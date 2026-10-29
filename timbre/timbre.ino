/*
  ================================================================
  TIMBRE ESCOLAR - CECyTE Plantel 18  (ESP32 + Módulo Relé)
  ================================================================
  Solo conéctalo a la corriente y a una red WiFi conocida:
   - Se conecta solo (prueba las redes de secretos.h).
   - Saca la hora real por Internet (NTP).
   - Le pregunta a la página (cecyteo.vercel.app) cada 5 segundos en horario
     escolar (cada 30 s de noche y fines de semana):
       * las horas y los días del timbre,
       * el RITMO normal y los ritmos de horas especiales,
       * los días sin timbre y los horarios especiales,
       * si le diste "Tocar timbre ahora",
       * si hay firmware nuevo (se actualiza solo, sin cable).
   - Le avisa a la página cuándo suena y que sigue en línea (letrero del panel).
   - Guarda lo último que recibió en su memoria: si se va el Internet
     o la luz, sigue tocando con el último horario y ritmo.

  La consulta a Internet corre en otro "hilo", así que aunque el WiFi
  esté lento o caído, el timbre suena justo a tiempo.

  CONEXIÓN: relé en el pin 23 (PIN_RELE).

  ACTUALIZAR SIN CABLE (OTA):
   1) Cambia FW_VERSION (abajo) a un número mayor, por ejemplo 2.
   2) Arduino IDE: Programa > Exportar binario compilado.
   3) En el panel de Admin > "Firmware del ESP32", sube el archivo
      "timbre.ino.bin" (el que NO dice bootloader, partitions ni merged)
      con ese mismo número de versión.
   El ESP32 lo descarga solo en cuanto no esté sonando.
  ================================================================
*/

#include <WiFi.h>
#include <WiFiMulti.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Update.h>
#include <time.h>
#include <Preferences.h>
#include "secretos.h"   // REDES (WiFi) y DEVICE_KEY: están en su propio archivo para no subirlos a GitHub

// ====== CONFIGURACIÓN ======
const int FW_VERSION = 2;   // sube este número cada vez que publiques un firmware nuevo

// Tu página (la llave DEVICE_KEY y las redes WiFi están en secretos.h)
const char* SERVER_URL   = "https://cecyteo.vercel.app/api/bell";
const char* FIRMWARE_URL = "https://cecyteo.vercel.app/api/firmware";

const int PIN_RELE = 23;
const unsigned long INTERVALO_ESCOLAR_MS = 5000;    // lunes a viernes de 6:00 a 17:00
const unsigned long INTERVALO_LENTO_MS   = 30000;   // noches y fines de semana

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
const int  MAX_OVR = 8, MAX_OVR_PASOS = 39;     // ritmos por hora
const int  MAX_OFF = 40;                        // días sin timbre
const int  MAX_ESP = 8, MAX_ESP_HORAS = 16;     // horarios especiales
const unsigned long PASO_MIN_MS = 20;
const unsigned long PASO_MAX_MS = 5000;         // seguridad: ningún paso deja el relé prendido más de 5 s

struct Ovr  { int minuto; int n; unsigned long r[MAX_OVR_PASOS]; };
struct Esp  { long fecha; int n; int horas[MAX_ESP_HORAS]; };

