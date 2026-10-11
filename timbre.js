// ==================== Ritmo del timbre (panel de admin) ====================
// Un ritmo es una lista de milisegundos que alterna SUENA, PAUSA, SUENA, ... y siempre
// termina sonando (cantidad impar). El ESP32 lo baja de /api/bell y lo toca con el relé.
//
// La primera mitad de este archivo es lógica pura (convertir audio / MIDI / toques a ritmo)
// y se prueba con `node test/timbre.test.js`. La segunda mitad es la interfaz del panel.
// Depende de app.js: bellConfig, icon(), saveBell(), ringBellNow().

const RITMO_MIN = 20;          // menos de esto el relé ni alcanza a cerrar
const RITMO_MAX_PASO = 5000;   // tope por paso (lo mismo que valida el servidor y el ESP32)
const RITMO_MAX_TOTAL = 30000;
const RITMO_MAX_PASOS = 119;   // impar, cabe en el límite de 120 del servidor

// ---------- Lógica pura ----------

// Deja el ritmo dentro de los límites: pasos de 20 a 5000 ms, impar, máximo 30 s.
function normalizarRitmo(raw) {
    const out = [];
    let total = 0;
    for (const v of raw) {
        const n = Math.min(RITMO_MAX_PASO, Math.max(RITMO_MIN, Math.round(Number(v) || 0)));
        if (out.length >= RITMO_MAX_PASOS || total + n > RITMO_MAX_TOTAL) break;
        out.push(n);
        total += n;
    }
    if (out.length % 2 === 0) out.pop(); // tiene que terminar sonando
    return out;
}

// [[inicioMs, finMs], ...] (lo que "suena") -> ritmo. El silencio antes del primero se descarta.
function intervalosARitmo(intervalos, minPausa = 40) {
    const juntos = [];
    for (const [s, e] of intervalos.slice().sort((a, b) => a[0] - b[0])) {
        const ult = juntos[juntos.length - 1];
        if (ult && s - ult[1] < minPausa) ult[1] = Math.max(ult[1], e);
        else juntos.push([s, e]);
    }
    const r = [];
    juntos.forEach(([s, e], i) => {
        r.push(Math.max(RITMO_MIN, Math.round((e - s) / 10) * 10));
        if (i < juntos.length - 1) r.push(Math.round((juntos[i + 1][0] - e) / 10) * 10);
    });
    return normalizarRitmo(r);
}

// Instantes de golpe (ms) -> intervalos: cada golpe dura `golpe` ms o hasta antes del siguiente.
function golpesAIntervalos(golpes, golpe, minPausa = 40) {
    return golpes.map((t, i) => {
        const tope = i < golpes.length - 1 ? golpes[i + 1] - minPausa : Infinity;
        return [t, Math.max(t + RITMO_MIN, Math.min(t + golpe, tope))];
    });
}

// Quita golpes más cerca que `sepMs`; si dos chocan se queda el más fuerte.
function separarGolpes(golpes, sepMs) {
    const out = [];
    for (const g of golpes) {
        const ult = out[out.length - 1];
        if (!ult || g.t - ult.t >= sepMs) out.push(g);
        else if (g.fuerza > ult.fuerza) out[out.length - 1] = g;
    }
    return out;
}

// Energía (RMS) cada 10 ms. altaFrecuencia = true resalta los ataques (diferencia entre muestras).
function energiaFrames(x, sr, altaFrecuencia) {
    const hop = Math.max(1, Math.round(sr * 0.01));
    const n = Math.floor(x.length / hop);
    const e = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        let s = 0;
        for (let j = i * hop, k = j + hop; j < k; j++) {
            const v = altaFrecuencia ? x[j] - (j ? x[j - 1] : 0) : x[j];
            s += v * v;
        }
        e[i] = Math.sqrt(s / hop);
    }
    return { e, hopMs: (hop / sr) * 1000 };
}

