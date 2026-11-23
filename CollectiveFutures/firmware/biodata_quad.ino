/* =========================================================================
 * BIODATA SONIFICATION - QUAD CHANNEL (v011 - Configurable I2C Rate + WiFi/MQTT)
 * =========================================================================
 *   https://electricityforprogress.com/CollectiveFutures/
 *   https://electricityforprogress.com/CollectiveFutures/bioStrike/bioStrike.html
 *
 *   Upgrades in v011:
 *   - Configurable Non-Blocking I2C Sensor Rate (ENVCFG / NETCFG, NVS-persisted):
 *     Supports 250ms (4Hz fast wind/light), 500ms, 1s, 5s, 15s (default), 30s, 60s,
 *     anti-jitter ON CHANGE (±0.5°F / ±1.5% RH deadband + 1s cooldown), and OFF
 *   - Non-blocking I2C SHT4x Sensor Engine (SDA=8, SCL=9) with hot-plug auto-detect
 *     across USB Serial, BLE GATT & Cloud MQTT
 *   - In-App BLE GATT & USB Serial Provisioning for WiFi + Cloud MQTT (NETCFG / NETGET)
 *   - Supports both Plain TCP (1883, e.g. test.mosquitto.org) & TLS (8883) + MQTT Auth
 *   - Zero-Interference Radio Default: WiFi stays strictly WIFI_OFF unless enabled
 *   - Installation Power-Hiccup Recovery: NVS-persisted auto-reconnect & headless
 *     4-channel raw + note + env + live /meta streaming without USB or BLE hosts
 * ========================================================================= */

#include <Arduino.h>
#include <math.h>
#include <Wire.h>
#include "Adafruit_SHT4x.h"
#include <Adafruit_NeoPixel.h>
#include <xtensa/hal.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Adafruit_TinyUSB.h>
#include <MIDI.h>

// Enabled out-of-the-box; WiFi radio stays strictly WIFI_OFF until enabled via CONNECT
#define ENABLE_WIFI_MQTT 1
#if ENABLE_WIFI_MQTT
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <time.h>
#endif

#define CONFIG_VERSION 33
#define NUM_CHANNELS 4

Adafruit_USBD_MIDI usb_midi_interface;
MIDI_CREATE_INSTANCE(Adafruit_USBD_MIDI, usb_midi_interface, usbMIDI);

const uint8_t BIO_PINS[NUM_CHANNELS] = {48, 47, 21, 14};

#define I2C_SDA 8
#define I2C_SCL 9
#define NEO_PIN 3
#define NEO_COUNT 12

TwoWire I2CSHT = TwoWire(0);
Adafruit_SHT4x sht4 = Adafruit_SHT4x();
Adafruit_NeoPixel strip(NEO_COUNT, NEO_PIN, NEO_GRB + NEO_KHZ800);
Preferences prefs;

// Non-blocking I2C Environmental Sensor State (Kit I2C Header: SDA=8, SCL=9)
// envRateMs: 0 = OFF, -1 = ON CHANGE (anti-jitter hysteresis), 100..600000 = periodic ms
#define ENV_DEFAULT_RATE_MS 15000
#define ENV_ONCHANGE_POLL_MS 500
#define ENV_ONCHANGE_COOLDOWN_MS 1000
#define ENV_ONCHANGE_HEARTBEAT_MS 60000
#define ENV_DEADBAND_TEMP_F 0.5f
#define ENV_DEADBAND_RH 1.5f
#define ENV_PROBE_INTERVAL_MS 15000
int32_t envRateMs = ENV_DEFAULT_RATE_MS;
bool sht4Available = false;
uint8_t sht4Addr = 0x44;
bool sht4MeasPending = false;
uint32_t sht4MeasStartMs = 0;
uint32_t lastEnvPollMs = 0;
uint32_t lastSht4ProbeMs = 0;
bool hasEnvReading = false;
bool hasEmittedEnv = false;
uint32_t lastEnvEmitMs = 0;
float lastTempC = 0.0f;
float lastTempF = 0.0f;
float lastRh = 0.0f;
float lastEmittedTempF = 0.0f;
float lastEmittedRh = 0.0f;

BLEServer *pServer = NULL;
BLECharacteristic *pMidiCharacteristic = NULL;
BLECharacteristic *pUartTxCharacteristic = NULL;
bool deviceConnected = false;
uint8_t connectedClients = 0;

// USB CDC Serial Telemetry & Epoch Sync State
bool usbRawEnabled = true;      // Enabled by default whenever USB CDC host opens port
bool usbHostConfirmed = false;  // Set true when web app sends USBRAW:1 / SYNC / EPOCH over Serial
int64_t hostEpochOffsetMs = 0;  // UTC epoch_ms - millis()
String serialRxLine = "";

#define MIDI_SERVICE_UUID        "03b80e5a-ede8-4b33-a751-6ce34ec4c700"
#define MIDI_CHARACTERISTIC_UUID "7772e5db-3868-4112-a1a9-f2669d106bf3"
#define UART_SERVICE_UUID        "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define UART_RX_CHAR_UUID        "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define UART_TX_CHAR_UUID        "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

struct ChannelConfig {
    uint8_t version = CONFIG_VERSION;
    float threshold = 2.0;
    float thresh_base = 2.0;
    float thresh_boost = 0.0;
    uint8_t window_size = 40;
    uint8_t density = 100;
    uint8_t note_min = 48;
    uint8_t note_max = 84;
    uint8_t vel_min = 60;
    uint8_t vel_max = 110;
    uint8_t spread = 75;
    float dur_mult = 1.5;
    uint8_t quantize = 0;
    uint8_t midi_channel = 0;
    uint8_t bpm = 120;
    uint8_t polyphony = 5;
    uint8_t steal_mode = 0;
    uint8_t legato = 0;
    uint16_t scale_mask = 0b101010110101;
};

ChannelConfig config[NUM_CHANNELS];
bool prefs_dirty = false;
uint32_t last_param_change = 0;

// FreeRTOS-safe BLE UART RX Line Queue (assembled in GATT callback, executed on main loopTask stack)
#define BLE_CMD_QUEUE_LEN 8
String bleRxPartial = "";
String bleCmdQueue[BLE_CMD_QUEUE_LEN];
volatile uint8_t bleCmdHead = 0;
volatile uint8_t bleCmdTail = 0;
portMUX_TYPE bleCmdMux = portMUX_INITIALIZER_UNLOCKED;

#if ENABLE_WIFI_MQTT
WiFiClient espTcpClient;
WiFiClientSecure espTlsClient;
PubSubClient mqttClient;

bool cloudEnabled = false;
String wifiSsid = "";
String wifiPass = "";
String mqttHost = "test.mosquitto.org";
uint16_t mqttPort = 1883;
bool mqttTls = false;
String mqttUser = "";
String mqttPass = "";
String mqttFeedId = "esp32-bioquad-01";
String mqttFeedName = "ESP32 BioQuad";
String mqttClientId = "";

uint32_t lastWifiBeginMs = 0;
uint32_t wifiDisconnectSinceMs = 0;
bool wifiWasConnected = false;
uint32_t lastMqttRetryMs = 0;
uint32_t lastMqttMetaMs = 0;
int lastMqttError = 0;
uint32_t lastNetStatusEmitMs = 0;
uint8_t lastReportedWifiState = 255;
uint8_t lastReportedMqttState = 255;
#endif

uint32_t tx_buffer[NUM_CHANNELS][10];
bool tx_ready[NUM_CHANNELS] = {false};
uint32_t last_telemetry = 0;
uint8_t current_telem_ch = 0;

#define MAX_WINDOW 100
uint32_t sample_buffer[NUM_CHANNELS][MAX_WINDOW];
size_t head_idx[NUM_CHANNELS] = {0};
uint32_t total_pulses[NUM_CHANNELS] = {0};

