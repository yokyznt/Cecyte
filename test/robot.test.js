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
    assert(ino.includes('F("INFO BAT=")') && ino.includes('strcmp(cmd, "BAT")'), 'INFO y BAT con el voltaje');
    // el bootloader de esta placa puede dejar el watchdog armado: se apaga antes que nada (.init3),
    // y MCUSR ya no sirve para saber por que se reinicio (solo se limpia)
    assert(/section\("\.init3"\)/.test(ino) && /wdt_disable\(\)/.test(ino) && /MCUSR = 0;/.test(ino), 'el firmware apaga el watchdog al arrancar');
    assert(!/= MCUSR\b/.test(ino), 'el firmware no debe fiarse de leer MCUSR');
    // un falso pulso del botón (ruido de motores) no corta el show: debe seguir bajo un rato
    assert(/botonFlanco\(\) && botonSostenido\(\)/.test(ino), 'el botón exige una pulsación sostenida');
    assert(ino.includes('PONG mbot-web 1') && ino.includes('ABORTED') && ino.includes('c == \'!\''));
    assert(new RegExp(`VEL_MAX = ${R.VEL_MAX};`).test(ino), 'VEL_MAX distinto entre página y firmware');
    assert(new RegExp(`VEL_TURBO = ${R.VEL_TURBO};`).test(ino), 'VEL_TURBO distinto entre página y firmware');
    assert(/Serial\.begin\(115200\)/.test(ino), 'baudios distintos');
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
        if (f.modo) assert([1, 2, 6, 7].includes(f.modo), f.id + ': modos 1 (esquivar), 2 (seguir), 6 (línea) y 7 (acercarse a la pared) del robot');
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
    assert(/strcmp\(cmd, "MODE"\)/.test(ino) && /n > MODO_PARK/.test(ino));
    assert(/PADD O|"O"/.test(ino) && /op == 5/.test(ino) && /void parkPaso/.test(ino) && ino.includes('PARK=1'), 'firmware con serie (PADD O) y estacionar (MODE 7)');
}

// 23a) Serie de demostración: varias funciones seguidas que el robot guarda como un solo show
{
    const f = id => R.FUNCIONES.find(x => x.id === id);
    assert(f('estacionar').modo === 7 && f('sirena').luces === 'sirena', 'estacionar y sirena en el catálogo');
    assert(R.leerNotas(f('sirena').notas).errores.length === 0, 'la sirena es una canción válida');

    const serie = [{ id: 'cuadrado', seg: 10 }, { id: 'esquivar', seg: 30 }, { id: 'trompo', seg: 6 }, { id: 'sirena', seg: 1 }];
    assert.deepStrictEqual(R.itemsDeSerie(serie, 'raptor').map(x => x.f.id), ['cuadrado', 'esquivar'], 'por modelo solo salen las suyas');
    const tanque = R.itemsDeSerie(serie, 'tanque');
    assert.deepStrictEqual(tanque.map(x => x.i), [0, 1, 2, 3], 'cada ítem recuerda su lugar en la serie');

    const prog = R.programaDeSerie(R.itemsDeSerie([{ id: 'esquivar', seg: 25 }, { id: 'estacionar', seg: 8 }], 'tanque'));
    assert.deepStrictEqual(prog.lineas, ['PADD O 1 25', 'PADD O 7 8'], 'las de sensor van como un segmento de modo');
    assert.strictEqual(prog.bytes, 6);

    const mixta = R.programaDeSerie(R.itemsDeSerie([{ id: 'cuadrado', seg: 10 }, { id: 'esquivar', seg: 5 }], 'tanque'), { giro90: 500, bpm: 120, vel: 110 });
    assert(mixta.lineas[0].startsWith('PADD M 110 110') && mixta.lineas.includes('PADD S') && mixta.lineas.includes('PADD O 1 5'));
    assert(mixta.lineas.indexOf('PADD S') < mixta.lineas.indexOf('PADD O 1 5'), 'las funciones salen en el orden de la serie');
    assert(mixta.cabe && mixta.bytes > 6);

    const larga = R.programaDeSerie(R.itemsDeSerie(Array.from({ length: 30 }, () => ({ id: 'zigzag', seg: 255 })), 'tanque'));
    assert(!larga.cabe, 'una serie enorme no cabe en el robot y se avisa');

    const trazo = R.trazoDeSerie(R.itemsDeSerie([{ id: 'cuadrado', seg: 16 }], 'tanque'), 500, 22);
    assert(trazo.length > 10, 'el mapa estimado dibuja el recorrido');
    const fin = trazo[trazo.length - 1];
    assert(Math.abs(fin.x) < 25 && Math.abs(fin.y) < 25, 'el cuadrado vuelve cerca del inicio');
    assert.strictEqual(R.trazoDeSerie(R.itemsDeSerie([{ id: 'esquivar', seg: 20 }], 'tanque')).length, 1, 'las de sensor no se pueden predecir');

    const exacto = R.pasosDeFuncion('AD 1 GD 90° GI 45°', 500, 120, 0, true);
    assert.deepStrictEqual(exacto.map(p => p.grados || 0), [0, 90, 45], 'con giroscopio los giros llevan sus grados');
    assert.deepStrictEqual(R.pasosDeFuncion('AD 1 GD 90°', 500, 120, 0), [{ mov: 'AD', beats: 2 }, { mov: 'GD', beats: 1 }], 'sin giroscopio no cambia nada');
    const girando = R.compilar({ pasos: R.pasosDeFuncion('AD 1 GD 90° GI 45° AD 1', 500, 120, 0, true), bpm: 120, vel: 110, continuo: true }).cmds.map(c => c.l);
    assert.deepStrictEqual(girando.filter(l => l[0] !== 'W'), ['M 110 110', 'G 90', 'G -45', 'M 110 110'], 'los giros salen como G grados y las rectas se reanudan después');
    const conMusica = R.compilar({ notas: R.leerNotas('C5/4 C5 C5 C5').notas, pasos: R.pasosDeFuncion('GD 90°', 500, 120, 0, true), bpm: 120, vel: 110, continuo: true }).cmds.map(c => c.l);
    assert(!conMusica.some(l => l.startsWith('G ')), 'con música el giro sigue siendo por tiempo (la orden G bloquea las notas)');
    const progG = R.programaDeSerie(R.itemsDeSerie([{ id: 'cuadrado', seg: 4 }], 'tanque'), { giro90: 500, bpm: 120, vel: 110, exacto: true });
    assert(progG.lineas.includes('PADD G 90'), 'la serie guarda el giro exacto');
    assert(!R.programaDeSerie(R.itemsDeSerie([{ id: 'cuadrado', seg: 4 }], 'tanque'), { giro90: 500, bpm: 120, vel: 110 }).lineas.some(l => l.startsWith('PADD G')), 'sin giroscopio no hay PADD G');

    const ino = fs.readFileSync(path.join(__dirname, '..', 'robot', 'mbot_ranger_web', 'mbot_ranger_web.ino'), 'utf8');
    assert(/strcmp\(a, "G"\)/.test(ino) && /op == 6/.test(ino) && /strcmp\(cmd, "G"\)/.test(ino) && ino.includes('GIRO='), 'el firmware gira con el giroscopio (G, PADD G, INFO GIRO)');
    assert(!/digitalWrite|digitalRead|pinMode|analogWrite/.test(ino.replace(/\/\/.*$/gm, '')), 'el firmware usa los registros directo (las funciones de pines pesan ~700 bytes)');
    assert(/strcmp\(a, "O"\)/.test(ino) && /pgmPon\(5\)/.test(ino), 'el firmware guarda PADD O');
    assert(/op == 5[^]*?pasoModo\(\)/.test(ino), 'el show corre el modo del segmento');
}

