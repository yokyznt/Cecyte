/*
  mBot Ranger (Me Auriga) con control desde la página del CECyTE (Web Serial)

  Es el sketch "tanquecito" de siempre (modos con el botón de la placa) más un puerto
  serie de texto, para que la página le mande notas, colores y movimientos en vivo.

  Modos (botón de la placa):
    0 = Reposo (LEDs azules)         1 = Esquivar obstáculos (verde)
    2 = Seguir objeto con la mano (amarillo)   3 = Test de motores (rojo)
    4 = Página (la manda la web; el botón vuelve a 0)   6 = Seguir la línea (solo por la página: MODE 6)

  Órdenes por USB, 115200 baudios, una por línea. Cada una responde OK, ERR ... o PONG:
    PING             -> PONG mbot-web 1
    T hz ms          suena una nota (hz 40..8000, ms 1..5000)
    W ms             espera sin sonar (0..5000)
    M izq der        motores -180..180 (positivo = adelante); toma el control (modo 4)
    S                para los motores
    L i r g b        un LED (i = 1..12) o todos (i = 0)
    LS <72 hex>      los 12 LEDs de golpe: RRGGBB x 12
    FX m b <72 hex> [v]  efecto de luces que corre solo en el robot, también mientras suena una nota:
                     m = 0 fijo, 1 arcoíris, 2 respirar, 3 persecución, 4 color por nota;
                     b = brillo 0..100; los 12 colores base van en hex como en LS;
                     v = velocidad del efecto en % (20..300, 100 = normal; opcional)
    TRIM n           corrección de rumbo -30..30 (+ gira a la derecha); se guarda sola
    VOL v            volumen del zumbador, 0..100 (se guarda con SAVE)
    SAVE             guarda el último FX y el volumen en la EEPROM: al encender, el robot los vuelve a poner
    PCLR             empieza a guardar un show nuevo (borra el anterior)
    PADD T hz ms     añade al show una nota; también PADD W ms, PADD M izq der y PADD S
    PEND f           termina el show; f: 1 = arranca solo al encender, 2 = se repite (3 = las dos)
    SPD n            velocidad de esquivar y seguir la mano, 40..230 (la línea usa LINEA vel)
    MODE n           cambia de modo (0..5; 5 = el show guardado, solo, sin la página; 6 = seguir la línea)
    FSAVE m [1]      guarda la función m (1 esquivar, 2 seguir la mano, 6 línea, con los ajustes LINEA de ese momento);
                     con 1 arranca sola 2,5 s después de encender. FCLR la borra
    BAT              responde "BAT 7.42" (voltaje de la batería)
    DIAG0            borra los contadores de diagnóstico que el robot dice al encender (INFO ...)
    !                un solo byte, sin salto de línea: paro de emergencia. Corta la nota,
                     frena los motores y borra lo pendiente. Responde ABORTED.
  Avisos sueltos: "BTN n" (se cambió de modo con el botón) y "WDT" (los motores se pararon
  solos porque en modo 4 pasaron 3 s sin órdenes).

  Arduino IDE:
    Placa:  Arduino Mega or Mega 2560
    Librerías: ninguna extra (solo EEPROM, que ya trae el IDE)
*/

#include <EEPROM.h>
#include <avr/wdt.h>

// Todo lo de esta placa tiene que caber en menos de 64 páginas de flash (16 KB): el bootloader borra
// mal las páginas altas, y cualquier subida que las toque puede dejar vacías las primeras (sin
// vectores de interrupción) y el programa no arranca. Por eso no se usan floats, math.h, random(),
// la clase de encoders ni el zumbador de Makeblock: los motores van por sus pines.

// El bootloader de esta placa puede dejar el watchdog armado al lanzar el programa; si el sketch no
// lo apaga lo primero, la placa se reinicia en bucle (sin hablar y a veces corrompiendo la EEPROM).
// Va en .init3 para correr antes que cualquier otra cosa (patrón de avr-libc).
void apagaWatchdog(void) __attribute__((naked)) __attribute__((used)) __attribute__((section(".init3")));
void apagaWatchdog(void) {
  MCUSR = 0;
  wdt_disable();
}

// Anillo de 12 LEDs WS2812 en el pin 44 (PL5). Driver propio, sin la librería Makeblock: incluirla
// aunque sea para el anillo enlaza todos sus módulos (Wire, Servo, IR, encoders, malloc...) y el
// programa deja de caber en 16 KB. La señal es la misma rutina de la librería, a 16 MHz.
uint8_t anillo[36];                          // G R B de cada LED, en el orden que se manda
void ledPon(uint8_t i, uint8_t r, uint8_t g, uint8_t b) {
  anillo[3 * i] = g; anillo[3 * i + 1] = r; anillo[3 * i + 2] = b;
}
void ledsTodos(uint8_t r, uint8_t g, uint8_t b) {
  for (uint8_t i = 0; i < 12; i++) ledPon(i, r, g, b);
}
void ledsMuestra() {
  uint8_t sreg = SREG;
  cli();
  const uint8_t alto = PORTL | _BV(PL5), bajo = PORTL & ~_BV(PL5);
  for (uint8_t n = 0; n < 36; n++) {
    uint8_t b = anillo[n], c;
    asm volatile (
      "ldi  %0,8        \n\t"
      "1:               \n\t"
      "st   X,%3        \n\t"     // sube la señal
      "rjmp .+0         \n\t"
      "sbrs %1,7        \n\t"
      "st   X,%4        \n\t"     // bit 0: baja pronto (0,35 us)
      "lsl  %1          \n\t"
      "rjmp .+0         \n\t"
      "rjmp .+0         \n\t"
      "rjmp .+0         \n\t"
      "brcc 2f          \n\t"
      "st   X,%4        \n\t"     // bit 1: baja más tarde (0,9 us)
      "2:               \n\t"
      "rjmp .+0         \n\t"
      "dec  %0          \n\t"
      "brne 1b          \n\t"
      : "=&d" (c), "+r" (b)
      : "x" (&PORTL), "r" (alto), "r" (bajo));
    // entre byte y byte (una pausa de ~5 us no afecta al WS2812, que pide >50 us para reiniciarse) se deja pasar
    // una interrupción pendiente: sin esto, el USB a 115200 pierde bytes mientras se dibuja el anillo
    sei();
    __asm__ volatile ("nop");
    cli();
  }
  SREG = sreg;
}