volatile uint32_t last_rise_cc[NUM_CHANNELS] = {0};
volatile uint32_t high_time_cc[NUM_CHANNELS] = {0};
volatile bool new_pulse[NUM_CHANNELS] = {false};

#define VOICES_PER_CH 8
struct PolyNote {
    bool active = false;
    bool note_on_sent = false;
    bool is_legato_transition = false;
    uint8_t old_pitch = 0;
    uint8_t pitch = 0;
    uint8_t vel = 0;
    uint32_t trigger_time = 0;
    uint32_t off_time = 0;
};
PolyNote voices[NUM_CHANNELS][VOICES_PER_CH];
uint32_t last_event_time = 0;

struct LEDEnvelope {
    bool active = false;
    uint32_t trigger_time = 0;
    uint32_t off_time = 0;
    uint16_t hue = 0;
    uint8_t max_bright = 0;
};
LEDEnvelope led_envs[NEO_COUNT];

int64_t getSyncedTimestampMs() {
    if (hostEpochOffsetMs > 0) {
        return hostEpochOffsetMs + (int64_t)millis();
    }
#if ENABLE_WIFI_MQTT
    struct timeval tv;
    if (gettimeofday(&tv, NULL) == 0 && tv.tv_sec > 1700000000) {
        return ((int64_t)tv.tv_sec * 1000LL) + (tv.tv_usec / 1000LL);
    }
#endif
    return (int64_t)millis();
}

String jsonEscape(const String& raw) {
    String out = "";
    out.reserve(raw.length() + 4);
    for (size_t i = 0; i < raw.length(); i++) {
        char c = raw[i];
        if (c == '\"') out += "\\\"";
        else if (c == '\\') out += "\\\\";
        else if (c == '\n') out += "\\n";
        else if (c == '\r') out += "";
        else if ((uint8_t)c >= 0x20) out += c;
    }
    return out;
}

bool extractJsonStr(const String& json, const char* key, String& outVal) {
    String pat = String("\"") + key + "\":";
    int idx = json.indexOf(pat);
    if (idx < 0) return false;
    idx += pat.length();
    while (idx < (int)json.length() && (json[idx] == ' ' || json[idx] == '\t')) idx++;
    if (idx >= (int)json.length() || json[idx] != '\"') return false;
    idx++;
    String res = "";
    while (idx < (int)json.length()) {
        char c = json[idx++];
        if (c == '\\' && idx < (int)json.length()) {
            char esc = json[idx++];
            if (esc == '\"' || esc == '\\' || esc == '/') res += esc;
            else if (esc == 'n') res += '\n';
            else if (esc == 'r') res += '\r';
            else if (esc == 't') res += '\t';
            else res += esc;
        } else if (c == '\"') {
            outVal = res;
            return true;
        } else {
            res += c;
        }
    }
    return false;
}

bool extractJsonInt(const String& json, const char* key, int& outVal) {
    String pat = String("\"") + key + "\":";
    int idx = json.indexOf(pat);
    if (idx < 0) return false;
    idx += pat.length();
    while (idx < (int)json.length() && (json[idx] == ' ' || json[idx] == '\t')) idx++;
    if (idx >= (int)json.length()) return false;
    if (json.substring(idx).startsWith("true")) { outVal = 1; return true; }
    if (json.substring(idx).startsWith("false")) { outVal = 0; return true; }
    int endIdx = idx;
    if (json[endIdx] == '-') endIdx++;
    while (endIdx < (int)json.length() && isDigit(json[endIdx])) endIdx++;
    if (endIdx == idx || (endIdx == idx + 1 && json[idx] == '-')) return false;
    outVal = json.substring(idx, endIdx).toInt();
    return true;
}

void notifyBleUartString(const String& msg) {
    if (!deviceConnected || !pUartTxCharacteristic) return;
    const size_t total = msg.length();
    const size_t chunkMax = 180;
    size_t offset = 0;
    while (offset < total) {
        size_t n = min(chunkMax, total - offset);
        pUartTxCharacteristic->setValue((uint8_t*)(msg.c_str() + offset), n);
        pUartTxCharacteristic->notify();
        offset += n;
        if (offset < total) delay(4);
    }
}

void emitTelemetryLine(const String& jsonLine, bool isRawStream) {
    bool sentUsb = false;
    if (Serial && Serial.availableForWrite() > 0 && (usbRawEnabled || !isRawStream)) {
        Serial.print(jsonLine);
        sentUsb = true;
    }
    // Only pause duplicate BLE GATT raw arrays when web app explicitly confirmed active USB Serial link
    bool suppressBleRaw = isRawStream && sentUsb && usbHostConfirmed && usbRawEnabled;
    if (deviceConnected && !suppressBleRaw) {
        notifyBleUartString(jsonLine);
    }
#if ENABLE_WIFI_MQTT
    if (cloudEnabled && mqttClient.connected()) {
        String topic = "bioquad/feeds/" + mqttFeedId + "/stream";
        mqttClient.publish(topic.c_str(), jsonLine.c_str(), false);
    }
#endif
}

// --- NON-BLOCKING I2C SHT4x SENSOR ENGINE (ZERO LOOP DELAY) ---
uint8_t sht4Crc8(const uint8_t *data, size_t len) {
    uint8_t crc = 0xFF;
    for (size_t j = 0; j < len; j++) {
        crc ^= data[j];
        for (uint8_t b = 0; b < 8; b++) {
            crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x31) : (uint8_t)(crc << 1);
        }
    }
    return crc;
}

bool probeSht4xAddress() {
    const uint8_t candidates[2] = {0x44, 0x45};
    for (int i = 0; i < 2; i++) {
        I2CSHT.beginTransmission(candidates[i]);
        if (I2CSHT.endTransmission() == 0) {
            sht4Addr = candidates[i];
            sht4Available = true;
            sht4MeasPending = false;
            return true;
        }
    }
    sht4Available = false;
    sht4MeasPending = false;
    return false;
}

String buildEnvJsonLine() {
    return String("{\"type\":\"env\",\"sensor\":\"sht4x\"") +
        ",\"ts\":" + String((long long)getSyncedTimestampMs()) +
        ",\"tC\":" + String(lastTempC, 1) +
        ",\"tF\":" + String(lastTempF, 1) +
        ",\"rh\":" + String(lastRh, 1) + "}\n";
}

void sendCachedEnvReading(bool viaSerial, bool viaBle) {
    if (!hasEnvReading) return;
    String envLine = buildEnvJsonLine();
    if (viaSerial && Serial) {
        Serial.print(envLine);
    }
    if (viaBle && deviceConnected) {
        notifyBleUartString(envLine);
    }
}

int32_t sanitizeEnvRateMs(int rawMs) {
    if (rawMs == 0) return 0;     // OFF
    if (rawMs < 0) return -1;     // ON CHANGE (hysteresis deadband)
    if (rawMs < 100) return 100;  // Safe floor (10 Hz max)
    if (rawMs > 600000) return 600000;
    return (int32_t)rawMs;
}

