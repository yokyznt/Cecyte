// /api/bell  -> control del timbre escolar (ESP32 + relé)
//
// GET  ?key=BELL_DEVICE_KEY   -> lo usa el ESP32. Responde TEXTO PLANO (9 líneas, pueden venir vacías):
//                                 1) id del último "tocar ahora"
//                                 2) segundos totales que dura el ritmo (informativo)
//                                 3) días activos (0=Dom,1=Lun ... 6=Sáb), ej. "12345"
//                                 4) horas separadas por coma, ej. "07:00,08:45,09:15"
//                                 5) ritmo normal en ms alternando SUENA,PAUSA,SUENA... ej. "220,160,200"
//                                 6) ritmos por hora, ej. "09:15=300,200,300;15:00=100,100,100"
//                                 7) días sin timbre AAAAMMDD separados por coma, ej. "20261225,20261226"
//                                 8) horarios especiales, ej. "20261020=07:00,10:00;20261021=08:00"
//                                 9) firmware publicado "versión|md5|bytes" (para actualizar el ESP32 sin cable)
//                                Parámetros opcionales del ESP32:
//                                 s=1  "aquí estoy" (cada ~30 s) + v=versión de firmware, rs=señal WiFi, t=hora del ESP32 (epoch)
//                                 ev=  toques que acaba de hacer, ej. "1760000000:P,1760000300:M" (P=programado, M=manual)
// GET  (con sesión de admin)  -> responde JSON con la configuración, estado del ESP32 e historial.
// POST { action: 'save', times, days, rhythm, rhythms, offDates, specials } -> solo admin.
// POST { action: 'ring' }                                                  -> solo admin, "toca el timbre ahora".
//
// El ESP32 no puede recibir órdenes desde Internet (está detrás del router),
// así que él le pregunta a esta API cada ~5 segundos si hay algo nuevo.

import { kv } from '@vercel/kv';
import { verifyToken, parseCookies } from '../lib/auth.js';

const BELL_KEY = 'cecyte_bell';
const SEEN_KEY = 'cecyte_bell_seen';
const LOG_KEY = 'cecyte_bell_log';
const FW_META_KEY = 'cecyte_fw_meta'; // lo escribe api/firmware.js

