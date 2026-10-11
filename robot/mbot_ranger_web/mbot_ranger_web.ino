/*
  mBot Ranger (Me Auriga) con control desde la página del CECyTE (Web Serial)

  Es el sketch "tanquecito" de siempre (modos con el botón de la placa) más un puerto
  serie de texto, para que la página le mande notas, colores y movimientos en vivo.

  Modos (botón de la placa):
    0 = Reposo (LEDs azules)         1 = Esquivar obstáculos (verde)
    2 = Seguir objeto con la mano (amarillo)   3 = Test de motores (rojo)
    4 = Página (la manda la web; el botón vuelve a 0)

  Órdenes por USB, 115200 baudios, una por línea. Cada una responde OK, ERR ... o PONG:
    PING             -> PONG mbot-web 1
    T hz ms          suena una nota (hz 40..8000, ms 1..5000)
    W ms             espera sin sonar (0..5000)
    M izq der        motores -180..180 (positivo = adelante); toma el control (modo 4)
    S                para los motores
    L i r g b        un LED (i = 1..12) o todos (i = 0)
    LS <72 hex>      los 12 LEDs de golpe: RRGGBB x 12
    FX m b <72 hex>  efecto de luces que corre solo en el robot, también mientras suena una nota:
                     m = 0 fijo, 1 arcoíris, 2 respirar, 3 persecución, 4 color por nota;
                     b = brillo 0..100; los 12 colores base van en hex como en LS
    SAVE             guarda el último FX en la EEPROM: al encender, el robot lo vuelve a poner
    PCLR             empieza a guardar un show nuevo (borra el anterior)
    PADD T hz ms     añade al show una nota; también PADD W ms, PADD M izq der y PADD S
    PEND f           termina el show; f: 1 = arranca solo al encender, 2 = se repite (3 = las dos)
    MODE n           cambia de modo (0..5; 5 = el show guardado, solo, sin la página)
    BAT              responde "BAT 7.42" (voltaje de la batería)
    DIAG0            borra los contadores de diagnóstico que el robot dice al encender (INFO ...)
    !                un solo byte, sin salto de línea: paro de emergencia. Corta la nota,
                     frena los motores y borra lo pendiente. Responde ABORTED.
  Avisos sueltos: "BTN n" (se cambió de modo con el botón) y "WDT" (los motores se pararon
  solos porque en modo 4 pasaron 3 s sin órdenes).

  Arduino IDE:
    Placa:  Arduino Mega or Mega 2560
    Librería: Makeblock-Libraries (MeAuriga.h)
*/

#include <MeAuriga.h>
#include <EEPROM.h>
#include <math.h>

MeEncoderOnBoard motorIzq(SLOT1);
MeEncoderOnBoard motorDer(SLOT2);
MeUltrasonicSensor ultrasonico(PORT_10);
MeRGBLed leds(0, 12);
MeBuzzer buzzer;

const int VEL = 120;                 // 0 a 255, para los modos del botón
const int VEL_MAX = 180;             // tope de lo que puede pedir la página
const int DIST_OBSTACULO = 20;       // cm
const int PIN_BUZZER = 45;
const int PIN_LEDS = 44;
const int AJUSTE_US = 4;             // lo que tarda un digitalWrite; si las notas salen bajas, súbelo
const int MODO_WEB = 4;
const int MODO_SHOW = 5;             // el show guardado en la EEPROM: suena y baila solo
const unsigned long SIN_ORDENES_MS = 3000;

// Show guardado: cabecera de 4 bytes en la EEPROM y luego las órdenes, una detrás de otra:
//   1 hz(2) ms(2) = nota   2 ms(2) = espera   3 izq/2 der/2 = motores   4 = parar
const int PGM_DIR = 100;
const int PGM_MAX = 2800;
const uint8_t PGM_MAGICO = 0xB5;
int pgmFin = 0;                      // bytes que lleva la subida en curso
unsigned long showT0 = 0;            // el show espera a esta hora (para dejarlo en el piso)

int modo = 0;
bool moviendo = false;
unsigned long ultimoBoton = 0;
unsigned long ultimaOrden = 0;

