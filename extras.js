const PDF_MAPA = { '…': '\x85', '—': '\x97', '–': '\x96', '“': '\x93', '”': '\x94', '‘': '\x91', '’': '\x92' };

function pdfTexto(s) {
    return String(s == null ? '' : s)
        .replace(/[…—–“”‘’]/g, c => PDF_MAPA[c])
        .replace(/[^\x20-\xff]/g, '?')
        .replace(/[\\()]/g, '\\$&');
}

function recortar(s, max) {
    s = String(s == null ? '' : s);
    return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s;
}

function construirPDF({ titulo, subtitulo, columnas, filas, pie }) {
    const W = 842, H = 595, M = 30;
    const anchoHora = 92;
    const anchoDia = (W - 2 * M - anchoHora) / (columnas.length - 1);
    const top = H - 80, altoCab = 22;
    const altoFila = Math.min(48, (top - altoCab - M - 10) / Math.max(1, filas.length));
    const ops = [];
    const n = v => v.toFixed(1);
    const texto = (x, y, t, tam, negrita) => ops.push(`BT /${negrita ? 'F2' : 'F1'} ${tam} Tf ${n(x)} ${n(y)} Td (${pdfTexto(t)}) Tj ET`);
    const cabe = (t, ancho, tam) => recortar(t, Math.max(3, Math.floor((ancho - 8) / (tam * 0.52))));
    const xCol = i => (i === 0 ? M : M + anchoHora + (i - 1) * anchoDia);
    const anchoCol = i => (i === 0 ? anchoHora : anchoDia);

    texto(M, H - 45, titulo, 18, true);
    if (subtitulo) texto(M, H - 62, subtitulo, 10, false);
    ops.push(`0.89 0.95 0.91 rg ${M} ${n(top - altoCab)} ${W - 2 * M} ${altoCab} re f 0 0 0 rg`);
    columnas.forEach((c, i) => texto(xCol(i) + 4, top - 15, cabe(c, anchoCol(i), 10), 10, true));

    filas.forEach((f, r) => {
        const y = top - altoCab - (r + 1) * altoFila;
        if (f.gris) ops.push(`0.95 0.95 0.95 rg ${M} ${n(y)} ${W - 2 * M} ${n(altoFila)} re f 0 0 0 rg`);
        texto(M + 4, y + altoFila - 14, cabe(f.etiqueta, anchoHora, 8), 8, true);
        f.celdas.forEach((cel, i) => {
            if (!cel) return;
            const x = xCol(i + 1) + 4;
            if (cel[0]) texto(x, y + altoFila - 14, cabe(cel[0], anchoDia, 9), 9, true);
            if (cel[1] && altoFila >= 28) texto(x, y + altoFila - 26, cabe(cel[1], anchoDia, 8), 8, false);
        });
    });

    const bottom = top - altoCab - filas.length * altoFila;
    ops.push('0.6 0.6 0.6 RG 0.5 w');
    for (let r = 0; r <= filas.length + 1; r++) {
        const y = r === 0 ? top : top - altoCab - (r - 1) * altoFila;
        ops.push(`${M} ${n(y)} m ${W - M} ${n(y)} l S`);
    }
    for (let i = 0; i <= columnas.length; i++) {
        const x = i === columnas.length ? W - M : xCol(i);
        ops.push(`${n(x)} ${top} m ${n(x)} ${n(bottom)} l S`);
    }
    if (pie) texto(M, 16, pie, 7, false);

    const contenido = ops.join('\n');
    const objs = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
        `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`
    ];
    let pdf = '%PDF-1.4\n';
    const offs = [];
    objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return pdf;
}

function filasDeHorario(db, slots, dias, coincide, celda) {
    return slots.map(s => ({
        etiqueta: s.receso ? s.key + ' Receso' : s.key,
        gris: !!s.receso,
        celdas: dias.map(d => {
            if (s.receso) return null;
            const c = db.find(i => coincide(i) && i.day === d && i.time === s.key);
            return c ? celda(c) : null;
        })
    }));
}

function maestrosDe(db) {
    return [...new Set(db.map(i => String(i.teacher || '').trim()).filter(t => t && !/^[-–—.]+$/.test(t)))].sort((a, b) => a.localeCompare(b, 'es'));
}

function clasesDeMaestro(db, maestro, slots, dias) {
    const orden = s => slots.findIndex(x => x.key === s);
    return dias.map(d => ({
        dia: d,
        clases: db.filter(i => String(i.teacher || '').trim() === maestro && i.day === d).sort((a, b) => orden(a.time) - orden(b.time))
    }));
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { construirPDF, pdfTexto, recortar, filasDeHorario, maestrosDe, clasesDeMaestro };
}

const CLAVE_ANUNCIOS_VISTOS = 'cecyte_anuncios_vistos';
let anuncios = [];

