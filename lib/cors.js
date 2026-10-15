// CORS acotado para la app de Android (Capacitor sirve la interfaz desde https://localhost).
// Solo esos orígenes reciben cabeceras CORS; la web normal es del mismo origen y no las necesita.
// No se permiten credenciales: la app manda la sesión como "Authorization: Bearer".

const ORIGENES = new Set([
    'https://localhost',        // Capacitor en Android (androidScheme: https)
    'capacitor://localhost',    // Capacitor en iOS (por si algún día)
    'http://localhost',         // pruebas locales con la app
]);

export function origenPermitido(origen) {
    return typeof origen === 'string' && ORIGENES.has(origen);
}

// Devuelve true si la petición ya quedó respondida (preflight OPTIONS): el handler debe salir.
export function cors(req, res) {
    const origen = req.headers && req.headers.origin;
    res.setHeader('Vary', 'Origin');
    if (origen && origenPermitido(origen)) {
        res.setHeader('Access-Control-Allow-Origin', origen);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method !== 'OPTIONS') return false;
    if (origen && !origenPermitido(origen)) {
        res.status(403).json({ error: 'Origen no permitido' });
    } else {
        res.status(204).end();
    }
    return true;
}
