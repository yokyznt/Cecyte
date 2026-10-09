/*
  ================================================================
  TIMBRE ESCOLAR - CECyTE Plantel 18  (ESP32 + Módulo Relé)
  ================================================================
  Solo conéctalo a la corriente y a una red WiFi conocida:
   - Se conecta solo (prueba las redes de la lista de abajo).
   - Saca la hora real por Internet (NTP).
   - Cada 5 segundos le pregunta a la página (cecyteo.vercel.app):
       * las horas y los días del timbre,
       * el RITMO del timbre (lo editas en el panel de Admin),
       * si le diste "Tocar timbre ahora".
   - Lo que cambies en el panel se actualiza SOLO: no hay que volver
     a programar el ESP32 nunca más.
   - Guarda lo último que recibió en su memoria: si se va el Internet
     o la luz, sigue tocando con el último horario y ritmo.

  La consulta a Internet corre en otro "hilo", así que aunque el WiFi
  esté lento o caído, el timbre suena justo a tiempo.

  CONEXIÓN: relé en el pin 23 (PIN_RELE).
  ================================================================
*/

#include <WiFi.h>
#include <WiFiMulti.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>
#include <Preferences.h>

#include "secretos.h"   // REDES (WiFi) y DEVICE_KEY: están en su propio archivo para no subirlos a GitHub

// ====== CONFIGURACIÓN ======
// Tu página (la llave DEVICE_KEY y las redes WiFi están en secretos.h)
const char* SERVER_URL = "https://cecyteo.vercel.app/api/bell";

const int PIN_RELE = 23;
const unsigned long INTERVALO_CONSULTA_MS = 5000;   // cada cuánto pregunta a la página

// Respaldo (hasta que llegue lo de la página por primera vez): el ritmo y los horarios de siempre.
// RITMO en milisegundos alternando SUENA, PAUSA, SUENA, ... (siempre impar: termina sonando)
const unsigned long RITMO_BASE[] = {
  220, 160,  200, 190,  200, 210,  140, 100,  140, 230,  100, 80,  130, 250,  160, 210,
  200
};
const int HORARIOS_BASE[][2] = {   // { hora (0-23), minuto }
  { 7, 0 }, { 8, 0 }, { 8, 45 }, { 9, 15 }, { 10, 0 }, { 11, 0 }, { 12, 0 }, { 13, 0 }, { 14, 0 }, { 15, 0 },
};
// ===========================

const int  MAX_PASOS = 128;
const int  MAX_HORARIOS = 40;
const unsigned long PASO_MIN_MS = 20;
const unsigned long PASO_MAX_MS = 5000;   // seguridad: ningún paso deja el relé prendido más de 5 s

// Todo lo que viene de la página (y se guarda en la memoria del ESP32)
struct Config {
  unsigned long ritmo[MAX_PASOS];
  int  numPasos;
  int  horarios[MAX_HORARIOS];    // minutos desde las 00:00
  int  numHorarios;
  bool dias[7];                   // 0=Dom ... 6=Sáb
};

Config cfg;                       // la que usa el timbre
Config nueva;                     // la que deja el hilo de Internet
volatile bool hayNueva = false;
volatile bool pedirTimbre = false;  // "Tocar timbre ahora" desde la página
SemaphoreHandle_t candado;
Preferences prefs;

// ----- estado del ritmo (solo lo toca loop) -----
bool sonando = false;
int  paso = 0;
unsigned long inicioPaso = 0;
long ultimaClave = -1;            // evita sonar dos veces en el mismo minuto
unsigned long ultimoPrint = 0;

void apagarRele()   { pinMode(PIN_RELE, INPUT); }
void encenderRele() { pinMode(PIN_RELE, OUTPUT); digitalWrite(PIN_RELE, LOW); }

void iniciarRitmo() {
  sonando = true;
  paso = 0;
  inicioPaso = millis();
  encenderRele();                 // el paso 0 siempre es SUENA
}

void manejarRitmo() {
  if (!sonando) return;
  if (millis() - inicioPaso < cfg.ritmo[paso]) return;

  paso++;
  if (paso >= cfg.numPasos) {     // terminó el ritmo
    sonando = false;
    apagarRele();
    Serial.println("Ritmo terminado");
    return;
  }

  inicioPaso = millis();
  if (paso % 2 == 0) encenderRele();   // pasos pares = suena
  else apagarRele();                   // pasos impares = pausa
}

