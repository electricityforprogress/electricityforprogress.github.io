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
        
        // 1. Strict Note Range Filter (Drops MIDI notes outside your sliders)
        if (d1 < p.minNote || d1 > p.maxNote) return; 
        
        // 2. Strict Scale Filter (Drops out-of-key MIDI notes)
        if (p.scaleType !== 'chromatic') {
            let noteClass = d1 % 12;
            if (p.activeScaleBits && !p.activeScaleBits[noteClass]) {
                return; 
            }
        }

        let playTime = window.audioCtx.currentTime + 0.015;
        let durMs = 500; 
        window.processBiodata({ type: 'note', ch: synthCh, n: d1, v: d2, d: durMs });
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
window.connectBLE = async function() {
    const btn = document.getElementById('btn-ble');
    const label = document.getElementById('ble-label');
    const statusDot = document.getElementById('ble-status');
    
    if (window.activeBleDevice && window.activeBleDevice.gatt && window.activeBleDevice.gatt.connected) {
        window.activeBleDevice.gatt.disconnect(); 
        return; 
    }
    try {
        if (typeof window.audioCtx !== 'undefined' && window.audioCtx.state === 'suspended') {
            await window.audioCtx.resume();
        }
        if (typeof ensureSynths === 'function') ensureSynths();  
                
        if (!navigator.bluetooth) throw new Error("Web Bluetooth is not available.");
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
            if (filterErr.name === 'NotFoundError' || filterErr.message.includes('User cancelled')) {
                throw filterErr;
            }
            device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [
                    "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
                    "03b80e5a-ede8-4b33-a751-6ce34ec4c700"
                ]
            });
        }
        
        window.activeBleDevice = device;
                 
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
                 
        window.bleTxCharacteristic = await service.getCharacteristic("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
        const rxChar = await service.getCharacteristic("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
                 
        device.addEventListener('gattserverdisconnected', () => { 
            if (label) label.innerText = 'CONNECT';
            if (statusDot) { statusDot.className = 'status-offline'; statusDot.style.color = 'var(--red)'; }
            window.activeBleDevice = null;
            window.bleTxCharacteristic = null;
        });
                 
        await rxChar.startNotifications();
        rxChar.addEventListener('characteristicvaluechanged', (e) => {
            if (typeof window.bleBuffer === 'undefined') window.bleBuffer = '';
            window.bleBuffer += new TextDecoder().decode(e.target.value);
            let lines = window.bleBuffer.split('\n'); 
            window.bleBuffer = lines.pop(); 
            for (let line of lines) { 
                if (line.trim().startsWith('{')) { 
                    try { window.processBiodata(JSON.parse(line)); } catch(err){} 
                } 
            }
        });
        
        if (label) label.innerText = 'CLOSE';
        if (statusDot) { statusDot.className = 'status-online'; statusDot.style.color = 'var(--green)'; }
                 
        // Hardware-first handshake request
        setTimeout(() => { 
            window.bleTxQueue.push("SYNC\n");
            window.processBleQueue();
        }, 1000);
        
    } catch (error) { 
        console.error("BLE Connect Error:", error);
        if (label) label.innerText = 'FAILED';
        if (statusDot) { statusDot.className = 'status-offline'; statusDot.style.color = 'var(--red)'; }
        
        setTimeout(() => { 
             if (!window.activeBleDevice || !window.activeBleDevice.gatt.connected) { 
                 if (label) label.innerText = 'CONNECT'; 
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