# Cómo subir esto a Vercel (paso a paso)

Ya no es una página estática nomás — ahora tiene un "cerebrito" atrás (API +
base de datos) para que el horario sea el mismo para todos y solo tú lo
puedas editar. Sigue esto en orden, no te lo saltes.

## 1. Sube la carpeta a GitHub

Vercel jala el proyecto desde un repositorio de GitHub. Crea un repo nuevo
(puede ser privado) y sube TODA esta carpeta tal cual está: `index.html`,
`styles.css`, `app.js`, la carpeta `api/`, la carpeta `lib/`, `package.json`
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
