// node test/api-telefonos.test.mjs -> salas de teléfonos: unirse, compartir ubicación, listar, buscar, vencer, salir, límites.
import assert from 'node:assert';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.AUTH_SECRET = 'secreto-de-prueba-0123456789';

let ahora = 1_800_000_000_000;
Date.now = () => ahora;

const store = new Map();
const vence = new Map();
const zsets = new Map();
const vivo = k => !vence.has(k) || vence.get(k) > ahora;
globalThis.__kv = {
    get: async k => (store.has(k) && vivo(k) ? structuredClone(store.get(k)) : null),
    mget: async (...ks) => ks.map(k => (store.has(k) && vivo(k) ? structuredClone(store.get(k)) : null)),
    set: async (k, v, o) => { if (o && o.nx && store.has(k) && vivo(k)) return null; store.set(k, structuredClone(v)); if (o && o.ex) vence.set(k, ahora + o.ex * 1000); else vence.delete(k); return 'OK'; },
    del: async k => { store.delete(k); vence.delete(k); },
    incr: async k => { const n = (Number(store.get(k)) || 0) + 1; store.set(k, n); return n; },
    expire: async () => 1,
    zadd: async (k, { score, member }) => { const z = zsets.get(k) || new Map(); z.set(member, score); zsets.set(k, z); return 1; },
    zscore: async (k, m) => { const z = zsets.get(k); return z && z.has(m) ? z.get(m) : null; },
    zrange: async (k, min, max, o) => {
        assert(o && o.byScore, 'zrange por puntaje');
        const z = zsets.get(k) || new Map();
        const tope = max === '+inf' ? Infinity : max;
        return [...z.entries()].filter(([, s]) => s >= min && s <= tope).sort((a, b) => a[1] - b[1]).map(([m]) => m);
    },
    zrem: async (k, m) => { const z = zsets.get(k); if (z) z.delete(m); },
    zremrangebyscore: async (k, min, max) => { const z = zsets.get(k); if (z) for (const [m, s] of z) if (s >= min && s <= max) z.delete(m); },
};
const stub = 'data:text/javascript,export const kv = globalThis.__kv;';
registerHooks({ resolve: (spec, ctx, next) => (spec === '@vercel/kv' ? { url: stub, shortCircuit: true } : next(spec, ctx)) });

const root = pathToFileURL(fileURLToPath(new URL('..', import.meta.url))).href;
const { default: telefonos } = await import(root + 'api/telefonos.js');
const { verificarDispositivo } = await import(root + 'lib/auth.js');
const { limpiarSala, ubicacionValida, idTelefonoValido } = await import(root + 'lib/validar.js');

async function call({ method = 'POST', body, query, headers = {} } = {}) {
    const out = { status: 200, headers: {}, body: null };
    const res = {
        status(c) { out.status = c; return this; },
        setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
        json(o) { out.body = o; return this; },
        end() { return this; },
    };
    await telefonos({ method, body, query, headers }, res);
    return out;
}
const desde = ip => ({ 'x-forwarded-for': ip });
const SALA = 'ABC123';

assert.strictEqual(limpiarSala(' abc123 '), 'ABC123');
assert.strictEqual(limpiarSala('ab'), null);
assert.strictEqual(limpiarSala('ABC 123'), null);
assert(ubicacionValida(19.4, -99.1, 8) && !ubicacionValida(91, 0, 5) && !ubicacionValida(0, 181, 5) && !ubicacionValida(0, 0, -1) && !ubicacionValida(NaN, 0, 5));
assert(idTelefonoValido('0123456789ab') && !idTelefonoValido('xyz'));

const unir = async (nombre, ip = '9.9.9.9', sala = SALA) => (await call({ body: { accion: 'unirse', sala, nombre }, headers: desde(ip) })).body;
const ubic = (t, extra = {}) => call({ body: Object.assign({ accion: 'ubicacion', sala: SALA, id: t.id, token: t.token, nombre: t.nombre || 'Ana', lat: 19.4326, lon: -99.1332, p: 6 }, extra) });

// 1) unirse
let r = await call({ body: { accion: 'unirse', sala: 'x', nombre: 'Ana' } });
assert.strictEqual(r.status, 400, 'sala inválida');
r = await call({ body: { accion: 'unirse', sala: SALA, nombre: '' } });
assert.strictEqual(r.status, 400, 'nombre vacío');
r = await call({ body: { accion: 'unirse', sala: SALA, nombre: 'x'.repeat(21) } });
assert.strictEqual(r.status, 400, 'nombre muy largo');
const ana = await unir('Ana');
assert(idTelefonoValido(ana.id) && ana.token.length === 32, 'id y token');
assert(verificarDispositivo(SALA, ana.id, ana.token) && !verificarDispositivo('OTRA99', ana.id, ana.token) && !verificarDispositivo(SALA, ana.id, 'malo'), 'el token es de esa sala y ese id');
ana.nombre = 'Ana';
assert.strictEqual([...store.keys()].filter(k => k.startsWith('tel:')).length, 0, 'unirse no guarda ubicación');

