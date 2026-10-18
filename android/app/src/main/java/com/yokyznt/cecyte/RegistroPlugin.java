package com.yokyznt.cecyte;

import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Registro")
public class RegistroPlugin extends Plugin {
    @PluginMethod
    public void registrar(PluginCall call) {
        Log.i("VozJS", call.getString("texto", ""));
        call.resolve();
    }
}
