// POST /api/push/subscribe { group, previousGroup?, subscription }
// Guarda la suscripcion push de este dispositivo bajo su grupo, para poder
// mandarle avisos aunque tenga la pagina cerrada. Si venia de otro grupo
// (cambio de grupo en el selector), lo quita de la lista del grupo viejo.

import { kv } from '@vercel/kv';
import { limpiarGrupo, suscripcionValida, GRUPOS_POR_DEFECTO, MAX_SUSCRIPCIONES } from '../../lib/validar.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    const { group, previousGroup, subscription } = req.body || {};

    if (!limpiarGrupo(group) || !suscripcionValida(subscription)) {
        return res.status(400).json({ error: 'Faltan datos de la suscripción.' });
    }
    if (previousGroup !== undefined && previousGroup !== null && !limpiarGrupo(previousGroup)) {
        return res.status(400).json({ error: 'Grupo anterior inválido.' });
    }

    try {
        // solo grupos que existen: antes cualquiera podía crear llaves push_subs:<lo que fuera> sin límite
        const grupos = (await kv.get('cecyte_groups')) || GRUPOS_POR_DEFECTO;
        if (!grupos.includes(group)) {
            return res.status(400).json({ error: 'Ese grupo no existe.' });
        }

        if (previousGroup && previousGroup !== group) {
            const oldKey = `push_subs:${previousGroup}`;
            const oldSubs = (await kv.get(oldKey)) || [];
            await kv.set(oldKey, oldSubs.filter(s => s.endpoint !== subscription.endpoint));
        }

        const key = `push_subs:${group}`;
        const subs = (await kv.get(key)) || [];
        const filtered = subs.filter(s => s.endpoint !== subscription.endpoint);
        if (filtered.length >= MAX_SUSCRIPCIONES) {
            return res.status(429).json({ error: 'Ya hay demasiados dispositivos con aviso en este grupo.' });
        }
        filtered.push({ endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } });
        await kv.set(key, filtered);

        return res.status(200).json({ ok: true });
    } catch (err) {
        return res.status(500).json({ error: 'No se pudo guardar la suscripción.' });
    }
}
