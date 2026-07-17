/* Kanami-isa mail service — push service worker */
self.addEventListener('push', function (event) {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch (e) { return; }
  const n = payload.notification;
  if (n && n.title) {
    // Same tag as the auto-displayed notification -> dedupes to a single card.
    event.waitUntil(self.registration.showNotification(n.title, {
      body: n.body || '',
      icon: n.icon || '/k-logo.png',
      badge: n.badge || '/k-logo.png',
      tag: n.tag || 'newmail',
      data: n.data || { url: '/mail' },
    }));
  }
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/mail';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (const c of list) {
        if ('focus' in c) { c.focus(); return; }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
