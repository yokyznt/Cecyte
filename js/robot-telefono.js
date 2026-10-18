(function (raiz) {
    const $ = id => document.getElementById(id);
    const CLAVE = 'cecyte_yokis_tel';
    const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const MOVIDO_M = 15, CADA_MS = 45000, CADA_BUSCADO_MS = 10000, LISTA_MS = 10000, LISTA_GUIA_MS = 4000, MAX_GUIA_MS = 360000;
    const RUMBOS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    const T = { reg: null, watch: null, pos: null, recientes: [], ultimo: null, ultimoEnvio: 0, lista: [], recibidoEn: 0, ahoraServidor: 0, buscado: null, compartiendo: false, activa: false, guia: null, ultimaLista: 0 };

    const enlace = () => raiz.RobotEnlace || null;
    const listoRobot = () => !!(enlace() && enlace().listo());
    const geo = () => raiz.Plataforma && raiz.Plataforma.plugin('Geolocation');
    const norm = s => raiz.Robot.sinAcentos(String(s || '')).replace(/\s+/g, ' ').trim();
    const limpiarSala = v => { const s = String(v || '').trim().toUpperCase(); return /^[A-Z0-9]{6,10}$/.test(s) ? s : null; };
    const decir = (tipo, datos) => { if (raiz.Hevy) raiz.Hevy.di(tipo, datos); };

    function leerReg() {
        try { return JSON.parse(localStorage.getItem(CLAVE)) || null; } catch (e) { return null; }
    }

    function guardarReg(r) {
        try { if (r) localStorage.setItem(CLAVE, JSON.stringify(r)); else localStorage.removeItem(CLAVE); } catch (e) { /* sin guardado */ }
    }

    async function api(metodo, datos) {
        const cuerpo = metodo === 'POST' ? JSON.stringify(datos) : null;
        const ruta = '/api/telefonos' + (cuerpo ? '' : '?' + new URLSearchParams(datos).toString());
        const r = await raiz.API.fetch(ruta, { method: metodo, headers: cuerpo ? { 'Content-Type': 'application/json' } : {}, body: cuerpo });
        let j = null;
        try { j = await r.json(); } catch (e) { j = null; }
        return { ok: r.ok, estado: r.status, datos: j || {} };
    }

    function mensaje(t) {
        const el = $('rb-tel-estado');
        if (el) el.textContent = t || '';
    }

    function codigoNuevo() {
        const b = new Uint8Array(8);
        raiz.crypto.getRandomValues(b);
        return Array.from(b, x => ALFABETO[x % ALFABETO.length]).join('');
    }

    async function asegurarRegistro(sala, nombre) {
        if (T.reg && T.reg.sala === sala) {
            if (T.reg.nombre !== nombre) { T.reg.nombre = nombre; guardarReg(T.reg); }
            return true;
        }
        const r = await api('POST', { accion: 'unirse', sala, nombre });
        if (!r.ok || !r.datos.token) { mensaje(r.datos.error || 'No me pude unir a la sala.'); return false; }
        T.reg = { sala, nombre, id: r.datos.id, token: r.datos.token };
        guardarReg(T.reg);
        return true;
    }

    function pintarAviso() {
        const el = $('rb-tel-aviso');
        if (!el) return;
        el.hidden = !T.compartiendo;
        if (!T.compartiendo) return;
        el.textContent = T.buscado ? T.buscado + ' te está buscando. Sigues compartiendo tu ubicación con la sala ' + T.reg.sala + '.' : 'Compartiendo tu ubicación con la sala ' + T.reg.sala + '.';
    }

    function distanciaA(t) {
        return T.pos ? raiz.Robot.distanciaMetros(T.pos, t) : null;
    }

    function cardinal(t) {
        return RUMBOS[Math.round(raiz.Robot.rumboHacia(T.pos, t) / 45) % 8];
    }

    function hace(t) {
        const s = Math.max(0, Math.round((T.ahoraServidor - t.t + (Date.now() - T.recibidoEn)) / 1000));
        return s < 60 ? s + ' s' : Math.round(s / 60) + ' min';
    }

    function pintarRadar() {
        const cv = $('rb-tel-radar');
        if (!cv || !T.pos) return;
        const c = cv.getContext('2d'), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2;
        const otros = T.lista.filter(t => !T.reg || t.id !== T.reg.id);
        const maxD = Math.max(30, ...otros.map(t => distanciaA(t) || 0)) * 1.2;
        const esc = (W / 2 - 18) / maxD;
        const tinta = '#e8f0ea', verde = '#4ade80', naranja = '#fb923c';
        c.clearRect(0, 0, W, H);
        c.strokeStyle = tinta;
        c.globalAlpha = 0.25;
        c.lineWidth = 1;
        const paso = maxD > 400 ? 200 : maxD > 120 ? 50 : maxD > 40 ? 20 : 10;
        for (let r = paso; r < maxD; r += paso) { c.beginPath(); c.arc(cx, cy, r * esc, 0, 7); c.stroke(); }
        c.globalAlpha = 1;
        c.fillStyle = tinta;
        c.font = '12px sans-serif';
        c.textAlign = 'center';
        c.fillText('N', cx, 12);
        c.fillStyle = verde;
        c.beginPath(); c.arc(cx, cy, 6, 0, 7); c.fill();
        otros.forEach(t => {
            const d = distanciaA(t), rum = raiz.Robot.rumboHacia(T.pos, t) * Math.PI / 180;
            const x = cx + Math.sin(rum) * d * esc, y = cy - Math.cos(rum) * d * esc;
            c.fillStyle = T.guia && T.guia.id === t.id ? naranja : tinta;
            c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill();
            c.fillText(t.n.slice(0, 8), x, y - 10);
        });
    }

    function pintarLista() {
        pintarRadar();
        const ul = $('rb-tel-lista');
        if (!ul) return;
        ul.textContent = '';
        const otros = T.lista.filter(t => !T.reg || t.id !== T.reg.id);
        if (!T.compartiendo || !otros.length) {
            const li = document.createElement('li');
            li.className = 'rb-mem__vacio';
            li.textContent = T.compartiendo ? 'Nadie más comparte ahora.' : 'Enciende «Compartir mi ubicación» para ver la sala.';
            ul.appendChild(li);
            return;
        }
        otros.forEach(t => {
            const li = document.createElement('li');
            const d = distanciaA(t);
            const s = document.createElement('span');
            s.textContent = t.n + (d === null ? '' : ' · ' + Math.round(d) + ' m al ' + cardinal(t)) + ' · hace ' + hace(t);
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn btn--secondary btn--sm';
            b.textContent = T.guia && T.guia.id === t.id ? 'Buscando…' : 'Buscar con Hevy';
            b.disabled = !!T.guia;
            b.addEventListener('click', () => buscar(t.n));
            li.append(s, b);
            ul.appendChild(li);
        });
    }

    async function refrescar() {
        if (!T.reg || !T.compartiendo) return;
        T.ultimaLista = Date.now();
        let r;
        try { r = await api('GET', { sala: T.reg.sala, id: T.reg.id, token: T.reg.token }); } catch (e) { return; }
        if (r.estado === 401) { T.reg = null; guardarReg(null); mensaje('Se perdió tu registro, vuelve a encender Compartir.'); await dejar(); return; }
        if (!r.ok) return;
        T.lista = r.datos.telefonos || [];
        T.ahoraServidor = r.datos.ahora || Date.now();
        T.recibidoEn = Date.now();
        pintarLista();
    }

    function debeEnviar() {
        if (!T.pos) return false;
        if (!T.ultimo) return true;
        const ahora = Date.now(), cada = T.buscado ? CADA_BUSCADO_MS : CADA_MS;
        if (ahora - T.ultimoEnvio < 5000) return false;
        return ahora - T.ultimoEnvio >= cada || raiz.Robot.distanciaMetros(T.ultimo, T.pos) > MOVIDO_M;
    }

    async function enviar() {
        if (!T.compartiendo || !T.reg || !T.pos) return;
        const p = T.pos;
        T.ultimoEnvio = Date.now();
        let r;
        try { r = await api('POST', { accion: 'ubicacion', sala: T.reg.sala, id: T.reg.id, token: T.reg.token, nombre: T.reg.nombre, lat: p.lat, lon: p.lon, p: Math.round(p.p) }); } catch (e) { return; }
        if (r.estado === 401) { T.reg = null; guardarReg(null); mensaje('Se perdió tu registro, vuelve a encender Compartir.'); await dejar(); return; }
        if (r.estado === 429) { mensaje(r.datos.error || 'La sala está llena.'); await dejar(); return; }
        if (!r.ok) return;
        T.ultimo = { lat: p.lat, lon: p.lon };
        if ((r.datos.buscado || null) !== T.buscado) {
            T.buscado = r.datos.buscado || null;
            pintarAviso();
            if (T.buscado && raiz.RobotControl) raiz.RobotControl.vibrar([200, 100, 200]);
        }
    }

    function alPosicion(p) {
        T.pos = p;
        if (p.p <= 35) { T.recientes.push(p); if (T.recientes.length > 3) T.recientes.shift(); }
        if (debeEnviar()) enviar();
    }

    function posSuavizada() {
        if (!T.recientes.length) return null;
        const n = T.recientes.length;
        return { lat: T.recientes.reduce((s, x) => s + x.lat, 0) / n, lon: T.recientes.reduce((s, x) => s + x.lon, 0) / n };
    }

    async function empezarGps() {
        const G = geo();
        try {
            T.watch = await G.watchPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }, (pos, err) => {
                if (err || !pos || !pos.coords) return;
                alPosicion({ lat: pos.coords.latitude, lon: pos.coords.longitude, p: pos.coords.accuracy || 99, t: Date.now() });
            });
        } catch (e) {
            mensaje('No pude leer la ubicación. Revisa que el GPS esté encendido.');
        }
    }

    async function dejar() {
        pararGuia(null);
        const G = geo(), reg = T.reg;
        if (T.watch !== null && G) { try { await G.clearWatch({ id: T.watch }); } catch (e) { /* ya parado */ } }
        T.watch = null;
        const eraCompartiendo = T.compartiendo;
        T.compartiendo = false;
        T.pos = null;
        T.recientes = [];
        T.ultimo = null;
        T.buscado = null;
        T.lista = [];
        const c = $('rb-tel-compartir');
        if (c) c.checked = false;
        if (eraCompartiendo && raiz.RobotControl) raiz.RobotControl.pantalla(false, 'telefono');
        if (eraCompartiendo && reg) { try { await api('DELETE', { sala: reg.sala, id: reg.id, token: reg.token }); } catch (e) { /* sin red: vence solo en 3 min */ } }
        pintarAviso();
        pintarLista();
    }

    async function compartir(si) {
        if (!si) { await dejar(); mensaje('Dejaste de compartir y se borró tu punto.'); return; }
        const sala = limpiarSala($('rb-tel-sala').value), nombre = $('rb-tel-nombre').value.trim().slice(0, 20);
        const c = $('rb-tel-compartir');
        if (!sala || !nombre) { mensaje('Pon tu nombre y un código de sala de 6 a 10 letras o números.'); c.checked = false; return; }
        const G = geo();
        if (!G) { mensaje('Este teléfono no puede dar su ubicación.'); c.checked = false; return; }
        const perm = await G.requestPermissions().catch(() => null);
        if (!perm || (perm.location !== 'granted' && perm.coarseLocation !== 'granted')) { mensaje('Falta el permiso de ubicación.'); c.checked = false; return; }
        if (!(await asegurarRegistro(sala, nombre))) { c.checked = false; return; }
        T.compartiendo = true;
        mensaje('');
        if (raiz.RobotControl) raiz.RobotControl.pantalla(true, 'telefono');
        pintarAviso();
        pintarLista();
        await empezarGps();
    }

    function pararGuia(motivo) {
        const g = T.guia;
        if (!g) return;
        clearInterval(g.timer);
        T.guia = null;
        const e = enlace();
        if (e && e.listo()) { e.mover(0, 0); e.rumboIniciar(false); }
        mensaje('');
        pintarLista();
        if (motivo) decir(motivo, { nombre: g.nombre });
    }

    function pasoGuia() {
        const g = T.guia;
        if (!g) return;
        const e = enlace();
        if (!listoRobot()) { pararGuia(null); return; }
        if (document.hidden || Date.now() - g.desde > MAX_GUIA_MS) { pararGuia('telTiempo'); return; }
        const bat = $('rb-bat-pct');
        if (bat && /\d/.test(bat.textContent) && parseInt(bat.textContent, 10) < 15) { pararGuia('telBateria'); return; }
        if (Date.now() - T.ultimaLista > LISTA_GUIA_MS) refrescar();
        const dest = T.lista.find(t => t.id === g.id);
        const edad = dest ? T.ahoraServidor - dest.t + (Date.now() - T.recibidoEn) : 1e9;
        const d = raiz.Robot.decidirGuiado({ yo: posSuavizada(), destino: dest, fi0: g.fi0, radio: 8, precision: T.pos ? T.pos.p : 99, edadDestinoMs: edad });
        if (d.accion === 'llegue') { pararGuia(null); decir('telLlegue', { nombre: g.nombre, m: Math.round(d.distancia) }); return; }
        if (d.accion === 'perdido') { pararGuia('telPerdido'); return; }
        if (d.accion === 'esperar') {
            e.mover(0, 0);
            g.espera = g.espera || Date.now();
            if (Date.now() - g.espera > 20000) pararGuia(d.motivo === 'gps-malo' ? 'telGps' : 'telSinUbicacion');
            return;
        }
        g.espera = 0;
        if (e.soportaDistancia()) e.pedirDistancia();
        const dist = e.distancias();
        const f = raiz.Robot.frenoPorDistancia(d.v, d.v, dist.lecturas, Date.now() - dist.t, false);
        if (f.bloqueado) {
            e.rumbo(d.rumboRelativo, 0);
            g.bloqueadoDesde = g.bloqueadoDesde || Date.now();
            if (Date.now() - g.bloqueadoDesde > 3000) pararGuia('telBloqueo');
            return;
        }
        g.bloqueadoDesde = 0;
        e.rumbo(d.rumboRelativo, d.v);
        mensaje('Hacia ' + g.nombre + ': ' + Math.round(d.distancia) + ' m');
        pintarRadar();
    }

    async function buscar(nombre) {
        const fallo = (tipo, error, datos) => { decir(tipo, datos || { nombre }); return { ok: false, error }; };
        if (T.guia) return { ok: false, error: 'ya estoy buscando a ' + T.guia.nombre };
        if (!T.compartiendo || !T.reg) return fallo('telSinUbicacion', 'primero hay que encender «Compartir mi ubicación» en la pestaña Teléfono');
        if (!listoRobot()) return fallo('sinRobot', 'el robot no está conectado');
        const e = enlace();
        if (!e.soportaRumbo()) return fallo('telSinGiro', 'el robot no tiene giroscopio en su programa');
        const fi0 = raiz.RobotControl && raiz.RobotControl.rumbo ? raiz.RobotControl.rumbo() : null;
        if (fi0 === null) return fallo('telSinBrujula', 'el celular no tiene brújula activa');
        await refrescar();
        const q = norm(nombre);
        const candidatos = T.lista.filter(t => t.id !== T.reg.id && norm(t.n).includes(q)).sort((a, b) => (distanciaA(a) || 0) - (distanciaA(b) || 0));
        if (!candidatos.length) return fallo('telSinCompartir', 'no encuentro a «' + nombre + '» compartiendo su ubicación');
        const dest = candidatos[0];
        api('POST', { accion: 'buscar', sala: T.reg.sala, id: T.reg.id, token: T.reg.token, objetivo: dest.id }).catch(() => null);
        e.rumboIniciar(true);
        if (raiz.RobotControl) raiz.RobotControl.pantalla(true, 'telefono');
        T.guia = { id: dest.id, nombre: dest.n, fi0, desde: Date.now(), bloqueadoDesde: 0, espera: 0 };
        T.guia.timer = setInterval(pasoGuia, 1000);
        const m = Math.round(distanciaA(dest) || 0);
        decir('telBusca', { nombre: dest.n, m });
        pintarLista();
        return { ok: true, nombre: dest.n, distancia_m: m };
    }

    function resumen() {
        if (!T.compartiendo) return { compartiendo: false, telefonos: [] };
        return { compartiendo: true, buscando: T.guia ? T.guia.nombre : null, telefonos: T.lista.filter(t => t.id !== T.reg.id).map(t => ({ nombre: t.n, distancia_m: Math.round(distanciaA(t) || 0), hace_s: parseInt(hace(t), 10) })) };
    }

    function iniciar() {
        if (!$('sec-robot-telefono') || !raiz.Robot || !raiz.Robot.decidirGuiado) return;
        T.reg = leerReg();
        if (T.reg) { $('rb-tel-nombre').value = T.reg.nombre; $('rb-tel-sala').value = T.reg.sala; }
        $('rb-tel-compartir').addEventListener('change', e => compartir(e.target.checked));
        $('rb-tel-crear').addEventListener('click', () => { $('rb-tel-sala').value = codigoNuevo(); mensaje('Sala nueva: pásales el código a tus amigos.'); });
        $('rb-tel-borrar').addEventListener('click', () => dejar().then(() => mensaje('Se borró tu punto de la sala.')));
        $('rb-tel-parar').addEventListener('click', () => pararGuia(null));
        document.addEventListener('robot-paro', () => pararGuia(null));
        document.addEventListener('seccion-admin', e => { T.activa = !!(e.detail && e.detail.id === 'robot-telefono'); if (T.activa) { refrescar(); pintarLista(); } });
        setInterval(() => { if (T.compartiendo && debeEnviar()) enviar(); }, 5000);
        setInterval(() => { if (T.compartiendo && (T.activa || T.guia) && Date.now() - T.ultimaLista >= (T.guia ? LISTA_GUIA_MS : LISTA_MS)) refrescar(); }, 1000);
        raiz.addEventListener('pagehide', () => { if (T.compartiendo && T.reg) raiz.API.fetch('/api/telefonos?' + new URLSearchParams({ sala: T.reg.sala, id: T.reg.id, token: T.reg.token }).toString(), { method: 'DELETE', keepalive: true }).catch(() => null); });
        pintarLista();
    }

    raiz.Telefonos = { buscar, parar: () => pararGuia(null), resumen, compartiendo: () => T.compartiendo, buscando: () => !!T.guia };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})(window);
