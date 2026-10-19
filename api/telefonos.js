// /api/telefonos: amigos con un código de sala comparten su ubicación y otros pueden buscarlos.
//   POST {accion:'unirse', sala, nombre, crear?}            -> {id, token}  (no guarda ubicación; crear:true en una sala sin dueño te hace dueño)
//   POST {accion:'ubicacion', sala, id, token, nombre, lat, lon, p} -> {ok, buscado}  (guarda solo el último punto, vence a los 3 min)
//   POST {accion:'buscar', sala, id, token, objetivo}       -> {ok}  (avisa al teléfono buscado)
//   POST {accion:'salir', sala, id, token} o DELETE         -> borra su punto ya
//   POST {accion:'expulsar', sala, id, token, objetivo}     -> {ok}  (solo el dueño; el expulsado no puede volver 10 min)
//   GET  ?sala&id&token                                      -> {compartiendo, dueno, telefonos[]}  (solo ve a otros quien también comparte)
// Sin historial. Cada token solo autoriza a su propio id (lib/auth.js).

import crypto from 'crypto';
import { kv } from '@vercel/kv';
import { cors } from '../lib/cors.js';
import { firmarDispositivo, verificarDispositivo } from '../lib/auth.js';
import { limpiarSala, limpiarNombreTel, idTelefonoValido, ubicacionValida, MAX_TELEFONOS } from '../lib/validar.js';
import { ipDe, bloqueado, anotarFallo } from '../lib/limite.js';

const VIDA_S = 180;
const VENTANA_MS = 150000;
const BUSCA_S = 120;
const DUENO_S = 604800;
const VETO_S = 600;
const MAX_UNIRSE_POR_HORA = 20;
const MAX_TOKEN_MALO = 30;
const MENSAJE_VETO = 'Te expulsaron de la sala por 10 minutos.';

const clave = (sala, id) => `tel:${sala}:${id}`;
const claveBusca = (sala, id) => `tel:${sala}:busca:${id}`;
const indice = sala => `telidx:${sala}`;
const claveDueno = sala => `teldueno:${sala}`;
const vetoId = (sala, id) => `telveto:${sala}:i:${id}`;
const vetoNombre = (sala, nombre) => `telveto:${sala}:n:${nombre.toLowerCase().replace(/s+/g, ' ')}`;

async function esDueno(sala, id) {
    const d = await kv.get(claveDueno(sala));
    return !!d && d.id === id;
}

