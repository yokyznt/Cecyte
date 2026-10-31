// El aviso dice solo lo que sigue: materia y maestro (o «Receso» / «No hay más clases por hoy»). Igual que textoAviso() de app.js
export function buildMessage(prevClass, slot, nextClass, cambio) {
    if (slot && slot.receso) return 'Receso';
    if (nextClass && cambio) return `${nextClass.subject}: ${cambio.tipo === 'cancelada' ? 'cancelada hoy' : 'maestro ausente'}`;
    if (nextClass) return nextClass.teacher ? `${nextClass.subject}, ${nextClass.teacher}` : nextClass.subject;
    return 'No hay más clases por hoy';
}
