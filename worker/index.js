/**
 * Kanamiisa Worker — Main entry point
 * Handles routing, auth, and serves static files
 */

import { verify, generateSecret, generateURI } from './totp.js';
import {
    hashPassword, verifyPassword, createSession, validateSession,
    deleteSession, getUser, saveUser, deleteUser, listUsers,
    saveLog, listLogs, saveTOTPSecret, getTOTPSecret, validateSetupAuth
} from './auth.js';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        // === Stenographist routes ===

        // Redirect /stenographist (no trailing slash) to login
        if (path === '/stenographist') {
            return Response.redirect(new URL('/stenographist/login', request.url), 302);
        }

        if (path.startsWith('/stenographist/')) {
            const subpath = path.slice('/stenographist/'.length);

            // Login page (no auth)
            if (subpath === 'login' || subpath === 'login/' || subpath === '') {
                return serveFile(env, 'stenographist/login.html');
            }

            // Auth API (no auth)
            if (subpath === 'login/api/auth' && request.method === 'POST') {
                return handleAuth(request, env);
            }
            if (subpath === 'login/api/logout' && request.method === 'POST') {
                return handleLogout(request, env);
            }
            if (subpath === 'login/api/setup' && request.method === 'POST') {
                return handleSetup(request, env);
            }
            if (subpath === 'login/api/secret' && request.method === 'POST') {
                return handleGetSecret(request, env);
            }

            // TOTP setup page (cheat code protected, no session)
            if (subpath === 'login/setup' || subpath === 'login/setup/') {
                return serveFile(env, 'stenographist/login/setup.html');
            }

            // Everything else requires auth
            const session = await validateSession(request, env);

            if (!session) {
                return Response.redirect(new URL('/stenographist/login', request.url), 302);
            }

            // Admin API
            if (subpath === 'api/users' && request.method === 'GET') {
                if (!session.is_root) return jsonResponse({ error: 'Forbidden' }, 403);
                return handleListUsers(env);
            }

            if (subpath === 'api/users' && request.method === 'POST') {
                if (!session.is_root) return jsonResponse({ error: 'Forbidden' }, 403);
                return handleCreateUser(request, env);
            }

            if (subpath.match(/^api\/users\/[^/]+$/) && request.method === 'DELETE') {
                if (!session.is_root) return jsonResponse({ error: 'Forbidden' }, 403);
                const username = subpath.split('/').pop();
                return handleDeleteUser(username, env);
            }

            if (subpath.match(/^api\/users\/[^/]+$/) && request.method === 'PUT') {
                if (!session.is_root) return jsonResponse({ error: 'Forbidden' }, 403);
                const username = subpath.split('/').pop();
                return handleUpdatePassword(username, request, env);
            }

            if (subpath === 'api/logs' && request.method === 'GET') {
                if (!session.is_root) return jsonResponse({ error: 'Forbidden' }, 403);
                return handleListLogs(env);
            }

            // Stenographist API (audio processing)
            if (subpath === 'api/process' && request.method === 'POST') {
                return handleProcess(request, env);
            }

            // Session info (for frontend)
            if (subpath === 'api/session' && request.method === 'GET') {
                return jsonResponse({ username: session.username, is_root: session.is_root });
            }

            // Static files (CSS, JS, HTML)
            return serveFile(env, path.slice(1)); // Remove leading /
        }

        // Everything else: serve static files directly (no auth)
        if (path === '/' || path === '') {
            return serveFile(env, 'index.html');
        }
        return serveFile(env, path.slice(1));
    }
};

// === Auth Handlers ===

async function handleAuth(request, env) {
    try {
        const { username, password, clientInfo } = await request.json();

        if (!username || !password) {
            return jsonResponse({ error: 'Неправильный логин или пароль' }, 401);
        }

        let isRoot = false;
        let valid = false;

        if (username === 'kanamiisa') {
            // Root user: password = TOTP code
            const secret = await getTOTPSecret(env);
            if (secret) {
                valid = await verify(secret, password);
            }
            isRoot = true;
        } else {
            // Guest user: password = account password
            const user = await getUser(env, username);
            if (user) {
                valid = await verifyPassword(password, user.password_hash);
            }
        }

        if (!valid) {
            return jsonResponse({ error: 'Неправильный логин или пароль' }, 401);
        }

        const sessionId = await createSession(env, username, isRoot);

        // Log login
        const ip = request.headers.get('cf-connecting-ip') || 'unknown';
        const ua = request.headers.get('user-agent') || 'unknown';
        const serverInfo = await extractDeviceInfo(request);
        const deviceInfo = { ...serverInfo, ...(clientInfo || {}) };
        await saveLog(env, username, ip, ua, deviceInfo, Date.now());

        return new Response(JSON.stringify({ success: true, is_root: isRoot }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': `session=${sessionId}; Path=/; HttpOnly; SameSite=Strict`
            }
        });
    } catch (err) {
        return jsonResponse({ error: 'Неправильный логин или пароль' }, 401);
    }
}

