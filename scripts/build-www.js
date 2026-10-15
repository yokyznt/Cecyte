#!/usr/bin/env node
// Arma www/ (lo que empaqueta Capacitor en el APK) a partir de la web.
//  - copia una lista blanca: nada de api/, lib/, test/, DEPLOY.md ni secretos
//  - quita lo del robot (bloques @robot:start/@robot:end y líneas @robot:line) y lo exclusivo de la web (@web:line)
//  - escribe config/app.config.js con la plataforma, la base de la API y la versión
// Uso: node scripts/build-www.js   (lo llama `npm run www` y `npm run android:apk`)

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const DESTINO = path.join(RAIZ, 'www');
const APK = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'apk.json'), 'utf8'));

// Lo único que viaja al APK. Todo lo demás se queda fuera.
const ARCHIVOS = ['index.html', 'app.js', 'admin-secciones.js', 'calendario.js', 'timbre.js', 'timbre-estado.js', 'logo-cecyte.png'];
const CARPETAS = ['css', 'fonts', 'js'];

// Frases que mencionan al robot dentro de textos que sí viajan
const REEMPLAZOS = [
    ['Horario, timbre y robot en un solo lugar', 'Horario y timbre en un solo lugar'],
];

function quitarMarcas(texto) {
    return texto
        .replace(/[ \t]*<!--\s*@robot:start\s*-->[\s\S]*?<!--\s*@robot:end\s*-->[ \t]*\r?\n?/g, '')
        .replace(/[ \t]*\/\*\s*@robot:start\s*\*\/[\s\S]*?\/\*\s*@robot:end\s*\*\/[ \t]*\r?\n?/g, '')
        .split(/\r?\n/)
        .filter(l => !/@robot:line|@web:line/.test(l))
        .join('\n');
}

function copiarArchivo(origen, destino) {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    if (/\.(html|js|css)$/.test(origen)) {
        let t = quitarMarcas(fs.readFileSync(origen, 'utf8'));
        for (const [de, a] of REEMPLAZOS) t = t.split(de).join(a);
        fs.writeFileSync(destino, t);
    } else {
        fs.copyFileSync(origen, destino);
    }
}

function copiarCarpeta(rel) {
    const base = path.join(RAIZ, rel);
    if (!fs.existsSync(base)) return;
    for (const nombre of fs.readdirSync(base, { withFileTypes: true })) {
        const r = path.join(rel, nombre.name);
        if (nombre.isDirectory()) copiarCarpeta(r);
        else if (!/(^|[\\/])robot\.(css|js)$/.test(r)) copiarArchivo(path.join(RAIZ, r), path.join(DESTINO, r));
    }
}

function todos(dir, acc = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) todos(p, acc); else acc.push(p);
    }
    return acc;
}

// Se vacía el contenido (no la carpeta): en Windows un servidor o un editor abierto en www/ impide borrarla
fs.mkdirSync(DESTINO, { recursive: true });
for (const e of fs.readdirSync(DESTINO)) fs.rmSync(path.join(DESTINO, e), { recursive: true, force: true });
for (const a of ARCHIVOS) copiarArchivo(path.join(RAIZ, a), path.join(DESTINO, a));
for (const c of CARPETAS) copiarCarpeta(c);

// Configuración de plataforma: la web publica config/app.config.js con apiBase vacío; aquí se sobrescribe
const base = fs.readFileSync(path.join(RAIZ, 'config', 'app.config.js'), 'utf8');
const sobre = {
    plataforma: 'android',
    apiBase: APK.apiBase,
    version: APK.versionName,
    versionCode: APK.versionCode,
    versionUrl: APK.versionUrl,
    descargaUrl: APK.descargaUrl,
};
fs.mkdirSync(path.join(DESTINO, 'config'), { recursive: true });
fs.writeFileSync(path.join(DESTINO, 'config', 'app.config.js'),
    base + '\n// --- generado por scripts/build-www.js (APK) ---\nObject.assign(window.APP_CONFIG, ' + JSON.stringify(sobre, null, 4) + ');\n');

// Comprobaciones: nada del robot ni de secretos dentro del APK
const prohibidos = [/robot(?!o)/i, /web\s*serial/i, /navigator\.serial/, /\brb-[a-z]/, /VAPID_PRIVATE/, /CRON_SECRET/, /AUTH_SECRET/, /ADMIN_PASSWORD/];
const fallos = [];
for (const f of todos(DESTINO)) {
    if (!/\.(html|js|css|json|webmanifest)$/.test(f)) continue;
    const t = fs.readFileSync(f, 'utf8');
    for (const re of prohibidos) if (re.test(t)) fallos.push(path.relative(DESTINO, f) + ' contiene ' + re);
}
if (fallos.length) {
    console.error('www/ NO está limpio:\n - ' + fallos.join('\n - '));
    process.exit(1);
}
console.log('www/ listo (' + todos(DESTINO).length + ' archivos, v' + APK.versionName + ', sin robot)');
