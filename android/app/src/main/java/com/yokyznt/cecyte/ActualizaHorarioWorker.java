package com.yokyznt.cecyte;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Cada ~6 h baja /api/schedule (público, sin token), lo guarda y refresca el widget. Sin red conserva lo último. */
public class ActualizaHorarioWorker extends Worker {
    private static final int TOPE_BYTES = 2 * 1024 * 1024;   // el horario real pesa decenas de KB; esto solo evita respuestas absurdas

    public ActualizaHorarioWorker(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        String base = Horario.prefs(c).getString("apiBase", "");
        if (base.isEmpty()) return Result.success();
        HttpURLConnection h = null;
        try {
            h = (HttpURLConnection) new URL(base + "/api/schedule").openConnection();
            h.setConnectTimeout(15000);
            h.setReadTimeout(15000);
            if (h.getResponseCode() != 200) return Result.success();
            ByteArrayOutputStream sal = new ByteArrayOutputStream();
            try (InputStream in = h.getInputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) {
                    sal.write(buf, 0, n);
                    if (sal.size() > TOPE_BYTES) return Result.success();
                }
            }
            String cuerpo = sal.toString("UTF-8");
            new JSONArray(cuerpo);                       // si no es un arreglo JSON, se descarta y queda lo último
            Horario.prefs(c).edit().putString("horario", cuerpo).apply();
            HorarioWidget.refrescar(c);
        } catch (Exception e) {
            // sin red o respuesta rota: se queda lo último guardado
        } finally {
            if (h != null) h.disconnect();
        }
        return Result.success();
    }
}
