/* CECyTE Plantel 18 - Sistema de Horarios y Notificaciones
   Logica de la aplicacion (antes estaba inline en el HTML) */

// El horario ya no vive fijo aqui: se carga del servidor (/api/schedule)
// para que todos los que abran la pagina vean lo mismo.
let scheduleDatabase = [];

// Lista de grupos que existen (se administra desde el panel de admin, vive en /api/groups)
let groupsList = [];
// Grupo que esta viendo este alumno en este celular (se recuerda con localStorage)
let currentStudentGroup = localStorage.getItem('cecyte_group') || '';

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
let mobileActiveDay = 'Lunes'; // Dia mostrado en la vista de lista para celular (se ajusta al real en window.onload)
let scheduleLoaded = false; // evita mostrar "grupo sin materias" antes de que llegue el horario del servidor
let lastRenderedNowKey = null; // repinta el resaltado de "ahora" solo cuando cambia el bloque
const dayShort = { 'Lunes': 'Lun', 'Martes': 'Mar', 'Miércoles': 'Mié', 'Jueves': 'Jue', 'Viernes': 'Vie' };

// ==================== Utilidades de interfaz ====================
// Icono del sprite SVG que vive en index.html
function icon(name) {
    return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// Escapa texto antes de meterlo con innerHTML (materias, docentes y grupos los captura un humano)
function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Bloque de una materia (celda de la tabla y fila de la lista movil)
function slotHtml(match, isNow) {
    return `<div class="slot${isNow ? ' is-now' : ''}">
        <span class="slot__subject">${esc(match.subject)}</span>
        ${match.teacher ? `<span class="slot__teacher">${icon('user')}<span>${esc(match.teacher)}</span></span>` : ''}
    </div>`;
}

// Calcula que dia debe abrir por default la vista movil: el dia de hoy si es Lunes-Viernes,
// Lunes si es Sabado/Domingo, y tambien Lunes si ya es Viernes despues de la ultima clase.
function getDefaultMobileDay() {
    const day = getCurrentDaySpanish();
    if (!day) return 'Lunes'; // Sabado o Domingo

    if (day === 'Viernes') {
        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const finDeClases = timeToMinutes('15:00'); // hora en que termina el ultimo bloque
        if (nowMinutes >= finDeClases) return 'Lunes';
    }

    return day;
}

// Live Clock updater + tarjeta "Estado Actual" (ambos con la hora real)
setInterval(() => {
    const now = new Date();
    document.getElementById('live-clock').innerText = now.toLocaleTimeString('es-MX');
    updateCurrentClassCard();
}, 1000);

// Pinta la tarjeta "Estado Actual" segun la hora real y el horario cargado del servidor
function updateCurrentClassCard() {
    const panel = document.getElementById('now-panel');
    const titleEl = document.getElementById('current-subject-title');
    const teacherEl = document.getElementById('current-teacher-name');
    const timeEl = document.getElementById('current-subject-time');
    const stateEl = document.getElementById('now-state');
    const percentEl = document.getElementById('progress-percent');
    const barEl = document.getElementById('class-progress-bar');
    const trackEl = document.getElementById('progress-track');
    const countdownEl = document.getElementById('countdown-timer');
    const nextEl = document.getElementById('next-subject-name');
    if (!titleEl) return; // la tarjeta no esta en pantalla todavia

    const day = getCurrentDaySpanish();
    const slot = day ? getCurrentSlot() : null;
    const teacherLine = (iconName, text) => `${icon(iconName)}<span>${esc(text)}</span>`;
    const setState = (state, label) => { panel.dataset.state = state; stateEl.innerText = label; };

    // Cuando cambia el bloque, repinta el horario (resalta la hora actual) y la tira del dia
    const nowKey = `${day}|${slot ? slot.key : 'none'}`;
    if (nowKey !== lastRenderedNowKey) {
        lastRenderedNowKey = nowKey;
        renderStudentSchedule();
        renderDayStrip(day, slot);
    }

    if (!slot) {
        titleEl.innerText = day ? 'Sin clase en este momento' : 'Hoy no hay clases';
        teacherEl.innerHTML = '';
        timeEl.innerText = '—';
        setState('none', 'Sin clase');
        percentEl.innerText = '—';
        barEl.style.width = '0%';
        trackEl.setAttribute('aria-valuenow', '0');
        countdownEl.innerText = '--:--';
        nextEl.innerText = findNextClassLabel(day) || 'Sin más clases';
        return;
    }

    const currentClass = slot.receso ? null : findClass(currentStudentGroup, day, slot.key);
    const [startStr, endStr] = slot.key.split(' - ');
    const start = timeToMinutes(startStr);
    const end = timeToMinutes(endStr);
    const now = new Date();
    const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const startSeconds = start * 60;
    const endSeconds = end * 60;
    const totalSeconds = endSeconds - startSeconds;
    const elapsedSeconds = Math.min(Math.max(nowSeconds - startSeconds, 0), totalSeconds);
    const percent = totalSeconds > 0 ? Math.round((elapsedSeconds / totalSeconds) * 100) : 0;
    const remainingSeconds = Math.max(endSeconds - nowSeconds, 0);
    const remMin = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
    const remSec = String(remainingSeconds % 60).padStart(2, '0');

    if (slot.receso) {
        titleEl.innerText = 'Receso';
        teacherEl.innerHTML = teacherLine('coffee', 'Disfruta tu receso');
        setState('recess', 'Receso');
    } else if (currentClass) {
        titleEl.innerText = currentClass.subject;
        teacherEl.innerHTML = currentClass.teacher ? teacherLine('user', currentClass.teacher) : '';
        setState('class', 'En curso');
    } else {
        titleEl.innerText = 'Hora libre';
        teacherEl.innerHTML = '';
        setState('free', 'Hora libre');
    }

    timeEl.innerText = `${slot.key} hrs`;
    percentEl.innerText = `${percent}%`;
    barEl.style.width = `${percent}%`;
    trackEl.setAttribute('aria-valuenow', String(percent));
    countdownEl.innerText = `${remMin}:${remSec}`;
    nextEl.innerText = findNextClassLabel(day, slot.key) || 'Sin más clases hoy';
}

// Tira del dia: un segmento por bloque, proporcional a su duracion (pasado / ahora / por venir)
function renderDayStrip(day, slot) {
    const strip = document.getElementById('day-strip');
    if (!strip) return;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    strip.innerHTML = timeSlots.map(s => {
        const [start, end] = s.key.split(' - ').map(timeToMinutes);
        const isNow = !!(slot && slot.key === s.key);
        const isPast = !!day && end <= nowMinutes;
        const cls = ['strip__seg', s.receso ? 'is-recess' : '', isNow ? 'is-now' : (isPast ? 'is-past' : '')].join(' ').trim();
        return `<li class="${cls}" style="flex:${end - start}" title="${esc(s.label)}"></li>`;
    }).join('');
}

// Busca la siguiente materia asignada despues del bloque actual (o desde el inicio si no hay bloque activo)
function findNextClassLabel(day, afterSlotKey = null) {
    if (!day) return null;
    let index = afterSlotKey ? timeSlots.findIndex(s => s.key === afterSlotKey) + 1 : 0;
    for (; index < timeSlots.length; index++) {
        const slot = timeSlots[index];
        if (slot.receso) continue;
        const match = findClass(currentStudentGroup, day, slot.key);
        if (match) return `${match.subject} (${slot.key})`;
    }
    return null;
}

// ==================== Sincronizacion con el servidor ====================
// Trae el horario guardado en el servidor y repinta ambas vistas.
async function loadSchedule() {
    try {
        const res = await fetch('/api/schedule');
        if (!res.ok) return;
        scheduleDatabase = await res.json();
        scheduleLoaded = true;
        const updatedEl = document.getElementById('schedule-updated');
        if (updatedEl) updatedEl.innerText = 'Actualizado ' + new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
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

// ==================== Grupos ====================
// Trae la lista de grupos del servidor y actualiza los selectores en pantalla.
async function loadGroups() {
    try {
        const res = await fetch('/api/groups');
        if (!res.ok) return;
        groupsList = await res.json();
    } catch (err) {
        console.error('No se pudieron cargar los grupos:', err);
        groupsList = [];
    }

    // Si el grupo guardado en este celular ya no existe, o no hay ninguno guardado, usa el primero disponible
    if (!groupsList.includes(currentStudentGroup)) {
        currentStudentGroup = groupsList[0] || '';
    }

    populateGroupSelectors();
    renderGroupsList();
}

// Llena el selector de la vista de alumnos, el filtro del admin y el select del formulario
function populateGroupSelectors() {
    const studentSelect = document.getElementById('group-selector');
    if (studentSelect) {
        studentSelect.innerHTML = groupsList.length
            ? groupsList.map(g => `<option value="${esc(g)}" ${g === currentStudentGroup ? 'selected' : ''}>${esc(g)}</option>`).join('')
            : '<option value="">Sin grupos todavía</option>';
    }

    const adminFilter = document.getElementById('admin-group-filter');
    if (adminFilter) {
        const current = adminFilter.value || 'ALL';
        adminFilter.innerHTML = '<option value="ALL">Todos los Grupos</option>' +
            groupsList.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
        adminFilter.value = groupsList.includes(current) || current === 'ALL' ? current : 'ALL';
    }

    const formGroup = document.getElementById('form-group');
    if (formGroup) {
        formGroup.innerHTML = groupsList.length
            ? groupsList.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('')
            : '<option value="">Agrega un grupo primero</option>';
    }
}

// El alumno cambia de grupo en su celular
function changeGroup(group) {
    currentStudentGroup = group;
    localStorage.setItem('cecyte_group', group);
    lastActiveSlotKey = undefined; // evita un aviso falso al cambiar de grupo a medio bloque
    renderStudentSchedule();
    updateCurrentClassCard();
    checkScheduleAndNotify();

    // Si ya tenia notificaciones activadas, mueve la suscripcion push al grupo nuevo
    if ('Notification' in window && Notification.permission === 'granted') {
        subscribeToPush();
    }
}

// Admin agrega un grupo nuevo
async function addGroup(e) {
    e.preventDefault();
    const input = document.getElementById('new-group-name');
    const name = input.value.trim();
    if (!name) return;

    try {
        const res = await fetch('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ name })
        });
        const data = await res.json();

        if (!res.ok) {
            showNotificationToast('No se pudo agregar', data.error || 'Intenta de nuevo.', 'warning');
            return;
        }

        groupsList = data.groups;
        input.value = '';
        populateGroupSelectors();
        renderGroupsList();
        showNotificationToast('Grupo Agregado', `Se agregó el grupo ${name}.`, 'success');
    } catch (err) {
        showNotificationToast('Error', 'No se pudo conectar con el servidor.', 'warning');
    }
}

// Admin borra un grupo (y de paso todas sus materias)
async function deleteGroup(name) {
    if (!confirm(`¿Seguro que quieres eliminar el grupo "${name}"? También se van a borrar todas sus materias del horario.`)) return;

    try {
        const res = await fetch('/api/groups', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ name })
        });
        const data = await res.json();

        if (!res.ok) {
            showNotificationToast('No se pudo eliminar', data.error || 'Intenta de nuevo.', 'warning');
            return;
        }

        groupsList = data.groups;
        scheduleDatabase = data.schedule;
        populateGroupSelectors();
        renderGroupsList();
        renderAdminTable();
        renderStudentSchedule();
        showNotificationToast('Grupo Eliminado', `Se eliminó el grupo ${name} y sus materias.`, 'warning');
    } catch (err) {
        showNotificationToast('Error', 'No se pudo conectar con el servidor.', 'warning');
    }
}