// Detecta golpes (ataques) en un audio mono. sens 0-100: más alto = detecta más golpes.
function detectarGolpes(x, sr, sens, sepMs) {
    const { e, hopMs } = energiaFrames(x, sr, true);
    const nivel = Array.from(e, v => Math.log(1 + 200 * v));
    const flujo = nivel.map((v, i) => Math.max(0, v - (i ? nivel[i - 1] : 0)));   // el primer frame cuenta: un golpe justo al inicio del pedazo no se pierde
    const n = flujo.length;
    if (!n) return [];

    const media = flujo.reduce((a, b) => a + b, 0) / n;
    const desv = Math.sqrt(flujo.reduce((a, b) => a + (b - media) ** 2, 0) / n);
    const maxFlujo = flujo.reduce((a, b) => Math.max(a, b), 0);
    const maxNivel = nivel.reduce((a, b) => Math.max(a, b), 0);
    const umbral = Math.max(media + (3 - 2.6 * (sens / 100)) * desv, 0.08 * maxFlujo);

    const picos = [];
    for (let i = 0; i < n; i++) {
        if (flujo[i] <= umbral || nivel[i] < 0.25 * maxNivel) continue;
        let esPico = true;
        for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) if (flujo[k] > flujo[i]) esPico = false;
        if (esPico) picos.push({ t: i * hopMs, fuerza: flujo[i] });
    }
    return separarGolpes(picos, sepMs).map(g => g.t);
}

// Intervalos donde "hay sonido" (sigue el volumen, con histéresis para no parpadear).
function detectarSostenido(x, sr, sens) {
    const { e, hopMs } = energiaFrames(x, sr, false);
    const s = Array.from(e, (v, i) => ((e[i - 1] ?? v) + v + (e[i + 1] ?? v)) / 3);
    const pico = s.reduce((a, b) => Math.max(a, b), 0);
    if (pico < 1e-4) return [];
    const alto = pico * (0.6 - 0.5 * (sens / 100));
    const bajo = alto * 0.7;
    const out = [];
    let ini = null;
    s.forEach((v, i) => {
        if (ini === null && v >= alto) ini = i;
        else if (ini !== null && v < bajo) { out.push([ini * hopMs, i * hopMs]); ini = null; }
    });
    if (ini !== null) out.push([ini * hopMs, s.length * hopMs]);
    return out;
}

// Audio ya mezclado a mono -> ritmo. op = { modo: 'golpes'|'sostenido', sens, golpe, sep }
function audioARitmo(x, sr, op) {
    const iv = op.modo === 'sostenido'
        ? detectarSostenido(x, sr, op.sens)
        : golpesAIntervalos(detectarGolpes(x, sr, op.sens, op.sep), op.golpe);
    return { ritmo: intervalosARitmo(iv), intervalos: iv };
}

// Lee un archivo MIDI (.mid) y devuelve las notas [{s, e}] en milisegundos.
function parseMidi(b) {
    let p = 0;
    const u16 = () => (b[p++] << 8) | b[p++];
    const u32 = () => b[p++] * 16777216 + (b[p++] << 16) + (b[p++] << 8) + b[p++];
    const vlq = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80 && p < b.length); return v; };

    if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'MThd') throw new Error('No es un archivo MIDI.');
    p = 4; u32(); u16();
    const pistas = u16(), div = u16();
    if (div & 0x8000) throw new Error('Este MIDI usa tiempo SMPTE, no lo soporto.');

    const tempos = [{ tick: 0, us: 500000 }];
    const notas = []; // en ticks
    for (let t = 0; t < pistas && p < b.length; t++) {
        const tipo = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]); p += 4;
        const largo = u32(), fin = p + largo;
        if (tipo !== 'MTrk') { p = fin; continue; }
        let tick = 0, estado = 0;
        const activas = new Map();
        while (p < fin) {
            tick += vlq();
            let s = b[p];
            if (s < 0x80) s = estado; else p++;
            if (s === 0xff) {
                const mt = b[p++], len = vlq();
                if (mt === 0x51 && len === 3) tempos.push({ tick, us: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2] });
                p += len;
            } else if (s === 0xf0 || s === 0xf7) {
                p += vlq();
            } else {
                estado = s;
                const tp = s >> 4, k = (s & 15) * 128 + b[p++], vel = tp === 0xc || tp === 0xd ? 0 : b[p++];
                if (tp === 9 && vel > 0) { if (!activas.has(k)) activas.set(k, tick); }
                else if (tp === 8 || (tp === 9 && vel === 0)) {
                    if (activas.has(k)) { notas.push({ s: activas.get(k), e: tick, p: k % 128, c: (k / 128) | 0 }); activas.delete(k); }
                }
            }
        }
        activas.forEach((ini, k) => notas.push({ s: ini, e: tick, p: k % 128, c: (k / 128) | 0 }));
        p = fin;
    }

    tempos.sort((a, b2) => a.tick - b2.tick);
    const aMs = tick => {
        let ms = 0, ult = tempos[0];
        for (const tm of tempos.slice(1)) {
            if (tm.tick >= tick) break;
            ms += ((tm.tick - ult.tick) * ult.us) / div / 1000;
            ult = tm;
        }
        return ms + ((tick - ult.tick) * ult.us) / div / 1000;
    };
    // p = número de nota MIDI y c = canal (el 9 es la batería), para sacar la melodía
    return notas.map(n => ({ s: aMs(n.s), e: aMs(n.e), p: n.p, c: n.c })).sort((a, b2) => a.s - b2.s);
}

