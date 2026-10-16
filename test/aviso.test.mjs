// node test/aviso.test.mjs  -> el aviso dice solo materia y maestro (o Receso / No hay más clases)
import assert from 'node:assert';
import { buildMessage } from '../lib/aviso.js';

const mate = { subject: 'Matemáticas', teacher: 'Pérez López' };
assert.strictEqual(buildMessage(null, null, mate), 'Matemáticas, Pérez López');
assert.strictEqual(buildMessage(mate, { receso: false }, { subject: 'Inglés', teacher: '' }), 'Inglés');
assert.strictEqual(buildMessage(mate, { receso: true }, null), 'Receso');
assert.strictEqual(buildMessage(mate, null, null), 'No hay más clases por hoy');
assert.strictEqual(buildMessage(null, null, null), 'No hay más clases por hoy');
assert(!/terminar|Comienza|profesor/i.test(buildMessage(mate, null, mate)));
console.log('aviso.test.mjs: todo bien');