// Sensor ultrasónico del puerto 10 (señal en A11): igual que la librería, pero sin floats
int distanciaCm() {                        // 400 si no hay eco
  pinMode(A11, OUTPUT);
  digitalWrite(A11, LOW);
  delayMicroseconds(2);
  digitalWrite(A11, HIGH);
  delayMicroseconds(10);
  digitalWrite(A11, LOW);
  pinMode(A11, INPUT);
  unsigned long us = pulseIn(A11, HIGH, 30000UL);
  return us == 0 ? 400 : (int)(us / 58);
}

// Motores del Auriga (SLOT1 = izquierdo, SLOT2 = derecho): pines PWM, H1 y H2 de MeAuriga.h
const uint8_t MOT_PWM[2] = { 11, 10 };
const uint8_t MOT_H1[2]  = { 49, 47 };
const uint8_t MOT_H2[2]  = { 48, 46 };
int motUltimo[2] = { 1000, 1000 };
// Corrección de rumbo (orden TRIM, -30..30): dos motores nunca son idénticos y el robot se va de un lado.
// Positivo = la rueda derecha va a (100 - n) %, así gira hacia la derecha; negativo = la izquierda se frena.
const int EE_TRIM = 3041;
int8_t trim = 0;
void motorPwm(uint8_t m, int pwm) {
  pwm = constrain(pwm, -255, 255);
  if (pwm == motUltimo[m]) return;
  motUltimo[m] = pwm;
  if (pwm < 0) {
    digitalWrite(MOT_H1[m], LOW);
    delayMicroseconds(5);
    digitalWrite(MOT_H2[m], HIGH);
  } else {
    digitalWrite(MOT_H1[m], HIGH);
    delayMicroseconds(5);
    digitalWrite(MOT_H2[m], LOW);
  }
  analogWrite(MOT_PWM[m], abs(pwm));
}

const int VEL = 150;                 // 0 a 255. Con 90 las orugas no vencían la fricción: zumbaban sin avanzar
int velFn = VEL;                     // velocidad de esquivar y seguir la mano (orden SPD; se guarda con la función)
const int VEL_MAX = 180;             // tope de lo que puede pedir la página
const int DIST_OBSTACULO = 18;       // cm: a menos de esto esquiva (con 20 reaccionaba muy pronto; con 10, se pegaba a las paredes)
const int PIN_BUZZER = 45;
const int PIN_LEDS = 44;
const int MODO_WEB = 4;
const int MODO_SHOW = 5;             // el show guardado en la EEPROM: suena y baila solo
#define SEGUIDOR_LINEA 1             // 1 = incluye el modo 6 (seguidor de línea, orden LINEA)
#if SEGUIDOR_LINEA
const int MODO_MAX = 6;              // 6 = seguir la línea con el módulo Me Line Follower
unsigned long lnT0 = 0;              // cuándo empezó a seguir la línea (0 = no ha empezado)
uint8_t lnEstado = 255;              // 0 perdida, 1 en la línea, 2 cruce (para no redibujar las luces sin necesidad)
#else
const int MODO_MAX = MODO_SHOW;
#endif
const unsigned long SIN_ORDENES_MS = 3000;

// Show guardado: cabecera de 4 bytes en la EEPROM y luego las órdenes, una detrás de otra:
//   1 hz(2) ms(2) = nota   2 ms(2) = espera   3 izq/2 der/2 = motores   4 = parar
const int PGM_DIR = 100;
const int PGM_MAX = 2800;
const uint8_t PGM_MAGICO = 0xB5;
int pgmFin = 0;                      // bytes que lleva la subida en curso
unsigned long showT0 = 0;            // el show espera a esta hora (para dejarlo en el piso)

int modo = 0;
uint8_t escEstado = 0;               // paso de la maniobra de esquivar (ver esquivar())
int musP = 0;                            // música de fondo guardada: por dónde va en el show (EEPROM)
unsigned long musT = 0;                  // a esta hora toca la siguiente nota o silencio
bool abortar = false;                // un "!" de la página: corta lo que esté haciendo
bool moviendo = false;
unsigned long ultimoBoton = 0;
unsigned long ultimaOrden = 0;

// Efecto de luces (orden FX). Un cuadro nuevo cada FX_MS, y solo si pasaron FX_QUIETO_MS desde la
// última orden terminada: dibujar el anillo apaga las interrupciones unos 0,4 ms y en ese rato el
// USB podría perder bytes, pero la página no manda nada mientras espera el OK.
const unsigned long FX_MS = 60;
const unsigned long FX_QUIETO_MS = 40;
bool luzPropia = false;                // hay luces guardadas: esquivar y seguir la mano las respetan
uint8_t fxModo = 0;                  // 0 fijo, 1 arcoíris, 2 respirar, 3 persecución, 4 color por nota
uint8_t fxBrillo = 40;               // 0..100
uint8_t volumen = 100;               // volumen del zumbador, 0..100 (orden VOL)
uint16_t fxVel = 100;                // velocidad del efecto en %, 20..300
unsigned long fxT = 0, fxTprev = 0;  // tiempo del efecto (corre al ritmo de fxVel)
uint8_t fxBase[12][3];               // colores base de cada LED
uint8_t fxMatiz = 0;                 // modo 4: color de la última nota
bool fxHayNota = false;
bool fxSucio = false;                // modo 4: hay un color nuevo por dibujar
unsigned long fxUltimo = 0;

