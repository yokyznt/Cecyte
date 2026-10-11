// node test/robot.test.js  -> prueba canciones, baile, compilación a órdenes y cola de robot.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = require('../robot.js');

// 1) Frecuencias: La4 = 440, Do4 = 262, Mi5 = 659, Do#4 = 277, Sib4 = 466
assert.strictEqual(R.frecuencia('A', '', 4), 440);
assert.strictEqual(R.frecuencia('C', '', 4), 262);
assert.strictEqual(R.frecuencia('E', '', 5), 659);
assert.strictEqual(R.frecuencia('C', '#', 4), 277);
assert.strictEqual(R.frecuencia('B', 'b', 4), 466);

// 2) Notas: la duración se hereda, el punto alarga, R es silencio, lo raro va a errores
{
    const { notas, errores } = R.leerNotas('C4/8 D4 E4/4. R/2 // comentario\n G4 X9 C4/3 Bb3');
    assert.deepStrictEqual(notas.map(n => n.beats), [0.5, 0.5, 1.5, 2, 2, 2]);
    assert.deepStrictEqual(notas.map(n => n.hz), [262, 294, 330, 0, 392, 233]);
    assert.deepStrictEqual(errores, ['X9', 'C4/3']);
}

// 3) Toda la biblioteca se lee sin errores y ninguna nota se sale del rango del buzzer
for (const c of R.CANCIONES) {
    const { notas, errores } = R.leerNotas(c.texto);
    assert.deepStrictEqual(errores, [], `${c.id}: ${errores}`);
    assert(notas.length > 5, c.id);
    assert(notas.every(n => n.hz === 0 || (n.hz >= 40 && n.hz <= 8000)), c.id);
}
for (const b of R.BAILES) assert.deepStrictEqual(R.leerBaile(b.texto).errores, [], b.id);

// 4) Baile
{
    const { pasos, errores } = R.leerBaile('AD/2 gi/4 PA XX AT/3');
    assert.deepStrictEqual(pasos.map(p => [p.mov, p.beats]), [['AD', 2], ['GI', 1], ['PA', 1]]);
    assert.deepStrictEqual(errores, ['XX', 'AT/3']);
}

// 5) Compilar: dos negras a 120 bpm -> nota 450 ms + silencio 50 ms, cada una
{
    const { notas } = R.leerNotas('C4/4 D4/4');
    const { cmds, ms } = R.compilar({ notas, bpm: 120 });
    assert.deepStrictEqual(cmds.map(c => c.l), ['T 262 450', 'W 50', 'T 294 450', 'W 50']);
    assert.strictEqual(ms, 1000);
}

// 6) El tiempo no se desvía: la suma de las esperas es exactamente la duración total
for (const c of R.CANCIONES) {
    const { notas } = R.leerNotas(c.texto);
    const { cmds, ms } = R.compilar({ notas, bpm: c.bpm });
    assert.strictEqual(cmds.reduce((s, x) => s + x.ms, 0), ms, c.id);
    assert(cmds.every(x => !/^[TW]/.test(x.l) || Number(x.l.split(' ').pop()) <= 5000), c.id + ': orden > 5 s');
}

// 7) Notas muy cortas no llevan silencio; silencios y notas largas se parten en pedazos de 4 s
{
    const { cmds } = R.compilar({ notas: R.leerNotas('C4/32').notas, bpm: 240 });   // 1/8 de tiempo = 31 ms
    assert.deepStrictEqual(cmds.map(c => c.l), ['T 262 31']);
    const largo = R.compilar({ notas: R.leerNotas('R/1').notas, bpm: 30 });   // 4 beats a 30 bpm = 8 s
    assert.deepStrictEqual(largo.cmds.map(c => c.l), ['W 4000', 'W 4000']);
}

// 8) Baile + canción: los movimientos cambian en el instante del paso y el robot termina parado
{
    const { notas } = R.leerNotas('C4/4 C4 C4 C4');   // 4 tiempos a 120 bpm = 2 s
    const { pasos } = R.leerBaile('AD/2 AT/2');
    const { cmds, ms } = R.compilar({ notas, pasos, bpm: 120, vel: 100 });
    const ls = cmds.map(c => c.l);
    assert.strictEqual(ms, 2000);
    assert.deepStrictEqual(ls.filter(l => l[0] === 'M'), ['M 100 100', 'M -100 -100']);
    assert.strictEqual(ls[0], 'M 100 100');
    assert.strictEqual(ls[ls.length - 1], 'S');
    const iAtras = ls.indexOf('M -100 -100');
    const antes = cmds.slice(0, iAtras).reduce((s, x) => s + x.ms, 0);
    assert.strictEqual(antes, 1000, 'el giro a "atrás" empieza a los 1000 ms');
    assert.strictEqual(cmds.reduce((s, x) => s + x.ms, 0), 2000);
}

