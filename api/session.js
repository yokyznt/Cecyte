// GET /api/session — le dice al front si este dispositivo ya tiene sesion de admin activa y qué puede hacer.
// Acepta la cookie (web) o el token Bearer (APK).
// Responde { loggedIn, rol: 'master' | 'admin', nombre, permisos[] }; el maestro además tiene el permiso 'admins'.

import { kv } from '@vercel/kv';
import { sesionDe } from '../lib/admins.js';
import { cors } from '../lib/cors.js';

export default async function handler(req, res) {
    if (cors(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    const s = await sesionDe(req, kv);
    if (!s) return res.status(200).json({ loggedIn: false });
    return res.status(200).json({ loggedIn: true, rol: s.rol, nombre: s.nombre, permisos: s.permisos });
}