void serviceEnvSensors(uint32_t nowMs) {
    if (envRateMs == 0) {
        sht4MeasPending = false;
        return;
    }

    if (!sht4Available) {
        if (lastSht4ProbeMs == 0 || (nowMs - lastSht4ProbeMs >= ENV_PROBE_INTERVAL_MS)) {
            lastSht4ProbeMs = nowMs;
            if (probeSht4xAddress()) {
                lastEnvPollMs = 0; // Trigger immediate first reading upon hot-plug
            }
        }
        return;
    }

    uint32_t pollCadenceMs = (envRateMs < 0) ? (uint32_t)ENV_ONCHANGE_POLL_MS : (uint32_t)envRateMs;

    // Stage 1: Trigger high-repeatability SHT4x measurement (0xFD) with zero delay()
    if (!sht4MeasPending) {
        if (lastEnvPollMs == 0 || (nowMs - lastEnvPollMs >= pollCadenceMs)) {
            I2CSHT.beginTransmission(sht4Addr);
            I2CSHT.write(0xFD);
            if (I2CSHT.endTransmission() == 0) {
                sht4MeasPending = true;
                sht4MeasStartMs = nowMs;
                lastEnvPollMs = nowMs;
            } else {
                sht4Available = false;
                lastSht4ProbeMs = nowMs;
            }
        }
        return;
    }

    // Stage 2: Read 6 bytes after >= 12ms conversion window (datasheet max = 8.3ms)
    if (nowMs - sht4MeasStartMs >= 12) {
        sht4MeasPending = false;
        uint8_t rxBuf[6] = {0};
        uint8_t got = I2CSHT.requestFrom(sht4Addr, (uint8_t)6);
        if (got == 6) {
            for (int i = 0; i < 6; i++) {
                rxBuf[i] = (uint8_t)I2CSHT.read();
            }
            if (sht4Crc8(rxBuf, 2) == rxBuf[2] && sht4Crc8(rxBuf + 3, 2) == rxBuf[5]) {
                uint16_t rawT = ((uint16_t)rxBuf[0] << 8) | rxBuf[1];
                uint16_t rawRH = ((uint16_t)rxBuf[3] << 8) | rxBuf[4];
                lastTempC = -45.0f + 175.0f * ((float)rawT / 65535.0f);
                lastTempF = (lastTempC * 1.8f) + 32.0f;
                float rhCalc = -6.0f + 125.0f * ((float)rawRH / 65535.0f);
                lastRh = constrain(rhCalc, 0.0f, 100.0f);
                hasEnvReading = true;

                bool shouldEmit = true;
                if (envRateMs < 0) {
                    // Anti-jitter ON CHANGE hysteresis: deadband anchored to last emitted reading
                    bool pastCooldown = !hasEmittedEnv || (nowMs - lastEnvEmitMs >= ENV_ONCHANGE_COOLDOWN_MS);
                    bool deltaExceeded = !hasEmittedEnv ||
                        (fabsf(lastTempF - lastEmittedTempF) >= ENV_DEADBAND_TEMP_F) ||
                        (fabsf(lastRh - lastEmittedRh) >= ENV_DEADBAND_RH);
                    bool keepaliveDue = !hasEmittedEnv || (nowMs - lastEnvEmitMs >= ENV_ONCHANGE_HEARTBEAT_MS);
                    shouldEmit = (pastCooldown && deltaExceeded) || keepaliveDue;
                }

                if (shouldEmit) {
                    hasEmittedEnv = true;
                    lastEnvEmitMs = nowMs;
                    lastEmittedTempF = lastTempF;
                    lastEmittedRh = lastRh;

                    bool usbActive = (Serial && Serial.availableForWrite() > 0);
                    bool mqttActive = false;
#if ENABLE_WIFI_MQTT
                    mqttActive = (cloudEnabled && mqttClient.connected());
#endif
                    if (deviceConnected || usbActive || mqttActive) {
                        emitTelemetryLine(buildEnvJsonLine(), false);
                    }
                }
            }
        } else {
            while (I2CSHT.available()) I2CSHT.read();
            sht4Available = false;
            lastSht4ProbeMs = nowMs;
        }
    }
}

#if ENABLE_WIFI_MQTT
uint8_t getWifiStateCode() {
    if (!cloudEnabled || wifiSsid.length() == 0) return 0; // Off
    wl_status_t st = WiFi.status();
    if (st == WL_CONNECTED) return 2;
    if (st == WL_CONNECT_FAILED || st == WL_NO_SSID_AVAIL) return 3;
    return 1; // Linking
}

uint8_t getMqttStateCode() {
    if (!cloudEnabled || wifiSsid.length() == 0) return 0; // Off
    if (mqttClient.connected()) return 2;
    if (lastMqttError != 0 && WiFi.status() == WL_CONNECTED) return 3;
    return 1; // Waiting / Connecting
}

void sendNetStatus(bool viaSerial, bool viaBle) {
    uint8_t wCode = getWifiStateCode();
    uint8_t mCode = getMqttStateCode();
    String ipStr = (wCode == 2) ? WiFi.localIP().toString() : "";
    int rssiVal = (wCode == 2) ? WiFi.RSSI() : 0;

    String statusJson = String("{\"type\":\"net_status\",\"fw\":\"v011\"") +
        ",\"en\":" + String(cloudEnabled ? 1 : 0) +
        ",\"wifi\":" + String(wCode) +
        ",\"ip\":\"" + jsonEscape(ipStr) + "\"" +
        ",\"rssi\":" + String(rssiVal) +
        ",\"mqtt\":" + String(mCode) +
        ",\"merr\":" + String(lastMqttError) +
        ",\"ssid\":\"" + jsonEscape(wifiSsid) + "\"" +
        ",\"hasWpass\":" + String(wifiPass.length() > 0 ? 1 : 0) +
        ",\"host\":\"" + jsonEscape(mqttHost) + "\"" +
        ",\"port\":" + String(mqttPort) +
        ",\"tls\":" + String((mqttTls || mqttPort == 8883) ? 1 : 0) +
        ",\"muser\":\"" + jsonEscape(mqttUser) + "\"" +
        ",\"hasMpass\":" + String(mqttPass.length() > 0 ? 1 : 0) +
        ",\"id\":\"" + jsonEscape(mqttFeedId) + "\"" +
        ",\"name\":\"" + jsonEscape(mqttFeedName) + "\"" +
        ",\"envMs\":" + String((long)envRateMs) +
        ",\"sht\":" + String(sht4Available ? 1 : 0) + "}\n";

    if (viaSerial && Serial) {
        Serial.print(statusJson);
    }
    if (viaBle && deviceConnected) {
        notifyBleUartString(statusJson);
    }
}

void configureMqttTransport() {
    if (mqttClient.connected()) {
        mqttClient.disconnect();
    }
    bool useTls = mqttTls || (mqttPort == 8883);
    if (useTls) {
        espTlsClient.setInsecure();
        espTlsClient.setTimeout(3);
        mqttClient.setClient(espTlsClient);
    } else {
        mqttClient.setClient(espTcpClient);
    }
    mqttClient.setServer(mqttHost.c_str(), mqttPort);
    mqttClient.setBufferSize(1024);
    mqttClient.setKeepAlive(25);
    mqttClient.setSocketTimeout(2);
    mqttClientId = ""; // Regenerate unique client ID on next connect
}

void applyCloudNetworkMode(bool forceReconnect) {
    configureMqttTransport();
    lastMqttError = 0;
    lastMqttRetryMs = 0;

    if (!cloudEnabled || wifiSsid.length() == 0) {
        WiFi.disconnect(true, false);
        WiFi.mode(WIFI_OFF);
        wifiWasConnected = false;
        wifiDisconnectSinceMs = 0;
        return;
    }

    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    if (forceReconnect || WiFi.status() != WL_CONNECTED) {
        if (forceReconnect) {
            WiFi.disconnect(false, false);
        }
        WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
        lastWifiBeginMs = millis();
        wifiDisconnectSinceMs = lastWifiBeginMs;
        wifiWasConnected = false;
    }
}

