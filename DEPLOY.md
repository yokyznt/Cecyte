# Cómo subir esto a Vercel (paso a paso)

Ya no es una página estática nomás — ahora tiene un "cerebrito" atrás (API +
base de datos) para que el horario sea el mismo para todos y solo tú lo
puedas editar. Sigue esto en orden, no te lo saltes.

## 1. Sube la carpeta a GitHub

Vercel jala el proyecto desde un repositorio de GitHub. Crea un repo nuevo
(puede ser privado) y sube TODA esta carpeta tal cual está: `index.html`,
`css/`, `fonts/`, `js/`, `config/`, `app.js`, la carpeta `api/`, la carpeta `lib/`, `package.json`
y `.gitignore`.

## 2. Importa el proyecto en Vercel

En vercel.com → "Add New Project" → conecta ese repo → Deploy. Con que exista
`package.json` y la carpeta `api/`, Vercel ya detecta solo que hay funciones
serverless, no necesitas configurar nada raro ahí.

Va a fallar el primer deploy (o va a subir "a medias") porque todavía le
faltan las llaves de abajo. Es normal, ahorita las agregamos.

## 3. Crea la base de datos (Vercel KV)

Esto es donde se guarda el horario de verdad.

1. Dentro de tu proyecto en Vercel, ve a la pestaña **Storage**.
2. Dale **Create Database** → elige **KV** (es gratis en el plan Hobby).
3. Cuando te pregunte a qué proyecto conectarla, elige este mismo proyecto.
4. Vercel agrega solo las variables `KV_REST_API_URL`, `KV_REST_API_TOKEN`,
   etc. No tienes que copiarlas a mano.

## 4. Agrega tus dos variables secretas

En tu proyecto → **Settings** → **Environment Variables**, agrega estas dos:

