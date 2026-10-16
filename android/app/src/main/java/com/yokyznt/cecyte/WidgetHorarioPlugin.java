package com.yokyznt.cecyte;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

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
        try {
            new JSONArray(horario);                       // solo se guarda un horario que se pueda leer
        } catch (Exception e) {
            call.reject("El horario no es un arreglo JSON");
            return;
        }
        Horario.prefs(getContext()).edit()
            .putString("grupo", grupo).putString("horario", horario).putString("apiBase", apiBase).apply();
        HorarioWidget.programarTrabajo(getContext());
        HorarioWidget.refrescar(getContext());
        call.resolve();
    }
}
