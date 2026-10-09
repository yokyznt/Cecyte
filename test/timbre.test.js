// node test/timbre.test.js  -> prueba la conversión audio/MIDI/texto -> ritmo de timbre.js
const assert = require('assert');
const T = require('../timbre.js');

// 1) Texto de Arduino con comentarios (como el del usuario) -> sus números exactos
const arduino = `const unsigned long RITMO[] = {
  220, 160,     // suena 0.22 s, pausa 0.16 s
  200, 190,     // suena 0.2 s, pausa 0.19 s
  200      // suena 0.2 s y termina
};`;
assert.deepStrictEqual(T.ritmoDeTexto(arduino), [220, 160, 200, 190, 200]);
assert.deepStrictEqual(T.ritmoDeTexto(T.ritmoACodigo([220, 160, 200])), [220, 160, 200]);

// 2) Normalizar: par -> se quita la pausa final; fuera de rango se recorta
assert.deepStrictEqual(T.normalizarRitmo([100, 100]), [100]);
assert.deepStrictEqual(T.normalizarRitmo([5, 99999, 100]), [20, 5000, 100]);
const enorme = T.normalizarRitmo(new Array(500).fill(5000));
assert.strictEqual(enorme.length % 2, 1);
assert(enorme.reduce((a, b) => a + b, 0) <= 30000);

// 3) Toques grabados: apretado 200, suelto 300, apretado 150
assert.deepStrictEqual(T.toquesARitmo([{ down: 1000, up: 1200 }, { down: 1500, up: 1650 }]), [200, 300, 150]);

// 4) Audio sintético: 8 clics cada 500 ms a 8 kHz -> 8 golpes
const sr = 8000, x = new Float32Array(sr * 4);
for (let c = 0; c < 8; c++) for (let i = 0; i < 240; i++) x[c * 4000 + 800 + i] = Math.sin(i * 0.9) * Math.exp(-i / 60);
const golpes = T.detectarGolpes(x, sr, 50, 120);
assert.strictEqual(golpes.length, 8, 'detectó ' + golpes.length + ' golpes');
golpes.forEach((t, i) => assert(Math.abs(t - (100 + i * 500)) <= 30, `golpe ${i} en ${t}`));
const a = T.audioARitmo(x, sr, { modo: 'golpes', sens: 50, golpe: 120, sep: 120 });
assert.strictEqual(a.ritmo.length, 15);
assert(a.ritmo.filter((_, i) => i % 2 === 0).every(v => v === 120));
assert(a.ritmo.filter((_, i) => i % 2 === 1).every(v => Math.abs(v - 380) <= 20));
assert.deepStrictEqual(T.audioARitmo(new Float32Array(sr), sr, { modo: 'golpes', sens: 100, golpe: 120, sep: 120 }).ritmo, [], 'silencio = sin ritmo');

// 5) Modo "seguir volumen": 2 ráfagas de tono de 300 ms separadas por 300 ms
const y = new Float32Array(sr * 2);
for (const ini of [0.2, 0.8]) for (let i = 0; i < 0.3 * sr; i++) y[Math.floor(ini * sr) + i] = 0.5 * Math.sin(i * 0.3);
const s = T.audioARitmo(y, sr, { modo: 'sostenido', sens: 50 }).ritmo;
assert.strictEqual(s.length, 3);
assert(s.every(v => Math.abs(v - 300) <= 40), 'sostenido ' + s);

// 6) MIDI armado a mano: 480 ticks/negra, 120 bpm -> negra = 500 ms; dos notas
const midi = Uint8Array.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
    0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 0x1e,
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    0x00, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0,        // on en 0, off a los 480 ticks
    0x83, 0x60, 0x90, 62, 100, 0x83, 0x60, 0x80, 62, 0,  // on a 960, off a 1440
    0x00, 0xff, 0x2f, 0x00
]);
const notas = T.parseMidi(midi);
assert.strictEqual(notas.length, 2);
assert(Math.abs(notas[0].e - 500) < 1 && Math.abs(notas[1].s - 1000) < 1, JSON.stringify(notas));
assert.deepStrictEqual(T.midiARitmo(notas, { modo: 'sostenido' }).ritmo, [500, 500, 500]);
assert.deepStrictEqual(T.midiARitmo(notas, { modo: 'golpes', golpe: 100, sep: 100 }).ritmo, [100, 900, 100]);
assert.throws(() => T.parseMidi(Uint8Array.from([1, 2, 3, 4, 5])), /MIDI/);

// 6b) Un golpe justo en el segundo 0 del pedazo también cuenta (10 golpes cada 0.5 s empezando en 0)
const z = new Float32Array(sr * 5);
for (let c = 0; c < 10; c++) for (let i = 0; i < 300; i++) z[c * 4000 + i] = Math.sin(i * 0.7) * Math.exp(-i / 80);
assert.strictEqual(T.detectarGolpes(z, sr, 50, 120).length, 10);

// 7) Selección del pedazo de la canción (canción de 100 s, selección actual 10 a 18)
const sel = { a: 10, b: 18 };
assert.deepStrictEqual(T.arrastrarSeleccion('nuevo', 40, sel, 100, 30), { a: 30, b: 40 });       // arrastrar hacia la derecha
assert.deepStrictEqual(T.arrastrarSeleccion('nuevo', 20, sel, 100, 30), { a: 20, b: 30 });       // hacia la izquierda
assert.deepStrictEqual(T.arrastrarSeleccion('nuevo', 90, sel, 100, 10), { a: 10, b: 35 });       // tope de 25 s
assert.deepStrictEqual(T.arrastrarSeleccion('a', 12, sel, 100), { a: 12, b: 18 });
assert.deepStrictEqual(T.arrastrarSeleccion('a', 99, sel, 100), { a: 17, b: 18 });               // mínimo 1 s
assert.deepStrictEqual(T.arrastrarSeleccion('b', 90, sel, 100), { a: 10, b: 35 });               // tope de 25 s
assert.deepStrictEqual(T.arrastrarSeleccion('mover', 50, sel, 100, 4), { a: 46, b: 54 });        // agarrada a 4 s del inicio
assert.deepStrictEqual(T.arrastrarSeleccion('mover', 500, sel, 100, 4), { a: 92, b: 100 });      // no se sale de la canción
assert.deepStrictEqual(T.arrastrarSeleccion('mover', -5, sel, 100, 4), { a: 0, b: 8 });
assert.deepStrictEqual(T.arrastrarSeleccion('nuevo', 100, sel, 100, 100), { a: 99, b: 100 });    // un clic al final
const resumen = T.resumenDeAudio({ length: 8000, numberOfChannels: 1, getChannelData: () => Float32Array.from({ length: 8000 }, (_, i) => (i < 4000 ? 0.9 : 0.1)) }, 10);
assert(resumen[0] > 0.8 && resumen[9] < 0.2 && resumen.length === 10);

console.log('timbre.test.js OK');
