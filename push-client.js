/* Kanami-isa mail service — push subscription client (used on /mail) */
(function () {
  function urlB64ToUint8Array(b64u) {
    const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: 'same-origin' }, opts)).then((r) => r.json());
  }

  function showControls(state) {
    const box = document.getElementById('pushControls');
    if (!box) return;
    box.innerHTML = '';

    if (state === 'unsupported') {
      box.textContent = 'Пуш не поддерживается';
      return;
    }

    if (state === 'granted') {
      const t = document.createElement('button');
      t.className = 'btn ghost';
      t.textContent = '🔔 Тест пуша';
      t.onclick = async () => {
        try {
          await api('/push/test', { method: 'POST' });
          t.textContent = 'Отправлено!';
          setTimeout(() => (t.textContent = '🔔 Тест пуша'), 2000);
        } catch (e) { t.textContent = 'Ошибка'; }
      };
      box.appendChild(t);
      return;
    }

    const b = document.createElement('button');
    b.className = 'btn ghost';
    b.textContent = '🔔 Уведомления';
    b.onclick = subscribe;
    box.appendChild(b);
  }

  async function ensureSw() {
    if (!('serviceWorker' in navigator)) return null;
    return navigator.serviceWorker.register('/sw.js').catch((e) => {
      console.warn('sw registration failed', e);
      return null;
    });
  }

  async function subscribe() {
    try {
      const reg = await ensureSw();
      if (!reg) { alert('Service Worker не поддерживается этим браузером'); return; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { alert('Разрешение на уведомления не получено'); return; }
      const { publicKey } = await api('/push/vapid');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(publicKey),
      });
      await api('/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub),
      });
      showControls('granted');
    } catch (e) {
      console.error(e);
      alert('Не удалось включить уведомления: ' + e.message);
    }
  }

  window.addEventListener('load', async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      showControls('unsupported');
      return;
    }
    const perm = Notification.permission;
    if (perm === 'granted') {
      const reg = await ensureSw();
      const sub = reg && (await reg.pushManager.getSubscription());
      if (!sub) await subscribe();
    }
    showControls(perm);
  });
})();
