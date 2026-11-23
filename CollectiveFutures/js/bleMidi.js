/**
 * js/bleMidi.js
 * bioQuad Web Bluetooth GATT, USB Hardware Routing, Web MIDI In/Out & Telemetry Engine
 */

// --- WEB MIDI ACCESS (INPUTS & OUTPUTS) ---
window.midiAccess = null;
window.selectedMidiInput = null;
window.midiOutput = null;

function setupWebMidi() {
    if (!navigator.requestMIDIAccess) return;
    navigator.requestMIDIAccess({ sysex: false }).then(access => {
        window.midiAccess = access;

        const updateMidiPorts = () => {
            const inSelect = document.getElementById('midi-in-select');
            const outSelect = document.getElementById('midi-out-select');

            // 1. Populate MIDI Inputs
            if (inSelect) {
                const currentIn = inSelect.value || 'none';
                inSelect.innerHTML = '<option value="none">None</option><option value="all">All</option>';

                access.inputs.forEach((input, key) => {
                    const opt = document.createElement('option');
                    opt.value = key;
                    opt.text = input.name || `In (${key})`;
                    if (key === currentIn) opt.selected = true;
                    inSelect.appendChild(opt);

                    input.onmidimessage = handleIncomingMidi;
                });
            }

            // 2. Populate MIDI Outputs
            if (outSelect) {
                const currentOut = outSelect.value;
                outSelect.innerHTML = '<option value="none">None</option>';
                access.outputs.forEach((output, key) => {
                    const opt = document.createElement('option');
                    opt.value = key;
                    opt.text = output.name || `MIDI Out (${key})`;
                    if (key === currentOut) opt.selected = true;
                    outSelect.appendChild(opt);
                });
                window.midiOutput = access.outputs.get(outSelect.value) || null;
            }
        };

        updateMidiPorts();
        access.onstatechange = updateMidiPorts;

        const outSelect = document.getElementById('midi-out-select');
        if (outSelect) {
            outSelect.addEventListener('change', (e) => {
                window.midiOutput = access.outputs.get(e.target.value) || null;
            });
        }
    }).catch(err => {
        console.warn("Web MIDI Access not available:", err);
    });
}

// Inbound MIDI message processor
function handleIncomingMidi(event) {
    const inSelect = document.getElementById('midi-in-select');
    const selectedId = inSelect ? inSelect.value : 'none';

    const data = event.data;
    if (!data || data.length === 0) return;

    // 1-Byte System Real-Time MIDI Clock Messages (0xF8 Tick, 0xFA Start -> Beat 1, 0xFB Continue, 0xFC Stop)
    const rawStatus = data[0];
    if (rawStatus === 0xF8 || rawStatus === 0xFA || rawStatus === 0xFB || rawStatus === 0xFC) {
        if (window.midiClockMode === 'in') {
            if (selectedId === 'none' || selectedId === 'all' || (event.target && event.target.id === selectedId)) {
                if (window.bioClock && typeof window.bioClock.onMidiRealTime === 'function') {
                    window.bioClock.onMidiRealTime(rawStatus, event.timeStamp || performance.now());
                }
            }
        }
        return;
    }

    if (selectedId === 'none') return;
    if (selectedId !== 'all' && event.target && event.target.id !== selectedId) return;
    if (data.length < 2) return;

    const status = rawStatus & 0xF0;
    const channel = rawStatus & 0x0F;
    const d1 = data[1];
    const d2 = data.length > 2 ? data[2] : 0;

    let synthCh = channel % 4;
    for (let i = 0; i < 4; i++) {
        if (window.synthChannels[i] && window.synthChannels[i].params.midiOutCh === channel) {
            synthCh = i;
            break;
        }
    }

    // Note On
    if (status === 0x90 && d2 > 0) {
        const p = window.synthChannels[synthCh].params;
        const minN = p.minNote || 0;
        const maxN = p.maxNote || 127;

        let targetNote = d1;
        if (typeof window.scaleNote === 'function') {
            targetNote = window.scaleNote(d1, p.scaleType, p.scaleRoot, p.activeScaleBits, minN, maxN);
        } else {
            targetNote = Math.max(minN, Math.min(maxN, d1));
        }

        window.processBiodata({ type: 'note', ch: synthCh, n: targetNote, v: d2, d: 500, ts: Date.now() }, 'midi');
    }
    // Control Change (CC)
    else if (status === 0xB0) {
        const ccNum = d1;
        const ccVal = d2;

        if (window.synthChannels[synthCh]) {
            const p = window.synthChannels[synthCh].params;
            if (ccNum === 81) {
                const base = 1.0 + (ccVal / 127) * 4.0;
                const boost = Math.max(0, p.threshold - 5.0);
                p.threshold = parseFloat((base + boost).toFixed(2));
                const tEl = document.getElementById(`ch-mini-thresh-${synthCh}`);
                const vEl = document.getElementById(`ch-val-thresh-${synthCh}`);
                if (tEl) tEl.value = p.threshold;
                if (vEl) vEl.innerText = p.threshold.toFixed(2) + 'x';
            }
            else if (ccNum === 80) {
                const maxScale = p.threshMax || 5.0;
                const boostRange = Math.max(5.0, maxScale - 5.0);
                const boost = (ccVal / 127) * boostRange;
                const base = Math.min(5.0, p.threshold);
                p.threshold = parseFloat((base + boost).toFixed(2));
                const tEl = document.getElementById(`ch-mini-thresh-${synthCh}`);
                const vEl = document.getElementById(`ch-val-thresh-${synthCh}`);
                if (tEl) tEl.value = p.threshold;
                if (vEl) vEl.innerText = p.threshold.toFixed(2) + 'x';
            }
        }
    }
}

