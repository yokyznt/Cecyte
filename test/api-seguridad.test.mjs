// node test/api-seguridad.test.mjs -> login con límite de intentos, validación de horario y grupos,
// suscripciones push y tokens de sesión, con un KV falso en memoria.
import assert from 'node:assert';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.AUTH_SECRET = 'secreto-de-prueba-0123456789';
process.env.ADMIN_PASSWORD = 'clave-correcta';

const store = new Map();
globalThis.__kv = {
    get: async k => (store.has(k) ? structuredClone(store.get(k)) : null),
    set: async (k, v) => { store.set(k, structuredClone(v)); return 'OK'; },
    mset: async o => { Object.entries(o).forEach(([k, v]) => store.set(k, structuredClone(v))); return 'OK'; },
    del: async k => { store.delete(k); },
    incr: async k => { const n = (Number(store.get(k)) || 0) + 1; store.set(k, n); return n; },
    expire: async () => 1,
};
const stub = 'data:text/javascript,export const kv = globalThis.__kv;';
registerHooks({ resolve: (spec, ctx, next) => (spec === '@vercel/kv' ? { url: stub, shortCircuit: true } : next(spec, ctx)) });

const root = pathToFileURL(fileURLToPath(new URL('..', import.meta.url))).href;
const { default: login } = await import(root + 'api/login.js');
const { default: schedule } = await import(root + 'api/schedule.js');
const { default: groups } = await import(root + 'api/groups.js');
const { default: subscribe } = await import(root + 'api/push/subscribe.js');
const { signToken, verifyToken } = await import(root + 'lib/auth.js');
const { default: session } = await import(root + 'api/session.js');
const { limpiarHorario } = await import(root + 'lib/validar.js');

async function call(handler, { method = 'GET', body, headers = {} } = {}) {
    const out = { status: 200, headers: {}, body: null };
    const res = {
        status(c) { out.status = c; return this; },
        setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
        json(o) { out.body = o; return this; },
        end() { return this; },
    };
    await handler({ method, body, headers }, res);
    return out;
}
const admin = { cookie: `admin_token=${signToken()}` };
const desde = ip => ({ 'x-forwarded-for': ip });

// 1) login: 5 fallos y luego bloqueo por IP; otra IP no se ve afectada; acertar limpia el contador
for (let i = 0; i < 5; i++) {
    const r = await call(login, { method: 'POST', body: { password: 'mala' }, headers: desde('1.1.1.1') });
    assert.strictEqual(r.status, 401, 'intento ' + i);
}
let r = await call(login, { method: 'POST', body: { password: 'clave-correcta' }, headers: desde('1.1.1.1') });
assert.strictEqual(r.status, 429, 'bloqueada aunque la clave sea buena');
assert(r.headers['retry-after']);
r = await call(login, { method: 'POST', body: { password: 'clave-correcta' }, headers: desde('2.2.2.2') });
assert.strictEqual(r.status, 200);
assert(/admin_token=/.test(r.headers['set-cookie']));
await call(login, { method: 'POST', body: { password: 'mala' }, headers: desde('3.3.3.3') });
await call(login, { method: 'POST', body: { password: 'clave-correcta' }, headers: desde('3.3.3.3') });
assert.strictEqual(store.has('login_fallos:3.3.3.3'), false, 'acertar borra los fallos');
assert.strictEqual((await call(login, { method: 'POST', body: { password: { $ne: 1 } }, headers: desde('4.4.4.4') })).status, 401, 'la clave tiene que ser texto');
assert.strictEqual((await call(login, { method: 'GET' })).status, 405);

