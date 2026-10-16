// node test/robot-bluetooth.test.js -> el adaptador BLE de js/robot-bluetooth.js con un plugin falso:
// elige la característica correcta, parte las líneas en trozos de 20 bytes, entrega lo que llega y deja pasar el paro primero.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const escuchas = {};
const escrituras = [];
let conectado = false;
const falso = {
    initialize: async () => {},
    requestDevice: async () => ({ deviceId: 'AA:BB', name: 'Makeblock_LE001b10624694' }),
    addListener: async (clave, cb) => { escuchas[clave] = cb; return { remove() {} }; },
    connect: async () => { conectado = true; },
    requestConnectionPriority: async () => {},
    requestMtu: async () => {},
    getMtu: async () => ({ value: 23 }),
    getServices: async () => ({
        services: [
            { uuid: '00001800-0000-1000-8000-00805f9b34fb', characteristics: [{ uuid: '00002a00-0000-1000-8000-00805f9b34fb', properties: { read: true, write: true } }] },
            { uuid: '0000ffe1-0000-1000-8000-00805f9b34fb', characteristics: [
                { uuid: '0000ffe2-0000-1000-8000-00805f9b34fb', properties: { notify: true } },
                { uuid: '0000ffe3-0000-1000-8000-00805f9b34fb', properties: { writeWithoutResponse: true, write: true } },
            ] },
        ],
    }),
    startNotifications: async () => {},
    stopNotifications: async () => {},
    disconnect: async () => { conectado = false; },
    writeWithoutResponse: async (o) => { escrituras.push(o); await new Promise(r => setTimeout(r, 2)); },
    write: async () => { throw new Error('debería usar writeWithoutResponse'); },
};
const info = { textContent: '' };
const ctx = {
    console, setTimeout, Promise,
    localStorage: (() => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; })(),
    document: { getElementById: id => (id === 'rb-bt-info' ? info : null) },
};
ctx.window = ctx;
ctx.Plataforma = { nativo: true, plugin: n => (n === 'BluetoothLe' ? falso : null) };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'robot-bluetooth.js'), 'utf8'), ctx);
const BT = ctx.RobotBluetooth;
const hexA = h => Buffer.from(h, 'hex').toString('latin1');

(async () => {
    assert.strictEqual(BT.disponible(), true);
    assert.strictEqual(BT._aHex('M 1\n'), '4d20310a');
    assert.strictEqual(BT._deHex('4f4b0a'), 'OK\n');

    const d = await BT.elegir();
    assert.strictEqual(d.name, 'Makeblock_LE001b10624694');
    const recibido = [];
    let cierres = 0;
    const t = await BT.conectar(d, { alDatos: x => recibido.push(x), alCerrar: () => cierres++ });
    assert.strictEqual(t.tipo, 'ble');
    assert.strictEqual(JSON.stringify(BT.recordado()), JSON.stringify({ deviceId: 'AA:BB', name: 'Makeblock_LE001b10624694' }), 'recuerda el robot');
    assert(/ffe1/.test(info.textContent) && /escribe ffe3/.test(info.textContent) && /avisa ffe2/.test(info.textContent), 'elige FFE1: escribe FFE3, avisa FFE2\n' + info.textContent);

    // lo que manda el robot llega como texto
    escuchas['notification|AA:BB|0000ffe1-0000-1000-8000-00805f9b34fb|0000ffe2-0000-1000-8000-00805f9b34fb']({ value: '504f4e47' });
    assert.deepStrictEqual(recibido, ['PONG']);

    // una línea larga sale en trozos de 20 bytes, en orden
    const larga = 'LS ' + 'f'.repeat(72) + '\n';
    await t.escribir(larga);
    await new Promise(r => setTimeout(r, 40));
    assert(escrituras.length >= 4 && escrituras.every(e => e.value.length / 2 <= 20), 'trozos de a lo más 20 bytes');
    assert.strictEqual(escrituras.map(e => hexA(e.value)).join(''), larga, 'se reensambla igual');

    // el paro borra lo que esperaba y sale primero
    escrituras.length = 0;
    t.escribir('T 440 100\n'.repeat(10));
    t.escribir('!');
    await new Promise(r => setTimeout(r, 60));
    const texto = escrituras.map(e => hexA(e.value)).join('');
    assert(texto.includes('!'), 'el paro llegó');
    assert(texto.length < 100, 'lo pendiente se descartó (' + texto.length + ' bytes)');

    // perder el enlace avisa una sola vez
    escuchas['disconnected|AA:BB']();
    escuchas['disconnected|AA:BB']();
    assert.strictEqual(cierres, 1);
    await assert.rejects(() => t.escribir('PING\n'), /cerrado/);
    console.log('robot-bluetooth.test.js: todo bien');
})().catch(e => { console.error(e); process.exit(1); });
