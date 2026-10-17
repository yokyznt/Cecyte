(function (raiz) {
    const $ = id => document.getElementById(id);
    const CLAVE = 'cecyte_robot_calibra';
    const CM_PX = 0.5, SALIDA = { x: 150, y: 188 };
    const MS_PASO = 50, MS_LATIDO = 250, HIST_MAX = 6;
    const FIGURAS = { circulo: 'un círculo', cuadrado: 'un cuadrado', triangulo: 'un triángulo', estrella: 'una estrella' };
    const E = { puntos: [], dibujando: false, guardia: null, radar: false, radarCancelado: false, escuchando: false, corrida: null };

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

    async function voz(texto) {
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

    function hablar(texto) {
        aviso(texto);
        historial('yokis', texto);
        voz(texto);
    }

    const di = (tipo, datos) => hablar(raiz.Robot.frase(tipo, datos));

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
        if (alto && listo()) enlace().mover(0, 0);
    }

    function correr(recorrido, habla, datos, texto) {
        if (!listo()) { di('sinRobot'); return false; }
        if (!recorrido) { di('fallo'); return false; }
        if (E.corrida) { di('ocupado'); return false; }
        E.corrida = { r: recorrido, t0: Date.now(), ult: '', envio: 0, timer: setInterval(pasoCorrida, MS_PASO) };
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
        if (!r) { hablar('No tengo nada que deshacer, compa. Maneja un poco con el mando primero.'); return; }
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
        if (!listo() || !enlace().soportaDistancia()) { hablar('El radar necesita el robot conectado con el firmware nuevo, compa.'); return; }
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
            hablar(`Radar listo, compa. Lo más cerca está a ${cerca >= 400 ? 'más de 4 metros' : cerca + ' centímetros'}, hacia los ${i * 30} grados.`);
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
        if (!listo() || !enlace().soportaDistancia()) { b.setAttribute('aria-pressed', 'false'); b.textContent = 'Armar guardia'; hablar('La guardia necesita el robot conectado con el firmware nuevo, compa.'); return; }
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

    function charla(t) {
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
        if (o.a === 'paro') { if (listo()) enlace().paro(); detener(false); di('paro'); return; }
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

    async function escuchar() {
        if (E.escuchando) return;
        const SR = raiz.Plataforma && raiz.Plataforma.plugin('SpeechRecognition');
        const Web = raiz.SpeechRecognition || raiz.webkitSpeechRecognition;
        const boton = $('rb-jarvis');
        E.escuchando = true;
        boton.classList.add('is-activo');
        aviso('Escuchando…');
        try {
            let texto = '';
            if (SR) {
                const p = await SR.requestPermissions();
                if (p.speechRecognition !== 'granted') { di('sinMicro'); return; }
                const r = await SR.start({ language: 'es-MX', maxResults: 5, prompt: 'Dime, compa', partialResults: false, popup: true });
                texto = elegirTexto(r.matches);
            } else if (Web) {
                texto = await new Promise((res, rej) => {
                    const rec = new Web();
                    rec.lang = 'es-MX';
                    rec.maxAlternatives = 5;
                    rec.onresult = e => res(elegirTexto(Array.from(e.results[0]).map(x => x.transcript)));
                    rec.onerror = e => rej(e);
                    rec.onend = () => res('');
                    rec.start();
                });
            } else { di('sinVoz'); return; }
            if (!texto) { di('nada'); return; }
            historial('yo', texto);
            aviso('«' + texto + '»');
            ejecutar(raiz.Robot.ordenDeVoz(texto));
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
        $('rb-voz-probar').addEventListener('click', () => { guardaVoz(); hablar('¡Qué onda, compa! Así suena tu amigo Yokis. ¡Listo pa lo que sea!'); });
        pintarVoces();
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
