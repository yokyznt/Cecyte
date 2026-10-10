// node test/api.test.mjs  -> prueba api/bell.js y api/firmware.js con un KV falso en memoria
import assert from 'node:assert';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.AUTH_SECRET = 'secreto-de-prueba-0123456789';
process.env.BELL_DEVICE_KEY = 'llave-de-prueba';

// KV falso (solo lo que usan las APIs)
const store = new Map();
globalThis.__kv = {
    get: async k => (store.has(k) ? structuredClone(store.get(k)) : null),
    set: async (k, v) => { store.set(k, structuredClone(v)); return 'OK'; },
    del: async k => { store.delete(k); },
    mget: async (...ks) => ks.map(k => (store.has(k) ? structuredClone(store.get(k)) : null)),
    zadd: async (k, ...items) => {
        const z = store.get(k) || new Map();
        items.forEach(i => z.set(i.member, i.score));
        store.set(k, z);
    },
    zrange: async (k, a, b, o) => {
        const z = [...(store.get(k) || new Map())].sort((x, y) => x[1] - y[1]).map(x => x[0]);
        if (o && o.rev) z.reverse();
        return z.slice(a, b + 1);
    },
    zremrangebyrank: async (k, a, b) => {
        const z = store.get(k);
        if (!z) return;
        const sorted = [...z].sort((x, y) => x[1] - y[1]);
        const n = sorted.length;
        const from = a < 0 ? n + a : a, to = b < 0 ? n + b : b;
        sorted.slice(from, to + 1).forEach(([m]) => z.delete(m));
    }
};
const stub = 'data:text/javascript,export const kv = globalThis.__kv;';
registerHooks({ resolve: (spec, ctx, next) => (spec === '@vercel/kv' ? { url: stub, shortCircuit: true } : next(spec, ctx)) });

const root = pathToFileURL(fileURLToPath(new URL('..', import.meta.url))).href;
const { default: bell } = await import(root + 'api/bell.js');
const { default: firmware } = await import(root + 'api/firmware.js');
const { signToken } = await import(root + 'lib/auth.js');

const adminCookie = { cookie: `admin_token=${signToken()}` };
async function call(handler, { method = 'GET', query = {}, body, headers = {} } = {}) {
    const out = { status: 200, headers: {}, body: null };
    const res = {
        status(c) { out.status = c; return this; },
        setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
        json(o) { out.body = o; return this; },
        send(b) { out.body = b; return this; }
    };
    await handler({ method, query, body, headers }, res);
    return out;
}
const save = (extra = {}) => call(bell, {
    method: 'POST', headers: adminCookie,
    body: { action: 'save', times: ['07:00', '09:15'], days: [1, 2, 3, 4, 5], rhythm: [200, 100, 200], ...extra }
});

// 1) sin llave ni sesión -> 401
assert.strictEqual((await call(bell)).status, 401);
assert.strictEqual((await call(bell, { query: { key: 'mala' } })).status, 401);

// 2) el ESP32 recibe 9 líneas; con la config de fábrica el ritmo normal está en la línea 5
let r = await call(bell, { query: { key: 'llave-de-prueba' } });
let lines = r.body.split('\n');
assert.strictEqual(lines.length, 9);
assert.strictEqual(lines[2], '12345');
assert.strictEqual(lines[4], '220,160,200,190,200,210,140,100,140,230,100,80,130,250,160,210,200');

// 3) guardar con ritmo por hora, días sin timbre y horario especial
r = await save({
    rhythms: { '09:15': [300, 200, 300], '23:59': [100] },       // 23:59 no está en las horas: se descarta
    offDates: ['2026-12-25', '2026-12-24', '2026-12-25'],
    specials: { '2026-10-20': ['10:00', '07:00'] }
});
assert.strictEqual(r.status, 200, JSON.stringify(r.body));
r = await call(bell, { query: { key: 'llave-de-prueba' } });
lines = r.body.split('\n');
assert.strictEqual(lines[3], '07:00,09:15');
assert.strictEqual(lines[4], '200,100,200');
assert.strictEqual(lines[5], '09:15=300,200,300');
assert.strictEqual(lines[6], '20261224,20261225');
assert.strictEqual(lines[7], '20261020=07:00,10:00');

