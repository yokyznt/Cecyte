package com.yokyznt.cecyte;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/**
 * Datos del widget y cálculo de qué clase es «ahora» y cuál «sigue». El cálculo (calcular, proximoCambio) no toca
 * Android, así que se prueba con JUnit (HorarioTest). Los textos son los mismos que textoAviso() de app.js.
 */
public final class Horario {
    // Mismos bloques que timeSlots de app.js (test/widget.test.js comprueba que no se desfasen).
    static final String[] BLOQUES = {
        "07:00 - 08:00", "08:00 - 08:45", "08:45 - 09:15", "09:15 - 10:00", "10:00 - 11:00",
        "11:00 - 12:00", "12:00 - 13:00", "13:00 - 14:00", "14:00 - 15:00",
    };
    static final String RECESO = "08:45 - 09:15";
    private static final String[] DIAS = { "Lunes", "Martes", "Miércoles", "Jueves", "Viernes" };

    public static final class Clase {
        final String grupo, dia, hora, materia, maestro;

        Clase(String grupo, String dia, String hora, String materia, String maestro) {
            this.grupo = grupo; this.dia = dia; this.hora = hora; this.materia = materia; this.maestro = maestro;
        }
    }

    /** Cambio del día que marca el admin (clase cancelada / maestro ausente); es lo que devuelve /api/changes. */
    public static final class Cambio {
        final String id, grupo, fecha, hora, tipo, nota;

        Cambio(String id, String grupo, String fecha, String hora, String tipo, String nota) {
            this.id = id; this.grupo = grupo; this.fecha = fecha; this.hora = hora; this.tipo = tipo; this.nota = nota;
        }
    }

    public static final class Estado {
        public final String ahora, ahoraDetalle, sigue, sigueDetalle;

        Estado(String ahora, String ahoraDetalle, String sigue, String sigueDetalle) {
            this.ahora = ahora; this.ahoraDetalle = ahoraDetalle; this.sigue = sigue; this.sigueDetalle = sigueDetalle;
        }
    }

    private Horario() {}