// Efecto de luces (orden FX). Un cuadro nuevo cada FX_MS, y solo si pasaron FX_QUIETO_MS desde la
// última orden terminada: dibujar el anillo apaga las interrupciones unos 0,4 ms y en ese rato el
// USB podría perder bytes, pero la página no manda nada mientras espera el OK.
const unsigned long FX_MS = 60;
const unsigned long FX_QUIETO_MS = 40;
uint8_t fxModo = 0;                  // 0 fijo, 1 arcoíris, 2 respirar, 3 persecución, 4 color por nota
uint8_t fxBrillo = 40;               // 0..100
uint8_t fxBase[12][3];               // colores base de cada LED
uint8_t fxMatiz = 0;                 // modo 4: color de la última nota
bool fxHayNota = false;
bool fxSucio = false;                // modo 4: hay un color nuevo por dibujar
unsigned long fxUltimo = 0;

// ---------- Interrupciones de los encoders ----------
void isrIzq(void) {
  if (digitalRead(motorIzq.getPortB()) == 0) motorIzq.pulsePosMinus();
  else motorIzq.pulsePosPlus();
}
void isrDer(void) {
  if (digitalRead(motorDer.getPortB()) == 0) motorDer.pulsePosMinus();
  else motorDer.pulsePosPlus();
}

// ---------- Movimiento ----------
// Voltaje de la batería (A4 mide un tercio, como en el firmware de fábrica)
float bateria() { return analogRead(A4) / 1024.0 * 15.0; }

// Diagnóstico que sobrevive a un reinicio (EEPROM, 0xFF = vacío; la página lo muestra al conectar).
// El bootloader de esta placa borra MCUSR antes de arrancar el sketch, así que no se puede saber por
// qué se reinició; en su lugar se cuenta: BOOT = arranques (conectar por USB cuenta uno), BTN = veces
// que el botón cambió de modo, RUN = pasadas del show, MIN = voltaje más bajo con las ruedas andando (x10).
const int EE_BOOT = 2980, EE_BTN = 2981, EE_RUN = 2982, EE_MIN = 2983;
uint8_t cuentaEE(int dir) { uint8_t v = EEPROM.read(dir); return v == 0xFF ? 0 : v; }
void sumaEE(int dir) { uint8_t v = cuentaEE(dir); if (v < 254) EEPROM.update(dir, v + 1); }
void notaBateria() {
  uint8_t d = (uint8_t)constrain(bateria() * 10.0, 0, 254);
  uint8_t m = EEPROM.read(EE_MIN);
  if (m == 0xFF || d < m) EEPROM.update(EE_MIN, d);
}

// izq y der: positivo = esa rueda va hacia adelante.
// Las ruedas suben en rampa (30 de PWM cada 12 ms): pedirle de golpe toda la corriente a la batería
// hunde el voltaje y la placa se puede reiniciar. Parar, en cambio, es inmediato.
// motores() solo fija el objetivo; la rampa avanza dentro de drenar(), que corre en toda espera y en
// todo tono, así no se frena la música.
int izqAct = 0, derAct = 0, izqObj = 0, derObj = 0;
unsigned long rampaT = 0, bateriaT = 0;
void rampa() {
  unsigned long t = millis();
  if (moviendo && t - bateriaT > 50) { bateriaT = t; notaBateria(); }
  if ((izqAct == izqObj && derAct == derObj) || t - rampaT < 12) return;
  rampaT = t;
  izqAct += constrain(izqObj - izqAct, -30, 30);
  derAct += constrain(derObj - derAct, -30, 30);
  motorIzq.setMotorPwm(-izqAct);
  motorDer.setMotorPwm(derAct);
}
void motores(int izq, int der) {
  izqObj = izq;
  derObj = der;
  moviendo = (izq != 0 || der != 0);
  rampa();
}
void adelante(int v)   { motores(v, v); }
void atras(int v)      { motores(-v, -v); }
void giraIzq(int v)    { motores(-v, v); }
void giraDer(int v)    { motores(v, -v); }
void parar() {
  izqAct = derAct = izqObj = derObj = 0;
  motorIzq.setMotorPwm(0);
  motorDer.setMotorPwm(0);
  moviendo = false;
}

// ---------- LEDs ----------
void color(int r, int g, int b) {
  leds.setColor(0, r, g, b);
  leds.show();
}

void aplicaModo() {
  parar();
  if (modo < MODO_WEB) fxModo = 0;     // los colores de los modos mandan sobre el efecto
  switch (modo) {
    case 0: color(0, 0, 40);   break;
    case 1: color(0, 40, 0);   break;
    case 2: color(40, 30, 0);  break;
    case 3: color(40, 0, 0);   break;
  }
  if (modo < MODO_WEB) buzzer.tone(500 + modo * 200, 120);
}

