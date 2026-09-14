// Helper de autenticación para el panel de admin.
// No usamos una base de datos de sesiones: el "token" de la cookie es
// simplemente una marca de tiempo firmada con una llave secreta (AUTH_SECRET).
// Si alguien la modifica, la firma ya no coincide y se rechaza.

import crypto from 'crypto';

const SECRET = process.env.AUTH_SECRET;
const TOKEN_LIFETIME_MS = 12 * 60 * 60 * 1000; // 12 horas

function getSecret() {
    if (!SECRET) {
        throw new Error('Falta configurar la variable de entorno AUTH_SECRET en Vercel.');
    }
    return SECRET;
}

export function signToken() {
    const timestamp = Date.now().toString();
    const hmac = crypto.createHmac('sha256', getSecret()).update(timestamp).digest('hex');
    return `${timestamp}.${hmac}`;
}

export function verifyToken(token) {
    if (!token || !SECRET) return false;

    const [timestamp, hmac] = token.split('.');
    if (!timestamp || !hmac) return false;

    const expected = crypto.createHmac('sha256', SECRET).update(timestamp).digest('hex');

    // Comparación segura contra timing attacks
    const a = Buffer.from(hmac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

    const age = Date.now() - Number(timestamp);
    return age >= 0 && age <= TOKEN_LIFETIME_MS;
}

export function parseCookies(req) {
    const header = req.headers.cookie || '';
    const cookies = {};
    header.split(';').forEach(pair => {
        const idx = pair.indexOf('=');
        if (idx === -1) return;
        const key = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (key) cookies[key] = decodeURIComponent(value);
    });
    return cookies;
}
