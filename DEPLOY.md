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

## Varios admins con permisos

`ADMIN_PASSWORD` es la contraseña **maestra**: solo la tiene el dueño, puede
todo y es la única que gestiona admins. Nunca se guarda en el código ni en
la base de datos.

- Entra con la maestra y toca otra vez el botón de admin (arriba a la
  derecha): gira y se convierte en los ajustes de admins. Tócalo de nuevo
  para volver al panel; es el único botón que cambia entre los dos.
- Ahí creas hasta 20 admins, cada uno con nombre, contraseña propia (6 a 64
  caracteres, no repetida) y los permisos que elijas: Horarios, Grupos,
  Alertas, Timbre, Ritmo, ESP32 y las secciones del Robot.
- Se guardan en Vercel KV (`cecyte_admins`) con la contraseña cifrada (scrypt).
- Editar permisos, cambiar la contraseña o borrar a un admin surte efecto de
  inmediato; cambiar su contraseña también le cierra sus sesiones abiertas.
- Después de actualizar, hay que redeplegar `api/` para que funcione.

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
- **Robot:** Música (canción, teclado y cántalo), Baile, Funciones, Luces e Instalar.
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
- **Canciones guardadas:** las canciones y los ritmos se guardan con nombre en el celular. Ya no se importan audios ni MIDI; lo que sí queda es «Cántalo» (grabar la voz y convertirla en pitidos) y el teclado.
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
- **Nombre y tolerancias de voz:** Hevy solo obedece si la frase empieza con su nombre, que se acepta por cómo suena (hevy, hevi, jevi, jebi, hebi, heavy, «he vi», «je bi»…, hasta tres palabras; `quitarNombre` y `NOMBRE_HEVY` en `robot.js`). «Yokis» y «Jarvis» ya no sirven. Las palabras casi iguales a un comando («abanza», «izquirda», «lus», «cucarracha») se corrigen por fonética + distancia de edición (`corregirVocabulario`); las comunes protegidas no se tocan.
- **IA autónoma con personalidad (opcional, gratis):** con una llave de Gemini (aistudio.google.com/apikey; queda solo en el celular, en Voz de Hevy) la app manda lo que oyó el micrófono, la conversación reciente, la hora y el estado del robot a `gemini-flash-lite-latest` (o `gemini-flash-latest`). Solo ejecuta lo que `validarOrdenIA` reconoce: acciones, funciones y canciones fuera de lista y números fuera de rango se descartan. Además de las órdenes, la IA puede conversar (`decir`), encadenar hasta 8 pasos seguros (`plan`: mover, girar, figuras, luces, claxon) y añadir un comentario con su personalidad a cualquier acción (`dice`). Se usa cuando el intérprete local no entiende y, para la charla (gracias, cómo estás, chiste, elogio, queja, quién eres, adiós), en lugar de una frase fija. Sin llave o sin red funciona el intérprete local.
- **Personalidades (Hevy → Personalidad):** Normal, Payaso, Grosero, Argentino, Triste y Científico (también por voz: «Hevy, ponte triste» o «modo científico», acción `modo` que valida `validarOrdenIA`; cada modo tiene su tabla local —`PAYASO`, `GROSERAS`, `TRISTE`, `CIENTIFICO` en `TABLAS_MODO`— y su prompt). *Triste*: melancólico y tierno. *Científico*: respuestas técnicas con cifras y unidades, sin inventar. El tono también viaja en el `systemInstruction` de la voz en vivo (`TONOS_LIVE`) y la sesión se identifica por voz+modo. *Payaso*: chistes rancios y muchas risas (frases locales en `PAYASO` y `CHISTES_RANCIOS`; con IA improvisa). *Grosero*: groserías y burlas con humor; 1 de cada 4 órdenes de movimiento, luces, música o baile se niega (la app decide el dado, la IA recibe «esta vez te niegas», y sin red hay frases locales en `GROSERAS`) y toma la iniciativa (hace otra cosa o agrega travesuras). El prompt prohíbe insultos contra grupos y amenazas reales. En cualquier modo «parar», «para música» y «batería» los resuelve el intérprete local (`CRITICAS`), nunca la IA, así que siempre obedecen.
- **Coherencia y memoria de la IA:** el prompt incluye todas las funciones del robot (`FUNCIONES`), las canciones guardadas y la elegida, y el historial de lo que dijo y lo que hizo (`(Hevy hizo: …)`). Con llave, todas las órdenes pasan primero por la IA (menos las críticas) y el intérprete local queda de respaldo. Si Hevy promete algo en «dice» o «texto» («ahí te va la canción de estrellita») y la IA no incluyó la acción, `cumplirPromesa` la ejecuta (salvo frases con negación). Los planes admiten mover, girar, figuras, luces, claxon, canción y baile.
- **Voz de Gemini en vivo (casi instantánea):** las voces de Gemini se piden por el Live API (`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`, modelo `gemini-3.1-flash-live-preview`, llave en la URL). Hay 2 sesiones abiertas (activa y de repuesto); el primer audio llega a ~0,5–0,9 s de enviar el texto (`realtimeInput`) y se reproduce en streaming con Web Audio (`LIVE`, `reproducirChunk`). Una frase nueva interrumpe la anterior cambiando a la sesión de repuesto (`cortarLive`, llamado desde `callarIA`); cada frase usa una sesión nueva (la de repuesto ya abierta): con la memoria de una sesión reutilizada Gemini dejaba de leer el texto e improvisaba —medido con 5 frases seguidas en modo triste—; las sesiones sin usar se cierran a los 3 min. Cada frase terminada se guarda en la caché (`live|voz|texto`) y al repetirla suena al instante. Si no hay primer audio en 4,5 s (`LIVE_PRIMER_AUDIO_MS`) se reintenta una vez con la sesión de repuesto (3,5 s) y solo tras 2 fallos seguidos se bloquea el Live 10 s; el respaldo es la voz de Google y luego la del teléfono (solo con internet). Se quitaron Gemini REST y su cuota de 10 frases al día. Con `cecyte_yokis_depurar=1` (solo en el APK personal) la app hace una autoprueba muda y escribe `VozLive: …` en logcat (etiqueta `VozJS`, vía `Registro.registrar`, porque el APK de producción no envía `console.log`). Medido en el Nothing: sesión lista en 0,34 s, primer audio a 0,59 s, audio activo sin tocar la pantalla. Probado: 4 sesiones simultáneas permitidas; no se pudo medir desde el navegador de pruebas (bloquea el WebSocket), pero Google acepta los `Origin` de la app.
- **Menú único de voces:** en Hevy → Voz de Hevy hay un solo menú (`#rb-voz-unica`) con Gemini y «Mis voces» (grabadas); la elegida va primero y las demás quedan de respaldo. No hay ajustes de la voz del teléfono: sin internet no habla (solo escribe en el chat). A Gemini ya no se le manda instrucción de estilo (la leía en voz alta).
- **Sin internet (sin voz):** la voz local (sherpa-onnx + Piper) se quitó: la app pasó de ~99 MB a unos pocos MB y se borraron `VozLocalPlugin.java`, `scripts/descargar-voz-local.js` y las reglas de `.gitignore` (solo queda `RegistroPlugin.java`, que escribe los registros `VozJS` en logcat). Con `navigator.onLine === false` Hevy **no habla ni mueve el robot al hablar**: `hablar()` solo escribe en el chat (`aviso` + `historial`), no se llama a la IA (`consultarIA`), no se abre la conversación en vivo ni el candado (`encenderEscucha` avisa) y el toque simple usa el reconocimiento nativo del teléfono (`escuchar`, que sirve sin internet si el teléfono tiene el paquete de voz sin conexión). Solo se entienden las órdenes del intérprete local (`ordenDeVoz`), las rutinas aprendidas (`rutinaEnTexto`) y las frases de cada modo; lo demás contesta «no entendí» en el chat. Al perder la conexión aparece un aviso (evento `offline`). Con internet, si la voz de Gemini falla, el respaldo es Google y luego la voz del teléfono.
- **Facts y chistes reales:** con llave, la IA inventa el fact o chiste (regla `REGLA DE FACTS, CHISTES Y TRIVIA`: verdadero, nuevo y distinto de la conversación reciente); `fact` y `chiste` ya no son charlas enlatadas. Tu lista de «Facts» y las frases locales de cada modo solo se usan sin IA. Trivia y adivinanzas las lleva la IA con la memoria de la conversación.
- **Piedra, papel o tijera:** «Hevy, juguemos piedra, papel o tijera» y luego «Hevy, tijera». Acción `ppt`: la jugada de Hevy se sortea en la app (justo), se muestra con las luces del robot (rojo piedra, blanco papel, verde tijera) y el resultado se dice con el tono del modo; la IA no decide ni narra el resultado.
- **Por su cuenta (Hevy → Por su cuenta):** *Que Hevy comente cosas solo* (activo por defecto, `cecyte_yokis_solo`): comenta al conectarse el robot, con batería baja (cada 10 min como máximo), si algo se pone a menos de 12 cm y tras 4–6 min de aburrimiento; máximo 1 comentario cada 3 min y nunca mientras escucha, habla o se mueve. La IA lo redacta con su personalidad (`consultarIA(…, evento)`); sin IA usa las frases locales. *Escucha continua* (apagada por defecto): `getUserMedia` → `AudioContext` 16 kHz → PCM por WebSocket a `gemini-3.5-transcribe-live`; solo atiende frases que empiezan con «Hevy» (`procesarTexto(lista, true)`), no envía audio mientras Hevy habla (+0,6 s), reconecta sola, se apaga a los 20 min sin hablarle y al salir de la app. Gasta batería y datos.
- **Candado del micrófono:** mantener pulsado el micrófono de Hevy (0,6 s) enciende la escucha continua (candado naranja); pulsarlo de nuevo la apaga. Al tocar el micrófono se calla al instante lo que Hevy esté diciendo (`callarIA` + `detenerMeneo`). Con el candado puesto no se oye al usuario mientras Hevy habla (para no oírse a sí mismo): para cortarlo se toca el micrófono. Los emojis de la IA se quitan antes de hablar.
- **Modo triste (dramático):** llora («buaaa», «snif») e inventa desgracias distintas cada vez (la esposa lavadora que lo dejó por el técnico, el perro, la tostadora…); sin violencia ni daño a sí mismo. Voz en vivo con tono llorón (`TONOS_LIVE.triste`).
- **Micrófono (un toque y candado):** con llave de Gemini, el toque simple y el candado usan el mismo motor (`encenderEscucha(unico)`: getUserMedia → 16 kHz → `gemini-3.5-transcribe-live`); el audio de los primeros 4 s se guarda en `ESC.cola` hasta que la transcripción está lista, así no se pierde lo primero que dices. Lo que dices se escribe en el chat mientras hablas (`interimInputTranscription` → burbuja `is-vivo`, `pintarVivo`). El toque simple se apaga solo al terminar la frase (o a los 10 s sin voz) y no exige decir «Hevy»; el candado tampoco, salvo que se marque «exigir que empiece con Hevy» (`rb-escucha-nombre`). Sin llave se usa el reconocedor nativo (`popup: false`). El botón se agranda con el volumen (`is-escuchando`) y el candado se ve con `is-candado`.
- **Modo argentino desquiciado (tipo «Grok/Tesla grosero» de TikTok):** tabla `ARGENTINO` (voseo y lunfardo: che, boludo, pelotudo, forro, fiaca, garrón…), `REMATES_ARGENTINOS`, prompt `LINEAS_ARGENTINO` con la misma rebeldía del grosero y acento rioplatense en la voz en vivo (`TONOS_LIVE.argentino`). Se activa en Hevy → Personalidad o diciendo «Hevy, ponte argentino». Mismos límites: sin insultos a grupos ni amenazas.
- **La IA sabe que es el robot:** el prompt (`IDENTIDAD`, `AUTONOMÍA`) le dice que su cuerpo es el mBot Ranger (ruedas, sensor ultrasónico, 12 LED, bocina, sensores), que habla en primera persona y que decide por iniciativa (planes de hasta 8 pasos, funciones, radar, guardia). El contexto incluye el modo actual, si está en movimiento y la lectura del sensor frontal (`sensorFrontal`, si tiene menos de 5 s): con menos de 20 cm no avanza.
- **Hablar manual sin ventana de Google:** `SpeechRecognition.start` usa `popup: false`; lo que dices se ve en el chat de la app. La pulsación larga del candado se detecta con `pointerdown`/`pointermove` (450 ms, `touch-action: none`) sin cancelarse por `pointercancel`. Con `cecyte_yokis_depurar=1` la app hace una autoprueba de la escucha continua a los 9 s del arranque y escribe `Escucha: …` en logcat (`VozJS`).
- **Conversación en vivo (cerebro de voz a voz):** con llave de Gemini y una voz de Gemini elegida, el micrófono (toque y candado) abre un solo WebSocket Live (`conectarCerebro`, modelo `gemini-3.1-flash-live-preview`): el audio de 16 kHz entra, la respuesta sale en audio de 24 kHz (`reproducirChunk`) y las acciones llegan como llamadas de función (`herramientasCerebro()` en `robot.js`: mover, giro, luces, plan, modo, ppt, recordar, crear_rutina…) que pasan por `accionDeHerramienta` → `validarOrdenIA` → `ejecutarSilencio` y se responden con `toolResponse` (batería, distancia, errores). El prompt es `promptCerebro(modo)` (identidad, autonomía, personalidad del modo, memoria y rutinas). Lo que dices y lo que contesta se escribe en el chat (`inputTranscription`/`outputTranscription`). «Parar» también se detecta localmente en lo que oye. Si el servidor falla, avisa un error o se corta antes de estar listo, cae solo a la escucha normal (`caerAlFlujoNormal`). Interruptor «Conversación en vivo» en Por su cuenta (`cecyte_yokis_cerebro`). Medido con la llave gratis: audio de ~4 s → llamadas `mover` y `luces` en ~1,3 s.
- **Texto en vivo y micrófono de un toque:** con el cerebro en vivo, lo que dices se escribe en el chat mientras hablas porque se abre en paralelo una sesión de transcripción (`abrirTextoVivo`, `interimInputTranscription`) que recibe el mismo audio solo para mostrar; el cerebro entrega su propia transcripción al terminar la frase. En el modo de un toque, al llegar tu transcripción (o la primera respuesta o llamada de herramienta) se llama `cerrarEntrada()`: el micrófono se apaga y el botón vuelve a verde mientras Hevy contesta; la conexión se cierra al terminar su respuesta.
- **Interrumpir hablando:** mientras Hevy habla, el audio del micrófono no se manda (evita que se oiga a sí mismo) pero se guarda un anillo de ~1,5 s; si el nivel de voz supera `UMBRAL_INTERRUPCION` (0,14) durante 250 ms, Hevy se calla (`interrumpirPorVoz`) y se manda el anillo, así no se pierde lo primero que dices. Tocar el micrófono mientras habla solo lo calla (no apaga la escucha). El registro `Escucha: …` muestra `eco máx` para calibrar el umbral.
- **Memoria y rutinas:** `cecyte_yokis_memoria` (hasta 30 datos cortos) y `cecyte_yokis_rutinas` (nombre → pasos de plan), con menú «Memoria» para borrarlas. Se inyectan en la IA (`contextoMemoria`) y en el cerebro en vivo; las rutinas también se ejecutan localmente al decir su nombre (`rutinaEnTexto`), sin IA.
- **Modo personal (no versionado):** `config/modo-personal.json` (en `.gitignore`) se inyecta en `robot.js` solo con `CECYTE_CLAVES=1` (`const MODO_PERSONAL = null;`). Esquema: `{ id, nombre, sinonimos, lineas[], tabla{}, tonoLive, bienvenida }`. Sin el archivo el modo no existe (sin botón y la voz/IA lo rechazan), así que ni el repo ni las compilaciones de la escuela lo contienen.
- **Modo Aura (farmeo de aura):** tabla `AURA`, `REMATES_AURA` y prompt `LINEAS_AURA` (también usado por `promptCerebro`): zoomer brainrot de TikTok (skibidi, sigma, rizz, Ohio, mewing, fanum tax, NPC, cooked, «six seven»…) que reparte y resta puntos de aura por todo y farmea la suya con cada acción; humor inofensivo, sin groserías fuertes. Se activa en Personalidad o con «Hevy, ponte brainrot / sigma / aura / tiktok». Voz en vivo con tono hiperactivo (`TONOS_LIVE.aura`).
- **Pestaña Teléfono (ubicación compartida y «busca el teléfono de X»):** solo en el APK personal (robot). Amigos con un **código de sala** (6–10 letras/números, se crea en la pestaña) comparten su ubicación; cada quien enciende «Compartir» a mano (nunca arranca encendido), se ve un aviso fijo, quien es buscado ve «X te está buscando» y solo ve a los demás quien también comparte. Backend `api/telefonos.js` (KV, sin historial): `tel:<sala>:<id>` = `{n, lat, lon, p, t}` con vencimiento de 180 s, índice `telidx:<sala>` (zset) y `tel:<sala>:busca:<id>` (120 s); token por teléfono = HMAC de «sala:id» con `AUTH_SECRET` (`firmarDispositivo`/`verificarDispositivo` en `lib/auth.js`); 20 teléfonos por sala, 20 uniones por hora por IP; CORS de la app. Para cuidar la cuota gratis el cliente envía solo si se movió más de 15 m o cada 45 s (cada 10 s mientras lo buscan). Ubicación solo en primer plano (`@capacitor/geolocation`; el manifiesto ya no limita `ACCESS_FINE_LOCATION` a Android 11) y se borra al apagar, a los 3 min sin señal y con `pagehide`.
- **Guiado hacia un teléfono:** «Hevy, encuentra el teléfono de Ana» (`buscar_telefono`, también como herramienta del cerebro en vivo junto a `listar_telefonos`) o el botón «Buscar con Hevy». El celular va plano sobre el robot con la parte de arriba hacia el frente (aporta GPS y brújula). Al empezar se alinea el giroscopio (`H0`, `fi0` = brújula) y cada segundo `Robot.decidirGuiado` calcula el rumbo con `distanciaMetros`/`rumboHacia`; se manda `H <rumbo relativo> v` con velocidad baja, con freno por obstáculo (`frenoPorDistancia` y el sensor ultrasónico) y se detiene a menos de 8 m. Paradas: «parar», 6 min, destino sin señal 45 s, batería < 15 %, GPS malo 20 s, obstáculo 3 s, app en segundo plano. Límites: GPS de ±5–10 m, solo al aire libre y la brújula se desvía cerca de los motores. `test/robot.test.js` trae un simulador (ruido de GPS de 3 m y brújula torcida hasta 15°) y `test/api-telefonos.test.mjs` prueba la API.
- **Mando con flechas diagonales:** el estilo «flechas» tiene 8 botones (`data-pad` ±1,±1 en las esquinas); la mezcla de ruedas es la misma de la palanca a 45° (una rueda a tope y la otra casi parada).
- **Voz con IA (gratis, prioritaria):** con la misma llave de Gemini, Hevy habla con voz de IA en Voz de Hevy. Cadena: (1) caché permanente en el teléfono (IndexedDB `hevy-voz-ia`, 150 frases; una frase ya generada no gasta cuota ni necesita red), (2) Gemini TTS probando `gemini-3.8-flash-lite-tts`, `gemini-3.8-flash-tts`, `gemini-3.1-flash-tts-preview` y `gemini-2.5-flash-preview-tts` (la cuota gratis es de 10 frases por día por modelo; un 429 pasa al siguiente modelo y un audio vacío se reintenta sin estilo), (3) voz de Google Translate (`translate_tts`, sin cuota), (4) voz del teléfono sin internet ni datos. El apartado muestra qué voz se usó y por qué.
- **Cántalo:** la voz grabada con el micrófono se convierte en notas siguiendo la línea dominante: suma los armónicos de cada altura posible y un Viterbi elige el camino que más suena y menos salta. Se ajusta a la tonalidad y se sube al registro donde el zumbador suena bien.
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
  menos de 64 páginas (16 KB) y no tocar la zona alta; hoy ocupa 16 170 bytes de los 16 384 y se compila con
  `-mcall-prologues` (`--build-property compiler.cpp.extra_flags=-mcall-prologues` y lo mismo con `compiler.c.extra_flags`);
  sin esa bandera ya no cabe. Tampoco se usan `digitalWrite`, `pinMode` ni `analogWrite` (pesan ~700 bytes): los motores, el zumbador, el anillo y los sensores van por registros (PORTL, PORTB, PORTK, PINF, PINK, OCR1A/OCR2A).
