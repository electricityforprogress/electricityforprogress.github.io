/*
 * =========================================================================================
 * Project: BioStrike - Solenoid Percussion Controller & Interface (BLE-Only Edition)
 * Hardware: Seeed Studio XIAO ESP32-S3
 * Architecture: Dual BLE (Native Bluedroid) - BLE MIDI (Input) & BLE GATT/NUS (Web UI Config)
 * =========================================================================================
 * 
 * DESCRIPTION:
 * BioStrike translates incoming BLE MIDI data into precisely timed, velocity-mapped PWM 
 * pulses to drive multi-channel solenoid actuators. Designed for kinetic sound art and 
 * acoustic instrument sonification, it features a dual-connection BLE architecture. The 
 * ESP32 concurrently hosts a standard BLE MIDI service for DAW/Sequencer control and a 
 * Nordic UART Service (NUS) for real-time telemetry and parameter tuning via an external 
 * Web Bluetooth app. Channel configurations are saved to non-volatile flash memory.
 *
 * POWER ARCHITECTURE:
 * - Solenoids run on an external 12V DC power rail.
 * - An onboard 12V to 5V DC-DC buck converter steps down the high-current solenoid supply 
 *   to 5V to safely power the XIAO ESP32-S3 via its VIN pin.
 *
 * OPTOCOUPLER & MOSFET DRIVER NOTES (3.3V LOGIC LEVEL COMPATIBILITY):
 * Common commercial MOSFET breakout modules often utilize optocouplers (e.g., PC817) with 
 * input networks tuned strictly for 5V microcontroller logic. When driving these from the 
 * 3.3V logic pins of the XIAO ESP32-S3, users frequently observe unreliable triggering or 
 * weak gate saturation.
 * 
 * Troubleshooting & Modification Guidelines:
 * 1. Current Limiting Resistor Values: The root issue is often incorrect series resistor 
 *    values sized for 5V rather than 3.3V, failing to provide the recommended forward 
 *    current (If) required by the optocoupler's internal infrared diode. Experimenting with 
 *    swapping out the input series resistor for a lower resistance value will ensure full 
 *    optocoupler activation while keeping the indicator LED intact.
 * 2. LED Forward Voltage Drops & Colors: The onboard indicator LEDs (especially green, blue, 
 *    or white with ~2.8V-3.2V forward voltages) wired in series or parallel with the optocoupler 
 *    starve the circuit when driven by 3.3V. 
 * 3. LED Removal / Isolation: If gate drive issues persist, it is highly recommended to remove 
 *    the indicator LED or desolder its current-limiting resistor entirely. Eliminating this 
 *    redundant current draw frees up the pin's drive capacity, ensuring crisp, fast optical 
 *    triggering directly from the 3.3V GPIO line.
 * =========================================================================================
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Preferences.h>

// --- UUIDs ---
#define MIDI_SERVICE_UUID        "03b80e5a-ede8-4b33-a751-6ce34ec4c700"
#define MIDI_CHARACTERISTIC_UUID "7772e5db-3868-4112-a1a9-f2669d106bf3"

#define UART_SERVICE_UUID        "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define UART_RX_CHAR_UUID        "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define UART_TX_CHAR_UUID        "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

// --- Hardware Setup ---
const int PWM_FREQ = 20000;
const int PWM_RES = 8;
uint8_t globalMidiChannel = 0; // 0 = Omni

struct Solenoid {
  uint8_t pin;
  uint8_t noteNumber;
  uint8_t minPwm;
  uint8_t maxPwm;
  uint8_t duration;
  unsigned long startTime;
  bool active;
};

// Default mappings for channels 0 to 3
Solenoid solenoids[4] = {
  {1, 36, 120, 255, 40, 0, false},
  {2, 38, 100, 255, 30, 0, false},
  {3, 42, 80,  200, 15, 0, false},
  {4, 45, 110, 255, 35, 0, false}
};

Preferences prefs;

// --- BLE Server & Pipeline State ---
BLEServer *pServer = NULL;
BLECharacteristic *pMidiCharacteristic = NULL;
BLECharacteristic *pUartTxCharacteristic = NULL;
BLECharacteristic *pUartRxCharacteristic = NULL;

uint32_t connectedClients = 0;
bool gattConnected = false;


// --- Solenoid Actuation & GATT Telemetry ---
void fireSolenoid(uint8_t ch, uint8_t velocity) {
  if (ch > 3) return;

  uint8_t targetPwm = map(velocity, 1, 127, solenoids[ch].minPwm, solenoids[ch].maxPwm);
  targetPwm = constrain(targetPwm, solenoids[ch].minPwm, solenoids[ch].maxPwm);

  ledcWrite(solenoids[ch].pin, targetPwm);
  solenoids[ch].startTime = millis();
  solenoids[ch].active = true;

  // Ultra-compact strike telemetry notification: S:<ch>:<velocity>\n
  if (gattConnected && pUartTxCharacteristic != NULL) {
    char strikeMsg[16];
    snprintf(strikeMsg, sizeof(strikeMsg), "S:%d:%d\n", ch, velocity);
    pUartTxCharacteristic->setValue((uint8_t*)strikeMsg, strlen(strikeMsg));
    pUartTxCharacteristic->notify();
  }
}

void onNoteOn(uint8_t channel, uint8_t note, uint8_t velocity) {
  if (globalMidiChannel != 0 && channel != globalMidiChannel) return;

  for (int i = 0; i < 4; i++) {
    if (note == solenoids[i].noteNumber) {
      fireSolenoid(i, velocity);
    }
  }
}

// --- Persistence Helpers ---
void saveChannelSettings(uint8_t ch) {
  if (ch > 3) return;
  char key[8];
  snprintf(key, sizeof(key), "n%d", ch);    prefs.putUInt(key, solenoids[ch].noteNumber);
  snprintf(key, sizeof(key), "pMin%d", ch); prefs.putUInt(key, solenoids[ch].minPwm);
  snprintf(key, sizeof(key), "pMax%d", ch); prefs.putUInt(key, solenoids[ch].maxPwm);
  snprintf(key, sizeof(key), "d%d", ch);    prefs.putUInt(key, solenoids[ch].duration);
}

void sendFullConfigOverGatt() {
  if (!gattConnected || pUartTxCharacteristic == NULL) return;
  
  // Format: CFG:<gCh>:<ch0_note>,<min>,<max>,<dur>:<ch1...>\n
  char cfgMsg[128];
  snprintf(cfgMsg, sizeof(cfgMsg), "CFG:%d:%d,%d,%d,%d:%d,%d,%d,%d:%d,%d,%d,%d:%d,%d,%d,%d\n",
    globalMidiChannel,
    solenoids[0].noteNumber, solenoids[0].minPwm, solenoids[0].maxPwm, solenoids[0].duration,
    solenoids[1].noteNumber, solenoids[1].minPwm, solenoids[1].maxPwm, solenoids[1].duration,
    solenoids[2].noteNumber, solenoids[2].minPwm, solenoids[2].maxPwm, solenoids[2].duration,
    solenoids[3].noteNumber, solenoids[3].minPwm, solenoids[3].maxPwm, solenoids[3].duration
  );
  pUartTxCharacteristic->setValue((uint8_t*)cfgMsg, strlen(cfgMsg));
  pUartTxCharacteristic->notify();
}

// --- BLE Callbacks ---
class MultiPeerServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    connectedClients++;
    Serial.printf("[BLE] Device Connected. Total Clients: %d\n", connectedClients);
    pServer->startAdvertising(); // Keep advertising for secondary devices
  }

  void onDisconnect(BLEServer* pServer) {
    if (connectedClients > 0) connectedClients--;
    Serial.printf("[BLE] Device Disconnected. Total Clients: %d\n", connectedClients);
    pServer->startAdvertising();
  }
};

class MidiRxCallbacks: public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) {
    uint8_t* rxData = pChar->getData();
    size_t length = pChar->getLength();

    if (length >= 5) {
      uint8_t status = rxData[2];
      uint8_t note = rxData[3];
      uint8_t velocity = rxData[4];

      if ((status & 0xF0) == 0x90 && velocity > 0) {
        uint8_t channel = (status & 0x0F) + 1;
        Serial.printf("[MIDI IN] Ch: %d | Note: %d | Vel: %d\n", channel, note, velocity);
        onNoteOn(channel, note, velocity);
      }
    }
  }
};

class UartRxCallbacks: public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) {
    uint8_t* data = pChar->getData();
    size_t len = pChar->getLength();
    if (len == 0) return;

    char cmd[64];
    size_t copyLen = min(len, sizeof(cmd) - 1);
    memcpy(cmd, data, copyLen);
    cmd[copyLen] = '\0';
    
    Serial.printf("[GATT IN] %s", cmd); 

    // 1. Initial State Request: '?'
     if (cmd[0] == '?') {
      gattConnected = true;
      sendFullConfigOverGatt();
      return;
    }

    // 2. Real-time Live Tuning: 'L:<ch>:<param>:<val>'
    if (cmd[0] == 'L' && cmd[1] == ':') {
      int ch, param, val;
      if (sscanf(cmd, "L:%d:%d:%d", &ch, &param, &val) == 3 && ch >= 0 && ch < 4) {
        if (param == 0) solenoids[ch].noteNumber = val;
        else if (param == 1) solenoids[ch].minPwm = val;
        else if (param == 2) solenoids[ch].maxPwm = val;
        else if (param == 3) solenoids[ch].duration = val;
      }
      return;
    }

    // 3. Flash Memory Commit: 'SAVE:<ch>'
    if (strncmp(cmd, "SAVE:", 5) == 0) {
      int ch = atoi(&cmd[5]);
      if (ch >= 0 && ch < 4) saveChannelSettings(ch);
      else if (ch == 99) prefs.putUInt("gCh", globalMidiChannel);
      Serial.println("[SYSTEM] Saved to Flash.");
      return;
    }

    // 4. Test Strike: 'TEST:<ch>:<vel>'
    if (strncmp(cmd, "TEST:", 5) == 0) {
      int ch, vel;
      if (sscanf(cmd, "TEST:%d:%d", &ch, &vel) == 2) fireSolenoid(ch, vel);
      return;
    }

    // 5. Global MIDI Channel: 'GCH:<val>'
    if (strncmp(cmd, "GCH:", 4) == 0) {
      globalMidiChannel = atoi(&cmd[4]);
      return;
    }
  }
};


void setup() {
  Serial.begin(115200);

  // Load Last Session Configuration
  prefs.begin("biostrike", false);
  globalMidiChannel = prefs.getUInt("gCh", 0);

  for (int i = 0; i < 4; i++) {
    char key[8];
    uint8_t defNote = (i == 0) ? 36 : (i == 1) ? 38 : (i == 2) ? 42 : 45;
    snprintf(key, sizeof(key), "n%d", i);    solenoids[i].noteNumber = prefs.getUInt(key, defNote);
    snprintf(key, sizeof(key), "pMin%d", i); solenoids[i].minPwm     = prefs.getUInt(key, 100);
    snprintf(key, sizeof(key), "pMax%d", i); solenoids[i].maxPwm     = prefs.getUInt(key, 255);
    snprintf(key, sizeof(key), "d%d", i);    solenoids[i].duration   = prefs.getUInt(key, 30);

    ledcAttach(solenoids[i].pin, PWM_FREQ, PWM_RES);
    ledcWrite(solenoids[i].pin, 0);
  }

  // BLE Native Initialization
  BLEDevice::init("BioStrike");
  BLEDevice::setMTU(512);

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MultiPeerServerCallbacks());

  // BLE MIDI Service
  BLEService *pMidiService = pServer->createService(MIDI_SERVICE_UUID);
  pMidiCharacteristic = pMidiService->createCharacteristic(
    MIDI_CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ   |
    BLECharacteristic::PROPERTY_NOTIFY |
    BLECharacteristic::PROPERTY_WRITE  |
    BLECharacteristic::PROPERTY_WRITE_NR
  );
  
  pMidiCharacteristic->addDescriptor(new BLE2902());
  pMidiCharacteristic->setCallbacks(new MidiRxCallbacks());
  pMidiService->start();

  // Nordic UART GATT Service
  BLEService *pUartService = pServer->createService(UART_SERVICE_UUID);
  pUartTxCharacteristic = pUartService->createCharacteristic(
    UART_TX_CHAR_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pUartTxCharacteristic->addDescriptor(new BLE2902());

  pUartRxCharacteristic = pUartService->createCharacteristic(
    UART_RX_CHAR_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  pUartRxCharacteristic->setCallbacks(new UartRxCallbacks());
  pUartService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  
  // Put MIDI in the primary advertisement so DAWs see it instantly
  pAdvertising->addServiceUUID(MIDI_SERVICE_UUID);

  // Put Name and UART in the Scan Response packet
  BLEAdvertisementData scanResponseData;
  scanResponseData.setName("BioStrike"); 
  scanResponseData.setCompleteServices(BLEUUID(UART_SERVICE_UUID));
  pAdvertising->setScanResponseData(scanResponseData);

  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[SYSTEM] BioStrike Booted. BLE Advertising Started.");
}

void loop() {

  unsigned long now = millis();
  for (int i = 0; i < 4; i++) {
    if (solenoids[i].active && (now - solenoids[i].startTime >= solenoids[i].duration)) {
      ledcWrite(solenoids[i].pin, 0);
      solenoids[i].active = false;
    }
  }
}