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
const MAX_NOTAS = 400;
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

// "C4/8", "F#3/4.", "R/2": la duración se repite hasta que pongas otra. /4 = un tiempo, /2 = dos.
function leerNotas(texto) {
    const notas = [], errores = [];
    let denom = 4, punto = false;
    for (const tok of palabras(texto)) {
        const m = /^(?:([A-Ga-g])([#b]?)(\d)|[Rr])(?:\/(\d+)(\.?))?$/.exec(tok);
        if (!m) { errores.push(tok); continue; }
        if (m[4] !== undefined) {
            const d = Number(m[4]);
            if (!DENOMINADORES.includes(d)) { errores.push(tok); continue; }
            denom = d;
            punto = m[5] === '.';
        }
        notas.push({ nombre: tok, hz: m[1] ? frecuencia(m[1], m[2], Number(m[3])) : 0, beats: (4 / denom) * (punto ? 1.5 : 1) });
        if (notas.length >= MAX_NOTAS) { errores.push('…'); break; }
    }
    return { notas, errores };
}

// Movimientos: [rueda izquierda, rueda derecha] en múltiplos de la velocidad (positivo = adelante)
const MOVIMIENTOS = { AD: [1, 1], AT: [-1, -1], GI: [-1, 1], GD: [1, -1], PA: [0, 0] };

// "AD/2 GI/4 PA/4": adelante, atrás, gira izquierda, gira derecha, parar. Misma duración que las notas.
function leerBaile(texto) {
    const pasos = [], errores = [];
    let denom = 4, punto = false;
    for (const tok of palabras(texto)) {
        const m = /^(AD|AT|GI|GD|PA)(?:\/(\d+)(\.?))?$/i.exec(tok);
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
// Devuelve { cmds: [{ l, ms, ex }], ms }. ex = orden de LEDs (va sola, sin nada detrás hasta su OK).
function compilar({ notas = [], pasos = [], bpm = 120, vel = 110, luz = null }) {
    const beatMs = 60000 / clamp(Number(bpm) || 120, 30, 300);
    const v = clamp(Math.round(Number(vel) || 0), 0, VEL_MAX);
    const R = Math.round;

    // Sonido: segmentos [a, b) en ms enteros; cada nota suena ARTICULACION y luego calla.
    // Los tiempos se redondean absolutos para que el error no se acumule.
    const son = [];
    let t = 0;
    notas.forEach((n, i) => {
        const dur = n.beats * beatMs;
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
            cmds.push({ l: `M ${l * v} ${r * v}`, ms: 0 });
        }
        for (let resta = b - a; resta > 0; resta -= MAX_ORDEN_MS) {
            const ms = Math.min(resta, MAX_ORDEN_MS);
            cmds.push(s && s.hz > 0 ? { l: `T ${s.hz} ${ms}`, ms } : { l: `W ${ms}`, ms });
        }
    }
    if (baile.length) cmds.push({ l: 'S', ms: 0 });
    return { cmds, ms: total };
}

// ---------- Cola con confirmaciones ----------
// Cada orden se confirma con una línea OK/ERR. Se mandan varias seguidas (para que no haya huecos
// entre notas) sin pasarse de VENTANA_BYTES. Las de LEDs van solas porque mientras el robot
// dibuja el anillo no oye el USB. "!" (abortar) corta todo y se espera su "ABORTED".

function crearCola(escribir, crudo) {
    let pend = [], vuelo = [], abortando = false, alFinal = null, timerAborto = null;

    function bombear() {
        if (abortando) return;
        while (pend.length) {
            const c = pend[0], n = c.l.length + 1;
            const bytes = vuelo.reduce((s, x) => s + x.n, 0);
            if (vuelo.length && (c.ex || vuelo[vuelo.length - 1].ex)) break;
            if (vuelo.length >= VENTANA_ORDENES || (vuelo.length && bytes + n > VENTANA_BYTES)) break;
            pend.shift();
            vuelo.push({ n, ex: !!c.ex });
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
            bombear();
        },
        ack() { if (!abortando && vuelo.length) { vuelo.shift(); bombear(); } },
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

// base: 12 colores [r,g,b]; t en ms; hz solo para "musica". Devuelve 12 colores [r,g,b].
function efecto(nombre, t, base, hz) {
    switch (nombre) {
        case 'arcoiris':
            return base.map((_, i) => hsv((i / LEDS + t / 4000) % 1, 1, 1));
        case 'respirar': {
            const k = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(2 * Math.PI * t / 2400));
            return base.map(c => c.map(x => x * k));
        }
        case 'persecucion': {
            const cabeza = Math.floor(t / 90) % LEDS;
            return base.map((c, i) => {
                const d = (cabeza - i + LEDS) % LEDS;
                const k = d < 5 ? 1 - d * 0.2 : 0.04;
                return c.map(x => x * k);
            });
        }
        case 'musica': {
            if (!hz) return base;
            const tono = ((Math.log2(hz / 261.63) % 1) + 1) % 1;   // la misma nota da el mismo color en cualquier octava
            return base.map(() => hsv(tono, 1, 1));
        }
        default:
            return base;
    }
}

// 12 colores [r,g,b] -> "RRGGBB" x 12 con el brillo (0 a 100) aplicado
function marcoHex(colores, brillo) {
    const k = clamp(brillo, 0, 100) / 100;
    return colores.slice(0, LEDS).map(c => c.map(x => clamp(Math.round(x * k), 0, 255).toString(16).padStart(2, '0')).join('')).join('');
}

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

const EFECTOS = [
    ['fijo', 'Colores fijos'], ['arcoiris', 'Arcoíris giratorio'], ['respirar', 'Respirar'],
    ['persecucion', 'Persecución'], ['musica', 'Cambia con cada nota'],
];

const lib = {
    BAUDIOS, VEL_MAX, ARTICULACION, LEDS, CANCIONES, BAILES, EFECTOS,
    frecuencia, leerNotas, leerBaile, compilar, crearCola, crearLector,
    hsv, hexARgb, efecto, marcoHex,
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
    leds: Array.from({ length: LEDS }, () => '#00a850'),
    brillo: 40, efecto: 'fijo', vivo: true, repetir: false,
    cancion: 'estrellita', notas: '', bpm: 110, baile: 'vaiven', pasos: null, vel: 110,
};

function guardar() {
    try {
        const { leds, brillo, efecto, vivo, repetir, cancion, notas, bpm, baile, pasos, vel } = S;
        localStorage.setItem(LLAVE, JSON.stringify({ leds, brillo, efecto, vivo, repetir, cancion, notas, bpm, baile, pasos, vel }));
    } catch (e) { /* sin almacenamiento: no se recuerda nada */ }
}

function cargar() {
    try {
        const g = JSON.parse(localStorage.getItem(LLAVE) || 'null');
        if (g && typeof g === 'object') Object.assign(S, g);
    } catch (e) { /* datos viejos o dañados: se usan los de fábrica */ }
    if (!Array.isArray(S.leds) || S.leds.length !== LEDS) S.leds = Array.from({ length: LEDS }, () => '#00a850');
    if (!S.notas) {
        const c = CANCIONES.find(x => x.id === S.cancion) || CANCIONES[0];
        S.notas = c.texto;
        S.bpm = c.bpm;
    }
    if (S.pasos === null || S.pasos === undefined) S.pasos = (BAILES.find(b => b.id === S.baile) || BAILES[0]).texto;
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
    for (const id of ['rb-tocar', 'rb-bailar']) $(id).disabled = est !== 'listo';
    if (est === 'sinprograma') $('rb-instalar').open = true;
}

// ---------- Puerto serie ----------

function crudo(texto) {
    if (S.escritor) S.escritor.write(new TextEncoder().encode(texto)).catch(() => { /* se cerró */ });
}
const escribirLinea = l => crudo(l + '\n');

function alLinea(l) {
    if (/^(OK|ERR)\b/.test(l)) {
        if (/^ERR/.test(l)) mensaje('El robot no entendió una orden (' + l + ').', 'err');
        S.cola.ack();
    } else if (/^PONG mbot-web/.test(l) || /mBot Ranger web .*listo/.test(l)) {
        if (S.estado === 'conectando') alListo();
    } else if (/mBot Ranger listo/.test(l)) {
        S.vioArranque = true;   // el programa viejo (tanquecito): no habla con la página
    } else if (l === 'ABORTED') {
        S.cola.abortado();
    } else if (l === 'WDT') {
        mensaje('El robot se detuvo solo porque la página dejó de mandarle órdenes.', 'err');
    } else if (/^BTN \d/.test(l)) {
        mensaje('Se cambió de modo con el botón del robot. Pulsa Tocar o Bailar para que vuelva a obedecer a la página.');
    }
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
            amp.gain.setValueAtTime(0.06, t);
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

// Devuelve { cmds, ms } con la canción y/o el baile que haya en pantalla
function armar(conCancion, conBaile) {
    const n = leerNotas(S.notas), b = leerBaile(S.pasos);
    mostrarErrores(n.errores, b.errores);
    const base = coloresBase();
    const luz = (i, hz) => marcoHex(efecto(S.efecto, (i || 0) * 150, base, hz), S.brillo);
    return compilar({
        notas: conCancion ? n.notas : [],
        pasos: conBaile ? b.pasos : [],
        bpm: S.bpm, vel: S.vel,
        luz: S.efecto === 'fijo' ? null : luz,
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
    S.actuando = { conCancion, conBaile };
    S.inicio = performance.now();
    S.total = ms;
    S.cola.enviar(['MODE 4'].concat(cmds), () => {
        if (S.actuando && S.repetir) return actuar(conCancion, conBaile);
        S.actuando = false;
        progreso(0);
        S.sucio = true;
        mensaje('Listo.', 'ok');
    });
    mensaje(conBaile ? 'Bailando…' : 'Cantando…');
}

function paro() {
    S.actuando = false;
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
    actuar(a.conCancion, a.conBaile);
}

// Anillo de LEDs y efectos: cada 100 ms, si el robot está libre
function tickLeds() {
    const visible = !$('sec-robot').hidden && !document.hidden;
    if (S.actuando || S.audio) progreso((performance.now() - S.inicio) / S.total);
    if (S.estado !== 'listo' || !S.vivo || S.actuando || !visible || S.cola.ocupado()) return;
    const animado = S.efecto !== 'fijo' && S.efecto !== 'musica';
    if (!animado && !S.sucio) return;
    S.sucio = false;
    const colores = efecto(animado ? S.efecto : 'fijo', performance.now(), coloresBase());
    S.cola.enviar([{ l: 'LS ' + marcoHex(colores, S.brillo), ex: true }]);
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
    $('rb-vivo').checked = S.vivo;
    $('rb-repetir').checked = S.repetir;
    $('rb-cancion').value = S.cancion;
    $('rb-baile').value = S.baile;
    pintarAnillo();
    mostrarErrores(leerNotas(S.notas).errores, leerBaile(S.pasos).errores);
}

function opciones(sel, lista, propia) {
    sel.innerHTML = lista.map(x => `<option value="${x.id}">${x.nombre}</option>`).join('') + `<option value="propia">${propia}</option>`;
}

function iniciar() {
    if (!$('sec-robot')) return;
    cargar();
    S.cola = crearCola(escribirLinea, crudo);
    opciones($('rb-cancion'), CANCIONES, 'Mi canción');
    opciones($('rb-baile'), BAILES, 'Mi baile');
    $('rb-efecto').innerHTML = EFECTOS.map(([id, n]) => `<option value="${id}">${n}</option>`).join('');
    const paleta = [['#ff2a2a', 'Rojo'], ['#ff7a00', 'Naranja'], ['#ffd400', 'Amarillo'], ['#00c040', 'Verde'],
                    ['#00c8d0', 'Cian'], ['#2060ff', 'Azul'], ['#a030ff', 'Morado'], ['#ffffff', 'Blanco'], ['#000000', 'Apagado']];
    $('rb-paleta').innerHTML = paleta.map(([c, n]) => `<button type="button" class="rb-sw" data-c="${c}" style="--c:${c}" aria-label="Pintar todos de ${n}" title="${n}"></button>`).join('');
    pintarTodo();
    ponEstado('desconectado');

    $('rb-conectar').addEventListener('click', () => conectar(false));
    $('rb-todos').addEventListener('click', () => conectar(true));
    $('rb-paro').addEventListener('click', paro);
    $('rb-tocar').addEventListener('click', () => actuar(true, false));
    $('rb-bailar').addEventListener('click', () => actuar(true, true));
    $('rb-escuchar').addEventListener('click', escucharAqui);
    $('rb-silencio').addEventListener('click', () => { detenerAudio(); progreso(0); });

    $('rb-vivo').addEventListener('change', e => { S.vivo = e.target.checked; S.sucio = true; guardar(); });
    $('rb-repetir').addEventListener('change', e => { S.repetir = e.target.checked; guardar(); });

    $('rb-cancion').addEventListener('change', e => {
        S.cancion = e.target.value;
        const c = CANCIONES.find(x => x.id === S.cancion);
        if (c) { S.notas = c.texto; S.bpm = c.bpm; }
        pintarTodo();
        cambio('cancion');
    });
    $('rb-notas').addEventListener('input', e => {
        S.notas = e.target.value;
        S.cancion = 'propia';
        $('rb-cancion').value = 'propia';
        mostrarErrores(leerNotas(S.notas).errores, leerBaile(S.pasos).errores);
        cambio('cancion');
    });
    $('rb-bpm').addEventListener('input', e => {
        S.bpm = Number(e.target.value);
        $('rb-bpm-v').textContent = S.bpm + ' tiempos por minuto';
        cambio('cancion');
    });

    $('rb-baile').addEventListener('change', e => {
        S.baile = e.target.value;
        const b = BAILES.find(x => x.id === S.baile);
        if (b) S.pasos = b.texto;
        pintarTodo();
        cambio('baile');
    });
    $('rb-pasos').addEventListener('input', e => {
        S.pasos = e.target.value;
        S.baile = 'propia';
        $('rb-baile').value = 'propia';
        mostrarErrores(leerNotas(S.notas).errores, leerBaile(S.pasos).errores);
        cambio('baile');
    });
    $('rb-vel').addEventListener('input', e => {
        S.vel = Number(e.target.value);
        $('rb-vel-v').textContent = S.vel;
        cambio('baile');
    });

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

    setInterval(tickLeds, 100);

    // Conectarse solo al abrir la pestaña y al enchufar el cable
    new MutationObserver(conectarSolo).observe($('sec-robot'), { attributes: true, attributeFilter: ['hidden'] });
    if ('serial' in navigator) {
        navigator.serial.addEventListener('connect', conectarSolo);
        navigator.serial.addEventListener('disconnect', () => { if (S.estado !== 'desconectado') cerrar(); });
    } else {
        mensaje('Para controlar el robot abre esta página en Chrome o Edge desde una computadora.', 'err');
    }
    window.addEventListener('pagehide', () => { if (S.estado === 'listo') crudo('!'); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();

})(typeof window !== 'undefined' ? window : globalThis);
