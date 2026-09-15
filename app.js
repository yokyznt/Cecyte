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
let mobileActiveDay = 'Lunes'; // Dia mostrado en la vista de lista para celular

// Live Clock updater + tarjeta "Estado Actual" (ambos con la hora real)
setInterval(() => {
    const now = new Date();
    document.getElementById('live-clock').innerText = now.toLocaleTimeString('es-MX');
    updateCurrentClassCard();
}, 1000);

// Pinta la tarjeta "Estado Actual" segun la hora real y el horario cargado del servidor
function updateCurrentClassCard() {
    const titleEl = document.getElementById('current-subject-title');
    const teacherEl = document.getElementById('current-teacher-name');
    const timeEl = document.getElementById('current-subject-time');
    const percentEl = document.getElementById('progress-percent');
    const barEl = document.getElementById('class-progress-bar');
    const countdownEl = document.getElementById('countdown-timer');
    const nextEl = document.getElementById('next-subject-name');
    if (!titleEl) return; // la tarjeta no esta en pantalla todavia

    const day = getCurrentDaySpanish();
    const slot = day ? getCurrentSlot() : null;

    if (!slot) {
        titleEl.innerText = day ? 'Sin clase en este momento' : 'Hoy no hay clases';
        teacherEl.innerHTML = '<i class="fa-solid fa-chalkboard-user text-emerald-600"></i> —';
        timeEl.innerText = '—';
        percentEl.innerText = '—';
        barEl.style.width = '0%';
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
        teacherEl.innerHTML = '<i class="fa-solid fa-mug-hot text-emerald-600"></i> Disfruta tu receso';
    } else if (currentClass) {
        titleEl.innerText = currentClass.subject;
        teacherEl.innerHTML = `<i class="fa-solid fa-chalkboard-user text-emerald-600"></i> ${currentClass.teacher}`;
    } else {
        titleEl.innerText = 'Hora libre';
        teacherEl.innerHTML = '<i class="fa-solid fa-chalkboard-user text-emerald-600"></i> —';
    }

    timeEl.innerText = `${slot.key} hrs`;
    percentEl.innerText = `${percent}%`;
    barEl.style.width = `${percent}%`;
    countdownEl.innerText = `${remMin}:${remSec}`;
    nextEl.innerText = findNextClassLabel(day, slot.key) || 'Sin más clases hoy';
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
            ? groupsList.map(g => `<option value="${g}" ${g === currentStudentGroup ? 'selected' : ''}>${g}</option>`).join('')
            : '<option value="">Sin grupos todavía</option>';
    }

    const adminFilter = document.getElementById('admin-group-filter');
    if (adminFilter) {
        const current = adminFilter.value || 'ALL';
        adminFilter.innerHTML = '<option value="ALL">Todos los Grupos</option>' +
            groupsList.map(g => `<option value="${g}">${g}</option>`).join('');
        adminFilter.value = groupsList.includes(current) || current === 'ALL' ? current : 'ALL';
    }

    const formGroup = document.getElementById('form-group');
    if (formGroup) {
        formGroup.innerHTML = groupsList.length
            ? groupsList.map(g => `<option value="${g}">${g}</option>`).join('')
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
        container.innerHTML = '<p class="text-xs text-slate-400 italic">Todavía no hay grupos. Agrega uno arriba.</p>';
        return;
    }

    container.innerHTML = groupsList.map(g => `
        <span class="inline-flex items-center gap-2 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg pl-3 pr-2 py-1.5 text-xs font-semibold">
            ${g}
            <button type="button" onclick="deleteGroup('${g.replace(/'/g, "\\'")}')" class="text-emerald-400 hover:text-rose-600 transition">
                <i class="fa-solid fa-xmark"></i>
            </button>
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
    populateGroupSelectors();
    renderGroupsList();
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
                const match = scheduleDatabase.find(i => i.group === currentStudentGroup && i.day === day && i.time === slot.key);
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
            const match = scheduleDatabase.find(i => i.group === currentStudentGroup && i.day === mobileActiveDay && i.time === slot.key);
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

    const groupFilter = document.getElementById('admin-group-filter')?.value || 'ALL';

    let filtered = scheduleDatabase.filter(item => {
        const matchesQuery = item.subject.toLowerCase().includes(filterQuery.toLowerCase()) ||
               item.teacher.toLowerCase().includes(filterQuery.toLowerCase());
        const matchesGroup = groupFilter === 'ALL' || item.group === groupFilter;
        return matchesQuery && matchesGroup;
    });

    document.getElementById('admin-count').innerText = filtered.length;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-400 italic">No se encontraron registros en la base de datos.</td></tr>`;
        return;
    }

    filtered.forEach(item => {
        let tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition';
        tr.innerHTML = `
            <td class="py-3 px-4 font-bold text-emerald-700">${item.group}</td>
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
    document.getElementById('form-group').value = item.group;
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

function requestNotificationPermission() {
    if (!('Notification' in window)) {
        updateNotificationStatus('No soportado en este navegador');
        return;
    }
    registerServiceWorker().then(() => {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                updateNotificationStatus('Activado en este dispositivo');
                showNotificationToast('Notificaciones Activadas', 'Este dispositivo recibirá avisos de cambio de clase.', 'success');
            } else {
                updateNotificationStatus('Permiso denegado');
            }
        });
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

// ==================== Importar Horario por codigo (JSON) ====================
// Recibe una lista de materias pegada en texto (la genero yo leyendo una foto
// del horario que me mandes por chat) y las agrega todas de un jalón.
async function importSchedule() {
    const textarea = document.getElementById('import-json');
    const statusEl = document.getElementById('import-status');
    statusEl.className = 'text-xs text-slate-500';
    statusEl.innerText = '';

    let parsed;
    try {
        parsed = JSON.parse(textarea.value);
    } catch (err) {
        statusEl.className = 'text-xs text-rose-600 font-semibold';
        statusEl.innerText = 'Eso no es un código válido — revisa que sea JSON correcto (llaves, comillas, comas).';
        return;
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
        statusEl.className = 'text-xs text-rose-600 font-semibold';
        statusEl.innerText = 'El código debe ser una lista de materias entre corchetes [ ].';
        return;
    }

    const validTimeKeys = timeSlots.filter(s => !s.receso).map(s => s.key);
    const errors = [];
    parsed.forEach((item, i) => {
        if (!item.group || !item.day || !item.time || !item.subject || !item.teacher) {
            errors.push(`Fila ${i + 1}: le falta algún dato (group, day, time, subject o teacher).`);
            return;
        }
        if (!daysOfWeek.includes(item.day)) errors.push(`Fila ${i + 1}: el día "${item.day}" no es válido.`);
        if (!validTimeKeys.includes(item.time)) errors.push(`Fila ${i + 1}: la hora "${item.time}" no coincide con ningún bloque del horario.`);
    });

    if (errors.length > 0) {
        statusEl.className = 'text-xs text-rose-600 font-semibold';
        statusEl.innerHTML = errors.slice(0, 6).join('<br>');
        return;
    }

    statusEl.className = 'text-xs text-slate-500';
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

    // Agrega las materias nuevas con ids consecutivos
    const previousState = scheduleDatabase;
    let nextId = scheduleDatabase.length > 0 ? Math.max(...scheduleDatabase.map(i => i.id)) + 1 : 1;
    const newItems = parsed.map(item => ({
        id: nextId++,
        group: item.group,
        day: item.day,
        time: item.time,
        subject: item.subject,
        teacher: item.teacher
    }));
    scheduleDatabase = [...scheduleDatabase, ...newItems];

    const saved = await saveScheduleToServer();
    if (!saved) {
        scheduleDatabase = previousState;
        statusEl.className = 'text-xs text-rose-600 font-semibold';
        statusEl.innerText = 'No se pudo guardar en el servidor. Intenta de nuevo.';
        return;
    }

    textarea.value = '';
    statusEl.className = 'text-xs text-emerald-700 font-semibold';
    statusEl.innerText = `Se importaron ${newItems.length} materias correctamente.`;
    renderAdminTable();
    renderStudentSchedule();
    showNotificationToast('Horario Importado', `Se agregaron ${newItems.length} materias.`, 'success');
}

// Initial render on load
window.onload = async function() {
    await loadGroups();   // trae la lista de grupos (necesaria para filtrar el horario)
    await loadSchedule(); // trae el horario real del servidor
    await registerServiceWorker();

    if ('Notification' in window && Notification.permission === 'granted') {
        updateNotificationStatus('Activado en este dispositivo');
    }

    checkScheduleAndNotify();
    updateCurrentClassCard();
    checkAdminSession(); // por si ya habia sesion abierta y refresca la pestaña
    setInterval(checkScheduleAndNotify, 20000); // revisa cambio de clase cada 20 segundos
    setInterval(loadSchedule, 15000); // refresca el horario cada 15 segundos por si otro admin hizo cambios
    setInterval(loadGroups, 15000); // refresca la lista de grupos por si se agrego/borro alguno
}
