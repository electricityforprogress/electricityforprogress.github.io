/**
 * js/bleMidi.js
 */

navigator.requestMIDIAccess({ sysex: false }).then(access => {
    const select = document.getElementById('midi-out-select');
    const pop = () => { 
        let currentVal = select.value; 
        select.innerHTML = '<option value="none">No Output</option>'; 
        Array.from(access.outputs.values()).forEach(p => { 
            let opt = document.createElement('option'); 
            opt.value = p.id; opt.text = p.name; 
            if (p.id === currentVal) opt.selected = true; 
            select.appendChild(opt); 
        }); 
        window.midiOutput = access.outputs.get(select.value) || null;
    }
    pop(); access.onstatechange = pop; 
    select.addEventListener('change', (e) => window.midiOutput = access.outputs.get(e.target.value) || null);
}).catch(()=>{});

// --- UART SYNC COMMANDS WITH BUFFER QUEUE ---
window.bleTxQueue = [];
window.bleIsSending = false;

// The "Traffic Cop" to prevent Bluetooth buffer overflows
window.processBleQueue = async function() {
    if (window.bleIsSending || window.bleTxQueue.length === 0 || !window.bleTxCharacteristic) return;
    window.bleIsSending = true;
    
    let cmd = window.bleTxQueue.shift();
    try {
        let encoder = new TextEncoder();
        // Use standard writeValue to wait for the ESP32 to ACK the packet
        await window.bleTxCharacteristic.writeValue(encoder.encode(cmd));
    } catch (e) { 
        console.error("BLE TX Error:", e); 
    }
    
    window.bleIsSending = false;
    // Process the next item in the queue immediately
    if (window.bleTxQueue.length > 0) {
        setTimeout(window.processBleQueue, 5);
    }
};

window.sendHardwareCC = function(ch, cc, val) {
    if (window.bleTxCharacteristic) {
        window.bleTxQueue.push(`C:${ch},${cc},${Math.round(val)}\n`);
        window.processBleQueue();
    }
};

window.sendHardwareScale = function(ch, mask) {
    if (window.bleTxCharacteristic) {
        window.bleTxQueue.push(`S:${ch},${mask}\n`);
        window.processBleQueue();
    }
};

// --- MIDI OUT ---
window.sendMidiNote = function(channel, pitch, velocity, duration, playTimeAudioCtx) {
    let played = false;
    if (synthChannels[channel]) played = synthChannels[channel].play(pitch, velocity, duration, playTimeAudioCtx);
    
    if (played && typeof midiOutput !== 'undefined' && midiOutput) { 
        let midiCh = synthChannels[channel].params.midiOutCh || channel; 
        let nowAudio = window.audioCtx.currentTime;
        let delayMs = Math.max(0, (playTimeAudioCtx - nowAudio) * 1000);
        let sysTime = window.performance.now() + delayMs;
        
        midiOutput.send([0x90 + midiCh, pitch, velocity], sysTime); 
        setTimeout(() => { if (midiOutput) midiOutput.send([0x80 + midiCh, pitch, 0]); }, duration + delayMs); 
    }
    return played; 
};

window.sendMidiCC = function(channel, ccNumber, val) {
    if (typeof midiOutput !== 'undefined' && midiOutput) {
        let midiCh = synthChannels[channel] ? (synthChannels[channel].params.midiOutCh || channel) : channel;
        let sysTime = window.performance.now();
        midiOutput.send([0xB0 + midiCh, ccNumber, val], sysTime);
    }
};