// ---------- Movimiento ----------
// Voltaje de la batería en centésimas de volt (A4 mide un tercio, como en el firmware de fábrica)
int bateriaCv() { return (int)((long)analogRead(A4) * 1500L / 1024L); }
void imprimeDec(int centesimas, int decimales) {          // 742 -> "7.42" (2 decimales) o 74 -> "7.4" (1)
  int div = decimales == 2 ? 100 : 10;
  Serial.print(centesimas / div);
  Serial.print('.');
  int resto = centesimas % div;
  if (decimales == 2 && resto < 10) Serial.print('0');
  Serial.print(resto);
}

// Diagnóstico que sobrevive a un reinicio (EEPROM, 0xFF = vacío; la página lo muestra al conectar).
// El bootloader de esta placa borra MCUSR antes de arrancar el sketch, así que no se puede saber por
// qué se reinició; en su lugar se cuenta: BOOT = arranques (conectar por USB cuenta uno), BTN = veces
// que el botón cambió de modo, RUN = pasadas del show, MIN = voltaje más bajo con las ruedas andando (x10).
const int EE_BOOT = 2980, EE_BTN = 2981, EE_RUN = 2982, EE_MIN = 2983;
uint8_t cuentaEE(int dir) { uint8_t v = EEPROM.read(dir); return v == 0xFF ? 0 : v; }
void sumaEE(int dir) { uint8_t v = cuentaEE(dir); if (v < 254) EEPROM.update(dir, v + 1); }
void notaBateria() {
  uint8_t d = (uint8_t)constrain(bateriaCv() / 10, 0, 254);
  uint8_t m = EEPROM.read(EE_MIN);
  if (m == 0xFF || d < m) EEPROM.update(EE_MIN, d);
}

// izq y der: positivo = esa rueda va hacia adelante.
// Las ruedas suben en rampa (16 de PWM cada 12 ms): pedirle de golpe toda la corriente a la batería
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
  // arranque suave: con 30 por paso los motores pedían de golpe tanta corriente que, a pilas y sin USB, el
  // voltaje caía a ~4 V, el regulador de 5 V se hundía y la placa se reiniciaba al segundo de andar
  izqAct += constrain(izqObj - izqAct, -16, 16);
  derAct += constrain(derObj - derAct, -16, 16);
  sacaMotores();
}
void sacaMotores() {                       // lleva izqAct/derAct a los motores, con la corrección de rumbo
  int li = izqAct, ld = derAct;
  if (trim > 0) ld = ld * (100 - trim) / 100; else li = li * (100 + trim) / 100;
  motorPwm(0, -li);
  motorPwm(1, ld);
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
  motorPwm(0, 0);
  motorPwm(1, 0);
  moviendo = false;
}

// ---------- LEDs ----------
void color(int r, int g, int b) {
  ledsTodos(r, g, b);
  ledsMuestra();
}

void aplicaModo() {
  parar();
  tonoApaga();
  escEstado = 0;
  musP = 0;
  musT = millis() + 1500;               // si la página manda la música, tiene tiempo de adelantarse
#if SEGUIDOR_LINEA
  lnT0 = 0;                            // el seguidor empieza su cuenta de tiempo de cero cada vez
  lnEstado = 255;
#endif
  // los colores de los modos del botón mandan sobre el efecto, salvo en esquivar y seguir la mano cuando
  // el usuario guardó sus luces: ahí siguen con su efecto
  const bool conserva = luzPropia && (modo == 1 || modo == 2);
  if (modo < MODO_WEB && !conserva) fxModo = 0;
  if (conserva) {
    fxDibuja();
  } else {
    switch (modo) {
      case 0: color(0, 0, 40);   break;
      case 1: color(0, 40, 0);   break;
      case 2: color(40, 30, 0);  break;
      case 3: color(40, 0, 0);   break;
    }
  }
  if (modo < MODO_WEB) tono(500 + modo * 200, 120);
}

// ---------- Modos del botón ----------
uint16_t semilla = 0xACE1;             // xorshift de 16 bits: random() de Arduino pesa casi 300 bytes
uint16_t azar() {
  semilla ^= semilla << 7;
  semilla ^= semilla >> 9;
  semilla ^= semilla << 8;
  return semilla;
}

// Esquivar sin esperas bloqueantes: cada llamada avanza un paso y regresa, así loop() sigue atendiendo el USB,
// las luces y la música.
// Al ver algo enfrente: se detiene, retrocede un poco si está pegado y GIRA un rato fijo hacia otro lado
// (medir mientras gira falla con paredes en ángulo, que no devuelven eco) y sigue; si todavía hay algo, gira de
// nuevo hacia el mismo lado, así da más vuelta hasta hallar camino.
//   0 avanza  1 pausa  2 retrocede (si está pegado)  3 pausa  8 gira  9 pausa
unsigned long escT = 0, escUltimo = 0;
int escD = 0;
bool escIzq = false;
const unsigned long ESC_GIRO_MS = 600;   // lo que gira cada vez (unos 120° a velocidad VEL); se suma un poco al azar

void escPaso(uint8_t e, unsigned long dur) {
  escEstado = e;
  escT = millis() + dur;
}

