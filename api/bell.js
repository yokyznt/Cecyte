// /api/bell  -> control del timbre escolar (ESP32 + relé)
//
// GET  ?key=BELL_DEVICE_KEY   -> lo usa el ESP32. Responde TEXTO PLANO (5 líneas):
//                                 1) id del último "tocar ahora"
//                                 2) segundos totales que dura el ritmo (informativo)
//                                 3) días activos (0=Dom,1=Lun ... 6=Sáb), ej. "12345"
//                                 4) horas separadas por coma, ej. "07:00,08:45,09:15"
//                                 5) ritmo en ms alternando SUENA,PAUSA,SUENA... ej. "220,160,200"
//                                Con &s=1 además guarda "visto por última vez" para el panel
//                                (el ESP32 lo manda cada ~30 s para gastar menos la base de datos).
// GET  (con sesión de admin)  -> responde JSON con la configuración + si el ESP32 está en línea.
// POST { action: 'save', times, days, rhythm }    -> solo admin, guarda horas, días y ritmo del timbre.
// POST { action: 'ring' }                         -> solo admin, "toca el timbre ahora".
//
// El ESP32 no puede recibir órdenes desde Internet (está detrás del router),
// así que él le pregunta a esta API cada ~5 segundos si hay algo nuevo.

import { kv } from '@vercel/kv';
import { verifyToken, parseCookies } from '../lib/auth.js';

const BELL_KEY = 'cecyte_bell';
const SEEN_KEY = 'cecyte_bell_seen';

// Ritmo: milisegundos alternando SUENA, PAUSA, SUENA, ... (siempre impar: empieza y termina sonando)
const DEFAULT_RHYTHM = [220, 160, 200, 190, 200, 210, 140, 100, 140, 230, 100, 80, 130, 250, 160, 210, 200];
const MAX_STEPS = 120;      // el ESP32 guarda hasta 128
const MIN_STEP_MS = 20;     // menos que esto el relé ni alcanza a cerrar
const MAX_STEP_MS = 5000;   // tope por paso: un relé trabado prendido no dura más de 5 s
const MAX_TOTAL_MS = 30000;

const DEFAULT_BELL = {
    times: ['07:00', '08:45', '09:15', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
    duration: 3,
    days: [1, 2, 3, 4, 5],
    rhythm: DEFAULT_RHYTHM,
    ringId: '0'
};

function validRhythm(r) {
    return Array.isArray(r)
        && r.length >= 1 && r.length <= MAX_STEPS && r.length % 2 === 1
        && r.every(n => Number.isInteger(n) && n >= MIN_STEP_MS && n <= MAX_STEP_MS)
        && r.reduce((a, b) => a + b, 0) <= MAX_TOTAL_MS;
}

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
                const { times, days, rhythm } = body;

                if (!Array.isArray(times) || times.length > 40 || !times.every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
                    return res.status(400).json({ error: 'Horas inválidas (formato HH:MM).' });
                }
                if (rhythm !== undefined && !validRhythm(rhythm)) {
                    return res.status(400).json({ error: 'Ritmo inválido: cantidad impar de pasos (empieza y termina sonando), cada paso de 20 a 5000 ms y máximo 30 s en total.' });
                }
                if (!Array.isArray(days) || !days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
                    return res.status(400).json({ error: 'Días inválidos.' });
                }

                bell.times = [...new Set(times)].sort();
                if (rhythm !== undefined) {
                    bell.rhythm = rhythm;
                    bell.duration = Math.max(1, Math.ceil(rhythm.reduce((a, b) => a + b, 0) / 1000));
                }
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