// --- BLE CONNECTION ---
window.connectBLE = async function() {
    const btn = document.getElementById('btn-ble');
    if (window.activeBleDevice && window.activeBleDevice.gatt && window.activeBleDevice.gatt.connected) {
        window.activeBleDevice.gatt.disconnect(); return; 
    }
    try {
        if(btn) btn.innerHTML = 'INIT... <span id="ble-status" class="status-offline">●</span>';
        if (typeof audioCtx !== 'undefined' && audioCtx.state === 'suspended') await audioCtx.resume();
        if (typeof ensureSynths === 'function') ensureSynths(); 
        
        if(btn) btn.innerHTML = 'SCANNING... <span id="ble-status" class="status-offline">●</span>';
        const device = await navigator.bluetooth.requestDevice({ 
            filters: [{ namePrefix: "biodata" }, { namePrefix: "Biodata" }], 
            optionalServices: ["6e400001-b5a3-f393-e0a9-e50e24dcca9e"] 
        });
        
        window.activeBleDevice = device;
        if(btn) btn.innerHTML = 'CONNECTING... <span id="ble-status" class="status-offline">●</span>';
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
        
        window.bleTxCharacteristic = await service.getCharacteristic("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
        const rxChar = await service.getCharacteristic("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
        
        device.addEventListener('gattserverdisconnected', () => { 
            if(btn) btn.innerHTML = 'CONNECT <span id="ble-status" class="status-offline" style="color: var(--red);">●</span>';
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
                    try { processBiodata(JSON.parse(line)); } catch(err){} 
                } 
            }
        });
        if(btn) btn.innerHTML = 'DISCONNECT <span id="ble-status" class="status-online" style="color: var(--green);">●</span>';
        
        // Push full state on connect (Now fully queued and safe!)
        setTimeout(() => { if (typeof syncParamsToHardware === 'function') syncParamsToHardware(activeSynthIndex); }, 500);

    } catch (error) { 
        console.error("BLE Connect Error:", error);
        if(btn) btn.innerHTML = 'FAILED <span id="ble-status" class="status-offline" style="color: var(--red);">●</span>';
        setTimeout(() => { if(btn && (!window.activeBleDevice || !window.activeBleDevice.gatt.connected)) { btn.innerHTML = 'CONNECT <span id="ble-status" class="status-offline">●</span>'; } }, 3000);
    }
};

window.processBiodata = function(payload) {
    if (!payload || typeof payload.ch !== 'number') return;
    let chIdx = payload.ch;
    let ch = chData[chIdx];
    if (!ch) return;

    if (payload.type === 'note') {
        let playTime = window.audioCtx.currentTime + 0.015;
        window.sendMidiNote(chIdx, payload.n, payload.v, payload.d, playTime);
        
        if (!ch.notes) ch.notes = [];
        ch.notes.push({ n: payload.n, t: Date.now(), dur: payload.d, v: payload.v });
        
        if (ch.waveBuffer && ch.waveBuffer.length > 0) {
            let lastIdx = ch.waveBuffer.length - 1;
            ch.waveBuffer[lastIdx].evt = 1;
            ch.waveBuffer[lastIdx].n = payload.n;
        }
        
        if (typeof window.triggerDensityVisualizer === 'function') window.triggerDensityVisualizer(chIdx, 'pass');
        return;
    }

    if (payload.type === 'raw' && Array.isArray(payload.p)) {
        if (!ch.waveBuffer) ch.waveBuffer = [];
        if (!ch.vizBuffer) ch.vizBuffer = [];
        if (!ch.acc || ch.acc.lastSec === undefined) ch.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: Date.now() };

        let pConfig = synthChannels[chIdx] ? synthChannels[chIdx].params : window.defaultParams;
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
            stdevi += v * v;
        });
        if (ch.vizBuffer.length > 0) averg /= ch.vizBuffer.length;
        let variance = (stdevi / ch.vizBuffer.length) - (averg * averg);
        
        ch.lastStdevi = variance > 0 ? Math.sqrt(variance) : 1.0;
        if (ch.lastStdevi < 0.1) ch.lastStdevi = 1.0;
        ch.lastDelta = maxim - minim;
        ch.lastBlockTime = nowMs;
        
        if (nowMs - ch.acc.lastSec >= 1000) {
            if (!ch.history) ch.history = [];
            if (ch.acc.count > 0) ch.history.push({ avg: ch.acc.sum / ch.acc.count, min: ch.acc.min, max: ch.acc.max });
            if (ch.history.length > 300) ch.history.shift(); 
            ch.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: nowMs };
        }
    }
};
