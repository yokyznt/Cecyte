package com.yokyznt.cecyte;

import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Calendar;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Trabajo de fondo, cada ~15 min (el mínimo de WorkManager; con el teléfono en reposo Android puede tardar más):
 *  - SOLO de lunes a viernes de 06:00 a 15:30; fuera de ahí sale de inmediato, sin red ni batería.
 *  - baja /api/changes (cambios del día) y avisa con una notificación cada cambio nuevo del grupo guardado
 *  - cada ~6 h baja también /api/schedule (público, sin token)
 *  - refresca el widget. Sin red conserva lo último.
 */
public class ActualizaHorarioWorker extends Worker {
    static final String CANAL = "cambios-del-dia";
    private static final int TOPE_BYTES = 2 * 1024 * 1024;   // el horario real pesa decenas de KB; esto solo evita respuestas absurdas
    private static final long HORARIO_CADA_MS = 6L * 60 * 60 * 1000;

    public ActualizaHorarioWorker(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        SharedPreferences p = Horario.prefs(c);
        Calendar ahora = Calendar.getInstance();
        if (!Horario.enHorarioDeRevision(ahora.get(Calendar.DAY_OF_WEEK), ahora.get(Calendar.HOUR_OF_DAY) * 60 + ahora.get(Calendar.MINUTE))) {
            return Result.success();
        }
        String base = p.getString("apiBase", "");
        if (base.isEmpty()) return Result.success();

        String cambios = bajar(base + "/api/changes");
        if (cambios != null) {
            p.edit().putString("cambios", cambios).apply();
            avisarCambios(c, p, cambios, ahora);
        }
        if (ahora.getTimeInMillis() - p.getLong("ultimoHorario", 0) >= HORARIO_CADA_MS) {
            String horario = bajar(base + "/api/schedule");
            if (horario != null) p.edit().putString("horario", horario).putLong("ultimoHorario", ahora.getTimeInMillis()).apply();
        }
        HorarioWidget.refrescar(c);
        return Result.success();
    }

    // Devuelve el cuerpo si es un arreglo JSON válido; null si no hay red, el servidor falla o la respuesta es rara
    private static String bajar(String url) {
        HttpURLConnection h = null;
        try {
            h = (HttpURLConnection) new URL(url).openConnection();
            h.setConnectTimeout(15000);
            h.setReadTimeout(15000);
            if (h.getResponseCode() != 200) return null;
            ByteArrayOutputStream sal = new ByteArrayOutputStream();
            try (InputStream in = h.getInputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) {
                    sal.write(buf, 0, n);
                    if (sal.size() > TOPE_BYTES) return null;
                }
            }
            String cuerpo = sal.toString("UTF-8");
            new JSONArray(cuerpo);
            return cuerpo;
        } catch (Exception e) {
            return null;
        } finally {
            if (h != null) h.disconnect();
        }
    }

    // Una notificación por cada cambio de HOY de mi grupo que todavía no se avisó (los ya vistos en la app cuentan como avisados)
    private static void avisarCambios(Context c, SharedPreferences p, String json, Calendar ahora) {
        String grupo = p.getString("grupo", "");
        if (grupo.isEmpty()) return;
        String hoy = Horario.fechaHoy(ahora);
        List<Horario.Clase> clases = Horario.leer(p.getString("horario", "[]"));
        Set<String> avisados = new HashSet<>(p.getStringSet("avisados", new HashSet<String>()));
        Set<String> vigentes = new HashSet<>();
        boolean puede = NotificationManagerCompat.from(c).areNotificationsEnabled();
        for (Horario.Cambio x : Horario.leerCambios(json)) {
            vigentes.add(x.id);
            if (!x.grupo.equals(grupo) || !x.fecha.equals(hoy) || avisados.contains(x.id)) continue;
            if (!puede) continue;   // sin permiso no se marca: si lo dan más tarde, todavía se avisa
            publicar(c, x, clases, Horario.nombreDia(ahora.get(Calendar.DAY_OF_WEEK)));
            avisados.add(x.id);
        }
        avisados.retainAll(vigentes);   // los vencidos se olvidan
        p.edit().putStringSet("avisados", avisados).apply();
    }

    @SuppressLint("MissingPermission")   // ya se comprobó areNotificationsEnabled()
    private static void publicar(Context c, Horario.Cambio x, List<Horario.Clase> clases, String dia) {
        String materia = "";
        for (Horario.Clase k : clases) {
            if (k.grupo.equals(x.grupo) && k.dia.equals(dia) && k.hora.equals(x.hora)) { materia = k.materia; break; }
        }
        String texto = (materia.isEmpty() ? "" : materia + ": ") + Horario.textoCambio(x.tipo).toLowerCase(Locale.ROOT)
            + (x.nota.isEmpty() ? "" : ". " + x.nota);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel canal = new NotificationChannel(CANAL, "Cambios del día", NotificationManager.IMPORTANCE_HIGH);
            canal.setDescription("Avisa cuando se cancela una clase o falta un maestro");
            c.getSystemService(NotificationManager.class).createNotificationChannel(canal);
        }
        Intent abre = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CANAL)
            .setSmallIcon(R.drawable.ic_stat_cecyte)
            .setContentTitle("CECyTE Plantel 18")
            .setContentText(texto)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(texto))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true);
        if (abre != null) b.setContentIntent(PendingIntent.getActivity(c, 0, abre, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        NotificationManagerCompat.from(c).notify(x.id.hashCode(), b.build());
    }
}
