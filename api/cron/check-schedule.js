// GET /api/cron/check-schedule?secret=TU_CRON_SECRET
//
// Esto es lo que hace que las notificaciones lleguen aunque nadie tenga la
// pagina abierta. Un servicio externo (cron-job.org) le "toca la puerta" a
// esta URL cada 5-15 minutos. Cada vez que la toca:
//   1. Calcula la hora real de Mexico (Vercel corre en UTC, hay que convertir)
//   2. Para cada grupo, ve si cambio de bloque de clase desde la ultima vez
//   3. Si cambio, manda un push real a todos los celulares suscritos a ese grupo
//
// Protegido con un "secret" en la URL para que no cualquiera lo pueda disparar.

import { kv } from '@vercel/kv';
import { getWebPush } from '../../lib/webpush.js';

const SCHEDULE_KEY = 'cecyte_schedule';
const GROUPS_KEY = 'cecyte_groups';

// Debe ser identico a los bloques de app.js — si cambias uno, cambia el otro.
const TIME_SLOTS = [
    { key: '07:00 - 08:00', receso: false },
    { key: '08:00 - 08:45', receso: false },
    { key: '08:45 - 09:15', receso: true },
    { key: '09:15 - 10:00', receso: false },
    { key: '10:00 - 11:00', receso: false },
    { key: '11:00 - 12:00', receso: false },
    { key: '12:00 - 13:00', receso: false },
    { key: '13:00 - 14:00', receso: false },
    { key: '14:00 - 15:00', receso: false }
];
const VALID_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

function timeToMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

// Vercel corre sus funciones en UTC, asi que hay que pedir la hora
// explicitamente en la zona horaria de Mexico, no usar new Date() a secas.
function getMexicoNowParts() {
    const fmt = new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Mexico_City',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    const map = {};
    fmt.formatToParts(new Date()).forEach(p => { map[p.type] = p.value; });
    const weekday = map.weekday.charAt(0).toUpperCase() + map.weekday.slice(1);
    return { weekday, hour: parseInt(map.hour, 10), minute: parseInt(map.minute, 10) };
}

function getCurrentSlot(hour, minute) {
    const nowMinutes = hour * 60 + minute;
    for (const slot of TIME_SLOTS) {
        const [s, e] = slot.key.split(' - ');
        if (nowMinutes >= timeToMinutes(s) && nowMinutes < timeToMinutes(e)) return slot;
    }
    return null;
}

function buildMessage(prevClass, slot, nextClass) {
    const lineas = [];
    if (prevClass) lineas.push('La clase actual está por terminar.');
    if (slot && slot.receso) {
        lineas.push('Sigue: Receso.');
    } else if (nextClass) {
        lineas.push(`Comienza: ${nextClass.subject}${nextClass.teacher ? `, con el/la profesor(a) ${nextClass.teacher}` : ''}.`);
    } else if (!prevClass) {
        lineas.push('No hay más clases por el momento.');
    }
    return lineas.join('\n');
}

export default async function handler(req, res) {
    const secret = req.query.secret || req.headers['x-cron-secret'];
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    let webpush;
    try {
        webpush = getWebPush();
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }

    const { weekday, hour, minute } = getMexicoNowParts();
    const day = VALID_DAYS.includes(weekday) ? weekday : null;
    const slot = day ? getCurrentSlot(hour, minute) : null;
    const currentKey = slot ? slot.key : null;

    const groups = (await kv.get(GROUPS_KEY)) || [];
    const schedule = (await kv.get(SCHEDULE_KEY)) || [];

    const resumen = [];

    for (const group of groups) {
        const stateKey = `push_last_slot:${group}`;
        const lastKeyRaw = await kv.get(stateKey);
        const isFirstRun = lastKeyRaw === undefined || lastKeyRaw === null;
        const lastKey = isFirstRun ? null : lastKeyRaw;

        if (currentKey === lastKey) continue; // no cambio de bloque para este grupo, nada que hacer

        if (!isFirstRun) {
            const prevSlot = TIME_SLOTS.find(s => s.key === lastKey);
            const prevClass = (day && prevSlot && !prevSlot.receso)
                ? schedule.find(i => i.group === group && i.day === day && i.time === prevSlot.key)
                : null;
            const nextClass = (day && slot && !slot.receso)
                ? schedule.find(i => i.group === group && i.day === day && i.time === slot.key)
                : null;

            const shouldNotify = prevClass || nextClass || (slot && slot.receso);

            if (shouldNotify) {
                const body = buildMessage(prevClass, slot, nextClass);
                const subsKey = `push_subs:${group}`;
                const subs = (await kv.get(subsKey)) || [];
                let notified = 0;
                const stillValid = [];

                for (const sub of subs) {
                    try {
                        await webpush.sendNotification(sub, JSON.stringify({ title: 'CECyTE Plantel 18', body }));
                        stillValid.push(sub);
                        notified++;
                    } catch (err) {
                        // 410/404 = la suscripcion ya no existe (desinstalaron, revocaron permiso, etc.)
                        if (err.statusCode !== 410 && err.statusCode !== 404) {
                            stillValid.push(sub); // error temporal, no la borramos todavia
                        }
                    }
                }

                if (stillValid.length !== subs.length) {
                    await kv.set(subsKey, stillValid);
                }

                resumen.push({ group, notified, total: subs.length });
            }
        }

        await kv.set(stateKey, currentKey);
    }

    return res.status(200).json({ ok: true, day, hour, minute, currentKey, resumen });
}
