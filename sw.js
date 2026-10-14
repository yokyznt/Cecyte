// Service Worker.
// 1) Avisos del sistema (push) aunque la página esté cerrada.
// 2) Funciona sin Internet: lo que se pidió bien se guarda y, si la red falla, se usa la última copia.
//    "Red primero": con conexión siempre se ve lo más nuevo; la copia solo sirve de respaldo.

const CACHE = 'cecyte-v1';
const BASICOS = ['/', '/index.html', '/styles.css', '/app.js', '/calendario.js', '/admin-secciones.js', '/logo-cecyte.png', '/manifest.webmanifest'];
// De la API solo se guarda lo público que necesita el alumno para ver su horario
const API_GUARDABLE = ['/api/schedule', '/api/groups'];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => Promise.all(BASICOS.map(url => cache.add(url).catch(() => null))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(nombres => Promise.all(nombres.filter(n => n !== CACHE).map(n => caches.delete(n))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || req.headers.has('range')) return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;                         // fuentes y demás: que las maneje el navegador
    if (url.pathname.startsWith('/api/') && !API_GUARDABLE.includes(url.pathname)) return;   // sesión, timbre, push...
    event.respondWith(redPrimero(req));
});

async function redPrimero(req) {
    const cache = await caches.open(CACHE);
    try {
        const resp = await fetch(req);
        if (resp && resp.ok) cache.put(req, resp.clone());
        return resp;
    } catch (err) {
        const copia = await cache.match(req) || (req.mode === 'navigate' ? await cache.match('/') : null);
        if (copia) return copia;
        throw err;
    }
}

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
