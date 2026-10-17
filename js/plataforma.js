// Puente con Capacitor. En la web no hace nada (nativo = false); en el APK expone los plugins
// nativos y engancha el botón atrás, la barra de estado y la pantalla de arranque.
(function (raiz) {
    const cap = raiz.Capacitor;
    const nativo = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
    if (nativo) document.documentElement.classList.add('es-app');

    function plugin(nombre) {
        return nativo && cap.Plugins ? (cap.Plugins[nombre] || null) : null;
    }

    // Barras del sistema: iconos claros sobre fondo oscuro y viceversa (plugin SystemBars de Capacitor)
    function ajustarBarra() {
        const SB = plugin('SystemBars');
        if (!SB || !SB.setStyle || !raiz.Tema) return;
        const oscuro = raiz.Tema.efectivo() === 'oscuro';
        try { SB.setStyle({ style: oscuro ? 'DARK' : 'LIGHT' }); } catch (e) { /* sin soporte */ }
    }

    const ONDABLES = '.btn, .rb-fn, .rb-modelo, .rb-figura, .rb-jarvis__mic, [role="tab"], .icon-btn';

    function ondas() {
        document.addEventListener('pointerdown', e => {
            const b = e.target.closest(ONDABLES);
            if (!b || b.disabled) return;
            toque(8);
            const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2;
            const o = document.createElement('span');
            o.className = 'app-onda';
            o.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
            b.classList.add('app-ondable');
            b.appendChild(o);
            o.addEventListener('animationend', () => o.remove());
        }, { passive: true });
    }

    function toque(ms) {
        if (navigator.vibrate) navigator.vibrate(ms);
    }

    function moverEstadoRobot() {
        const fila = document.getElementById('rb-estado-fila'), bat = document.getElementById('rb-bat'), badge = document.getElementById('rb-badge');
        const panel = document.querySelector('.rb-conexion');
        if (!fila || !bat || !badge) return;
        fila.append(bat, badge);
        if (panel) panel.hidden = true;
        bat.setAttribute('role', 'button');
        bat.tabIndex = 0;
        bat.addEventListener('click', () => bat.classList.toggle('is-abierta'));
    }

    function navAutoOcultar() {
        let y0 = window.scrollY, espera = false;
        window.addEventListener('scroll', () => {
            if (espera) return;
            espera = true;
            requestAnimationFrame(() => {
                const y = window.scrollY, nav = document.querySelector('.sections');
                if (nav) {
                    if (y > y0 + 8 && y > 140) nav.classList.add('is-oculta');
                    else if (y < y0 - 8 || y < 80) nav.classList.remove('is-oculta');
                }
                y0 = y;
                espera = false;
            });
        }, { passive: true });
    }

    function iniciar() {
        // Lo que solo existe en una plataforma (data-solo="web" | "android")
        document.querySelectorAll('[data-solo]').forEach(el => { el.hidden = el.dataset.solo !== (nativo ? 'android' : 'web'); });
        if (!nativo) return;
        ondas();
        moverEstadoRobot();
        navAutoOcultar();
        raiz.addEventListener('tema-cambiado', ajustarBarra);
        ajustarBarra();
        const App = plugin('App');
        if (App && App.addListener) {
            // Atrás: cierra un modal abierto, vuelve a la vista del alumno o sale de la app
            App.addListener('backButton', () => {
                if (raiz.RobotControl && raiz.RobotControl.salirPantalla()) return;
                const dialogo = document.querySelector('dialog[open]');
                if (dialogo) { dialogo.close(); return; }
                const admin = document.getElementById('view-admin');
                if (admin && !admin.classList.contains('hidden') && typeof raiz.switchView === 'function') { raiz.switchView('student'); return; }
                App.exitApp();
            });
            App.addListener('resume', () => raiz.dispatchEvent(new CustomEvent('app-reanudada')));
        }
        const SP = plugin('SplashScreen');
        if (SP && SP.hide) setTimeout(() => SP.hide(), 150);
    }

    raiz.Plataforma = { nativo, plugin, iniciar };
})(window);
