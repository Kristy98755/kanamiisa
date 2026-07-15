/**
 * Authentication module
 * Handles sessions, password hashing, user management
 */

const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours (but cookie expires on browser close)
const CHEAT_CODE = '787898';

/**
 * Hash password using PBKDF2
 */
export async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );

    const bits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        256
    );

    const hash = new Uint8Array(bits);
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    const hashHex = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');

    return `${saltHex}:${hashHex}`;
}

/**
 * Verify password against stored hash
 */
export async function verifyPassword(password, stored) {
    const [saltHex, hashHex] = stored.split(':');
    const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));

    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );

    const bits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        256
    );

    const hash = new Uint8Array(bits);
    const hashHex2 = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');

    return hashHex === hashHex2;
}

/**
 * Generate session ID
 */
export function generateSessionId() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a new session
 */
export async function createSession(env, username, isRoot) {
    const sessionId = generateSessionId();
    const session = {
        username,
        is_root: isRoot,
        created_at: Date.now()
    };

    await env.AUTH_KV.put(`session:${sessionId}`, JSON.stringify(session), {
        expirationTtl: 86400 // 24 hours
    });

    return sessionId;
}

/**
 * Validate session from cookie
 */
export async function validateSession(request, env) {
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/session=([a-f0-9]+)/);

    if (!match) return null;

    const sessionId = match[1];
    const session = await env.AUTH_KV.get(`session:${sessionId}`, 'json');

    if (!session) return null;

    return session;
}

/**
 * Delete session (logout)
 */
export async function deleteSession(env, sessionId) {
    await env.AUTH_KV.delete(`session:${sessionId}`);
}

/**
 * Verify cheat code for setup endpoint
 */
export function verifyCheatCode(code) {
    return code === CHEAT_CODE;
}

/**
 * Get user from KV
 */
export async function getUser(env, username) {
    const data = await env.AUTH_KV.get(`user:${username}`, 'json');
    return data;
}

/**
 * Save user to KV
 */
export async function saveUser(env, username, passwordHash) {
    const user = {
        password_hash: passwordHash,
        created_at: Date.now()
    };
    await env.AUTH_KV.put(`user:${username}`, JSON.stringify(user));
}

/**
 * Delete user from KV
 */
export async function deleteUser(env, username) {
    await env.AUTH_KV.delete(`user:${username}`);
}

/**
 * List all users
 */
export async function listUsers(env) {
    const keys = await env.AUTH_KV.list({ prefix: 'user:' });
    const users = [];

    for (const key of keys.keys) {
        const username = key.name.replace('user:', '');
        const data = await env.AUTH_KV.get(key.name, 'json');
        users.push({
            username,
            created_at: data.created_at
        });
    }

    return users;
}

/**
 * Save login log
 */
const LEX = {
    'Windows': 'Wi', 'macOS': 'Ma', 'Linux': 'Li', 'Android': 'An', 'iOS': 'iO',
    'Chrome': 'Ch', 'Firefox': 'Fx', 'Edge': 'Ed', 'Safari': 'Sa',
    'Google Inc.': 'gI', 'Google Inc': 'gI', 'Apple Inc.': 'aI', 'Apple Inc': 'aI',
    'slow-2g': 's2', 'wifi': 'wf', 'cellular': 'cl', 'ethernet': 'et', 'bluetooth': 'bt',
    'landscape-primary': 'lp', 'landscape-secondary': 'ls', 'portrait-primary': 'pp', 'portrait-secondary': 'ps'
};
const UA_LEX = [
    ['Mozilla/5.0', 'M5'],
    ['AppleWebKit/537.36', 'AW'],
    ['KHTML, like Gecko', 'lkGk'],
    ['Gecko/20100101', 'Gk'],
    ['Chrome/', 'Ch/'],
    ['Safari/', 'Sa/'],
    ['Edg/', 'Ed/'],
    ['Firefox/', 'Fx/'],
    ['Version/', 'Vr/'],
    ['Win64; x64', 'W64'],
    ['Windows NT 10.0', 'W10'],
    ['Macintosh; Intel Mac OS X', 'MOS'],
    ['X11; Linux x86_64', 'LX']
];

function lexCompressStr(v) {
    if (typeof v !== 'string') return v;
    if (LEX[v] !== undefined) return LEX[v];
    if (/Mozilla|Gecko|AppleWebKit|Chrome|Firefox|Edge|Safari/.test(v)) {
        let s = v;
        for (const [orig, tok] of UA_LEX) s = s.split(orig).join(tok);
        return s;
    }
    return v;
}
function lexCompressObj(o) {
    if (Array.isArray(o)) return o.map(lexCompressObj);
    if (o && typeof o === 'object') {
        const r = {};
        for (const k in o) r[k] = lexCompressObj(o[k]);
        return r;
    }
    return lexCompressStr(o);
}

export async function saveLog(env, username, ip, userAgent, deviceInfo, sessionStart, from, sessionId) {
    const entry = {
        username,
        ip,
        user_agent: userAgent,
        device: lexCompressObj(deviceInfo || {}),
        session_start: sessionStart,
        from: from || 'none',
        session_id: sessionId || null
    };

    let arr = await env.AUTH_KV.get('logindex', 'json') || [];
    arr.unshift(entry);
    if (arr.length > 2000) arr.length = 2000;
    await env.AUTH_KV.put('logindex', JSON.stringify(arr));
}

/**
 * List login logs
 */
export async function listLogs(env, limit = 100) {
    const keys = await env.AUTH_KV.list({ prefix: 'log:', limit });
    const logs = [];

    for (const key of keys.keys) {
        const data = await env.AUTH_KV.get(key.name, 'json');
        logs.push(data);
    }

    return logs.sort((a, b) => b.session_start - a.session_start);
}

/**
 * Save TOTP secret
 */
export async function saveTOTPSecret(env, secret) {
    await env.AUTH_KV.put('totp:secret', secret);
}

/**
 * Get TOTP secret
 */
export async function getTOTPSecret(env) {
    return await env.AUTH_KV.get('totp:secret');
}

/**
 * Validate cheat code from request
 */
export async function validateSetupAuth(request) {
    const body = await request.json();
    return verifyCheatCode(body.code);
}
