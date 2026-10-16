// Exportar el horario de un grupo a un archivo de calendario (.ics) para Google Calendar, Apple, Outlook...
// Cada materia es un evento que se repite cada semana a su hora (hora local, sin zona: igual en cualquier lugar).
// Sirve en el navegador (window.Calendario) y en Node (para las pruebas).

(function (raiz) {
    'use strict';

    const DIAS = { 'Lunes': 1, 'Martes': 2, 'Miércoles': 3, 'Jueves': 4, 'Viernes': 5 };
    const BYDAY = { 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR' };
    const HORA = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;

    const pad = n => String(n).padStart(2, '0');
    const fechaLocal = (d, h, m) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(h)}${pad(m)}00`;
    const fechaUTC = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

    // Escapes de texto del formato iCalendar: \ ; , y saltos de línea
    function escapar(t) {
        return String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    }

    // Las líneas largas se parten a 70 caracteres con un espacio de continuación (el límite es 75 bytes)
    function plegar(linea) {
        const trozos = [];
        let resto = linea;
        while (resto.length > 70) {
            trozos.push(resto.slice(0, 70));
            resto = ' ' + resto.slice(70);
        }
        trozos.push(resto);
        return trozos.join('\r\n');
    }

    // materias: [{ id, group, day, time: "07:00 - 08:00", subject, teacher }]
    // La primera vez de cada materia cae en la próxima fecha de ese día (hoy incluido).
    // Devuelve { texto, eventos } (eventos = cuántas materias se pudieron exportar).
    function construirICS(materias, grupo, hoy = new Date()) {
        const base = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
        const sello = fechaUTC(hoy);
        const lineas = [];
        let eventos = 0;
        for (const m of materias) {
            if (!m || m.group !== grupo) continue;
            const dia = DIAS[m.day];
            const t = HORA.exec(String(m.time || ''));
            if (!dia || !t) continue;
            const ini = [Number(t[1]), Number(t[2])], fin = [Number(t[3]), Number(t[4])];
            if (ini[0] > 23 || fin[0] > 23 || ini[1] > 59 || fin[1] > 59) continue;
            if (fin[0] * 60 + fin[1] <= ini[0] * 60 + ini[1]) continue;
            const d = new Date(base);
            d.setDate(d.getDate() + ((dia - d.getDay() + 7) % 7));
            lineas.push(
                'BEGIN:VEVENT',
                `UID:${m.id}-${dia}-${pad(ini[0])}${pad(ini[1])}@cecyteo.vercel.app`,
                `DTSTAMP:${sello}`,
                `DTSTART:${fechaLocal(d, ini[0], ini[1])}`,
                `DTEND:${fechaLocal(d, fin[0], fin[1])}`,
                `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[dia]}`,
                `SUMMARY:${escapar(m.subject)}`,
                ...(m.teacher ? [`DESCRIPTION:${escapar('Docente: ' + m.teacher)}`] : []),
                `LOCATION:${escapar('CECyTE Plantel 18')}`,
                'END:VEVENT'
            );
            eventos++;
        }
        const todo = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//CECyTE Plantel 18//Horario//ES',
            'CALSCALE:GREGORIAN',
            `X-WR-CALNAME:${escapar('Horario ' + grupo)}`,
            ...lineas,
            'END:VCALENDAR',
        ].map(plegar);
        return { texto: todo.join('\r\n') + '\r\n', eventos };
    }

    // ---------- Pegar el horario desde Excel ----------
    // Convierte filas copiadas de una hoja de cálculo (columnas separadas por tabulador o ;) en materias:
    // grupo, día, hora, materia y maestro (el maestro puede ir vacío). Tolera encabezado, líneas vacías, comillas de
    // Excel, días sin acento o en mayúsculas y horas como "7:00-8:00". dias y bloques son los de app.js (daysOfWeek y los timeSlots sin receso).
    const sinAcentos = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

    function celda(c) {
        c = String(c).trim();
        if (c.length >= 2 && c[0] === '"' && c[c.length - 1] === '"') c = c.slice(1, -1).replace(/""/g, '"').trim();
        return c;
    }

    function filasAHorario(texto, dias, bloques) {
        const items = [], errores = [];
        String(texto).split(/\r?\n/).forEach((linea, i) => {
            if (!linea.trim()) return;
            const c = linea.split(linea.includes('\t') ? '\t' : ';').map(celda);
            if (i === 0 && sinAcentos(c[0]) === 'grupo') return;                      // encabezado
            const n = i + 1;
            if (c.length < 4 || !c[0] || !c[3]) { errores.push(`Fila ${n}: faltan datos (grupo, día, hora y materia son obligatorios; el maestro puede ir vacío).`); return; }
            const dia = dias.find(d => sinAcentos(d) === sinAcentos(c[1]));
            if (!dia) { errores.push(`Fila ${n}: el día "${c[1]}" no es válido.`); return; }
            const h = /^(\d{1,2}):(\d{2})\s*(?:-|a|–)\s*(\d{1,2}):(\d{2})$/i.exec(c[2]);
            const hora = h ? `${h[1].padStart(2, '0')}:${h[2]} - ${h[3].padStart(2, '0')}:${h[4]}` : '';
            if (!bloques.includes(hora)) { errores.push(`Fila ${n}: la hora "${c[2]}" no coincide con ningún bloque del horario.`); return; }
            items.push({ group: c[0], day: dia, time: hora, subject: c[3], teacher: c[4] || '' });
        });
        return { items, errores };
    }

    const lib = { construirICS, filasAHorario };
    if (typeof module !== 'undefined' && module.exports) module.exports = lib;
    else raiz.Calendario = lib;
})(typeof window !== 'undefined' ? window : globalThis);
