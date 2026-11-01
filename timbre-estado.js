// ==================== Timbre: excepciones, estado del ESP32 y firmware (panel de admin) ====================
// Complementa a timbre.js (ritmo) y app.js (horas y días). Todo se guarda con saveBell() de app.js,
// salvo el firmware, que se sube aparte a /api/firmware.
// Depende de: bellConfig, esc(), icon(), showAdminLogin() (app.js) y $r(), rMsg(), setRitmo() (timbre.js).

const FW_MIN_BYTES = 100000;
const FW_MAX_BYTES = 1310720;   // partición OTA del ESP32 (esquema por defecto de 4 MB)
const FW_CHUNK_BYTES = 300000;

// "7:00, 10:30" -> ["07:00","10:30"], o null si alguna hora no es válida
function leerHoras(texto) {
    const partes = texto.split(/[\s,;]+/).filter(Boolean);
    const horas = partes.map(p => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(p);
        if (!m || +m[1] > 23 || +m[2] > 59) return null;
        return `${m[1].padStart(2, '0')}:${m[2]}`;
    });
    return horas.every(Boolean) ? [...new Set(horas)].sort() : null;
}

function fechaLinda(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function bMsg(texto, tipo = '') {
    const m = $r('bell-save-msg');
    if (!m) return;
    m.className = 'msg' + (tipo ? ` msg--${tipo}` : '');
    m.innerText = texto;
}

// ----- Días sin timbre -----

function addOffDate() {
    const v = $r('bell-off-date').value;
    if (!v) return;
    if (bellConfig.offDates.length >= 40) { bMsg('Máximo 40 días sin timbre.', 'err'); return; }
    if (!bellConfig.offDates.includes(v)) bellConfig.offDates = [...bellConfig.offDates, v].sort();
    $r('bell-off-date').value = '';
    renderBellExtras();
}

function removeOffDate(d) {
    bellConfig.offDates = bellConfig.offDates.filter(x => x !== d);
    renderBellExtras();
}

// ----- Horario especial (un día con otras horas) -----

function addSpecial() {
    const fecha = $r('bell-special-date').value;
    const horas = leerHoras($r('bell-special-times').value);
    if (!fecha) { bMsg('Elige la fecha del horario especial.', 'err'); return; }
    if (!horas) { bMsg('Escribe las horas así: 07:00, 10:30 (máximo 16).', 'err'); return; }
    if (horas.length > 16) { bMsg('Máximo 16 horas por día especial.', 'err'); return; }
    if (!bellConfig.specials[fecha] && Object.keys(bellConfig.specials).length >= 8) { bMsg('Máximo 8 días con horario especial.', 'err'); return; }
    bellConfig.specials = { ...bellConfig.specials, [fecha]: horas };
    $r('bell-special-date').value = '';
    $r('bell-special-times').value = '';
    renderBellExtras();
}

function removeSpecial(d) {
    const { [d]: _quitado, ...resto } = bellConfig.specials;
    bellConfig.specials = resto;
    renderBellExtras();
}

// ----- Ritmo propio para una hora (ej. el recreo) -----

function setOverride() {
    const hora = $r('rhythm-ovr-time').value;
    if (!hora) { rMsg('Primero agrega horas al timbre.', 'err'); return; }
    const r = bellConfig.rhythm;
    if (r.length > 39) { rMsg('Para una hora el ritmo puede tener hasta 20 toques.', 'err'); return; }
    if (!bellConfig.rhythms[hora] && Object.keys(bellConfig.rhythms).length >= 8) { rMsg('Máximo 8 horas con ritmo propio.', 'err'); return; }
    bellConfig.rhythms = { ...bellConfig.rhythms, [hora]: r.slice() };
    rMsg(`Las ${hora} van a sonar con el ritmo que ves arriba. Dale Guardar.`, 'ok');
    renderBellExtras();
}

function removeOverride(hora) {
    const { [hora]: _quitado, ...resto } = bellConfig.rhythms;
    bellConfig.rhythms = resto;
    renderBellExtras();
}

function cargarOverride(hora) {
    if (bellConfig.rhythms[hora]) setRitmo(bellConfig.rhythms[hora].slice(), `Cargué el ritmo de las ${hora} para editarlo. Para que se guarde ahí, pulsa "Usar para esa hora".`);
}

// ----- Dibujo -----

function chipList(items, quitar, texto) {
    return items.length
        ? items.map(it => `<span class="chip">${texto(it)}
            <button type="button" class="chip__x" data-k="${esc(it)}" onclick="${quitar}(this.dataset.k)" title="Quitar" aria-label="Quitar ${esc(it)}">${icon('x')}</button></span>`).join('')
        : '';
}

function renderBellExtras() {
    if (!$r('bell-off-list')) return;

    // si se quitó una hora del timbre, su ritmo propio ya no aplica
    bellConfig.rhythms = Object.fromEntries(Object.entries(bellConfig.rhythms || {}).filter(([t]) => bellConfig.times.includes(t)));

    $r('bell-off-list').innerHTML = chipList(bellConfig.offDates, 'removeOffDate', d => esc(fechaLinda(d)))
        || '<span class="chips__empty">No hay días sin timbre.</span>';

    const especiales = Object.keys(bellConfig.specials).sort();
    $r('bell-special-list').innerHTML = chipList(especiales, 'removeSpecial', d => `${esc(fechaLinda(d))}: ${esc(bellConfig.specials[d].join(', ') || 'sin timbre')}`)
        || '<span class="chips__empty">No hay horarios especiales.</span>';

    const sel = $r('rhythm-ovr-time');
    const previa = sel.value;
    sel.innerHTML = bellConfig.times.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    if (bellConfig.times.includes(previa)) sel.value = previa;

    const horas = Object.keys(bellConfig.rhythms).sort();
    $r('rhythm-ovr-list').innerHTML = chipList(horas, 'removeOverride', h => `<button type="button" class="chip__link" data-k="${esc(h)}" onclick="cargarOverride(this.dataset.k)" title="Cargar para editar">${esc(h)} · ${(bellConfig.rhythms[h].length + 1) / 2} toques</button>`)
        || '<span class="chips__empty">Todas las horas usan el ritmo normal.</span>';

    renderEstado();
}

function renderEstado() {
    renderWifi();
    renderLocal();
    const info = $r('esp-info');
    if (!info) return;
    const edad = bellConfig.lastSeen ? (bellConfig.serverNow - bellConfig.lastSeen) / 1000 : null;
    const items = [];
    if (edad === null) {
        items.push('El ESP32 no se ha conectado todavía.');
    } else {
        items.push(`Última señal: hace ${edad < 90 ? Math.round(edad) + ' s' : Math.round(edad / 60) + ' min'}`);
        items.push(`Firmware v${bellConfig.espFw || '?'}${bellConfig.fw ? ` (publicado: v${bellConfig.fw.version})` : ' (no hay uno publicado)'}`);
        const rssi = bellConfig.espRssi;
        if (rssi) items.push(`WiFi ${rssi > -60 ? 'buena' : rssi > -75 ? 'regular' : 'débil'} (${rssi} dBm)`);
        const diff = bellConfig.espClockDiffMs;
        if (diff !== null && diff !== undefined) items.push(Math.abs(diff) > 10000 ? `Reloj desfasado ${Math.round(diff / 1000)} s` : 'Reloj en hora');
    }
    info.innerHTML = items.map(t => `<li>${esc(t)}</li>`).join('');

    const log = bellConfig.log || [];
    $r('bell-log').innerHTML = log.length
        ? log.map(m => {
            const [ts, tipo] = m.split(':');
            const cuando = new Date(Number(ts) * 1000).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'medium' });
            return `<li><span class="num">${esc(cuando)}</span><span class="tag ${tipo === 'M' ? 'tag--manual' : ''}">${tipo === 'M' ? 'Manual' : 'Programado'}</span></li>`;
        }).join('')
        : '<li class="chips__empty">Todavía no hay toques registrados.</li>';
}