// 2) ubicación: token malo, otra sala, valores inválidos
r = await call({ body: { accion: 'ubicacion', sala: SALA, id: ana.id, token: 'x'.repeat(32), nombre: 'Ana', lat: 1, lon: 1, p: 5 }, headers: desde('7.7.7.7') });
assert.strictEqual(r.status, 401, 'token malo');
r = await call({ body: { accion: 'ubicacion', sala: 'OTRA99', id: ana.id, token: ana.token, nombre: 'Ana', lat: 1, lon: 1, p: 5 } });
assert.strictEqual(r.status, 401, 'token de otra sala');
r = await ubic(ana, { lat: 95 });
assert.strictEqual(r.status, 400, 'latitud inválida');
r = await ubic(ana, { nombre: '' });
assert.strictEqual(r.status, 400, 'sin nombre');
r = await ubic(ana);
assert.strictEqual(r.status, 200);
assert.strictEqual(r.body.buscado, null);
assert.deepStrictEqual([...store.keys()].filter(k => k.startsWith('tel:')), ['tel:ABC123:' + ana.id], 'un solo punto por teléfono, sin historial');
assert.strictEqual(vence.get('tel:ABC123:' + ana.id) - ahora, 180000, 'vence a los 3 min');

// 3) listar: quien no comparte no ve a nadie; quien comparte ve a los demás
const beto = await unir('Beto');
beto.nombre = 'Beto';
let l = await call({ method: 'GET', query: { sala: SALA, id: beto.id, token: beto.token } });
assert.deepStrictEqual(l.body, { ok: true, compartiendo: false, telefonos: [] }, 'sin compartir no se ve a nadie');
await ubic(beto, { lat: 19.4330, lon: -99.1330 });
l = await call({ method: 'GET', query: { sala: SALA, id: beto.id, token: beto.token } });
assert.strictEqual(l.body.compartiendo, true);
assert.deepStrictEqual(l.body.telefonos.map(t => t.n).sort(), ['Ana', 'Beto']);
assert(l.body.telefonos.every(t => Number.isFinite(t.lat) && Number.isFinite(t.t) && t.id));
l = await call({ method: 'GET', query: { sala: SALA, id: beto.id, token: 'x'.repeat(32) }, headers: desde('6.6.6.6') });
assert.strictEqual(l.status, 401, 'listar pide token');
const otra = await unir('Cris', '9.9.9.9', 'ZZZ999');
await ubic({ id: otra.id, token: otra.token, nombre: 'Cris' }, { sala: 'ZZZ999' });
l = await call({ method: 'GET', query: { sala: SALA, id: beto.id, token: beto.token } });
assert(!l.body.telefonos.some(t => t.n === 'Cris'), 'las salas no se mezclan');

// 4) buscar: el buscado se entera en su siguiente envío
r = await call({ body: { accion: 'buscar', sala: SALA, id: beto.id, token: beto.token, objetivo: ana.id } });
assert.strictEqual(r.status, 200);
r = await ubic(ana);
assert.strictEqual(r.body.buscado, 'Beto', 'Ana ve que Beto la busca');
r = await call({ body: { accion: 'buscar', sala: SALA, id: beto.id, token: beto.token, objetivo: '0000000000ff' } });
assert.strictEqual(r.status, 404, 'solo se busca a quien comparte');
ahora += 121000;
r = await ubic(ana);
assert.strictEqual(r.body.buscado, null, 'el aviso de búsqueda vence a los 2 min');

// 5) vencimiento: sin enviar por 3 min desaparece
ahora += 61000;
l = await call({ method: 'GET', query: { sala: SALA, id: ana.id, token: ana.token } });
assert.deepStrictEqual(l.body.telefonos.map(t => t.n), ['Ana'], 'Beto ya venció');
assert(!vivo('tel:ABC123:' + beto.id), 'su punto se borró solo');

// 6) salir borra ya (POST y DELETE)
r = await call({ body: { accion: 'salir', sala: SALA, id: ana.id, token: ana.token } });
assert.strictEqual(r.status, 200);
assert(!store.has('tel:ABC123:' + ana.id), 'salir borra el punto');
assert.strictEqual(await globalThis.__kv.zscore('telidx:ABC123', ana.id), null, 'y su lugar en el índice');
await ubic(beto);
r = await call({ method: 'DELETE', query: { sala: SALA, id: beto.id, token: beto.token } });
assert.strictEqual(r.status, 200);
assert(!store.has('tel:ABC123:' + beto.id));