// Pinta los "chips" de grupos existentes en el panel de admin, con boton para borrar
function renderGroupsList() {
    const container = document.getElementById('groups-list');
    if (!container) return;

    if (groupsList.length === 0) {
        container.innerHTML = '<p class="chips__empty">Todavía no hay grupos. Agrega uno arriba.</p>';
        return;
    }

    container.innerHTML = groupsList.map(g => `
        <span class="chip">${esc(g)}
            <button type="button" class="chip__x" data-name="${esc(g)}" onclick="deleteGroup(this.dataset.name)" title="Eliminar" aria-label="Eliminar grupo ${esc(g)}">${icon('x')}</button>
        </span>
    `).join('');
}

// Switch between Student View and Admin View
let isAdminLoggedIn = false;

function switchView(view) {
    const studentView = document.getElementById('view-student');
    const adminView = document.getElementById('view-admin');
    const tabStudent = document.getElementById('tab-student');
    const tabAdmin = document.getElementById('tab-admin');

    const isStudent = view === 'student';
    studentView.classList.toggle('hidden', !isStudent);
    adminView.classList.toggle('hidden', isStudent);
    tabStudent.setAttribute('aria-pressed', String(isStudent));
    tabAdmin.setAttribute('aria-pressed', String(!isStudent));
    if (!isStudent) checkAdminSession();
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
}

