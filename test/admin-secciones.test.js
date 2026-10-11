// Orden del panel de administración: 3 apartados (Horario, Timbre, Robot) y sus secciones.
// Revisa que index.html y admin-secciones.js digan lo mismo (si uno cambia, esto avisa).
// Se corre con: node test/admin-secciones.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(raiz, 'admin-secciones.js'), 'utf8');

// APARTADOS del script
const ctx = {};
vm.runInNewContext(js.slice(js.indexOf('const APARTADOS'), js.indexOf('const ADMIN_SECCIONES')) + '\nthis.APARTADOS = APARTADOS;', ctx);
const APARTADOS = JSON.parse(JSON.stringify(ctx.APARTADOS));   // objetos de este contexto (vm da otros prototipos)

assert.deepStrictEqual(Object.keys(APARTADOS), ['horario', 'timbre', 'robot']);
assert.deepStrictEqual(APARTADOS.horario, ['horarios', 'grupos', 'alertas']);
assert.deepStrictEqual(APARTADOS.timbre, ['timbre', 'ritmo', 'esp32']);
assert(APARTADOS.robot.length >= 4, 'el robot lleva sus secciones');

const todas = Object.values(APARTADOS).flat();
const unicas = new Set(todas);
assert.strictEqual(unicas.size, todas.length, 'una sección no puede estar en dos apartados');

const sacar = re => [...html.matchAll(re)].map(m => m[1]);
const paneles = sacar(/data-section="([^"]+)"/g);
const pestanas = sacar(/data-section-tab="([^"]+)"/g);
assert.deepStrictEqual([...new Set(paneles)].sort(), [...unicas].sort(), 'cada sección tiene su panel');
assert.deepStrictEqual([...pestanas].sort(), [...unicas].sort(), 'cada sección tiene su pestaña');
assert.deepStrictEqual(sacar(/data-apartado-tab="([^"]+)"/g), Object.keys(APARTADOS));
assert.deepStrictEqual(sacar(/data-apartado-sub="([^"]+)"/g), Object.keys(APARTADOS));
assert.deepStrictEqual(sacar(/data-apartado="([^"]+)"/g), Object.keys(APARTADOS));

// cada pestaña apunta a un id que existe
const ids = sacar(/ id="([^"]+)"/g);
assert.strictEqual(new Set(ids).size, ids.length, 'ids repetidos: ' + ids.filter((x, i) => ids.indexOf(x) !== i));
for (const aria of sacar(/aria-controls="([^"]+)"/g)) assert(ids.includes(aria), 'aria-controls sin destino: ' + aria);

// el botón verde de nueva materia ya no está en la cabecera sino en la barra del horario
const cabecera = html.slice(html.indexOf('class="admin-head"'), html.indexOf('<nav class="sections"'));
assert(!cabecera.includes('Nueva Materia'), 'la cabecera no lleva el botón de nueva materia');
const toolbar = html.slice(html.indexOf('<div class="toolbar">'), html.indexOf('<table class="data">'));
assert(toolbar.includes('openAddModal()') && toolbar.includes('Nueva Materia'), 'el botón vive en la barra del horario');

// la conexión del robot (conectar, paro, "actualizar", puertos, ajustes de pilas) vive SOLO en Instalar;
// la cabecera del apartado Robot se queda con título, batería y estado
{
    const ini = html.indexOf('id="sec-robot-instalar"');
    const fin = html.indexOf('class="rb-barra"');
    assert(ini > 0 && fin > ini);
    const instalar = html.slice(ini, fin);
    for (const id of ['rb-conectar', 'rb-paro', 'rb-vivo', 'rb-todos', 'rb-bat-quim', 'rb-bat-cap', 'rb-bat-borrar', 'rb-diag']) {
        assert(instalar.includes(`id="${id}"`), `${id} debe estar en Instalar`);
        assert.strictEqual(html.split(`id="${id}"`).length - 1, 1, `${id} solo una vez`);
    }
    const cab = html.slice(html.indexOf('<section class="panel rb-conexion"'), html.indexOf('id="sec-robot-musica"'));
    for (const id of ['rb-conectar', 'rb-paro', 'rb-vivo', 'rb-todos', 'rb-msg']) assert(!cab.includes(`id="${id}"`), `${id} no va en la cabecera`);
    for (const id of ['rb-bat', 'rb-badge', 'robot-heading']) assert(cab.includes(`id="${id}"`), `${id} sí va en la cabecera`);
    // el mensaje y el avance acompañan a la barra fija, que se ve en todas las secciones del robot
    const barra = html.slice(fin);
    assert(barra.indexOf('id="rb-msg"') > 0 && barra.indexOf('id="rb-prog"') > 0, 'mensaje y avance en la barra fija');
}

// todo lo que usa robot.js existe
const robotJs = fs.readFileSync(path.join(raiz, 'robot.js'), 'utf8');
const usados = new Set([...robotJs.matchAll(/\$\('(rb-[a-z0-9-]+)'\)/g)].map(m => m[1]));
const faltan = [...usados].filter(i => !ids.includes(i));
assert.deepStrictEqual(faltan, [], 'ids del robot que faltan en index.html');

console.log('admin-secciones.test.js: todo bien');