// ----- memoria permanente (sobrevive a apagones) -----
void cargarConfig() {
  memset(&cfg, 0, sizeof(cfg));
  prefs.begin("timbre", false);
  if (prefs.getBytesLength("cfg") == sizeof(Config)) {
    prefs.getBytes("cfg", &cfg, sizeof(Config));
    Serial.printf("Config recuperada de la memoria: %d toques, %d horas\n", (cfg.numPasos + 1) / 2, cfg.numHorarios);
  } else {
    cfg.numPasos = sizeof(RITMO_BASE) / sizeof(RITMO_BASE[0]);
    for (int i = 0; i < cfg.numPasos; i++) cfg.ritmo[i] = RITMO_BASE[i];
    cfg.numHorarios = sizeof(HORARIOS_BASE) / sizeof(HORARIOS_BASE[0]);
    for (int i = 0; i < cfg.numHorarios; i++) cfg.horarios[i] = HORARIOS_BASE[i][0] * 60 + HORARIOS_BASE[i][1];
    for (int d = 1; d <= 5; d++) cfg.dias[d] = true;   // lunes a viernes
    Serial.println("Sin config guardada: uso el ritmo y horarios de fábrica");
  }
  prefs.end();
}

void guardarConfig() {
  prefs.begin("timbre", false);
  prefs.putBytes("cfg", &cfg, sizeof(Config));
  prefs.end();
}

// ----- hilo de Internet (no frena al timbre) -----
Config recibida;                   // última config que mandó la página
String ultimoRingId = "";
bool   ringInicializado = false;   // al arrancar NO tocamos por un "tocar ahora" viejo

String linea(const String& texto, int n) {
  int ini = 0;
  for (int i = 0; i < n; i++) {
    ini = texto.indexOf('\n', ini);
    if (ini < 0) return "";
    ini++;
  }
  int fin = texto.indexOf('\n', ini);
  return texto.substring(ini, fin < 0 ? texto.length() : fin);
}

// Devuelve true si el ritmo es válido y lo deja en dest
bool parsearRitmo(const String& txt, Config& dest) {
  unsigned long r[MAX_PASOS];
  int n = 0, ini = 0, largo = txt.length();
  if (largo == 0) return false;
  while (ini < largo) {
    int coma = txt.indexOf(',', ini);
    if (coma < 0) coma = largo;
    long v = txt.substring(ini, coma).toInt();
    if (v < (long)PASO_MIN_MS || v > (long)PASO_MAX_MS || n >= MAX_PASOS) return false;
    r[n++] = v;
    ini = coma + 1;
  }
  if (n % 2 == 0) return false;            // tiene que terminar sonando
  memset(dest.ritmo, 0, sizeof(dest.ritmo));
  memcpy(dest.ritmo, r, n * sizeof(unsigned long));
  dest.numPasos = n;
  return true;
}

void consultarServidor() {
  static unsigned long vez = 0;
  WiFiClientSecure cliente;
  cliente.setInsecure();                   // no validamos certificado (suficiente para este uso)
  HTTPClient http;
  http.setTimeout(6000);

  // cada 6ta consulta (~30 s) avisa "aquí estoy" para el letrerito "ESP32 en línea" del panel
  String url = String(SERVER_URL) + "?key=" + DEVICE_KEY + ((vez++ % 6 == 0) ? "&s=1" : "");
  if (!http.begin(cliente, url)) return;

  int codigo = http.GET();
  if (codigo != 200) {
    Serial.printf("Página respondió %d (sigo con la última config)\n", codigo);
    http.end();
    return;
  }
  String cuerpo = http.getString();
  http.end();
  cuerpo.replace("\r", "");

  String ringId = linea(cuerpo, 0);
  String dias   = linea(cuerpo, 2);
  String horas  = linea(cuerpo, 3);
  String ritmo  = linea(cuerpo, 4);
  if (ringId.length() == 0) return;        // respuesta rara: la ignoramos

  Config n;
  memcpy(&n, &recibida, sizeof(Config));

  for (int d = 0; d < 7; d++) n.dias[d] = false;
  for (unsigned int i = 0; i < dias.length(); i++) {
    int d = dias.charAt(i) - '0';
    if (d >= 0 && d <= 6) n.dias[d] = true;
  }

  memset(n.horarios, 0, sizeof(n.horarios));
  n.numHorarios = 0;
  int ini = 0, largo = horas.length();
  while (ini < largo && n.numHorarios < MAX_HORARIOS) {
    int coma = horas.indexOf(',', ini);
    if (coma < 0) coma = largo;
    String hhmm = horas.substring(ini, coma);
    hhmm.trim();
    if (hhmm.length() == 5 && hhmm.charAt(2) == ':')
      n.horarios[n.numHorarios++] = hhmm.substring(0, 2).toInt() * 60 + hhmm.substring(3, 5).toInt();
    ini = coma + 1;
  }

  if (!parsearRitmo(ritmo, n)) Serial.println("Ritmo de la página inválido o ausente: conservo el anterior");

  if (memcmp(&n, &recibida, sizeof(Config)) != 0) {
    memcpy(&recibida, &n, sizeof(Config));
    xSemaphoreTake(candado, portMAX_DELAY);
    memcpy(&nueva, &n, sizeof(Config));
    hayNueva = true;
    xSemaphoreGive(candado);
    Serial.println("La página mandó cambios (ritmo/horas/días)");
  }

  // "Tocar ahora": solo si el id cambió desde la última vez que lo vimos
  if (!ringInicializado) {
    ultimoRingId = ringId;
    ringInicializado = true;
  } else if (ringId != ultimoRingId) {
    ultimoRingId = ringId;
    pedirTimbre = true;
    Serial.println("Orden manual desde la página: tocar timbre");
  }
}

