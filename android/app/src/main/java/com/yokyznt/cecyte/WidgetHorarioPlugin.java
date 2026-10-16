package com.yokyznt.cecyte;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.content.SharedPreferences;

import org.json.JSONArray;

import java.util.HashSet;
import java.util.Set;

/**
 * Puente entre la app (js/avisos-nativos.js) y el widget: guarda el grupo y el horario que ve el alumno
 * y refresca el widget. Se registra en MainActivity.
 */
@CapacitorPlugin(name = "WidgetHorario")
public class WidgetHorarioPlugin extends Plugin {
    @PluginMethod
    public void guardar(PluginCall call) {
        String grupo = call.getString("grupo", "");
        String horario = call.getString("horario", "[]");
        String apiBase = call.getString("apiBase", "");
        String cambios = call.getString("cambios", "[]");
        try {
            new JSONArray(horario);                       // solo se guarda lo que se pueda leer
            new JSONArray(cambios);
        } catch (Exception e) {
            call.reject("El horario o los cambios no son un arreglo JSON");
            return;
        }
        SharedPreferences p = Horario.prefs(getContext());
        // Los cambios que el alumno ya ve en la app cuentan como avisados: el trabajo de fondo no los repite como notificación
        Set<String> avisados = new HashSet<>(p.getStringSet("avisados", new HashSet<String>()));
        for (Horario.Cambio x : Horario.leerCambios(cambios)) if (x.grupo.equals(grupo)) avisados.add(x.id);
        p.edit().putString("grupo", grupo).putString("horario", horario).putString("cambios", cambios)
            .putString("apiBase", apiBase).putStringSet("avisados", avisados).apply();
        HorarioWidget.programarTrabajo(getContext());
        HorarioWidget.refrescar(getContext());
        call.resolve();
    }
}