| Nombre | Valor |
|---|---|
| `ADMIN_PASSWORD` | La contraseña que vas a usar tú para entrar al panel de admin. Ponle algo que no sea obvio. |
| `AUTH_SECRET` | Cualquier texto largo y aleatorio (mínimo 20 caracteres). Es la llave con la que se firma tu sesión, no la compartas. Puedes generar una en [randomkeygen.com](https://randomkeygen.com/) o pedirme que te dé una. |

Guarda, y aplica para **Production, Preview y Development** (las tres
casillas).

## 5. Vuelve a desplegar

Ve a la pestaña **Deployments**, entra al último deploy, dale a los tres
puntitos → **Redeploy**. Ahora sí va a jalar completo, porque ya tiene la
base de datos y las contraseñas configuradas.

## 6. Pruébalo

- Abre tu URL de Vercel, entra a "Admin Horarios", mete tu `ADMIN_PASSWORD`.
- Agrega o edita una materia y guarda.
- Abre la misma URL en otro celular (o en modo incógnito) — en máximo 15
  segundos debe aparecer el cambio ahí también, sin que esa persona haga nada.

## Notas importantes

- **No subas tu `ADMIN_PASSWORD` ni tu `AUTH_SECRET` a GitHub.** Esas solo
  van en Vercel (Environment Variables), nunca dentro del código.
- Si algún día quieres cambiar la contraseña, nomás edita `ADMIN_PASSWORD`
  en Vercel y vuelve a desplegar (Redeploy). No hay que tocar código.
- La sesión de admin dura 12 horas en el dispositivo donde entraste; después
  te vuelve a pedir la contraseña.

## 7. Notificaciones push reales (con la página cerrada)

Esto es aparte del resto — hace que las notificaciones lleguen aunque nadie
tenga la página abierta en su celular.

### Variables de entorno nuevas

Agrega estas en Vercel (Settings → Environment Variables), igual que
`ADMIN_PASSWORD`:

| Nombre | Valor |
|---|---|
| `VAPID_PUBLIC_KEY` | Llave pública VAPID: genérala con `npx web-push generate-vapid-keys` (ver `ROTAR_CLAVES.md`). **No pegues aquí el valor real.** |
| `VAPID_PRIVATE_KEY` | Llave privada VAPID del mismo par. Solo en Vercel, nunca en el repositorio. |
| `VAPID_SUBJECT` | `mailto:tu-correo@ejemplo.com` (pon un correo real tuyo) |
| `CRON_SECRET` | Texto aleatorio largo (mínimo 32 caracteres). Es el mismo que va en la URL del cron en cron-job.org. |

Guarda y vuelve a desplegar (Redeploy) para que las tome.

### Configura el "cron" externo gratis

Vercel gratis solo deja correr sus propios cron jobs una vez al día, así que
usamos un servicio externo que le toque la puerta a tu página cada rato:

1. Entra a [cron-job.org](https://cron-job.org) y crea una cuenta gratis.
2. Crea un cronjob nuevo con esta URL (cambia `tu-dominio` por el real de
   Vercel, y deja el `secret` tal cual):
   ```
   https://tu-dominio.vercel.app/api/cron/check-schedule?secret=adceaa2162599e16a40fbf4b7e99d361cb2f143c507b7866
   ```
3. Ponle que se ejecute cada 10 minutos (o cada 5 si quieres más precisión).
4. Guarda. Con eso, cada 10 minutos se revisa solo si cambió de clase y se
   manda el push a quien lo tenga activado.

### Cómo lo activan los alumnos

Igual que antes: en la vista de Alumnos, botón "Activar Notificaciones".
Ahora, además de pedir permiso, el celular se suscribe de verdad — por eso
va a funcionar aunque cierren la página o apaguen la pantalla.


## 8. Timbre escolar (ESP32 + relé)

En el panel de Admin hay una tarjeta "Timbre Escolar" donde editas las horas,
la duración, los días, y hay un botón para tocar el timbre al momento. El ESP32
le pregunta a la página cada ~10 segundos, así que no hay que reprogramarlo.

### Variable nueva en Vercel

| Nombre | Valor |
|---|---|
| `BELL_DEVICE_KEY` | Texto aleatorio de 32 caracteres hexadecimales; el mismo valor va en `timbre/secretos.h` del ESP32. |

Guarda y haz Redeploy. Esa misma llave va en `DEVICE_KEY` dentro de
`timbre_esp32.ino` (es lo que le permite al ESP32 leer las horas sin sesión de admin).

### En el ESP32

Abre `timbre_esp32.ino` en Arduino IDE y cambia solo `WIFI_SSID`,
`WIFI_PASSWORD` y `SERVER_URL` (tu dominio real de Vercel + `/api/bell`).
Placa: "ESP32 Dev Module". No necesita librerías extra.

### Cómo saber que funciona

Entra a Admin: la tarjeta del timbre muestra "ESP32 en línea" en verde cuando
el ESP32 ha consultado en el último minuto.

## 9. Robot mBot Ranger (USB, sin servidor)

El panel de Admin tiene tres apartados, cada uno con sus secciones:

- **Horario:** Horarios (con el botón *Nueva Materia / Bloque* y la importación), Grupos y Alertas.
- **Timbre:** Timbre, Ritmo y ESP32.
- **Robot:** Música (canción, teclado y melodía de un audio), Baile, Funciones, Luces e Instalar.
  La conexión, el paro, el progreso y la batería están siempre arriba. El volumen del robot está en Música.
  - **Batería:** barra con el porcentaje, el voltaje y cuánto va a durar. El robot manda su voltaje al
    conectar (`INFO ... BAT=`) y la página se lo pregunta (`BAT`) cada 10 s cuando está quieto; con los
    motores andando el voltaje cae (~5,6 V) y esas lecturas no cuentan. El porcentaje sale de una curva por
    tipo de pilas (recargables NiMH, alcalinas o mixtas, en "Ajustes de la batería") y la duración se estima
    con lo que hace el robot y, con ~10 minutos de datos, con lo que de verdad se ha gastado.
  - **Funciones:** comportamientos por modelo del kit (Land Raider, Dashing Raptor y Nervous Bird) que corren hasta
    pulsar Paro. Poner una función deja el baile en "Solo luces" y, al revés, elegir un baile quita la función.
    Tienen casillas de luces (apagadas = FX brillo 0, sin guardarlas en la EEPROM) y de música. Las de movimiento
    las arma la página con `M`/`W`/`T` (`CI`/`CD` son curvas; los giros en grados se calibran con "lo que tarda
    en girar 90°"); *Esquivar* y *Seguir mi mano* usan los modos 1 y 2 que el programa del robot ya trae (`MODE 1`
    / `MODE 2`) y al parar la página manda `!` y `MODE 4`. El Nervous Bird necesita un programa de equilibrio con el
    giroscopio que este firmware no incluye: sus funciones son solo movimientos suaves.
  - **Pilas:** además del tiempo de uso, la barra dice en cuánto tiempo volverían al 100 % con tu cargador
    (corriente en "Ajustes de la batería", 500 mA por defecto; las NiMH necesitan ~140 % de su capacidad).

Se puede abrir una sección directo con `#admin-<sección>` (por ejemplo `#admin-robot-luces`;
`#admin-robot` abre Música). `node test/admin-secciones.test.js` revisa que el HTML y el script coincidan.

El robot se controla solo desde la app del celular, por Bluetooth (la pestaña Robot no aparece en la web
y ya no hay Web Serial); no usa Vercel ni variables nuevas.

Una sola vez hay que subirle al robot `robot/mbot_ranger_web/mbot_ranger_web.ino`
con el IDE de Arduino (placa "Arduino Mega or Mega 2560", librería Makeblock). Es el
sketch del tanquecito con los modos del botón más el modo 4, el de la página.
El USB solo sirve para subir el programa desde la computadora; después la app se conecta por Bluetooth.

- **Canciones y baile:** se escriben como texto (`C4/4 D4 E4/2`, `AD/2 GI/4`). También
  acepta milisegundos (`A5:120 R:300`).
- **Audio a ritmo:** se sube un MP3/WAV/OGG o un MIDI, se detectan los golpes (la misma
  detección que usa el ritmo del timbre) y quedan como notas editables. Los ritmos y las
  canciones se guardan con nombre en el navegador.
- **Luces:** los 12 LEDs del anillo, brillo y efectos; se aplican al instante. El efecto
  corre solo dentro del robot (no se traba mientras suena) y se guarda en su EEPROM: sigue
  igual al desconectarlo del USB y vuelve solo al encenderlo.
- **Seguridad:** el botón **Paro** corta nota y motores al momento, y si la página
  deja de mandar órdenes los motores se paran solos a los 3 segundos.
- **Baile guardado:** en Baile, "Guardar este baile en el robot" deja el baile con su canción y sus luces y borra
  cualquier función guardada: el robot solo baila, sin la página. **Velocidad:** un solo control (de lo más lento a lo más
  rápido) en Funciones y Baile sirve para todas las funciones, incluidas esquivar (`SPD`) y seguir la mano.
- **Funciones guardadas:** en Funciones, "Guardar la función en el robot" deja la función (con la canción y las luces
  marcadas) en su EEPROM y la hace sin USB: con el botón de la placa o, si lo marcas, sola 2,5 s después de
  encenderlo. Cada guardado reemplaza al anterior. Úsalo con las baterías puestas y el interruptor encendido.
- **Melodía de un audio:** además del ritmo, "Sacar la melodía" sigue la línea dominante
  (la voz si la canción la tiene, o el instrumento principal si es solo instrumental): suma los
  armónicos de cada altura posible y un Viterbi elige el camino que más suena y menos salta.
  Se afina con el registro (medio, agudo, grave) y la sensibilidad; las notas se ajustan a la
  tonalidad y se suben al registro donde el zumbador suena bien. En un MIDI se ignora la batería.
- **Teclado:** tocas con el ratón o con Z X C V B N M / Q W E R T Y U (y S D G H J / 2 3 5 6 7
  para las negras); "Grabar" registra cada nota con su duración y sus silencios en tiempo real,
  y la grabación se usa como canción o se guarda con nombre en la biblioteca.
- **Velocidad de las luces:** el efecto (arcoíris, respirar, persecución) corre del 20 % al
  300 % y se guarda en el robot junto con el efecto.
- **Sonido sin entrecortes:** el zumbador suena por hardware (Timer5, pin 45), así el anillo de
  LEDs no corta la nota cada vez que dibuja un cuadro.
- **Diagnóstico:** al conectar, la página muestra la batería y lo que el robot anotó solo
  (arranques, cambios de modo con el botón, pasadas del show, voltaje mínimo con las ruedas
  andando); "Borrar este aviso" lo pone en cero.
- **Subir el firmware a esta placa (importante):** el bootloader de este robot borra, en cada
  escritura de página, la página que marca un puntero interno que arranca en 0 al iniciar la
  sesión, no la que se le pide. Subir en orden 0, 1, 2… una sola vez cada página (como hace
  avrdude) funciona; saltarse páginas, reintentar o reescribir una página deja en blanco las
  primeras (sin vectores de interrupción) y el programa no arranca aunque la verificación de
  cada página haya pasado. Si una subida falla, hay que repetirla entera desde una sesión
  nueva. Además el sketch apaga el watchdog al arrancar (`.init3`) y no usa floats, `math.h`,
  `random()` ni las clases de encoders/zumbador/ultrasonido de Makeblock, para que quepa en
  menos de 64 páginas (16 KB) y no tocar la zona alta; hoy ocupa 15 752 bytes de los 16 384 y se compila con
  `-mcall-prologues` (`--build-property compiler.cpp.extra_flags=-mcall-prologues` y lo mismo con `compiler.c.extra_flags`);
  sin esa bandera ya no cabe. Tampoco se usan `digitalWrite`, `pinMode` ni `analogWrite` (pesan ~700 bytes): los motores, el zumbador, el anillo y los sensores van por registros (PORTL, PORTB, PORTK, PINF, PINK, OCR1A/OCR2A).
- **Serie de demostración:** en Funciones se arma una lista (función + segundos) que la página reproduce sola o guarda
  como un único show en el robot (`PADD O modo s` para las de sensor, órdenes `M`/`W`/`T` para las demás). El robot la
  repite hasta cortarla con el botón o un `!`. Modo 7 = «Acercarse a la pared» (se detiene a 10 cm pitando más rápido).
  `INFO` trae `PARK=1` cuando el programa los entiende.
- **Giro con giroscopio:** `G n` gira n grados (positivo = derecha) leyendo el MPU6050 (0x69) por I2C a mano; `PADD G n` lo guarda en el show. `INFO` trae `GIRO=1` si el chip responde. La página lo usa en las funciones sin música (con música los giros siguen por tiempo, `giro90`, porque `G` bloquea las notas).
- **Pruebas:** `node test/robot.test.js`.

## Pendiente

- El firmware ocupa 15 752 de los 16 384 bytes (64 páginas) que admite esta placa: casi no queda margen; ver la nota del flasheo.

## Alumnos: instalable, sin conexión, modo oscuro y calendario

- **Instalable (PWA):** `manifest.webmanifest` + `sw.js`. En el celular el navegador ofrece "Instalar" / "Agregar a la
  pantalla de inicio". El service worker usa **red primero** (siempre lo más nuevo con Internet) y guarda copia de los
  archivos de la página y de `/api/schedule` y `/api/groups`; sin Internet muestra la última copia. No guarda sesión,
  timbre, push ni firmware. Al cambiar archivos estáticos no hace falta tocar nada; si algún día se cambia la forma de
  guardar, subir `CACHE` (`cecyte-v2`) en `sw.js`.
- **Tema:** botón en el encabezado que alterna Automático (sigue al sistema), Claro y Oscuro; se recuerda en ese navegador (`localStorage: cecyte_tema`). Solo cambia tokens en
  `css/themes/oscuro.css` (`html[data-tema="oscuro"]`).
- **Agregar a mi calendario:** descarga un `.ics` con las materias del grupo elegido, repetidas cada semana (`calendario.js`).
- **Pruebas:** `npm test` corre todas (robot, admin, timbre, calendario/PWA, API y seguridad).

## App de Android (APK)

Ver `ANDROID.md`. Rotar las llaves (VAPID y `CRON_SECRET`): ver `ROTAR_CLAVES.md`.
