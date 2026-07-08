/**
 * Cloudflare Worker — Stenographist Backend
 *
 * Handles:
 * 1. Session management (create, validate, kill)
 * 2. Event tracking (page_view, heartbeat, login_attempt, logout)
 * 3. Fingerprint storage
 * 4. Auth (login/logout)
 * 5. Audio upload → Speech-to-text → Medical history
 *
 * KV Namespace: AUTH_KV
 *   session:{session_id} → session data
 *   failed:{session_id} → brute force counter (TTL 1 hour)
 */

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: corsHeaders(env)
            });
        }

        // --- Session & Event endpoints (no auth required) ---
        if (request.method === 'POST' && path === '/stenographist/api/event') {
            return handleEvent(request, env);
        }
        if (request.method === 'POST' && path === '/stenographist/api/fingerprint') {
            return handleFingerprint(request, env);
        }
        if (request.method === 'POST' && path === '/stenographist/api/auth') {
            return handleAuth(request, env);
        }
        if (request.method === 'POST' && path === '/stenographist/api/logout') {
            return handleLogout(request, env);
        }
        if (request.method === 'GET' && path === '/stenographist/api/session') {
            return handleGetSession(request, env);
        }

        // --- Admin endpoints (auth required) ---
        if (request.method === 'GET' && path === '/stenographist/api/sessions') {
            return handleGetSessions(request, env);
        }
        if (request.method === 'POST' && path === '/stenographist/api/session/kill') {
            return handleKillSession(request, env);
        }
        if (request.method === 'GET' && path === '/stenographist/api/logs') {
            return handleGetLogs(request, env);
        }
        if (request.method === 'GET' && path === '/stenographist/api/users') {
            return handleGetUsers(request, env);
        }
        if (request.method === 'POST' && path === '/stenographist/api/users') {
            return handleCreateUser(request, env);
        }
        if (request.method === 'DELETE' && path.startsWith('/stenographist/api/users/')) {
            return handleDeleteUser(request, env);
        }
        if (request.method === 'PUT' && path.startsWith('/stenographist/api/users/')) {
            return handleChangePassword(request, env);
        }

        // --- Legacy endpoints for panel.html compatibility ---
        if (request.method === 'POST' && path === '/stenographist/login/api/logout') {
            return handleLogout(request, env);
        }

        // --- Audio processing (auth required) ---
        if (request.method === 'POST' && path === '/stenographist/api/process') {
            return handleProcess(request, env);
        }

        return jsonResponse({ error: 'Not found' }, 404, env);
    }
};

// ============================================================
// Session Management
// ============================================================

function getSessionId(request) {
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/session_id=([^;]+)/);
    return match ? match[1] : null;
}