void escGira(unsigned long t) {
  if (t - escUltimo > 2500) escIzq = (azar() & 1) == 0;       // otro obstáculo enseguida: sigue hacia el mismo lado
  escUltimo = t;
  if (escIzq) giraIzq(velFn); else giraDer(velFn);
  escPaso(8, ESC_GIRO_MS + azar() % 250);
}

void esquivar() {
  const unsigned long t = millis();
  if (escEstado != 0 && (long)(t - escT) < 0) return;           // todavía en la pausa o el giro de este paso
  switch (escEstado) {
    case 0:
      escD = distanciaCm();
      if (escD > DIST_OBSTACULO || distanciaCm() > DIST_OBSTACULO) {   // dos lecturas: un eco falso no lo frena
        adelante(velFn);
        return;
      }
      parar();                                                  // algo adelante
      escPaso(1, 60);
      break;
    case 1:
      if (escD < 6) { atras(velFn); escPaso(2, 200); }            // muy pegado: un respiro
      else escGira(t);
      break;
    case 2:
      parar();
      escPaso(3, 60);
      break;
    case 3:
      escGira(t);
      break;
    case 8:
      parar();
      escPaso(9, 60);
      break;
    default:
      escEstado = 0;
  }
}

void seguir() {
  int d = distanciaCm();
  if (d > 12 && d < 40)      adelante(velFn);
  else if (d <= 8)           atras(velFn);
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
bool botonOcupado();
bool botonFlanco() {
  if (botonOcupado()) return false;       // el módulo de línea del puerto 9 usa ese pin
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
  // con las ruedas andando (o atoradas en una esquina) el ruido de los motores baja la lectura del botón y daba
  // pulsaciones falsas que cambiaban de modo solas: andando se pide una pulsación más larga
  const unsigned long exigido = moviendo ? 600UL : 300UL;
  while (millis() - t0 < exigido) {
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

unsigned long tonoFin = 0;               // si no es 0, a esta hora se apaga la nota que suena sin esperarla

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
  if (tonoFin && (long)(millis() - tonoFin) >= 0) tonoApaga();
  musicaFondo();
  if (!abortar) rampa();                     // drenar() corre en toda espera: de aquí avanza la rampa
}

// ---------- Sonido y esperas (revisan el USB y el paro mientras pasan) ----------
void espera(unsigned long ms) {
  unsigned long fin = millis() + ms;
  while (!abortar && !(modo == MODO_SHOW && colaN > 0) && (long)(fin - millis()) > 0) {
    drenar();
    fxPaso();
  }
}

// El zumbador (pin 45 = OC5B) suena por hardware con el Timer5 en PWM rápido: el pin sale solo en cada
// vuelta del contador. Así el anillo de LEDs, que apaga las interrupciones unos 0,4 ms al dibujar
// cada cuadro, ya no entrecorta el sonido (antes la onda se hacía a mano y se cortaba en cada cuadro).
//   frecuencia = F_CPU / (prescaler * (1 + ICR5))
// El volumen es el ancho del pulso: 50 % de la onda (volumen 100) es lo más fuerte, y al bajarlo el
// pulso se hace más angosto y suena más bajito. La amplitud de la onda es sin(pi * ancho), así que para
// que el volumen suba parejo (amplitud lineal) el ancho sigue asin(volumen / 100) / pi. Está en
// milésimas del periodo, de 5 en 5 de volumen; entre medias se interpola.
const uint16_t ANCHO_VOL[21] = { 0, 16, 32, 48, 64, 80, 97, 114, 131, 149, 167, 185, 205, 225, 247, 270, 295, 323, 356, 399, 500 };
uint16_t anchoPermil() {
  uint8_t i = volumen / 5, r = volumen % 5;
  if (i >= 20) return ANCHO_VOL[20];
  return ANCHO_VOL[i] + (uint32_t)(ANCHO_VOL[i + 1] - ANCHO_VOL[i]) * r / 5;
}

void tonoApaga() {
  TCCR5B = 0;
  TCCR5A = 0;
  digitalWrite(PIN_BUZZER, LOW);
  tonoFin = 0;
}

void tonoInicia(int hz) {                  // enciende el zumbador y sigue: lo apaga tonoApaga() o drenar() al vencer tonoFin
  unsigned long ciclos = 16000000UL / (unsigned long)hz;    // con prescaler 1
  uint8_t cs = 1;
  if (ciclos > 65536UL) { cs = 2; ciclos /= 8; }            // graves: prescaler 8
  uint16_t tope = (uint16_t)(ciclos - 1);
  uint32_t ancho = (uint32_t)tope * anchoPermil() / 1000UL;
  if (ancho < 1) ancho = 1;
  pinMode(PIN_BUZZER, OUTPUT);
  TCCR5A = _BV(COM5B1) | _BV(WGM51);
  TCCR5B = _BV(WGM53) | _BV(WGM52) | cs;
  ICR5 = tope;
  OCR5B = (uint16_t)ancho;
  TCNT5 = 0;
}

void tono(int hz, int ms) {
  if (volumen == 0) { espera(ms); return; }
  tonoInicia(hz);
  espera(ms);
  tonoApaga();
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
  for (int i = 0; i < 12; i++) ledPon(i, v[3 * i], v[3 * i + 1], v[3 * i + 2]);
  ledsMuestra();
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
  // clase de nota 0..11 (Do = 0): se lleva la frecuencia a la octava de Do4 y se cuentan los umbrales
  // entre semitonos (centésimas de Hz) que supera
  static const uint16_t UMBRAL[12] = { 26930, 28531, 30227, 32025, 33929, 35947, 38084, 40349, 42748, 45290, 47983, 50836 };
  long f = (long)hz * 100L;
  while (f < 26163L) f *= 2;
  while (f >= 52326L) f /= 2;
  uint8_t clase = 0;
  for (uint8_t i = 0; i < 12; i++) if (f >= UMBRAL[i]) clase++;
  return (uint8_t)((clase % 12) * 255 / 12);
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
  // reloj del efecto: corre al ritmo de fxVel (100 = normal, 200 = el doble de rápido)
  unsigned long ahora = millis();
  fxT += (ahora - fxTprev) * fxVel / 100UL;
  fxTprev = ahora;
  unsigned long t = fxT;
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
    // el anillo es lo que más gasta después de los motores (hasta ~300 mA al 100 %): el 100 % del control
    // equivale a un 50 % real. Es igual andando o quieto: antes bajaba más al moverse y, con el brillo ya
    // bajo, las luces casi se apagaban justo cuando el robot andaba
    uint32_t esc = (uint32_t)k * (fxBrillo / 2);   // k 0..255 por brillo 0..100
    ledPon(i, (uint32_t)r * esc / 25500UL, (uint32_t)g * esc / 25500UL, (uint32_t)b * esc / 25500UL);
  }
  ledsMuestra();
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
  luzPropia = true;
  EEPROM.update(EE_DIR, EE_MAGICO);
  EEPROM.update(EE_DIR + 1, fxModo);
  EEPROM.update(EE_DIR + 2, fxBrillo);
  for (int i = 0; i < 36; i++) EEPROM.update(EE_DIR + 3 + i, fxBase[i / 3][i % 3]);
  EEPROM.update(EE_DIR + 39, (uint8_t)(fxVel / 2));            // velocidad, a la mitad para que quepa en un byte
  EEPROM.update(EE_DIR + 40, volumen);
}

void fxRestaurar() {
  if (EEPROM.read(EE_DIR) != EE_MAGICO) return;
  uint8_t m = EEPROM.read(EE_DIR + 1), b = EEPROM.read(EE_DIR + 2);
  if (m > 4 || b > 100) return;
  luzPropia = true;
  for (int i = 0; i < 36; i++) fxBase[i / 3][i % 3] = EEPROM.read(EE_DIR + 3 + i);
  uint8_t v = EEPROM.read(EE_DIR + 39);
  fxVel = (v >= 10 && v <= 150) ? v * 2 : 100;
  uint8_t vo = EEPROM.read(EE_DIR + 40);
  if (vo <= 100) volumen = vo;                                 // 0xFF = nunca guardado: queda en 100
  fxModo = m;
  fxBrillo = b;
  fxHayNota = false;
  fxDibuja();
  Serial.print(F("FX guardado: modo "));
  Serial.println(m);
}

// Música de fondo de las funciones guardadas (esquivar, seguir la mano y línea): toca las notas T y W del show
// guardado con la bandera 4, sin esperarlas, y las repite. La llama drenar(), que corre en toda espera.
void musicaFondo() {
  if (!(modo == 1 || modo == 2 || modo == 6) || abortar) return;
  unsigned long t = millis();
  if ((long)(t - musT) < 0) return;                    // sonando o en silencio
  if (!pgmValido() || !(pgmBanderas() & 4)) return;
  const int largo = pgmLargo();
  if (musP >= largo) musP = 0;
  uint8_t op = EEPROM.read(PGM_DIR + 4 + musP++);
  if (op == 1 && musP + 4 <= largo) {
    int hz = EEPROM.read(PGM_DIR + 4 + musP) | (EEPROM.read(PGM_DIR + 4 + musP + 1) << 8);
    int ms = EEPROM.read(PGM_DIR + 4 + musP + 2) | (EEPROM.read(PGM_DIR + 4 + musP + 3) << 8);
    musP += 4;
    ms = constrain(ms, 1, 5000);
    if (volumen) { tonoInicia(constrain(hz, 40, 8000)); tonoFin = t + ms; }
    musT = t + ms;
  } else if (op == 2 && musP + 2 <= largo) {
    musT = t + constrain(EEPROM.read(PGM_DIR + 4 + musP) | (EEPROM.read(PGM_DIR + 4 + musP + 1) << 8), 0, 5000);
    musP += 2;
  } else if (op == 3) {
    musP += 2;
  } else if (op != 4) {
    musP = 0;
    musT = t + 1000;
  }
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
    if (!repite) parar();                    // repitiendo, no se frena entre vuelta y vuelta
  } while (repite && modo == MODO_SHOW && !abortar && colaN == 0);
  parar();
  if (modo == MODO_SHOW) modo = 0;           // las luces siguen: no se llama a aplicaModo()
  Serial.println(F("SHOW fin"));
}

