/* CECyTE Plantel 18 - Sistema de Horarios y Notificaciones
   Logica de la aplicacion (antes estaba inline en el HTML) */

// El horario ya no vive fijo aqui: se carga del servidor (/api/schedule)
// para que todos los que abran la pagina vean lo mismo.
let scheduleDatabase = [];

// Bloques horarios. "key" es lo que se guarda en cada materia, "label" es lo que se muestra.
// El bloque de receso no tiene materias: siempre queda en blanco.
const timeSlots = [
    { key: '07:00 - 08:00', label: '07:00 - 08:00', receso: false },
    { key: '08:00 - 08:45', label: '08:00 - 08:45', receso: false },
    { key: '08:45 - 09:15', label: '08:45 - 09:15 (Receso)', receso: true },
    { key: '09:15 - 10:00', label: '09:15 - 10:00', receso: false },
    { key: '10:00 - 11:00', label: '10:00 - 11:00', receso: false },
    { key: '11:00 - 12:00', label: '11:00 - 12:00', receso: false },
    { key: '12:00 - 13:00', label: '12:00 - 13:00', receso: false },
    { key: '13:00 - 14:00', label: '13:00 - 14:00', receso: false },
    { key: '14:00 - 15:00', label: '14:00 - 15:00', receso: false }
];
const daysOfWeek = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
let mobileActiveDay = 'Lunes'; // Dia mostrado en la vista de lista para celular

// Live Clock updater
setInterval(() => {
    const now = new Date();
    document.getElementById('live-clock').innerText = now.toLocaleTimeString('es-MX');
}, 1000);

// ==================== Sincronizacion con el servidor ====================
// Trae el horario guardado en el servidor y repinta ambas vistas.
async function loadSchedule() {
    try {
        const res = await fetch('/api/schedule');
        if (!res.ok) return;
        scheduleDatabase = await res.json();
        renderStudentSchedule();
        if (isAdminLoggedIn) renderAdminTable();
    } catch (err) {
        console.error('No se pudo cargar el horario:', err);
    }
}

// Manda al servidor el arreglo completo actualizado (solo funciona con sesion activa)
async function saveScheduleToServer() {
    const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(scheduleDatabase)
    });

    if (res.status === 401) {
        isAdminLoggedIn = false;
        showAdminLogin();
        showNotificationToast('Sesión Expirada', 'Vuelve a iniciar sesión para guardar cambios.', 'warning');
        return false;
    }
    return res.ok;
}

// Switch between Student View and Admin View
let isAdminLoggedIn = false;

function switchView(view) {
    const studentView = document.getElementById('view-student');
    const adminView = document.getElementById('view-admin');
    const tabStudent = document.getElementById('tab-student');
    const tabAdmin = document.getElementById('tab-admin');

    if (view === 'student') {
        studentView.classList.remove('hidden');
        adminView.classList.add('hidden');
        tabStudent.className = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-emerald-600 text-white shadow-sm flex items-center space-x-1.5';
        tabAdmin.className = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-all text-emerald-200 hover:text-white flex items-center space-x-1.5';
    } else {
        studentView.classList.add('hidden');
        adminView.classList.remove('hidden');
        tabAdmin.className = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-emerald-600 text-white shadow-sm flex items-center space-x-1.5';
        tabStudent.className = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-all text-emerald-200 hover:text-white flex items-center space-x-1.5';
        checkAdminSession();
    }
}

// Revisa con el servidor si ya hay una sesion de admin valida en este dispositivo
async function checkAdminSession() {
    try {
        const res = await fetch('/api/session');
        const data = await res.json();
        isAdminLoggedIn = !!data.loggedIn;
    } catch (err) {
        isAdminLoggedIn = false;
    }

    if (isAdminLoggedIn) {
        showAdminContent();
    } else {
        showAdminLogin();
    }
}

function showAdminLogin() {
    document.getElementById('admin-login').classList.remove('hidden');
    document.getElementById('admin-content').classList.add('hidden');
    document.getElementById('admin-content').classList.remove('flex');
}

