let gestion = { admins: [], permisos: [], grupos: [], max: 20 };

const ALFABETO_CLAVES = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const gestionEl = id => document.getElementById(id);

function gestionAbierta() {
    const el = gestionEl('admin-gestion');
    return !!el && !el.hidden;
}

function ponerBotonAdmin(enGestion, animar) {
    const boton = gestionEl('tab-admin');
    const uso = gestionEl('tab-admin-uso');
    const texto = gestionEl('tab-admin-texto');
    if (!boton || !uso || !texto) return;
    const cambiar = () => {
        uso.setAttribute('href', enGestion ? '#i-ajustes' : '#i-sliders');
        texto.textContent = enGestion ? 'Ajustes de admins' : 'Admin Horarios';
        boton.setAttribute('aria-label', texto.textContent);
    };
    const icono = boton.querySelector('.icon');
    if (!animar || matchMedia('(prefers-reduced-motion: reduce)').matches) return cambiar();
    icono.classList.remove('is-girando');
    void icono.getBoundingClientRect();
    icono.classList.add('is-girando');
    icono.addEventListener('animationend', () => icono.classList.remove('is-girando'), { once: true });
    setTimeout(cambiar, 180);
}

function abrirGestionAdmins() {
    const sesion = typeof sesionAdmin === 'function' ? sesionAdmin() : null;
    if (!sesion || sesion.rol !== 'master') return;
    gestionEl('admin-content').classList.add('en-gestion');
    gestionEl('admin-gestion').hidden = false;
    ponerBotonAdmin(true, true);
    window.scrollTo({ top: 0 });
    cargarAdmins();
}

function cerrarGestionAdmins(animar = false) {
    const cont = gestionEl('admin-content');
    const sec = gestionEl('admin-gestion');
    if (!cont || !sec) return;
    const estabaAbierta = !sec.hidden;
    cont.classList.remove('en-gestion');
    sec.hidden = true;
    if (estabaAbierta) ponerBotonAdmin(false, animar);
}

function alternarGestionAdmins() {
    if (gestionAbierta()) cerrarGestionAdmins(true);
    else abrirGestionAdmins();
}

async function cargarAdmins() {
    const lista = gestionEl('gestion-lista');
    lista.innerHTML = '<p class="chips__empty">Cargando…</p>';
    try {
        const res = await API.fetch('/api/admins', { cache: 'no-store' });
        const datos = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(datos.error || 'No se pudo cargar.');
        gestion = datos;
        pintarAdmins();
    } catch (err) {
        lista.innerHTML = `<p class="msg msg--err" role="alert">${esc(err.message || 'Sin conexión.')}</p>`;
    }
}

function resumenPermisos(a) {
    return gestion.grupos.map(g => {
        const del = gestion.permisos.filter(p => p.grupo === g.id);
        const tiene = del.filter(p => a.permisos.includes(p.id));
        if (!tiene.length) return '';
        const todo = tiene.length === del.length;
        const nombres = tiene.map(p => p.nombre).join(', ');
        return `<span class="perm-chip${todo ? ' is-todo' : ''}" title="${esc(nombres)}"><b>${esc(g.nombre)}</b> ${todo ? 'todo' : `${tiene.length}/${del.length}`}</span>`;
    }).join('');
}

function pintarAdmins() {
    const maestro = `
        <article class="admin-card admin-card--maestro">
            <span class="admin-card__avatar">${icon('escudo')}</span>
            <div class="admin-card__info">
                <h3 class="admin-card__nombre">Maestro</h3>
                <div class="admin-card__perms"><span class="perm-chip is-todo"><b>Todo</b> incluye admins</span></div>
                <p class="admin-card__nota">Su contraseña solo existe en el servidor y no se puede ver ni cambiar aquí.</p>
            </div>
        </article>`;

    const tarjetas = gestion.admins.map(a => `
        <article class="admin-card">
            <span class="admin-card__avatar" aria-hidden="true">${esc(a.nombre.charAt(0).toUpperCase())}</span>
            <div class="admin-card__info">
                <h3 class="admin-card__nombre">${esc(a.nombre)}</h3>
                <div class="admin-card__perms">${resumenPermisos(a)}</div>
            </div>
            <div class="admin-card__acc">
                <button type="button" class="icon-btn" data-editar="${esc(a.id)}" aria-label="Editar a ${esc(a.nombre)}">${icon('pencil')}</button>
                <button type="button" class="icon-btn icon-btn--danger" data-borrar="${esc(a.id)}" aria-label="Borrar a ${esc(a.nombre)}">${icon('trash')}</button>
            </div>
        </article>`).join('');

    const vacio = gestion.admins.length ? '' : `
        <div class="gestion__vacio">
            <p>Aún no hay más admins.</p>
            <p class="hint">Crea uno con su propia contraseña y elige qué puede tocar.</p>
        </div>`;

    gestionEl('gestion-lista').innerHTML = maestro + tarjetas + vacio;
    gestionEl('gestion-cuenta').textContent = `${gestion.admins.length} de ${gestion.max} admins`;
    gestionEl('gestion-nuevo').disabled = gestion.admins.length >= gestion.max;
}

