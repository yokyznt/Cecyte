// POST /api/login  { password }
// Si la contraseña coincide con ADMIN_PASSWORD (variable de entorno en Vercel),
// manda una cookie httpOnly firmada que dura 12 horas.

import { kv } from '@vercel/kv';
import { signToken } from '../lib/auth.js';
import { esClaveMaestra, leerAdmins, claveCoincide } from '../lib/admins.js';
import { ipDe, bloqueado, anotarFallo, olvidar } from '../lib/limite.js';
import { cors, origenPermitido } from '../lib/cors.js';

const MAX_FALLOS = 5;            // intentos fallidos por IP...
const VENTANA_S = 10 * 60;        // ...en 10 minutos

export default async function handler(req, res) {
    if (cors(req, res)) return;
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    if (!process.env.ADMIN_PASSWORD) {
        return res.status(500).json({ error: 'El servidor no tiene configurada ADMIN_PASSWORD en Vercel.' });
    }

    const clave = `login_fallos:${ipDe(req)}`;
    if (await bloqueado(kv, clave, MAX_FALLOS)) {
        res.setHeader('Retry-After', String(VENTANA_S));
        return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos y vuelve a intentar.' });
    }

    const { password } = req.body || {};

    // La contraseña maestra (ADMIN_PASSWORD) o la de alguno de los admins guardados
    let sujeto = null;
    if (typeof password === 'string' && password.length > 0 && password.length <= 200) {
        if (esClaveMaestra(password)) {
            sujeto = 'master';
        } else {
            let admins = [];
            try { admins = await leerAdmins(kv); } catch (e) { admins = []; }
            const a = admins.find(x => claveCoincide(password, x));
            if (a) sujeto = a.id;
        }
    }
    if (!sujeto) {
        await anotarFallo(kv, clave, VENTANA_S);
        return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    await olvidar(kv, clave);

    let token;
    try {
        token = signToken(sujeto);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }

    const isProd = process.env.NODE_ENV === 'production';
    res.setHeader(
        'Set-Cookie',
        `admin_token=${token}; HttpOnly; Path=/; Max-Age=43200; SameSite=Lax${isProd ? '; Secure' : ''}`
    );

    // La app de Android no usa cookies: recibe el mismo token en el cuerpo. La web no lo ve (sigue en cookie HttpOnly).
    const desdeApp = origenPermitido(req.headers.origin);
    return res.status(200).json(desdeApp ? { ok: true, token } : { ok: true });
}
