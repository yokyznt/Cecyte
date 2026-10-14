// node test/calendario.test.js -> el archivo de calendario (.ics) del horario, el manifiesto y el modo sin conexión
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { construirICS } = require('../calendario.js');

const raiz = path.join(__dirname, '..');
const miercoles = new Date(2026, 9, 14, 12, 0, 0);          // miércoles 14 de octubre de 2026

const materias = [
    { id: 1, group: '501', day: 'Lunes', time: '07:00 - 08:00', subject: 'Cálculo, I; "parcial"', teacher: 'Ing. Gómez' },
    { id: 2, group: '501', day: 'Miércoles', time: '9:15 - 10:00', subject: 'Física', teacher: '' },
    { id: 3, group: '502', day: 'Lunes', time: '07:00 - 08:00', subject: 'Otra' },
    { id: 4, group: '501', day: 'Sábado', time: '07:00 - 08:00', subject: 'Día raro' },
    { id: 5, group: '501', day: 'Martes', time: '10:00 - 09:00', subject: 'Hora al revés' },
    { id: 6, group: '501', day: 'Martes', time: 'ocho', subject: 'Hora rara' },
];
const { texto, eventos } = construirICS(materias, '501', miercoles);
assert.strictEqual(eventos, 2, 'solo las materias válidas del grupo');
assert(texto.startsWith('BEGIN:VCALENDAR\r\n') && texto.endsWith('END:VCALENDAR\r\n'));
assert.strictEqual((texto.match(/BEGIN:VEVENT/g) || []).length, 2);
assert(texto.includes('DTSTART:20261019T070000') && texto.includes('DTEND:20261019T080000'), 'el lunes siguiente');
assert(texto.includes('DTSTART:20261014T091500') && texto.includes('DTEND:20261014T100000'), 'hoy mismo si es ese día');
assert(texto.includes('RRULE:FREQ=WEEKLY;BYDAY=MO') && texto.includes('RRULE:FREQ=WEEKLY;BYDAY=WE'));
const BS = String.fromCharCode(92);
assert(texto.includes('SUMMARY:Cálculo' + BS + ', I' + BS + '; "parcial"'), 'comas y puntos y coma se escapan');
assert(texto.includes('DESCRIPTION:Docente: Ing. Gómez'));
assert(!texto.includes('Otra') && !texto.includes('Día raro') && !texto.includes('Hora al revés'));
assert(texto.split('\r\n').every(l => l.length <= 71), 'líneas plegadas');
assert.strictEqual(new Set([...texto.matchAll(/UID:(\S+)/g)].map(m => m[1])).size, 2, 'UID únicos');
assert.strictEqual(construirICS([], '501', miercoles).eventos, 0);
assert.strictEqual(construirICS(materias, 'no-existe', miercoles).eventos, 0);

// el manifiesto hace la página instalable
const manifiesto = JSON.parse(fs.readFileSync(path.join(raiz, 'manifest.webmanifest'), 'utf8'));
assert(manifiesto.name && manifiesto.short_name && manifiesto.start_url === '/' && manifiesto.display === 'standalone');
assert(manifiesto.icons.some(i => i.sizes === '192x192') && manifiesto.icons.some(i => i.sizes === '512x512'));
manifiesto.icons.forEach(i => assert(fs.existsSync(path.join(raiz, i.src)), 'falta el icono ' + i.src));
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
assert(html.includes('rel="manifest" href="manifest.webmanifest"') && html.includes('<script src="calendario.js">'));

// el service worker solo guarda archivos propios y la API pública del horario; nada de sesión ni de timbre
const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
assert(sw.includes("API_GUARDABLE = ['/api/schedule', '/api/groups']"));
assert(/req\.method !== 'GET'/.test(sw) && /url\.origin !== self\.location\.origin/.test(sw));
['/', '/index.html', '/app.js', '/styles.css', '/calendario.js'].forEach(u => assert(sw.includes(`'${u}'`), 'precache ' + u));
assert(/addEventListener\('push'/.test(sw) && /addEventListener\('notificationclick'/.test(sw), 'sigue dando los avisos push');

console.log('calendario.test.js: todo bien');