// Notas MIDI (ya recortadas a la ventana, en ms desde el inicio) -> ritmo.
function midiARitmo(notas, op) {
    let iv;
    if (op.modo === 'sostenido') {
        iv = notas.map(n => [n.s, n.e]);
    } else {
        const golpes = separarGolpes(notas.map(n => ({ t: n.s, fuerza: 0 })), op.sep).map(g => g.t);
        iv = golpesAIntervalos(golpes, op.golpe);
    }
    return { ritmo: intervalosARitmo(iv), intervalos: iv };
}

// Toques grabados [{down, up}] (ms) -> ritmo. Lo que dura el botón apretado = SUENA.
function toquesARitmo(toques) {
    const r = [];
    toques.forEach((t, i) => {
        r.push(Math.round((t.up - t.down) / 10) * 10);
        if (i < toques.length - 1) r.push(Math.round((toques[i + 1].down - t.up) / 10) * 10);
    });
    return normalizarRitmo(r);
}

// Saca los números de un texto tipo Arduino, ignorando comentarios (// y /* */).
function ritmoDeTexto(texto) {
    const limpio = texto.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
    return normalizarRitmo((limpio.match(/\d+/g) || []).map(Number));
}

function ritmoACodigo(r) {
    const filas = [];
    for (let i = 0; i < r.length; i += 2) filas.push('  ' + r.slice(i, i + 2).join(', ') + (i + 2 < r.length ? ',' : ''));
    return `const unsigned long RITMO[] = {\n${filas.join('\n')}\n};`;
}

// Selección [a, b] (en segundos) al arrastrar sobre la canción.
// modo: 'a' (borde izquierdo), 'b' (borde derecho), 'mover' (ref = dónde agarraste dentro) o 'nuevo' (ref = dónde empezó el arrastre).
// Siempre queda entre 1 y 25 s y dentro de la canción (dur).
const SEL_MIN = 1, SEL_MAX = 25;
function arrastrarSeleccion(modo, t, sel, dur, ref) {
    let { a, b } = sel;
    t = Math.min(dur, Math.max(0, t));
    if (modo === 'a') { a = Math.min(t, b - SEL_MIN); if (b - a > SEL_MAX) a = b - SEL_MAX; }
    else if (modo === 'b') { b = Math.max(t, a + SEL_MIN); if (b - a > SEL_MAX) b = a + SEL_MAX; }
    else if (modo === 'mover') { const largo = b - a; a = Math.min(Math.max(0, t - ref), Math.max(0, dur - largo)); b = a + largo; }
    else {
        a = Math.min(ref, t); b = Math.max(ref, t);
        if (b - a > SEL_MAX) { if (t < ref) a = b - SEL_MAX; else b = a + SEL_MAX; }
        if (b - a < SEL_MIN) b = a + SEL_MIN;
    }
    a = Math.max(0, a); b = Math.min(dur, b);
    if (b - a < SEL_MIN) a = Math.max(0, b - SEL_MIN);
    return { a: Math.round(a * 10) / 10, b: Math.round(b * 10) / 10 };
}

// Volumen de toda la canción en `bins` barritas (0 a 1) para dibujar la vista general
function resumenDeAudio(buffer, bins = 700) {
    const n = buffer.length, paso = n / bins, out = new Float32Array(bins);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
        const d = buffer.getChannelData(c);
        for (let i = 0; i < bins; i++) {
            const a = Math.floor(i * paso), b = Math.min(n, Math.floor((i + 1) * paso));
            const salto = Math.max(1, Math.floor((b - a) / 200));
            let m = 0;
            for (let j = a; j < b; j += salto) { const v = Math.abs(d[j]); if (v > m) m = v; }
            if (m > out[i]) out[i] = m;
        }
    }
    return out;
}

