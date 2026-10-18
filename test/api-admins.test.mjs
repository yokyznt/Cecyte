// node test/api-admins.test.mjs -> varios admins con contraseña propia y permisos por función; solo el maestro los gestiona.
import assert from 'node:assert';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.AUTH_SECRET = 'secreto-de-prueba-0123456789';
process.env.ADMIN_PASSWORD = 'maestra-prueba';

let ahora = 1_800_000_000_000;
Date.now = () => ahora;

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
const { default: session } = await import(root + 'api/session.js');
const { default: admins } = await import(root + 'api/admins.js');
const { default: groups } = await import(root + 'api/groups.js');
const { default: changes } = await import(root + 'api/changes.js');
const { signToken, leerToken } = await import(root + 'lib/auth.js');
const { PERMISOS, limpiarPermisos, nuevaClave, claveCoincide } = await import(root + 'lib/admins.js');

async function call(handler, { method = 'GET', body, query, headers = {} } = {}) {
    const out = { status: 200, headers: {}, body: null };
    const res = {
        status(c) { out.status = c; return this; },
        setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
        json(o) { out.body = o; return this; },
        end() { return this; },
    };
    await handler({ method, body, query, headers }, res);
    return out;
}
const ip = n => ({ 'x-forwarded-for': '10.0.0.' + n });
const entrar = (clave, n = 1) => call(login, { method: 'POST', body: { password: clave }, headers: { origin: 'https://localhost', ...ip(n) } });
const con = token => ({ authorization: 'Bearer ' + token });

// catálogo y utilidades
assert(PERMISOS.length === 14 && new Set(PERMISOS.map(p => p.id)).size === 14, 'catálogo de permisos');
assert.deepStrictEqual(limpiarPermisos(['grupos', 'inventado', 'horarios', 'grupos']), ['horarios', 'grupos'], 'solo permisos reales, en orden y sin repetir');
const k = nuevaClave('hola1234');
assert(claveCoincide('hola1234', k) && !claveCoincide('hola12345', k) && !JSON.stringify(k).includes('hola1234'), 'la contraseña se guarda cifrada');

// tokens: de quién son y que no se puedan falsificar
assert.strictEqual(leerToken(signToken()).id, 'master');
const tA = signToken('abcdef012345');
assert.strictEqual(leerToken(tA).id, 'abcdef012345');
assert.strictEqual(leerToken(tA.replace('abcdef012345', '000000000000')), null, 'cambiar el dueño del token lo invalida');
const viejo = `${ahora}.${crypto.createHmac('sha256', process.env.AUTH_SECRET).update(String(ahora)).digest('hex')}`;
assert.strictEqual(leerToken(viejo).id, 'master', 'los tokens anteriores a los admins siguen siendo del maestro');

// 1) maestro: entra y ve que puede gestionar admins
let r = await entrar('maestra-prueba');
assert.strictEqual(r.status, 200);
const master = r.body.token;
r = await call(session, { headers: con(master) });
assert.strictEqual(r.body.loggedIn, true);
assert.strictEqual(r.body.rol, 'master');
assert(r.body.permisos.includes('admins') && PERMISOS.every(p => r.body.permisos.includes(p.id)), 'el maestro lo puede todo');
r = await call(session, {});
assert.deepStrictEqual(r.body, { loggedIn: false });

// 2) sin sesión o sin ser maestro no se gestionan admins
assert.strictEqual((await call(admins, {})).status, 401);
assert.strictEqual((await call(admins, { method: 'POST', body: { nombre: 'X', clave: 'abcdef', permisos: ['grupos'] } })).status, 401);

// 3) crear admins
const crear = (body, token = master) => call(admins, { method: 'POST', body, headers: con(token) });
r = await crear({ nombre: 'Ana', clave: 'ana-clave-1', permisos: ['grupos', 'horarios'] });
assert.strictEqual(r.status, 201);
const ana = r.body.admin;
assert(/^[0-9a-f]{12}$/.test(ana.id) && !('hash' in ana) && !('sal' in ana), 'no se devuelve la contraseña cifrada');
const guardados = store.get('cecyte_admins');
assert(guardados.length === 1 && guardados[0].hash && guardados[0].sal && !JSON.stringify(guardados).includes('ana-clave-1'), 'se guarda cifrada');
assert.strictEqual((await crear({ nombre: 'ana', clave: 'otra-clave-1', permisos: ['grupos'] })).status, 400, 'nombre repetido (sin importar mayúsculas)');
assert.strictEqual((await crear({ nombre: 'Beto', clave: 'ana-clave-1', permisos: ['grupos'] })).status, 400, 'contraseña repetida');
assert.strictEqual((await crear({ nombre: 'Beto', clave: 'maestra-prueba', permisos: ['grupos'] })).status, 400, 'no puede usar la del maestro');
assert.strictEqual((await crear({ nombre: 'Beto', clave: '123', permisos: ['grupos'] })).status, 400, 'contraseña muy corta');
assert.strictEqual((await crear({ nombre: 'Beto', clave: 'beto-clave-1', permisos: [] })).status, 400, 'al menos un permiso');
assert.strictEqual((await crear({ nombre: 'Beto', clave: 'beto-clave-1', permisos: ['inventado'] })).status, 400, 'solo permisos reales');
assert.strictEqual((await crear({ nombre: '', clave: 'beto-clave-1', permisos: ['grupos'] })).status, 400, 'nombre vacío');
r = await crear({ nombre: 'Beto', clave: 'beto-clave-1', permisos: ['alertas', 'timbre', 'robot-luces', 'inventado'] });
assert.strictEqual(r.status, 201);
assert.deepStrictEqual(r.body.admin.permisos, ['alertas', 'timbre', 'robot-luces']);
const beto = r.body.admin;
r = await call(admins, { headers: con(master) });
assert.deepStrictEqual(r.body.admins.map(a => a.nombre), ['Ana', 'Beto']);
assert(r.body.permisos.length === 14 && r.body.grupos.length === 3 && r.body.max === 20 && !JSON.stringify(r.body).includes('"hash"'));

