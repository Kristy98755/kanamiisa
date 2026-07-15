/**
 * Kanamiisa Worker — Main entry point
 * Handles routing, auth, session management, and serves static files
 */

import { verify, generateSecret, generateURI } from './totp.js';
import {
    hashPassword, verifyPassword, createSession, validateSession,
    deleteSession, getUser, saveUser, deleteUser, listUsers,
    saveLog, listLogs, saveTOTPSecret, getTOTPSecret, validateSetupAuth
} from './auth.js';
import { mailFetch, mailEmail } from './mail.js';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        // === Login routes (canonical entry point at /login) ===
        if (path === '/login' || path === '/login/') {
            return serveFile(env, 'stenographist/login.html');
        }
        if (path.startsWith('/login/')) {
            const lsub = path.slice('/login/'.length);
            if (lsub === 'setup' || lsub === 'setup/') {
                return serveFile(env, 'stenographist/login/setup.html');
            }
            if (lsub === 'api/auth' && request.method === 'POST') return handleAuth(request, env);
            if (lsub === 'api/logout' && request.method === 'POST') return handleLogout(request, env);
            if (lsub === 'api/setup' && request.method === 'POST') return handleSetup(request, env);
            if (lsub === 'api/secret' && request.method === 'POST') return handleGetSecret(request, env);
        }

        // === Stenographist routes ===

        if (path === '/stenographist') {
            return Response.redirect(new URL('/login', request.url), 302);
        }

        if (path.startsWith('/stenographist/')) {
            const subpath = path.slice('/stenographist/'.length);

            // --- No-auth routes ---

            if (subpath === 'login' || subpath === 'login/') {
                return Response.redirect(new URL('/login' + url.search, request.url), 302);
            }
            if (subpath === '') {
                return serveFile(env, 'stenographist/login.html');
            }
            if (subpath === 'login/setup' || subpath === 'login/setup/') {
                return Response.redirect(new URL('/login/setup' + url.search, request.url), 302);
            }
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

            // --- Session tracking (no auth, uses session_id cookie) ---
            if (subpath === 'api/event' && request.method === 'POST') {
                return handleEvent(request, env);
            }
            if (subpath === 'api/fingerprint' && request.method === 'POST') {
                return handleFingerprint(request, env);
            }
            if (subpath === 'api/logout' && request.method === 'POST') {
                return handleNewLogout(request, env);
            }
            if (subpath === 'api/session' && request.method === 'GET') {
                return handleGetSession(request, env);
            }

            // --- Admin session endpoints (session_id cookie, role-based) ---
            if (subpath === 'api/sessions' && request.method === 'GET') {
                return handleGetSessions(request, env);
            }
            if (subpath === 'api/session/kill' && request.method === 'POST') {
                return handleKillSession(request, env);
            }

            // --- Auth-required routes (old session cookie) ---
            const session = await validateSession(request, env);

            if (!session) {
                return Response.redirect(new URL('/login', request.url), 302);
            }

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
            if (subpath === 'api/process' && request.method === 'POST') {
                return handleProcess(request, env);
            }

            // Static files
            return serveFile(env, path.slice(1));
        }

        // === Mail routes (auth-gated via session system) ===
        if (path === '/mail' || path === '/mail/' || path.startsWith('/mail/api/')) {
            return mailFetch(request, env);
        }

        // Everything else: serve static files directly
        if (path === '/' || path === '') {
            return serveFile(env, 'index.html');
        }
        return serveFile(env, path.slice(1));
    },

    async email(message, env, ctx) {
        return mailEmail(message, env, ctx);
    }
};

// ============================================================
// Stenographist Session Tracking (session_id cookie system)
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