const RITMO_DE_FABRICA = [220, 160, 200, 190, 200, 210, 140, 100, 140, 230, 100, 80, 130, 250, 160, 210, 200];
const RITMOS_BASE = [
    ['Tu ritmo de siempre', RITMO_DE_FABRICA],
    ['Continuo 3 s', [3000]],
    ['Un toque largo', [1200]],
    ['Doble toque', [300, 200, 300]],
    ['Triple toque', [200, 150, 200, 150, 200]],
    ['Redoble', [70, 60, 70, 60, 70, 60, 70, 60, 70, 60, 70, 60, 70, 60, 70, 150, 500]],
    ['Se acelera', [300, 300, 260, 260, 220, 220, 180, 180, 140, 140, 100, 100, 100]],
    ['Se frena', [100, 100, 100, 100, 140, 140, 180, 180, 220, 220, 260, 260, 300]],
    ['Fin de clase', [150, 100, 150, 100, 150, 300, 600]]
];

if (typeof module !== 'undefined') {
    module.exports = { arrastrarSeleccion, resumenDeAudio, normalizarRitmo, intervalosARitmo, golpesAIntervalos, detectarGolpes, detectarSostenido, audioARitmo, parseMidi, midiARitmo, toquesARitmo, ritmoDeTexto, ritmoACodigo };
}

// ---------- Interfaz ----------

const $r = id => document.getElementById(id);
let audioCtx = null;
let previewNodes = null;   // { osc, raf } mientras suena la vista previa
let tapState = null;       // grabación de toques en curso
let musica = null;         // { tipo: 'audio'|'midi', buffer | notas, nombre, duracion }

