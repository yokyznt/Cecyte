# App de Android (CECyTE 18)

La app es la misma web empaquetada con **Capacitor 8**: un solo código para el sitio y el APK. El robot no entra
al APK (queda solo en la web de escritorio).

## Qué cambia entre la web y el APK

| | Web (cecyteo.vercel.app) | APK |
|---|---|---|
| Archivos | servidos por Vercel | dentro del APK (`www/`) |
| API | rutas relativas `/api/...` | `APP_CONFIG.apiBase` = https://cecyteo.vercel.app |
| Sesión de admin | cookie HttpOnly | token Bearer (`js/api.js`), solo en el APK |
| Avisos | Web Push + service worker | notificaciones locales (`js/avisos-nativos.js`) |
| Sin conexión | service worker | copia local del horario y de los grupos |
| Robot | sí | no (se quita en el build) |

## Estructura

```
config/app.config.js   marca, plataforma, API base, tema por defecto (la web la usa tal cual)
config/apk.json        appId, nombre, versión y URLs del APK (única fuente de la versión)
css/                   tokens -> base -> componentes -> páginas -> layout -> (robot) -> temas
js/tema.js             Automático / Claro / Oscuro
js/api.js              cliente único de la API
js/plataforma.js       puente con Capacitor (botón atrás, barras del sistema, splash)
js/avisos-nativos.js   agenda 14 días de avisos locales del grupo
js/actualizacion.js    aviso de versión nueva (version.json)
lib/cors.js            CORS solo para https://localhost (el origen de la app)
scripts/build-www.js   arma www/: lista blanca, quita el robot y revisa que no haya secretos
scripts/build-apk.js   Gradle + firma + copia a Desktop\CECyTE-APK
android/               proyecto Capacitor
```

## Cambiar el diseño

- **Colores, tipografía, radios, sombras:** `css/tokens.css` (primitivos) y `css/themes/oscuro.css` (tema oscuro).
- **Nombre, subtítulo, logo y color de la barra:** `config/app.config.js` > `marca`.
- **Un tema nuevo:** crea `css/themes/<nombre>.css` redefiniendo los tokens bajo `html[data-tema="<nombre>"]`,
  enlázalo en `index.html` y agrega el nombre a `MODOS` de `js/tema.js`.
- **Lo que solo existe en la web:** marca la línea con `@web:line`; lo del robot, con `@robot:line` o entre
  `@robot:start` y `@robot:end` (HTML o JS). El build las elimina del APK.

## Compilar

Requisitos (los mismos de Fruit Spire): Node, JDK 17/21 en `~/.jdks`, Android SDK en
`%LOCALAPPDATA%\Android\Sdk`. Android Studio con JDK 25 no sirve para Gradle 8.14.

```
npm install
npm test                          # pruebas (incluye que www/ salga sin robot ni secretos)
npm run www                       # solo arma www/
node scripts/build-apk.js --debug # APK de pruebas (firma debug)
npm run android:apk               # APK de release firmado -> Desktop\CECyTE-APK\CECyTE-18-<versión>.apk
```

La versión sale de `config/apk.json` (`versionName`, `versionCode`). Para publicar una nueva:

1. Sube `versionName` y `versionCode` en `config/apk.json` **y** en `version.json` (el sitio la sirve).
2. `npm run android:apk` y sube el `.apk` a una GitHub Release.
3. Haz merge a `main`: Vercel publica `version.json` y las apps instaladas muestran el aviso.

## Llave de firma

`Desktop\CECyTE-APK\llaves\cecyte-release.jks` + `keystore.properties` (fuera del repo, ignorados por git).
Hay que respaldarla: sin ella no se pueden publicar actualizaciones instalables sobre la app ya instalada.

## Avisos

El APK agenda en el teléfono los próximos 14 días de cambios de bloque del grupo elegido (≈ 90 notificaciones),
con el mismo texto que el cron del servidor (`textoAviso()` en `app.js`). Se renueva al abrir la app, al traer un
horario nuevo, al cambiar de grupo y al reanudar. Con alarmas exactas concedidas suenan a la hora; si no, Android
las entrega aproximadas. Limitación: si el administrador cambia el horario con la app cerrada, el teléfono conserva
los avisos viejos hasta abrirla o reiniciarse (no hay push remoto en el APK).

## Probado y no probado

- Probado: pruebas automáticas, el paquete `www/` en un navegador con un Capacitor simulado (avisos, token,
  calendario compartido, sin conexión) y la instalación estructural del APK (firma v2, permisos, versión).
- No probado en un dispositivo real: notificaciones del sistema, alarmas exactas, botón atrás, SystemBars y el menú
  de compartir. Pendiente de una prueba con el teléfono conectado (`adb install -r`).