// --- Event endpoint (heartbeat, page_view, etc.) ---
async function handleEvent(request, env) {
    try {
        const body = await request.json();
        const { session_id, type, path: eventPath, timestamp, success, username } = body;

        if (!session_id || !type) {
            return jsonResponse({ error: 'Missing session_id or type' }, 400);
        }

        const ip = getIp(request);
        const country = getCountry(request);

        let session = await env.AUTH_KV.get(`session:${session_id}`, 'json');

        if (!session) {
            session = {
                id: session_id,
                created: new Date(timestamp).toISOString(),
                lastSeen: new Date(timestamp).toISOString(),
                ip,
                country,
                userAgent: getUserAgent(request),
                username: null,
                role: null,
                failedAttempts: 0,
                events: []
            };
        } else {
            session.lastSeen = new Date(timestamp).toISOString();
        }

        session.events.push({
            type,
            ts: new Date(timestamp).toISOString(),
            path: eventPath || null,
            success: success !== undefined ? success : null,
            username: username || null
        });

        if (session.events.length > 100) {
            session.events = session.events.slice(-100);
        }

        await env.AUTH_KV.put(
            `session:${session_id}`,
            JSON.stringify(session),
            { expirationTtl: 3600 }
        );

        if (session.kick) {
            return jsonResponse({ ok: true, session_id, kick: true });
        }

        return jsonResponse({ ok: true, session_id });
    } catch (err) {
        console.error('Event error:', err);
        return jsonResponse({ error: err.message }, 500);
    }
}

// --- Fingerprint endpoint ---
async function handleFingerprint(request, env) {
    try {
        const { session_id, fingerprint } = await request.json();

        if (!session_id || !fingerprint) {
            return jsonResponse({ error: 'Missing session_id or fingerprint' }, 400);
        }

        const session = await env.AUTH_KV.get(`session:${session_id}`, 'json');
        if (!session) {
            return jsonResponse({ error: 'Session not found' }, 404);
        }

        session.fingerprint = fingerprint;
        await env.AUTH_KV.put(
            `session:${session_id}`,
            JSON.stringify(session),
            { expirationTtl: 3600 }
        );

        return jsonResponse({ ok: true });
    } catch (err) {
        console.error('Fingerprint error:', err);
        return jsonResponse({ error: err.message }, 500);
    }
}

// --- Get session endpoint (returns both old and new formats) ---
async function handleGetSession(request, env) {
    try {
        const sessionId = getSessionId(request);
        if (!sessionId) {
            return jsonResponse({ valid: false }, 200);
        }

        const session = await env.AUTH_KV.get(`session:${sessionId}`, 'json');
        if (!session) {
            return jsonResponse({ valid: false }, 200);
        }

        return jsonResponse({
            valid: true,
            session_id: session.id,
            created: session.created,
            lastSeen: session.lastSeen,
            username: session.username,
            role: session.role,
            is_root: session.role === 'root',
            failedAttempts: session.failedAttempts || 0
        });
    } catch (err) {
        console.error('GetSession error:', err);
        return jsonResponse({ error: err.message }, 500);
    }
}

// --- New logout endpoint (session_id cookie) ---
async function handleNewLogout(request, env) {
    try {
        const sessionId = getSessionId(request);
        if (!sessionId) {
            return jsonResponse({ ok: true });
        }

        const session = await env.AUTH_KV.get(`session:${sessionId}`, 'json');
        if (session && session.username) {
            const listKey = `session_list:${session.username}`;
            const list = await env.AUTH_KV.get(listKey, 'json') || [];
            const newList = list.filter(id => id !== sessionId);
            if (newList.length > 0) {
                await env.AUTH_KV.put(listKey, JSON.stringify(newList), { expirationTtl: 3600 });
            } else {
                await env.AUTH_KV.delete(listKey);
            }
        }

        await env.AUTH_KV.delete(`session:${sessionId}`);
        await env.AUTH_KV.delete(`failed:${sessionId}`);

        return jsonResponse({ ok: true });
    } catch (err) {
        console.error('Logout error:', err);
        return jsonResponse({ error: err.message }, 500);
    }
}

