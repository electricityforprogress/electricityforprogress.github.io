/**
 * js/usbSerial.js
 * bioQuad USB Serial & WebUSB CDC-ACM Hardware Transport Engine
 *
 * Allows users to connect the ESP32 bioQuad device via USB-C cable directly to
 * their computer or Android phone/tablet to stream high-speed raw 555-timer
 * ticks, MIDI/note JSON, and NVS parameter sync without BLE GATT bottlenecks.
 */
(function (window) {
  'use strict';

  const Core = window.BioQuadCore;
  const encoder = new TextEncoder();

  // Known USB Vendor IDs mapped to friendly hardware names after port selection
  const USB_VENDOR_LABELS = {
    0xCAFE: 'Biodata Quad USB',
    0x303A: 'ESP32-S3 USB CDC',
    0x10C4: 'ESP32 CP210x',
    0x1A86: 'ESP32 CH34x',
    0x1A87: 'ESP32 CH9102',
    0x0403: 'FTDI USB Serial',
    0x239A: 'Adafruit ESP32',
    0x2341: 'Arduino ESP32'
  };

  function isEmbeddedFrame() {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  }

  class BioQuadUsbTransport {
    constructor() {
      this.isConnected = false;
      this.isConnecting = false;
      this.mode = null; // 'webserial' | 'webusb' | null
      this.port = null;
      this.usbDevice = null;
      this.deviceName = 'ESP32 USB Serial';
      this.usbInEndpoint = null;
      this.usbOutEndpoint = null;
      this.usbInterfaceNum = null;
      this.reader = null;
      this.readLoopActive = false;
      this.txQueue = [];
      this.isSending = false;
      this.lineParser = Core ? new Core.LineStreamParser() : null;
      this.baudRate = 115200;
      this.rxPacketCount = 0;
      this.lastError = '';
      this.needsStandaloneTab = false;
      this.handshakeRetryTimer = null;
    }

    getCapabilities() {
      const hasWebSerial = typeof navigator !== 'undefined' && 'serial' in navigator && typeof navigator.serial.requestPort === 'function';
      const hasWebUsb = typeof navigator !== 'undefined' && 'usb' in navigator && typeof navigator.usb.requestDevice === 'function';
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      const isIOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      return {
        supported: hasWebSerial || hasWebUsb,
        hasWebSerial,
        hasWebUsb,
        isIOS
      };
    }

    async connect(customBaud) {
      if (this.isConnected) {
        await this.disconnect();
        return false;
      }
      if (this.isConnecting) return false;

      if (customBaud && !isNaN(parseInt(customBaud, 10))) {
        this.baudRate = parseInt(customBaud, 10);
      }

      const caps = this.getCapabilities();
      this.lastError = '';
      this.needsStandaloneTab = false;

      if (!caps.supported) {
        const msg = caps.isIOS
          ? 'iOS Safari/WebKit does not expose raw Web Serial. Use BLE (Bluefy), USB MIDI (MIDI menu), or Feeds.'
          : 'Web Serial requires Chrome, Edge, or Opera over HTTPS or localhost.';
        this.lastError = msg;
        this.emitStatus('unsupported', msg);
        if (typeof window.showHardwareNotice === 'function') {
          window.showHardwareNotice(msg, 6000, { needsStandaloneTab: false });
        }
        return false;
      }

      // Resume Web Audio non-blockingly so transient user gesture stays intact for requestPort/requestDevice
      if (window.audioCtx && window.audioCtx.state === 'suspended') {
        window.audioCtx.resume().catch(() => {});
      }

      try {
        if (caps.hasWebSerial) {
          return await this.connectWebSerial();
        }
        return await this.connectWebUsbCdc();
      } catch (err) {
        this.isConnecting = false;
        const classified = (Core && typeof Core.classifyHardwareError === 'function')
          ? Core.classifyHardwareError(err, 'USB Serial', isEmbeddedFrame())
          : { kind: 'error', message: (err && err.message) ? err.message : String(err), needsStandaloneTab: false };

        if (classified.kind === 'cancelled') {
          this.lastError = '';
          this.needsStandaloneTab = false;
          this.emitStatus('disconnected', 'USB selection cancelled.');
          return false;
        }

        this.lastError = classified.message;
        this.needsStandaloneTab = Boolean(classified.needsStandaloneTab);
        this.emitStatus(classified.needsStandaloneTab ? 'blocked' : 'error', classified.message);
        if (typeof window.showHardwareNotice === 'function') {
          window.showHardwareNotice(classified.message, 7000, {
            needsStandaloneTab: this.needsStandaloneTab
          });
        }
        return false;
      }
    }

    async connectWebSerial() {
      // Must be the very first await on click call-stack with no VID filter so all ports appear
      const port = await navigator.serial.requestPort();

      this.isConnecting = true;
      this.emitStatus('connecting', 'Opening USB port...');
      if (typeof window.ensureSynths === 'function') window.ensureSynths();

      let friendlyName = 'ESP32 USB Serial';
      if (typeof port.getInfo === 'function') {
        try {
          const info = port.getInfo() || {};
          if (info.usbVendorId && USB_VENDOR_LABELS[info.usbVendorId]) {
            friendlyName = USB_VENDOR_LABELS[info.usbVendorId];
          } else if (info.usbVendorId) {
            friendlyName = `USB Serial (0x${info.usbVendorId.toString(16).toUpperCase()})`;
          }
        } catch (e) {}
      }

      if (!port.readable) {
        await port.open({ baudRate: this.baudRate, bufferSize: 16384 });
      }
      if (typeof port.setSignals === 'function') {
        // DTR=true, RTS=false asserts active TinyUSB CDC host while keeping ESP32 EN=HIGH (normal run mode)
        await port.setSignals({ dataTerminalReady: true, requestToSend: false }).catch(() => {});
      }

      this.port = port;
      this.deviceName = friendlyName;
      this.mode = 'webserial';
      this.isConnected = true;
      this.isConnecting = false;
      this.lastError = '';
      this.needsStandaloneTab = false;
      this.rxPacketCount = 0;
      if (this.lineParser) this.lineParser.reset();

      port.addEventListener?.('disconnect', () => {
        this.cleanupDisconnected('USB cable unplugged.');
      });

      this.readLoopActive = true;
      this.startWebSerialReadLoop();
      this.performHandshake();
      this.emitStatus('connected', `${this.deviceName} (${this.baudRate} baud)`);
      if (typeof window.showHardwareNotice === 'function') {
        window.showHardwareNotice(`Connected to ${this.deviceName} (${this.baudRate} baud).`, 3200);
      }
      return true;
    }

    async connectWebUsbCdc() {
      // Must be the very first await on click call-stack; empty filters allows selecting any USB CDC device
      const device = await navigator.usb.requestDevice({ filters: [] });

      this.isConnecting = true;
      this.emitStatus('connecting', 'Claiming WebUSB interface...');
      if (typeof window.ensureSynths === 'function') window.ensureSynths();

      await device.open();
      if (device.configuration === null) {
        await device.selectConfiguration(1);
      }

      // Locate CDC Data interface (class 0x0A or vendor-specific bulk IN+OUT pair)
      let foundIface = null;
      let inEp = null;
      let outEp = null;
      let ctrlIface = null;

      for (const iface of device.configuration.interfaces) {
        const alt = iface.alternates[0];
        if (!alt) continue;
        if (alt.interfaceClass === 0x02) ctrlIface = iface.interfaceNumber;
        if (alt.interfaceClass === 0x0A || alt.interfaceClass === 0xFF) {
          const epIn = alt.endpoints.find(e => e.direction === 'in' && e.type === 'bulk');
          const epOut = alt.endpoints.find(e => e.direction === 'out' && e.type === 'bulk');
          if (epIn && epOut) {
            foundIface = iface.interfaceNumber;
            inEp = epIn.endpointNumber;
            outEp = epOut.endpointNumber;
            break;
          }
        }
      }

      if (foundIface === null) {
        await device.close().catch(() => {});
        throw new Error('No compatible USB CDC Serial bulk interface found on selected device.');
      }

      if (ctrlIface !== null && ctrlIface !== foundIface) {
        await device.claimInterface(ctrlIface).catch(() => {});
      }
      await device.claimInterface(foundIface);

      // Send CDC SET_CONTROL_LINE_STATE (DTR=1, RTS=0)
      await device.controlTransferOut({
        requestType: 'class',
        recipient: 'interface',
        request: 0x22,
        value: 0x01,
        index: ctrlIface !== null ? ctrlIface : foundIface
      }).catch(() => {});

      this.usbDevice = device;
      this.deviceName = device.productName || USB_VENDOR_LABELS[device.vendorId] || 'WebUSB CDC';
      this.usbInterfaceNum = foundIface;
      this.usbInEndpoint = inEp;
      this.usbOutEndpoint = outEp;
      this.mode = 'webusb';
      this.isConnected = true;
      this.isConnecting = false;
      this.lastError = '';
      this.needsStandaloneTab = false;
      this.rxPacketCount = 0;
      if (this.lineParser) this.lineParser.reset();

      this.readLoopActive = true;
      this.startWebUsbReadLoop();
      this.performHandshake();
      this.emitStatus('connected', `${this.deviceName} Active`);
      if (typeof window.showHardwareNotice === 'function') {
        window.showHardwareNotice(`Connected to ${this.deviceName}.`, 3200);
      }
      return true;
    }

    performHandshake() {
      clearTimeout(this.handshakeRetryTimer);
      window._hwNetInitialSynced = false;
      const sendInitBurst = () => {
        if (!this.isConnected) return;
        this.sendCommand(`EPOCH:${Date.now()}\n`);
        this.sendCommand('USBRAW:1\n');
        this.sendCommand('SYNC\n');
        this.sendCommand('NETGET\n');
      };
      // Stage 1: immediate handshake for ESP32-S3 native TinyUSB
      setTimeout(sendInitBurst, 150);
      // Stage 2: retry if UART bridge auto-reset took ~1s to boot
      this.handshakeRetryTimer = setTimeout(() => {
        if (this.isConnected && this.rxPacketCount === 0) {
          sendInitBurst();
        }
      }, 1250);
    }

    async startWebSerialReadLoop() {
      while (this.port && this.port.readable && this.readLoopActive) {
        try {
          this.reader = this.port.readable.getReader();
          while (this.readLoopActive) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value) this.handleIncomingBytes(value);
          }
        } catch (readErr) {
          if (this.readLoopActive) {
            console.warn('[USB] Serial read stream interrupted:', readErr);
          }
          break;
        } finally {
          if (this.reader) {
            try { this.reader.releaseLock(); } catch (e) {}
            this.reader = null;
          }
        }
      }
      if (this.isConnected && this.readLoopActive) {
        this.cleanupDisconnected('USB Serial stream closed.');
      }
    }

    async startWebUsbReadLoop() {
      while (this.usbDevice && this.usbDevice.opened && this.readLoopActive) {
        try {
          const res = await this.usbDevice.transferIn(this.usbInEndpoint, 512);
          if (res && res.data && res.data.byteLength > 0) {
            const bytes = new Uint8Array(res.data.buffer, res.data.byteOffset, res.data.byteLength);
            this.handleIncomingBytes(bytes);
          }
        } catch (err) {
          if (this.readLoopActive) {
            console.warn('[USB] WebUSB transferIn interrupted:', err);
          }
          break;
        }
      }
      if (this.isConnected && this.readLoopActive) {
        this.cleanupDisconnected('WebUSB connection closed.');
      }
    }

    handleIncomingBytes(bytes) {
      if (!this.lineParser) return;
      const lines = this.lineParser.push(bytes);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('{') && line.endsWith('}')) {
          try {
            const parsed = JSON.parse(line);
            this.rxPacketCount++;
            if (typeof window.processBiodata === 'function') {
              window.processBiodata(parsed, 'usb');
            }
          } catch (e) {}
        }
      }
    }

    sendCommand(cmdStr) {
      if (!this.isConnected) return false;
      const normalized = cmdStr.endsWith('\n') ? cmdStr : (cmdStr + '\n');
      this.txQueue.push(normalized);
      this.processTxQueue();
      return true;
    }

    async processTxQueue() {
      if (this.isSending || this.txQueue.length === 0 || !this.isConnected) return;
      this.isSending = true;

      while (this.txQueue.length > 0 && this.isConnected) {
        const cmd = this.txQueue.shift();
        const data = encoder.encode(cmd);
        try {
          if (this.mode === 'webserial' && this.port && this.port.writable) {
            const writer = this.port.writable.getWriter();
            try {
              await writer.write(data);
            } finally {
              writer.releaseLock();
            }
          } else if (this.mode === 'webusb' && this.usbDevice && this.usbDevice.opened) {
            await this.usbDevice.transferOut(this.usbOutEndpoint, data);
          }
        } catch (err) {
          console.warn('[USB] Write error:', err);
          break;
        }
      }

      this.isSending = false;
    }

    async disconnect() {
      this.readLoopActive = false;
      if (this.isConnected) {
        try {
          // Politely restore BLE raw telemetry if device stays powered
          const disableCmd = encoder.encode('USBRAW:0\n');
          if (this.mode === 'webserial' && this.port && this.port.writable && !this.port.writable.locked) {
            const w = this.port.writable.getWriter();
            await w.write(disableCmd).catch(() => {});
            w.releaseLock();
          }
        } catch (e) {}
      }

      if (this.reader) {
        try { await this.reader.cancel(); } catch (e) {}
        try { this.reader.releaseLock(); } catch (e) {}
        this.reader = null;
      }

      if (this.port) {
        try { await this.port.close(); } catch (e) {}
        this.port = null;
      }

      if (this.usbDevice) {
        try { await this.usbDevice.close(); } catch (e) {}
        this.usbDevice = null;
      }

      this.cleanupDisconnected('USB Disconnected');
    }

    cleanupDisconnected(reason) {
      clearTimeout(this.handshakeRetryTimer);
      this.isConnected = false;
      this.isConnecting = false;
      this.readLoopActive = false;
      this.mode = null;
      this.txQueue = [];
      if (!window.activeBleDevice || !window.activeBleDevice.gatt || !window.activeBleDevice.gatt.connected) {
        window.hwNetStatus = null;
        window.localHwEnvSensor = null;
        if (window.chData) {
          for (let c = 0; c < 4; c++) {
            if (window.chData[c]) window.chData[c].localEnvSensor = null;
          }
        }
      }
      if (typeof window.refreshAllSensorHUDs === 'function') {
        window.refreshAllSensorHUDs();
      }
      this.emitStatus('disconnected', reason || 'Disconnected');
    }

    emitStatus(state, message) {
      if (typeof window.refreshHardwareStatusUI === 'function') {
        window.refreshHardwareStatusUI();
      }
      window.dispatchEvent(new CustomEvent('bioquad_usb_status', {
        detail: {
          state,
          message,
          isConnected: this.isConnected,
          mode: this.mode,
          baudRate: this.baudRate,
          rxPacketCount: this.rxPacketCount
        }
      }));
    }
  }

  window.usbHardware = new BioQuadUsbTransport();
  window.connectUSB = function () {
    const baudEl = document.getElementById('usb-baud-select');
    const baud = baudEl ? parseInt(baudEl.value, 10) : 115200;
    return window.usbHardware.connect(baud);
  };
})(window);