void publishHardwareMeta(uint32_t nowMs) {
    if (!mqttClient.connected()) return;
    lastMqttMetaMs = nowMs;
    String metaTopic = "bioquad/feeds/" + mqttFeedId + "/meta";
    String envFields = hasEnvReading
        ? (String(",\"sensor\":\"sht4x\",\"tC\":") + String(lastTempC, 1) +
           ",\"tF\":" + String(lastTempF, 1) +
           ",\"rh\":" + String(lastRh, 1))
        : "";
    String metaJson = String("{\"feedId\":\"") + jsonEscape(mqttFeedId) +
        "\",\"name\":\"" + jsonEscape(mqttFeedName) +
        "\",\"location\":\"ESP32 Hardware\",\"species\":\"Live 4-Ch Sensor\"" +
        ",\"channels\":4,\"online\":true,\"hw\":true,\"fw\":\"v011\"" +
        envFields +
        ",\"ts\":" + String((long long)getSyncedTimestampMs()) + "}";
    mqttClient.publish(metaTopic.c_str(), metaJson.c_str(), false);
}

void serviceCloudNetwork(uint32_t nowMs) {
    if (cloudEnabled && wifiSsid.length() > 0) {
        wl_status_t wStat = WiFi.status();
        if (wStat == WL_CONNECTED) {
            if (!wifiWasConnected) {
                wifiWasConnected = true;
                wifiDisconnectSinceMs = 0;
                lastMqttRetryMs = 0;
                configTime(0, 0, "pool.ntp.org", "time.nist.gov", "time.google.com");
            }

            if (!mqttClient.connected()) {
                if (lastMqttRetryMs == 0 || (nowMs - lastMqttRetryMs >= 5000)) {
                    lastMqttRetryMs = nowMs;
                    if (mqttClientId.length() == 0) {
                        uint64_t mac = ESP.getEfuseMac();
                        char suffix[10];
                        snprintf(suffix, sizeof(suffix), "%04X", (uint16_t)(mac & 0xFFFF));
                        String shortId = mqttFeedId.substring(0, min((unsigned int)14, mqttFeedId.length()));
                        mqttClientId = "bq_" + shortId + "_" + String(suffix);
                    }
                    String metaTopic = "bioquad/feeds/" + mqttFeedId + "/meta";
                    String willJson = String("{\"feedId\":\"") + jsonEscape(mqttFeedId) + "\",\"online\":false,\"ts\":0}";
                    bool connectedOk = false;
                    if (mqttUser.length() > 0) {
                        connectedOk = mqttClient.connect(
                            mqttClientId.c_str(),
                            mqttUser.c_str(),
                            mqttPass.c_str(),
                            metaTopic.c_str(),
                            0,
                            false,
                            willJson.c_str()
                        );
                    } else {
                        connectedOk = mqttClient.connect(
                            mqttClientId.c_str(),
                            metaTopic.c_str(),
                            0,
                            false,
                            willJson.c_str()
                        );
                    }

                    if (connectedOk) {
                        lastMqttError = 0;
                        publishHardwareMeta(nowMs);
                    } else {
                        lastMqttError = mqttClient.state();
                    }
                }
            } else {
                mqttClient.loop();
                if (nowMs - lastMqttMetaMs >= 10000) {
                    publishHardwareMeta(nowMs);
                }
            }
        } else {
            if (wifiWasConnected) {
                wifiWasConnected = false;
                wifiDisconnectSinceMs = nowMs;
            } else if (wifiDisconnectSinceMs == 0) {
                wifiDisconnectSinceMs = nowMs;
            }

            // Non-blocking power-hiccup & router-reboot recovery (zero WiFi scan stalls)
            if (nowMs - lastWifiBeginMs >= 15000) {
                if (nowMs - wifiDisconnectSinceMs >= 45000) {
                    WiFi.disconnect(false, false);
                    wifiDisconnectSinceMs = nowMs;
                }
                WiFi.mode(WIFI_STA);
                WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
                lastWifiBeginMs = nowMs;
            }
        }
    }

    // Push live network state transitions to connected USB/BLE configurator
    bool hostActive = deviceConnected || (Serial && usbHostConfirmed);
    if (hostActive) {
        uint8_t curW = getWifiStateCode();
        uint8_t curM = getMqttStateCode();
        bool stateChanged = (curW != lastReportedWifiState) || (curM != lastReportedMqttState);
        bool linkingHeartbeat = (cloudEnabled && (curW == 1 || curM == 1) && (nowMs - lastNetStatusEmitMs >= 3000));
        if (stateChanged || linkingHeartbeat) {
            lastReportedWifiState = curW;
            lastReportedMqttState = curM;
            lastNetStatusEmitMs = nowMs;
            sendNetStatus(usbHostConfirmed, deviceConnected);
        }
    }
}
#endif

void IRAM_ATTR isr_bio_0() { uint32_t now = xthal_get_ccount(); if (digitalRead(BIO_PINS[0])) last_rise_cc[0] = now; else if (now > last_rise_cc[0]) { high_time_cc[0] = now - last_rise_cc[0]; new_pulse[0] = true; } }
void IRAM_ATTR isr_bio_1() { uint32_t now = xthal_get_ccount(); if (digitalRead(BIO_PINS[1])) last_rise_cc[1] = now; else if (now > last_rise_cc[1]) { high_time_cc[1] = now - last_rise_cc[1]; new_pulse[1] = true; } }
void IRAM_ATTR isr_bio_2() { uint32_t now = xthal_get_ccount(); if (digitalRead(BIO_PINS[2])) last_rise_cc[2] = now; else if (now > last_rise_cc[2]) { high_time_cc[2] = now - last_rise_cc[2]; new_pulse[2] = true; } }
void IRAM_ATTR isr_bio_3() { uint32_t now = xthal_get_ccount(); if (digitalRead(BIO_PINS[3])) last_rise_cc[3] = now; else if (now > last_rise_cc[3]) { high_time_cc[3] = now - last_rise_cc[3]; new_pulse[3] = true; } }

void sendMidi(uint8_t status, uint8_t data1, uint8_t data2) {
    if (!deviceConnected) return;
    uint16_t ts = millis() & 0x1FFF;
    uint8_t header = 0x80 | ((ts >> 7) & 0x3F);
    uint8_t time_lo = 0x80 | (ts & 0x7F);
    uint8_t midiPacket[] = { header, time_lo, status, data1, data2 };
    pMidiCharacteristic->setValue(midiPacket, 5);
    pMidiCharacteristic->notify();
}

void processIncomingCC(uint8_t ch, uint8_t cc, uint8_t val) {
    if (ch >= NUM_CHANNELS) return;
    prefs_dirty = true;
    last_param_change = millis();

    switch(cc) {
        case 80:
            config[ch].thresh_boost = (val / 127.0f) * 5.0f;
            config[ch].threshold = config[ch].thresh_base + config[ch].thresh_boost;
            break;
        case 81:
            config[ch].thresh_base = 1.0f + (val / 127.0f) * 4.0f;
            config[ch].threshold = config[ch].thresh_base + config[ch].thresh_boost;
            break;
        case 82: config[ch].window_size = constrain(val, 10, 100); break;
        case 83: config[ch].density = constrain(val, 0, 100); break;
        case 84: config[ch].note_min = val; break;
        case 85: config[ch].note_max = val; break;
        case 86: config[ch].vel_min = val; break;
        case 87: config[ch].vel_max = val; break;
        case 88: config[ch].spread = constrain(val, 0, 100); break;
        case 89: config[ch].dur_mult = val / 10.0f; break;
        case 90: config[ch].quantize = val; break;
        case 91: config[ch].midi_channel = val; break;
        case 92: config[ch].bpm = round(60.0f + (val / 127.0f) * 180.0f); break;
        case 93: config[ch].polyphony = constrain(val, 1, 8); break;
        case 94: config[ch].steal_mode = val; break;
        case 95: config[ch].legato = (val > 63) ? 1 : 0; break;
    }
}