export default async function handler(req, res) {
    if (cors(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Método no permitido' });

    const datos = Object.assign({}, req.query || {}, req.body && typeof req.body === 'object' ? req.body : {});
    const sala = limpiarSala(datos.sala);
    if (!sala) return res.status(400).json({ error: 'Código de sala inválido.' });
    const accion = req.method === 'DELETE' ? 'salir' : req.method === 'GET' ? 'listar' : datos.accion;

    try {
        if (accion === 'unirse') {
            const llaveIp = 'tel_unirse:' + ipDe(req);
            if (await bloqueado(kv, llaveIp, MAX_UNIRSE_POR_HORA)) return res.status(429).json({ error: 'Demasiados intentos, espera un rato.' });
            await anotarFallo(kv, llaveIp, 3600);
            const nombreNuevo = limpiarNombreTel(datos.nombre);
            if (!nombreNuevo) return res.status(400).json({ error: 'Pon un nombre de 1 a 20 letras.' });
            if (await kv.get(vetoNombre(sala, nombreNuevo))) return res.status(403).json({ error: MENSAJE_VETO, expulsado: true });
            const id = crypto.randomBytes(6).toString('hex');
            if (datos.crear === true) await kv.set(claveDueno(sala), { id }, { nx: true, ex: DUENO_S });
            return res.status(200).json({ ok: true, id, token: firmarDispositivo(sala, id) });
        }

        const llaveToken = 'tel_token:' + ipDe(req);
        if (!idTelefonoValido(datos.id) || !verificarDispositivo(sala, datos.id, datos.token)) {
            if (await bloqueado(kv, llaveToken, MAX_TOKEN_MALO)) return res.status(429).json({ error: 'Demasiados intentos, espera un rato.' });
            await anotarFallo(kv, llaveToken, 600);
            return res.status(401).json({ error: 'Teléfono no registrado en esta sala.' });
        }
        const id = datos.id;
        if (await kv.get(vetoId(sala, id))) return res.status(403).json({ error: MENSAJE_VETO, expulsado: true });

        if (accion === 'ubicacion') {
            const nombre = limpiarNombreTel(datos.nombre);
            const lat = Number(datos.lat), lon = Number(datos.lon), p = Number(datos.p);
            if (!nombre || !ubicacionValida(lat, lon, p)) return res.status(400).json({ error: 'Ubicación inválida.' });
            const ya = await kv.zscore(indice(sala), id);
            if (ya === null || ya === undefined) {
                const vivos = await kv.zrange(indice(sala), Date.now() - VENTANA_MS, '+inf', { byScore: true });
                if ((vivos || []).length >= MAX_TELEFONOS) return res.status(429).json({ error: 'La sala está llena.' });
            }
            const t = Date.now();
            await kv.set(clave(sala, id), { n: nombre, lat, lon, p, t }, { ex: VIDA_S });
            await kv.zadd(indice(sala), { score: t, member: id });
            if (ya === null || ya === undefined) await kv.expire(indice(sala), 86400);
            const busca = await kv.get(claveBusca(sala, id));
            return res.status(200).json({ ok: true, buscado: busca && busca.quien ? busca.quien : null });
        }

        if (accion === 'buscar') {
            if (!idTelefonoValido(datos.objetivo)) return res.status(400).json({ error: 'Teléfono inválido.' });
            if (!(await kv.get(clave(sala, datos.objetivo)))) return res.status(404).json({ error: 'Ese teléfono no está compartiendo su ubicación.' });
            const yo = await kv.get(clave(sala, id));
            await kv.set(claveBusca(sala, datos.objetivo), { quien: yo && yo.n ? yo.n : 'Hevy' }, { ex: BUSCA_S });
            return res.status(200).json({ ok: true });
        }

        if (accion === 'expulsar') {
            if (!(await esDueno(sala, id))) return res.status(403).json({ error: 'Solo quien creó la sala puede expulsar.' });
            if (!idTelefonoValido(datos.objetivo) || datos.objetivo === id) return res.status(400).json({ error: 'Teléfono inválido.' });
            const blanco = await kv.get(clave(sala, datos.objetivo));
            await kv.set(vetoId(sala, datos.objetivo), 1, { ex: VETO_S });
            if (blanco && blanco.n) await kv.set(vetoNombre(sala, blanco.n), 1, { ex: VETO_S });
            await kv.del(clave(sala, datos.objetivo));
            await kv.del(claveBusca(sala, datos.objetivo));
            await kv.zrem(indice(sala), datos.objetivo);
            return res.status(200).json({ ok: true });
        }

        if (accion === 'salir') {
            await kv.del(clave(sala, id));
            await kv.del(claveBusca(sala, id));
            await kv.zrem(indice(sala), id);
            return res.status(200).json({ ok: true });
        }

        if (accion === 'listar') {
            if (!(await kv.get(clave(sala, id)))) return res.status(200).json({ ok: true, compartiendo: false, telefonos: [] });
            const minimo = Date.now() - VENTANA_MS;
            const ids = (await kv.zrange(indice(sala), minimo, '+inf', { byScore: true })) || [];
            const registros = ids.length ? await kv.mget(...ids.map(i => clave(sala, i))) : [];
            const telefonos = ids.map((i, k) => (registros[k] ? { id: i, n: registros[k].n, lat: registros[k].lat, lon: registros[k].lon, p: registros[k].p, t: registros[k].t } : null)).filter(Boolean);
            await kv.zremrangebyscore(indice(sala), 0, minimo);
            const dueno = await esDueno(sala, id);
            return res.status(200).json({ ok: true, compartiendo: true, dueno, ahora: Date.now(), telefonos });
        }

        return res.status(400).json({ error: 'Acción desconocida.' });
    } catch (err) {
        return res.status(500).json({ error: 'No se pudo completar la operación.' });
    }
}
