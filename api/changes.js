// GET  /api/changes -> publico: cambios del dia (clase cancelada / maestro ausente) de hoy en adelante
// POST /api/changes -> solo admin (cookie o Bearer):
//        { action: 'add', group, time, tipo: 'cancelada' | 'ausente', nota? }   siempre es para HOY
//        { action: 'remove', id }
//
// Cada cambio vence solo: al pasar la medianoche (hora de Ciudad de Mexico) deja de devolverse y se poda al
// escribir. Hay uno por clase y dia: marcar otra vez la misma clase reemplaza el aviso anterior.

import { randomUUID } from 'node:crypto';
import { kv } from '@vercel/kv';
import { verifyToken, adminToken } from '../lib/auth.js';

const KEY = 'cecyte_changes';
const MAX = 100;
const TIPOS = ['cancelada', 'ausente'];

// Fecha de hoy en la escuela (AAAA-MM-DD). Vercel corre en UTC: sin esto, de 18:00 a 24:00 ya seria "mañana".
export function hoyMX(ahora = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

export default async function handler(req, res) {
    const hoy = hoyMX();

    if (req.method === 'GET') {
        try {
            const todos = (await kv.get(KEY)) || [];
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json(todos.filter(c => c.date >= hoy));
        } catch (err) {
            return res.status(500).json({ error: 'No se pudo leer la base de datos (Vercel KV).' });
        }
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    if (!verifyToken(adminToken(req))) {
        return res.status(401).json({ error: 'No autorizado. Inicia sesión de nuevo.' });
    }

    const b = req.body || {};
    try {
        let todos = ((await kv.get(KEY)) || []).filter(c => c.date >= hoy);

        if (b.action === 'add') {
            const group = typeof b.group === 'string' ? b.group.trim().slice(0, 60) : '';
            const time = typeof b.time === 'string' && /^\d\d:\d\d - \d\d:\d\d$/.test(b.time) ? b.time : '';
            const tipo = TIPOS.includes(b.tipo) ? b.tipo : '';
            const nota = typeof b.nota === 'string' ? b.nota.trim().slice(0, 120) : '';
            if (!group || !time || !tipo) {
                return res.status(400).json({ error: 'Faltan el grupo, la hora o el tipo de cambio (cancelada o ausente).' });
            }
            todos = todos.filter(c => !(c.group === group && c.date === hoy && c.time === time));
            if (todos.length >= MAX) {
                return res.status(400).json({ error: `Ya hay ${MAX} cambios para hoy: quita alguno antes de agregar otro.` });
            }
            todos.push({ id: randomUUID(), group, date: hoy, time, tipo, nota, t: Date.now() });
        } else if (b.action === 'remove') {
            if (typeof b.id !== 'string' || !b.id) return res.status(400).json({ error: 'Falta el id del cambio.' });
            todos = todos.filter(c => c.id !== b.id);
        } else {
            return res.status(400).json({ error: 'Acción no válida.' });
        }

        await kv.set(KEY, todos);
        return res.status(200).json({ changes: todos });
    } catch (err) {
        return res.status(500).json({ error: 'No se pudo guardar el cambio.' });
    }
}