// ---------- Modos del botón ----------
void esquivar() {
  int d = ultrasonico.distanceCm();
  if (d > DIST_OBSTACULO) {
    adelante(VEL);
  } else {
    parar();
    espera(100);
    atras(VEL);
    espera(400);
    if (random(2) == 0) giraIzq(VEL); else giraDer(VEL);
    espera(random(350, 700));
    parar();
  }
}

void seguir() {
  int d = ultrasonico.distanceCm();
  if (d > 12 && d < 40)      adelante(VEL);
  else if (d <= 8)           atras(VEL);
  else                       parar();
}

void testMotores() {
  // Cada motor por separado, para ver cuál no responde
  motores(150, 0);  espera(800); parar(); espera(400);
  motores(0, 150);  espera(800); parar(); espera(400);
  adelante(150);    espera(800); parar(); espera(400);
  atras(150);       espera(800); parar(); espera(400);
  giraIzq(150);     espera(600); parar(); espera(400);
  giraDer(150);     espera(600); parar();
  modo = 0;         // al terminar vuelve a reposo
  aplicaModo();
}

// ---------- Botón de la placa ----------
bool botonPresionado() {
  return analogRead(A7) < 100;
}

// Cuenta solo el instante de pulsar, y solo si el botón se vio suelto al menos una vez desde que
// enciende. Así un botón que lee "presionado" siempre (placa sin batería, botón atorado) no cambia
// de modo ni echa a andar los motores solo.
// Además es estricto con el ruido: "suelto" solo cuenta si la lectura es claramente alta (> 500) y
// "presionado" solo si se mantiene baja (< 60) durante 60 ms; los valores de en medio no cuentan.
bool botonLiberado = false;
bool botonAntes = false;
unsigned long botonBajoDesde = 0;
bool botonFlanco() {
  int v = analogRead(A7);
  unsigned long t = millis();
  if (v > 500) {
    botonLiberado = true;
    botonBajoDesde = 0;
  } else if (v < 60) {
    if (botonBajoDesde == 0) botonBajoDesde = t;
  } else {
    botonBajoDesde = 0;
  }
  bool ahora = botonBajoDesde != 0 && (t - botonBajoDesde) >= 60;
  bool pulso = ahora && !botonAntes && botonLiberado;
  botonAntes = ahora;
  return pulso;
}

// Una pulsación de verdad sigue baja un rato; el ruido de los motores o un cable flojo, no. Tras el
// flanco se exige que siga baja 150 ms seguidos (atendiendo el USB mientras tanto).
bool botonSostenido() {
  unsigned long t0 = millis();
  while (millis() - t0 < 150) {
    if (analogRead(A7) >= 60) return false;
    drenar();
  }
  return true;
}

// ---------- USB: cola de bytes ----------
// Todo lo que llega se guarda aquí, también mientras suena una nota, y un "!" corta todo.
const int RING = 256;
char cola[RING];
int colaIni = 0, colaFin = 0, colaN = 0;
bool abortar = false;

void drenar() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '!') {
      abortar = true;
      colaIni = colaFin = colaN = 0;
    } else if (colaN < RING) {
      cola[colaFin] = c;
      colaFin = (colaFin + 1) % RING;
      colaN++;
    }
  }
  if (!abortar) rampa();                     // drenar() corre en toda espera: de aquí avanza la rampa
}

// ---------- Sonido y esperas (revisan el USB y el paro mientras pasan) ----------
void tono(int hz, int ms) {
  long periodo = 1000000L / hz;                       // µs
  long medio = periodo / 2 - AJUSTE_US;
  if (medio < 1) medio = 1;
  unsigned long fin = micros() + (unsigned long)ms * 1000UL;
  unsigned long ultimoDrenaje = micros();
  pinMode(PIN_BUZZER, OUTPUT);
  while (!abortar && !(modo == MODO_SHOW && colaN > 0) && (long)(fin - micros()) > 0) {
    digitalWrite(PIN_BUZZER, HIGH);
    delayMicroseconds(medio);
    digitalWrite(PIN_BUZZER, LOW);
    delayMicroseconds(medio);
    if (micros() - ultimoDrenaje > 4000UL) {
      drenar();
      fxPaso();
      ultimoDrenaje = micros();
    }
  }
}