// 2) horario: forma estricta, solo los campos conocidos, topes
const materia = (extra = {}) => ({ id: 1, group: '501 Programación', day: 'Lunes', time: '07:00 - 08:00', subject: 'Cálculo', teacher: 'Ing. Gómez', ...extra });
assert.strictEqual((await call(schedule, { method: 'POST', body: [materia()] })).status, 401, 'sin sesión');
for (const [mal, texto] of [
    [{ day: 'Sábado' }, 'día'], [{ time: 'ocho' }, 'hora'], [{ subject: '' }, 'materia vacía'], [{ group: 'x'.repeat(61) }, 'grupo largo'],
    [{ subject: 'a\u0000b' }, 'caracter de control'], [{ id: 'abc' }, 'id'], [{ teacher: 'x'.repeat(121) }, 'docente largo'],
]) {
    r = await call(schedule, { method: 'POST', headers: admin, body: [materia(mal)] });
    assert.strictEqual(r.status, 400, texto + ' → ' + JSON.stringify(r.body));
}
assert.strictEqual((await call(schedule, { method: 'POST', headers: admin, body: { a: 1 } })).status, 400, 'no es arreglo');
assert.strictEqual((await call(schedule, { method: 'POST', headers: admin, body: [1] })).status, 400, 'elemento no objeto');
assert.strictEqual((await call(schedule, { method: 'POST', headers: admin, body: Array.from({ length: 1501 }, () => materia()) })).status, 400, 'demasiadas');
r = await call(schedule, { method: 'POST', headers: admin, body: [materia({ id: '7', extra: 'x'.repeat(5000), teacher: undefined })] });
assert.strictEqual(r.status, 200, JSON.stringify(r.body));
r = await call(schedule);
assert.deepStrictEqual(r.body, [{ id: 7, group: '501 Programación', day: 'Lunes', time: '07:00 - 08:00', subject: 'Cálculo', teacher: '' }], 'solo campos conocidos');
assert.strictEqual(limpiarHorario([]).ok, true, 'un horario vacío es válido (se puede vaciar)');

// 3) grupos: nombre válido, tope y borrado atómico con sus materias
assert.strictEqual((await call(groups, { method: 'POST', headers: admin, body: { name: '  ' } })).status, 400);
assert.strictEqual((await call(groups, { method: 'POST', headers: admin, body: { name: 'x'.repeat(61) } })).status, 400);
assert.strictEqual((await call(groups, { method: 'POST', headers: admin, body: { name: 'a\nb' } })).status, 400);
r = await call(groups, { method: 'POST', headers: admin, body: { name: ' 502 Contabilidad ' } });
assert.deepStrictEqual(r.body.groups, ['501 Programación', '502 Contabilidad'], 'se recorta');
assert.strictEqual((await call(groups, { method: 'POST', headers: admin, body: { name: '502 Contabilidad' } })).status, 400, 'duplicado');
await call(schedule, { method: 'POST', headers: admin, body: [materia({ id: 1 }), materia({ id: 2, group: '502 Contabilidad' })] });
r = await call(groups, { method: 'DELETE', headers: admin, body: { name: '502 Contabilidad' } });
assert.deepStrictEqual(r.body.groups, ['501 Programación']);
assert.deepStrictEqual(r.body.schedule.map(m => m.id), [1], 'se van sus materias');
assert.deepStrictEqual(store.get('cecyte_schedule').map(m => m.id), [1]);
assert.strictEqual((await call(groups, { method: 'DELETE', headers: admin, body: { name: { x: 1 } } })).status, 400);
for (let i = 0; i < 39; i++) await call(groups, { method: 'POST', headers: admin, body: { name: 'G' + i } });
assert.strictEqual((await call(groups, { method: 'POST', headers: admin, body: { name: 'uno-mas' } })).status, 400, 'tope de grupos');

