// GET    /api/groups -> cualquiera puede leer la lista de grupos (publico)
// POST   /api/groups { name } -> solo admin, agrega un grupo nuevo
// DELETE /api/groups { name } -> solo admin, borra el grupo Y todas sus materias del horario
//
// Guardamos la lista de grupos aparte del horario para que un admin pueda
// crear un grupo vacio (sin materias todavia) y que igual aparezca en el
// selector, o borrar un grupo completo de un jalón sin tener que borrar
// materia por materia.

import { kv } from '@vercel/kv';
import { verifyToken, parseCookies } from '../lib/auth.js';
import { limpiarGrupo, GRUPOS_POR_DEFECTO, MAX_GRUPOS } from '../lib/validar.js';

const GROUPS_KEY = 'cecyte_groups';
const SCHEDULE_KEY = 'cecyte_schedule';
const DEFAULT_GROUPS = GRUPOS_POR_DEFECTO;

export default async function handler(req, res) {
    if (req.method === 'GET') {
        try {
            const groups = await kv.get(GROUPS_KEY);
            return res.status(200).json(groups || DEFAULT_GROUPS);
        } catch (err) {
            return res.status(500).json({ error: 'No se pudo conectar a la base de datos (Vercel KV).' });
        }
    }

    // POST y DELETE requieren sesion de admin
    const cookies = parseCookies(req);
    if (!verifyToken(cookies.admin_token)) {
        return res.status(401).json({ error: 'No autorizado. Inicia sesión de nuevo.' });
    }

    if (req.method === 'POST') {
        const { name } = req.body || {};
        const trimmed = limpiarGrupo(name);

        if (!trimmed) {
            return res.status(400).json({ error: 'Ponle un nombre al grupo (hasta 60 letras, sin caracteres raros).' });
        }

        try {
            const groups = (await kv.get(GROUPS_KEY)) || DEFAULT_GROUPS;
            if (groups.includes(trimmed)) {
                return res.status(400).json({ error: 'Ese grupo ya existe.' });
            }
            if (groups.length >= MAX_GRUPOS) {
                return res.status(400).json({ error: `Ya hay ${MAX_GRUPOS} grupos: borra alguno antes de agregar otro.` });
            }
            const updated = [...groups, trimmed];
            await kv.set(GROUPS_KEY, updated);
            return res.status(200).json({ groups: updated });
        } catch (err) {
            return res.status(500).json({ error: 'No se pudo guardar el grupo nuevo.' });
        }
    }

    if (req.method === 'DELETE') {
        const { name } = req.body || {};
        if (typeof name !== 'string' || !name) {
            return res.status(400).json({ error: 'Falta el nombre del grupo a eliminar.' });
        }

        try {
            const groups = (await kv.get(GROUPS_KEY)) || DEFAULT_GROUPS;
            const updatedGroups = groups.filter(g => g !== name);
            // También se van las materias que pertenecían a ese grupo. Las dos llaves se escriben en un solo
            // paso (MSET es atómico): antes, si fallaba a la mitad quedaban materias de un grupo que ya no existía.
            const schedule = (await kv.get(SCHEDULE_KEY)) || [];
            const updatedSchedule = schedule.filter(item => item.group !== name);
            await kv.mset({ [GROUPS_KEY]: updatedGroups, [SCHEDULE_KEY]: updatedSchedule });

            return res.status(200).json({ groups: updatedGroups, schedule: updatedSchedule });
        } catch (err) {
            return res.status(500).json({ error: 'No se pudo eliminar el grupo.' });
        }
    }

    return res.status(405).json({ error: 'Método no permitido' });
}
