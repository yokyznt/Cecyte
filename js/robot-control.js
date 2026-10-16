// Control en tiempo real del robot desde el celular (o la compu): joystick táctil, inclinar el teléfono,
// claxon, luces rápidas y modos automáticos. Va en la pestaña «Control» del apartado Robot.
//
// Seguridad: arranca al 60 % de la velocidad; al soltar el joystick se manda «M 0 0»; al salir de la pestaña,
// bloquear la pantalla, perder el enlace o pulsar PARO se frena; y el firmware frena solo si pasan 3 s sin órdenes.
// Depende de robot.js (Robot.mezclaJoystick y RobotEnlace).
(function (raiz) {
    const MS_REVISION = 66;       // ~15 veces por segundo
    const MS_LATIDO = 250;        // mientras se mantiene, se repite la orden (el firmware frena a los 3 s sin órdenes)
    const $ = id => document.getElementById(id);

    const C = {
        x: 0, y: 0,               // la palanca, de -1 a 1
        vmax: 60,
        movido: false, ultimo: '', ultimoEnvio: 0,
        inclinar: false, mantiene: false, ref: null, g: { x: 0, y: 0, z: 0 },
        activa: false, luz: null,
    };

    const vibrar = patron => { try { if (navigator.vibrate) navigator.vibrate(patron); } catch (e) { /* sin vibración */ } };
    const enlace = () => raiz.RobotEnlace || null;
    const listo = () => !!(enlace() && enlace().listo());

    // ---------- Palanca ----------

    function pintarPalanca() {
        const joy = $('rb-joy'), mando = $('rb-joy-mando');
        if (!joy || !mando) return;
        const r = joy.getBoundingClientRect();
        const alcance = Math.max(0, r.width / 2 - mando.offsetWidth / 2);
        mando.style.transform = `translate(${(C.x * alcance).toFixed(1)}px, ${(-C.y * alcance).toFixed(1)}px)`;
        const m = raiz.Robot.mezclaJoystick(C.x, C.y, C.vmax);
        $('rb-joy-txt').textContent = `Izquierda ${m.izq} · Derecha ${m.der}`;
    }

    function fijar(x, y) {
        C.x = x; C.y = y;
        pintarPalanca();
    }

    // Lo que se manda al robot: la palanca, o la inclinación mientras se mantiene el botón
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
        fijar(0, 0);
        C.mantiene = false;
        if (!listo()) return;
        if (conParo) enlace().paro();
        else if (C.movido) enlace().mover(0, 0);
        C.movido = false;
        C.ultimo = '';
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
            fijar(dx, dy);
        };
        joy.addEventListener('pointerdown', e => {
            if (id !== null) return;
            id = e.pointerId;
            try { joy.setPointerCapture(id); } catch (err) { /* sin captura */ }
            joy.classList.add('is-activo');
            llevar(e);
            e.preventDefault();
        });
        joy.addEventListener('pointermove', e => { if (e.pointerId === id) llevar(e); });
        const soltar = e => {
            if (e.pointerId !== id) return;
            id = null;
            joy.classList.remove('is-activo');
            frenar(false);
        };
        joy.addEventListener('pointerup', soltar);
        joy.addEventListener('pointercancel', soltar);
        joy.addEventListener('lostpointercapture', soltar);
        window.addEventListener('resize', pintarPalanca);
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
        const giro = ($('rb-incl-inv-g').checked ? -1 : 1) * (g.x - C.ref.x) / 0.5;
        const avance = ($('rb-incl-inv-a').checked ? -1 : 1) * (g.z - C.ref.z) / 0.5;
        const k = v => Math.max(-1, Math.min(1, v));
        return { x: k(giro), y: k(avance) };
    }

    function calibrar() {
        C.ref = gravedad();
        $('rb-incl-estado').textContent = 'Calibrado. Mantén pulsado «Mantén para manejar» e inclina.';
        vibrar(20);
    }

    function iniciarInclinar() {
        raiz.addEventListener('devicemotion', e => {
            const a = e.accelerationIncludingGravity;
            if (!a || a.x === null) return;
            const t = 9.81, f = 0.25;                     // filtro pasa-bajos: quita temblores
            C.g = { x: C.g.x + ((a.x / t) - C.g.x) * f, y: C.g.y + ((a.y / t) - C.g.y) * f, z: C.g.z + ((a.z / t) - C.g.z) * f };
        });
        $('rb-incl-on').addEventListener('change', e => {
            C.inclinar = e.target.checked;
            C.ref = null;
            frenar(false);
            $('rb-incl-opciones').hidden = !C.inclinar;
            $('rb-joy').classList.toggle('is-apagado', C.inclinar);
            $('rb-incl-estado').textContent = C.inclinar ? 'Pulsa Calibrar con el teléfono como lo agarras.' : '';
        });
        $('rb-incl-cal').addEventListener('click', calibrar);
        const mant = $('rb-incl-mant');
        const ya = v => {
            if (C.inclinar && C.ref) C.mantiene = v;
            else if (v) $('rb-incl-estado').textContent = 'Primero pulsa Calibrar.';
            if (!v) frenar(false);
        };
        mant.addEventListener('pointerdown', e => { e.preventDefault(); try { mant.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ } ya(true); });
        for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) mant.addEventListener(ev, () => ya(false));
    }

    // ---------- Botones rápidos ----------

    function iniciarBotones() {
        $('rb-ctl-paro').addEventListener('click', () => { frenar(true); vibrar([60, 40, 60]); });
        $('rb-ctl-vmax').addEventListener('input', e => {
            C.vmax = Number(e.target.value);
            $('rb-ctl-vmax-v').textContent = C.vmax + ' %';
            pintarPalanca();
        });
        document.querySelectorAll('[data-nota]').forEach(b => b.addEventListener('click', () => {
            if (!listo()) return;
            const [hz, ms] = b.dataset.nota.split(',').map(Number);
            enlace().enviar(['T ' + hz + ' ' + ms]);
            vibrar(12);
        }));
        document.querySelectorAll('[data-luz]').forEach(b => b.addEventListener('click', () => {
            if (!listo()) return;
            enlace().luces(b.dataset.luz, b.dataset.color || null);
            vibrar(12);
        }));
        document.querySelectorAll('[data-modo]').forEach(b => b.addEventListener('click', () => {
            if (!listo()) return;
            const m = b.dataset.modo;
            frenar(false);
            if (m === 'manual') enlace().manual(); else enlace().modo(Number(m));
            document.querySelectorAll('[data-modo]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
            vibrar(18);
        }));
    }

    // ---------- Pantalla completa: el control ocupa todo, sin cabecera ni pestañas ----------

    function pantallaCompleta(si) {
        const sec = $('sec-robot-control'), boton = $('rb-ctl-full');
        sec.classList.toggle('is-pantalla', si);
        document.body.classList.toggle('rb-pantalla-completa', si);
        boton.setAttribute('aria-pressed', String(si));
        boton.textContent = si ? 'Salir de pantalla completa' : 'Pantalla completa';
        window.scrollTo(0, 0);
        pintarPalanca();
    }

    // La usa el botón atrás de Android: true si había pantalla completa y la cerró
    function salirPantalla() {
        const sec = $('sec-robot-control');
        if (!sec || !sec.classList.contains('is-pantalla')) return false;
        frenar(false);
        pantallaCompleta(false);
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
        $('sec-robot-control').classList.toggle('is-sin-enlace', e !== 'listo');
        if (e !== 'listo') { C.movido = false; C.ultimo = ''; fijar(0, 0); C.mantiene = false; }
    }

    function iniciar() {
        if (!$('rb-joy') || !raiz.Robot || !raiz.Robot.mezclaJoystick) return;
        iniciarPalanca();
        iniciarInclinar();
        iniciarBotones();
        $('rb-ctl-full').addEventListener('click', () => pantallaCompleta(!$('sec-robot-control').classList.contains('is-pantalla')));
        pintarPalanca();
        pintarEstado();
        setInterval(revisar, MS_REVISION);

        document.addEventListener('robot-estado', pintarEstado);
        document.addEventListener('seccion-admin', e => {
            const activa = e.detail && e.detail.id === 'robot-control';
            if (C.activa && !activa) { frenar(false); pantallaCompleta(false); }
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
