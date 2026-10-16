// Mando del robot en tiempo real (celular o compu): cruz de dirección, claxon, notas, luces, modos y,
// opcionalmente, inclinar el teléfono. Va en la pestaña «Control» del apartado Robot y se abre a pantalla completa
// (en el APK, forzando horizontal).
//
// Seguridad: arranca al 60 % de la velocidad; al soltar una tecla se manda «M 0 0»; al cerrar el mando, cambiar de
// pestaña, bloquear la pantalla, perder el enlace o pulsar PARO se frena; y el firmware frena solo si pasan 3 s sin órdenes.
// Depende de robot.js (Robot.mezclaJoystick y RobotEnlace).
(function (raiz) {
    const MS_REVISION = 66;       // ~15 veces por segundo
    const MS_LATIDO = 250;        // mientras se mantiene, se repite la orden (el firmware frena a los 3 s sin órdenes)
    const $ = id => document.getElementById(id);

    const C = {
        x: 0, y: 0,               // dirección pedida, de -1 a 1
        vmax: 60,
        movido: false, ultimo: '', ultimoEnvio: 0,
        inclinar: false, mantiene: false, ref: null, g: { x: 0, y: 0, z: 0 },
        activa: false,
        presionadas: new Map(),   // quién mantiene una dirección (puntero o tecla) -> [x, y]
    };

    const vibrar = patron => { try { if (navigator.vibrate) navigator.vibrate(patron); } catch (e) { /* sin vibración */ } };
    const enlace = () => raiz.RobotEnlace || null;
    const listo = () => !!(enlace() && enlace().listo());
    const abierto = () => $('sec-robot-control').classList.contains('is-pantalla');
    const apretado = id => $(id).getAttribute('aria-pressed') === 'true';

    // ---------- Envío ----------

    // Lo que se manda al robot: la cruz, o la inclinación mientras se mantiene el aro
    function fuente() {
        if (C.inclinar) return C.mantiene ? inclinacion() : { x: 0, y: 0 };
        return { x: C.x, y: C.y };
    }

    function revisar() {
        if (!C.activa || !listo()) return;
        const f = fuente();
        const m = raiz.Robot.mezclaJoystick(f.x, f.y, C.vmax);
        const clave = m.izq + ',' + m.der;
        const ahora = Date.now();
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

    // Frena ya, sin esperar al siguiente turno (al soltar, salir o perder el enlace)
    function frenar(conParo) {
        C.presionadas.clear();
        C.x = 0; C.y = 0;
        C.mantiene = false;
        document.querySelectorAll('#rb-mando .is-down').forEach(b => b.classList.remove('is-down'));
        if (!listo()) return;
        if (conParo) enlace().paro();
        else if (C.movido) enlace().mover(0, 0);
        C.movido = false;
        C.ultimo = '';
    }

    // ---------- Cruz de dirección (toque o teclado) ----------

    // Manda la última dirección que sigue apretada
    function actualizarDireccion() {
        const dirs = [...C.presionadas.values()];
        const d = dirs.length ? dirs[dirs.length - 1] : [0, 0];
        C.x = d[0]; C.y = d[1];
    }

    function mantener(quien, dir, boton) {
        C.presionadas.set(quien, dir);
        if (boton) boton.classList.add('is-down');
        actualizarDireccion();
    }

    function soltar(quien, boton) {
        C.presionadas.delete(quien);
        if (boton) boton.classList.remove('is-down');
        actualizarDireccion();
    }

    function iniciarCruz() {
        document.querySelectorAll('[data-dir]').forEach(b => {
            const dir = b.dataset.dir.split(',').map(Number);
            b.addEventListener('pointerdown', e => {
                e.preventDefault();
                try { b.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
                mantener(e.pointerId, dir, b);
                vibrar(8);
            });
            const fin = e => soltar(e.pointerId, b);
            for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, fin);
        });

        // Teclado: flechas o WASD, solo con el mando abierto
        const teclas = { ArrowUp: [0, 1], w: [0, 1], ArrowDown: [0, -1], s: [0, -1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
        document.addEventListener('keydown', e => {
            if (!abierto() || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.key === 'Escape') { cerrarMando(); return; }
            if (e.key === ' ') { e.preventDefault(); frenar(true); return; }
            const dir = teclas[e.key.length === 1 ? e.key.toLowerCase() : e.key];
            if (!dir) return;
            e.preventDefault();
            mantener('k' + e.key.toLowerCase(), dir, null);
        });
        document.addEventListener('keyup', e => soltar('k' + e.key.toLowerCase(), null));
    }

    // ---------- Inclinar el celular ----------
    // El giro sale de cuánto se inclina hacia un lado dentro del plano de la pantalla (como un volante) y el
    // avance de inclinar la parte de arriba hacia afuera o hacia ti. Se calibra con el teléfono como lo agarras.

    function gravedad() {
        const ang = (raiz.screen && raiz.screen.orientation && raiz.screen.orientation.angle) || 0;
        const rad = ang * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
        const g = C.g;
        return { x: g.x * c + g.y * s, y: -g.x * s + g.y * c, z: g.z };
    }

    function inclinacion() {
        if (!C.ref) return { x: 0, y: 0 };
        const g = gravedad();
        const giro = (apretado('rb-incl-inv-g') ? -1 : 1) * (g.x - C.ref.x) / 0.5;
        const avance = (apretado('rb-incl-inv-a') ? -1 : 1) * (g.z - C.ref.z) / 0.5;
        const k = v => Math.max(-1, Math.min(1, v));
        return { x: k(giro), y: k(avance) };
    }

    function calibrar() {
        C.ref = gravedad();
        $('rb-incl-estado').textContent = '';
        vibrar(20);
    }

    function alternar(id) {
        const b = $(id);
        b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
    }

    function iniciarInclinar() {
        raiz.addEventListener('devicemotion', e => {
            const a = e.accelerationIncludingGravity;
            if (!a || a.x === null) return;
            const t = 9.81, f = 0.25;                     // filtro pasa-bajos: quita temblores
            C.g = { x: C.g.x + ((a.x / t) - C.g.x) * f, y: C.g.y + ((a.y / t) - C.g.y) * f, z: C.g.z + ((a.z / t) - C.g.z) * f };
        });
        $('rb-incl-on').addEventListener('click', () => {
            alternar('rb-incl-on');
            C.inclinar = apretado('rb-incl-on');
            C.ref = null;
            frenar(false);
            $('rb-mando').classList.toggle('es-incl', C.inclinar);
            $('rb-incl-estado').textContent = '';
            if (C.inclinar) calibrar();                   // arranca calibrado con el teléfono como lo traes
        });
        $('rb-incl-cal').addEventListener('click', calibrar);
        $('rb-incl-inv-g').addEventListener('click', () => alternar('rb-incl-inv-g'));
        $('rb-incl-inv-a').addEventListener('click', () => alternar('rb-incl-inv-a'));
        const mant = $('rb-incl-mant');
        const ya = v => {
            if (v && C.inclinar && C.ref) { C.mantiene = true; mant.classList.add('is-down'); }
            else if (!v) { frenar(false); mant.classList.remove('is-down'); }
        };
        mant.addEventListener('pointerdown', e => { e.preventDefault(); try { mant.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ } ya(true); });
        for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) mant.addEventListener(ev, () => ya(false));
    }

    // ---------- Botones de acción, bandejas y modos ----------

    function cerrarBandejas(menos) {
        document.querySelectorAll('.rb-bandeja').forEach(b => { if (b !== menos) b.hidden = true; });
        document.querySelectorAll('[data-abre]').forEach(b => b.setAttribute('aria-expanded', String(!!menos && b.dataset.abre === menos.id)));
    }

    function iniciarBotones() {
        $('rb-ctl-paro').addEventListener('pointerdown', e => { e.preventDefault(); frenar(true); vibrar([60, 40, 60]); });
        $('rb-ctl-paro').addEventListener('click', e => { if (e.detail === 0) frenar(true); });     // teclado / lector de pantalla
        $('rb-ctl-vmax').addEventListener('input', e => {
            C.vmax = Number(e.target.value);
            $('rb-ctl-vmax-v').textContent = C.vmax;
        });
        $('rb-ctl-bt').addEventListener('click', () => { const b = $('rb-conectar'); if (b) b.click(); });

        document.querySelectorAll('[data-nota]').forEach(b => b.addEventListener('click', () => {
            if (!listo()) return;
            const [hz, ms] = b.dataset.nota.split(',').map(Number);
            enlace().enviar(['T ' + hz + ' ' + ms]);
            vibrar(12);
        }));
        document.querySelectorAll('[data-luz]').forEach(b => b.addEventListener('click', () => {
            if (listo()) enlace().luces(b.dataset.luz, b.dataset.color || null);
            vibrar(12);
            cerrarBandejas(null);
        }));
        document.querySelectorAll('[data-abre]').forEach(b => b.addEventListener('click', () => {
            const bandeja = $(b.dataset.abre);
            const abrir = bandeja.hidden;
            cerrarBandejas(abrir ? bandeja : null);
            bandeja.hidden = !abrir;
        }));
        // Tocar fuera de una bandeja la cierra
        document.addEventListener('pointerdown', e => {
            if (!e.target.closest('.rb-bandeja, [data-abre]')) cerrarBandejas(null);
        });

        document.querySelectorAll('[data-modo]').forEach(b => b.addEventListener('click', () => {
            if (!listo()) return;
            const m = b.dataset.modo;
            frenar(false);
            if (m === 'manual') enlace().manual(); else enlace().modo(Number(m));
            document.querySelectorAll('[data-modo]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
            vibrar(18);
        }));
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
        if (!si) cerrarBandejas(null);
        fijarHorizontal(si);
    }

    function cerrarMando() {
        frenar(false);
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
        if (e !== 'listo') { C.movido = false; C.ultimo = ''; C.x = 0; C.y = 0; C.presionadas.clear(); C.mantiene = false; }
    }

    function iniciar() {
        if (!$('rb-mando') || !raiz.Robot || !raiz.Robot.mezclaJoystick) return;
        iniciarCruz();
        iniciarInclinar();
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
