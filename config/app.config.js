// Configuración de la aplicación: marca, plataforma y API.
// La web usa estos valores tal cual. scripts/build-www.js genera para el APK una copia que sobrescribe
// plataforma, apiBase y versión (ver config/apk.json). Cambiar el diseño o la marca = editar este archivo y css/themes/.
window.APP_CONFIG = {
    marca: {
        nombre: 'CECyTE Plantel 18',
        subtitulo: 'Control de Horarios y Notificaciones',
        nombreCorto: 'CECyTE 18',
        logo: 'logo-cecyte.png',
        colorTema: { claro: '#ffffff', oscuro: '#10231a' },
    },
    plataforma: 'web',        // 'web' | 'android'
    apiBase: '',              // '' = mismo origen; en el APK: https://cecyteo.vercel.app
    temaDefecto: 'auto',      // 'auto' (sigue al sistema) | 'claro' | 'oscuro'
    claveTema: 'cecyte_tema',
    claveToken: 'cecyte_token',
    version: 'web',
    versionCode: 0,
    versionUrl: '',
    descargaUrl: '',
};