// 23d) Modo dirección: la palanca marca un rumbo y el robot gira hacia él (atrás = da la vuelta, no retrocede)
{
    const D = R.rumboDeJoystick;
    assert.deepStrictEqual(D(0, 1, 100), { grados: 0, v: 180 }, 'arriba: rumbo 0 a toda velocidad');
    assert.deepStrictEqual(D(1, 0, 100), { grados: 90, v: 180 }, 'derecha: 90');
    assert.deepStrictEqual(D(-1, 0, 100), { grados: -90, v: 180 }, 'izquierda: -90');
    assert.deepStrictEqual(D(0, -1, 100), { grados: 180, v: 180 }, 'atrás: 180, es decir, da la vuelta');
    assert.deepStrictEqual(D(0, -1, 60), { grados: 180, v: 108 }, '60 % de 180');
    assert.deepStrictEqual(D(0.05, 0.05, 100), { grados: 0, v: 0 }, 'zona muerta: no se mueve');
    assert.strictEqual(D(0.7, 0.7, 100).grados, 45, 'diagonal a la derecha');
    assert.strictEqual(D(-0.7, -0.7, 100).grados, -135, 'diagonal atrás a la izquierda');
    assert.strictEqual(D(0, 1, 100, R.VEL_TURBO).v, R.VEL_TURBO, 'el turbo sube el tope');
    const O = R.rumboDeOrientacion;
    const cerca = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180) < 0.5;
    assert(cerca(O(0, 0, 0, 0), 0), 'plano con el borde de arriba al norte');
    assert(cerca(O(270, 0, 0, 0), 90), 'plano con el borde de arriba al este');
    assert(cerca(O(0, 90, 0, 0), 0), 'parado: la parte trasera mira al norte');
    assert(cerca(O(90, 90, 0, 0), 270), 'parado y girado a la izquierda: la parte trasera mira al oeste');
    assert(cerca(O(0, 0, 0, 90), 90), 'plano en horizontal: el borde de arriba de la pantalla es el lado derecho del teléfono');
    assert.strictEqual(R.rumboRelativo(170, 30, 0), -160, 'se envuelve a -180..180');
    assert.strictEqual(R.rumboRelativo(10, 0, 10), 0, 'sin girar el teléfono ni la palanca, el rumbo es 0');
    assert.strictEqual(R.rumboRelativo(350, 0, 10), -20, 'si el teléfono giró 20° a la izquierda, el robot también');
    assert.strictEqual(R.rumboRelativo(100, 90, 100), 90, 'la palanca a la derecha, con el teléfono donde se alineó, es 90');
    assert.strictEqual(R.rumboRelativo(190, 90, 100), -180, 'si el teléfono giró 90° a la derecha y la palanca va a la derecha, el robot da la media vuelta (180° = -180°)');
    const ino = fs.readFileSync(path.join(__dirname, '..', 'robot', 'mbot_ranger_web', 'mbot_ranger_web.ino'), 'utf8');
    assert(/\(rumbo \+ 65536L\) >> 17/.test(ino), 'el rumbo sube al girar a la derecha');
    assert(/strcmp\(cmd, "H0"\)/.test(ino) && /strcmp\(cmd, "H1"\)/.test(ino) && /strcmp\(cmd, "H"\) && a && b/.test(ino) && /void rumboMueve/.test(ino), 'el firmware lleva el modo dirección (H0, H1, H)');
    const js = fs.readFileSync(path.join(__dirname, '..', 'robot.js'), 'utf8');
    const ctl = fs.readFileSync(path.join(__dirname, '..', 'js', 'robot-control.js'), 'utf8');
    assert(/addEventListener\('deviceorientationabsolute'/.test(ctl) && /iniciarBrujula\(\);/.test(ctl) && /rumboRelativo\(hayBrujula\(\) \? C\.fiF : C\.fi0, r\.grados, C\.fi0\)/.test(ctl) && /\.es-incl \.rb-estilo \{ display: none; \}/.test(fs.readFileSync(path.join(__dirname, '..', 'css', 'robot.css'), 'utf8')) && /\.es-dir #rb-ctl-ruta, \.rb-mando\.es-dir \.rb-freno \{ display: none; \}/.test(fs.readFileSync(path.join(__dirname, '..', 'css', 'robot.css'), 'utf8')), 'la brújula del teléfono se lee siempre y el rumbo que se manda la usa en cada revisión');
    assert(/id="rb-dir-cal"/.test(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')) && /\$\('rb-dir-cal'\)\.addEventListener\('click', alinearRumbo\)/.test(ctl), 'hay un botón para alinear el teléfono con el robot');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const ctlLF = ctl.replace(/\r/g, '');
    assert(/'H ' \+ grados \+ ' ' \+ v/.test(js) && /rumboDeJoystick/.test(ctl), 'la app manda H con el rumbo de la palanca');
    assert(!/id="rb-dir-on"/.test(html) && /ciclarCel\(\); \}\);/.test(ctl), 'el modo dirección ya no tiene botón propio: es el segundo estado del botón del celular');
    assert(/if \(C\.dirModo\) \{ ponerRumbo\(false\); return; \}\n[^\n]*if \(C\.inclinar\) \{ ponerInclinar\(false\);[^\n]*ponerRumbo\(true\)[^\n]*\n[^\n]*ponerInclinar\(true\);/.test(ctlLF), 'el botón del celular pasa normal → inclinar → dirección → normal');
    assert(/id="rb-estilo"/.test(html) && /const ESTILOS = \['palanca', 'flechas', 'pedales'\]/.test(ctl) && /class="rb-flechas"/.test(html) && /rb-pedales--dir/.test(html) && /rb-pedales--gas/.test(html) && (html.match(/data-pad="/g) || []).length === 12 && ['-1,1', '1,1', '-1,-1', '1,-1'].every(p => html.includes('data-pad="' + p + '" aria-label')), 'hay botón de estilo de control con palanca, flechas (4 + 4 diagonales) y pedales (2 de dirección y 2 de aceleración)');
    assert(/if \(!f\.pad\) suavizar\(m\);/.test(ctl) && /C\.px \+= \(k1\(x\) - C\.px\) \* 0\.4;/.test(ctl), 'la palanca se suaviza y las flechas y pedales aceleran poco a poco');
    assert(/rb-grupo--sesion/.test(html) && /rb-grupo--info/.test(html) && /rb-grupo--herr/.test(html), 'la barra del mando está agrupada en sesión, información y herramientas');
    const fwc = fs.readFileSync(path.join(__dirname, '..', 'robot', 'mbot_ranger_web', 'mbot_ranger_web.ino'), 'utf8').replace(/\r/g, '');
    assert(/void parar\(\) \{[^}]*rumboV = 0;/.test(fwc) && /strcmp\(cmd, "M"\) && a && b\) \{[\s\S]{0,140}rumboV = 0;/.test(fwc), 'cualquier paro o una orden M cancela el control de rumbo del robot');
    assert(/w = rumboW >> 7/.test(fwc) && /\(rumboV \* \(70 - a\)\) >> 6/.test(fwc), 'el rumbo se corrige dentro del robot, con freno por la velocidad de giro');
}

// 23c) El robot solo se controla desde la app: sin Web Serial y con la pestaña oculta en la web
{
    const js = fs.readFileSync(path.join(__dirname, '..', 'robot.js'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert(!/navigator\.serial|requestPort|abrirSerie/.test(js), 'robot.js ya no usa Web Serial');
    assert(/id="tab-ap-robot" data-solo="android"/.test(html), 'la pestaña Robot solo sale en la app');
    assert(!/data-solo="web"/.test(html.slice(html.indexOf('id="sec-robot"'), html.indexOf('class="rb-barra"'))), 'sin instrucciones de USB en la sección del robot');
}

// 23b) Sonido más fuerte: la canción sube de octava entera (mismas notas) hasta que su nota grave pase de ~800 Hz
{
    const { notas } = R.leerNotas('C4/4 E4 G4 C5');                 // 262..523 Hz
    const arriba = R.realzarNotas(notas);
    assert.deepStrictEqual(arriba.map(n => n.hz), notas.map(n => n.hz * 4), 'dos octavas arriba');
    assert(Math.min(...arriba.map(n => n.hz)) >= 800 && Math.max(...arriba.map(n => n.hz)) <= 4500);
    assert.deepStrictEqual(R.realzarNotas(R.leerNotas('C6/4 E6').notas).map(n => n.hz), [1047, 1319], 'ya agudas: sin cambio');
    const conSilencio = R.realzarNotas(R.leerNotas('C4/4 R/4 E4').notas);
    assert.strictEqual(conSilencio[1].hz, 0, 'los silencios no cambian');
    assert.deepStrictEqual(R.realzarNotas([]), []);
    // una canción que abarca mucho rango solo sube lo que cabe (hasta que la más aguda toque ~4,5 kHz)
    const ancha = R.leerNotas('C3/4 C7').notas;                      // 131..2093 Hz
    assert.deepStrictEqual(R.realzarNotas(ancha).map(n => n.hz), [262, 4186]);
}

// 24) Sin seguidor de línea (se hará con el Raptor) y tiempo de carga de las pilas
{
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert(html.includes('id="rb-ln-vel"') && html.includes('id="rb-ln-sensores"'), 'la interfaz lleva los ajustes del seguidor de línea');
    const lin = R.FUNCIONES.find(f => f.id === 'linea');
    assert(lin && lin.modo === 6 && lin.v.includes('raptor'), 'seguir la línea es una función del Raptor con el modo 6');
    const fw = fs.readFileSync(path.join(__dirname, '..', 'robot', 'mbot_ranger_web', 'mbot_ranger_web.ino'), 'utf8');
    assert(/void seguirLinea\(\)/.test(fw) && /strcmp\(cmd, "LINEA"\)/.test(fw) && /strcmp\(cmd, "SENS"\)/.test(fw), 'el firmware lleva el seguidor');
    assert(/esquinaI/.test(fw) && /s == 5 && fase\) ledsTodos\(150, 0, 0\)/.test(fw), 'direccionales en las esquinas y reversa en rojo intermitente');
    assert(/esquinaI\[4\] = \{ 0, 1, 9, 10 \}, esquinaD\[4\] = \{ 3, 4, 6, 7 \}/.test(fw), 'el LED 1 del anillo está 2 lugares a la izquierda del frente: los intermitentes de la derecha son los LED 4, 5, 7 y 8 (índices 3, 4, 6, 7)');
    assert(/strcmp\(cmd, "INFO"\)/.test(fw), 'el firmware contesta INFO cuando se le pide (por Bluetooth no se reinicia al conectar)');
    assert(/enviar\(\['MODE 4', 'INFO'\]\)/.test(fs.readFileSync(path.join(__dirname, '..', 'robot.js'), 'utf8')), 'la página pide INFO al conectar');
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
    const luces = Number(/const int EE_DIR = (\d+);/.exec(ino)[1]);
    assert(dir >= pgm && dir + 4 <= luces, 'la función guardada no pisa el show ni las luces guardadas');
    assert(/if \(modo != 0\) fnEspera = 0;/.test(ino), 'si la página toma el control, la función no arranca sola');
    const js = fs.readFileSync(path.join(__dirname, '..', 'robot.js'), 'utf8');
    assert(/function alListo\(\) \{[^}]*MODE 4/.test(js), 'al conectar, la página frena lo que arranca solo');
}

// 30) Joystick: zona muerta, avance, giro en el sitio, curvas, límite del círculo y velocidad máxima
{
    const J = R.mezclaJoystick;
    assert.deepStrictEqual(J(0, 0, 60), { izq: 0, der: 0 });
    assert.deepStrictEqual(J(0.05, -0.05, 100), { izq: 0, der: 0 }, 'zona muerta');
    assert.deepStrictEqual(J(0, 1, 100), { izq: 180, der: 180 }, 'al frente, a toda velocidad');
    assert.deepStrictEqual(J(0, -1, 100), { izq: -180, der: -180 }, 'hacia atrás');
    assert.deepStrictEqual(J(0, 1, 60), { izq: 108, der: 108 }, '60 % de 180');
    assert.deepStrictEqual(J(1, 0, 100), { izq: 180, der: -180 }, 'a la derecha gira en su sitio');
    assert.deepStrictEqual(J(-1, 0, 100), { izq: -180, der: 180 }, 'a la izquierda gira en su sitio');
    const c = J(0.7, 0.7, 100);
    assert(c.izq > c.der && c.der >= 0 && c.izq <= 180, 'diagonal: avanza curvando a la derecha');
    assert.deepStrictEqual(J(3, 3, 100), J(0.7071, 0.7071, 100), 'fuera del círculo se recorta');
    const suave = J(0.2, 1, 100);
    assert(suave.der >= 160, 'de frente, un roce lateral casi no curva');
    const m = J(0.3, 0.6, 20);
    assert(Math.abs(m.izq) <= 36 && Math.abs(m.der) <= 36, 'vmax 20 % = 36');
    assert.deepStrictEqual(J(NaN, undefined, 60), { izq: 0, der: 0 }, 'valores raros no mueven');
    // hacia atrás es un volante: el robot retrocede hacia donde empujas, así que la rueda de ese lado es la que va más lenta
    const a = J(0.5, -0.9, 100);
    assert(a.izq < a.der && a.der < 0, 'atrás-derecha: la izquierda retrocede más (la parte de atrás se va a la derecha)');
    const b = J(-0.5, -0.9, 100);
    assert(b.der < b.izq && b.izq < 0, 'atrás-izquierda: al revés');
    const d = J(0.5, 0.9, 100);
    assert(d.izq > d.der && d.der > 0, 'adelante-derecha: la izquierda avanza más (curva a la derecha)');
    assert.deepStrictEqual(J(1, -0.1, 100).izq > 0, true, 'casi en el sitio, a la derecha: sigue girando a la derecha');
}

// 31) Cola «último gana» (control en vivo): una sola M en camino y la más reciente reemplaza a la pendiente
{
    const enviadas = [], crudos = [];
    const cola = R.crearCola(l => enviadas.push(l), c => crudos.push(c));
    cola.mover('M 100 100'); cola.mover('M 90 90'); cola.mover('M 80 80'); cola.mover('M 70 70');
    assert.deepStrictEqual(enviadas, ['M 100 100'], 'solo la primera sale; las demás esperan');
    cola.ack();
    assert.deepStrictEqual(enviadas, ['M 100 100', 'M 70 70'], 'tras el OK sale solo la más reciente');
    cola.ack();
    cola.mover('M 0 0');
    assert.strictEqual(enviadas[enviadas.length - 1], 'M 0 0', 'frenar sale al instante si no hay nada en camino');
    // el paro no espera: aborta y borra lo pendiente
    cola.mover('M 50 50'); cola.mover('M 40 40');
    cola.abortar();
    assert.deepStrictEqual(crudos, ['!']);
    cola.abortado();
    assert.strictEqual(cola.ocupado(), false);
    // una M que no se confirma en 1,5 s no bloquea la siguiente
    const e2 = [];
    const c2 = R.crearCola(l => e2.push(l), () => {});
    const ahora = Date.now;
    c2.mover('M 10 10');
    Date.now = () => ahora() + 2000;
    c2.mover('M 20 20');
    Date.now = ahora;
    assert.deepStrictEqual(e2, ['M 10 10', 'M 20 20'], 'una M perdida no traba el control');
}

// 33) Recorridos grabados: el tiempo arranca en la primera orden, siempre termina frenado y lo roto se descarta
{
    const g = R.compactarRecorrido([{ t: 1000, izq: 60, der: 60 }, { t: 1500, izq: 60, der: 60 }, { t: 2000, izq: 30, der: 90 }], 3500, 'Prueba');
    assert.deepStrictEqual(g.pasos, [{ t: 0, izq: 60, der: 60 }, { t: 1000, izq: 30, der: 90 }, { t: 2500, izq: 0, der: 0 }], 'sin repetidas y cerrado con frenado');
    assert.strictEqual(g.ms, 2500);
    const f = R.compactarRecorrido([{ t: 100, izq: 50, der: 50 }, { t: 600, izq: 0, der: 0 }], 5000, 'Frenado');
    assert.strictEqual(f.ms, 500, 'si ya terminó frenado, el silencio final se recorta');
    assert.strictEqual(R.compactarRecorrido([{ t: 0, izq: 0, der: 0 }], 500, 'x'), null, 'sin movimiento no se guarda');
    assert.strictEqual(R.compactarRecorrido([], 500, 'x'), null);
    assert.strictEqual(R.pasoEn(g, 0).izq, 60);
    assert.strictEqual(R.pasoEn(g, 999).izq, 60, 'antes del siguiente paso sigue el anterior');
    assert.strictEqual(R.pasoEn(g, 1000).izq, 30);
    assert.strictEqual(R.pasoEn(g, 9999).izq, 0);
    // lo que viene de localStorage puede estar roto o ser malicioso
    assert.strictEqual(R.validarRecorrido(null), null);
    assert.strictEqual(R.validarRecorrido({ pasos: 'x' }), null);
    const v = R.validarRecorrido({ nombre: 'a'.repeat(99), ms: 'x', pasos: [{ t: 0, izq: 999, der: -999 }, { t: -5, izq: 1, der: 1 }, { t: 'a', izq: 1, der: 1 }, { t: 500, izq: 0, der: 0 }] });
    assert.strictEqual(v.nombre.length, 30);
    assert.deepStrictEqual(v.pasos, [{ t: 0, izq: R.VEL_TURBO, der: -R.VEL_TURBO }, { t: 500, izq: 0, der: 0 }], 'recorta la velocidad y descarta pasos inválidos');
    assert(v.ms >= 500 && v.ms <= R.RECORRIDO_MS);
    const largo = R.validarRecorrido({ ms: 1e9, pasos: [{ t: 0, izq: 50, der: 50 }, { t: 1e9, izq: 0, der: 0 }] });
    assert.strictEqual(largo.pasos.length, 1, 'un paso fuera del tope de duración se descarta');
    assert.strictEqual(largo.ms, R.RECORRIDO_MS);
    assert.strictEqual(R.RECORRIDO_MAX, 10);
}

// 34) Freno por obstáculo: solo hacia adelante, con las dos últimas lecturas cerca y frescas (15 cm; 35 en turbo)
{
    const F = R.frenoPorDistancia;
    assert.deepStrictEqual(F(100, 100, [10, 12], 100, false), { izq: 0, der: 0, cerca: true, bloqueado: true }, 'adelante y a 10 cm: frena');
    assert.strictEqual(F(100, 100, [10, 30], 100, false).bloqueado, false, 'una sola lectura cerca no frena (eco falso)');
    assert.strictEqual(F(100, 100, [20, 20], 100, false).bloqueado, false, 'a 20 cm todavía avanza');
    assert.strictEqual(F(100, 100, [20, 20], 100, true).bloqueado, true, 'en turbo frena desde 35 cm');
    assert.strictEqual(F(-100, -100, [5, 5], 100, false).bloqueado, false, 'atrás siempre se puede');
    assert.deepStrictEqual(F(80, -80, [5, 5], 100, false), { izq: 80, der: -80, cerca: true, bloqueado: false }, 'girar en el sitio se puede');
    assert.strictEqual(F(100, 40, [5, 5], 100, false).bloqueado, true, 'una curva hacia adelante también se bloquea');
    assert.strictEqual(F(100, 100, [5, 5], 5000, false).bloqueado, false, 'lectura vieja: no se sabe, no frena');
    assert.strictEqual(F(100, 100, [400, 400], 100, true).bloqueado, false, '400 = sin eco');
    assert.strictEqual(F(100, 100, [0, 0], 100, false).bloqueado, false, '0 no es una lectura');
    assert.strictEqual(F(100, 100, [5], 100, false).bloqueado, false, 'con una sola lectura todavía no frena');
    assert.strictEqual(F(100, 100, undefined, 0, false).bloqueado, false);
    // el firmware responde a DIST y avisa PARK=1 en INFO: así la página sabe que es el programa de esta versión
    const ino = fs.readFileSync(path.join(__dirname, '..', 'robot', 'mbot_ranger_web', 'mbot_ranger_web.ino'), 'utf8');
    assert(/!strcmp\(cmd, "DIST"\)/.test(ino) && /Serial\.print\(F\("DIST "\)\)/.test(ino), 'DIST en el firmware');
    assert(/F\(" PARK=1/.test(ino), 'INFO avisa PARK=1');
    assert(/!strcmp\(cmd, "DIR"\)/.test(ino) && /!strcmp\(cmd, "LUZ"\)/.test(ino), 'firmware con DIR y LUZ');
    const js = fs.readFileSync(path.join(__dirname, '..', 'robot.js'), 'utf8');
    assert(/\^DIST /.test(js) && /kv\.PARK === 1/.test(js), 'la página lee DIST y PARK=1');
}

console.log('robot.test.js: todo bien');

// 32) Turbo: con tope VEL_TURBO la palanca al frente pide más que con el tope normal, nunca más que VEL_TURBO
{
    assert.strictEqual(R.mezclaJoystick(0, 1, 100).izq, R.VEL_MAX);
    assert.strictEqual(R.mezclaJoystick(0, 1, 100, R.VEL_TURBO).izq, R.VEL_TURBO);
    assert(R.VEL_TURBO > R.VEL_MAX && R.VEL_TURBO <= 255);
    assert.strictEqual(R.mezclaJoystick(0, 1, 100, 9999).izq, R.VEL_TURBO);
    const g = R.mezclaJoystick(1, 0, 100, R.VEL_TURBO);
    assert(g.izq === R.VEL_TURBO && g.der === -R.VEL_TURBO);
}

{
    const S = R.senalesDeMovimiento;
    assert.deepStrictEqual(S(100, 100, false, false), { dir: 'o', luz: 'o' }, 'derecho: sin direccional');
    assert.deepStrictEqual(S(100, 90, false, true), { dir: 'o', luz: 'o' }, 'curva suave: sin direccional');
    assert.deepStrictEqual(S(180, 40, false, true), { dir: 'd', luz: 'o' }, 'giro fuerte a la derecha');
    assert.deepStrictEqual(S(40, 180, false, true), { dir: 'i', luz: 'o' }, 'giro fuerte a la izquierda');
    assert.deepStrictEqual(S(-180, 180, false, true), { dir: 'i', luz: 'o' }, 'giro en el sitio');
    assert.deepStrictEqual(S(0, 0, true, true), { dir: 'x', luz: 'o' }, 'bloqueado por obstáculo: intermitentes');
    assert.deepStrictEqual(S(0, 0, false, true), { dir: 'o', luz: 'o' }, 'al soltar la palanca no se prende ninguna luz roja');
    assert.deepStrictEqual(S(0, 0, false, false), { dir: 'o', luz: 'o' }, 'quieto sin haberse movido: nada');
    assert.strictEqual(S(-100, -100, false, true).luz, 'r', 'reversa');
}

{
    const sumaMs = r => r.ms;
    const sq = R.rutaARecorrido(R.figura('cuadrado', 60), 20, 500);
    assert(sq && sq.pasos.filter(p => p.izq > 0 && p.der < 0).length === 3, 'cuadrado: 3 giros a la derecha (el primer lado ya va de frente)');
    assert(sumaMs(sq) > 4 * 3000, 'cuadrado: 4 lados de 60 cm a 20 cm/s');
    assert.strictEqual(R.rutaARecorrido([{ x: 0, y: 0 }], 20, 500), null, 'un punto no es ruta');
    const izq = R.rutaARecorrido([{ x: 0, y: 0 }, { x: -50, y: 0 }], 20, 500);
    assert(izq.pasos[0].izq < 0 && izq.pasos[0].der > 0, 'a la izquierda gira a la izquierda');
    assert.strictEqual(izq.pasos[0].t === 0 && Math.round(izq.pasos[2].t) >= 500, true, 'girar 90 dura giro90');
    ['circulo', 'cuadrado', 'triangulo', 'estrella'].forEach(f => assert(R.rutaARecorrido(R.figura(f, 60), 20, 500), f));
    assert.strictEqual(R.figura('rombo', 60), null);
    const ida = R.validarRecorrido({ nombre: 'x', ms: 3000, pasos: [{ t: 0, izq: 100, der: 100 }, { t: 1000, izq: 100, der: -100 }, { t: 2000, izq: 0, der: 0 }] });
    const vuelta = R.inversoDeRecorrido(ida.pasos, 3000, 'Casa');
    assert.deepStrictEqual(vuelta.pasos.map(p => [p.t, p.izq, p.der]), [[0, 0, 0], [1000, -100, 100], [2000, -100, -100]], 'el regreso invierte orden y signos');
    assert.strictEqual(R.giroARecorrido(90, 500).ms, 500);
    assert.strictEqual(R.giroARecorrido(-180, 500).pasos[0].izq < 0, true);
    assert.strictEqual(R.movimientoARecorrido(-1, 1000).pasos[0].izq < 0, true);
    const V = R.ordenDeVoz;
    assert.deepStrictEqual(V('avanza'), { a: 'sinNombre' }, 'sin decir Hevy no obedece');
    assert.deepStrictEqual(V('para'), { a: 'sinNombre' });
    assert.deepStrictEqual(V('Hevy'), { a: 'saludo' });
    assert.deepStrictEqual(V('Oye Hevy, para'), { a: 'paro' });
    assert.deepStrictEqual(V('jevi alto ya'), { a: 'paro' }, 'tolera cómo se oye el nombre');
    assert.deepStrictEqual(V('Hevy avanza 2 metros'), { a: 'mover', sentido: 1, cm: 200, s: null });
    assert.deepStrictEqual(V('Hevy por favor avanza dos metros'), { a: 'mover', sentido: 1, cm: 200, s: null }, 'números en palabras');
    assert.deepStrictEqual(V('Hevy avanza medio metro'), { a: 'mover', sentido: 1, cm: 50, s: null });
    assert.deepStrictEqual(V('Hevy ve para atrás tres segundos'), { a: 'mover', sentido: -1, cm: null, s: 3 });
    assert.deepStrictEqual(V('Hevy gira a la izquierda'), { a: 'giro', grados: -90 });
    assert.deepStrictEqual(V('Hevy gira cuarenta y cinco grados a la derecha'), { a: 'giro', grados: 45 });
    assert.deepStrictEqual(V('Hevy gira ciento ochenta grados'), { a: 'giro', grados: 180 });
    assert.deepStrictEqual(V('Hevy a la derecha'), { a: 'giro', grados: 90 });
    assert.deepStrictEqual(V('Hevy da la vuelta'), { a: 'giro', grados: 180 });
    assert.deepStrictEqual(V('Hevy dibuja un círculo'), { a: 'figura', f: 'circulo' });
    assert.deepStrictEqual(V('Hevy hazme una estrella'), { a: 'figura', f: 'estrella' });
    assert.deepStrictEqual(V('Hevy regresa a casa'), { a: 'casa' });
    assert.deepStrictEqual(V('Hevy activa el modo guardia'), { a: 'guardia', on: true });
    assert.deepStrictEqual(V('Hevy desactiva la guardia'), { a: 'guardia', on: false });
    assert.deepStrictEqual(V('Hevy hazme un radar'), { a: 'radar' });
    assert.deepStrictEqual(V('Hevy quita el turbo'), { a: 'turbo', on: false });
    assert.deepStrictEqual(V('Hevy enciende las luces rojas'), { a: 'luces', efecto: 'fijo', color: '#ff2a2a' });
    assert.deepStrictEqual(V('Hevy pon las luces en arcoíris'), { a: 'luces', efecto: 'arcoiris' });
    assert.deepStrictEqual(V('Hevy apaga las luces'), { a: 'luces', efecto: 'fijo', color: '#000000' });
    assert.deepStrictEqual(V('Hevy luces respirando'), { a: 'luces', efecto: 'respirar' });
    assert.deepStrictEqual(V('Hevy inicia la función zigzag'), { a: 'funcion', id: 'zigzag' });
    assert.deepStrictEqual(V('Hevy activa esquivar obstáculos'), { a: 'funcion', id: 'esquivar' });
    assert.deepStrictEqual(V('Hevy modo seguir mi mano'), { a: 'funcion', id: 'mano' });
    assert.deepStrictEqual(V('Hevy sigue la línea'), { a: 'funcion', id: 'linea' });
    assert.deepStrictEqual(V('Hevy deja de seguir la línea'), { a: 'paro' });
    assert.deepStrictEqual(V('Hevy haz círculos'), { a: 'funcion', id: 'circulos' });
    assert.deepStrictEqual(V('Hevy toca estrellita'), { a: 'cancion', id: 'estrellita' });
    assert.deepStrictEqual(V('Hevy pon la canción de la cucaracha'), { a: 'cancion', id: 'cucaracha' });
    assert.deepStrictEqual(V('Hevy reproduce música'), { a: 'cancion', id: null, q: '' });
    assert.deepStrictEqual(V('Hevy toca la canción mi vals'), { a: 'cancion', id: null, q: 'mi vals' });
    assert.deepStrictEqual(V('Hevy detén la música'), { a: 'cancionParar' });
    assert.deepStrictEqual(V('Hevy cuánta batería tienes'), { a: 'bateria' });
    assert.deepStrictEqual(V('Hevy toca el claxon'), { a: 'claxon' });
    assert.deepStrictEqual(V('Hevy qué hora es'), { a: 'charla', t: 'hora' });
    assert.deepStrictEqual(V('Jarvis para'), { a: 'sinNombre' }, 'el nombre viejo ya no sirve');
    assert.deepStrictEqual(V('yokis para'), { a: 'sinNombre' }, 'el nombre anterior ya no sirve');
    assert(!/Yokis/.test(Object.values(R.FRASES).flat().join(' ') + Object.values(R.GROSERAS).flat().join(' ') + R.promptIA(false)), 'ya nadie se llama Yokis');
    assert(/Hevy/.test(R.promptIA(false)) && /GROSERO/.test(R.promptIA(true)) && !/GROSERO/.test(R.promptIA(false)), 'el modo grosero solo va en su prompt');
    assert(/SIEMPRE se obedece/.test(R.promptIA(true)), 'parar siempre obedece, aun en modo grosero');
    assert(R.frase('negarse', null, () => 0, true) !== R.frase('negarse', null, () => 0, false), 'frases groseras aparte');
    assert.strictEqual(R.frase('mover', null, () => 0, true), R.GROSERAS.aceptar[0]);
    assert.strictEqual(R.frase('paro', null, () => 0, true), R.GROSERAS.paro[0]);
    assert.deepStrictEqual(R.validarOrdenIA({ a: 'decir', texto: '  hola, we  ' }), { a: 'decir', texto: 'hola, we' });
    assert.strictEqual(R.validarOrdenIA({ a: 'decir', texto: '' }), null);
    assert.deepStrictEqual(R.validarOrdenIA({ a: 'paro', dice: 'ya paré' }), { a: 'paro', dice: 'ya paré' });
    const plan = R.validarOrdenIA({ a: 'plan', pasos: [{ a: 'mover', sentido: 1, cm: 50 }, { a: 'giro', grados: 90 }, { a: 'decir', texto: 'no' }, { a: 'hack' }], dice: 'a lucirnos' });
    assert.deepStrictEqual(plan.pasos.map(p => p.a), ['mover', 'giro'], 'el plan solo lleva pasos seguros');
    assert.strictEqual(plan.dice, 'a lucirnos');
    assert.strictEqual(R.validarOrdenIA({ a: 'plan', pasos: [{ a: 'plan', pasos: [] }] }), null);
    const unido = R.unirRecorridos([R.movimientoARecorrido(1, 1000), R.giroARecorrido(90, 500)], 'Plan');
    assert(unido && unido.ms === 1500 && unido.pasos.some(p => p.t >= 1000 && p.izq > 0 && p.der < 0), 'unir recorridos los encadena');
    ['hevy', 'hevi', 'jevi', 'jebi', 'hebi', 'heavy', 'evi', 'jevy', 'he vi', 'je bi', 'oye hevi', 'hola jebi'].forEach(n => assert.deepStrictEqual(V(n + ' para'), { a: 'paro' }, 'nombre ' + n));
    ['hebbie', 'jeby', 'yebi', 'hey hevi', 'ey jevi', 'ebi', 'heby', 'jebbi', 'je vi', 'he bi'].forEach(n => assert.deepStrictEqual(V(n + ' para'), { a: 'paro' }, 'oído como ' + n));
    ['hola', 'amigo para', 'yate para', 'ya quiero que pares', 'jarvis avanza'].forEach(n => assert.strictEqual(V(n).a, 'sinNombre', 'sin nombre: ' + n));
    assert.deepStrictEqual(V('jevi abanza dos metros'), V('Hevy avanza dos metros'));
    assert.deepStrictEqual(V('hebi gira a la izquirda'), { a: 'giro', grados: -90 });
    assert.deepStrictEqual(V('hevy enciende la lus roja'), V('Hevy enciende la luz roja'));
    assert.deepStrictEqual(V('Hevy toca la cucarracha'), { a: 'cancion', id: 'cucaracha' });
    assert.strictEqual(V('Hevy avanza dos metros').cm, 200, 'las palabras bien dichas no se tocan');
    assert.strictEqual(R.corregirVocabulario('dos metros y medio'), 'dos metros y medio');
    assert.deepStrictEqual(R.validarOrdenIA({ a: 'luces', efecto: 'fijo', color: 'Rojo' }), V('Hevy luz roja'));
    assert.strictEqual(R.validarOrdenIA({ a: 'borrarTodo' }), null);
    assert.strictEqual(R.validarOrdenIA({ a: 'funcion', id: 'inventada' }), null);
    assert.strictEqual(R.validarOrdenIA({ a: 'luces', efecto: 'fijo', color: 'cafe' }), null);
    assert.strictEqual(R.validarOrdenIA({ a: 'giro', grados: 99999 }).grados, 720);
    assert.deepStrictEqual(R.validarOrdenIA({ a: 'mover', sentido: -1, cm: 'x' }), { a: 'mover', sentido: -1, cm: null, s: null });
    assert.ok(R.promptIA().includes('circulos') && R.promptIA().includes('sinNombre'));
    assert.deepStrictEqual(V('Hevy baila'), { a: 'baile', id: null, cancion: null });
    assert.deepStrictEqual(V('Hevy ponte a bailar'), { a: 'baile', id: null, cancion: null });
    assert.deepStrictEqual(V('Hevy baila el zigzag con estrellita'), { a: 'baile', id: 'zigzag', cancion: 'estrellita' });
    assert.deepStrictEqual(V('Hevy baila la cucaracha'), { a: 'baile', id: 'cucaracha', cancion: 'cucaracha' });
    assert.deepStrictEqual(V('Hevy deja de bailar'), { a: 'paro' });
    assert.deepStrictEqual(V('Hevy cómo estás'), { a: 'charla', t: 'estado' });
    assert.deepStrictEqual(V('Hevy cuéntame un chiste'), { a: 'charla', t: 'chiste' });
    for (const d of ['Hevy tírate un facto', 'jevi tirate un fact', 'Hevy, tírate un fact por favor', 'Hevy dime un dato curioso', 'Hevy dame un dato']) {
        assert.deepStrictEqual(V(d), { a: 'charla', t: 'fact' }, d);
    }
    assert(R.FRASES.fact.length >= 3, 'hay facts de fábrica');
    const extras = fs.readFileSync(path.join(__dirname, '..', 'js', 'robot-extras.js'), 'utf8');
    assert(/function meneoHablar/.test(extras) && /enlace\(\)\.libre\(\)/.test(extras) && /E\.guardia/.test(extras.split('function meneoHablar')[1].split('function iniciarMeneo')[0]), 'Hevy menea al robot al contestar, solo si está libre y sin la guardia armada');
    assert(/hablar\(t \|\| raiz\.Robot\.frase\(tipo, datos, undefined, modo === 'normal' \? false : modo\), tipo === 'paro'\)/.test(extras), 'al decir «para» no se mueve');
    const MODELOS_VOZ_OK = s => !/gemini-3\.8-flash-lite-tts|gemini-2\.5-flash-preview-tts/.test(s);
    const htmlVozIA = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    ['rb-voz-unica', 'rb-ia-llave', 'rb-ia-probar', 'rb-ia-estado', 'rb-gradium-llave'].forEach(id => assert(htmlVozIA.includes('id="' + id + '"') && extras.includes("$('" + id + "')"), 'existe ' + id));
    assert(['normal', 'payaso', 'grosero', 'argentino', 'triste', 'cientifico'].every(m => htmlVozIA.includes('name="rb-modo" value="' + m + '"')) && extras.includes('input[name="rb-modo"]') && /rb-seg--6/.test(htmlVozIA), 'selector de seis personalidades');
    assert(/MODO PAYASO/.test(R.promptIA('payaso')) && !/MODO PAYASO/.test(R.promptIA('grosero')) && !/MODO PAYASO/.test(R.promptIA(false)), 'el modo payaso solo va en su prompt');
    assert(/jajaja/i.test(R.PAYASO.paro[0] + R.PAYASO.aceptar.join('') + R.RISAS.join('')), 'el payaso se ríe');
    assert(R.CHISTES_RANCIOS.length >= 8 && R.CHISTES_RANCIOS.every(c => /ja|ji/i.test(c)), 'chistes rancios con risas');
    assert.strictEqual(R.frase('chiste', null, () => 0, 'payaso'), R.CHISTES_RANCIOS[0]);
    assert.strictEqual(R.frase('mover', null, () => 0, 'payaso'), R.PAYASO.aceptar[0]);
    assert.strictEqual(R.frase('mover', null, () => 0, 'grosero'), R.GROSERAS.aceptar[0]);
    assert.strictEqual(R.frase('mover', null, () => 0, false), R.FRASES.mover[0]);
    assert(/REGLA DE COHERENCIA/.test(R.promptIA(false)) && R.FUNCIONES.every(f => R.promptIA(false).includes(f.id + ': ' + f.nombre)), 'la IA conoce las funciones del robot');
    assert(/Autonomía total/.test(R.promptIA(true)) && /Autonomía:/.test(R.promptIA(false)), 'autonomía en ambos modos');
    const planM = R.validarOrdenIA({ a: 'plan', pasos: [{ a: 'cancion', id: 'estrellita' }, { a: 'baile', id: null, cancion: null }, { a: 'cancionParar' }, { a: 'funcion', id: 'zigzag' }], dice: 'Ahí te va estrellita' });
    assert.deepStrictEqual(planM.pasos.map(p => p.a), ['cancion', 'baile', 'cancionParar'], 'el plan admite música y baile, no funciones');
    const javaDir = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'yokyznt', 'cecyte');
    const clon = fs.readFileSync(path.join(javaDir, 'ClonVozPlugin.java'), 'utf8');
    assert(/@CapacitorPlugin\(name = "ClonVoz"\)/.test(clon) && /api\.gradium\.ai\/api\/voices\//.test(clon) && /x-api-key/.test(clon) && /audio_file/.test(clon) && /"language", "es"/.test(clon), 'plugin nativo que sube la muestra a Gradium');
    assert(/registerPlugin\(ClonVozPlugin\.class\)/.test(fs.readFileSync(path.join(javaDir, 'MainActivity.java'), 'utf8')), 'el plugin de clonar está registrado');
    assert(htmlVozIA.includes('id="rb-gradium-llave"') && /data-acc="clonar"/.test(extras) && /api\.gradium\.ai\/api\/post\/speech\/tts/.test(extras), 'clonar voz con Gradium');
    const orden = extras.slice(extras.indexOf('async function voz(texto)'));
    assert(orden.indexOf('reproducirGrabada(texto)') < orden.indexOf('hablarClon(texto)') && orden.indexOf('hablarClon(texto)') < orden.indexOf('hablarIA(texto)'), 'prioridad: grabada, clon, IA de Gemini, Google, teléfono');
    assert(/translate_tts/.test(extras) && /hevy-voz-ia/.test(extras) && MODELOS_VOZ_OK(extras), 'cadena de voz con caché, sin la voz de pago por frase');
    assert(htmlVozIA.includes('id="rb-voz-unica"') && !/rb-voz-sel|rb-voz-grave|rb-voz-rapido|rb-vozia-voz|rb-local-voz|rb-gradium-voz/.test(htmlVozIA) && /VOCES_GRADIUM/.test(extras), 'un solo menú de voces, sin ajustes de la voz del teléfono');
    assert(/const niveles = \{ live: nivelLive, gradium: nivelGradium, local: hablarLocal \}/.test(extras) && extras.indexOf('await hablarGoogle(texto, turno)') > extras.indexOf('await hablarLocal(texto, turno)'), 'en vivo primero, luego un único respaldo local, y Google solo si falla todo');
    const raizRepo = path.join(__dirname, '..');
    const voz = fs.readFileSync(path.join(javaDir, 'VozLocalPlugin.java'), 'utf8');
    assert(/@CapacitorPlugin\(name = "VozLocal"\)/.test(voz) && /OfflineTts/.test(voz) && /espeak-ng-data/.test(voz) && /NO_WRAP/.test(voz), 'plugin nativo de voz local con sherpa-onnx');
    assert(/registerPlugin\(VozLocalPlugin\.class\)/.test(fs.readFileSync(path.join(javaDir, 'MainActivity.java'), 'utf8')), 'voz local registrada');
    const grad = fs.readFileSync(path.join(raizRepo, 'android', 'app', 'build.gradle'), 'utf8');
    assert(/sherpa-onnx-1\.13\.8/.test(grad) && /abiFilters 'arm64-v8a'/.test(grad), 'gradle: librería de voz local y solo arm64');
    const ign = fs.readFileSync(path.join(raizRepo, '.gitignore'), 'utf8');
    assert(/android\/app\/libs\/\*\.aar/.test(ign) && /assets\/voz\//.test(ign) && /\.cache-voz/.test(ign), 'los binarios de la voz local no se versionan');
    assert(/descargar-voz-local\.js/.test(fs.readFileSync(path.join(raizRepo, 'scripts', 'build-apk.js'), 'utf8')) && /es_MX-ald-medium/.test(fs.readFileSync(path.join(raizRepo, 'scripts', 'descargar-voz-local.js'), 'utf8')), 'el APK baja la voz local antes de compilar');
    assert(/\['gradium', 'live'\]/.test(extras) && /function vozLocalUsada\(\) \{\s+return 'ald';/.test(extras) && !/ajustesLocal/.test(extras), 'la voz elegida va primero; sin internet, la local de hombre');
    assert(/grupo\('Sin internet'/.test(extras) && /grupo\('Mis voces'/.test(extras) && /grupo\('IA de Gradium'/.test(extras) && /grupo\('IA de Google \(Gemini, en vivo\)'/.test(extras), 'todas las voces en un menú');
    assert(/const CLAVES_LOCALES = \{\};/.test(extras) && !/gsk_[0-9a-f]{20,}|AIza[0-9A-Za-z_-]{20,}/.test(extras + htmlVozIA), 'ninguna llave en el código versionado');
    assert(/config\/claves-locales\.json/.test(ign) && /CECYTE_CLAVES/.test(fs.readFileSync(path.join(raizRepo, 'scripts', 'build-www.js'), 'utf8')), 'las llaves personales solo entran con CECYTE_CLAVES=1');
    assert(!/Di en español mexicano|tono de amigo/.test(extras), 'ya no se le pide estilo a Gemini (lo leía en voz alta)');
    assert(/LIVE_PRIMER_AUDIO_MS = 4500/.test(extras) && /LIVE_REINTENTO_MS = 3500/.test(extras) && /for \(let intento = 0; intento < 2; intento\+\+\)/.test(extras) && /VIA\.liveFallos >= 2/.test(extras) && /VIA\.liveHasta = Date\.now\(\) \+ 10000/.test(extras), 'Live: 4,5 s, un reintento con la sesión de repuesto y bloqueo solo tras 2 fallos');
    assert(/gemini-3\.1-flash-live-preview/.test(extras) && /BidiGenerateContent/.test(extras) && /realtimeInput: \{ text: texto \}/.test(extras), 'voz de Gemini en vivo por WebSocket');
    assert(/function cortarLive\(\)/.test(extras) && /function callarIA\(\) \{\s+cortarLive\(\);/.test(extras) && !/s\.usos/.test(extras) && /LIVE\.repuesto/.test(extras), 'interrumpir cambia a la sesión de repuesto y cada frase usa una sesión nueva (la memoria de la sesión hacía improvisar a Gemini)');
    assert(/const sinRed = VIA\.motivo === 'red' \|\| raiz\.navigator\.onLine === false/.test(extras) && /principal !== 'local' && await hablarLocal/.test(extras) && !/nivelGemini|pedirVozIA/.test(extras), 'si Gemini no responde, un único respaldo: la voz local');
    assert(/E\.callado = true;\s+hablar\(d, o\.a === 'paro'\)/.test(extras), 'la voz arranca antes que la acción');
    const javaVoz = fs.readFileSync(path.join(javaDir, 'VozLocalPlugin.java'), 'utf8');
    assert(/VERSION = "2"/.test(javaVoz) && /setNoiseScale\(0\.5f\)/.test(javaVoz) && /borrar\(base\)/.test(javaVoz), 'voz local nueva: datos v2, menos ruido y limpieza');
    assert(/vits-piper-es_MX-ald-medium'/.test(fs.readFileSync(path.join(raizRepo, 'scripts', 'descargar-voz-local.js'), 'utf8')) && !/claude/.test(fs.readFileSync(path.join(raizRepo, 'scripts', 'descargar-voz-local.js'), 'utf8').replace(/rmSync\(path\.join\(VOZ, 'claude'\)/, '')), 'solo la voz de hombre sin cuantizar');
    assert(/function cumplirPromesa/.test(extras) && /NEGACION/.test(extras) && /CRITICAS = \['paro', 'cancionParar', 'bateria'\]/.test(extras), 'lo que dice, lo hace; parar nunca pasa por la IA');
    assert(/gemini-flash-lite-latest/.test(extras) && /gemini-3\.1-flash-live-preview/.test(extras), 'modelos vigentes de voz y texto');
    assert(!/thinkingBudget|gemini-2\.5-flash-lite/.test(extras), 'sin lo que Google ya rechaza');
    assert(/if \(await hablarIA\(texto\)\) return;\s+const TTS/.test(extras), 'si la voz de IA falla, habla la del teléfono');
    assert(Object.values(R.FRASES).flat().every(f => !/\bcompa\b/i.test(f)), 'Hevy dice «we», no «compa»');
    assert.deepStrictEqual(V('Hevy gracias'), { a: 'charla', t: 'gracias' });
    assert.deepStrictEqual(V('Hevy quién eres'), { a: 'charla', t: 'quien' });
    assert.deepStrictEqual(V('Hevy qué puedes hacer'), { a: 'charla', t: 'ayuda' });
    assert.deepStrictEqual(V('Hevy eres el mejor'), { a: 'charla', t: 'elogio' });
    assert.deepStrictEqual(V('Hevy adiós'), { a: 'charla', t: 'adios' });
    assert.strictEqual(V('Hevy cuántos planetas hay'), null);
    for (const tipo of Object.keys(R.FRASES)) assert(R.FRASES[tipo].length && R.FRASES[tipo].every(x => typeof x === 'string' && x.length > 3), 'frases de ' + tipo);
    assert.strictEqual(R.frase('hora', { hora: '7:50 p. m.' }, () => 0), 'Son las 7:50 p. m., we.');
    assert.strictEqual(R.frase('figura', { f: 'una estrella' }, () => 0.99), 'Órale, una estrella va saliendo.');
    assert(R.frase('noExiste').length > 3, 'tipo desconocido: contesta algo');
    const VETADAS = /\b(puto|puta|maric\w+|joto|negro|negra|indio|india|retrasad\w+|mongol\w*|violar|violaci\w+|te mato|matarte|sexo|sexual)\b/i;
    ['saludo', 'estado', 'gracias', 'elogio', 'queja', 'adios', 'quien', 'chiste', 'paro', 'aceptar', 'negarse', 'sinNombre', 'noEntendi', 'nada'].forEach(tipo => {
        assert(R.GROSERAS[tipo].length >= 8 && new Set(R.GROSERAS[tipo]).size === R.GROSERAS[tipo].length, 'diccionario grosero amplio y sin repetidos: ' + tipo);
    });
    assert(Object.values(R.GROSERAS).flat().concat(Object.values(R.ARGENTINO).flat(), R.REMATES_GROSEROS, R.REMATES_ARGENTINOS, R.TRISTE.saludo, R.CIENTIFICO.fact).every(f => !VETADAS.test(f)), 'ni insultos a grupos, ni amenazas, ni sexo explícito');
    assert(R.ARGENTINO.saludo.length >= 5 && /\b(boludo|pelotudo|che)\b/.test(R.ARGENTINO.saludo.join(' ')) && !/\b(wey|cabrón|pinche)\b/i.test(Object.values(R.ARGENTINO).flat().join(' ')), 'el modo argentino habla en argentino, sin mexicanismos');
    assert.strictEqual(R.frase('mover', null, () => 0, 'argentino'), R.ARGENTINO.aceptar[0]);
    assert.deepStrictEqual(V('Hevy ponte argentino'), { a: 'modo', modo: 'argentino' });
    assert(/MODO ARGENTINO DESQUICIADO/.test(R.promptIA('argentino')) && /Grok/.test(R.promptIA('argentino')) && !/MODO ARGENTINO/.test(R.promptIA('grosero')) && R.validarOrdenIA({ a: 'modo', modo: 'argentino' }).modo === 'argentino', 'prompt y acción del modo argentino');
    assert(/IDENTIDAD: tú NO eres un asistente aparte/.test(R.promptIA(false)) && /AUTONOMÍA: no esperas órdenes exactas/.test(R.promptIA(false)) && /sensorFrontal\(\)/.test(extras) && /popup: false/.test(extras) && !/popup: true/.test(extras), 'la IA sabe que es el robot, tiene autonomía, ve el sensor y el micrófono manual no abre la ventana de Google');
    assert(R.REMATES_GROSEROS.length >= 20 && /\bpendejo\b/.test(R.promptIA('grosero')) && /hijo de la chingada/.test(R.promptIA('grosero')), 'el prompt grosero trae vocabulario amplio');
    ['triste', 'cientifico'].forEach(m => {
        const tabla = m === 'triste' ? R.TRISTE : R.CIENTIFICO;
        Object.keys(tabla).forEach(tipo => assert(tabla[tipo].length && tabla[tipo].every(x => typeof x === 'string' && x.length > 8), m + ' ' + tipo));
        assert.strictEqual(R.frase('mover', null, () => 0, m), tabla.aceptar[0]);
        assert.strictEqual(R.frase('fact', null, () => 0, m), tabla.fact[0]);
    });
    assert(/MODO TRISTE/.test(R.promptIA('triste')) && /MODO CIENTÍFICO/.test(R.promptIA('cientifico')) && !/MODO TRISTE|MODO CIENTÍFICO/.test(R.promptIA('payaso')), 'cada modo trae su propio prompt');
    assert(/REGLA DE FACTS, CHISTES Y TRIVIA/.test(R.promptIA(false)) && !R.validarOrdenIA({ a: 'charla', t: 'fact' }) && !R.validarOrdenIA({ a: 'charla', t: 'chiste' }), 'facts y chistes los inventa la IA, no salen enlatados');
    assert.deepStrictEqual(V('Hevy ponte triste'), { a: 'modo', modo: 'triste' });
    assert.deepStrictEqual(V('Hevy modo científico'), { a: 'modo', modo: 'cientifico' });
    assert.deepStrictEqual(V('Hevy cámbiate a payaso'), { a: 'modo', modo: 'payaso' });
    assert.deepStrictEqual(V('Hevy ponte serio'), { a: 'modo', modo: 'normal' });
    assert.deepStrictEqual(R.validarOrdenIA({ a: 'modo', modo: 'grosero' }), { a: 'modo', modo: 'grosero' });
    assert.strictEqual(R.validarOrdenIA({ a: 'modo', modo: 'inventado' }), null);
    assert.deepStrictEqual(V('Hevy tijera'), { a: 'ppt', usuario: 'tijera' });
    assert.deepStrictEqual(V('Hevy juguemos piedra papel o tijera'), { a: 'ppt' });
    assert.deepStrictEqual(R.validarOrdenIA({ a: 'ppt', usuario: 'papel' }), { a: 'ppt', usuario: 'papel' });
    assert.deepStrictEqual(R.validarOrdenIA({ a: 'ppt', usuario: 'lagarto' }), { a: 'ppt' });
    ['pptInvita', 'pptGano', 'pptPerdio', 'pptEmpate', 'aburrido'].forEach(tipo => ['normal', 'grosero', 'triste', 'cientifico'].forEach(m => assert(R.frase(tipo, { mia: 'piedra', tuya: 'papel' }, () => 0, m === 'normal' ? false : m).length > 8, tipo + ' ' + m)));
    assert(/\{mia\}/.test(R.FRASES.pptGano[0]) && /Empate/.test(R.frase('pptEmpate', { mia: 'papel' }, () => 0)), 'frases del juego');
    assert(htmlVozIA.includes('id="rb-solo"') && htmlVozIA.includes('id="rb-escucha"') && htmlVozIA.includes('id="rb-escucha-estado"'), 'interruptores de «por su cuenta»');
    assert(/gemini-3\.5-transcribe-live/.test(extras) && /audio\/pcm;rate=/.test(extras) && /inputTranscription/.test(extras) && /procesarTexto\(\[sinNombre \? 'Hevy ' \+ dicho : dicho\], false, dicho\)/.test(extras), 'escucha continua con transcripción en vivo');
    assert(/E\.hablando \|\| E\.escuchando \|\| Date\.now\(\) < E\.finHabla \+ 600/.test(extras) && /1200000/.test(extras) && /document\.hidden && ESC\.on/.test(extras), 'no se oye a sí mismo y se apaga solo');
    assert(/function iniciarMicrofono\(\)/.test(extras) && /'pointerdown', e => \{\s+largo = false;[\s\S]*?callarIA\(\);/.test(extras) && /\}, 450\);/.test(extras) && /\['pointerup', 'pointerleave'\]\.forEach/.test(extras) && /classList\.add\('is-candado'\)/.test(extras) && /rb-jarvis__candado/.test(htmlVozIA) && /is-candado/.test(fs.readFileSync(path.join(__dirname, '..', 'css', 'robot.css'), 'utf8')), 'mantener el micrófono pone el candado y al pulsar se calla lo que dice');
    assert(/createAnalyser\(\)/.test(extras) && /setProperty\('--nivel'/.test(extras) && /ESC\.ctx\.resume\(\)/.test(extras) && /Escucha: oí «/.test(extras) && /var\(--nivel, 0\)/.test(fs.readFileSync(path.join(__dirname, '..', 'css', 'robot.css'), 'utf8')), 'el botón del micrófono se expande con el nivel de entrada y la escucha deja registro');
    assert(/interimInputTranscription/.test(extras) && /function pintarVivo/.test(extras) && /is-yo is-vivo/.test(extras) && /ESC\.cola\.forEach\(d => ws\.send\(d\)\)/.test(extras) && /else if \(llaveIA\(\)\) encenderEscucha\(true\)/.test(extras) && /rb-escucha-nombre/.test(htmlVozIA) && /is-vivo/.test(fs.readFileSync(path.join(__dirname, '..', 'css', 'robot.css'), 'utf8')), 'un toque usa el mismo motor, lo que dices se escribe en el chat mientras hablas y no se pierde lo primero');
    assert(/silenceDurationMs: 500/.test(extras) && /function juntarTranscripcion/.test(extras) && /\\p\{Script=Latin\}/.test(extras) && /soloNombre \? 2500 : 1100/.test(extras), 'la escucha continua une segmentos, acepta el nombre en otro alfabeto y espera tras decir solo «Hevy»');
    assert(/buaaa/i.test(R.TRISTE.saludo.join('')) && R.TRISTE.saludo.concat(R.TRISTE.estado, R.TRISTE.adios).some(f => /esposa/.test(f)) && /esposa/.test(R.promptIA('triste')) && /sobbing and crying/.test(extras), 'el modo triste llora y se inventa desgracias');
    assert(/ahora - SOLO\.ultimo < 180000/.test(extras) && /SOLO\.bateria < 600000/.test(extras) && /consultarIA\(\[\], false, evento\)/.test(extras), 'reacciona solo con tope de frecuencia');
}

{
    const ids = R.GRUPOS_FN.flatMap(g => g.ids);
    assert.deepStrictEqual([...ids].sort(), R.FUNCIONES.map(f => f.id).sort(), 'cada función está en un solo grupo');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    ['ninguna', ...R.FUNCIONES.map(f => f.id)].forEach(id => assert(html.includes(`id="i-fn-${id}"`), 'icono de ' + id));
    R.VARIANTES.forEach(v => assert(html.includes(`id="i-mod-${v.id}"`), 'icono del modelo ' + v.id));
    ['radar', 'escudo', 'casa', 'fig-circulo', 'fig-cuadrado', 'fig-triangulo', 'fig-estrella'].forEach(i => assert(html.includes(`id="i-${i}"`), 'icono ' + i));
    ['robot-jarvis', 'robot-dibujar', 'robot-funciones'].forEach(sec => assert(html.includes(`id="sec-${sec}"`) && html.includes(`id="tab-${sec}"`), 'sección ' + sec));
    assert(!html.includes('rb-menu-extra') && !html.includes('rb-ctl-extra'), 'el mando ya no lleva el menú de Hevy');
    assert(html.includes('id="rb-baile-panel"') && !html.includes('id="tab-robot-baile"') && !html.includes('id="sec-robot-baile"'), 'el baile es una función de Funciones con su panel de ajustes');
    assert(html.includes('id="i-fn-baile"'), 'icono del baile');
    const nav = fs.readFileSync(path.join(__dirname, '..', 'admin-secciones.js'), 'utf8');
    assert(/'robot-control', 'robot-funciones', 'robot-jarvis', 'robot-dibujar'/.test(nav), 'Funciones va junto a Control');
}

{
    assert.strictEqual(R.RULETA_N, 12);
    assert.deepStrictEqual([0, 1, 2, 3].map(R.ruletaColor), ['rojo', 'negro', 'rojo', 'negro'], 'rojo y negro alternados');
    const plan = R.ruletaPlan(() => 0.5, 3);
    assert.strictEqual(plan.destino, 6);
    assert.strictEqual(plan.inicio, 6);
    assert.strictEqual(R.ruletaPosEn(plan, plan.dur), plan.destino, 'al terminar cae en el destino');
    assert.strictEqual(R.ruletaPosEn(plan, 0), plan.inicio, 'al principio está donde empezó');
    const finales = new Set(), ultimos = [], duraciones = [];
    let aleatorio = 0;
    const gen = () => { aleatorio = (aleatorio * 9301 + 49297) % 233280; return aleatorio / 233280; };
    for (let i = 0; i < 300; i++) {
        const p = R.ruletaPlan(gen, 8);
        finales.add(p.tipo);
        assert.strictEqual(R.ruletaPosEn(p, p.dur), p.destino, 'siempre cae en su destino');
        assert.strictEqual(p.color, R.ruletaColor(p.destino));
        assert.strictEqual(p.num, p.destino + 1);
        for (let k = 1; k < p.pasos.length; k++) assert(p.pasos[k].t > p.pasos[k - 1].t, 'el tiempo siempre avanza');
        const ints = p.pasos.map((x, k) => x.t - (k ? p.pasos[k - 1].t : 0));
        assert(ints[0] < 120, 'arranca rápido');
        ultimos.push(p.pasos[p.pasos.length - 1].t - p.pasos[p.pasos.length - 2].t);
        duraciones.push(p.dur);
    }
    assert.deepStrictEqual([...finales].sort(), ['directo', 'doble', 'rebote'], 'el final cambia: directo, con rebote o con doble saltito');
    assert(Math.max.apply(null, ultimos) - Math.min.apply(null, ultimos) > 200, 'el último saltito dura distinto cada vez');
    assert(Math.max.apply(null, duraciones) < 26000 && Math.min.apply(null, duraciones) > 12000, 'la ruleta normal dura entre 12 y 26 s');
    const lento = R.ruletaPlan(() => 0.99, 8);
    assert(lento.pasos[lento.pasos.length - 1].t - lento.pasos[lento.pasos.length - 2].t < 1300, 'el último saltito nunca se eterniza');
    const col = R.ruletaColores(4, true);
    assert.strictEqual(col.length, 12);
    assert.deepStrictEqual(col[4], [0, 255, 60], 'la bolita es verde');
    assert(col[0][0] > 100 && col[0][1] === 0, 'las casillas pares son rojas');
    assert(col[1][0] < 20 && col[1][1] < 20, 'las impares son negras');
    assert.deepStrictEqual(R.ordenDeVoz('Hevy juega a la ruleta'), { a: 'ruleta' });
    assert.deepStrictEqual(R.ordenDeVoz('Hevy detén la ruleta'), { a: 'paro' });
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert(html.includes('id="rb-ruleta-panel"') && html.includes('id="rb-rul-girar"') && html.includes('id="i-fn-ruleta"'), 'la ruleta tiene panel e icono');
    assert(['rb-voz-unica', 'rb-voz-probar'].every(id => html.includes(`id="${id}"`)), 'Hevy deja elegir su voz en un solo menú');
    const ex = fs.readFileSync(path.join(__dirname, '..', 'js', 'robot-extras.js'), 'utf8');
    assert(/pitch: 0\.75/.test(ex) && /rate: 1\.15/.test(ex), 'voz grave y enérgica por defecto');
}

{
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert(['rb-fn-ventana', 'rb-fn-almacen', 'rb-fn-generico', 'rb-fn-ventana-cuerpo'].every(id => html.includes(`id="${id}"`)), 'los ajustes de cada función van en una ventana');
    const rj = fs.readFileSync(path.join(__dirname, '..', 'robot.js'), 'utf8');
    assert(/function abrirVentanaFuncion/.test(rj) && /previo && c\.querySelector/.test(rj), 'tocar una función elegida abre su ventana');
    assert(/laps \* 2250/.test(rj) && /RULETA_BOLA = \[0, 255, 60\]/.test(rj), 'la ruleta dura más y la bolita es verde');
    assert(/<option value="8" selected>Normal \(18 s\)/.test(html), 'la ruleta normal da 8 vueltas en 18 s');
    assert(['rb-vz-lista', 'rb-ent-abrir', 'rb-ent-ventana', 'rb-ent-prog', 'rb-ent-frase', 'rb-ent-grabar', 'rb-ent-sig', 'rb-ent-onda', 'rb-ent-nombre', 'rb-ent-guardar'].every(id => html.includes(`id="${id}"`)), 'el entrenamiento de voz es un asistente con progreso, grabar, siguiente, onda y nombre');
}

{
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert(['rb-cant-grabar', 'rb-cant-voz', 'rb-cant-nivel', 'rb-cant-tonal', 'rb-cant-oir', 'rb-cant-info'].every(id => html.includes(`id="${id}"`)), 'se puede cantar y convertir la voz en pitidos');
    assert(/id="tab-robot-musica"[^>]*>\s*<svg[^>]*><use href="#i-music"\/><\/svg><span>Audio<\/span>/.test(html), 'la pestaña Música ahora se llama Audio');
    assert(!html.includes('<span>Música</span>'), 'ya no hay pestañas llamadas Música');
    const rj = fs.readFileSync(path.join(__dirname, '..', 'robot.js'), 'utf8');
    assert(/function melodiaDeCanto/.test(rj) && /REGISTROS_CANTO/.test(rj) && /echoCancellation: false/.test(rj), 'la voz cantada se convierte con el rastreador de melodía y sin filtros que alteren el tono');
    const sr = 16000, cantadas = [[392, 0.5], [440, 0.5], [523.25, 0.5], [440, 0.5], [392, 0.7]];
    const x = new Float32Array(Math.floor(cantadas.reduce((a, n) => a + n[1], 0) * sr));
    let pos = 0;
    for (const [f, d] of cantadas) { const n = Math.floor(d * sr); for (let k = 0; k < n; k++, pos++) { const env = Math.min(1, k / 400, (n - k) / 400); x[pos] = 0.5 * env * (Math.sin(2 * Math.PI * f * k / sr) + 0.3 * Math.sin(4 * Math.PI * f * k / sr)); } }
    const melodia = R.melodiaDeAudio(x, sr, { fMin: 120, fMax: 700, sens: 60, tonalidad: true, subir: true });
    assert.deepStrictEqual(melodia.texto.split(' ').map(t => t.split(':')[0]), ['G5', 'A5', 'C6', 'A5', 'G5'], 'una melodía cantada sol-la-do-la-sol sale como cinco pitidos (subida de octava)');
}

{
    const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'robot.css'), 'utf8');
    const marca = css.indexOf('/* App: animaciones.');
    assert(marca > 0, 'hay un bloque de animaciones de la app');
    const bloque = css.slice(marca);
    assert(/@media \(prefers-reduced-motion: no-preference\)/.test(bloque), 'las animaciones respetan «reducir animaciones»');
    ['app-sube', 'app-elige', 'app-pop', 'app-ventana', 'app-resultado', 'app-onda-mic', 'app-burbuja', 'app-frase', 'app-barra', 'app-onda'].forEach(k => assert(bloque.includes('@keyframes ' + k), 'animación ' + k));
    const selectores = bloque.split('\n').map(l => l.trim()).filter(l => /^[.:]/.test(l));
    assert(selectores.length > 20 && selectores.every(l => /^\.(es-app|app-onda)/.test(l)), 'todas las reglas están limitadas a la app (es-app) o a clases que solo crea la app');
    const pl = fs.readFileSync(path.join(__dirname, '..', 'js', 'plataforma.js'), 'utf8');
    assert(/if \(nativo\) document\.documentElement\.classList\.add\('es-app'\)/.test(pl) && /function ondas\(\)/.test(pl), 'la clase es-app y las ondas al tocar solo se activan en el APK');
    assert(/if \(!nativo\) return;\s*ondas\(\);/.test(pl), 'las ondas se registran solo en la app');
}

{
    const ay = fs.readFileSync(path.join(__dirname, '..', 'js', 'ayudas.js'), 'utf8');
    assert(/isNativePlatform/.test(ay), 'en la app no se crean los iconos de información');
    const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'robot.css'), 'utf8');
    assert(/\.es-app p\.hint:not\(\[id\]\):not\(:has\(button, a\)\) \{ display: none; \}/.test(css), 'en la app se esconden los textos de ayuda');
}

{
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert(!html.includes('rb-fn-ventana-cerrar') && html.includes('id="rb-fn-ventana"'), 'el menú de función ya no lleva la X: se cierra tocando fuera');
    const rj = fs.readFileSync(path.join(__dirname, '..', 'robot.js'), 'utf8');
    assert(/origenFuera/.test(rj), 'solo se cierra si el toque empieza y termina fuera de la ventana');
    assert(html.includes('id="rb-estado-fila"'), 'hay una fila para batería y conexión bajo el título del panel');
    const inst = html.slice(html.indexOf('id="sec-robot-instalar"'));
    assert(/data-solo="android">\s*<h4 class="panel__sub">Sesión<\/h4>[\s\S]*logoutAdmin\(\)/.test(inst), 'Cerrar sesión está en Instalar (solo app)');
    const pl = fs.readFileSync(path.join(__dirname, '..', 'js', 'plataforma.js'), 'utf8');
    assert(/function moverEstadoRobot/.test(pl) && /function navAutoOcultar/.test(pl) && /toque\(8\)/.test(pl), 'en la app la batería sube al encabezado, las pestañas se esconden y los toques vibran');
    const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'robot.css'), 'utf8');
    assert(/\.es-app \.admin-head__actions \{ display: none; \}/.test(css) && /\.es-app \.rb-barra__que \{ display: none; \}/.test(css), 'en la app no sale Cerrar sesión arriba y la barra de abajo es compacta');
    assert(/\.es-app \.rb-barra \{[^}]*bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 28px\)/.test(css) && /\.rb-barra \{[^}]*padding: 0; pointer-events: none;/.test(css), 'los botones de parar y reproducir suben un poco para que la barra del teléfono no los tape y van sueltos, sin recuadro');
    const barra = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert(/id="rb-barra-paro"[^>]*rb-barra__cuadro[^>]*><svg[^>]*><use href="#i-stop"\/><\/svg><\/button>/.test(barra) && /id="rb-barra-play"[^>]*rb-barra__cuadro[^>]*><svg[^>]*><use href="#i-play"\/><\/svg><\/button>/.test(barra), 'parar y reproducir son botones cuadrados solo con el símbolo');
    assert(/\.es-app \{ -webkit-user-select: none; user-select: none; \}/.test(css) && /\.es-app, \.es-app \* \{ -webkit-tap-highlight-color: transparent;/.test(css) && /\.es-app ::selection \{ background: transparent; \}/.test(css) && /\.es-app input, \.es-app textarea, \.es-app \[contenteditable\] \{ -webkit-user-select: text;/.test(css), 'en la app no sale el cuadro azul al dejar presionado, pero se puede seleccionar el texto de los cuadros de escribir');
    const rjs = fs.readFileSync(path.join(__dirname, '..', 'robot.js'), 'utf8');
    assert(/S\.leds\[S\.sel\] = b\.dataset\.c;/.test(rjs) && !/S\.leds\.fill\(b\.dataset\.c\)/.test(rjs) && /id="rb-led-ant"/.test(barra) && /id="rb-led-sig"/.test(barra) && /id="rb-led-apagar"/.test(barra), 'tocar un color pinta solo el LED elegido; hay flechas para cambiar de LED y botón para apagarlo');
    assert(/\.rb-paleta \.rb-sw \{[^}]*background: transparent/.test(css), 'los colores de la paleta de luces no heredan el estilo redondo del mando');
    assert(/id="rb-toast"/.test(barra) && /\.rb-barra #rb-msg \{ display: none; \}/.test(css) && /function mensaje\(texto, tipo, rapido\) \{\s*if \(rapido\) aviso\(texto, tipo\);/.test(rjs), 'los mensajes no salen como aviso rápido arriba salvo que se pida, y nunca en la barra de abajo');
    assert((rjs.match(/mensaje\([^;\n]*, true\)/g) || []).length === 2 && /mensaje\('Robot conectado', 'ok', true\)/.test(rjs), 'el único aviso rápido es «Robot conectado», al conectar o al entrar al robot ya conectado');
    assert(/\.rb-barra__cuadro\.is-pulso::after \{ animation: rb-anillo/.test(css) && /classList\.add\('is-pulso'\)/.test(rjs), 'parar y reproducir tienen animación al tocarlos');
    const man = fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
    assert(/android\.permission\.VIBRATE/.test(man), 'la app puede vibrar');
    assert(/pantallaViva\(true, 'ruleta'\)/.test(rj) && /razonesPantalla/.test(fs.readFileSync(path.join(__dirname, '..', 'js', 'robot-control.js'), 'utf8')), 'la pantalla sigue encendida con el mando, la ruleta y las rutas');
}
