// Configura la libreria web-push con las llaves VAPID (variables de entorno en Vercel).
// Se usa desde cualquier api/ que necesite mandar una notificacion push real.

import webpush from 'web-push';

let configured = false;

export function getWebPush() {
    if (!configured) {
        if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
            throw new Error('Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en las variables de entorno.');
        }
        webpush.setVapidDetails(
            process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
            process.env.VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY
        );
        configured = true;
    }
    return webpush;
}