// 9) El baile se repite para cubrir la canción; la velocidad nunca pasa del tope del firmware
{
    const { notas } = R.leerNotas('C4/1 C4/1');   // 8 tiempos
    const { cmds } = R.compilar({ notas, pasos: R.leerBaile('GI/2 GD/2').pasos, bpm: 120, vel: 999 });
    const giros = cmds.map(c => c.l).filter(l => l[0] === 'M');
    assert.strictEqual(giros.length, 4);
    assert(giros.every(l => l.split(' ').slice(1).every(n => Math.abs(Number(n)) === R.VEL_MAX)));
}

// 10) Solo baile (sin canción): una vuelta, con esperas en vez de notas
{
    const { cmds, ms } = R.compilar({ pasos: R.leerBaile('AD/4 PA/4').pasos, bpm: 120 });
    assert.strictEqual(ms, 1000);
    assert.deepStrictEqual(cmds.map(c => c.l), ['M 110 110', 'W 500', 'M 0 0', 'W 500', 'S']);
}

// 11) Luces: una orden LS exclusiva justo antes de cada nota que suena
{
    const { notas } = R.leerNotas('C4/4 R/4 E4/4');
    const { cmds } = R.compilar({ notas, bpm: 120, luz: (i, hz) => 'ab'.repeat(36) });
    const ls = cmds.filter(c => c.l.startsWith('LS '));
    assert.strictEqual(ls.length, 2);
    assert(ls.every(c => c.ex && c.l.length === 3 + 72));
    assert(cmds[0].ex && cmds[1].l.startsWith('T 262'));
}

// 12) Cola: ventana de bytes/órdenes, el OK libera las siguientes y "fin" se llama una sola vez
{
    const enviadas = [], crudos = [];
    const cola = R.crearCola(l => enviadas.push(l), c => crudos.push(c));
    let fines = 0;
    const cmds = Array.from({ length: 30 }, (_, i) => ({ l: `T ${400 + i} 100`, ms: 100 }));
    cola.enviar(cmds, () => fines++);
    assert(enviadas.length >= 2 && enviadas.length <= 8, 'ventana de órdenes: ' + enviadas.length);
    assert(enviadas.reduce((s, l) => s + l.length + 1, 0) <= 120, 'ventana de bytes');
    const antes = enviadas.length;
    cola.ack();
    assert(enviadas.length > antes, 'un OK deja pasar más órdenes');
    while (cola.ocupado()) cola.ack();
    assert.strictEqual(enviadas.length, 30);
    assert.strictEqual(fines, 1);
}

// 13) Cola: las órdenes de LEDs van solas (nada antes sin confirmar, nada después hasta su OK)
{
    const enviadas = [];
    const cola = R.crearCola(l => enviadas.push(l), () => {});
    cola.enviar([{ l: 'T 440 100' }, { l: 'LS ' + 'f'.repeat(72), ex: true }, { l: 'T 440 100' }]);
    assert.deepStrictEqual(enviadas, ['T 440 100']);
    cola.ack();
    assert.strictEqual(enviadas.length, 2);
    assert(enviadas[1].startsWith('LS '));
    cola.ack();
    assert.strictEqual(enviadas.length, 3);
}

// 14) Cola: abortar manda "!" una vez, ignora lo que venga y retoma tras ABORTED
{
    const enviadas = [], crudos = [];
    const cola = R.crearCola(l => enviadas.push(l), c => crudos.push(c));
    cola.enviar(Array.from({ length: 10 }, () => ({ l: 'T 440 100' })));
    cola.abortar();
    cola.abortar();
    assert.deepStrictEqual(crudos, ['!']);
    const n = enviadas.length;
    cola.ack();
    cola.enviar([{ l: 'S' }]);
    assert.strictEqual(enviadas.length, n, 'nada sale mientras se espera el ABORTED');
    cola.abortado();
    assert.strictEqual(cola.ocupado(), false);
    cola.enviar([{ l: 'S' }]);
    assert.strictEqual(enviadas[enviadas.length - 1], 'S');
}