// --- UNIFIED HARDWARE TX ROUTING (USB SERIAL PRIORITY -> BLE GATT FALLBACK) ---
window.bleTxQueue = [];
window.bleIsSending = false;

window.bleMaxChunkBytes = 120;

window.writeBleBytes = async function(chunk) {
    if (typeof window.bleTxCharacteristic.writeValueWithResponse === 'function') {
        try {
            await window.bleTxCharacteristic.writeValueWithResponse(chunk);
            return;
        } catch (writeRespErr) {
            if (typeof window.bleTxCharacteristic.writeValueWithoutResponse === 'function') {
                await window.bleTxCharacteristic.writeValueWithoutResponse(chunk);
                return;
            }
            if (typeof window.bleTxCharacteristic.writeValue === 'function') {
                await window.bleTxCharacteristic.writeValue(chunk);
                return;
            }
            throw writeRespErr;
        }
    }
    if (typeof window.bleTxCharacteristic.writeValueWithoutResponse === 'function') {
        await window.bleTxCharacteristic.writeValueWithoutResponse(chunk);
        return;
    }
    await window.bleTxCharacteristic.writeValue(chunk);
};

window.processBleQueue = async function() {
    if (window.bleIsSending || window.bleTxQueue.length === 0 || !window.bleTxCharacteristic) return;

    if (window.activeBleDevice && (!window.activeBleDevice.gatt || !window.activeBleDevice.gatt.connected)) {
        window.bleTxQueue = [];
        return;
    }

    window.bleIsSending = true;
    const cmd = window.bleTxQueue[0];

    try {
        const encoded = new TextEncoder().encode(cmd);
        let maxSlice = window.bleMaxChunkBytes || 120;
        for (let offset = 0; offset < encoded.length; offset += maxSlice) {
            const slice = encoded.subarray(offset, Math.min(encoded.length, offset + maxSlice));
            try {
                await window.writeBleBytes(slice);
            } catch (sliceErr) {
                if (slice.length > 20) {
                    // Fallback to universal 20-byte ATT MTU slices if adapter negotiated default MTU
                    window.bleMaxChunkBytes = 20;
                    maxSlice = 20;
                    for (let sub = offset; sub < encoded.length; sub += 20) {
                        await window.writeBleBytes(encoded.subarray(sub, Math.min(encoded.length, sub + 20)));
                    }
                    break;
                }
                throw sliceErr;
            }
        }

        window.bleTxQueue.shift();
        window.bleIsSending = false;

        if (window.bleTxQueue.length > 0) {
            setTimeout(window.processBleQueue, 20);
        }
    } catch (e) {
        console.warn("BLE TX Busy (Retrying):", e.message);
        window.bleIsSending = false;
        setTimeout(window.processBleQueue, 100);
    }
};

window.markHardwarePendingNvs = function() {
    if (!window.hwNvsState) return;
    if (typeof window.isHardwareConnected === 'function' && window.isHardwareConnected()) {
        window.hwNvsState.status = 'pending_nvs';
        window.hwNvsState.transport = (window.usbHardware && window.usbHardware.isConnected) ? 'usb' : 'ble';
        clearTimeout(window.hwNvsState.nvsCommitTimer);
        // Firmware auto-commits dirty NVS after 3000ms of inactivity
        window.hwNvsState.nvsCommitTimer = setTimeout(() => {
            if (window.hwNvsState && window.hwNvsState.status === 'pending_nvs') {
                window.hwNvsState.status = 'saved';
                window.hwNvsState.lastSavedAt = Date.now();
                if (typeof window.refreshHardwareStatusUI === 'function') window.refreshHardwareStatusUI();
            }
        }, 3200);
        if (typeof window.refreshHardwareStatusUI === 'function') window.refreshHardwareStatusUI();
    }
};

window.sendHardwareCommand = function(cmd) {
    const normalized = cmd.endsWith('\n') ? cmd : (cmd + '\n');
    if (window.usbHardware && window.usbHardware.isConnected) {
        window.usbHardware.sendCommand(normalized);
        return true;
    }
    if (window.bleTxCharacteristic) {
        window.bleTxQueue.push(normalized);
        window.processBleQueue();
        return true;
    }
    return false;
};

window.sendHardwareCC = function(ch, cc, val) {
    if (window.sendHardwareCommand(`C:${ch},${cc},${Math.round(val)}\n`)) {
        window.markHardwarePendingNvs();
    }
};

window.sendHardwareScale = function(ch, mask) {
    if (window.sendHardwareCommand(`S:${ch},${mask}\n`)) {
        window.markHardwarePendingNvs();
    }
};

window.saveHardwareNVS = function() {
    if (!window.isHardwareConnected || !window.isHardwareConnected()) {
        if (typeof window.showHardwareNotice === 'function') {
            window.showHardwareNotice('Connect your bioQuad ESP32 via USB Serial or BLE GATT first to commit parameters to hardware NVS.');
        }
        return false;
    }
    for (let ch = 0; ch < 4; ch++) {
        if (typeof window.syncParamsToHardware === 'function') {
            window.syncParamsToHardware(ch);
        }
    }
    window.sendHardwareCommand('SAVE\n');
    if (window.hwNvsState) {
        window.hwNvsState.status = 'saved';
        window.hwNvsState.lastSavedAt = Date.now();
        clearTimeout(window.hwNvsState.nvsCommitTimer);
    }
    if (typeof window.refreshHardwareStatusUI === 'function') window.refreshHardwareStatusUI();
    return true;
};

