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
    // el botón de la placa no debe poder echar a andar los motores por ruido o por quedar "pegado"
    assert(ino.includes('botonFlanco()') && !/if \(botonPresionado\(\) &&/.test(ino), 'el botón usa botonFlanco');
    assert(/v > 500/.test(ino) && /v < 60/.test(ino) && />= 60/.test(ino), 'el botón es estricto: alto claro, bajo sostenido 60 ms');
    // las ruedas suben en rampa SIN bloquear (si no, cada orden M le quita hasta 70 ms a la música),
    // y parar es inmediato; la rampa avanza en drenar(), que corre en toda espera y todo tono
    assert(!/void motores[^]*?delay\(/.test(ino.split('void adelante')[0]), 'motores() no debe bloquear con delay');
    assert(/void drenar\(\)[^]*?rampa\(\)/.test(ino), 'la rampa avanza dentro de drenar()');
    assert(/void parar\(\) \{[^}]*motorPwm\(0, 0\)/.test(ino), 'parar corta de golpe');
    // la imagen debe caber en menos de 64 paginas de flash (el bootloader de esta placa borra mal las
    // altas): sin floats, math.h, random() ni las clases de encoders / zumbador / ultrasonido de Makeblock
    const sinComentarios = ino.replace(/\/\*[^]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const feo of [/\bfloat\b/, /\bdouble\b/, /\blog\(/, /\bfloor\(/, /\brandom\(/, /MeEncoderOnBoard/, /MeBuzzer/, /MeUltrasonicSensor/, /<math\.h>/]) {
        assert(!feo.test(sinComentarios), 'el firmware no debe usar ' + feo);
    }
    assert(!/delay\(/.test(ino.split('void esquivar')[1].split('// ---------- Botón')[0]), 'los modos del botón esperan con espera(), para que la rampa avance');
    // diagnóstico que la página lee al conectar
    for (const clave of ['BTN=', 'RUN=', 'MIN=', 'BAT=']) assert(ino.includes(`F(" ${clave}")`), `INFO sin ${clave}`);
    assert(ino.includes('F("INFO BOOT=")'), 'INFO sin BOOT');
    assert(ino.includes('strcmp(cmd, "DIAG0")') && ino.includes('strcmp(cmd, "BAT")'));
    // el bootloader de esta placa puede dejar el watchdog armado: se apaga antes que nada (.init3),
    // y MCUSR ya no sirve para saber por que se reinicio (solo se limpia)
    assert(/section\("\.init3"\)/.test(ino) && /wdt_disable\(\)/.test(ino) && /MCUSR = 0;/.test(ino), 'el firmware apaga el watchdog al arrancar');
    assert(!/= MCUSR\b/.test(ino), 'el firmware no debe fiarse de leer MCUSR');
    // un falso pulso del botón (ruido de motores) no corta el show: debe seguir bajo un rato
    assert(/botonFlanco\(\) && botonSostenido\(\)/.test(ino), 'el botón exige una pulsación sostenida');
    assert(ino.includes('PONG mbot-web 1') && ino.includes('ABORTED') && ino.includes('c == \'!\''));
    assert(new RegExp(`VEL_MAX = ${R.VEL_MAX};`).test(ino), 'VEL_MAX distinto entre página y firmware');
    assert(new RegExp(`Serial\\.begin\\(${R.BAUDIOS}\\)`).test(ino), 'baudios distintos');
}

// 18) Melodía de un audio: se recuperan las notas, un salto normal no se "corrige" y un salto de
//     octava de más (error típico del detector) sí
{
    const sr = 16000;
    const tono = lista => {                                    // lista de [midi, segundos]
        const x = new Float32Array(Math.round(sr * lista.reduce((s, n) => s + n[1], 0)));
        let i = 0;
        for (const [m, seg] of lista) {
            const f = 440 * Math.pow(2, (m - 69) / 12);
            for (let k = 0; k < sr * seg; k++, i++) x[i] = 0.5 * Math.sin(2 * Math.PI * f * k / sr);
        }
        return x;
    };
    const nombres = r => r.texto.split(' ').map(t => t.split(':')[0]);
    const op = { fMin: 200, fMax: 1500, tonalidad: false, subir: false };

    // subida con un salto legítimo Sol5 -> Do6: no lo baja una octava
    const r1 = R.melodiaDeAudio(tono([[72, 0.25], [76, 0.25], [79, 0.25], [84, 0.25], [79, 0.25], [76, 0.25]]), sr, op);
    assert.deepStrictEqual(nombres(r1), ['C5', 'E5', 'G5', 'C6', 'G5', 'E5'], r1.texto);
    assert.strictEqual(r1.notas, 6);

    // un Sol6 suelto entre notas graves (confusión de octava) vuelve a su octava
    const r2 = R.melodiaDeAudio(tono([[72, 0.25], [76, 0.25], [91, 0.25], [76, 0.25], [72, 0.25]]), sr, { ...op, fMax: 2000 });
    assert.deepStrictEqual(nombres(r2), ['C5', 'E5', 'G5', 'E5', 'C5'], r2.texto);

    // con "subir al registro" las notas conservan su nombre y la mediana cae cerca de Sol5
    const grave = R.melodiaDeAudio(tono([[48, 0.3], [52, 0.3], [55, 0.3], [52, 0.3]]), sr, { fMin: 80, fMax: 400, tonalidad: false });
    assert.deepStrictEqual(nombres(grave).map(n => n.replace(/\d/, '')), ['C', 'E', 'G', 'E'], grave.texto);
    assert(nombres(grave).every(n => /[5-6]$/.test(n)), grave.texto);

    // un MIDI se convierte igual, y a la vez suena la más aguda
    const m = R.melodiaDeMidi([{ s: 0, e: 200, p: 60 }, { s: 0, e: 200, p: 48 }, { s: 200, e: 400, p: 64 }], { subir: false });
    assert.deepStrictEqual(nombres(m), ['C4', 'E4'], m.texto);

    // y la ficha resultante es una canción que la página sabe tocar
    assert(R.leerNotas(r1.texto).notas.length === 6);

    // voz con vibrato (con sus armónicos) + bajo + acordes + golpes de percusión: sigue a la voz,
    // no al bajo ni a los acordes (la fase se integra: el vibrato no puede acumular desvío)
    const mel = [67, 69, 71, 72, 71, 69, 67, 64, 67, 69, 71, 74, 72, 71, 69, 67];
    const bajo = [43, 43, 48, 48, 43, 43, 50, 50, 43, 43, 48, 48, 43, 43, 50, 50];
    const seg = 0.5, N = Math.round(sr * seg * mel.length), mezcla = new Float32Array(N);
    let semilla = 1;
    const azar = () => { semilla = (semilla * 1664525 + 1013904223) >>> 0; return semilla / 4294967296 - 0.5; };
    let ph = 0, phb = 0;
    for (let i = 0; i < N; i++) {
        const t = i / sr, k = Math.min(mel.length - 1, Math.floor(t / seg));
        ph += 2 * Math.PI * 440 * Math.pow(2, (mel[k] - 69) / 12) * (1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * t)) / sr;
        phb += 2 * Math.PI * 440 * Math.pow(2, (bajo[k] - 69) / 12) / sr;
        let v = 0, b = 0;
        for (let h = 1; h <= 8; h++) v += 0.7 / h * Math.sin(h * ph);
        for (let h = 1; h <= 4; h++) b += 0.9 / (h * h) * Math.sin(h * phb);
        const acorde = 0.25 * (Math.sin(2 * Math.PI * 261.6 * t) + Math.sin(2 * Math.PI * 329.6 * t) + Math.sin(2 * Math.PI * 392 * t));
        mezcla[i] = 0.35 * (v + b + acorde) + 0.3 * ((i % 4000) < 300 ? azar() * 1.2 : 0) + 0.04 * azar();
    }
    const r3 = R.melodiaDeAudio(mezcla, sr, { fMin: 110, fMax: 1000, tonalidad: false, subir: false });
    const esperado = mel.map(m => R.nombreMidi(m));
    let en = 0;
    for (const n of nombres(r3)) if (n === esperado[en]) en++;
    assert(en >= 14, `la voz debe recuperarse (${en}/16): ${r3.texto}`);
}

// 19) Teclado: lo tocado se vuelve texto de notas con sus milisegundos y silencios; velocidad de luces
{
    const g = R.grabacionATexto([{ n: 'C4', s: 0, e: 250 }, { n: 'E4', s: 300, e: 520 }, { n: 'G4', s: 530, e: 900 }]);
    assert.strictEqual(g.texto, 'C4:250 R:50 E4:220 G4:370', g.texto);   // 10 ms de hueco no cuentan como silencio
    assert.strictEqual(g.notas, 3);
    assert.strictEqual(g.ms, 900);
    assert.deepStrictEqual(g.intervalos, [[0, 250], [300, 520], [530, 900]]);
    // lo grabado es una canción que la página sabe leer, con las mismas duraciones
    const leidas = R.leerNotas(g.texto);
    assert.deepStrictEqual(leidas.errores, []);
    assert.deepStrictEqual(leidas.notas.map(n => [n.nombre.split(':')[0], n.ms]), [['C4', 250], ['R', 50], ['E4', 220], ['G4', 370]]);
    assert.strictEqual(R.grabacionATexto([]).texto, '');
    // sostenidos: C#4 también se entiende
    assert.deepStrictEqual(R.leerNotas(R.grabacionATexto([{ n: 'C#4', s: 0, e: 100 }]).texto).errores, []);

    // el teclado de la computadora cubre 25 semitonos sin repetir ninguno
    const semis = Object.values(R.TECLAS_PIANO);
    assert.strictEqual(new Set(semis).size, semis.length);
    assert.strictEqual(Math.min(...semis), 0);
    assert.strictEqual(Math.max(...semis), 24);

    // velocidad de las luces: opcional, acotada de 20 a 300 %
    const azulFx = Array.from({ length: 12 }, () => [0, 0, 255]);
    assert.strictEqual(R.fxLinea('arcoiris', 40, azulFx), 'FX 1 40 ' + '0000ff'.repeat(12));
    assert(R.fxLinea('arcoiris', 40, azulFx, 150).endsWith(' 150'));
    assert(R.fxLinea('arcoiris', 40, azulFx, 5).endsWith(' 20'));
    assert(R.fxLinea('arcoiris', 40, azulFx, 999).endsWith(' 300'));

    // el firmware: velocidad guardada en la EEPROM y zumbador por hardware (el anillo ya no lo entrecorta)
    const ino = fs.readFileSync(path.join(__dirname, '..', 'robot', 'mbot_ranger_web', 'mbot_ranger_web.ino'), 'utf8');
    assert(/fxVel = d \? constrain\(atoi\(d\), 20, 300\)/.test(ino), 'FX acepta la velocidad como 4.º dato');
    assert(/EE_DIR \+ 39/.test(ino), 'la velocidad se guarda junto al efecto');
    assert(/TCCR5A = _BV\(COM5B1\) \| _BV\(WGM51\)/.test(ino) && /ICR5 = tope/.test(ino), 'el tono sale del Timer5 en PWM rápido');
    // volumen: el ancho del pulso; 0 calla, se guarda con SAVE y la página lo manda con VOL
    assert(/strcmp\(cmd, "VOL"\)/.test(ino) && /OCR5B = \(uint16_t\)ancho/.test(ino) && /EE_DIR \+ 40/.test(ino), 'el firmware entiende VOL y lo guarda');
    assert(/if \(volumen == 0\)/.test(ino), 'volumen 0 no suena');
    assert(!/digitalWrite\(PIN_BUZZER, HIGH\)/.test(ino), 'el tono ya no se hace a mano');
}

// 20) Batería: porcentaje por tipo de pilas, y cuánto va a durar
{
    // NiMH: 6 celdas; 8,52 V (1,42 por celda) = llena, 7,5 V ≈ 45 %, 6 V = vacía
    assert.strictEqual(R.porcentajeBateria(8.6, 'nimh'), 100);
    assert.strictEqual(R.porcentajeBateria(8.52, 'nimh'), 100);
    assert.strictEqual(R.porcentajeBateria(8.4, 'nimh'), 97);
    assert.strictEqual(R.porcentajeBateria(7.5, 'nimh'), 45);
    assert.strictEqual(R.porcentajeBateria(6.0, 'nimh'), 0);
    assert.strictEqual(R.porcentajeBateria(5.0, 'nimh'), 0);
    // la misma lectura vale distinto en alcalinas (7,5 V ya es casi la mitad baja)
    assert(R.porcentajeBateria(7.5, 'alcalina') < R.porcentajeBateria(7.5, 'nimh'));
    assert.strictEqual(R.porcentajeBateria(9.6, 'alcalina'), 100);
    assert.strictEqual(R.porcentajeBateria(0, 'nimh'), null, 'sin lectura no hay porcentaje');
    // las curvas bajan siempre al bajar el voltaje (sin saltos hacia arriba)
    for (const q of Object.keys(R.CURVAS_BATERIA)) {
        let antes = 101;
        for (let v = 9.8; v >= 5.5; v -= 0.05) {
            const p = R.porcentajeBateria(v, q);
            assert(p <= antes, `${q} sube en ${v.toFixed(2)} V`);
            antes = p;
        }
    }

    // estimado por uso: 2000 mAh al 50 % con margen del 10 % -> 900 mAh
    const reposo = R.tiempoRestante({ pct: 50, capacidadMah: 2000, uso: 'reposo' });
    assert.deepStrictEqual(reposo, { minutos: Math.round(900 / 120 * 60), fuente: 'estimado' });
    const motores = R.tiempoRestante({ pct: 50, capacidadMah: 2000, uso: 'motores' });
    assert(motores.minutos < reposo.minutos / 4, 'con los motores dura bastante menos');
    assert.strictEqual(R.tiempoRestante({ pct: null }), null);

    // con historial real: baja 10 % en una hora -> con 50 % quedan unas 5 horas, sin importar el estimado
    const t0 = 1000000000000;
    const hist = [];
    for (let i = 0; i <= 6; i++) hist.push([t0 + i * 600000, 7.6 - i * 0.02]);   // cada 10 min, 0,02 V
    const pctFin = R.porcentajeBateria(hist[hist.length - 1][1], 'nimh');
    const real = R.tiempoRestante({ pct: pctFin, capacidadMah: 2000, historial: hist, uso: 'reposo' });
    assert.strictEqual(real.fuente, 'por tu uso');
    assert(real.minutos > 0);
    // con muy pocos datos no se fía del historial
    assert.strictEqual(R.tiempoRestante({ pct: 50, historial: hist.slice(0, 2) }).fuente, 'estimado');

    assert.strictEqual(R.formatoDuracion(0), 'menos de 1 min');
    assert.strictEqual(R.formatoDuracion(45), '45 min');
    assert.strictEqual(R.formatoDuracion(60), '1 h');
    assert.strictEqual(R.formatoDuracion(200), '3 h 20 min');
    assert.strictEqual(R.formatoDuracion(5000), 'más de 2 días');
}

// 21) Seguidor de líneas: ajustes saneados y órdenes para el robot (todavía desactivado)
{
    assert.strictEqual(R.SEGUIDOR_ACTIVO, true, 'el seguidor está activo: es la función «Seguir la línea»');
    const d = R.lineaNormaliza(null);
    assert.deepStrictEqual(d, R.lineaNormaliza(R.LINEA_DEFECTO));
    // valores raros se acotan o vuelven al de fábrica
    const raro = R.lineaNormaliza({ puerto: 9, color: 'azul', velocidad: 999, giro: -5, perdida: 'volar', cruce: 'x', obstaculoCm: 5000, duracionS: -1, buscarMs: 99999 });
    assert.strictEqual(raro.puerto, 6, 'el 9 es el botón de la placa');
    assert.strictEqual(raro.color, 'negra');
    assert.strictEqual(raro.velocidad, 150);
    assert.strictEqual(raro.giro, 10);
    assert.strictEqual(raro.perdida, 'buscar');
    assert.strictEqual(raro.cruce, 'recto');
    assert.strictEqual(raro.obstaculoCm, 200);
    assert.strictEqual(raro.duracionS, 0);
    assert.strictEqual(raro.buscarMs, 10000);

    const o = R.lineaAOrdenes({ puerto: 7, color: 'blanca', velocidad: 100, giro: 60, perdida: 'parar', buscarMs: 800, cruce: 'izquierda', obstaculoCm: 15, duracionS: 30, avisos: false });
    assert.deepStrictEqual(o, [
        'LINEA puerto 7', 'LINEA color 1', 'LINEA vel 100', 'LINEA giro 60', 'LINEA perdida 0',
        'LINEA buscar 800', 'LINEA cruce 2', 'LINEA obst 15', 'LINEA dur 30', 'LINEA avisos 0',
    ]);

    // firmware: el modo 6 existe pero va apagado (el binario subido no cambia) y acepta las mismas claves
    const ino = fs.readFileSync(path.join(__dirname, '..', 'robot', 'mbot_ranger_web', 'mbot_ranger_web.ino'), 'utf8');
    assert(/#define SEGUIDOR_LINEA 1\b/.test(ino), 'el firmware lleva el seguidor (modo 6)');
    // sin MeAuriga.h: esa librería enlaza Wire, Servo, IR y encoders y el programa no cabe en 16 KB con el seguidor
    assert(!/#include\s*<Me\w+\.h>/.test(ino), 'el firmware no debe incluir la librería Makeblock');
    assert(/void ledsMuestra\(\)/.test(ino) && /PORTL/.test(ino), 'driver propio del anillo de LEDs');
    assert(/strcmp\(cmd, "LINEA"\)/.test(ino) && /void seguirLinea\(\)/.test(ino));
    for (const clave of o.map(l => l.split(' ')[1])) assert(ino.includes(`"${clave}"`), 'el firmware no entiende LINEA ' + clave);
}

// 22) Volumen del robot: el ancho del pulso sigue asin(v/100)/pi (amplitud lineal), no una curva cuadrática
{
    const ino = fs.readFileSync(path.join(__dirname, '..', 'robot', 'mbot_ranger_web', 'mbot_ranger_web.ino'), 'utf8');
    const m = /ANCHO_VOL\[21\] = \{([^}]*)\}/.exec(ino);
    assert(m, 'tabla ANCHO_VOL');
    const tabla = m[1].split(',').map(Number);
    assert.strictEqual(tabla.length, 21);
    assert.strictEqual(tabla[0], 0, 'volumen 0 = sin pulso');
    assert.strictEqual(tabla[20], 500, 'volumen 100 = 50 %, lo más fuerte');
    tabla.forEach((d, i) => {
        const esperado = Math.round(Math.asin(i * 5 / 100) / Math.PI * 1000);
        assert(Math.abs(d - esperado) <= 1, `volumen ${i * 5}: ${d} y debería ser ${esperado}`);
        if (i) assert(d > tabla[i - 1], 'la tabla sube siempre');
    });
    // a media escala hay que oír claramente más que con la curva cuadrática de antes (125 milésimas)
    assert(tabla[10] >= 160, 'volumen 50 = ' + tabla[10]);
    assert(/anchoPermil\(\)/.test(ino) && !/volumen \* volumen/.test(ino), 'tono usa la tabla');
}

// 23) Funciones por modelo: catálogo coherente, pasos con segundos/grados, curvas y repetición continua
{
    const ids = R.VARIANTES.map(v => v.id);
    assert.deepStrictEqual(ids, ['tanque', 'raptor', 'pajaro']);
    assert.strictEqual(new Set(R.FUNCIONES.map(f => f.id)).size, R.FUNCIONES.length, 'ids repetidos');
    for (const f of R.FUNCIONES) {
        assert(f.v.length && f.v.every(v => ids.includes(v)), f.id + ': modelo desconocido');
        assert(f.nombre && f.desc, f.id);
        if (f.modo) assert([1, 2, 6].includes(f.modo), f.id + ': modos 1 (esquivar), 2 (seguir) y 6 (línea) del robot');
        else {
            assert(R.pasosDeFuncion(f.pasos).length > 0, f.id + ': sin pasos');
            // todo el texto de pasos es "MOV número[°]": nada se pierde en silencio
            assert.strictEqual(f.pasos.split(/\s+/).length % 2, 0, f.id);
            assert.strictEqual(R.pasosDeFuncion(f.pasos, 500, 60, 0).length, f.pasos.split(/\s+/).length / 2, f.id);
        }
    }
    for (const id of ids) assert(R.FUNCIONES.filter(f => f.v.includes(id)).length >= 3, id + ' lleva al menos 3 funciones');
    assert(R.FUNCIONES.filter(f => f.v.length === 1).length >= 6, 'cada modelo tiene funciones propias');
    assert(R.FUNCIONES.some(f => f.id === 'avanzar' && ids.every(v => f.v.includes(v))), 'seguir avanzando está en los tres');

    // segundos y grados: a 120 bpm entran 2 tiempos por segundo; 90° = lo que valga giro90
    const unaVuelta = R.pasosDeFuncion('AD 2 GD 90°', 500, 120, 0);
    assert.deepStrictEqual(unaVuelta, [{ mov: 'AD', beats: 4 }, { mov: 'GD', beats: 1 }]);
    assert.strictEqual(R.pasosDeFuncion('GI 360°', 400, 60, 0)[0].beats, 1.6);
    // se repite hasta cubrir 30 s (2,5 s por vuelta -> 12 vueltas)
    assert.strictEqual(R.pasosDeFuncion('AD 2 GD 90°', 500, 120).length, 24);
    assert.deepStrictEqual(R.pasosDeFuncion('texto sin pasos'), []);

    // curvas: la rueda del lado de la curva va al 40 %, y los números salen enteros
    assert.deepStrictEqual(R.leerBaile('CI/2 CD/4').errores, []);
    const curva = R.compilar({ pasos: R.pasosDeFuncion('CI 1 CD 1', 500, 120, 0), bpm: 120, vel: 115, continuo: true });
    assert.deepStrictEqual(curva.cmds.map(c => c.l).filter(l => l[0] === 'M'), ['M 46 115', 'M 115 46']);

    // continuo: no termina en S (parar) para empalmar vueltas; sin continuo sí (como los bailes)
    const sin = R.compilar({ pasos: R.pasosDeFuncion('AD 2', 500, 120, 0), bpm: 120, vel: 110 });
    const con = R.compilar({ pasos: R.pasosDeFuncion('AD 2', 500, 120, 0), bpm: 120, vel: 110, continuo: true });
    assert.strictEqual(sin.cmds[sin.cmds.length - 1].l, 'S');
    assert(!con.cmds.some(c => c.l === 'S'));
    assert.strictEqual(con.ms, 2000);

    // con música: la canción manda en la duración y el movimiento la acompaña sin parar
    const { notas } = R.leerNotas('C4/4 D4/4 E4/4 F4/4');
    const conMusica = R.compilar({ notas, pasos: R.pasosDeFuncion('AD 1 PA 0.5', 500, 120), bpm: 120, vel: 100, continuo: true });
    assert.strictEqual(conMusica.ms, 2000);
    assert(conMusica.cmds.some(c => c.l.startsWith('T ')) && conMusica.cmds.some(c => c.l === 'M 100 100') && conMusica.cmds.some(c => c.l === 'M 0 0'));

    // el firmware entiende los modos que usan las funciones autónomas y la página los manda con MODE
    const ino = fs.readFileSync(path.join(__dirname, '..', 'robot', 'mbot_ranger_web', 'mbot_ranger_web.ino'), 'utf8');
    assert(/case 1: esquivar\(\);/.test(ino) && /case 2: seguir\(\);/.test(ino), 'modos 1 y 2 del robot');
    assert(/strcmp\(cmd, "MODE"\)/.test(ino) && /n > MODO_MAX/.test(ino));
}

// 24) Línea dentro de Funciones y tiempo de carga de las pilas
{
    const f = R.FUNCIONES.find(x => x.id === 'linea');
    assert(f && f.modo === 6 && f.linea && f.v.includes('tanque') && f.v.includes('raptor'), 'Seguir la línea es una función (modo 6)');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert(!html.includes('data-section="robot-linea"'), 'ya no hay sección Línea aparte');
    assert(html.includes('id="rb-ln-panel"') && html.indexOf('id="rb-ln-panel"') > html.indexOf('id="sec-robot-funciones"')
        && html.indexOf('id="rb-ln-panel"') < html.indexOf('id="sec-robot-luces"'), 'los ajustes de la línea viven en Funciones');
    // 2000 mAh al 50 %: faltan 1000 mAh; con 500 mA y 140 % de carga son 2,8 h
    assert.strictEqual(R.tiempoCarga({ pct: 50, capacidadMah: 2000, corrienteMa: 500, quimica: 'nimh' }), 168);
    assert.strictEqual(R.tiempoCarga({ pct: 100, capacidadMah: 2000, corrienteMa: 500 }), 0);
    assert.strictEqual(R.tiempoCarga({ pct: 0, capacidadMah: 2000, corrienteMa: 1000 }), 168);
    assert.strictEqual(R.tiempoCarga({ pct: 50, quimica: 'alcalina' }), null, 'las alcalinas no se recargan');
    assert.strictEqual(R.tiempoCarga({ pct: null }), null);
    assert.strictEqual(R.tiempoCarga({ pct: 50, corrienteMa: 0 }), null);
}

// 25) Función guardada en el robot: orden FSAVE/FCLR, sitio propio en la EEPROM y que no arranque con la página
{
    const ino = fs.readFileSync(path.join(__dirname, '..', 'robot', 'mbot_ranger_web', 'mbot_ranger_web.ino'), 'utf8');
    assert(/strcmp\(cmd, "FSAVE"\)/.test(ino) && /strcmp\(cmd, "FCLR"\)/.test(ino) && /void fnCargar\(\)/.test(ino));
    const dir = Number(/const int FN_DIR = (\d+);/.exec(ino)[1]);
    const pgm = Number(/const int PGM_DIR = (\d+);/.exec(ino)[1]) + 4 + Number(/const int PGM_MAX = (\d+);/.exec(ino)[1]);
    const diag = Number(/const int EE_BOOT = (\d+)/.exec(ino)[1]);
    assert(dir >= pgm && dir + 15 <= diag, 'la función guardada no pisa el show ni los contadores');
    assert(/if \(modo != 0\) fnEspera = 0;/.test(ino), 'si la página toma el control, la función no arranca sola');
    const js = fs.readFileSync(path.join(__dirname, '..', 'robot.js'), 'utf8');
    assert(/function alListo\(\) \{[^}]*MODE 4/.test(js), 'al conectar, la página frena lo que arranca solo');
}

console.log('robot.test.js: todo bien');
