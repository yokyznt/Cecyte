// Validación de lo que guarda el admin y de lo que mandan los dispositivos.
// Antes los endpoints solo revisaban que "fuera un arreglo": cualquier cosa (o JSON enorme) acababa en KV.

export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
export const GRUPOS_POR_DEFECTO = ['501 Programación'];
export const MAX_REGISTROS = 1500;     // materias en total
export const MAX_GRUPOS = 40;
export const MAX_SUSCRIPCIONES = 500;  // dispositivos con aviso push por grupo

const CONTROL = /[\u0000-\u001f\u007f]/;
const HORA = /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/;

// Texto de 1..max caracteres sin caracteres de control, o null
export function limpiarTexto(v, max, { vacio = false } = {}) {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (CONTROL.test(t) || t.length > max) return null;
    if (!t && !vacio) return null;
    return t;
}

export const limpiarGrupo = v => limpiarTexto(v, 60);

export const MAX_TELEFONOS = 20;       // teléfonos compartiendo ubicación por sala
export const limpiarSala = v => { const s = typeof v === 'string' ? v.trim().toUpperCase() : ''; return /^[A-Z0-9]{6,10}$/.test(s) ? s : null; };
export const limpiarNombreTel = v => limpiarTexto(v, 20);
export const idTelefonoValido = v => typeof v === 'string' && /^[0-9a-f]{12}$/.test(v);
export function ubicacionValida(lat, lon, p) {
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && Number.isFinite(p) && p >= 0 && p <= 5000;
}

// Devuelve { ok: true, datos } con solo los campos conocidos, o { ok: false, error }
export function limpiarHorario(entrada) {
    if (!Array.isArray(entrada)) return { ok: false, error: 'Formato inválido: se esperaba un arreglo.' };
    if (entrada.length > MAX_REGISTROS) return { ok: false, error: `Demasiadas materias (máximo ${MAX_REGISTROS}).` };
    const datos = [];
    for (let i = 0; i < entrada.length; i++) {
        const m = entrada[i];
        const donde = `Materia ${i + 1}`;
        if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, error: `${donde}: no es un objeto.` };
        const id = Number(m.id);
        const group = limpiarGrupo(m.group);
        const subject = limpiarTexto(m.subject, 120);
        const teacher = m.teacher === undefined || m.teacher === null ? '' : limpiarTexto(m.teacher, 120, { vacio: true });
        const time = typeof m.time === 'string' ? m.time.trim() : '';
        if (!Number.isFinite(id)) return { ok: false, error: `${donde}: id inválido.` };
        if (!group) return { ok: false, error: `${donde}: grupo inválido.` };
        if (!DIAS.includes(m.day)) return { ok: false, error: `${donde}: día inválido.` };
        if (!HORA.test(time)) return { ok: false, error: `${donde}: hora inválida (formato "07:00 - 08:00").` };
        if (!subject) return { ok: false, error: `${donde}: falta la materia.` };
        if (teacher === null) return { ok: false, error: `${donde}: docente inválido.` };
        datos.push({ id, group, day: m.day, time, subject, teacher });
    }
    return { ok: true, datos };
}

// Una suscripción push de verdad: endpoint https y las llaves del navegador
export function suscripcionValida(s) {
    return !!s && typeof s === 'object'
        && typeof s.endpoint === 'string' && s.endpoint.length <= 600 && /^https:\/\//.test(s.endpoint)
        && !!s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string'
        && s.keys.p256dh.length <= 200 && s.keys.auth.length <= 100;
}
