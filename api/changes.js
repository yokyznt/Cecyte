// GET  /api/changes -> publico: cambios del dia (clase cancelada / maestro ausente) de hoy en adelante
// POST /api/changes -> solo admin (cookie o Bearer):
//        { action: 'add', group, time, tipo: 'cancelada' | 'ausente', nota? }   siempre es para HOY
//        { action: 'remove', id }
//
// Cada cambio vence solo: al pasar la medianoche (hora de Ciudad de Mexico) deja de devolverse y se poda al
// escribir. Hay uno por clase y dia: marcar otra vez la misma clase reemplaza el aviso anterior.

import { randomUUID } from 'node:crypto';
import { kv } from '@vercel/kv';
import { exigir } from '../lib/admins.js';
import { cors } from '../lib/cors.js';
import { getWebPush } from '../lib/webpush.js';

const KEY = 'cecyte_changes';
const MAX = 100;
const TIPOS = ['cancelada', 'ausente'];
const ANUNCIOS = 'cecyte_anuncios';
const MAX_ANUNCIOS = 10;

function sumarDias(fecha, n) {
    const d = new Date(fecha + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

async function avisarATodos(titulo, texto) {
    let webpush;
    try { webpush = getWebPush(); } catch (e) { return 0; }
    const grupos = (await kv.get('cecyte_groups')) || [];
    const vistos = new Set();
    let enviados = 0;
    for (const g of grupos) {
        const subs = (await kv.get(`push_subs:${g}`)) || [];
        await Promise.all(subs.filter(s => !vistos.has(s.endpoint)).map(async s => {
            vistos.add(s.endpoint);
            try { await webpush.sendNotification(s, JSON.stringify({ title: titulo, body: texto })); enviados++; } catch (e) { }
        }));
    }
    return enviados;
}

async function anuncios(req, res, hoy) {
    let lista = ((await kv.get(ANUNCIOS)) || []).filter(a => a.hasta >= hoy);
    if (req.method === 'GET') {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(lista);
    }
    if (!(await exigir(req, res, kv, 'alertas'))) return;
    const b = req.body || {};
    if (b.action === 'anuncio-add') {
        const titulo = typeof b.titulo === 'string' ? b.titulo.trim().slice(0, 80) : '';
        const texto = typeof b.texto === 'string' ? b.texto.trim().slice(0, 400) : '';
        const dias = Number.isInteger(b.dias) ? Math.min(Math.max(b.dias, 1), 60) : 1;
        if (!titulo) return res.status(400).json({ error: 'Escribe un título para el anuncio.' });
        if (lista.length >= MAX_ANUNCIOS) return res.status(400).json({ error: `Máximo ${MAX_ANUNCIOS} anuncios activos: quita alguno.` });
        lista.push({ id: randomUUID(), titulo, texto, desde: hoy, hasta: sumarDias(hoy, dias - 1), t: Date.now() });
        await kv.set(ANUNCIOS, lista);
        const enviados = b.avisar === false ? 0 : await avisarATodos(titulo, texto || titulo);
        return res.status(200).json({ anuncios: lista, enviados });
    }
    if (b.action === 'anuncio-remove') {
        lista = lista.filter(a => a.id !== b.id);
        await kv.set(ANUNCIOS, lista);
        return res.status(200).json({ anuncios: lista });
    }
    return res.status(400).json({ error: 'Acción no válida.' });
}

// Fecha de hoy en la escuela (AAAA-MM-DD). Vercel corre en UTC: sin esto, de 18:00 a 24:00 ya seria "mañana".
export function hoyMX(ahora = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

export default async function handler(req, res) {
    if (cors(req, res)) return;
    const hoy = hoyMX();

    const b0 = req.body || {};
    if ((req.method === 'GET' && req.query && req.query.anuncios) || (req.method === 'POST' && /^anuncio-/.test(String(b0.action || '')))) {
        try {
            return await anuncios(req, res, hoy);
        } catch (err) {
            return res.status(500).json({ error: 'No se pudieron leer o guardar los anuncios.' });
        }
    }

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

    if (!(await exigir(req, res, kv, 'alertas'))) return;

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
