// Aviso de versión nueva del APK. Compara la versión instalada (APP_CONFIG.versionCode) con version.json
// del sitio y, si hay una mayor, muestra un banner con el enlace de descarga. En la web no hace nada.
(function (raiz) {
    const cfg = raiz.APP_CONFIG || {};
    const CLAVE = 'cecyte_aviso_version';

    function mostrar(info) {
        const banner = document.createElement('div');
        banner.className = 'update-banner';
        banner.setAttribute('role', 'status');
        const texto = document.createElement('span');
        texto.textContent = 'Hay una versión nueva de la app (' + info.version + ').' + (info.notas ? ' ' + info.notas : '');
        const enlace = document.createElement('a');
        enlace.href = info.url || cfg.descargaUrl || '#';
        enlace.target = '_blank';
        enlace.rel = 'noopener';
        enlace.textContent = 'Descargar';
        const cerrar = document.createElement('button');
        cerrar.type = 'button';
        cerrar.setAttribute('aria-label', 'Cerrar aviso');
        cerrar.textContent = '×';
        cerrar.addEventListener('click', () => {
            try { localStorage.setItem(CLAVE, String(info.versionCode)); } catch (e) { /* sin almacenamiento */ }
            banner.remove();
        });
        banner.append(texto, enlace, cerrar);
        document.body.prepend(banner);
    }

    async function buscar() {
        if (cfg.plataforma !== 'android' || !cfg.versionUrl) return;
        try {
            const r = await fetch(cfg.versionUrl, { cache: 'no-store' });
            if (!r.ok) return;
            const info = await r.json();
            let visto = 0;
            try { visto = Number(localStorage.getItem(CLAVE)) || 0; } catch (e) { /* sin almacenamiento */ }
            if (Number(info.versionCode) > Number(cfg.versionCode) && Number(info.versionCode) > visto) mostrar(info);
        } catch (e) { /* sin red: no pasa nada */ }
    }

    raiz.Actualizacion = { buscar };
})(window);