async function handleLogout(request, env) {
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/session=([a-f0-9]+)/);

    if (match) {
        await deleteSession(env, match[1]);
    }

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': 'session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'
        }
    });
}

async function handleSetup(request, env) {
    try {
        const valid = await validateSetupAuth(request);
        if (!valid) {
            return jsonResponse({ error: 'Invalid code' }, 403);
        }

        const secret = generateSecret();
        await saveTOTPSecret(env, secret);

        const uri = generateURI(secret);
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(uri)}`;

        return jsonResponse({ secret, uri, qr_url: qrUrl });
    } catch (err) {
        return jsonResponse({ error: err.message }, 500);
    }
}

async function handleGetSecret(request, env) {
    try {
        const valid = await validateSetupAuth(request);
        if (!valid) {
            return jsonResponse({ error: 'Invalid code' }, 403);
        }

        const secret = await getTOTPSecret(env);
        if (!secret) {
            return jsonResponse({ error: 'No TOTP configured' }, 404);
        }

        const uri = generateURI(secret);
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(uri)}`;

        return jsonResponse({ secret, uri, qr_url: qrUrl });
    } catch (err) {
        return jsonResponse({ error: err.message }, 500);
    }
}

// === User Management ===

async function handleListUsers(env) {
    const users = await listUsers(env);
    return jsonResponse({ users });
}

async function handleCreateUser(request, env) {
    try {
        const { username, password } = await request.json();

        if (!username || !password) {
            return jsonResponse({ error: 'Username and password required' }, 400);
        }

        const existing = await getUser(env, username);
        if (existing) {
            return jsonResponse({ error: 'User already exists' }, 409);
        }

        const hash = await hashPassword(password);
        await saveUser(env, username, hash);

        return jsonResponse({ success: true });
    } catch (err) {
        return jsonResponse({ error: err.message }, 500);
    }
}

async function handleDeleteUser(username, env) {
    if (username === 'kanamiisa') {
        return jsonResponse({ error: 'Cannot delete root user' }, 403);
    }

    await deleteUser(env, username);
    return jsonResponse({ success: true });
}

async function handleUpdatePassword(username, request, env) {
    if (username === 'kanamiisa') {
        return jsonResponse({ error: 'Cannot change root password this way' }, 403);
    }

    const { password } = await request.json();
    if (!password || password.length < 4) {
        return jsonResponse({ error: 'Password must be at least 4 characters' }, 400);
    }

    const user = await getUser(env, username);
    if (!user) {
        return jsonResponse({ error: 'User not found' }, 404);
    }

    const hash = await hashPassword(password);
    await saveUser(env, username, hash);
    return jsonResponse({ success: true });
}

// === Logs ===

async function handleListLogs(env) {
    const logs = await listLogs(env);
    return jsonResponse({ logs });
}

// === Device Info Extraction ===

async function extractDeviceInfo(request) {
    const ua = request.headers.get('user-agent') || '';
    const country = request.headers.get('cf-ipcountry') || '??';

    // Basic device detection from User-Agent
    let platform = 'unknown';
    let browser = 'unknown';

    if (ua.includes('Windows')) platform = 'Windows';
    else if (ua.includes('Mac')) platform = 'macOS';
    else if (ua.includes('Linux')) platform = 'Linux';
    else if (ua.includes('Android')) platform = 'Android';
    else if (ua.includes('iOS') || ua.includes('iPhone')) platform = 'iOS';

    if (ua.includes('Chrome')) browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari')) browser = 'Safari';
    else if (ua.includes('Edge')) browser = 'Edge';

    return { platform, browser, country, raw: ua };
}

// === Static File Serving ===

async function serveFile(env, path) {
    try {
        const response = await env.ASSETS.fetch(new Request(`https://kanamiisa.uk/${path}`));
        if (response.ok) {
            return response;
        }
        return new Response('Not Found', { status: 404 });
    } catch (err) {
        return new Response('Not Found', { status: 404 });
    }
}

// === Stenographist API (audio processing) ===

async function handleProcess(request, env) {
    // Import from the old worker code
    try {
        const formData = await request.formData();
        const audioFile = formData.get('audio');

        if (!audioFile) {
            return jsonResponse({ error: 'No audio file provided' }, 400);
        }

        const accept = request.headers.get('accept') || '';
        const useSSE = accept.includes('text/event-stream');

        if (useSSE) {
            return handleProcessSSE(audioFile, env);
        }

        return await processFull(audioFile, env);
    } catch (err) {
        return jsonResponse({ error: err.message }, 500);
    }
}