#if SEGUIDOR_LINEA
// ---------- Seguidor de línea (módulo Me Line Follower: dos sensores digitales) ----------
// Puertos con dos pines digitales: 6, 7, 8 y 9 (el 10 es el ultrasonido). El 9 comparte el pin A7 con el botón de
// la placa: con el módulo ahí el botón no se puede usar (la salida del sensor parecería una pulsación).
const uint8_t LN_S1[4] = { A10, A9, A8, A7 };     // puertos 6, 7, 8 y 9 (el 9 comparte A7 con el botón de la placa)
const uint8_t LN_S2[4] = { A15, A14, A13, A12 };
uint8_t lnPuerto = 0, lnColor = 0, lnVel = 130, lnGiro = 50, lnPerdida = 1, lnCruce = 0, lnObst = 0, lnAvisos = 1;
uint16_t lnBuscarMs = 4000, lnDurS = 0;
unsigned long lnPerdidoDesde = 0;
int8_t lnLado = 1;                   // hacia dónde vio la línea por última vez (-1 izquierda, 1 derecha)

void lineaConfig(const char *k, int v) {
  if (!strcmp(k, "puerto")) lnPuerto = constrain(v, 6, 9) - 6;
  else if (!strcmp(k, "color")) lnColor = v ? 1 : 0;
  else if (!strcmp(k, "vel")) lnVel = constrain(v, 40, 150);
  else if (!strcmp(k, "giro")) lnGiro = constrain(v, 10, 100);
  else if (!strcmp(k, "perdida")) lnPerdida = constrain(v, 0, 2);
  else if (!strcmp(k, "buscar")) lnBuscarMs = constrain(v, 0, 10000);
  else if (!strcmp(k, "cruce")) lnCruce = constrain(v, 0, 3);
  else if (!strcmp(k, "obst")) lnObst = constrain(v, 0, 200);
  else if (!strcmp(k, "dur")) lnDurS = constrain(v, 0, 3600);
  else if (!strcmp(k, "avisos")) lnAvisos = v ? 1 : 0;
}