function showAdminContent() {
    document.getElementById('admin-login').classList.add('hidden');
    document.getElementById('admin-content').classList.remove('hidden');
    populateGroupSelectors();
    renderGroupsList();
    renderAdminTable();
    loadBell();
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

/// Render de la tabla semanal de horario (resalta el dia y la hora actuales)
function renderStudentSchedule() {
    const tbody = document.getElementById('schedule-table-body');
    const today = getCurrentDaySpanish();
    const nowSlot = today ? getCurrentSlot() : null;

    // Encabezado: marca la columna de hoy
    document.querySelectorAll('#week-head th[data-day]').forEach(th => {
        const isToday = th.dataset.day === today;
        th.classList.toggle('is-today', isToday);
        th.innerHTML = isToday ? `${th.dataset.day}<span class="today-tag">· Hoy</span>` : th.dataset.day;
    });

    tbody.innerHTML = timeSlots.map(slot => {
        const [start, end] = slot.key.split(' - ');
        const isNowRow = !!(nowSlot && nowSlot.key === slot.key);
        const timeCell = `<td class="time-cell"><span class="t-start">${start}</span><span class="t-end">${end}</span></td>`;

        // El receso siempre queda en blanco: una sola banda a lo ancho
        if (slot.receso) {
            return `<tr class="${isNowRow ? 'is-now-row' : ''}">${timeCell}<td class="recess-cell" colspan="${daysOfWeek.length}">Receso</td></tr>`;
        }

        const cells = daysOfWeek.map(day => {
            const match = findClass(currentStudentGroup, day, slot.key);
            const isToday = day === today;
            // si no hay match, la celda queda vacia (en blanco)
            return `<td class="${isToday ? 'is-today' : ''}">${match ? slotHtml(match, isNowRow && isToday) : ''}</td>`;
        }).join('');
        return `<tr class="${isNowRow ? 'is-now-row' : ''}">${timeCell}${cells}</tr>`;
    }).join('');

    // Grupo sin materias: avisa en vez de dejar una cuadricula vacia sin explicacion
    const emptyEl = document.getElementById('schedule-empty');
    if (emptyEl) {
        const hasAny = scheduleDatabase.some(i => i.group === currentStudentGroup);
        emptyEl.classList.toggle('hidden', !scheduleLoaded || hasAny);
    }

    // Mantener sincronizada la vista movil (lista por dia)
    renderMobileDayTabs();
    renderMobileSchedule();
}

// Cambia el dia activo en la vista movil (lista vertical)
function switchMobileDay(day) {
    mobileActiveDay = day;
    renderMobileDayTabs();
    renderMobileSchedule();
}

// Pinta las pestañas de dia (Lunes...Viernes) para la vista movil
function renderMobileDayTabs() {
    const container = document.getElementById('mobile-day-tabs');
    if (!container) return;
    const today = getCurrentDaySpanish();

    container.innerHTML = daysOfWeek.map(day => `
        <button type="button" role="tab" class="day-tab${day === today ? ' is-today' : ''}"
            aria-selected="${day === mobileActiveDay}" aria-label="${day}${day === today ? ' (hoy)' : ''}"
            onclick="switchMobileDay('${day}')">${dayShort[day]}</button>
    `).join('');
}

// Pinta la lista vertical de horas para el dia activo (vista movil)
function renderMobileSchedule() {
    const list = document.getElementById('mobile-schedule-list');
    if (!list) return;
    const today = getCurrentDaySpanish();
    const nowSlot = today ? getCurrentSlot() : null;

    list.innerHTML = timeSlots.map(slot => {
        const [start, end] = slot.key.split(' - ');
        const isNowRow = !!(nowSlot && mobileActiveDay === today && nowSlot.key === slot.key);
        const time = `<div class="time-cell"><span class="t-start">${start}</span><span class="t-end">${end}</span></div>`;

        let body;
        if (slot.receso) {
            body = '<div class="empty">Receso</div>'; // el receso siempre queda en blanco
        } else {
            const match = findClass(currentStudentGroup, mobileActiveDay, slot.key);
            body = match ? slotHtml(match, isNowRow) : '<div class="empty">Hora libre</div>';
        }
        return `<li class="day-row${slot.receso ? ' is-recess' : ''}${isNowRow ? ' is-now' : ''}">${time}${body}</li>`;
    }).join('');
}

// Render Admin Table
function renderAdminTable(filterQuery = '') {
    const tbody = document.getElementById('admin-table-body');
    const groupFilter = document.getElementById('admin-group-filter')?.value || 'ALL';
    const query = filterQuery.toLowerCase();

    const filtered = scheduleDatabase.filter(item => {
        const matchesQuery = item.subject.toLowerCase().includes(query) ||
               item.teacher.toLowerCase().includes(query);
        const matchesGroup = groupFilter === 'ALL' || item.group === groupFilter;
        return matchesQuery && matchesGroup;
    });

    document.getElementById('admin-count').innerText = filtered.length;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr class="row-empty"><td colspan="6" class="cell-empty">No se encontraron registros en la base de datos.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(item => `
        <tr>
            <td class="cell-group">${esc(item.group)}</td>
            <td class="cell-day">${esc(item.day)}</td>
            <td class="cell-time num">${esc(item.time)}</td>
            <td class="cell-subject">${esc(item.subject)}</td>
            <td class="cell-teacher">${esc(item.teacher) || '—'}</td>
            <td class="cell-actions">
                <button type="button" onclick="editScheduleItem(${item.id})" class="icon-btn" title="Editar" aria-label="Editar ${esc(item.subject)}">${icon('pencil')}</button>
                <button type="button" onclick="deleteScheduleItem(${item.id})" class="icon-btn icon-btn--danger" title="Eliminar" aria-label="Eliminar ${esc(item.subject)}">${icon('trash')}</button>
            </td>
        </tr>
    `).join('');
}

function filterAdminTable(query) {
    renderAdminTable(query);
}

// Modal Controls
function openAddModal() {
    document.getElementById('modal-title').innerText = 'Registrar Nueva Materia en Horario';
    document.getElementById('schedule-form').reset();
    document.getElementById('edit-id').value = '';
    document.getElementById('schedule-modal').showModal();
}

function closeAddModal() {
    document.getElementById('schedule-modal').close();
}

function editScheduleItem(id) {
    const item = scheduleDatabase.find(i => i.id === id);
    if (!item) return;

    document.getElementById('modal-title').innerText = 'Editar Registro de Horario';
    document.getElementById('edit-id').value = item.id;
    document.getElementById('form-group').value = item.group;
    document.getElementById('form-day').value = item.day;
    document.getElementById('form-time').value = item.time;
    document.getElementById('form-subject').value = item.subject;
    document.getElementById('form-teacher').value = item.teacher;

    document.getElementById('schedule-modal').showModal();
}

async function saveScheduleItem(e) {
    e.preventDefault();
    const editId = document.getElementById('edit-id').value;
    const group = document.getElementById('form-group').value;
    const day = document.getElementById('form-day').value;
    const time = document.getElementById('form-time').value;
    const subject = document.getElementById('form-subject').value;
    const teacher = document.getElementById('form-teacher').value;

    if (!group) {
        showNotificationToast('Falta el grupo', 'Agrega un grupo primero desde "Gestión de Grupos".', 'warning');
        return;
    }

    const previousState = scheduleDatabase; // por si hay que revertir
    let successMessage;

    if (editId) {
        // Update
        const index = scheduleDatabase.findIndex(i => i.id == editId);
        if (index !== -1) {
            scheduleDatabase = scheduleDatabase.map((item, i) =>
                i === index ? { id: Number(editId), group, day, time, subject, teacher } : item
            );
            successMessage = `Se modificó correctamente la materia ${subject}`;
        }
    } else {
        // Insert
        const newId = scheduleDatabase.length > 0 ? Math.max(...scheduleDatabase.map(i => i.id)) + 1 : 1;
        scheduleDatabase = [...scheduleDatabase, { id: newId, group, day, time, subject, teacher }];
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

function findClass(group, day, slotKey) {
    return scheduleDatabase.find(i => i.group === group && i.day === day && i.time === slotKey);
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
        const prevClass = (day && prevSlot && !prevSlot.receso) ? findClass(currentStudentGroup, day, prevSlot.key) : null;
        const nextClass = (day && slot && !slot.receso) ? findClass(currentStudentGroup, day, slot.key) : null;

        // Solo avisamos si de verdad hay algo que contar (una clase que termina o una que empieza).
        if (prevClass || nextClass || (slot && slot.receso)) {
            fireClassChangeAlert(prevClass, slot, nextClass);
        }
        lastActiveSlotKey = currentKey;
    }
}

function fireClassChangeAlert(prevClass, nextSlot, nextClass) {
    const now = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    // Texto detallado, solo para el registro del panel de admin (ese si dice cual clase termino)
    const terminoTexto = prevClass ? `${prevClass.subject} — ${prevClass.teacher}` : 'Sin clase';
    let sigueTexto;
    if (nextSlot && nextSlot.receso) {
        sigueTexto = 'Receso';
    } else if (nextClass) {
        sigueTexto = `${nextClass.subject} — ${nextClass.teacher}`;
    } else {
        sigueTexto = 'Sin clase';
    }

    // Mensaje que le llega al alumno: NO dice que materia termina, solo avisa que va a terminar
    // y dice con detalle la materia que sigue y su profesor.
    const avisoLineas = [];
    if (prevClass) avisoLineas.push('La clase actual está por terminar.');
    if (nextSlot && nextSlot.receso) {
        avisoLineas.push('Sigue: Receso.');
    } else if (nextClass) {
        avisoLineas.push(`Comienza: ${nextClass.subject}, con el/la profesor(a) ${nextClass.teacher}.`);
    } else if (!prevClass) {
        avisoLineas.push('No hay más clases por el momento.');
    }
    const avisoTexto = avisoLineas.join('\n');

    // 1. Toast dentro de la pagina (para cuando la pestaña esta abierta y visible)
    showNotificationToast('Aviso de Clase', avisoTexto, 'info');

    // 2. Notificacion real del sistema operativo (si ya se dio permiso en este dispositivo)
    sendSystemNotification('CECyTE Plantel 18', avisoTexto);

    // 3. Registro para el panel de admin (este si trae el detalle completo, incluida la que termino)
    alertLog.unshift({ time: now, termino: terminoTexto, sigue: sigueTexto });
    alertLog = alertLog.slice(0, 30);
    renderAlertLog();
}

// Registra el Service Worker (necesario para que las notificaciones funcionen en Android/Chrome)
let swRegistration = null;
async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    try {
        swRegistration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        return swRegistration;
    } catch (err) {
        console.error('No se pudo registrar el Service Worker:', err);
        return null;
    }
}

// Manda una notificacion real del sistema (banner fuera de la pagina), si hay permiso concedido.
// Usa el Service Worker porque Chrome en Android NO deja usar "new Notification()" directo.
async function sendSystemNotification(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    try {
        if ('serviceWorker' in navigator) {
            const reg = swRegistration || await navigator.serviceWorker.ready;
            await reg.showNotification(title, { body, tag: 'cecyte-alerta', renotify: true });
            return;
        }
        // Navegadores de escritorio viejos que no usan Service Worker para esto
        new Notification(title, { body });
    } catch (err) {
        console.error('No se pudo mostrar la notificación:', err);
    }
}

// Recuerda a que grupo esta suscrito este dispositivo (para poder moverlo si cambia de grupo)
let lastSubscribedGroup = localStorage.getItem('cecyte_push_group') || null;

function requestNotificationPermission() {
    if (!('Notification' in window)) {
        updateNotificationStatus('No soportado en este navegador');
        return;
    }
    registerServiceWorker().then(() => {
        Notification.requestPermission().then(async permission => {
            if (permission === 'granted') {
                updateNotificationStatus('Activado en este dispositivo');
                showNotificationToast('Notificaciones Activadas', 'Este dispositivo recibirá avisos de cambio de clase, incluso con la página cerrada.', 'success');
                await subscribeToPush();
            } else {
                updateNotificationStatus('Permiso denegado');
            }
        });
    });
}

// Convierte la llave publica VAPID (texto) al formato que pide pushManager.subscribe
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// Suscribe este dispositivo a notificaciones push reales (funcionan con la pagina cerrada)
async function subscribeToPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!currentStudentGroup) return; // sin grupo elegido todavia, no hay a quien avisar

    try {
        const reg = swRegistration || await navigator.serviceWorker.ready;
        const keyRes = await fetch('/api/push/public-key');
        const { publicKey } = await keyRes.json();
        if (!publicKey) return;

        let subscription = await reg.pushManager.getSubscription();
        if (!subscription) {
            subscription = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey)
            });
        }

        await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group: currentStudentGroup, previousGroup: lastSubscribedGroup, subscription })
        });

        lastSubscribedGroup = currentStudentGroup;
        localStorage.setItem('cecyte_push_group', currentStudentGroup);
    } catch (err) {
        console.error('No se pudo suscribir a notificaciones push:', err);
    }
}

