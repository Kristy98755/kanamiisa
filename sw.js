/* Kanami-isa mail service — push service worker */
self.addEventListener('push', function (event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { return; }
  const title = data.title || 'Kanami-isa mail service';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: data.icon || '/k-logo.png',
    badge: data.badge || '/k-logo.png',
    tag: data.tag || 'newmail',
    data: { url: data.url || '/mail' },
  }));
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
