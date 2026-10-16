// Widget de Android: que los bloques de Java y de app.js no se desfasen y que el manifest, los diseños y el puente JS estén completos.
// El cálculo en sí se prueba con JUnit: `cd android && gradlew testDebugUnitTest`.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(raiz, f), 'utf8');
const java = 'android/app/src/main/java/com/yokyznt/cecyte/';
const res = 'android/app/src/main/res/';

// 1) Los bloques horarios de Horario.java son los mismos que timeSlots de app.js
{
    const app = leer('app.js');
    const bloquesApp = [...app.matchAll(/key: '(\d\d:\d\d - \d\d:\d\d)'/g)].map(m => m[1]);
    const recesoApp = /key: '(\d\d:\d\d - \d\d:\d\d)',[^}]*receso: true/.exec(app)[1];
    const j = leer(java + 'Horario.java');
    const bloquesJava = [.../BLOQUES = \{([^}]*)\}/.exec(j)[1].matchAll(/"(\d\d:\d\d - \d\d:\d\d)"/g)].map(m => m[1]);
    const recesoJava = /RECESO = "(\d\d:\d\d - \d\d:\d\d)"/.exec(j)[1];
    assert(bloquesApp.length >= 5, 'se leyeron los bloques de app.js');
    assert.deepStrictEqual(bloquesJava, bloquesApp, 'Horario.BLOQUES = timeSlots de app.js');
    assert.strictEqual(recesoJava, recesoApp, 'el receso coincide');
    // los textos de «sigue» son los de textoAviso()
    for (const t of ['Receso', 'No hay más clases por hoy']) {
        assert(j.includes('"' + t + '"') && app.includes("'" + t + "'"), 'mismo texto: ' + t);
    }
}

// 2) Manifest, diseños, descriptores y colores (claro y oscuro) existen y se apuntan entre sí
{
    const m = leer('android/app/src/main/AndroidManifest.xml');
    for (const [clase, info] of [['HorarioWidget4x2', 'widget_4x2_info'], ['HorarioWidget2x1', 'widget_2x1_info']]) {
        assert(m.includes(`android:name=".${clase}"`) && m.includes(`@xml/${info}`), 'receiver ' + clase);
        assert(fs.existsSync(path.join(raiz, java, clase + '.java')), clase + '.java');
        assert(fs.existsSync(path.join(raiz, res, 'xml', info + '.xml')), info);
    }
    for (const l of ['widget_4x2', 'widget_2x1']) assert(fs.existsSync(path.join(raiz, res, 'layout', l + '.xml')), l);
    const claro = leer(res + 'values/widget_colores.xml'), oscuro = leer(res + 'values-night/widget_colores.xml');
    for (const c of ['widget_fondo', 'widget_texto', 'widget_tenue', 'widget_acento']) {
        assert(claro.includes(`name="${c}"`) && oscuro.includes(`name="${c}"`), 'color claro y oscuro: ' + c);
    }
    const strings = leer(res + 'values/strings.xml');
    for (const s of ['widget_ahora', 'widget_sigue', 'widget_desc_4x2', 'widget_desc_2x1']) assert(strings.includes(`name="${s}"`), s);
    // cada id que pinta HorarioWidget existe en el diseño que corresponde
    const w = leer(java + 'HorarioWidget.java');
    const grande = leer(res + 'layout/widget_4x2.xml'), chico = leer(res + 'layout/widget_2x1.xml');
    for (const id of ['w_raiz', 'w_grupo', 'w_ahora', 'w_ahora_det', 'w_sigue', 'w_sigue_det']) {
        assert(w.includes('R.id.' + id) && grande.includes('@+id/' + id), 'id ' + id);
    }
    for (const id of ['w_raiz', 'w_ahora', 'w_ahora_det']) assert(chico.includes('@+id/' + id), 'id chico ' + id);
    assert(/registerPlugin\(WidgetHorarioPlugin\.class\);\s*\/\/[^\n]*\n\s*super\.onCreate/.test(leer(java + 'MainActivity.java')), 'plugin registrado antes de super.onCreate');
    assert(leer('android/app/build.gradle').includes('androidx.work:work-runtime'), 'dependencia de WorkManager');
}

// 3) El puente JS llama al plugin con lo que el plugin espera, y solo cuando algo cambia
{
    const js = leer('js/avisos-nativos.js');
    assert(/plugin\('WidgetHorario'\)/.test(js) && /@CapacitorPlugin\(name = "WidgetHorario"\)/.test(leer(java + 'WidgetHorarioPlugin.java')));
    assert(/guardar\(\{ grupo, horario, apiBase/.test(js));
    for (const campo of ['grupo', 'horario', 'apiBase']) assert(leer(java + 'WidgetHorarioPlugin.java').includes(`getString("${campo}"`), 'el plugin lee ' + campo);
    assert(/horario-actualizado[^\n]*actualizarWidget/.test(js) && /grupo-cambiado[^\n]*actualizarWidget/.test(js), 'se actualiza con el horario y el grupo');
}

console.log('widget.test.js: todo bien');
