// Admins con contraseña propia y permisos por función.
// El maestro es ADMIN_PASSWORD (variable de entorno): tiene todos los permisos y es el único que gestiona a los demás.
// Los demás se guardan en KV (cecyte_admins) con la contraseña cifrada (scrypt + sal); sus permisos se leen en cada petición,
// así que cambiarlos, cambiar su contraseña o borrarlos surte efecto de inmediato.

import crypto from 'crypto';
import { leerToken, adminToken } from './auth.js';

export const CLAVE_ADMINS = 'cecyte_admins';
export const MAX_ADMINS = 20;
export const CLAVE_MIN = 6;
export const CLAVE_MAX = 64;

export const GRUPOS_PERMISOS = [
    { id: 'horario', nombre: 'Horario' },
    { id: 'timbre', nombre: 'Timbre' },
    { id: 'robot', nombre: 'Robot' },
];

export const PERMISOS = [
    { id: 'horarios', grupo: 'horario', nombre: 'Horarios' },
    { id: 'grupos', grupo: 'horario', nombre: 'Grupos' },
    { id: 'alertas', grupo: 'horario', nombre: 'Alertas' },
    { id: 'timbre', grupo: 'timbre', nombre: 'Timbre' },
    { id: 'ritmo', grupo: 'timbre', nombre: 'Ritmo' },
    { id: 'esp32', grupo: 'timbre', nombre: 'ESP32' },
    { id: 'robot-control', grupo: 'robot', nombre: 'Control' },
    { id: 'robot-funciones', grupo: 'robot', nombre: 'Funciones' },
    { id: 'robot-jarvis', grupo: 'robot', nombre: 'Hevy' },
    { id: 'robot-dibujar', grupo: 'robot', nombre: 'Dibujar' },
    { id: 'robot-musica', grupo: 'robot', nombre: 'Audio' },
    { id: 'robot-luces', grupo: 'robot', nombre: 'Luces' },
    { id: 'robot-telefono', grupo: 'robot', nombre: 'Teléfono' },
    { id: 'robot-instalar', grupo: 'robot', nombre: 'Conexión' },
];

export const IDS_PERMISOS = PERMISOS.map(p => p.id);

// Solo los permisos que existen, sin repetir y en el orden del catálogo
export function limpiarPermisos(v) {
    return Array.isArray(v) ? IDS_PERMISOS.filter(id => v.includes(id)) : [];
}

export function nuevaClave(clave) {
    const sal = crypto.randomBytes(16).toString('hex');
    return { sal, hash: crypto.scryptSync(clave, sal, 32).toString('hex') };
}

export function claveCoincide(clave, admin) {
    if (!admin || typeof admin.sal !== 'string' || typeof admin.hash !== 'string' || typeof clave !== 'string') return false;
    const calculado = crypto.scryptSync(clave, admin.sal, 32);
    const guardado = Buffer.from(admin.hash, 'hex');
    return calculado.length === guardado.length && crypto.timingSafeEqual(calculado, guardado);
}

export function esClaveMaestra(clave) {
    const maestra = process.env.ADMIN_PASSWORD;
    if (!maestra || typeof clave !== 'string') return false;
    const a = crypto.createHash('sha256').update(clave).digest();
    const b = crypto.createHash('sha256').update(maestra).digest();
    return crypto.timingSafeEqual(a, b);
}

export async function leerAdmins(kv) {
    const lista = await kv.get(CLAVE_ADMINS);
    return Array.isArray(lista) ? lista : [];
}

export async function guardarAdmins(kv, lista) {
    await kv.set(CLAVE_ADMINS, lista);
}

// Lo que se puede mostrar de un admin (nunca la contraseña cifrada)
export const publico = a => ({ id: a.id, nombre: a.nombre, permisos: a.permisos, creado: a.creado, actualizado: a.actualizado });

// null si no hay sesión válida; si no, quién es y qué puede hacer
export async function sesionDe(req, kv) {
    const t = leerToken(adminToken(req));
    if (!t) return null;
    if (t.id === 'master') return { rol: 'master', id: 'master', nombre: 'Maestro', permisos: [...IDS_PERMISOS, 'admins'] };
    let lista;
    try { lista = await leerAdmins(kv); } catch (e) { return null; }
    const a = lista.find(x => x.id === t.id);
    if (!a || t.ts < (a.claveCambiada || 0)) return null;
    return { rol: 'admin', id: a.id, nombre: a.nombre, permisos: limpiarPermisos(a.permisos) };
}

// Responde 401 (sin sesión) o 403 (sin permiso) y devuelve null; si todo bien devuelve la sesión.
// aceptados: basta con tener uno de esos permisos.
export async function exigir(req, res, kv, ...aceptados) {
    const s = await sesionDe(req, kv);
    if (!s) {
        res.status(401).json({ error: 'No autorizado. Inicia sesión de nuevo.' });
        return null;
    }
    if (aceptados.length && !aceptados.some(p => s.permisos.includes(p))) {
        res.status(403).json({ error: 'Tu contraseña no tiene permiso para esto.' });
        return null;
    }
    return s;
}