    // ---------- Lo que guarda la app (SharedPreferences propias, las escribe WidgetHorarioPlugin y ActualizaHorarioWorker) ----------

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("widget_horario", Context.MODE_PRIVATE);
    }

    static List<Clase> leer(String json) {
        List<Clase> r = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(json);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                r.add(new Clase(o.optString("group"), o.optString("day"), o.optString("time"), o.optString("subject"), o.optString("teacher")));
            }
        } catch (Exception e) { /* datos rotos: widget vacío en vez de caerse */ }
        return r;
    }

    static List<Cambio> leerCambios(String json) {
        List<Cambio> r = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(json);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                r.add(new Cambio(o.optString("id"), o.optString("group"), o.optString("date"), o.optString("time"), o.optString("tipo"), o.optString("nota")));
            }
        } catch (Exception e) { /* datos rotos: sin cambios */ }
        return r;
    }

    static Estado estadoAhora(Context c) {
        SharedPreferences p = prefs(c);
        Calendar ahora = Calendar.getInstance();
        return calcular(leer(p.getString("horario", "[]")), leerCambios(p.getString("cambios", "[]")), fechaHoy(ahora), p.getString("grupo", ""),
            ahora.get(Calendar.DAY_OF_WEEK), ahora.get(Calendar.HOUR_OF_DAY) * 60 + ahora.get(Calendar.MINUTE));
    }

    // ---------- Cálculo puro ----------

    private static int minutos(String hhmm) {
        return Integer.parseInt(hhmm.substring(0, 2)) * 60 + Integer.parseInt(hhmm.substring(3, 5));
    }

    private static int inicio(String bloque) { return minutos(bloque.substring(0, 5)); }
    private static int fin(String bloque) { return minutos(bloque.substring(8, 13)); }

    private static Clase buscar(List<Clase> cs, String grupo, String dia, String hora) {
        for (Clase c : cs) if (c.grupo.equals(grupo) && c.dia.equals(dia) && c.hora.equals(hora)) return c;
        return null;
    }

    private static String detalle(Clase c, String bloque) {
        return c.maestro.isEmpty() ? bloque : c.maestro + " · " + bloque;
    }

    // Mismos textos que TEXTO_CAMBIO de app.js
    static String textoCambio(String tipo) {
        return "ausente".equals(tipo) ? "Maestro ausente" : "Cancelada hoy";
    }

    private static String detalleCambio(Cambio x) {
        return x.nota.isEmpty() ? textoCambio(x.tipo) : textoCambio(x.tipo) + " · " + x.nota;
    }

    static Cambio buscarCambio(List<Cambio> cs, String fecha, String grupo, String hora) {
        for (Cambio x : cs) if (x.fecha.equals(fecha) && x.grupo.equals(grupo) && x.hora.equals(hora)) return x;
        return null;
    }

    static String fechaHoy(Calendar c) {
        return String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    /** Nombre del día como lo guarda el horario ("Lunes"...), o null en fin de semana. diaSemana es Calendar.DAY_OF_WEEK. */
    static String nombreDia(int diaSemana) {
        int d = diaSemana - Calendar.MONDAY;
        return d >= 0 && d < DIAS.length ? DIAS[d] : null;
    }

    /** ¿Toca revisar cambios del día? Solo lunes a viernes de 06:00 a 15:30: fuera de ahí el trabajo de fondo no gasta red ni batería. */
    static boolean enHorarioDeRevision(int diaSemana, int minuto) {
        return nombreDia(diaSemana) != null && minuto >= 6 * 60 && minuto < 15 * 60 + 30;
    }

    /** Sin cambios del día: igual que antes. */
    public static Estado calcular(List<Clase> clases, String grupo, int diaSemana, int minuto) {
        return calcular(clases, new ArrayList<Cambio>(), "", grupo, diaSemana, minuto);
    }

    /** diaSemana es Calendar.DAY_OF_WEEK; minuto es el minuto del día (0-1439); fechaHoy es AAAA-MM-DD. */
    public static Estado calcular(List<Clase> clases, List<Cambio> cambios, String fechaHoy, String grupo, int diaSemana, int minuto) {
        if (grupo == null || grupo.isEmpty()) return new Estado("Elige tu grupo", "Abre la app", "", "");
        int d = diaSemana - Calendar.MONDAY;
        if (d < 0 || d >= DIAS.length) return new Estado("Sin clases hoy", "Fin de semana", "", "");
        String dia = DIAS[d];

        int actual = -1;
        for (int i = 0; i < BLOQUES.length; i++) if (minuto >= inicio(BLOQUES[i]) && minuto < fin(BLOQUES[i])) actual = i;

        String ahora, ahoraDet = "";
        if (actual < 0) {
            ahora = minuto < inicio(BLOQUES[0]) ? "Aún no empiezan las clases" : "Clases terminadas";
        } else if (BLOQUES[actual].equals(RECESO)) {
            ahora = "Receso"; ahoraDet = RECESO;
        } else {
            Clase c = buscar(clases, grupo, dia, BLOQUES[actual]);
            Cambio x = c != null ? buscarCambio(cambios, fechaHoy, grupo, BLOQUES[actual]) : null;
            ahora = c != null ? c.materia : "Sin clase";
            ahoraDet = x != null ? detalleCambio(x) : c != null ? detalle(c, BLOQUES[actual]) : BLOQUES[actual];
        }

        String sigue = "No hay más clases por hoy", sigueDet = "";
        int desde = actual >= 0 ? actual + 1 : (minuto < inicio(BLOQUES[0]) ? 0 : BLOQUES.length);
        for (int i = desde; i < BLOQUES.length; i++) {
            if (BLOQUES[i].equals(RECESO)) { sigue = "Receso"; sigueDet = RECESO; break; }
            Clase c = buscar(clases, grupo, dia, BLOQUES[i]);
            if (c != null) {
                Cambio x = buscarCambio(cambios, fechaHoy, grupo, BLOQUES[i]);
                sigue = c.materia;
                sigueDet = x != null ? detalleCambio(x) : detalle(c, BLOQUES[i]);
                break;
            }
        }
        return new Estado(ahora, ahoraDet, sigue, sigueDet);
    }

    /** El primer cambio de bloque (inicio o fin) que viene después de «desde»; sirve para programar el siguiente refresco. */
    public static Calendar proximoCambio(Calendar desde) {
        for (int d = 0; d < 8; d++) {
            for (int i = 0; i <= BLOQUES.length; i++) {
                int m = i < BLOQUES.length ? inicio(BLOQUES[i]) : fin(BLOQUES[BLOQUES.length - 1]);
                Calendar t = (Calendar) desde.clone();
                t.add(Calendar.DAY_OF_MONTH, d);
                t.set(Calendar.HOUR_OF_DAY, m / 60);
                t.set(Calendar.MINUTE, m % 60);
                t.set(Calendar.SECOND, 0);
                t.set(Calendar.MILLISECOND, 0);
                int dow = t.get(Calendar.DAY_OF_WEEK);
                if (dow >= Calendar.MONDAY && dow <= Calendar.FRIDAY && t.after(desde)) return t;
            }
        }
        Calendar manana = (Calendar) desde.clone();   // no debería pasar: respaldo de 6 h
        manana.add(Calendar.HOUR_OF_DAY, 6);
        return manana;
    }
}