void espera(unsigned long ms) {
  unsigned long fin = millis() + ms;
  while (!abortar && !(modo == MODO_SHOW && colaN > 0) && (long)(fin - millis()) > 0) {
    drenar();
    fxPaso();
  }
}

// ---------- LEDs desde la página ----------
int nibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

bool ledsHex(const char *h) {
  uint8_t v[36];
  for (int i = 0; i < 36; i++) {
    int hi = nibble(h[2 * i]), lo = nibble(h[2 * i + 1]);
    if (hi < 0 || lo < 0) return false;
    v[i] = hi * 16 + lo;
  }
  for (int i = 0; i < 12; i++) leds.setColorAt(i, v[3 * i], v[3 * i + 1], v[3 * i + 2]);
  leds.show();
  return true;
}

// ---------- Efectos de luces (corren solos, también mientras suena una nota) ----------
void hsvFx(uint8_t h, uint8_t &r, uint8_t &g, uint8_t &b) {   // matiz 0..255, color puro
  uint8_t region = h / 43;
  uint8_t sube = (h - region * 43) * 6;
  uint8_t baja = 255 - sube;
  switch (region) {
    case 0:  r = 255;  g = sube; b = 0;    break;
    case 1:  r = baja; g = 255;  b = 0;    break;
    case 2:  r = 0;    g = 255;  b = sube; break;
    case 3:  r = 0;    g = baja; b = 255;  break;
    case 4:  r = sube; g = 0;    b = 255;  break;
    default: r = 255;  g = 0;    b = baja; break;
  }
}

// La misma nota da el mismo color en cualquier octava
uint8_t fxMatizDe(int hz) {
  float s = 12.0 * log(hz / 261.63) / 0.693147;
  s = s - 12.0 * floor(s / 12.0);
  return (uint8_t)(s * 255.0 / 12.0);
}

bool fxCarga(const char *h) {
  for (int i = 0; i < 36; i++) {
    int hi = nibble(h[2 * i]), lo = nibble(h[2 * i + 1]);
    if (hi < 0 || lo < 0) return false;
    fxBase[i / 3][i % 3] = hi * 16 + lo;
  }
  return true;
}

void fxDibuja() {
  unsigned long t = millis();
  for (int i = 0; i < 12; i++) {
    uint8_t r = fxBase[i][0], g = fxBase[i][1], b = fxBase[i][2];
    uint8_t k = 255;
    switch (fxModo) {
      case 1:                                              // arcoíris: una vuelta cada 4 s
        hsvFx((uint8_t)((i * 256) / 12 + t / 16), r, g, b);
        break;
      case 2: {                                            // respirar: sube y baja cada 2,4 s
        unsigned long p = t % 2400UL;
        unsigned long tri = p < 1200UL ? p : 2400UL - p;
        k = 51 + (uint8_t)(204UL * tri / 1200UL);
      } break;
      case 3: {                                            // persecución: una cola de 5 LEDs
        int d = ((int)((t / 90UL) % 12UL) - i + 12) % 12;
        k = d < 5 ? 255 - d * 51 : 10;
      } break;
      case 4:                                              // color por nota
        if (fxHayNota) hsvFx(fxMatiz, r, g, b);
        break;
    }
    // con las ruedas andando el anillo baja a la mitad: así le queda más corriente a los motores
    uint32_t esc = (uint32_t)k * (moviendo ? fxBrillo / 2 : fxBrillo);   // k 0..255 por brillo 0..100
    leds.setColorAt(i, (uint32_t)r * esc / 25500UL, (uint32_t)g * esc / 25500UL, (uint32_t)b * esc / 25500UL);
  }
  leds.show();
}

void fxPaso() {
  if (fxModo == 0) return;                                 // fijo: nada que animar
  unsigned long t = millis();
  if (t - fxUltimo < FX_MS || t - ultimaOrden < FX_QUIETO_MS) return;
  if (fxModo == 4) {                                       // solo cuando hay un color nuevo
    if (!fxSucio) return;
    fxSucio = false;
  }
  fxUltimo = t;
  fxDibuja();
}

// ---------- Guardar el efecto: al encender, el robot lo vuelve a poner ----------
const int EE_DIR = 3000;
const uint8_t EE_MAGICO = 0xA7;