void lineaEstado(uint8_t e) {
  if (e == lnEstado) return;
  lnEstado = e;
  if (lnAvisos && fxModo == 0) { if (e == 0) color(40, 0, 0); else color(0, 40, 0); }   // con un efecto, el efecto manda
}

// Registro del seguidor (diagnóstico, orden LOG): cada cambio de lo que ven los sensores o de lo que decide el
// robot. estado = bit1 sensor 1 (S1) y bit0 sensor 2 (S2) viendo la línea; accion: 1 recto, 2 corrige hacia S1,
// 3 corrige hacia S2, 4 cruce, 5 perdida (derecho), 6 arco hacia S1, 7 arco hacia S2, 8 parar.
uint8_t lnLog[150];                    // 50 eventos de 3 bytes: estado*16+accion, tiempo (10 ms) alto y bajo
uint8_t lnLogN = 0;
uint8_t lnLogUlt = 255;
unsigned long lnLogT0 = 0;

void lnRegistra(uint8_t estado, uint8_t accion) {
  const uint8_t k = (estado << 4) | accion;
  if (k == lnLogUlt || lnLogN >= 50) return;
  lnLogUlt = k;
  const unsigned int t = (unsigned int)((millis() - lnLogT0) / 10UL);
  lnLog[3 * lnLogN] = k;
  lnLog[3 * lnLogN + 1] = t >> 8;
  lnLog[3 * lnLogN + 2] = t & 0xFF;
  lnLogN++;
}

void seguirLinea() {
  if (lnT0 == 0) {
    lnT0 = millis();
    lnLogT0 = lnT0;                                    // registro nuevo en cada carrera
    lnLogN = 0;
    lnLogUlt = 255;
    pinMode(LN_S1[lnPuerto], INPUT);
    pinMode(LN_S2[lnPuerto], INPUT);
  }
  if ((lnDurS && millis() - lnT0 > lnDurS * 1000UL) || (lnObst && distanciaCm() < lnObst)) {
    parar();
    modo = 0;
    aplicaModo();
    return;
  }
  // el módulo da LOW sobre una línea negra; con línea blanca se invierte
  const bool s1 = (digitalRead(LN_S1[lnPuerto]) == LOW) != (lnColor == 1);
  const bool s2 = (digitalRead(LN_S2[lnPuerto]) == LOW) != (lnColor == 1);
  const int c = (int)lnVel * lnGiro / 100;           // cuánto se frena la rueda de adentro (x2)
  if (s1 && s2) {                                    // cruce
    lnPerdidoDesde = 0;
    lineaEstado(2);
    if (lnCruce == 0) motores(lnVel, lnVel);
    else if (lnCruce == 1) parar();
    else if (lnCruce == 2) motores(-lnVel, lnVel);
    else motores(lnVel, -lnVel);
    lnRegistra(3, 4);
  } else if (s1) {                                   // la línea está a la izquierda: corrige hacia allí
    lnLado = -1;
    lnPerdidoDesde = 0;
    lineaEstado(1);
    motores(lnVel - 2 * c, lnVel);
    lnRegistra(2, 2);
  } else if (s2) {
    lnLado = 1;
    lnPerdidoDesde = 0;
    lineaEstado(1);
    motores(lnVel, lnVel - 2 * c);
    lnRegistra(1, 3);
  } else {                                           // perdida
    if (lnPerdidoDesde == 0) lnPerdidoDesde = millis();
    lineaEstado(0);
    // Ninguno la ve: en una recta es lo normal (la línea queda ENTRE los sensores) y en una curva fuerte es que
    // se salió. Como no se puede distinguir, no se gira en el sitio: sigue derecho un instante y luego AVANZA
    // zigzagueando en arcos cada vez más largos (hacia el último lado, luego al otro...). En una recta el
    // zigzag es mínimo porque un sensor la toca enseguida y corrige; en una curva la vuelve a encontrar.
    const unsigned long perdido = millis() - lnPerdidoDesde;
    if (lnPerdida == 0) {
      parar();
      lnRegistra(0, 8);
    } else if (lnPerdida == 2 || perdido < 150) {
      motores(lnVel, lnVel);
      lnRegistra(0, 5);
    } else if (perdido - 150 > lnBuscarMs) {
      parar();
      lnRegistra(0, 8);
    } else {
      unsigned long r = perdido - 150, dur = 250;
      int8_t lado = lnLado;
      while (r >= dur && dur < 2500) { r -= dur; dur += 250; lado = -lado; }
      if (lado > 0) motores(lnVel, lnVel / 5); else motores(lnVel / 5, lnVel);   // arco hacia ese lado
      lnRegistra(0, lado > 0 ? 7 : 6);
    }
  }
}
#endif