// 4) push: solo grupos que existen, suscripción real y tope
const sub = (n = 1) => ({ endpoint: 'https://push.ejemplo.test/' + n, keys: { p256dh: 'BPclave', auth: 'auth' }, expirationTime: null });
assert.strictEqual((await call(subscribe, { method: 'POST', body: { group: 'grupo-que-no-existe', subscription: sub() } })).status, 400);
assert.strictEqual((await call(subscribe, { method: 'POST', body: { group: '501 Programación', subscription: { endpoint: 'http://x', keys: {} } } })).status, 400);
assert.strictEqual((await call(subscribe, { method: 'POST', body: { group: '501 Programación', subscription: { endpoint: 'https://x/1' } } })).status, 400, 'sin llaves');
r = await call(subscribe, { method: 'POST', body: { group: '501 Programación', subscription: sub(1) } });
assert.strictEqual(r.status, 200);
assert.deepStrictEqual(store.get('push_subs:501 Programación'), [{ endpoint: 'https://push.ejemplo.test/1', keys: { p256dh: 'BPclave', auth: 'auth' } }], 'solo endpoint y llaves');
await call(subscribe, { method: 'POST', body: { group: '501 Programación', subscription: sub(1) } });
assert.strictEqual(store.get('push_subs:501 Programación').length, 1, 'no se duplica');
store.set('push_subs:501 Programación', Array.from({ length: 500 }, (_, i) => sub(i + 100)));
assert.strictEqual((await call(subscribe, { method: 'POST', body: { group: '501 Programación', subscription: sub(999) } })).status, 429, 'tope por grupo');

// 5) token de sesión: alterado o vencido no sirve
const t = signToken();
assert.strictEqual(verifyToken(t), true);
assert.strictEqual(verifyToken(t.slice(0, -1) + (t.endsWith('0') ? '1' : '0')), false, 'firma alterada');
const viejo = String(Date.now() - 13 * 3600 * 1000);
const firma = crypto.createHmac('sha256', process.env.AUTH_SECRET).update(viejo).digest('hex');
assert.strictEqual(verifyToken(`${viejo}.${firma}`), false, 'vencido (más de 12 h)');
assert.strictEqual(verifyToken(''), false);

// 6) app de Android: CORS solo para su origen y sesión por token Bearer (la cookie sigue sirviendo en la web)
const APP = 'https://localhost';
r = await call(schedule, { headers: { origin: APP } });
assert.strictEqual(r.headers['access-control-allow-origin'], APP, 'el origen de la app recibe CORS');
assert(!r.headers['access-control-allow-credentials'], 'sin credenciales abiertas');
r = await call(schedule, { headers: { origin: 'https://sitio-ajeno.example' } });
assert.strictEqual(r.headers['access-control-allow-origin'], undefined, 'un origen ajeno no recibe CORS');
r = await call(schedule, { method: 'GET', headers: {} });
assert.strictEqual(r.headers['access-control-allow-origin'], undefined, 'mismo origen: sin cabeceras CORS');
r = await call(schedule, { method: 'OPTIONS', headers: { origin: APP } });
assert.strictEqual(r.status, 204, 'preflight de la app');
assert(/Authorization/.test(r.headers['access-control-allow-headers']));
r = await call(schedule, { method: 'OPTIONS', headers: { origin: 'https://sitio-ajeno.example' } });
assert.strictEqual(r.status, 403, 'preflight de un origen ajeno');

const bearer = { authorization: 'Bearer ' + signToken(), origin: APP };
assert.strictEqual((await call(session, { headers: bearer })).body.loggedIn, true, 'Bearer válido abre sesión');
assert.strictEqual((await call(session, { headers: { authorization: 'Bearer ' + signToken() + 'x', origin: APP } })).body.loggedIn, false, 'Bearer alterado');
assert.strictEqual((await call(session, { headers: { authorization: 'Bearer', origin: APP } })).body.loggedIn, false, 'Bearer vacío');
r = await call(schedule, { method: 'POST', headers: bearer, body: [materia({ id: 9 })] });
assert.strictEqual(r.status, 200, 'Bearer puede guardar horario');

// el token solo viaja en el cuerpo si la petición viene de la app; en la web queda en la cookie HttpOnly
r = await call(login, { method: 'POST', body: { password: 'clave-correcta' }, headers: { ...desde('5.5.5.5'), origin: APP } });
assert.strictEqual(r.status, 200);
assert.strictEqual(verifyToken(r.body.token), true, 'la app recibe el token');
r = await call(login, { method: 'POST', body: { password: 'clave-correcta' }, headers: { ...desde('6.6.6.6'), origin: 'https://cecyteo.vercel.app' } });
assert.strictEqual(r.body.token, undefined, 'la web no recibe el token en el cuerpo');
assert(/admin_token=/.test(r.headers['set-cookie']));

console.log('api-seguridad.test.mjs: todo bien');