function handleProcessSSE(audioFile, env) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            function sendEvent(data) {
                const payload = `data: ${JSON.stringify(data)}\n\n`;
                controller.enqueue(encoder.encode(payload));
            }

            try {
                sendEvent({ type: 'progress', step: 0, detail: 'Отправка аудио...', percent: 5 });
                const transcript = await transcribeAudio(audioFile, env);
                sendEvent({ type: 'progress', step: 1, detail: `Речь распознана (${countWords(transcript)} слов)`, percent: 35 });

                sendEvent({ type: 'progress', step: 2, detail: 'Анализ текста...', percent: 45 });
                const medicalHistory = await generateMedicalHistory(transcript, env);
                sendEvent({ type: 'progress', step: 3, detail: 'История болезни сформирована', percent: 95 });

                sendEvent({ type: 'progress', step: 3, detail: 'Готово', percent: 100 });
                sendEvent({ type: 'result', data: { transcript, medicalHistory } });
            } catch (err) {
                sendEvent({ type: 'error', message: err.message });
            }

            controller.close();
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
}

async function processFull(audioFile, env) {
    const transcript = await transcribeAudio(audioFile, env);
    const medicalHistory = await generateMedicalHistory(transcript, env);
    return jsonResponse({ transcript, medicalHistory });
}

// === Speech-to-Text ===

async function transcribeAudio(audioFile, env) {
    if (env.AI) {
        try {
            const audioBuffer = await audioFile.arrayBuffer();
            const result = await env.AI.run('@cf/openai/whisper', {
                audio: [...new Uint8Array(audioBuffer)]
            });

            if (result && result.text) {
                return result.text;
            }
        } catch (err) {
            console.warn('Workers AI Whisper failed:', err.message);
        }
    }

    throw new Error('Speech-to-text service not configured.');
}

// === Medical History Generation ===

async function generateMedicalHistory(transcript, env) {
    const systemPrompt = `Ты — медицинский ассистент. По givenному тексту записи врача или пациента, создай структурированную историю болезни.

Верни ТОЛЬКО валидный JSON без markdown и комментариев по этой схеме:

{
    "passport": { "fio": "", "dob": "", "age": "", "gender": "", "address": "", "admissionDate": "", "dischargeDate": "", "referredBy": "", "department": "" },
    "diagnosis": { "admission": "", "main": "", "complications": "", "comorbidities": "" },
    "complaints": "",
    "anamnesis": "",
    "lifeAnamnesis": { "pastDiseases": "", "surgeries": "", "traumas": "", "chronicDiseases": "", "allergies": "", "badHabits": "", "heredity": "" },
    "status": { "generalState": "", "consciousness": "", "position": "", "temperature": "", "height": "", "weight": "", "bmi": "" },
    "skin": { "color": "", "rash": "", "moisture": "", "turgor": "", "mucous": "" },
    "lymphNodes": "",
    "respiratory": { "respRate": "", "nasalBreathing": "", "percussion": "", "auscultation": "", "wheezes": "", "dyspnea": "", "spo2": "" },
    "cardiovascular": { "bp": "", "pulse": "", "heartBorders": "", "heartTones": "", "murmurs": "", "edema": "" },
    "digestive": { "tongue": "", "abdomen": "", "liver": "", "spleen": "", "stool": "" },
    "urinary": { "urination": "", "punchingSymptom": "", "urEdema": "" },
    "nervous": { "consciousness": "", "orientation": "", "meningeal": "", "focalSymptoms": "" },
    "labResults": { "cbc": "", "urinalysis": "", "biochemistry": "", "xray": "", "ct": "", "ecg": "", "otherStudies": "" },
    "diagnosisRationale": ""
}

Правила:
- Если информации по полю нет, поставь пустую строку ""
- Сохраняй медицинскую терминологию
- Будь точным, не добавляй информацию, которой нет в записи
- Пиши на русском языке`;

    const userPrompt = `Транскрипция медицинской записи:\n\n${transcript}`;

    if (env.GROQ_API_KEY) {
        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.1-8b-instant',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    max_tokens: 4096,
                    temperature: 0.3
                })
            });

            if (!response.ok) {
                throw new Error(`Groq API error ${response.status}`);
            }

            const data = await response.json();
            if (data.choices && data.choices[0]) {
                return parseJSON(data.choices[0].message.content);
            }
        } catch (err) {
            console.warn('Groq LLM failed:', err.message);
        }
    }

    throw new Error('AI model not configured.');
}

function parseJSON(text) {
    let cleaned = text.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    try {
        return JSON.parse(cleaned);
    } catch (e) {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error('Failed to parse AI response as JSON');
    }
}

function countWords(text) {
    return text.split(/\s+/).filter(w => w.length > 0).length;
}

// === Helpers ===

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept'
    };
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json'
        }
    });
}