void fxGuardar() {
  EEPROM.update(EE_DIR, EE_MAGICO);
  EEPROM.update(EE_DIR + 1, fxModo);
  EEPROM.update(EE_DIR + 2, fxBrillo);
  for (int i = 0; i < 36; i++) EEPROM.update(EE_DIR + 3 + i, fxBase[i / 3][i % 3]);
}

void fxRestaurar() {
  if (EEPROM.read(EE_DIR) != EE_MAGICO) return;
  uint8_t m = EEPROM.read(EE_DIR + 1), b = EEPROM.read(EE_DIR + 2);
  if (m > 4 || b > 100) return;
  for (int i = 0; i < 36; i++) fxBase[i / 3][i % 3] = EEPROM.read(EE_DIR + 3 + i);
  fxModo = m;
  fxBrillo = b;
  fxHayNota = false;
  fxDibuja();
  Serial.print(F("FX guardado: modo "));
  Serial.println(m);
}

// ---------- Show guardado: canta y baila solo, sin la página ----------
bool pgmValido()      { return EEPROM.read(PGM_DIR) == PGM_MAGICO && pgmLargo() > 0; }
uint8_t pgmBanderas() { return EEPROM.read(PGM_DIR + 1); }
int pgmLargo()        { return EEPROM.read(PGM_DIR + 2) | (EEPROM.read(PGM_DIR + 3) << 8); }

bool pgmPon(uint8_t b) {                     // un byte más de la subida
  if (pgmFin >= PGM_MAX) return false;
  EEPROM.update(PGM_DIR + 4 + pgmFin++, b);
  drenar();                                  // cada escritura tarda ~3 ms: que el USB no se llene
  return true;
}

// La página (o el botón de la placa) cortan el show: llegan bytes por USB, un "!" o se pulsa el botón.
bool showCortar() {
  drenar();
  if (abortar || colaN > 0) return true;
  if (botonFlanco() && botonSostenido()) {
    ultimoBoton = millis();
    sumaEE(EE_BTN);
    modo = 0;
    aplicaModo();
    Serial.print(F("BTN "));
    Serial.println(modo);
    return true;
  }
  return false;
}

void correShow() {
  if (!pgmValido()) { modo = 0; return; }
  const int largo = pgmLargo();
  const bool repite = pgmBanderas() & 2;
  Serial.println(F("SHOW inicio"));
  do {
    int p = 0;
    sumaEE(EE_RUN);
    while (p < largo && modo == MODO_SHOW) {
      uint8_t op = EEPROM.read(PGM_DIR + 4 + p++);
      if (op == 1 && p + 4 <= largo) {
        int hz = EEPROM.read(PGM_DIR + 4 + p) | (EEPROM.read(PGM_DIR + 4 + p + 1) << 8);
        int ms = EEPROM.read(PGM_DIR + 4 + p + 2) | (EEPROM.read(PGM_DIR + 4 + p + 3) << 8);
        p += 4;
        tono(constrain(hz, 40, 8000), constrain(ms, 1, 5000));
      } else if (op == 2 && p + 2 <= largo) {
        int ms = EEPROM.read(PGM_DIR + 4 + p) | (EEPROM.read(PGM_DIR + 4 + p + 1) << 8);
        p += 2;
        espera(constrain(ms, 0, 5000));
      } else if (op == 3 && p + 2 <= largo) {
        int izq = (int8_t)EEPROM.read(PGM_DIR + 4 + p) * 2;
        int der = (int8_t)EEPROM.read(PGM_DIR + 4 + p + 1) * 2;
        p += 2;
        motores(constrain(izq, -VEL_MAX, VEL_MAX), constrain(der, -VEL_MAX, VEL_MAX));
      } else if (op == 4) {
        parar();
      } else {
        break;                               // dato raro: se termina el show
      }
      fxPaso();
      if (showCortar()) break;
    }
    parar();
  } while (repite && modo == MODO_SHOW && !abortar && colaN == 0);
  parar();
  if (modo == MODO_SHOW) modo = 0;           // las luces siguen: no se llama a aplicaModo()
  Serial.println(F("SHOW fin"));
}

// ---------- Órdenes ----------
void ok()  { Serial.println(F("OK")); }
void err(const __FlashStringHelper *motivo) { Serial.print(F("ERR ")); Serial.println(motivo); }

