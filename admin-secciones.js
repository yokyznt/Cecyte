// ==================== Admin: navegación por secciones ====================
// Una sección a la vez, a todo el ancho. Cada bloque del admin lleva data-section="<id>" y
// cada pestaña data-section-tab="<id>". Funciona con teclado (flechas, Inicio, Fin), recuerda la
// última sección y se puede abrir directo con un enlace: https://.../#admin-timbre
// Depende de: switchView() de app.js (solo para abrir el admin desde el enlace).

const ADMIN_SECCIONES = ['horarios', 'timbre', 'ritmo', 'esp32', 'robot', 'grupos', 'alertas'];

function seccionGuardada() {
    const deHash = location.hash.startsWith('#admin-') ? location.hash.slice(7) : '';
    if (ADMIN_SECCIONES.includes(deHash)) return deHash;
    try {
        const g = sessionStorage.getItem('adminSeccion');
        if (ADMIN_SECCIONES.includes(g)) return g;
    } catch (e) { /* sin almacenamiento: seguimos con la primera */ }
    return 'horarios';
}

// opciones: enfocar (mueve el foco a la pestaña), recordar (guarda y actualiza el enlace), desplazar (sube a la barra)
function mostrarSeccionAdmin(id, { enfocar = false, recordar = true, desplazar = false } = {}) {
    if (!ADMIN_SECCIONES.includes(id)) id = 'horarios';

    document.querySelectorAll('[data-section]').forEach(el => { el.hidden = el.dataset.section !== id; });
    document.querySelectorAll('[data-section-tab]').forEach(btn => {
        const activa = btn.dataset.sectionTab === id;
        btn.setAttribute('aria-selected', String(activa));
        btn.tabIndex = activa ? 0 : -1;
        if (activa) {
            btn.scrollIntoView({ inline: 'center', block: 'nearest' });   // en celular, la pestaña activa queda a la vista
            if (enfocar) btn.focus();
        }
    });

    if (recordar) {
        try { history.replaceState(null, '', '#admin-' + id); } catch (e) { /* abierto como archivo */ }
        try { sessionStorage.setItem('adminSeccion', id); } catch (e) { /* sin almacenamiento */ }
    }

    if (desplazar) {   // si venías muy abajo, sube justo debajo de la barra de secciones
        const barra = document.querySelector('.sections');
        const tope = barra.getBoundingClientRect().top + window.scrollY - 64;
        if (window.scrollY > tope) window.scrollTo({ top: tope });
    }
}

document.addEventListener('click', e => {
    const tab = e.target.closest('[data-section-tab]');
    if (tab) mostrarSeccionAdmin(tab.dataset.sectionTab, { desplazar: true });
});

document.addEventListener('keydown', e => {
    const tab = e.target.closest && e.target.closest('[data-section-tab]');
    if (!tab) return;
    const i = ADMIN_SECCIONES.indexOf(tab.dataset.sectionTab);
    const destino = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: ADMIN_SECCIONES.length - 1 }[e.key];
    if (destino === undefined) return;
    e.preventDefault();
    mostrarSeccionAdmin(ADMIN_SECCIONES[(destino + ADMIN_SECCIONES.length) % ADMIN_SECCIONES.length], { enfocar: true });
});

window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#admin-')) mostrarSeccionAdmin(seccionGuardada(), { recordar: false });
});

window.addEventListener('load', () => {
    mostrarSeccionAdmin(seccionGuardada(), { recordar: false });
    if (location.hash.startsWith('#admin') && typeof switchView === 'function') switchView('admin');   // enlace directo al admin
});
