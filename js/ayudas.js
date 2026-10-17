// Menos texto en pantalla: cada párrafo de ayuda (p.hint) queda plegado detrás de un icono «i» y se abre al tocarlo.
// Si justo antes hay un título, el icono se pega al título; si no, queda en su lugar.
// No toca los avisos que cambian solos (los que tienen id) ni los que llevan un botón dentro.
(function () {
    const SVG = '<svg class="icon" aria-hidden="true"><use href="#i-info"/></svg>';
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) return;

    document.querySelectorAll('p.hint').forEach(p => {
        if (p.id || p.querySelector('button, a') || p.closest('.rb-mando')) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ayuda';
        b.setAttribute('aria-expanded', 'false');
        b.setAttribute('aria-label', 'Ver ayuda');
        b.innerHTML = SVG;
        if (p.dataset.solo) b.dataset.solo = p.dataset.solo;
        p.classList.add('hint--plegado');
        const antes = p.previousElementSibling;
        if (antes && /^H[1-6]$/.test(antes.tagName)) antes.appendChild(b);
        else p.parentNode.insertBefore(b, p);
        b.addEventListener('click', () => {
            const abre = b.getAttribute('aria-expanded') !== 'true';
            b.setAttribute('aria-expanded', String(abre));
            p.classList.toggle('hint--plegado', !abre);
        });
    });
})();
