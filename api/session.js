// GET /api/session — le dice al front si este dispositivo ya tiene sesion de admin activa.

import { verifyToken, parseCookies } from '../lib/auth.js';

export default function handler(req, res) {
    const cookies = parseCookies(req);
    const loggedIn = verifyToken(cookies.admin_token);
    return res.status(200).json({ loggedIn });
}
