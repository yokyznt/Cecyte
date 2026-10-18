#!/usr/bin/env node
// Compila el APK de release firmado con Gradle (JDK 21 de ~/.jdks) y lo copia a la carpeta de entrega.
// Antes hay que correr `npm run android:sync` (lo hace `npm run android:apk`).
// Llave: Desktop\CECyTE-APK\llaves\keystore.properties (fuera del repo). Si no existe, usa --debug.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const APK = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'apk.json'), 'utf8'));
const ENTREGA = path.join(os.homedir(), 'Desktop', 'CECyTE-APK');
const PROPS = path.join(ENTREGA, 'llaves', 'keystore.properties');
const debug = process.argv.includes('--debug');

// JDK 17 o 21 portátil (el JDK 25 de Android Studio rompe Gradle 8.14)
const env = Object.assign({}, process.env);
const jdks = path.join(os.homedir(), '.jdks');
if (fs.existsSync(jdks)) {
    const jdk = fs.readdirSync(jdks).filter(d => /^jdk-(17|21)\./.test(d)).sort().pop();
    if (jdk) env.JAVA_HOME = path.join(jdks, jdk);
}
env.ANDROID_HOME = env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
env.ANDROID_SDK_ROOT = env.ANDROID_HOME;

if (!debug) {
    if (!fs.existsSync(PROPS)) {
        console.error('Falta la llave de firma: ' + PROPS + '\nCrea la llave (ver instalar.md) o compila con --debug para pruebas.');
        process.exit(1);
    }
    env.CECYTE_KEYSTORE_PROPS = PROPS;
}

const voz = spawnSync(process.execPath, [path.join(__dirname, 'descargar-voz-local.js')], { stdio: 'inherit' });
if (voz.status !== 0) process.exit(voz.status || 1);

const gradle = path.join(RAIZ, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const tarea = debug ? 'assembleDebug' : 'assembleRelease';
const r = spawnSync(gradle, [tarea, '--console=plain', '-q'], { cwd: path.join(RAIZ, 'android'), env, stdio: 'inherit', shell: process.platform === 'win32' });
if (r.status !== 0) process.exit(r.status || 1);

const origen = path.join(RAIZ, 'android', 'app', 'build', 'outputs', 'apk', debug ? 'debug' : 'release',
    debug ? 'app-debug.apk' : 'app-release.apk');
if (!fs.existsSync(origen)) {
    console.error('No se encontró el APK generado en ' + origen);
    process.exit(1);
}
fs.mkdirSync(ENTREGA, { recursive: true });
const destino = path.join(ENTREGA, 'CECyTE-18-' + APK.versionName + (debug ? '-debug' : '') + '.apk');
fs.copyFileSync(origen, destino);
console.log('APK listo: ' + destino + ' (' + (fs.statSync(destino).size / 1048576).toFixed(1) + ' MB)');
