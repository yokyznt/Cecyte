// Service Worker minimo. Su unico trabajo es existir para que el navegador
// (sobre todo Chrome en Android) nos deje mostrar notificaciones reales del
// sistema con reg.showNotification(). No maneja push ni cache todavia.

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
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