function getIp(request) {
    return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function getCountry(request) {
    return request.headers.get('CF-IPCountry') || 'unknown';
}

function getUserAgent(request) {
    return request.headers.get('User-Agent') || 'unknown';
}

// --- Event endpoint ---
async function handleEvent(request, env) {
    try {
        const body = await request.json();
        const { session_id, type, path, timestamp, success, username } = body;

        if (!session_id || !type) {
            return jsonResponse({ error: 'Missing session_id or type' }, 400, env);
        }

        const ip = getIp(request);
        const country = getCountry(request);

        // Get or create session
        let session = await env.AUTH_KV.get(`session:${session_id}`, 'json');

        if (!session) {
            // New session
            session = {
                id: session_id,
                created: new Date(timestamp).toISOString(),
                lastSeen: new Date(timestamp).toISOString(),
                ip,
                country,
                userAgent: getUserAgent(request),
                username: null,
                failedAttempts: 0,
                events: []
            };
        } else {
            // Update lastSeen
            session.lastSeen = new Date(timestamp).toISOString();
        }

        // Add event
        session.events.push({
            type,
            ts: new Date(timestamp).toISOString(),
            path: path || null,
            success: success !== undefined ? success : null,
            username: username || null
        });

        // Keep only last 100 events
        if (session.events.length > 100) {
            session.events = session.events.slice(-100);
        }

        // Save session (TTL 1 hour)
        await env.AUTH_KV.put(
            `session:${session_id}`,
            JSON.stringify(session),
            { expirationTtl: 3600 }
        );

        return jsonResponse({ ok: true, session_id }, 200, env);
    } catch (err) {
        console.error('Event error:', err);
        return jsonResponse({ error: err.message }, 500, env);
    }
}

// --- Fingerprint endpoint ---
async function handleFingerprint(request, env) {
    try {
        const { session_id, fingerprint } = await request.json();

        if (!session_id || !fingerprint) {
            return jsonResponse({ error: 'Missing session_id or fingerprint' }, 400, env);
        }

        const session = await env.AUTH_KV.get(`session:${session_id}`, 'json');
        if (!session) {
            return jsonResponse({ error: 'Session not found' }, 404, env);
        }

        session.fingerprint = fingerprint;
        await env.AUTH_KV.put(
            `session:${session_id}`,
            JSON.stringify(session),
            { expirationTtl: 3600 }
        );

        return jsonResponse({ ok: true }, 200, env);
    } catch (err) {
        console.error('Fingerprint error:', err);
        return jsonResponse({ error: err.message }, 500, env);
    }
}

// --- Auth endpoint ---
async function handleAuth(request, env) {
    try {
        const { username, password } = await request.json();
        const sessionId = getSessionId(request);

        if (!username || !password) {
            return jsonResponse({ error: 'Missing username or password' }, 400, env);
        }

        if (!sessionId) {
            return jsonResponse({ error: 'No session' }, 401, env);
        }

        // Check brute force
        const failedKey = `failed:${sessionId}`;
        const failedCount = await env.AUTH_KV.get(failedKey);
        if (failedCount && parseInt(failedCount) >= 10) {
            return jsonResponse({ error: 'Слишком много попыток. Попробуйте через 15 минут.' }, 429, env);
        }

        // Validate credentials (hardcoded for demo)
        const validUsers = {
            'kanamiisa': { password: 'kanamiisa', role: 'root' }
        };

        const user = validUsers[username];

        if (!user || user.password !== password) {
            // Increment failed attempts
            const current = failedCount ? parseInt(failedCount) : 0;
            await env.AUTH_KV.put(failedKey, (current + 1).toString(), { expirationTtl: 3600 });

            return jsonResponse({ error: 'Неправильный логин или пароль' }, 401, env);
        }

        // Success — clear failed attempts
        await env.AUTH_KV.delete(failedKey);

        // Update session with username
        const session = await env.AUTH_KV.get(`session:${sessionId}`, 'json');
        if (session) {
            session.username = username;
            session.role = user.role;
            await env.AUTH_KV.put(
                `session:${sessionId}`,
                JSON.stringify(session),
                { expirationTtl: 3600 }
            );

            // Add to user's session list
            const listKey = `session_list:${username}`;
            const list = await env.AUTH_KV.get(listKey, 'json') || [];
            if (!list.includes(sessionId)) {
                list.push(sessionId);
                await env.AUTH_KV.put(listKey, JSON.stringify(list), { expirationTtl: 3600 });
            }
        }

        return jsonResponse({ ok: true, username, role: user.role }, 200, env);
    } catch (err) {
        console.error('Auth error:', err);
        return jsonResponse({ error: err.message }, 500, env);
    }
}

// --- Logout endpoint ---
async function handleLogout(request, env) {
    try {
        const sessionId = getSessionId(request);
        if (!sessionId) {
            return jsonResponse({ ok: true }, 200, env);
        }

        const session = await env.AUTH_KV.get(`session:${sessionId}`, 'json');
        if (session && session.username) {
            // Remove from user's session list
            const listKey = `session_list:${session.username}`;
            const list = await env.AUTH_KV.get(listKey, 'json') || [];
            const newList = list.filter(id => id !== sessionId);
            if (newList.length > 0) {
                await env.AUTH_KV.put(listKey, JSON.stringify(newList), { expirationTtl: 3600 });
            } else {
                await env.AUTH_KV.delete(listKey);
            }
        }

        // Delete session
        await env.AUTH_KV.delete(`session:${sessionId}`);
        await env.AUTH_KV.delete(`failed:${sessionId}`);

        return jsonResponse({ ok: true }, 200, env);
    } catch (err) {
        console.error('Logout error:', err);
        return jsonResponse({ error: err.message }, 500, env);
    }
}

// --- Get session endpoint ---
async function handleGetSession(request, env) {
    try {
        const sessionId = getSessionId(request);
        if (!sessionId) {
            return jsonResponse({ valid: false }, 200, env);
        }

        const session = await env.AUTH_KV.get(`session:${sessionId}`, 'json');
        if (!session) {
            return jsonResponse({ valid: false }, 200, env);
        }

        return jsonResponse({
            valid: true,
            session_id: session.id,
            created: session.created,
            lastSeen: session.lastSeen,
            username: session.username,
            role: session.role,
            failedAttempts: session.failedAttempts || 0
        }, 200, env);
    } catch (err) {
        console.error('GetSession error:', err);
        return jsonResponse({ error: err.message }, 500, env);
    }
}

// --- Get sessions (admin) ---
async function handleGetSessions(request, env) {
    try {
        const sessionId = getSessionId(request);
        if (!sessionId) {
            return jsonResponse({ error: 'No session' }, 401, env);
        }

        const session = await env.AUTH_KV.get(`session:${sessionId}`, 'json');
        if (!session || session.role !== 'root') {
            return jsonResponse({ error: 'Forbidden' }, 403, env);
        }

        // List all sessions
        const list = await env.AUTH_KV.list({ prefix: 'session:' });
        const sessions = [];

        for (const key of list.keys) {
            if (key.name === `session:${sessionId}`) continue; // Skip self

            const s = await env.AUTH_KV.get(key.name, 'json');
            if (s) {
                // Check if active (lastSeen within 2 minutes)
                const lastSeen = new Date(s.lastSeen).getTime();
                const isActive = (Date.now() - lastSeen) < 120000;

                sessions.push({
                    session_id: s.id,
                    username: s.username,
                    ip: s.ip,
                    country: s.country,
                    userAgent: s.userAgent,
                    lastSeen: s.lastSeen,
                    created: s.created,
                    failedAttempts: s.failedAttempts || 0,
                    active: isActive,
                    incognito: s.fingerprint?.incognito || false
                });
            }
        }

        return jsonResponse({ sessions }, 200, env);
    } catch (err) {
        console.error('GetSessions error:', err);
        return jsonResponse({ error: err.message }, 500, env);
    }
}

// --- Kill session (admin) ---
async function handleKillSession(request, env) {
    try {
        const adminSessionId = getSessionId(request);
        if (!adminSessionId) {
            return jsonResponse({ error: 'No session' }, 401, env);
        }

        const adminSession = await env.AUTH_KV.get(`session:${adminSessionId}`, 'json');
        if (!adminSession || adminSession.role !== 'root') {
            return jsonResponse({ error: 'Forbidden' }, 403, env);
        }

        const { session_id } = await request.json();
        if (!session_id) {
            return jsonResponse({ error: 'Missing session_id' }, 400, env);
        }

        const targetSession = await env.AUTH_KV.get(`session:${session_id}`, 'json');
        if (!targetSession) {
            return jsonResponse({ error: 'Session not found' }, 404, env);
        }

        // Remove from user's session list
        if (targetSession.username) {
            const listKey = `session_list:${targetSession.username}`;
            const list = await env.AUTH_KV.get(listKey, 'json') || [];
            const newList = list.filter(id => id !== session_id);
            if (newList.length > 0) {
                await env.AUTH_KV.put(listKey, JSON.stringify(newList), { expirationTtl: 3600 });
            } else {
                await env.AUTH_KV.delete(listKey);
            }
        }

        // Delete session
        await env.AUTH_KV.delete(`session:${session_id}`);
        await env.AUTH_KV.delete(`failed:${session_id}`);

        return jsonResponse({ ok: true }, 200, env);
    } catch (err) {
        console.error('KillSession error:', err);
        return jsonResponse({ error: err.message }, 500, env);
    }
}

// --- Get logs (admin) - compatible with panel.html format ---
async function handleGetLogs(request, env) {
    try {
        const sessionId = getSessionId(request);
        if (!sessionId) {
            return jsonResponse({ error: 'No session' }, 401, env);
        }

        const session = await env.AUTH_KV.get(`session:${sessionId}`, 'json');
        if (!session || session.role !== 'root') {
            return jsonResponse({ error: 'Forbidden' }, 403, env);
        }

        // List all sessions and format for panel.html
        const list = await env.AUTH_KV.list({ prefix: 'session:' });
        const logs = [];

        for (const key of list.keys) {
            const s = await env.AUTH_KV.get(key.name, 'json');
            if (s) {
                const fp = s.fingerprint || {};
                logs.push({
                    session_id: s.id,
                    username: s.username,
                    ip: s.ip,
                    device: {
                        country: s.country,
                        platform: fp.navigator?.platform || fp.navigator?.userAgentData?.platform || '-',
                        browser: parseBrowser(fp.navigator?.userAgent),
                        raw: s.userAgent
                    },
                    user_agent: s.userAgent,
                    session_start: s.created,
                    network: fp.network || fp.navigator?.connection || null,
                    battery: fp.battery || null,
                    gpu: fp.webgl || null,
                    memory: fp.memory || fp.cpu || null,
                    navigator: fp.navigator || null,
                    screen: fp.screen || null,
                    window: fp.window || null,
                    timezone: fp.datetime || fp.intl || null,
                    failedAttempts: s.failedAttempts || 0,
                    active: (Date.now() - new Date(s.lastSeen).getTime()) < 120000
                });
            }
        }

        // Sort by session_start descending
        logs.sort((a, b) => new Date(b.session_start) - new Date(a.session_start));

        return jsonResponse({ logs }, 200, env);
    } catch (err) {
        console.error('GetLogs error:', err);
        return jsonResponse({ error: err.message }, 500, env);
    }
}

function parseBrowser(ua) {
    if (!ua) return '-';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Edg')) return 'Edge';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Safari')) return 'Safari';
    return ua.split(' ').pop() || '-';
}