function updateNotificationStatus(text) {
    const el = document.getElementById('notification-status');
    if (el) el.innerText = text;
}

// Botón "Probar" del admin: manda una alerta de ejemplo sin esperar a que cambie la hora real.
// Botón "Probar" del alumno: manda una notificación de prueba genérica, sin inventar clases falsas
function testNotification() {
    const mensaje = 'Esto es una notificación de prueba. Si la ves, ya quedó funcionando en este dispositivo.';
    showNotificationToast('Notificación de Prueba', mensaje, 'info');
    sendSystemNotification('CECyTE Plantel 18 (Prueba)', mensaje);
}

function renderAlertLog() {
    const tbody = document.getElementById('alert-log-body');
    if (!tbody) return;

    if (alertLog.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="log-empty">Todavía no se ha registrado ninguna alerta.</td></tr>`;
        return;
    }

    tbody.innerHTML = alertLog.map(entry => `
        <tr>
            <td class="num">${esc(entry.time)}</td>
            <td>${esc(entry.termino)}</td>
            <td class="go">${esc(entry.sigue)}</td>
        </tr>
    `).join('');
}

function showNotificationToast(title, message, type = 'info') {
    const container = document.getElementById('notification-container');
    const toast = document.createElement('div');
    const iconByType = { success: 'check', info: 'bell', warning: 'alert' };
    toast.className = `toast toast--${iconByType[type] ? type : 'info'}`;

    toast.innerHTML = `
        <div class="toast__icon">${icon(iconByType[type] || 'bell')}</div>
        <div class="toast__body">
            <div class="toast__head">
                <h5 class="toast__title">${esc(title)}</h5>
                <span class="toast__time">Ahora</span>
            </div>
            <p class="toast__msg">${esc(message)}</p>
        </div>
    `;

    container.appendChild(toast);

    // Se cierra solo a los 5 segundos
    setTimeout(() => {
        toast.classList.add('is-leaving');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// ==================== Importar Horario por codigo (JSON) ====================
// Recibe una lista de materias pegada en texto (la genero yo leyendo una foto
// del horario que me mandes por chat) y las agrega todas de un jalón.
async function importSchedule() {
    const textarea = document.getElementById('import-json');
    const statusEl = document.getElementById('import-status');
    statusEl.className = 'msg';
    statusEl.innerText = '';

    let parsed;
    try {
        parsed = JSON.parse(textarea.value);
    } catch (err) {
        statusEl.className = 'msg msg--err';
        statusEl.innerText = 'Eso no es un código válido — revisa que sea JSON correcto (llaves, comillas, comas).';
        return;
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
        statusEl.className = 'msg msg--err';
        statusEl.innerText = 'El código debe ser una lista de materias entre corchetes [ ].';
        return;
    }

    const validTimeKeys = timeSlots.filter(s => !s.receso).map(s => s.key);
    const errors = [];
    parsed.forEach((item, i) => {
        if (!item.group || !item.day || !item.time || !item.subject) {
            errors.push(`Fila ${i + 1}: le falta algún dato (group, day, time o subject). El teacher sí puede venir vacío.`);
            return;
        }
        if (!daysOfWeek.includes(item.day)) errors.push(`Fila ${i + 1}: el día "${item.day}" no es válido.`);
        if (!validTimeKeys.includes(item.time)) errors.push(`Fila ${i + 1}: la hora "${item.time}" no coincide con ningún bloque del horario.`);
    });

    if (errors.length > 0) {
        statusEl.className = 'msg msg--err';
        statusEl.innerHTML = errors.slice(0, 6).join('<br>');
        return;
    }

    statusEl.className = 'msg';
    statusEl.innerText = 'Importando...';

    // Crea sobre la marcha los grupos mencionados que todavia no existan
    const newGroups = [...new Set(parsed.map(i => i.group))].filter(g => !groupsList.includes(g));
    for (const g of newGroups) {
        try {
            const res = await fetch('/api/groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ name: g })
            });
            const data = await res.json();
            if (res.ok) groupsList = data.groups;
        } catch (err) {
            // seguimos aunque falle la creacion de un grupo suelto
        }
    }
    populateGroupSelectors();
    renderGroupsList();

    // Agrega materias nuevas y REEMPLAZA las que ya ocupaban el mismo grupo+dia+hora (evita duplicados encimados)
    const previousState = scheduleDatabase;
    let nextId = scheduleDatabase.length > 0 ? Math.max(...scheduleDatabase.map(i => i.id)) + 1 : 1;
    let workingDatabase = scheduleDatabase;
    let addedCount = 0;
    let replacedCount = 0;

    parsed.forEach(item => {
        const clean = { group: item.group, day: item.day, time: item.time, subject: item.subject, teacher: item.teacher || '' };
        const existingIndex = workingDatabase.findIndex(i => i.group === clean.group && i.day === clean.day && i.time === clean.time);

        if (existingIndex !== -1) {
            const existingId = workingDatabase[existingIndex].id;
            workingDatabase = workingDatabase.map((i, idx) => idx === existingIndex ? { id: existingId, ...clean } : i);
            replacedCount++;
        } else {
            workingDatabase = [...workingDatabase, { id: nextId++, ...clean }];
            addedCount++;
        }
    });

    scheduleDatabase = workingDatabase;

    const saved = await saveScheduleToServer();
    if (!saved) {
        scheduleDatabase = previousState;
        statusEl.className = 'msg msg--err';
        statusEl.innerText = 'No se pudo guardar en el servidor. Intenta de nuevo.';
        return;
    }

    textarea.value = '';
    statusEl.className = 'msg msg--ok';
    statusEl.innerText = `Listo: ${addedCount} materias nuevas agregadas` + (replacedCount ? `, ${replacedCount} reemplazadas (ya ocupaban ese horario).` : '.');
    renderAdminTable();
    renderStudentSchedule();
    showNotificationToast('Horario Importado', `${addedCount} agregadas, ${replacedCount} reemplazadas.`, 'success');
}

// ==================== Timbre escolar (ESP32) ====================
// El ESP32 le pregunta a /api/bell cada ~10s por las horas y por si hay un "tocar ahora".
// Aqui solo editamos esa configuracion y mostramos si el ESP32 esta en linea.
let bellConfig = { times: [], duration: 5, days: [1, 2, 3, 4, 5], lastSeen: null, serverNow: 0 };

async function loadBell(fromPoll = false) {
    if (!isAdminLoggedIn) return;
    try {
        const res = await fetch('/api/bell', { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();

        // En el refresco automatico solo actualizamos el estado "en linea",
        // para no pisar lo que el admin esta editando y todavia no guarda.
        if (fromPoll) {
            bellConfig.lastSeen = data.lastSeen;
            bellConfig.serverNow = data.serverNow;
        } else {
            bellConfig = data;
            renderBell();
        }
        renderBellStatus();
    } catch (err) {
        console.error('No se pudo cargar el timbre:', err);
    }
}

function renderBell() {
    const list = document.getElementById('bell-times-list');
    if (!list) return;
    list.innerHTML = bellConfig.times.length
        ? bellConfig.times.map(t => `
            <span class="chip">${esc(t)}
                <button type="button" class="chip__x" data-time="${esc(t)}" onclick="removeBellTime(this.dataset.time)" title="Quitar" aria-label="Quitar ${esc(t)}">${icon('x')}</button>
            </span>`).join('')
        : '<span class="chips__empty">No hay horas programadas.</span>';

    document.getElementById('bell-duration').value = bellConfig.duration;
    document.querySelectorAll('.bell-day').forEach(cb => {
        cb.checked = bellConfig.days.includes(Number(cb.value));
    });
}

function renderBellStatus() {
    const box = document.getElementById('bell-status');
    const text = document.getElementById('bell-status-text');
    if (!box) return;

    const ageSec = bellConfig.lastSeen ? (bellConfig.serverNow - bellConfig.lastSeen) / 1000 : null;
    if (ageSec !== null && ageSec < 60) {
        box.className = 'badge badge--ok';
        text.innerText = 'ESP32 en línea';
    } else {
        box.className = 'badge badge--off';
        text.innerText = ageSec === null ? 'ESP32 sin conexión (nunca visto)' : 'ESP32 sin conexión';
    }
}

function addBellTime() {
    const input = document.getElementById('bell-new-time');
    if (!input.value) return;
    if (!bellConfig.times.includes(input.value)) {
        bellConfig.times.push(input.value);
        bellConfig.times.sort();
    }
    input.value = '';
    renderBell();
}

function removeBellTime(t) {
    bellConfig.times = bellConfig.times.filter(x => x !== t);
    renderBell();
}

async function saveBell() {
    const msg = document.getElementById('bell-save-msg');
    const days = [...document.querySelectorAll('.bell-day')].filter(cb => cb.checked).map(cb => Number(cb.value));
    const duration = Number(document.getElementById('bell-duration').value);

    msg.className = 'msg';
    msg.innerText = 'Guardando...';

    try {
        const res = await fetch('/api/bell', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ action: 'save', times: bellConfig.times, duration, days })
        });

        if (res.status === 401) {
            isAdminLoggedIn = false;
            showAdminLogin();
            return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al guardar');

        bellConfig = { ...bellConfig, ...data };
        renderBell();
        msg.className = 'msg msg--ok';
        msg.innerText = 'Guardado. El ESP32 lo toma en ~10 segundos.';
    } catch (err) {
        msg.className = 'msg msg--err';
        msg.innerText = err.message;
    }
}

async function ringBellNow() {
    const btn = document.getElementById('bell-ring-btn');
    const msg = document.getElementById('bell-ring-msg');
    btn.disabled = true;
    msg.className = 'msg';
    msg.innerText = 'Enviando orden...';

    try {
        const res = await fetch('/api/bell', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ action: 'ring' })
        });

        if (res.status === 401) {
            isAdminLoggedIn = false;
            showAdminLogin();
            return;
        }
        if (!res.ok) throw new Error('No se pudo enviar la orden.');

        msg.className = 'msg msg--ok';
        msg.innerText = 'Orden enviada. Suena en máximo ~10 segundos.';
    } catch (err) {
        msg.className = 'msg msg--err';
        msg.innerText = err.message;
    } finally {
        setTimeout(() => {
            btn.disabled = false;
        }, 4000);
    }
}

// Initial render on load
window.onload = async function() {
    mobileActiveDay = getDefaultMobileDay(); // abre en el dia real de hoy

    // Tocar fuera del formulario (el fondo del <dialog>) cierra el modal
    const scheduleModal = document.getElementById('schedule-modal');
    scheduleModal.addEventListener('click', e => { if (e.target === scheduleModal) scheduleModal.close(); });
    await loadGroups();   // trae la lista de grupos (necesaria para filtrar el horario)
    await loadSchedule(); // trae el horario real del servidor
    await registerServiceWorker();

    if ('Notification' in window && Notification.permission === 'granted') {
        updateNotificationStatus('Activado en este dispositivo');
        subscribeToPush(); // refresca la suscripcion push por si acaso
    }

    checkScheduleAndNotify();
    updateCurrentClassCard();
    checkAdminSession(); // por si ya habia sesion abierta y refresca la pestaña
    setInterval(checkScheduleAndNotify, 20000); // revisa cambio de clase cada 20 segundos
    setInterval(loadSchedule, 15000); // refresca el horario cada 15 segundos por si otro admin hizo cambios
    setInterval(loadGroups, 15000); // refresca la lista de grupos por si se agrego/borro alguno
    setInterval(() => loadBell(true), 15000); // refresca el estado "ESP32 en linea" del timbre
}