function pintarPermisosForm(marcados) {
    gestionEl('admin-form-permisos').innerHTML = gestion.grupos.map(g => {
        const items = gestion.permisos.filter(p => p.grupo === g.id).map(p => `
            <label class="perm-op">
                <input type="checkbox" name="permiso" value="${esc(p.id)}"${marcados.includes(p.id) ? ' checked' : ''}>
                <span>${esc(p.nombre)}</span>
            </label>`).join('');
        return `
            <div class="permisos__grupo">
                <div class="permisos__cab">
                    <span class="permisos__nombre">${esc(g.nombre)}</span>
                    <button type="button" class="permisos__todo" data-grupo="${esc(g.id)}">Todo</button>
                </div>
                <div class="permisos__lista">${items}</div>
            </div>`;
    }).join('');
}

function marcarPermisos(ids) {
    document.querySelectorAll('#admin-form-permisos input[name="permiso"]').forEach(c => { c.checked = ids === 'todos' || ids.includes(c.value); });
}

function abrirFormAdmin(id) {
    const a = id ? gestion.admins.find(x => x.id === id) : null;
    gestionEl('admin-form').reset();
    gestionEl('admin-form-id').value = a ? a.id : '';
    gestionEl('admin-form-titulo').textContent = a ? 'Editar admin' : 'Nuevo admin';
    gestionEl('admin-form-nombre').value = a ? a.nombre : '';
    const clave = gestionEl('admin-form-clave');
    clave.type = 'password';
    clave.required = !a;
    clave.placeholder = a ? 'Déjala vacía para no cambiarla' : '6 a 64 caracteres';
    gestionEl('admin-form-ver').textContent = 'Ver';
    gestionEl('admin-form-ver').setAttribute('aria-pressed', 'false');
    gestionEl('admin-form-error').hidden = true;
    pintarPermisosForm(a ? a.permisos : []);
    gestionEl('admin-form-modal').showModal();
    gestionEl('admin-form-nombre').focus();
}

function cerrarFormAdmin() {
    gestionEl('admin-form-modal').close();
}

function generarClave() {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return Array.from(bytes, b => ALFABETO_CLAVES[b % ALFABETO_CLAVES.length]).join('');
}

function errorForm(texto) {
    const el = gestionEl('admin-form-error');
    el.textContent = texto;
    el.hidden = false;
}

async function guardarAdmin(e) {
    e.preventDefault();
    const id = gestionEl('admin-form-id').value;
    const permisos = Array.from(document.querySelectorAll('#admin-form-permisos input[name="permiso"]:checked'), c => c.value);
    if (!permisos.length) return errorForm('Elige al menos un permiso.');

    const cuerpo = { nombre: gestionEl('admin-form-nombre').value.trim(), permisos };
    const clave = gestionEl('admin-form-clave').value;
    if (clave || !id) cuerpo.clave = clave;
    if (id) cuerpo.id = id;

    const boton = gestionEl('admin-form-guardar');
    boton.disabled = true;
    gestionEl('admin-form-error').hidden = true;
    try {
        const res = await API.fetch('/api/admins', {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cuerpo)
        });
        const datos = await res.json().catch(() => ({}));
        if (!res.ok) return errorForm(datos.error || 'No se pudo guardar.');
        cerrarFormAdmin();
        showNotificationToast(id ? 'Admin actualizado' : 'Admin creado', cuerpo.nombre, 'success');
        await cargarAdmins();
    } catch (err) {
        errorForm('No se pudo conectar con el servidor.');
    } finally {
        boton.disabled = false;
    }
}

async function borrarAdmin(id) {
    const a = gestion.admins.find(x => x.id === id);
    if (!a || !confirm(`¿Borrar a "${a.nombre}"? Perderá el acceso de inmediato.`)) return;
    try {
        const res = await API.fetch('/api/admins?id=' + encodeURIComponent(id), { method: 'DELETE' });
        const datos = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(datos.error || 'No se pudo borrar.');
        showNotificationToast('Admin borrado', a.nombre, 'success');
        await cargarAdmins();
    } catch (err) {
        showNotificationToast('No se pudo borrar', err.message || 'Sin conexión.', 'warning');
    }
}

document.addEventListener('click', e => {
    const editar = e.target.closest('[data-editar]');
    if (editar) return abrirFormAdmin(editar.dataset.editar);
    const borrar = e.target.closest('[data-borrar]');
    if (borrar) return borrarAdmin(borrar.dataset.borrar);
    const grupo = e.target.closest('[data-grupo]');
    if (grupo) {
        const cajas = Array.from(document.querySelectorAll('#admin-form-permisos input[name="permiso"]')).filter(c => gestion.permisos.find(p => p.id === c.value).grupo === grupo.dataset.grupo);
        const todas = cajas.every(c => c.checked);
        cajas.forEach(c => { c.checked = !todas; });
        return;
    }
    if (e.target.closest('#admin-perm-todos')) return marcarPermisos('todos');
    if (e.target.closest('#admin-perm-ninguno')) return marcarPermisos([]);
    if (e.target.closest('#admin-form-gen')) {
        const campo = gestionEl('admin-form-clave');
        campo.value = generarClave();
        campo.type = 'text';
        gestionEl('admin-form-ver').textContent = 'Ocultar';
        gestionEl('admin-form-ver').setAttribute('aria-pressed', 'true');
        return;
    }
    if (e.target.closest('#admin-form-ver')) {
        const campo = gestionEl('admin-form-clave');
        const mostrar = campo.type === 'password';
        campo.type = mostrar ? 'text' : 'password';
        gestionEl('admin-form-ver').textContent = mostrar ? 'Ocultar' : 'Ver';
        gestionEl('admin-form-ver').setAttribute('aria-pressed', String(mostrar));
    }
});
