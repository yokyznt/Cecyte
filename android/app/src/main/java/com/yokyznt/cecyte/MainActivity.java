package com.yokyznt.cecyte;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ClonVozPlugin.class);
        registerPlugin(VozLocalPlugin.class);
        registerPlugin(WidgetHorarioPlugin.class);   // antes de super.onCreate: ahí arranca el puente
        super.onCreate(savedInstanceState);
    }
}