// --- Get sessions (admin) ---
async function handleGetSessions(request, env) {
    try {
        const sessionId = getSessionId(request);
        if (!sessionId) {
            return jsonResponse({ error: 'No session' }, 401);
        }

        const session = await env.AUTH_KV.get(`session:${sessionId}`, 'json');
        if (!session || session.role !== 'root') {
            return jsonResponse({ error: 'Forbidden' }, 403);
        }

        const list = await env.AUTH_KV.list({ prefix: 'session:' });
        const sessions = [];

        for (const key of list.keys) {
            const s = await env.AUTH_KV.get(key.name, 'json');
            if (s) {
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

        return jsonResponse({ sessions });
    } catch (err) {
        console.error('GetSessions error:', err);
        return jsonResponse({ error: err.message }, 500);
    }
}

// --- Kill session (admin) ---
async function handleKillSession(request, env) {
    try {
        const adminSessionId = getSessionId(request);
        if (!adminSessionId) {
            return jsonResponse({ error: 'No session' }, 401);
        }

        const adminSession = await env.AUTH_KV.get(`session:${adminSessionId}`, 'json');
        if (!adminSession || adminSession.role !== 'root') {
            return jsonResponse({ error: 'Forbidden' }, 403);
        }

        const { session_id } = await request.json();
        if (!session_id) {
            return jsonResponse({ error: 'Missing session_id' }, 400);
        }

        const targetSession = await env.AUTH_KV.get(`session:${session_id}`, 'json');
        if (!targetSession) {
            return jsonResponse({ error: 'Session not found' }, 404);
        }

        targetSession.kick = true;
        await env.AUTH_KV.put(
            `session:${session_id}`,
            JSON.stringify(targetSession),
            { expirationTtl: 3600 }
        );

        return jsonResponse({ ok: true });
    } catch (err) {
        console.error('KillSession error:', err);
        return jsonResponse({ error: err.message }, 500);
    }
}

// ============================================================
// Legacy Auth (old session cookie system for login.html)
// ============================================================

async function handleAuth(request, env) {
    try {
        const { username, password, clientInfo } = await request.json();

        if (!username || !password) {
            return jsonResponse({ error: 'Неправильный логин или пароль' }, 401);
        }

        let isRoot = false;
        let valid = false;

        if (username === 'kanamiisa') {
            const secret = await getTOTPSecret(env);
            if (secret) {
                valid = await verify(secret, password);
            }
            isRoot = true;
        } else {
            const user = await getUser(env, username);
            if (user) {
                valid = await verifyPassword(password, user.password_hash);
            }
        }

        if (!valid) {
            return jsonResponse({ error: 'Неправильный логин или пароль' }, 401);
        }

        const sessionId = await createSession(env, username, isRoot);

        // Also create/update stenographist session with role
        let stenoSessionId = getSessionId(request);
        if (!stenoSessionId) {
            stenoSessionId = crypto.randomUUID();
        }

        const stenoSession = await env.AUTH_KV.get(`session:${stenoSessionId}`, 'json');
        if (stenoSession) {
            stenoSession.username = username;
            stenoSession.role = isRoot ? 'root' : 'guest';
            await env.AUTH_KV.put(
                `session:${stenoSessionId}`,
                JSON.stringify(stenoSession),
                { expirationTtl: 3600 }
            );
        } else {
            const now = new Date().toISOString();
            await env.AUTH_KV.put(
                `session:${stenoSessionId}`,
                JSON.stringify({
                    id: stenoSessionId,
                    created: now,
                    lastSeen: now,
                    ip: request.headers.get('CF-Connecting-IP') || 'unknown',
                    country: request.headers.get('CF-IPCountry') || 'unknown',
                    userAgent: request.headers.get('User-Agent') || 'unknown',
                    username,
                    role: isRoot ? 'root' : 'guest',
                    failedAttempts: 0,
                    events: []
                }),
                { expirationTtl: 3600 }
            );
        }

        const listKey = `session_list:${username}`;
        const list = await env.AUTH_KV.get(listKey, 'json') || [];
        if (!list.includes(stenoSessionId)) {
            list.push(stenoSessionId);
            await env.AUTH_KV.put(listKey, JSON.stringify(list), { expirationTtl: 3600 });
        }

        const ip = request.headers.get('cf-connecting-ip') || 'unknown';
        const ua = request.headers.get('user-agent') || 'unknown';
        const serverInfo = await extractDeviceInfo(request);
        const deviceInfo = { ...serverInfo, ...(clientInfo || {}) };
        await saveLog(env, username, ip, ua, deviceInfo, Date.now());

        const cookies = [
            `session=${sessionId}; Path=/; HttpOnly; SameSite=Strict`,
            `session_id=${stenoSessionId}; Path=/stenographist; SameSite=Strict; Max-Age=3600`
        ];

        return new Response(JSON.stringify({ success: true, is_root: isRoot }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': cookies.join(', ')
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

// ============================================================
// User Management
// ============================================================

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

// ============================================================
// Logs
// ============================================================

async function handleListLogs(env) {
    const logs = [];

    // 1. Read old login logs from auth.js (log:* prefix)
    const oldKeys = await env.AUTH_KV.list({ prefix: 'log:', limit: 100 });
    for (const key of oldKeys.keys) {
        const data = await env.AUTH_KV.get(key.name, 'json');
        if (!data) continue;
        logs.push({
            session_id: null,
            username: data.username,
            ip: data.ip,
            user_agent: data.user_agent,
            session_start: data.session_start,
            last_seen: null,
            active: false,
            failedAttempts: 0,
            device: data.device || {},
            network: null, battery: null, gpu: null, memory: null,
            navigator: null, screen: null, window: null, timezone: null
        });
    }

    // 2. Read stenographist sessions (session:* prefix)
    const sessionKeys = await env.AUTH_KV.list({ prefix: 'session:' });
    for (const key of sessionKeys.keys) {
        const s = await env.AUTH_KV.get(key.name, 'json');
        if (!s) continue;

        const fp = s.fingerprint || {};
        const isActive = (Date.now() - new Date(s.lastSeen).getTime()) < 120000;

        logs.push({
            session_id: s.id,
            username: s.username,
            ip: s.ip,
            user_agent: s.userAgent,
            session_start: s.created,
            last_seen: s.lastSeen,
            active: isActive,
            failedAttempts: s.failedAttempts || 0,
            device: {
                country: s.country,
                platform: fp.navigator?.platform || fp.navigator?.userAgentData?.platform || '-',
                browser: parseBrowser(s.userAgent),
                raw: s.userAgent
            },
            network: fp.network || fp.navigator?.connection || null,
            battery: fp.battery || null,
            gpu: fp.webgl || null,
            memory: fp.memory || fp.cpu || null,
            navigator: fp.navigator || null,
            screen: fp.screen || null,
            window: fp.window || null,
            timezone: fp.datetime || fp.intl || null
        });
    }

    logs.sort((a, b) => new Date(b.session_start || 0) - new Date(a.session_start || 0));
    return jsonResponse({ logs });
}

function parseBrowser(ua) {
    if (!ua) return '-';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Edg')) return 'Edge';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Safari')) return 'Safari';
    return ua.split(' ').pop() || '-';
}

// ============================================================
// Device Info Extraction
// ============================================================

async function extractDeviceInfo(request) {
    const ua = request.headers.get('user-agent') || '';
    const country = request.headers.get('cf-ipcountry') || '??';

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

// ============================================================
// Static File Serving
// ============================================================

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

// ============================================================
// Audio Processing
// ============================================================

async function handleProcess(request, env) {
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

// ============================================================
// Helpers
// ============================================================

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