- **Serie de demostración:** en Funciones se arma una lista (función + segundos) que la página reproduce sola o guarda
  como un único show en el robot (`PADD O modo s` para las de sensor, órdenes `M`/`W`/`T` para las demás). El robot la
  repite hasta cortarla con el botón o un `!`. Modo 7 = «Acercarse a la pared» (se detiene a 10 cm pitando más rápido).
  `INFO` trae `PARK=1` cuando el programa los entiende.
- **Giro con giroscopio:** `G n` gira n grados (positivo = derecha) leyendo el MPU6050 (0x69) por I2C a mano; `PADD G n` lo guarda en el show. `INFO` trae `GIRO=1` si el chip responde. La página lo usa en las funciones sin música (con música los giros siguen por tiempo, `giro90`, porque `G` bloquea las notas).
- **Mando (agrupado):** la barra de arriba tiene tres grupos: sesión (cerrar, estado, Bluetooth), información (distancia y avisos) y herramientas (recorridos, alinear, estilo de control, turbo). El botón del celular tiene tres estados: control normal → inclinar el celular → modo dirección → normal. El botón de estilo cambia entre **palanca**, **flechas** (cuatro, se pueden sostener dos a la vez para avanzar y girar) y **pedales** (dos de dirección a la izquierda y dos de aceleración a la derecha; con pedales las cuatro acciones —claxon, música, luces y celular— pasan al centro, debajo del paro). Flechas y pedales aceleran poco a poco al sostenerlos y frenan al soltar; la palanca y el teléfono inclinado también se suavizan. El estilo se recuerda.
- **Modo dirección:** la palanca (o las flechas o los pedales) es **relativa al teléfono**: arriba = hacia donde apunta el teléfono, atrás = hacia ti. El teléfono lee su brújula (`deviceorientationabsolute`) todo el tiempo y en cada revisión (~15 veces por segundo) la app manda `H grados v` con `grados = brújula del teléfono + ángulo − brújula al alinear`. El robot corrige su rumbo por su cuenta (cada 20 ms, con la velocidad de giro del giroscopio como freno), así que gira suave, avanza mientras se acomoda y no hace zigzag. Al activar el modo se alinea solo (supone que el robot mira hacia donde apunta el teléfono) y el botón «Alinear» lo repite. `H0` calibra el giroscopio con el robot quieto y toma el rumbo actual como cero, `H1` apaga el modo, y cualquier paro (`!`, `S`, `M`, el seguro de 3 segundos) cancela el control de rumbo. Sin brújula usa un rumbo fijo y el botón del celular muestra un puntito rojo. Sin freno por obstáculo en este modo. En el firmware se quitó el modo 3 del botón (test de motores) para ganar espacio.
- **Pruebas:** `node test/robot.test.js`.

## Pendiente

- El firmware ocupa 16 170 de los 16 384 bytes (64 páginas) que admite esta placa: casi no queda margen; ver la nota del flasheo.

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
