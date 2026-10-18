#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const LIBS = path.join(RAIZ, 'android', 'app', 'libs');
const VOZ = path.join(RAIZ, 'android', 'app', 'src', 'main', 'assets', 'voz');
const CACHE = path.join(RAIZ, '.cache-voz');
const BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/';
const AAR = { archivo: 'sherpa-onnx-1.13.8.aar', url: BASE + 'v1.13.8/sherpa-onnx-1.13.8.aar', minimo: 45e6 };
const VOCES = [
    { id: 'ald', paquete: 'vits-piper-es_MX-ald-medium', modelo: 'es_MX-ald-medium.onnx', minimo: 50e6 },
];

function descargar(url, destino) {
    return new Promise((res, rej) => {
        https.get(url, { headers: { 'User-Agent': 'cecyte-build' } }, r => {
            if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
                r.resume();
                descargar(r.headers.location, destino).then(res, rej);
                return;
            }
            if (r.statusCode !== 200) { r.resume(); rej(new Error('HTTP ' + r.statusCode + ' al bajar ' + url)); return; }
            const f = fs.createWriteStream(destino + '.parte');
            r.pipe(f);
            f.on('finish', () => f.close(() => { fs.renameSync(destino + '.parte', destino); res(); }));
            f.on('error', rej);
        }).on('error', rej);
    });
}

const tamano = p => (fs.existsSync(p) ? fs.statSync(p).size : 0);

async function main() {
    fs.mkdirSync(LIBS, { recursive: true });
    fs.mkdirSync(CACHE, { recursive: true });
    const aar = path.join(LIBS, AAR.archivo);
    if (tamano(aar) < AAR.minimo) {
        console.log('Bajando la librería de voz local (' + AAR.archivo + ')…');
        await descargar(AAR.url, aar);
    }
    for (const v of VOCES) {
        const destino = path.join(VOZ, v.id);
        fs.rmSync(path.join(VOZ, 'claude'), { recursive: true, force: true });
        if (tamano(path.join(destino, 'model.onnx')) > v.minimo && fs.existsSync(path.join(VOZ, 'espeak-ng-data'))) continue;
        const tar = path.join(CACHE, v.paquete + '.tar.bz2');
        if (tamano(tar) < 1e6) {
            console.log('Bajando la voz ' + v.id + '…');
            await descargar(BASE + 'tts-models/' + v.paquete + '.tar.bz2', tar);
        }
        const ext = path.join(CACHE, 'ext');
        fs.mkdirSync(ext, { recursive: true });
        const r = spawnSync('tar', ['-xjf', path.basename(tar), '-C', 'ext'], { stdio: 'inherit', cwd: CACHE });
        if (r.status !== 0) throw new Error('No se pudo extraer ' + tar + ' (hace falta el comando tar con soporte bz2)');
        const origen = path.join(ext, v.paquete);
        fs.mkdirSync(destino, { recursive: true });
        fs.copyFileSync(path.join(origen, v.modelo), path.join(destino, 'model.onnx'));
        fs.copyFileSync(path.join(origen, 'tokens.txt'), path.join(destino, 'tokens.txt'));
        if (!fs.existsSync(path.join(VOZ, 'espeak-ng-data'))) fs.cpSync(path.join(origen, 'espeak-ng-data'), path.join(VOZ, 'espeak-ng-data'), { recursive: true });
        fs.rmSync(origen, { recursive: true, force: true });
    }
    console.log('Voz local lista: ' + VOCES.map(v => v.id).join(', '));
}

main().catch(e => {
    console.error('No se pudo preparar la voz local: ' + e.message);
    process.exit(1);
});
