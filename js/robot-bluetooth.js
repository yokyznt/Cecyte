// Bluetooth (BLE) para el robot mBot Ranger en el APK.
// Usa el plugin @capacitor-community/bluetooth-le sin bundler (Capacitor.Plugins.BluetoothLe) y le da a robot.js un
// transporte { tipo: 'ble', escribir(texto), cerrar() } igual de simple que el del puerto USB.
//
// El módulo Bluetooth de la Me Auriga anuncia «Makeblock_LE…» y funciona como un puerto serie transparente.
// Se espera el servicio FFE1 (escritura FFE3, avisos FFE2, estilo Makeblock/HM-10), pero no se da por hecho:
// al conectar se descubren los servicios y se elige la característica que escribe y la que avisa. Lo descubierto
// queda en #rb-bt-info para poder diagnosticar un módulo distinto.
(function (raiz) {
    const CLAVE = 'cecyte_robot_ble';
    const PREFIJO = 'Makeblock';
    const MTU_DESEADO = 185;
    const TIMEOUT_MS = 10000;
    const IGNORAR = ['1800', '1801', '180a'];                    // GAP, GATT y datos del fabricante

    const plugin = () => raiz.Plataforma && raiz.Plataforma.plugin('BluetoothLe');
    const corto = uuid => String(uuid).toLowerCase().replace(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/, '$1');

    function aHex(texto) {
        let h = '';
        for (let i = 0; i < texto.length; i++) h += (texto.charCodeAt(i) & 0xff).toString(16).padStart(2, '0');
        return h;
    }

    function deHex(hex) {
        let t = '';
        const limpio = String(hex || '').replace(/[^0-9a-fA-F]/g, '');
        for (let i = 0; i + 1 < limpio.length; i += 2) t += String.fromCharCode(parseInt(limpio.substr(i, 2), 16));
        return t;
    }

    function informar(texto) {
        const el = document.getElementById('rb-bt-info');
        if (el) el.textContent = texto;
    }

    function recordado() {
        try { return JSON.parse(localStorage.getItem(CLAVE)) || null; } catch (e) { return null; }
    }

    function recordar(d) {
        try { localStorage.setItem(CLAVE, JSON.stringify({ deviceId: d.deviceId, name: d.name || '' })); } catch (e) { /* sin almacenamiento */ }
    }

    function olvidar() {
        try { localStorage.removeItem(CLAVE); } catch (e) { /* sin almacenamiento */ }
    }

    let iniciado = false;
    async function iniciar() {
        if (iniciado) return;
        await plugin().initialize({ androidNeverForLocation: true });
        iniciado = true;
    }

    // Muestra la lista de aparatos cercanos que se llaman «Makeblock…» (o todos, si se pide)
    async function elegir(todos) {
        const BLE = plugin();
        await iniciar();
        const opciones = {
            displayStrings: {
                scanning: 'Buscando el robot…', cancel: 'Cancelar',
                availableDevices: 'Aparatos cercanos', noDeviceFound: 'No encontré ningún aparato',
            },
        };
        if (!todos) opciones.namePrefix = PREFIJO;
        try {
            return await BLE.requestDevice(opciones);
        } catch (e) {
            if (/cancel|dismiss/i.test(String(e && e.message))) return null;
            throw e;
        }
    }

    // Elige dónde escribir y dónde escuchar entre los servicios que tiene el módulo
    function elegirCaracteristicas(servicios) {
        const util = servicios.filter(s => !IGNORAR.includes(corto(s.uuid)));
        util.sort((a, b) => (corto(b.uuid) === 'ffe1') - (corto(a.uuid) === 'ffe1') || (corto(b.uuid) === 'ffe0') - (corto(a.uuid) === 'ffe0'));
        for (const s of util) {
            const cs = s.characteristics || [];
            const escribe = cs.find(c => c.properties && (c.properties.writeWithoutResponse || c.properties.write));
            const avisa = cs.find(c => c.properties && (c.properties.notify || c.properties.indicate));
            if (escribe && avisa) return { servicio: s.uuid, escritura: escribe, aviso: avisa };
        }
        return null;
    }

    async function conectar(dispositivo, { alDatos, alCerrar }) {
        const BLE = plugin();
        await iniciar();
        const id = dispositivo.deviceId;
        let cerrado = false;
        const avisoCierre = () => { if (!cerrado) { cerrado = true; alCerrar(); } };

        await BLE.addListener('disconnected|' + id, avisoCierre);
        await BLE.connect({ deviceId: id, timeout: TIMEOUT_MS });
        try { await BLE.requestConnectionPriority({ deviceId: id, connectionPriority: 1 }); } catch (e) { /* no es crítico */ }
        let mtu = 23;
        try { await BLE.requestMtu({ deviceId: id, mtu: MTU_DESEADO }); } catch (e) { /* algunos módulos no lo permiten */ }
        try { mtu = (await BLE.getMtu({ deviceId: id })).value || 23; } catch (e) { /* se queda con 23 */ }

        const { services } = await BLE.getServices({ deviceId: id });
        const resumen = services.map(s => corto(s.uuid) + ': ' + (s.characteristics || []).map(c =>
            corto(c.uuid) + '[' + Object.keys(c.properties || {}).filter(k => c.properties[k]).join(',') + ']').join(' ')).join('\n');
        const eleccion = elegirCaracteristicas(services);
        if (!eleccion) {
            informar('Servicios del módulo (ninguno sirve como puerto serie):\n' + resumen);
            try { await BLE.disconnect({ deviceId: id }); } catch (e) { /* ya cerrado */ }
            throw new Error('Este módulo Bluetooth no tiene una característica de escritura y otra de avisos.');
        }
        const conRespuesta = !eleccion.escritura.properties.writeWithoutResponse;
        const pieza = Math.max(20, mtu - 3);
        informar([
            'Aparato: ' + (dispositivo.name || '(sin nombre)') + '  ' + id,
            'Servicio ' + corto(eleccion.servicio) + ' · escribe ' + corto(eleccion.escritura.uuid) +
                (conRespuesta ? ' (con respuesta)' : ' (sin respuesta)') + ' · avisa ' + corto(eleccion.aviso.uuid),
            'MTU ' + mtu + ' · trozos de ' + pieza + ' bytes',
            'Todos los servicios:', resumen,
        ].join('\n'));

        await BLE.addListener('notification|' + id + '|' + eleccion.servicio + '|' + eleccion.aviso.uuid, ev => alDatos(deHex(ev && ev.value)));
        await BLE.startNotifications({ deviceId: id, service: eleccion.servicio, characteristic: eleccion.aviso.uuid });
        recordar(dispositivo);

        // Las escrituras salen de una en una; un «!» (paro) borra lo que esperaba y sale primero
        let pendientes = [];
        let escribiendo = false;
        async function vaciar() {
            if (escribiendo) return;
            escribiendo = true;
            try {
                while (pendientes.length && !cerrado) {
                    const trozo = pendientes.shift();
                    const llamada = { deviceId: id, service: eleccion.servicio, characteristic: eleccion.escritura.uuid, value: aHex(trozo) };
                    if (conRespuesta) await BLE.write(llamada); else await BLE.writeWithoutResponse(llamada);
                }
            } catch (e) {
                pendientes = [];
            } finally {
                escribiendo = false;
            }
        }

        return {
            tipo: 'ble',
            nombre: dispositivo.name || 'Robot',
            escribir(texto) {
                if (cerrado) return Promise.reject(new Error('Bluetooth cerrado'));
                const trozos = [];
                for (let i = 0; i < texto.length; i += pieza) trozos.push(texto.slice(i, i + pieza));
                if (texto.charAt(0) === '!') pendientes = trozos;
                else pendientes.push(...trozos);
                vaciar();
                return Promise.resolve();
            },
            async cerrar() {
                cerrado = true;
                pendientes = [];
                try { await BLE.stopNotifications({ deviceId: id, service: eleccion.servicio, characteristic: eleccion.aviso.uuid }); } catch (e) { /* idem */ }
                try { await BLE.disconnect({ deviceId: id }); } catch (e) { /* ya estaba cerrado */ }
            },
        };
    }

    raiz.RobotBluetooth = {
        disponible: () => !!(raiz.Plataforma && raiz.Plataforma.nativo && plugin()),
        elegir, conectar, recordado, olvidar,
        _aHex: aHex, _deHex: deHex,
    };
})(window);
