// node test/api-cambios.test.mjs  -> prueba api/changes.js (cambios del dia) con un KV falso en memoria
import assert from 'node:assert';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.AUTH_SECRET = 'secreto-de-prueba-0123456789';

const store = new Map();
globalThis.__kv = {
    get: async k => (store.has(k) ? structuredClone(store.get(k)) : null),
    set: async (k, v) => { store.set(k, structuredClone(v)); return 'OK'; },
};
const stub = 'data:text/javascript,export const kv = globalThis.__kv;';
registerHooks({ resolve: (spec, ctx, next) => (spec === '@vercel/kv' ? { url: stub, shortCircuit: true } : next(spec, ctx)) });

const root = pathToFileURL(fileURLToPath(new URL('..', import.meta.url))).href;
const { default: changes, hoyMX } = await import(root + 'api/changes.js');
const { signToken } = await import(root + 'lib/auth.js');

const adminCookie = { cookie: `admin_token=${signToken()}` };
async function call({ method = 'GET', body, headers = {} } = {}) {
    const out = { status: 200, headers: {}, body: null };
    const res = {
        status(c) { out.status = c; return this; },
        setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
        json(o) { out.body = o; return this; },
    };
    await changes({ method, query: {}, body, headers }, res);
    return out;
}
const agregar = (extra = {}) => call({ method: 'POST', headers: adminCookie, body: { action: 'add', group: '501 Programación', time: '08:00 - 08:45', tipo: 'cancelada', ...extra } });

// 1) hoyMX es la fecha de la escuela, no la de UTC: a las 20:00 del 12-oct en México ya es 13-oct en UTC
assert.strictEqual(hoyMX(new Date('2026-10-13T02:00:00Z')), '2026-10-12');
assert.strictEqual(hoyMX(new Date('2026-10-13T07:00:00Z')), '2026-10-13');

// 2) leer es público y empieza vacío
let r = await call();
assert.strictEqual(r.status, 200);
assert.deepStrictEqual(r.body, []);
assert.strictEqual(r.headers['cache-control'], 'no-store');

// 3) escribir exige sesión de admin
assert.strictEqual((await call({ method: 'POST', body: { action: 'add' } })).status, 401);
assert.strictEqual((await call({ method: 'POST', headers: { cookie: 'admin_token=falso' }, body: { action: 'add' } })).status, 401);
assert.strictEqual((await call({ method: 'POST', headers: { authorization: 'Bearer ' + signToken() }, body: { action: 'add', group: 'A', time: '07:00 - 08:00', tipo: 'ausente' } })).status, 200, 'la app (Bearer) también puede');
store.clear();

// 4) agregar valida y limpia
assert.strictEqual((await agregar({ group: '' })).status, 400);
assert.strictEqual((await agregar({ time: 'mañana' })).status, 400);
assert.strictEqual((await agregar({ tipo: 'inventado' })).status, 400);
r = await agregar({ nota: '  Hay junta  ' + 'x'.repeat(300) });
assert.strictEqual(r.status, 200);
assert.strictEqual(r.body.changes.length, 1);
const c = r.body.changes[0];
assert.strictEqual(c.date, hoyMX());
assert(c.nota.startsWith('Hay junta') && c.nota.length === 120, 'nota recortada a 120');
assert(typeof c.id === 'string' && c.id.length > 8);

// 5) uno por clase y día: marcar de nuevo reemplaza
r = await agregar({ tipo: 'ausente', nota: 'Incapacidad' });
assert.strictEqual(r.body.changes.length, 1);
assert.strictEqual(r.body.changes[0].tipo, 'ausente');
r = await agregar({ time: '09:15 - 10:00' });
assert.strictEqual(r.body.changes.length, 2);

// 6) leer devuelve lo de hoy; lo de ayer ya venció y se poda al escribir
const ayer = '2000-01-01';
store.set('cecyte_changes', [...store.get('cecyte_changes'), { id: 'viejo', group: 'X', date: ayer, time: '07:00 - 08:00', tipo: 'cancelada', nota: '', t: 0 }]);
r = await call();
assert.strictEqual(r.body.length, 2, 'el de ayer no se devuelve');
r = await agregar({ time: '10:00 - 11:00' });
assert.strictEqual(r.body.changes.length, 3);
assert(!store.get('cecyte_changes').some(x => x.id === 'viejo'), 'se podó el vencido');

// 7) quitar
const id = r.body.changes[0].id;
r = await call({ method: 'POST', headers: adminCookie, body: { action: 'remove', id } });
assert.strictEqual(r.body.changes.length, 2);
assert.strictEqual((await call({ method: 'POST', headers: adminCookie, body: { action: 'remove' } })).status, 400);
assert.strictEqual((await call({ method: 'POST', headers: adminCookie, body: { action: 'otra' } })).status, 400);

// 8) tope de cambios por día
store.set('cecyte_changes', Array.from({ length: 100 }, (_, i) => ({ id: 'c' + i, group: 'G' + i, date: hoyMX(), time: '07:00 - 08:00', tipo: 'cancelada', nota: '', t: i })));
assert.strictEqual((await agregar({ group: 'otro' })).status, 400);

// 9) otros métodos
assert.strictEqual((await call({ method: 'DELETE', headers: adminCookie })).status, 405);

console.log('api-cambios.test.mjs OK');