void sendStateDump(bool viaSerial, bool viaBle) {
    for (int i = 0; i < NUM_CHANNELS; i++) {
        String stateJson = "{\"type\":\"state\",\"ch\":" + String(i) +
            ",\"ts\":" + String((long long)getSyncedTimestampMs()) +
            ",\"thr\":" + String(config[i].threshold) +
            ",\"win\":" + String(config[i].window_size) +
            ",\"den\":" + String(config[i].density) +
            ",\"nMin\":" + String(config[i].note_min) +
            ",\"nMax\":" + String(config[i].note_max) +
            ",\"vMin\":" + String(config[i].vel_min) +
            ",\"vMax\":" + String(config[i].vel_max) +
            ",\"spr\":" + String(config[i].spread) +
            ",\"dur\":" + String(config[i].dur_mult) +
            ",\"qtz\":" + String(config[i].quantize) +
            ",\"mCh\":" + String(config[i].midi_channel) +
            ",\"bpm\":" + String(config[i].bpm) +
            ",\"poly\":" + String(config[i].polyphony) +
            ",\"stl\":" + String(config[i].steal_mode) +
            ",\"leg\":" + String(config[i].legato) +
            ",\"scl\":" + String(config[i].scale_mask) + "}\n";

        if (viaSerial && Serial) {
            Serial.print(stateJson);
        }
        if (viaBle && deviceConnected) {
            pUartTxCharacteristic->setValue((uint8_t*)stateJson.c_str(), stateJson.length());
            pUartTxCharacteristic->notify();
            delay(25);
        }
    }
}

void handleControlCommand(const String& rawCmd, bool fromSerial) {
    String rx = rawCmd;
    rx.trim();
    if (rx.length() == 0) return;

    if (fromSerial) {
        usbHostConfirmed = true;
    }

    if (rx.startsWith("PING")) {
        String pong = "{\"type\":\"pong\",\"fw\":\"v011\",\"ts\":" + String((long long)getSyncedTimestampMs()) + "}\n";
        if (fromSerial && Serial) Serial.print(pong);
        else if (deviceConnected) notifyBleUartString(pong);
        return;
    }

    if (rx.startsWith("SYNC")) {
        if (fromSerial) usbRawEnabled = true;
        sendStateDump(fromSerial, !fromSerial);
        if (envRateMs != 0) sendCachedEnvReading(fromSerial, !fromSerial);
#if ENABLE_WIFI_MQTT
        sendNetStatus(fromSerial, !fromSerial);
#endif
        return;
    }

    if (rx.startsWith("NETGET")) {
        if (envRateMs != 0) sendCachedEnvReading(fromSerial, !fromSerial);
#if ENABLE_WIFI_MQTT
        sendNetStatus(fromSerial, !fromSerial);
#endif
        return;
    }

    if (rx.startsWith("ENVGET")) {
        sendCachedEnvReading(fromSerial, !fromSerial);
        return;
    }

    if (rx.startsWith("ENVCFG:")) {
        String json = rx.substring(7);
        int rateVal = (int)envRateMs;
        if (extractJsonInt(json, "ms", rateVal) || extractJsonInt(json, "envMs", rateVal)) {
            envRateMs = sanitizeEnvRateMs(rateVal);
            prefs.putInt("e_ms", envRateMs);
            lastEnvPollMs = 0;     // Trigger immediate fresh sample if enabled
            hasEmittedEnv = false; // Reset hysteresis anchor so first sample emits right away
        }
        String ack = String("{\"type\":\"env_cfg\",\"envMs\":") + String((long)envRateMs) +
            ",\"sht\":" + String(sht4Available ? 1 : 0) +
            ",\"ts\":" + String((long long)getSyncedTimestampMs()) + "}\n";
        if (fromSerial && Serial) Serial.print(ack);
        else if (deviceConnected) notifyBleUartString(ack);
        return;
    }

    if (rx.startsWith("USBRAW:")) {
        bool enable = (rx.substring(7).toInt() != 0);
        usbRawEnabled = enable;
        usbHostConfirmed = enable;
        if (Serial) {
            Serial.println(String("{\"type\":\"usb_mode\",\"active\":") + (usbRawEnabled ? "1" : "0") + "}");
        }
        return;
    }

    if (rx.startsWith("EPOCH:")) {
        int64_t hostEpoch = strtoll(rx.substring(6).c_str(), NULL, 10);
        if (hostEpoch > 1700000000000LL) {
            hostEpochOffsetMs = hostEpoch - (int64_t)millis();
        }
        return;
    }

    if (rx.startsWith("SAVE")) {
        prefs.putBytes("cfg", config, sizeof(ChannelConfig) * NUM_CHANNELS);
        prefs_dirty = false;
        String ack = "{\"type\":\"nvs_saved\",\"ok\":1,\"ts\":" + String((long long)getSyncedTimestampMs()) + "}\n";
        emitTelemetryLine(ack, false);
        return;
    }

#if ENABLE_WIFI_MQTT
    if (rx.startsWith("NETCFG:")) {
        String json = rx.substring(7);
        int enVal = cloudEnabled ? 1 : 0;
        int portVal = (int)mqttPort;
        int tlsVal = mqttTls ? 1 : 0;
        String strVal = "";

        if (extractJsonInt(json, "en", enVal)) {
            cloudEnabled = (enVal != 0);
            prefs.putBool("c_en", cloudEnabled);
        }
        if (extractJsonStr(json, "ssid", strVal)) {
            wifiSsid = strVal;
            prefs.putString("w_ssid", wifiSsid);
        }
        if (extractJsonStr(json, "wpass", strVal) && strVal != "__KEEP__") {
            wifiPass = strVal;
            prefs.putString("w_pass", wifiPass);
        }
        if (extractJsonStr(json, "host", strVal) && strVal.length() > 0) {
            mqttHost = strVal;
            prefs.putString("m_host", mqttHost);
        }
        if (extractJsonInt(json, "port", portVal) && portVal > 0 && portVal <= 65535) {
            mqttPort = (uint16_t)portVal;
            prefs.putUShort("m_port", mqttPort);
        }
        if (extractJsonInt(json, "tls", tlsVal)) {
            mqttTls = (tlsVal != 0) || (mqttPort == 8883);
            prefs.putBool("m_tls", mqttTls);
        }
        if (extractJsonStr(json, "muser", strVal)) {
            mqttUser = strVal;
            prefs.putString("m_user", mqttUser);
        }
        if (extractJsonStr(json, "mpass", strVal) && strVal != "__KEEP__") {
            mqttPass = strVal;
            prefs.putString("m_pass", mqttPass);
        }
        if (extractJsonStr(json, "id", strVal) && strVal.length() > 0) {
            mqttFeedId = strVal;
            prefs.putString("m_feed", mqttFeedId);
        }
        if (extractJsonStr(json, "name", strVal) && strVal.length() > 0) {
            mqttFeedName = strVal;
            prefs.putString("m_name", mqttFeedName);
        }
        int envMsVal = (int)envRateMs;
        if (extractJsonInt(json, "envMs", envMsVal)) {
            envRateMs = sanitizeEnvRateMs(envMsVal);
            prefs.putInt("e_ms", envRateMs);
            lastEnvPollMs = 0;
            hasEmittedEnv = false;
        }

        applyCloudNetworkMode(true);
        lastReportedWifiState = getWifiStateCode();
        lastReportedMqttState = getMqttStateCode();
        lastNetStatusEmitMs = millis();

        String ack = "{\"type\":\"nvs_saved\",\"ok\":1,\"net\":1,\"ts\":" + String((long long)getSyncedTimestampMs()) + "}\n";
        if (fromSerial && Serial) Serial.print(ack);
        else if (deviceConnected) notifyBleUartString(ack);
        sendNetStatus(fromSerial, !fromSerial);
        return;
    }

    if (rx.startsWith("WIFI:")) {
        int comma = rx.indexOf(',', 5);
        if (comma > 5) {
            wifiSsid = rx.substring(5, comma);
            wifiPass = rx.substring(comma + 1);
            cloudEnabled = (wifiSsid.length() > 0);
            prefs.putBool("c_en", cloudEnabled);
            prefs.putString("w_ssid", wifiSsid);
            prefs.putString("w_pass", wifiPass);
            applyCloudNetworkMode(true);
            sendNetStatus(fromSerial, !fromSerial);
        }
        return;
    }
    if (rx.startsWith("MQTT:")) {
        int c1 = rx.indexOf(',', 5);
        int c2 = rx.indexOf(',', c1 + 1);
        if (c1 > 5 && c2 > c1) {
            mqttHost = rx.substring(5, c1);
            mqttPort = (uint16_t)rx.substring(c1 + 1, c2).toInt();
            mqttFeedId = rx.substring(c2 + 1);
            mqttTls = (mqttPort == 8883);
            prefs.putString("m_host", mqttHost);
            prefs.putUShort("m_port", mqttPort);
            prefs.putBool("m_tls", mqttTls);
            prefs.putString("m_feed", mqttFeedId);
            applyCloudNetworkMode(false);
            sendNetStatus(fromSerial, !fromSerial);
        }
        return;
    }
#endif

    int ch, cc, val;
    if (rx.startsWith("C:") && sscanf(rx.c_str(), "C:%d,%d,%d", &ch, &cc, &val) == 3) {
        processIncomingCC(ch, cc, val);
    }
    else if (rx.startsWith("S:") && sscanf(rx.c_str(), "S:%d,%d", &ch, &val) == 2) {
        if (ch >= 0 && ch < NUM_CHANNELS) {
            config[ch].scale_mask = (uint16_t)val;
            prefs_dirty = true;
            last_param_change = millis();
        }
    }
}

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pSrv) {
        connectedClients++;
        deviceConnected = true;
        BLEDevice::startAdvertising();
    }
    void onDisconnect(BLEServer* pSrv) {
        if (connectedClients > 0) connectedClients--;
        if (connectedClients == 0) deviceConnected = false;
        BLEDevice::startAdvertising();
    }
};

class MidiRxCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pChar) {
        uint8_t* rxData = pChar->getData();
        size_t len = pChar->getLength();
        if (len >= 5) {
            uint8_t status = rxData[2];
            if ((status & 0xF0) == 0xB0) {
                uint8_t rx_midi_ch = status & 0x0F;
                for (int i = 0; i < NUM_CHANNELS; i++) {
                    if (config[i].midi_channel == rx_midi_ch) {
                        processIncomingCC(i, rxData[3], rxData[4]);
                    }
                }
            }
        }
    }
};

class UartRxCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pChar) {
        uint8_t* rxData = pChar->getData();
        size_t len = pChar->getLength();
        if (len == 0) return;

        // Reassemble fragmented BLE GATT writes until '\n' or '\r' and queue for main loopTask
        for (size_t i = 0; i < len; i++) {
            char c = (char)rxData[i];
            if (c == '\n' || c == '\r') {
                if (bleRxPartial.length() > 0) {
                    portENTER_CRITICAL(&bleCmdMux);
                    uint8_t nextHead = (bleCmdHead + 1) % BLE_CMD_QUEUE_LEN;
                    if (nextHead != bleCmdTail) {
                        bleCmdQueue[bleCmdHead] = bleRxPartial;
                        bleCmdHead = nextHead;
                    }
                    portEXIT_CRITICAL(&bleCmdMux);
                    bleRxPartial = "";
                }
            } else if (bleRxPartial.length() < 512) {
                bleRxPartial += c;
            }
        }
    }
};

uint8_t applyScaleMask(uint8_t raw_note, uint16_t mask) {
    if (mask == 0) return raw_note;
    if (mask & (1 << (raw_note % 12))) return raw_note;
    for (int offset = 1; offset <= 12; offset++) {
        int up = raw_note + offset;
        if (up <= 127 && (mask & (1 << (up % 12)))) return up;
        int down = raw_note - offset;
        if (down >= 0 && (mask & (1 << (down % 12)))) return down;
    }
    return raw_note;
}

void analyze_and_map(uint8_t ch, uint32_t raw_ticks) {
    if (raw_ticks == 0) return;
    last_event_time = millis();

    sample_buffer[ch][head_idx[ch]] = raw_ticks;
    head_idx[ch] = (head_idx[ch] + 1) % config[ch].window_size;
    if (total_pulses[ch] < config[ch].window_size) { total_pulses[ch]++; return; }

    if (!tx_ready[ch]) {
        int stride = max(1, config[ch].window_size / 10);
        for (int i = 0; i < 10; i++) {
            tx_buffer[ch][i] = sample_buffer[ch][(head_idx[ch] + (i * stride)) % config[ch].window_size];
        }
        tx_ready[ch] = true;
    }

    float sum = 0;
    for (int i = 0; i < config[ch].window_size; i++) {
        sum += (10000000.0f / sample_buffer[ch][i]);
    }
    float mean = sum / config[ch].window_size;
    if (mean <= 0.0f) return;

    float current_rVal = 10000000.0f / raw_ticks;

    float sum_sq = 0;
    for (int i = 0; i < config[ch].window_size; i++) {
        float val = 10000000.0f / sample_buffer[ch][i];
        sum_sq += pow(val - mean, 2);
    }
    float std_dev = sqrtf(sum_sq / config[ch].window_size);
    float min_std_dev = mean * 0.005f;

    if (abs(current_rVal - mean) > (config[ch].threshold * std_dev) && std_dev > min_std_dev) {
        if (random(0, 100) <= config[ch].density) {
            static uint32_t last_trigger[NUM_CHANNELS] = {0};
            if (millis() - last_trigger[ch] > 150) {
                float normalized = (current_rVal - mean) / (config[ch].threshold * std_dev);
                long norm_pct = constrain(abs(normalized) * 100, 100, 200);

                uint8_t raw_note = map(norm_pct, 100, 200, config[ch].note_min, config[ch].note_max);
                raw_note = min(config[ch].note_max, max(config[ch].note_min, raw_note));
                uint8_t target_pitch = applyScaleMask(raw_note, config[ch].scale_mask);

                uint8_t target_vel = map(norm_pct, 100, 200, config[ch].vel_min, config[ch].vel_max);
                target_vel = min(config[ch].vel_max, max(config[ch].vel_min, target_vel));

                float v = config[ch].dur_mult;
                uint32_t max_ms = (v <= 1.0f) ? (500.0f + ((v - 0.1f) / 0.9f) * 5150.0f) : (5650.0f + ((v - 1.0f) / 4.0f) * 24350.0f);
                uint32_t min_ms = 150 + ((100 - config[ch].spread) / 100.0f) * (max_ms - 150);
                uint8_t bio_entropy = raw_ticks % 127;
                uint32_t target_dur = min_ms + ((max_ms - min_ms) * (bio_entropy / 127.0f));

                int v_idx = -1;
                for (int i = 0; i < config[ch].polyphony; i++) {
                    if (!voices[ch][i].active) { v_idx = i; break; }
                }

                if (v_idx == -1) {
                    if (config[ch].legato == 1 && config[ch].polyphony == 1) {
                        v_idx = 0;
                    } else if (config[ch].steal_mode != 3) {
                        int target_idx = 0;
                        uint32_t oldest_time = 0xFFFFFFFF;
                        uint8_t lowest_pitch = 255;
                        uint8_t highest_pitch = 0;

                        for (int i = 0; i < config[ch].polyphony; i++) {
                            if (voices[ch][i].trigger_time < oldest_time) {
                                oldest_time = voices[ch][i].trigger_time;
                                if (config[ch].steal_mode == 0) target_idx = i;
                            }
                            if (voices[ch][i].pitch < lowest_pitch) {
                                lowest_pitch = voices[ch][i].pitch;
                                if (config[ch].steal_mode == 1) target_idx = i;
                            }
                            if (voices[ch][i].pitch > highest_pitch) {
                                highest_pitch = voices[ch][i].pitch;
                                if (config[ch].steal_mode == 2) target_idx = i;
                            }
                        }
                        v_idx = target_idx;
                    }
                }

                if (v_idx != -1) {
                    bool was_active = (voices[ch][v_idx].active && voices[ch][v_idx].note_on_sent);
                    if (was_active) {
                        if (config[ch].legato == 1 && config[ch].polyphony == 1) {
                            voices[ch][v_idx].is_legato_transition = true;
                            voices[ch][v_idx].old_pitch = voices[ch][v_idx].pitch;
                        } else {
                            sendMidi(0x80 + config[ch].midi_channel, voices[ch][v_idx].pitch, 0);
                            usbMIDI.sendNoteOff(voices[ch][v_idx].pitch, 0, config[ch].midi_channel + 1);
                        }
                    }

                    voices[ch][v_idx].active = true;
                    voices[ch][v_idx].note_on_sent = false;
                    voices[ch][v_idx].pitch = target_pitch;
                    voices[ch][v_idx].vel = target_vel;

                    uint32_t now = millis();
                    if (config[ch].quantize > 0) {
                        float beat_ms = 60000.0f / (float)config[ch].bpm;
                        float div_ms = (config[ch].quantize == 1) ? beat_ms/16.0f : (config[ch].quantize == 2) ? beat_ms/8.0f : (config[ch].quantize == 3) ? beat_ms/4.0f : (config[ch].quantize == 4) ? beat_ms/2.0f : (config[ch].quantize == 5) ? beat_ms : (config[ch].quantize == 6) ? beat_ms*(2.0f/3.0f) : (config[ch].quantize == 7) ? beat_ms*2.0f : beat_ms*4.0f;
                        voices[ch][v_idx].trigger_time = ceil((float)now / div_ms) * div_ms;
                    } else {
                        voices[ch][v_idx].trigger_time = now;
                    }
                    voices[ch][v_idx].off_time = voices[ch][v_idx].trigger_time + target_dur;
                }
                last_trigger[ch] = millis();
            }
        }
    }
}