function pdfBytes(pdf) {
    const b = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) b[i] = pdf.charCodeAt(i) & 255;
    return b;
}

function nombreArchivo(base) {
    return base.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') + '.pdf';
}

function fechaPie() {
    return 'CECyTE Plantel 18 · generado el ' + new Date().toLocaleString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function guardarPDF(nombre, pdf, titulo) {
    if (window.Plataforma && Plataforma.nativo) {
        const FS = Plataforma.plugin('Filesystem');
        const Share = Plataforma.plugin('Share');
        if (FS && Share) {
            try {
                const r = await FS.writeFile({ path: nombre, data: btoa(pdf), directory: 'CACHE' });
                await Share.share({ title: titulo, url: r.uri, dialogTitle: 'Guardar o imprimir el PDF' });
            } catch (err) {
                if (!/cancel/i.test(String(err && err.message))) showNotificationToast('No se pudo compartir', 'Intenta de nuevo.', 'info');
            }
            return;
        }
    }
    const url = URL.createObjectURL(new Blob([pdfBytes(pdf)], { type: 'application/pdf' }));
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showNotificationToast('PDF listo', 'Se descargó el horario. Ábrelo para verlo o imprimirlo.', 'success');
}

function pdfGrupo() {
    if (!currentStudentGroup) return showNotificationToast('Elige tu grupo', 'Primero elige un grupo.', 'info');
    if (!scheduleDatabase.some(i => i.group === currentStudentGroup)) return showNotificationToast('Sin materias', 'Este grupo todavía no tiene materias.', 'info');
    const filas = filasDeHorario(scheduleDatabase, timeSlots, daysOfWeek, i => i.group === currentStudentGroup, c => [c.subject, c.teacher]);
    const pdf = construirPDF({ titulo: 'Horario ' + currentStudentGroup, subtitulo: 'CECyTE Plantel 18', columnas: ['Hora', ...daysOfWeek], filas, pie: fechaPie() });
    guardarPDF(nombreArchivo('horario-' + currentStudentGroup), pdf, 'Horario ' + currentStudentGroup);
}

function pdfMaestro() {
    const maestro = document.getElementById('maestro-selector').value;
    if (!maestro) return showNotificationToast('Elige un maestro', 'Primero elige a quién quieres ver.', 'info');
    const filas = filasDeHorario(scheduleDatabase, timeSlots, daysOfWeek, i => String(i.teacher || '').trim() === maestro, c => [c.group, c.subject]);
    const pdf = construirPDF({ titulo: 'Horario de ' + maestro, subtitulo: 'CECyTE Plantel 18', columnas: ['Hora', ...daysOfWeek], filas, pie: fechaPie() });
    guardarPDF(nombreArchivo('horario-' + maestro), pdf, 'Horario de ' + maestro);
}

function rellenarMaestros() {
    const sel = document.getElementById('maestro-selector');
    if (!sel) return;
    const elegido = sel.value || localStorage.getItem('cecyte_maestro') || '';
    const lista = maestrosDe(scheduleDatabase);
    sel.innerHTML = '<option value="">Elige un maestro</option>' + lista.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
    if (lista.includes(elegido)) sel.value = elegido;
    renderMaestro();
}

function renderMaestro() {
    const sel = document.getElementById('maestro-selector');
    const caja = document.getElementById('maestro-lista');
    if (!sel || !caja) return;
    const maestro = sel.value;
    try { if (maestro) localStorage.setItem('cecyte_maestro', maestro); } catch (e) { }
    if (!maestro) { caja.innerHTML = '<p class="hint">Elige un maestro para ver en qué grupo y salón le toca cada hora.</p>'; return; }
    const dias = clasesDeMaestro(scheduleDatabase, maestro, timeSlots, daysOfWeek);
    const hoy = getCurrentDaySpanish();
    caja.innerHTML = dias.map(({ dia, clases }) => `<div class="maestro-dia${dia === hoy ? ' maestro-dia--hoy' : ''}">
        <h4 class="panel__sub">${esc(dia)}${dia === hoy ? ' · hoy' : ''}</h4>
        ${clases.length
            ? `<ul class="plain-list">${clases.map(c => `<li><b>${esc(c.time)}</b> · ${esc(c.group)} · ${esc(c.subject)}</li>`).join('')}</ul>`
            : '<p class="hint">Sin clases</p>'}
    </div>`).join('');
}

function anunciosVigentes(lista) {
    const hoy = hoyLocal();
    return (lista || []).filter(a => a && a.hasta >= hoy);
}

function fechaCorta(iso) {
    return new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function renderAnuncios() {
    const caja = document.getElementById('anuncios');
    const vigentes = anunciosVigentes(anuncios);
    if (caja) {
        caja.hidden = !vigentes.length;
        caja.innerHTML = vigentes.map(a => `<article class="anuncio">
            <strong class="anuncio__titulo">${icon('megaphone')} ${esc(a.titulo)}</strong>
            ${a.texto ? `<p class="anuncio__texto">${esc(a.texto)}</p>` : ''}
            <small class="anuncio__fecha">${a.desde === a.hasta ? 'Hoy' : 'Hasta el ' + esc(fechaCorta(a.hasta))}</small>
        </article>`).join('');
    }
    const admin = document.getElementById('anuncio-lista');
    if (admin) {
        admin.innerHTML = vigentes.length
            ? vigentes.map(a => `<span class="chip">${esc(a.titulo)} (hasta ${esc(fechaCorta(a.hasta))})
                <button type="button" class="chip__x" data-k="${esc(a.id)}" onclick="quitarAnuncio(this.dataset.k)" title="Quitar" aria-label="Quitar ${esc(a.titulo)}">${icon('x')}</button></span>`).join('')
            : '<p class="hint">No hay anuncios activos.</p>';
    }
}

function avisarAnunciosNuevos() {
    let vistos = null;
    try { vistos = JSON.parse(localStorage.getItem(CLAVE_ANUNCIOS_VISTOS)); } catch (e) { }
    const vigentes = anunciosVigentes(anuncios);
    const nuevos = vistos ? vigentes.filter(a => !vistos.includes(a.id)) : [];
    nuevos.forEach(a => {
        showNotificationToast(a.titulo, a.texto || 'Nuevo anuncio de la escuela', 'info');
        const LN = window.Plataforma && Plataforma.nativo && Plataforma.plugin('LocalNotifications');
        if (LN) LN.schedule({ notifications: [{ id: 300000 + Math.floor(Math.random() * 90000), title: a.titulo, body: a.texto || 'Nuevo anuncio de la escuela', schedule: { at: new Date(Date.now() + 1000) }, smallIcon: 'ic_stat_cecyte' }] }).catch(() => null);
    });
    try { localStorage.setItem(CLAVE_ANUNCIOS_VISTOS, JSON.stringify(vigentes.map(a => a.id))); } catch (e) { }
}

async function cargarAnuncios() {
    try {
        const res = await API.fetch('/api/changes?anuncios=1', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const lista = await res.json();
        if (!Array.isArray(lista)) return;
        cachear('anuncios', lista);
        anuncios = lista;
        avisarAnunciosNuevos();
    } catch (err) {
        const copia = leerCache('anuncios');
        if (copia && !anuncios.length) anuncios = copia.datos;
    }
    renderAnuncios();
}

function aMsg(texto, tipo = '') {
    const m = document.getElementById('anuncio-msg');
    if (!m) return;
    m.className = 'msg' + (tipo ? ' msg--' + tipo : '');
    m.innerText = texto;
}

async function mandarAnuncio(cuerpo) {
    const res = await API.fetch('/api/changes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    if (res.status === 401) { isAdminLoggedIn = false; showAdminLogin(); throw new Error('Inicia sesión de nuevo.'); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar.');
    anuncios = data.anuncios || [];
    cachear('anuncios', anuncios);
    try { localStorage.setItem(CLAVE_ANUNCIOS_VISTOS, JSON.stringify(anuncios.map(a => a.id))); } catch (e) { }
    renderAnuncios();
    return data;
}

async function publicarAnuncio() {
    const titulo = document.getElementById('anuncio-titulo').value.trim();
    const texto = document.getElementById('anuncio-texto').value.trim();
    const dias = Math.min(60, Math.max(1, parseInt(document.getElementById('anuncio-dias').value, 10) || 1));
    const avisar = document.getElementById('anuncio-avisar').checked;
    if (!titulo) { aMsg('Escribe un título.', 'err'); return; }
    aMsg('Publicando...');
    try {
        const data = await mandarAnuncio({ action: 'anuncio-add', titulo, texto, dias, avisar });
        document.getElementById('anuncio-titulo').value = '';
        document.getElementById('anuncio-texto').value = '';
        aMsg(avisar ? `Publicado. Notificación enviada a ${data.enviados || 0} dispositivos; en la app les aparece al abrirla.` : 'Publicado.', 'ok');
    } catch (err) {
        aMsg(err.name === 'AbortError' || err instanceof TypeError ? 'Sin conexión: los anuncios necesitan Internet.' : err.message, 'err');
    }
}

async function quitarAnuncio(id) {
    if (!confirm('¿Quitar este anuncio?')) return;
    try {
        await mandarAnuncio({ action: 'anuncio-remove', id });
        aMsg('Anuncio quitado.', 'ok');
    } catch (err) {
        aMsg(err.message, 'err');
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
        rellenarMaestros();
        cargarAnuncios();
        setInterval(cargarAnuncios, 60000);
        window.addEventListener('online', cargarAnuncios);
    });
    document.addEventListener('horario-actualizado', rellenarMaestros);
}