void ejecuta(char *s) {
  char *cmd = strtok(s, " ");
  if (!cmd) return;
  char *a = strtok(NULL, " ");
  char *b = strtok(NULL, " ");
  char *c = strtok(NULL, " ");
  char *d = strtok(NULL, " ");

  if (!strcmp(cmd, "PING")) {
    Serial.println(F("PONG mbot-web 1"));
  } else if (!strcmp(cmd, "T") && a && b) {
    int hz = constrain(atoi(a), 40, 8000);
    int ms = constrain(atoi(b), 1, 5000);
    if (fxModo == 4) {                                   // color por nota
      fxMatiz = fxMatizDe(hz);
      fxHayNota = true;
      fxSucio = true;
    }
    tono(hz, ms);
    ok();
  } else if (!strcmp(cmd, "W") && a) {
    espera(constrain(atoi(a), 0, 5000));
    ok();
  } else if (!strcmp(cmd, "M") && a && b) {
    if (modo != MODO_WEB) { modo = MODO_WEB; aplicaModo(); }
    motores(constrain(atoi(a), -VEL_MAX, VEL_MAX), constrain(atoi(b), -VEL_MAX, VEL_MAX));
    ok();
  } else if (!strcmp(cmd, "S")) {
    parar();
    ok();
  } else if (!strcmp(cmd, "L") && a && b && c && d) {
    int i = atoi(a);
    if (i < 0 || i > 12) { err(F("led")); }
    else {
      fxModo = 0;
      leds.setColor(i, constrain(atoi(b), 0, 255), constrain(atoi(c), 0, 255), constrain(atoi(d), 0, 255));
      leds.show();
      ok();
    }
  } else if (!strcmp(cmd, "LS") && a && strlen(a) == 72) {
    fxModo = 0;
    if (ledsHex(a)) ok(); else err(F("hex"));
  } else if (!strcmp(cmd, "FX") && a && b && c && strlen(c) == 72) {
    int m = atoi(a), br = atoi(b);
    if (m < 0 || m > 4 || br < 0 || br > 100) { err(F("fx")); }
    else if (!fxCarga(c)) { err(F("hex")); }
    else {
      fxModo = m;
      fxBrillo = br;
      fxHayNota = false;
      fxSucio = false;
      fxUltimo = millis();
      fxDibuja();
      ok();
    }
  } else if (!strcmp(cmd, "SAVE")) {
    fxGuardar();
    ok();
  } else if (!strcmp(cmd, "BAT")) {
    Serial.print(F("BAT "));
    Serial.println(bateria(), 2);
  } else if (!strcmp(cmd, "DIAG0")) {          // borra los contadores de diagnóstico
    for (int dir = EE_BOOT; dir <= EE_MIN; dir++) EEPROM.update(dir, 0xFF);
    ok();
  } else if (!strcmp(cmd, "PCLR")) {
    EEPROM.update(PGM_DIR, 0);                 // el show queda inválido hasta que PEND lo cierre
    pgmFin = 0;
    ok();
  } else if (!strcmp(cmd, "PADD") && a) {
    bool bien = false;
    if (!strcmp(a, "T") && b && c) {
      int hz = constrain(atoi(b), 40, 8000), ms = constrain(atoi(c), 1, 5000);
      bien = pgmPon(1) && pgmPon(hz & 0xFF) && pgmPon(hz >> 8) && pgmPon(ms & 0xFF) && pgmPon(ms >> 8);
    } else if (!strcmp(a, "W") && b) {
      int ms = constrain(atoi(b), 0, 5000);
      bien = pgmPon(2) && pgmPon(ms & 0xFF) && pgmPon(ms >> 8);
    } else if (!strcmp(a, "M") && b && c) {
      int izq = constrain(atoi(b), -VEL_MAX, VEL_MAX) / 2, der = constrain(atoi(c), -VEL_MAX, VEL_MAX) / 2;
      bien = pgmPon(3) && pgmPon((uint8_t)(int8_t)izq) && pgmPon((uint8_t)(int8_t)der);
    } else if (!strcmp(a, "S")) {
      bien = pgmPon(4);
    }
    if (bien) ok(); else err(F("show"));
  } else if (!strcmp(cmd, "PEND")) {
    int banderas = a ? atoi(a) : 0;
    EEPROM.update(PGM_DIR + 1, banderas);
    EEPROM.update(PGM_DIR + 2, pgmFin & 0xFF);
    EEPROM.update(PGM_DIR + 3, pgmFin >> 8);
    EEPROM.update(PGM_DIR, pgmFin > 0 ? PGM_MAGICO : 0);   // al final: así nunca queda un show a medias
    ok();
  } else if (!strcmp(cmd, "MODE") && a) {
    int n = atoi(a);
    if (n < 0 || n > MODO_SHOW) { err(F("modo")); }
    else {
      modo = n;
      aplicaModo();
      if (n == MODO_SHOW) showT0 = millis() + 300;
      ok();
    }
  } else {
    err(F("comando"));
  }
  ultimaOrden = millis();
}