// --- MIDI OUT ---
window.sendMidiNote = function(channel, pitch, velocity, duration, playTimeAudioCtx) {
    const hasSynth = Boolean(window.synthChannels && window.synthChannels[channel]);
    let played = false;
    if (hasSynth) {
        played = window.synthChannels[channel].play(pitch, velocity, duration, playTimeAudioCtx);
    }

    if ((played || !hasSynth) && typeof window.midiOutput !== 'undefined' && window.midiOutput) {
        const rawMidiCh = hasSynth && window.synthChannels[channel].params.midiOutCh !== undefined
            ? window.synthChannels[channel].params.midiOutCh
            : channel;
        const midiCh = Math.max(0, Math.min(15, parseInt(rawMidiCh, 10) || 0));
        const nowAudio = window.audioCtx ? window.audioCtx.currentTime : 0;
        const delayMs = (typeof playTimeAudioCtx === 'number' && isFinite(playTimeAudioCtx) && window.audioCtx)
            ? Math.max(0, (playTimeAudioCtx - nowAudio) * 1000)
            : 0;
        const sysTime = window.performance.now() + delayMs;
        const safePitch = Math.max(0, Math.min(127, Math.round(pitch)));
        const safeVel = Math.max(1, Math.min(127, Math.round(velocity)));
        const safeDur = Math.max(15, Number(duration) || 200);

        try {
            window.midiOutput.send([0x90 + midiCh, safePitch, safeVel], sysTime);
            setTimeout(() => {
                try {
                    if (window.midiOutput) window.midiOutput.send([0x80 + midiCh, safePitch, 0]);
                } catch (e) {}
            }, safeDur + delayMs);
        } catch (e) {}
    }
    return played || !hasSynth;
};

window.sendMidiCC = function(channel, ccNumber, val) {
    if (typeof window.midiOutput !== 'undefined' && window.midiOutput) {
        const midiCh = window.synthChannels[channel] ? (window.synthChannels[channel].params.midiOutCh || channel) : channel;
        const sysTime = window.performance.now();
        window.midiOutput.send([0xB0 + midiCh, ccNumber, val], sysTime);
    }
};

// --- WEB BLUETOOTH CONNECTION ---
window.bleStatusState = 'idle';
window.bleLastError = '';
window.bleNeedsStandaloneTab = false;

function isBleEmbeddedFrame() {
    try {
        return window.self !== window.top;
    } catch (e) {
        return true;
    }
}

window.showBlePermissionModal = function(msg, options = {}) {
    const needsStandaloneTab = Boolean(options && options.needsStandaloneTab);
    if (typeof window.showHardwareNotice === 'function') {
        window.showHardwareNotice(msg, 7000, { needsStandaloneTab });
    }
    window.dispatchEvent(new CustomEvent('bioquad_ble_error', {
        detail: {
            message: msg || 'BLE connection error.',
            isPermissionsPolicy: needsStandaloneTab
        }
    }));
};

