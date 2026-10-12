/*
 * =========================================================================================
 * Project: BioStrike - Solenoid Percussion Controller & Interface
 * Hardware: Seeed Studio XIAO ESP32-S3
 * Architecture: Web Audio/BLE MIDI to Multi-Channel Solenoid Actuator Driver
 * =========================================================================================
 * 
 * DESCRIPTION:
 * BioStrike translates incoming MIDI data (via BLE MIDI and WebSockets) into precisely 
 * timed, velocity-mapped PWM pulses to drive multi-channel solenoid actuators. Designed 
 * for kinetic sound art and acoustic instrument sonification, it features a self-hosted 
 * captive portal web UI for runtime parameter tuning, mDNS discovery, and full ArduinoOTA 
 * support for wireless updates.
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

#include <WiFi.h>
#include <DNSServer.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <ArduinoOTA.h>

#include <Preferences.h>
#include <ArduinoJson.h>
#include "html.h" // Your frontend UI

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define MIDI_SERVICE_UUID        "03b80e5a-ede8-4b33-a751-6ce34ec4c700"
#define MIDI_CHARACTERISTIC_UUID "7772e5db-3868-4112-a1a9-f2669d106bf3"

BLEServer *pServer = NULL;
BLECharacteristic *pMidiCharacteristic = NULL;

// --- Network & BLE ---
const char* mdnsName = "biostrike";
const byte DNS_PORT = 53;

WebServer server(80);
WebSocketsServer webSocket = WebSocketsServer(81);
DNSServer dnsServer;

Preferences prefs;

String savedSSID = "";
String savedPass = "";
bool isAPMode = false;
bool bleConnected = false;

// --- Hardware & Config ---
const int PWM_FREQ = 20000; // 20kHz to eliminate whine
const int PWM_RES = 8;
uint8_t globalMidiChannel = 0;

struct Solenoid {
  uint8_t pin;
  uint8_t channel;
  uint8_t noteNumber;
  uint8_t minPwm;
  uint8_t maxPwm;
  uint8_t duration;
  unsigned long startTime;
  bool active;
};

// Map to your 4 MOSFET channels
Solenoid solenoids[4] = {
  {1, 0, 36, 120, 255, 40, 0, false},
  {2, 1, 38, 100, 255, 30, 0, false},
  {3, 2, 42, 80,  200, 15, 0, false},
  {4, 3, 45, 110, 255, 35, 0, false}
};

// --- Hardware & Routing Logic ---

void fireSolenoid(uint8_t ch, uint8_t velocity) {
  if (ch > 3) return;
  
  uint8_t targetPwm = map(velocity, 1, 127, solenoids[ch].minPwm, solenoids[ch].maxPwm);
  targetPwm = constrain(targetPwm, solenoids[ch].minPwm, solenoids[ch].maxPwm);
  
  // Point to .pin instead of .channel
  ledcWrite(solenoids[ch].pin, targetPwm);
  
  solenoids[ch].startTime = millis();
  solenoids[ch].active = true;

  char msg[20]; 
  sprintf(msg, "strike:%d:%d", ch, velocity);
  webSocket.broadcastTXT(msg);
}

void onNoteOn(byte channel, byte note, byte velocity) {
  // 1. Print every raw incoming note so we aren't blind
  Serial.print("BLE MIDI In -> Ch: ");
  Serial.print(channel);
  Serial.print(" | Note: ");
  Serial.print(note);
  Serial.print(" | Vel: ");
  Serial.println(velocity);

  // 2. Filter by global channel
  if (globalMidiChannel != 0 && channel != globalMidiChannel) {
    Serial.println("  -> Dropped (Wrong MIDI Channel)");
    return; 
  }
  
  // 3. Check against mapped solenoids
  bool matched = false;
  for (int i = 0; i < 4; i++) {
    if (note == solenoids[i].noteNumber) {
      fireSolenoid(i, velocity);
      matched = true;
    }
  }
  
  if (!matched) {
    Serial.println("  -> Dropped (Note not mapped to any solenoid)");
  }
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  if (type == WStype_TEXT) {
    String msg = (char*)payload;
    
// Print every incoming WebSocket message to the Serial monitor
    Serial.print("WS Received: ");
    Serial.println(msg);

    if (msg.startsWith("test:")) {
      // Test strike from UI format: "test:chIndex:velocity"
      int firstColon = msg.indexOf(':');
      int secondColon = msg.indexOf(':', firstColon + 1);
      if(firstColon != -1 && secondColon != -1) {
          uint8_t ch = msg.substring(firstColon + 1, secondColon).toInt();
          uint8_t vel = msg.substring(secondColon + 1).toInt();
          fireSolenoid(ch, vel);
      }
    }
    
    else if (msg.startsWith("wifi:")) {
      int split = msg.indexOf(':', 5);
      
      savedSSID = msg.substring(5, split);
      savedSSID.trim(); // Kills the invisible space on the network name
      
      savedPass = msg.substring(split + 1);
      savedPass.trim(); // Kills the invisible space on the password
      
      prefs.putString("ssid", savedSSID);
      prefs.putString("pass", savedPass);
      
      // Send a quick message back to the UI before pulling the plug
      webSocket.sendTXT(num, "rebooting");
      delay(500); // Give the WebSocket a moment to flush the message
      
      // Reboot the board to apply the new WiFi credentials
      ESP.restart(); 
    }

    else if (msg.startsWith("cfg:")) {
      // Parse the JSON settings payload from UI
      String jsonStr = msg.substring(4);
      StaticJsonDocument<1024> doc;
      DeserializationError error = deserializeJson(doc, jsonStr);
      
      if (!error) {
        globalMidiChannel = doc["globalChannel"];
        prefs.putUInt("gCh", globalMidiChannel);

        JsonArray channels = doc["channels"];
        for (int i = 0; i < 4; i++) {
          solenoids[i].noteNumber = channels[i]["note"];
          solenoids[i].minPwm = channels[i]["minPwm"];
          solenoids[i].maxPwm = channels[i]["maxPwm"];
          solenoids[i].duration = channels[i]["duration"];
          
          // Save to ESP32 Flash memory
          prefs.putUInt(("n" + String(i)).c_str(), solenoids[i].noteNumber);
          prefs.putUInt(("pMin" + String(i)).c_str(), solenoids[i].minPwm);
          prefs.putUInt(("pMax" + String(i)).c_str(), solenoids[i].maxPwm);
          prefs.putUInt(("d" + String(i)).c_str(), solenoids[i].duration);
        }
      }
    }
  } else if (type == WStype_CONNECTED) {
    webSocket.sendTXT(num, bleConnected ? "ble:1" : "ble:0");
    webSocket.sendTXT(num, isAPMode ? "net:Hotspot (BioStrike.local)" : "net:Local WiFi");
  }
}

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) { bleConnected = true; }
    void onDisconnect(BLEServer* pServer) { bleConnected = false; pServer->startAdvertising(); }
};

class MidiRxCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pChar) {
        // Grab the raw binary data and its length directly
        uint8_t* rxValue = pChar->getData();
        size_t length = pChar->getLength();
        
        // A standard BLE MIDI packet is at least 5 bytes: [TimeHigh, TimeLow, Status, Data1, Data2]
        if (length >= 5) {
            uint8_t status = rxValue[2];
            uint8_t note = rxValue[3];
            uint8_t velocity = rxValue[4];

            // 0x90 to 0x9F is Note On.
            if ((status & 0xF0) == 0x90 && velocity > 0) {
                uint8_t channel = (status & 0x0F) + 1; // Convert 0-15 to 1-16
                onNoteOn(channel, note, velocity);     // Send to your existing BioStrike logic
            }
        }
    }
};

void setup() {
  Serial.begin(115200);

  // 1. INSTANT START: Load hardware preferences and start PWM + BLE MIDI
  prefs.begin("biostrike", false);
  globalMidiChannel = prefs.getUInt("gCh", 1);
  
  for (int i = 0; i < 4; i++) {
    // Fallback defaults if not set in memory
    uint8_t defNote = (i==0)?36:(i==1)?38:(i==2)?42:45; 
    solenoids[i].noteNumber = prefs.getUInt(("n" + String(i)).c_str(), defNote);
    solenoids[i].minPwm = prefs.getUInt(("pMin" + String(i)).c_str(), 100);
    solenoids[i].maxPwm = prefs.getUInt(("pMax" + String(i)).c_str(), 255);
    solenoids[i].duration = prefs.getUInt(("d" + String(i)).c_str(), 30);
    
    ledcAttach(solenoids[i].pin, PWM_FREQ, PWM_RES);
    ledcWrite(solenoids[i].pin, 0);
  }

BLEDevice::init("BioStrike");
  BLEDevice::setMTU(512); 
  
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());
  
  BLEService *pMidiService = pServer->createService(MIDI_SERVICE_UUID);
  
  // Set to WRITE and WRITE_NR so external devices can send MIDI to the ESP32
  pMidiCharacteristic = pMidiService->createCharacteristic(
      MIDI_CHARACTERISTIC_UUID, 
      BLECharacteristic::PROPERTY_READ   | 
      BLECharacteristic::PROPERTY_NOTIFY | 
      BLECharacteristic::PROPERTY_WRITE  | 
      BLECharacteristic::PROPERTY_WRITE_NR
  );
  
  pMidiCharacteristic->addDescriptor(new BLE2902());
  pMidiCharacteristic->setCallbacks(new MidiRxCallbacks()); // Attach our parser
  
  pMidiService->start();
  
  BLEAdvertising *pAdvertising = pServer->getAdvertising();
  pAdvertising->addServiceUUID(pMidiService->getUUID());
  pAdvertising->start();

  // 2. NON-BLOCKING WIFI INIT
  savedSSID = prefs.getString("ssid", "");
  savedPass = prefs.getString("pass", "");

  if (savedSSID != "") {
    Serial.print("Attempting to connect to WiFi SSID: [");
    Serial.print(savedSSID);
    Serial.println("]");
    
    Serial.print("With Password: [");
    Serial.print(savedPass);
    Serial.println("]");
    
    WiFi.mode(WIFI_STA);
    WiFi.begin(savedSSID.c_str(), savedPass.c_str());
    
    unsigned long startAttempt = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 10000) { 
      delay(500); 
      Serial.print(".");
    }
    Serial.println();
  }

  // 3. CAPTIVE PORTAL FALLBACK
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi connection failed or not set. Starting AP Mode: BioStrike");
    isAPMode = true;
    WiFi.mode(WIFI_AP);
    WiFi.softAP("BioStrike");
    delay(100); 
    dnsServer.start(DNS_PORT, "*", WiFi.softAPIP()); 
  } else {
    Serial.print("WiFi Connected! IP Address: ");
    Serial.println(WiFi.localIP());
  }

  // Start mDNS regardless of AP or STA mode so .local always resolves
  MDNS.begin(mdnsName);
  MDNS.addService("http", "tcp", 80);

  // 3.5 INITIALIZE OTA WITH HARDWARE SAFETY
  ArduinoOTA.setHostname(mdnsName);
  
  // CRITICAL: Ensure solenoids power down when OTA halts the main loop
  ArduinoOTA.onStart([]() {
    for (int i = 0; i < 4; i++) {
      ledcWrite(solenoids[i].pin, 0);
    }
  });
  
  ArduinoOTA.begin();

  // 4. START WEB SERVICES
  // Explicitly serve root
  server.on("/", []() {
    server.send_P(200, "text/html", index_html);
  });

  // OS Captive Portal probes
  server.on("/generate_204", []() { server.send_P(200, "text/html", index_html); });
  server.on("/hotspot-detect.html", []() { server.send_P(200, "text/html", index_html); });

  // Catch-all
  server.onNotFound([]() { 
    server.send_P(200, "text/html", index_html); 
  }); 

  server.begin();
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);

}

void loop() {
  // 1. Track BLE state changes to update the Web UI
  static bool lastBleState = false;
  
  if (bleConnected != lastBleState) {
    lastBleState = bleConnected;
    webSocket.broadcastTXT(bleConnected ? "ble:1" : "ble:0");
  }

  // 2. Handle Network & OTA Services
  ArduinoOTA.handle();

  if (isAPMode) dnsServer.processNextRequest(); 
  server.handleClient();
  webSocket.loop();
  
  // 3. Solenoid Safety Shutoff Timer
  unsigned long now = millis();
  for (int i = 0; i < 4; i++) {
    if (solenoids[i].active && (now - solenoids[i].startTime >= solenoids[i].duration)) {
      ledcWrite(solenoids[i].pin, 0); // Point to .pin instead of .channel
      solenoids[i].active = false;
    }
  }
}