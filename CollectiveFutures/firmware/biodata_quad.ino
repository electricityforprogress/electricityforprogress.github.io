/* =========================================================================
 * BIODATA SONIFICATION - QUAD CHANNEL (v007)
 * =========================================================================
 *   https://electricityforprogress.com/CollectiveFutures/
 *   https://electricityforprogress.com/CollectiveFutures/bioStrike/bioStrike.html
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

#define CONFIG_VERSION 30 // Bumped to force NVS structural update
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

BLEServer *pServer = NULL;
BLECharacteristic *pMidiCharacteristic = NULL;
BLECharacteristic *pUartTxCharacteristic = NULL;
bool deviceConnected = false;
uint8_t connectedClients = 0; 

#define MIDI_SERVICE_UUID        "03b80e5a-ede8-4b33-a751-6ce34ec4c700"
#define MIDI_CHARACTERISTIC_UUID "7772e5db-3868-4112-a1a9-f2669d106bf3"
#define UART_SERVICE_UUID "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define UART_RX_CHAR_UUID "6e400002-b5a3-f393-e0a9-e50e24dcca9e" 
#define UART_TX_CHAR_UUID "6e400003-b5a3-f393-e0a9-e50e24dcca9e" 

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
        case 82: config[ch].window_size = map(val, 0, 127, 10, 100); break;
        case 83: config[ch].density = map(val, 0, 127, 0, 100); break;
        case 84: config[ch].note_min = val; break;
        case 85: config[ch].note_max = val; break;
        case 86: config[ch].vel_min = val; break;
        case 87: config[ch].vel_max = val; break;
        case 88: config[ch].spread = map(val, 0, 127, 0, 100); break;
        case 89: config[ch].dur_mult = (val / 127.0f) * 4.9f + 0.1f; break; 
        case 90: config[ch].quantize = map(val, 0, 127, 0, 8); break;
        case 91: config[ch].midi_channel = map(val, 0, 127, 0, 15); break;
        case 92: config[ch].bpm = map(val, 0, 127, 60, 240); break;
        case 93: config[ch].polyphony = map(val, 0, 127, 1, 8); break;
        case 94: config[ch].steal_mode = map(val, 0, 127, 0, 3); break;
        case 95: config[ch].legato = (val > 63) ? 1 : 0; break;
    }
}

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) { 
        connectedClients++;
        deviceConnected = true; 
        BLEDevice::startAdvertising(); 
    }
    void onDisconnect(BLEServer* pServer) { 
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
        
        String rx = "";
        for (size_t i = 0; i < len; i++) rx += (char)rxData[i];
        
        // --- HARDWARE-FIRST SYNC HANDSHAKE ---
        if (rx.startsWith("SYNC")) {
            for (int i = 0; i < NUM_CHANNELS; i++) {
                String stateJson = "{\"type\":\"state\",\"ch\":" + String(i) + 
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
                
                pUartTxCharacteristic->setValue((uint8_t*)stateJson.c_str(), stateJson.length());
                pUartTxCharacteristic->notify();
                delay(30); // 30ms breather to prevent BLE buffer overflow
            }
            return;
        }
        
        int ch, cc, val;
        if (rx.startsWith("C:") && sscanf(rx.c_str(), "C:%d,%d,%d", &ch, &cc, &val) == 3) {
            processIncomingCC(ch, cc, val);
        }
        else if (rx.startsWith("S:") && sscanf(rx.c_str(), "S:%d,%d", &ch, &val) == 2) {
            if (ch < NUM_CHANNELS) {
                config[ch].scale_mask = val;
                prefs_dirty = true;
                last_param_change = millis();
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
        for (int i=0; i<10; i++) {
            tx_buffer[ch][i] = sample_buffer[ch][(head_idx[ch] + (i * (config[ch].window_size/10))) % config[ch].window_size];
        }
        tx_ready[ch] = true;
    }
    
    float sum = 0; 
    for(int i = 0; i < config[ch].window_size; i++) {
        sum += (10000000.0f / sample_buffer[ch][i]); 
    }
    float mean = sum / config[ch].window_size;
    if (mean <= 0.0f) return;
    
    float current_rVal = 10000000.0f / raw_ticks;
    
    float sum_sq = 0; 
    for(int i = 0; i < config[ch].window_size; i++) {
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
                        // Strict Voice Stealing implementation mapped to the JS UI parameters
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
    pinMode(NEO_PIN, INPUT); 

    TinyUSBDevice.setManufacturerDescriptor("Electricity for Progress");
    TinyUSBDevice.setProductDescriptor("Biodata Quad USB"); 
    TinyUSBDevice.setID(0xCAFE, 0x8029); 
    usb_midi_interface.begin();
    usbMIDI.begin(MIDI_CHANNEL_OMNI);

    uint32_t boot_timer = millis();
    while (!Serial && (millis() - boot_timer < 2500)); 
    delay(100);

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

    I2CSHT.begin(I2C_SDA, I2C_SCL);
    if (sht4.begin(&I2CSHT)) sht4.setPrecision(SHT4X_HIGH_PRECISION);

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
            strip.setPixelColor(i, round_colors[r]); strip.show(); delay(40); strip.setPixelColor(i, 0); 
        }
    }
    for (int r = 0; r < 2; r++) {
        for (int i = 0; i < NEO_COUNT; i++) { 
            strip.setPixelColor(i, strip.gamma32(strip.ColorHSV((i * 65536L / NEO_COUNT) + (r * 32768L), 255, 200)));
            strip.show(); delay(40); strip.setPixelColor(i, 0); 
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

    while (usbMIDI.read()) {
        if (usbMIDI.getType() == midi::ControlChange) {
            uint8_t rx_ch = usbMIDI.getChannel() - 1; 
            for (int i = 0; i < NUM_CHANNELS; i++) {
                if (config[i].midi_channel == rx_ch) processIncomingCC(i, usbMIDI.getData1(), usbMIDI.getData2());
            }
        }
    }

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
                    
                    // Trigger the ADSR LED Envelope for this specific voice
                    uint8_t target_led = (c * (NEO_COUNT / NUM_CHANNELS)) + (v % (NEO_COUNT / NUM_CHANNELS));
                    led_envs[target_led].active = true;
                    led_envs[target_led].trigger_time = p.trigger_time;
                    led_envs[target_led].off_time = p.off_time;
                    led_envs[target_led].hue = (p.pitch % 12) * 5461;
                    led_envs[target_led].max_bright = map(p.vel, 0, 127, 40, 255);
                    
                    if (deviceConnected) {
                        String noteJson = "{\"type\":\"note\",\"ch\":" + String(c) + ",\"n\":" + String(p.pitch) + ",\"v\":" + String(p.vel) + ",\"d\":" + String(p.off_time - p.trigger_time) + "}\n";
                        pUartTxCharacteristic->setValue((uint8_t*)noteJson.c_str(), noteJson.length());
                        pUartTxCharacteristic->notify();
                    }
                }
                else if (p.note_on_sent && current_millis >= p.off_time) {
                    sendMidi(0x80 + config[c].midi_channel, p.pitch, 0);
                    usbMIDI.sendNoteOff(p.pitch, 0, config[c].midi_channel + 1);
                    p.active = false;
                }
            }
        }
    }

    if (deviceConnected && (current_millis - last_telemetry > 25)) {
        if (tx_ready[current_telem_ch]) {
            String json_payload = "{\"type\":\"raw\",\"ch\":" + String(current_telem_ch) + ",\"p\":[";
            for (int i=0; i<10; i++) { json_payload += String(tx_buffer[current_telem_ch][i]); if (i < 9) json_payload += ","; }
            json_payload += "]}\n";
            tx_ready[current_telem_ch] = false;
            pUartTxCharacteristic->setValue((uint8_t*)json_payload.c_str(), json_payload.length());
            pUartTxCharacteristic->notify();
        }
        current_telem_ch = (current_telem_ch + 1) % NUM_CHANNELS;
        last_telemetry = current_millis;
    }

    if (prefs_dirty && current_millis - last_param_change > 3000) { 
        prefs.putBytes("cfg", config, sizeof(ChannelConfig) * NUM_CHANNELS); 
        prefs_dirty = false; 
    }

    // --- ORGANIC ADSR LED ANIMATOR ---
    static uint32_t last_anim = 0;
    if (current_millis - last_anim > 25) { 
        last_anim = current_millis;
        
        if (current_millis - last_event_time > 30000) {
            float phase = current_millis / 1000.0f; 
            float pulse = (sin(phase) * 0.5f) + 0.5f; 
            uint8_t a = (uint8_t)(pulse * 25.0f) + 2; 
            strip.fill(deviceConnected ? strip.Color(0, a, a) : strip.Color(a, a, a)); 
        } else {
            for (int i = 0; i < NEO_COUNT; i++) {
                if (led_envs[i].active) {
                    uint32_t t = current_millis;
                    uint32_t start = led_envs[i].trigger_time;
                    uint32_t end = led_envs[i].off_time;
                    
                    if (t < start) {
                        strip.setPixelColor(i, 0);
                    } else if (t >= start && t < end) {
                        
                        // Attack & Hold Phase
                        uint32_t elapsed = t - start;
                        uint32_t attack_time = 50; 
                        float b = led_envs[i].max_bright;
                        
                        if (elapsed < attack_time) {
                            b = (b * elapsed) / (float)attack_time;
                        } else {
                            // Organic decay: slow drop to 60% brightness during the note hold
                            uint32_t hold_time = end - start;
                            if (hold_time > attack_time) {
                                float decay_pct = (float)(elapsed - attack_time) / (float)(hold_time - attack_time);
                                b = b - (b * 0.4f * decay_pct);
                            }
                        }
                        strip.setPixelColor(i, strip.gamma32(strip.ColorHSV(led_envs[i].hue, 255, (uint8_t)b)));
                        
                    } else {
                        // Release Phase (Dynamic scaling based on note duration)
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