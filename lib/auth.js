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

// El token dice de quién es: «master» (la contraseña de ADMIN_PASSWORD) o el id de un admin (lib/admins.js)
export function signToken(sujeto = 'master') {
    const timestamp = Date.now().toString();
    const hmac = crypto.createHmac('sha256', getSecret()).update(`${timestamp}.${sujeto}`).digest('hex');
    return `${timestamp}.${sujeto}.${hmac}`;
}

// {ts, id} si la firma y la vigencia son válidas; los tokens viejos de 2 partes (antes de los admins) eran del maestro
export function leerToken(token) {
    if (!token || !SECRET || typeof token !== 'string') return null;
    const partes = token.split('.');
    if (partes.length !== 2 && partes.length !== 3) return null;
    const [timestamp, id, hmac] = partes.length === 2 ? [partes[0], 'master', partes[1]] : partes;
    if (!timestamp || !hmac || !/^[a-z0-9]{1,16}$/.test(id)) return null;

    const base = partes.length === 2 ? timestamp : `${timestamp}.${id}`;
    const expected = crypto.createHmac('sha256', SECRET).update(base).digest('hex');

    // Comparación segura contra timing attacks
    const a = Buffer.from(hmac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const age = Date.now() - Number(timestamp);
    return age >= 0 && age <= TOKEN_LIFETIME_MS ? { ts: Number(timestamp), id } : null;
}

export function verifyToken(token) {
    return !!leerToken(token);
}

// Token de un teléfono dentro de una sala: HMAC de «sala:id». Solo autoriza a ese id; no expira (los datos vencen solos en KV).
export function firmarDispositivo(sala, id) {
    return crypto.createHmac('sha256', getSecret()).update(`tel:${sala}:${id}`).digest('hex').slice(0, 32);
}

export function verificarDispositivo(sala, id, token) {
    if (!SECRET || typeof token !== 'string' || typeof id !== 'string') return false;
    const esperado = crypto.createHmac('sha256', SECRET).update(`tel:${sala}:${id}`).digest('hex').slice(0, 32);
    const a = Buffer.from(token), b = Buffer.from(esperado);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
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

// Token de la sesión de admin: cabecera "Authorization: Bearer <token>" (APK) o cookie admin_token (web)
export function adminToken(req) {
    const h = req.headers && req.headers.authorization;
    if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7).trim();
    return parseCookies(req).admin_token;
}