// Ritmo: milisegundos alternando SUENA, PAUSA, SUENA, ... (siempre impar: empieza y termina sonando)
const DEFAULT_RHYTHM = [220, 160, 200, 190, 200, 210, 140, 100, 140, 230, 100, 80, 130, 250, 160, 210, 200];
const MAX_STEPS = 120;       // el ESP32 guarda hasta 128
const MAX_OVR_STEPS = 39;    // los ritmos por hora tienen menos espacio en el ESP32
const MAX_OVERRIDES = 8;
const MAX_OFF_DATES = 40;
const MAX_SPECIALS = 8;
const MAX_SPECIAL_TIMES = 16;
const MIN_STEP_MS = 20;      // menos que esto el relé ni alcanza a cerrar
const MAX_STEP_MS = 5000;    // tope por paso: un relé trabado prendido no dura más de 5 s
const MAX_TOTAL_MS = 30000;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULT_BELL = {
    times: ['07:00', '08:45', '09:15', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
    duration: 3,
    days: [1, 2, 3, 4, 5],
    rhythm: DEFAULT_RHYTHM,
    rhythms: {},
    offDates: [],
    specials: {},
    ringId: '0'
};

function validRhythm(r, maxSteps = MAX_STEPS) {
    return Array.isArray(r)
        && r.length >= 1 && r.length <= maxSteps && r.length % 2 === 1
        && r.every(n => Number.isInteger(n) && n >= MIN_STEP_MS && n <= MAX_STEP_MS)
        && r.reduce((a, b) => a + b, 0) <= MAX_TOTAL_MS;
}

// "2026-12-25" real (no 2026-02-31)
function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const compact = date => date.replace(/-/g, '');

async function getBell() {
    const saved = await kv.get(BELL_KEY);
    return { ...DEFAULT_BELL, ...(saved || {}) };
}

function isAdmin(req) {
    return verifyToken(parseCookies(req).admin_token);
}

// Texto para el ESP32 (ver arriba)
function deviceText(bell, fw) {
    const rhythms = Object.entries(bell.rhythms || {}).map(([t, r]) => `${t}=${r.join(',')}`).join(';');
    const specials = Object.entries(bell.specials || {}).map(([d, ts]) => `${compact(d)}=${ts.join(',')}`).join(';');
    return [
        bell.ringId,
        bell.duration,
        bell.days.join(''),
        bell.times.join(','),
        bell.rhythm.join(','),
        rhythms,
        (bell.offDates || []).map(compact).join(','),
        specials,
        fw ? `${fw.version}|${fw.md5}|${fw.size}` : ''
    ].join('\n');
}

// Toques que reporta el ESP32: "epoch:P,epoch:M". zadd con el mismo miembro no duplica.
async function logEvents(ev) {
    const items = String(ev || '').split(',').filter(x => /^\d{10}:[PM]$/.test(x)).slice(0, 8);
    if (!items.length) return;
    const [first, ...rest] = items.map(m => ({ score: Number(m.split(':')[0]), member: m }));
    await kv.zadd(LOG_KEY, first, ...rest);
    await kv.zremrangebyrank(LOG_KEY, 0, -51); // conserva los últimos 50
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
            const fw = await kv.get(FW_META_KEY);

            if (isDevice) {
                if (req.query.s) {
                    const clock = Number(req.query.t) || 0;
                    await kv.set(SEEN_KEY, {
                        t: Date.now(),
                        fw: Number(req.query.v) || 0,
                        rssi: Number(req.query.rs) || 0,
                        clockDiffMs: clock > 1.6e9 ? clock * 1000 - Date.now() : null
                    });
                }
                if (req.query.ev) await logEvents(req.query.ev);
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.setHeader('Cache-Control', 'no-store');
                return res.status(200).send(deviceText(bell, fw));
            }

            const seen = (await kv.get(SEEN_KEY)) || {};
            const log = (await kv.zrange(LOG_KEY, 0, 19, { rev: true })) || [];
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({
                ...bell,
                lastSeen: seen.t || null,
                espFw: seen.fw || 0,
                espRssi: seen.rssi || 0,
                espClockDiffMs: seen.clockDiffMs ?? null,
                log: log.map(String),
                fw: fw ? { version: fw.version, size: fw.size, ts: fw.ts } : null,
                serverNow: Date.now()
            });
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
                const { times, days, rhythm, rhythms, offDates, specials } = body;

                if (!Array.isArray(times) || times.length > 40 || !times.every(t => TIME_RE.test(t))) {
                    return res.status(400).json({ error: 'Horas inválidas (formato HH:MM).' });
                }
                if (rhythm !== undefined && !validRhythm(rhythm)) {
                    return res.status(400).json({ error: 'Ritmo inválido: cantidad impar de pasos (empieza y termina sonando), cada paso de 20 a 5000 ms y máximo 30 s en total.' });
                }
                if (!Array.isArray(days) || !days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
                    return res.status(400).json({ error: 'Días inválidos.' });
                }

                const cleanTimes = [...new Set(times)].sort();

                if (rhythms !== undefined) {
                    const entries = Object.entries(rhythms || {}).filter(([t]) => cleanTimes.includes(t));
                    if (entries.length > MAX_OVERRIDES) {
                        return res.status(400).json({ error: `Máximo ${MAX_OVERRIDES} horas con ritmo propio.` });
                    }
                    if (!entries.every(([t, r]) => TIME_RE.test(t) && validRhythm(r, MAX_OVR_STEPS))) {
                        return res.status(400).json({ error: `Ritmo por hora inválido (máximo ${(MAX_OVR_STEPS + 1) / 2} toques cada uno).` });
                    }
                    bell.rhythms = Object.fromEntries(entries);
                } else {
                    bell.rhythms = Object.fromEntries(Object.entries(bell.rhythms || {}).filter(([t]) => cleanTimes.includes(t)));
                }

                if (offDates !== undefined) {
                    if (!Array.isArray(offDates) || offDates.length > MAX_OFF_DATES || !offDates.every(validDate)) {
                        return res.status(400).json({ error: `Días sin timbre inválidos (máximo ${MAX_OFF_DATES}).` });
                    }
                    bell.offDates = [...new Set(offDates)].sort();
                }

                if (specials !== undefined) {
                    const entries = Object.entries(specials || {});
                    const okEntries = entries.length <= MAX_SPECIALS && entries.every(([d, ts]) =>
                        validDate(d) && Array.isArray(ts) && ts.length <= MAX_SPECIAL_TIMES && ts.every(t => TIME_RE.test(t)));
                    if (!okEntries) {
                        return res.status(400).json({ error: `Horarios especiales inválidos (máximo ${MAX_SPECIALS} días y ${MAX_SPECIAL_TIMES} horas por día).` });
                    }
                    bell.specials = Object.fromEntries(entries.map(([d, ts]) => [d, [...new Set(ts)].sort()]).sort());
                }

                bell.times = cleanTimes;
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
