package com.yokyznt.cecyte;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "ClonVoz")
public class ClonVozPlugin extends Plugin {
    private static final String URL_VOCES = "https://api.gradium.ai/api/voices/";

    @PluginMethod
    public void crear(final PluginCall call) {
        final String llave = call.getString("llave", "");
        final String nombre = call.getString("nombre", "Voz de Hevy");
        final String audio = call.getString("audio", "");
        if (llave.isEmpty() || audio.isEmpty()) {
            call.reject("Faltan la llave o el audio");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection c = null;
                try {
                    byte[] wav = Base64.decode(audio, Base64.DEFAULT);
                    String borde = "----hevy" + System.currentTimeMillis();
                    c = (HttpURLConnection) new URL(URL_VOCES).openConnection();
                    c.setRequestMethod("POST");
                    c.setDoOutput(true);
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(90000);
                    c.setRequestProperty("x-api-key", llave);
                    c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + borde);
                    OutputStream o = c.getOutputStream();
                    campo(o, borde, "name", nombre);
                    campo(o, borde, "language", "es");
                    campo(o, borde, "description", "Voz de Hevy");
                    o.write(("--" + borde + "\r\nContent-Disposition: form-data; name=\"audio_file\"; filename=\"muestra.wav\"\r\nContent-Type: audio/wav\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                    o.write(wav);
                    o.write(("\r\n--" + borde + "--\r\n").getBytes(StandardCharsets.UTF_8));
                    o.flush();
                    o.close();
                    int codigo = c.getResponseCode();
                    InputStream in = codigo < 400 ? c.getInputStream() : c.getErrorStream();
                    ByteArrayOutputStream salida = new ByteArrayOutputStream();
                    if (in != null) {
                        byte[] buf = new byte[4096];
                        int n;
                        while ((n = in.read(buf)) > 0) salida.write(buf, 0, n);
                        in.close();
                    }
                    JSObject r = new JSObject();
                    r.put("codigo", codigo);
                    r.put("cuerpo", salida.toString("UTF-8"));
                    call.resolve(r);
                } catch (Exception e) {
                    call.reject(e.getMessage() == null ? "Sin conexión" : e.getMessage());
                } finally {
                    if (c != null) c.disconnect();
                }
            }
        }).start();
    }

    private static void campo(OutputStream o, String borde, String nombre, String valor) throws java.io.IOException {
        o.write(("--" + borde + "\r\nContent-Disposition: form-data; name=\"" + nombre + "\"\r\n\r\n" + valor + "\r\n").getBytes(StandardCharsets.UTF_8));
    }
}
