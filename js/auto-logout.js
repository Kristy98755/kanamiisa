/**
 * Auto-logout for Mail & Panel (main `session` cookie system).
 * Mirrors stenographist/js/session.js: pauses the session when the tab is
 * hidden, shows an overlay, and logs the user out after INACTIVE_TIMEOUT.
 * Logout clears the main `session` cookie via /login/api/logout.
 */
(function () {
  'use strict';

  var HEARTBEAT_INTERVAL = 30000; // 30 seconds
  var INACTIVE_TIMEOUT = 110000;  // 110 seconds

  var heartbeatTimer = null;
  var inactiveSince = null;

  function showOverlay() {
    if (document.getElementById('auto-logout-overlay')) return;
    var ov = document.createElement('div');
    ov.id = 'auto-logout-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#171a21;border:1px solid #262b36;border-radius:12px;padding:24px;text-align:center;max-width:320px;';
    var p = document.createElement('p');
    p.textContent = 'Сессия приостановлена';
    p.style.cssText = 'margin:0 0 14px;color:#e6e6e6;font:14px system-ui,sans-serif;';
    var btn = document.createElement('button');
    btn.textContent = 'Продолжить';
    btn.style.cssText = 'background:#2563eb;color:#fff;border:0;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:14px;';
    btn.addEventListener('click', onResume);
    box.appendChild(p);
    box.appendChild(btn);
    ov.appendChild(box);
    document.body.appendChild(ov);
  }

  function hideOverlay() {
    var ov = document.getElementById('auto-logout-overlay');
    if (ov) ov.remove();
  }

  function onHidden() {
    inactiveSince = Date.now();
    showOverlay();
    stopHeartbeat();
  }

  function onVisible() {
    if (inactiveSince && Date.now() - inactiveSince > INACTIVE_TIMEOUT) {
      logout();
      return;
    }
    // Keep overlay; user must click "Продолжить".
  }

  function onResume() {
    if (inactiveSince && Date.now() - inactiveSince > INACTIVE_TIMEOUT) {
      logout();
      return;
    }
    inactiveSince = null;
    hideOverlay();
    startHeartbeat();
  }

  function targetFrom() {
    var p = location.pathname;
    if (p.indexOf('/mail') === 0) return 'mail';
    if (p.indexOf('/stenographist/panel') === 0) return 'panel';
    if (p.indexOf('/stenographist') === 0) return 'stenographist';
    return 'stenographist';
  }

  async function logout() {
    try {
      await fetch('/login/api/logout', { method: 'POST', keepalive: true });
    } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    window.location.href = '/login?from=' + encodeURIComponent(targetFrom());
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(async function () {
      try {
        var res = await fetch('/login/api/session');
        var data = await res.json();
        if (!data.valid) logout();
      } catch (e) {}
    }, HEARTBEAT_INTERVAL);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function init() {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) onHidden();
      else onVisible();
    });
    startHeartbeat();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
