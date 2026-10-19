(function (raiz) {
    const $ = id => document.getElementById(id);
    const CLAVE = 'cecyte_yokis_tel';
    const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const MOVIDO_M = 15, CADA_MS = 45000, CADA_BUSCADO_MS = 10000, LISTA_MS = 10000, LISTA_GUIA_MS = 4000, MAX_GUIA_MS = 360000;
    const RUMBOS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    const T = { reg: null, watch: null, pos: null, recientes: [], ultimo: null, ultimoEnvio: 0, lista: [], recibidoEn: 0, ahoraServidor: 0, buscado: null, dueno: false, salaNueva: null, compartiendo: false, activa: false, guia: null, ultimaLista: 0 };

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

    async function expulsado(texto) {
        T.reg = null;
        guardarReg(null);
        mensaje(texto || 'Te expulsaron de la sala por 10 minutos.');
        await dejar();
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
        const r = await api('POST', { accion: 'unirse', sala, nombre, crear: T.salaNueva === sala });
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
        const yo = posSuavizada() || T.pos;
        return yo ? raiz.Robot.distanciaMetros(yo, t) : null;
    }

    function cardinal(t) {
        return RUMBOS[Math.round(raiz.Robot.rumboHacia(posSuavizada() || T.pos, t) / 45) % 8];
    }

    function hace(t) {
        const s = Math.max(0, Math.round((T.ahoraServidor - t.t + (Date.now() - T.recibidoEn)) / 1000));
        return s < 60 ? s + ' s' : Math.round(s / 60) + ' min';
    }

    const PASOS_RADIO = [5, 10, 20, 30, 50, 100, 200, 300, 500, 1000, 2000, 5000];
    const PASOS_ANILLO = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    const RADIO_MIN = 3, RADIO_MAX = 8000;
    const RASTRO_MS = 300000;
    const Z = { auto: true, radio: 50, sel: null, dedos: new Map(), dist0: 0, radio0: 0, puntos: [], rumboArriba: false, rastros: new Map() };

    function anotarRastro(clave, p) {
        const ahora = Date.now(), lista = Z.rastros.get(clave) || [];
        const ultimo = lista[lista.length - 1];
        if (!ultimo || raiz.Robot.distanciaMetros(ultimo, p) > 2 || ahora - ultimo.t > 8000) lista.push({ lat: p.lat, lon: p.lon, t: ahora });
        while (lista.length && ahora - lista[0].t > RASTRO_MS) lista.shift();
        Z.rastros.set(clave, lista);
    }

    function pintarRastros(c, yo, rot, cx, cy, esc, W, color) {
        const ahora = Date.now(), tope = W / 2;
        c.lineWidth = 2;
        Z.rastros.forEach(lista => {
            const pts = lista.map(q => {
                const d = raiz.Robot.distanciaMetros(yo, q), a = (raiz.Robot.rumboHacia(yo, q) - rot) * Math.PI / 180;
                return { x: cx + Math.sin(a) * d * esc, y: cy - Math.cos(a) * d * esc, t: q.t };
            });
            for (let i = 1; i < pts.length; i++) {
                if (Math.hypot(pts[i].x - cx, pts[i].y - cy) > tope) continue;
                c.globalAlpha = 0.12 + 0.5 * (1 - Math.min(1, (ahora - pts[i].t) / RASTRO_MS));
                c.strokeStyle = color;
                c.beginPath(); c.moveTo(pts[i - 1].x, pts[i - 1].y); c.lineTo(pts[i].x, pts[i].y); c.stroke();
            }
        });
        c.globalAlpha = 1;
        c.lineWidth = 1;
    }

    const miPos = () => {
        const s = posSuavizada();
        return s ? { lat: s.lat, lon: s.lon, p: T.pos ? T.pos.p : 0 } : T.pos;
    };
    const bonito = m => (m >= 1000 ? (m / 1000).toFixed(m % 1000 ? 1 : 0) + ' km' : Math.round(m) + ' m');
    const edadSeg = t => Math.max(0, Math.round((T.ahoraServidor - t.t + (Date.now() - T.recibidoEn)) / 1000));

    function radioAuto(otros) {
        const yo = miPos();
        const lejos = Math.max(0, ...otros.map(t => (yo ? raiz.Robot.distanciaMetros(yo, t) : 0))) * 1.15;
        return PASOS_RADIO.find(p => p >= lejos && p >= 10) || PASOS_RADIO[PASOS_RADIO.length - 1];
    }

    function radioActual() {
        if (Z.auto) return radioAuto(T.lista.filter(t => !T.reg || t.id !== T.reg.id));
        return Math.min(RADIO_MAX, Math.max(RADIO_MIN, Z.radio));
    }

    function zoom(factor) {
        const base = radioActual();
        Z.auto = false;
        const siguiente = factor < 1 ? [...PASOS_RADIO].reverse().find(p => p < base * 0.999) : PASOS_RADIO.find(p => p > base * 1.001);
        Z.radio = siguiente || (factor < 1 ? RADIO_MIN : RADIO_MAX);
        pintarRadar();
    }

    function ajustarLienzo(cv) {
        const lado = Math.round(cv.getBoundingClientRect().width);
        if (lado < 40) return null;
        const dpr = Math.min(3, raiz.devicePixelRatio || 1);
        const px = Math.round(lado * dpr);
        if (cv.width !== px || cv.height !== px) {
            cv.width = px;
            cv.height = px;
        }
        return { lado, dpr };
    }

    function halo(c, x, y, metros, esc, ancho, color) {
        const r = Math.min(metros * esc, ancho / 2);
        if (r < 4) return;
        c.globalAlpha = 0.18;
        c.fillStyle = color;
        c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
        c.globalAlpha = 0.5;
        c.strokeStyle = color;
        c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke();
        c.globalAlpha = 1;
    }

    function flechaRumbo(c, cx, cy, grados, color) {
        const a = grados * Math.PI / 180, largo = 30;
        const px = cx + Math.sin(a) * largo, py = cy - Math.cos(a) * largo;
        c.strokeStyle = color;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(cx, cy);
        c.lineTo(px, py);
        c.moveTo(px, py);
        c.lineTo(px - Math.sin(a - 0.5) * 10, py + Math.cos(a - 0.5) * 10);
        c.moveTo(px, py);
        c.lineTo(px - Math.sin(a + 0.5) * 10, py + Math.cos(a + 0.5) * 10);
        c.stroke();
        c.lineWidth = 1;
    }

    function pintarRadar() {
        const cv = $('rb-tel-radar');
        const yo = miPos();
        if (!cv || !yo) return;
        const medida = ajustarLienzo(cv);
        if (!medida) return;
        const { lado: W, dpr } = medida, H = W, cx = W / 2, cy = H / 2, margen = 22;
        const brujula = raiz.RobotControl && raiz.RobotControl.rumbo ? raiz.RobotControl.rumbo() : null;
        const rot = Z.rumboArriba && brujula !== null ? brujula : 0;
        const c = cv.getContext('2d');
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        const otros = T.lista.filter(t => !T.reg || t.id !== T.reg.id);
        const radio = radioActual();
        const esc = (W / 2 - margen) / radio;
        const tinta = '#e8f0ea', verde = '#4ade80', naranja = '#fb923c';
        c.clearRect(0, 0, W, H);
        c.textBaseline = 'middle';
        c.font = '11px sans-serif';
        c.strokeStyle = tinta;
        c.fillStyle = tinta;
        c.lineWidth = 1;

        const anillo = PASOS_ANILLO.find(p => radio / p <= 4) || PASOS_ANILLO[PASOS_ANILLO.length - 1];
        c.textAlign = 'left';
        for (let r = anillo; r <= radio * 1.001; r += anillo) {
            c.globalAlpha = 0.28;
            c.beginPath(); c.arc(cx, cy, r * esc, 0, 7); c.stroke();
            c.globalAlpha = 0.7;
            c.fillText(bonito(r), cx + r * esc * 0.7071 + 3, cy - r * esc * 0.7071 - 2);
        }
        c.globalAlpha = 0.18;
        c.beginPath();
        c.moveTo(cx, cy - radio * esc); c.lineTo(cx, cy + radio * esc);
        c.moveTo(cx - radio * esc, cy); c.lineTo(cx + radio * esc, cy);
        c.stroke();
        c.globalAlpha = 0.85;
        c.textAlign = 'center';
        [['N', 0], ['E', 90], ['S', 180], ['O', 270]].forEach(([letra, g]) => {
            const a = (g - rot) * Math.PI / 180;
            c.fillText(letra, cx + Math.sin(a) * (W / 2 - 9), cy - Math.cos(a) * (H / 2 - 9));
        });
        c.globalAlpha = 1;

        pintarRastros(c, yo, rot, cx, cy, esc, W, verde);
        halo(c, cx, cy, yo.p || 0, esc, W, verde);
        if (brujula !== null) flechaRumbo(c, cx, cy, brujula - rot, verde);
        c.fillStyle = verde;
        c.beginPath(); c.arc(cx, cy, 6, 0, 7); c.fill();
        c.fillStyle = tinta;
        c.textAlign = 'center';
        c.fillText('Yo', cx, cy + 17);

        Z.puntos = [];
        otros.forEach(t => {
            const d = raiz.Robot.distanciaMetros(yo, t), rum = (raiz.Robot.rumboHacia(yo, t) - rot) * Math.PI / 180;
            const fuera = d * esc > W / 2 - margen;
            const rr = fuera ? W / 2 - margen : d * esc;
            const x = cx + Math.sin(rum) * rr, y = cy - Math.cos(rum) * rr;
            const color = T.guia && T.guia.id === t.id ? naranja : tinta;
            const opaco = edadSeg(t) > 60 ? 0.5 : 1;
            if (!fuera) halo(c, x, y, t.p || 0, esc, W, color);
            c.globalAlpha = opaco;
            c.fillStyle = color;
            if (fuera) {
                c.save();
                c.translate(x, y);
                c.rotate(rum);
                c.beginPath(); c.moveTo(0, -8); c.lineTo(6, 6); c.lineTo(-6, 6); c.closePath(); c.fill();
                c.restore();
            } else {
                c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill();
            }
            if (Z.sel === t.id) {
                c.strokeStyle = color;
                c.lineWidth = 2;
                c.beginPath(); c.arc(x, y, 11, 0, 7); c.stroke();
                c.lineWidth = 1;
            }
            const arriba = y > 34;
            c.fillStyle = tinta;
            c.textAlign = x > W - 70 ? 'right' : x < 70 ? 'left' : 'center';
            c.fillText(t.n.slice(0, 10), x, y + (arriba ? -22 : 22));
            c.fillText((fuera ? '→ ' : '') + bonito(d), x, y + (arriba ? -11 : 33));
            c.globalAlpha = 1;
            Z.puntos.push({ id: t.id, x, y });
        });

        const escala = $('rb-radar-escala');
        if (escala) escala.textContent = 'Radio ' + bonito(radio) + (Z.auto ? ' (automático)' : '') + ' · mi GPS ±' + Math.round(yo.p || 0) + ' m';
        const auto = $('rb-radar-auto');
        if (auto) auto.setAttribute('aria-pressed', String(Z.auto));
        const info = $('rb-radar-info');
        const elegido = otros.find(t => t.id === Z.sel);
        const ir = $('rb-radar-ir');
        if (ir) ir.disabled = !elegido || !!T.guia;
        const rb = $('rb-radar-rumbo');
        if (rb) rb.setAttribute('aria-pressed', String(Z.rumboArriba));
        if (info) info.textContent = elegido ? elegido.n + ': ' + bonito(raiz.Robot.distanciaMetros(yo, elegido)) + ' al ' + RUMBOS[Math.round(raiz.Robot.rumboHacia(yo, elegido) / 45) % 8] + ' · hace ' + hace(elegido) + ' · GPS ±' + Math.round(elegido.p || 0) + ' m' : '';
    }

    function iniciarRadar() {
        const cv = $('rb-tel-radar');
        if (!cv) return;
        $('rb-radar-mas').addEventListener('click', () => zoom(0.5));
        $('rb-radar-menos').addEventListener('click', () => zoom(2));
        $('rb-radar-auto').addEventListener('click', () => { Z.auto = true; pintarRadar(); });
        $('rb-radar-rumbo').addEventListener('click', () => {
            const hay = raiz.RobotControl && raiz.RobotControl.rumbo && raiz.RobotControl.rumbo() !== null;
            if (!Z.rumboArriba && !hay) { mensaje('El celular no tiene brújula activa, no puedo girar el mapa.'); return; }
            Z.rumboArriba = !Z.rumboArriba;
            pintarRadar();
        });
        const caja = $('rb-radar-caja'), pleno = $('rb-radar-full');
        const pantallaCompleta = si => {
            caja.classList.toggle('is-full', si);
            pleno.setAttribute('aria-pressed', String(si));
            pleno.textContent = si ? 'Cerrar pantalla completa' : 'Pantalla completa';
            requestAnimationFrame(pintarRadar);
        };
        pleno.addEventListener('click', () => pantallaCompleta(!caja.classList.contains('is-full')));
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && caja.classList.contains('is-full')) pantallaCompleta(false); });
        $('rb-radar-ir').addEventListener('click', () => {
            const q = T.lista.find(x => x.id === Z.sel);
            if (!q) return;
            pantallaCompleta(false);
            buscar(q.n, q.id);
        });
        cv.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 0.5 : 2); }, { passive: false });
        cv.addEventListener('dblclick', () => { Z.auto = true; pintarRadar(); });
        cv.addEventListener('pointerdown', e => {
            Z.dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (Z.dedos.size === 2) {
                const [a, b] = [...Z.dedos.values()];
                Z.dist0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
                Z.radio0 = radioActual();
            }
        });
        cv.addEventListener('pointermove', e => {
            if (!Z.dedos.has(e.pointerId)) return;
            Z.dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (Z.dedos.size !== 2) return;
            const [a, b] = [...Z.dedos.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            Z.auto = false;
            Z.radio = Math.min(RADIO_MAX, Math.max(RADIO_MIN, Z.radio0 * Z.dist0 / d));
            pintarRadar();
        });
        cv.addEventListener('pointerup', e => {
            const solo = Z.dedos.size === 1 && Z.dedos.has(e.pointerId);
            Z.dedos.delete(e.pointerId);
            if (!solo) return;
            const caja = cv.getBoundingClientRect();
            const x = e.clientX - caja.left, y = e.clientY - caja.top;
            const cerca = Z.puntos.map(q => ({ id: q.id, d: Math.hypot(q.x - x, q.y - y) })).sort((a, b) => a.d - b.d)[0];
            Z.sel = cerca && cerca.d < 22 ? cerca.id : null;
            pintarRadar();
        });
        cv.addEventListener('pointercancel', e => Z.dedos.delete(e.pointerId));
        raiz.addEventListener('resize', pintarRadar);
    }

    function pintarLista() {
        pintarRadar();
        const ul = $('rb-tel-lista');
        if (!ul) return;
        ul.textContent = '';
        const otros = T.lista.filter(t => !T.reg || t.id !== T.reg.id).sort((a, b) => (distanciaA(a) || 0) - (distanciaA(b) || 0));
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
            if (T.dueno) {
                const x = document.createElement('button');
                x.type = 'button';
                x.className = 'btn btn--secondary btn--sm';
                x.textContent = 'Expulsar';
                x.addEventListener('click', () => expulsar(t));
                li.appendChild(x);
            }
            ul.appendChild(li);
        });
    }

    async function expulsar(t) {
        if (!T.reg || !T.dueno || !raiz.confirm('¿Expulsar a ' + t.n + ' de la sala por 10 minutos?')) return;
        const r = await api('POST', { accion: 'expulsar', sala: T.reg.sala, id: T.reg.id, token: T.reg.token, objetivo: t.id });
        mensaje(r.ok ? t.n + ' ya no está en la sala.' : r.datos.error || 'No se pudo expulsar.');
        await refrescar();
    }

    async function refrescar() {
        if (!T.reg || !T.compartiendo) return;
        T.ultimaLista = Date.now();
        let r;
        try { r = await api('GET', { sala: T.reg.sala, id: T.reg.id, token: T.reg.token }); } catch (e) { return; }
        if (r.estado === 401) { T.reg = null; guardarReg(null); mensaje('Se perdió tu registro, vuelve a encender Compartir.'); await dejar(); return; }
        if (r.estado === 403 && r.datos.expulsado) { await expulsado(r.datos.error); return; }
        if (!r.ok) return;
        T.dueno = !!r.datos.dueno;
        T.lista = r.datos.telefonos || [];
        T.lista.forEach(q => { if (!T.reg || q.id !== T.reg.id) anotarRastro(q.id, q); });
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
        if (r.estado === 403 && r.datos.expulsado) { await expulsado(r.datos.error); return; }
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
        if (p.p <= 35) { T.recientes.push(p); if (T.recientes.length > 3) T.recientes.shift(); const s = posSuavizada(); if (s) anotarRastro('yo', s); }
        if (T.activa) pintarRadar();
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
        T.dueno = false;
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

    function motivoEspera(motivo, g, dest) {
        if (motivo === 'gps-malo') return 'Tu GPS está impreciso (±' + Math.round(T.pos ? T.pos.p : 0) + ' m): sal a un lugar abierto y espera.';
        if (!posSuavizada()) return 'Esperando tu ubicación del GPS…';
        if (!dest) return 'Esperando la ubicación de ' + g.nombre + '…';
        return 'Falta la brújula del celular para orientar a Hevy.';
    }

    function pasoGuia() {
        const g = T.guia;
        if (!g) return;
        const e = enlace();
        if (!listoRobot()) { pararGuia(null); mensaje('Hevy se desconectó y la búsqueda se paró.'); return; }
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
            mensaje(motivoEspera(d.motivo, g, dest));
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
            mensaje('Hay algo adelante de Hevy; espero a que se despeje.');
            if (Date.now() - g.bloqueadoDesde > 3000) pararGuia('telBloqueo');
            return;
        }
        g.bloqueadoDesde = 0;
        e.rumbo(d.rumboRelativo, d.v);
        mensaje('Hacia ' + g.nombre + ': ' + Math.round(d.distancia) + ' m');
        pintarRadar();
    }

    async function buscar(nombre, idExacto) {
        const fallo = (tipo, error, datos) => { decir(tipo, datos || { nombre }); mensaje(error.charAt(0).toUpperCase() + error.slice(1) + '.'); return { ok: false, error }; };
        if (T.guia) return { ok: false, error: 'ya estoy buscando a ' + T.guia.nombre };
        if (!T.compartiendo || !T.reg) return fallo('telSinUbicacion', 'primero hay que encender «Compartir mi ubicación» en la pestaña Teléfono');
        if (!listoRobot()) return fallo('sinRobot', 'el robot no está conectado');
        const e = enlace();
        if (!e.soportaRumbo()) return fallo('telSinGiro', 'el robot no tiene giroscopio en su programa');
        const fi0 = raiz.RobotControl && raiz.RobotControl.rumbo ? raiz.RobotControl.rumbo() : null;
        if (fi0 === null) return fallo('telSinBrujula', 'el celular no tiene brújula activa');
        await refrescar();
        const q = norm(nombre);
        const candidatos = T.lista.filter(t => t.id !== T.reg.id && (idExacto ? t.id === idExacto : norm(t.n).includes(q))).sort((a, b) => (distanciaA(a) || 0) - (distanciaA(b) || 0));
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
        $('rb-tel-crear').addEventListener('click', () => { $('rb-tel-sala').value = codigoNuevo(); T.salaNueva = $('rb-tel-sala').value; mensaje('Sala nueva: pásales el código a tus amigos.'); });
        $('rb-tel-borrar').addEventListener('click', () => dejar().then(() => mensaje('Se borró tu punto de la sala.')));
        $('rb-tel-parar').addEventListener('click', () => pararGuia(null));
        iniciarRadar();
        document.addEventListener('robot-paro', () => pararGuia(null));
        document.addEventListener('seccion-admin', e => { T.activa = !!(e.detail && e.detail.id === 'robot-telefono'); if (T.activa) { refrescar(); pintarLista(); } });
        setInterval(() => { if (T.compartiendo && debeEnviar()) enviar(); }, 5000);
        setInterval(() => { if (T.compartiendo && (T.activa || T.guia) && Date.now() - T.ultimaLista >= (T.guia ? LISTA_GUIA_MS : LISTA_MS)) refrescar(); }, 1000);
        raiz.addEventListener('pagehide', () => { if (T.compartiendo && T.reg) raiz.API.fetch('/api/telefonos?' + new URLSearchParams({ sala: T.reg.sala, id: T.reg.id, token: T.reg.token }).toString(), { method: 'DELETE', keepalive: true }).catch(() => null); });
        pintarLista();
    }

    raiz.Telefonos = { buscar, rumboArriba: () => Z.rumboArriba, parar: () => pararGuia(null), resumen, compartiendo: () => T.compartiendo, buscando: () => !!T.guia };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})(window);