// 7) sala llena (20) y límite de uniones por IP
const llenos = [];
for (let i = 0; i < 20; i++) {
    const t = await unir('P' + i, '5.5.5.' + i);
    t.nombre = 'P' + i;
    assert.strictEqual((await ubic(t)).status, 200, 'cabe el ' + i);
    llenos.push(t);
}
const extra = await unir('Extra', '4.4.4.4');
extra.nombre = 'Extra';
assert.strictEqual((await ubic(extra)).status, 429, 'sala llena');
assert.strictEqual((await ubic(llenos[0])).status, 200, 'los que ya están siguen actualizando');
for (let i = 0; i < 20; i++) await unir('Spam', '3.3.3.3');
r = await call({ body: { accion: 'unirse', sala: SALA, nombre: 'Spam' }, headers: desde('3.3.3.3') });
assert.strictEqual(r.status, 429, 'demasiados intentos de unirse desde una IP');

// 8) dueño y expulsión
const SALA2 = 'ZED789';
const unirSala = async (nombre, crear, ip) => (await call({ body: { accion: 'unirse', sala: SALA2, nombre, crear }, headers: desde(ip) })).body;
const ubic2 = t => call({ body: { accion: 'ubicacion', sala: SALA2, id: t.id, token: t.token, nombre: t.nombre, lat: 19.4326, lon: -99.1332, p: 6 } });
const lista2 = t => call({ method: 'GET', query: { sala: SALA2, id: t.id, token: t.token } });
const jefe = await unirSala('Jefe', true, '21.0.0.1'); jefe.nombre = 'Jefe';
const visita = await unirSala('Visita', false, '21.0.0.2'); visita.nombre = 'Visita';
const intruso = await unirSala('Intruso', true, '21.0.0.3'); intruso.nombre = 'Intruso';
await ubic2(jefe); await ubic2(visita); await ubic2(intruso);
assert.strictEqual((await lista2(jefe)).body.dueno, true, 'quien crea la sala es el dueño');
assert.strictEqual((await lista2(visita)).body.dueno, false, 'los demás no');
assert.strictEqual((await lista2(intruso)).body.dueno, false, 'crear:true en una sala con dueño no le quita el dueño');
const expulsar = (quien, objetivo) => call({ body: { accion: 'expulsar', sala: SALA2, id: quien.id, token: quien.token, objetivo: objetivo.id } });
assert.strictEqual((await expulsar(visita, jefe)).status, 403, 'solo el dueño expulsa');
assert.strictEqual((await expulsar(jefe, jefe)).status, 400, 'el dueño no se expulsa a sí mismo');
assert.strictEqual((await expulsar(jefe, visita)).status, 200, 'el dueño expulsa');
assert.strictEqual((await lista2(jefe)).body.telefonos.some(x => x.id === visita.id), false, 'el expulsado desaparece de la sala');
r = await ubic2(visita);
assert.strictEqual(r.status, 403, 'el expulsado no puede seguir');
assert(r.body.expulsado && /10 minutos/.test(r.body.error), 'avisa que fueron 10 minutos');
r = await call({ body: { accion: 'unirse', sala: SALA2, nombre: 'visita' }, headers: desde('21.0.0.9') });
assert.strictEqual(r.status, 403, 'tampoco con otro registro y el mismo nombre');
r = await call({ body: { accion: 'unirse', sala: SALA2, nombre: 'Otra' }, headers: desde('21.0.0.2') });
assert.strictEqual(r.status, 200, 'otro nombre desde su mismo internet sí pasa');
ahora += 601_000;
r = await call({ body: { accion: 'unirse', sala: SALA2, nombre: 'Visita' }, headers: desde('21.0.0.9') });
assert.strictEqual(r.status, 200, 'pasados 10 minutos puede volver');

// 9) CORS de la app y métodos
r = await call({ method: 'OPTIONS', headers: { origin: 'https://localhost' } });
assert.strictEqual(r.status, 204);
assert.strictEqual(r.headers['access-control-allow-origin'], 'https://localhost');
r = await call({ method: 'POST', body: { accion: 'unirse', sala: SALA, nombre: 'Ana' }, headers: { origin: 'https://localhost', ...desde('8.8.8.8') } });
assert.strictEqual(r.headers['access-control-allow-origin'], 'https://localhost');
assert.strictEqual(r.headers['cache-control'], 'no-store', 'nada de caché con ubicaciones');
r = await call({ method: 'PUT', body: {} });
assert.strictEqual(r.status, 405);
r = await call({ body: { accion: 'inventada', sala: SALA, id: ana.id, token: ana.token } });
assert.strictEqual(r.status, 400);

console.log('api-telefonos.test.mjs: todo bien');
