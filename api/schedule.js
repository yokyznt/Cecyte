// GET  /api/schedule  -> cualquiera puede leer el horario actual (publico)
// POST /api/schedule  -> solo con sesion de admin valida, guarda el horario nuevo
//
// Esto es lo que hace que el horario sea el mismo para TODOS: ya no vive en la
// memoria de cada navegador, vive en Vercel KV (una base de datos chiquita
// tipo llave-valor). Cuando el admin guarda, se escribe aqui. Cuando cualquier
// alumno carga la pagina (o cada 15s mientras la tiene abierta), la vuelve a leer.

import { kv } from '@vercel/kv';
import { verifyToken, parseCookies } from '../lib/auth.js';

const SCHEDULE_KEY = 'cecyte_schedule';

// Horario de ejemplo con el que arranca la primera vez (antes de que el admin guarde algo)
const DEFAULT_SCHEDULE = [
    { id: 1, day: 'Lunes', time: '07:00 - 08:00', subject: 'Cálculo Diferencial', teacher: 'Ing. Roberto Gómez' },
    { id: 2, day: 'Lunes', time: '08:00 - 08:45', subject: 'Física II', teacher: 'Dra. Carmen Solís' },
    { id: 3, day: 'Lunes', time: '09:15 - 10:00', subject: 'Programación Orientada a Objetos', teacher: 'Lic. Javier Estrada' },
    { id: 4, day: 'Martes', time: '07:00 - 08:00', subject: 'Programación Orientada a Objetos', teacher: 'Lic. Javier Estrada' },
    { id: 5, day: 'Martes', time: '08:00 - 08:45', subject: 'Inglés IV', teacher: 'Prof. Ana Luisa' }
];

export default async function handler(req, res) {
    if (req.method === 'GET') {
        try {
            const data = await kv.get(SCHEDULE_KEY);
            return res.status(200).json(data || DEFAULT_SCHEDULE);
        } catch (err) {
            return res.status(500).json({
                error: 'No se pudo conectar a la base de datos (Vercel KV). Revisa que esté enlazada al proyecto.'
            });
        }
    }

    if (req.method === 'POST') {
        const cookies = parseCookies(req);
        if (!verifyToken(cookies.admin_token)) {
            return res.status(401).json({ error: 'No autorizado. Inicia sesión de nuevo.' });
        }

        const schedule = req.body;
        if (!Array.isArray(schedule)) {
            return res.status(400).json({ error: 'Formato inválido: se esperaba un arreglo.' });
        }

        try {
            await kv.set(SCHEDULE_KEY, schedule);
            return res.status(200).json({ ok: true });
        } catch (err) {
            return res.status(500).json({
                error: 'No se pudo guardar en la base de datos (Vercel KV). Revisa que esté enlazada al proyecto.'
            });
        }
    }

    return res.status(405).json({ error: 'Método no permitido' });
}
