/**
 * Stenographist — Session Management
 * Handles session lifecycle, heartbeat, tab background detection, events
 */

const Session = (() => {
    'use strict';

    const COOKIE_TTL = 3600; // 1 hour
    const HEARTBEAT_INTERVAL = 30000; // 30 seconds
    const INACTIVE_TIMEOUT = 110000; // 110 seconds

    let heartbeatTimer = null;
    let fingerprintSent = false;

    // --- Cookie helpers ---
    function setCookie(name, value, ttl) {
        const expires = new Date(Date.now() + ttl * 1000).toUTCString();
        document.cookie = `${name}=${value}; expires=${expires}; path=/stenographist; SameSite=Strict`;
    }

    function getCookie(name) {
        const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : null;
    }

    function deleteCookie(name) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/stenographist`;
    }

    // --- Session ID ---
    function getSessionId() {
        let id = getCookie('session_id');
        if (!id) {
            id = crypto.randomUUID();
            setCookie('session_id', id, COOKIE_TTL);
        }
        return id;
    }

    function hasSession() {
        return !!getCookie('session_id');
    }

    // --- Event sending ---
    async function sendEvent(type, data = {}) {
        const sessionId = getSessionId();
        const body = {
            session_id: sessionId,
            type,
            path: window.location.pathname,
            timestamp: Date.now(),
            ...data
        };

        try {
            const response = await fetch('/stenographist/api/event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                keepalive: true
            });

            const result = await response.json();

            // Send fingerprint on first page_view
            if (!fingerprintSent && type === 'page_view' && window.__fingerprint) {
                await sendFingerprint(window.__fingerprint);
                fingerprintSent = true;
            }

            return result;
        } catch (e) {
            console.warn('[Session] Event send failed:', e.message);
            return null;
        }
    }

    async function sendFingerprint(fingerprint) {
        const sessionId = getSessionId();
        try {
            await fetch('/stenographist/api/fingerprint', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    fingerprint
                }),
                keepalive: true
            });
        } catch (e) {
            console.warn('[Session] Fingerprint send failed:', e.message);
        }
    }

    // --- Heartbeat ---
    function startHeartbeat() {
        stopHeartbeat();
        heartbeatTimer = setInterval(async () => {
            const result = await sendEvent('heartbeat');
            if (result && result.kick) {
                console.warn('[Session] Kicked by admin');
                stopHeartbeat();
                logout();
            }
        }, HEARTBEAT_INTERVAL);
    }

    function stopHeartbeat() {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    }

    // --- Tab background detection ---
    function setupVisibilityHandler() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                onTabHidden();
            } else {
                onTabVisible();
            }
        });

        // Also handle beforeunload
        window.addEventListener('beforeunload', () => {
            sendEvent('tab_close');
        });
    }

    function onTabHidden() {
        // Save inactive timestamp
        setCookie('inactive_since', Date.now().toString(), COOKIE_TTL);

        // Stop heartbeat
        stopHeartbeat();

        // Show overlay
        showOverlay();
    }

    function onTabVisible() {
        // Don't auto-hide overlay - user must click "Продолжить"
        // Only check timeout
        const inactiveSince = getCookie('inactive_since');
        if (inactiveSince) {
            const elapsed = Date.now() - parseInt(inactiveSince);
            if (elapsed > INACTIVE_TIMEOUT) {
                logout();
                return;
            }
        }
    }

    function onResume() {
        const inactiveSince = getCookie('inactive_since');
        if (inactiveSince) {
            const elapsed = Date.now() - parseInt(inactiveSince);
            if (elapsed > INACTIVE_TIMEOUT) {
                logout();
                return;
            }
        }

        deleteCookie('inactive_since');
        hideOverlay();
        startHeartbeat();
        sendEvent('focus');
    }

    // --- Overlay ---
    function createOverlay() {
        if (document.getElementById('session-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'session-overlay';
        overlay.className = 'session-overlay';
        overlay.innerHTML = `
            <div class="session-overlay__content">
                <p class="session-overlay__text">Сессия приостановлена</p>
                <button class="session-overlay__btn" id="sessionResumeBtn">Продолжить</button>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('sessionResumeBtn').addEventListener('click', () => {
            onResume();
        });
    }

    function showOverlay() {
        createOverlay();
        document.getElementById('session-overlay').classList.add('session-overlay--visible');
    }

    function hideOverlay() {
        const overlay = document.getElementById('session-overlay');
        if (overlay) {
            overlay.classList.remove('session-overlay--visible');
        }
    }

    // --- Incognito detection ---
    function detectIncognito() {
        return new Promise((resolve) => {
            let detected = false;
            let resolved = false;

            function done(result) {
                if (resolved) return;
                if (result) detected = true;
                resolved = true;
                resolve(detected);
            }

            // Timeout after 500ms
            setTimeout(() => done(false), 500);

            // Method 1: FileSystem API (Chrome)
            try {
                const requestFileSystem = window.requestFileSystem || window.webkitRequestFileSystem;
                if (requestFileSystem) {
                    requestFileSystem(window.TEMPORARY, 1, () => {}, () => done(true));
                }
            } catch (e) {}

            // Method 2: Storage estimate (Chrome/Edge)
            try {
                if (navigator.storage && navigator.storage.estimate) {
                    navigator.storage.estimate().then(est => {
                        if (est.quota === 0) done(true);
                    }).catch(() => {});
                }
            } catch (e) {}

            // Method 3: localStorage
            try {
                const testKey = '__incognito_test__';
                localStorage.setItem(testKey, '1');
                localStorage.removeItem(testKey);
            } catch (e) {
                done(true);
            }

            // Method 4: Firefox IndexedDB
            try {
                if (typeof indexedDB !== 'undefined') {
                    const dbReq = indexedDB.open('__incognito_test__');
                    dbReq.onerror = () => done(true);
                    dbReq.onsuccess = () => {
                        indexedDB.deleteDatabase('__incognito_test__');
                    };
                }
            } catch (e) {}
        });
    }

    function showIncognitoBanner() {
        if (document.getElementById('incognito-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'incognito-banner';
        banner.className = 'incognito-banner';
        banner.innerHTML = `
            <div class="incognito-banner__content">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
                <span>В анонимном режиме истории болезни не сохраняются. Пожалуйста, откройте страницу в обычном режиме.</span>
            </div>
        `;
        document.body.appendChild(banner);
    }

    // --- Auth ---
    async function login(username, password) {
        const result = await sendEvent('login_attempt', {
            success: false,
            username
        });

        try {
            const response = await fetch('/stenographist/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (data.ok) {
                await sendEvent('login_attempt', { success: true, username });
                return { ok: true, username: data.username };
            } else {
                return { ok: false, error: data.error };
            }
        } catch (e) {
            return { ok: false, error: 'Ошибка сети' };
        }
    }

    async function logout() {
        await sendEvent('logout');
        deleteCookie('session_id');
        deleteCookie('inactive_since');
        window.location.href = '/login';
    }

    async function checkSession() {
        try {
            const response = await fetch('/stenographist/api/session');
            const data = await response.json();
            return data;
        } catch (e) {
            return { valid: false };
        }
    }

    // --- Init ---
    async function init() {
        // Create overlay (hidden by default)
        createOverlay();

        // Setup visibility handler
        setupVisibilityHandler();

        // Detect incognito
        try {
            const isIncognito = await detectIncognito();
            if (isIncognito) {
                showIncognitoBanner();
                window.__incognito = true;
            }
        } catch (e) {
            console.warn('[Session] Incognito detection failed:', e.message);
        }

        // Send initial page_view
        try {
            await sendEvent('page_view');
        } catch (e) {
            console.warn('[Session] page_view failed:', e.message);
        }

        // Start heartbeat (always)
        startHeartbeat();
    }

    // --- Public API ---
    return {
        init,
        sendEvent,
        login,
        logout,
        checkSession,
        getSessionId,
        hasSession,
        detectIncognito,
        showOverlay,
        hideOverlay
    };
})();
