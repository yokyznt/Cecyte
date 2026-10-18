// /api/admins: gestión de admins (solo el maestro, que es quien entra con ADMIN_PASSWORD).
//   GET                          -> { admins[], permisos[], grupos[], max }
//   POST   { nombre, clave, permisos[] }        -> crea un admin
//   PUT    { id, nombre?, clave?, permisos[]? } -> edita (si cambia la clave, sus sesiones abiertas se cierran)
//   DELETE ?id=...                              -> lo borra (pierde el acceso de inmediato)
// La contraseña de cada admin se guarda cifrada (scrypt) y nunca se devuelve.

import crypto from 'crypto';
import { kv } from '@vercel/kv';
import { cors } from '../lib/cors.js';
import { limpiarTexto } from '../lib/validar.js';
import { exigir, leerAdmins, guardarAdmins, nuevaClave, claveCoincide, esClaveMaestra, limpiarPermisos, publico, PERMISOS, GRUPOS_PERMISOS, MAX_ADMINS, CLAVE_MIN, CLAVE_MAX } from '../lib/admins.js';

const NOMBRE_MAX = 30;

// Texto del error, o null si la contraseña sirve
function errorDeClave(clave, lista, idPropio) {
    if (typeof clave !== 'string' || clave.length < CLAVE_MIN || clave.length > CLAVE_MAX) return `La contraseña debe tener de ${CLAVE_MIN} a ${CLAVE_MAX} caracteres.`;
    if (esClaveMaestra(clave)) return 'Esa contraseña ya es la del maestro.';
    if (lista.some(a => a.id !== idPropio && claveCoincide(clave, a))) return 'Otro admin ya usa esa contraseña.';
    return null;
}

const nombreRepetido = (lista, nombre, idPropio) => lista.some(a => a.id !== idPropio && a.nombre.toLowerCase() === nombre.toLowerCase());

export default async function handler(req, res) {
    if (cors(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Método no permitido' });
    if (!(await exigir(req, res, kv, 'admins'))) return;

    const datos = Object.assign({}, req.query || {}, req.body && typeof req.body === 'object' ? req.body : {});

    try {
        const lista = await leerAdmins(kv);

        if (req.method === 'GET') {
            return res.status(200).json({ admins: lista.map(publico), permisos: PERMISOS, grupos: GRUPOS_PERMISOS, max: MAX_ADMINS });
        }

        if (req.method === 'POST') {
            const nombre = limpiarTexto(datos.nombre, NOMBRE_MAX);
            if (!nombre) return res.status(400).json({ error: `Ponle un nombre de 1 a ${NOMBRE_MAX} letras.` });
            if (nombreRepetido(lista, nombre)) return res.status(400).json({ error: 'Ya hay un admin con ese nombre.' });
            if (lista.length >= MAX_ADMINS) return res.status(400).json({ error: `Ya hay ${MAX_ADMINS} admins, borra alguno primero.` });
            const errClave = errorDeClave(datos.clave, lista, null);
            if (errClave) return res.status(400).json({ error: errClave });
            const permisos = limpiarPermisos(datos.permisos);
            if (!permisos.length) return res.status(400).json({ error: 'Elige al menos un permiso.' });
            const ahora = Date.now();
            const admin = { id: crypto.randomBytes(6).toString('hex'), nombre, ...nuevaClave(datos.clave), permisos, creado: ahora, actualizado: ahora, claveCambiada: ahora };
            await guardarAdmins(kv, [...lista, admin]);
            return res.status(201).json({ ok: true, admin: publico(admin) });
        }

        const i = lista.findIndex(a => a.id === datos.id);
        if (i < 0) return res.status(404).json({ error: 'Ese admin ya no existe.' });

        if (req.method === 'DELETE') {
            await guardarAdmins(kv, lista.filter((_, k) => k !== i));
            return res.status(200).json({ ok: true });
        }

        const actual = lista[i];
        const nuevo = { ...actual };
        if (datos.nombre !== undefined) {
            const nombre = limpiarTexto(datos.nombre, NOMBRE_MAX);
            if (!nombre) return res.status(400).json({ error: `Ponle un nombre de 1 a ${NOMBRE_MAX} letras.` });
            if (nombreRepetido(lista, nombre, actual.id)) return res.status(400).json({ error: 'Ya hay un admin con ese nombre.' });
            nuevo.nombre = nombre;
        }
        if (datos.permisos !== undefined) {
            const permisos = limpiarPermisos(datos.permisos);
            if (!permisos.length) return res.status(400).json({ error: 'Elige al menos un permiso.' });
            nuevo.permisos = permisos;
        }
        if (typeof datos.clave === 'string' && datos.clave !== '') {
            const errClave = errorDeClave(datos.clave, lista, actual.id);
            if (errClave) return res.status(400).json({ error: errClave });
            Object.assign(nuevo, nuevaClave(datos.clave), { claveCambiada: Date.now() });
        }
        nuevo.actualizado = Date.now();
        const copia = [...lista];
        copia[i] = nuevo;
        await guardarAdmins(kv, copia);
        return res.status(200).json({ ok: true, admin: publico(nuevo) });
    } catch (err) {
        return res.status(500).json({ error: 'No se pudo completar la operación.' });
    }
}
