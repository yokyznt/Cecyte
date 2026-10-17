(function (raiz) {
    const $ = id => document.getElementById(id);
    const CLAVE = 'cecyte_robot_calibra';
    const CM_PX = 0.5, SALIDA = { x: 150, y: 188 };
    const MS_PASO = 50, MS_LATIDO = 250, HIST_MAX = 6;
    const FIGURAS = { circulo: 'un círculo', cuadrado: 'un cuadrado', triangulo: 'un triángulo', estrella: 'una estrella' };
    const E = { puntos: [], dibujando: false, guardia: null, radar: false, radarCancelado: false, escuchando: false, corrida: null, meneo: null };

    const enlace = () => raiz.RobotEnlace || null;
    const control = () => raiz.RobotControl || null;
    const listo = () => !!(enlace() && enlace().listo());
    const esperar = ms => new Promise(r => setTimeout(r, ms));

    function aviso(t) {
        ['rb-jarvis-msg', 'rb-dib-msg', 'rb-herr-msg'].forEach(id => { const el = $(id); if (el) el.textContent = t; });
    }

    function historial(quien, texto) {
        const ol = $('rb-jarvis-hist');
        if (!ol) return;
        const li = document.createElement('li');
        li.className = quien === 'yo' ? 'is-yo' : 'is-jarvis';
        li.textContent = texto;
        ol.appendChild(li);
        while (ol.children.length > HIST_MAX) ol.removeChild(ol.firstChild);
    }

    const CLAVE_VOZ = 'cecyte_yokis_voz';
    const PISTAS_HOMBRE = /esd|male|hombre|masculin|jorge|diego|carlos|pablo|juan|raul|enrique|miguel|antonio|-m\b/i;
    const E_VOZ = { lista: null };

    function ajustesVoz() {
        const a = { nombre: '', pitch: 0.75, rate: 1.15 };
        try { Object.assign(a, JSON.parse(localStorage.getItem(CLAVE_VOZ)) || {}); } catch (e) { /* sin guardado */ }
        a.pitch = Math.min(1.5, Math.max(0.5, Number(a.pitch) || 0.75));
        a.rate = Math.min(1.5, Math.max(0.8, Number(a.rate) || 1.15));
        return a;
    }

    function guardaVoz() {
        const a = { nombre: $('rb-voz-sel').value, pitch: Number($('rb-voz-grave').value), rate: Number($('rb-voz-rapido').value) };
        try { localStorage.setItem(CLAVE_VOZ, JSON.stringify(a)); } catch (e) { /* sin guardado */ }
    }

    async function vocesEspanol() {
        if (E_VOZ.lista) return E_VOZ.lista;
        const TTS = raiz.Plataforma && raiz.Plataforma.plugin('TextToSpeech');
        let todas = [];
        try {
            if (TTS && TTS.getSupportedVoices) todas = (await TTS.getSupportedVoices()).voices || [];
            else if (raiz.speechSynthesis) todas = raiz.speechSynthesis.getVoices().map(v => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI }));
        } catch (e) { todas = []; }
        E_VOZ.lista = todas.map((v, i) => ({ idx: i, nombre: v.name || v.voiceURI || ('voz ' + i), lang: v.lang || '' })).filter(v => /^es/i.test(v.lang));
        return E_VOZ.lista;
    }

    async function vozElegida() {
        const lista = await vocesEspanol();
        const a = ajustesVoz();
        const guardada = lista.find(v => v.nombre === a.nombre);
        if (guardada) return guardada;
        const mx = lista.filter(v => /^es[-_](MX|US|419)/i.test(v.lang));
        return mx.find(v => PISTAS_HOMBRE.test(v.nombre)) || lista.find(v => PISTAS_HOMBRE.test(v.nombre)) || mx[0] || lista[0] || null;
    }

    const CLAVE_ACTIVA = 'cecyte_voz_activa';
    const ENT = { activa: '', claves: new Set(), voces: [], audio: null, bd: null };
    const PRIORIDAD_ENT = ['saludo', 'estado', 'paro', 'mover', 'giro', 'baile', 'ruleta', 'cancion', 'luces', 'casa', 'radar', 'guardiaOn', 'alerta', 'gracias', 'elogio', 'adios', 'claxon', 'sinNombre', 'noEntendi', 'sinRobot'];
    const PASOS_ENT = 12, MS_NIVEL = 70, BARRAS = 48;
    const W = { i: 0, frases: [], blobs: [], ondas: [], durs: [], niveles: [], rec: null, flujo: null, ctx: null, timer: null, audio: null };

    function abrirBD() {
        if (ENT.bd) return ENT.bd;
        ENT.bd = new Promise((res, rej) => {
            const q = raiz.indexedDB.open('cecyte_voz_entrenada', 2);
            q.onupgradeneeded = () => {
                const db = q.result;
                if (!db.objectStoreNames.contains('f')) db.createObjectStore('f');
                if (!db.objectStoreNames.contains('v')) db.createObjectStore('v');
            };
            q.onsuccess = () => res(q.result);
            q.onerror = () => rej(q.error);
        });
        return ENT.bd;
    }

    async function bd(tienda, modo, fn) {
        const db = await abrirBD();
        return new Promise((res, rej) => {
            const t = db.transaction(tienda, modo), st = t.objectStore(tienda);
            const r = fn(st);
            t.oncomplete = () => res(r && r.result !== undefined ? r.result : undefined);
            t.onerror = () => rej(t.error);
        });
    }

    const bdGet = k => bd('f', 'readonly', st => st.get(k));
    const bdPut = (k, v) => bd('f', 'readwrite', st => st.put(v, k));
    const bdDel = k => bd('f', 'readwrite', st => st.delete(k));
    const bdClaves = () => bd('f', 'readonly', st => st.getAllKeys());
    const vzTodas = () => bd('v', 'readonly', st => st.getAll());
    const vzPut = (n, m) => bd('v', 'readwrite', st => st.put(m, n));
    const vzDel = n => bd('v', 'readwrite', st => st.delete(n));

    function frasesEntrenables() {
        const F = raiz.Robot.FRASES;
        const tipos = PRIORIDAD_ENT.filter(t => F[t]).concat(Object.keys(F).filter(t => !PRIORIDAD_ENT.includes(t)));
        return tipos.map(t => F[t].find(x => !x.includes('{'))).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i && x.length < 140);
    }

    async function reproducirGrabada(texto) {
        try {
            const blob = await bdGet(ENT.activa + '|' + texto);
            if (!blob) return false;
            if (ENT.audio) ENT.audio.pause();
            const a = new Audio(URL.createObjectURL(blob));
            ENT.audio = a;
            a.onended = () => URL.revokeObjectURL(a.src);
            await a.play();
            return true;
        } catch (e) {
            return false;
        }
    }

    function f0Medio(x, sr) {
        const d = Math.max(1, Math.round(sr / 12000)), fs = sr / d;
        const m = new Float32Array(Math.floor(x.length / d));
        for (let i = 0; i < m.length; i++) m[i] = x[i * d];
        const paso = Math.floor(fs * 0.04), minLag = Math.floor(fs / 400), maxLag = Math.floor(fs / 70), res = [];
        for (let i = 0; i + paso + maxLag < m.length; i += paso) {
            let e = 0;
            for (let j = 0; j < paso; j++) e += m[i + j] * m[i + j];
            if (e / paso < 1e-4) continue;
            let mejor = 0, lag = 0;
            for (let l = minLag; l <= maxLag; l++) {
                let c = 0;
                for (let j = 0; j < paso; j++) c += m[i + j] * m[i + j + l];
                if (c > mejor) { mejor = c; lag = l; }
            }
            if (lag && mejor / e > 0.5) res.push(fs / lag);
        }
        if (!res.length) return 0;
        res.sort((a, b) => a - b);
        return res[Math.floor(res.length / 2)];
    }

    async function estimarTono(blobs) {
        const Ctx = raiz.AudioContext || raiz.webkitAudioContext;
        if (!Ctx) return 0;
        const ctx = new Ctx(), tonos = [];
        try {
            for (const blob of blobs.filter(Boolean).slice(0, 6)) {
                try {
                    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
                    const f = f0Medio(buf.getChannelData(0), buf.sampleRate);
                    if (f) tonos.push(f);
                } catch (e) { /* esa grabación no se pudo analizar */ }
            }
        } finally {
            ctx.close();
        }
        if (!tonos.length) return 0;
        tonos.sort((a, b) => a - b);
        return tonos[Math.floor(tonos.length / 2)];
    }

    function mensajeEnt(t) {
        const el = $('rb-ent-msg');
        if (el) el.textContent = t || '';
    }

    function ajustarTono(f0) {
        const a = ajustesVoz();
        a.pitch = Math.min(1.5, Math.max(0.5, Math.round(f0 / 115 * 20) / 20));
        try { localStorage.setItem(CLAVE_VOZ, JSON.stringify(a)); } catch (e) { /* sin guardado */ }
        pintarVoces();
    }

    async function activarVoz(nombre) {
        ENT.activa = nombre || '';
        try { localStorage.setItem(CLAVE_ACTIVA, ENT.activa); } catch (e) { /* sin guardado */ }
        ENT.claves = new Set();
        if (ENT.activa) {
            try { (await bdClaves()).filter(k => k.startsWith(ENT.activa + '|')).forEach(k => ENT.claves.add(k.slice(ENT.activa.length + 1))); } catch (e) { /* sin base de datos */ }
            const m = ENT.voces.find(v => v.nombre === ENT.activa);
            if (m && m.f0) ajustarTono(m.f0);
        }
        pintarVocesEntrenadas();
    }

    function pintarVocesEntrenadas() {
        const ul = $('rb-vz-lista');
        if (!ul) return;
        const fila = (nombre, detalle, uso, borrable) => `<li class="rb-vz-item${uso ? ' is-activa' : ''}" data-n="${nombre}"><span><b>${nombre}</b><small>${detalle}</small></span>`
            + (uso ? '<small>En uso</small>' : '<button type="button" class="btn btn--secondary btn--sm" data-acc="usar">Usar</button>')
            + (borrable ? '<button type="button" class="btn btn--secondary btn--sm" data-acc="borrar" aria-label="Borrar esta voz">Borrar</button>' : '') + '</li>';
        ul.innerHTML = fila('Voz del teléfono', 'La voz sintética que ajustaste arriba', !ENT.activa, false)
            + ENT.voces.map(v => fila(v.nombre, `${v.n} frases${v.f0 ? ' · tono ' + Math.round(v.f0) + ' Hz' : ''}`, v.nombre === ENT.activa, true)).join('');
    }

    function resumir(niveles, n) {
        if (!niveles.length) return [];
        const sal = [];
        for (let i = 0; i < n; i++) {
            const a = Math.floor(i * niveles.length / n), b = Math.max(a + 1, Math.floor((i + 1) * niveles.length / n));
            sal.push(Math.max.apply(null, niveles.slice(a, b)));
        }
        return sal;
    }

    function dibujarOnda(barras, progreso, enVivo) {
        const cv = $('rb-ent-onda'), g = cv.getContext('2d');
        g.clearRect(0, 0, cv.width, cv.height);
        const ancho = cv.width / BARRAS, falta = BARRAS - barras.length;
        for (let i = 0; i < BARRAS; i++) {
            const v = enVivo ? (i >= falta ? barras[i - falta] : undefined) : barras[i];
            const h = v === undefined ? 3 : Math.max(3, v * (cv.height - 6));
            g.fillStyle = enVivo ? 'oklch(0.55 0.2 27)' : (progreso >= 0 && i / BARRAS <= progreso ? 'oklch(0.47 0.12 153)' : 'oklch(0.6 0.04 150)');
            g.beginPath();
            g.roundRect(i * ancho + 1, (cv.height - h) / 2, ancho - 3, h, 2);
            g.fill();
        }
    }

    const mmss = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

    function pintarPaso() {
        const n = W.frases.length, hecha = !!W.blobs[W.i];
        $('rb-ent-prog').max = n;
        $('rb-ent-prog').value = W.blobs.filter(Boolean).length;
        $('rb-ent-paso').textContent = `Frase ${W.i + 1} de ${n}`;
        $('rb-ent-frase').textContent = W.frases[W.i];
        $('rb-ent-frase').classList.remove('is-cambia');
        void $('rb-ent-frase').offsetWidth;
        $('rb-ent-frase').classList.add('is-cambia');
        $('rb-ent-grabar').textContent = hecha ? 'Volver a grabar' : 'Grabar';
        $('rb-ent-grabar').classList.remove('is-grabando');
        $('rb-ent-sig').textContent = W.i === n - 1 ? 'Terminar' : 'Siguiente';
        $('rb-ent-sig').disabled = !hecha;
        $('rb-ent-play').disabled = !hecha;
        $('rb-ent-tiempo').textContent = hecha ? mmss(W.durs[W.i]) : '0:00';
        dibujarOnda(hecha ? W.ondas[W.i] : [], -1, false);
    }

    function abrirEntrenamiento() {
        const d = $('rb-ent-ventana');
        if (d.open) return;
        W.i = 0;
        W.frases = frasesEntrenables().slice(0, PASOS_ENT);
        W.blobs = [];
        W.ondas = [];
        W.durs = [];
        $('rb-ent-pasos').hidden = false;
        $('rb-ent-final').hidden = true;
        $('rb-ent-aviso').textContent = '';
        $('rb-ent-nombre').value = '';
        $('rb-ent-guardar').disabled = true;
        pintarPaso();
        d.showModal();
    }

    function limpiarGrabacion() {
        clearInterval(W.timer);
        if (W.rec && W.rec.state === 'recording') { W.rec.onstop = null; W.rec.stop(); }
        if (W.flujo) W.flujo.getTracks().forEach(t => t.stop());
        if (W.ctx) { try { W.ctx.close(); } catch (e) { /* ya cerrado */ } }
        if (W.audio) W.audio.pause();
        W.rec = null;
        W.flujo = null;
        W.ctx = null;
    }

    async function grabarPaso() {
        if (W.rec) { W.rec.stop(); return; }
        if (!raiz.navigator.mediaDevices || !raiz.MediaRecorder) { $('rb-ent-aviso').textContent = 'Este celular no deja grabar audio aquí.'; return; }
        let flujo;
        try {
            flujo = await raiz.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        } catch (e) {
            $('rb-ent-aviso').textContent = 'No pude usar el micrófono. Dale permiso a la app en los ajustes del teléfono.';
            return;
        }
        if (W.audio) W.audio.pause();
        const trozos = [], i = W.i;
        const Ctx = raiz.AudioContext || raiz.webkitAudioContext;
        const rec = raiz.MediaRecorder.isTypeSupported && raiz.MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? new raiz.MediaRecorder(flujo, { mimeType: 'audio/webm;codecs=opus' }) : new raiz.MediaRecorder(flujo);
        W.rec = rec;
        W.flujo = flujo;
        W.niveles = [];
        let analizador = null, buf = null;
        if (Ctx) {
            W.ctx = new Ctx();
            analizador = W.ctx.createAnalyser();
            analizador.fftSize = 512;
            W.ctx.createMediaStreamSource(flujo).connect(analizador);
            buf = new Uint8Array(analizador.fftSize);
        }
        $('rb-ent-grabar').textContent = 'Parar';
        $('rb-ent-grabar').classList.add('is-grabando');
        $('rb-ent-sig').disabled = true;
        $('rb-ent-play').disabled = true;
        $('rb-ent-aviso').textContent = 'Grabando… que lea la frase y pulsa Parar.';
        const t0 = Date.now();
        W.timer = setInterval(() => {
            let nivel = 0.15;
            if (analizador) {
                analizador.getByteTimeDomainData(buf);
                let s = 0;
                for (let j = 0; j < buf.length; j++) { const v = (buf[j] - 128) / 128; s += v * v; }
                nivel = Math.min(1, Math.sqrt(s / buf.length) * 4);
            }
            W.niveles.push(nivel);
            $('rb-ent-tiempo').textContent = mmss(Date.now() - t0);
            dibujarOnda(W.niveles.slice(-BARRAS), 0, true);
        }, MS_NIVEL);
        const tope = setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, 15000);
        rec.ondataavailable = e => { if (e.data && e.data.size) trozos.push(e.data); };
        rec.onstop = () => {
            clearTimeout(tope);
            const dur = Date.now() - t0;
            limpiarGrabacion();
            const blob = new Blob(trozos, { type: rec.mimeType || 'audio/webm' });
            if (blob.size < 2000 || W.niveles.length < 6) { $('rb-ent-aviso').textContent = 'No se oyó nada: intenta otra vez más cerca del micrófono.'; pintarPaso(); return; }
            W.blobs[i] = blob;
            W.ondas[i] = resumir(W.niveles, BARRAS);
            W.durs[i] = dur;
            $('rb-ent-aviso').textContent = 'Escúchala; si te gusta, pulsa Siguiente.';
            pintarPaso();
        };
        rec.start();
    }

    function reproducirPaso() {
        const i = W.i, blob = W.blobs[i];
        if (!blob) return;
        if (W.audio && !W.audio.paused) { W.audio.pause(); return; }
        const a = new Audio(URL.createObjectURL(blob));
        W.audio = a;
        a.ontimeupdate = () => {
            const dur = W.durs[i] / 1000 || a.duration || 1;
            dibujarOnda(W.ondas[i], Math.min(1, a.currentTime / dur), false);
            $('rb-ent-tiempo').textContent = mmss(a.currentTime * 1000);
        };
        a.onended = () => { URL.revokeObjectURL(a.src); dibujarOnda(W.ondas[i], -1, false); $('rb-ent-tiempo').textContent = mmss(W.durs[i]); };
        a.play().catch(() => { $('rb-ent-aviso').textContent = 'No pude reproducir la grabación.'; });
    }

    function siguientePaso() {
        if (W.audio) W.audio.pause();
        if (W.i < W.frases.length - 1) { W.i++; $('rb-ent-aviso').textContent = ''; pintarPaso(); return; }
        $('rb-ent-pasos').hidden = true;
        $('rb-ent-final').hidden = false;
        $('rb-ent-nombre').focus();
    }

    async function guardarVoz() {
        const nombre = $('rb-ent-nombre').value.trim().replace(/\|/g, ' ').slice(0, 30);
        if (!nombre) return;
        $('rb-ent-guardar').disabled = true;
        try {
            for (const k of (await bdClaves()).filter(k => k.startsWith(nombre + '|'))) await bdDel(k);
            for (let i = 0; i < W.frases.length; i++) if (W.blobs[i]) await bdPut(nombre + '|' + W.frases[i], W.blobs[i]);
            const f0 = await estimarTono(W.blobs);
            await vzPut(nombre, { nombre, f0, n: W.blobs.filter(Boolean).length, fecha: Date.now() });
            ENT.voces = (await vzTodas()) || [];
            await activarVoz(nombre);
            $('rb-ent-ventana').close();
            mensajeEnt(`Voz «${nombre}» guardada y en uso.${f0 ? ' Tono medido: ' + Math.round(f0) + ' Hz.' : ''}`);
        } catch (e) {
            $('rb-ent-guardar').disabled = false;
            $('rb-ent-aviso').textContent = 'No pude guardar la voz en este teléfono.';
        }
    }

    async function iniciarEntrena() {
        if (!$('rb-vz-lista') || !raiz.indexedDB) return;
        $('rb-ent-abrir').addEventListener('click', abrirEntrenamiento);
        $('rb-ent-cerrar').addEventListener('click', () => (raiz.RobotUI ? raiz.RobotUI.cerrarSuave($('rb-ent-ventana')) : $('rb-ent-ventana').close()));
        $('rb-ent-ventana').addEventListener('close', limpiarGrabacion);
        $('rb-ent-grabar').addEventListener('click', grabarPaso);
        $('rb-ent-play').addEventListener('click', reproducirPaso);
        $('rb-ent-sig').addEventListener('click', siguientePaso);
        $('rb-ent-atras').addEventListener('click', () => { $('rb-ent-final').hidden = true; $('rb-ent-pasos').hidden = false; pintarPaso(); });
        $('rb-ent-nombre').addEventListener('input', () => { $('rb-ent-guardar').disabled = !$('rb-ent-nombre').value.trim(); });
        $('rb-ent-guardar').addEventListener('click', guardarVoz);
        $('rb-vz-lista').addEventListener('click', async e => {
            const b = e.target.closest('[data-acc]');
            if (!b) return;
            const nombre = b.closest('.rb-vz-item').dataset.n;
            if (b.dataset.acc === 'usar') { await activarVoz(nombre === 'Voz del teléfono' ? '' : nombre); return; }
            if (!b.dataset.seguro) { b.dataset.seguro = '1'; b.textContent = '¿Borrar?'; setTimeout(pintarVocesEntrenadas, 3000); return; }
            for (const k of (await bdClaves()).filter(k => k.startsWith(nombre + '|'))) await bdDel(k);
            await vzDel(nombre);
            ENT.voces = (await vzTodas()) || [];
            if (ENT.activa === nombre) await activarVoz('');
            else pintarVocesEntrenadas();
            mensajeEnt(`Voz «${nombre}» borrada.`);
        });
        try {
            const viejas = (await bdClaves()).filter(k => !k.includes('|'));
            if (viejas.length) {
                for (const k of viejas) { await bdPut('Voz anterior|' + k, await bdGet(k)); await bdDel(k); }
                await vzPut('Voz anterior', { nombre: 'Voz anterior', f0: 0, n: viejas.length, fecha: Date.now() });
            }
            ENT.voces = (await vzTodas()) || [];
            let guardada = '';
            try { guardada = localStorage.getItem(CLAVE_ACTIVA) || ''; } catch (e) { guardada = ''; }
            await activarVoz(ENT.voces.some(v => v.nombre === guardada) ? guardada : '');
        } catch (e) {
            pintarVocesEntrenadas();
        }
    }

    async function voz(texto) {
        if (ENT.activa && ENT.claves.has(texto) && await reproducirGrabada(texto)) return;
        const TTS = raiz.Plataforma && raiz.Plataforma.plugin('TextToSpeech');
        const a = ajustesVoz();
        try {
            const v = await vozElegida();
            if (TTS) {
                try { await TTS.stop(); } catch (e) { /* nada que parar */ }
                const op = { text: texto, lang: v ? v.lang.replace('_', '-') : 'es-MX', rate: a.rate, pitch: a.pitch, volume: 1, category: 'ambient' };
                if (v) op.voice = v.idx;
                await TTS.speak(op);
            } else if (raiz.speechSynthesis) {
                const u = new SpeechSynthesisUtterance(texto);
                u.lang = v ? v.lang : 'es-MX';
                u.rate = a.rate;
                u.pitch = a.pitch;
                const real = raiz.speechSynthesis.getVoices().find(x => v && x.name === v.nombre);
                if (real) u.voice = real;
                raiz.speechSynthesis.cancel();
                raiz.speechSynthesis.speak(u);
            }
        } catch (e) { /* sin voz: queda el texto */ }
    }

    async function pintarVoces() {
        const sel = $('rb-voz-sel');
        if (!sel) return;
        const lista = await vocesEspanol();
        const elegida = await vozElegida();
        sel.innerHTML = lista.length ? lista.map(v => `<option value="${v.nombre}">${v.nombre} (${v.lang})</option>`).join('') : '<option value="">Voz del sistema</option>';
        if (elegida) sel.value = elegida.nombre;
        const a = ajustesVoz();
        $('rb-voz-grave').value = a.pitch;
        $('rb-voz-rapido').value = a.rate;
    }

    const CLAVE_MENEO = 'cecyte_yokis_meneo';
    const meneoActivo = () => { try { return localStorage.getItem(CLAVE_MENEO) !== '0'; } catch (e) { return true; } };

    function detenerMeneo() {
        const G = E.meneo;
        if (!G) return;
        clearInterval(G.timer);
        E.meneo = null;
        if (listo()) enlace().mover(0, 0);
    }

    // Mientras contesta, el robot hace un meneo corto en su sitio (un giro a cada lado, sin avanzar): como si hablara.
    // La duración se calcula por el largo del texto; con la voz nativa, que avisa cuándo termina, se corta ahí.
    function meneoHablar(texto, fin) {
        if (!meneoActivo() || E.corrida || E.radar || E.guardia || !listo() || !enlace().libre()) return;
        detenerMeneo();
        const t0 = Date.now(), G = { hasta: t0 + Math.min(9000, Math.max(700, texto.length * 62)), ult: '' };
        fin.then(() => { if (E.meneo === G && Date.now() - t0 > 700) G.hasta = Date.now(); });
        G.timer = setInterval(() => {
            const t = Date.now();
            if (t >= G.hasta || !listo() || E.corrida) { detenerMeneo(); return; }
            const f = (t - t0) % 520;
            const v = f < 110 ? [130, -130] : f >= 260 && f < 370 ? [-130, 130] : [0, 0];
            const clave = v.join(',');
            if (clave !== G.ult) { enlace().mover(v[0], v[1]); G.ult = clave; }
        }, 40);
        E.meneo = G;
    }

    function iniciarMeneo() {
        const c = $('rb-habla-mueve');
        if (!c) return;
        c.checked = meneoActivo();
        c.addEventListener('change', () => {
            try { localStorage.setItem(CLAVE_MENEO, c.checked ? '1' : '0'); } catch (e) { /* sin guardado */ }
            if (!c.checked) detenerMeneo();
        });
    }

    function hablar(texto, quieto) {
        aviso(texto);
        historial('yokis', texto);
        const fin = voz(texto);
        if (!quieto) meneoHablar(texto, fin);
    }

    const di = (tipo, datos) => {
        let t = null;
        if (ENT.activa && !datos) {
            const grabadas = (raiz.Robot.FRASES[tipo] || []).filter(x => ENT.claves.has(x));
            if (grabadas.length) t = grabadas[Math.floor(Math.random() * grabadas.length)];
        }
        hablar(t || raiz.Robot.frase(tipo, datos), tipo === 'paro');
    };

    function calibra() {
        const g = { vel: raiz.Robot.RUTA_CM_S, giro: 500 };
        try { Object.assign(g, JSON.parse(localStorage.getItem(CLAVE)) || {}); } catch (e) { /* sin guardado */ }
        return g;
    }

    function leerCalibra() {
        const c = calibra();
        const v = Number($('rb-cal-vel').value), gi = Number($('rb-cal-giro').value);
        return { vel: v >= 5 && v <= 80 ? v : c.vel, giro: gi >= 150 && gi <= 2000 ? gi : c.giro };
    }

    function guardaCalibra() {
        try { localStorage.setItem(CLAVE, JSON.stringify(leerCalibra())); } catch (e) { /* sin guardado */ }
    }

    function pasoCorrida() {
        const R = E.corrida;
        if (!R) return;
        if (!listo()) { detener(false); return; }
        const ahora = Date.now(), t = ahora - R.t0;
        if (t >= R.r.ms) { detener(true); return; }
        const p = raiz.Robot.pasoEn(R.r, t);
        if (!p) return;
        const clave = p.izq + ',' + p.der;
        if (clave !== R.ult || ahora - R.envio >= MS_LATIDO) {
            enlace().mover(p.izq, p.der);
            R.ult = clave;
            R.envio = ahora;
        }
    }

    function detener(alto) {
        const R = E.corrida;
        if (!R) return;
        clearInterval(R.timer);
        E.corrida = null;
        if (control() && control().pantalla) control().pantalla(false, 'ruta');
        if (alto && listo()) enlace().mover(0, 0);
    }

    function correr(recorrido, habla, datos, texto) {
        if (!listo()) { di('sinRobot'); return false; }
        if (!recorrido) { di('fallo'); return false; }
        if (E.corrida) { di('ocupado'); return false; }
        detenerMeneo();
        E.corrida = { r: recorrido, t0: Date.now(), ult: '', envio: 0, timer: setInterval(pasoCorrida, MS_PASO) };
        if (control() && control().pantalla) control().pantalla(true, 'ruta');
        pasoCorrida();
        if (habla) di(habla, datos);
        else if (texto) aviso(texto);
        return true;
    }

    async function esperarFin() {
        while (E.corrida) await esperar(60);
    }

    function figura(nombre) {
        const c = calibra();
        return raiz.Robot.rutaARecorrido(raiz.Robot.figura(nombre, 60), c.vel, c.giro, nombre);
    }

    function pintarLienzo() {
        const cv = $('rb-lienzo'), g = cv.getContext('2d');
        g.clearRect(0, 0, cv.width, cv.height);
        g.fillStyle = 'oklch(0.22 0.02 160)';
        g.fillRect(0, 0, cv.width, cv.height);
        g.fillStyle = 'oklch(0.78 0.17 150)';
        g.beginPath();
        g.arc(SALIDA.x, SALIDA.y, 7, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'oklch(0.85 0.15 70)';
        g.lineWidth = 4;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.beginPath();
        g.moveTo(SALIDA.x, SALIDA.y);
        E.puntos.forEach(p => g.lineTo(p.px, p.py));
        g.stroke();
    }

    function iniciarLienzo() {
        const cv = $('rb-lienzo');
        const punto = e => {
            const r = cv.getBoundingClientRect();
            return { px: (e.clientX - r.left) * cv.width / r.width, py: (e.clientY - r.top) * cv.height / r.height };
        };
        cv.addEventListener('pointerdown', e => {
            e.preventDefault();
            E.dibujando = true;
            E.puntos = [];
            try { cv.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
            pintarLienzo();
        });
        cv.addEventListener('pointermove', e => {
            if (!E.dibujando) return;
            const p = punto(e), u = E.puntos[E.puntos.length - 1] || { px: SALIDA.x, py: SALIDA.y };
            if (Math.hypot(p.px - u.px, p.py - u.py) < 12 || E.puntos.length >= 80) return;
            E.puntos.push(p);
            pintarLienzo();
        });
        const soltar = () => { E.dibujando = false; };
        cv.addEventListener('pointerup', soltar);
        cv.addEventListener('pointercancel', soltar);
        $('rb-lienzo-borrar').addEventListener('click', () => { E.puntos = []; pintarLienzo(); });
        $('rb-lienzo-ir').addEventListener('click', () => {
            if (!E.puntos.length) { aviso('Dibuja primero el camino con el dedo.'); return; }
            guardaCalibra();
            const c = calibra();
            const pts = [{ x: 0, y: 0 }].concat(E.puntos.map(p => ({ x: (p.px - SALIDA.x) * CM_PX, y: (SALIDA.y - p.py) * CM_PX })));
            correr(raiz.Robot.rutaARecorrido(pts, c.vel, c.giro, 'Dibujo'), null, null, 'En camino.');
        });
        pintarLienzo();
    }

    function regresarCasa() {
        if (!listo()) { di('sinRobot'); return; }
        const t = control() ? control().trayecto() : { pasos: [], ms: 0 };
        const r = raiz.Robot.inversoDeRecorrido(t.pasos, t.ms, 'Casa');
        if (!r) { hablar('No tengo nada que deshacer, we. Maneja un poco con el mando primero.'); return; }
        if (correr(r, 'casa')) control().marcarCasa();
    }

    function pintarRadar(lecturas) {
        const cv = $('rb-radar-lienzo'), g = cv.getContext('2d'), cx = cv.width / 2, cy = cv.height / 2, R = cv.width / 2 - 14;
        cv.hidden = false;
        g.clearRect(0, 0, cv.width, cv.height);
        g.fillStyle = 'oklch(0.22 0.02 160)';
        g.fillRect(0, 0, cv.width, cv.height);
        g.strokeStyle = 'oklch(0.45 0.03 160)';
        g.lineWidth = 1;
        [0.33, 0.66, 1].forEach(k => { g.beginPath(); g.arc(cx, cy, R * k, 0, Math.PI * 2); g.stroke(); });
        g.fillStyle = 'oklch(0.78 0.17 150)';
        g.beginPath();
        g.arc(cx, cy, 5, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'oklch(0.85 0.15 70)';
        g.lineWidth = 3;
        g.beginPath();
        lecturas.forEach((d, i) => {
            const a = (i * 30) * Math.PI / 180, r = Math.min(d, 200) / 200 * R;
            const x = cx + r * Math.sin(a), y = cy - r * Math.cos(a);
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        });
        g.closePath();
        g.stroke();
        g.fillStyle = 'oklch(0.95 0.02 160)';
        g.font = '12px sans-serif';
        g.fillText('200 cm', cx + 4, cy - R + 12);
    }

    function pintarRadarBtn() {
        $('rb-radar').textContent = E.radar ? 'Cancelar' : 'Escanear';
    }

    async function radar(callado) {
        if (E.radar) { E.radarCancelado = true; return; }
        if (!listo() || !enlace().soportaDistancia()) { hablar('El radar necesita el robot conectado con el firmware nuevo, we.'); return; }
        E.radar = true;
        E.radarCancelado = false;
        pintarRadarBtn();
        if (callado) aviso('Escaneando…'); else di('radar');
        const c = calibra(), lecturas = [];
        for (let i = 0; i < 12 && !E.radarCancelado && listo(); i++) {
            await esperar(350);
            enlace().pedirDistancia();
            await esperar(450);
            const d = enlace().distancias().lecturas;
            const cm = d.length ? d[d.length - 1] : 400;
            lecturas.push(cm > 0 ? cm : 400);
            pintarRadar(lecturas);
            if (i < 11 && !E.radarCancelado) {
                if (!correr(raiz.Robot.giroARecorrido(30, c.giro))) break;
                await esperarFin();
            }
        }
        E.radar = false;
        pintarRadarBtn();
        if (E.radarCancelado) { aviso('Radar cancelado.'); return; }
        if (lecturas.length === 12) {
            const cerca = Math.min.apply(null, lecturas), i = lecturas.indexOf(cerca);
            hablar(`Radar listo, we. Lo más cerca está a ${cerca >= 400 ? 'más de 4 metros' : cerca + ' centímetros'}, hacia los ${i * 30} grados.`);
        }
    }

    function alarma() {
        let n = 0;
        const t = setInterval(() => {
            if (!E.guardia || !listo() || n++ > 14) { clearInterval(t); return; }
            enlace().nota(n % 2 ? 880 : 660, 300);
            if (enlace().senal) enlace().senal('dir', 'x');
            if (control() && control().vibrar) control().vibrar([200, 100, 200]);
        }, 400);
    }

    function ponerGuardia(si, callado) {
        const b = $('rb-guardia');
        if (E.guardia) clearInterval(E.guardia.timer);
        E.guardia = null;
        b.setAttribute('aria-pressed', String(si));
        b.textContent = si ? 'Apagar guardia' : 'Armar guardia';
        if (!si) { if (callado) aviso('Guardia apagada.'); else di('guardiaOff'); return; }
        if (!listo() || !enlace().soportaDistancia()) { b.setAttribute('aria-pressed', 'false'); b.textContent = 'Armar guardia'; hablar('La guardia necesita el robot conectado con el firmware nuevo, we.'); return; }
        const G = { base: [], enfria: 0, timer: null };
        G.timer = setInterval(() => {
            if (!listo()) { ponerGuardia(false, true); return; }
            enlace().pedirDistancia();
            const l = enlace().distancias().lecturas, cm = l.length ? l[l.length - 1] : 400;
            if (G.base.length < 6) { G.base.push(cm); return; }
            const base = G.base.slice().sort((a, c) => a - c)[3];
            if (Date.now() < G.enfria) return;
            if (cm > 0 && cm < base - 25 && l.length > 1 && l[l.length - 2] < base - 25) {
                G.enfria = Date.now() + 8000;
                di('alerta');
                alarma();
            }
        }, 350);
        E.guardia = G;
        if (callado) aviso('Guardia armada.'); else di('guardiaOn');
    }

    const CLAVE_FACTS = 'cecyte_yokis_facts';
    function leerFacts() {
        let t = '';
        try { t = localStorage.getItem(CLAVE_FACTS) || ''; } catch (e) { /* sin guardado */ }
        const lista = t.split('\n').map(x => x.trim()).filter(Boolean);
        return lista.length ? lista : raiz.Robot.FRASES.fact;
    }
    function tirarFact() {
        const l = leerFacts();
        hablar(l[Math.floor(Math.random() * l.length)]);
    }
    function iniciarFacts() {
        const caja = $('rb-fact-texto');
        if (!caja) return;
        try { caja.value = localStorage.getItem(CLAVE_FACTS) || ''; } catch (e) { /* sin guardado */ }
        caja.placeholder = raiz.Robot.FRASES.fact.join('\n');
        caja.addEventListener('change', () => { try { localStorage.setItem(CLAVE_FACTS, caja.value); } catch (e) { /* sin guardado */ } });
        $('rb-fact-probar').addEventListener('click', () => { caja.dispatchEvent(new Event('change')); tirarFact(); });
        $('rb-fact-restaurar').addEventListener('click', () => { caja.value = ''; caja.dispatchEvent(new Event('change')); });
    }

    function charla(t) {
        if (t === 'fact') { tirarFact(); return; }
        const ahora = new Date();
        const datos = {
            hora: ahora.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' }),
            fecha: ahora.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }),
        };
        di(t, datos);
    }

    function ejecutar(o) {
        if (!o) { di('noEntendi'); return; }
        const c = calibra();
        if (o.a === 'sinNombre') { di('sinNombre'); return; }
        if (o.a === 'charla') { charla(o.t); return; }
        if (o.a === 'saludo') { di('saludo'); return; }
        if (o.a === 'paro') { if (listo()) enlace().paro(); detener(false); detenerMeneo(); di('paro'); return; }
        if (o.a === 'bateria') {
            const p = $('rb-bat-pct');
            if (p && /\d/.test(p.textContent)) di('bateria', { pct: p.textContent.replace(/\s*%/, ' por ciento') });
            else di('sinBateria');
            return;
        }
        if (!listo()) { di('sinRobot'); return; }
        if (o.a === 'mover') {
            const ms = o.s ? o.s * 1000 : o.cm ? o.cm / c.vel * 1000 : 1500;
            correr(raiz.Robot.movimientoARecorrido(o.sentido, ms), o.sentido > 0 ? 'mover' : 'reversa');
        } else if (o.a === 'giro') correr(raiz.Robot.giroARecorrido(o.grados, c.giro), 'giro');
        else if (o.a === 'figura') correr(figura(o.f), 'figura', { f: FIGURAS[o.f] || o.f });
        else if (o.a === 'casa') regresarCasa();
        else if (o.a === 'radar') radar(false);
        else if (o.a === 'guardia') ponerGuardia(o.on, false);
        else if (o.a === 'turbo') di('turbo');
        else if (o.a === 'ruleta') {
            if (enlace().ruleta(r => di('ruletaFin', { num: r.num, color: r.color }))) di('ruleta'); else di('ocupado');
        }
        else if (o.a === 'claxon') { enlace().nota(440, 500); di('claxon'); }
        else if (o.a === 'luces') { enlace().luces(o.efecto, o.color || null); di(o.color === '#000000' ? 'lucesOff' : 'luces'); }
        else if (o.a === 'baile') {
            const r = enlace().bailar(o.id, o.cancion);
            if (r) hablar(raiz.Robot.frase('baile') + ` Va con ${r.baile}${r.cancion ? ' y ' + r.cancion : ''}.`);
            else di('fallo');
        } else if (o.a === 'funcion') {
            const r = enlace().funcionPorId(o.id);
            if (r) hablar(raiz.Robot.frase('funcion', { nombre: r.nombre }) + (r.modelo ? ` Ojo, cambié al modelo ${r.modelo}.` : ''));
            else di('sinFuncion');
        } else if (o.a === 'cancionParar') { enlace().detenerCancion(); di('cancionParar'); }
        else if (o.a === 'cancion') {
            let id = o.id;
            if (!id && o.q) {
                const q = raiz.Robot.sinAcentos(o.q);
                const cn = enlace().canciones().find(x => raiz.Robot.sinAcentos(x.nombre).includes(q) || q.includes(raiz.Robot.sinAcentos(x.nombre)));
                id = cn ? cn.id : null;
                if (!id) { di('sinCancion'); return; }
            }
            if (!id) id = enlace().cancionActual();
            if (enlace().tocarCancion(id)) di('cancion'); else di('sinCancion');
        }
    }

    function elegirTexto(matches) {
        const lista = (matches || []).filter(Boolean);
        const bueno = lista.find(m => { const o = raiz.Robot.ordenDeVoz(m); return o && o.a !== 'sinNombre'; });
        return bueno || lista[0] || '';
    }

    const CLAVE_IA = 'cecyte_yokis_ia';
    const MODELOS_IA = ['gemini-flash-lite-latest', 'gemini-flash-latest'];

    function llaveIA() {
        try { return (localStorage.getItem(CLAVE_IA) || '').trim(); } catch (e) { return ''; }
    }

    async function consultarIA(alternativas) {
        const llave = llaveIA();
        if (!llave || !alternativas.length) return null;
        const cuerpo = JSON.stringify({
            systemInstruction: { parts: [{ text: raiz.Robot.promptIA() }] },
            contents: [{ role: 'user', parts: [{ text: alternativas.map((t, i) => (i + 1) + '. ' + t).join('\n') }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 300 },
        });
        for (const modelo of MODELOS_IA) {
            const corte = new AbortController();
            const reloj = setTimeout(() => corte.abort(), 6000);
            try {
                const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + modelo + ':generateContent', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': llave }, body: cuerpo, signal: corte.signal,
                });
                if (!r.ok) continue;
                const j = await r.json();
                const dicho = JSON.parse(j.candidates[0].content.parts.map(p => p.text || '').join(''));
                const o = [].concat(dicho).map(raiz.Robot.validarOrdenIA).find(Boolean);
                if (o) return o;
            } catch (e) {
                continue;
            } finally {
                clearTimeout(reloj);
            }
        }
        return null;
    }

    function iniciarIA() {
        const campo = $('rb-ia-llave');
        if (!campo) return;
        campo.value = llaveIA();
        campo.addEventListener('change', () => {
            try { localStorage.setItem(CLAVE_IA, campo.value.trim()); } catch (e) { return; }
            $('rb-ia-estado').textContent = campo.value.trim() ? 'IA de respaldo activada.' : 'IA de respaldo apagada.';
        });
        $('rb-ia-probar').addEventListener('click', async () => {
            campo.dispatchEvent(new Event('change'));
            const o = await consultarIA(['yakis avanza dos metros', 'yo kiss avanza dos metros']);
            $('rb-ia-estado').textContent = o && o.a === 'mover' ? 'Funciona: la IA entendió «yakis avanza dos metros».' : llaveIA() ? 'No respondió: revisa la llave o tu internet.' : 'Pega primero tu llave.';
        });
    }

    async function escuchar() {
        if (E.escuchando) return;
        const SR = raiz.Plataforma && raiz.Plataforma.plugin('SpeechRecognition');
        const Web = raiz.SpeechRecognition || raiz.webkitSpeechRecognition;
        const boton = $('rb-jarvis');
        E.escuchando = true;
        boton.classList.add('is-activo');
        aviso('Escuchando…');
        try {
            let lista = [];
            if (SR) {
                const p = await SR.requestPermissions();
                if (p.speechRecognition !== 'granted') { di('sinMicro'); return; }
                const r = await SR.start({ language: 'es-MX', maxResults: 5, prompt: 'Dime, we', partialResults: false, popup: true });
                lista = (r.matches || []).filter(Boolean);
            } else if (Web) {
                lista = await new Promise((res, rej) => {
                    const rec = new Web();
                    rec.lang = 'es-MX';
                    rec.maxAlternatives = 5;
                    rec.onresult = e => res(Array.from(e.results[0]).map(x => x.transcript).filter(Boolean));
                    rec.onerror = e => rej(e);
                    rec.onend = () => res([]);
                    rec.start();
                });
            } else { di('sinVoz'); return; }
            const texto = elegirTexto(lista);
            if (!texto) { di('nada'); return; }
            historial('yo', texto);
            aviso('«' + texto + '»');
            let orden = raiz.Robot.ordenDeVoz(texto);
            if (!orden || orden.a === 'sinNombre') {
                const ia = await consultarIA(lista.slice(0, 4));
                if (ia) orden = ia;
            }
            ejecutar(orden);
        } catch (e) {
            di('fallo');
        } finally {
            E.escuchando = false;
            boton.classList.remove('is-activo');
        }
    }

    function iniciar() {
        if (!$('rb-jarvis') || !raiz.Robot || !raiz.Robot.ordenDeVoz) return;
        const c = calibra();
        $('rb-cal-vel').value = c.vel;
        $('rb-cal-giro').value = c.giro;
        ['rb-cal-vel', 'rb-cal-giro'].forEach(id => $(id).addEventListener('change', guardaCalibra));
        document.querySelectorAll('[data-figura]').forEach(b => b.addEventListener('click', () => { guardaCalibra(); correr(figura(b.dataset.figura), null, null, 'Dibujando ' + b.dataset.figura + '.'); }));
        $('rb-casa-marca').addEventListener('click', () => { if (control()) control().marcarCasa(); aviso('Casa marcada: aquí empieza el regreso.'); });
        $('rb-casa-ir').addEventListener('click', regresarCasa);
        $('rb-radar').addEventListener('click', () => { guardaCalibra(); radar(true); });
        $('rb-guardia').addEventListener('click', () => ponerGuardia($('rb-guardia').getAttribute('aria-pressed') !== 'true', true));
        $('rb-jarvis').addEventListener('click', escuchar);
        ['rb-voz-sel', 'rb-voz-grave', 'rb-voz-rapido'].forEach(id => $(id).addEventListener('change', guardaVoz));
        iniciarFacts();
        iniciarIA();
        iniciarMeneo();
        $('rb-voz-probar').addEventListener('click', () => { guardaVoz(); hablar('¡Qué onda, we! Así suena tu amigo Yokis. ¡Listo pa lo que sea!'); });
        pintarVoces();
        iniciarEntrena();
        document.addEventListener('robot-paro', () => {
            detener(false);
            E.radarCancelado = true;
            if (E.guardia) ponerGuardia(false, true);
        });
        iniciarLienzo();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})(window);
