package com.yokyznt.cecyte;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.Calendar;
import java.util.concurrent.TimeUnit;

/**
 * Widget «ahora / sigue». Las dos versiones (4x2 y 2x1) comparten todo: una sola pasada pinta las dos.
 * Se refresca al cambiar de bloque (alarma aproximada, sin permiso), cada ~30 min por el sistema y cada ~6 h
 * cuando ActualizaHorarioWorker baja el horario nuevo.
 */
public abstract class HorarioWidget extends AppWidgetProvider {
    static final String ACCION = "com.yokyznt.cecyte.ACTUALIZAR_WIDGET";

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) { refrescar(c); }

    @Override
    public void onEnabled(Context c) { programarTrabajo(c); }

    @Override
    public void onReceive(Context c, Intent i) {
        super.onReceive(c, i);
        if (ACCION.equals(i.getAction())) refrescar(c);
    }

    /** Baja el horario cada 6 h con red; si no hay red se queda lo último (no hace falta reintentar: cada ciclo vuelve a intentar). */
    static void programarTrabajo(Context c) {
        PeriodicWorkRequest r = new PeriodicWorkRequest.Builder(ActualizaHorarioWorker.class, 6, TimeUnit.HOURS)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork("horario-widget", ExistingPeriodicWorkPolicy.KEEP, r);
    }

    static void refrescar(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        Horario.Estado e = Horario.estadoAhora(c);
        String grupo = Horario.prefs(c).getString("grupo", "");
        Intent abre = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        PendingIntent toque = abre == null ? null : PendingIntent.getActivity(c, 0, abre, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        boolean hay = false;
        int[] grandes = m.getAppWidgetIds(new ComponentName(c, HorarioWidget4x2.class));
        if (grandes.length > 0) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_4x2);
            v.setTextViewText(R.id.w_grupo, grupo);
            v.setTextViewText(R.id.w_ahora, e.ahora);
            v.setTextViewText(R.id.w_ahora_det, e.ahoraDetalle);
            v.setTextViewText(R.id.w_sigue, e.sigue);
            v.setTextViewText(R.id.w_sigue_det, e.sigueDetalle);
            if (toque != null) v.setOnClickPendingIntent(R.id.w_raiz, toque);
            m.updateAppWidget(grandes, v);
            hay = true;
        }
        int[] chicos = m.getAppWidgetIds(new ComponentName(c, HorarioWidget2x1.class));
        if (chicos.length > 0) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_2x1);
            v.setTextViewText(R.id.w_ahora, e.ahora);
            v.setTextViewText(R.id.w_ahora_det, e.ahoraDetalle);
            if (toque != null) v.setOnClickPendingIntent(R.id.w_raiz, toque);
            m.updateAppWidget(chicos, v);
            hay = true;
        }
        if (hay) programarAlarma(c);
    }

    // Una sola alarma, al siguiente cambio de bloque. Aproximada a propósito: no pide el permiso de alarmas exactas.
    private static void programarAlarma(Context c) {
        AlarmManager a = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (a == null) return;
        Intent i = new Intent(c, HorarioWidget4x2.class).setAction(ACCION);
        PendingIntent pi = PendingIntent.getBroadcast(c, 1, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Calendar cuando = Horario.proximoCambio(Calendar.getInstance());
        a.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cuando.getTimeInMillis() + 2000, pi);
    }
}