// 15) Lector: junta pedazos, quita \r y la basura del reinicio
{
    const lineas = [];
    const leer = R.crearLector(l => lineas.push(l));
    leer('Æ\u001e�mBot Ranger web v1 li');
    leer('sto\r\nOK\r\nPO');
    leer('NG mbot-web 1\n\n');
    assert.deepStrictEqual(lineas, ['mBot Ranger web v1 listo', 'OK', 'PONG mbot-web 1']);
}

// 16) LEDs: el marco son 12 x RRGGBB, el brillo escala y la misma nota da el mismo color en otra octava
{
    const blanco = Array.from({ length: 12 }, () => [255, 255, 255]);
    assert.strictEqual(R.marcoHex(blanco, 100), 'ffffff'.repeat(12));
    assert.strictEqual(R.marcoHex(blanco, 0), '000000'.repeat(12));
    assert.strictEqual(R.marcoHex(blanco, 50).slice(0, 6), '808080');
    assert.deepStrictEqual(R.hsv(0, 1, 1).map(Math.round), [255, 0, 0]);
    const a = R.efecto('musica', 0, blanco, 440), b = R.efecto('musica', 0, blanco, 880);
    assert.deepStrictEqual(a[0].map(Math.round), b[0].map(Math.round));
    assert.strictEqual(R.efecto('arcoiris', 0, blanco).length, 12);
    assert.deepStrictEqual(R.hexARgb('#ff8000'), [255, 128, 0]);
}

// 16b) Colores rápidos: los primarios, el blanco y el negro en su valor exacto, y todos llegan tal cual al LED
{
    const por = Object.fromEntries(R.PALETA.map(([c, n]) => [n, c]));
    assert.strictEqual(por.Rojo, '#ff0000');
    assert.strictEqual(por.Verde, '#00ff00');
    assert.strictEqual(por.Azul, '#0000ff');
    assert.strictEqual(por.Blanco, '#ffffff');
    assert.strictEqual(por.Apagado, '#000000');
    assert.strictEqual(por.Amarillo, '#ffff00');
    assert.strictEqual(por.Cian, '#00ffff');
    assert(R.PALETA.every(([c]) => /^#[0-9a-f]{6}$/.test(c)), 'formato #rrggbb');
    assert(R.PALETA.every(([c]) => R.hexARgb(c).every(v => [0, 128, 255].includes(v))), 'cada canal vale 0, 128 o 255');
    assert.strictEqual(R.COLOR_INICIAL, '#00ff00');
    // a brillo 100 el LED recibe exactamente el color; a otro brillo solo se escala, sin mezclar canales
    for (const [c] of R.PALETA) {
        const rgb = R.hexARgb(c);
        const hex = R.marcoHex(Array.from({ length: 12 }, () => rgb), 100).slice(0, 6);
        assert.strictEqual('#' + hex, c);
    }
    assert.strictEqual(R.marcoHex(Array.from({ length: 12 }, () => R.hexARgb('#ff0000')), 40).slice(0, 6), '660000');
    assert.strictEqual(R.marcoHex(Array.from({ length: 12 }, () => R.hexARgb('#ffffff')), 40).slice(0, 6), '666666');
    // el arcoíris también usa primarios puros
    assert.deepStrictEqual(R.hsv(1 / 3, 1, 1).map(Math.round), [0, 255, 0]);
    assert.deepStrictEqual(R.hsv(2 / 3, 1, 1).map(Math.round), [0, 0, 255]);
}

// 17) La página y el firmware hablan el mismo idioma (si uno cambia, esto avisa)
{
    const ino = fs.readFileSync(path.join(__dirname, '..', 'robot', 'mbot_ranger_web', 'mbot_ranger_web.ino'), 'utf8');
    for (const cmd of ['PING', 'T', 'W', 'M', 'S', 'L', 'LS', 'MODE']) {
        assert(ino.includes(`strcmp(cmd, "${cmd}")`), `el firmware no entiende ${cmd}`);
    }
    assert(ino.includes('PONG mbot-web 1') && ino.includes('ABORTED') && ino.includes('c == \'!\''));
    assert(new RegExp(`VEL_MAX = ${R.VEL_MAX};`).test(ino), 'VEL_MAX distinto entre página y firmware');
    assert(new RegExp(`Serial\\.begin\\(${R.BAUDIOS}\\)`).test(ino), 'baudios distintos');
}

console.log('robot.test.js: todo bien');