function getAudioCtx() {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

function rMsg(texto, tipo = '') {
    const m = $r('rhythm-save-msg');
    if (!m) return;
    m.className = 'msg' + (tipo ? ` msg--${tipo}` : '');
    m.innerText = texto;
}

function totalRitmo(r = bellConfig.rhythm || []) {
    return r.reduce((a, b) => a + b, 0);
}

function setRitmo(r, mensaje) {
    if (!r.length) return false;
    bellConfig.rhythm = r;
    renderRhythm();
    if (mensaje) rMsg(mensaje, 'ok');
    return true;
}

// ----- Dibujo: lista de pasos + línea de tiempo -----

function renderRhythm() {
    const box = $r('rhythm-steps');
    if (!box) return;
    if (!Array.isArray(bellConfig.rhythm) || !bellConfig.rhythm.length) bellConfig.rhythm = RITMO_DE_FABRICA.slice();
    const r = bellConfig.rhythm;

    const filas = [];
    for (let i = 0; i < r.length; i += 2) {
        const ultimo = i === r.length - 1;
        const campo = (idx, etiqueta) => `<label class="step__f"><span>${etiqueta}</span>
            <input type="number" class="input" min="${RITMO_MIN}" max="${RITMO_MAX_PASO}" step="10" value="${r[idx]}" data-i="${idx}" oninput="setPaso(this)"
                aria-label="Toque ${i / 2 + 1}: ${etiqueta.toLowerCase()} en milisegundos"><em>ms</em></label>`;
        filas.push(`<div class="step"><span class="step__n">${i / 2 + 1}</span>
            ${campo(i, 'Suena')}${ultimo ? '<span class="step__end">y termina</span>' : campo(i + 1, 'Pausa')}
            <button type="button" class="chip__x" onclick="quitarToque(${i})" title="Quitar este toque" aria-label="Quitar toque ${i / 2 + 1}">${icon('x')}</button></div>`);
    }
    box.innerHTML = filas.join('');
    dibujarLinea();
    renderPresets();
}

function dibujarLinea() {
    const r = bellConfig.rhythm || [];
    const total = totalRitmo(r) || 1;
    let acc = 0, html = '';
    r.forEach((ms, i) => {
        if (i % 2 === 0) html += `<span class="tl__on" style="left:${(acc / total) * 100}%;width:${(ms / total) * 100}%"></span>`;
        acc += ms;
    });
    const linea = $r('rhythm-tl-bars');
    if (linea) linea.innerHTML = html;

    const toques = (r.length + 1) / 2;
    $r('rhythm-total').innerText = `${toques} ${toques === 1 ? 'toque' : 'toques'} · ${(totalRitmo(r) / 1000).toFixed(2)} s`;
    const aviso = r.length > RITMO_MAX_PASOS || totalRitmo(r) > RITMO_MAX_TOTAL;
    $r('rhythm-warn').hidden = !aviso;
}

function renderPresets() {
    const box = $r('rhythm-presets');
    if (!box || box.childElementCount) return;
    box.innerHTML = RITMOS_BASE.map(([nombre], i) => `<button type="button" class="pill" onclick="usarPreset(${i})">${nombre}</button>`).join('');
}

function usarPreset(i) {
    stopPreview();
    setRitmo(RITMOS_BASE[i][1].slice(), `Cargado "${RITMOS_BASE[i][0]}". Dale Guardar para mandarlo al timbre.`);
}

function setPaso(el) {
    const v = Math.min(RITMO_MAX_PASO, Math.max(RITMO_MIN, Math.round(Number(el.value) || RITMO_MIN)));
    bellConfig.rhythm[Number(el.dataset.i)] = v;
    dibujarLinea();
}

function agregarToque() {
    const r = bellConfig.rhythm;
    if (r.length + 2 > RITMO_MAX_PASOS || totalRitmo(r) + 300 > RITMO_MAX_TOTAL) {
        rMsg('Ya no caben más toques (máximo 30 s o 59 toques).', 'err');
        return;
    }
    r.push(150, 150);
    renderRhythm();
}

function quitarToque(i) {
    const r = bellConfig.rhythm;
    if (r.length === 1) { rMsg('Tiene que quedar al menos un toque.', 'err'); return; }
    if (i === r.length - 1) r.splice(r.length - 2, 2); // el último se lleva la pausa anterior
    else r.splice(i, 2);
    renderRhythm();
}

// ----- Escuchar (vista previa en el navegador, no toca el timbre real) -----

function playRhythm(r = bellConfig.rhythm) {
    stopPreview();
    const ctx = getAudioCtx();
    const t0 = ctx.currentTime + 0.05;
    const osc = ctx.createOscillator();
    const filtro = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    filtro.type = 'lowpass';
    filtro.frequency.value = 2400;
    g.gain.setValueAtTime(0, t0);
    osc.connect(filtro).connect(g).connect(ctx.destination);

    let t = t0;
    r.forEach((ms, i) => {
        const d = ms / 1000;
        if (i % 2 === 0) {
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.22, t + 0.004);
            g.gain.setValueAtTime(0.22, t + Math.max(0.004, d - 0.004));
            g.gain.linearRampToValueAtTime(0, t + d);
        }
        t += d;
    });
    osc.start(t0);
    osc.stop(t + 0.1);

    const head = $r('rhythm-head');
    const durTotal = t - t0;
    const paso = () => {
        const p = (ctx.currentTime - t0) / durTotal;
        if (p >= 1) return stopPreview();
        head.style.left = `${Math.max(0, p) * 100}%`;
        head.hidden = false;
        previewNodes.raf = requestAnimationFrame(paso);
    };
    previewNodes = { osc, raf: requestAnimationFrame(paso) };
    osc.onended = () => stopPreview();
}

function stopPreview() {
    if (!previewNodes) return;
    cancelAnimationFrame(previewNodes.raf);
    try { previewNodes.osc.stop(); } catch (e) { /* ya estaba detenido */ }
    previewNodes = null;
    const head = $r('rhythm-head');
    if (head) head.hidden = true;
}

// ----- Pestañas -----

