// Tema visual: 'auto' (sigue al sistema), 'claro' u 'oscuro'.
// Se carga en el <head> para pintar el tema correcto desde el primer cuadro (sin parpadeo).
// El CSS solo mira html[data-tema="claro|oscuro"]; el modo elegido queda en html[data-tema-modo].
(function (raiz) {
    const cfg = raiz.APP_CONFIG || {};
    const CLAVE = cfg.claveTema || 'cecyte_tema';
    const MODOS = ['auto', 'claro', 'oscuro'];
    const ETIQUETAS = { auto: 'Automático', claro: 'Claro', oscuro: 'Oscuro' };
    const colores = (cfg.marca && cfg.marca.colorTema) || { claro: '#ffffff', oscuro: '#10231a' };
    const mq = raiz.matchMedia ? raiz.matchMedia('(prefers-color-scheme: dark)') : null;

    function guardado() {
        try {
            const v = localStorage.getItem(CLAVE);
            if (MODOS.includes(v)) return v;
        } catch (e) { /* sin almacenamiento */ }
        return MODOS.includes(cfg.temaDefecto) ? cfg.temaDefecto : 'auto';
    }

    function efectivo(modo) {
        if (modo === 'auto') return mq && mq.matches ? 'oscuro' : 'claro';
        return modo;
    }

    let modoActual = guardado();

    function aplicar(modo) {
        modoActual = MODOS.includes(modo) ? modo : 'auto';
        const tema = efectivo(modoActual);
        const html = document.documentElement;
        html.dataset.tema = tema;
        html.dataset.temaModo = modoActual;
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', colores[tema]);
        raiz.dispatchEvent(new CustomEvent('tema-cambiado', { detail: { modo: modoActual, tema } }));
        return tema;
    }

    function elegir(modo) {
        try { localStorage.setItem(CLAVE, modo); } catch (e) { /* sin almacenamiento */ }
        return aplicar(modo);
    }

    function ciclar() {
        return elegir(MODOS[(MODOS.indexOf(modoActual) + 1) % MODOS.length]);
    }

    raiz.Tema = {
        MODOS,
        etiqueta: (m) => ETIQUETAS[m || modoActual],
        modo: () => modoActual,
        efectivo: () => efectivo(modoActual),
        aplicar, elegir, ciclar,
    };

    aplicar(modoActual);
    if (mq && mq.addEventListener) {
        mq.addEventListener('change', () => { if (modoActual === 'auto') aplicar('auto'); });
    }
})(window);
