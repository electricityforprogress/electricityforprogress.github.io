/**
 * js/bleMidi.js
 * bioQuad Web Bluetooth GATT, Web MIDI In/Out & Telemetry Engine
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
                inSelect.innerHTML = '<option value="none">None</option><option value="all">All Inputs</option>';
                
                access.inputs.forEach((input, key) => {
                    let opt = document.createElement('option');
                    opt.value = key;
                    opt.text = input.name || `MIDI In (${key})`;
                    if (key === currentIn) opt.selected = true;
                    inSelect.appendChild(opt);
                    
                    input.onmidimessage = handleIncomingMidi;
                });
            }
            
            // 2. Populate MIDI Outputs
            if (outSelect) {
                const currentOut = outSelect.value;
                outSelect.innerHTML = '<option value="none">No Output</option>';
                access.outputs.forEach((output, key) => {
                    let opt = document.createElement('option');
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
         
    if (selectedId === 'none') return;
    if (selectedId !== 'all' && event.target && event.target.id !== selectedId) return;
    const data = event.data;
    if (!data || data.length < 2) return;
    
    const status = data[0] & 0xF0;
    const channel = data[0] & 0x0F; 
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
        let p = window.synthChannels[synthCh].params;
        let minN = p.minNote || 0;
        let maxN = p.maxNote || 127;
        
        // Quantize incoming MIDI note through the channel's scale so notes sound in key
        let targetNote = d1;
        if (typeof window.scaleNote === 'function') {
            targetNote = window.scaleNote(d1, p.scaleType, p.scaleRoot, p.activeScaleBits, minN, maxN);
        } else {
            targetNote = Math.max(minN, Math.min(maxN, d1));
        }

        let durMs = 500; 
        window.processBiodata({ type: 'note', ch: synthCh, n: targetNote, v: d2, d: durMs });
    }
    // Control Change (CC)
    else if (status === 0xB0) {
        const ccNum = d1;
        const ccVal = d2;
                 
        if (window.synthChannels[synthCh]) {
            const p = window.synthChannels[synthCh].params;
            if (ccNum === 81) {
                let base = 0.05 + (ccVal / 127) * 4.95;
                let boost = Math.max(0, p.threshold - 5.0);
                p.threshold = parseFloat((base + boost).toFixed(2));
                let tEl = document.getElementById(`ch-mini-thresh-${synthCh}`);
                let vEl = document.getElementById(`ch-val-thresh-${synthCh}`);
                if (tEl) tEl.value = p.threshold;
                if (vEl) vEl.innerText = p.threshold.toFixed(2) + 'x';
            }
            else if (ccNum === 80) {
                let maxScale = p.threshMax || 5.0;
                let boostRange = Math.max(5.0, maxScale - 5.0);
                let boost = (ccVal / 127) * boostRange;
                let base = Math.min(5.0, p.threshold);
                p.threshold = parseFloat((base + boost).toFixed(2));
                let tEl = document.getElementById(`ch-mini-thresh-${synthCh}`);
                let vEl = document.getElementById(`ch-val-thresh-${synthCh}`);
                if (tEl) tEl.value = p.threshold;
                if (vEl) vEl.innerText = p.threshold.toFixed(2) + 'x';
            }
        }
    }
}

// --- UART SYNC COMMANDS WITH BUFFER QUEUE ---
window.bleTxQueue = [];
window.bleIsSending = false;

window.processBleQueue = async function() {
    if (window.bleIsSending || window.bleTxQueue.length === 0 || !window.bleTxCharacteristic) return;
    
    // Clear queue if the device drops offline
    if (window.activeBleDevice && !window.activeBleDevice.gatt.connected) {
        window.bleTxQueue = [];
        return;
    }
    
    window.bleIsSending = true;
    let cmd = window.bleTxQueue[0]; 
    
    try {
        let encoder = new TextEncoder();
        if (window.bleTxCharacteristic.writeValueWithResponse) {
            await window.bleTxCharacteristic.writeValueWithResponse(encoder.encode(cmd));
        } else {
            await window.bleTxCharacteristic.writeValue(encoder.encode(cmd));
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
}

window.sendHardwareCC = function(ch, cc, val) {
    if (window.bleTxCharacteristic) {
        window.bleTxQueue.push(`C:${ch},${cc},${Math.round(val)}\n`);
        window.processBleQueue();
    }
}

window.sendHardwareScale = function(ch, mask) {
    if (window.bleTxCharacteristic) {
        window.bleTxQueue.push(`S:${ch},${mask}\n`);
        window.processBleQueue();
    }
}

// --- MIDI OUT ---
window.sendMidiNote = function(channel, pitch, velocity, duration, playTimeAudioCtx) {
    let played = false;
    if (window.synthChannels[channel]) {
        played = window.synthChannels[channel].play(pitch, velocity, duration, playTimeAudioCtx);
    }
    
    if (played && typeof midiOutput !== 'undefined' && midiOutput) {
        let midiCh = window.synthChannels[channel]?.params.midiOutCh ?? channel;
        let nowAudio = window.audioCtx.currentTime;
        let delayMs = Math.max(0, (playTimeAudioCtx - nowAudio) * 1000);
        let sysTime = window.performance.now() + delayMs;
        
        midiOutput.send([0x90 + midiCh, pitch, velocity], sysTime);
        setTimeout(() => { 
            if (midiOutput) midiOutput.send([0x80 + midiCh, pitch, 0]); 
        }, duration + delayMs);
    }
    return played;
}

window.sendMidiCC = function(channel, ccNumber, val) {
    if (typeof midiOutput !== 'undefined' && midiOutput) {
        let midiCh = window.synthChannels[channel] ? (window.synthChannels[channel].params.midiOutCh || channel) : channel;
        let sysTime = window.performance.now();
        midiOutput.send([0xB0 + midiCh, ccNumber, val], sysTime);
    }
}

// --- WEB BLUETOOTH CONNECTION ---
window.showBlePermissionModal = function(msg) {
    window.dispatchEvent(new CustomEvent('bioquad_ble_error', { 
        detail: { 
            message: msg || "Web Bluetooth is disallowed by the browser iframe's permissions policy.",
            isPermissionsPolicy: true
        } 
    }));
};

window.connectBLE = async function() {
    const btn = document.getElementById('btn-ble');
    const label = document.getElementById('ble-label');
    const statusDot = document.getElementById('ble-status');
    
    // 1. If active and connected, clicking cleanly disconnects
    if (window.activeBleDevice && window.activeBleDevice.gatt && window.activeBleDevice.gatt.connected) {
        try { window.activeBleDevice.gatt.disconnect(); } catch(e){}
        window.activeBleDevice = null;
        window.bleTxCharacteristic = null;
        window.bleIsConnecting = false;
        if (label) label.innerText = 'CONNECT';
        if (statusDot) { statusDot.className = 'status-offline'; statusDot.style.color = 'var(--red)'; }
        return; 
    }

    if (window.bleIsConnecting) {
        console.warn("BLE connection already in progress. Please wait...");
        return;
    }
    window.bleIsConnecting = true;

    // 2. Check if Web Bluetooth API is supported
    if (!navigator.bluetooth || !navigator.bluetooth.requestDevice) {
        window.bleIsConnecting = false;
        window.showBlePermissionModal("Web Bluetooth is not supported in this browser. Please use Google Chrome, Microsoft Edge, or a Web Bluetooth-enabled browser on desktop/Android.");
        if (label) label.innerText = 'NO BLE';
        setTimeout(() => { if (label) label.innerText = 'CONNECT'; }, 3000);
        return;
    }

    // 3. Check Permissions Policy if available
    if (typeof document !== 'undefined') {
        const docWithPolicy = document;
        const isPolicyBlocked = (
            (docWithPolicy.permissionsPolicy && typeof docWithPolicy.permissionsPolicy.allowsFeature === 'function' && !docWithPolicy.permissionsPolicy.allowsFeature('bluetooth')) ||
            (docWithPolicy.featurePolicy && typeof docWithPolicy.featurePolicy.allowsFeature === 'function' && !docWithPolicy.featurePolicy.allowsFeature('bluetooth'))
        );
        if (isPolicyBlocked) {
            window.bleIsConnecting = false;
            window.showBlePermissionModal("Web Bluetooth access is disallowed inside this embedded preview iframe by the browser permissions policy. To connect your hardware device via Bluetooth, launch this app in a standalone tab, or use the File Portal to stream or playback recorded plant biodata.");
            if (label) label.innerText = 'BLOCKED';
            if (statusDot) { statusDot.className = 'status-offline'; statusDot.style.color = 'var(--red)'; }
            setTimeout(() => { if (label) label.innerText = 'CONNECT'; }, 3000);
            return;
        }
    }

    try {
        if (typeof window.audioCtx !== 'undefined' && window.audioCtx.state === 'suspended') {
            await window.audioCtx.resume();
        }
        if (typeof ensureSynths === 'function') ensureSynths();  
                
        if (label) label.innerText = 'SCAN';
                 
        let device = null;
        try {
            device = await navigator.bluetooth.requestDevice({ 
                 filters: [
                    { namePrefix: "biodata" }, { namePrefix: "Biodata" },
                    { namePrefix: "bioQuad" }, { namePrefix: "BioQuad" },
                    { namePrefix: "esp32" }, { namePrefix: "ESP32" }
                ], 
                 optionalServices: [
                    "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
                    "03b80e5a-ede8-4b33-a751-6ce34ec4c700" 
                ] 
             });
        } catch (filterErr) {
            if (filterErr.name === 'SecurityError' || (filterErr.message && filterErr.message.toLowerCase().includes('permissions policy'))) {
                window.bleIsConnecting = false;
                window.showBlePermissionModal("Web Bluetooth access is disallowed inside this embedded preview iframe by the browser permissions policy. To connect your hardware device via Bluetooth, launch this app in a standalone tab, or use the File Portal.");
                if (label) label.innerText = 'BLOCKED';
                if (statusDot) { statusDot.className = 'status-offline'; statusDot.style.color = 'var(--red)'; }
                setTimeout(() => { if (label) label.innerText = 'CONNECT'; }, 3000);
                return;
            }
            if (filterErr.name === 'NotFoundError' || (filterErr.message && filterErr.message.includes('User cancelled')) || filterErr.name === 'AbortError') {
                window.bleIsConnecting = false;
                if (label) label.innerText = 'CONNECT';
                return;
            }
            // Fallback: acceptAllDevices
            device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [
                    "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
                    "03b80e5a-ede8-4b33-a751-6ce34ec4c700"
                ]
            });
        }

        if (!device) {
            window.bleIsConnecting = false;
            if (label) label.innerText = 'CONNECT';
            return;
        }
        
        window.activeBleDevice = device;
        if (label) label.innerText = 'LINKING';
        if (statusDot) { statusDot.className = 'status-offline'; statusDot.style.color = '#ffaa00'; }

        // Helper timeout promise
        const withTimeout = (promise, ms, desc) => {
            let timer;
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(desc || `Timeout after ${ms}ms`)), ms);
            });
            return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
        };

        // 4. Connect to GATT server (with 10-second timeout)
        let server = null;
        if (device.gatt && device.gatt.connected) {
            server = device.gatt;
        } else {
            server = await withTimeout(
                device.gatt.connect(),
                10000,
                "GATT connection timed out. If previously connected, reset/power-cycle your bioQuad device."
            );
        }

        // 5. Discover Service (try Nordic UART first, then fallback to BLE MIDI)
        let service = null;
        let rxChar = null;
        let isBleMidiMode = false;

        try {
            service = await server.getPrimaryService("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
            window.bleTxCharacteristic = await service.getCharacteristic("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
            rxChar = await service.getCharacteristic("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
        } catch (uartErr) {
            console.warn("Nordic UART service not found, trying BLE MIDI service:", uartErr);
            try {
                service = await server.getPrimaryService("03b80e5a-ede8-4b33-a751-6ce34ec4c700");
                rxChar = await service.getCharacteristic("7772e5db-3868-4112-a1a9-f2669d106bf3");
                window.bleTxCharacteristic = rxChar;
                isBleMidiMode = true;
            } catch (midiErr) {
                throw new Error("Connected to device, but neither Nordic UART nor BLE MIDI service was found.");
            }
        }
                 
        device.addEventListener('gattserverdisconnected', () => { 
            if (label) label.innerText = 'CONNECT';
            if (statusDot) { statusDot.className = 'status-offline'; statusDot.style.color = 'var(--red)'; }
            window.activeBleDevice = null;
            window.bleTxCharacteristic = null;
            window.bleIsConnecting = false;
        });
                 
        await rxChar.startNotifications();

        // 6. Handle characteristic notifications
        rxChar.addEventListener('characteristicvaluechanged', (e) => {
            if (isBleMidiMode) {
                // Parse standard BLE MIDI stream
                const dv = e.target.value;
                if (!dv || dv.byteLength < 3) return;
                let idx = 1; // skip header byte
                while (idx < dv.byteLength) {
                    let b = dv.getUint8(idx++);
                    if (b & 0x80) { // timestamp low or status
                        let status = b;
                        let ch = (status & 0x0F) % 4;
                        let d1 = idx < dv.byteLength ? dv.getUint8(idx++) : 60;
                        let d2 = idx < dv.byteLength ? dv.getUint8(idx++) : 0;
                        let msgType = status & 0xF0;
                        if (msgType === 0x90 && d2 > 0) {
                            window.processBiodata({ ch: ch, type: 'note', n: d1, v: d2, d: 200 });
                        } else if (msgType === 0xB0) {
                            if (typeof window.sendMidiCC === 'function') window.sendMidiCC(ch, d1, d2);
                        }
                    }
                }
            } else {
                // Parse Nordic UART JSON stream
                if (typeof window.bleBuffer === 'undefined') window.bleBuffer = '';
                window.bleBuffer += new TextDecoder().decode(e.target.value);
                let lines = window.bleBuffer.split('\n'); 
                window.bleBuffer = lines.pop(); 
                for (let line of lines) { 
                    let trimmed = line.trim();
                    if (trimmed.startsWith('{')) { 
                        try { window.processBiodata(JSON.parse(trimmed)); } catch(err){} 
                    } 
                }
            }
        });
        
        if (label) label.innerText = 'CLOSE';
        if (statusDot) { statusDot.className = 'status-online'; statusDot.style.color = 'var(--green)'; }
        window.bleIsConnecting = false;
                 
        // Hardware-first handshake request for bioQuad firmware
        setTimeout(() => { 
            if (window.bleTxCharacteristic && !isBleMidiMode) {
                window.bleTxQueue.push("SYNC\n");
                window.processBleQueue();
            }
        }, 1000);
        
    } catch (error) { 
        window.bleIsConnecting = false;
        console.warn("BLE Connect result:", error.message || error);
        
        if (error.name === 'SecurityError' || (error.message && error.message.toLowerCase().includes('permissions policy'))) {
            window.showBlePermissionModal("Web Bluetooth access is disallowed inside this embedded preview iframe by the browser permissions policy. To connect hardware BLE devices directly, launch this app in a standalone tab, or use the File Portal.");
            if (label) label.innerText = 'BLOCKED';
        } else if (error.name === 'NotFoundError' || (error.message && error.message.includes('User cancelled')) || error.name === 'AbortError') {
            if (label) label.innerText = 'CONNECT';
        } else {
            if (label) label.innerText = 'RETRY';
            if (statusDot) { statusDot.className = 'status-offline'; statusDot.style.color = 'var(--red)'; }
        }
        
        setTimeout(() => { 
             if (!window.activeBleDevice || !window.activeBleDevice.gatt || !window.activeBleDevice.gatt.connected) { 
                 if (label) label.innerText = 'CONNECT'; 
                 if (statusDot) { statusDot.className = 'status-offline'; statusDot.style.color = 'var(--red)'; }
             } 
         }, 3000);
    }
}

// --- TELEMETRY & NOTE PROCESSOR ---
window.processBiodata = function(payload) {
    if (!payload || typeof payload.ch !== 'number') return;
    let chIdx = payload.ch;
    let ch = window.chData[chIdx];
    if (!ch) return;

    // Record live biodata if recorder is active and not currently playing back a stream
    if (window.biodataRecorder && window.biodataRecorder.isRecording && !window.biodataRecorder.isPaused && (!window.dataStreamer || !window.dataStreamer.isPlaying)) {
        if (payload.type === 'note') {
            window.biodataRecorder.recordNote(chIdx, payload.n, payload.v, payload.d);
        } else if (payload.type === 'raw' && Array.isArray(payload.p)) {
            window.biodataRecorder.recordRaw(chIdx, payload.p);
        }
    }

    if (payload.type === 'note') {
        let playTime = window.audioCtx.currentTime + 0.015;
        window.sendMidiNote(chIdx, payload.n, payload.v, payload.d, playTime);
        
        if (!ch.notes) ch.notes = [];
        ch.notes.push({ n: payload.n, t: Date.now(), dur: payload.d, v: payload.v });
        
        let tabLed = document.getElementById(`led-${chIdx}`);
        if (tabLed) {
            tabLed.classList.add('active');
            setTimeout(() => tabLed.classList.remove('active'), 100);
        }
        
        if (ch.waveBuffer && ch.waveBuffer.length > 0) {
            let lastIdx = ch.waveBuffer.length - 1;
            ch.waveBuffer[lastIdx].evt = 1;
            ch.waveBuffer[lastIdx].n = payload.n;
        }
        
        if (typeof window.triggerDensityVisualizer === 'function') {
            window.triggerDensityVisualizer(chIdx, 'pass');
        }

        // INJECT VISUAL METER SPIKE
        if (window.synthChannels[chIdx]) {
            let p = window.synthChannels[chIdx].params;
            let maxM = Math.max(1.0, Math.min(10.0, p.threshMax || 5.0));
            let tVal = Math.max(1.0, Math.min(maxM, p.threshold));
            let tPct = Math.max(0, Math.min(1, (tVal - 1.0) / Math.max(0.01, maxM - 1.0)));
            
            ch.vizDeltaPct = Math.min(1.0, tPct + 0.05 + (payload.v / 127) * 0.1); 
            if (!ch.peak) ch.peak = { val: 0, time: 0, vel: 0 };
            ch.peak.val = ch.vizDeltaPct;
            ch.peak.time = Date.now();
            ch.peak.vel = 0;
        }
        
        return;
    }

    if (payload.type === 'raw' && Array.isArray(payload.p)) {
        if (!ch.waveBuffer) ch.waveBuffer = [];
        if (!ch.vizBuffer) ch.vizBuffer = [];
        if (!ch.acc || ch.acc.lastSec === undefined) ch.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: Date.now() };
        let pConfig = window.synthChannels[chIdx] ? window.synthChannels[chIdx].params : window.defaultParams;
        const CALIBRATION_FACTOR = 10000000; 
        
        let nowMs = Date.now();
        payload.p.forEach(rawTicks => {
            let rVal = CALIBRATION_FACTOR / rawTicks;
            ch.acc.sum += rVal; 
            ch.acc.count++;
            if (rVal < ch.acc.min) ch.acc.min = rVal;
            if (rVal > ch.acc.max) ch.acc.max = rVal;
            
            ch.waveBuffer.push({ r: rVal, ticks: rawTicks, evt: 0 });
            ch.vizBuffer.push(rVal);
            
            while (ch.waveBuffer.length > 120000) ch.waveBuffer.shift();
            if (ch.vizBuffer.length > (pConfig.sampleSize || 40)) ch.vizBuffer.shift();
        });
        
        let maxim = 0, minim = 1000000, averg = 0, stdevi = 0;
        ch.vizBuffer.forEach(v => {
            if (v > maxim) maxim = v;
            if (v < minim) minim = v;
            averg += v;
        });
        if (ch.vizBuffer.length > 0) averg /= ch.vizBuffer.length;
        
        let maxDev = 0;
        ch.vizBuffer.forEach(v => {
            stdevi += (v - averg) * (v - averg);
            let dev = Math.abs(v - averg);
            if (dev > maxDev) maxDev = dev;
        });
        
        let variance = ch.vizBuffer.length > 0 ? (stdevi / ch.vizBuffer.length) : 0;
        
        ch.lastStdevi = variance > 0 ? Math.sqrt(variance) : 1.0;
        if (ch.lastStdevi < 0.1) ch.lastStdevi = 1.0;
        ch.lastMaxDev = maxDev; // Exactly mirrors hardware threshold check
        ch.lastBlockTime = nowMs;
        
        if (nowMs - ch.acc.lastSec >= 1000) {
            if (!ch.history) ch.history = [];
            if (ch.acc.count > 0) ch.history.push({ avg: ch.acc.sum / ch.acc.count, min: ch.acc.min, max: ch.acc.max });
            if (ch.history.length > 300) ch.history.shift(); 
            ch.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: nowMs };
        }
    }
    
    // --- PARSE HARDWARE STATE SYNC ---
    if (payload.type === 'state') {
        let p = window.synthChannels[chIdx].params;
        p.threshold = payload.thr;
        
        // Auto-expand the UI slider scale if hardware threshold exceeds current max
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
        
        for (let i = 0; i < 12; i++) {
            p.activeScaleBits[i] = (payload.scl & (1 << i)) !== 0;
        }
        
        window.synthChannels[chIdx].applyParams();
        if (chIdx === window.activeSynthIndex && typeof window.syncUI === 'function') {
            window.syncUI();
            if (typeof window.syncPianoUI === 'function') window.syncPianoUI();
        }
        return;
    }
};

// Initialize Web MIDI on page load
setupWebMidi();