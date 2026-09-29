/*
  ================================================================
  TIMBRE ESCOLAR - CECyTE Plantel 18  (ESP32 + Módulo Relé)
  ================================================================
  Qué hace:
   - Se conecta a tu WiFi y saca la hora real por Internet (NTP).
   - Cada 10 segundos le pregunta a tu página (Vercel) las horas del
     timbre y si en el panel de Admin le dieron "Tocar timbre ahora".
   - Toca el timbre (relé) en las horas programadas y cuando se lo
     pidas desde la página. Todo se edita desde el panel de Admin,
     NO hay que volver a programar el ESP32.
   - Si se cae el Internet, sigue tocando con las últimas horas que
     recibió (la hora sigue corriendo sola en el ESP32).

  CONEXIONES:
    ESP32 GND   -> GND del módulo relé
    ESP32 5V    -> VCC del módulo relé
    ESP32 GPIO2 -> IN (señal) del módulo relé
    Lado AC del relé: Corriente -> C, Timbre -> NO

  ANTES DE SUBIRLO cambia SOLO WIFI_SSID y WIFI_PASSWORD.
  (La direccion de tu sitio y la llave ya estan puestas.)

  Relé: si el timbre suena al revés (prendido todo el tiempo salvo
  cuando debería sonar), cambia RELAY_ACTIVO_EN_BAJO a false.
  ================================================================
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>
#include <Preferences.h>

// ---------- CONFIGURACIÓN ----------
// >>> LO UNICO QUE TIENES QUE CAMBIAR: tu WiFi (entre las comillas) <<<
const char* WIFI_SSID     = "NOMBRE_DE_TU_WIFI";
const char* WIFI_PASSWORD = "CONTRASENA_DE_TU_WIFI";

// Lo de abajo YA esta listo, no lo toques:
const char* SERVER_URL = "https://cecyteo.vercel.app/api/bell";
const char* DEVICE_KEY = "65f3fde588876a90ed6d2f09511dfecfa891cdce6d6cb7d5";

const int  PIN_RELE = 2;                  // GPIO02 -> IN del relé
const bool RELAY_ACTIVO_EN_BAJO = true;   // true = el módulo se activa con LOW (lo más común)

const unsigned long INTERVALO_CONSULTA_MS = 10000; // cada cuánto pregunta al servidor

// Hora de México central (UTC-6, sin horario de verano)
const long GMT_OFFSET_SEG = -6 * 3600;
const int  DST_OFFSET_SEG = 0;
// ------------------------------------

const int MAX_HORARIOS = 40;

// Valores de respaldo (los mismos de antes) por si el servidor no responde al arrancar
int  horarios[MAX_HORARIOS] = {420, 480, 525, 555, 600, 660, 720, 780, 840, 900}; // minutos desde 00:00
int  numHorarios = 10;
bool diasActivos[7] = {false, true, true, true, true, true, false};          // 0=Dom ... 6=Sáb
unsigned long duracionMs = 5000;

Preferences prefs; // memoria permanente del ESP32 (sobrevive a apagones)

String ultimoRingId = "";        // último "tocar ahora" ya atendido
bool   ringIdInicializado = false; // al arrancar NO tocamos por un ringId viejo

bool releActivo = false;
unsigned long releEncendidoDesde = 0;
long ultimaClaveSonada = -1;     // evita sonar dos veces en el mismo minuto
unsigned long ultimaConsulta = 0;

void activarRele() {
  digitalWrite(PIN_RELE, RELAY_ACTIVO_EN_BAJO ? LOW : HIGH);
  releActivo = true;
  releEncendidoDesde = millis();
  Serial.println("Timbre ACTIVADO");
}

void apagarRele() {
  digitalWrite(PIN_RELE, RELAY_ACTIVO_EN_BAJO ? HIGH : LOW);
  releActivo = false;
  Serial.println("Timbre apagado");
}

// Guarda las horas en la memoria del ESP32 para que un apagon no las borre
void guardarConfig() {
  prefs.begin("timbre", false);
  prefs.putUChar("n", numHorarios);
  if (numHorarios > 0) prefs.putBytes("horas", horarios, numHorarios * sizeof(int));
  uint8_t mascara = 0;
  for (int i = 0; i < 7; i++) if (diasActivos[i]) mascara |= (1 << i);
  prefs.putUChar("dias", mascara);
  prefs.putUShort("dur", (uint16_t)(duracionMs / 1000));
  prefs.end();
}

// Al arrancar, recupera lo ultimo que se guardo (si hay algo guardado)
void cargarConfig() {
  prefs.begin("timbre", false);
  if (prefs.isKey("n")) {
    int n = prefs.getUChar("n", 0);
    if (n <= MAX_HORARIOS) {
      numHorarios = n;
      if (n > 0) prefs.getBytes("horas", horarios, n * sizeof(int));
    }
    uint8_t mascara = prefs.getUChar("dias", 0);
    for (int i = 0; i < 7; i++) diasActivos[i] = (mascara >> i) & 1;
    uint16_t seg = prefs.getUShort("dur", 5);
    if (seg >= 1 && seg <= 30) duracionMs = seg * 1000UL;
    Serial.printf("Horario recuperado de la memoria: %d horas\n", numHorarios);
  } else {
    Serial.println("Sin horario guardado todavia: uso el de fabrica");
  }
  prefs.end();
}

void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("Conectando a WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 15000) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(" conectado! IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println(" no se pudo (reintento después)");
  }
}

// Convierte "07:00,08:45,..." en el arreglo de minutos
void parsearHoras(String linea) {
  int n = 0;
  int inicio = 0;
  while (inicio < (int)linea.length() && n < MAX_HORARIOS) {
    int coma = linea.indexOf(',', inicio);
    if (coma == -1) coma = linea.length();
    String hhmm = linea.substring(inicio, coma);
    hhmm.trim();
    if (hhmm.length() == 5 && hhmm.charAt(2) == ':') {
      horarios[n++] = hhmm.substring(0, 2).toInt() * 60 + hhmm.substring(3, 5).toInt();
    }
    inicio = coma + 1;
  }
  numHorarios = n;
}

// Pregunta al servidor: id de "tocar ahora", duración, días y horas
void consultarServidor() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure cliente;
  cliente.setInsecure(); // no validamos certificado (suficiente para este uso)
  HTTPClient http;
  http.setTimeout(4000);

  String url = String(SERVER_URL) + "?key=" + DEVICE_KEY;
  if (!http.begin(cliente, url)) return;

  int codigo = http.GET();
  if (codigo == 200) {
    String cuerpo = http.getString();
    cuerpo.replace("\r", "");

    int p1 = cuerpo.indexOf('\n');
    int p2 = cuerpo.indexOf('\n', p1 + 1);
    int p3 = cuerpo.indexOf('\n', p2 + 1);
    if (p1 > 0 && p2 > p1 && p3 > p2) {
      String ringId   = cuerpo.substring(0, p1);
      int    segundos = cuerpo.substring(p1 + 1, p2).toInt();
      String dias     = cuerpo.substring(p2 + 1, p3);
      String horas    = cuerpo.substring(p3 + 1);

      // Copia de lo anterior, para saber si algo cambio y solo entonces guardar
      int  viejoN = numHorarios;
      int  viejasHoras[MAX_HORARIOS];
      bool viejosDias[7];
      memcpy(viejasHoras, horarios, sizeof(horarios));
      memcpy(viejosDias, diasActivos, sizeof(diasActivos));
      unsigned long viejaDur = duracionMs;

      if (segundos >= 1 && segundos <= 30) duracionMs = segundos * 1000UL;

      for (int i = 0; i < 7; i++) diasActivos[i] = false;
      for (unsigned int i = 0; i < dias.length(); i++) {
        int d = dias.charAt(i) - '0';
        if (d >= 0 && d <= 6) diasActivos[d] = true;
      }

      parsearHoras(horas);

      bool cambio = (viejoN != numHorarios) || (viejaDur != duracionMs) ||
                    memcmp(viejosDias, diasActivos, sizeof(diasActivos)) != 0 ||
                    memcmp(viejasHoras, horarios, numHorarios * sizeof(int)) != 0;
      if (cambio) {
        guardarConfig();
        Serial.println("Horario nuevo guardado en la memoria del ESP32");
      }

      // "Tocar ahora": solo si el id cambió desde la última vez que lo vimos
      if (!ringIdInicializado) {
        ultimoRingId = ringId;          // primera lectura tras arrancar: solo memorizamos
        ringIdInicializado = true;
      } else if (ringId != ultimoRingId) {
        ultimoRingId = ringId;
        Serial.println("Orden manual desde la página: tocar timbre");
        activarRele();
      }

      Serial.printf("Config OK: %d horas, %lu s\n", numHorarios, duracionMs / 1000);
    }
  } else {
    Serial.printf("Servidor respondió %d (sigo con la última config)\n", codigo);
  }
  http.end();
}

void revisarHorarios() {
  struct tm t;
  if (!getLocalTime(&t, 0)) return;

  if (!diasActivos[t.tm_wday]) return;

  int minutosAhora = t.tm_hour * 60 + t.tm_min;
  long clave = (long)t.tm_yday * 1440L + minutosAhora; // único por día y minuto

  for (int i = 0; i < numHorarios; i++) {
    if (horarios[i] == minutosAhora && clave != ultimaClaveSonada) {
      ultimaClaveSonada = clave;
      Serial.printf("Hora programada %02d:%02d\n", t.tm_hour, t.tm_min);
      activarRele();
      break;
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_RELE, OUTPUT);
  apagarRele();

  cargarConfig(); // usa las horas guardadas, aunque no haya internet

  conectarWiFi();

  configTime(GMT_OFFSET_SEG, DST_OFFSET_SEG, "pool.ntp.org", "time.google.com");
  Serial.println("Esperando hora de Internet...");
  struct tm t;
  int intentos = 0;
  while (!getLocalTime(&t) && intentos < 20) {
    delay(1000);
    intentos++;
  }
  if (intentos < 20) Serial.println(&t, "Hora lista: %A %d/%m/%Y %H:%M:%S");

  consultarServidor();
  ultimaConsulta = millis();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long ultimoIntentoWiFi = 0;
    if (millis() - ultimoIntentoWiFi > 15000) {
      ultimoIntentoWiFi = millis();
      WiFi.disconnect();
      conectarWiFi();
    }
  }

  if (millis() - ultimaConsulta >= INTERVALO_CONSULTA_MS) {
    ultimaConsulta = millis();
    consultarServidor();
  }

  revisarHorarios();

  if (releActivo && millis() - releEncendidoDesde >= duracionMs) {
    apagarRele();
  }

  delay(100);
}
