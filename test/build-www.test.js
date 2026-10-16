// node test/build-www.test.js -> el paquete del APK (www/) sale con la configuración de Android, sin secretos y con
// (o sin) el robot según config/apk.json (incluirRobot).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const APK = JSON.parse(fs.readFileSync(path.join(raiz, 'config', 'apk.json'), 'utf8'));
const conRobot = APK.incluirRobot !== false;
execFileSync(process.execPath, [path.join(raiz, 'scripts', 'build-www.js')], { stdio: 'pipe' });
const www = rel => fs.readFileSync(path.join(raiz, 'www', rel), 'utf8');
const existe = rel => fs.existsSync(path.join(raiz, 'www', rel));

// lo que nunca debe viajar
['sw.js', 'manifest.webmanifest', 'DEPLOY.md', 'ROTAR_CLAVES.md'].forEach(f => assert(!existe(f), f + ' no va en el APK'));
['api', 'lib', 'test', 'timbre', 'robot', 'scripts'].forEach(d => assert(!existe(d), d + '/ no va en el APK (el .ino tampoco)'));

const html = www('index.html');
assert(html.includes('data-apartado="horario"') && html.includes('data-apartado-tab="timbre"'), 'Horario y Timbre siguen');
assert(html.includes('js/api.js') && html.includes('config/app.config.js'), 'scripts de la app');
assert(!html.includes('rel="manifest"'), 'sin manifiesto web');

const nav = www('admin-secciones.js');
assert(/horario:\s*\[/.test(nav) && /timbre:\s*\[/.test(nav));
if (conRobot) {
    ['robot.js', 'css/robot.css', 'js/robot-bluetooth.js', 'js/robot-control.js'].forEach(f => assert(existe(f), f + ' va en el APK'));
    assert(html.includes('id="sec-robot-control"') && html.includes('id="rb-joy"'), 'pestaña de control');
    assert(html.includes('js/robot-bluetooth.js') && html.includes('js/robot-control.js'), 'scripts del robot');
    assert(/robot:\s*\['robot-control'/.test(nav), 'el apartado Robot empieza por Control');
    assert(!html.includes('@web:line'), 'sin marcas internas de la web');
} else {
    ['robot.js', 'css/robot.css', 'js/robot-bluetooth.js', 'js/robot-control.js'].forEach(f => assert(!existe(f), f + ' no va en el APK'));
    assert(!/robot/i.test(html.replace(/Roboto/g, '')) && !html.includes('rb-'), 'index.html sin robot');
    assert(!/robot/i.test(nav), 'admin-secciones.js sin robot');
}

// configuración de plataforma
const cfg = www('config/app.config.js');
assert(/plataforma:\s*'web'/.test(cfg), 'valor base de la web');
assert(/"plataforma":\s*"android"/.test(cfg) && /"apiBase":\s*"https:\/\/cecyteo\.vercel\.app"/.test(cfg), 'sobrescrito para Android');

// ningún secreto
const todos = [];
(function recorrer(d) { fs.readdirSync(d, { withFileTypes: true }).forEach(e => (e.isDirectory() ? recorrer(path.join(d, e.name)) : todos.push(path.join(d, e.name)))); })(path.join(raiz, 'www'));
todos.filter(f => /\.(html|js|css|json)$/.test(f)).forEach(f => {
    const t = fs.readFileSync(f, 'utf8');
    ['VAPID_PRIVATE', 'CRON_SECRET', 'AUTH_SECRET', 'ADMIN_PASSWORD', 'BELL_DEVICE_KEY'].forEach(k => assert(!t.includes(k), path.basename(f) + ' no debe nombrar ' + k));
});

console.log('build-www.test.js: todo bien (' + todos.length + ' archivos, ' + (conRobot ? 'con' : 'sin') + ' robot)');
