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
    assert.deepStrictEqual(R.hexARgb('#ff8000'), [255, 128, 0]);
    // FX: modo, brillo y los 12 colores base SIN brillo (lo aplica el robot)
    const azul = Array.from({ length: 12 }, () => [0, 0, 255]);
    assert.strictEqual(R.fxLinea('arcoiris', 40, azul), 'FX 1 40 ' + '0000ff'.repeat(12));
    assert(R.fxLinea('fijo', 100, azul).startsWith('FX 0 100 '));
    assert(R.fxLinea('musica', 250, azul).startsWith('FX 4 100 '), 'el brillo se limita a 100');
    assert(R.fxLinea('raro', 5, azul).startsWith('FX 0 5 '), 'efecto desconocido = fijo');
    assert.strictEqual(R.fxLinea('persecucion', 50, azul).length, 'FX 3 50 '.length + 72);
}

// 16c) Duración en milisegundos y texto de ritmos
{
    const { notas, errores } = R.leerNotas('A5:120 R:300 C5 E5:5 G5:90000 D5/4');
    assert.deepStrictEqual(errores, ['E5:5', 'G5:90000']);
    assert.deepStrictEqual(notas.map(n => n.ms), [120, 300, 300, undefined]);   // C5 hereda los 300 ms
    assert.strictEqual(notas[3].beats, 1);
    // en milisegundos la velocidad (bpm) no cuenta
    const a = R.compilar({ notas: R.leerNotas('A5:200 R:100').notas, bpm: 60 });
    const b = R.compilar({ notas: R.leerNotas('A5:200 R:100').notas, bpm: 240 });
    assert.deepStrictEqual(a.cmds.map(c => c.l), b.cmds.map(c => c.l));
    assert.strictEqual(a.ms, 300);
    // intervalos -> texto: pausas, tonos que alternan y duración mínima
    const txt = R.ritmoATexto([[0, 100], [250, 350], [600, 605]]);
    assert.strictEqual(txt, 'C5:100 R:150 E5:100 R:250 G5:10');
    assert.deepStrictEqual(R.leerNotas(txt).errores, []);
    assert.strictEqual(R.ritmoATexto([[200, 300]], R.TONOS_RITMO.agudo), 'R:200 A5:100');
    // un audio larguísimo nunca pasa del máximo de notas
    const muchos = Array.from({ length: 1000 }, (_, i) => [i * 100, i * 100 + 50]);
    assert.deepStrictEqual(R.leerNotas(R.ritmoATexto(muchos)).errores, []);
}

// 16d) Audio -> ritmo del robot con la detección de golpes de timbre.js (8 golpes sintéticos cada 500 ms)
{
    const T = require('../timbre.js');
    const sr = 8000, x = new Float32Array(sr * 4);
    for (let c = 0; c < 8; c++) for (let i = 0; i < 240; i++) x[c * 4000 + 800 + i] = Math.sin(i * 0.9) * Math.exp(-i / 60);
    const { intervalos } = T.audioARitmo(x, sr, { modo: 'golpes', sens: 50, golpe: 120, sep: 120 });
    assert.strictEqual(intervalos.length, 8);
    const { notas, errores } = R.leerNotas(R.ritmoATexto(intervalos));
    assert.deepStrictEqual(errores, []);
    assert.strictEqual(notas.filter(n => n.hz > 0).length, 8);
    const total = notas.reduce((s, n) => s + n.ms, 0);
    assert(Math.abs(total - intervalos[7][1]) <= 60, 'dura lo mismo que el audio: ' + total);
    const { cmds, ms } = R.compilar({ notas });
    assert.strictEqual(cmds.reduce((s, c) => s + c.ms, 0), ms);
}

// 16f) Cola: una orden de luces que llega rota (ERR) se reintenta UNA vez; las de tiempo (T, W, M) no
{
    const enviadas = [];
    const cola = R.crearCola(l => enviadas.push(l), () => {});
    cola.enviar([{ l: 'SAVE', ex: true }]);
    assert.strictEqual(cola.ack(true), true, 'primer ERR: reintenta');
    assert.deepStrictEqual(enviadas, ['SAVE', 'SAVE']);
    assert.strictEqual(cola.ack(true), false, 'segundo ERR: ya no');
    assert.strictEqual(cola.ocupado(), false);
    enviadas.length = 0;
    cola.enviar([{ l: 'T 440 100' }, { l: 'M 100 100' }]);
    assert.strictEqual(cola.ack(true), false);
    assert.strictEqual(cola.ack(true), false);
    assert.deepStrictEqual(enviadas, ['T 440 100', 'M 100 100']);
    enviadas.length = 0;
    cola.enviar([{ l: 'FX 1 40 ' + 'ff0000'.repeat(12), ex: true }]);
    assert.strictEqual(cola.ack(true), true);
    assert.strictEqual(cola.ack(false), false, 'si el reintento sale bien, ya está');
    assert.strictEqual(enviadas.length, 2);
}