window.connectBLE = async function() {
    // 1. If active and connected, clicking cleanly disconnects
    if (window.activeBleDevice && window.activeBleDevice.gatt && window.activeBleDevice.gatt.connected) {
        try { window.activeBleDevice.gatt.disconnect(); } catch (e) {}
        window.activeBleDevice = null;
        window.bleTxCharacteristic = null;
        window.bleIsConnecting = false;
        window.bleStatusState = 'idle';
        window.bleLastError = '';
        window.bleNeedsStandaloneTab = false;
        if (typeof window.refreshHardwareStatusUI === 'function') window.refreshHardwareStatusUI();
        return false;
    }

    if (window.bleIsConnecting) return false;

    // 2. Check if Web Bluetooth API is supported
    if (!navigator.bluetooth || typeof navigator.bluetooth.requestDevice !== 'function') {
        const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
        const isIOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const msg = isIOS
            ? 'Safari/WebKit on iOS does not expose Web Bluetooth. Open this site in Bluefy on iOS/iPadOS, or use USB MIDI / Feeds.'
            : 'Web Bluetooth requires Chrome, Edge, or Opera on Desktop or Android.';
        window.bleIsConnecting = false;
        window.bleStatusState = 'error';
        window.bleLastError = msg;
        window.bleNeedsStandaloneTab = false;
        window.showBlePermissionModal(msg, { needsStandaloneTab: false });
        if (typeof window.refreshHardwareStatusUI === 'function') window.refreshHardwareStatusUI();
        return false;
    }

    // Resume Web Audio non-blockingly so transient user activation stays intact for requestDevice()
    if (typeof window.audioCtx !== 'undefined' && window.audioCtx.state === 'suspended') {
        window.audioCtx.resume().catch(() => {});
    }

    window.bleIsConnecting = true;
    window.bleStatusState = 'scanning';
    window.bleLastError = '';
    window.bleNeedsStandaloneTab = false;
    if (typeof window.refreshHardwareStatusUI === 'function') window.refreshHardwareStatusUI();

    const UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
    const MIDI_SERVICE = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";

    try {
        let device = null;
        try {
            // Must be the very first await on the click call-stack to preserve user activation
            device = await navigator.bluetooth.requestDevice({
                filters: [
                    { services: [UART_SERVICE] },
                    { services: [MIDI_SERVICE] },
                    { namePrefix: "Biodata" }, { namePrefix: "biodata" }, { namePrefix: "BioData" },
                    { namePrefix: "bioQuad" }, { namePrefix: "BioQuad" },
                    { namePrefix: "esp32" }, { namePrefix: "ESP32" },
                    { namePrefix: "eforp" }, { namePrefix: "Eforp" }
                ],
                optionalServices: [UART_SERVICE, MIDI_SERVICE]
            });
        } catch (filterErr) {
            // Only fall back to acceptAllDevices if the browser rejected the filter syntax (TypeError)
            if (filterErr && filterErr.name === 'TypeError') {
                device = await navigator.bluetooth.requestDevice({
                    acceptAllDevices: true,
                    optionalServices: [UART_SERVICE, MIDI_SERVICE]
                });
            } else {
                throw filterErr;
            }
        }

        if (!device) {
            window.bleIsConnecting = false;
            window.bleStatusState = 'idle';
            if (typeof window.refreshHardwareStatusUI === 'function') window.refreshHardwareStatusUI();
            return false;
        }

        if (typeof ensureSynths === 'function') ensureSynths();

        window.activeBleDevice = device;
        window.bleStatusState = 'linking';
        if (typeof window.refreshHardwareStatusUI === 'function') window.refreshHardwareStatusUI();

        const withTimeout = (promise, ms, desc) => {
            let timer;
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(desc || `Timeout after ${ms}ms`)), ms);
            });
            return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
        };

        let server = null;
        if (device.gatt && device.gatt.connected) {
            server = device.gatt;
        } else {
            server = await withTimeout(
                device.gatt.connect(),
                12000,
                "GATT link timed out. Power-cycle or reset your bioQuad ESP32 and try again."
            );
        }

        let service = null;
        let rxChar = null;
        let isBleMidiMode = false;

        try {
            service = await server.getPrimaryService(UART_SERVICE);
            window.bleTxCharacteristic = await service.getCharacteristic("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
            rxChar = await service.getCharacteristic("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
        } catch (uartErr) {
            try {
                service = await server.getPrimaryService(MIDI_SERVICE);
                rxChar = await service.getCharacteristic("7772e5db-3868-4112-a1a9-f2669d106bf3");
                window.bleTxCharacteristic = rxChar;
                isBleMidiMode = true;
            } catch (midiErr) {
                throw new Error("Connected to BLE device, but neither Nordic UART nor BLE MIDI service was found.");
            }
        }

        device.addEventListener('gattserverdisconnected', () => {
            window.activeBleDevice = null;
            window.bleTxCharacteristic = null;
            window.bleIsConnecting = false;
            window.bleStatusState = 'idle';
            if (!window.usbHardware || !window.usbHardware.isConnected) {
                window.hwNetStatus = null;
                window.localHwEnvSensor = null;
                if (window.chData) {
                    for (let c = 0; c < 4; c++) {
                        if (window.chData[c]) window.chData[c].localEnvSensor = null;
                    }
                }
            }
            if (typeof window.refreshHardwareStatusUI === 'function') window.refreshHardwareStatusUI();
            if (typeof window.refreshAllSensorHUDs === 'function') window.refreshAllSensorHUDs();
        });

        const bleLineParser = (window.BioQuadCore && window.BioQuadCore.LineStreamParser)
            ? new window.BioQuadCore.LineStreamParser()
            : null;

        await rxChar.startNotifications();

        rxChar.addEventListener('characteristicvaluechanged', (e) => {
            if (isBleMidiMode) {
                const dv = e.target.value;
                if (!dv || dv.byteLength < 3) return;
                let idx = 1;
                while (idx < dv.byteLength) {
                    const b = dv.getUint8(idx++);
                    if (b & 0x80) {
                        const status = b;
                        const ch = (status & 0x0F) % 4;
                        const d1 = idx < dv.byteLength ? dv.getUint8(idx++) : 60;
                        const d2 = idx < dv.byteLength ? dv.getUint8(idx++) : 0;
                        const msgType = status & 0xF0;
                        if (msgType === 0x90 && d2 > 0) {
                            window.processBiodata({ ch, type: 'note', n: d1, v: d2, d: 200, ts: Date.now() }, 'ble');
                        } else if (msgType === 0xB0) {
                            if (typeof window.sendMidiCC === 'function') window.sendMidiCC(ch, d1, d2);
                        }
                    }
                }
            } else {
                const dv = e.target.value;
                if (!dv) return;
                const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
                if (bleLineParser) {
                    const lines = bleLineParser.push(bytes);
                    for (let i = 0; i < lines.length; i++) {
                        const trimmed = lines[i];
                        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                            try { window.processBiodata(JSON.parse(trimmed), 'ble'); } catch (err) {}
                        }
                    }
                } else {
                    if (typeof window.bleBuffer === 'undefined') window.bleBuffer = '';
                    window.bleBuffer += new TextDecoder().decode(bytes);
                    const lines = window.bleBuffer.split(/\r?\n/);
                    window.bleBuffer = lines.pop() || '';
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed.startsWith('{')) {
                            try { window.processBiodata(JSON.parse(trimmed), 'ble'); } catch (err) {}
                        }
                    }
                }
            }
        });

        window.bleIsConnecting = false;
        window.bleStatusState = 'connected';
        window.bleLastError = '';
        window.bleNeedsStandaloneTab = false;
        if (window.hwNvsState) {
            window.hwNvsState.status = 'saved';
            window.hwNvsState.transport = (window.usbHardware && window.usbHardware.isConnected) ? 'usb' : 'ble';
        }
        if (typeof window.refreshHardwareStatusUI === 'function') window.refreshHardwareStatusUI();
        if (typeof window.showHardwareNotice === 'function') {
            window.showHardwareNotice(`Connected to ${device.name || 'Biodata-Q4'} over BLE GATT.`, 3200);
        }

        window._hwNetInitialSynced = false;
        setTimeout(() => {
            if (window.bleTxCharacteristic && !isBleMidiMode) {
                window.bleTxQueue.push(`EPOCH:${Date.now()}\n`);
                window.bleTxQueue.push("SYNC\n");
                window.bleTxQueue.push("NETGET\n");
                window.processBleQueue();
            }
        }, 650);
        return true;

    } catch (error) {
        window.bleIsConnecting = false;
        window.activeBleDevice = null;
        window.bleTxCharacteristic = null;
        console.warn("BLE Connect result:", error && (error.message || error));

        const Core = window.BioQuadCore;
        const classified = (Core && typeof Core.classifyHardwareError === 'function')
            ? Core.classifyHardwareError(error, 'Bluetooth LE', isBleEmbeddedFrame())
            : { kind: 'error', message: (error && error.message) ? error.message : 'BLE connection failed.', needsStandaloneTab: false };

        if (classified.kind === 'cancelled') {
            window.bleStatusState = 'idle';
            window.bleLastError = '';
            window.bleNeedsStandaloneTab = false;
        } else {
            window.bleStatusState = classified.needsStandaloneTab ? 'blocked' : 'error';
            window.bleLastError = classified.message;
            window.bleNeedsStandaloneTab = Boolean(classified.needsStandaloneTab);
            window.showBlePermissionModal(classified.message, {
                needsStandaloneTab: window.bleNeedsStandaloneTab
            });
        }
        if (typeof window.refreshHardwareStatusUI === 'function') window.refreshHardwareStatusUI();
        return false;
    }
};

