package com.yokyznt.cecyte;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.Arrays;
import java.util.Calendar;
import java.util.List;

/** Cálculo del widget («ahora» y «sigue»): corre sin teléfono con `gradlew testDebugUnitTest`. */
public class HorarioTest {
    private static final List<Horario.Clase> CLASES = Arrays.asList(
        new Horario.Clase("3A", "Lunes", "07:00 - 08:00", "Matemáticas", "Ana"),
        new Horario.Clase("3A", "Lunes", "08:00 - 08:45", "Física", "Beto"),
        new Horario.Clase("3A", "Lunes", "10:00 - 11:00", "Inglés", ""),
        new Horario.Clase("3A", "Lunes", "14:00 - 15:00", "Taller", "Carla"),
        new Horario.Clase("3B", "Lunes", "07:00 - 08:00", "Otra", "Otro")
    );

    private static Horario.Estado lunes(int h, int m) {
        return Horario.calcular(CLASES, "3A", Calendar.MONDAY, h * 60 + m);
    }

    @Test public void claseActualYSiguiente() {
        Horario.Estado e = lunes(7, 30);
        assertEquals("Matemáticas", e.ahora);
        assertEquals("Ana · 07:00 - 08:00", e.ahoraDetalle);
        assertEquals("Física", e.sigue);
    }

    @Test public void despuesDeLaUltimaClaseDelBloqueSigueElReceso() {
        Horario.Estado e = lunes(8, 30);
        assertEquals("Física", e.ahora);
        assertEquals("Receso", e.sigue);
        assertEquals("08:45 - 09:15", e.sigueDetalle);
    }

    @Test public void duranteElRecesoSigueLaProximaClaseConMaestroVacio() {
        Horario.Estado e = lunes(9, 0);
        assertEquals("Receso", e.ahora);
        assertEquals("Inglés", e.sigue);
        assertEquals("10:00 - 11:00", e.sigueDetalle);   // sin maestro, solo el bloque
    }

    @Test public void bloqueSinClaseSeSaltaAlSiguienteConClase() {
        Horario.Estado e = lunes(11, 30);
        assertEquals("Sin clase", e.ahora);
        assertEquals("Taller", e.sigue);
    }

    @Test public void ultimaClaseYFinDelDia() {
        assertEquals("No hay más clases por hoy", lunes(14, 30).sigue);
        Horario.Estado e = lunes(15, 0);
        assertEquals("Clases terminadas", e.ahora);
        assertEquals("No hay más clases por hoy", e.sigue);
    }

    @Test public void antesDeLasSiete() {
        Horario.Estado e = lunes(6, 0);
        assertEquals("Aún no empiezan las clases", e.ahora);
        assertEquals("Matemáticas", e.sigue);
    }

    @Test public void finDeSemanaYSinGrupo() {
        assertEquals("Sin clases hoy", Horario.calcular(CLASES, "3A", Calendar.SATURDAY, 600).ahora);
        assertEquals("Sin clases hoy", Horario.calcular(CLASES, "3A", Calendar.SUNDAY, 600).ahora);
        assertEquals("Elige tu grupo", Horario.calcular(CLASES, "", Calendar.MONDAY, 600).ahora);
        assertEquals("Elige tu grupo", Horario.calcular(CLASES, null, Calendar.MONDAY, 600).ahora);
    }

    private static final List<Horario.Cambio> CAMBIOS = Arrays.asList(
        new Horario.Cambio("a", "3A", "2026-10-12", "08:00 - 08:45", "cancelada", ""),
        new Horario.Cambio("b", "3A", "2026-10-12", "10:00 - 11:00", "ausente", "Incapacidad"),
        new Horario.Cambio("c", "3B", "2026-10-12", "07:00 - 08:00", "cancelada", ""),   // otro grupo
        new Horario.Cambio("d", "3A", "2026-10-13", "07:00 - 08:00", "cancelada", "")    // otro día
    );

    private static Horario.Estado lunesConCambios(int h, int m) {
        return Horario.calcular(CLASES, CAMBIOS, "2026-10-12", "3A", Calendar.MONDAY, h * 60 + m);
    }

    @Test public void elCambioDeHoySeVeEnAhoraYEnSigue() {
        Horario.Estado e = lunesConCambios(7, 30);          // ahora Matemáticas (sin cambio), sigue Física (cancelada)
        assertEquals("Ana · 07:00 - 08:00", e.ahoraDetalle);
        assertEquals("Física", e.sigue);
        assertEquals("Cancelada hoy", e.sigueDetalle);
        e = lunesConCambios(8, 10);                         // ahora Física cancelada
        assertEquals("Física", e.ahora);
        assertEquals("Cancelada hoy", e.ahoraDetalle);
        e = lunesConCambios(9, 30);                         // sigue Inglés con maestro ausente y nota
        assertEquals("Inglés", e.sigue);
        assertEquals("Maestro ausente · Incapacidad", e.sigueDetalle);
    }

    @Test public void losCambiosDeOtroGrupoODiaNoCuentan() {
        assertEquals("Ana · 07:00 - 08:00", lunesConCambios(7, 30).ahoraDetalle);          // el de 3B y el de mañana no se ven
        assertEquals("Maestro ausente", Horario.textoCambio("ausente"));
        assertEquals("Cancelada hoy", Horario.textoCambio("cancelada"));
    }

    @Test public void soloSeRevisaEnHorarioEscolar() {
        assertEquals(true, Horario.enHorarioDeRevision(Calendar.MONDAY, 6 * 60));
        assertEquals(false, Horario.enHorarioDeRevision(Calendar.MONDAY, 6 * 60 - 1));
        assertEquals(true, Horario.enHorarioDeRevision(Calendar.FRIDAY, 15 * 60 + 29));
        assertEquals(false, Horario.enHorarioDeRevision(Calendar.FRIDAY, 15 * 60 + 30));
        assertEquals(false, Horario.enHorarioDeRevision(Calendar.SATURDAY, 9 * 60));
        assertEquals(false, Horario.enHorarioDeRevision(Calendar.SUNDAY, 9 * 60));
    }

    @Test public void fechaYDiaDelHorario() {
        Calendar c = Calendar.getInstance();
        c.clear();
        c.set(2026, Calendar.OCTOBER, 5, 8, 0, 0);
        assertEquals("2026-10-05", Horario.fechaHoy(c));
        assertEquals("Lunes", Horario.nombreDia(Calendar.MONDAY));
        assertEquals("Viernes", Horario.nombreDia(Calendar.FRIDAY));
        assertEquals(null, Horario.nombreDia(Calendar.SUNDAY));
    }

    @Test public void soloCuentaElGrupoElegido() {
        assertEquals("Otra", Horario.calcular(CLASES, "3B", Calendar.MONDAY, 7 * 60 + 30).ahora);
    }

    @Test public void proximoCambioSigueElBloqueYSaltaElFinDeSemana() {
        Calendar viernes = Calendar.getInstance();
        viernes.clear();
        viernes.set(2026, Calendar.OCTOBER, 16, 14, 30, 0);          // viernes
        Calendar t = Horario.proximoCambio(viernes);
        assertEquals(15, t.get(Calendar.HOUR_OF_DAY));               // fin del último bloque, el mismo día
        assertEquals(16, t.get(Calendar.DAY_OF_MONTH));
        t = Horario.proximoCambio(t);                                // ya pasó: el lunes a las 7
        assertEquals(19, t.get(Calendar.DAY_OF_MONTH));
        assertEquals(7, t.get(Calendar.HOUR_OF_DAY));
        assertEquals(Calendar.MONDAY, t.get(Calendar.DAY_OF_WEEK));
    }
}
