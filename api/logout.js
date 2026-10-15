// POST /api/logout — borra la cookie de sesion de este dispositivo.

import { cors } from '../lib/cors.js';

export default function handler(req, res) {
    if (cors(req, res)) return;
    const isProd = process.env.NODE_ENV === 'production';
    res.setHeader(
        'Set-Cookie',
        `admin_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${isProd ? '; Secure' : ''}`
    );
    return res.status(200).json({ ok: true });
}