// 16g) Show guardado en el robot: solo notas, esperas, motores y paro; con su tamaño en la EEPROM
{
    const { notas } = R.leerNotas('C4/4 D4/4');                     // 4 órdenes: T W T W
    const { pasos } = R.leerBaile('AD/2 AT/2');
    const { cmds } = R.compilar({ notas, pasos, bpm: 120, vel: 100, luz: () => 'ab'.repeat(36) });
    const p = R.programaParaRobot(cmds);
    assert(p.lineas.every(l => /^PADD (T \d+ \d+|W \d+|M -?\d+ -?\d+|S)$/.test(l)), 'solo órdenes del show');
    assert(!p.lineas.some(l => l.startsWith('PADD LS')), 'las luces no van en el show');
    const esperado = cmds.filter(c => /^[TWMS]( |$)/.test(c.l)).reduce((s, c) => s + { T: 5, W: 3, M: 3, S: 1 }[c.l[0]], 0);
    assert.strictEqual(p.bytes, esperado);
    assert.strictEqual(p.cabe, true);
    // una canción larguísima no cabe y la página avisa antes de mandarla
    const muchas = R.leerNotas('C5:100 '.repeat(400)).notas;          // 400 notas, cada una con su silencio: 3200 bytes
    const grande = R.programaParaRobot(R.compilar({ notas: muchas }).cmds);
    assert(grande.bytes > R.PGM_MAX && grande.cabe === false, 'bytes: ' + grande.bytes);
    // lo mismo que acepta el firmware (velocidades pares, que se guardan a la mitad)
    assert(p.lineas.every(l => !/^PADD M/.test(l) || l.split(' ').slice(2).every(n => Math.abs(Number(n)) <= R.VEL_MAX)));
}

// 16e) Cola: "sin novedad" solo cuenta mientras hay algo esperando respuesta
{
    const cola = R.crearCola(() => {}, () => {});
    assert.strictEqual(cola.sinNovedad(), 0);
    cola.enviar([{ l: 'T 440 100' }]);
    assert(cola.sinNovedad() >= 0 && cola.sinNovedad() < 1000);
    cola.ack();
    assert.strictEqual(cola.sinNovedad(), 0);
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
    for (const cmd of ['PING', 'T', 'W', 'M', 'S', 'L', 'LS', 'FX', 'SAVE', 'PCLR', 'PADD', 'PEND', 'MODE']) {
        assert(ino.includes(`strcmp(cmd, "${cmd}")`), `el firmware no entiende ${cmd}`);
    }
    assert(new RegExp(`PGM_MAX = ${R.PGM_MAX};`).test(ino), 'PGM_MAX distinto entre página y firmware');
    for (const sub of ['"T"', '"W"', '"M"', '"S"']) assert(ino.includes(`strcmp(a, ${sub})`), `PADD no acepta ${sub}`);
    // los modos de efecto de la página coinciden con los que dibuja el firmware (0 a 4)
    assert.deepStrictEqual(Object.values(R.MODOS_FX).sort(), [0, 1, 2, 3, 4]);
    assert(/m < 0 \|\| m > 4/.test(ino), 'el firmware acepta FX 0 a 4');
    assert(ino.includes('EEPROM.update'), 'SAVE guarda en la EEPROM');
    assert(ino.includes('PONG mbot-web 1') && ino.includes('ABORTED') && ino.includes('c == \'!\''));
    assert(new RegExp(`VEL_MAX = ${R.VEL_MAX};`).test(ino), 'VEL_MAX distinto entre página y firmware');
    assert(new RegExp(`Serial\\.begin\\(${R.BAUDIOS}\\)`).test(ino), 'baudios distintos');
}

console.log('robot.test.js: todo bien');
