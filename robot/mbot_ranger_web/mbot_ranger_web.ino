/*
  mBot Ranger (Me Auriga) con control desde la página del CECyTE (Web Serial)

  Es el sketch "tanquecito" de siempre (modos con el botón de la placa) más un puerto
  serie de texto, para que la página le mande notas, colores y movimientos en vivo.

  Modos (botón de la placa):
    0 = Reposo (LEDs azules)         1 = Esquivar obstáculos (verde)
    2 = Seguir objeto con la mano (amarillo)
    4 = Página (la manda la web; el botón vuelve a 0)   5 = Baile o función guardados (sin la página)

  Órdenes por USB, 115200 baudios, una por línea. Cada una responde OK, ERR ... o PONG:
    PING             -> PONG mbot-web 1
    T hz ms          suena una nota (hz 40..8000, ms 1..5000)
    W ms             espera sin sonar (0..5000)
    M izq der        motores -235..235 (positivo = adelante; arriba de 180 solo para el turbo); toma el control (modo 4)
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
    SPD n            velocidad de esquivar y seguir la mano, 40..230
    MODE n           cambia de modo (0..5; 5 = el baile guardado, solo, sin la página)
    FSAVE m [1]      guarda la función m (1 esquivar, 2 seguir la mano); con 1 arranca sola 2,5 s después de
                     encender. FCLR la borra
    BAT              responde "BAT 7.42" (voltaje de la batería)
    DIST             responde "DIST 23" (cm al obstáculo de enfrente; 400 = sin eco). El mando lo usa para frenar solo
    LINEA clave valor ajustes del seguidor de línea (puerto 9): vel 40..150, giro 10..100, buscar ms, color 0/1
    H0               modo dirección: pone el rumbo actual como cero (con el robot quieto); H1 lo apaga
    H grados v       va hacia ese rumbo (-180..180, positivo = derecha del cero): gira hacia él y avanza con velocidad v; v = 0 frena
    HG               responde "HG 90": el rumbo actual en grados
    G n              gira n grados (-360..360, positivo = derecha) con el giroscopio; INFO trae GIRO=1 si lo hay
    PADD G grados    en el show: gira esos grados (como G)
    MODE 7         se acerca despacio a lo de enfrente y se detiene a 10 cm, pitando más rápido al acercarse (PARK=1 en INFO)
    PADD O modo s    en el show: corre el modo (1, 2, 6 o 7) durante s segundos (1..255) y sigue con lo siguiente
    SENS             responde "SENS 01": lo que ven los dos sensores de línea (1 = nivel alto)
    DIR i|d|x|o      direccional izquierda, derecha, intermitentes o apagar (se apaga sola a los 4 s sin repetir)
    LUZ f|r|o        luz de freno (roja), de reversa (blanca con pitido) o apagar
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
  DDRK |= _BV(PK3);
  PORTK &= ~_BV(PK3);
  delayMicroseconds(2);
  PORTK |= _BV(PK3);
  delayMicroseconds(10);
  PORTK &= ~_BV(PK3);
  DDRK &= ~_BV(PK3);
  unsigned long us = pulseIn(A11, HIGH, 30000UL);
  return us == 0 ? 400 : (int)(us / 58);
}

// Motores del Auriga (motor 0 = SLOT1, motor 1 = SLOT2): PWM en OC1A (pin 11) y OC2A (pin 10), sentido en PL0/PL1 y PL2/PL3
// (pines 49/48 y 47/46). Se escriben los registros directo: digitalWrite, pinMode y analogWrite de Arduino pesan ~700 bytes.
int motUltimo[2] = { 1000, 1000 };
// Corrección de rumbo (orden TRIM, -30..30): dos motores nunca son idénticos y el robot se va de un lado.
// Positivo = la rueda derecha va a (100 - n) %, así gira hacia la derecha; negativo = la izquierda se frena.
const int EE_TRIM = 3041;
int8_t trim = 0;
void motorPwm(uint8_t m, int pwm) {
  pwm = constrain(pwm, -255, 255);
  if (pwm == motUltimo[m]) return;
  motUltimo[m] = pwm;
  const uint8_t h1 = m ? _BV(PL2) : _BV(PL0), h2 = m ? _BV(PL3) : _BV(PL1);
  if (pwm < 0) {
    PORTL &= ~h1;
    delayMicroseconds(5);
    PORTL |= h2;
  } else {
    PORTL |= h1;
    delayMicroseconds(5);
    PORTL &= ~h2;
  }
  const uint8_t v = abs(pwm);
  const uint8_t pin = m ? _BV(PB4) : _BV(PB5);
  const uint8_t com = m ? _BV(COM2A1) : _BV(COM1A1);
  volatile uint8_t *tccr = m ? &TCCR2A : &TCCR1A;
  if (v == 0 || v == 255) {
    *tccr &= ~com;
    if (v) PORTB |= pin; else PORTB &= ~pin;
  } else {
    if (m) OCR2A = v; else OCR1A = v;
    *tccr |= com;
  }
}

const int VEL = 150;                 // 0 a 255. Con 90 las orugas no vencían la fricción: zumbaban sin avanzar
int velFn = VEL;                     // velocidad de esquivar y seguir la mano (orden SPD; se guarda con la función)
const int VEL_MAX = 180;             // tope de lo que puede pedir la página (programas guardados, baile y funciones)
const int VEL_TURBO = 235;           // tope de la orden M (modo turbo del mando); la rampa de motores() evita el tirón de corriente
const int DIST_OBSTACULO = 18;       // cm: a menos de esto esquiva (con 20 reaccionaba muy pronto; con 10, se pegaba a las paredes)
const int MODO_WEB = 4;
const int MODO_SHOW = 5;             // el show guardado en la EEPROM: suena y baila solo
const int MODO_LINEA = 6;            // seguir la línea con el módulo Me Line Follower del puerto 9 (solo por la página)
const int MODO_PARK = 7;
bool lnUsa = false;                  // la página ya habló del módulo: el puerto 9 comparte el pin A7 con el botón de la placa
unsigned long lnT0 = 0;
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
bool rumboOn = false;                // modo dirección: el giroscopio lleva la cuenta del rumbo (orden H0)
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
void imprimeBat() {                                        // 742 -> "7.42"
  const int cv = bateriaCv();
  Serial.print(cv / 100);
  Serial.print('.');
  if (cv % 100 < 10) Serial.print('0');
  Serial.print(cv % 100);
}

// izq y der: positivo = esa rueda va hacia adelante.
// Las ruedas suben en rampa (16 de PWM cada 12 ms): pedirle de golpe toda la corriente a la batería
// hunde el voltaje y la placa se puede reiniciar. Parar, en cambio, es inmediato.
// motores() solo fija el objetivo; la rampa avanza dentro de drenar(), que corre en toda espera y en
// todo tono, así no se frena la música.
int izqAct = 0, derAct = 0, izqObj = 0, derObj = 0;
unsigned long rampaT = 0;
void rampa() {
  unsigned long t = millis();
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
  // El motor 0 es la rueda derecha (y va con signo invertido) y el motor 1 la izquierda: así «izq» y «der» son
  // las ruedas de verdad (probado con el robot en el aire: antes M 120 0 movía la rueda derecha)
  motorPwm(0, -ld);
  motorPwm(1, li);
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
  rumboOn = false;
  parar();
  tonoApaga();
  escEstado = 0;
  musP = 0;
  musT = millis() + 1500;               // si la página manda la música, tiene tiempo de adelantarse
  lnT0 = 0;
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

// ---------- Botón de la placa ----------
// Cuenta solo el instante de pulsar, y solo si el botón se vio suelto al menos una vez desde que
// enciende. Así un botón que lee "presionado" siempre (placa sin batería, botón atorado) no cambia
// de modo ni echa a andar los motores solo.
// Además es estricto con el ruido: "suelto" solo cuenta si la lectura es claramente alta (> 500) y
// "presionado" solo si se mantiene baja (< 60) durante 60 ms; los valores de en medio no cuentan.
bool botonLiberado = false;
bool botonAntes = false;
unsigned long botonBajoDesde = 0;
bool botonFlanco() {
  if (lnUsa) return false;
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
  PORTL &= ~_BV(PL4);
  tonoFin = 0;
}

void tonoInicia(int hz) {                  // enciende el zumbador y sigue: lo apaga tonoApaga() o drenar() al vencer tonoFin
  unsigned long ciclos = 16000000UL / (unsigned long)hz;    // con prescaler 1
  uint8_t cs = 1;
  if (ciclos > 65536UL) { cs = 2; ciclos /= 8; }            // graves: prescaler 8
  uint16_t tope = (uint16_t)(ciclos - 1);
  uint32_t ancho = (uint32_t)tope * anchoPermil() / 1000UL;
  if (ancho < 1) ancho = 1;
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

bool hex36(const char *h, uint8_t *v) {
  for (int i = 0; i < 36; i++) {
    int hi = nibble(h[2 * i]), lo = nibble(h[2 * i + 1]);
    if (hi < 0 || lo < 0) return false;
    v[i] = hi * 16 + lo;
  }
  return true;
}

bool ledsHex(const char *h) {
  uint8_t v[36];
  if (!hex36(h, v)) return false;
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

bool fxCarga(const char *h) { return hex36(h, &fxBase[0][0]); }

uint8_t dirSenal = 0, luzSenal = 0, senalVista = 0, senalFase = 0;
uint8_t anilloGuardado[36];
unsigned long senalVence = 0, reversaT = 0;

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
  if (fxModo == 0 || dirSenal || luzSenal) return;         // fijo: nada que animar
  unsigned long t = millis();
  if (t - fxUltimo < FX_MS || t - ultimaOrden < FX_QUIETO_MS) return;
  if (fxModo == 4) {                                       // solo cuando hay un color nuevo
    if (!fxSucio) return;
    fxSucio = false;
  }
  fxUltimo = t;
  fxDibuja();
}

void senalPaso() {
  const uint8_t s = dirSenal ? dirSenal : luzSenal;
  if (s && (long)(millis() - senalVence) > 0) { dirSenal = 0; luzSenal = 0; }
  if (!(dirSenal ? dirSenal : luzSenal)) {
    if (senalVista) {
      memcpy(anillo, anilloGuardado, 36);
      ledsMuestra();
      senalVista = 0;
      fxSucio = true;
    }
    return;
  }
  if (s == 5 && millis() >= reversaT) {
    reversaT = millis() + 900;
    if (volumen) { tonoInicia(1200); tonoFin = millis() + 90; }
  }
  const uint8_t fase = (s <= 3 || s == 5) ? (millis() / 350UL) & 1 : 0;
  if (s == senalVista && fase == senalFase) return;
  if (!senalVista) memcpy(anilloGuardado, anillo, 36);
  senalVista = s;
  senalFase = fase;
  ledsTodos(0, 0, 0);
  static const uint8_t esquinaI[4] = { 0, 1, 9, 10 }, esquinaD[4] = { 3, 4, 6, 7 };
  if ((s == 1 || s == 3) && fase) for (uint8_t i = 0; i < 4; i++) ledPon(esquinaI[i], 150, 60, 0);
  if ((s == 2 || s == 3) && fase) for (uint8_t i = 0; i < 4; i++) ledPon(esquinaD[i], 150, 60, 0);
  if (s == 5 && fase) ledsTodos(150, 0, 0);
  ledsMuestra();
}

// ---------- Seguidor de línea (módulo Me Line Follower: dos sensores digitales, puerto 9) ----------
// Con dos sensores solo se sabe a qué lado se ve la línea, así que la dirección es un valor suave (lnS, -255 izquierda
// a 255 derecha) que sube mientras un sensor ve la línea, se relaja en cuanto vuelve a quedar entre los dos y, si la
// pierde, sigue creciendo hacia el último lado (arco cada vez más cerrado, y luego hacia el otro lado) hasta hallarla.
// En las curvas baja la velocidad. Ajustes por la orden LINEA (en RAM): vel, giro, buscar, color.
void lnInicia() { DDRF &= ~_BV(PF7); DDRK &= ~_BV(PK4); }
uint8_t lnLee(uint8_t i) { return i ? (PINK >> 4) & 1 : (PINF >> 7) & 1; }
uint8_t lnVel = 120, lnGiro = 55, lnColor = 0;
uint16_t lnBuscarMs = 4000;
int lnS = 0;
int8_t lnLado = 1;
unsigned long lnUlt = 0, lnPerdidoDesde = 0;
uint8_t lnEstado = 255;

void lineaConfig(const char *k, int v) {
  lnUsa = true;
  if (!strcmp(k, "vel")) lnVel = constrain(v, 40, 150);
  else if (!strcmp(k, "giro")) lnGiro = constrain(v, 10, 100);
  else if (!strcmp(k, "buscar")) lnBuscarMs = constrain(v, 0, 10000);
  else if (!strcmp(k, "color")) lnColor = v ? 1 : 0;
}

void seguirLinea() {
  const unsigned long ahora = millis();
  if (lnT0 == 0) {
    lnT0 = ahora;
    lnUlt = ahora;
    lnS = 0;
    lnPerdidoDesde = 0;
    lnEstado = 255;
    lnUsa = true;
    lnInicia();
  }
  const unsigned long dt = ahora - lnUlt;
  if (dt < 5) return;
  lnUlt = ahora;
  const bool s1 = (lnLee(0) == 0) != (lnColor == 1);
  const bool s2 = (lnLee(1) == 0) != (lnColor == 1);
  int objetivo = 0, ritmo = 2;
  uint8_t estado = 1;
  if (s1 != s2) {
    lnLado = s2 ? 1 : -1;
    lnPerdidoDesde = 0;
    objetivo = lnLado * 255;
    ritmo = 1;
  } else if (s1 && s2) {
    lnPerdidoDesde = 0;
    ritmo = 3;
  } else {
    if (lnPerdidoDesde == 0) lnPerdidoDesde = ahora;
    const unsigned long perdido = ahora - lnPerdidoDesde;
    if (perdido < 200) {
      ritmo = 2;
    } else if (perdido > lnBuscarMs) {
      parar();
      modo = 0;
      aplicaModo();
      return;
    } else {
      estado = 0;
      const int8_t lado = ((perdido / 1200UL) & 1) ? -lnLado : lnLado;
      objetivo = lado * 255;
      ritmo = 1;
    }
  }
  const int paso = (int)(constrain(dt, 5UL, 100UL) * (ritmo == 1 ? 1 : ritmo == 2 ? 2 : 3));
  lnS += constrain(objetivo - lnS, -paso, paso);
  if (estado != lnEstado) {
    lnEstado = estado;
    if (fxModo == 0) { if (estado) color(0, 40, 0); else color(40, 0, 0); }
  }
  const int g = lnS < 0 ? -lnS : lnS;
  const int v = (int)((long)lnVel * (510 - g) / 510);
  const int c = (int)((long)v * lnGiro * 2 * g / 25500L);
  if (lnS < 0) motores(v - c, v); else motores(v, v - c);
}

unsigned long parkT = 0, parkBip = 0;
void parkPaso() {
  const unsigned long t = millis();
  if (t - parkT < 60) return;
  parkT = t;
  const int d = distanciaCm();
  if (d <= 10) {
    parar();
    tono(1500, 300);
    modo = 0;
    return;
  }
  adelante(d > 40 ? 130 : 110);
  if (volumen && (long)(t - parkBip) >= 0) {
    tonoInicia(1200);
    tonoFin = t + 40;
    parkBip = t + constrain(d * 8, 80, 700);
  }
}

const uint8_t GYRO_DIR = 0x69 << 1;
const int GIRO_ADEL = 3;
bool giroOk = false;
bool twiCmd(uint8_t c) {
  TWCR = _BV(TWINT) | c | _BV(TWEN);
  for (uint16_t n = 0; n < 30000; n++) if (TWCR & _BV(TWINT)) return true;
  return false;
}
bool twiTx(uint8_t d) { TWDR = d; return twiCmd(0); }
bool gyroEscribe(uint8_t reg, uint8_t v) {
  const bool bien = twiCmd(_BV(TWSTA)) && twiTx(GYRO_DIR) && (TWSR & 0xF8) == 0x18 && twiTx(reg) && twiTx(v);
  TWCR = _BV(TWINT) | _BV(TWSTO) | _BV(TWEN);
  return bien;
}
int16_t gyroZ() {
  int16_t v = 0;
  if (twiCmd(_BV(TWSTA)) && twiTx(GYRO_DIR) && twiTx(0x47) && twiCmd(_BV(TWSTA)) && twiTx(GYRO_DIR | 1) && twiCmd(_BV(TWEA))) {
    v = (int16_t)TWDR << 8;
    if (twiCmd(0)) v |= TWDR;
  }
  TWCR = _BV(TWINT) | _BV(TWSTO) | _BV(TWEN);
  return v;
}
void gyroIni() {
  PORTD |= 3;
  TWSR = 0;
  TWBR = 72;
  giroOk = gyroEscribe(0x6B, 0) && gyroEscribe(0x1A, 3);
}

long calibraGiro() {
  parar();
  espera(120);
  long s = 0;
  for (uint8_t i = 0; i < 16; i++) { s += gyroZ(); espera(3); }
  return s >> 4;
}

long rumbo = 0, rumboRep = 0;
unsigned long rumboT = 0;
void rumboPaso() {
  if (!rumboOn) return;
  const unsigned long t = millis();
  if (t - rumboT < 4) return;
  rumbo += (long)(gyroZ() - rumboRep) * (long)(t - rumboT);
  rumboT = t;
}
void rumboInicia() {
  rumboRep = calibraGiro();
  rumbo = 0;
  rumboT = millis();
  rumboOn = true;
}
int rumboGrados() { return (int)((65536L - rumbo) >> 17); }
void rumboMueve(int obj, int v) {
  if (v <= 0) { parar(); return; }
  int e = obj - rumboGrados();
  while (e > 180) e -= 360;
  while (e < -180) e += 360;
  const int a = e < 0 ? -e : e;
  const int fwd = a >= 64 ? 0 : (v * (64 - a)) >> 6;
  const int g = a < 4 ? 0 : constrain(a * 2 + 100, 110, 150);
  const int s = e > 0 ? g : -g, tope = max(v, g);
  motores(constrain(fwd + s, -tope, tope), constrain(fwd - s, -tope, tope));
}

void giroGrados(int grados) {
  const int g = grados < 0 ? -grados : grados;
  if (!g || !giroOk) { parar(); return; }
  rumboInicia();
  if (grados > 0) giraDer(140); else giraIzq(140);
  const unsigned long t0 = millis(), tope = min((unsigned long)g * 25 + 1200, 5000UL);
  while (!abortar && millis() - t0 < tope) {
    espera(3);
    rumboPaso();
    const int r = rumboGrados();
    if ((r < 0 ? -r : r) >= g - GIRO_ADEL) break;
  }
  parar();
  rumboOn = false;
}

void pasoModo() {
  switch (modo) {
    case 1: esquivar(); break;
    case 2: seguir(); break;
    case MODO_LINEA: seguirLinea(); break;
    case MODO_PARK: parkPaso(); break;
  }
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

// Música de fondo de las funciones guardadas (esquivar y seguir la mano): toca las notas T y W del show
// guardado con la bandera 4, sin esperarlas, y las repite. La llama drenar(), que corre en toda espera.
void musicaFondo() {
  if (!(modo == 1 || modo == 2) || abortar) return;
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
      } else if (op == 5 && p + 2 <= largo) {
        const int m = EEPROM.read(PGM_DIR + 4 + p);
        const unsigned long fin = millis() + 1000UL * EEPROM.read(PGM_DIR + 4 + p + 1);
        p += 2;
        modo = m;
        aplicaModo();
        bool corta = false;
        while ((long)(millis() - fin) < 0 && modo == m) {
          pasoModo();
          fxPaso();
          if (showCortar()) { corta = true; break; }
        }
        parar();
        if (corta) { modo = 0; break; }
        modo = MODO_SHOW;
      } else if (op == 6 && p + 2 <= largo) {
        giroGrados((int)(EEPROM.read(PGM_DIR + 4 + p) | (EEPROM.read(PGM_DIR + 4 + p + 1) << 8)));
        p += 2;
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

// ---------- Función guardada (esquivar o seguir la mano) ----------
// Al encenderlo (si se marcó) o con el botón de la placa, el robot la hace sin la página.
// 4 bytes en la EEPROM: magia, modo, arranca solo y velocidad.
const int FN_DIR = 2950;
const uint8_t FN_MAGICO = 0xC4;
int fnModo = 0;                       // 0 = no hay función guardada
unsigned long fnEspera = 0;           // si no es 0, arranca a esta hora (para dejarlo en el piso)

void fnGuardar(int m, bool solo) {
  EEPROM.update(FN_DIR + 1, m);
  EEPROM.update(FN_DIR + 2, solo ? 1 : 0);
  EEPROM.update(FN_DIR + 3, velFn);
  EEPROM.update(FN_DIR, FN_MAGICO);     // al final: nunca queda a medias
  fnModo = m;
}

void fnCargar() {
  if (EEPROM.read(FN_DIR) != FN_MAGICO) return;
  int m = EEPROM.read(FN_DIR + 1);
  if (m != 1 && m != 2) return;
  fnModo = m;
  const uint8_t v = EEPROM.read(FN_DIR + 3);
  if (v >= 40 && v <= 230) velFn = v;
}

// ---------- Órdenes ----------
void imprimeInfo() {
  Serial.print(F("INFO BAT="));
  imprimeBat();
  Serial.print(F(" TRIM="));
  Serial.print((int)trim);
  Serial.print(F(" PARK=1 GIRO="));
  Serial.print(giroOk ? 1 : 0);
  Serial.println();
}

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
    if (modo == 1 || modo == 2) {                       // esquivar y seguir: la nota suena sin frenar al robot
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
    motores(constrain(atoi(a), -VEL_TURBO, VEL_TURBO), constrain(atoi(b), -VEL_TURBO, VEL_TURBO));
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
    imprimeBat();
    Serial.println();
  } else if (!strcmp(cmd, "DIST")) {
    Serial.print(F("DIST "));
    Serial.println(distanciaCm());
  } else if (!strcmp(cmd, "DIR") && a) {
    const char k = a[0];
    dirSenal = k == 'i' ? 1 : k == 'd' ? 2 : k == 'x' ? 3 : 0;
    senalVence = millis() + 4000UL;
    ok();
  } else if (!strcmp(cmd, "LUZ") && a) {
    const char k = a[0];
    luzSenal = k == 'f' ? 4 : k == 'r' ? 5 : 0;
    senalVence = millis() + 4000UL;
    ok();
  } else if (!strcmp(cmd, "INFO")) {
    imprimeInfo();
    ok();
  } else if (!strcmp(cmd, "LINEA") && a && b) {
    lineaConfig(a, atoi(b));
    ok();
  } else if (!strcmp(cmd, "SENS")) {
    lnUsa = true;
    lnInicia();
    Serial.print(F("SENS "));
    Serial.print(lnLee(0));
    Serial.println(lnLee(1));
  } else if (!strcmp(cmd, "H0")) {
    if (!giroOk) { err(F("giro")); }
    else {
      if (modo != MODO_WEB) { modo = MODO_WEB; aplicaModo(); }
      rumboInicia();
      ok();
    }
  } else if (!strcmp(cmd, "H1")) {
    rumboOn = false;
    parar();
    ok();
  } else if (!strcmp(cmd, "H") && a && b) {
    if (!rumboOn) { err(F("rumbo")); }
    else {
      rumboMueve(constrain(atoi(a), -180, 180), constrain(atoi(b), 0, VEL_TURBO));
      ok();
    }
  } else if (!strcmp(cmd, "HG")) {
    Serial.print(F("HG "));
    Serial.println(rumboGrados());
  } else if (!strcmp(cmd, "G") && a) {
    if (giroOk) { giroGrados(constrain(atoi(a), -360, 360)); ok(); } else err(F("giro"));
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
    } else if (!strcmp(a, "G") && b) {
      const int g = constrain(atoi(b), -360, 360);
      bien = pgmPon(6) && pgmPon(g & 0xFF) && pgmPon(g >> 8);
    } else if (!strcmp(a, "O") && b && c) {
      bien = pgmPon(5) && pgmPon(constrain(atoi(b), 0, MODO_PARK)) && pgmPon(constrain(atoi(c), 1, 255));
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
    if (m != 1 && m != 2) { err(F("modo")); }
    else { fnGuardar(m, b && atoi(b) != 0); ok(); }
  } else if (!strcmp(cmd, "FCLR")) {
    EEPROM.update(FN_DIR, 0);
    fnModo = 0;
    ok();
  } else if (!strcmp(cmd, "MODE") && a) {
    int n = atoi(a);
    if (n < 0 || n > MODO_PARK) { err(F("modo")); }
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

  DDRB |= _BV(PB4) | _BV(PB5);
  DDRL |= _BV(PL0) | _BV(PL1) | _BV(PL2) | _BV(PL3) | _BV(PL4) | _BV(PL5);   // sentido de motores, zumbador (45) y anillo (44)
  semilla ^= (uint16_t)analogRead(A0) << 3 | 1;

  aplicaModo();
  tono(800, 100);
  fxRestaurar();                       // si hay luces guardadas, vuelven solas
  { uint8_t t = EEPROM.read(EE_TRIM); trim = (t == 0xFF) ? 0 : constrain((int8_t)t, -30, 30); }
  if (pgmValido() && (pgmBanderas() & 1)) {   // show guardado que arranca solo, a los 2,5 s
    modo = MODO_SHOW;
    showT0 = millis() + 2500;
  }
  gyroIni();
  fnCargar();
  if (fnModo && EEPROM.read(FN_DIR + 2)) fnEspera = millis() + 2500;   // arranca sola, a los 2,5 s
  imprimeInfo();
  Serial.println(F("mBot Ranger web v1 listo"));
}

void loop() {
  atiendeUSB();
  rumboPaso();
  fxPaso();
  senalPaso();

  // Cambio de modo con el botón (con antirrebote): 0, 1, 2 y, si hay show guardado, 5.
  // De 2 sin show, de 4 (página) y de 5 vuelve a 0.
  // Con la página al mando (mandó algo en los últimos 15 s) el botón de la placa se ignora: sus pulsaciones
  // falsas por ruido cambiaban de modo solas (luz azul y paro). Para parar está el Paro de la página.
  const bool paginaAlMando = ultimaOrden != 0 && millis() - ultimaOrden < 15000UL;
  if (!paginaAlMando && botonFlanco() && botonSostenido() && millis() - ultimoBoton > 300) {
    ultimoBoton = millis();
    if (modo == 2 && pgmValido()) { modo = MODO_SHOW; showT0 = millis() + 600; }
    else modo = (modo >= 2) ? 0 : modo + 1;
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
    case MODO_SHOW: if ((long)(millis() - showT0) >= 0) correShow(); break;
    default: pasoModo(); break;
  }

  // Seguro: si la página se calla con los motores andando, se paran solos
  if (modo == MODO_WEB && moviendo && millis() - ultimaOrden > SIN_ORDENES_MS) {
    parar();
    Serial.println(F("WDT"));
  }
}