char linea[96];
int lineaN = 0;
bool lineaLarga = false;

void atiendeUSB() {
  drenar();
  if (abortar) {
    abortar = false;
    lineaN = 0;
    lineaLarga = false;
    parar();
    Serial.println(F("ABORTED"));
  }
  while (colaN > 0 && !abortar) {
    char c = cola[colaIni];
    colaIni = (colaIni + 1) % RING;
    colaN--;
    if (c == '\n') {
      linea[lineaN] = 0;
      if (lineaLarga) err(F("largo"));
      else if (lineaN > 0) ejecuta(linea);
      lineaN = 0;
      lineaLarga = false;
    } else if (c != '\r') {
      if (lineaN < (int)sizeof(linea) - 1) linea[lineaN++] = c;
      else lineaLarga = true;
    }
  }
}

void setup() {
  Serial.begin(115200);

  // Interrupciones de encoders
  attachInterrupt(motorIzq.getIntNum(), isrIzq, RISING);
  attachInterrupt(motorDer.getIntNum(), isrDer, RISING);

  // Configuración PWM de la placa (igual que el firmware de fábrica)
  TCCR1A = _BV(WGM10);
  TCCR1B = _BV(CS11) | _BV(WGM12);
  TCCR2A = _BV(WGM21) | _BV(WGM20);
  TCCR2B = _BV(CS21);

  leds.setpin(PIN_LEDS);
  buzzer.setpin(PIN_BUZZER);
  randomSeed(analogRead(A0));

  aplicaModo();
  buzzer.tone(800, 100);
  fxRestaurar();                       // si hay luces guardadas, vuelven solas
  if (pgmValido() && (pgmBanderas() & 1)) {   // show guardado que arranca solo, a los 2,5 s
    modo = MODO_SHOW;
    showT0 = millis() + 2500;
  }
  sumaEE(EE_BOOT);
  uint8_t minimo = EEPROM.read(EE_MIN);
  Serial.print(F("INFO BOOT="));
  Serial.print(cuentaEE(EE_BOOT));
  Serial.print(F(" BTN="));
  Serial.print(cuentaEE(EE_BTN));
  Serial.print(F(" RUN="));
  Serial.print(cuentaEE(EE_RUN));
  Serial.print(F(" MIN="));
  Serial.print(minimo == 0xFF ? 0.0 : minimo / 10.0, 1);
  Serial.print(F(" BAT="));
  Serial.println(bateria(), 2);
  Serial.println(F("mBot Ranger web v1 listo"));
}

void loop() {
  atiendeUSB();
  fxPaso();

  // Cambio de modo con el botón (con antirrebote): 0, 1, 2, 3 y, si hay show guardado, 5.
  // De 3 sin show, de 4 (página) y de 5 vuelve a 0.
  if (botonFlanco() && botonSostenido() && millis() - ultimoBoton > 300) {
    ultimoBoton = millis();
    sumaEE(EE_BTN);
    if (modo == 3 && pgmValido()) { modo = MODO_SHOW; showT0 = millis() + 600; }
    else modo = (modo >= 3) ? 0 : modo + 1;
    aplicaModo();
    Serial.print(F("BTN "));
    Serial.println(modo);
  }

  switch (modo) {
    case 1: esquivar();    break;
    case 2: seguir();      break;
    case 3: testMotores(); break;
    case MODO_SHOW: if ((long)(millis() - showT0) >= 0) correShow(); break;
    default: break;
  }

  // Seguro: si la página se calla con los motores andando, se paran solos
  if (modo == MODO_WEB && moviendo && millis() - ultimaOrden > SIN_ORDENES_MS) {
    parar();
    Serial.println(F("WDT"));
  }
}
