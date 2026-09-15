// POST /api/push/subscribe { group, previousGroup?, subscription }
// Guarda la suscripcion push de este dispositivo bajo su grupo, para poder
// mandarle avisos aunque tenga la pagina cerrada. Si venia de otro grupo
// (cambio de grupo en el selector), lo quita de la lista del grupo viejo.

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    const { group, previousGroup, subscription } = req.body || {};

    if (!group || !subscription || !subscription.endpoint) {
        return res.status(400).json({ error: 'Faltan datos de la suscripción.' });
    }

    try {
        if (previousGroup && previousGroup !== group) {
            const oldKey = `push_subs:${previousGroup}`;
            const oldSubs = (await kv.get(oldKey)) || [];
            await kv.set(oldKey, oldSubs.filter(s => s.endpoint !== subscription.endpoint));
        }

        const key = `push_subs:${group}`;
        const subs = (await kv.get(key)) || [];
        const filtered = subs.filter(s => s.endpoint !== subscription.endpoint);
        filtered.push(subscription);
        await kv.set(key, filtered);

        return res.status(200).json({ ok: true });
    } catch (err) {
        return res.status(500).json({ error: 'No se pudo guardar la suscripción.' });
    }
}