// --- TELEMETRY & NOTE PROCESSOR ---
window.processBiodata = function(payload, source = 'ble') {
    if (!payload) return;

    // Handle explicit NVS save confirmation, WiFi/MQTT status, or USB/link handshake acks from firmware v008/v009+
    if (payload.type === 'nvs_saved') {
        if (window.hwNvsState) {
            window.hwNvsState.status = 'saved';
            window.hwNvsState.lastSavedAt = Date.now();
            clearTimeout(window.hwNvsState.nvsCommitTimer);
        }
        if (payload.net && typeof window.showHardwareNotice === 'function') {
            window.showHardwareNotice('Saved WiFi & Cloud MQTT settings to ESP32 NVS.', 3600);
        }
        if (typeof window.refreshHardwareStatusUI === 'function') window.refreshHardwareStatusUI();
        return;
    }
    if (payload.type === 'net_status') {
        window.hwNetStatus = Object.assign({}, payload, {
            receivedAt: Date.now(),
            transport: source
        });
        const explicitRead = Boolean(window._hwNetPendingSync);
        const shouldSyncFields = Boolean(!window._hwNetInitialSynced || explicitRead);
        window._hwNetInitialSynced = true;
        window._hwNetPendingSync = false;
        if (typeof window.refreshHardwareNetUI === 'function') {
            window.refreshHardwareNetUI(shouldSyncFields, explicitRead);
        }
        return;
    }
    if (payload.type === 'env_cfg') {
        if (payload.envMs !== undefined && window.BioQuadCore && typeof window.BioQuadCore.normalizeEnvRateMs === 'function') {
            window.envSensorRateMs = window.BioQuadCore.normalizeEnvRateMs(payload.envMs);
            try { localStorage.setItem('bioquad_env_rate_ms', String(window.envSensorRateMs)); } catch (e) {}
        }
        if (typeof window.refreshHardwareNetUI === 'function') window.refreshHardwareNetUI(false);
        return;
    }
    if (payload.type === 'usb_mode' || payload.type === 'pong') {
        if (typeof window.refreshHardwareStatusUI === 'function') window.refreshHardwareStatusUI();
        return;
    }

    // Handle periodic or On-Change I2C environmental sensor readings (e.g. SHT4x °F / °C / %RH)
    if (payload.type === 'env') {
        if (source === 'ble' && window.usbHardware && window.usbHardware.isConnected) {
            return;
        }
        const Core = window.BioQuadCore;
        const nowEnvMs = Date.now();
        const envObj = (Core && typeof Core.normalizeEnvSensorPayload === 'function')
            ? Core.normalizeEnvSensorPayload(payload, nowEnvMs)
            : null;
        if (!envObj) return;

        if (source === 'mqtt') {
            if (envObj.ch !== null && window.chData && window.chData[envObj.ch]) {
                window.chData[envObj.ch].mqttEnvSensor = envObj;
            }
        } else {
            const rateMode = (window.envSensorRateMs !== undefined) ? Number(window.envSensorRateMs) : 15000;
            if (rateMode === 0) {
                return; // Local I2C sensor polling explicitly turned OFF
            }
            if (rateMode < 0 && Core && typeof Core.shouldEmitEnvOnChange === 'function') {
                // Enforce anti-jitter ON CHANGE deadband even if connected board runs older periodic firmware
                if (!Core.shouldEmitEnvOnChange(window.lastEmittedLocalEnv, envObj, nowEnvMs)) {
                    return;
                }
            } else if (rateMode > 0 && window.lastEmittedLocalEnv && window.lastEmittedLocalEnv.emittedAt) {
                // Enforce minimum interval if older firmware streams faster than selected rate (with 15% clock slack)
                if ((nowEnvMs - window.lastEmittedLocalEnv.emittedAt) < (rateMode * 0.85)) {
                    return;
                }
            }

            window.lastEmittedLocalEnv = Object.assign({}, envObj, { emittedAt: nowEnvMs });
            if (envObj.ch !== null && window.chData && window.chData[envObj.ch]) {
                window.chData[envObj.ch].localEnvSensor = envObj;
            } else {
                window.localHwEnvSensor = envObj;
            }
            if (window.bioquadFeeds && window.bioquadFeeds.isPublishing) {
                window.bioquadFeeds.broadcastTelemetryEvent(payload);
            }
            if (typeof window.refreshHardwareNetUI === 'function') {
                window.refreshHardwareNetUI(false);
            }
        }
        if (typeof window.refreshAllSensorHUDs === 'function') {
            window.refreshAllSensorHUDs();
        }
        return;
    }

    if (typeof payload.ch !== 'number') return;

    // Deduplicate raw packets: if USB Serial is actively connected, ignore BLE GATT raw telemetry
    if (source === 'ble' && payload.type === 'raw' && window.usbHardware && window.usbHardware.isConnected) {
        return;
    }

    const chIdx = payload.ch;
    const ch = window.chData[chIdx];
    if (!ch) return;

    // 1. Isolate channels actively playing back a recorded session or file in DataStreamer
    // so live USB, BLE, MIDI, or Cloud MQTT/Sim feeds never double-trigger on top of playback.
    if (source !== 'stream' && window.dataStreamer && typeof window.dataStreamer.isChannelPlayingStream === 'function' && window.dataStreamer.isChannelPlayingStream(chIdx)) {
        return;
    }

    // 2. Isolate channels actively routed to an incoming MQTT stream (e.g., CH 3 <- Stream 1, CH 4 <- Stream 2)
    // from floating hardware pins or stray local events, unless intentionally self-looping the exact same channel.
    if (source !== 'mqtt' && source !== 'stream' && window.bioquadFeeds && window.bioquadFeeds.channelRoutes) {
        const activeRoute = window.bioquadFeeds.channelRoutes[chIdx];
        if (activeRoute) {
            const isSameChSelfLoop = Boolean(
                window.bioquadFeeds.isPublishing &&
                activeRoute.feedId === window.bioquadFeeds.publishFeedId &&
                activeRoute.remoteCh === chIdx
            );
            if (!isSameChSelfLoop) {
                return;
            }
        }
    }

    // Forward local live telemetry (USB, BLE, MIDI, or local File Stream) to Cloud MQTT if user enabled Broadcast
    if (source !== 'mqtt' && window.bioquadFeeds && window.bioquadFeeds.isPublishing && (payload.type === 'raw' || payload.type === 'note')) {
        window.bioquadFeeds.broadcastTelemetryEvent(payload);
    }

    // Record live biodata if recorder is active and not currently playing back a saved file stream
    if (window.biodataRecorder && window.biodataRecorder.isRecording && !window.biodataRecorder.isPaused && (!window.dataStreamer || !window.dataStreamer.isPlaying || source !== 'stream')) {
        if (payload.type === 'note') {
            window.biodataRecorder.recordNote(chIdx, payload.n, payload.v, payload.d);
        } else if (payload.type === 'raw' && Array.isArray(payload.p)) {
            window.biodataRecorder.recordRaw(chIdx, payload.p);
        }
    }

    if (payload.type === 'note') {
        const synthCh = window.synthChannels ? window.synthChannels[chIdx] : null;
        const p = (synthCh && synthCh.params) ? synthCh.params : (window.defaultParams || {});
        const nowAudio = window.audioCtx ? window.audioCtx.currentTime : 0;
        let playTime = nowAudio + 0.015;
        let quantDelayMs = 0;

        if (!payload._audioAlreadyScheduled) {
            const quantStep = Math.round(Number(p.quantize) || 0);
            if (quantStep > 0 && window.bioClock && typeof window.bioClock.quantizeAudioTime === 'function') {
                playTime = window.bioClock.quantizeAudioTime(playTime, quantStep);
                // Prevent identical pitch stacking onto the exact same quantized grid slot on one channel
                if (
                    ch._lastQuantSlotTime !== undefined &&
                    Math.abs(playTime - ch._lastQuantSlotTime) < 0.004 &&
                    ch._lastQuantPitch === payload.n
                ) {
                    return;
                }
                ch._lastQuantSlotTime = playTime;
                ch._lastQuantPitch = payload.n;
                quantDelayMs = Math.max(0, (playTime - nowAudio) * 1000);
            }
            window.sendMidiNote(chIdx, payload.n, payload.v, payload.d, playTime);
        }

        const commitNoteVisuals = () => {
            if (!ch.notes) ch.notes = [];
            ch.notes.push({ n: payload.n, t: Date.now(), dur: payload.d, v: payload.v });

            if (typeof window.triggerChannelLED === 'function') {
                window.triggerChannelLED(chIdx);
            } else {
                ['led-', 'focus-led-', 'card-led-'].forEach(prefix => {
                    const el = document.getElementById(`${prefix}${chIdx}`);
                    if (el) {
                        el.classList.add('active');
                        setTimeout(() => el.classList.remove('active'), 115);
                    }
                });
            }

            if (ch.waveBuffer && ch.waveBuffer.length > 0) {
                const lastIdx = ch.waveBuffer.length - 1;
                ch.waveBuffer[lastIdx].evt = 1;
                ch.waveBuffer[lastIdx].n = payload.n;
            }

            if (typeof window.triggerDensityVisualizer === 'function') {
                window.triggerDensityVisualizer(chIdx, 'pass', payload.n, payload.v, payload.d);
            }

            // Inject visual meter spike
            if (window.synthChannels[chIdx]) {
                const pNow = window.synthChannels[chIdx].params;
                const maxM = Math.max(1.0, Math.min(10.0, pNow.threshMax || 5.0));
                const tVal = Math.max(1.0, Math.min(maxM, pNow.threshold));
                const tPct = Math.max(0, Math.min(1, (tVal - 1.0) / Math.max(0.01, maxM - 1.0)));

                ch.vizDeltaPct = Math.min(1.0, tPct + 0.05 + (payload.v / 127) * 0.1);
                if (!ch.peak) ch.peak = { val: 0, time: 0, vel: 0 };
                ch.peak.val = ch.vizDeltaPct;
                ch.peak.time = Date.now();
                ch.peak.vel = 0;
            }
        };

        if (quantDelayMs > 30) {
            setTimeout(commitNoteVisuals, Math.min(4000, Math.round(quantDelayMs)));
        } else {
            commitNoteVisuals();
        }
        return;
    }

    if (payload.type === 'raw' && Array.isArray(payload.p)) {
        if (!ch.metricMeta || ch.metricMeta.isBiodata !== true) {
            ch.metricMeta = { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' };
        }
        if (!ch.waveBuffer) ch.waveBuffer = [];
        if (!ch.vizBuffer) ch.vizBuffer = [];
        if (!ch.acc || ch.acc.lastSec === undefined) ch.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: Date.now() };
        const Core = window.BioQuadCore;
        const pConfig = window.synthChannels[chIdx] ? window.synthChannels[chIdx].params : window.defaultParams;
        const CALIBRATION_FACTOR = 10000000;
        const sampleWindow = Math.max(2, Math.min(2000, Math.round(Number(pConfig.sampleSize) || 40)));
        const threshold = Number(pConfig.threshold) || 2.0;
        const sonifyLocally = Boolean(payload._sonifyRawLocally);

        const nowMs = Date.now();
        let latestRVal = null;
        let lastStats = null;

        payload.p.forEach((rawTicks, sampleIdx) => {
            if (!rawTicks || rawTicks <= 0) return;
            const rVal = CALIBRATION_FACTOR / rawTicks;
            latestRVal = rVal;

            ch.acc.sum += rVal;
            ch.acc.count++;
            if (rVal < ch.acc.min) ch.acc.min = rVal;
            if (rVal > ch.acc.max) ch.acc.max = rVal;

            ch.waveBuffer.push({ r: rVal, ticks: rawTicks, evt: 0 });
            ch.vizBuffer.push(rVal);

            while (ch.waveBuffer.length > 120000) ch.waveBuffer.shift();
            while (ch.vizBuffer.length > sampleWindow) ch.vizBuffer.shift();

            if (ch.vizBuffer.length > 1) {
                const vLen = ch.vizBuffer.length;
                ch.slew = ch.vizBuffer[vLen - 1] - ch.vizBuffer[vLen - 2];
            }

            if (sonifyLocally && Core && typeof Core.evaluateBioSampleWindow === 'function') {
                const stats = Core.evaluateBioSampleWindow(ch.vizBuffer, rVal, threshold, true);
                lastStats = stats;
                if (stats.isOverThreshold && ch.vizBuffer.length >= Math.min(10, sampleWindow)) {
                    const approxSampleMs = nowMs + sampleIdx * 6;
                    if (!ch._lastLocalRawTriggerMs || (approxSampleMs - ch._lastLocalRawTriggerMs) > 150) {
                        const density = pConfig.density !== undefined ? pConfig.density : 100;
                        const mapped = Core.sonifyBioSample(stats, rVal, pConfig, (rawTicks % 127) / 127);
                        if ((Math.random() * 100) <= density) {
                            ch._lastLocalRawTriggerMs = approxSampleMs;
                            window.processBiodata({
                                type: 'note',
                                ch: chIdx,
                                n: mapped.note,
                                v: mapped.velocity,
                                d: mapped.duration
                            }, source);
                        } else if (typeof window.triggerDensityVisualizer === 'function') {
                            window.triggerDensityVisualizer(chIdx, 'drop', mapped.note, mapped.velocity, mapped.duration);
                        }
                    }
                }
            }
        });

        const finalStats = lastStats || (
            Core && typeof Core.evaluateBioSampleWindow === 'function'
                ? Core.evaluateBioSampleWindow(ch.vizBuffer, latestRVal, threshold, true)
                : null
        );

        if (finalStats) {
            ch.rawStdev = finalStats.rawStdev;
            ch.lastStdevi = finalStats.meterStdevi;
            ch.lastMaxDev = finalStats.meterMaxDev;
        } else {
            let averg = 0, stdevi = 0, maxDev = 0;
            ch.vizBuffer.forEach(v => { averg += v; });
            if (ch.vizBuffer.length > 0) averg /= ch.vizBuffer.length;
            ch.vizBuffer.forEach(v => {
                const dev = Math.abs(v - averg);
                stdevi += dev * dev;
                if (dev > maxDev) maxDev = dev;
            });
            const variance = ch.vizBuffer.length > 0 ? (stdevi / ch.vizBuffer.length) : 0;
            const rawStdev = variance > 0 ? Math.sqrt(variance) : 0;
            const minStdDev = Math.max(1e-5, Math.abs(averg) * 0.00005);
            ch.rawStdev = rawStdev;
            ch.lastStdevi = rawStdev > minStdDev ? rawStdev : minStdDev;
            ch.lastMaxDev = rawStdev > minStdDev ? maxDev : 0;
        }
        ch.lastBlockTime = nowMs;

        if (nowMs - ch.acc.lastSec >= 1000) {
            if (!ch.history) ch.history = [];
            if (ch.acc.count > 0) ch.history.push({ avg: ch.acc.sum / ch.acc.count, min: ch.acc.min, max: ch.acc.max });
            if (ch.history.length > 300) ch.history.shift();
            ch.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: nowMs };
        }
        return;
    }

    // --- PARSE HARDWARE STATE SYNC ---
    if (payload.type === 'state' && window.synthChannels[chIdx]) {
        const p = window.synthChannels[chIdx].params;
        p.threshold = payload.thr;

        if (p.threshold > (p.threshMax || 5.0)) {
            p.threshMax = Math.ceil(p.threshold);
            if (typeof window.setThresholdMax === 'function') window.setThresholdMax(chIdx, p.threshMax);
        }

        p.sampleSize = payload.win;
        p.density = payload.den;
        p.minNote = payload.nMin;
        p.maxNote = payload.nMax;
        p.velMin = payload.vMin;
        p.velMax = payload.vMax;
        p.spread = payload.spr;
        p.durMult = payload.dur;
        p.quantize = payload.qtz;
        p.midiOutCh = payload.mCh;
        window.masterBPM = payload.bpm;
        p.voices = payload.poly;
        p.legato = payload.leg;

        if (payload.stl === 0) p.stealMode = 'oldest';
        else if (payload.stl === 1) p.stealMode = 'lowest';
        else if (payload.stl === 2) p.stealMode = 'highest';
        else if (payload.stl === 3) p.stealMode = 'env';
        p.steal = p.stealMode;

        const decodedBits = typeof window.decodeScaleBits === 'function' ? window.decodeScaleBits(payload.scl) : null;
        if (decodedBits) {
            p.activeScaleBits = decodedBits;
        } else {
            if (!Array.isArray(p.activeScaleBits) || p.activeScaleBits.length !== 12) {
                p.activeScaleBits = new Array(12).fill(true);
            }
            const sclNum = Number(payload.scl) || 0;
            for (let i = 0; i < 12; i++) {
                p.activeScaleBits[i] = (sclNum & (1 << i)) !== 0;
            }
        }
        if (typeof window.detectScaleFromBits === 'function') {
            const detected = window.detectScaleFromBits(p.activeScaleBits, p.scaleRoot);
            p.scaleType = detected.scaleType;
            p.scaleRoot = detected.scaleRoot;
        }

        window.synthChannels[chIdx].applyParams();

        const miniT = document.getElementById(`ch-mini-thresh-${chIdx}`);
        const miniV = document.getElementById(`ch-val-thresh-${chIdx}`);
        const miniW = document.getElementById(`ch-window-${chIdx}`);
        const miniWV = document.getElementById(`ch-val-window-${chIdx}`);
        if (miniT) miniT.value = p.threshold;
        if (miniV) miniV.innerText = parseFloat(p.threshold).toFixed(2) + 'x';
        if (miniW) miniW.value = p.sampleSize;
        if (miniWV) miniWV.innerText = p.sampleSize;

        if (window.hwNvsState) {
            window.hwNvsState.status = 'saved';
            window.hwNvsState.transport = source === 'usb' ? 'usb' : 'ble';
        }
        if (typeof window.refreshHardwareStatusUI === 'function') window.refreshHardwareStatusUI();

        if (typeof window.recordPerfSnapshotDelta === 'function') {
            window.recordPerfSnapshotDelta(chIdx);
        }
        if (typeof window.recordPerfParam === 'function') {
            window.recordPerfParam(0, 'master.bpm', window.masterBPM, true);
        }
        if (chIdx === window.activeSynthIndex && typeof window.syncUI === 'function') {
            window.syncUI();
            if (typeof window.syncPianoUI === 'function') window.syncPianoUI();
        }
    }
};