// 4) cada admin entra con su contraseña y solo puede lo suyo
r = await entrar('ana-clave-1', 2);
assert.strictEqual(r.status, 200);
const tAna = r.body.token;
r = await call(session, { headers: con(tAna) });
assert.deepStrictEqual({ rol: r.body.rol, nombre: r.body.nombre, permisos: r.body.permisos }, { rol: 'admin', nombre: 'Ana', permisos: ['horarios', 'grupos'] });
assert.strictEqual((await call(admins, { headers: con(tAna) })).status, 403, 'un admin no gestiona admins');
assert.strictEqual((await call(admins, { method: 'POST', headers: con(tAna), body: { nombre: 'Z', clave: 'zzzzzzz', permisos: ['grupos'] } })).status, 403);
r = await call(groups, { method: 'POST', headers: con(tAna), body: { name: '502 Contabilidad' } });
assert.strictEqual(r.status, 200, 'Ana tiene permiso de grupos');
r = await entrar('beto-clave-1', 3);
const tBeto = r.body.token;
r = await call(groups, { method: 'POST', headers: con(tBeto), body: { name: '503 Logística' } });
assert.strictEqual(r.status, 403, 'Beto no tiene permiso de grupos');
assert(/permiso/.test(r.body.error));
r = await call(changes, { method: 'POST', headers: con(tBeto), body: { accion: 'agregar', date: '2099-01-01', group: '501 Programación', type: 'cancelada', texto: 'x' } });
assert(r.status !== 403 && r.status !== 401, 'Beto sí tiene permiso de alertas (otro error es válido)');
r = await call(groups, { method: 'POST', headers: con(master), body: { name: '504 Redes' } });
assert.strictEqual(r.status, 200, 'el maestro puede todo');
assert.strictEqual((await entrar('contraseña-mala', 4)).status, 401);

// 5) editar: permisos, nombre y contraseña
const editar = (body, token = master) => call(admins, { method: 'PUT', body, headers: con(token) });
r = await editar({ id: ana.id, permisos: ['horarios'] });
assert.strictEqual(r.status, 200);
r = await call(groups, { method: 'POST', headers: con(tAna), body: { name: '505 Química' } });
assert.strictEqual(r.status, 403, 'quitarle un permiso surte efecto de inmediato con la misma sesión');
r = await editar({ id: ana.id, nombre: 'Beto' });
assert.strictEqual(r.status, 400, 'nombre repetido al editar');
r = await editar({ id: ana.id, nombre: 'Ana María', permisos: ['horarios', 'grupos'] });
assert.strictEqual(r.body.admin.nombre, 'Ana María');
assert.strictEqual((await call(groups, { method: 'POST', headers: con(tAna), body: { name: '505 Química' } })).status, 200, 'y devolverlo también');
assert.strictEqual((await editar({ id: ana.id, clave: 'beto-clave-1' })).status, 400, 'no puede quedarse con la contraseña de otro');
assert.strictEqual((await editar({ id: ana.id, clave: 'ab' })).status, 400);
assert.strictEqual((await editar({ id: ana.id, permisos: [] })).status, 400);
assert.strictEqual((await editar({ id: 'ffffffffffff', nombre: 'Q' })).status, 404);
assert.strictEqual((await editar({ id: ana.id, nombre: 'Otra' }, tAna)).status, 403, 'un admin no se edita a sí mismo');
ahora += 5000;
r = await editar({ id: ana.id, clave: 'ana-nueva-clave' });
assert.strictEqual(r.status, 200);
r = await call(session, { headers: con(tAna) });
assert.deepStrictEqual(r.body, { loggedIn: false }, 'cambiar la contraseña cierra sus sesiones abiertas');
assert.strictEqual((await entrar('ana-clave-1', 5)).status, 401, 'la contraseña vieja ya no sirve');
assert.strictEqual((await entrar('ana-nueva-clave', 6)).status, 200, 'la nueva sí');
r = await editar({ id: ana.id, nombre: 'Ana María' });
assert.strictEqual(r.status, 200, 'sin mandar contraseña, no se cambia');
assert.strictEqual((await entrar('ana-nueva-clave', 7)).status, 200);

// 6) borrar: pierde el acceso de inmediato
r = await call(admins, { method: 'DELETE', query: { id: beto.id }, headers: con(master) });
assert.strictEqual(r.status, 200);
r = await call(session, { headers: con(tBeto) });
assert.deepStrictEqual(r.body, { loggedIn: false }, 'borrado = sin sesión');
assert.strictEqual((await entrar('beto-clave-1', 8)).status, 401);
assert.strictEqual((await call(admins, { method: 'DELETE', query: { id: beto.id }, headers: con(master) })).status, 404);
r = await call(admins, { headers: con(master) });
assert.deepStrictEqual(r.body.admins.map(a => a.nombre), ['Ana María']);

// 7) tope de admins
for (let i = 0; i < 19; i++) assert.strictEqual((await crear({ nombre: 'Admin ' + i, clave: 'clave-numero-' + i, permisos: ['grupos'] })).status, 201);
r = await crear({ nombre: 'Uno más', clave: 'clave-numero-x', permisos: ['grupos'] });
assert.strictEqual(r.status, 400);
assert(/20/.test(r.body.error));

console.log('api-admins.test.mjs: todo bien');
