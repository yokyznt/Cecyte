// ==================== Robot mBot Ranger (panel de admin) ====================
// La página habla por USB (Web Serial, Chrome o Edge) con el programa robot/mbot_ranger_web.
// Le manda notas, movimientos y colores como líneas de texto y espera el "OK" de cada una.
//
// La primera mitad es lógica pura (leer canciones, compilar a órdenes, cola con confirmaciones)
// y se prueba con `node test/robot.test.js`. La segunda mitad es la interfaz del panel.
// Depende del HTML: la sección #sec-robot de index.html.

(function (raiz) {
'use strict';

const BAUDIOS = 115200;
const VEL_MAX = 180;          // lo mismo que VEL_MAX del firmware
const ARTICULACION = 0.9;     // cuánto de cada nota suena; el resto es el silencio entre notas
const MAX_NOTAS = 600;
const LEDS = 12;
const MAX_ORDEN_MS = 4000;    // el firmware corta cada T y W a 5000 ms; se parten antes
const VENTANA_BYTES = 120;    // lo que puede haber en camino sin OK (el firmware guarda 256)
const VENTANA_ORDENES = 8;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---------- Canciones y baile (texto -> pasos) ----------

const SEMITONO = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DENOMINADORES = [1, 2, 4, 8, 16, 32];

function frecuencia(letra, alt, octava) {
    const midi = (octava + 1) * 12 + SEMITONO[letra.toUpperCase()] + (alt === '#' ? 1 : alt === 'b' ? -1 : 0);
    return Math.round(440 * Math.pow(2, (midi - 69) / 12));
}

// Parte el texto en palabras; "//" comenta hasta el fin de línea y | , ; se ignoran.
function palabras(texto) {
    return String(texto || '').replace(/\/\/.*$/gm, ' ').replace(/[|,;]/g, ' ').split(/\s+/).filter(Boolean);
}

// "C4/8", "F#3/4.", "R/2", "A5:120": la duración se repite hasta que pongas otra.
// /4 = un tiempo, /2 = dos, /8 = medio; ":120" = 120 milisegundos (así salen los ritmos de un audio).
function leerNotas(texto) {
    const notas = [], errores = [];
    let dur = { beats: 1 };
    for (const tok of palabras(texto)) {
        const m = /^(?:([A-Ga-g])([#b]?)(\d)|[Rr])(?:\/(\d+)(\.?)|:(\d+))?$/.exec(tok);
        if (!m) { errores.push(tok); continue; }
        if (m[4] !== undefined) {
            const d = Number(m[4]);
            if (!DENOMINADORES.includes(d)) { errores.push(tok); continue; }
            dur = { beats: (4 / d) * (m[5] === '.' ? 1.5 : 1) };
        } else if (m[6] !== undefined) {
            const ms = Number(m[6]);
            if (ms < 10 || ms > 60000) { errores.push(tok); continue; }
            dur = { ms };
        }
        notas.push({ nombre: tok, hz: m[1] ? frecuencia(m[1], m[2], Number(m[3])) : 0, ...dur });
        if (notas.length >= MAX_NOTAS) { errores.push('…'); break; }
    }
    return { notas, errores };
}

// Movimientos: [rueda izquierda, rueda derecha] en múltiplos de la velocidad (positivo = adelante)
// CI / CD: avanzar en curva (la rueda de ese lado va al 40 %); sirven para círculos y eses.
const MOVIMIENTOS = { AD: [1, 1], AT: [-1, -1], GI: [-1, 1], GD: [1, -1], PA: [0, 0], CI: [0.4, 1], CD: [1, 0.4] };

// "AD/2 GI/4 PA/4": adelante, atrás, gira izquierda, gira derecha, parar. Misma duración que las notas.
function leerBaile(texto) {
    const pasos = [], errores = [];
    let denom = 4, punto = false;
    for (const tok of palabras(texto)) {
        const m = /^(AD|AT|GI|GD|PA|CI|CD)(?:\/(\d+)(\.?))?$/i.exec(tok);
        if (!m) { errores.push(tok); continue; }
        if (m[2] !== undefined) {
            const d = Number(m[2]);
            if (!DENOMINADORES.includes(d)) { errores.push(tok); continue; }
            denom = d;
            punto = m[3] === '.';
        }
        pasos.push({ mov: m[1].toUpperCase(), beats: (4 / denom) * (punto ? 1.5 : 1) });
        if (pasos.length >= MAX_NOTAS) { errores.push('…'); break; }
    }
    return { pasos, errores };
}

// Junta canción y baile en una sola lista de órdenes en orden de tiempo.
//   luz(i, hz) -> texto de 72 hex (los 12 LEDs) o null; se manda al empezar cada nota.
//   continuo: no termina con S (parar), para que una repetición siga de corrido sin frenar entre vueltas.
// Devuelve { cmds: [{ l, ms, ex }], ms }. ex = orden de LEDs (va sola, sin nada detrás hasta su OK).
function compilar({ notas = [], pasos = [], bpm = 120, vel = 110, luz = null, continuo = false }) {
    const beatMs = 60000 / clamp(Number(bpm) || 120, 30, 300);
    const v = clamp(Math.round(Number(vel) || 0), 0, VEL_MAX);
    const R = Math.round;

    // Sonido: segmentos [a, b) en ms enteros; cada nota suena ARTICULACION y luego calla.
    // Los tiempos se redondean absolutos para que el error no se acumule.
    const son = [];
    let t = 0;
    notas.forEach((n, i) => {
        const dur = n.ms !== undefined ? n.ms : n.beats * beatMs;
        const suena = n.hz > 0 ? (dur >= 100 ? dur * ARTICULACION : dur) : 0;
        if (n.hz > 0) son.push({ a: R(t), b: R(t + suena), hz: clamp(n.hz, 40, 8000), i });
        const ini = R(t + suena), fin = R(t + dur);
        if (fin > ini) son.push({ a: ini, b: fin, hz: 0, i: null });
        t += dur;
    });
    let total = R(t);

    // Baile: se repite hasta cubrir la canción (o una vuelta si no hay canción).
    const baile = [];
    const ciclo = pasos.reduce((s, p) => s + p.beats * beatMs, 0);
    if (ciclo > 0) {
        const limite = total > 0 ? total : R(ciclo);
        for (let c = 0; c * ciclo < limite && baile.length < 4000; c++) {
            let u = c * ciclo;
            for (const p of pasos) {
                const a = R(u), b = Math.min(R(u + p.beats * beatMs), limite);
                if (b > a) baile.push({ a, b, mov: p.mov });
                u += p.beats * beatMs;
                if (u >= limite) break;
            }
        }
        if (total === 0) total = limite;
    }

    const cortes = new Set([0, total]);
    for (const s of son.concat(baile)) { cortes.add(s.a); cortes.add(s.b); }
    const orden = [...cortes].filter(x => x >= 0 && x <= total).sort((x, y) => x - y);

    const cmds = [];
    let movPrev = null;
    for (let k = 0; k + 1 < orden.length; k++) {
        const a = orden[k], b = orden[k + 1];
        const s = son.find(x => x.a <= a && a < x.b);
        const d = baile.find(x => x.a <= a && a < x.b);
        if (luz && s && s.hz > 0 && s.a === a) {
            const h = luz(s.i, s.hz);
            if (h) cmds.push({ l: 'LS ' + h, ms: 0, ex: true });
        }
        if (d && d.mov !== movPrev) {
            movPrev = d.mov;
            const [l, r] = MOVIMIENTOS[d.mov];
            cmds.push({ l: `M ${R(l * v)} ${R(r * v)}`, ms: 0 });
        }
        for (let resta = b - a; resta > 0; resta -= MAX_ORDEN_MS) {
            const ms = Math.min(resta, MAX_ORDEN_MS);
            cmds.push(s && s.hz > 0 ? { l: `T ${s.hz} ${ms}`, ms } : { l: `W ${ms}`, ms });
        }
    }
    if (baile.length && !continuo) cmds.push({ l: 'S', ms: 0 });
    return { cmds, ms: total };
}

// ---------- Cola con confirmaciones ----------
// Cada orden se confirma con una línea OK/ERR. Se mandan varias seguidas (para que no haya huecos
// entre notas) sin pasarse de VENTANA_BYTES. Las de LEDs van solas porque mientras el robot
// dibuja el anillo no oye el USB. "!" (abortar) corta todo y se espera su "ABORTED".

function crearCola(escribir, crudo) {
    let pend = [], vuelo = [], abortando = false, alFinal = null, timerAborto = null, ultimoMov = Date.now();

    function bombear() {
        if (abortando) return;
        while (pend.length) {
            const c = pend[0], n = c.l.length + 1;
            const bytes = vuelo.reduce((s, x) => s + x.n, 0);
            if (vuelo.length && (c.ex || vuelo[vuelo.length - 1].ex)) break;
            if (vuelo.length >= VENTANA_ORDENES || (vuelo.length && bytes + n > VENTANA_BYTES)) break;
            pend.shift();
            vuelo.push({ n, ex: !!c.ex, c });
            escribir(c.l);
        }
        if (!pend.length && !vuelo.length && alFinal) {
            const f = alFinal;
            alFinal = null;
            f();
        }
    }

    function soltar() {
        abortando = false;
        clearTimeout(timerAborto);
        pend = []; vuelo = []; alFinal = null;
    }

    return {
        enviar(cmds, fin) {
            pend = pend.concat(cmds.map(c => (typeof c === 'string' ? { l: c } : c)));
            if (fin) alFinal = fin;
            if (!vuelo.length) ultimoMov = Date.now();
            bombear();
        },
        // err = el robot contestó ERR. Una orden de luces o de ajuste que llegó rota se reintenta una
        // vez (el USB puede perder un byte mientras el robot dibuja el anillo); las que llevan
        // tiempo (T, W, M) no, porque repetirlas descuadraría la canción. Devuelve true si reintentó.
        ack(err) {
            if (abortando || !vuelo.length) return false;
            ultimoMov = Date.now();
            const e = vuelo.shift();
            const reintentar = !!err && !e.c.reint && /^(FX|SAVE|MODE|LS|L|S|VOL|LINEA)( |$)/.test(e.c.l);
            if (reintentar) pend.unshift(Object.assign({}, e.c, { reint: 1 }));
            bombear();
            return reintentar;
        },
        abortar() {
            pend = []; vuelo = []; alFinal = null;
            if (abortando) return;
            abortando = true;
            crudo('!');
            timerAborto = setTimeout(soltar, 1500);   // si el robot no contesta, seguimos igual
            if (timerAborto.unref) timerAborto.unref();
        },
        abortado() { soltar(); },
        ocupado() { return abortando || pend.length > 0 || vuelo.length > 0; },
        // ms desde la última orden confirmada; sirve para detectar que el robot dejó de contestar
        sinNovedad() { return vuelo.length > 0 && !abortando ? Date.now() - ultimoMov : 0; },
        reiniciar() { soltar(); },
    };
}

// Junta los pedazos que llegan por USB en líneas completas (sin el basura que sale al reiniciar).
function crearLector(alLinea) {
    let resto = '';
    return function (trozo) {
        resto += trozo;
        const partes = resto.split('\n');
        resto = partes.pop();
        if (resto.length > 400) resto = '';
        for (const p of partes) {
            const l = p.replace(/\r/g, '').replace(/^[^\x20-\x7e]+/, '').trim();
            if (l) alLinea(l);
        }
    };
}

// ---------- LEDs ----------

function hsv(h, s, v) {
    const i = Math.floor(h * 6) % 6, f = h * 6 - Math.floor(h * 6);
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
    return [r * 255, g * 255, b * 255];
}

function hexARgb(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 12 colores [r,g,b] -> "RRGGBB" x 12 con el brillo (0 a 100) aplicado
function marcoHex(colores, brillo) {
    const k = clamp(brillo, 0, 100) / 100;
    return colores.slice(0, LEDS).map(c => c.map(x => clamp(Math.round(x * k), 0, 255).toString(16).padStart(2, '0')).join('')).join('');
}

// Los efectos corren solos en el robot (también mientras suena una nota), así las luces siguen
// su flujo y no hay que mandarle cuadros uno por uno. Modo FX = número que entiende el firmware.
const MODOS_FX = { fijo: 0, arcoiris: 1, respirar: 2, persecucion: 3, musica: 4 };

// Orden FX: los 12 colores base van sin brillo y el robot aplica el brillo (0 a 100).
// vel (opcional) = velocidad del efecto en % (20 a 300, 100 = normal); un robot con programa viejo la ignora.
function fxLinea(nombre, brillo, colores, vel) {
    const m = MODOS_FX[nombre] !== undefined ? MODOS_FX[nombre] : 0;
    const v = vel === undefined ? '' : ' ' + Math.round(clamp(Number(vel) || 100, 20, 300));
    return `FX ${m} ${Math.round(clamp(Number(brillo) || 0, 0, 100))} ${marcoHex(colores, 100)}${v}`;
}

// ---------- Teclado: grabar notas tocadas en tiempo real ----------
// eventos: [{ n: 'C#4', s, e }] en ms desde la primera tecla, uno detrás de otro (el zumbador toca una
// nota a la vez). Devuelve el texto de notas con milisegundos y los intervalos [inicio, fin] de cada una.
function grabacionATexto(eventos) {
    const fichas = [], intervalos = [];
    let fin = 0;
    for (const ev of eventos) {
        const ini = Math.round(ev.s), dur = clamp(Math.round(ev.e - ev.s), 10, 60000);
        const hueco = ini - fin;
        if (fichas.length && hueco >= 30) fichas.push('R:' + Math.min(hueco, 60000));
        fichas.push(`${ev.n}:${dur}`);
        intervalos.push([ini, ini + dur]);
        fin = ini + dur;
    }
    return { texto: fichas.join(' '), notas: eventos.length, ms: fin, intervalos };
}

// Semitonos sobre la tecla Z (C de la octava elegida) de cada tecla del teclado de la computadora:
// dos filas como en un piano (Z X C V B N M con S D G H J, y Q W E R T Y U con 2 3 5 6 7).
const TECLAS_PIANO = {
    KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
    KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
    KeyI: 24,
};

// ---------- Biblioteca ----------
// Solo melodías tradicionales o de dominio público. Duraciones: /4 = un tiempo, /8 = medio, /2 = dos.

const CANCIONES = [
    { id: 'estrellita', nombre: 'Estrellita', bpm: 110, texto:
        'C4/4 C4 G4 G4 A4 A4 G4/2  F4/4 F4 E4 E4 D4 D4 C4/2\n' +
        'G4/4 G4 F4 F4 E4 E4 D4/2  G4/4 G4 F4 F4 E4 E4 D4/2\n' +
        'C4/4 C4 G4 G4 A4 A4 G4/2  F4/4 F4 E4 E4 D4 D4 C4/2' },
    { id: 'cumple', nombre: 'Cumpleaños feliz', bpm: 120, texto:
        'G4/8. G4/16 A4/4 G4 C5 B4/2  G4/8. G4/16 A4/4 G4 D5 C5/2\n' +
        'G4/8. G4/16 G5/4 E5 C5 B4 A4  F5/8. F5/16 E5/4 C5 D5 C5/2' },
    { id: 'cucaracha', nombre: 'La Cucaracha', bpm: 130, texto:
        'C4/8 C4 C4 F4/4 A4/2  C4/8 C4 C4 F4/4 A4/2\n' +
        'F4/4 F4/8 E4/4 E4/8 D4/4 D4/8 C4/2' },
    { id: 'alegria', nombre: 'Oda a la Alegría', bpm: 120, texto:
        'E4/4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4/4. D4/8 D4/2\n' +
        'E4/4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4/4. C4/8 C4/2' },
    { id: 'jingle', nombre: 'Jingle Bells', bpm: 140, texto:
        'E4/4 E4 E4/2  E4/4 E4 E4/2  E4/4 G4 C4/4. D4/8 E4/1\n' +
        'F4/4 F4 F4/4. F4/8  F4/4 E4 E4 E4/8 E4  E4/4 D4 D4 E4 D4/2 G4/2' },
    { id: 'elisa', nombre: 'Para Elisa', bpm: 130, texto:
        'E5/8 D#5 E5 D#5 E5 B4 D5 C5 A4/4 R/8 C4 E4 A4 B4/4 R/8 E4 G#4 B4 C5/4 R/8' },
    { id: 'santiago', nombre: 'Fray Santiago', bpm: 120, texto:
        'C4/4 D4 E4 C4  C4 D4 E4 C4  E4 F4 G4/2  E4/4 F4 G4/2\n' +
        'G4/8 A4 G4 F4 E4/4 C4  G4/8 A4 G4 F4 E4/4 C4  C4/4 G3 C4/2  C4/4 G3 C4/2' },
    { id: 'escala', nombre: 'Escala (para afinar)', bpm: 100, texto:
        'C4/4 D4 E4 F4 G4 A4 B4 C5/2' },
];

const BAILES = [
    { id: 'vaiven', nombre: 'Vaivén', texto: 'AD/2 AT/2' },
    { id: 'trompo', nombre: 'Trompo', texto: 'GI/2 GD/2' },
    { id: 'zigzag', nombre: 'Zigzag', texto: 'AD/4 GI/4 AD/4 GD/4' },
    { id: 'cucaracha', nombre: 'Cucaracha', texto: 'AD/4 PA/4 AT/4 PA/4 GI/2 GD/2' },
    { id: 'quieto', nombre: 'Solo luces (sin moverse)', texto: '' },
];

// ---------- Funciones por modelo ----------
// Los tres modelos del kit mBot Ranger llevan la misma placa (Me Auriga con giroscopio, luz y sonido, y
// los módulos de ultrasonido y de línea), así que se programan igual; cambia lo que luce en cada uno.
// pasos: "movimiento segundos", o "GI 90°" con grados (se calibra con giro90, lo que tarda en girar 90°).
// modo: la hace el propio robot con su sensor ultrasónico (modos 1 y 2 de su programa, sin la página).
const VARIANTES = [
    { id: 'tanque', nombre: 'Land Raider (tanque)', nota: 'Orugas: tiene mucha fuerza y gira sobre su propio eje, pero es lento.' },
    { id: 'raptor', nombre: 'Dashing Raptor (carro de carreras)', nota: 'Tres ruedas: es el más rápido; luce más en curvas abiertas que girando en su sitio.' },
    { id: 'pajaro', nombre: 'Nervous Bird (autoequilibrado)', nota: 'Se mantiene en pie con el giroscopio de la placa. El programa que hoy lleva el robot no incluye ese equilibrio: aquí solo hay movimientos suaves, para probarlos con el robot sujeto o con la velocidad baja.' },
];

const FUNCIONES = [
    { id: 'avanzar', v: ['tanque', 'raptor', 'pajaro'], nombre: 'Seguir avanzando', desc: 'Avanza en línea recta sin parar hasta que pulses Paro.', pasos: 'AD 4' },
    { id: 'esquivar', v: ['tanque', 'raptor'], nombre: 'Esquivar obstáculos', desc: 'Avanza solo; si algo está a menos de 20 cm, retrocede y gira hacia un lado al azar. Usa su sensor ultrasónico.', modo: 1 },
    { id: 'mano', v: ['tanque', 'raptor'], nombre: 'Seguir mi mano', desc: 'Se acerca si tu mano está entre 12 y 40 cm, retrocede si la pones a menos de 8 cm y se queda quieto si no hay nada.', modo: 2 },
    { id: 'linea', v: ['tanque', 'raptor'], nombre: 'Seguir la línea', desc: 'Sigue una línea negra (o blanca) en el piso con el módulo Me Line Follower; sus ajustes salen más abajo.', modo: 6, linea: true },
    { id: 'cuadrado', v: ['tanque', 'raptor'], nombre: 'Patrulla cuadrada', desc: 'Avanza, gira 90° y repite: recorre un cuadrado una y otra vez.', pasos: 'AD 1.5 GD 90°' },
    { id: 'idavuelta', v: ['tanque'], nombre: 'Ida y vuelta', desc: 'Avanza 2 s, para, retrocede 2 s y vuelve a empezar, como un guardia en su pasillo.', pasos: 'AD 2 PA 0.5 AT 2 PA 0.5' },
    { id: 'vigilante', v: ['tanque'], nombre: 'Vigilante', desc: 'Sin moverse del sitio, barre a un lado y al otro con pausas, como mirando que todo esté bien.', pasos: 'GI 45° PA 1 GD 90° PA 1 GI 45° PA 1' },
    { id: 'trompo', v: ['tanque'], nombre: 'Trompo', desc: 'Gira sobre su propio eje, 3 s para cada lado, sin parar.', pasos: 'GI 3 GD 3' },
    { id: 'zigzag', v: ['tanque', 'raptor'], nombre: 'Zigzag', desc: 'Avanza haciendo eses, una curva a la izquierda y otra a la derecha.', pasos: 'CI 1 CD 1' },
    { id: 'arrancon', v: ['raptor'], nombre: 'Arrancón y vuelta', desc: 'Acelera en recta, da la vuelta en U, regresa y vuelve a dar la vuelta.', pasos: 'AD 2 PA 0.5 GD 180° AD 2 PA 0.5 GI 180°' },
    { id: 'circulos', v: ['raptor'], nombre: 'Círculos', desc: 'Da vueltas en círculo hacia la izquierda. Si no cierra bien, ajusta la velocidad.', pasos: 'CI 8' },
    { id: 'ocho', v: ['raptor'], nombre: 'Ocho', desc: 'Un círculo a la izquierda y otro a la derecha, dibujando un ocho.', pasos: 'CI 5 CD 5' },
    { id: 'slalom', v: ['raptor'], nombre: 'Slalom', desc: 'Curvas cortas alternadas con un tramo recto, como esquivando conos.', pasos: 'CI 0.6 CD 1.2 CI 0.6' },
    { id: 'derrape', v: ['raptor'], nombre: 'Derrape', desc: 'Avanza un momento y da un giro completo en su sitio, a toda velocidad.', pasos: 'AD 1 GI 360° PA 0.5' },
    { id: 'picoteo', v: ['pajaro'], nombre: 'Pajarito nervioso', desc: 'Pasitos cortos hacia delante y hacia atrás, como si picoteara.', pasos: 'AD 0.15 AT 0.15 AD 0.15 AT 0.15 AD 0.15 AT 0.15 PA 1.2' },
    { id: 'paso', v: ['pajaro'], nombre: 'Paso de pájaro', desc: 'Da un pasito, se queda quieto un rato y vuelve a dar otro.', pasos: 'AD 0.8 PA 1.5' },
    { id: 'mirada', v: ['pajaro'], nombre: 'Mirar a los lados', desc: 'Gira un poco a un lado, luego al otro y regresa al centro.', pasos: 'GI 20° PA 0.8 GD 40° PA 0.8 GI 20° PA 1.2' },
];

// Pasos de una función ya en tiempos del bpm dado (para que compilar() los pueda mezclar con una canción)
// y repetidos hasta cubrir al menos minS segundos, así la página no tiene que reiniciarlos a cada rato.
function pasosDeFuncion(texto, giro90 = 500, bpm = 120, minS = 30) {
    const base = [];
    for (const m of String(texto).matchAll(/\b(AD|AT|GI|GD|PA|CI|CD)\s+(\d+(?:\.\d+)?)(°?)/g)) {
        const n = Number(m[2]);
        base.push({ mov: m[1], s: m[3] ? n / 90 * giro90 / 1000 : n });
    }
    const ciclo = base.reduce((a, p) => a + p.s, 0);
    if (!(ciclo > 0)) return [];
    const veces = Math.min(200, Math.max(1, Math.ceil(minS / ciclo)));
    const porSegundo = bpm / 60;
    const pasos = [];
    for (let i = 0; i < veces; i++) for (const p of base) pasos.push({ mov: p.mov, beats: p.s * porSegundo });
    return pasos;
}

const EFECTOS = [
    ['fijo', 'Colores fijos'], ['arcoiris', 'Arcoíris giratorio'], ['respirar', 'Respirar'],
    ['persecucion', 'Persecución'], ['musica', 'Cambia con cada nota'],
];

// Colores rápidos: cada canal vale 0, 128 o 255 para que el LED muestre justo ese color.
// El brillo se aplica después, al mandarlo, y no los mezcla.
const PALETA = [
    ['#ff0000', 'Rojo'], ['#ff8000', 'Naranja'], ['#ffff00', 'Amarillo'], ['#00ff00', 'Verde'],
    ['#00ffff', 'Cian'], ['#0000ff', 'Azul'], ['#8000ff', 'Morado'], ['#ffffff', 'Blanco'], ['#000000', 'Apagado'],
];
const COLOR_INICIAL = '#00ff00';

// Tonos con los que suenan los golpes de un ritmo. "Alterna" cambia de tono en cada golpe, y así
// el efecto de luces "por nota" también cambia de color.
const TONOS_RITMO = {
    alterna: ['C5', 'E5', 'G5', 'C6'],
    agudo: ['A5'],
    grave: ['A4'],
};

// [[inicio, fin], ...] en ms -> texto de notas con duración en milisegundos: "C5:120 R:300 E5:90"
function ritmoATexto(intervalos, tonos = TONOS_RITMO.alterna) {
    const out = [];
    let t = 0, k = 0;
    for (const [s, e] of intervalos) {
        if (out.length >= MAX_NOTAS - 2) break;
        const pausa = Math.round(s - t);
        if (pausa >= 10) out.push('R:' + Math.min(pausa, 60000));
        const dur = Math.min(60000, Math.max(10, Math.round(e - s)));
        out.push(`${tonos[k++ % tonos.length]}:${dur}`);
        t = Math.max(t, s) + dur;
    }
    return out.join(' ');
}

// ---------- Melodía de un audio o de un MIDI ----------
// El buzzer toca una nota a la vez, así que de una canción se queda la línea principal (la voz o el
// instrumento que más se oye): el pico dominante del espectro entre fMin y fMax en cada instante.
// Luego se suaviza, se ajusta a la tonalidad (se quitan las notas desafinadas) y se sube al registro
// donde el buzzer suena mejor.

const NOMBRES_NOTA = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOMBRES_TONICA = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const nombreMidi = m => NOMBRES_NOTA[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const ESCALA_MAYOR = [0, 2, 4, 5, 7, 9, 11];
const MIDI_OBJETIVO = 79;         // La mediana de la melodía cae cerca de Sol5 (784 Hz), donde el buzzer se oye bien

function fftEnSitio(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { const a = re[i]; re[i] = re[j]; re[j] = a; const b = im[i]; im[i] = im[j]; im[j] = b; }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), medio = len >> 1;
        for (let i = 0; i < n; i += len) {
            let cr = 1, ci = 0;
            for (let j = 0; j < medio; j++) {
                const ur = re[i + j], ui = im[i + j];
                const xr = re[i + j + medio], xi = im[i + j + medio];
                const vr = xr * cr - xi * ci, vi = xr * ci + xi * cr;
                re[i + j] = ur + vr; im[i + j] = ui + vi;
                re[i + j + medio] = ur - vr; im[i + j + medio] = ui - vi;
                const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
            }
        }
    }
}

// midi: un valor por cuadro (NaN = silencio) -> texto de notas con milisegundos. Es el último paso
// de la melodía, y lo comparten el audio y el MIDI.
function melodiaATexto(midi, hopMs, op) {
    const o = Object.assign({ minNotaMs: 90, tonalidad: true, subir: true }, op);
    const n = midi.length;
    const q = Array.from(midi, v => (Number.isNaN(v) ? NaN : Math.round(v)));

    // tonalidad: la escala mayor que más cuadros cubre (Do mayor = La menor, etc.)
    const cuentas = new Array(12).fill(0);
    q.forEach(m => { if (!Number.isNaN(m)) cuentas[((m % 12) + 12) % 12]++; });
    let tonica = 0, mejor = -1;
    for (let t = 0; t < 12; t++) {
        const cubre = ESCALA_MAYOR.reduce((s, g) => s + cuentas[(t + g) % 12], 0);
        if (cubre > mejor) { mejor = cubre; tonica = t; }
    }
    const enEscala = new Set(ESCALA_MAYOR.map(g => (tonica + g) % 12));
    if (o.tonalidad) {
        for (let f = 0; f < n; f++) {
            const m = q[f];
            if (Number.isNaN(m) || enEscala.has(((m % 12) + 12) % 12)) continue;
            const abajo = enEscala.has((((m - 1) % 12) + 12) % 12), arriba = enEscala.has((((m + 1) % 12) + 12) % 12);
            // si las dos vecinas valen, se queda con la que más suena en la canción
            q[f] = abajo && arriba
                ? (cuentas[(((m - 1) % 12) + 12) % 12] >= cuentas[(((m + 1) % 12) + 12) % 12] ? m - 1 : m + 1)
                : abajo ? m - 1 : arriba ? m + 1 : m;
        }
    }

    // cuadros iguales seguidos -> tramos
    let tramos = [];
    for (let f = 0; f < n; f++) {
        const t = tramos[tramos.length - 1];
        if (t && ((Number.isNaN(t.m) && Number.isNaN(q[f])) || t.m === q[f])) t.n++;
        else tramos.push({ m: q[f], n: 1 });
    }
    // quita notas demasiado cortas (se funden con la vecina más cercana) y huecos mínimos
    const minF = Math.max(1, Math.round(o.minNotaMs / hopMs));
    const huecoF = Math.max(1, Math.round(50 / hopMs));
    for (let pasada = 0; pasada < 3; pasada++) {
        for (let i = 0; i < tramos.length; i++) {
            const r = tramos[i];
            if (!Number.isNaN(r.m) && r.n < minF) {
                const vec = [tramos[i - 1], tramos[i + 1]].filter(t => t && !Number.isNaN(t.m));
                r.m = vec.length ? vec.sort((a, b) => Math.abs(a.m - r.m) - Math.abs(b.m - r.m))[0].m : NaN;
            } else if (Number.isNaN(r.m) && r.n < huecoF && i > 0 && i < tramos.length - 1) {
                r.m = tramos[i - 1].m;
            }
        }
        tramos = tramos.reduce((out, r) => {
            const t = out[out.length - 1];
            if (t && ((Number.isNaN(t.m) && Number.isNaN(r.m)) || t.m === r.m)) t.n += r.n; else out.push({ m: r.m, n: r.n });
            return out;
        }, []);
    }

    // continuidad de octava: el detector confunde una nota con su octava. Un salto de 10 o más
    // semitonos respecto a la nota anterior casi siempre es eso, así que pasa a la octava más cercana
    // a la anterior; los saltos normales (hasta una sexta) no se tocan. Las iguales que quedan
    // seguidas se juntan
    let previa = NaN;
    for (const t of tramos) {
        if (Number.isNaN(t.m)) continue;
        if (!Number.isNaN(previa) && Math.abs(t.m - previa) >= 10) {
            let mejorM = t.m;
            for (const d of [-24, -12, 12, 24]) if (Math.abs(t.m + d - previa) < Math.abs(mejorM - previa)) mejorM = t.m + d;
            t.m = mejorM;
        }
        previa = t.m;
    }
    tramos = tramos.reduce((out, r) => {
        const t = out[out.length - 1];
        if (t && !Number.isNaN(t.m) && t.m === r.m) t.n += r.n; else out.push({ m: r.m, n: r.n });
        return out;
    }, []);

    // al registro del buzzer: octavas enteras, así cada nota conserva su nombre
    const sonadas = tramos.filter(t => !Number.isNaN(t.m)).map(t => t.m).sort((a, b) => a - b);
    let desplazo = 0;
    if (o.subir && sonadas.length) {
        const med = sonadas[sonadas.length >> 1];
        desplazo = 12 * Math.round((MIDI_OBJETIVO - med) / 12);
    }
    const ajusta = m => { let v = m + desplazo; while (v < 55) v += 12; while (v > 100) v -= 12; return v; };

    const fichas = [];
    let notas = 0, ms = 0, truncado = false;
    for (const t of tramos) {
        if (fichas.length >= MAX_NOTAS - 2) { truncado = true; break; }
        const dur = clamp(Math.round(t.n * hopMs), 10, 60000);
        if (Number.isNaN(t.m)) { if (fichas.length) fichas.push('R:' + dur); }
        else { fichas.push(`${nombreMidi(ajusta(t.m))}:${dur}`); notas++; }
        ms += dur;
    }
    while (fichas.length && fichas[fichas.length - 1].startsWith('R:')) fichas.pop();
    const inicios = [];
    let t0 = 0;
    for (const t of tramos) { if (!Number.isNaN(t.m)) inicios.push([t0, t0 + t.n * hopMs]); t0 += t.n * hopMs; }
    return {
        texto: fichas.join(' '), notas, ms, truncado, intervalos: inicios,
        tonalidad: `${NOMBRES_TONICA[tonica]} mayor (o ${NOMBRES_TONICA[(tonica + 9) % 12]} menor)`,
    };
}

// x: muestras mono en [-1, 1]; sr: su frecuencia de muestreo.
// op: fMin y fMax (Hz) del registro de la melodía, sens (0 a 100), minNotaMs, tonalidad, subir.
//
// Sigue la línea melódica dominante (la voz si la hay, o el instrumento principal):
//  1. espectro por cuadro, comprimido y "blanqueado" (se queda con los picos, no con el ruido
//     ni con la batería);
//  2. para cada altura candidata (pasos de un tercio de semitono) se suman sus armónicos: la
//     voz y los instrumentos tienen muchos, un golpe de batería o un bajo suelto no;
//  3. Viterbi: elige el camino de alturas que más suena y menos salta, con un estado "sin
//     melodía" para los silencios y las partes sin línea clara.
function melodiaDeAudio(x, sr, op = {}) {
    const o = Object.assign({ fMin: 110, fMax: 1000, sens: 50 }, op);
    const k = Math.max(1, Math.round(sr / 16000)), sr2 = sr / k;
    const n2 = Math.floor(x.length / k);
    const y = new Float32Array(n2);
    for (let i = 0; i < n2; i++) { let s = 0; for (let j = 0; j < k; j++) s += x[i * k + j]; y[i] = s / k; }

    const N = 2048, hop = 512, M = N / 2;
    const frames = Math.floor((n2 - N) / hop);
    if (frames < 4) return { texto: '', notas: 0, ms: 0, truncado: false, intervalos: [], tonalidad: '' };
    const hopMs = hop / sr2 * 1000, binHz = sr2 / N;
    const fTop = Math.min(3500, sr2 / 2 - 200);
    const kTop = Math.floor(fTop / binHz);

    const cand = [];
    for (let f = Math.max(40, o.fMin); f <= Math.min(o.fMax, fTop / 2); f *= Math.pow(2, 1 / 36)) cand.push(f);
    const nC = cand.length;
    if (nC < 4) return { texto: '', notas: 0, ms: 0, truncado: false, intervalos: [], tonalidad: '' };
    const H = 10, peso = Array.from({ length: H + 1 }, (_, h) => Math.pow(0.84, Math.max(0, h - 1)));
    // preferencia suave por el registro de la voz (alrededor de 320 Hz); ayuda a no irse a octavas raras
    const previa = cand.map(f => { const z = Math.log2(f / 320) / 1.1; return 0.85 + 0.15 * Math.exp(-0.5 * z * z); });

    const ventana = new Float32Array(N);
    for (let i = 0; i < N; i++) ventana[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    const energia = new Float32Array(frames);
    let maxE = 0;
    for (let f = 0; f < frames; f++) {
        let s = 0;
        for (let i = 0; i < N; i += 4) { const v = y[f * hop + i]; s += v * v; }
        energia[f] = Math.sqrt(s / (N / 4));
        if (energia[f] > maxE) maxE = energia[f];
    }

    const re = new Float32Array(N), im = new Float32Array(N);
    const lm = new Float32Array(M + 2), blanco = new Float32Array(M + 2), suma = new Float64Array(M + 3);
    const W = Math.max(8, Math.round(250 / binHz));
    const sal = new Float32Array(frames * nC);
    const maxFrame = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
        if (energia[f] < 0.03 * maxE) continue;
        for (let i = 0; i < N; i++) { re[i] = y[f * hop + i] * ventana[i]; im[i] = 0; }
        fftEnSitio(re, im);
        let mx = 1e-9;
        for (let b = 2; b <= kTop + 2; b++) { const m = Math.hypot(re[b], im[b]); lm[b] = m; if (m > mx) mx = m; }
        suma[0] = 0;
        for (let b = 0; b <= kTop + 2; b++) {
            lm[b] = b < 2 ? 0 : Math.sqrt(lm[b] / mx);          // raíz: se oyen los picos débiles sin que el más fuerte aplaste
            suma[b + 1] = suma[b] + lm[b];
        }
        for (let b = 2; b <= kTop + 2; b++) {
            const a = Math.max(0, b - W), c = Math.min(kTop + 3, b + W + 1);
            blanco[b] = Math.max(0, lm[b] - (suma[c] - suma[a]) / (c - a));
        }
        let mejor = 0;
        for (let c = 0; c < nC; c++) {
            let s = 0;
            for (let h = 1; h <= H; h++) {
                const fr = cand[c] * h;
                if (fr > fTop) break;
                // tolerancia proporcional: con vibrato los armónicos altos se corren varios bins
                // y un peso que premia caer justo en el bin: a 130 Hz un bin ya mide casi un semitono
                const pos = fr / binHz, bin = Math.round(pos), tol = Math.max(1, Math.ceil(0.012 * pos));
                let v = 0;
                for (let d = -tol; d <= tol; d++) {
                    const w = blanco[bin + d] * (1 - 0.3 * Math.abs(bin + d - pos) / (tol + 0.5));
                    if (w > v) v = w;
                }
                s += peso[h] * v;
            }
            s *= previa[c];
            sal[f * nC + c] = s;
            if (s > mejor) mejor = s;
        }
        maxFrame[f] = mejor;
    }

    // referencia de "fuerte": el percentil 90 de lo mejor de cada cuadro con sonido
    const con = Array.from(maxFrame).filter(v => v > 0).sort((p, q) => p - q);
    if (!con.length) return { texto: '', notas: 0, ms: 0, truncado: false, intervalos: [], tonalidad: '' };
    const ref = con[Math.min(con.length - 1, Math.floor(con.length * 0.9))] || 1;
    const theta = 0.5 - 0.0035 * clamp(Number(o.sens) || 0, 0, 100);   // costo de "no hay melodía"

    // Viterbi: estados = alturas candidatas + "sin melodía" (U)
    const nS = nC + 1, U = nC, VENT = 24;           // hasta 8 semitonos de salto con costo suave
    const costoPaso = 0.004, costoSalto = 0.22, costoVoz = 0.05;
    let prev = new Float32Array(nS), cur = new Float32Array(nS);
    const atras = new Int16Array(frames * nS);
    for (let f = 0; f < frames; f++) {
        let ip = 0;
        for (let s = 1; s < nS; s++) if (prev[s] > prev[ip]) ip = s;
        let ipVoz = 0;
        for (let s = 1; s < nC; s++) if (prev[s] > prev[ipVoz]) ipVoz = s;
        for (let c = 0; c < nC; c++) {
            let mejor = prev[ip] - costoSalto, de = ip;
            const lo = Math.max(0, c - VENT), hi = Math.min(nC - 1, c + VENT);
            for (let j = lo; j <= hi; j++) {
                const v = prev[j] - costoPaso * Math.abs(j - c);
                if (v > mejor) { mejor = v; de = j; }
            }
            const vu = prev[U] - costoVoz;
            if (vu > mejor) { mejor = vu; de = U; }
            cur[c] = mejor + Math.min(1.5, sal[f * nC + c] / ref);
            atras[f * nS + c] = de;
        }
        let mejorU = prev[U], deU = U;
        if (prev[ipVoz] - costoVoz > mejorU) { mejorU = prev[ipVoz] - costoVoz; deU = ipVoz; }
        cur[U] = mejorU + theta;
        atras[f * nS + U] = deU;
        const t = prev; prev = cur; cur = t;
    }
    let s = 0;
    for (let i = 1; i < nS; i++) if (prev[i] > prev[s]) s = i;
    const midi = new Float32Array(frames).fill(NaN);
    for (let f = frames - 1; f >= 0; f--) {
        if (s !== U) midi[f] = 69 + 12 * Math.log2(cand[s] / 440);
        s = atras[f * nS + s];
    }

    // mediana móvil de 5 cuadros sobre los que tienen tono
    const liso = new Float32Array(frames).fill(NaN);
    for (let f = 0; f < frames; f++) {
        if (Number.isNaN(midi[f])) continue;
        const v = [];
        for (let j = Math.max(0, f - 2); j <= Math.min(frames - 1, f + 2); j++) if (!Number.isNaN(midi[j])) v.push(midi[j]);
        v.sort((p, q) => p - q);
        liso[f] = v[v.length >> 1];
    }
    return melodiaATexto(liso, hopMs, o);
}

// notas: [{ s, e, p }] en ms y p = número MIDI. Si suenan varias a la vez, se queda la más aguda.
function melodiaDeMidi(notas, op = {}) {
    const hopMs = 20;
    const fin = notas.reduce((m, n) => Math.max(m, n.e), 0);
    const n = Math.ceil(fin / hopMs);
    const midi = new Float32Array(n).fill(NaN);
    for (const t of notas) {
        for (let f = Math.floor(t.s / hopMs); f < Math.min(n, Math.ceil(t.e / hopMs)); f++) {
            if (Number.isNaN(midi[f]) || t.p > midi[f]) midi[f] = t.p;
        }
    }
    return melodiaATexto(midi, hopMs, Object.assign({ minNotaMs: 40, tonalidad: false }, op));
}

// Show guardado en el robot: la canción y el baile compilados, para que los haga solo, sin la página.
// Espacio en su EEPROM: nota 5 bytes, espera 3, motores 3, parar 1 (igual que PGM_MAX del firmware).
const PGM_MAX = 2800;
const BYTES_ORDEN = { T: 5, W: 3, M: 3, S: 1 };

function programaParaRobot(cmds) {
    const lineas = [];
    let bytes = 0;
    for (const c of cmds) {
        const n = BYTES_ORDEN[c.l.split(' ')[0]];
        if (!n) continue;                       // las luces no van en el show: ya se guardan con SAVE
        bytes += n;
        lineas.push('PADD ' + c.l);
    }
    return { lineas, bytes, cabe: bytes <= PGM_MAX };
}

// ---------- Batería: porcentaje y cuánto va a durar ----------
// El robot mide el voltaje de sus 6 pilas AA. Cada curva es por celda, [voltios, %] de mayor a menor; el
// porcentaje del paquete sale de interpolar (voltaje / 6). Con los motores andando el voltaje cae mucho
// (a ~5,6 V), así que solo se deben usar lecturas en reposo.
const CELDAS = 6;
const CURVAS_BATERIA = {
    nimh: [[1.42, 100], [1.35, 90], [1.30, 75], [1.27, 60], [1.25, 45], [1.23, 30], [1.20, 15], [1.15, 5], [1.00, 0]],
    alcalina: [[1.60, 100], [1.50, 80], [1.40, 50], [1.30, 25], [1.20, 10], [1.10, 0]],
    mixta: [[1.50, 100], [1.40, 80], [1.32, 55], [1.26, 35], [1.20, 15], [1.05, 0]],
};
const CAPACIDAD_DEFECTO = { nimh: 2000, alcalina: 2200, mixta: 2000 };
// Corriente aproximada (mA) según lo que hace el robot; el historial real la corrige cuando hay datos.
const CONSUMO_MA = { reposo: 120, musica: 160, motores: 700 };

function porcentajeBateria(volts, quimica) {
    const curva = CURVAS_BATERIA[quimica] || CURVAS_BATERIA.nimh;
    const v = Number(volts) / CELDAS;
    if (!(v > 0)) return null;
    if (v >= curva[0][0]) return 100;
    if (v <= curva[curva.length - 1][0]) return 0;
    for (let i = 1; i < curva.length; i++) {
        const [vb, pb] = curva[i], [va, pa] = curva[i - 1];
        if (v >= vb) return Math.round(pb + (pa - pb) * (v - vb) / (va - vb));
    }
    return 0;
}

// pct 0..100; historial [[ms, volts]] en reposo; uso 'reposo' | 'musica' | 'motores'.
// Devuelve { minutos, fuente } o null si no hay porcentaje.
function tiempoRestante({ pct, capacidadMah = 2000, historial = [], uso = 'reposo', quimica = 'nimh' }) {
    if (pct === null || pct === undefined || !(pct >= 0)) return null;
    // 1) con lo que de verdad ha bajado (mínimos cuadrados del % contra las horas)
    const puntos = [];
    for (const [t, v] of historial) {
        const p = porcentajeBateria(v, quimica);
        if (p !== null) puntos.push([t / 3600000, p]);
    }
    if (puntos.length >= 4) {
        const dt = puntos[puntos.length - 1][0] - puntos[0][0];
        const caida = puntos[0][1] - puntos[puntos.length - 1][1];
        if (dt >= 10 / 60 && caida >= 3) {
            const n = puntos.length;
            const mx = puntos.reduce((s, q) => s + q[0], 0) / n, my = puntos.reduce((s, q) => s + q[1], 0) / n;
            let sxy = 0, sxx = 0;
            for (const [x, y] of puntos) { sxy += (x - mx) * (y - my); sxx += (x - mx) * (x - mx); }
            const pendiente = sxx > 0 ? -sxy / sxx : 0;           // % que se pierde por hora
            if (pendiente > 0.5) return { minutos: Math.round(pct / pendiente * 60), fuente: 'por tu uso' };
        }
    }
    // 2) estimado por lo que está haciendo (con 10 % de margen: no se aprovecha toda la carga)
    const restanteMah = capacidadMah * pct / 100 * 0.9;
    const ma = CONSUMO_MA[uso] || CONSUMO_MA.reposo;
    return { minutos: Math.round(restanteMah / ma * 60), fuente: 'estimado' };
}

// Minutos para volver al 100 % con un cargador de corrienteMa. Las NiMH necesitan ~140 % de su capacidad
// (parte se va en calor). Las alcalinas no se recargan: null. Con pct = 100 da 0.
function tiempoCarga({ pct, capacidadMah = 2000, corrienteMa = 500, quimica = 'nimh' }) {
    if (quimica === 'alcalina' || pct === null || pct === undefined || !(pct >= 0) || !(corrienteMa > 0)) return null;
    const faltante = capacidadMah * (100 - Math.min(pct, 100)) / 100;
    return Math.round(faltante * 1.4 / corrienteMa * 60);
}

function formatoDuracion(min) {
    if (!(min >= 0)) return '';
    if (min < 1) return 'menos de 1 min';
    if (min < 60) return min + ' min';
    if (min >= 48 * 60) return 'más de 2 días';
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
}

// ---------- Seguidor de líneas (la función «Seguir la línea») ----------
// Con el módulo Me Line Follower (dos sensores). Puertos con dos pines digitales: 6, 7 y 8; el 9 es el
// botón de la placa y el 10 lo usa el ultrasonido. El programa del robot lo trae como modo 6.
const SEGUIDOR_ACTIVO = true;
const LINEA_DEFECTO = { puerto: 6, color: 'negra', velocidad: 80, giro: 50, perdida: 'buscar', buscarMs: 1500, cruce: 'recto', obstaculoCm: 0, duracionS: 0, avisos: true };
const LINEA_PERDIDA = { parar: 0, buscar: 1, recto: 2 };
const LINEA_CRUCE = { recto: 0, parar: 1, izquierda: 2, derecha: 3 };

function lineaNormaliza(c) {
    const o = Object.assign({}, LINEA_DEFECTO, c || {});
    return {
        puerto: [6, 7, 8].includes(Number(o.puerto)) ? Number(o.puerto) : LINEA_DEFECTO.puerto,
        color: o.color === 'blanca' ? 'blanca' : 'negra',
        velocidad: clamp(Math.round(Number(o.velocidad) || LINEA_DEFECTO.velocidad), 40, 150),
        giro: clamp(Math.round(Number(o.giro) || LINEA_DEFECTO.giro), 10, 100),
        perdida: o.perdida in LINEA_PERDIDA ? o.perdida : LINEA_DEFECTO.perdida,
        buscarMs: clamp(Math.round(Number(o.buscarMs) || 0), 0, 10000),
        cruce: o.cruce in LINEA_CRUCE ? o.cruce : LINEA_DEFECTO.cruce,
        obstaculoCm: clamp(Math.round(Number(o.obstaculoCm) || 0), 0, 200),
        duracionS: clamp(Math.round(Number(o.duracionS) || 0), 0, 3600),
        avisos: o.avisos !== false,
    };
}

// Las órdenes que se le mandan al robot para configurar el seguidor (una por ajuste)
function lineaAOrdenes(cfg) {
    const c = lineaNormaliza(cfg);
    return [
        'LINEA puerto ' + c.puerto,
        'LINEA color ' + (c.color === 'blanca' ? 1 : 0),
        'LINEA vel ' + c.velocidad,
        'LINEA giro ' + c.giro,
        'LINEA perdida ' + LINEA_PERDIDA[c.perdida],
        'LINEA buscar ' + c.buscarMs,
        'LINEA cruce ' + LINEA_CRUCE[c.cruce],
        'LINEA obst ' + c.obstaculoCm,
        'LINEA dur ' + c.duracionS,
        'LINEA avisos ' + (c.avisos ? 1 : 0),
    ];
}

const lib = {
    BAUDIOS, VEL_MAX, ARTICULACION, LEDS, CANCIONES, BAILES, EFECTOS, PALETA, COLOR_INICIAL, MODOS_FX, TONOS_RITMO,
    PGM_MAX, VARIANTES, FUNCIONES, pasosDeFuncion,
    frecuencia, leerNotas, leerBaile, compilar, crearCola, crearLector,
    hsv, hexARgb, marcoHex, fxLinea, ritmoATexto, programaParaRobot,
    melodiaDeAudio, melodiaDeMidi, nombreMidi, grabacionATexto, TECLAS_PIANO,
    porcentajeBateria, tiempoRestante, tiempoCarga, formatoDuracion, CURVAS_BATERIA, CAPACIDAD_DEFECTO,
    lineaNormaliza, lineaAOrdenes, LINEA_DEFECTO, SEGUIDOR_ACTIVO,
};

if (typeof module !== 'undefined' && module.exports) module.exports = lib;
else raiz.Robot = lib;

if (typeof document === 'undefined') return;

// ==================== Interfaz ====================

const $ = id => document.getElementById(id);
const LLAVE = 'cecyte_robot_v1';
const VID_CH340 = 0x1A86;

const S = {
    estado: 'desconectado',   // desconectado | conectando | listo | sinprograma
    puerto: null, escritor: null, lector: null, vioArranque: false,
    cola: null, actuando: false, sucio: true, sel: 0,
    inicio: 0, total: 0, audio: null,
    leds: Array.from({ length: LEDS }, () => COLOR_INICIAL),
    brillo: 40, efecto: 'fijo', velFx: 100, vol: 100, vivo: true, repetir: false,
    cancion: 'estrellita', notas: '', bpm: 110, baile: 'vaiven', pasos: null, vel: 110,
    guardadas: [],            // canciones y ritmos guardados: { id, nombre, texto, bpm }
    guardarEn: 0,             // cuándo mandar SAVE al robot (ms), 0 = nada pendiente
    enShow: false,            // el robot está haciendo su show guardado: no hay que mandarle nada
    arranca: false,           // "que empiece solo al encenderlo"
    rec: '',                // última grabación del teclado (texto de notas)
    variante: 'tanque', funcion: '',                 // modelo del robot y función elegida ('' = ninguna)
    funLuces: true, funMusica: false, giro90: 500,   // casillas de la función y ms que tarda en girar 90°
    corriendoFuncion: false,  // hay una función en marcha (para las luces y para parar bien)
    autonomo: 0,              // modo del robot (1 o 2) si la función la hace él solo con su sensor
    salirModo: false,         // al llegar ABORTED, sacar al robot de ese modo (MODE 4)
    bateria: { quimica: 'nimh', capacidad: 2000, hist: [] },   // pilas: tipo, capacidad (mAh) y lecturas en reposo [ms, V]
    linea: Object.assign({}, LINEA_DEFECTO),                   // seguidor de líneas (todavía desactivado)
    fwNuevo: false,           // el robot ya mandó su línea INFO: entiende BAT
    ultimaActividad: 0, ultimoBat: 0, ultimoVolt: null, ultimoNivel: 'ok',
};
const MAX_GUARDADAS = 40;
let musicaCargada = null;     // audio o MIDI elegido para convertir en ritmo (no se guarda)

function guardar() {
    try {
        const { leds, brillo, efecto, velFx, vol, vivo, repetir, cancion, notas, bpm, baile, pasos, vel, guardadas, arranca, rec, bateria, linea, variante, funcion, funLuces, funMusica, giro90 } = S;
        localStorage.setItem(LLAVE, JSON.stringify({ leds, brillo, efecto, velFx, vol, vivo, repetir, cancion, notas, bpm, baile, pasos, vel, guardadas, arranca, rec, bateria, linea, variante, funcion, funLuces, funMusica, giro90 }));
    } catch (e) { /* sin almacenamiento: no se recuerda nada */ }
}

function cargar() {
    try {
        const g = JSON.parse(localStorage.getItem(LLAVE) || 'null');
        if (g && typeof g === 'object') Object.assign(S, g);
    } catch (e) { /* datos viejos o dañados: se usan los de fábrica */ }
    S.velFx = clamp(Number(S.velFx) || 100, 20, 300);
    S.vol = clamp(Number.isFinite(Number(S.vol)) ? Number(S.vol) : 100, 0, 100);
    if (typeof S.rec !== 'string') S.rec = '';
    const b = S.bateria && typeof S.bateria === 'object' ? S.bateria : {};
    S.bateria = {
        quimica: b.quimica in CURVAS_BATERIA ? b.quimica : 'nimh',
        capacidad: clamp(Math.round(Number(b.capacidad) || CAPACIDAD_DEFECTO.nimh), 500, 10000),
        cargador: clamp(Math.round(Number(b.cargador) || 500), 100, 3000),     // mA del cargador (para el tiempo de carga)
        hist: (Array.isArray(b.hist) ? b.hist : []).filter(p => Array.isArray(p) && p.length === 2 && p[0] > 0 && p[1] > 0).slice(-200),
    };
    S.linea = lineaNormaliza(S.linea);
    if (!Array.isArray(S.leds) || S.leds.length !== LEDS) S.leds = Array.from({ length: LEDS }, () => COLOR_INICIAL);
    S.guardadas = (Array.isArray(S.guardadas) ? S.guardadas : [])
        .filter(g => g && typeof g.id === 'string' && typeof g.nombre === 'string' && typeof g.texto === 'string')
        .slice(0, MAX_GUARDADAS);
    if (S.cancion.startsWith('g:') && !S.guardadas.some(g => 'g:' + g.id === S.cancion)) S.cancion = 'propia';
    if (!S.notas) {
        const c = CANCIONES.find(x => x.id === S.cancion) || CANCIONES[0];
        S.notas = c.texto;
        S.bpm = c.bpm;
    }
    if (S.pasos === null || S.pasos === undefined) S.pasos = (BAILES.find(b => b.id === S.baile) || BAILES[0]).texto;
    if (!VARIANTES.some(v => v.id === S.variante)) S.variante = VARIANTES[0].id;
    const f = FUNCIONES.find(x => x.id === S.funcion);
    if (!f || !f.v.includes(S.variante)) S.funcion = '';
    if (S.funcion) { S.baile = 'quieto'; S.pasos = ''; }    // con una función puesta no hay baile
    S.funLuces = S.funLuces !== false;
    S.funMusica = S.funMusica === true;
    S.giro90 = clamp(Math.round(Number(S.giro90) || 500), 200, 1500);
    S.corriendoFuncion = false; S.autonomo = 0; S.salirModo = false;
}

function mensaje(texto, tipo) {
    const el = $('rb-msg');
    el.textContent = texto || '';
    el.className = 'msg' + (tipo ? ' msg--' + tipo : '');
}

const TEXTO_ESTADO = {
    desconectado: ['Sin conectar', 'idle'],
    conectando: ['Conectando…', 'idle'],
    listo: ['Robot listo', 'ok'],
    sinprograma: ['Falta instalar el programa', 'off'],
};

function ponEstado(est) {
    S.estado = est;
    const [txt, clase] = TEXTO_ESTADO[est];
    $('rb-badge').className = 'badge badge--' + clase;
    $('rb-badge-text').textContent = txt;
    $('rb-conectar').textContent = est === 'desconectado' ? 'Conectar el robot' : 'Desconectar';
    for (const id of ['rb-tocar', 'rb-bailar', 'rb-fn-iniciar', 'rb-pgm-guardar', 'rb-pgm-probar', 'rb-pgm-borrar']) $(id).disabled = est !== 'listo';
    if (est === 'sinprograma') {
        $('rb-instalar').open = true;
        if (typeof mostrarSeccionAdmin === 'function') mostrarSeccionAdmin('robot-instalar', { recordar: false });   // las instrucciones, a la vista
    }
}

// ---------- Puerto serie ----------

function crudo(texto) {
    if (S.escritor) S.escritor.write(new TextEncoder().encode(texto)).catch(() => { /* se cerró */ });
}
const escribirLinea = l => crudo(l + '\n');

function alLinea(l) {
    if (/^(OK|ERR)\b/.test(l)) {
        const err = /^ERR/.test(l);
        const reintento = S.cola.ack(err);
        if (err && !reintento) mensaje('El robot no entendió una orden (' + l + ').', 'err');
    } else if (/^BAT /.test(l)) {
        S.cola.ack();                      // BAT contesta con su propia línea, sin OK
        bateriaLeida(parseFloat(l.slice(4)));
    } else if (/^INFO /.test(l)) {
        // "INFO BOOT=2 BTN=0 RUN=3 MIN=5.4 BAT=7.42" al encender: lo que el robot anotó solo desde que
        // se borró el aviso. BOOT cuenta cada arranque, y conectarlo por USB también reinicia la placa
        const kv = {};
        for (const par of l.slice(5).split(' ')) { const [k, v] = par.split('='); kv[k] = parseFloat(v); }
        S.fwNuevo = true;                  // este programa ya entiende la orden BAT
        bateriaLeida(kv.BAT);
        const cosas = [];
        if (kv.BOOT > 1) cosas.push(`${kv.BOOT} arranques (conectarlo por USB cuenta uno; si lo probaste solo, los demás fueron reinicios)`);
        if (kv.BTN) cosas.push(`${kv.BTN} cambio(s) de modo con el botón`);
        if (kv.RUN) cosas.push(`${kv.RUN} pasada(s) del show`);
        if (kv.MIN) cosas.push(`voltaje más bajo con las ruedas andando: ${kv.MIN.toFixed(1)} V`);
        $('rb-diag-txt').textContent = cosas.length ? 'Desde la última vez que lo borraste: ' + cosas.join(', ') + '.' : '';
        $('rb-diag').hidden = !cosas.length;
    } else if (/^PONG mbot-web/.test(l) || /mBot Ranger web .*listo/.test(l)) {
        if (S.estado === 'conectando') alListo();
    } else if (/mBot Ranger listo/.test(l)) {
        S.vioArranque = true;   // el programa viejo (tanquecito): no habla con la página
    } else if (l === 'ABORTED') {
        S.cola.abortado();
        if (S.salirModo) { S.salirModo = false; crudo('MODE 4\n'); }   // "!" para y ya, pero esquivar/seguir seguirían: se le quita el modo
    } else if (/^SHOW fin/.test(l)) {
        if (S.enShow) mensaje('El show guardado terminó.', 'ok');
        S.enShow = false;
        S.sucio = true;
    } else if (l === 'WDT') {
        mensaje('El robot se detuvo solo porque la página dejó de mandarle órdenes.', 'err');
    } else if (/^BTN \d/.test(l)) {
        mensaje('Se cambió de modo con el botón del robot. Pulsa Tocar o Bailar para que vuelva a obedecer a la página.');
    }
}

// Medidor de la cabecera: barra, porcentaje y cuánto va a durar con lo que se está haciendo.
// Solo con lecturas en reposo (con los motores andando el voltaje cae a ~5,6 V y daría un % falso).
const NOMBRE_PILAS = { nimh: 'recargables NiMH', alcalina: 'alcalinas', mixta: 'mixtas' };

function mostrarBateria(v) {
    const el = $('rb-bat');
    if (!el || !(v >= 0)) return;
    el.hidden = false;
    if (v < 1) {                                   // solo USB: la placa no ve las pilas
        el.dataset.nivel = 'sin';
        $('rb-bat-pct').textContent = 'Sin pilas';
        $('rb-bat-v').textContent = 'solo USB';
        $('rb-bat-fill').style.transform = 'scaleX(0)';
        $('rb-bat-tiempo').textContent = '';
        $('rb-bat-carga').textContent = '';
        $('rb-bat-aviso').hidden = true;
        el.title = 'El robot no está viendo las pilas: está alimentado solo por el USB, o el interruptor está apagado.';
        return;
    }
    const b = S.bateria;
    const pct = porcentajeBateria(v, b.quimica);
    const uso = S.enShow || S.autonomo ? 'motores' : S.actuando ? (S.actuando.conBaile ? 'motores' : 'musica') : 'reposo';
    const t = tiempoRestante({ pct, capacidadMah: b.capacidad, historial: b.hist, uso, quimica: b.quimica });
    const nivel = pct <= 10 ? 'critica' : pct <= 20 ? 'baja' : 'ok';
    el.dataset.nivel = nivel;
    $('rb-bat-pct').textContent = pct + ' %';
    $('rb-bat-v').textContent = v.toFixed(2) + ' V';
    $('rb-bat-fill').style.transform = `scaleX(${pct / 100})`;
    el.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', String(pct));
    $('rb-bat-tiempo').textContent = t ? `≈ ${formatoDuracion(t.minutos)} de uso (${t.fuente})` : '';
    const carga = tiempoCarga({ pct, capacidadMah: b.capacidad, corrienteMa: b.cargador, quimica: b.quimica });
    $('rb-bat-carga').textContent = carga === null ? '' : carga < 1 ? 'Cargada al 100 %'
        : `≈ ${formatoDuracion(carga)} en cargar al 100 % (cargador de ${b.cargador} mA)`;
    el.title = `${v.toFixed(2)} V, pilas ${NOMBRE_PILAS[b.quimica]} de ${b.capacidad} mAh`;
    // el aviso va en el propio medidor (no en un mensaje suelto)
    const aviso = $('rb-bat-aviso');
    aviso.hidden = nivel === 'ok';
    aviso.textContent = nivel === 'critica' ? '¡Cargar ya!' : 'Cargar pronto';
    S.ultimoNivel = nivel;
}

// Una lectura nueva en reposo: se guarda para estimar el consumo real y se actualiza el medidor
function bateriaLeida(v) {
    if (!(v >= 0)) return;
    if (v < 1) return mostrarBateria(v);
    const b = S.bateria, ahora = Date.now();
    if (S.ultimoVolt !== null && v > S.ultimoVolt + 0.4) b.hist = [];     // pilas cargadas o cambiadas: el historial ya no sirve
    S.ultimoVolt = v;
    const ult = b.hist[b.hist.length - 1];
    if (!ult || ahora - ult[0] >= 20000) b.hist.push([ahora, Math.round(v * 100) / 100]);
    b.hist = b.hist.filter(p => ahora - p[0] < 6 * 3600000).slice(-200);
    mostrarBateria(v);
    guardar();
}

function alListo() {
    clearInterval(S.saludo);
    ponEstado('listo');
    mensaje('Listo. Lo que cambies aquí se aplica en el robot al instante.', 'ok');
    S.cola.enviar(['MODE 4']);
    S.sucio = true;
}

async function abrir(puerto) {
    try {
        await puerto.open({ baudRate: BAUDIOS });
    } catch (e) {
        mensaje('No pude abrir el puerto. Si el IDE de Arduino o mBlock lo tienen abierto, ciérralos y vuelve a intentar.', 'err');
        return;
    }
    S.puerto = puerto;
    S.escritor = puerto.writable.getWriter();
    S.lector = puerto.readable.getReader();
    S.vioArranque = false;
    S.cola.reiniciar();
    ponEstado('conectando');
    mensaje('Conectando… (la placa se reinicia y suena una vez)');
    leerBucle();
    let intentos = 0;
    S.saludo = setInterval(() => {
        if (S.estado !== 'conectando') return clearInterval(S.saludo);
        if (++intentos > 14) {
            clearInterval(S.saludo);
            ponEstado('sinprograma');
            mensaje(S.vioArranque
                ? 'El robot tiene todavía el programa viejo. Instala el nuevo (abajo) y vuelve a conectar.'
                : 'El robot no contesta. Revisa el cable o instala el programa nuevo (abajo).', 'err');
        } else if (intentos > 2) {
            crudo('PING\n');
        }
    }, 400);
}

async function leerBucle() {
    const dec = new TextDecoder();
    const juntar = crearLector(alLinea);
    try {
        for (;;) {
            const { value, done } = await S.lector.read();
            if (done) break;
            juntar(dec.decode(value, { stream: true }));
        }
    } catch (e) { /* se desenchufó */ }
    cerrar();
}

async function cerrar() {
    const era = S.estado;
    clearInterval(S.saludo);
    S.cola.reiniciar();
    S.actuando = false;
    S.enShow = false;
    detenerAudio();
    const { lector, escritor, puerto } = S;
    S.puerto = S.escritor = S.lector = null;
    try { if (lector) await lector.cancel(); } catch (e) { /* ya estaba cerrado */ }
    try { if (lector) lector.releaseLock(); } catch (e) { /* idem */ }
    try { if (escritor) escritor.releaseLock(); } catch (e) { /* idem */ }
    try { if (puerto) await puerto.close(); } catch (e) { /* idem */ }
    ponEstado('desconectado');
    progreso(0);
    if (era === 'listo') mensaje('El robot se desconectó. Si lo vuelves a enchufar, se reconecta solo.');
}

async function conectar(todos) {
    if (!('serial' in navigator)) {
        mensaje('Este navegador no puede hablar con el robot. Abre la página en Chrome o Edge desde una computadora.', 'err');
        return;
    }
    if (S.estado !== 'desconectado') { await cerrar(); return; }
    try {
        const filtros = todos ? [] : [{ usbVendorId: VID_CH340 }];
        await abrir(await navigator.serial.requestPort({ filters: filtros }));
    } catch (e) {
        if (e && e.name !== 'NotFoundError') mensaje('No se pudo conectar: ' + e.message, 'err');
    }
}

// Si ya diste permiso antes, se conecta solo al abrir la pestaña o al enchufar el cable
async function conectarSolo() {
    if (!('serial' in navigator) || S.estado !== 'desconectado' || $('sec-robot').hidden) return;
    try {
        const p = (await navigator.serial.getPorts()).find(x => (x.getInfo().usbVendorId || 0) === VID_CH340);
        if (p) await abrir(p);
    } catch (e) { /* sin permiso todavía: espera al botón */ }
}

// ---------- Sonido en el navegador (escuchar sin robot) ----------

function detenerAudio() {
    if (S.audio) { try { S.audio.close(); } catch (e) { /* ya cerrado */ } S.audio = null; }
}

function escucharAqui() {
    detenerAudio();
    const { cmds, ms } = armar(true, false);
    if (!ms) return mensaje('No hay notas para escuchar.', 'err');
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = S.audio = new Ctx();
    const osc = ctx.createOscillator(), amp = ctx.createGain();
    osc.type = 'square';
    amp.gain.value = 0;
    osc.connect(amp).connect(ctx.destination);
    let t = ctx.currentTime + 0.05;
    for (const c of cmds) {
        const [k, a, b] = c.l.split(' ');
        if (k === 'T') {
            osc.frequency.setValueAtTime(Number(a), t);
            amp.gain.setValueAtTime(0.06 * S.vol / 100, t);
            amp.gain.setValueAtTime(0, t + Number(b) / 1000);
            t += Number(b) / 1000;
        } else if (k === 'W') {
            t += Number(a) / 1000;
        }
    }
    osc.start();
    osc.stop(t + 0.1);
    osc.onended = () => { progreso(0); if (S.audio === ctx) detenerAudio(); };
    S.inicio = performance.now();
    S.total = ms;
    mensaje('Sonando en el navegador…');
}

// ---------- Armar y tocar ----------

function coloresBase() { return S.leds.map(hexARgb); }

// La línea FX que toca ahora: las luces de la pantalla, o apagadas si una función en marcha las desactivó.
function lineaLuces() {
    if (S.corriendoFuncion && !S.funLuces) return fxLinea('fijo', 0, coloresBase(), 100);
    return fxLinea(S.efecto, S.brillo, coloresBase(), S.velFx);
}

// Devuelve { cmds, ms } con la canción y/o el baile que haya en pantalla
function armar(conCancion, conBaile) {
    const n = leerNotas(S.notas), b = leerBaile(S.pasos);
    mostrarErrores(n.errores, b.errores);
    return compilar({
        notas: conCancion ? n.notas : [],
        pasos: conBaile ? b.pasos : [],
        bpm: S.bpm, vel: S.vel,
    });
}

function mostrarErrores(notas, baile) {
    $('rb-err-notas').textContent = notas.length ? 'No entendí: ' + notas.slice(0, 6).join(', ') + (notas.length > 6 ? '…' : '') : '';
    $('rb-err-baile').textContent = baile.length ? 'No entendí: ' + baile.slice(0, 6).join(', ') : '';
}

function actuar(conCancion, conBaile) {
    if (S.estado !== 'listo') return mensaje('Conecta el robot primero.', 'err');
    const { cmds, ms } = armar(conCancion, conBaile);
    if (!ms) return mensaje('No hay nada que tocar: la canción y el baile están vacíos.', 'err');
    S.corriendoFuncion = false;
    S.autonomo = 0;
    S.actuando = { conCancion, conBaile };
    S.ultimaActividad = Date.now();
    S.inicio = performance.now();
    S.total = ms;
    // El efecto de luces va primero y corre solo en el robot mientras suena todo lo demás.
    const fx = { l: fxLinea(S.efecto, S.brillo, coloresBase(), S.velFx), ex: true };
    S.guardarEn = Date.now() + 2500;
    S.cola.enviar(['MODE 4', fx, 'VOL ' + S.vol].concat(cmds), () => {
        if (S.actuando && S.repetir) return actuar(conCancion, conBaile);
        S.actuando = false;
        progreso(0);
        mensaje('Listo.', 'ok');
    });
    mensaje(conBaile ? 'Bailando…' : 'Cantando…');
}

// ---------- Funciones por modelo ----------
// Una función es un comportamiento que corre hasta pulsar Paro. Las de movimiento las arma la página
// (pasos repetidos, con la canción encima si la casilla de música está marcada); esquivar y seguir la
// mano las hace el propio robot con su sensor (modos 1 y 2), y entonces la música suena en la página
// porque el robot no puede mirar el sensor mientras toca una nota.

// Los ajustes de la línea tal como van al robot: sin luces de estado si la función va "sin luces".
function lineaEnRobot() {
    return Object.assign({}, S.linea, { avisos: S.linea.avisos && S.funLuces });
}

function funcionActual() {
    return FUNCIONES.find(f => f.id === S.funcion && f.v.includes(S.variante)) || null;
}

function armarFuncion(f) {
    const n = leerNotas(S.notas);
    mostrarErrores(n.errores, leerBaile(S.pasos).errores);
    return compilar({
        notas: S.funMusica ? n.notas : [],
        pasos: pasosDeFuncion(f.pasos, S.giro90, S.bpm),
        bpm: S.bpm, vel: S.vel, continuo: true,
    });
}

// seguido: una vuelta más de lo mismo; no repite el MODE 4 ni las luces para que no se note el empalme.
function lanzarFuncion(f, seguido) {
    const { cmds, ms } = armarFuncion(f);
    if (!ms) { S.corriendoFuncion = false; return mensaje('Esa función no tiene pasos.', 'err'); }
    S.actuando = { fn: true, conBaile: true };
    S.corriendoFuncion = true;
    S.ultimaActividad = Date.now();
    S.inicio = performance.now();
    S.total = ms;
    const previo = seguido ? [] : ['MODE 4', { l: lineaLuces(), ex: true }, 'VOL ' + S.vol];
    S.cola.enviar(previo.concat(cmds), () => {
        if (S.actuando && S.actuando.fn) lanzarFuncion(f, true);
    });
}

// reinicio: lo llama esperarYTocar() tras un cambio en vivo; no hay que parar nada antes.
function iniciarFuncion(reinicio) {
    const f = funcionActual();
    if (!f) return mensaje('Elige una función primero.', 'err');
    if (S.estado !== 'listo') return mensaje('Conecta el robot primero.', 'err');
    if (!reinicio && (S.actuando || S.enShow || S.corriendoFuncion)) {   // primero se corta lo que esté haciendo
        paro();
        return esperarYTocar({ fn: true });
    }
    S.guardarEn = 0;                       // unas luces apagadas por la función no se guardan en el robot
    if (f.modo) {
        S.actuando = false;
        S.corriendoFuncion = true;
        S.autonomo = f.modo;
        S.ultimaActividad = Date.now();
        if (f.linea) {
            // el robot pinta verde/rojo según la línea: las luces de la pantalla se dejan antes, en fijo y sin brillo
            const luz = S.funLuces && S.linea.avisos ? fxLinea('fijo', 0, coloresBase(), 100) : lineaLuces();
            S.cola.enviar(['MODE 4'].concat(lineaAOrdenes(lineaEnRobot()), [{ l: luz, ex: true }, 'VOL ' + S.vol, { l: 'MODE 6', ex: true }]));
        } else {
            S.cola.enviar([{ l: 'MODE ' + f.modo, ex: true }, { l: lineaLuces(), ex: true }, 'VOL ' + S.vol]);
        }
        if (S.funMusica) escucharAqui();
        return mensaje(`${f.nombre}: lo hace el robot solo con su sensor. Pulsa Paro para detenerlo.`, 'ok');
    }
    S.autonomo = 0;
    lanzarFuncion(f, false);
    mensaje(`${f.nombre}: en marcha. Pulsa Paro para detenerlo.`, 'ok');
}

// Poner una función quita el baile (los dos mueven las ruedas): queda en "Solo luces" y sin pasos.
function elegirFuncion(id) {
    if (S.corriendoFuncion) paro();
    const habiaBaile = S.baile !== 'quieto' || S.pasos.trim() !== '';
    S.funcion = id;
    if (id) {
        S.baile = 'quieto';
        S.pasos = '';
    }
    guardar();
    pintarTodo();
    const f = funcionActual();
    if (f) mensaje(`Función «${f.nombre}» puesta${habiaBaile ? ' y se quitó el baile que tenías' : ''}. Pulsa Iniciar.`, 'ok');
}

// Elegir o escribir un baile quita la función: no pueden ir juntos.
function quitarFuncion() {
    if (!S.funcion) return;
    if (S.corriendoFuncion) paro();
    S.funcion = '';
    pintarFunciones();
    mensaje('Se quitó la función: el baile y la función no van juntos.');
}

function pintarFunciones() {
    const v = VARIANTES.find(x => x.id === S.variante) || VARIANTES[0];
    const f = funcionActual();
    $('rb-fn-var').value = v.id;
    $('rb-fn-nota').textContent = v.nota;
    const lista = [{ id: '', nombre: 'Ninguna', desc: 'El robot solo hace lo que le mandes desde las otras secciones.' }]
        .concat(FUNCIONES.filter(x => x.v.includes(v.id)));
    $('rb-fn-lista').innerHTML = lista.map(x =>
        `<label class="rb-fn"><input type="radio" name="rb-fn" value="${x.id}"${x.id === S.funcion ? ' checked' : ''}>`
        + `<span><b>${x.nombre}</b><small>${x.desc}${x.modo ? ' <em>La hace el robot solo.</em>' : ''}</small></span></label>`).join('');
    $('rb-fn-luces').checked = S.funLuces;
    $('rb-fn-musica').checked = S.funMusica;
    $('rb-fn-giro').value = S.giro90;
    $('rb-fn-giro-v').textContent = S.giro90 + ' ms';
    $('rb-fn-vel').value = S.vel;
    $('rb-fn-vel-v').textContent = S.vel;
    $('rb-fn-vel').disabled = $('rb-fn-giro').disabled = !!(f && f.modo);   // esas usan su propia velocidad
    const op = $('rb-cancion').selectedOptions[0];
    $('rb-fn-cancion').textContent = op ? op.textContent : '';
    $('rb-ln-panel').hidden = !(f && f.linea);
}

// ---------- Show guardado en el robot ----------

function pgmInfo(texto, tipo) {
    const el = $('rb-pgm-info');
    el.textContent = texto || '';
    el.className = 'msg' + (tipo ? ' msg--' + tipo : '');
}

function guardarShow() {
    if (S.estado !== 'listo') return pgmInfo('Conecta el robot primero.', 'err');
    const { cmds, ms } = armar(true, true);
    if (!ms) return pgmInfo('No hay nada que guardar: la canción y el baile están vacíos.', 'err');
    const prog = programaParaRobot(cmds);
    if (!prog.cabe) return pgmInfo(`Es demasiado largo para el robot (${prog.bytes} de ${PGM_MAX} bytes). Usa un pedazo más corto o una velocidad más alta.`, 'err');
    const banderas = ($('rb-auto').checked ? 1 : 0) | (S.repetir ? 2 : 0);
    const fx = { l: fxLinea(S.efecto, S.brillo, coloresBase(), S.velFx), ex: true };
    S.actuando = false;
    S.enShow = false;
    S.guardarEn = 0;
    pgmInfo(`Guardando en el robot (${prog.lineas.length} órdenes)… no lo desconectes.`);
    const dur = (ms / 1000).toFixed(1);
    S.cola.enviar(['MODE 4', 'PCLR'].concat(prog.lineas, ['PEND ' + banderas, 'VOL ' + S.vol, fx, { l: 'SAVE', ex: true }]), () => {
        pgmInfo(`Listo: el robot ya sabe hacer su show de ${dur} s sin la página`
            + (banderas & 1 ? ' y lo hace solo 2,5 s después de encenderlo' : '')
            + (banderas & 2 ? ', repitiéndolo' : '')
            + '. Con el botón de la placa se elige o se corta.', 'ok');
    });
}

function probarShow() {
    if (S.estado !== 'listo') return pgmInfo('Conecta el robot primero.', 'err');
    S.actuando = false;
    S.corriendoFuncion = false;
    S.autonomo = 0;
    S.enShow = true;
    S.ultimaActividad = Date.now();
    S.cola.enviar([{ l: 'MODE 5', ex: true }]);
    pgmInfo('El robot hace su show guardado por su cuenta. Pulsa Paro para cortarlo.');
}

function borrarShow() {
    if (S.estado !== 'listo') return pgmInfo('Conecta el robot primero.', 'err');
    S.enShow = false;
    S.cola.enviar([{ l: 'MODE 4', ex: true }, { l: 'PCLR', ex: true }, { l: 'PEND 0', ex: true }], () => pgmInfo('Show borrado del robot.', 'ok'));
}

function paro() {
    S.ultimaActividad = Date.now();
    S.actuando = false;
    S.enShow = false;
    if (S.corriendoFuncion) {
        S.corriendoFuncion = false;
        S.sucio = true;                                  // las luces vuelven a ser las de la pantalla
        if (S.autonomo) { S.autonomo = 0; S.salirModo = true; }
    }
    detenerAudio();
    S.cola.abortar();
    progreso(0);
    mensaje('Paro. El robot se detuvo.');
}

function progreso(ratio) {
    $('rb-prog').value = clamp(ratio, 0, 1);
}

// Si estás tocando y cambias algo, vuelve a empezar con el cambio.
let timerReinicio = null;
function cambio(tipo) {
    guardar();
    if (!S.vivo) return;
    if (tipo === 'led') S.sucio = true;
    if (S.actuando && S.estado === 'listo') {
        clearTimeout(timerReinicio);
        timerReinicio = setTimeout(() => {
            const a = S.actuando;
            if (!a) return;
            S.actuando = false;
            S.cola.abortar();
            esperarYTocar(a);
        }, 600);
    }
}

function esperarYTocar(a) {
    if (S.cola.ocupado()) return setTimeout(() => esperarYTocar(a), 40);
    if (a.fn) iniciarFuncion(true);
    else actuar(a.conCancion, a.conBaile);
}

// Cada 100 ms: avance de la barra, aviso si el robot dejó de contestar y, cuando cambian las luces,
// una sola orden FX (el robot anima el efecto él solo) y luego SAVE para que se quede guardado.
function tickLeds() {
    const visible = !$('sec-robot').hidden && !document.hidden;
    if (S.actuando || S.audio) progreso((performance.now() - S.inicio) / S.total);
    if (S.estado === 'listo' && S.cola.sinNovedad() > 6000) {
        paro();
        mensaje('El robot dejó de contestar. Si no reacciona, pulsa Desconectar y vuelve a conectar.', 'err');
        return;
    }
    // cada 10 s, con el robot quieto y sin nada en la cola, se le pregunta el voltaje (en reposo)
    const ahora = Date.now();
    if (S.estado === 'listo' && S.fwNuevo && !S.actuando && !S.enShow && !S.cola.ocupado()
        && ahora - S.ultimoBat > 10000 && ahora - S.ultimaActividad > 3000) {
        S.ultimoBat = ahora;
        S.cola.enviar(['BAT']);
        return;
    }
    if (S.estado !== 'listo' || !S.vivo || S.actuando || S.enShow || !visible || S.cola.ocupado()) return;
    if (S.sucio) {
        S.sucio = false;
        S.guardarEn = S.corriendoFuncion ? 0 : Date.now() + 2500;   // las luces apagadas por una función no se guardan
        S.cola.enviar([{ l: lineaLuces(), ex: true }, 'VOL ' + S.vol]);
    } else if (S.guardarEn && !S.corriendoFuncion && Date.now() >= S.guardarEn) {
        S.guardarEn = 0;
        S.cola.enviar([{ l: 'SAVE', ex: true }]);
        mensaje('Luces guardadas en el robot: siguen igual aunque lo desconectes.', 'ok');
    }
}

// ---------- Pantalla ----------

function pintarAnillo() {
    const cont = $('rb-anillo');
    if (!cont.children.length) {
        for (let i = 0; i < LEDS; i++) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'rb-led';
            b.dataset.i = i;
            b.textContent = i + 1;
            const ang = (i / LEDS) * 2 * Math.PI - Math.PI / 2;
            b.style.left = (50 + 38 * Math.cos(ang)) + '%';
            b.style.top = (50 + 38 * Math.sin(ang)) + '%';
            b.setAttribute('aria-label', 'LED ' + (i + 1));
            cont.appendChild(b);
        }
    }
    [...cont.children].forEach((b, i) => {
        b.style.setProperty('--c', S.leds[i]);
        b.setAttribute('aria-pressed', String(i === S.sel));
    });
    $('rb-led-color').value = S.leds[S.sel];
}

function pintarTodo() {
    $('rb-notas').value = S.notas;
    $('rb-bpm').value = S.bpm;
    $('rb-bpm-v').textContent = S.bpm + ' tiempos por minuto';
    $('rb-pasos').value = S.pasos;
    $('rb-vel').value = S.vel;
    $('rb-vel-v').textContent = S.vel;
    $('rb-brillo').value = S.brillo;
    $('rb-brillo-v').textContent = S.brillo + ' %';
    $('rb-efecto').value = S.efecto;
    $('rb-fxvel').value = S.velFx;
    $('rb-fxvel-v').textContent = S.velFx + ' %';
    $('rb-vol').value = S.vol;
    $('rb-vol-v').textContent = S.vol + ' %';
    $('rb-vivo').checked = S.vivo;
    $('rb-repetir').checked = S.repetir;
    $('rb-auto').checked = S.arranca;
    $('rb-cancion').value = S.cancion;
    $('rb-baile').value = S.baile;
    $('rb-borrar').disabled = !S.cancion.startsWith('g:');
    pintarFunciones();
    pintarAnillo();
    mostrarErrores(leerNotas(S.notas).errores, leerBaile(S.pasos).errores);
}

function opciones(sel, lista, propia) {
    sel.innerHTML = lista.map(x => `<option value="${x.id}">${x.nombre}</option>`).join('') + `<option value="propia">${propia}</option>`;
}

const escHtml = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Canciones de fábrica, luego las que guardaste (canciones o ritmos de un audio) y "sin guardar"
function pintarCanciones() {
    const base = CANCIONES.map(x => `<option value="${x.id}">${x.nombre}</option>`).join('');
    const mias = S.guardadas.map(x => `<option value="g:${escHtml(x.id)}">${escHtml(x.nombre)}</option>`).join('');
    $('rb-cancion').innerHTML = base + (mias ? `<optgroup label="Mis canciones y ritmos">${mias}</optgroup>` : '')
        + '<option value="propia">Sin guardar (lo que hay en pantalla)</option>';
    $('rb-cancion').value = S.cancion;
}

// ---------- Audio o MIDI -> ritmo ----------
// Reutiliza la detección de golpes de timbre.js (la misma del ritmo del timbre) y deja el
// resultado como texto de notas con milisegundos, para poder editarlo, escucharlo y guardarlo.

function infoAudio(texto, tipo) {
    const el = $('rb-aud-info');
    el.textContent = texto || '';
    el.className = 'msg' + (tipo ? ' msg--' + tipo : '');
}

async function leerArchivoMusica(f) {
    const buf = await f.arrayBuffer();
    if (/\.midi?$/i.test(f.name)) {
        const notas = parseMidi(new Uint8Array(buf));
        if (!notas.length) throw new Error('el MIDI no trae notas');
        return { tipo: 'midi', notas, dur: notas[notas.length - 1].e / 1000 };
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    try {
        const buffer = await ctx.decodeAudioData(buf);
        return { tipo: 'audio', buffer, dur: buffer.duration };
    } finally {
        ctx.close();
    }
}

// Pedazo [ini, ini + dur] segundos, mezclado a mono
function monoVentana(buffer, ini, dur) {
    const sr = buffer.sampleRate;
    const a = Math.floor(ini * sr);
    const n = Math.max(1, Math.min(Math.floor(dur * sr), buffer.length - a));
    const x = new Float32Array(n);
    const canales = buffer.numberOfChannels;
    for (let c = 0; c < canales; c++) {
        const d = buffer.getChannelData(c);
        for (let i = 0; i < n; i++) x[i] += d[a + i] / canales;
    }
    return { x, sr };
}

// Tempo aproximado a partir del tiempo típico entre golpes, para que el baile (que va en tiempos) acompañe
function estimarBpm(intervalos) {
    const d = [];
    for (let i = 1; i < intervalos.length; i++) d.push(intervalos[i][0] - intervalos[i - 1][0]);
    d.sort((p, q) => p - q);
    const med = d[Math.floor(d.length / 2)];
    if (!med || med < 40) return null;
    let bpm = 60000 / med;
    while (bpm > 200) bpm /= 2;
    while (bpm < 70) bpm *= 2;
    return Math.round(bpm);
}

// Registro donde buscar la melodía: [Hz mínimo, Hz máximo]
const REGISTROS = { voz: [130, 1000], agudo: [260, 1800], grave: [60, 350] };

function convertirAudio() {
    if (!musicaCargada) return infoAudio('Primero elige un archivo de audio o un MIDI.', 'err');
    const ini = clamp(Number($('rb-aud-ini').value) || 0, 0, Math.max(0, musicaCargada.dur - 1));
    const dur = clamp(Number($('rb-aud-dur').value) || 20, 1, 60);
    const desde = ini * 1000, hasta = (ini + dur) * 1000;
    const melodia = $('rb-aud-que').value === 'melodia';
    let texto, intervalos, aviso = '';

    if (melodia) {
        // la línea melódica dominante: la voz si la hay, o el instrumento principal si es solo instrumental
        const reg = REGISTROS[$('rb-aud-reg').value] || REGISTROS.voz;
        const op = { fMin: reg[0], fMax: reg[1], sens: Number($('rb-aud-sens').value), tonalidad: $('rb-aud-tonal').checked, subir: $('rb-aud-subir').checked };
        let r;
        if (musicaCargada.tipo === 'midi') {
            const notas = musicaCargada.notas
                .filter(n => n.c !== 9 && n.p !== undefined && n.e > desde && n.s < hasta)       // sin la batería
                .map(n => ({ s: Math.max(0, n.s - desde), e: Math.min(hasta, n.e) - desde, p: n.p }));
            r = melodiaDeMidi(notas, op);
        } else {
            const { x, sr } = monoVentana(musicaCargada.buffer, ini, dur);
            r = melodiaDeAudio(x, sr, op);
        }
        texto = r.texto;
        intervalos = r.intervalos;
        if (r.tonalidad && texto) aviso = ' Tonalidad: ' + r.tonalidad + '.';
        if (r.truncado) aviso += ' Se cortó en ' + MAX_NOTAS + ' notas.';
        if (!texto) return infoAudio('No encontré una melodía clara en ese pedazo. Sube la sensibilidad, cambia el registro o elige otra parte.', 'err');
    } else {
        const op = { modo: $('rb-aud-modo').value, sens: Number($('rb-aud-sens').value), golpe: 120, sep: 120 };
        if (musicaCargada.tipo === 'midi') {
            const notas = musicaCargada.notas
                .filter(n => n.e > desde && n.s < hasta)
                .map(n => ({ s: Math.max(0, n.s - desde), e: Math.min(hasta, n.e) - desde }));
            intervalos = midiARitmo(notas, op).intervalos;
        } else {
            const { x, sr } = monoVentana(musicaCargada.buffer, ini, dur);
            intervalos = audioARitmo(x, sr, op).intervalos;
        }
        texto = ritmoATexto(intervalos, TONOS_RITMO[$('rb-aud-tono').value] || TONOS_RITMO.alterna);
        if (!texto) return infoAudio('No encontré golpes en ese pedazo. Sube la sensibilidad o elige otra parte.', 'err');
    }

    const n = leerNotas(texto).notas;
    const total = n.reduce((suma, x) => suma + (x.ms || 0), 0);
    const bpm = estimarBpm(intervalos);
    S.notas = texto;
    S.cancion = 'propia';
    if (bpm) S.bpm = bpm;
    $('rb-nombre').value = '';
    pintarCanciones();
    pintarTodo();
    cambio('cancion');
    const que = melodia ? n.filter(x => x.hz > 0).length + ' notas' : intervalos.length + ' golpes';
    infoAudio(`Listo: ${que} en ${(total / 1000).toFixed(1)} s${bpm ? ` (unos ${bpm} tiempos por minuto)` : ''}.${aviso} Escúchalo aquí o guárdalo con un nombre.`, 'ok');
}

function guardarCancion() {
    const texto = S.notas.trim();
    if (!leerNotas(texto).notas.length) return mensaje('No hay notas que guardar.', 'err');
    const nombre = ($('rb-nombre').value.trim() || ('Ritmo ' + (S.guardadas.length + 1))).slice(0, 40);
    let g = S.guardadas.find(x => x.nombre.toLowerCase() === nombre.toLowerCase());
    if (g) {
        g.texto = texto;
        g.bpm = S.bpm;
    } else {
        if (S.guardadas.length >= MAX_GUARDADAS) return mensaje('Ya tienes ' + MAX_GUARDADAS + ' guardados; borra alguno primero.', 'err');
        g = { id: Date.now().toString(36), nombre, texto, bpm: S.bpm };
        S.guardadas.push(g);
    }
    S.cancion = 'g:' + g.id;
    $('rb-nombre').value = g.nombre;
    pintarCanciones();
    pintarTodo();
    guardar();
    mensaje(`Guardado «${g.nombre}». Sale en la lista de canciones.`, 'ok');
}

function borrarCancion() {
    const g = S.guardadas.find(x => 'g:' + x.id === S.cancion);
    if (!g || !window.confirm(`¿Borrar «${g.nombre}»?`)) return;
    S.guardadas = S.guardadas.filter(x => x !== g);
    S.cancion = 'propia';
    $('rb-nombre').value = '';
    pintarCanciones();
    pintarTodo();
    guardar();
    mensaje('Borrado.');
}

// ---------- Teclado: tocar y grabar ----------

const T = {
    octava: 4, actual: null, abajo: new Set(), grabando: false, esperando: false, t0: 0, eventos: [],
    ctx: null, osc: null, amp: null, ultimoEnvio: 0,
};
const MAX_GRABADAS = 280;     // notas por grabación (con sus silencios caben en las 600 fichas)
const BLANCAS = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];
const NEGRAS = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5, 13: 7, 15: 8, 18: 10, 20: 11, 22: 12 };   // semitono -> blanca a su izquierda

function infoRec(texto, tipo) {
    const el = $('rb-rec-info');
    el.textContent = texto || '';
    el.className = 'msg' + (tipo ? ' msg--' + tipo : '');
}

function notaDeSemitono(semi) {
    const midi = (T.octava + 1) * 12 + semi;
    return { nombre: nombreMidi(midi), hz: clamp(Math.round(440 * Math.pow(2, (midi - 69) / 12)), 40, 8000) };
}

function pintarTeclado() {
    const letras = {};
    for (const [codigo, semi] of Object.entries(TECLAS_PIANO)) letras[semi] = codigo.replace(/^Key|^Digit/, '');
    const n = BLANCAS.length;
    const blancas = BLANCAS.map(s => `<button type="button" class="rb-tecla" data-s="${s}" aria-label="${notaDeSemitono(s).nombre}"><span>${letras[s] || ''}</span></button>`).join('');
    const negras = Object.entries(NEGRAS).map(([s, izq]) =>
        `<button type="button" class="rb-tecla rb-tecla--negra" data-s="${s}" style="left: ${(izq + 1) * 100 / n}%" aria-label="${notaDeSemitono(Number(s)).nombre}"><span>${letras[s] || ''}</span></button>`).join('');
    $('rb-piano').innerHTML = blancas + negras;
    $('rb-tec-oct').textContent = `Octava ${T.octava}: de ${notaDeSemitono(0).nombre} a ${notaDeSemitono(24).nombre}`;
}

function pintarTecla(semi, abajo) {
    const b = $('rb-piano').querySelector(`[data-s="${semi}"]`);
    if (b) b.classList.toggle('is-down', abajo);
}

function sonidoTeclado(hz) {            // hz = 0 calla
    if (!$('rb-tec-aqui').checked) return;
    if (!T.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        T.ctx = new Ctx();
        T.osc = T.ctx.createOscillator();
        T.amp = T.ctx.createGain();
        T.osc.type = 'square';
        T.amp.gain.value = 0;
        T.osc.connect(T.amp).connect(T.ctx.destination);
        T.osc.start();
    }
    if (T.ctx.state === 'suspended') T.ctx.resume();
    const t = T.ctx.currentTime;
    if (hz) {
        T.osc.frequency.setValueAtTime(hz, t);
        T.amp.gain.setTargetAtTime(0.06 * S.vol / 100, t, 0.004);
    } else {
        T.amp.gain.setTargetAtTime(0, t, 0.012);
    }
}

function pintarGrabacion() {
    const g = grabacionATexto(T.eventos);
    $('rb-rec-texto').value = g.texto;
    const suena = T.actual ? ' (suena ' + T.actual.nombre + ')' : '';
    infoRec(T.esperando ? 'Grabando… toca una tecla para empezar.' : `Grabando: ${g.notas} notas, ${(g.ms / 1000).toFixed(1)} s${suena}`);
}

function cerrarNotaTeclado(ahora) {
    const a = T.actual;
    if (!a) return;
    T.actual = null;
    sonidoTeclado(0);
    pintarTecla(a.semi, false);
    if (T.grabando && !T.esperando) {
        T.eventos.push({ n: a.nombre, s: a.s - T.t0, e: ahora - T.t0 });
        if (T.eventos.length >= MAX_GRABADAS) { pararGrabacion(); return; }
    }
    if (T.grabando) pintarGrabacion();
}

function teclaAbajo(semi) {
    if (T.abajo.has(semi)) return;
    T.abajo.add(semi);
    const ahora = performance.now();
    cerrarNotaTeclado(ahora);                           // una nota a la vez, como el zumbador
    const n = notaDeSemitono(semi);
    T.actual = { semi, nombre: n.nombre, hz: n.hz, s: ahora };
    if (T.grabando && T.esperando) { T.esperando = false; T.t0 = ahora; }
    sonidoTeclado(n.hz);
    pintarTecla(semi, true);
    // en el robot suena corto y espaciado para que no se acumule la cola
    if ($('rb-tec-robot').checked && S.estado === 'listo' && !S.actuando && !S.enShow && ahora - T.ultimoEnvio > 150) {
        T.ultimoEnvio = ahora;
        S.cola.enviar([`T ${n.hz} 140`]);
    }
    if (T.grabando) pintarGrabacion();
}

function teclaArriba(semi) {
    T.abajo.delete(semi);
    if (T.actual && T.actual.semi === semi) cerrarNotaTeclado(performance.now());
}

function soltarTodas() {
    [...T.abajo].forEach(teclaArriba);
    cerrarNotaTeclado(performance.now());
}

function pararGrabacion() {
    cerrarNotaTeclado(performance.now());
    if (!T.grabando) return;
    T.grabando = false;
    T.esperando = false;
    const g = grabacionATexto(T.eventos);
    S.rec = g.texto;
    $('rb-rec-texto').value = g.texto;
    $('rb-rec-boton').textContent = '● Grabar';
    infoRec(g.notas ? `Grabadas ${g.notas} notas en ${(g.ms / 1000).toFixed(1)} s. Úsala como la canción o guárdala con un nombre.` : 'No se grabó ninguna nota.', g.notas ? 'ok' : 'err');
    guardar();
}

function grabarTeclado() {
    if (T.grabando) return pararGrabacion();
    T.grabando = true;
    T.esperando = true;
    T.eventos = [];
    $('rb-rec-boton').textContent = '■ Parar';
    pintarGrabacion();
}

function limpiarGrabacion() {
    if (T.grabando) { T.grabando = false; T.esperando = false; $('rb-rec-boton').textContent = '● Grabar'; }
    cerrarNotaTeclado(performance.now());
    T.eventos = [];
    S.rec = '';
    $('rb-rec-texto').value = '';
    infoRec('');
    guardar();
}

// La grabación pasa a ser la canción de la pantalla (con el tempo estimado para que el baile la siga)
function usarGrabacion() {
    if (T.grabando) pararGrabacion();
    const texto = S.rec.trim();
    const notas = leerNotas(texto).notas;
    if (!notas.length) { infoRec('Todavía no hay una grabación: pulsa Grabar y toca algunas teclas.', 'err'); return false; }
    const intervalos = [];
    let t = 0;
    for (const n of notas) {
        const dur = n.ms !== undefined ? n.ms : 0;
        if (n.hz > 0) intervalos.push([t, t + dur]);
        t += dur;
    }
    const bpm = estimarBpm(intervalos);
    S.notas = texto;
    S.cancion = 'propia';
    if (bpm) S.bpm = bpm;
    $('rb-nombre').value = '';
    pintarCanciones();
    pintarTodo();
    cambio('cancion');
    return true;
}

function guardarGrabacion() {
    if (!usarGrabacion()) return;
    $('rb-nombre').value = $('rb-rec-nombre').value.trim();
    guardarCancion();
    infoRec(`Grabación guardada como «${$('rb-nombre').value}». Sale en la lista de canciones.`, 'ok');
}

function iniciarTeclado() {
    pintarTeclado();
    $('rb-rec-texto').value = S.rec;
    const piano = $('rb-piano');
    piano.addEventListener('pointerdown', e => {
        const b = e.target.closest('.rb-tecla');
        if (!b) return;
        e.preventDefault();
        const semi = Number(b.dataset.s);
        teclaAbajo(semi);
        const suelta = () => {
            teclaArriba(semi);
            window.removeEventListener('pointerup', suelta);
            window.removeEventListener('pointercancel', suelta);
        };
        window.addEventListener('pointerup', suelta);
        window.addEventListener('pointercancel', suelta);
    });
    const cambiaOctava = d => { soltarTodas(); T.octava = clamp(T.octava + d, 2, 6); pintarTeclado(); };
    $('rb-tec-oct-menos').addEventListener('click', () => cambiaOctava(-1));
    $('rb-tec-oct-mas').addEventListener('click', () => cambiaOctava(1));
    $('rb-rec-boton').addEventListener('click', grabarTeclado);
    $('rb-rec-limpiar').addEventListener('click', limpiarGrabacion);
    $('rb-rec-usar').addEventListener('click', () => { if (usarGrabacion()) infoRec('Lista como la canción de la pantalla: escúchala o cántala en el robot.', 'ok'); });
    $('rb-rec-guardar').addEventListener('click', guardarGrabacion);

    // teclas del teclado de la computadora, sin estorbar cuando se está escribiendo en un cuadro
    const escribiendo = el => el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
        || (el.tagName === 'INPUT' && !/^(range|checkbox|radio|button|file)$/.test(el.type)));
    document.addEventListener('keydown', e => {
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || $('sec-robot').hidden || escribiendo(e.target)) return;
        const semi = TECLAS_PIANO[e.code];
        if (semi === undefined) return;
        e.preventDefault();
        teclaAbajo(semi);
    });
    document.addEventListener('keyup', e => {
        const semi = TECLAS_PIANO[e.code];
        if (semi !== undefined) teclaArriba(semi);
    });
    window.addEventListener('blur', soltarTodas);
}

// ---------- Seguidor de líneas (desactivado) ----------

function pintarLinea() {
    const c = S.linea;
    $('rb-ln-puerto').value = String(c.puerto);
    $('rb-ln-color').value = c.color;
    $('rb-ln-vel').value = c.velocidad;
    $('rb-ln-vel-v').textContent = c.velocidad;
    $('rb-ln-giro').value = c.giro;
    $('rb-ln-giro-v').textContent = c.giro + ' %';
    $('rb-ln-perdida').value = c.perdida;
    $('rb-ln-buscar').value = c.buscarMs;
    $('rb-ln-buscar-campo').hidden = c.perdida !== 'buscar';
    $('rb-ln-cruce').value = c.cruce;
    $('rb-ln-obst').value = c.obstaculoCm;
    $('rb-ln-dur').value = c.duracionS;
    $('rb-ln-avisos').checked = c.avisos;
}

function cambioLinea() {
    S.linea = lineaNormaliza({
        puerto: $('rb-ln-puerto').value, color: $('rb-ln-color').value,
        velocidad: $('rb-ln-vel').value, giro: $('rb-ln-giro').value,
        perdida: $('rb-ln-perdida').value, buscarMs: $('rb-ln-buscar').value,
        cruce: $('rb-ln-cruce').value, obstaculoCm: $('rb-ln-obst').value,
        duracionS: $('rb-ln-dur').value, avisos: $('rb-ln-avisos').checked,
    });
    pintarLinea();
    guardar();
    if (S.corriendoFuncion && S.autonomo === 6 && S.estado === 'listo' && !S.cola.ocupado()) {
        S.cola.enviar(lineaAOrdenes(lineaEnRobot()));          // el robot lee estos valores en cada vuelta
    }
}

// ---------- Barra fija: parar y reproducir lo que haya en la sección que se ve ----------

const QUE_REPRODUCE = {
    'robot-musica': 'la canción', 'robot-baile': 'el baile con la canción', 'robot-funciones': 'la función elegida',
    'robot-luces': 'las luces',
    'robot-show': 'el show guardado', 'robot-instalar': 'nada en esta sección',
};

function seccionRobotActual() {
    const el = [...document.querySelectorAll('[data-section^="robot-"]')].find(e => !e.hidden);
    return el ? el.dataset.section : 'robot-musica';
}

function pintarBarra() {
    const sec = seccionRobotActual();
    $('rb-barra-que').textContent = QUE_REPRODUCE[sec] || 'nada';
    $('rb-barra-play').disabled = sec === 'robot-instalar';
}

// Con el robot conectado se reproduce en el robot; si no, la música suena en la página
function reproducirGeneral() {
    const sec = seccionRobotActual();
    const listo = S.estado === 'listo';
    if (sec === 'robot-musica') return listo ? actuar(true, false) : escucharAqui();
    if (sec === 'robot-baile') return listo ? actuar(true, true) : escucharAqui();
    if (sec === 'robot-funciones') return iniciarFuncion();
    if (sec === 'robot-show') return probarShow();
    if (sec === 'robot-luces') {
        if (!listo) return mensaje('Conecta el robot para ver las luces en él.', 'err');
        S.guardarEn = Date.now() + 2500;
        S.cola.enviar([{ l: fxLinea(S.efecto, S.brillo, coloresBase(), S.velFx), ex: true }, 'VOL ' + S.vol]);
        return mensaje('Luces enviadas al robot.', 'ok');
    }
    mensaje('En esta sección no hay nada que reproducir.');
}

function pararTodo() {
    soltarTodas();            // el teclado: corta la nota que esté sonando
    paro();                   // el robot (motores, nota y cola), el sonido de la página y el avance
}

function iniciarLineaYBateria() {
    // la conexión vive solo en Instalar: el estado de la cabecera lleva allá
    const irAConectar = () => { if (typeof mostrarSeccionAdmin === 'function') mostrarSeccionAdmin('robot-instalar'); };
    $('rb-badge').addEventListener('click', irAConectar);
    $('rb-badge').addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); irAConectar(); }
    });
    $('rb-barra-paro').addEventListener('click', pararTodo);
    $('rb-barra-play').addEventListener('click', reproducirGeneral);
    document.addEventListener('seccion-admin', () => { pintarBarra(); pintarFunciones(); });
    pintarBarra();
    for (const id of ['rb-ln-puerto', 'rb-ln-color', 'rb-ln-perdida', 'rb-ln-cruce', 'rb-ln-buscar', 'rb-ln-obst', 'rb-ln-dur']) {
        $(id).addEventListener('change', cambioLinea);
    }
    for (const id of ['rb-ln-vel', 'rb-ln-giro']) $(id).addEventListener('input', cambioLinea);
    $('rb-ln-avisos').addEventListener('change', cambioLinea);
    $('rb-ln-reset').addEventListener('click', () => { S.linea = lineaNormaliza(null); pintarLinea(); guardar(); });

    // ajustes de las pilas: el porcentaje y la duración se calculan con esto
    $('rb-bat-quim').value = S.bateria.quimica;
    $('rb-bat-cap').value = S.bateria.capacidad;
    $('rb-bat-carga-ma').value = S.bateria.cargador;
    $('rb-bat-carga-ma').addEventListener('change', e => {
        S.bateria.cargador = clamp(Math.round(Number(e.target.value) || 500), 100, 3000);
        e.target.value = S.bateria.cargador;
        guardar();
        if (S.ultimoVolt !== null) mostrarBateria(S.ultimoVolt);
    });
    $('rb-bat-quim').addEventListener('change', e => {
        S.bateria.quimica = e.target.value in CURVAS_BATERIA ? e.target.value : 'nimh';
        S.bateria.capacidad = CAPACIDAD_DEFECTO[S.bateria.quimica];
        S.bateria.hist = [];
        $('rb-bat-cap').value = S.bateria.capacidad;
        S.ultimoNivel = 'ok';
        guardar();
        if (S.ultimoVolt !== null) mostrarBateria(S.ultimoVolt);
    });
    $('rb-bat-cap').addEventListener('change', e => {
        S.bateria.capacidad = clamp(Math.round(Number(e.target.value) || CAPACIDAD_DEFECTO[S.bateria.quimica]), 500, 10000);
        e.target.value = S.bateria.capacidad;
        guardar();
        if (S.ultimoVolt !== null) mostrarBateria(S.ultimoVolt);
    });
    $('rb-bat-borrar').addEventListener('click', () => {
        S.bateria.hist = [];
        guardar();
        if (S.ultimoVolt !== null) mostrarBateria(S.ultimoVolt);
    });
    pintarLinea();
}

