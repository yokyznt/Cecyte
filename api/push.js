// /api/push?accion=...  (vercel.json lo expone como /api/push/<accion>; son una sola función por el tope de 12 del plan gratis)
//   GET  public-key             -> { publicKey } llave pública VAPID (no es secreta)
//   POST subscribe   { group, previousGroup?, subscription } -> guarda la suscripción push de este dispositivo bajo su grupo
//   POST unsubscribe { group, endpoint }                     -> la quita de la lista de su grupo

import { kv } from '@vercel/kv';
import { limpiarGrupo, suscripcionValida, GRUPOS_POR_DEFECTO, MAX_SUSCRIPCIONES } from '../lib/validar.js';

async function suscribir(req, res) {
    const { group, previousGroup, subscription } = req.body || {};

    if (!limpiarGrupo(group) || !suscripcionValida(subscription)) {
        return res.status(400).json({ error: 'Faltan datos de la suscripción.' });
    }
    if (previousGroup !== undefined && previousGroup !== null && !limpiarGrupo(previousGroup)) {
        return res.status(400).json({ error: 'Grupo anterior inválido.' });
    }

    try {
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

async function desuscribir(req, res) {
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

export default async function handler(req, res) {
    const accion = req.query && req.query.accion;

    if (accion === 'public-key') {
        return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
    }
    if (accion !== 'subscribe' && accion !== 'unsubscribe') {
        return res.status(404).json({ error: 'No existe.' });
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }
    return accion === 'subscribe' ? suscribir(req, res) : desuscribir(req, res);
}
