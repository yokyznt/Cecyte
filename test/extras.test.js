const assert = require('assert');
const { construirPDF, pdfTexto, filasDeHorario, maestrosDe, clasesDeMaestro } = require('../extras.js');

const slots = [
    { key: '07:00 - 08:00', receso: false },
    { key: '08:45 - 09:15', receso: true },
    { key: '09:15 - 10:00', receso: false }
];
const dias = ['Lunes', 'Martes'];
const db = [
    { id: 1, group: '501 Programación', day: 'Lunes', time: '09:15 - 10:00', subject: 'Física', teacher: 'Ana Pérez' },
    { id: 2, group: '501 Programación', day: 'Lunes', time: '07:00 - 08:00', subject: 'Matemáticas (II)', teacher: 'Luis Ruiz' },
    { id: 3, group: '502 Contabilidad', day: 'Martes', time: '07:00 - 08:00', subject: 'Química', teacher: 'Ana Pérez' },
    { id: 4, group: '502 Contabilidad', day: 'Martes', time: '09:15 - 10:00', subject: 'Ética', teacher: ' ' }
];

assert.strictEqual(pdfTexto('a(b)\\c'), 'a\\(b\\)\\\\c');
assert.strictEqual(pdfTexto('Ñandú — ok 😀'), 'Ñandú \x97 ok ??');

assert.deepStrictEqual(maestrosDe(db), ['Ana Pérez', 'Luis Ruiz']);
const ana = clasesDeMaestro(db, 'Ana Pérez', slots, dias);
assert.deepStrictEqual(ana.map(d => d.clases.map(c => c.id)), [[1], [3]]);

const filas = filasDeHorario(db, slots, dias, i => i.group === '501 Programación', c => [c.subject, c.teacher]);
assert.strictEqual(filas.length, 3);
assert.deepStrictEqual(filas[0].celdas, [['Matemáticas (II)', 'Luis Ruiz'], null]);
assert.strictEqual(filas[1].gris, true);
assert.deepStrictEqual(filas[1].celdas, [null, null]);

const pdf = construirPDF({ titulo: 'Horario 501 Programación', subtitulo: 'CECyTE', columnas: ['Hora', ...dias], filas, pie: 'pie' });
assert.ok(pdf.startsWith('%PDF-1.4\n'));
assert.ok(pdf.trimEnd().endsWith('%%EOF'));
assert.ok([...pdf].every(c => c.charCodeAt(0) < 256));
const inicioXref = Number(pdf.match(/startxref\n(\d+)/)[1]);
assert.strictEqual(pdf.slice(inicioXref, inicioXref + 4), 'xref');
const offsets = pdf.slice(inicioXref).split('\n').slice(3, 9).map(l => Number(l.slice(0, 10)));
offsets.forEach((o, i) => assert.ok(pdf.startsWith(`${i + 1} 0 obj`, o), 'offset del objeto ' + (i + 1)));
const largo = Number(pdf.match(/\/Length (\d+)/)[1]);
const ini = pdf.indexOf('stream\n') + 7;
assert.strictEqual(pdf.indexOf('\nendstream', ini), ini + largo);
assert.ok(pdf.includes('(Matem\xe1ticas \\(II\\))'));

console.log('extras.test.js: todo bien');
