package com.yokyznt.cecyte;

import android.content.res.AssetManager;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "VozLocal")
public class VozLocalPlugin extends Plugin {
    private static final String TAG = "VozLocal";
    private static final String VERSION = "1";
    private final ExecutorService hilo = Executors.newSingleThreadExecutor();
    private OfflineTts motor;
    private String vozActual = "";

    @PluginMethod
    public void preparar(final PluginCall call) {
        final String voz = limpiarVoz(call.getString("voz", "ald"));
        hilo.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    long t0 = System.currentTimeMillis();
                    cargar(voz);
                    long carga = System.currentTimeMillis() - t0;
                    t0 = System.currentTimeMillis();
                    GeneratedAudio a = motor.generate("Hola, soy Hevy.", 0, 1.0f);
                    long prueba = System.currentTimeMillis() - t0;
                    float segundos = a.getSamples().length / (float) a.getSampleRate();
                    Log.i(TAG, "listo voz=" + voz + " carga=" + carga + "ms prueba=" + prueba + "ms audio=" + segundos + "s");
                    JSObject r = new JSObject();
                    r.put("carga", carga);
                    r.put("prueba", prueba);
                    call.resolve(r);
                } catch (Throwable e) {
                    Log.e(TAG, "no pudo prepararse", e);
                    call.reject(mensaje(e));
                }
            }
        });
    }

    @PluginMethod
    public void hablar(final PluginCall call) {
        final String texto = call.getString("texto", "");
        final String voz = limpiarVoz(call.getString("voz", "ald"));
        final Float rapidez = call.getFloat("velocidad", 1.0f);
        if (texto.trim().isEmpty() || texto.length() > 700) {
            call.reject("Texto vacío o demasiado largo");
            return;
        }
        hilo.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    cargar(voz);
                    long t0 = System.currentTimeMillis();
                    float v = rapidez == null ? 1.0f : Math.max(0.6f, Math.min(1.6f, rapidez));
                    GeneratedAudio a = motor.generate(texto, 0, v);
                    byte[] wav = aWav(a.getSamples(), a.getSampleRate());
                    Log.i(TAG, "hablo " + texto.length() + " letras en " + (System.currentTimeMillis() - t0) + "ms");
                    JSObject r = new JSObject();
                    r.put("audio", Base64.encodeToString(wav, Base64.NO_WRAP));
                    call.resolve(r);
                } catch (Throwable e) {
                    Log.e(TAG, "no pudo hablar", e);
                    call.reject(mensaje(e));
                }
            }
        });
    }

    private static String limpiarVoz(String voz) {
        return "claude".equals(voz) ? "claude" : "ald";
    }

    private static String mensaje(Throwable e) {
        return e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
    }

    private synchronized void cargar(String voz) throws IOException {
        if (motor != null && voz.equals(vozActual)) return;
        if (motor != null) {
            motor.release();
            motor = null;
        }
        File base = new File(getContext().getFilesDir(), "voz");
        copiarAssets(base);
        OfflineTtsVitsModelConfig vits = new OfflineTtsVitsModelConfig();
        vits.setModel(new File(base, voz + "/model.onnx").getAbsolutePath());
        vits.setTokens(new File(base, voz + "/tokens.txt").getAbsolutePath());
        vits.setDataDir(new File(base, "espeak-ng-data").getAbsolutePath());
        OfflineTtsModelConfig modelo = new OfflineTtsModelConfig();
        modelo.setVits(vits);
        modelo.setNumThreads(2);
        modelo.setDebug(false);
        modelo.setProvider("cpu");
        OfflineTtsConfig config = new OfflineTtsConfig();
        config.setModel(modelo);
        motor = new OfflineTts(null, config);
        vozActual = voz;
    }

    private void copiarAssets(File base) throws IOException {
        File marca = new File(base, "version.txt");
        if (marca.exists() && VERSION.equals(leer(marca))) return;
        copiar(getContext().getAssets(), "voz", base);
        FileOutputStream o = new FileOutputStream(marca);
        o.write(VERSION.getBytes("UTF-8"));
        o.close();
    }

    private static String leer(File f) throws IOException {
        InputStream in = new java.io.FileInputStream(f);
        ByteArrayOutputStream salida = new ByteArrayOutputStream();
        byte[] buf = new byte[64];
        int n;
        while ((n = in.read(buf)) > 0) salida.write(buf, 0, n);
        in.close();
        return salida.toString("UTF-8");
    }

    private static void copiar(AssetManager am, String ruta, File destino) throws IOException {
        String[] hijos = am.list(ruta);
        if (hijos != null && hijos.length > 0) {
            destino.mkdirs();
            for (String h : hijos) copiar(am, ruta + "/" + h, new File(destino, h));
            return;
        }
        File padre = destino.getParentFile();
        if (padre != null) padre.mkdirs();
        InputStream in = am.open(ruta);
        OutputStream out = new FileOutputStream(destino);
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        out.close();
        in.close();
    }

    private static byte[] aWav(float[] muestras, int frecuencia) {
        int n = muestras.length;
        ByteBuffer b = ByteBuffer.allocate(44 + 2 * n).order(ByteOrder.LITTLE_ENDIAN);
        b.put("RIFF".getBytes()).putInt(36 + 2 * n).put("WAVE".getBytes()).put("fmt ".getBytes());
        b.putInt(16).putShort((short) 1).putShort((short) 1).putInt(frecuencia).putInt(frecuencia * 2).putShort((short) 2).putShort((short) 16);
        b.put("data".getBytes()).putInt(2 * n);
        for (int i = 0; i < n; i++) {
            float x = Math.max(-1f, Math.min(1f, muestras[i]));
            b.putShort((short) Math.round(x * 32767f));
        }
        return b.array();
    }
}