// --- 24-PPQN MIDI CLOCK OUT & BEAT-1 LISTENER SCHEDULER ---
(function startBioClockTicker() {
    setInterval(() => {
        const clk = window.bioClock;
        if (!clk) return;
        const st = clk.getState();
        const nowAudio = clk._nowAudio();
        const secPerBeat = 60 / st.bpm;
        const secPerTick = secPerBeat / clk.ppqn;

        // 1. Transmit 24-PPQN 0xF8 MIDI Timing Clock when in 'out' mode and an output port is selected
        if (window.midiClockMode === 'out' && window.midiOutput) {
            const lookaheadSec = 0.05;
            const horizonState = clk.getState(nowAudio + lookaheadSec);
            const targetTick = horizonState.tickCount;
            if (clk.lastMidiTickSentTotal < st.tickCount - 4) {
                clk.lastMidiTickSentTotal = st.tickCount - 1;
            }
            while (clk.lastMidiTickSentTotal < targetTick) {
                clk.lastMidiTickSentTotal++;
                const tickBeats = clk.lastMidiTickSentTotal / clk.ppqn;
                const tickAudioTime = clk.anchorAudioTime + (tickBeats - clk.anchorTotalBeats) * secPerBeat;
                const delayMs = Math.max(0, (tickAudioTime - nowAudio) * 1000);
                const sendTs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) + delayMs;
                try {
                    window.midiOutput.send([0xF8], sendTs);
                } catch (e) {
                    try { window.midiOutput.send([0xF8]); } catch (e2) {}
                }
            }
        } else {
            clk.lastMidiTickSentTotal = st.tickCount;
        }

        // 2. Dispatch Beat-1..4 callbacks for pattern / Strudel engines
        const curWholeBeat = Math.floor(st.totalBeats);
        if (curWholeBeat !== clk.lastDispatchedBeatTotal) {
            clk.lastDispatchedBeatTotal = curWholeBeat;
            if (Array.isArray(clk.beatListeners) && clk.beatListeners.length > 0) {
                for (let i = 0; i < clk.beatListeners.length; i++) {
                    try { clk.beatListeners[i](st); } catch (err) {}
                }
            }
        }
    }, 20);
})();

// Initialize Web MIDI on page load
setupWebMidi();
