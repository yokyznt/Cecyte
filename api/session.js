// GET /api/session — le dice al front si este dispositivo ya tiene sesion de admin activa.
// Acepta la cookie (web) o el token Bearer (APK).

import { verifyToken, adminToken } from '../lib/auth.js';
import { cors } from '../lib/cors.js';

export default function handler(req, res) {
    if (cors(req, res)) return;
    const loggedIn = verifyToken(adminToken(req));
    return res.status(200).json({ loggedIn });
}
