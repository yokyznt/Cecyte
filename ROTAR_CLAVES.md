# Rotar las llaves del servidor

Las llaves VAPID (privada) y `CRON_SECRET` estuvieron escritas en `DEPLOY.md` y quedaron en el historial de Git.
Quitarlas del archivo no las "des-publica": lo que cierra el asunto es **cambiarlas**. Esta guía es para hacerlo
cuando quieras; nada de esto se ejecuta solo.

## Qué pasa al rotar

| Llave | Efecto de cambiarla |
|---|---|
| `CRON_SECRET` | El cron deja de funcionar hasta que cambies la URL en cron-job.org. Sin otro efecto. |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` | Las suscripciones push **web** anteriores dejan de servir: cada alumno tiene que volver a pulsar "Activar Notificaciones". La app de Android no se ve afectada (usa avisos locales). |
| `BELL_DEVICE_KEY` | El ESP32 recibe 401 hasta que cambies `DEVICE_KEY` en `timbre/secretos.h` y lo vuelvas a cargar por USB. |

## Pasos

1. Genera valores nuevos (en tu computadora, no los pegues en ningún archivo del repo):
   - VAPID: `npx web-push generate-vapid-keys`
   - Secretos: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
2. Vercel > Settings > Environment Variables: edita `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `CRON_SECRET`
   (Production, Preview y Development).
3. cron-job.org: cambia el valor de `CRON_SECRET` en la URL del trabajo (`/api/cron/check-schedule?...`).
4. Vercel > Deployments > Redeploy.
5. Prueba: abre la página, pulsa "Activar Notificaciones" y "Probar"; revisa que el cron responda 200.

## Después

- No vuelvas a escribir valores reales en la documentación; usa marcadores.
- Si el repositorio es público, considera además reescribir el historial o hacerlo privado.