function showRhythmTab(nombre) {
    document.querySelectorAll('[data-rtab]').forEach(p => { p.hidden = p.dataset.rtab !== nombre; });
    document.querySelectorAll('[data-rtabbtn]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rtabbtn === nombre)));
}

// ----- Golpear el ritmo (botón grande o barra espaciadora) -----

function tapAbajo(e) {
    if (e && e.repeat) return;
    const ctx = getAudioCtx();
    if (!tapState) tapState = { toques: [], timer: null, osc: null };
    clearTimeout(tapState.timer);
    const ult = tapState.toques[tapState.toques.length - 1];
    if (ult && ult.up === null) return; // ya estaba apretado
    tapState.toques.push({ down: performance.now(), up: null });
    $r('tap-pad').classList.add('is-down');

    // pitido mientras lo mantienes apretado
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'square'; osc.frequency.value = 880; g.gain.value = 0.12;
    osc.connect(g).connect(ctx.destination);
    osc.start();
    tapState.osc = osc;
}

function tapArriba() {
    if (!tapState) return;
    const ult = tapState.toques[tapState.toques.length - 1];
    if (!ult || ult.up !== null) return;
    ult.up = performance.now();
    $r('tap-pad').classList.remove('is-down');
    try { tapState.osc.stop(); } catch (e) { /* ya estaba detenido */ }

    const llevado = ult.up - tapState.toques[0].down;
    $r('tap-count').innerText = `${tapState.toques.length} toques marcados…`;
    // 2 s sin tocar (o llegar a 30 s) = terminaste
    tapState.timer = setTimeout(terminarGolpeo, llevado > RITMO_MAX_TOTAL - 3000 ? 0 : 2000);
}

function terminarGolpeo() {
    if (!tapState) return;
    const toques = tapState.toques.filter(t => t.up !== null);
    tapState = null;
    $r('tap-count').innerText = 'Pulsa y mantén para marcar cada toque.';
    if (!toques.length) return;
    setRitmo(toquesARitmo(toques), `Grabé ${toques.length} toques. Escúchalo y ajusta los tiempos si hace falta.`);
    showRhythmTab('pasos');
}

function reiniciarGolpeo() {
    if (tapState) { clearTimeout(tapState.timer); try { tapState.osc.stop(); } catch (e) { /* nada */ } }
    tapState = null;
    $r('tap-pad').classList.remove('is-down');
    $r('tap-count').innerText = 'Pulsa y mantén para marcar cada toque.';
}

// ----- Pegar / copiar código Arduino -----

function usarTextoRitmo() {
    const r = ritmoDeTexto($r('rhythm-paste').value);
    if (!setRitmo(r, `Leí ${(r.length + 1) / 2} toques.`)) rMsg('No encontré números válidos en ese texto.', 'err');
    else showRhythmTab('pasos');
}

function verCodigoRitmo() {
    const codigo = ritmoACodigo(bellConfig.rhythm);
    $r('rhythm-paste').value = codigo;
    if (navigator.clipboard) navigator.clipboard.writeText(codigo).then(() => rMsg('Código copiado al portapapeles.', 'ok'), () => {});
}

// ----- Música -> timbre -----

async function cargarMusica(file) {
    if (!file) return;
    const info = $r('music-info');
    if (file.size > 25 * 1024 * 1024) { info.innerText = 'El archivo pesa más de 25 MB.'; return; }
    info.innerText = 'Leyendo…';
    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'MThd') {
            const notas = parseMidi(bytes);
            if (!notas.length) throw new Error('El MIDI no tiene notas.');
            const dur = Math.max(...notas.map(n => n.e)) / 1000;
            musica = { tipo: 'midi', notas, nombre: file.name, duracion: dur };
        } else {
            const buffer = await getAudioCtx().decodeAudioData(bytes.buffer);
            musica = { tipo: 'audio', buffer, nombre: file.name, duracion: buffer.duration };
        }
    } catch (err) {
        musica = null;
        $r('music-controls').hidden = true;
        info.innerText = err.message && err.message.includes('MIDI') ? err.message : 'No pude leer ese archivo. Prueba con MP3, WAV, OGG o MIDI.';
        return;
    }
    info.innerText = `${musica.nombre} · ${musica.tipo === 'midi' ? 'MIDI' : 'audio'} · ${musica.duracion.toFixed(1)} s`;
    musica.resumen = musica.tipo === 'audio' ? resumenDeAudio(musica.buffer) : null;
    $r('music-start').value = 0;
    $r('music-start').max = Math.max(0, Math.floor(musica.duracion - 1));
    $r('music-len').value = Math.max(1, Math.min(8, Math.floor(musica.duracion)));
    $r('music-orig').hidden = musica.tipo !== 'audio';
    $r('music-controls').hidden = false;
    convertirMusica();
}

// ----- Elegir el pedazo arrastrando sobre la canción completa -----

function seleccionActual() {
    const a = Math.max(0, Number($r('music-start').value) || 0);
    const largo = Math.min(SEL_MAX, Math.max(SEL_MIN, Number($r('music-len').value) || 8));
    return { a, b: a + largo };
}