void setup() {
    Serial.begin(115200);
    serialRxLine.reserve(512);
    bleRxPartial.reserve(512);
    pinMode(NEO_PIN, INPUT);

    TinyUSBDevice.setManufacturerDescriptor("Electricity for Progress");
    TinyUSBDevice.setProductDescriptor("Biodata Quad USB");
    TinyUSBDevice.setID(0xCAFE, 0x8029);
    usb_midi_interface.begin();
    usbMIDI.begin(MIDI_CHANNEL_OMNI);

    uint32_t boot_timer = millis();
    while (!Serial && (millis() - boot_timer < 400));
    delay(40);

    prefs.begin("bio_quad", false);
    ChannelConfig stored_cfg[NUM_CHANNELS];
    if (prefs.getBytesLength("cfg") == sizeof(ChannelConfig) * NUM_CHANNELS) {
        prefs.getBytes("cfg", &stored_cfg, sizeof(ChannelConfig) * NUM_CHANNELS);
        if (stored_cfg[0].version == CONFIG_VERSION) {
            for (int i = 0; i < NUM_CHANNELS; i++) config[i] = stored_cfg[i];
        } else {
            for (int i = 0; i < NUM_CHANNELS; i++) config[i].midi_channel = i;
            prefs.putBytes("cfg", config, sizeof(ChannelConfig) * NUM_CHANNELS);
        }
    } else {
        for (int i = 0; i < NUM_CHANNELS; i++) config[i].midi_channel = i;
        prefs.putBytes("cfg", config, sizeof(ChannelConfig) * NUM_CHANNELS);
    }

#if ENABLE_WIFI_MQTT
    cloudEnabled = prefs.getBool("c_en", false);
    wifiSsid = prefs.getString("w_ssid", "");
    wifiPass = prefs.getString("w_pass", "");
    mqttHost = prefs.getString("m_host", "test.mosquitto.org");
    mqttPort = prefs.getUShort("m_port", 1883);
    mqttTls = prefs.getBool("m_tls", false);
    mqttUser = prefs.getString("m_user", "");
    mqttPass = prefs.getString("m_pass", "");
    mqttFeedId = prefs.getString("m_feed", "esp32-bioquad-01");
    mqttFeedName = prefs.getString("m_name", "ESP32 BioQuad");
    applyCloudNetworkMode(true);
#endif

    envRateMs = sanitizeEnvRateMs(prefs.getInt("e_ms", ENV_DEFAULT_RATE_MS));
    I2CSHT.begin(I2C_SDA, I2C_SCL);
    I2CSHT.setTimeOut(20);
    if (probeSht4xAddress()) {
        if (sht4.begin(&I2CSHT)) {
            sht4.setPrecision(SHT4X_HIGH_PRECISION);
            sht4.setHeater(SHT4X_NO_HEATER);
        }
    }

    BLEDevice::init("Biodata-Q4");
    BLEDevice::setMTU(512);
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MyServerCallbacks());

    BLEService *pMidiService = pServer->createService(MIDI_SERVICE_UUID);
    pMidiCharacteristic = pMidiService->createCharacteristic(MIDI_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_WRITE_NR);
    pMidiCharacteristic->addDescriptor(new BLE2902());
    pMidiCharacteristic->setCallbacks(new MidiRxCallbacks());
    pMidiService->start();

    BLEService *pUartService = pServer->createService(UART_SERVICE_UUID);
    pUartTxCharacteristic = pUartService->createCharacteristic(UART_TX_CHAR_UUID, BLECharacteristic::PROPERTY_NOTIFY);
    pUartTxCharacteristic->addDescriptor(new BLE2902());

    BLECharacteristic *pUartRxCharacteristic = pUartService->createCharacteristic(UART_RX_CHAR_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
    pUartRxCharacteristic->setCallbacks(new UartRxCallbacks());
    pUartService->start();

    BLEAdvertising *pAdvertising = pServer->getAdvertising();
    pAdvertising->addServiceUUID(pMidiService->getUUID());
    pAdvertising->addServiceUUID(pUartService->getUUID());
    pAdvertising->start();

    delay(100);
    strip.begin();
    strip.setBrightness(150);
    uint32_t round_colors[2] = { strip.Color(0, 255, 200), strip.Color(150, 0, 255) };
    for (int r = 0; r < 2; r++) {
        for (int i = 0; i < NEO_COUNT; i++) {
            strip.setPixelColor(i, round_colors[r]); strip.show(); delay(30); strip.setPixelColor(i, 0);
        }
    }
    strip.show();

    for (int i = 0; i < NUM_CHANNELS; i++) pinMode(BIO_PINS[i], INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(BIO_PINS[0]), isr_bio_0, CHANGE);
    attachInterrupt(digitalPinToInterrupt(BIO_PINS[1]), isr_bio_1, CHANGE);
    attachInterrupt(digitalPinToInterrupt(BIO_PINS[2]), isr_bio_2, CHANGE);
    attachInterrupt(digitalPinToInterrupt(BIO_PINS[3]), isr_bio_3, CHANGE);
}