// --- Get users (admin) ---
async function handleGetUsers(request, env) {
    try {
        const sessionId = getSessionId(request);
        if (!sessionId) {
            return jsonResponse({ error: 'No session' }, 401, env);
        }

        const session = await env.AUTH_KV.get(`session:${sessionId}`, 'json');
        if (!session || session.role !== 'root') {
            return jsonResponse({ error: 'Forbidden' }, 403, env);
        }

        // Hardcoded users for demo
        const users = [
            { username: 'kanamiisa', created_at: Date.now() }
        ];

        return jsonResponse({ users }, 200, env);
    } catch (err) {
        console.error('GetUsers error:', err);
        return jsonResponse({ error: err.message }, 500, env);
    }
}

// --- Create user (admin) ---
async function handleCreateUser(request, env) {
    try {
        const sessionId = getSessionId(request);
        if (!sessionId) {
            return jsonResponse({ error: 'No session' }, 401, env);
        }

        const session = await env.AUTH_KV.get(`session:${sessionId}`, 'json');
        if (!session || session.role !== 'root') {
            return jsonResponse({ error: 'Forbidden' }, 403, env);
        }

        const { username, password } = await request.json();
        if (!username || !password) {
            return jsonResponse({ error: 'Missing username or password' }, 400, env);
        }

        // Store user in KV
        await env.AUTH_KV.put(`user:${username}`, JSON.stringify({
            username,
            password,
            created_at: Date.now()
        }), { expirationTtl: 86400 * 365 });

        return jsonResponse({ ok: true, username }, 200, env);
    } catch (err) {
        console.error('CreateUser error:', err);
        return jsonResponse({ error: err.message }, 500, env);
    }
}

