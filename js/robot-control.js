// Mando del robot en tiempo real (celular o compu): palanca, inclinar el teléfono, claxon, canciones y luces.
// Va en la pestaña «Control» del apartado Robot y se abre a pantalla completa (en el APK, forzando horizontal).
//
// Seguridad: arranca al 60 % de la velocidad; al soltar la palanca se manda «M 0 0»; al cerrar el mando, cambiar de
// pestaña, bloquear la pantalla, perder el enlace o pulsar PARO se frena; y el firmware frena solo si pasan 3 s sin órdenes.
// Depende de robot.js (Robot.mezclaJoystick y RobotEnlace).
(function (raiz) {
    const MS_REVISION = 66;       // ~15 veces por segundo
    const MS_LATIDO = 250;        // mientras se mantiene, se repite la orden (el firmware frena a los 3 s sin órdenes)
    const MS_CLAXON = 140;        // el claxon se repite mientras se mantiene (cada nota dura 320 ms: sin huecos)
    const MS_ARMAR = 1200;        // al activar inclinar, un momento para acomodar el teléfono antes de que mande
    const ZONA_GRADOS = 7, TOPE_GRADOS = 30;
    const MS_TURBO_MAX = 8000;    // guarda de calor: tras 8 s seguidos arriba de la velocidad normal, vuelve a la normal un rato
    const MS_ENFRIA = 4000;
    const $ = id => document.getElementById(id);

    const C = {
        jx: 0, jy: 0, joyActivo: false,   // palanca, de -1 a 1
        teclas: new Map(),                // teclado: tecla -> [x, y]
        vmax: 60,
        movido: false, ultimo: '', ultimoEnvio: 0,
        inclinar: false, ref: null, armaEn: 0, g: { x: 0, y: 0, z: 0 }, tilt: { x: 0, y: 0 },
        activa: false, claxon: null, vigila: null,
        turbo: false, vmaxPrev: 60, luzPrev: null, carga: 0, enfriaHasta: 0, ultimaRev: 0,
    };

    const vibrar = patron => { try { if (navigator.vibrate) navigator.vibrate(patron); } catch (e) { /* sin vibración */ } };
    const enlace = () => raiz.RobotEnlace || null;
    const listo = () => !!(enlace() && enlace().listo());
    const abierto = () => $('sec-robot-control').classList.contains('is-pantalla');
    const apretado = id => $(id).getAttribute('aria-pressed') === 'true';
    const k1 = v => Math.max(-1, Math.min(1, v));

    // ---------- Qué se manda ----------

    function teclado() {
        const v = [...C.teclas.values()];
        return v.length ? { x: v[v.length - 1][0], y: v[v.length - 1][1] } : { x: 0, y: 0 };
    }

    function fuente() {
        if (C.inclinar) return Date.now() >= C.armaEn ? C.tilt : { x: 0, y: 0 };
        return C.joyActivo ? { x: C.jx, y: C.jy } : teclado();
    }

    function revisar() {
        if (!C.activa) return;
        if (C.inclinar) leerInclinacion();
        if (!listo()) return;
        const f = fuente();
        const ahora = Date.now();
        const turbo = C.turbo && ahora >= C.enfriaHasta;
        const m = raiz.Robot.mezclaJoystick(f.x, f.y, C.vmax, turbo ? raiz.Robot.VEL_TURBO : undefined);
        const clave = m.izq + ',' + m.der;
        if (C.turbo) guardaCalor(m, ahora);
        if (m.izq === 0 && m.der === 0) {
            if (C.movido) {                        // se soltó: una sola orden de frenado
                enlace().mover(0, 0);
                C.movido = false;
                C.ultimo = '';
                C.ultimoEnvio = ahora;
            }
            return;
        }
        C.movido = true;
        if (clave !== C.ultimo || ahora - C.ultimoEnvio >= MS_LATIDO) {
            enlace().mover(m.izq, m.der);
            C.ultimo = clave;
            C.ultimoEnvio = ahora;
        }
    }

    // Turbo sin sobrecargar: el firmware ya sube los motores en rampa (sin tirón de corriente); además, si se pide más
    // que la velocidad normal durante MS_TURBO_MAX seguidos, se vuelve a la normal MS_ENFRIA para que descansen
    function guardaCalor(m, ahora) {
        const dt = Math.min(200, ahora - (C.ultimaRev || ahora));
        C.ultimaRev = ahora;
        const esfuerzo = Math.max(Math.abs(m.izq), Math.abs(m.der));
        if (esfuerzo > raiz.Robot.VEL_MAX) C.carga += dt; else C.carga = Math.max(0, C.carga - dt * 1.5);
        if (C.carga > MS_TURBO_MAX) { C.carga = 0; C.enfriaHasta = ahora + MS_ENFRIA; vibrar([40, 60, 40]); }
        $('rb-turbo').classList.toggle('is-enfriando', ahora < C.enfriaHasta);
    }

    // Frena ya, sin esperar al siguiente turno (al soltar, salir o perder el enlace)
    function frenar(conParo) {
        C.jx = 0; C.jy = 0; C.joyActivo = false;
        C.teclas.clear();
        C.tilt = { x: 0, y: 0 };
        pintarPalanca();
        pintarNivel();
        $('rb-joy').classList.remove('is-activo');
        soltarClaxon();
        if (!listo()) return;
        if (conParo) enlace().paro();
        else if (C.movido) enlace().mover(0, 0);
        C.movido = false;
        C.ultimo = '';
    }

    // ---------- Palanca ----------

    function pintarPalanca() {
        const joy = $('rb-joy'), mando = $('rb-joy-mando');
        const alcance = Math.max(0, joy.offsetWidth / 2 - mando.offsetWidth / 2);
        const x = C.joyActivo ? C.jx : 0, y = C.joyActivo ? C.jy : 0;
        mando.style.transform = `translate(${(x * alcance).toFixed(1)}px, ${(-y * alcance).toFixed(1)}px)`;
    }

    function iniciarPalanca() {
        const joy = $('rb-joy');
        let id = null;
        const llevar = e => {
            const r = joy.getBoundingClientRect();
            let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
            let dy = -(e.clientY - (r.top + r.height / 2)) / (r.height / 2);
            const m = Math.hypot(dx, dy);
            if (m > 1) { dx /= m; dy /= m; }
            C.jx = dx; C.jy = dy;
            pintarPalanca();
        };
        joy.addEventListener('pointerdown', e => {
            if (id !== null) return;
            id = e.pointerId;
            try { joy.setPointerCapture(id); } catch (err) { /* sin captura */ }
            C.joyActivo = true;
            joy.classList.add('is-activo');
            llevar(e);
            e.preventDefault();
        });
        joy.addEventListener('pointermove', e => { if (e.pointerId === id) llevar(e); });
        const soltar = e => {
            if (e.pointerId !== id) return;
            id = null;
            C.joyActivo = false; C.jx = 0; C.jy = 0;
            joy.classList.remove('is-activo');
            pintarPalanca();
        };
        joy.addEventListener('pointerup', soltar);
        joy.addEventListener('pointercancel', soltar);
        joy.addEventListener('lostpointercapture', soltar);
        window.addEventListener('resize', () => { pintarPalanca(); pintarNivel(); });

        // Teclado (compu): flechas o WASD, solo con el mando abierto. Espacio = paro, Esc = cerrar
        const dirs = { ArrowUp: [0, 1], w: [0, 1], ArrowDown: [0, -1], s: [0, -1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
        const nombre = e => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
        document.addEventListener('keydown', e => {
            if (!abierto() || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.key === 'Escape') { cerrarMando(); return; }
            if (e.key === ' ') { e.preventDefault(); frenar(true); return; }
            const d = dirs[nombre(e)];
            if (!d) return;
            e.preventDefault();
            C.teclas.set(nombre(e), d);
        });
        document.addEventListener('keyup', e => C.teclas.delete(nombre(e)));
    }

    // ---------- Inclinar el celular ----------
    // Sin botón de «mantener»: mientras esté activo, el teléfono manda. Subir el borde de arriba de la pantalla (hacia
    // el frente) = adelante; bajarlo = atrás. Ladear (un lado arriba, el otro abajo) = girar. Todo es relativo a la
    // posición en que se centró, y hay una zona muerta de unos grados para que el temblor de las manos no mueva el robot.

    // Gravedad en los ejes de la pantalla tal como se ve: x a la derecha, y hacia arriba, z hacia ti
    function gravedad() {
        const ang = (raiz.screen && raiz.screen.orientation && raiz.screen.orientation.angle) || 0;
        const rad = ang * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
        const g = C.g;
        return { x: g.x * c - g.y * s, y: g.x * s + g.y * c, z: g.z };
    }

    const grados = r => r * 180 / Math.PI;
    function posturaActual() {
        const g = gravedad();
        return { cab: grados(Math.atan2(g.y, g.z)), lad: grados(Math.atan2(g.x, Math.hypot(g.y, g.z))) };
    }

    const sinZona = d => (Math.abs(d) < ZONA_GRADOS ? 0 : Math.sign(d) * k1((Math.abs(d) - ZONA_GRADOS) / (TOPE_GRADOS - ZONA_GRADOS)));

    function leerInclinacion() {
        const p = posturaActual();
        if (Date.now() < C.armaEn || !C.ref) {            // acomodando: el cero sigue a la postura hasta que arma
            C.ref = p;
            C.tilt = { x: 0, y: 0 };
        } else {
            const avance = sinZona(p.cab - C.ref.cab) * (apretado('rb-incl-inv-a') ? -1 : 1);
            const giro = sinZona(-(p.lad - C.ref.lad)) * (apretado('rb-incl-inv-g') ? -1 : 1);
            C.tilt = { x: giro, y: avance };
        }
        pintarNivel();
    }

    function pintarNivel() {
        const nivel = document.querySelector('.rb-nivel'), punto = $('rb-nivel-punto');
        if (!nivel || !nivel.offsetWidth) return;
        const alcance = nivel.offsetWidth * 0.39;
        punto.style.transform = `translate(${(C.tilt.x * alcance).toFixed(1)}px, ${(-C.tilt.y * alcance).toFixed(1)}px)`;
        nivel.classList.toggle('is-armado', Date.now() >= C.armaEn);
    }

    function centrar() {
        C.ref = posturaActual();
        C.armaEn = 0;
        vibrar(20);
    }

    function alternar(id) {
        const b = $(id);
        b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
    }

    function ponerInclinar(si) {
        C.inclinar = si;
        $('rb-incl-on').setAttribute('aria-pressed', String(si));
        $('rb-mando').classList.toggle('es-incl', si);
        C.ref = null;
        C.armaEn = si ? Date.now() + MS_ARMAR : 0;
        if (!si) frenar(false);
        C.tilt = { x: 0, y: 0 };
        pintarNivel();
        pintarPalanca();
    }

    function iniciarInclinar() {
        raiz.addEventListener('devicemotion', e => {
            const a = e.accelerationIncludingGravity;
            if (!a || a.x === null) return;
            const t = 9.81, f = 0.25;                     // filtro pasa-bajos: quita temblores
            C.g = { x: C.g.x + ((a.x / t) - C.g.x) * f, y: C.g.y + ((a.y / t) - C.g.y) * f, z: C.g.z + ((a.z / t) - C.g.z) * f };
        });
        $('rb-incl-on').addEventListener('click', () => { if (C.turbo) return; vibrar(14); ponerInclinar(!C.inclinar); });
        $('rb-incl-cal').addEventListener('click', centrar);
        $('rb-incl-inv-g').addEventListener('click', () => alternar('rb-incl-inv-g'));
        $('rb-incl-inv-a').addEventListener('click', () => alternar('rb-incl-inv-a'));
    }

    // ---------- Turbo ----------
    // Más potencia a los motores (hasta VEL_TURBO) y se apagan las demás funciones: canción, luces, claxon, inclinar y
    // los menús. Al salir del turbo se devuelven las luces y la velocidad que había.

    function ponerTurbo(si) {
        if (si === C.turbo) return;
        C.turbo = si;
        C.carga = 0; C.enfriaHasta = 0; C.ultimaRev = 0;
        const e = enlace(), vm = $('rb-ctl-vmax');
        $('rb-mando').classList.toggle('es-turbo', si);
        $('rb-turbo').setAttribute('aria-pressed', String(si));
        $('rb-turbo').classList.remove('is-enfriando');
        if (si) {
            C.vmaxPrev = C.vmax;
            C.vmax = 100;
            vm.disabled = true;
            $('rb-ctl-vmax-v').textContent = 'MAX';
            cerrarMenus(null);
            soltarClaxon();
            if (C.inclinar) ponerInclinar(false);
            if (listo()) { C.luzPrev = e.luzAhora(); e.detenerCancion(); e.luces('fijo', '#000000'); }
        } else {
            C.vmax = C.vmaxPrev;
            vm.value = C.vmax;
            vm.disabled = false;
            $('rb-ctl-vmax-v').textContent = C.vmax;
            if (listo() && C.luzPrev) e.ponerLuz(C.luzPrev);
            C.luzPrev = null;
        }
        frenar(false);
        vibrar(si ? [30, 40, 60] : 20);
    }

    // ---------- Claxon: suena mientras se mantiene ----------

    function tocarClaxon() { if (listo()) enlace().nota(440, 320); }

    function soltarClaxon() {
        clearInterval(C.claxon);
        C.claxon = null;
        $('rb-claxon').classList.remove('is-down');
    }

    function iniciarClaxon() {
        const b = $('rb-claxon');
        b.addEventListener('pointerdown', e => {
            e.preventDefault();
            if (C.turbo) return;
            try { b.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
            b.classList.add('is-down');
            vibrar(10);
            tocarClaxon();
            clearInterval(C.claxon);
            C.claxon = setInterval(tocarClaxon, MS_CLAXON);
        });
        for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, soltarClaxon);
        b.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { b.classList.add('is-down'); tocarClaxon(); C.claxon = C.claxon || setInterval(tocarClaxon, MS_CLAXON); } });
        b.addEventListener('keyup', soltarClaxon);
    }

    // ---------- Menús chicos: canciones y luces ----------

    function cerrarMenus(menos) {
        document.querySelectorAll('.rb-menu').forEach(m => { if (m !== menos) m.hidden = true; });
        document.querySelectorAll('[data-abre]').forEach(b => b.setAttribute('aria-expanded', String(!!menos && b.dataset.abre === menos.id)));
        if (!menos || menos.id !== 'rb-menu-musica') { clearInterval(C.vigila); C.vigila = null; }
    }

    const icono = id => `<svg class="icon" aria-hidden="true"><use href="#i-${id}"/></svg>`;

    function pintarCanciones() {
        const lista = $('rb-canciones');
        const e = enlace();
        const cs = e && e.canciones ? e.canciones() : [];
        lista.textContent = '';
        if (!cs.length) {
            const v = document.createElement('p');
            v.className = 'rb-menu__vacio';
            v.textContent = 'No hay canciones.';
            lista.appendChild(v);
            return;
        }
        for (const c of cs) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'rb-cancion' + (c.mia ? ' rb-cancion--mia' : '');
            b.dataset.id = c.id;
            b.setAttribute('aria-pressed', 'false');
            b.innerHTML = icono('play');
            const t = document.createElement('span');
            t.textContent = c.nombre;
            b.appendChild(t);
            lista.appendChild(b);
        }
        marcarSonando();
    }

    // Marca cuál suena (y le pone el icono de parar); se repite mientras el menú está abierto
    function marcarSonando() {
        const suena = enlace() && enlace().sonando ? enlace().sonando() : '';
        document.querySelectorAll('#rb-canciones .rb-cancion').forEach(b => {
            const on = b.dataset.id === suena;
            if (b.getAttribute('aria-pressed') !== String(on)) {
                b.setAttribute('aria-pressed', String(on));
                b.querySelector('use').setAttribute('href', on ? '#i-stop' : '#i-play');
            }
        });
    }

    function iniciarMenus() {
        document.querySelectorAll('[data-abre]').forEach(b => b.addEventListener('click', () => {
            if (C.turbo) return;
            const menu = $(b.dataset.abre);
            const abrir = menu.hidden;
            cerrarMenus(abrir ? menu : null);
            menu.hidden = !abrir;
            if (abrir && menu.id === 'rb-menu-musica') {
                pintarCanciones();
                C.vigila = setInterval(marcarSonando, 600);
            }
        }));
        // Tocar fuera de un menú lo cierra
        document.addEventListener('pointerdown', e => {
            if (!e.target.closest('.rb-menu, [data-abre]')) cerrarMenus(null);
        });
        $('rb-canciones').addEventListener('click', e => {
            const b = e.target.closest('.rb-cancion');
            if (!b || !listo()) return;
            if (b.getAttribute('aria-pressed') === 'true') enlace().detenerCancion();
            else enlace().tocarCancion(b.dataset.id);
            vibrar(12);
            setTimeout(marcarSonando, 150);
        });
        document.querySelectorAll('[data-luz]').forEach(b => b.addEventListener('click', () => {
            if (listo()) enlace().luces(b.dataset.luz, b.dataset.color || null);
            vibrar(12);
            cerrarMenus(null);
        }));
    }

    function iniciarBotones() {
        $('rb-ctl-paro').addEventListener('pointerdown', e => { e.preventDefault(); frenar(true); vibrar([60, 40, 60]); });
        $('rb-ctl-paro').addEventListener('click', e => { if (e.detail === 0) frenar(true); });     // teclado / lector de pantalla
        $('rb-ctl-vmax').addEventListener('input', e => {
            C.vmax = Number(e.target.value);
            $('rb-ctl-vmax-v').textContent = C.vmax;
        });
        $('rb-ctl-bt').addEventListener('click', () => { const b = $('rb-conectar'); if (b) b.click(); });
        $('rb-turbo').addEventListener('click', () => ponerTurbo(!C.turbo));
    }

    // ---------- Abrir y cerrar el mando ----------

    const orientacion = () => raiz.Plataforma && raiz.Plataforma.plugin('ScreenOrientation');

    async function fijarHorizontal(si) {
        try {
            const O = orientacion();
            if (O) { if (si) await O.lock({ orientation: 'landscape' }); else await O.unlock(); }
        } catch (e) { /* sin bloqueo de orientación: el aviso de girar se encarga */ }
    }

    function abrirMando(si) {
        const sec = $('sec-robot-control');
        sec.classList.toggle('is-pantalla', si);
        document.body.classList.toggle('rb-pantalla-completa', si);
        window.scrollTo(0, 0);
        if (!si) cerrarMenus(null);
        fijarHorizontal(si);
        requestAnimationFrame(() => { pintarPalanca(); pintarNivel(); });
    }

    function cerrarMando() {
        ponerTurbo(false);
        frenar(false);
        if (C.inclinar) ponerInclinar(false);
        abrirMando(false);
    }

    // La usa el botón atrás de Android: true si había mando abierto y lo cerró
    function salirPantalla() {
        if (!abierto()) return false;
        cerrarMando();
        return true;
    }

    // ---------- Estado, pantalla encendida y seguridad ----------

    let candado = null;
    async function pantallaEncendida(si) {
        try {
            if (si && navigator.wakeLock && !candado) {
                candado = await navigator.wakeLock.request('screen');
                candado.addEventListener('release', () => { candado = null; });
            } else if (!si && candado) {
                await candado.release();
                candado = null;
            }
        } catch (e) { /* no se pudo mantener la pantalla encendida */ }
    }

    function pintarEstado() {
        const e = enlace() ? enlace().estado() : 'desconectado';
        const textos = { desconectado: ['Sin conectar', 'idle'], conectando: ['Conectando…', 'idle'], listo: ['Robot listo', 'ok'], sinprograma: ['No contesta', 'off'] };
        const [txt, clase] = textos[e] || textos.desconectado;
        $('rb-ctl-estado').className = 'badge badge--' + clase;
        $('rb-ctl-estado-txt').textContent = txt;
        $('rb-mando-estado').setAttribute('aria-label', txt);
        $('rb-mando-estado').title = txt;
        const sec = $('sec-robot-control');
        for (const k of ['listo', 'conectando', 'sinprograma']) sec.classList.toggle('is-' + k, e === k);
        sec.classList.toggle('is-sin-enlace', e !== 'listo');
        if (e !== 'listo') { C.movido = false; C.ultimo = ''; C.jx = 0; C.jy = 0; C.joyActivo = false; C.teclas.clear(); C.tilt = { x: 0, y: 0 }; pintarPalanca(); }
    }

    function iniciar() {
        if (!$('rb-mando') || !raiz.Robot || !raiz.Robot.mezclaJoystick) return;
        iniciarPalanca();
        iniciarInclinar();
        iniciarClaxon();
        iniciarMenus();
        iniciarBotones();
        $('rb-ctl-full').addEventListener('click', () => abrirMando(true));
        $('rb-ctl-salir').addEventListener('click', cerrarMando);
        pintarEstado();
        setInterval(revisar, MS_REVISION);

        document.addEventListener('robot-estado', pintarEstado);
        document.addEventListener('seccion-admin', e => {
            const activa = e.detail && e.detail.id === 'robot-control';
            if (C.activa && !activa) cerrarMando();
            C.activa = activa;
            pantallaEncendida(activa);
        });
        // Si la app pasa a segundo plano o se bloquea la pantalla: paro total
        document.addEventListener('visibilitychange', () => { if (document.hidden) frenar(true); });
        window.addEventListener('pagehide', () => frenar(true));
        window.addEventListener('blur', () => frenar(false));
    }

    raiz.RobotControl = { salirPantalla };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})(window);