void loop() {
    uint32_t current_millis = millis();

    // 1. Non-blocking USB CDC Serial Command Reader
    while (Serial && Serial.available() > 0) {
        char ch = (char)Serial.read();
        if (ch == '\n' || ch == '\r') {
            if (serialRxLine.length() > 0) {
                handleControlCommand(serialRxLine, true);
                serialRxLine = "";
            }
        } else if (serialRxLine.length() < 512) {
            serialRxLine += ch;
        }
    }

    // 1b. Drain FreeRTOS-safe BLE GATT UART Command Queue
    while (bleCmdTail != bleCmdHead) {
        String cmdToRun = "";
        portENTER_CRITICAL(&bleCmdMux);
        if (bleCmdTail != bleCmdHead) {
            cmdToRun = bleCmdQueue[bleCmdTail];
            bleCmdQueue[bleCmdTail] = "";
            bleCmdTail = (bleCmdTail + 1) % BLE_CMD_QUEUE_LEN;
        }
        portEXIT_CRITICAL(&bleCmdMux);
        if (cmdToRun.length() > 0) {
            handleControlCommand(cmdToRun, false);
        }
    }

    // 2. USB MIDI CC Sync
    while (usbMIDI.read()) {
        if (usbMIDI.getType() == midi::ControlChange) {
            uint8_t rx_ch = usbMIDI.getChannel() - 1;
            for (int i = 0; i < NUM_CHANNELS; i++) {
                if (config[i].midi_channel == rx_ch) processIncomingCC(i, usbMIDI.getData1(), usbMIDI.getData2());
            }
        }
    }

#if ENABLE_WIFI_MQTT
    serviceCloudNetwork(current_millis);
#endif
    serviceEnvSensors(current_millis);

    // 3. 555 Galvanic Conductance Pulse Processing
    for (int i = 0; i < NUM_CHANNELS; i++) {
        if (new_pulse[i]) {
            noInterrupts();
            uint32_t pulse_us = high_time_cc[i] / 240;
            uint32_t raw_ticks = high_time_cc[i];
            new_pulse[i] = false;
            interrupts();
            if (pulse_us > 5 && pulse_us < 50000) analyze_and_map(i, raw_ticks);
        }
    }

    // 4. Polyphonic Voice Scheduler & Timestamped Note Emission
    for (int c = 0; c < NUM_CHANNELS; c++) {
        for (int v = 0; v < VOICES_PER_CH; v++) {
            PolyNote& p = voices[c][v];
            if (p.active) {
                if (!p.note_on_sent && current_millis >= p.trigger_time) {
                    sendMidi(0x90 + config[c].midi_channel, p.pitch, p.vel);
                    usbMIDI.sendNoteOn(p.pitch, p.vel, config[c].midi_channel + 1);

                    if (p.is_legato_transition) {
                        sendMidi(0x80 + config[c].midi_channel, p.old_pitch, 0);
                        usbMIDI.sendNoteOff(p.old_pitch, 0, config[c].midi_channel + 1);
                        p.is_legato_transition = false;
                    }

                    p.note_on_sent = true;

                    uint8_t target_led = (c * (NEO_COUNT / NUM_CHANNELS)) + (v % (NEO_COUNT / NUM_CHANNELS));
                    led_envs[target_led].active = true;
                    led_envs[target_led].trigger_time = p.trigger_time;
                    led_envs[target_led].off_time = p.off_time;
                    led_envs[target_led].hue = (p.pitch % 12) * 5461;
                    led_envs[target_led].max_bright = map(p.vel, 0, 127, 40, 255);

                    String noteJson = "{\"type\":\"note\",\"ch\":" + String(c) +
                        ",\"ts\":" + String((long long)getSyncedTimestampMs()) +
                        ",\"n\":" + String(p.pitch) +
                        ",\"v\":" + String(p.vel) +
                        ",\"d\":" + String(p.off_time - p.trigger_time) +
#if ENABLE_WIFI_MQTT
                        ",\"name\":\"" + jsonEscape(mqttFeedName) + "\"" +
#endif
                        "}\n";
                    emitTelemetryLine(noteJson, false);
                }
                else if (p.note_on_sent && current_millis >= p.off_time) {
                    sendMidi(0x80 + config[c].midi_channel, p.pitch, 0);
                    usbMIDI.sendNoteOff(p.pitch, 0, config[c].midi_channel + 1);
                    p.active = false;
                }
            }
        }
    }

    // 5. Raw Telemetry Streaming (15ms over USB Serial, 25ms over BLE or Headless Cloud MQTT)
    bool usbReady = (Serial && Serial.availableForWrite() > 0 && usbRawEnabled);
    bool mqttReady = false;
#if ENABLE_WIFI_MQTT
    mqttReady = (cloudEnabled && mqttClient.connected());
#endif
    uint32_t telemInterval = (usbReady && usbHostConfirmed) ? 15 : 25;
    bool anyTransportConnected = deviceConnected || usbReady || mqttReady;
    if (anyTransportConnected && (current_millis - last_telemetry > telemInterval)) {
        if (tx_ready[current_telem_ch]) {
            String json_payload = "{\"type\":\"raw\",\"ch\":" + String(current_telem_ch) +
                ",\"ts\":" + String((long long)getSyncedTimestampMs()) +
                ",\"p\":[";
            for (int i = 0; i < 10; i++) {
                json_payload += String(tx_buffer[current_telem_ch][i]);
                if (i < 9) json_payload += ",";
            }
            json_payload += "]}\n";
            tx_ready[current_telem_ch] = false;
            emitTelemetryLine(json_payload, true);
        }
        current_telem_ch = (current_telem_ch + 1) % NUM_CHANNELS;
        last_telemetry = current_millis;
    }

    // 6. Auto-commit dirty parameters to ESP32 NVS after 3 seconds idle
    if (prefs_dirty && current_millis - last_param_change > 3000) {
        prefs.putBytes("cfg", config, sizeof(ChannelConfig) * NUM_CHANNELS);
        prefs_dirty = false;
        String ack = "{\"type\":\"nvs_saved\",\"ok\":1,\"auto\":1,\"ts\":" + String((long long)getSyncedTimestampMs()) + "}\n";
        emitTelemetryLine(ack, false);
    }

    // 7. Organic ADSR NeoPixel Animator
    static uint32_t last_anim = 0;
    if (current_millis - last_anim > 25) {
        last_anim = current_millis;
        if (current_millis - last_event_time > 30000) {
            float phase = current_millis / 1000.0f;
            float pulse = (sin(phase) * 0.5f) + 0.5f;
            uint8_t a = (uint8_t)(pulse * 25.0f) + 2;
            strip.fill(anyTransportConnected ? strip.Color(0, a, a) : strip.Color(a, a, a));
        } else {
            for (int i = 0; i < NEO_COUNT; i++) {
                if (led_envs[i].active) {
                    uint32_t t = current_millis;
                    uint32_t start = led_envs[i].trigger_time;
                    uint32_t end = led_envs[i].off_time;

                    if (t < start) {
                        strip.setPixelColor(i, 0);
                    } else if (t >= start && t < end) {
                        uint32_t elapsed = t - start;
                        uint32_t attack_time = 50;
                        float b = led_envs[i].max_bright;
                        if (elapsed < attack_time) {
                            b = (b * elapsed) / (float)attack_time;
                        } else {
                            uint32_t hold_time = end - start;
                            if (hold_time > attack_time) {
                                float decay_pct = (float)(elapsed - attack_time) / (float)(hold_time - attack_time);
                                b = b - (b * 0.4f * decay_pct);
                            }
                        }
                        strip.setPixelColor(i, strip.gamma32(strip.ColorHSV(led_envs[i].hue, 255, (uint8_t)b)));
                    } else {
                        uint32_t elapsed = t - end;
                        uint32_t note_dur = end - start;
                        uint32_t release_time = constrain(note_dur / 2, 200, 1500);
                        if (elapsed < release_time) {
                            float starting_release_b = led_envs[i].max_bright * 0.6f;
                            float b = starting_release_b - (starting_release_b * elapsed) / (float)release_time;
                            strip.setPixelColor(i, strip.gamma32(strip.ColorHSV(led_envs[i].hue, 255, (uint8_t)b)));
                        } else {
                            led_envs[i].active = false;
                            strip.setPixelColor(i, 0);
                        }
                    }
                } else {
                    strip.setPixelColor(i, 0);
                }
            }
        }
        strip.show();
    }
}