// --- Delete user (admin) ---
async function handleDeleteUser(request, env) {
    try {
        const sessionId = getSessionId(request);
        if (!sessionId) {
            return jsonResponse({ error: 'No session' }, 401, env);
        }

        const session = await env.AUTH_KV.get(`session:${sessionId}`, 'json');
        if (!session || session.role !== 'root') {
            return jsonResponse({ error: 'Forbidden' }, 403, env);
        }

        const url = new URL(request.url);
        const username = decodeURIComponent(url.pathname.split('/').pop());

        if (username === 'kanamiisa') {
            return jsonResponse({ error: 'Cannot delete root user' }, 400, env);
        }

        await env.AUTH_KV.delete(`user:${username}`);
        return jsonResponse({ ok: true }, 200, env);
    } catch (err) {
        console.error('DeleteUser error:', err);
        return jsonResponse({ error: err.message }, 500, env);
    }
}

// --- Change password (admin) ---
async function handleChangePassword(request, env) {
    try {
        const sessionId = getSessionId(request);
        if (!sessionId) {
            return jsonResponse({ error: 'No session' }, 401, env);
        }

        const session = await env.AUTH_KV.get(`session:${sessionId}`, 'json');
        if (!session || session.role !== 'root') {
            return jsonResponse({ error: 'Forbidden' }, 403, env);
        }

        const url = new URL(request.url);
        const username = decodeURIComponent(url.pathname.split('/').pop());
        const { password } = await request.json();

        if (!password) {
            return jsonResponse({ error: 'Missing password' }, 400, env);
        }

        const user = await env.AUTH_KV.get(`user:${username}`, 'json');
        if (!user) {
            return jsonResponse({ error: 'User not found' }, 404, env);
        }

        user.password = password;
        await env.AUTH_KV.put(`user:${username}`, JSON.stringify(user), { expirationTtl: 86400 * 365 });

        return jsonResponse({ ok: true }, 200, env);
    } catch (err) {
        console.error('ChangePassword error:', err);
        return jsonResponse({ error: err.message }, 500, env);
    }
}