function ponerSeleccion(sel) {
    $r('music-start').value = sel.a;
    $r('music-len').value = Math.round((sel.b - sel.a) * 10) / 10;
    dibujarResumen();
}

function dibujarResumen() {
    const cv = $r('music-overview');
    if (!cv || !musica) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    c.clearRect(0, 0, w, h);
    const estilo = getComputedStyle(document.documentElement);
    const verde = estilo.getPropertyValue('--green-700').trim(), gris = estilo.getPropertyValue('--line-strong').trim();
    const xDe = s => (s / musica.duracion) * w;

    c.fillStyle = gris;
    if (musica.resumen) {
        const pico = musica.resumen.reduce((a, b) => Math.max(a, b), 0) || 1;
        for (let px = 0; px < w; px++) {
            const alto = Math.max(1, (musica.resumen[Math.floor((px / w) * musica.resumen.length)] / pico) * (h - 8));
            c.fillRect(px, (h - alto) / 2, 1, alto);
        }
    } else {
        musica.notas.forEach(n => c.fillRect(xDe(n.s / 1000), h * 0.3, Math.max(1, xDe((n.e - n.s) / 1000)), h * 0.4));
    }

    // zona elegida: sombreada, con dos bordes para agarrar
    const { a, b } = seleccionActual();
    const x1 = xDe(a), x2 = Math.min(w, xDe(Math.min(b, musica.duracion)));
    c.fillStyle = verde;
    c.globalAlpha = 0.16;
    c.fillRect(x1, 0, x2 - x1, h);
    c.globalAlpha = 1;
    c.fillRect(x1 - 1, 0, 3, h);
    c.fillRect(x2 - 2, 0, 3, h);
    $r('music-sel-label').innerText = `Pedazo elegido: de ${a.toFixed(1)} s a ${Math.min(b, musica.duracion).toFixed(1)} s (${(Math.min(b, musica.duracion) - a).toFixed(1)} s)`;
}

let arrastreMusica = null;
function resumenTiempo(e) {
    const r = $r('music-overview').getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * musica.duracion;
}

function resumenAbajo(e) {
    if (!musica) return;
    const t = resumenTiempo(e), { a, b } = seleccionActual();
    const tol = (12 / $r('music-overview').clientWidth) * musica.duracion;   // ~12 px para agarrar un borde
    if (Math.abs(t - a) <= tol) arrastreMusica = { modo: 'a' };
    else if (Math.abs(t - b) <= tol) arrastreMusica = { modo: 'b' };
    else if (t > a && t < b) arrastreMusica = { modo: 'mover', ref: t - a };
    else arrastreMusica = { modo: 'nuevo', ref: t };
    e.currentTarget.setPointerCapture(e.pointerId);
}

function resumenMueve(e) {
    if (!musica) return;
    if (!arrastreMusica) {   // solo el cursor: flechas sobre los bordes, mano en el centro
        const t = resumenTiempo(e), { a, b } = seleccionActual();
        const tol = (12 / $r('music-overview').clientWidth) * musica.duracion;
        $r('music-overview').style.cursor = Math.abs(t - a) <= tol || Math.abs(t - b) <= tol ? 'ew-resize' : (t > a && t < b ? 'grab' : 'crosshair');
        return;
    }
    const s = seleccionActual();
    ponerSeleccion(arrastrarSeleccion(arrastreMusica.modo, resumenTiempo(e), { a: s.a, b: Math.min(s.b, musica.duracion) }, musica.duracion, arrastreMusica.ref));
}

function resumenSuelta() {
    if (!arrastreMusica) return;
    arrastreMusica = null;
    convertirMusica();   // al soltar: se convierte el pedazo elegido en el ritmo del timbre
}

function opcionesMusica() {
    return {
        modo: $r('music-mode').value,
        sens: Number($r('music-sens').value),
        golpe: Number($r('music-hit').value),
        sep: Number($r('music-sep').value)
    };
}

function segmentoMono(buffer, inicioS, largoS) {
    const sr = buffer.sampleRate;
    const a = Math.floor(inicioS * sr), b = Math.min(buffer.length, a + Math.floor(largoS * sr));
    const x = new Float32Array(Math.max(0, b - a));
    for (let c = 0; c < buffer.numberOfChannels; c++) {
        const d = buffer.getChannelData(c);
        for (let i = 0; i < x.length; i++) x[i] += d[a + i] / buffer.numberOfChannels;
    }
    return x;
}

