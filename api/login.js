// POST /api/login  { password }
// Si la contraseña coincide con ADMIN_PASSWORD (variable de entorno en Vercel),
// manda una cookie httpOnly firmada que dura 12 horas.

import { signToken } from '../lib/auth.js';

export default function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    if (!process.env.ADMIN_PASSWORD) {
        return res.status(500).json({ error: 'El servidor no tiene configurada ADMIN_PASSWORD en Vercel.' });
    }

    const { password } = req.body || {};

    if (password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    let token;
    try {
        token = signToken();
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }

    const isProd = process.env.NODE_ENV === 'production';
    res.setHeader(
        'Set-Cookie',
        `admin_token=${token}; HttpOnly; Path=/; Max-Age=43200; SameSite=Lax${isProd ? '; Secure' : ''}`
    );

    return res.status(200).json({ ok: true });
}