// Todo lo que viene de la página (y se guarda en la memoria del ESP32)
struct Config {
  unsigned long ritmo[MAX_PASOS];
  int  numPasos;
  int  horarios[MAX_HORARIOS];    // minutos desde las 00:00
  int  numHorarios;
  bool dias[7];                   // 0=Dom ... 6=Sáb
  Ovr  ovr[MAX_OVR];
  int  numOvr;
  long off[MAX_OFF];              // AAAAMMDD
  int  numOff;
  Esp  esp[MAX_ESP];
  int  numEsp;
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
const unsigned long* rActual = NULL;   // ritmo que está sonando (apunta dentro de cfg)
int  nActual = 0;
long ultimaClave = -1;            // evita sonar dos veces en el mismo minuto
unsigned long ultimoPrint = 0;

// ----- toques por avisar a la página (los mete loop, los manda el hilo de Internet) -----
struct Evento { uint32_t t; char tipo; };   // tipo: 'P' programado, 'M' manual
Evento cola[4];
int nCola = 0;

void apagarRele()   { pinMode(PIN_RELE, INPUT); }
void encenderRele() { pinMode(PIN_RELE, OUTPUT); digitalWrite(PIN_RELE, LOW); }

bool horaValida(struct tm* t) {
  return getLocalTime(t, 0) && t->tm_year > 120;   // año > 2020
}

void registrarEvento(char tipo) {
  time_t ahora = time(NULL);
  if (ahora < 1600000000) return;                  // sin hora real no avisamos
  xSemaphoreTake(candado, portMAX_DELAY);
  if (nCola < 4) { cola[nCola].t = (uint32_t)ahora; cola[nCola].tipo = tipo; nCola++; }
  xSemaphoreGive(candado);
}

void iniciarRitmo(const unsigned long* r, int n, char tipo) {
  rActual = r;
  nActual = n;
  sonando = true;
  paso = 0;
  inicioPaso = millis();
  encenderRele();                 // el paso 0 siempre es SUENA
  registrarEvento(tipo);
}

void manejarRitmo() {
  if (!sonando) return;
  if (millis() - inicioPaso < rActual[paso]) return;

  paso++;
  if (paso >= nActual) {          // terminó el ritmo
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
  if (prefs.getBytesLength("cfg2") == sizeof(Config)) {
    prefs.getBytes("cfg2", &cfg, sizeof(Config));
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
  prefs.putBytes("cfg2", &cfg, sizeof(Config));
  prefs.end();
}

// ----- lectura de lo que manda la página -----
Config recibida;                   // última config que mandó la página
String ultimoRingId = "";
bool   ringInicializado = false;   // al arrancar NO tocamos por un "tocar ahora" viejo
unsigned long ultimoIntentoOTA = 0;

// Línea n (0,1,2...) de un texto separado por saltos de línea
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

// Siguiente pedazo de `s` separado por `sep`, empezando en `pos`. false cuando ya no hay más.
bool siguiente(const String& s, int& pos, char sep, String& out) {
  if (pos > (int)s.length()) return false;
  int fin = s.indexOf(sep, pos);
  if (fin < 0) fin = s.length();
  out = s.substring(pos, fin);
  out.trim();
  pos = fin + 1;
  return true;
}

// "HH:MM" -> minutos desde las 00:00, o -1 si no es una hora válida
int minutosDe(const String& hhmm) {
  if (hhmm.length() != 5 || hhmm.charAt(2) != ':') return -1;
  int h = hhmm.substring(0, 2).toInt(), m = hhmm.substring(3, 5).toInt();
  if (h < 0 || h > 23 || m < 0 || m > 59) return -1;
  return h * 60 + m;
}

// "220,160,200" -> out[]; devuelve cuántos pasos (o -1 si no es válido: pasos de 20 a 5000 ms, cantidad impar)
int parsearRitmo(const String& txt, unsigned long* out, int maxN) {
  int n = 0, pos = 0;
  String p;
  while (siguiente(txt, pos, ',', p)) {
    long v = p.toInt();
    if (v < (long)PASO_MIN_MS || v > (long)PASO_MAX_MS || n >= maxN) return -1;
    out[n++] = v;
  }
  return (n % 2 == 1) ? n : -1;
}

// "07:00,08:45" -> out[] en minutos
int parsearHoras(const String& txt, int* out, int maxN) {
  int n = 0, pos = 0;
  String p;
  while (siguiente(txt, pos, ',', p) && n < maxN) {
    int m = minutosDe(p);
    if (m >= 0) out[n++] = m;
  }
  return n;
}

// Interpreta las 9 líneas de la página dentro de n (n ya trae lo anterior como base)
void interpretar(const String& cuerpo, Config& n) {
  String p;

  // días
  String dias = linea(cuerpo, 2);
  for (int d = 0; d < 7; d++) n.dias[d] = false;
  for (unsigned int i = 0; i < dias.length(); i++) {
    int d = dias.charAt(i) - '0';
    if (d >= 0 && d <= 6) n.dias[d] = true;
  }

  // horas
  memset(n.horarios, 0, sizeof(n.horarios));
  n.numHorarios = parsearHoras(linea(cuerpo, 3), n.horarios, MAX_HORARIOS);

  // ritmo normal (si viene mal, se conserva el anterior)
  unsigned long r[MAX_PASOS];
  int np = parsearRitmo(linea(cuerpo, 4), r, MAX_PASOS);
  if (np > 0) {
    memset(n.ritmo, 0, sizeof(n.ritmo));
    memcpy(n.ritmo, r, np * sizeof(unsigned long));
    n.numPasos = np;
  } else {
    Serial.println("Ritmo de la página inválido o ausente: conservo el anterior");
  }

  // ritmos por hora: "09:15=300,200,300;15:00=100,100,100"
  memset(n.ovr, 0, sizeof(n.ovr));
  n.numOvr = 0;
  String ov = linea(cuerpo, 5);
  int pos = 0;
  while (siguiente(ov, pos, ';', p) && n.numOvr < MAX_OVR) {
    int eq = p.indexOf('=');
    if (eq < 0) continue;
    int m = minutosDe(p.substring(0, eq));
    unsigned long tmp[MAX_OVR_PASOS];
    int k = parsearRitmo(p.substring(eq + 1), tmp, MAX_OVR_PASOS);
    if (m < 0 || k < 0) continue;
    Ovr& o = n.ovr[n.numOvr++];
    o.minuto = m;
    o.n = k;
    memcpy(o.r, tmp, k * sizeof(unsigned long));
  }

  // días sin timbre: "20261225,20261226"
  memset(n.off, 0, sizeof(n.off));
  n.numOff = 0;
  String of = linea(cuerpo, 6);
  pos = 0;
  while (siguiente(of, pos, ',', p) && n.numOff < MAX_OFF) {
    long f = p.toInt();
    if (f > 20200101L) n.off[n.numOff++] = f;
  }

  // horarios especiales: "20261020=07:00,10:00;20261021=08:00"
  memset(n.esp, 0, sizeof(n.esp));
  n.numEsp = 0;
  String es = linea(cuerpo, 7);
  pos = 0;
  while (siguiente(es, pos, ';', p) && n.numEsp < MAX_ESP) {
    int eq = p.indexOf('=');
    if (eq < 0) continue;
    long f = p.substring(0, eq).toInt();
    if (f <= 20200101L) continue;
    Esp& e = n.esp[n.numEsp++];
    e.fecha = f;
    e.n = parsearHoras(p.substring(eq + 1), e.horas, MAX_ESP_HORAS);
  }
}

// ----- conexión segura -----
int  fallosCert = 0;               // veces seguidas que falló validar el certificado
unsigned long ultimoFalloCert = 0;

void prepararCliente(WiFiClientSecure& cliente) {
  struct tm t;
  // Con hora real se valida el certificado de la página. Si falla 3 veces seguidas
  // (por ejemplo un core viejo sin certificados), usa conexión sin validar y reintenta cada 30 min.
  if (fallosCert >= 3 && millis() - ultimoFalloCert > 1800000UL) fallosCert = 0;
  if (horaValida(&t) && fallosCert < 3) cliente.useBuiltinCACertBundle();
  else cliente.setInsecure();
}

void contarFalloCert(int codigo) {
  if (codigo < 0) {
    if (fallosCert < 3) fallosCert++;
    ultimoFalloCert = millis();
    if (fallosCert == 3) Serial.println("AVISO: no pude validar el certificado HTTPS; uso conexión sin validar");
  } else {
    fallosCert = 0;
  }
}

// ----- firmware nuevo (OTA) -----
bool momentoSeguroOTA() {
  struct tm t;
  if (sonando || !horaValida(&t)) return false;
  return t.tm_sec >= 5 && t.tm_sec <= 25;   // lejos del cambio de minuto, que es cuando suena el timbre
}

// Le pasa a Update lo que baja HTTPClient (writeToStream también entiende respuestas "chunked")
class FlujoOTA : public Stream {
 public:
  size_t write(const uint8_t* b, size_t n) override { return Update.write((uint8_t*)b, n); }
  size_t write(uint8_t c) override { return Update.write(&c, 1); }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
};

void actualizarFirmware(int version, const String& md5, long tam) {
  Serial.printf("Firmware nuevo v%d (actual v%d): descargando %ld bytes...\n", version, FW_VERSION, tam);
  WiFiClientSecure cliente;
  prepararCliente(cliente);
  HTTPClient http;
  http.setTimeout(20000);
  if (!http.begin(cliente, String(FIRMWARE_URL) + "?key=" + DEVICE_KEY)) return;

  int codigo = http.GET();
  contarFalloCert(codigo);
  long len = http.getSize();                       // -1 si viene en trozos
  if (codigo != 200 || (len > 0 && len != tam) || tam <= 0 || !Update.begin(tam)) {
    Serial.printf("OTA cancelada (HTTP %d, tamaño %ld)\n", codigo, len);
    http.end();
    return;
  }
  Update.setMD5(md5.c_str());
  FlujoOTA flujo;
  int escritos = http.writeToStream(&flujo);
  http.end();

  if (escritos == tam && Update.end()) {           // end() revisa tamaño y MD5
    Serial.println("Firmware actualizado. Reiniciando...");
    delay(300);
    ESP.restart();
  }
  Serial.printf("OTA falló (%s). Sigo con el firmware actual\n", Update.errorString());
  Update.abort();
}

String redesTexto = "";

String deHex(const String& h) {
  String s;
  for (int i = 0; i + 1 < (int)h.length(); i += 2) s += (char)strtol(h.substring(i, i + 2).c_str(), NULL, 16);
  return s;
}

void cargarRedes() {
  prefs.begin("timbre", true);
  redesTexto = prefs.getString("redes", "");
  prefs.end();
}

void guardarRedes(const String& r) {
  if (r == redesTexto) return;
  prefs.begin("timbre", false);
  prefs.putString("redes", r);
  prefs.end();
  redesTexto = r;
  Serial.println("La página mandó redes WiFi nuevas: guardadas");
}

// ----- consulta a la página -----
void consultarServidor() {
  static unsigned long vez = 0;
  static Config n;                         // static: no cabe cómodo en la pila del hilo
  WiFiClientSecure cliente;
  prepararCliente(cliente);
  HTTPClient http;
  http.setTimeout(6000);

  // cada 6ta consulta avisa "aquí estoy" (versión, señal y hora) para el panel
  String url = String(SERVER_URL) + "?key=" + DEVICE_KEY;
  if (vez++ % 6 == 0) url += "&s=1&v=" + String(FW_VERSION) + "&rs=" + String(WiFi.RSSI()) + "&t=" + String((unsigned long)time(NULL));

  // toques que aún no se han avisado
  int enviados = 0;
  xSemaphoreTake(candado, portMAX_DELAY);
  String ev = "";
  for (int i = 0; i < nCola; i++) ev += (i ? "," : "") + String(cola[i].t) + ":" + String(cola[i].tipo);
  enviados = nCola;
  xSemaphoreGive(candado);
  if (enviados > 0) url += "&ev=" + ev;

  if (!http.begin(cliente, url)) return;
  int codigo = http.GET();
  contarFalloCert(codigo);
  if (codigo != 200) {
    Serial.printf("Página respondió %d (sigo con la última config)\n", codigo);
    http.end();
    return;
  }
  String cuerpo = http.getString();
  http.end();
  cuerpo.replace("\r", "");

  String ringId = linea(cuerpo, 0);
  if (ringId.length() == 0) return;        // respuesta rara: la ignoramos

  // la página ya recibió los toques: los quitamos de la cola
  if (enviados > 0) {
    xSemaphoreTake(candado, portMAX_DELAY);
    int resto = nCola - enviados;
    for (int i = 0; i < resto; i++) cola[i] = cola[i + enviados];
    nCola = resto > 0 ? resto : 0;
    xSemaphoreGive(candado);
  }

  memcpy(&n, &recibida, sizeof(Config));
  interpretar(cuerpo, n);
  if (memcmp(&n, &recibida, sizeof(Config)) != 0) {
    memcpy(&recibida, &n, sizeof(Config));
    xSemaphoreTake(candado, portMAX_DELAY);
    memcpy(&nueva, &n, sizeof(Config));
    hayNueva = true;
    xSemaphoreGive(candado);
    Serial.println("La página mandó cambios (ritmo/horas/días/excepciones)");
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

  int lineas = 1;
  for (char c : cuerpo) if (c == '\n') lineas++;
  if (lineas >= 10) guardarRedes(linea(cuerpo, 9));

  // firmware nuevo: "versión|md5|bytes"
  String fw = linea(cuerpo, 8);
  int b1 = fw.indexOf('|'), b2 = fw.indexOf('|', b1 + 1);
  if (b1 > 0 && b2 > b1) {
    int version = fw.substring(0, b1).toInt();
    if (version > FW_VERSION && momentoSeguroOTA() && millis() - ultimoIntentoOTA > 600000UL) {
      ultimoIntentoOTA = millis();             // si falla, reintenta en 10 minutos
      actualizarFirmware(version, fw.substring(b1 + 1, b2), fw.substring(b2 + 1).toInt());
    }
  }
}

// Cada cuánto preguntar: seguido en horario escolar, espaciado de noche y fines de semana
unsigned long intervaloConsulta() {
  struct tm t;
  if (!horaValida(&t)) return INTERVALO_ESCOLAR_MS;
  bool escolar = t.tm_wday >= 1 && t.tm_wday <= 5 && t.tm_hour >= 6 && t.tm_hour < 17;
  return escolar ? INTERVALO_ESCOLAR_MS : INTERVALO_LENTO_MS;
}

void tareaInternet(void*) {
  WiFiMulti* wifiMulti = nullptr;
  String usadas = "-";

  for (;;) {
    if (redesTexto != usadas) {
      usadas = redesTexto;
      delete wifiMulti;
      wifiMulti = new WiFiMulti();
      for (auto& red : REDES) wifiMulti->addAP(red[0], red[1]);
      int pos = 0, total = 0;
      String par;
      while (siguiente(usadas, pos, ',', par)) {
        int dp = par.indexOf(':');
        if (dp <= 0) continue;
        String ssid = deHex(par.substring(0, dp)), clave = deHex(par.substring(dp + 1));
        wifiMulti->addAP(ssid.c_str(), clave.length() ? clave.c_str() : NULL);
        total++;
      }
      Serial.printf("Redes WiFi: %d de secretos.h + %d de la página\n", (int)(sizeof(REDES) / sizeof(REDES[0])), total);
    }
    if (wifiMulti->run(8000, true) == WL_CONNECTED) {   // true = también prueba redes ocultas
      static bool avisado = false;
      if (!avisado) { avisado = true; Serial.print("WiFi conectado, IP: "); Serial.println(WiFi.localIP()); }
      consultarServidor();
    } else {
      Serial.println("Buscando WiFi...");
    }
    vTaskDelay(intervaloConsulta() / portTICK_PERIOD_MS);
  }
}

// ----- horarios -----
// Ritmo de una hora: el propio de esa hora si tiene, si no el normal
void ritmoDeLaHora(int minuto, const unsigned long** r, int* n) {
  for (int i = 0; i < cfg.numOvr; i++) {
    if (cfg.ovr[i].minuto == minuto) { *r = cfg.ovr[i].r; *n = cfg.ovr[i].n; return; }
  }
  *r = cfg.ritmo;
  *n = cfg.numPasos;
}

void revisarHorarios() {
  struct tm t;
  if (!horaValida(&t)) return;

  int minutosAhora = t.tm_hour * 60 + t.tm_min;
  long clave = (long)t.tm_yday * 1440L + minutosAhora;    // único por día y minuto
  if (clave == ultimaClave) return;

  long fecha = (t.tm_year + 1900) * 10000L + (t.tm_mon + 1) * 100L + t.tm_mday;
  for (int i = 0; i < cfg.numOff; i++) if (cfg.off[i] == fecha) return;   // día sin timbre

  // horario especial de hoy (manda sobre los días de la semana); si no, el normal
  const int* horas = cfg.horarios;
  int n = cfg.numHorarios;
  bool especial = false;
  for (int i = 0; i < cfg.numEsp; i++) {
    if (cfg.esp[i].fecha == fecha) { horas = cfg.esp[i].horas; n = cfg.esp[i].n; especial = true; break; }
  }
  if (!especial && !cfg.dias[t.tm_wday]) return;

  for (int i = 0; i < n; i++) {
    if (horas[i] == minutosAhora) {
      ultimaClave = clave;
      if (!sonando) {
        const unsigned long* r; int np;
        ritmoDeLaHora(minutosAhora, &r, &np);
        iniciarRitmo(r, np, 'P');
      }
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
  cargarRedes();
  memcpy(&recibida, &cfg, sizeof(Config));

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  configTzTime("CST6", "pool.ntp.org", "time.google.com");   // Oaxaca: UTC-6, sin horario de verano

  xTaskCreatePinnedToCore(tareaInternet, "internet", 16384, NULL, 1, NULL, 0);
  Serial.printf("Timbre listo (firmware v%d). Conectando a WiFi y buscando la hora...\n", FW_VERSION);
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
    if (!sonando) iniciarRitmo(cfg.ritmo, cfg.numPasos, 'M');
  }

  manejarRitmo();
  revisarHorarios();

  if (millis() - ultimoPrint >= 10000) {
    ultimoPrint = millis();
    struct tm t;
    if (horaValida(&t)) Serial.printf("Hora: %02d:%02d:%02d\n", t.tm_hour, t.tm_min, t.tm_sec);
    else Serial.println("Esperando hora de internet...");
  }

  delay(5);
}
