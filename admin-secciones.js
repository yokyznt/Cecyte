// ==================== Admin: navegación por apartados y secciones ====================
// Tres apartados (Horario, Timbre y Robot) y, dentro de cada uno, sus secciones. Cada apartado lleva
// data-apartado="<id>", cada sección data-section="<id>", y las pestañas data-apartado-tab / data-section-tab.
// Una sección a la vez, a todo el ancho. Funciona con teclado (flechas, Inicio, Fin), recuerda la última
// sección y se puede abrir directo con un enlace: https://.../#admin-timbre
// Depende de: switchView() de app.js (solo para abrir el admin desde el enlace).

const APARTADOS = {
    horario: ['horarios', 'grupos', 'alertas'],
    timbre: ['timbre', 'ritmo', 'esp32'],
    robot: ['robot-musica', 'robot-baile', 'robot-funciones', 'robot-luces', 'robot-instalar'],
};
const ADMIN_SECCIONES = Object.values(APARTADOS).flat();
const ALIAS_SECCION = { robot: 'robot-musica' };          // enlaces viejos: #admin-robot
const PRIMERA_SECCION = 'horarios';
const apartadoDe = id => Object.keys(APARTADOS).find(a => APARTADOS[a].includes(id));
const ultimaPorApartado = {};                              // la sección que tenía cada apartado al salir de él

function seccionGuardada() {
    const deHash = location.hash.startsWith('#admin-') ? location.hash.slice(7) : '';
    const h = ALIAS_SECCION[deHash] || deHash;
    if (ADMIN_SECCIONES.includes(h)) return h;
    try {
        const g = sessionStorage.getItem('adminSeccion');
        if (ADMIN_SECCIONES.includes(g)) return g;
    } catch (e) { /* sin almacenamiento: seguimos con la primera */ }
    return PRIMERA_SECCION;
}

// opciones: enfocar (mueve el foco a la pestaña), recordar (guarda y actualiza el enlace), desplazar (sube a la barra)
function mostrarSeccionAdmin(id, { enfocar = false, recordar = true, desplazar = false } = {}) {
    id = ALIAS_SECCION[id] || id;
    if (!ADMIN_SECCIONES.includes(id)) id = PRIMERA_SECCION;
    const ap = apartadoDe(id);
    ultimaPorApartado[ap] = id;

    document.querySelectorAll('[data-apartado]').forEach(el => { el.hidden = el.dataset.apartado !== ap; });
    document.querySelectorAll('[data-apartado-sub]').forEach(el => { el.hidden = el.dataset.apartadoSub !== ap; });
    document.querySelectorAll('[data-section]').forEach(el => { el.hidden = el.dataset.section !== id; });
    document.querySelectorAll('[data-apartado-tab]').forEach(btn => {
        const activa = btn.dataset.apartadoTab === ap;
        btn.setAttribute('aria-selected', String(activa));
        btn.tabIndex = activa ? 0 : -1;
        if (activa) btn.scrollIntoView({ inline: 'center', block: 'nearest' });
    });
    document.querySelectorAll('[data-section-tab]').forEach(btn => {
        const activa = btn.dataset.sectionTab === id;
        btn.setAttribute('aria-selected', String(activa));
        btn.tabIndex = activa ? 0 : -1;
        if (activa) {
            btn.scrollIntoView({ inline: 'center', block: 'nearest' });   // en celular, la pestaña activa queda a la vista
            if (enfocar) btn.focus();
        }
    });

    document.dispatchEvent(new CustomEvent('seccion-admin', { detail: { id, apartado: ap } }));   // lo escucha robot.js (barra fija)

    if (recordar) {
        try { history.replaceState(null, '', '#admin-' + id); } catch (e) { /* abierto como archivo */ }
        try { sessionStorage.setItem('adminSeccion', id); } catch (e) { /* sin almacenamiento */ }
    }

    if (desplazar) {   // si venías muy abajo, sube justo debajo de la barra de pestañas
        const barra = document.querySelector('.sections');
        const tope = barra.getBoundingClientRect().top + window.scrollY - 64;
        if (window.scrollY > tope) window.scrollTo({ top: tope });
    }
}

document.addEventListener('click', e => {
    const ap = e.target.closest('[data-apartado-tab]');
    if (ap) {
        const a = ap.dataset.apartadoTab;
        mostrarSeccionAdmin(ultimaPorApartado[a] || APARTADOS[a][0], { desplazar: true });
        return;
    }
    const tab = e.target.closest('[data-section-tab]');
    if (tab) mostrarSeccionAdmin(tab.dataset.sectionTab, { desplazar: true });
});

// Flechas, Inicio y Fin recorren las pestañas de su misma barra (apartados o secciones del apartado)
document.addEventListener('keydown', e => {
    const tab = e.target.closest && e.target.closest('[data-apartado-tab], [data-section-tab]');
    if (!tab) return;
    const esApartado = tab.hasAttribute('data-apartado-tab');
    const lista = esApartado ? Object.keys(APARTADOS) : APARTADOS[apartadoDe(tab.dataset.sectionTab)];
    const actual = esApartado ? tab.dataset.apartadoTab : tab.dataset.sectionTab;
    const i = lista.indexOf(actual);
    const destino = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: lista.length - 1 }[e.key];
    if (destino === undefined) return;
    e.preventDefault();
    const nuevo = lista[(destino + lista.length) % lista.length];
    mostrarSeccionAdmin(esApartado ? (ultimaPorApartado[nuevo] || APARTADOS[nuevo][0]) : nuevo, { enfocar: !esApartado });
    if (esApartado) document.getElementById('tab-ap-' + nuevo).focus();
});

window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#admin-')) mostrarSeccionAdmin(seccionGuardada(), { recordar: false });
});

window.addEventListener('load', () => {
    mostrarSeccionAdmin(seccionGuardada(), { recordar: false });
    if (location.hash.startsWith('#admin') && typeof switchView === 'function') switchView('admin');   // enlace directo al admin
});
