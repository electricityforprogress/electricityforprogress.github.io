/**
 * js/syncCore.js
 * Pure, zero-dependency algorithms for bioQuad:
 * - 555 Galvanic Conductance & Rolling Window Deviation Math
 * - Scale Mask & Additive Hardware CC Encoding/Decoding
 * - Session Filename Sanitization
 * - Streaming Line Framing (USB Serial / BLE UART)
 * - Multi-User Playout Sync & Clock Skew Estimator
 * - Pure Binary MQTT 3.1.1 over WebSockets Packet Codec
 *
 * Compatible with both browser (window.BioQuadCore) and Node.js unit tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.BioQuadCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';

  const CALIBRATION_FACTOR = 10000000;

  const SCALES = {
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic_major: [0, 2, 4, 7, 9],
    pentatonic_minor: [0, 3, 5, 7, 10],
    hirajoshi: [0, 2, 3, 7, 8]
  };

  function ticksToConductance(rawTicks) {
    const t = Number(rawTicks);
    if (!isFinite(t) || t <= 0) return 0.1;
    return Math.max(0.1, CALIBRATION_FACTOR / t);
  }

  /**
   * Resolves a record's exact conductance (µS) or raw numeric value for playback & analysis.
   * For biodata streams with valid 555-timer `rawTicks`, computes `10,000,000 / rawTicks` directly
   * so recorded takes and exported CSVs retain full 32-bit hardware precision without `.toFixed(2)` loss.
   */
  function resolveBioRecordValue(rawValue, rawTicks = null, isBiodata = true, isMidiOnly = false) {
    const numVal = Number(rawValue);
    if (!isBiodata || isMidiOnly) {
      return isFinite(numVal) ? numVal : 0;
    }

    if (rawTicks !== null && rawTicks !== undefined && rawTicks !== '') {
      const t = Number(rawTicks);
      if (isFinite(t) && t > 0) {
        return Math.max(0.1, CALIBRATION_FACTOR / t);
      }
    }

    if (!isFinite(numVal)) return 0.1;
    let rVal = Math.abs(numVal);
    if (rVal < 0.1) rVal = 0.1;
    if (rVal > 10000) {
      rVal = Math.max(0.1, CALIBRATION_FACTOR / rVal);
    }
    return rVal;
  }

  /**
   * Evaluates a rolling window of samples against the current incoming sample (`currentVal`),
   * matching ESP32 `biodata_quad.ino` (`analyze_and_map`) without artificial `0.015` hard floors
   * or `< 0.1 -> 1.0` standard-deviation clamping.
   */
  function evaluateBioSampleWindow(values, currentVal, threshold = 2.0, isBiodata = true) {
    if (!Array.isArray(values) || values.length === 0) {
      return {
        mean: 0,
        minim: 0,
        maxim: 0,
        rawStdev: 0,
        minStdDev: 1e-4,
        sampleDev: 0,
        maxDev: 0,
        meterStdevi: 1.0,
        meterMaxDev: 0,
        sampleRatio: 0,
        windowRatio: 0,
        normPct: 0,
        isActiveSignal: false,
        isOverThreshold: false
      };
    }

    const len = values.length;
    let sum = 0;
    let maxim = -Infinity;
    let minim = Infinity;
    for (let i = 0; i < len; i++) {
      const v = Number(values[i]) || 0;
      sum += v;
      if (v > maxim) maxim = v;
      if (v < minim) minim = v;
    }
    const mean = sum / len;

    let sumSq = 0;
    let maxDev = 0;
    for (let i = 0; i < len; i++) {
      const dev = Math.abs((Number(values[i]) || 0) - mean);
      sumSq += dev * dev;
      if (dev > maxDev) maxDev = dev;
    }

    const variance = sumSq / len;
    const rawStdev = variance > 0 ? Math.sqrt(variance) : 0;
    const minStdDev = isBiodata
      ? Math.max(1e-5, Math.abs(mean) * 0.00005)
      : 1e-6;

    const cur = (currentVal !== undefined && currentVal !== null && isFinite(Number(currentVal)))
      ? Number(currentVal)
      : (Number(values[len - 1]) || 0);
    const sampleDev = Math.abs(cur - mean);

    const safeThresh = Math.max(1.0, Number(threshold) || 2.0);
    const isActiveSignal = rawStdev > minStdDev;
    const meterStdevi = isActiveSignal ? rawStdev : minStdDev;
    const meterMaxDev = isActiveSignal ? maxDev : 0;
    const sampleRatio = isActiveSignal ? (sampleDev / rawStdev) : 0;
    const windowRatio = isActiveSignal ? (maxDev / rawStdev) : 0;
    const isOverThreshold = isActiveSignal && (sampleDev > (safeThresh * rawStdev));

    const normalized = (safeThresh * rawStdev) > 0 ? (sampleDev / (safeThresh * rawStdev)) : 1.0;
    const normPct = Math.max(1.0, Math.min(2.0, normalized)) - 1.0;

    return {
      mean,
      minim,
      maxim,
      rawStdev,
      minStdDev,
      sampleDev,
      maxDev,
      meterStdevi,
      meterMaxDev,
      sampleRatio,
      windowRatio,
      normPct,
      isActiveSignal,
      isOverThreshold
    };
  }

  /**
   * Maps a threshold-crossing sample and its rolling-window stats to `{ note, velocity, duration }`
   * consistently across recorded file playback, MQTT streams, and virtual botanical feeds.
   */
  function sonifyBioSample(stats, currentVal, params = {}, entropyUnit = Math.random()) {
    const p = params || {};
    const minN = p.minNote ?? 36;
    const maxN = p.maxNote ?? 84;
    const span = stats.maxim - stats.minim;
    let normPitch = span > 1e-5
      ? Math.max(0, Math.min(1, (Number(currentVal) - stats.minim) / span))
      : (stats.normPct ?? 0.5);

    normPitch = applySpreadCurve(normPitch, p.spread ?? 75);
    const rawNote = Math.round(minN + normPitch * (maxN - minN));
    const scaled = scaleNote(rawNote, p.scaleType, p.scaleRoot, p.activeScaleBits, minN, maxN);
    const note = Math.max(0, Math.min(127, Math.round(isFinite(scaled) ? scaled : 60)));

    const velMin = p.velMin ?? 60;
    const velMax = p.velMax ?? 110;
    const normPct = Math.max(0, Math.min(1, Number(stats.normPct) || 0));
    const velocity = Math.max(1, Math.min(127, Math.round(velMin + normPct * (velMax - velMin))));

    const durMult = Number(p.durMult) || 1.0;
    const ent = Math.max(0, Math.min(1, isFinite(Number(entropyUnit)) ? Number(entropyUnit) : 0.5));
    const duration = Math.round((160 + ent * 300) * durMult);

    return { note, velocity, duration };
  }

  function computeWindowStats(values, threshold = 2.0) {
    if (!Array.isArray(values) || values.length === 0) {
      return { mean: 0, minim: 0, maxim: 0, stdevi: 1.0, maxDev: 0, ratio: 0, isOverThreshold: false };
    }
    let sum = 0;
    let maxim = -Infinity;
    let minim = Infinity;
    for (let i = 0; i < values.length; i++) {
      const v = Number(values[i]) || 0;
      sum += v;
      if (v > maxim) maxim = v;
      if (v < minim) minim = v;
    }
    const mean = sum / values.length;
    let sumSq = 0;
    let maxDev = 0;
    for (let i = 0; i < values.length; i++) {
      const dev = Math.abs((Number(values[i]) || 0) - mean);
      sumSq += dev * dev;
      if (dev > maxDev) maxDev = dev;
    }
    const variance = sumSq / values.length;
    let stdevi = variance > 0 ? Math.sqrt(variance) : 1.0;
    if (stdevi < 0.1) stdevi = 1.0;
    const ratio = maxDev / stdevi;
    return {
      mean,
      minim,
      maxim,
      stdevi,
      maxDev,
      ratio,
      isOverThreshold: ratio >= threshold
    };
  }

  function mapScale(value, inMin, inMax, outMin, outMax) {
    if (inMax === inMin) return outMin;
    return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
  }

  function applySpreadCurve(normPitch, spread) {
    const clamped = Math.max(0, Math.min(1, Number(normPitch) || 0));
    const spreadNorm = Math.max(0, Math.min(100, Number(spread) || 0)) / 100.0;
    const deviation = clamped - 0.5;
    const sign = Math.sign(deviation);
    const pow = spreadNorm < 0.5
      ? mapScale(spreadNorm, 0, 0.5, 3.0, 1.0)
      : mapScale(spreadNorm, 0.5, 1.0, 1.0, 0.33);
    return 0.5 + (sign * Math.pow(Math.abs(deviation) * 2, pow) / 2);
  }

  function decodeScaleBits(rawBits) {
    if (rawBits === null || rawBits === undefined) return null;
    const fromMask = (mask) => {
      const m = Number(mask) & 0x0FFF;
      return Array.from({ length: 12 }, (_, i) => ((m >> i) & 1) !== 0);
    };
    if (typeof rawBits === 'number' && isFinite(rawBits)) return fromMask(rawBits);
    if (Array.isArray(rawBits)) {
      if (rawBits.length === 12) {
        return rawBits.map(b => Boolean(typeof b === 'string' ? (b === '1' || b.toLowerCase() === 'true') : b));
      }
      if (rawBits.length === 2) {
        return fromMask((Number(rawBits[0]) & 0xFF) | ((Number(rawBits[1]) & 0x0F) << 8));
      }
      if (rawBits.length > 0 && rawBits.length < 12) {
        return Array.from({ length: 12 }, (_, i) => Boolean(rawBits[i]));
      }
      return null;
    }
    if (typeof rawBits === 'string') {
      const s = rawBits.trim();
      if (!s) return null;
      if (/^[01]{12}$/.test(s)) return s.split('').map(c => c === '1');
      if (/^0x[0-9a-f]+$/i.test(s)) return fromMask(parseInt(s, 16));
      if (/^\d+$/.test(s)) {
        const num = parseInt(s, 10);
        if (!isNaN(num) && num >= 0 && num <= 4095) return fromMask(num);
      }
    }
    return null;
  }

  function encodeScaleMask(activeScaleBits) {
    const bits = decodeScaleBits(activeScaleBits);
    if (!bits) return 0x0FFF;
    let mask = 0;
    for (let i = 0; i < 12; i++) {
      if (bits[i]) mask |= (1 << i);
    }
    return mask;
  }

  function buildScaleBitsFromPreset(scaleType, scaleRoot = 0) {
    const root = ((parseInt(scaleRoot, 10) || 0) % 12 + 12) % 12;
    const degrees = SCALES[scaleType] || null;
    if (!degrees || scaleType === 'chromatic') return new Array(12).fill(true);
    const bits = new Array(12).fill(false);
    degrees.forEach(deg => { bits[(root + deg) % 12] = true; });
    return bits;
  }

  function scaleNote(rawNote, scaleType, root, activeScaleBits, minNote = 0, maxNote = 127) {
    const snappedNote = Math.max(minNote, Math.min(maxNote, Math.round(rawNote)));
    let bits = decodeScaleBits(activeScaleBits);
    if (!bits && scaleType && SCALES[scaleType]) {
      bits = buildScaleBitsFromPreset(scaleType, root);
    }
    if (!bits || bits.every(Boolean) || bits.every(b => !b)) return snappedNote;
    if (bits[snappedNote % 12]) return snappedNote;
    for (let offset = 1; offset <= 12; offset++) {
      const up = snappedNote + offset;
      if (up <= maxNote && bits[up % 12]) return up;
      const down = snappedNote - offset;
      if (down >= minNote && bits[down % 12]) return down;
    }
    return snappedNote;
  }

  function encodeThresholdCC(threshold) {
    const t = Math.min(10.0, Math.max(1.0, Number(threshold) || 2.0));
    const baseVal = Math.min(5.0, t);
    const boostVal = Math.max(0.0, t - 5.0);
    const cc81 = Math.min(127, Math.max(0, Math.round(((baseVal - 1.0) / 4.0) * 127)));
    const cc80 = Math.min(127, Math.max(0, Math.round((boostVal / 5.0) * 127)));
    return { cc81, cc80 };
  }

  function decodeThresholdCC(cc81, cc80) {
    const base = 1.0 + (Math.min(127, Math.max(0, cc81)) / 127) * 4.0;
    const boost = (Math.min(127, Math.max(0, cc80)) / 127) * 5.0;
    return Math.round((base + boost) * 100) / 100;
  }

  function makeTimestampSlug(prefixOrDate = 'bioQuad', maybeDate = new Date()) {
    let prefix = 'bioQuad';
    let date = maybeDate;
    if (prefixOrDate instanceof Date) {
      date = prefixOrDate;
    } else if (typeof prefixOrDate === 'string' && prefixOrDate.trim()) {
      prefix = prefixOrDate.trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'bioQuad';
    }
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      date = new Date();
    }
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${prefix}_${y}${mo}${d}_${h}${mi}${s}`;
  }

  function sanitizeSessionFilename(rawName, fallbackPrefix = 'bioQuad') {
    const trimmed = String(rawName || '').trim().replace(/\.(csv|tsv|json|zip|mid)$/i, '');
    const cleaned = trimmed
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
    if (!cleaned) {
      return makeTimestampSlug(fallbackPrefix);
    }
    return cleaned;
  }

  /**
   * Accurately classifies Web Serial, WebUSB, and Web Bluetooth errors so real
   * hardware/driver errors (port busy, gesture expired, GATT timeout) are never
   * misreported as embedded-iframe policy blocks.
   */
  function classifyHardwareError(err, transportLabel = 'Hardware', isEmbeddedFrame = false) {
    const name = (err && err.name) ? String(err.name) : '';
    const rawMsg = (err && err.message) ? String(err.message).trim() : String(err || 'Unknown error').trim();
    const msgLower = rawMsg.toLowerCase();

    if (
      name === 'NotFoundError' ||
      name === 'AbortError' ||
      msgLower.includes('user cancelled') ||
      msgLower.includes('user canceled') ||
      msgLower.includes('no port selected') ||
      msgLower.includes('no device selected')
    ) {
      return {
        kind: 'cancelled',
        message: `${transportLabel} selection cancelled.`,
        needsStandaloneTab: false
      };
    }

    const mentionsPolicy =
      msgLower.includes('permissions policy') ||
      msgLower.includes('feature policy') ||
      msgLower.includes('disallowed by permissions') ||
      (name === 'SecurityError' && msgLower.includes('access to the feature'));

    if (Boolean(isEmbeddedFrame) && mentionsPolicy) {
      return {
        kind: 'iframe_policy',
        message: `${transportLabel} is blocked inside this preview frame. Click OPEN TAB to connect directly.`,
        needsStandaloneTab: true
      };
    }

    if (
      msgLower.includes('user gesture') ||
      msgLower.includes('user activation')
    ) {
      return {
        kind: 'gesture',
        message: `Click Connect again to authorize ${transportLabel}.`,
        needsStandaloneTab: false
      };
    }

    if (
      name === 'NetworkError' ||
      msgLower.includes('failed to open serial port') ||
      msgLower.includes('access denied') ||
      msgLower.includes('port is already open') ||
      msgLower.includes('busy')
    ) {
      return {
        kind: 'port_busy',
        message: `Cannot open ${transportLabel} (${rawMsg}). Close Arduino Serial Monitor or other apps using the device, then retry.`,
        needsStandaloneTab: false
      };
    }

    return {
      kind: 'error',
      message: rawMsg ? `${transportLabel}: ${rawMsg}` : `${transportLabel} connection failed.`,
      needsStandaloneTab: false
    };
  }

  /**
   * Streaming Line Framing Parser for USB Serial & BLE UART chunks
   */
  class LineStreamParser {
    constructor(maxBufferLength = 32768) {
      this.buffer = '';
      this.maxBufferLength = maxBufferLength;
      this.decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
    }

    push(chunk) {
      let str = '';
      if (typeof chunk === 'string') {
        str = chunk;
      } else if (chunk && this.decoder) {
        str = this.decoder.decode(chunk, { stream: true });
      }
      if (!str) return [];

      this.buffer += str;
      if (this.buffer.length > this.maxBufferLength) {
        const lastNl = this.buffer.lastIndexOf('\n');
        this.buffer = lastNl >= 0 ? this.buffer.slice(lastNl + 1) : '';
      }

      const parts = this.buffer.split(/\r?\n/);
      this.buffer = parts.pop() || '';
      const lines = [];
      for (let i = 0; i < parts.length; i++) {
        const trimmed = parts[i].trim();
        if (trimmed.length > 0) lines.push(trimmed);
      }
      return lines;
    }

    reset() {
      this.buffer = '';
    }
  }

  /**
   * Multi-User Playout Synchronization & Clock Skew Estimator
   * Estimates sender->receiver clock offset (localNow - senderTs) using a sliding
   * minimum-transit window (immune to positive network jitter spikes) and schedules
   * notes & waveform frames onto a deterministic playout horizon so multiple
   * listeners hear notes simultaneously.
   */
  class PlayoutSyncController {
    constructor(options = {}) {
      this.playoutBufferMs = options.playoutBufferMs ?? 180;
      this.lateGraceMs = options.lateGraceMs ?? 140;
      this.maxFutureMs = options.maxFutureMs ?? 3000;
      this.windowSize = options.windowSize ?? 24;
      this.samples = [];
      this.offsetMs = null; // Estimated (localClock - remoteClock) + minTransit
      this.jitterMs = 0;
      this.lastDeltaMs = null;
      this.syncedCount = 0;
      this.lateCount = 0;
      this.droppedCount = 0;
    }

    setPlayoutBufferMs(ms) {
      this.playoutBufferMs = Math.max(20, Math.min(1500, Number(ms) || 180));
    }

    reset() {
      this.samples = [];
      this.offsetMs = null;
      this.jitterMs = 0;
      this.lastDeltaMs = null;
    }

    observeTimestamp(remoteTsMs, localNowMs = Date.now()) {
      const rTs = Number(remoteTsMs);
      if (!isFinite(rTs) || rTs <= 0) return this.offsetMs || 0;

      // Ignore device-uptime timestamps (< year 2020 epoch) for absolute skew, anchor relative instead
      const delta = localNowMs - rTs;

      // If clock jumped by > 10 seconds (e.g. switched feed or device rebooted), re-anchor cleanly
      if (this.offsetMs !== null && Math.abs(delta - this.offsetMs) > 10000) {
        this.samples = [];
        this.offsetMs = null;
      }

      if (this.lastDeltaMs !== null) {
        const instJitter = Math.abs(delta - this.lastDeltaMs);
        this.jitterMs = this.jitterMs * 0.85 + instJitter * 0.15;
      }
      this.lastDeltaMs = delta;

      this.samples.push(delta);
      if (this.samples.length > this.windowSize) {
        this.samples.shift();
      }

      // Minimum observed transit delta in window gives best estimate of baseline clock offset without queueing spikes
      let minDelta = Infinity;
      for (let i = 0; i < this.samples.length; i++) {
        if (this.samples[i] < minDelta) minDelta = this.samples[i];
      }

      if (this.offsetMs === null) {
        this.offsetMs = minDelta;
      } else {
        // Track downward shifts quickly (faster path discovered), upward drift gently
        const alpha = minDelta < this.offsetMs ? 0.35 : 0.08;
        this.offsetMs = this.offsetMs * (1 - alpha) + minDelta * alpha;
      }

      return this.offsetMs;
    }

    schedule(remoteTsMs, localNowMs = Date.now()) {
      const rTs = Number(remoteTsMs);
      if (!isFinite(rTs) || rTs <= 0) {
        return {
          playAtLocalMs: localNowMs + 15,
          delayMs: 15,
          audioTimeOffsetSec: 0.015,
          isLate: false,
          dropped: false,
          offsetMs: this.offsetMs || 0,
          jitterMs: Math.round(this.jitterMs)
        };
      }

      const offset = this.observeTimestamp(rTs, localNowMs);
      const targetLocalMs = rTs + offset + this.playoutBufferMs;
      let delayMs = targetLocalMs - localNowMs;

      if (delayMs < -this.lateGraceMs) {
        this.droppedCount++;
        return {
          playAtLocalMs: localNowMs,
          delayMs: 0,
          audioTimeOffsetSec: 0.005,
          isLate: true,
          dropped: true,
          offsetMs: Math.round(offset),
          jitterMs: Math.round(this.jitterMs)
        };
      }

      let isLate = false;
      if (delayMs < 5) {
        isLate = delayMs < 0;
        if (isLate) this.lateCount++;
        delayMs = 5;
      } else if (delayMs > this.maxFutureMs) {
        delayMs = this.playoutBufferMs;
      } else {
        this.syncedCount++;
      }

      return {
        playAtLocalMs: localNowMs + delayMs,
        delayMs: Math.round(delayMs),
        audioTimeOffsetSec: delayMs / 1000,
        isLate,
        dropped: false,
        offsetMs: Math.round(offset),
        jitterMs: Math.round(this.jitterMs)
      };
    }

    getDiagnostics() {
      return {
        playoutBufferMs: this.playoutBufferMs,
        offsetMs: this.offsetMs !== null ? Math.round(this.offsetMs) : 0,
        jitterMs: Math.round(this.jitterMs),
        syncedCount: this.syncedCount,
        lateCount: this.lateCount,
        droppedCount: this.droppedCount
      };
    }
  }

  /**
   * Pure Vanilla Binary MQTT 3.1.1 Packet Codec (for WebSocket 'mqtt' subprotocol)
   */
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function encodeVarInt(num) {
    const out = [];
    let x = num >>> 0;
    do {
      let encodedByte = x % 128;
      x = Math.floor(x / 128);
      if (x > 0) encodedByte |= 128;
      out.push(encodedByte);
    } while (x > 0);
    return out;
  }

  function decodeVarInt(bytes, startOffset = 1) {
    let multiplier = 1;
    let value = 0;
    let idx = startOffset;
    let encodedByte = 0;
    do {
      if (idx >= bytes.length) return null;
      encodedByte = bytes[idx++];
      value += (encodedByte & 127) * multiplier;
      if (multiplier > 128 * 128 * 128) throw new Error('Malformed MQTT remaining length');
      multiplier *= 128;
    } while ((encodedByte & 128) !== 0);
    return { value, nextOffset: idx };
  }

  function encodeUtf8Field(str) {
    const utf8 = textEncoder.encode(String(str || ''));
    const out = new Uint8Array(2 + utf8.length);
    out[0] = (utf8.length >> 8) & 0xFF;
    out[1] = utf8.length & 0xFF;
    out.set(utf8, 2);
    return out;
  }

  function concatBytes(chunks) {
    let total = 0;
    for (let i = 0; i < chunks.length; i++) total += chunks[i].length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      out.set(chunks[i], offset);
      offset += chunks[i].length;
    }
    return out;
  }

  const MqttCodec = {
    encodeVarInt,
    decodeVarInt,

    encodeConnect(clientId, keepAliveSec = 30, username = '', password = '') {
      const protoName = encodeUtf8Field('MQTT');
      const protoLevel = new Uint8Array([0x04]); // MQTT 3.1.1
      let flags = 0x02; // Clean session
      const payloadParts = [encodeUtf8Field(clientId)];
      if (username) {
        flags |= 0x80;
        payloadParts.push(encodeUtf8Field(username));
        if (password) {
          flags |= 0x40;
          payloadParts.push(encodeUtf8Field(password));
        }
      }
      const varHeader = concatBytes([
        protoName,
        protoLevel,
        new Uint8Array([flags, (keepAliveSec >> 8) & 0xFF, keepAliveSec & 0xFF])
      ]);
      const payload = concatBytes(payloadParts);
      const remLen = encodeVarInt(varHeader.length + payload.length);
      return concatBytes([new Uint8Array([0x10, ...remLen]), varHeader, payload]);
    },

    encodeSubscribe(packetId, topics) {
      const topicList = Array.isArray(topics) ? topics : [topics];
      const idBytes = new Uint8Array([(packetId >> 8) & 0xFF, packetId & 0xFF]);
      const subParts = [idBytes];
      for (let i = 0; i < topicList.length; i++) {
        subParts.push(encodeUtf8Field(topicList[i]));
        subParts.push(new Uint8Array([0x00])); // QoS 0
      }
      const body = concatBytes(subParts);
      const remLen = encodeVarInt(body.length);
      return concatBytes([new Uint8Array([0x82, ...remLen]), body]);
    },

    encodePublish(topic, payloadStrOrBytes, retain = false) {
      const topicField = encodeUtf8Field(topic);
      const payloadBytes = typeof payloadStrOrBytes === 'string'
        ? textEncoder.encode(payloadStrOrBytes)
        : payloadStrOrBytes;
      const body = concatBytes([topicField, payloadBytes]);
      const remLen = encodeVarInt(body.length);
      const headerByte = 0x30 | (retain ? 0x01 : 0x00); // QoS 0
      return concatBytes([new Uint8Array([headerByte, ...remLen]), body]);
    },

    encodePingReq() {
      return new Uint8Array([0xC0, 0x00]);
    },

    encodeDisconnect() {
      return new Uint8Array([0xE0, 0x00]);
    },

    decodePackets(bufferBytes) {
      const packets = [];
      let offset = 0;
      while (offset < bufferBytes.length) {
        if (bufferBytes.length - offset < 2) break;
        const firstByte = bufferBytes[offset];
        const type = firstByte >> 4;
        const flags = firstByte & 0x0F;
        const rem = decodeVarInt(bufferBytes, offset + 1);
        if (!rem) break; // Incomplete header
        const packetEnd = rem.nextOffset + rem.value;
        if (packetEnd > bufferBytes.length) break; // Incomplete body

        const body = bufferBytes.subarray(rem.nextOffset, packetEnd);
        if (type === 2) {
          // CONNACK
          packets.push({ type: 'connack', returnCode: body[1] || 0 });
        } else if (type === 3) {
          // PUBLISH
          const topicLen = (body[0] << 8) | body[1];
          const topic = textDecoder.decode(body.subarray(2, 2 + topicLen));
          const qos = (flags >> 1) & 0x03;
          const payloadStart = 2 + topicLen + (qos > 0 ? 2 : 0);
          const payloadBytes = body.subarray(payloadStart);
          const payloadText = textDecoder.decode(payloadBytes);
          packets.push({
            type: 'publish',
            topic,
            qos,
            retain: (flags & 0x01) !== 0,
            payloadText
          });
        } else if (type === 9) {
          packets.push({ type: 'suback', packetId: (body[0] << 8) | body[1] });
        } else if (type === 13) {
          packets.push({ type: 'pingresp' });
        }
        offset = packetEnd;
      }
      return {
        packets,
        remaining: bufferBytes.subarray(offset)
      };
    }
  };

  /**
   * Computes anti-pop minimum ADSR slews for 'amp', 'filter', and 'pitch' envelopes.
   * Ensures low-sustain decays and short note-offs never truncate low-frequency waveforms
   * mid-cycle or slam resonant BiquadFilterNodes in <45ms while the VCA is still audible.
   */
  function computeSafeEnvelopeTimings(envConfig, type = 'amp', companionAmpRel = 0) {
    const rawAtk = Number(envConfig && envConfig.atk);
    const rawDec = Number(envConfig && envConfig.dec);
    const rawRel = Number(envConfig && envConfig.rel);

    if (type === 'filter') {
      const safeAtk = Math.max(0.012, isFinite(rawAtk) && rawAtk > 0 ? rawAtk : 0.02);
      const safeDec = Math.max(0.045, isFinite(rawDec) && rawDec > 0 ? rawDec : 0.08);
      // If filter release was left at legacy 10ms default while amp release rings out,
      // couple filter release gently so note-off never slams the filter mid-ring.
      const baseRel = Math.max(0.050, isFinite(rawRel) && rawRel > 0 ? rawRel : 0.08);
      const coupledRel = (isFinite(rawRel) && rawRel <= 0.02 && companionAmpRel > 0.08)
        ? Math.min(0.35, Math.max(baseRel, companionAmpRel * 0.55))
        : baseRel;
      return { safeAtk, safeDec, safeRel: coupledRel };
    }

    if (type === 'amp') {
      return {
        safeAtk: Math.max(0.006, isFinite(rawAtk) && rawAtk > 0 ? rawAtk : 0.01),
        safeDec: Math.max(0.024, isFinite(rawDec) && rawDec > 0 ? rawDec : 0.024),
        safeRel: Math.max(0.024, isFinite(rawRel) && rawRel > 0 ? rawRel : 0.024)
      };
    }

    return {
      safeAtk: Math.max(0.006, isFinite(rawAtk) && rawAtk > 0 ? rawAtk : 0.01),
      safeDec: Math.max(0.015, isFinite(rawDec) && rawDec > 0 ? rawDec : 0.015),
      safeRel: Math.max(0.015, isFinite(rawRel) && rawRel > 0 ? rawRel : 0.015)
    };
  }

  /**
   * Evaluates a scheduled ADSR trajectory at arbitrary `queryTime` (matching Web Audio
   * linearRampToValueAtTime or exponentialRampToValueAtTime math) so voice stealing
   * and ahead-of-time MQTT scheduling know the exact parameter value at `safeNow`
   * instead of reading stale `AudioParam.value` at `audioCtx.currentTime`.
   */
  function evalAdsrAtTime(seg, queryTime) {
    if (!seg) return 0;
    const {
      startTime, stopTime, relEnd,
      startVal, peakVal, susVal, endVal,
      safeAtk, safeDec, exponential
    } = seg;

    if (queryTime <= startTime) return startVal;
    if (queryTime >= relEnd) return endVal;

    const interp = (a, b, frac) => {
      const t = Math.max(0, Math.min(1, frac));
      if (exponential) {
        const sa = Math.max(1e-5, a);
        const sb = Math.max(1e-5, b);
        return sa * Math.pow(sb / sa, t);
      }
      return a + (b - a) * t;
    };

    const noteDur = Math.max(0.01, stopTime - startTime);
    let releaseStartVal = susVal;
    if (noteDur <= safeAtk) {
      releaseStartVal = interp(startVal, peakVal, noteDur / safeAtk);
      if (queryTime <= stopTime) {
        return interp(startVal, peakVal, (queryTime - startTime) / safeAtk);
      }
    } else if (noteDur <= safeAtk + safeDec) {
      const atkEnd = startTime + safeAtk;
      releaseStartVal = interp(peakVal, susVal, (noteDur - safeAtk) / safeDec);
      if (queryTime <= atkEnd) {
        return interp(startVal, peakVal, (queryTime - startTime) / safeAtk);
      }
      if (queryTime <= stopTime) {
        return interp(peakVal, susVal, (queryTime - atkEnd) / safeDec);
      }
    } else {
      const atkEnd = startTime + safeAtk;
      const decEnd = atkEnd + safeDec;
      if (queryTime <= atkEnd) {
        return interp(startVal, peakVal, (queryTime - startTime) / safeAtk);
      }
      if (queryTime <= decEnd) {
        return interp(peakVal, susVal, (queryTime - atkEnd) / safeDec);
      }
      if (queryTime <= stopTime) {
        return susVal;
      }
    }

    const relDur = Math.max(0.001, relEnd - stopTime);
    return interp(releaseStartVal, endVal, (queryTime - stopTime) / relDur);
  }

  /**
   * Pure state transition for assigning or toggling a specific remote stream channel
   * `(feedId, remoteCh)` onto a local destination channel `localCh` (0..3).
   * `followPatch` defaults to `true` (`AUTO` mode: follows the plant artist's synth patch & automation).
   */
  function toggleChannelRoute(currentRoutes, localCh, feedId, remoteCh = 0, defaultFollowPatch = true) {
    const next = Array.isArray(currentRoutes) ? currentRoutes.slice(0, 4) : [null, null, null, null];
    while (next.length < 4) next.push(null);
    const ch = parseInt(localCh, 10);
    if (isNaN(ch) || ch < 0 || ch > 3) return next;

    if (!feedId) {
      next[ch] = null;
      return next;
    }

    const rCh = Math.max(0, Math.min(3, parseInt(remoteCh, 10) || 0));
    const existing = next[ch];
    if (existing && existing.feedId === feedId && existing.remoteCh === rCh) {
      next[ch] = null;
    } else {
      next[ch] = {
        feedId: String(feedId),
        remoteCh: rCh,
        followPatch: Boolean(defaultFollowPatch)
      };
    }
    return next;
  }

  /**
   * Validates whether an incoming MQTT `/meta` discovery packet represents a genuinely
   * active live session rather than a stale retained message replayed by a public broker.
   */
  function isLiveFeedMetaFresh(metaPayload, nowMs = Date.now(), maxAgeMs = 25000, isRetained = true) {
    if (!metaPayload || typeof metaPayload !== 'object') return false;
    if (metaPayload.online === false) return false;
    const ts = Number(metaPayload.ts);
    // Live non-retained packet from an online ESP32 whose NTP clock has not locked yet (uptime ms)
    if (!isRetained && metaPayload.hw === true && isFinite(ts) && ts > 0 && ts <= 1700000000000) {
      return true;
    }
    if (!isFinite(ts) || ts <= 1700000000000) return false;
    const age = nowMs - ts;
    const windowMs = isRetained ? maxAgeMs : Math.max(maxAgeMs, 60000);
    return age >= -windowMs && age <= windowMs;
  }

  /**
   * Hardware ESP32 TCP/TLS <-> Browser WSS Broker Presets
   */
  const HW_BROKER_PRESETS = {
    mosquitto: {
      host: 'test.mosquitto.org',
      port: 1883,
      tlsPort: 8883,
      tls: false,
      wssUrl: 'wss://test.mosquitto.org:8081/mqtt'
    },
    emqx: {
      host: 'broker.emqx.io',
      port: 1883,
      tlsPort: 8883,
      tls: false,
      wssUrl: 'wss://broker.emqx.io:8084/mqtt'
    },
    hivemq: {
      host: 'broker.hivemq.com',
      port: 1883,
      tlsPort: 8883,
      tls: false,
      wssUrl: 'wss://broker.hivemq.com:8884/mqtt'
    }
  };

  /**
   * Normalizes a user-entered MQTT broker host for ESP32 TCP/TLS PubSubClient.
   * Gracefully strips accidental `wss://`, `mqtts://`, `/mqtt` paths, and translates
   * browser WebSocket ports (8081, 8083, 8084, 8884) to native MQTT TCP/TLS ports.
   */
  function sanitizeBrokerHostInput(rawHost, rawPort = 1883, rawTls = false) {
    let str = String(rawHost || '').trim();
    let impliedTls = Boolean(rawTls);
    let parsedPort = parseInt(rawPort, 10);
    let urlPort = NaN;

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(str)) {
      const schemeMatch = str.match(/^([a-z0-9+.-]+):\/\//i);
      const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : '';
      if (scheme === 'mqtts' || scheme === 'ssl' || scheme === 'tls') {
        impliedTls = true;
      }
      try {
        const u = new URL(str);
        str = u.hostname || '';
        if (u.port) urlPort = parseInt(u.port, 10);
      } catch (e) {
        str = str.replace(/^[a-z0-9+.-]+:\/\//i, '').split('/')[0];
      }
    } else {
      str = str.split('/')[0].trim();
    }

    // Strip `:port` suffix if attached to bare host:port
    const colonIdx = str.lastIndexOf(':');
    if (colonIdx > 0 && str.indexOf(':') === colonIdx) {
      const maybePort = parseInt(str.slice(colonIdx + 1), 10);
      if (!isNaN(maybePort) && maybePort > 0 && maybePort <= 65535) {
        urlPort = maybePort;
        str = str.slice(0, colonIdx);
      }
    }

    const host = str.replace(/[^a-zA-Z0-9.-]/g, '').toLowerCase() || 'test.mosquitto.org';

    // Translate browser WebSocket ports if user pasted a wss:// URL
    const wsPlainPorts = new Set([8080, 8083, 9001]);
    const wsTlsPorts = new Set([8081, 8084, 8884, 443]);

    let candidatePort = (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) ? parsedPort : 1883;
    if (!isNaN(urlPort) && urlPort > 0 && urlPort <= 65535) {
      if (wsPlainPorts.has(urlPort)) {
        candidatePort = 1883;
      } else if (wsTlsPorts.has(urlPort)) {
        // Public brokers offer plain TCP 1883 for ESP32 unless user explicitly enabled TLS;
        // Private cloud clusters (HiveMQ Cloud / EMQX Cloud) require TLS 8883
        const isKnownPublic = host === 'test.mosquitto.org' || host === 'broker.emqx.io' || host === 'broker.hivemq.com';
        if (isKnownPublic && !rawTls) {
          candidatePort = 1883;
        } else {
          candidatePort = 8883;
          impliedTls = true;
        }
      } else {
        candidatePort = urlPort;
      }
    } else if (wsPlainPorts.has(candidatePort)) {
      candidatePort = 1883;
    } else if (wsTlsPorts.has(candidatePort)) {
      candidatePort = impliedTls ? 8883 : 1883;
    }

    if (candidatePort === 8883) {
      impliedTls = true;
    }

    return {
      host,
      port: candidatePort,
      tls: impliedTls
    };
  }

  /**
   * Maps an ESP32 MQTT broker hostname to its corresponding browser WebSocket (`wss://`) URL
   * so clicking "OPEN STREAM" connects the web app to the exact same broker bus.
   */
  function resolveWssUrlForHardwareHost(rawHost, tls = false, currentWssUrl = '') {
    const clean = sanitizeBrokerHostInput(rawHost, tls ? 8883 : 1883, tls);
    const host = clean.host;
    if (host === 'test.mosquitto.org') return HW_BROKER_PRESETS.mosquitto.wssUrl;
    if (host === 'broker.emqx.io') return HW_BROKER_PRESETS.emqx.wssUrl;
    if (host === 'broker.hivemq.com') return HW_BROKER_PRESETS.hivemq.wssUrl;

    if (currentWssUrl) {
      try {
        const cur = new URL(currentWssUrl);
        if (cur.hostname.toLowerCase() === host && (cur.protocol === 'wss:' || cur.protocol === 'ws:')) {
          return currentWssUrl.trim();
        }
      } catch (e) {}
    }

    // Standard HiveMQ Cloud / EMQX Serverless / Cloud MQTT WSS endpoint
    return `wss://${host}:8884/mqtt`;
  }

  /**
   * Builds a line-framed `NETCFG:{...}\n` JSON command for provisioning ESP32 WiFi & Cloud MQTT
   * over BLE GATT or USB Serial. Preserves existing NVS passwords via `"__KEEP__"` when left blank.
   */
  function buildHardwareNetConfigCommand(input = {}, lastHwStatus = null) {
    const en = input.en !== undefined ? (input.en ? 1 : 0) : 1;
    const ssid = String(input.ssid ?? '').trim().slice(0, 64);
    const rawWpass = String(input.wpass ?? '');
    const broker = sanitizeBrokerHostInput(input.host, input.port, Boolean(input.tls));
    const muser = String(input.muser ?? '').trim().slice(0, 64);
    const rawMpass = String(input.mpass ?? '');

    const rawId = String(input.id ?? '').trim();
    const id = rawId
      ? sanitizeSessionFilename(rawId, 'esp32-bioquad').toLowerCase().replace(/\./g, '-').slice(0, 40)
      : 'esp32-bioquad-01';

    const name = String(input.name ?? '').trim().slice(0, 40) || 'ESP32 BioQuad';

    let wpass = rawWpass;
    if (
      wpass === '' &&
      !input.clearWpass &&
      lastHwStatus &&
      lastHwStatus.hasWpass &&
      (!lastHwStatus.ssid || lastHwStatus.ssid === ssid)
    ) {
      wpass = '__KEEP__';
    }

    let mpass = rawMpass;
    if (
      mpass === '' &&
      !input.clearMpass &&
      lastHwStatus &&
      lastHwStatus.hasMpass &&
      (!lastHwStatus.muser || lastHwStatus.muser === muser)
    ) {
      mpass = '__KEEP__';
    }

    const payload = {
      en,
      ssid,
      wpass,
      host: broker.host,
      port: broker.port,
      tls: broker.tls ? 1 : 0,
      muser,
      mpass,
      id,
      name
    };

    if (input.envMs !== undefined && input.envMs !== null && input.envMs !== '') {
      payload.envMs = normalizeEnvRateMs(input.envMs);
    }

    return {
      command: `NETCFG:${JSON.stringify(payload)}\n`,
      payload
    };
  }

  /**
   * Normalizes an environmental I2C sensor rate setting:
   *  - `0`  -> OFF
   *  - `-1` -> ON CHANGE (anti-jitter hysteresis deadband)
   *  - `100..600000` -> periodic polling interval in milliseconds (default 15000ms)
   */
  function normalizeEnvRateMs(raw) {
    if (raw === 'off' || raw === 'OFF' || raw === 0 || raw === '0') return 0;
    if (raw === 'change' || raw === 'onchange' || raw === 'ON_CHANGE' || raw === -1 || raw === '-1') return -1;
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed)) return 15000;
    if (parsed === 0) return 0;
    if (parsed < 0) return -1;
    return Math.max(100, Math.min(600000, parsed));
  }

  function formatEnvRateLabel(rateMs) {
    const clean = normalizeEnvRateMs(rateMs);
    if (clean === 0) return 'OFF';
    if (clean < 0) return 'ON CHANGE (\u00B10.5\u00B0F)';
    if (clean < 1000) return `${clean}ms`;
    return `${Math.round(clean / 1000)}s`;
  }

  function buildHardwareEnvConfigCommand(rawRate) {
    const ms = normalizeEnvRateMs(rawRate);
    return {
      ms,
      command: `ENVCFG:${JSON.stringify({ ms })}\n`
    };
  }

  /**
   * Parses a channel stream selector value `"<feedId>:<remoteCh>"` into `{ feedId, remoteCh }`
   * or returns `null` when `"Local Input"` (`""`) is selected.
   */
  function parseStreamSelectValue(rawValue) {
    const str = String(rawValue || '').trim();
    if (!str) return null;
    const sep = str.lastIndexOf(':');
    if (sep <= 0) return null;
    const feedId = str.slice(0, sep).trim();
    const chNum = parseInt(str.slice(sep + 1), 10);
    if (!feedId || isNaN(chNum)) return null;
    return {
      feedId,
      remoteCh: Math.max(0, Math.min(3, chNum))
    };
  }

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const SCALE_SHORT_LABELS = {
    chromatic: 'Chrom',
    major: 'Maj',
    minor: 'Min',
    pentatonic_major: 'Maj5',
    pentatonic_minor: 'Min5',
    hirajoshi: 'Hira',
    custom: 'Custom'
  };
  const WAVE_SHORT_LABELS = {
    sine: 'Sin',
    triangle: 'Tri',
    sawtooth: 'Saw',
    square: 'Sqr',
    drums: 'Drums'
  };

  /**
   * Builds a concise musical summary label for a channel synth patch (e.g. "Soft Plucks" or "Tri · C Min5").
   */
  function summarizePatch(patchObj) {
    if (!patchObj || typeof patchObj !== 'object') return '';
    const pName = String(patchObj.patchName || '').trim();
    const p = patchObj.params || patchObj;
    const oscType = p && p.sources && p.sources.osc1 ? p.sources.osc1.type : 'sawtooth';
    const waveLbl = WAVE_SHORT_LABELS[oscType] || 'Syn';
    const rootIdx = ((parseInt(p && p.scaleRoot, 10) || 0) % 12 + 12) % 12;
    const sType = (p && p.scaleType) || 'chromatic';
    const scaleLbl = sType === 'chromatic'
      ? 'Chrom'
      : `${NOTE_NAMES[rootIdx]} ${SCALE_SHORT_LABELS[sType] || sType}`;

    if (pName && pName !== 'INIT') {
      return `${pName} · ${scaleLbl}`;
    }
    return `${waveLbl} · ${scaleLbl}`;
  }

  /**
   * Extracts a compact, network-safe synth patch snapshot for MQTT sharing.
   * Strips listener-local routing/output properties (`midiOutCh`, `mixVol`, `muted`)
   * so the artist's sound design & scale travel with the stream without hijacking
   * a subscriber's external MIDI channel or mixer levels.
   */
  function extractShareablePatch(rawParams, patchName = 'INIT') {
    if (!rawParams || typeof rawParams !== 'object') return null;
    const cloned = JSON.parse(JSON.stringify(rawParams));
    delete cloned.midiOutCh;
    delete cloned.mixVol;
    delete cloned.muted;
    delete cloned.savedPatchName;

    cloned.scaleMask = encodeScaleMask(cloned.activeScaleBits);
    delete cloned.activeScaleBits;

    const cleanName = String(patchName || rawParams.savedPatchName || 'INIT').trim().slice(0, 36) || 'INIT';
    return {
      patchName: cleanName,
      params: cloned
    };
  }

  /**
   * Merges an incoming remote artist synth patch onto a subscriber's local channel params
   * while strictly preserving the subscriber's local `midiOutCh`, `mixVol`, and `muted` state.
   */
  function mergeRemotePatchIntoLocal(localParams, remotePatchOrParams, baseDefaults = null) {
    const incomingRaw = (remotePatchOrParams && remotePatchOrParams.params && typeof remotePatchOrParams.params === 'object')
      ? remotePatchOrParams.params
      : remotePatchOrParams;

    const base = baseDefaults
      ? JSON.parse(JSON.stringify(baseDefaults))
      : (localParams ? JSON.parse(JSON.stringify(localParams)) : {});
    const local = (localParams && typeof localParams === 'object') ? localParams : {};
    const src = (incomingRaw && typeof incomingRaw === 'object') ? JSON.parse(JSON.stringify(incomingRaw)) : {};

    // Preserve listener-local output & mixer state
    const keepMidiOutCh = local.midiOutCh;
    const keepMixVol = local.mixVol !== undefined ? local.mixVol : (base.mixVol !== undefined ? base.mixVol : 0.5);
    const keepMuted = Boolean(local.muted);

    const merged = Object.assign({}, base, local, src);
    const nestedGroups = ['sources', 'filter', 'lfo', 'pitchLfo', 'filterLfo', 'ampLfo', 'env', 'pitchEnv', 'filterEnv', 'ampEnv', 'fx'];
    for (let i = 0; i < nestedGroups.length; i++) {
      const k = nestedGroups[i];
      if ((base[k] && typeof base[k] === 'object') || (local[k] && typeof local[k] === 'object') || (src[k] && typeof src[k] === 'object')) {
        merged[k] = Object.assign({}, base[k] || {}, local[k] || {}, src[k] || {});
        if (k === 'sources') {
          merged.sources.osc1 = Object.assign(
            {},
            (base.sources && base.sources.osc1) || {},
            (local.sources && local.sources.osc1) || {},
            (src.sources && src.sources.osc1) || {}
          );
          merged.sources.noise = Object.assign(
            {},
            (base.sources && base.sources.noise) || {},
            (local.sources && local.sources.noise) || {},
            (src.sources && src.sources.noise) || {}
          );
        }
      }
    }

    const decodedBits = decodeScaleBits(
      src.activeScaleBits !== undefined ? src.activeScaleBits : src.scaleMask
    );
    if (decodedBits) {
      merged.activeScaleBits = decodedBits;
    } else if (merged.scaleType && SCALES[merged.scaleType]) {
      merged.activeScaleBits = buildScaleBitsFromPreset(merged.scaleType, merged.scaleRoot || 0);
    } else if (!Array.isArray(merged.activeScaleBits) || merged.activeScaleBits.length !== 12) {
      merged.activeScaleBits = new Array(12).fill(true);
    }
    delete merged.scaleMask;

    if (keepMidiOutCh !== undefined) merged.midiOutCh = keepMidiOutCh;
    else delete merged.midiOutCh;
    merged.mixVol = keepMixVol;
    merged.muted = keepMuted;

    return merged;
  }

  /**
   * Builds a flat, filtered, ranked list of stream rows for the live STREAMS directory.
   * Scales cleanly to dozens of concurrent MQTT rigs by hiding idle sub-channels by default
   * (unless routed or `showIdle` is enabled) and supporting instant text search.
   */
  function filterStreamDirectoryRows(feeds, options = {}) {
    const list = Array.isArray(feeds) ? feeds : [];
    const query = String(options.query || '').trim().toLowerCase();
    const showIdle = Boolean(options.showIdle);
    const showSim = Boolean(options.showSim);
    const routes = Array.isArray(options.channelRoutes) ? options.channelRoutes : [null, null, null, null];
    const txChStats = Array.isArray(options.txChStats) ? options.txChStats : [];

    const rows = [];

    for (let fIdx = 0; fIdx < list.length; fIdx++) {
      const feed = list[fIdx];
      if (!feed || !feed.feedId) continue;

      const isFeedRouted = routes.some(r => r && r.feedId === feed.feedId);
      if (feed.isVirtualUtc && !showSim && !isFeedRouted) {
        continue;
      }

      const chCount = Math.max(1, Math.min(4, parseInt(feed.channels, 10) || 4));
      let anySubActive = false;
      const chPktCounts = [];

      for (let rCh = 0; rCh < chCount; rCh++) {
        const rxPkts = Array.isArray(feed.chStats) && feed.chStats[rCh] ? (feed.chStats[rCh].msgCount || 0) : 0;
        const txPkts = feed.isSelfBroadcast && txChStats[rCh] ? (txChStats[rCh].msgCount || 0) : 0;
        const count = Math.max(rxPkts, txPkts);
        chPktCounts.push(count);
        if (count > 0) anySubActive = true;
      }

      for (let rCh = 0; rCh < chCount; rCh++) {
        const pktCount = chPktCounts[rCh];
        const routedLocalChs = [];
        for (let lCh = 0; lCh < 4; lCh++) {
          const rt = routes[lCh];
          if (rt && rt.feedId === feed.feedId && (rt.remoteCh || 0) === rCh) {
            routedLocalChs.push(lCh);
          }
        }

        const isActive = Boolean(feed.isVirtualUtc) || pktCount > 0;
        // Show sub-channel if: active, currently routed, user requested Idle streams,
        // OR if a live feed just announced with 0 packets across all 4 channels (show S1 placeholder)
        const showAsReadyPlaceholder = !feed.isVirtualUtc && !anySubActive && rCh === 0;
        if (!showIdle && !isActive && routedLocalChs.length === 0 && !showAsReadyPlaceholder) {
          continue;
        }

        const patchObj = Array.isArray(feed.patches) ? feed.patches[rCh] : null;
        const patchSummary = patchObj ? summarizePatch(patchObj) : '';

        if (query) {
          const haystack = [
            feed.name || '',
            feed.feedId || '',
            feed.location || '',
            feed.species || '',
            `s${rCh + 1}`,
            `stream ${rCh + 1}`,
            patchSummary,
            patchObj && patchObj.patchName ? patchObj.patchName : ''
          ].join(' ').toLowerCase();
          if (!haystack.includes(query)) continue;
        }

        rows.push({
          key: `${feed.feedId}:${rCh}`,
          feedId: feed.feedId,
          feedName: feed.name || feed.feedId,
          location: feed.location || '',
          species: feed.species || '',
          remoteCh: rCh,
          streamLabel: `S${rCh + 1}`,
          pktCount,
          isActive: pktCount > 0 || Boolean(feed.isVirtualUtc),
          isVirtualUtc: Boolean(feed.isVirtualUtc),
          isSelfBroadcast: Boolean(feed.isSelfBroadcast),
          routedLocalChs,
          patchSummary,
          hasPatch: Boolean(patchObj)
        });
      }
    }

    rows.sort((a, b) => {
      // 1. Virtual UTC feeds always after live MQTT feeds (unless routed)
      const aVirt = a.isVirtualUtc ? 1 : 0;
      const bVirt = b.isVirtualUtc ? 1 : 0;
      if (aVirt !== bVirt) return aVirt - bVirt;

      // 2. Currently routed streams or self-broadcast first
      const aRouted = a.routedLocalChs.length > 0 ? 1 : 0;
      const bRouted = b.routedLocalChs.length > 0 ? 1 : 0;
      if (aRouted !== bRouted) return bRouted - aRouted;

      if (a.isSelfBroadcast !== b.isSelfBroadcast) {
        return a.isSelfBroadcast ? -1 : 1;
      }

      // 3. Active packet streams ahead of 0-packet ready placeholders
      const aLive = a.pktCount > 0 ? 1 : 0;
      const bLive = b.pktCount > 0 ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive;

      const cmpName = a.feedName.localeCompare(b.feedName);
      if (cmpName !== 0) return cmpName;
      return a.remoteCh - b.remoteCh;
    });

    return rows;
  }

  /**
   * Beat durations (in quarter-note beats) for bioQuad's 9 quantize steps:
   * 0: FR (Free), 1: /64, 2: /32, 3: /16, 4: /8, 5: /4, 6: /4T, 7: /2, 8: 1B (4-beat Bar / Beat 1)
   */
  const QUANTIZE_BEAT_STEPS = [
    0,        // 0: FR
    0.0625,   // 1: /64
    0.125,    // 2: /32
    0.25,     // 3: /16
    0.5,      // 4: /8
    1.0,      // 5: /4 (every beat)
    2 / 3,    // 6: /4T (quarter-note triplet aligned to Beat 1 & Beat 3)
    2.0,      // 7: /2 (Beat 1 & Beat 3)
    4.0       // 8: 1B (Beat 1 downbeat of each 4/4 bar)
  ];

  /**
   * Computes exact bar/cycle, Beat 1..4 index, 24-PPQN tick, and normalized phases
   * for any WebAudio timestamp relative to the Beat-1 clock anchor.
   */
  function computeClockPhaseAtTime(queryAudioTime, anchorAudioTime = 0, anchorTotalBeats = 0, bpm = 120, beatsPerBar = 4, ppqn = 24) {
    const safeBpm = Math.max(20, Math.min(300, Number(bpm) || 120));
    const safeBpb = Math.max(1, Math.round(Number(beatsPerBar) || 4));
    const safePpqn = Math.max(1, Math.round(Number(ppqn) || 24));
    const secPerBeat = 60 / safeBpm;
    const elapsedSec = (Number(queryAudioTime) || 0) - (Number(anchorAudioTime) || 0);
    const rawBeats = (Number(anchorTotalBeats) || 0) + (elapsedSec / secPerBeat);
    const totalBeats = rawBeats >= 0 ? rawBeats : 0;

    const cycle = totalBeats / safeBpb;
    const barIndex = Math.floor(cycle + 1e-9);
    const beatInBarFloat = ((totalBeats % safeBpb) + safeBpb) % safeBpb;
    const beatIndex = Math.floor(beatInBarFloat + 1e-9) % safeBpb;
    const beatPhase = Math.max(0, Math.min(0.999999, beatInBarFloat - Math.floor(beatInBarFloat)));
    const barPhase = Math.max(0, Math.min(0.999999, beatInBarFloat / safeBpb));
    const totalTicks = Math.floor(totalBeats * safePpqn + 1e-6);
    const ticksPerBar = safeBpb * safePpqn;
    const tickInBar = ((totalTicks % ticksPerBar) + ticksPerBar) % ticksPerBar;

    return {
      bpm: safeBpm,
      totalBeats,
      cycle,
      barIndex,
      beatIndex,
      beatInBar: beatIndex,
      beatNumber: beatIndex + 1,
      isDownbeat: beatIndex === 0,
      barPhase,
      beatPhase,
      tickCount: totalTicks,
      tickInBar
    };
  }

  /**
   * Snaps a target WebAudio timestamp forward onto the shared Beat-1 bar grid.
   * Because all 4 channels share the same Beat-1 `anchorAudioTime` and `anchorTotalBeats`,
   * 1B (step 8) lands exclusively on Beat 1, /2 (step 7) lands on Beat 1 & Beat 3,
   * and /4 (step 5) lands on Beats 1, 2, 3, 4 synchronously across channels.
   */
  function quantizeAudioTimestamp(rawAudioTime, anchorAudioTime = 0, bpm = 120, quantizeStep = 0, anchorTotalBeats = 0, beatsPerBar = 4) {
    const t = Number(rawAudioTime) || 0;
    const stepIdx = Math.max(0, Math.min(QUANTIZE_BEAT_STEPS.length - 1, Math.round(Number(quantizeStep) || 0)));
    const stepBeats = QUANTIZE_BEAT_STEPS[stepIdx];
    if (!stepBeats || stepBeats <= 0) return t;

    const safeBpm = Math.max(20, Math.min(300, Number(bpm) || 120));
    const safeBpb = Math.max(1, Math.round(Number(beatsPerBar) || 4));
    const secPerBeat = 60 / safeBpm;

    // Bar-origin audio time where totalBeats === 0 (or integer multiple of beatsPerBar)
    const barOriginAudioTime = (Number(anchorAudioTime) || 0) - ((Number(anchorTotalBeats) || 0) * secPerBeat);
    const beatsFromOrigin = (t - barOriginAudioTime) / secPerBeat;

    // Snap relative to the start of the current bar so triplets (/4T), /2, and 1B always lock to Beat 1
    const barIdx = Math.floor((beatsFromOrigin + 1e-7) / safeBpb);
    const barStartBeats = barIdx * safeBpb;
    const offsetInBar = Math.max(0, beatsFromOrigin - barStartBeats);
    let snappedInBar = Math.ceil((offsetInBar - 1e-6) / stepBeats) * stepBeats;
    if (snappedInBar >= safeBpb - 1e-6) {
      snappedInBar = safeBpb; // Wraps cleanly onto next bar's Beat 1!
    }
    const targetTotalBeats = barStartBeats + snappedInBar;
    return barOriginAudioTime + (targetTotalBeats * secPerBeat);
  }

  /**
   * Normalizes an incoming hardware or MQTT environmental sensor payload
   * (e.g. I2C SHT4x temperature/humidity `{"type":"env","sensor":"sht4x","tC":18.3,"tF":65.0,"rh":48.2}`
   * or `/meta` fields) into a clean canonical object. Returns `null` if no valid reading is present.
   */
  function normalizeEnvSensorPayload(payload, nowMs = Date.now()) {
    if (!payload || typeof payload !== 'object') return null;

    const rawTC = payload.tC !== undefined ? Number(payload.tC) : (payload.tempC !== undefined ? Number(payload.tempC) : NaN);
    const rawTF = payload.tF !== undefined ? Number(payload.tF) : (payload.tempF !== undefined ? Number(payload.tempF) : NaN);
    const rawRh = payload.rh !== undefined ? Number(payload.rh) : (payload.humidity !== undefined ? Number(payload.humidity) : NaN);
    const rawLux = payload.lux !== undefined ? Number(payload.lux) : NaN;
    const rawCo2 = payload.co2 !== undefined ? Number(payload.co2) : NaN;

    let tC = null;
    let tF = null;
    if (Number.isFinite(rawTC) && rawTC >= -60 && rawTC <= 130) {
      tC = Math.round(rawTC * 10) / 10;
      tF = Number.isFinite(rawTF) ? (Math.round(rawTF * 10) / 10) : (Math.round(((rawTC * 1.8) + 32) * 10) / 10);
    } else if (Number.isFinite(rawTF) && rawTF >= -76 && rawTF <= 266) {
      tF = Math.round(rawTF * 10) / 10;
      tC = Math.round(((rawTF - 32) / 1.8) * 10) / 10;
    }

    const rh = (Number.isFinite(rawRh) && rawRh >= 0 && rawRh <= 100) ? (Math.round(rawRh * 10) / 10) : null;
    const lux = (Number.isFinite(rawLux) && rawLux >= 0) ? Math.round(rawLux) : null;
    const co2 = (Number.isFinite(rawCo2) && rawCo2 >= 0) ? Math.round(rawCo2) : null;

    if (tF === null && rh === null && lux === null && co2 === null) {
      return null;
    }

    let ch = null;
    if (typeof payload.ch === 'number' && Number.isInteger(payload.ch) && payload.ch >= 0 && payload.ch <= 3) {
      ch = payload.ch;
    }

    const rawTs = Number(payload.ts);
    const ts = (Number.isFinite(rawTs) && rawTs > 0) ? rawTs : nowMs;
    const sensor = String(payload.sensor || 'sht4x').trim().slice(0, 24) || 'sht4x';

    return {
      sensor,
      ch,
      tC,
      tF,
      rh,
      lux,
      co2,
      ts,
      receivedAt: nowMs
    };
  }

  /**
   * Formats a normalized environmental sensor reading into a compact badge string
   * for the channel data block (e.g. `"65°F"` or `"18°C"`).
   */
  function formatEnvSensorDisplay(envObj, unit = 'F') {
    if (!envObj || typeof envObj !== 'object') return '';
    const useCelsius = String(unit || 'F').toUpperCase() === 'C';
    if (useCelsius && envObj.tC !== null && envObj.tC !== undefined && Number.isFinite(envObj.tC)) {
      return `${Math.round(envObj.tC)}\u00B0C`;
    }
    if (envObj.tF !== null && envObj.tF !== undefined && Number.isFinite(envObj.tF)) {
      return `${Math.round(envObj.tF)}\u00B0F`;
    }
    if (envObj.tC !== null && envObj.tC !== undefined && Number.isFinite(envObj.tC)) {
      const calcF = (envObj.tC * 1.8) + 32;
      return `${Math.round(calcF)}\u00B0F`;
    }
    if (envObj.rh !== null && envObj.rh !== undefined && Number.isFinite(envObj.rh)) {
      return `${Math.round(envObj.rh)}%RH`;
    }
    if (envObj.lux !== null && envObj.lux !== undefined && Number.isFinite(envObj.lux)) {
      return `${Math.round(envObj.lux)}lx`;
    }
    if (envObj.co2 !== null && envObj.co2 !== undefined && Number.isFinite(envObj.co2)) {
      return `${Math.round(envObj.co2)}ppm`;
    }
    return '';
  }

  /**
   * Formats a hover tooltip string with full 0.1° precision and relative humidity when available.
   */
  function formatEnvSensorTooltip(envObj) {
    if (!envObj || typeof envObj !== 'object') return '';
    const parts = [];
    if (envObj.tF !== null && envObj.tF !== undefined && Number.isFinite(envObj.tF)) {
      const cPart = (envObj.tC !== null && envObj.tC !== undefined && Number.isFinite(envObj.tC))
        ? ` (${envObj.tC.toFixed(1)}\u00B0C)`
        : '';
      parts.push(`${envObj.tF.toFixed(1)}\u00B0F${cPart}`);
    }
    if (envObj.rh !== null && envObj.rh !== undefined && Number.isFinite(envObj.rh)) {
      parts.push(`${Math.round(envObj.rh)}% RH`);
    }
    if (envObj.lux !== null && envObj.lux !== undefined && Number.isFinite(envObj.lux)) {
      parts.push(`${envObj.lux} lx`);
    }
    if (envObj.co2 !== null && envObj.co2 !== undefined && Number.isFinite(envObj.co2)) {
      parts.push(`${envObj.co2} ppm CO2`);
    }
    return parts.join(' \u00B7 ');
  }

  /**
   * Anti-jitter hysteresis gate for `ON CHANGE` environmental sensor mode.
   * Suppresses 1-LSB thermal/ADC chatter by anchoring deadbands (`±0.5°F`, `±1.5% RH`)
   * to the last emitted reading with a minimum cooldown and 60s baseline keepalive.
   */
  function shouldEmitEnvOnChange(prevEmitted, nextEnv, nowMs = Date.now(), opts = {}) {
    if (!nextEnv || typeof nextEnv !== 'object') return false;
    if (!prevEmitted || typeof prevEmitted !== 'object') return true;

    const cooldownMs = opts.cooldownMs !== undefined ? Number(opts.cooldownMs) : 1000;
    const heartbeatMs = opts.heartbeatMs !== undefined ? Number(opts.heartbeatMs) : 60000;
    const deadbandTempF = opts.deadbandTempF !== undefined ? Number(opts.deadbandTempF) : 0.5;
    const deadbandRh = opts.deadbandRh !== undefined ? Number(opts.deadbandRh) : 1.5;

    const prevTime = Number(prevEmitted.emittedAt ?? prevEmitted.receivedAt ?? 0);
    const elapsed = nowMs - prevTime;
    if (prevTime > 0 && elapsed >= heartbeatMs) return true;
    if (prevTime > 0 && elapsed < cooldownMs) return false;

    if (Number.isFinite(nextEnv.tF) && Number.isFinite(prevEmitted.tF)) {
      if (Math.abs(nextEnv.tF - prevEmitted.tF) >= deadbandTempF) return true;
    } else if (Number.isFinite(nextEnv.tF) !== Number.isFinite(prevEmitted.tF)) {
      return true;
    }

    if (Number.isFinite(nextEnv.rh) && Number.isFinite(prevEmitted.rh)) {
      if (Math.abs(nextEnv.rh - prevEmitted.rh) >= deadbandRh) return true;
    } else if (Number.isFinite(nextEnv.rh) !== Number.isFinite(prevEmitted.rh)) {
      return true;
    }

    if (Number.isFinite(nextEnv.lux)) {
      if (!Number.isFinite(prevEmitted.lux) || Math.abs(nextEnv.lux - prevEmitted.lux) >= Math.max(5, Math.abs(prevEmitted.lux) * 0.05)) {
        return true;
      }
    }

    if (Number.isFinite(nextEnv.co2)) {
      if (!Number.isFinite(prevEmitted.co2) || Math.abs(nextEnv.co2 - prevEmitted.co2) >= 15) {
        return true;
      }
    }

    return false;
  }

  /**
   * Determines whether a data column represents bioQuad admittance/conductance (`µS` + `kΩ` + `T` ticks)
   * or generic raw file data (e.g. NASA ISS telemetry, financial series, wind/weather CSVs).
   * Never forces `µS` or `kΩ` onto arbitrary uploaded datasets.
   */
  function inferColumnMetricMeta(colName, fileColumns = [], opts = {}) {
    if (opts && opts.forceBiodata) {
      return { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' };
    }
    if (opts && opts.forceMidiOnly) {
      return { isBiodata: false, unit: '', heading: 'MIDI EVENTS' };
    }

    const rawCol = String(colName || '').trim();
    const lower = rawCol.toLowerCase();
    const colsLower = Array.isArray(fileColumns) ? fileColumns.map(c => String(c || '').trim().toLowerCase()) : [];

    const isExplicitConductance =
      /(^|[_\s-])(conductance|admittance|microsiemens|siemens)([_\s-]|$)/i.test(lower) ||
      /(^|[_\s-])(us|\u00b5s|biometric_us|gsr_us)$/i.test(lower) ||
      ((lower === 'raw_ticks' || lower === 'ticks') && colsLower.some(c => c.includes('conductance')));

    if (isExplicitConductance) {
      return { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' };
    }

    // Non-biodata raw file column: infer unit ONLY when unambiguous in the column name; otherwise unitless ''
    let unit = '';
    if (/(^|[_\s-])(millivolts?|mv)$/i.test(lower)) unit = 'mV';
    else if (/(^|[_\s-])(volts?|voltage|vdc|vac)$/i.test(lower)) unit = 'V';
    else if (/(^|[_\s-])(milliamps?|ma)$/i.test(lower)) unit = 'mA';
    else if (/(^|[_\s-])(amps?|amperes?)$/i.test(lower)) unit = 'A';
    else if (/(^|[_\s-])(kpa|kilopascals?)$/i.test(lower)) unit = 'kPa';
    else if (/(^|[_\s-])(hpa|mbar)$/i.test(lower)) unit = 'hPa';
    else if (/(^|[_\s-])(psi)$/i.test(lower)) unit = 'psi';
    else if (/((temp|deg)[_\s-]*c|celsius)$/i.test(lower)) unit = '\u00B0C';
    else if (/((temp|deg)[_\s-]*f|fahrenheit)$/i.test(lower)) unit = '\u00B0F';
    else if (/(^|[_\s-])(dps|deg_per_s)$/i.test(lower)) unit = 'dps';
    else if (/(^|[_\s-])(mph)$/i.test(lower)) unit = 'mph';
    else if (/(^|[_\s-])(mps|m_per_s)$/i.test(lower)) unit = 'm/s';
    else if (/(^|[_\s-])(kph|kmh)$/i.test(lower)) unit = 'km/h';
    else if (/(^|[_\s-])(knots?|kts)$/i.test(lower)) unit = 'kn';
    else if (/(^|[_\s-])(bpm)$/i.test(lower)) unit = 'BPM';
    else if (/(^|[_\s-])(hz|hertz)$/i.test(lower)) unit = 'Hz';
    else if (/(^|[_\s-])(pct|percent|rh|humidity)$/i.test(lower)) unit = '%';
    else if (/(^|[_\s-])(ppm)$/i.test(lower)) unit = 'ppm';
    else if (/(^|[_\s-])(lux|lx)$/i.test(lower)) unit = 'lx';

    let cleaned = rawCol
      .replace(/[_\s-]+/g, ' ')
      .trim()
      .toUpperCase();

    if (/^(TEMP C|COOLANT TEMP C|AIR TEMP C)$/.test(cleaned) || cleaned.endsWith(' TEMP C')) {
      cleaned = cleaned.replace(/\s+C$/, '');
    } else if (cleaned.endsWith(' TEMP F')) {
      cleaned = cleaned.replace(/\s+F$/, '');
    }

    if (!cleaned || cleaned === 'VALUE' || cleaned === 'VAL' || cleaned === 'DATA') {
      cleaned = 'RAW DATA';
    } else if (cleaned.length > 16) {
      cleaned = cleaned.slice(0, 16).trim();
    }

    return {
      isBiodata: false,
      unit,
      heading: cleaned
    };
  }

  /**
   * Formats a channel numeric value according to its metric metadata (`µS` for biodata,
   * adaptive raw precision + optional explicit unit or unitless for uploaded files).
   */
  function formatChannelMetricValue(val, metricMeta = null, includeUnit = true) {
    const num = Number(val);
    if (!Number.isFinite(num)) return includeUnit && (!metricMeta || metricMeta.isBiodata !== false) ? '0.0 \u00B5S' : '0.0';

    const isBio = !metricMeta || metricMeta.isBiodata !== false;
    if (isBio) {
      const s = num.toFixed(1);
      return includeUnit ? `${s} \u00B5S` : s;
    }

    const abs = Math.abs(num);
    let s;
    if (abs === 0) s = '0.0';
    else if (abs >= 10000) s = Math.round(num).toString();
    else if (abs >= 10) s = num.toFixed(1);
    else if (abs >= 1) s = num.toFixed(2);
    else s = num.toFixed(3);

    const unit = (metricMeta && metricMeta.unit) ? String(metricMeta.unit) : '';
    return (includeUnit && unit) ? `${s} ${unit}` : s;
  }

  return {
    CALIBRATION_FACTOR,
    SCALES,
    QUANTIZE_BEAT_STEPS,
    HW_BROKER_PRESETS,
    ticksToConductance,
    resolveBioRecordValue,
    evaluateBioSampleWindow,
    sonifyBioSample,
    computeWindowStats,
    mapScale,
    applySpreadCurve,
    decodeScaleBits,
    encodeScaleMask,
    buildScaleBitsFromPreset,
    scaleNote,
    encodeThresholdCC,
    decodeThresholdCC,
    makeTimestampSlug,
    sanitizeSessionFilename,
    classifyHardwareError,
    computeSafeEnvelopeTimings,
    evalAdsrAtTime,
    toggleChannelRoute,
    isLiveFeedMetaFresh,
    sanitizeBrokerHostInput,
    resolveWssUrlForHardwareHost,
    buildHardwareNetConfigCommand,
    normalizeEnvRateMs,
    formatEnvRateLabel,
    buildHardwareEnvConfigCommand,
    parseStreamSelectValue,
    summarizePatch,
    extractShareablePatch,
    mergeRemotePatchIntoLocal,
    filterStreamDirectoryRows,
    computeClockPhaseAtTime,
    quantizeAudioTimestamp,
    normalizeEnvSensorPayload,
    formatEnvSensorDisplay,
    formatEnvSensorTooltip,
    shouldEmitEnvOnChange,
    inferColumnMetricMeta,
    formatChannelMetricValue,
    LineStreamParser,
    PlayoutSyncController,
    MqttCodec,
    concatBytes
  };
});