// ----- Subir firmware (OTA) -----

function aBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

async function postFirmware(cuerpo) {
    const res = await API.fetch('/api/firmware', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(cuerpo)
    });
    if (res.status === 401) { isAdminLoggedIn = false; showAdminLogin(); throw new Error('Tu sesión terminó. Entra de nuevo.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo subir el firmware.');
    return data;
}

async function publicarFirmware() {
    const msg = $r('fw-msg'), btn = $r('fw-btn');
    const file = $r('fw-file').files[0];
    const version = Number($r('fw-version').value);
    const decir = (t, tipo = '') => { msg.className = 'msg' + (tipo ? ` msg--${tipo}` : ''); msg.innerText = t; };

    if (!file) return decir('Elige el archivo timbre.ino.bin.', 'err');
    if (!Number.isInteger(version) || version < 1) return decir('Escribe el número de versión (el mismo FW_VERSION del código).', 'err');
    if (file.size < FW_MIN_BYTES || file.size > FW_MAX_BYTES) return decir(`El archivo mide ${file.size} bytes; debe estar entre ${FW_MIN_BYTES} y ${FW_MAX_BYTES}.`, 'err');

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] !== 0xe9) return decir('Ese archivo no es un firmware de ESP32. Usa el .ino.bin (no el bootloader, partitions ni merged).', 'err');

    btn.disabled = true;
    try {
        const uploadId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        const total = Math.ceil(bytes.length / FW_CHUNK_BYTES);
        for (let i = 0; i < total; i++) {
            decir(`Subiendo ${i + 1} de ${total}…`);
            await postFirmware({ action: 'chunk', uploadId, index: i, total, data: aBase64(bytes.subarray(i * FW_CHUNK_BYTES, (i + 1) * FW_CHUNK_BYTES)) });
        }
        decir('Publicando…');
        await postFirmware({ action: 'commit', uploadId, total, version });
        decir(`Publicado v${version}. El ESP32 lo descarga solo en cuanto pueda (con el timbre en silencio).`, 'ok');
        $r('fw-file').value = '';
        loadBell(true);
    } catch (err) {
        decir(err.message, 'err');
    } finally {
        btn.disabled = false;
    }
}