// ============================================================
// Audio Processing
// ============================================================

async function handleProcess(request, env) {
    const headers = corsHeaders(env);

    try {
        const formData = await request.formData();
        const audioFile = formData.get('audio');

        if (!audioFile) {
            return jsonResponse({ error: 'No audio file provided' }, 400, env);
        }

        const accept = request.headers.get('accept') || '';
        const useSSE = accept.includes('text/event-stream');

        if (useSSE) {
            return handleProcessSSE(audioFile, env);
        }

        return await processFull(audioFile, env);
    } catch (err) {
        console.error('Process error:', err);
        return jsonResponse({ error: err.message }, 500, env);
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
            ...headers,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
}

async function processFull(audioFile, env) {
    const transcript = await transcribeAudio(audioFile, env);
    const medicalHistory = await generateMedicalHistory(transcript, env);
    return jsonResponse({ transcript, medicalHistory }, 200, env);
}

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

async function generateMedicalHistory(transcript, env) {
    const systemPrompt = `Ты — медицинский ассистент. По givenному тексту записи врача или пациента, создай структурированную историю болезни.

Верни ТОЛЬКО валидный JSON без markdown и комментариев по этой схеме:

{
    "passport": {
        "fio": "ФИО",
        "dob": "Дата рождения",
        "age": "Возраст",
        "gender": "Пол",
        "address": "Адрес",
        "admissionDate": "Дата и время поступления",
        "dischargeDate": "Дата и время выписки (пустая строка если неизвестно)",
        "referredBy": "Кем направлен",
        "department": "Отделение"
    },
    "diagnosis": {
        "admission": "Диагноз при поступлении",
        "main": "Основной клинический диагноз (МКБ-код если можно определить)",
        "complications": "Осложнения",
        "comorbidities": "Сопутствующие заболевания"
    },
    "complaints": "Жалобы при поступлении (свободный текст)",
    "anamnesis": "Анамнез заболевания — история текущей болезни",
    "lifeAnamnesis": {
        "pastDiseases": "Перенесённые заболевания",
        "surgeries": "Операции",
        "traumas": "Травмы",
        "chronicDiseases": "Хронические заболевания",
        "allergies": "Аллергические реакции",
        "badHabits": "Вредные привычки",
        "heredity": "Наследственность"
    },
    "status": {
        "generalState": "Общее состояние",
        "consciousness": "Сознание",
        "position": "Положение",
        "temperature": "Температура",
        "height": "Рост",
        "weight": "Вес",
        "bmi": "ИМТ"
    },
    "skin": {
        "color": "Окраска кожи",
        "rash": "Сыпь",
        "moisture": "Влажность",
        "turgor": "Тургор",
        "mucous": "Состояние слизистых"
    },
    "lymphNodes": "Периферические лимфоузлы",
    "respiratory": {
        "respRate": "ЧДД",
        "nasalBreathing": "Носовое дыхание",
        "percussion": "Перкуторный звук",
        "auscultation": "Аускультативная картина",
        "wheezes": "Хрипы",
        "dyspnea": "Одышка",
        "spo2": "SpO₂"
    },
    "cardiovascular": {
        "bp": "АД",
        "pulse": "Пульс",
        "heartBorders": "Границы сердца",
        "heartTones": "Тоны сердца",
        "murmurs": "Шумы",
        "edema": "Отеки"
    },
    "digestive": {
        "tongue": "Язык",
        "abdomen": "Живот",
        "liver": "Печень",
        "spleen": "Селезенка",
        "stool": "Стул"
    },
    "urinary": {
        "urination": "Мочеиспускание",
        "punchingSymptom": "Симптом поколачивания",
        "urEdema": "Отёки"
    },
    "nervous": {
        "consciousness": "Сознание",
        "orientation": "Ориентация",
        "meningeal": "Менингеальные симптомы",
        "focalSymptoms": "Очаговая симптоматика"
    },
    "labResults": {
        "cbc": "ОАК",
        "urinalysis": "ОАМ",
        "biochemistry": "Биохимия",
        "xray": "Рентгенография",
        "ct": "КТ",
        "ecg": "ЭКГ",
        "otherStudies": "Прочие исследования"
    },
    "diagnosisRationale": "Обоснование диагноза — краткий текст"
}

Правила:
- Если информации по полю нет, поставь пустую строку "" или "не указано"
- Сохраняй медицинскую терминологию
- Будь точным, не добавляй информацию, которой нет в записи
- Пиши на русском языке`;

    const userPrompt = `Транскрипция медицинской записи:\n\n${transcript}`;

    if (env.AI) {
        try {
            const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                max_tokens: 4096,
                temperature: 0.3
            });

            if (result && result.response) {
                return parseJSON(result.response);
            }
        } catch (err) {
            console.warn('Workers AI LLM failed:', err.message);
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

// ============================================================
// Helpers
// ============================================================

function countWords(text) {
    return text.split(/\s+/).filter(w => w.length > 0).length;
}

function corsHeaders(env) {
    const allowedOrigins = env.ALLOWED_ORIGINS
        ? env.ALLOWED_ORIGINS.split(',')
        : ['*'];

    return {
        'Access-Control-Allow-Origin': allowedOrigins[0] || '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
        'Access-Control-Allow-Credentials': 'true'
    };
}

function jsonResponse(data, status, env) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...corsHeaders(env),
            'Content-Type': 'application/json'
        }
    });
}
