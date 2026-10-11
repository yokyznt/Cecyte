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
    MODE n           cambia de modo (0..4)
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
const unsigned long SIN_ORDENES_MS = 3000;

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
// izq y der: positivo = esa rueda va hacia adelante
void motores(int izq, int der) {
  motorIzq.setMotorPwm(-izq);
  motorDer.setMotorPwm(der);
  moviendo = (izq != 0 || der != 0);
}
void adelante(int v)   { motores(v, v); }
void atras(int v)      { motores(-v, -v); }
void giraIzq(int v)    { motores(-v, v); }
void giraDer(int v)    { motores(v, -v); }
void parar()           { motores(0, 0); }

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
    delay(100);
    atras(VEL);
    delay(400);
    if (random(2) == 0) giraIzq(VEL); else giraDer(VEL);
    delay(random(350, 700));
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
  motores(150, 0);  delay(800); parar(); delay(400);
  motores(0, 150);  delay(800); parar(); delay(400);
  adelante(150);    delay(800); parar(); delay(400);
  atras(150);       delay(800); parar(); delay(400);
  giraIzq(150);     delay(600); parar(); delay(400);
  giraDer(150);     delay(600); parar();
  modo = 0;         // al terminar vuelve a reposo
  aplicaModo();
}

// ---------- Botón de la placa ----------
bool botonPresionado() {
  return analogRead(A7) < 100;
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
}

// ---------- Sonido y esperas (revisan el USB y el paro mientras pasan) ----------
void tono(int hz, int ms) {
  long periodo = 1000000L / hz;                       // µs
  long medio = periodo / 2 - AJUSTE_US;
  if (medio < 1) medio = 1;
  unsigned long fin = micros() + (unsigned long)ms * 1000UL;
  unsigned long ultimoDrenaje = micros();
  pinMode(PIN_BUZZER, OUTPUT);
  while (!abortar && (long)(fin - micros()) > 0) {
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
  while (!abortar && (long)(fin - millis()) > 0) {
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
    uint32_t esc = (uint32_t)k * fxBrillo;                 // k 0..255 por brillo 0..100
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
  } else if (!strcmp(cmd, "MODE") && a) {
    int n = atoi(a);
    if (n < 0 || n > MODO_WEB) { err(F("modo")); }
    else { modo = n; aplicaModo(); ok(); }
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
  Serial.println(F("mBot Ranger web v1 listo"));
}

void loop() {
  atiendeUSB();
  fxPaso();

  // Cambio de modo con el botón (con antirrebote). De 3 o de 4 vuelve a 0.
  if (botonPresionado() && millis() - ultimoBoton > 400) {
    ultimoBoton = millis();
    modo = (modo >= MODO_WEB - 1) ? 0 : modo + 1;
    aplicaModo();
    Serial.print(F("BTN "));
    Serial.println(modo);
  }

  switch (modo) {
    case 1: esquivar();    break;
    case 2: seguir();      break;
    case 3: testMotores(); break;
    default: break;
  }

  // Seguro: si la página se calla con los motores andando, se paran solos
  if (modo == MODO_WEB && moviendo && millis() - ultimaOrden > SIN_ORDENES_MS) {
    parar();
    Serial.println(F("WDT"));
  }
}