function wMsg(texto, tipo = '') {
    const m = $r('wifi-msg');
    if (!m) return;
    m.className = 'msg' + (tipo ? ' msg--' + tipo : '');
    m.innerText = texto;
}

function renderWifi() {
    const lista = $r('wifi-list');
    if (!lista) return;
    const redes = bellConfig.wifi || [];
    lista.innerHTML = chipList(redes.map(w => w.ssid), 'removeWifi', s => `${icon('wifi')} ${esc(s)}${redes.find(w => w.ssid === s)?.hasPass ? '' : ' (abierta)'}`)
        || '<p class="hint">Sin redes guardadas desde la página (usa las de secretos.h).</p>';
}

async function enviarWifi(networks, ok) {
    wMsg('Guardando...');
    try {
        const res = await API.fetch('/api/bell', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ action: 'wifi', networks })
        });
        if (res.status === 401) { isAdminLoggedIn = false; showAdminLogin(); return false; }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al guardar');
        bellConfig.wifi = data.wifi;
        renderWifi();
        wMsg(ok, 'ok');
        return true;
    } catch (err) {
        wMsg(err.message, 'err');
        return false;
    }
}

async function addWifi() {
    const ssid = $r('wifi-ssid').value.trim();
    const pass = $r('wifi-pass').value;
    if (!ssid) { wMsg('Escribe el nombre de la red.', 'err'); return; }
    if (pass && pass.length < 8) { wMsg('La contraseña WiFi debe tener al menos 8 caracteres.', 'err'); return; }
    const resto = (bellConfig.wifi || []).filter(w => w.ssid !== ssid).map(w => ({ ssid: w.ssid }));
    if (await enviarWifi([...resto, { ssid, pass }], `Red "${ssid}" guardada. El ESP32 la recibe en ~5 segundos.`)) {
        $r('wifi-ssid').value = '';
        $r('wifi-pass').value = '';
    }
}

function removeWifi(ssid) {
    if (!confirm(`¿Quitar la red "${ssid}" del timbre?`)) return;
    enviarWifi((bellConfig.wifi || []).filter(w => w.ssid !== ssid).map(w => ({ ssid: w.ssid })), `Red "${ssid}" quitada.`);
}

function ipTimbre() {
    const campo = $r('local-ip');
    const escrita = campo && campo.value.trim();
    if (escrita) { try { localStorage.setItem('cecyte_timbre_ip', escrita); } catch (e) { } return escrita; }
    try { return localStorage.getItem('cecyte_timbre_ip') || bellConfig.espIp || ''; } catch (e) { return bellConfig.espIp || ''; }
}