// El puerto 9 comparte el pin A7 con el botón de la placa: con el seguidor de línea ahí, el botón se ignora
// (el sensor negro se leería como pulsación y cambiaría de modo solo).
bool botonOcupado() {
#if SEGUIDOR_LINEA
  return lnPuerto == 3;
#else
  return false;
#endif
}

// ---------- Función guardada (esquivar, seguir la mano o seguir la línea) ----------
// Al encenderlo (si se marcó) o con el botón de la placa, el robot la hace sin la página.
// 15 bytes: magia, modo, arranca solo y los ajustes de la línea, que se cargan al encender.
const int FN_DIR = 2950;
const uint8_t FN_MAGICO = 0xC3;
int fnModo = 0;                       // 0 = no hay función guardada
unsigned long fnEspera = 0;           // si no es 0, arranca a esta hora (para dejarlo en el piso)

void fnGuardar(int m, bool solo) {
  EEPROM.update(FN_DIR + 1, m);
  EEPROM.update(FN_DIR + 2, solo ? 1 : 0);
#if SEGUIDOR_LINEA
  EEPROM.update(FN_DIR + 3, lnPuerto);
  EEPROM.update(FN_DIR + 4, lnColor);
  EEPROM.update(FN_DIR + 5, lnVel);
  EEPROM.update(FN_DIR + 6, lnGiro);
  EEPROM.update(FN_DIR + 7, lnPerdida);
  EEPROM.update(FN_DIR + 8, lnCruce);
  EEPROM.update(FN_DIR + 9, lnObst);
  EEPROM.update(FN_DIR + 10, lnAvisos);
  EEPROM.update(FN_DIR + 11, lnBuscarMs & 0xFF);
  EEPROM.update(FN_DIR + 12, lnBuscarMs >> 8);
  EEPROM.update(FN_DIR + 13, lnDurS & 0xFF);
  EEPROM.update(FN_DIR + 14, lnDurS >> 8);
#endif
  EEPROM.update(FN_DIR + 15, velFn);
  EEPROM.update(FN_DIR, FN_MAGICO);     // al final: nunca queda a medias
  fnModo = m;
}

void fnCargar() {
  if (EEPROM.read(FN_DIR) != FN_MAGICO) return;
  int m = EEPROM.read(FN_DIR + 1);
  if (m != 1 && m != 2 && m != 6) return;
  if (m > MODO_MAX) return;
  fnModo = m;
  { uint8_t v = EEPROM.read(FN_DIR + 15); if (v >= 40 && v <= 230) velFn = v; }
#if SEGUIDOR_LINEA
  lnPuerto = constrain(EEPROM.read(FN_DIR + 3), 0, 3);
  lnColor = EEPROM.read(FN_DIR + 4) ? 1 : 0;
  lnVel = constrain(EEPROM.read(FN_DIR + 5), 40, 150);
  lnGiro = constrain(EEPROM.read(FN_DIR + 6), 10, 100);
  lnPerdida = constrain(EEPROM.read(FN_DIR + 7), 0, 2);
  lnCruce = constrain(EEPROM.read(FN_DIR + 8), 0, 3);
  lnObst = constrain(EEPROM.read(FN_DIR + 9), 0, 200);
  lnAvisos = EEPROM.read(FN_DIR + 10) ? 1 : 0;
  lnBuscarMs = constrain(EEPROM.read(FN_DIR + 11) | (EEPROM.read(FN_DIR + 12) << 8), 0, 10000);
  lnDurS = constrain(EEPROM.read(FN_DIR + 13) | (EEPROM.read(FN_DIR + 14) << 8), 0, 3600);
#endif
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
    if (modo == 1 || modo == 2 || modo == 6) {          // esquivar, seguir y línea: la nota suena sin frenar al robot
      if (volumen) { tonoInicia(hz); tonoFin = millis() + ms; }
      musT = millis() + 3000;                          // la página manda la música: la guardada espera
    } else {
      tono(hz, ms);
    }
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
      const uint8_t r = constrain(atoi(b), 0, 255), g = constrain(atoi(c), 0, 255), bl = constrain(atoi(d), 0, 255);
      if (i == 0) ledsTodos(r, g, bl); else ledPon(i - 1, r, g, bl);
      ledsMuestra();
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
      fxVel = d ? constrain(atoi(d), 20, 300) : 100;   // 4.º dato opcional: velocidad del efecto en %
      fxHayNota = false;
      fxSucio = false;
      fxUltimo = millis();
      fxDibuja();
      ok();
    }