function showAdminContent() {
    document.getElementById('admin-login').classList.add('hidden');
    document.getElementById('admin-content').classList.remove('hidden');
    document.getElementById('admin-content').classList.add('flex');
    renderAdminTable();
}

async function submitLogin(e) {
    e.preventDefault();
    const password = document.getElementById('admin-password').value;
    const errorMsg = document.getElementById('login-error');
    errorMsg.classList.add('hidden');

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ password })
        });

        if (res.ok) {
            isAdminLoggedIn = true;
            document.getElementById('admin-password').value = '';
            showAdminContent();
        } else {
            errorMsg.classList.remove('hidden');
        }
    } catch (err) {
        errorMsg.innerText = 'No se pudo conectar con el servidor.';
        errorMsg.classList.remove('hidden');
    }
}

async function logoutAdmin() {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    isAdminLoggedIn = false;
    showAdminLogin();
}

// Render de la tabla semanal de horario
function renderStudentSchedule() {
    const tbody = document.getElementById('schedule-table-body');
    tbody.innerHTML = '';
    timeSlots.forEach(slot => {
        let tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50/80 transition';

        let tdTime = document.createElement('td');
        tdTime.className = 'py-3 px-4 font-mono font-bold text-slate-500 bg-slate-50/50 border-b border-slate-100';
        tdTime.innerText = slot.label;
        tr.appendChild(tdTime);

        daysOfWeek.forEach(day => {
            let td = document.createElement('td');
            td.className = 'py-3 px-4 border-b border-slate-100';

            // El receso siempre queda en blanco
            if (!slot.receso) {
                const match = scheduleDatabase.find(i => i.day === day && i.time === slot.key);
                if (match) {
                    td.innerHTML = `
                        <div class="p-2 rounded-xl bg-emerald-50/80 border border-emerald-100 shadow-2xs">
                            <span class="font-bold text-emerald-900 block">${match.subject}</span>
                            <span class="text-[10px] text-slate-500 block mt-0.5"><i class="fa-solid fa-user-tie text-emerald-600"></i> ${match.teacher}</span>
                        </div>
                    `;
                }
                // si no hay match, la celda queda vacia (en blanco)
            }
            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });

    // Mantener sincronizada la vista movil (lista por dia)
    renderMobileDayTabs();
    renderMobileSchedule();
}

// Cambia el dia activo en la vista movil (lista vertical)
function switchMobileDay(day) {
    mobileActiveDay = day;
    renderMobileSchedule();
}

// Pinta las pestañas de dia (Lunes...Viernes) para la vista movil
function renderMobileDayTabs() {
    const container = document.getElementById('mobile-day-tabs');
    if (!container) return;
    container.innerHTML = '';

    daysOfWeek.forEach(day => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.innerText = day;
        btn.onclick = () => switchMobileDay(day);
        btn.className = (day === mobileActiveDay)
            ? 'shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white transition'
            : 'shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition';
        container.appendChild(btn);
    });
}

// Pinta la lista vertical de horas para el dia activo (vista movil)
function renderMobileSchedule() {
    const list = document.getElementById('mobile-schedule-list');
    if (!list) return;
    list.innerHTML = '';

    timeSlots.forEach(slot => {
        const row = document.createElement('div');
        row.className = 'px-4 py-3 flex items-start gap-3';

        const timeCol = document.createElement('div');
        timeCol.className = 'w-[92px] shrink-0 pt-0.5 font-mono text-[10.5px] font-bold text-slate-500 leading-tight';
        timeCol.innerText = slot.label;
        row.appendChild(timeCol);

        const contentCol = document.createElement('div');
        contentCol.className = 'flex-1 min-w-0';

        // El receso siempre queda en blanco
        if (!slot.receso) {
            const match = scheduleDatabase.find(i => i.day === mobileActiveDay && i.time === slot.key);
            if (match) {
                contentCol.innerHTML = `
                    <div class="p-2.5 rounded-xl bg-emerald-50/80 border border-emerald-100">
                        <span class="font-bold text-emerald-900 text-xs block">${match.subject}</span>
                        <span class="text-[10px] text-slate-500 block mt-0.5"><i class="fa-solid fa-user-tie text-emerald-600"></i> ${match.teacher}</span>
                    </div>
                `;
            }
            // si no hay match, queda en blanco
        }

        row.appendChild(contentCol);
        list.appendChild(row);
    });
}

// Render Admin Table
function renderAdminTable(filterQuery = '') {
    const tbody = document.getElementById('admin-table-body');
    tbody.innerHTML = '';

    let filtered = scheduleDatabase.filter(item => {
        return item.subject.toLowerCase().includes(filterQuery.toLowerCase()) ||
               item.teacher.toLowerCase().includes(filterQuery.toLowerCase());
    });

    document.getElementById('admin-count').innerText = filtered.length;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-400 italic">No se encontraron registros en la base de datos.</td></tr>`;
        return;
    }

    filtered.forEach(item => {
        let tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition';
        tr.innerHTML = `
            <td class="py-3 px-4">${item.day}</td>
            <td class="py-3 px-4 font-mono">${item.time}</td>
            <td class="py-3 px-4 font-bold text-slate-800">${item.subject}</td>
            <td class="py-3 px-4 text-slate-600">${item.teacher}</td>
            <td class="py-3 px-4 text-right space-x-2">
                <button onclick="editScheduleItem(${item.id})" class="p-1.5 text-slate-400 hover:text-emerald-600 transition bg-slate-100 hover:bg-emerald-50 rounded-lg"><i class="fa-solid fa-pen-to-square"></i></button>
                <button onclick="deleteScheduleItem(${item.id})" class="p-1.5 text-slate-400 hover:text-rose-600 transition bg-slate-100 hover:bg-rose-50 rounded-lg"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filterAdminTable(query) {
    renderAdminTable(query);
}

// Modal Controls
function openAddModal() {
    document.getElementById('modal-title').innerText = 'Registrar Nueva Materia en Horario';
    document.getElementById('schedule-form').reset();
    document.getElementById('edit-id').value = '';
    document.getElementById('schedule-modal').classList.remove('hidden');
    document.getElementById('schedule-modal').classList.add('flex');
}

function closeAddModal() {
    document.getElementById('schedule-modal').classList.remove('flex');
    document.getElementById('schedule-modal').classList.add('hidden');
}

function editScheduleItem(id) {
    const item = scheduleDatabase.find(i => i.id === id);
    if (!item) return;

    document.getElementById('modal-title').innerText = 'Editar Registro de Horario';
    document.getElementById('edit-id').value = item.id;
    document.getElementById('form-day').value = item.day;
    document.getElementById('form-time').value = item.time;
    document.getElementById('form-subject').value = item.subject;
    document.getElementById('form-teacher').value = item.teacher;

    document.getElementById('schedule-modal').classList.remove('hidden');
    document.getElementById('schedule-modal').classList.add('flex');
}

async function saveScheduleItem(e) {
    e.preventDefault();
    const editId = document.getElementById('edit-id').value;
    const day = document.getElementById('form-day').value;
    const time = document.getElementById('form-time').value;
    const subject = document.getElementById('form-subject').value;
    const teacher = document.getElementById('form-teacher').value;

    const previousState = scheduleDatabase; // por si hay que revertir
    let successMessage;

    if (editId) {
        // Update
        const index = scheduleDatabase.findIndex(i => i.id == editId);
        if (index !== -1) {
            scheduleDatabase = scheduleDatabase.map((item, i) =>
                i === index ? { id: Number(editId), day, time, subject, teacher } : item
            );
            successMessage = `Se modificó correctamente la materia ${subject}`;
        }
    } else {
        // Insert
        const newId = scheduleDatabase.length > 0 ? Math.max(...scheduleDatabase.map(i => i.id)) + 1 : 1;
        scheduleDatabase = [...scheduleDatabase, { id: newId, day, time, subject, teacher }];
        successMessage = `Se agregó la materia ${subject}`;
    }

    const saved = await saveScheduleToServer();
    if (!saved) {
        scheduleDatabase = previousState; // revertir si no se pudo guardar
        renderAdminTable();
        renderStudentSchedule();
        return;
    }

    showNotificationToast('Cambios Guardados', `${successMessage}. Ya se actualizó para todos.`, 'success');
    closeAddModal();
    renderAdminTable();
    renderStudentSchedule();
}

async function deleteScheduleItem(id) {
    if (!confirm('¿Estás seguro de eliminar este registro del horario?')) return;

    const previousState = scheduleDatabase;
    scheduleDatabase = scheduleDatabase.filter(i => i.id !== id);

    const saved = await saveScheduleToServer();
    if (!saved) {
        scheduleDatabase = previousState;
        renderAdminTable();
        renderStudentSchedule();
        return;
    }

    renderAdminTable();
    renderStudentSchedule();
    showNotificationToast('Registro Eliminado', 'Se actualizó el horario para todos.', 'warning');
}

// ==================== Motor de Notificaciones Automaticas ====================
// Revisa la hora real de este dispositivo contra scheduleDatabase y avisa
// cuando cambia el bloque de clase (que termino / que sigue).

let alertLog = []; // Historial de alertas disparadas, mas reciente primero
let lastActiveSlotKey = undefined; // undefined = todavia no se ha revisado ni una vez

function timeToMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

// Traduce el dia de la semana real (Date.getDay) al nombre usado en scheduleDatabase.
// Sabado y Domingo devuelven null (no hay clases).
function getCurrentDaySpanish() {
    const map = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes' };
    return map[new Date().getDay()] || null;
}

// Devuelve el bloque horario (timeSlots) en el que cae la hora actual, o null si no hay clases ahorita.
function getCurrentSlot() {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    for (const slot of timeSlots) {
        const [startStr, endStr] = slot.key.split(' - ');
        const start = timeToMinutes(startStr);
        const end = timeToMinutes(endStr);
        if (nowMinutes >= start && nowMinutes < end) return slot;
    }
    return null;
}

function findClass(day, slotKey) {
    return scheduleDatabase.find(i => i.day === day && i.time === slotKey);
}

// Se ejecuta cada 20 segundos: detecta si cambiamos de bloque y, si aplica, dispara la alerta.
function checkScheduleAndNotify() {
    const day = getCurrentDaySpanish();
    const slot = day ? getCurrentSlot() : null;
    const currentKey = slot ? slot.key : null;

    if (lastActiveSlotKey === undefined) {
        // Primera revisión de la sesión: solo guardamos el estado, no avisamos nada.
        lastActiveSlotKey = currentKey;
        return;
    }

    if (currentKey !== lastActiveSlotKey) {
        const prevSlot = timeSlots.find(s => s.key === lastActiveSlotKey);
        const prevClass = (day && prevSlot && !prevSlot.receso) ? findClass(day, prevSlot.key) : null;
        const nextClass = (day && slot && !slot.receso) ? findClass(day, slot.key) : null;

        // Solo avisamos si de verdad hay algo que contar (una clase que termina o una que empieza).
        if (prevClass || nextClass || (slot && slot.receso)) {
            fireClassChangeAlert(prevClass, slot, nextClass);
        }
        lastActiveSlotKey = currentKey;
    }
}

function fireClassChangeAlert(prevClass, nextSlot, nextClass) {
    const now = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    const terminoTexto = prevClass ? `${prevClass.subject} — ${prevClass.teacher}` : 'Sin clase';
    let sigueTexto;
    if (nextSlot && nextSlot.receso) {
        sigueTexto = 'Receso';
    } else if (nextClass) {
        sigueTexto = `${nextClass.subject} — ${nextClass.teacher}`;
    } else {
        sigueTexto = 'Sin clase';
    }

    // 1. Toast dentro de la pagina (para cuando la pestaña esta abierta y visible)
    showNotificationToast('Cambio de Clase', `Termina: ${terminoTexto}\nSigue: ${sigueTexto}`, 'info');

    // 2. Notificacion real del sistema operativo (si ya se dio permiso en este dispositivo)
    sendSystemNotification('CECyTE Plantel 18', `Termina: ${terminoTexto}\nSigue: ${sigueTexto}`);

    // 3. Registro para el panel de admin
    alertLog.unshift({ time: now, termino: terminoTexto, sigue: sigueTexto });
    alertLog = alertLog.slice(0, 30);
    renderAlertLog();
}

// Manda una notificacion real del sistema (banner fuera de la pagina), si hay permiso concedido.
function sendSystemNotification(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
        new Notification(title, { body });
    }
}

function requestNotificationPermission() {
    if (!('Notification' in window)) {
        updateNotificationStatus('No soportado en este navegador');
        return;
    }
    Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
            updateNotificationStatus('Activado en este dispositivo');
            showNotificationToast('Notificaciones Activadas', 'Este dispositivo recibirá avisos de cambio de clase.', 'success');
        } else {
            updateNotificationStatus('Permiso denegado');
        }
    });
}

function updateNotificationStatus(text) {
    const el = document.getElementById('notification-status');
    if (el) el.innerText = text;
}

// Botón "Probar" del admin: manda una alerta de ejemplo sin esperar a que cambie la hora real.
function testNotification() {
    fireClassChangeAlert(
        { subject: 'Cálculo Diferencial', teacher: 'Ing. Roberto Gómez' },
        null,
        { subject: 'Programación Orientada a Objetos', teacher: 'Lic. Javier Estrada' }
    );
}

function renderAlertLog() {
    const tbody = document.getElementById('alert-log-body');
    if (!tbody) return;

    if (alertLog.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="py-6 text-center text-slate-400 italic">Todavía no se ha registrado ninguna alerta.</td></tr>`;
        return;
    }

    tbody.innerHTML = alertLog.map(entry => `
        <tr>
            <td class="py-2.5 px-4 font-mono">${entry.time}</td>
            <td class="py-2.5 px-4">${entry.termino}</td>
            <td class="py-2.5 px-4 font-semibold text-emerald-700">${entry.sigue}</td>
        </tr>
    `).join('');
}

function showNotificationToast(title, message, type, iconColor = 'bg-emerald-600') {
    const container = document.getElementById('notification-container');
    const toast = document.createElement('div');
    toast.className = `pointer-events-auto bg-white rounded-2xl shadow-xl border border-slate-200 p-4 flex items-start space-x-3 transition-all duration-300 translate-y-2 opacity-0 animate-in fade-in slide-in-from-bottom-5`;
    
    toast.innerHTML = `
        <div class="w-10 h-10 rounded-xl ${iconColor} text-white flex items-center justify-center shrink-0 shadow-md">
            <i class="fa-solid fa-bell"></i>
        </div>
        <div class="flex-1">
            <div class="flex justify-between items-center">
                <h5 class="font-bold text-xs text-slate-900">${title}</h5>
                <span class="text-[10px] text-slate-400 font-mono">Ahora</span>
            </div>
            <p class="text-xs text-slate-600 mt-1 leading-relaxed whitespace-pre-line">${message}</p>
        </div>
    `;

    container.appendChild(toast);

    // Auto dismiss after 5 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// Initial render on load
window.onload = async function() {
    await loadSchedule(); // trae el horario real del servidor

    if ('Notification' in window && Notification.permission === 'granted') {
        updateNotificationStatus('Activado en este dispositivo');
    }

    checkScheduleAndNotify();
    setInterval(checkScheduleAndNotify, 20000); // revisa cambio de clase cada 20 segundos
    setInterval(loadSchedule, 15000); // refresca el horario cada 15 segundos por si otro admin hizo cambios
}
