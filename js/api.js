// Cliente de la API. Un solo punto para llegar al servidor:
//  - web: rutas relativas y cookie de sesión (mismo origen)
//  - APK: base absoluta (APP_CONFIG.apiBase), token Bearer guardado en el teléfono y sin cookies
(function (raiz) {
    const cfg = raiz.APP_CONFIG || {};
    const CLAVE = cfg.claveToken || 'cecyte_token';
    const nativo = cfg.plataforma === 'android';

    function leerToken() {
        if (!nativo) return null;
        try { return localStorage.getItem(CLAVE) || null; } catch (e) { return null; }
    }

    function guardarToken(t) {
        if (!nativo) return;   // en la web la sesión viaja en la cookie HttpOnly
        try {
            if (t) localStorage.setItem(CLAVE, t); else localStorage.removeItem(CLAVE);
        } catch (e) { /* sin almacenamiento */ }
    }

    function url(ruta) {
        return (cfg.apiBase || '') + ruta;
    }

    // Igual que fetch, pero con base, Authorization y credenciales según la plataforma
    function pedir(ruta, opciones) {
        const o = Object.assign({}, opciones);
        o.headers = Object.assign({}, o.headers);
        const token = leerToken();
        if (token) o.headers.Authorization = 'Bearer ' + token;
        if (nativo) o.credentials = 'omit';
        else if (!o.credentials) o.credentials = 'same-origin';
        return fetch(url(ruta), o);
    }

    raiz.API = { fetch: pedir, url, guardarToken, tieneToken: () => !!leerToken(), esNativo: nativo };
})(window);
