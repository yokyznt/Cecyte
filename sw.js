// Service Worker minimo. Su unico trabajo es existir para que el navegador
// (sobre todo Chrome en Android) nos deje mostrar notificaciones reales del
// sistema con reg.showNotification(). No maneja push ni cache todavia.

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Aqui llega el aviso real aunque la pagina este cerrada — lo manda nuestro
// servidor (api/cron/check-schedule.js) via Web Push.
self.addEventListener('push', (event) => {
    let data = { title: 'CECyTE Plantel 18', body: 'Hay un cambio de clase.' };
    try {
        if (event.data) data = event.data.json();
    } catch (err) {
        // si no viene en JSON, nos quedamos con el mensaje default de arriba
    }

    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            tag: 'cecyte-alerta',
            renotify: true
        })
    );
});

// Si el usuario toca la notificacion, la cerramos y enfocamos la pagina.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then((clientsArr) => {
            if (clientsArr.length > 0) {
                return clientsArr[0].focus();
            }
            return self.clients.openWindow('/');
        })
    );
});