void tareaInternet(void*) {
  WiFiMulti wifiMulti;
  for (auto& red : REDES) wifiMulti.addAP(red[0], red[1]);

  for (;;) {
    if (wifiMulti.run(8000) == WL_CONNECTED) {
      static bool avisado = false;
      if (!avisado) { avisado = true; Serial.print("WiFi conectado, IP: "); Serial.println(WiFi.localIP()); }
      consultarServidor();
    } else {
      Serial.println("Buscando WiFi...");
    }
    vTaskDelay(INTERVALO_CONSULTA_MS / portTICK_PERIOD_MS);
  }
}

// ----- horarios -----
void revisarHorarios() {
  struct tm t;
  if (!getLocalTime(&t, 0) || t.tm_year <= 120) return;   // hora válida (año > 2020)
  if (!cfg.dias[t.tm_wday]) return;

  int minutosAhora = t.tm_hour * 60 + t.tm_min;
  long clave = (long)t.tm_yday * 1440L + minutosAhora;    // único por día y minuto
  if (clave == ultimaClave) return;

  for (int i = 0; i < cfg.numHorarios; i++) {
    if (cfg.horarios[i] == minutosAhora) {
      ultimaClave = clave;
      if (!sonando) iniciarRitmo();
      Serial.printf("%02d:%02d -> TIMBRE\n", t.tm_hour, t.tm_min);
      return;
    }
  }
}

void setup() {
  Serial.begin(115200);
  apagarRele();
  candado = xSemaphoreCreateMutex();

  cargarConfig();                          // usa lo último guardado, aunque no haya Internet
  memcpy(&recibida, &cfg, sizeof(Config));

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  configTzTime("CST6", "pool.ntp.org", "time.google.com");   // Oaxaca: UTC-6, sin horario de verano

  xTaskCreatePinnedToCore(tareaInternet, "internet", 12288, NULL, 1, NULL, 0);
  Serial.println("Timbre listo. Conectando a WiFi y buscando la hora...");
}

void loop() {
  // Cambios que llegaron de la página: se aplican cuando el timbre NO está sonando
  if (hayNueva && !sonando) {
    xSemaphoreTake(candado, portMAX_DELAY);
    bool cambio = memcmp(&cfg, &nueva, sizeof(Config)) != 0;
    if (cambio) memcpy(&cfg, &nueva, sizeof(Config));
    hayNueva = false;
    xSemaphoreGive(candado);
    if (cambio) {
      guardarConfig();
      Serial.printf("Config nueva aplicada y guardada: %d toques, %d horas\n", (cfg.numPasos + 1) / 2, cfg.numHorarios);
    }
  }

  if (pedirTimbre) {
    pedirTimbre = false;
    if (!sonando) iniciarRitmo();
  }

  manejarRitmo();
  revisarHorarios();

  if (millis() - ultimoPrint >= 10000) {
    ultimoPrint = millis();
    struct tm t;
    if (getLocalTime(&t, 0) && t.tm_year > 120) Serial.printf("Hora: %02d:%02d:%02d\n", t.tm_hour, t.tm_min, t.tm_sec);
    else Serial.println("Esperando hora de internet...");
  }

  delay(5);
}