#if SEGUIDOR_LINEA
  } else if (!strcmp(cmd, "LINEA") && a && b) {      // LINEA clave valor: ajustes del seguidor (en RAM)
    lineaConfig(a, atoi(b));
    ok();
#endif
#if SEGUIDOR_LINEA
  } else if (!strcmp(cmd, "LOG")) {                   // el registro del seguidor de la última carrera
    Serial.print(F("LOG "));
    Serial.println(lnLogN);
    for (uint8_t q = 0; q < lnLogN; q++) {
      Serial.print(F("LG "));
      Serial.print(lnLog[3 * q] >> 4);
      Serial.print(' ');
      Serial.print(lnLog[3 * q] & 15);
      Serial.print(' ');
      Serial.println(((unsigned int)lnLog[3 * q + 1] << 8) | lnLog[3 * q + 2]);
    }
  } else if (!strcmp(cmd, "SENS")) {                  // diagnóstico: los dos pines de los puertos 6, 7 y 8 (1 = alto)
    Serial.print(F("SENS"));
    for (uint8_t q = 0; q < 4; q++) {
      pinMode(LN_S1[q], INPUT);
      pinMode(LN_S2[q], INPUT);
      Serial.print(' ');
      Serial.print(digitalRead(LN_S1[q]));
      Serial.print(digitalRead(LN_S2[q]));
    }
    Serial.println();
#endif
  } else if (!strcmp(cmd, "SPD") && a) {              // SPD n: velocidad de esquivar y seguir la mano (40..230)
    velFn = constrain(atoi(a), 40, 230);
    ok();
  } else if (!strcmp(cmd, "TRIM") && a) {            // TRIM n: corrección de rumbo, se guarda sola
    trim = constrain(atoi(a), -30, 30);
    EEPROM.update(EE_TRIM, (uint8_t)trim);
    if (moviendo) sacaMotores();
    ok();
  } else if (!strcmp(cmd, "VOL") && a) {
    volumen = constrain(atoi(a), 0, 100);
    ok();
  } else if (!strcmp(cmd, "SAVE")) {
    fxGuardar();
    ok();
  } else if (!strcmp(cmd, "BAT")) {
    Serial.print(F("BAT "));
    imprimeDec(bateriaCv(), 2);
    Serial.println();
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
  } else if (!strcmp(cmd, "FSAVE") && a) {           // FSAVE modo [1 = arranca sola al encender]
    int m = atoi(a);
    if ((m != 1 && m != 2 && m != 6) || m > MODO_MAX) { err(F("modo")); }
    else { fnGuardar(m, b && atoi(b) != 0); ok(); }
  } else if (!strcmp(cmd, "FCLR")) {
    EEPROM.update(FN_DIR, 0);
    fnModo = 0;
    ok();
  } else if (!strcmp(cmd, "MODE") && a) {
    int n = atoi(a);
    if (n < 0 || n > MODO_MAX) { err(F("modo")); }
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

  // Configuración PWM de la placa (igual que el firmware de fábrica)
  TCCR1A = _BV(WGM10);
  TCCR1B = _BV(CS11) | _BV(WGM12);
  TCCR2A = _BV(WGM21) | _BV(WGM20);
  TCCR2B = _BV(CS21);

  for (uint8_t m = 0; m < 2; m++) {
    pinMode(MOT_PWM[m], OUTPUT);
    pinMode(MOT_H1[m], OUTPUT);
    pinMode(MOT_H2[m], OUTPUT);
  }
  pinMode(PIN_LEDS, OUTPUT);           // pin 44 = PL5, el que mueve ledsMuestra()
  semilla ^= (uint16_t)analogRead(A0) << 3 | 1;

  aplicaModo();
  tono(800, 100);
  fxRestaurar();                       // si hay luces guardadas, vuelven solas
  { uint8_t t = EEPROM.read(EE_TRIM); trim = (t == 0xFF) ? 0 : constrain((int8_t)t, -30, 30); }
  if (pgmValido() && (pgmBanderas() & 1)) {   // show guardado que arranca solo, a los 2,5 s
    modo = MODO_SHOW;
    showT0 = millis() + 2500;
  }
  fnCargar();
  if (fnModo && EEPROM.read(FN_DIR + 2)) fnEspera = millis() + 2500;   // arranca sola, a los 2,5 s
  sumaEE(EE_BOOT);
  uint8_t minimo = EEPROM.read(EE_MIN);
  Serial.print(F("INFO BOOT="));
  Serial.print(cuentaEE(EE_BOOT));
  Serial.print(F(" BTN="));
  Serial.print(cuentaEE(EE_BTN));
  Serial.print(F(" RUN="));
  Serial.print(cuentaEE(EE_RUN));
  Serial.print(F(" MIN="));
  imprimeDec(minimo == 0xFF ? 0 : minimo, 1);
  Serial.print(F(" BAT="));
  imprimeDec(bateriaCv(), 2);
  Serial.print(F(" TRIM="));
  Serial.print((int)trim);
  Serial.println();
  Serial.println(F("mBot Ranger web v1 listo"));
}

void loop() {
  atiendeUSB();
  fxPaso();

  // Cambio de modo con el botón (con antirrebote): 0, 1, 2, 3 y, si hay show guardado, 5.
  // De 3 sin show, de 4 (página) y de 5 vuelve a 0.
  // Con la página al mando (mandó algo en los últimos 15 s) el botón de la placa se ignora: sus pulsaciones
  // falsas por ruido cambiaban de modo solas (luz azul y paro). Para parar está el Paro de la página.
  const bool paginaAlMando = ultimaOrden != 0 && millis() - ultimaOrden < 15000UL;
  if (!paginaAlMando && botonFlanco() && botonSostenido() && millis() - ultimoBoton > 300) {
    ultimoBoton = millis();
    sumaEE(EE_BTN);
    if (modo == 3 && pgmValido()) { modo = MODO_SHOW; showT0 = millis() + 600; }
    else if ((modo == 3 || modo == MODO_SHOW) && fnModo == 6) modo = 6;   // la línea guardada, tras el show
    else modo = (modo >= 3) ? 0 : modo + 1;
    aplicaModo();
    Serial.print(F("BTN "));
    Serial.println(modo);
  }

  if (modo != 0) fnEspera = 0;         // si la página o el botón tomaron el control, no arranca sola
  if (fnEspera && millis() >= fnEspera) {
    fnEspera = 0;
    modo = fnModo;
    aplicaModo();
  }

  switch (modo) {
    case 1: esquivar();    break;
    case 2: seguir();      break;
    case 3: testMotores(); break;
    case MODO_SHOW: if ((long)(millis() - showT0) >= 0) correShow(); break;
#if SEGUIDOR_LINEA
    case 6: seguirLinea(); break;
#endif
    default: break;
  }

  // Seguro: si la página se calla con los motores andando, se paran solos
  if (modo == MODO_WEB && moviendo && millis() - ultimaOrden > SIN_ORDENES_MS) {
    parar();
    Serial.println(F("WDT"));
  }
}
