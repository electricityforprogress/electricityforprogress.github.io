/**
 * Web Bluetooth API Manager
 * Ingests raw pulse-width/galvanic deltas from the multi-channel ESP32-S3 hardware.
 */
export class BiodataBleManager {
  constructor(onDataReceivedCallback) {
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.onDataReceived = onDataReceivedCallback;
    this.isConnected = false;
    this.channels = [
      { minDelta: Infinity, maxDelta: -Infinity, baseline: 500, normalized: 0.5 },
      { minDelta: Infinity, maxDelta: -Infinity, baseline: 500, normalized: 0.5 },
      { minDelta: Infinity, maxDelta: -Infinity, baseline: 500, normalized: 0.5 },
      { minDelta: Infinity, maxDelta: -Infinity, baseline: 500, normalized: 0.5 }
    ];
    this.SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
    this.CHARACTERISTIC_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
  }

  async connect() {
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'Biodata' }, { namePrefix: 'ESP32' }],
        optionalServices: [this.SERVICE_UUID]
      });
      this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnect());
      this.server = await this.device.gatt.connect();
      const service = await this.server.getPrimaryService(this.SERVICE_UUID);
      this.characteristic = await service.getCharacteristic(this.CHARACTERISTIC_UUID);
      await this.characteristic.startNotifications();
      this.characteristic.addEventListener('characteristicvaluechanged', (e) => this.handlePacket(e));
      this.isConnected = true;
      return true;
    } catch (err) {
      this.isConnected = false;
      throw err;
    }
  }

handlePacket(event) {
    const dataView = event.target.value;
    const decoder = new TextDecoder();
    const jsonString = decoder.decode(dataView).trim();

    try {
      // Parse the JSON string coming from the ESP32
      const payload = JSON.parse(jsonString);
      const rawDeltas = [0, 0, 0, 0];

      // Extract the 'p' (pulse width) value from each channel's object[cite: 3]
      if (payload.ch && Array.isArray(payload.ch)) {
        payload.ch.forEach(channelData => {
          if (channelData.c >= 0 && channelData.c < 4) {
            rawDeltas[channelData.c] = channelData.p; 
          }
        });
      }

      // Send the clean array of pulse widths to the main orchestrator
      if (this.onDataReceived) {
        this.onDataReceived({
          raw: rawDeltas
        });
      }
    } catch (e) {
      // Web Bluetooth sometimes chunks large strings; catch partial JSON drops safely
      console.warn('Partial or malformed JSON packet received:', e.message);
    }
  }

  handleDisconnect() {
    this.isConnected = false;
    if (this.device && this.device.gatt) {
      setTimeout(() => {
        if (!this.isConnected) this.device.gatt.connect().catch(() => {});
      }, 2500);
    }
  }

  disconnect() {
    if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
    this.isConnected = false;
  }
}

/**
 * BioChannelProcessor
 * Handles dynamic windowing, leaky min/max normalization, and volatility math.
 */
export class BioChannelProcessor {
  constructor(sampleRateHz = 10) {
    // Window sizes based on sample rate
    this.microSize = sampleRateHz * 2;  // 2 seconds (immediate transients)
    this.mesoSize = sampleRateHz * 30;  // 30 seconds (performance phrasing)
    
    this.microBuffer = [];
    this.mesoBuffer = [];
    
    // Leaky boundaries
    this.leakyMin = Infinity;
    this.leakyMax = -Infinity;
    
    // How fast boundaries decay toward the center (e.g., 0.5% per tick)
    this.leakRate = 0.005; 
  }

  processReading(val) {
    // 1. Shift data through the time windows
    this.microBuffer.push(val);
    if (this.microBuffer.length > this.microSize) this.microBuffer.shift();

    this.mesoBuffer.push(val);
    if (this.mesoBuffer.length > this.mesoSize) this.mesoBuffer.shift();

    // 2. Calculate Meso Average (The shifting baseline)
    const mesoAvg = this.mesoBuffer.reduce((sum, v) => sum + v, 0) / this.mesoBuffer.length;

    // 3. Update Leaky Min/Max
    // Instantly expand if a new extreme is hit
    if (val < this.leakyMin || this.leakyMin === Infinity) this.leakyMin = val;
    if (val > this.leakyMax || this.leakyMax === -Infinity) this.leakyMax = val;

    // Slowly decay boundaries toward the meso average
    this.leakyMin += (mesoAvg - this.leakyMin) * this.leakRate;
    this.leakyMax -= (this.leakyMax - mesoAvg) * this.leakRate;

    // Prevent divide-by-zero if data is entirely flat
    const range = this.leakyMax - this.leakyMin;
    const safeRange = range > 1 ? range : 1; 

    // 4. Calculate Normalized Base (0.0 to 1.0)
    let nBio = (val - this.leakyMin) / safeRange;
    nBio = Math.max(0, Math.min(1, nBio)); // Clamp strictly to 0-1

    // 5. Calculate Micro Volatility (Standard Deviation against Meso Avg)
    // Formula: \sigma = \sqrt{\frac{\sum (x_i - \mu_{meso})^2}{N}}
    let sumSq = 0;
    for (let i = 0; i < this.microBuffer.length; i++) {
      sumSq += Math.pow(this.microBuffer[i] - mesoAvg, 2);
    }
    const volatility = Math.sqrt(sumSq / this.microBuffer.length);

    return {
      raw: val,
      normalizedBase: nBio,
      volatility: volatility,
      leakyMin: this.leakyMin,
      leakyMax: this.leakyMax,
      mesoAvg: mesoAvg
    };
  }
}