// 4) validaciones: ritmo par, paso fuera de rango, fecha imposible, demasiados toques por hora
assert.strictEqual((await save({ rhythm: [200, 100] })).status, 400);
assert.strictEqual((await save({ rhythm: [10] })).status, 400);
assert.strictEqual((await save({ offDates: ['2026-02-31'] })).status, 400);
assert.strictEqual((await save({ rhythms: { '09:15': new Array(41).fill(100) } })).status, 400);
assert.strictEqual((await save({ specials: { '2026-10-20': ['25:00'] } })).status, 400);
assert.strictEqual((await call(bell, { method: 'POST', body: { action: 'save' } })).status, 401);

// 5) latido del ESP32 + historial de toques (sin duplicar) + lo que ve el admin
await call(bell, { query: { key: 'llave-de-prueba', s: '1', v: '3', rs: '-61', t: String(Math.floor(Date.now() / 1000) - 20), ev: '1760000000:P,1760000300:M' } });
await call(bell, { query: { key: 'llave-de-prueba', ev: '1760000000:P,basura,1760000600:P' } });
r = await call(bell, { headers: adminCookie });
assert.strictEqual(r.body.espFw, 3);
assert.strictEqual(r.body.espRssi, -61);
assert(Math.abs(r.body.espClockDiffMs + 20000) < 2000, 'desfase de reloj ' + r.body.espClockDiffMs);
assert.deepStrictEqual(r.body.log, ['1760000600:P', '1760000300:M', '1760000000:P']);
assert.deepStrictEqual(r.body.rhythms, { '09:15': [300, 200, 300] });

// 6) firmware: trozos -> publicar -> el ESP32 lo baja idéntico, con md5
const bin = Buffer.alloc(150_000, 7); bin[0] = 0xe9;
const parts = [bin.subarray(0, 90_000), bin.subarray(90_000)];
const up = (a, extra) => call(firmware, { method: 'POST', headers: adminCookie, body: { uploadId: 'abc123xyz', total: 2, ...extra, action: a } });
assert.strictEqual((await up('chunk', { index: 0, data: parts[0].toString('base64') })).status, 200);
assert.strictEqual((await up('commit', { version: 2 })).status, 400, 'faltaba un trozo');
assert.strictEqual((await up('chunk', { index: 1, data: parts[1].toString('base64') })).status, 200);
assert.strictEqual((await up('commit', { version: 0 })).status, 400);
assert.strictEqual((await up('commit', { version: 2 })).status, 200);
r = await call(bell, { query: { key: 'llave-de-prueba' } });
assert.match(r.body.split('\n')[8], /^2\|[0-9a-f]{32}\|150000$/);
assert.strictEqual((await call(firmware, { query: { key: 'mala' } })).status, 401);
r = await call(firmware, { query: { key: 'llave-de-prueba' } });
assert.strictEqual(r.status, 200);
assert(Buffer.compare(r.body, bin) === 0);
assert.strictEqual(r.headers['x-md5'], crypto.createHash('md5').update(bin).digest('hex'));

// 7) un archivo que no es firmware de ESP32 (no empieza con 0xE9) se rechaza
const malo = Buffer.alloc(150_000, 1);
await call(firmware, { method: 'POST', headers: adminCookie, body: { action: 'chunk', uploadId: 'malo123456', index: 0, total: 1, data: malo.toString('base64') } });
r = await call(firmware, { method: 'POST', headers: adminCookie, body: { action: 'commit', uploadId: 'malo123456', total: 1, version: 3 } });
assert.strictEqual(r.status, 400);

console.log('api.test.mjs OK');
