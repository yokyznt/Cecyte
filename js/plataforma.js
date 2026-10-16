// Puente con Capacitor. En la web no hace nada (nativo = false); en el APK expone los plugins
// nativos y engancha el botón atrás, la barra de estado y la pantalla de arranque.
(function (raiz) {
    const cap = raiz.Capacitor;
    const nativo = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());

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

    function iniciar() {
        // Lo que solo existe en una plataforma (data-solo="web" | "android")
        document.querySelectorAll('[data-solo]').forEach(el => { el.hidden = el.dataset.solo !== (nativo ? 'android' : 'web'); });
        if (!nativo) return;
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