function iniciar() {
    if (!$('sec-robot')) return;
    cargar();
    S.cola = crearCola(escribirLinea, crudo);
    pintarCanciones();
    opciones($('rb-baile'), BAILES, 'Mi baile');
    $('rb-efecto').innerHTML = EFECTOS.map(([id, n]) => `<option value="${id}">${n}</option>`).join('');
    $('rb-fn-var').innerHTML = VARIANTES.map(v => `<option value="${v.id}">${v.nombre}</option>`).join('');
    $('rb-paleta').innerHTML = PALETA.map(([c, n]) => `<button type="button" class="rb-sw" data-c="${c}" aria-label="Pintar todos de ${n}" title="${n}"><span class="rb-sw__dot" style="--c:${c}"></span><span class="rb-sw__name">${n}</span></button>`).join('');
    pintarTodo();
    ponEstado('desconectado');

    $('rb-conectar').addEventListener('click', () => conectar(false));
    $('rb-todos').addEventListener('click', () => conectar(true));
    $('rb-paro').addEventListener('click', paro);
    $('rb-diag-borrar').addEventListener('click', () => { S.cola.enviar(['DIAG0']); $('rb-diag').hidden = true; });
    $('rb-tocar').addEventListener('click', () => actuar(true, false));
    $('rb-bailar').addEventListener('click', () => actuar(true, true));
    $('rb-escuchar').addEventListener('click', escucharAqui);
    $('rb-silencio').addEventListener('click', () => { detenerAudio(); progreso(0); });

    $('rb-vivo').addEventListener('change', e => { S.vivo = e.target.checked; S.sucio = true; guardar(); });
    $('rb-repetir').addEventListener('change', e => { S.repetir = e.target.checked; guardar(); });
    $('rb-auto').addEventListener('change', e => { S.arranca = e.target.checked; guardar(); });
    $('rb-pgm-guardar').addEventListener('click', guardarShow);
    $('rb-pgm-probar').addEventListener('click', probarShow);
    $('rb-pgm-borrar').addEventListener('click', borrarShow);

    $('rb-cancion').addEventListener('change', e => {
        S.cancion = e.target.value;
        const c = CANCIONES.find(x => x.id === S.cancion) || S.guardadas.find(x => 'g:' + x.id === S.cancion);
        if (c) { S.notas = c.texto; S.bpm = c.bpm; }
        $('rb-nombre').value = S.cancion.startsWith('g:') ? c.nombre : '';
        pintarTodo();
        cambio('cancion');
    });
    $('rb-notas').addEventListener('input', e => {
        S.notas = e.target.value;
        S.cancion = 'propia';
        $('rb-cancion').value = 'propia';
        $('rb-borrar').disabled = true;
        mostrarErrores(leerNotas(S.notas).errores, leerBaile(S.pasos).errores);
        cambio('cancion');
    });
    $('rb-guardar').addEventListener('click', guardarCancion);
    $('rb-borrar').addEventListener('click', borrarCancion);

    $('rb-audio').addEventListener('change', async e => {
        const f = e.target.files[0];
        musicaCargada = null;
        if (!f) return infoAudio('');
        infoAudio('Leyendo el archivo…');
        try {
            musicaCargada = await leerArchivoMusica(f);
            $('rb-aud-ini').value = 0;
            infoAudio(`${f.name}: dura ${musicaCargada.dur.toFixed(1)} s. Elige desde dónde y pulsa Convertir en ritmo.`);
        } catch (err) {
            infoAudio('No pude leer ese archivo (' + (err && err.message ? err.message : 'formato no válido') + ').', 'err');
        }
    });
    $('rb-aud-sens').addEventListener('input', e => { $('rb-aud-sens-v').textContent = e.target.value; });
    $('rb-aud-convertir').addEventListener('click', convertirAudio);
    $('rb-bpm').addEventListener('input', e => {
        S.bpm = Number(e.target.value);
        $('rb-bpm-v').textContent = S.bpm + ' tiempos por minuto';
        cambio('cancion');
    });

    $('rb-baile').addEventListener('change', e => {
        quitarFuncion();
        S.baile = e.target.value;
        const b = BAILES.find(x => x.id === S.baile);
        if (b) S.pasos = b.texto;
        pintarTodo();
        cambio('baile');
    });
    $('rb-pasos').addEventListener('input', e => {
        quitarFuncion();
        S.pasos = e.target.value;
        S.baile = 'propia';
        $('rb-baile').value = 'propia';
        mostrarErrores(leerNotas(S.notas).errores, leerBaile(S.pasos).errores);
        cambio('baile');
    });
    const ponVel = e => {                  // una sola velocidad para el baile y para las funciones
        S.vel = Number(e.target.value);
        for (const id of ['rb-vel', 'rb-fn-vel']) $(id).value = S.vel;
        for (const id of ['rb-vel-v', 'rb-fn-vel-v']) $(id).textContent = S.vel;
        cambio('baile');
    };
    $('rb-vel').addEventListener('input', ponVel);
    $('rb-fn-vel').addEventListener('input', ponVel);

    // Funciones por modelo
    $('rb-fn-var').addEventListener('change', e => {
        if (S.corriendoFuncion) paro();
        S.variante = e.target.value;
        if (!funcionActual()) S.funcion = '';
        guardar();
        pintarFunciones();
    });
    $('rb-fn-lista').addEventListener('change', e => {
        if (e.target.name === 'rb-fn') elegirFuncion(e.target.value);
    });
    $('rb-fn-luces').addEventListener('change', e => { S.funLuces = e.target.checked; cambio('led'); });
    $('rb-fn-musica').addEventListener('change', e => { S.funMusica = e.target.checked; cambio('funcion'); });
    $('rb-fn-giro').addEventListener('input', e => {
        S.giro90 = Number(e.target.value);
        $('rb-fn-giro-v').textContent = S.giro90 + ' ms';
        cambio('funcion');
    });
    $('rb-fn-iniciar').addEventListener('click', () => iniciarFuncion());

    $('rb-anillo').addEventListener('click', e => {
        const b = e.target.closest('.rb-led');
        if (!b) return;
        S.sel = Number(b.dataset.i);
        pintarAnillo();
    });
    $('rb-led-color').addEventListener('input', e => { S.leds[S.sel] = e.target.value; pintarAnillo(); cambio('led'); });
    $('rb-led-todos').addEventListener('click', () => { S.leds.fill($('rb-led-color').value); pintarAnillo(); cambio('led'); });
    $('rb-paleta').addEventListener('click', e => {
        const b = e.target.closest('.rb-sw');
        if (!b) return;
        S.leds.fill(b.dataset.c);
        pintarAnillo();
        cambio('led');
    });
    $('rb-brillo').addEventListener('input', e => {
        S.brillo = Number(e.target.value);
        $('rb-brillo-v').textContent = S.brillo + ' %';
        cambio('led');
    });
    $('rb-efecto').addEventListener('change', e => { S.efecto = e.target.value; cambio('led'); });
    $('rb-fxvel').addEventListener('input', e => {
        S.velFx = Number(e.target.value);
        $('rb-fxvel-v').textContent = S.velFx + ' %';
        cambio('led');
    });
    $('rb-vol').addEventListener('input', e => {
        S.vol = Number(e.target.value);
        $('rb-vol-v').textContent = S.vol + ' %';
        cambio('led');
    });
    iniciarTeclado();
    iniciarLineaYBateria();

    setInterval(tickLeds, 100);

    // Conectarse solo al abrir la pestaña y al enchufar el cable
    new MutationObserver(conectarSolo).observe($('sec-robot'), { attributes: true, attributeFilter: ['hidden'] });
    if ('serial' in navigator) {
        navigator.serial.addEventListener('connect', conectarSolo);
        navigator.serial.addEventListener('disconnect', () => { if (S.estado !== 'desconectado') cerrar(); });
    } else {
        mensaje('Para controlar el robot abre esta página en Chrome o Edge desde una computadora.', 'err');
    }
    window.addEventListener('pagehide', () => { if (S.estado === 'listo') crudo(S.autonomo ? '!MODE 4\n' : '!'); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();

})(typeof window !== 'undefined' ? window : globalThis);