let musicTimer = null;
function convertirMusicaSuave() { clearTimeout(musicTimer); musicTimer = setTimeout(convertirMusica, 150); }

function convertirMusica() {
    if (!musica) return;
    const op = opcionesMusica();
    const inicio = Math.max(0, Number($r('music-start').value) || 0);
    const largo = Math.min(25, Math.max(1, Number($r('music-len').value) || 8));
    dibujarResumen();
    $r('music-sens-v').innerText = op.sens;
    $r('music-hit-v').innerText = op.golpe + ' ms';
    $r('music-sep-v').innerText = op.sep + ' ms';
    $r('music-hit-box').hidden = op.modo === 'sostenido';
    $r('music-sep-box').hidden = op.modo === 'sostenido';

    let res, env = null, hopMs = 10;
    if (musica.tipo === 'audio') {
        const x = segmentoMono(musica.buffer, inicio, largo);
        res = audioARitmo(x, musica.buffer.sampleRate, op);
        ({ e: env, hopMs } = energiaFrames(x, musica.buffer.sampleRate, false));
    } else {
        const a = inicio * 1000, b = a + largo * 1000;
        const notas = musica.notas.filter(n => n.s >= a && n.s < b).map(n => ({ s: n.s - a, e: Math.min(n.e, b) - a }));
        res = midiARitmo(notas, op);
    }
    dibujarMusica(env, hopMs, res.intervalos, largo * 1000);

    if (!setRitmo(res.ritmo)) {
        rMsg('No encontré golpes en ese pedazo. Sube la sensibilidad o cambia el inicio.', 'err');
        return;
    }
    const cortado = totalRitmo(res.ritmo) >= RITMO_MAX_TOTAL - 500 ? ' (se cortó a 30 s)' : '';
    rMsg(`Convertí ${(res.ritmo.length + 1) / 2} toques${cortado}. Escúchalo y, si te gusta, Guardar.`, 'ok');
}

function dibujarMusica(env, hopMs, intervalos, largoMs) {
    const cv = $r('music-wave');
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    c.clearRect(0, 0, w, h);
    const estilo = getComputedStyle(document.documentElement);
    const verde = estilo.getPropertyValue('--green-700').trim(), gris = estilo.getPropertyValue('--line-strong').trim();

    if (env && env.length) {
        const pico = env.reduce((a, b) => Math.max(a, b), 0) || 1;
        c.fillStyle = gris;
        for (let px = 0; px < w; px++) {
            const i = Math.floor((px / w) * env.length);
            const alto = Math.max(1, (env[i] / pico) * (h - 4));
            c.fillRect(px, (h - alto) / 2, 1, alto);
        }
    }
    c.fillStyle = verde;
    intervalos.forEach(([s, e]) => c.fillRect((s / largoMs) * w, h - 6, Math.max(2, ((e - s) / largoMs) * w), 6));
}

function escucharOriginal() {
    if (!musica || musica.tipo !== 'audio') return;
    stopPreview();
    const ctx = getAudioCtx();
    const src = ctx.createBufferSource();
    src.buffer = musica.buffer;
    src.connect(ctx.destination);
    const inicio = Math.max(0, Number($r('music-start').value) || 0);
    const largo = Math.min(25, Math.max(1, Number($r('music-len').value) || 8));
    src.start(0, inicio, largo);
    previewNodes = { osc: { stop: () => src.stop() }, raf: 0 };
    src.onended = () => { previewNodes = null; };
}

// ----- Guardar -----

async function guardarRitmo(tocar = false) {
    stopPreview();
    const ok = await saveBell('rhythm-save-msg');
    if (ok && tocar) await ringBellNow();
}

// Atajos de teclado para el pad (barra espaciadora)
if (typeof document !== 'undefined') {
    document.addEventListener('keydown', e => { if (e.code === 'Space' && document.activeElement === $r('tap-pad')) { e.preventDefault(); tapAbajo(e); } });
    document.addEventListener('keyup', e => { if (e.code === 'Space' && document.activeElement === $r('tap-pad')) { e.preventDefault(); tapArriba(); } });
}