async function pedirAlTimbre(ruta, metodo = 'GET', cuerpo = '') {
    const ip = ipTimbre();
    if (!ip || !bellConfig.localKey) throw new Error('Falta la IP del timbre o abrir el panel una vez con Internet.');
    const url = `http://${ip}${ruta}`;
    const headers = { 'X-Key': bellConfig.localKey, 'Content-Type': 'text/plain' };
    const http = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.CapacitorHttp;
    if (http) {
        const r = await http.request({ url, method: metodo, headers, data: cuerpo || undefined, connectTimeout: 4000, readTimeout: 4000 });
        if (r.status === 401) throw new Error('El timbre no reconoce la llave (actualiza su firmware).');
        if (r.status !== 200) throw new Error('El timbre respondió ' + r.status);
        return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    }
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), 4000);
    try {
        const r = await fetch(url, { method: metodo, headers, body: cuerpo || undefined, signal: control.signal });
        if (!r.ok) throw new Error('El timbre respondió ' + r.status);
        return await r.json();
    } finally { clearTimeout(reloj); }
}

function textoParaTimbre(b) {
    const compacta = d => d.replace(/-/g, '');
    return [
        '',
        Math.max(1, Math.ceil((b.rhythm || []).reduce((a, x) => a + x, 0) / 1000)),
        (b.days || []).join(''),
        (b.times || []).join(','),
        (b.rhythm || []).join(','),
        Object.entries(b.rhythms || {}).map(([t, r]) => `${t}=${r.join(',')}`).join(';'),
        (b.offDates || []).map(compacta).join(','),
        Object.entries(b.specials || {}).map(([d, ts]) => `${compacta(d)}=${ts.join(',')}`).join(';'),
        ''
    ].join('\n');
}

function lMsg(texto, tipo = '') {
    const m = $r('local-msg');
    if (!m) return;
    m.className = 'msg' + (tipo ? ' msg--' + tipo : '');
    m.innerText = texto;
}

async function tocarDirecto() {
    try {
        await pedirAlTimbre('/tocar', 'POST');
        return true;
    } catch (e) {
        return false;
    }
}

async function localTocar() {
    lMsg('Enviando...');
    try { await pedirAlTimbre('/tocar', 'POST'); lMsg('Listo: el timbre está sonando.', 'ok'); }
    catch (e) { lMsg(errorLocal(e), 'err'); }
}

async function localMandar() {
    lMsg('Mandando horario y hora...');
    try {
        const t = Math.floor(Date.now() / 1000);
        await pedirAlTimbre('/config?t=' + t, 'POST', textoParaTimbre(bellConfig));
        lMsg('El timbre ya tiene este horario y la hora del teléfono. Cuando vuelva el Internet usará lo guardado en la página.', 'ok');
    } catch (e) { lMsg(errorLocal(e), 'err'); }
}

async function localEstado() {
    lMsg('Preguntando al timbre...');
    try {
        const e = await pedirAlTimbre('/estado');
        const hora = e.hora ? new Date(e.hora * 1000).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : 'sin hora';
        lMsg(`Conectado · firmware v${e.fw} · hora ${hora} · ${e.horas} horas programadas · señal ${e.rssi} dBm · Internet: ${e.internet ? 'sí' : 'no'}`, 'ok');
    } catch (e) { lMsg(errorLocal(e), 'err'); }
}

function errorLocal(e) {
    if (e && /Falta|llave|respondió/.test(e.message)) return e.message;
    return 'No encuentro el timbre. Revisa que el teléfono esté en el mismo WiFi que el timbre y la IP.';
}

function renderLocal() {
    const caja = $r('local-timbre');
    if (caja) {
        caja.hidden = !API.esNativo;
        if (caja.nextElementSibling && caja.nextElementSibling.tagName === 'HR') caja.nextElementSibling.hidden = !API.esNativo;
    }
    const campo = $r('local-ip');
    if (campo && !campo.value) {
        let ip = '';
        try { ip = localStorage.getItem('cecyte_timbre_ip') || ''; } catch (e) { }
        campo.value = ip || bellConfig.espIp || '';
    }
}
