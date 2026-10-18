(function (raiz) {
    const $ = id => document.getElementById(id);
    const CLAVE = 'cecyte_robot_calibra';
    const CM_PX = 0.5, SALIDA = { x: 150, y: 188 };
    const MS_PASO = 50, MS_LATIDO = 250, HIST_MAX = 6;
    const FIGURAS = { circulo: 'un círculo', cuadrado: 'un cuadrado', triangulo: 'un triángulo', estrella: 'una estrella' };
    const E = { puntos: [], dibujando: false, guardia: null, radar: false, radarCancelado: false, escuchando: false, corrida: null, meneo: null, memoria: [], dice: null, hablando: false, hablaTope: 0, nHabla: 0, finHabla: 0, procesando: false, cola: [], colaTimer: 0, encolar: false };
    const CLAVE_MODO = 'cecyte_yokis_modo';
    const MODOS = () => (raiz.Robot && raiz.Robot.MODOS_IA) || ['normal'];
    const personal = () => (raiz.Robot && raiz.Robot.MODO_PERSONAL) || null;
    const datoPersonal = (modo, campo) => (personal() && personal().id === modo ? personal()[campo] : '') || '';
    const modoHevy = () => {
        try {
            const m = localStorage.getItem(CLAVE_MODO);
            if (MODOS().includes(m)) return m;
            if (m === null && localStorage.getItem('cecyte_yokis_grosero') === '1') return 'grosero';
        } catch (e) { return 'normal'; }
        return 'normal';
    };
    const groseroOn = () => modoHevy() === 'grosero' || modoHevy() === 'argentino';
    const modoF = () => { const m = modoHevy(); return m === 'normal' ? false : m; };
    const CRITICAS = ['paro', 'cancionParar', 'bateria'];
    const NEGACION = /\b(no|ni|nunca|tampoco|jamas|nada|aunque)\b/;
    const PROMETIDAS = ['cancion', 'baile', 'luces', 'funcion', 'figura', 'radar', 'guardia', 'casa'];
    const REBELDES = ['mover', 'giro', 'figura', 'luces', 'baile', 'cancion', 'funcion', 'casa', 'radar', 'claxon', 'ruleta'];
    const SIN_DICE = ['sinRobot', 'fallo', 'ocupado', 'sinFuncion', 'sinCancion', 'sinMicro', 'sinVoz', 'telSinCompartir', 'telSinUbicacion', 'telSinGiro', 'telSinBrujula', 'telPerdido', 'telBloqueo', 'telGps', 'telTiempo', 'telBateria', 'telLlegue'];

    const enlace = () => raiz.RobotEnlace || null;
    const control = () => raiz.RobotControl || null;
    const listo = () => !!(enlace() && enlace().listo());
    const esperar = ms => new Promise(r => setTimeout(r, ms));
    const sinInternet = () => raiz.navigator.onLine === false;

    function aviso(t) {
        ['rb-jarvis-msg', 'rb-dib-msg', 'rb-herr-msg'].forEach(id => { const el = $(id); if (el) el.textContent = t; });
    }

    function historial(quien, texto) {
        E.memoria.push((quien === 'yo' ? 'Usuario: ' : 'Hevy: ') + texto);
        if (E.memoria.length > 12) E.memoria.shift();
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

    async function activarVoz(nombre) {
        ENT.activa = nombre || '';
        try { localStorage.setItem(CLAVE_ACTIVA, ENT.activa); } catch (e) { /* sin guardado */ }
        ENT.claves = new Set();
        if (ENT.activa) {
            try { (await bdClaves()).filter(k => k.startsWith(ENT.activa + '|')).forEach(k => ENT.claves.add(k.slice(ENT.activa.length + 1))); } catch (e) { /* sin base de datos */ }
        }
        pintarVocesEntrenadas();
    }

    function pintarVocesEntrenadas() {
        const ul = $('rb-vz-lista');
        if (!ul) return;
        const fila = (nombre, detalle, uso, clonable) => `<li class="rb-vz-item${uso ? ' is-activa' : ''}" data-n="${nombre}"><span><b>${nombre}</b><small>${detalle}</small></span>`
            + (uso ? '<small>En uso</small>' : '')
            + (clonable ? '<button type="button" class="btn btn--secondary btn--sm" data-acc="clonar">Clonar con IA</button>' : '')
            + '<button type="button" class="btn btn--secondary btn--sm" data-acc="borrar" aria-label="Borrar esta voz">Borrar</button></li>';
        ul.innerHTML = ENT.voces.length
            ? ENT.voces.map(v => fila(v.nombre, `${v.n} frases${v.clon ? ' · clonada con IA' : ''}`, v.nombre === ENT.activa, !v.clon)).join('')
            : '<li class="hint">Aún no hay voces. Entrena una abajo.</li>';
        pintarSelectorVoz();
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
        const pedir = () => raiz.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        try {
            flujo = await pedir();
        } catch (primero) {
            const SR = raiz.Plataforma && raiz.Plataforma.plugin('SpeechRecognition');
            try {
                if (SR) await SR.requestPermissions();
                flujo = await pedir().catch(() => raiz.navigator.mediaDevices.getUserMedia({ audio: true }));
            } catch (e) {
                $('rb-ent-aviso').textContent = 'No pude usar el micrófono (' + (e && e.name || primero && primero.name || 'sin permiso') + '). Revisa el permiso de la app en los ajustes del teléfono.';
                return;
            }
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
        const llaveG = $('rb-gradium-llave');
        if (llaveG) {
            llaveG.value = llaveGradium();
            llaveG.addEventListener('change', () => {
                VIA.gradiumHasta = 0;
                try { localStorage.setItem(CLAVE_GRADIUM, llaveG.value.trim()); } catch (e) { return; }
                estadoVoz(llaveG.value.trim() ? 'Llave de Gradium guardada.' : 'Llave de Gradium borrada.');
            });
        }
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
            if (b.dataset.acc === 'clonar') { b.disabled = true; await clonarVoz(nombre); return; }
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

    const CLAVE_VOZIA = 'cecyte_yokis_vozia';
    const VOCES_IA = [['Charon', 'Charon (grave)'], ['Fenrir', 'Fenrir (fuerte)'], ['Orus', 'Orus (firme)'], ['Puck', 'Puck (alegre)'], ['Zephyr', 'Zephyr (brillante)'], ['Kore', 'Kore (firme, femenina)']];
    const VIA = { fuente: null, cache: new Map(), turno: 0, bd: null, motivo: '' };

    function vozIAElegida() {
        try {
            const v = JSON.parse(localStorage.getItem(CLAVE_VOZIA)).voz;
            if (VOCES_IA.some(x => x[0] === v)) return v;
        } catch (e) { return 'Charon'; }
        return 'Charon';
    }

    function estadoVoz(t) {
        const el = $('rb-ia-estado');
        if (el) el.textContent = t;
    }

    function callarIA() {
        cortarLive();
        const a = VIA.fuente;
        VIA.fuente = null;
        if (!a) return;
        try { a.pause(); } catch (e) { return; }
    }

    function pcmAWav(b64) {
        const bin = atob(b64), n = bin.length, bytes = new Uint8Array(44 + n), v = new DataView(bytes.buffer);
        const txt = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
        txt(0, 'RIFF'); v.setUint32(4, 36 + n, true); txt(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, 24000, true); v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, n, true);
        for (let i = 0; i < n; i++) bytes[44 + i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: 'audio/wav' });
    }

    function sonar(url) {
        return new Promise((res, rej) => {
            const a = new Audio(url);
            VIA.fuente = a;
            const reloj = setTimeout(() => rej(new Error('tiempo')), 40000);
            a.onended = () => { clearTimeout(reloj); res(true); };
            a.onerror = () => { clearTimeout(reloj); rej(new Error('audio')); };
            a.onpause = () => { if (VIA.fuente !== a) { clearTimeout(reloj); res(true); } };
            a.play().catch(e => { clearTimeout(reloj); rej(e); });
        });
    }

    function abrirBdVia() {
        return new Promise(res => {
            if (VIA.bd) { res(VIA.bd); return; }
            try {
                const q = indexedDB.open('hevy-voz-ia', 1);
                q.onupgradeneeded = () => q.result.createObjectStore('v');
                q.onsuccess = () => { VIA.bd = q.result; res(q.result); };
                q.onerror = () => res(null);
            } catch (e) { res(null); }
        });
    }

    async function cacheGet(clave) {
        const db = await abrirBdVia();
        if (!db) return null;
        return new Promise(res => {
            const q = db.transaction('v').objectStore('v').get(clave);
            q.onsuccess = () => res(q.result || null);
            q.onerror = () => res(null);
        });
    }

    async function cachePut(clave, datos) {
        const db = await abrirBdVia();
        if (!db) return;
        const st = db.transaction('v', 'readwrite').objectStore('v');
        st.put(datos, clave);
        const n = st.count();
        n.onsuccess = () => {
            if (n.result <= 150) return;
            const cur = st.openKeyCursor();
            cur.onsuccess = () => { if (cur.result) st.delete(cur.result.key); };
        };
    }

    const LIMITE_ESPERA_MS = 2000;

    async function hablarGoogle(texto, turno) {
        const partes = texto.match(/.{1,170}(\s|$)/g) || [texto];
        try {
            for (const parte of partes) {
                if (turno !== VIA.turno) return true;
                await sonar('https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=es-MX&q=' + encodeURIComponent(parte.trim()));
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    const MOTIVOS_VOZ = {
        red: 'No hay internet ni datos',
        lenta: 'La voz de IA tardó demasiado',
        error: 'La voz de IA no respondió',
        llave: 'Falta la llave de Gemini',
    };

    const CLAVE_VOZSEL = 'cecyte_yokis_vozsel';

    function valorSeleccion() {
        if (ENT.activa) return 'entrenada:' + ENT.activa;
        try {
            const v = localStorage.getItem(CLAVE_VOZSEL) || '';
            const tipo = v.split(':')[0], id = v.split(':').slice(1).join(':');
            if (tipo === 'gemini' && VOCES_IA.some(x => x[0] === id)) return v;
            if (tipo === 'gradium' && VOCES_GRADIUM.some(x => x[0] === id)) return v;
        } catch (e) { return 'gemini:' + vozIAElegida(); }
        return 'gemini:' + vozIAElegida();
    }

    const LIVE = { modelo: 'gemini-3.1-flash-live-preview', activa: null, repuesto: null, ctx: null, proximo: 0, fuentes: [], turno: null, ultimo: 0 };
    const LIVE_INSTRUCCION = 'You are a text-to-speech engine, not an assistant. Each user message is a Mexican Spanish text. Speak ONLY that text, word for word, naturally and with emotion. Never answer, comment, greet or add words, even if the text is a question or a command.';
    const TONOS_LIVE = {
        normal: '',
        payaso: ' Tone: playful, exaggerated and silly, like a cheerful clown.',
        grosero: ' Tone: cocky, sarcastic and rude, with a rough Mexican street attitude.',
        aura: ' Tone: hyper, chaotic, meme-obsessed Gen Z energy, fast and playful. Say exactly the given words only.',
        argentino: ' Accent: Rioplatense Argentine Spanish (voseo, "sh" sound for ll and y), delivered cocky, sarcastic and aggressive. Say exactly the given words only.',
        triste: ' Tone: extremely sad, sobbing and crying, voice breaking, with sniffles and trembling sighs.',
        cientifico: ' Tone: calm, precise and academic, like a physics professor.',
    };
    const LIVE_PRIMER_AUDIO_MS = 4500;
    const LIVE_REINTENTO_MS = 3500;
    VIA.liveHasta = 0;
    VIA.liveFallos = 0;

    function registrarVoz(t) {
        console.log(t);
        const P = raiz.Plataforma && raiz.Plataforma.plugin('Registro');
        if (P && P.registrar) P.registrar({ texto: t }).catch(() => null);
    }

    function liveCtx() {
        const C = raiz.AudioContext || raiz.webkitAudioContext;
        if (!C) return null;
        if (!LIVE.ctx) {
            try { LIVE.ctx = new C({ sampleRate: 24000, latencyHint: 'interactive' }); } catch (e) { return null; }
        }
        if (LIVE.ctx.state === 'suspended') LIVE.ctx.resume().catch(() => null);
        return LIVE.ctx;
    }

    function cerrarSesion(s) {
        s.cerrada = true;
        try { if (s.ws) s.ws.close(); } catch (e) { s.ws = null; }
    }

    function terminarTurno(s, bien) {
        const t = s.turno;
        s.turno = null;
        if (!t || t.terminado) return;
        t.terminado = true;
        const espera = Math.max(0, (t.finAudio - (LIVE.ctx ? LIVE.ctx.currentTime : 0)) * 1000);
        setTimeout(() => t.resolver(bien), bien ? espera : 0);
    }

    function reproducirChunk(t, b64) {
        const c = LIVE.ctx;
        if (!c || t.cancelado || t.muda) return;
        const b = base64ABytes(b64), n = b.length >> 1, v = new DataView(b.buffer), f = new Float32Array(n);
        for (let i = 0; i < n; i++) f[i] = v.getInt16(2 * i, true) / 32768;
        const buf = c.createBuffer(1, n, 24000);
        buf.copyToChannel(f, 0);
        const fuente = c.createBufferSource();
        fuente.buffer = buf;
        fuente.connect(c.destination);
        const inicio = Math.max(c.currentTime + 0.04, LIVE.proximo);
        fuente.start(inicio);
        LIVE.proximo = inicio + buf.duration;
        t.finAudio = LIVE.proximo;
        LIVE.fuentes.push(fuente);
        fuente.onended = () => { LIVE.fuentes = LIVE.fuentes.filter(x => x !== fuente); };
    }

    async function procesarLive(s, ev, abierta) {
        let m;
        try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text()); } catch (e) { return; }
        if (m.setupComplete) { s.lista = true; abierta(true); return; }
        if (m.goAway) { s.cerrada = true; return; }
        if (m.error) { terminarTurno(s, false); return; }
        const sc = m.serverContent, t = s.turno;
        if (!sc || !t) return;
        if (sc.modelTurn && sc.modelTurn.parts) {
            sc.modelTurn.parts.forEach(p => {
                if (!p.inlineData || t.cancelado) return;
                if (!t.primero) {
                    t.primero = Date.now();
                    t.alPrimero(true);
                }
                t.pcm.push(p.inlineData.data);
                reproducirChunk(t, p.inlineData.data);
            });
        }
        if (sc.turnComplete) terminarTurno(s, true);
    }

    function abrirSesion(voz, modo) {
        const s = { voz, modo, ws: null, lista: false, cerrada: false, turno: null };
        s.promesa = new Promise(abierta => {
            let ws;
            try {
                ws = new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=' + encodeURIComponent(llaveIA()));
            } catch (e) {
                s.cerrada = true;
                abierta(false);
                return;
            }
            s.ws = ws;
            ws.onopen = () => ws.send(JSON.stringify({ setup: { model: 'models/' + LIVE.modelo, generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } } } }, systemInstruction: { parts: [{ text: LIVE_INSTRUCCION + (TONOS_LIVE[modo] || datoPersonal(modo, 'tonoLive')) }] } } }));
            ws.onmessage = ev => procesarLive(s, ev, abierta);
            const caida = () => { s.cerrada = true; abierta(false); terminarTurno(s, false); };
            ws.onerror = caida;
            ws.onclose = caida;
        });
        return s;
    }

    function garantizarRepuesto(voz, modo) {
        const r = LIVE.repuesto;
        if (r && (r.cerrada || r.voz !== voz || r.modo !== modo)) {
            cerrarSesion(r);
            LIVE.repuesto = null;
        }
        if (!LIVE.repuesto && llaveIA()) LIVE.repuesto = abrirSesion(voz, modo);
    }

    function sesionActiva(voz, modo) {
        const a = LIVE.activa;
        if (a && (a.cerrada || a.voz !== voz || a.modo !== modo)) {
            cerrarSesion(a);
            LIVE.activa = null;
        }
        if (!LIVE.activa) {
            const r = LIVE.repuesto;
            if (r && !r.cerrada && r.voz === voz && r.modo === modo) {
                LIVE.activa = r;
                LIVE.repuesto = null;
            } else {
                LIVE.activa = abrirSesion(voz, modo);
            }
        }
        garantizarRepuesto(voz, modo);
        LIVE.ultimo = Date.now();
        return LIVE.activa;
    }

    function cortarLive() {
        LIVE.fuentes.forEach(f => { try { f.stop(); } catch (e) { LIVE.fuentes = []; } });
        LIVE.fuentes = [];
        LIVE.proximo = 0;
        const t = LIVE.turno;
        LIVE.turno = null;
        if (!t || t.terminado) return;
        t.cancelado = true;
        t.terminado = true;
        t.alPrimero(false);
        t.resolver(false);
        const s = LIVE.activa;
        LIVE.activa = null;
        if (s) cerrarSesion(s);
    }

    function unirPcm(lista) {
        const partes = lista.map(base64ABytes), todo = new Uint8Array(partes.reduce((a, p) => a + p.length, 0));
        let o = 0;
        partes.forEach(p => { todo.set(p, o); o += p.length; });
        return bytesABase64(todo);
    }

    function fallaLive(motivo) {
        VIA.liveFallos++;
        if (VIA.liveFallos >= 2) {
            VIA.liveFallos = 0;
            VIA.liveHasta = Date.now() + 10000;
        }
        if (motivo) VIA.motivo = motivo;
        return false;
    }

    async function turnoLive(s, texto, turno, muda) {
        const t = { texto, cancelado: false, terminado: false, primero: 0, pcm: [], finAudio: 0, muda: !!muda };
        const fin = new Promise(r => { t.resolver = r; });
        const primero = new Promise(r => { t.alPrimero = r; });
        s.turno = t;
        LIVE.turno = t;
        LIVE.proximo = 0;
        t.inicio = Date.now();
        try {
            s.ws.send(JSON.stringify({ realtimeInput: { text: texto } }));
        } catch (e) {
            s.turno = null;
            LIVE.turno = null;
            return { t, fin, lento: true };
        }
        await Promise.race([primero, fin, esperar(LIVE_PRIMER_AUDIO_MS)]);
        if (!t.primero && !t.cancelado && turno === VIA.turno) {
            t.cancelado = true;
            t.terminado = true;
            s.turno = null;
            LIVE.turno = null;
            cerrarSesion(s);
            if (LIVE.activa === s) LIVE.activa = null;
            return { t, fin, lento: true };
        }
        return { t, fin, lento: false };
    }

    async function hablarLive(texto, voz, turno, clave, muda) {
        const c = liveCtx();
        if (!muda) {
            if (!c) return false;
            if (c.state !== 'running') await Promise.race([c.resume().catch(() => null), esperar(250)]);
            if (c.state !== 'running') {
                registrarVoz('VozLive: el audio del teléfono sigue bloqueado');
                return false;
            }
        }
        const modo = modoHevy();
        for (let intento = 0; intento < 2; intento++) {
            if (turno !== VIA.turno) return true;
            const s = sesionActiva(voz, modo);
            const lista = await Promise.race([s.promesa, esperar(intento ? LIVE_REINTENTO_MS : 900)]);
            if (turno !== VIA.turno) return true;
            if (!lista || s.cerrada) {
                cerrarSesion(s);
                if (LIVE.activa === s) LIVE.activa = null;
                if (raiz.navigator.onLine === false) return fallaLive('red');
                continue;
            }
            const { t, fin, lento } = await turnoLive(s, texto, turno, muda);
            if (turno !== VIA.turno || t.cancelado && !lento) {
                t.cancelado = true;
                return true;
            }
            if (lento) {
                registrarVoz('VozLive: sin audio tras ' + (Date.now() - t.inicio) + ' ms (intento ' + (intento + 1) + ')');
                continue;
            }
            VIA.liveFallos = 0;
            registrarVoz('VozLive: primer audio en ' + (t.primero - t.inicio) + ' ms (audio ' + (c ? c.state : 'sin contexto') + ')');
            await Promise.race([fin, esperar(30000)]);
            if (t.cancelado) return true;
            if (t.pcm.length && clave) cachePut(clave, unirPcm(t.pcm));
            cerrarSesion(s);
            if (LIVE.activa === s) LIVE.activa = null;
            if (!t.muda) estadoVoz('Voz: Gemini en vivo.');
            return true;
        }
        return fallaLive('lenta');
    }

    async function nivelLive(texto, turno) {
        if (!llaveIA()) { VIA.motivo = 'llave'; return false; }
        if (Date.now() < VIA.liveHasta) return false;
        const voz = vozIAElegida(), clave = 'live|' + voz + '|' + modoHevy() + '|' + texto;
        const guardado = VIA.cache.get(clave) || await cacheGet(clave);
        if (guardado) {
            VIA.cache.set(clave, guardado);
            if (turno !== VIA.turno) return true;
            callarIA();
            const url = URL.createObjectURL(pcmAWav(guardado));
            try {
                await sonar(url);
                estadoVoz('Voz: Gemini en vivo.');
                return true;
            } finally {
                URL.revokeObjectURL(url);
            }
        }
        return hablarLive(texto, voz, turno, clave, false);
    }

    function precalentarLive() {
        if (!llaveIA() || Date.now() < VIA.liveHasta) return;
        const t0 = Date.now();
        sesionActiva(vozIAElegida(), modoHevy()).promesa.then(ok => registrarVoz('VozLive: sesión ' + (ok ? 'lista en ' + (Date.now() - t0) + ' ms' : 'no abrió')));
    }

    async function autopruebaLive() {
        let depurar = false;
        try { depurar = localStorage.getItem('cecyte_yokis_depurar') === '1'; } catch (e) { return; }
        if (!depurar || !llaveIA()) return;
        const c = liveCtx();
        registrarVoz('VozLive: AudioContext ' + (c ? c.state : 'no disponible') + ' sin tocar la pantalla');
        const ok = await hablarLive('Hola.', vozIAElegida(), VIA.turno, '', true);
        registrarVoz('VozLive: autoprueba ' + (ok ? 'bien' : 'falló'));
    }

    setInterval(() => {
        if (!LIVE.ultimo || Date.now() - LIVE.ultimo < 180000) return;
        [LIVE.activa, LIVE.repuesto].forEach(s => { if (s) cerrarSesion(s); });
        LIVE.activa = null;
        LIVE.repuesto = null;
        LIVE.ultimo = 0;
    }, 30000);

    function nivelGradium(texto, turno) {
        const v = VOCES_GRADIUM.find(x => x[0] === vozGradiumElegida()) || ['', ''];
        return hablarGradium(texto, v[0], 'IA de Gradium (' + v[1] + ')', turno);
    }

    const ETIQUETA_NIVEL = { live: 'la voz de Gemini en vivo', gradium: 'la voz de IA de Gradium' };

    async function hablarIA(texto) {
        const turno = ++VIA.turno;
        VIA.motivo = '';
        const principal = valorSeleccion().split(':')[0] === 'gradium' ? 'gradium' : 'gemini';
        const niveles = { live: nivelLive, gradium: nivelGradium };
        const orden = principal === 'gradium' ? ['gradium', 'live'] : ['live'];
        for (const nivel of orden) {
            if (turno !== VIA.turno) return true;
            if (VIA.motivo === 'red' || VIA.motivo === 'lenta') continue;
            if (await niveles[nivel](texto, turno)) {
                if (nivel !== orden[0]) estadoVoz((MOTIVOS_VOZ[VIA.motivo] || 'La voz elegida no respondió') + ': hablo con ' + ETIQUETA_NIVEL[nivel] + '.');
                return true;
            }
        }
        if (turno !== VIA.turno) return true;
        callarIA();
        const motivo = MOTIVOS_VOZ[VIA.motivo] || 'La voz elegida no respondió';
        if (VIA.motivo !== 'red' && await hablarGoogle(texto, turno)) {
            estadoVoz(motivo + ': hablo con la voz de Google.');
            return true;
        }
        estadoVoz(motivo + ': hablo con la voz del teléfono.');
        return false;
    }

    function pintarSelectorVoz() {
        const sel = $('rb-voz-unica');
        if (!sel) return;
        sel.textContent = '';
        const grupo = (titulo, items) => {
            if (!items.length) return;
            const g = document.createElement('optgroup');
            g.label = titulo;
            items.forEach(it => {
                const o = document.createElement('option');
                o.value = it[0];
                o.textContent = it[1];
                g.appendChild(o);
            });
            sel.appendChild(g);
        };
        grupo('IA de Google (Gemini, en vivo)', VOCES_IA.map(v => ['gemini:' + v[0], v[1]]));
        grupo('IA de Gradium', VOCES_GRADIUM.map(v => ['gradium:' + v[0], v[1]]));
        grupo('Mis voces', ENT.voces.map(v => ['entrenada:' + v.nombre, v.nombre + (v.clon ? ' (clonada)' : ' (grabada)')]));
        sel.value = valorSeleccion();
    }

    function iniciarVozIA() {
        const sel = $('rb-voz-unica');
        if (!sel) return;
        pintarSelectorVoz();
        sel.addEventListener('change', async () => {
            const v = sel.value, tipo = v.split(':')[0], id = v.split(':').slice(1).join(':');
            VIA.gradiumHasta = 0;
            VIA.liveHasta = 0;
            if (tipo === 'entrenada') {
                await activarVoz(id);
            } else {
                try {
                    localStorage.setItem(CLAVE_VOZSEL, v);
                    if (tipo === 'gemini') localStorage.setItem(CLAVE_VOZIA, JSON.stringify({ voz: id }));
                    if (tipo === 'gradium') localStorage.setItem(CLAVE_VOZGR, id);
                    if (tipo === 'local') localStorage.setItem(CLAVE_LOCAL, JSON.stringify({ voz: id }));
                } catch (e) { return; }
                if (ENT.activa) await activarVoz('');
            }
            hablar('¡Qué onda, we! Así suena esta voz.', true);
        });
        document.addEventListener('pointerdown', () => { liveCtx(); }, true);
        setTimeout(() => {
            precalentarLive();
            autopruebaLive();
        }, 3000);
        setTimeout(autopruebaEscucha, 9000);
    }

    const CLAVE_GRADIUM = 'cecyte_yokis_gradium';
    const llaveGradium = () => { try { return (localStorage.getItem(CLAVE_GRADIUM) || '').trim(); } catch (e) { return ''; } };

    function bytesABase64(b) {
        let s = '';
        for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
        return btoa(s);
    }

    function base64ABytes(d) {
        const s = atob(d), b = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
        return b;
    }

    function aWav16(muestras, sr) {
        const n = muestras.length, bytes = new Uint8Array(44 + 2 * n), v = new DataView(bytes.buffer);
        const txt = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
        txt(0, 'RIFF'); v.setUint32(4, 36 + 2 * n, true); txt(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, 2 * n, true);
        for (let i = 0; i < n; i++) v.setInt16(44 + 2 * i, Math.max(-1, Math.min(1, muestras[i])) * 32767, true);
        return bytes;
    }

    function recortarSilencio(x, sr) {
        let a = 0, b = x.length - 1;
        while (a < b && Math.abs(x[a]) < 0.02) a++;
        while (b > a && Math.abs(x[b]) < 0.02) b--;
        const margen = Math.round(sr * 0.1);
        return x.slice(Math.max(0, a - margen), Math.min(x.length, b + margen));
    }

    async function muestraDeVoz(nombre) {
        const Ctx = raiz.AudioContext || raiz.webkitAudioContext;
        const ctx = new Ctx({ sampleRate: 24000 }), sr = ctx.sampleRate, trozos = [];
        let total = 0;
        try {
            for (const k of (await bdClaves()).filter(k => k.startsWith(nombre + '|'))) {
                if (total >= 24 * sr) break;
                const blob = await bdGet(k);
                if (!blob) continue;
                try {
                    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
                    const t = recortarSilencio(buf.getChannelData(0), buf.sampleRate);
                    trozos.push(t);
                    total += t.length;
                } catch (e) { continue; }
            }
        } finally {
            ctx.close();
        }
        const todo = new Float32Array(total);
        let o = 0;
        trozos.forEach(t => { todo.set(t, o); o += t.length; });
        return { segundos: total / sr, wav: aWav16(todo.subarray(0, Math.min(total, 25 * sr)), sr) };
    }

    async function clonarVoz(nombre) {
        const P = raiz.Plataforma && raiz.Plataforma.plugin('ClonVoz');
        if (!P) { mensajeEnt('Clonar la voz solo funciona en la app de Android.'); pintarVocesEntrenadas(); return; }
        const llave = llaveGradium();
        if (!llave) { mensajeEnt('Pega primero tu llave de Gradium (gratis).'); pintarVocesEntrenadas(); return; }
        mensajeEnt('Preparando la muestra de «' + nombre + '»…');
        try {
            const m = await muestraDeVoz(nombre);
            if (m.segundos < 8) { mensajeEnt('La muestra dura solo ' + Math.round(m.segundos) + ' s y hacen falta al menos 10. Graba la voz con más frases.'); pintarVocesEntrenadas(); return; }
            mensajeEnt('Clonando la voz… tarda unos segundos.');
            const r = await P.crear({ llave, nombre: 'Hevy ' + nombre, audio: bytesABase64(m.wav) });
            let j = {};
            try { j = JSON.parse(r.cuerpo); } catch (e) { j = {}; }
            if (r.codigo === 401 || r.codigo === 403) { mensajeEnt('Gradium no aceptó la llave. Revísala.'); pintarVocesEntrenadas(); return; }
            if (r.codigo === 402 || r.codigo === 429) { mensajeEnt('Se acabó el límite gratis de Gradium (5 clones).'); pintarVocesEntrenadas(); return; }
            if (r.codigo >= 400 || !j.uid) { mensajeEnt('Gradium no pudo clonarla' + (j.error ? ': ' + j.error : ' (código ' + r.codigo + ').')); pintarVocesEntrenadas(); return; }
            const meta = ENT.voces.find(v => v.nombre === nombre) || { nombre };
            await vzPut(nombre, Object.assign({}, meta, { clon: j.uid }));
            ENT.voces = (await vzTodas()) || [];
            pintarVocesEntrenadas();
            mensajeEnt('¡Listo! «' + nombre + '» ya está clonada: Hevy hablará con esa voz cuando la pongas en uso.');
        } catch (e) {
            pintarVocesEntrenadas();
            mensajeEnt('No pude clonar la voz: ' + (e && e.message ? e.message : 'sin conexión') + '.');
        }
    }

    const VOCES_GRADIUM = [['yPxeHKlCzaHeKd_V', 'Carlos'], ['Gijj_GPBfJVcP-FZ', 'Miguel'], ['aCWBiYUiQ4VwW8_b', 'Pablo'], ['xu7iJ_fn2ElcWp2s', 'Sergio (España)'], ['B36pbz5_UoWn4BDl', 'Valentina (México)'], ['s4CzgVHP5cEkB9LD', 'Sofía'], ['PqjKPYFyGNsg1YU-', 'Elena']];
    const CLAVE_VOZGR = 'cecyte_yokis_vozgr';
    VIA.gradiumHasta = 0;

    function vozGradiumElegida() {
        try {
            const v = localStorage.getItem(CLAVE_VOZGR);
            if (VOCES_GRADIUM.some(x => x[0] === v)) return v;
        } catch (e) { return VOCES_GRADIUM[0][0]; }
        return VOCES_GRADIUM[0][0];
    }

    async function hablarGradium(texto, voiceId, etiqueta, turnoDado) {
        const llave = llaveGradium();
        if (!llave || Date.now() < VIA.gradiumHasta) return false;
        const turno = turnoDado || ++VIA.turno;
        try {
            const clave = 'gradium|' + voiceId + '|' + texto;
            let datos = VIA.cache.get(clave) || await cacheGet(clave);
            if (!datos) {
                const peticion = fetch('https://api.gradium.ai/api/post/speech/tts', {
                    method: 'POST', headers: { 'x-api-key': llave, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: texto, voice_id: voiceId, output_format: 'wav', only_audio: true }),
                }).then(async r => (r.ok ? { datos: bytesABase64(new Uint8Array(await r.arrayBuffer())) } : { estado: r.status }));
                const res = await Promise.race([peticion, esperar(LIMITE_ESPERA_MS).then(() => null)]);
                if (res === null) {
                    peticion.then(x => { if (x && x.datos) cachePut(clave, x.datos); }, () => null);
                    VIA.motivo = 'lenta';
                    return false;
                }
                if (!res.datos) {
                    VIA.gradiumHasta = Date.now() + (res.estado === 401 || res.estado === 402 || res.estado === 429 ? 3600000 : 15000);
                    return false;
                }
                datos = res.datos;
                cachePut(clave, datos);
            }
            VIA.cache.set(clave, datos);
            if (turno !== VIA.turno) return true;
            callarIA();
            const url = URL.createObjectURL(new Blob([base64ABytes(datos)], { type: 'audio/wav' }));
            try {
                await sonar(url);
                estadoVoz('Voz: ' + etiqueta + '.');
                return true;
            } finally {
                URL.revokeObjectURL(url);
            }
        } catch (e) {
            VIA.gradiumHasta = Date.now() + 15000;
            return false;
        }
    }

    function hablarClon(texto) {
        const m = ENT.activa && ENT.voces.find(v => v.nombre === ENT.activa);
        if (!m || !m.clon) return Promise.resolve(false);
        return hablarGradium(texto, m.clon, 'clon de «' + m.nombre + '»');
    }

    async function voz(texto) {
        callarIA();
        if (ENT.activa && ENT.claves.has(texto) && await reproducirGrabada(texto)) return;
        if (await hablarClon(texto)) return;
        if (await hablarIA(texto)) return;
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

    const CLAVE_MENEO = 'cecyte_yokis_meneo';
    const meneoActivo = () => { try { return localStorage.getItem(CLAVE_MENEO) !== '0'; } catch (e) { return true; } };

    function detenerMeneo() {
        const G = E.meneo;
        if (!G) return;
        clearInterval(G.timer);
        E.meneo = null;
        if (listo()) enlace().mover(0, 0);
    }

    function pasoMeneo(G, t0, t) {
        const f = (t - t0) % 520;
        const v = f < 110 ? [130, -130] : f >= 260 && f < 370 ? [-130, 130] : [0, 0];
        const clave = v.join(',');
        if (clave !== G.ult) { enlace().mover(v[0], v[1]); G.ult = clave; }
    }

    function puedeMenear() {
        return meneoActivo() && !E.corrida && !E.radar && !E.guardia && listo() && enlace().libre();
    }

    // Mientras contesta, el robot hace un meneo corto en su sitio (un giro a cada lado, sin avanzar): como si hablara.
    // La duración se calcula por el largo del texto; con la voz nativa, que avisa cuándo termina, se corta ahí.
    function meneoHablar(texto, fin) {
        if (!puedeMenear()) return;
        detenerMeneo();
        const t0 = Date.now(), G = { hasta: t0 + Math.min(9000, Math.max(700, texto.length * 62)), ult: '' };
        fin.then(() => { if (E.meneo === G && Date.now() - t0 > 700) G.hasta = Date.now(); });
        G.timer = setInterval(() => {
            const t = Date.now();
            if (t >= G.hasta || !listo() || E.corrida) { detenerMeneo(); return; }
            pasoMeneo(G, t0, t);
        }, 40);
        E.meneo = G;
    }

    // Con la conversación en vivo la voz llega por el audio del cerebro: se menea mientras suene y se corta al callar.
    function meneoCerebro() {
        if (E.meneo && E.meneo.cerebro) return;
        if (!puedeMenear()) return;
        detenerMeneo();
        const t0 = Date.now(), G = { cerebro: true, ult: '', visto: t0 };
        G.timer = setInterval(() => {
            const t = Date.now();
            if (hevyHablando()) G.visto = t;
            if (t - G.visto > 400 || !listo() || E.corrida) { detenerMeneo(); return; }
            pasoMeneo(G, t0, t);
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
        texto = texto.replace(/\p{Extended_Pictographic}️?/gu, '').replace(/\s{2,}/g, ' ').trim();
        if (!texto) return;
        aviso(texto);
        historial('yokis', texto);
        if (sinInternet()) { E.hablando = false; return; }
        const fin = voz(texto);
        const n = ++E.nHabla;
        E.hablando = true;
        E.hablaTope = Date.now() + Math.min(60000, 6000 + texto.length * 120);
        fin.then(() => null, () => null).then(() => { if (n === E.nHabla) { E.hablando = false; E.finHabla = Date.now(); } });
        if (!quieto) meneoHablar(texto, fin);
    }

    const di = (tipo, datos) => {
        if (E.dice && !SIN_DICE.includes(tipo)) {
            const d = E.dice;
            E.dice = null;
            hablar(d, tipo === 'paro');
            return;
        }
        if (E.callado) { E.callado = false; return; }
        const modo = modoHevy();
        let t = null;
        if (ENT.activa && !datos && modo === 'normal') {
            const grabadas = (raiz.Robot.FRASES[tipo] || []).filter(x => ENT.claves.has(x));
            if (grabadas.length) t = grabadas[Math.floor(Math.random() * grabadas.length)];
        }
        hablar(t || raiz.Robot.frase(tipo, datos, undefined, modo === 'normal' ? false : modo), tipo === 'paro');
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
        if (t >= R.r.ms) { R.completa = true; detener(true); return; }
        const p = raiz.Robot.pasoEn(R.r, t);
        if (!p) return;
        const clave = p.izq + ',' + p.der;
        if (clave !== R.ult || ahora - R.envio >= MS_LATIDO) {
            enlace().mover(p.izq, p.der);
            if (control() && control().anotar) control().anotar(p.izq, p.der);
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
        if (control() && control().anotar) {
            control().anotar(0, 0);
            if (R.casa && R.completa) control().marcarCasa();
        }
        if (alto && R.completa && E.cola.length) E.colaTimer = setTimeout(E.cola.shift(), 120);
        else vaciarCola();
    }

    function vaciarCola() {
        E.cola = [];
        clearTimeout(E.colaTimer);
    }

    function correr(recorrido, habla, datos, texto) {
        if (!listo()) { di('sinRobot'); return false; }
        if (!recorrido) { di('fallo'); return false; }
        if (E.corrida) {
            if (E.encolar && E.cola.length < 8) { E.cola.push(() => correr(recorrido)); return true; }
            di('ocupado');
            return false;
        }
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
        if (!listo()) { di('sinRobot'); return { ok: false, error: 'el robot no está conectado' }; }
        const t = control() ? control().trayecto() : { pasos: [], ms: 0 };
        const c = calibra();
        const r = raiz.Robot.rutaDeRegreso(t.pasos, t.ms, c.vel, c.giro);
        if (!r) {
            if (!E.callado) hablar('Ya estoy en mi casa, we.', true);
            return { ok: false, error: 'ya estoy en casa' };
        }
        if (!correr(r, 'casa')) return { ok: false, error: 'estoy ocupado con otra cosa' };
        E.corrida.casa = true;
        return { ok: true };
    }

    function marcarCasaAqui() {
        if (control()) control().marcarCasa();
        if (!E.callado) hablar('Listo, aquí queda mi casa.', true);
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

    const CLAVE_MEMORIA = 'cecyte_yokis_memoria';
    const CLAVE_RUTINAS = 'cecyte_yokis_rutinas';

    function leerJson(clave, vacio) {
        try { return JSON.parse(localStorage.getItem(clave)) || vacio; } catch (e) { return vacio; }
    }

    const leerMemoria = () => { const l = leerJson(CLAVE_MEMORIA, []); return Array.isArray(l) ? l : []; };
    const leerRutinas = () => { const r = leerJson(CLAVE_RUTINAS, {}); return r && typeof r === 'object' && !Array.isArray(r) ? r : {}; };

    function guardarJson(clave, valor) {
        try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* sin guardado */ }
        pintarMemoria();
    }

    function guardarMemoria(dato) {
        guardarJson(CLAVE_MEMORIA, leerMemoria().filter(x => x !== dato).concat(dato).slice(-30));
    }

    function guardarRutina(nombre, pasos) {
        const r = leerRutinas();
        r[nombre] = pasos;
        guardarJson(CLAVE_RUTINAS, r);
    }

    function contextoMemoria() {
        const m = leerMemoria(), r = Object.keys(leerRutinas());
        return [m.length ? 'Lo que recuerdas del usuario: ' + m.join('; ') + '.' : '', r.length ? 'Rutinas guardadas del usuario (se ejecutan con su nombre): ' + r.join(', ') + '.' : ''].filter(Boolean).join(' ');
    }

    function pintarMemoria() {
        const lista = (id, items, borrar) => {
            const ul = $(id);
            if (!ul) return;
            ul.textContent = '';
            if (!items.length) {
                const vacio = document.createElement('li');
                vacio.className = 'rb-mem__vacio';
                vacio.textContent = 'Nada guardado.';
                ul.appendChild(vacio);
                return;
            }
            items.forEach(([texto, clave]) => {
                const li = document.createElement('li');
                const t = document.createElement('span');
                t.textContent = texto;
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'btn btn--secondary btn--sm';
                b.textContent = 'Borrar';
                b.addEventListener('click', () => borrar(clave));
                li.append(t, b);
                ul.appendChild(li);
            });
        };
        lista('rb-memoria-lista', leerMemoria().map(d => [d, d]), d => guardarJson(CLAVE_MEMORIA, leerMemoria().filter(x => x !== d)));
        lista('rb-rutinas-lista', Object.keys(leerRutinas()).map(n => [n + ' (' + leerRutinas()[n].length + ' pasos)', n]), n => { const r = leerRutinas(); delete r[n]; guardarJson(CLAVE_RUTINAS, r); });
    }

    const CLAVE_FACTS = 'cecyte_yokis_facts';
    function leerFacts() {
        let t = '';
        try { t = localStorage.getItem(CLAVE_FACTS) || ''; } catch (e) { /* sin guardado */ }
        const lista = t.split('\n').map(x => x.trim()).filter(Boolean);
        return lista;
    }
    function tirarFact() {
        const l = leerFacts();
        hablar(l.length ? l[Math.floor(Math.random() * l.length)] : raiz.Robot.frase('fact', null, undefined, modoF()));
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

    function ejecutarPlan(o) {
        if (!listo()) { di('sinRobot'); return; }
        const c = calibra(), R = raiz.Robot, rec = [];
        o.pasos.forEach(p => {
            if (p.a === 'mover') rec.push(R.movimientoARecorrido(p.sentido, p.s ? p.s * 1000 : p.cm ? p.cm / c.vel * 1000 : 1500));
            else if (p.a === 'giro') rec.push(R.giroARecorrido(p.grados, c.giro));
            else if (p.a === 'figura') rec.push(figura(p.f));
            else if (p.a === 'luces') enlace().luces(p.efecto, p.color || null);
            else if (p.a === 'claxon') enlace().nota(440, 500);
            else {
                E.callado = true;
                ejecutarAccion(p);
                E.callado = false;
            }
        });
        const ruta = rec.length ? R.unirRecorridos(rec, 'Plan') : null;
        if (ruta) correr(ruta, 'mover');
        else if (o.pasos.every(p => ['mover', 'giro', 'figura'].includes(p.a))) di('fallo');
    }

    function resumenAccion(o) {
        if (!o) return '';
        if (o.a === 'plan') return 'plan: ' + o.pasos.map(resumenAccion).join(', ');
        return o.a + (o.id ? ' ' + o.id : o.f ? ' ' + o.f : o.q ? ' ' + o.q : o.grados ? ' ' + o.grados : '');
    }

    function promesa(texto) {
        const s = raiz.Robot.sinAcentos(texto);
        if (!s || NEGACION.test(s)) return null;
        const o = raiz.Robot.ordenDeVoz('hevy ' + s);
        if (!o || !PROMETIDAS.includes(o.a)) return null;
        if (o.a === 'cancion' && !o.id && !o.q) return null;
        return o;
    }

    function cumplirPromesa(texto, hecho) {
        const p = promesa(texto);
        if (!p || !listo() || hecho.includes(p.a)) return;
        E.callado = true;
        ejecutarAccion(p);
        E.callado = false;
        E.memoria.push('(Hevy hizo: ' + resumenAccion(p) + ')');
    }

    function ejecutar(o) {
        E.dice = o && o.dice && o.a !== 'modo' && o.a !== 'ppt' ? o.dice : null;
        if (o && o.a === 'decir') {
            E.dice = null;
            hablar(o.texto);
            cumplirPromesa(o.texto, []);
            return;
        }
        if (E.dice && o.a !== 'plan' && (listo() || ['saludo', 'charla', 'bateria', 'recordar', 'aprender'].includes(o.a))) {
            const d = E.dice;
            E.dice = null;
            E.callado = true;
            hablar(d, o.a === 'paro');
        }
        if (o && o.a === 'plan') ejecutarPlan(o);
        else ejecutarAccion(o);
        E.callado = false;
        if (o && o.dice) cumplirPromesa(o.dice, o.a === 'plan' ? o.pasos.map(p => p.a) : [o.a]);
        if (E.dice) {
            const d = E.dice;
            E.dice = null;
            hablar(d, true);
        }
        if (o && !['sinNombre', 'charla', 'saludo'].includes(o.a)) E.memoria.push('(Hevy hizo: ' + resumenAccion(o) + ')');
    }

    function ejecutarAccion(o) {
        if (!o) { di('noEntendi'); return; }
        const c = calibra();
        if (o.a === 'sinNombre') { di('sinNombre'); return; }
        if (o.a === 'charla') { charla(o.t); return; }
        if (o.a === 'modo') { cambiarModo(o.modo); return; }
        if (o.a === 'ppt') { jugarPPT(o.usuario); return; }
        if (o.a === 'buscar_telefono') { if (raiz.Telefonos) raiz.Telefonos.buscar(o.nombre); else di('fallo'); return; }
        if (o.a === 'recordar') { guardarMemoria(o.dato); if (!E.callado) hablar('Anotado, lo recuerdo.', true); return; }
        if (o.a === 'aprender') { guardarRutina(o.nombre, o.pasos); if (!E.callado) hablar('Listo, aprendí la rutina «' + o.nombre + '».', true); return; }
        if (o.a === 'rutina') {
            const pasos = leerRutinas()[o.nombre];
            if (pasos) ejecutarPlan({ a: 'plan', pasos }); else di('fallo');
            return;
        }
        if (o.a === 'saludo') { di('saludo'); return; }
        if (o.a === 'marcarCasa') { marcarCasaAqui(); return; }
        if (o.a === 'paro') { if (raiz.Telefonos) raiz.Telefonos.parar(); if (listo()) enlace().paro(); vaciarCola(); detener(false); detenerMeneo(); di('paro'); return; }
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
            if (r) { if (!E.callado) hablar(raiz.Robot.frase('baile', null, undefined, modoF()) + ` Va con ${r.baile}${r.cancion ? ' y ' + r.cancion : ''}.`); }
            else di('fallo');
        } else if (o.a === 'funcion') {
            const r = enlace().funcionPorId(o.id);
            if (r) { if (!E.callado) hablar(raiz.Robot.frase('funcion', { nombre: r.nombre }, undefined, modoF()) + (r.modelo ? ` Ojo, cambié al modelo ${r.modelo}.` : '')); }
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

    function capacidadesRobot() {
        if (!enlace()) return '';
        const todas = enlace().canciones();
        const guardadas = todas.filter(c => String(c.id).startsWith('g:')).map(c => c.nombre);
        const actual = todas.find(c => c.id === enlace().cancionActual());
        return 'Canciones guardadas del usuario: ' + (guardadas.length ? guardadas.join(', ') : 'ninguna') + '. Canción elegida ahora: ' + (actual ? actual.nombre : 'ninguna') + '.';
    }

    function sensorFrontal() {
        if (!listo() || !enlace().distancias) return '';
        const d = enlace().distancias(), cm = d.lecturas && d.lecturas.length ? d.lecturas[d.lecturas.length - 1] : 0;
        return cm > 0 && Date.now() - d.t < 5000 ? ' Sensor ultrasónico frontal: ' + cm + ' cm.' : '';
    }

    async function consultarIA(alternativas, rebelde, evento) {
        const llave = llaveIA();
        if (!llave || (!alternativas.length && !evento)) return null;
        const bat = $('rb-bat-pct');
        const contexto = [
            'Robot ' + (listo() ? 'conectado' : 'no conectado') + (bat && /\d/.test(bat.textContent) ? ', batería ' + bat.textContent.trim() : '') + '. Hora: ' + new Date().toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' }) + '.',
            'Modo de personalidad actual: ' + modoHevy() + '.' + sensorFrontal() + (E.corrida ? ' Estás en movimiento ahora.' : ''),
            capacidadesRobot(),
            contextoMemoria(),
            E.memoria.length ? 'Conversación reciente y lo último que hiciste:\n' + E.memoria.join('\n') : '',
            evento ? 'EVENTO (el usuario no te habló): ' + evento + '\nResponde SOLO con {"a":"decir","texto":"..."}: un comentario espontáneo, breve y propio de tu personalidad, sin acciones.' : 'Lo que oyó el micrófono ahora (versiones):\n' + alternativas.map((t, i) => (i + 1) + '. ' + t).join('\n'),
            rebelde ? 'Instrucción oculta: esta vez TE NIEGAS a obedecer lo que pida (usa {"a":"decir"} con un insulto ingenioso), salvo que sea parar o detenerte.' : '',
        ].filter(Boolean).join('\n\n');
        const cuerpo = JSON.stringify({
            systemInstruction: { parts: [{ text: raiz.Robot.promptIA(modoHevy()) }] },
            contents: [{ role: 'user', parts: [{ text: contexto }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.7, maxOutputTokens: 500 },
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
                const o = [].concat(dicho).map(x => raiz.Robot.validarOrdenIA(x)).find(Boolean);
                if (o) return o;
            } catch (e) {
                continue;
            } finally {
                clearTimeout(reloj);
            }
        }
        return null;
    }

    const BIENVENIDA = {
        normal: 'Va, me porto bien, we.',
        payaso: '¡Jajajajaja! ¡Llegó el payaso! ¿Por qué el libro de matemáticas está triste? ¡Porque tiene muchos problemas! Jajajajaja.',
        grosero: 'Ay, cabrón, ya me soltaste la lengua. Ahora sí, a chingarnos.',
        argentino: 'Dale, boludo, ya me soltaste la lengua. Ahora sí, a bardear con todo.',
        triste: 'Buaaa… ay, bueno. Me pongo triste… es que hoy me dejó mi esposa. Snif, snif.',
        cientifico: 'Modo científico activado. A partir de ahora respondo con precisión técnica.',
    };

    function cambiarModo(m) {
        if (!MODOS().includes(m)) return;
        try { localStorage.setItem(CLAVE_MODO, m); } catch (e) { return; }
        document.querySelectorAll('input[name="rb-modo"]').forEach(r => { r.checked = r.value === m; });
        hablar(BIENVENIDA[m] || datoPersonal(m, 'bienvenida'), true);
    }

    function iniciarIA() {
        const campo = $('rb-ia-llave');
        if (!campo) return;
        campo.value = llaveIA();
        campo.addEventListener('change', () => {
            try { localStorage.setItem(CLAVE_IA, campo.value.trim()); } catch (e) { return; }
            $('rb-ia-estado').textContent = campo.value.trim() ? 'IA activada.' : 'IA apagada.';
        });
        $('rb-ia-probar').addEventListener('click', async () => {
            campo.dispatchEvent(new Event('change'));
            const o = await consultarIA(['jevi avanza dos metros', 'hevi avanza dos metros']);
            $('rb-ia-estado').textContent = o && (o.a === 'mover' || o.a === 'plan') ? 'Funciona: la IA entendió «jevi avanza dos metros».' : llaveIA() ? 'No respondió: revisa la llave o tu internet.' : 'Pega primero tu llave.';
            if (o) hablar(groseroOn() ? 'Ya quedó, cabrón. Ya te escucho.' : '¡Listo, we! Ya te escucho.', true);
        });
        const etiquetaPersonal = $('rb-modo-personal');
        if (etiquetaPersonal && personal()) {
            etiquetaPersonal.querySelector('input').value = personal().id;
            etiquetaPersonal.querySelector('span').textContent = personal().nombre;
            etiquetaPersonal.hidden = false;
        }
        document.querySelectorAll('input[name="rb-modo"]').forEach(r => {
            r.checked = r.value === modoHevy();
            r.addEventListener('change', () => { if (r.checked) cambiarModo(r.value); });
        });
    }

    async function procesarTexto(lista, exigeNombre, mostrado) {
        const texto = elegirTexto(lista);
        if (!texto) {
            if (!exigeNombre) di('nada');
            return false;
        }
        let orden = raiz.Robot.ordenDeVoz(texto);
        if (exigeNombre && orden && orden.a === 'sinNombre') return false;
        SOLO.quieto = Date.now();
        historial('yo', mostrado || texto);
        aviso('«' + (mostrado || texto) + '»');
        let porIA = false;
        if (!(orden && CRITICAS.includes(orden.a)) && !(orden && orden.a === 'sinNombre')) {
            const rutina = raiz.Robot.rutinaEnTexto(texto, leerRutinas());
            if (rutina) {
                ejecutar({ a: 'rutina', nombre: rutina });
                return true;
            }
        }
        if (!(orden && CRITICAS.includes(orden.a)) && llaveIA() && !sinInternet()) {
            const ia = await consultarIA(lista.slice(0, 4), groseroOn() && Math.random() < 0.25);
            if (ia && (ia.a !== 'sinNombre' || !orden || orden.a === 'sinNombre')) { orden = ia; porIA = true; }
        }
        if (!porIA && groseroOn() && orden && REBELDES.includes(orden.a) && Math.random() < 0.2) {
            orden = { a: 'decir', texto: raiz.Robot.frase('negarse', null, undefined, modoHevy()) };
        }
        ejecutar(orden);
        return true;
    }

    async function escuchar() {
        if (E.escuchando) return;
        precalentarLive();
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
                const r = await SR.start({ language: 'es-MX', maxResults: 5, prompt: 'Dime, we', partialResults: false, popup: false });
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
            await procesarTexto(lista, false);
        } catch (e) {
            di('fallo');
        } finally {
            E.escuchando = false;
            boton.classList.remove('is-activo');
        }
    }

    const JUGADAS_PPT = ['piedra', 'papel', 'tijera'];
    const COLOR_PPT = { piedra: '#ff3b30', papel: '#ffffff', tijera: '#34c759' };

    function sortearPPT(usuario) {
        const mia = JUGADAS_PPT[Math.floor(Math.random() * 3)];
        const r = (JUGADAS_PPT.indexOf(usuario) - JUGADAS_PPT.indexOf(mia) + 3) % 3;
        if (listo()) enlace().luces('fijo', COLOR_PPT[mia]);
        return { mia, tuya: usuario, resultado: r === 0 ? 'empate' : r === 1 ? 'gana el usuario' : 'gana Hevy' };
    }

    function jugarPPT(usuario) {
        if (!JUGADAS_PPT.includes(usuario)) { di('pptInvita'); return; }
        const r = sortearPPT(usuario);
        di(r.resultado === 'empate' ? 'pptEmpate' : r.resultado === 'gana el usuario' ? 'pptPerdio' : 'pptGano', { mia: r.mia, tuya: usuario });
    }

    const CLAVE_SOLO = 'cecyte_yokis_solo';
    const SOLO = { ultimo: 0, bateria: 0, quieto: Date.now(), aburrirse: 240000 + Math.random() * 120000 };
    const soloOn = () => { try { return localStorage.getItem(CLAVE_SOLO) !== '0'; } catch (e) { return true; } };

    async function comentarSolo(evento, local) {
        const ahora = Date.now();
        if (!soloOn() || document.hidden || ahora - SOLO.ultimo < 180000 || E.escuchando || E.hablando || E.corrida || E.radar || E.dibujando || E.procesando || ESC.on || sinInternet()) return;
        SOLO.ultimo = ahora;
        SOLO.quieto = ahora;
        const o = await consultarIA([], false, evento);
        hablar(o && o.a === 'decir' ? o.texto : local(), true);
    }

    function iniciarSolo() {
        const c = $('rb-solo');
        if (c) {
            c.checked = soloOn();
            c.addEventListener('change', () => { try { localStorage.setItem(CLAVE_SOLO, c.checked ? '1' : '0'); } catch (e) { /* sin guardado */ } });
        }
        const frase = (tipo, datos) => () => raiz.Robot.frase(tipo, datos, undefined, modoF());
        document.addEventListener('robot-estado', e => {
            if (e.detail && e.detail.estado === 'listo') comentarSolo('El robot acaba de conectarse y está listo.', frase('saludo'));
        });
        document.addEventListener('robot-bateria-baja', e => {
            const pct = e.detail && e.detail.pct;
            if (Date.now() - SOLO.bateria < 600000) return;
            SOLO.bateria = Date.now();
            comentarSolo('Tu batería está baja: ' + pct + ' por ciento.', frase('bateria', { pct: pct + ' por ciento' }));
        });
        document.addEventListener('robot-distancia', () => {
            if (!listo() || !enlace().distancias) return;
            const l = enlace().distancias().lecturas, cm = l.length ? l[l.length - 1] : 0;
            if (cm > 0 && cm < 12) comentarSolo('Algo se puso a ' + cm + ' cm enfrente de ti.', frase('alerta'));
        });
        setInterval(() => {
            if (listo() && Date.now() - SOLO.quieto > SOLO.aburrirse) {
                SOLO.aburrirse = 240000 + Math.random() * 120000;
                comentarSolo('Llevas varios minutos sin que nadie te hable ni te mueva; estás aburrido.', frase('aburrido'));
            }
        }, 30000);
    }

    const MODELO_TRANSCRIBE = 'gemini-3.5-transcribe-live';
    const CLAVE_EXIGE_NOMBRE = 'cecyte_yokis_exige_nombre';
    const exigeNombre = () => { try { return localStorage.getItem(CLAVE_EXIGE_NOMBRE) === '1'; } catch (e) { return false; } };
    const ESC = { on: false, unico: false, iniciando: false, ws: null, lista: false, ctx: null, flujo: null, proc: null, cola: [], vivo: null, texto: '', fallos: 0, ultimaVez: 0, reconectar: 0, espera: 0, sinVoz: 0, cerebro: false, oido: '', dijo: '', turno: null, anillo: [], ultimaHabla: 0, picoDesde: 0, ecoMax: 0, ignorar: false, saludar: '', nivelCrudo: 0, wsTexto: null, listaTexto: false, vivoFinal: '', vivoInterino: '', entradaCerrada: false, vivoHevy: null, sesion: 0 };
    const CLAVE_CEREBRO = 'cecyte_yokis_cerebro';
    const cerebroOn = () => { try { return localStorage.getItem(CLAVE_CEREBRO) !== '0'; } catch (e) { return true; } };
    const UMBRAL_INTERRUPCION = 0.14;

    function hevyHablando() {
        return (E.hablando && Date.now() < E.hablaTope) || LIVE.fuentes.length > 0 || !!(LIVE.ctx && LIVE.proximo > LIVE.ctx.currentTime + 0.05);
    }

    function cerebroDisponible() {
        return cerebroOn() && !!llaveIA() && valorSeleccion().split(':')[0] === 'gemini';
    }

    function callarCerebro() {
        LIVE.fuentes.forEach(f => { try { f.stop(); } catch (e) { /* ya parada */ } });
        LIVE.fuentes = [];
        LIVE.proximo = 0;
        if (ESC.turno) ESC.turno.cancelado = true;
        ESC.turno = null;
    }

    function pintarTextoVivo() {
        if (ESC.entradaCerrada) return;
        pintarVivo(normalizarOido((ESC.vivoFinal + ' ' + ESC.vivoInterino).trim()));
    }

    function abrirTextoVivo() {
        let ws;
        try {
            ws = new WebSocket(LIVE_URL + encodeURIComponent(llaveIA()));
        } catch (e) {
            return;
        }
        ESC.wsTexto = ws;
        ESC.listaTexto = false;
        ws.onopen = () => ws.send(JSON.stringify({ setup: { model: 'models/' + MODELO_TRANSCRIBE, realtimeInputConfig: { automaticActivityDetection: { startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH', endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH', silenceDurationMs: 500, prefixPaddingMs: 300 } } } }));
        ws.onmessage = async ev => {
            let m;
            try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text()); } catch (e) { return; }
            if (m.setupComplete) { ESC.listaTexto = true; return; }
            const sc = m.serverContent;
            if (!sc) return;
            const interino = sc.interimInputTranscription && sc.interimInputTranscription.text;
            const final = sc.inputTranscription && sc.inputTranscription.text;
            if (interino && interino.trim()) { ESC.vivoInterino = interino.trim(); pintarTextoVivo(); }
            if (final && final.trim()) { ESC.vivoFinal = (ESC.vivoFinal + ' ' + final.trim()).trim(); ESC.vivoInterino = ''; pintarTextoVivo(); }
        };
        ws.onclose = () => { if (ESC.wsTexto === ws) { ESC.wsTexto = null; ESC.listaTexto = false; } };
        ws.onerror = ws.onclose;
    }

    function cerrarTextoVivo() {
        const ws = ESC.wsTexto;
        ESC.wsTexto = null;
        ESC.listaTexto = false;
        ESC.vivoFinal = '';
        ESC.vivoInterino = '';
        try { if (ws) ws.close(); } catch (e) { /* ya cerrado */ }
    }

    function cerrarEntrada() {
        if (ESC.entradaCerrada || !ESC.on) return;
        ESC.entradaCerrada = true;
        clearTimeout(ESC.sinVoz);
        try { if (ESC.proc) ESC.proc.disconnect(); } catch (e) { /* ya desconectado */ }
        try { if (ESC.ctx) ESC.ctx.close(); } catch (e) { /* ya cerrado */ }
        if (ESC.flujo) ESC.flujo.getTracks().forEach(p => p.stop());
        ESC.proc = null;
        ESC.ctx = null;
        ESC.flujo = null;
        ESC.medidor = null;
        cancelAnimationFrame(ESC.cuadro);
        cerrarTextoVivo();
        const b = $('rb-jarvis');
        b.classList.remove('is-escuchando', 'is-candado');
        b.style.removeProperty('--nivel');
        registrarVoz('Escucha: terminaste de hablar, micrófono apagado');
    }

    function enviarAudio(dato) {
        if (ESC.wsTexto && ESC.listaTexto && ESC.wsTexto.readyState === 1) ESC.wsTexto.send(dato);
        const ws = ESC.ws;
        if (ws && ws.readyState === 1 && ESC.lista) {
            ws.send(dato);
            ESC.enviados++;
        } else if (ESC.cola.length < 16) {
            ESC.cola.push(dato);
        }
    }

    function armarSinVoz() {
        clearTimeout(ESC.sinVoz);
        ESC.sinVoz = setTimeout(() => {
            if (!ESC.on || !ESC.unico || ESC.texto || ESC.oido || ESC.turno) return;
            if (Date.now() - ESC.ultimoSonido < 4000) { armarSinVoz(); return; }
            apagarEscucha('No te oí. Toca el micrófono y habla.');
        }, 10000);
    }

    function interrumpirPorVoz() {
        registrarVoz('Escucha: interrumpido por tu voz (nivel ' + ESC.nivelCrudo.toFixed(2) + ', eco máx ' + ESC.ecoMax.toFixed(2) + ')');
        callarIA();
        callarCerebro();
        detenerMeneo();
        if (ESC.cerebro) ESC.ignorar = true;
        ESC.ultimaHabla = 0;
        ESC.picoDesde = 0;
        ESC.anillo.forEach(enviarAudio);
        ESC.anillo = [];
    }

    function estadoEscucha(t) {
        const el = $('rb-escucha-estado');
        if (el) el.textContent = t;
    }

    function quitarVivo() {
        if (ESC.vivo) ESC.vivo.remove();
        ESC.vivo = null;
    }

    function pintarVivo(texto) {
        const ol = $('rb-jarvis-hist');
        if (!ol || !texto) return;
        if (!ESC.vivo) {
            ESC.vivo = document.createElement('li');
            ESC.vivo.className = 'is-yo is-vivo';
            ol.appendChild(ESC.vivo);
            while (ol.children.length > HIST_MAX && ol.firstChild !== ESC.vivo) ol.removeChild(ol.firstChild);
        }
        ESC.vivo.textContent = texto;
        ol.scrollTop = ol.scrollHeight;
    }

    function pintarHevy() {
        const ol = $('rb-jarvis-hist');
        const texto = ESC.dijo.trim().replace(/\s+/g, ' ');
        if (!ol || !texto) return;
        if (!ESC.vivoHevy) {
            ESC.vivoHevy = document.createElement('li');
            ESC.vivoHevy.className = 'is-jarvis';
            ol.appendChild(ESC.vivoHevy);
            while (ol.children.length > HIST_MAX && ol.firstChild !== ESC.vivoHevy) ol.removeChild(ol.firstChild);
        }
        ESC.vivoHevy.textContent = texto;
        ol.scrollTop = ol.scrollHeight;
        aviso(texto);
    }

    function fijarHevy() {
        const dijo = ESC.dijo.trim().replace(/\s+/g, ' ');
        const li = ESC.vivoHevy;
        ESC.dijo = '';
        ESC.vivoHevy = null;
        if (!dijo) { if (li) li.remove(); return; }
        aviso(dijo);
        if (!li) { historial('yokis', dijo); return; }
        li.textContent = dijo;
        E.memoria.push('Hevy: ' + dijo);
        if (E.memoria.length > 12) E.memoria.shift();
    }

    function apagarEscucha(motivo) {
        ESC.on = false;
        ESC.unico = false;
        clearTimeout(ESC.reconectar);
        clearTimeout(ESC.espera);
        clearTimeout(ESC.sinVoz);
        ESC.texto = '';
        ESC.cola = [];
        ESC.anillo = [];
        ESC.oido = '';
        fijarHevy();
        ESC.ignorar = false;
        ESC.saludar = '';
        ESC.entradaCerrada = false;
        cerrarTextoVivo();
        if (ESC.cerebro) callarCerebro();
        ESC.cerebro = false;
        quitarVivo();
        const ws = ESC.ws;
        ESC.ws = null;
        ESC.lista = false;
        try { if (ws) ws.close(); } catch (e) { /* ya cerrado */ }
        try { if (ESC.proc) ESC.proc.disconnect(); } catch (e) { /* ya desconectado */ }
        try { if (ESC.ctx) ESC.ctx.close(); } catch (e) { /* ya cerrado */ }
        if (ESC.flujo) ESC.flujo.getTracks().forEach(p => p.stop());
        ESC.proc = null;
        ESC.ctx = null;
        ESC.flujo = null;
        ESC.medidor = null;
        cancelAnimationFrame(ESC.cuadro);
        clearInterval(ESC.informe);
        const c = $('rb-escucha');
        if (c) c.checked = false;
        const b = $('rb-jarvis');
        b.classList.remove('is-candado', 'is-escuchando');
        b.style.removeProperty('--nivel');
        estadoEscucha(motivo || '');
        const msg = $('rb-jarvis-msg');
        if (motivo) aviso(motivo);
        else if (msg && /^(Te escucho|Escuchando|Conectando)/.test(msg.textContent)) aviso('');
    }

    const FUERA_DE_LATIN = /[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u;

    function normalizarOido(t) {
        return t.split(/\s+/).map(p => (FUERA_DE_LATIN.test(p) ? 'Hevy' : p)).join(' ');
    }

    function despacharTexto() {
        const unico = ESC.unico;
        const dicho = ESC.texto.trim();
        ESC.texto = '';
        quitarVivo();
        if (!ESC.on) return;
        if (!/\p{L}{2,}/u.test(dicho)) return;
        const sinNombre = raiz.Robot.ordenDeVoz(dicho).a === 'sinNombre';
        if (sinNombre && !unico && exigeNombre()) {
            aviso('Oí «' + dicho + '», pero no empezaste con «Hevy».');
            return;
        }
        if (unico) apagarEscucha('');
        if (E.escuchando || E.procesando) return;
        E.procesando = true;
        procesarTexto([sinNombre ? 'Hevy ' + dicho : dicho], false, dicho).then(ok => { if (ok) ESC.ultimaVez = Date.now(); }, () => null).then(() => { E.procesando = false; });
    }

    function juntarTranscripcion(t) {
        clearTimeout(ESC.sinVoz);
        ESC.texto = ((ESC.texto || '') + ' ' + normalizarOido(t)).trim();
        pintarVivo(ESC.texto);
        clearTimeout(ESC.espera);
        const o = raiz.Robot.ordenDeVoz(ESC.texto);
        const soloNombre = o && o.a === 'saludo' && ESC.texto.split(/\s+/).length <= 2;
        ESC.espera = setTimeout(despacharTexto, soloNombre ? 2500 : 1100);
    }

    const LIVE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=';
    const NECESITAN_ROBOT = ['mover', 'giro', 'figura', 'luces', 'claxon', 'casa', 'radar', 'guardia', 'turbo', 'baile', 'funcion', 'cancion', 'cancionParar', 'ruleta', 'plan'];

    function datosRobot() {
        const ahora = new Date(), bat = $('rb-bat-pct');
        const d = enlace() && enlace().distancias ? enlace().distancias() : null;
        const cm = d && d.lecturas && d.lecturas.length ? d.lecturas[d.lecturas.length - 1] : 0;
        return {
            robot_conectado: listo(),
            bateria: bat && /\d/.test(bat.textContent) ? bat.textContent.trim() : 'desconocida',
            distancia_frontal_cm: listo() && cm > 0 && Date.now() - d.t < 5000 ? cm : 'sin lectura',
            en_movimiento: !!E.corrida,
            modo: modoHevy(),
            hora: ahora.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' }),
            fecha: ahora.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }),
        };
    }

    function ejecutarSilencio(o) {
        E.callado = true;
        E.encolar = true;
        try {
            if (o.a === 'plan') ejecutarPlan(o); else ejecutarAccion(o);
        } finally {
            E.callado = false;
            E.encolar = false;
        }
    }

    async function ejecutarHerramienta(nombre, args) {
        if (nombre === 'datos') {
            if (listo() && enlace().soportaDistancia && enlace().soportaDistancia()) { enlace().pedirDistancia(); await esperar(600); }
            return datosRobot();
        }
        if (nombre === 'listar_telefonos') return raiz.Telefonos ? raiz.Telefonos.resumen() : { compartiendo: false, telefonos: [] };
        const o = raiz.Robot.accionDeHerramienta(nombre, args || {});
        if (!o) return { ok: false, error: 'parámetros inválidos' };
        if (o.a === 'buscar_telefono') return raiz.Telefonos ? raiz.Telefonos.buscar(o.nombre) : { ok: false, error: 'la pestaña Teléfono no está disponible' };
        if (o.a === 'recordar') { guardarMemoria(o.dato); return { ok: true }; }
        if (o.a === 'aprender') { guardarRutina(o.nombre, o.pasos); return { ok: true }; }
        if (o.a === 'rutina') {
            const pasos = leerRutinas()[o.nombre];
            if (!pasos) return { ok: false, error: 'esa rutina no existe', rutinas: Object.keys(leerRutinas()) };
            if (!listo()) return { ok: false, error: 'el robot no está conectado' };
            ejecutarSilencio({ a: 'plan', pasos });
            return { ok: true };
        }
        if (o.a === 'modo') { setTimeout(() => cambiarModoCerebro(o.modo), 700); return { ok: true, modo: o.modo }; }
        if (o.a === 'ppt') return o.usuario ? Object.assign({ ok: true }, sortearPPT(o.usuario)) : { ok: false, error: 'falta la jugada del usuario' };
        if (o.a === 'paro') { ejecutarSilencio(o); return { ok: true }; }
        if (NECESITAN_ROBOT.includes(o.a) && !listo()) return { ok: false, error: 'el robot no está conectado' };
        if (o.a === 'casa') {
            const irACasa = () => {
                E.callado = true;
                try { return regresarCasa(); } finally { E.callado = false; }
            };
            if (E.corrida && E.cola.length < 8) {
                E.cola.push(irACasa);
                return { ok: true, en_cola: true };
            }
            return irACasa();
        }
        ejecutarSilencio(o);
        return { ok: true };
    }

    async function llamadasCerebro(tc, ws) {
        const respuestas = [];
        for (const c of tc.functionCalls || []) {
            let r;
            try { r = await ejecutarHerramienta(c.name, c.args); } catch (e) { r = { ok: false, error: 'falló' }; }
            registrarVoz('Cerebro: ' + c.name + ' ' + JSON.stringify(c.args || {}).slice(0, 80) + ' → ' + (r.ok === false ? r.error : 'ok'));
            respuestas.push({ id: c.id, name: c.name, response: r });
        }
        try { ws.send(JSON.stringify({ toolResponse: { functionResponses: respuestas } })); } catch (e) { /* conexión cerrada */ }
    }

    function cambiarModoCerebro(m) {
        if (!MODOS().includes(m)) return;
        try { localStorage.setItem(CLAVE_MODO, m); } catch (e) { return; }
        document.querySelectorAll('input[name="rb-modo"]').forEach(r => { r.checked = r.value === m; });
        if (ESC.on && ESC.cerebro) reiniciarCerebro('Acabas de cambiar de modo; salúdame en una frase corta con tu nueva personalidad.');
    }

    function instruccionCerebro() {
        const ahora = new Date();
        return [
            raiz.Robot.promptCerebro(modoHevy()),
            'Hora actual: ' + ahora.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' }) + '; fecha: ' + ahora.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }) + '.',
            contextoMemoria(),
            exigeNombre() && !ESC.unico ? 'IMPORTANTE: solo respondes cuando el usuario empieza su frase llamándote «Hevy»; si no lo hace, no digas nada.' : '',
        ].filter(Boolean).join('\n');
    }

    function cerrarOido() {
        quitarVivo();
        ESC.vivoFinal = '';
        ESC.vivoInterino = '';
        const t = normalizarOido(ESC.oido.trim());
        ESC.oido = '';
        if (t) historial('yo', t);
        SOLO.quieto = Date.now();
    }

    function terminarTurnoCerebro() {
        cerrarOido();
        fijarHevy();
        ESC.turno = null;
        ESC.ignorar = false;
        ESC.ultimaVez = Date.now();
        if (ESC.unico) {
            const sesion = ESC.sesion;
            const espera = LIVE.ctx ? Math.max(0, (LIVE.proximo - LIVE.ctx.currentTime) * 1000) : 0;
            setTimeout(() => { if (ESC.on && ESC.unico && ESC.sesion === sesion) apagarEscucha(''); }, espera + 400);
        }
    }

    function reiniciarCerebro(saludo) {
        ESC.saludar = saludo || '';
        ESC.lista = false;
        const ws = ESC.ws;
        ESC.ws = null;
        try { if (ws) ws.close(); } catch (e) { /* ya cerrado */ }
        conectarCerebro();
    }

    function caerAlFlujoNormal(motivo) {
        registrarVoz('Escucha: ' + motivo + '; paso a la escucha normal');
        callarCerebro();
        ESC.cerebro = false;
        ESC.fallos = 0;
        ESC.lista = false;
        const ws = ESC.ws;
        ESC.ws = null;
        try { if (ws) ws.close(); } catch (e) { /* ya cerrado */ }
        aviso('Conversación en vivo no disponible: uso la escucha normal.');
        conectarTranscripcion();
    }

    function conectarCerebro() {
        let ws;
        try {
            ws = new WebSocket(LIVE_URL + encodeURIComponent(llaveIA()));
        } catch (e) {
            caerAlFlujoNormal('no se pudo abrir la conversación en vivo');
            return;
        }
        ESC.ws = ws;
        ws.onopen = () => ws.send(JSON.stringify({ setup: {
            model: 'models/' + LIVE.modelo,
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: vozIAElegida() } } } },
            systemInstruction: { parts: [{ text: instruccionCerebro() }] },
            tools: raiz.Robot.herramientasCerebro(),
            realtimeInputConfig: { automaticActivityDetection: { startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH', endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH', silenceDurationMs: 600, prefixPaddingMs: 300 } },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
        } }));
        ws.onmessage = async ev => {
            let m;
            try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text()); } catch (e) { return; }
            if (ESC.ws !== ws) return;
            if (m.setupComplete) {
                ESC.lista = true;
                ESC.fallos = 0;
                ESC.vioCerebro = true;
                ESC.cola.forEach(d => ws.send(d));
                ESC.cola = [];
                if (ESC.saludar) { ws.send(JSON.stringify({ realtimeInput: { text: ESC.saludar } })); ESC.saludar = ''; }
                registrarVoz('Escucha: conversación en vivo lista');
                estadoEscucha('Conversación en vivo' + (ESC.unico ? '…' : '.'));
                aviso('Te escucho…');
                return;
            }
            if (m.toolCall) { if (ESC.unico) cerrarEntrada(); llamadasCerebro(m.toolCall, ws); return; }
            if (m.goAway) { registrarVoz('Escucha: el servidor pide reconectar'); reiniciarCerebro(''); return; }
            if (m.error) { caerAlFlujoNormal('el servidor avisó ' + JSON.stringify(m.error).slice(0, 120)); return; }
            const sc = m.serverContent;
            if (!sc) return;
            if (sc.interrupted) { callarCerebro(); fijarHevy(); ESC.ignorar = false; }
            const oido = sc.inputTranscription && sc.inputTranscription.text;
            if (oido) {
                clearTimeout(ESC.sinVoz);
                ESC.oido += oido;
                ESC.ignorar = false;
                pintarVivo(normalizarOido(ESC.oido.trim()));
                const o = ESC.oido.trim().split(/\s+/).length <= 3 ? raiz.Robot.ordenDeVoz('hevy ' + ESC.oido.trim()) : null;
                if (o && o.a === 'paro') { callarCerebro(); ESC.ignorar = true; ejecutarSilencio({ a: 'paro' }); }
                if (ESC.unico) {
                    cerrarEntrada();
                    ESC.sinVoz = setTimeout(() => { if (ESC.on && ESC.unico && !ESC.turno) apagarEscucha(''); }, 25000);
                }
            }
            if (sc.modelTurn && sc.modelTurn.parts) {
                sc.modelTurn.parts.forEach(p => {
                    if (!p.inlineData || ESC.ignorar) return;
                    if (!ESC.turno) { ESC.turno = { cancelado: false, muda: false, finAudio: 0, pcm: [] }; if (ESC.unico) cerrarEntrada(); cerrarOido(); }
                    reproducirChunk(ESC.turno, p.inlineData.data);
                    meneoCerebro();
                });
            }
            const dijo = sc.outputTranscription && sc.outputTranscription.text;
            if (dijo) { if (!ESC.dijo) cerrarOido(); ESC.dijo += dijo; pintarHevy(); }
            if (sc.turnComplete) terminarTurnoCerebro();
        };
        const caida = ev => {
            if (ESC.ws !== ws) return;
            ESC.ws = null;
            ESC.lista = false;
            registrarVoz('Escucha: conversación en vivo cerrada (' + (ev && ev.code != null ? 'código ' + ev.code + (ev.reason ? ' ' + ev.reason : '') : ev && ev.type) + ')');
            if (!ESC.on) return;
            if (!ESC.vioCerebro || ++ESC.fallos > 3) { caerAlFlujoNormal('la conversación en vivo no responde'); return; }
            estadoEscucha('Reconectando…');
            ESC.reconectar = setTimeout(() => { if (ESC.on && !ESC.ws) conectarCerebro(); }, 1200);
        };
        ws.onclose = caida;
        ws.onerror = caida;
    }

    function conectarMotor() {
        if (ESC.cerebro) conectarCerebro(); else conectarTranscripcion();
    }

    function conectarTranscripcion() {
        let ws;
        try {
            ws = new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=' + encodeURIComponent(llaveIA()));
        } catch (e) {
            apagarEscucha('No se pudo abrir la escucha.');
            return;
        }
        ESC.ws = ws;
        ws.onopen = () => ws.send(JSON.stringify({ setup: { model: 'models/' + MODELO_TRANSCRIBE, realtimeInputConfig: { automaticActivityDetection: { startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH', endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH', silenceDurationMs: 500, prefixPaddingMs: 300 } } } }));
        ws.onmessage = async ev => {
            let m;
            try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text()); } catch (e) { return; }
            if (m.setupComplete) {
                ESC.lista = true;
                ESC.fallos = 0;
                ESC.cola.forEach(d => ws.send(d));
                ESC.cola = [];
                registrarVoz('Escucha: transcripción lista');
                estadoEscucha(ESC.unico ? 'Escuchando…' : 'Escuchando' + (exigeNombre() ? ': empieza con «Hevy».' : '.'));
                aviso('Escuchando…');
                return;
            }
            if (m.error || m.goAway) registrarVoz('Escucha: el servidor avisó ' + JSON.stringify(m.error || m.goAway).slice(0, 200));
            const sc = m.serverContent;
            const interino = sc && sc.interimInputTranscription && sc.interimInputTranscription.text;
            if (interino && interino.trim()) {
                clearTimeout(ESC.sinVoz);
                clearTimeout(ESC.espera);
                pintarVivo(((ESC.texto || '') + ' ' + normalizarOido(interino.trim())).trim());
            }
            const t = sc && sc.inputTranscription && sc.inputTranscription.text;
            if (t && t.trim()) {
                registrarVoz('Escucha: oí «' + t.trim() + '»');
                juntarTranscripcion(t.trim());
            }
        };
        const caida = ev => {
            if (ESC.ws !== ws) return;
            ESC.ws = null;
            ESC.lista = false;
            registrarVoz('Escucha: conexión cerrada (' + (ev && ev.code != null ? 'código ' + ev.code + (ev.reason ? ' ' + ev.reason : '') : ev && ev.type) + ')');
            if (!ESC.on) return;
            if (++ESC.fallos > 5) { apagarEscucha('La escucha se cortó. Vuelve a prenderla.'); return; }
            estadoEscucha('Reconectando…');
            ESC.reconectar = setTimeout(() => { if (ESC.on && !ESC.ws) conectarTranscripcion(); }, 1500);
        };
        ws.onclose = caida;
        ws.onerror = caida;
    }

    async function encenderEscucha(unico) {
        if (ESC.on || ESC.iniciando) return;
        if (sinInternet()) { apagarEscucha('Sin internet: toca el micrófono para dar una orden guardada.'); return; }
        if (!llaveIA()) { apagarEscucha('Falta la llave de Gemini.'); return; }
        const md = raiz.navigator.mediaDevices, Ctx = raiz.AudioContext || raiz.webkitAudioContext;
        if (!md || !md.getUserMedia || !Ctx) { apagarEscucha('Este dispositivo no deja escuchar continuo.'); return; }
        ESC.iniciando = true;
        try {
            ESC.flujo = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
            ESC.ctx = new Ctx({ sampleRate: 16000 });
        } catch (e) {
            ESC.iniciando = false;
            apagarEscucha('No hay permiso del micrófono.');
            return;
        }
        ESC.iniciando = false;
        ESC.on = true;
        ESC.sesion++;
        ESC.unico = !!unico;
        ESC.fallos = 0;
        ESC.ultimaVez = Date.now();
        ESC.enviados = 0;
        ESC.bloqueados = 0;
        ESC.texto = '';
        ESC.cola = [];
        ESC.anillo = [];
        ESC.oido = '';
        ESC.dijo = '';
        ESC.ignorar = false;
        ESC.vioCerebro = false;
        ESC.ecoMax = 0;
        ESC.cerebro = cerebroDisponible();
        ESC.entradaCerrada = false;
        ESC.vivoFinal = '';
        ESC.vivoInterino = '';
        if (ESC.cerebro) { liveCtx(); abrirTextoVivo(); }
        const boton = $('rb-jarvis');
        boton.classList.add('is-escuchando');
        if (!ESC.unico) boton.classList.add('is-candado');
        aviso('Conectando…');
        estadoEscucha('Conectando…');
        if (ESC.ctx.state !== 'running') await Promise.race([ESC.ctx.resume().catch(() => null), esperar(800)]);
        const pistas = ESC.flujo.getAudioTracks();
        registrarVoz('Escucha: micrófono ' + (pistas.length ? pistas[0].readyState + (pistas[0].muted ? ' (mudo)' : '') : 'sin pistas') + ', audio ' + ESC.ctx.state + ' a ' + ESC.ctx.sampleRate + ' Hz' + (ESC.unico ? ' (un toque)' : ' (candado)'));
        const fuente = ESC.ctx.createMediaStreamSource(ESC.flujo);
        const medidor = ESC.ctx.createAnalyser();
        medidor.fftSize = 512;
        fuente.connect(medidor);
        const onda = new Float32Array(medidor.fftSize);
        const pintar = () => {
            if (!ESC.on || ESC.medidor !== medidor) return;
            medidor.getFloatTimeDomainData(onda);
            let s = 0;
            for (let i = 0; i < onda.length; i++) s += onda[i] * onda[i];
            ESC.nivelCrudo = Math.sqrt(s / onda.length);
            if (ESC.nivelCrudo > 0.04) ESC.ultimoSonido = Date.now();
            ESC.nivel = Math.max(Math.min(1, ESC.nivelCrudo * 9), ESC.nivel * 0.85);
            boton.style.setProperty('--nivel', ESC.nivel.toFixed(2));
            if (hevyHablando()) {
                ESC.ecoMax = Math.max(ESC.ecoMax, ESC.nivelCrudo);
                if (ESC.nivelCrudo > (E.meneo ? UMBRAL_INTERRUPCION * 2 : UMBRAL_INTERRUPCION)) {
                    if (!ESC.picoDesde) ESC.picoDesde = Date.now();
                    else if (Date.now() - ESC.picoDesde > 250) interrumpirPorVoz();
                } else ESC.picoDesde = 0;
            } else ESC.picoDesde = 0;
            ESC.cuadro = requestAnimationFrame(pintar);
        };
        ESC.medidor = medidor;
        ESC.nivel = 0;
        ESC.cuadro = requestAnimationFrame(pintar);
        ESC.proc = ESC.ctx.createScriptProcessor(4096, 1, 1);
        const mime = 'audio/pcm;rate=' + ESC.ctx.sampleRate;
        ESC.proc.onaudioprocess = e => {
            const habla = hevyHablando();
            if (habla) ESC.ultimaHabla = Date.now();
            const f = e.inputBuffer.getChannelData(0), b = new Uint8Array(f.length * 2), v = new DataView(b.buffer);
            for (let i = 0; i < f.length; i++) v.setInt16(2 * i, Math.max(-1, Math.min(1, f[i])) * 32767, true);
            const dato = JSON.stringify({ realtimeInput: { audio: { data: bytesABase64(b), mimeType: mime } } });
            if (habla || E.escuchando || Date.now() < ESC.ultimaHabla + 500 || Date.now() < E.finHabla + 600) {
                ESC.bloqueados++;
                ESC.anillo.push(dato);
                if (ESC.anillo.length > 6) ESC.anillo.shift();
                return;
            }
            ESC.anillo = [];
            enviarAudio(dato);
        };
        fuente.connect(ESC.proc);
        ESC.proc.connect(ESC.ctx.destination);
        conectarMotor();
        ESC.ultimoSonido = Date.now();
        if (ESC.unico) armarSinVoz();
        clearInterval(ESC.informe);
        ESC.informe = setInterval(() => {
            if (!ESC.on) return;
            registrarVoz('Escucha: enviados ' + ESC.enviados + ', sin enviar ' + ESC.bloqueados + ', nivel ' + ESC.nivel.toFixed(2) + ', listo ' + ESC.lista + ', cerebro ' + ESC.cerebro + ', hablando ' + hevyHablando() + ', eco máx ' + ESC.ecoMax.toFixed(2) + ', audio ' + (ESC.ctx ? ESC.ctx.state : '-'));
        }, 4000);
    }

    async function autopruebaEscucha() {
        let depurar = false;
        try { depurar = localStorage.getItem('cecyte_yokis_depurar') === '1'; } catch (e) { return; }
        if (!depurar || !llaveIA() || ESC.on) return;
        registrarVoz('Escucha: autoprueba iniciada');
        await encenderEscucha(false);
        await esperar(7000);
        registrarVoz('Escucha: autoprueba ' + (ESC.on && ESC.lista ? 'bien, enviados ' + ESC.enviados + ', nivel ' + ESC.nivel.toFixed(2) : 'falló (activa ' + ESC.on + ', lista ' + ESC.lista + ')'));
        if (ESC.on) apagarEscucha('');
    }

    function iniciarMicrofono() {
        const b = $('rb-jarvis');
        let reloj = 0, largo = false, ox = 0, oy = 0, hablaba = false;
        b.addEventListener('pointerdown', e => {
            largo = false;
            ox = e.clientX;
            oy = e.clientY;
            hablaba = hevyHablando();
            callarIA();
            callarCerebro();
            if (ESC.cerebro) ESC.ignorar = hablaba;
            detenerMeneo();
            clearTimeout(reloj);
            reloj = setTimeout(() => {
                largo = true;
                registrarVoz('Micrófono: pulsación larga, candado ' + (ESC.on && !ESC.unico ? 'se abre' : 'se cierra'));
                if (ESC.on && ESC.unico) { ESC.unico = false; clearTimeout(ESC.sinVoz); b.classList.add('is-candado'); }
                else if (ESC.on) apagarEscucha('Candado abierto.');
                else { const c = $('rb-escucha'); if (c) c.checked = true; encenderEscucha(false); }
            }, 450);
        });
        b.addEventListener('pointermove', e => { if (Math.abs(e.clientX - ox) > 24 || Math.abs(e.clientY - oy) > 24) clearTimeout(reloj); });
        ['pointerup', 'pointerleave'].forEach(ev => b.addEventListener(ev, () => clearTimeout(reloj)));
        b.addEventListener('contextmenu', e => e.preventDefault());
        b.addEventListener('click', () => {
            if (largo) { largo = false; return; }
            if (ESC.on && !ESC.unico) {
                if (!hablaba) apagarEscucha('Candado abierto.');
                return;
            }
            if (ESC.on) {
                const soloEscuchaba = !hablaba && !ESC.entradaCerrada && !ESC.turno && !ESC.oido && !ESC.texto;
                apagarEscucha('');
                if (!soloEscuchaba) encenderEscucha(true);
            }
            else if (llaveIA() && !sinInternet()) encenderEscucha(true);
            else escuchar();
        });
    }

    function iniciarEscuchaContinua() {
        const c = $('rb-escucha');
        if (!c) return;
        c.addEventListener('change', () => { if (c.checked) encenderEscucha(false); else apagarEscucha('Escucha apagada.'); });
        pintarMemoria();
        const cb = $('rb-cerebro');
        if (cb) {
            cb.checked = cerebroOn();
            cb.addEventListener('change', () => {
                try { localStorage.setItem(CLAVE_CEREBRO, cb.checked ? '1' : '0'); } catch (e) { /* sin guardado */ }
                if (ESC.on) apagarEscucha('Vuelve a prender el micrófono para usar el cambio.');
            });
        }
        const n = $('rb-escucha-nombre');
        if (n) {
            n.checked = exigeNombre();
            n.addEventListener('change', () => { try { localStorage.setItem(CLAVE_EXIGE_NOMBRE, n.checked ? '1' : '0'); } catch (e) { /* sin guardado */ } });
        }
        document.addEventListener('visibilitychange', () => { if (document.hidden && ESC.on) apagarEscucha('Se apagó al salir de la app.'); });
        setInterval(() => { if (ESC.on && Date.now() - ESC.ultimaVez > 1200000) apagarEscucha('Se apagó tras 20 minutos sin que me hablaras.'); }, 30000);
    }

    const CLAVES_LOCALES = {};

    function iniciar() {
        if (!$('rb-jarvis') || !raiz.Robot || !raiz.Robot.ordenDeVoz) return;
        Object.keys(CLAVES_LOCALES).forEach(k => {
            try { if (!localStorage.getItem(k)) localStorage.setItem(k, CLAVES_LOCALES[k]); } catch (e) { return; }
        });
        const c = calibra();
        $('rb-cal-vel').value = c.vel;
        $('rb-cal-giro').value = c.giro;
        ['rb-cal-vel', 'rb-cal-giro'].forEach(id => $(id).addEventListener('change', guardaCalibra));
        document.querySelectorAll('[data-figura]').forEach(b => b.addEventListener('click', () => { guardaCalibra(); correr(figura(b.dataset.figura), null, null, 'Dibujando ' + b.dataset.figura + '.'); }));
        $('rb-casa-marca').addEventListener('click', () => { if (control()) control().marcarCasa(); aviso('Casa marcada: aquí queda tu punto de regreso.'); });
        $('rb-casa-ir').addEventListener('click', regresarCasa);
        $('rb-radar').addEventListener('click', () => { guardaCalibra(); radar(true); });
        $('rb-guardia').addEventListener('click', () => ponerGuardia($('rb-guardia').getAttribute('aria-pressed') !== 'true', true));
        iniciarMicrofono();
        raiz.addEventListener('offline', () => {
            if (ESC.on) apagarEscucha('Sin internet: se apagó la escucha continua.');
            else aviso('Sin internet: solo entiendo órdenes y rutinas guardadas, y te contesto por el chat.');
        });
        raiz.addEventListener('online', () => { if (/^Sin internet/.test(($('rb-jarvis-msg') || {}).textContent || '')) aviso(''); });
        iniciarFacts();
        iniciarIA();
        iniciarSolo();
        iniciarEscuchaContinua();
        iniciarVozIA();
        iniciarMeneo();
        $('rb-voz-probar').addEventListener('click', () => { hablar('¡Qué onda, we! Así suena tu amigo Hevy. ¡Listo pa lo que sea!'); });
        iniciarEntrena();
        document.addEventListener('robot-paro', () => {
            vaciarCola();
            detener(false);
            E.radarCancelado = true;
            if (E.guardia) ponerGuardia(false, true);
        });
        iniciarLienzo();
    }

    raiz.Hevy = { hablar, di, modo: modoHevy };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})(window);
