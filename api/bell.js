// /api/bell  -> control del timbre escolar (ESP32 + relé)
//
// GET  ?key=BELL_DEVICE_KEY   -> lo usa el ESP32. Responde TEXTO PLANO (4 líneas):
//                                 1) id del último "tocar ahora"
//                                 2) segundos que suena el timbre
//                                 3) días activos (0=Dom,1=Lun ... 6=Sáb), ej. "12345"
//                                 4) horas separadas por coma, ej. "07:00,08:45,09:15"
//                                Además guarda "visto por última vez" para el panel.
// GET  (con sesión de admin)  -> responde JSON con la configuración + si el ESP32 está en línea.
// POST { action: 'save', times, duration, days }  -> solo admin, guarda horas del timbre.
// POST { action: 'ring' }                         -> solo admin, "toca el timbre ahora".
//
// El ESP32 no puede recibir órdenes desde Internet (está detrás del router),
// así que él le pregunta a esta API cada ~10 segundos si hay algo nuevo.

import { kv } from '@vercel/kv';
import { verifyToken, parseCookies } from '../lib/auth.js';

const BELL_KEY = 'cecyte_bell';
const SEEN_KEY = 'cecyte_bell_seen';

const DEFAULT_BELL = {
    times: ['07:00', '08:45', '09:15', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
    duration: 5,
    days: [1, 2, 3, 4, 5],
    ringId: '0'
};

async function getBell() {
    const saved = await kv.get(BELL_KEY);
    return { ...DEFAULT_BELL, ...(saved || {}) };
}

function isAdmin(req) {
    return verifyToken(parseCookies(req).admin_token);
}

export default async function handler(req, res) {
    if (req.method === 'GET') {
        const deviceKey = req.query.key;
        const isDevice = !!process.env.BELL_DEVICE_KEY && deviceKey === process.env.BELL_DEVICE_KEY;

        if (!isDevice && !isAdmin(req)) {
            return res.status(401).json({ error: 'No autorizado' });
        }

        try {
            const bell = await getBell();

            if (isDevice) {
                await kv.set(SEEN_KEY, Date.now());
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.setHeader('Cache-Control', 'no-store');
                return res
                    .status(200)
                    .send([bell.ringId, bell.duration, bell.days.join(''), bell.times.join(',')].join('\n'));
            }

            const lastSeen = (await kv.get(SEEN_KEY)) || null;
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ ...bell, lastSeen, serverNow: Date.now() });
        } catch (err) {
            return res.status(500).json({ error: 'No se pudo conectar a la base de datos (Vercel KV).' });
        }
    }

    if (req.method === 'POST') {
        if (!isAdmin(req)) {
            return res.status(401).json({ error: 'No autorizado. Inicia sesión de nuevo.' });
        }

        const body = req.body || {};

        try {
            const bell = await getBell();

            if (body.action === 'ring') {
                bell.ringId = String(Date.now());
                await kv.set(BELL_KEY, bell);
                return res.status(200).json({ ok: true, ringId: bell.ringId });
            }

            if (body.action === 'save') {
                const { times, duration, days } = body;

                if (!Array.isArray(times) || times.length > 40 || !times.every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
                    return res.status(400).json({ error: 'Horas inválidas (formato HH:MM).' });
                }
                const dur = Number(duration);
                if (!Number.isInteger(dur) || dur < 1 || dur > 30) {
                    return res.status(400).json({ error: 'La duración debe ser de 1 a 30 segundos.' });
                }
                if (!Array.isArray(days) || !days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
                    return res.status(400).json({ error: 'Días inválidos.' });
                }

                bell.times = [...new Set(times)].sort();
                bell.duration = dur;
                bell.days = [...new Set(days)].sort();
                await kv.set(BELL_KEY, bell);
                return res.status(200).json({ ok: true, ...bell });
            }

            return res.status(400).json({ error: 'Acción desconocida.' });
        } catch (err) {
            return res.status(500).json({ error: 'No se pudo guardar en la base de datos (Vercel KV).' });
        }
    }

    return res.status(405).json({ error: 'Método no permitido' });
}
