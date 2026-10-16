// Avisos de cambio de clase en el APK: notificaciones locales agendadas en el teléfono.
// Reemplaza a Web Push (que el WebView de Android no ofrece). Qué avisa y con qué texto es lo mismo que
// el cron del servidor: en cada cambio de bloque, la materia y el maestro de la clase que sigue.
//  - agenda los próximos DIAS_ADELANTE días del grupo elegido (lunes a viernes)
//  - se renueva al abrir la app, al traer un horario nuevo, al cambiar de grupo y al reanudar
//  - usa alarmas exactas si el usuario las concede; si no, Android las entrega aproximadas
(function (raiz) {
    const DIAS_ADELANTE = 14;
    const CANAL = 'cambios-de-clase';
    const ACTIVO = 'cecyte_avisos_activos';
    const NOMBRES_DIA = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes' };

    // Horas en que cambia el bloque (inicio de cada bloque y fin del último). Salen de timeSlots de app.js.
    function limites() {
        const set = new Set();
        for (const s of timeSlots) {
            const [a, b] = s.key.split(' - ');
            set.add(a);
            set.add(b);
        }
        return Array.from(set).sort();
    }

    function plugin() {
        return raiz.Plataforma && raiz.Plataforma.plugin('LocalNotifications');
    }

    function marcarActivo(v) {
        try { localStorage.setItem(ACTIVO, v ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
    }

    function estaMarcado() {
        try { return localStorage.getItem(ACTIVO) === '1'; } catch (e) { return false; }
    }

    async function exactas(pedir) {
        const LN = plugin();
        try {
            let r = await LN.checkExactNotificationSetting();
            if (r.exact_alarm !== 'granted' && pedir) {
                await LN.changeExactNotificationSetting();   // abre los ajustes de "Alarmas y recordatorios"
                r = await LN.checkExactNotificationSetting();
            }
            return r.exact_alarm === 'granted';
        } catch (e) {
            return false;   // Android < 12 o sin ese ajuste: no hay nada que pedir
        }
    }

    async function crearCanal() {
        const LN = plugin();
        try {
            await LN.createChannel({
                id: CANAL, name: 'Cambios de clase',
                description: 'Avisa cuando termina una clase y empieza otra',
                importance: 4, visibility: 1, vibration: true,
            });
        } catch (e) { /* ya existe o no aplica */ }
    }

    // Arma la lista de avisos con las mismas reglas que checkScheduleAndNotify
    function armarLista(ahora) {
        const grupo = currentStudentGroup;
        if (!grupo) return [];
        const horas = limites();
        const lista = [];
        for (let d = 0; d < DIAS_ADELANTE; d++) {
            const dia = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + d);
            const nombre = NOMBRES_DIA[dia.getDay()];
            if (!nombre) continue;                                   // sábado y domingo no hay clases
            horas.forEach((hhmm, i) => {
                const [h, m] = hhmm.split(':').map(Number);
                const cuando = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), h, m, 0);
                if (cuando <= ahora) return;
                const previo = timeSlots.find(s => s.key.endsWith(' - ' + hhmm));
                const siguiente = timeSlots.find(s => s.key.startsWith(hhmm + ' - '));
                const claseAnterior = previo && !previo.receso ? findClass(grupo, nombre, previo.key) : null;
                const claseSiguiente = siguiente && !siguiente.receso ? findClass(grupo, nombre, siguiente.key) : null;
                if (!(claseAnterior || claseSiguiente || (siguiente && siguiente.receso))) return;   // nada que contar
                lista.push({
                    id: 100000 + d * 100 + i,
                    title: 'CECyTE Plantel 18',
                    body: textoAviso(claseAnterior, siguiente, claseSiguiente),
                    schedule: { at: cuando, allowWhileIdle: true },
                    channelId: CANAL,
                    smallIcon: 'ic_stat_cecyte',
                });
            });
        }
        return lista;
    }

    let ocupado = false;
    let repetir = false;
    let ultimaFirma = '';

    // Cancela lo pendiente y vuelve a agendar los próximos días
    async function reprogramar() {
        const LN = plugin();
        if (!LN || !estaMarcado()) return;
        if (ocupado) { repetir = true; return; }
        ocupado = true;
        try {
            const p = await LN.checkPermissions();
            if (p.display !== 'granted') return;
            const lista = armarLista(new Date());
            // El horario se vuelve a traer cada 15 s: solo se agenda de nuevo si la lista cambió de verdad
            const firma = JSON.stringify(lista.map(n => [n.id, +n.schedule.at, n.body]));
            const pendientes = await LN.getPending();
            if (firma === ultimaFirma && pendientes.notifications.length === lista.length) return;
            if (pendientes.notifications.length) {
                await LN.cancel({ notifications: pendientes.notifications.map(n => ({ id: n.id })) });
            }
            if (lista.length) await LN.schedule({ notifications: lista });
            ultimaFirma = firma;
        } catch (e) {
            console.error('No se pudieron agendar los avisos:', e);
        } finally {
            ocupado = false;
            if (repetir) { repetir = false; reprogramar(); }
        }
    }

    // Widget de Android: se le pasa el grupo y el horario que ve el alumno; el widget y su trabajo de fondo lo leen de ahí
    let ultimoWidget = '';
    async function actualizarWidget() {
        const W = raiz.Plataforma && raiz.Plataforma.plugin('WidgetHorario');
        if (!W) return;
        const grupo = currentStudentGroup || '';
        const horario = JSON.stringify(scheduleDatabase);
        const firma = grupo + '|' + horario;
        if (firma === ultimoWidget) return;   // el horario se vuelve a traer cada 15 s: solo se manda si cambió
        try {
            await W.guardar({ grupo, horario, apiBase: (raiz.APP_CONFIG && raiz.APP_CONFIG.apiBase) || '' });
            ultimoWidget = firma;
        } catch (e) {
            console.error('No se pudo actualizar el widget:', e);
        }
    }

    const AvisosNativos = {
        // Pide permiso de notificaciones y, si se puede, alarmas exactas; luego agenda.
        async activar() {
            const LN = plugin();
            if (!LN) return { ok: false, exactas: false };
            let p = await LN.checkPermissions();
            if (p.display !== 'granted') p = await LN.requestPermissions();
            if (p.display !== 'granted') return { ok: false, exactas: false };
            await crearCanal();
            const ex = await exactas(true);
            marcarActivo(true);
            await reprogramar();
            return { ok: true, exactas: ex };
        },

        async estado() {
            const LN = plugin();
            if (!LN) return { activo: false, exactas: false };
            const p = await LN.checkPermissions();
            const activo = p.display === 'granted' && estaMarcado();
            return { activo, exactas: activo ? await exactas(false) : false };
        },

        // Aviso inmediato (botón "Probar" y avisos con la app abierta)
        async notificarAhora(title, body) {
            const LN = plugin();
            if (!LN) return;
            try {
                const p = await LN.checkPermissions();
                if (p.display !== 'granted') return;
                await crearCanal();
                await LN.schedule({
                    notifications: [{
                        id: 1, title, body, channelId: CANAL, smallIcon: 'ic_stat_cecyte',
                        schedule: { at: new Date(Date.now() + 500), allowWhileIdle: true },
                    }],
                });
            } catch (e) {
                console.error('No se pudo mostrar la notificación:', e);
            }
        },

        reprogramar,
        armarLista,
    };

    raiz.AvisosNativos = AvisosNativos;

    if (raiz.Plataforma && raiz.Plataforma.nativo) {
        document.addEventListener('horario-actualizado', () => { reprogramar(); actualizarWidget(); });
        document.addEventListener('grupo-cambiado', () => { reprogramar(); actualizarWidget(); });
        raiz.addEventListener('app-reanudada', () => reprogramar());
    }
})(window);
