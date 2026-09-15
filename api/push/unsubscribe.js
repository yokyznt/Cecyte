// POST /api/push/unsubscribe { group, endpoint }
// Quita una suscripcion push de la lista de su grupo (por ejemplo si el
// usuario desactiva las notificaciones, o su suscripcion ya no sirve).

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    const { group, endpoint } = req.body || {};
    if (!group || !endpoint) {
        return res.status(400).json({ error: 'Faltan datos.' });
    }

    try {
        const key = `push_subs:${group}`;
        const subs = (await kv.get(key)) || [];
        await kv.set(key, subs.filter(s => s.endpoint !== endpoint));
        return res.status(200).json({ ok: true });
    } catch (err) {
        return res.status(500).json({ error: 'No se pudo actualizar.' });
    }
}
