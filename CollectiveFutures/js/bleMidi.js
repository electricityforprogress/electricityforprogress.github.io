/**
 * js/bleMidi.js
 */

navigator.requestMIDIAccess({ sysex: false }).then(access => {
    const select = document.getElementById('midi-out-select');
    const pop = () => { 
        select.innerHTML = '<option value="none">No Output</option>'; 
        Array.from(access.outputs.values()).forEach(p => { 
            let opt = document.createElement('option'); 
            opt.value = p.id; 
            opt.text = p.name; 
            select.appendChild(opt); 
        }); 
    }
    pop(); 
    access.onstatechange = pop; 
    select.addEventListener('change', (e) => midiOutput = access.outputs.get(e.target.value) || null);
}).catch(()=>{});

function sendMidiNote(channel, pitch, velocity, duration) {
    if (synthChannels[channel]) synthChannels[channel].play(pitch, velocity, duration);
    if (midiOutput) { 
        let midiCh = synthChannels[channel].params.midiOutCh || channel; 
        midiOutput.send([0x90 + midiCh, pitch, velocity]); 
        setTimeout(() => { if (midiOutput) midiOutput.send([0x80 + midiCh, pitch, 0]); }, duration); 
    }
    return pitch; 
}

async function connectBLE() {
    try {
        const btn = document.getElementById('ble-status');
        if(btn) btn.innerText = 'INIT...';

        if (audioCtx.state === 'suspended') await audioCtx.resume();
        ensureSynths(); 
        
        if(btn) btn.innerText = 'SCANNING...';
        
        const device = await navigator.bluetooth.requestDevice({ 
            filters: [{ namePrefix: "biodata" }, { namePrefix: "Biodata" }], 
            optionalServices: ["6e400001-b5a3-f393-e0a9-e50e24dcca9e"] 
        });
        
        if(btn) btn.innerText = 'CONNECTING...';
        
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
        bleTxCharacteristic = await service.getCharacteristic("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
        const rxChar = await service.getCharacteristic("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
        
        device.addEventListener('gattserverdisconnected', () => { 
            if(btn) { btn.innerText = 'OFFLINE'; btn.style.color = 'var(--red)'; }
        });
        
        await rxChar.startNotifications();
        rxChar.addEventListener('characteristicvaluechanged', (e) => {
            bleBuffer += new TextDecoder().decode(e.target.value);
            let lines = bleBuffer.split('\n'); 
            bleBuffer = lines.pop(); 
            for (let line of lines) { 
                if (line.trim().startsWith('{')) { 
                    try { processBiodata(JSON.parse(line)); } catch(err){} 
                } 
            }
        });
        
        if(btn) { btn.innerText = 'ONLINE'; btn.style.color = 'var(--green)'; }
        
    } catch (error) { 
        console.error("BLE Connect Error:", error);
        const btn = document.getElementById('ble-status');
        if(btn) { btn.innerText = 'FAILED'; btn.style.color = 'var(--red)'; }
        alert("Bluetooth Error: " + error.message);
    }
}

function sendThresholdBLE(ch, val) { 
    document.getElementById(`t-val-${ch}`).innerText = val; 
    if (bleTxCharacteristic) bleTxCharacteristic.writeValueWithoutResponse(new TextEncoder().encode(`T${ch}:${val}\n`)); 
}

function processBiodata(payload) {
    if (payload.type === 'raw' && typeof payload.ch === 'number' && Array.isArray(payload.p)) {
        let chIdx = payload.ch;
        let ch = chData[chIdx];
        let pConfig = synthChannels[chIdx] ? synthChannels[chIdx].params : null;
        
        if (!pConfig) return;
        
        if (!ch.analysisBuffer) ch.analysisBuffer = [];
        if (!ch.lastTrigger) ch.lastTrigger = 0;
        if (ch.ema === undefined) ch.ema = null;
        if (ch.emaTicks === undefined) ch.emaTicks = null;
        if (!ch.history) ch.history = [];
        if (!ch.acc) ch.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: Date.now() };
        if (!ch.vis) ch.vis = { counter: 0, evt: 0, pitch: null };

        const CALIBRATION_FACTOR = 10000000; 
        const DECIMATION_RATE = 2;   // Fixed rate for smooth visuals
        const EMA_ALPHA = 0.05;      // Fixed smoothing

        payload.p.forEach(rawTicks => {
            ch.analysisBuffer.push(rawTicks);
            
            // Math computations
            let rawAdmittance = CALIBRATION_FACTOR / rawTicks;
            ch.ema = (ch.ema === null) ? rawAdmittance : (rawAdmittance * EMA_ALPHA) + (ch.ema * (1 - EMA_ALPHA));
            ch.emaTicks = (ch.emaTicks === null) ? rawTicks : (rawTicks * 0.05) + (ch.emaTicks * 0.95);

            if (ch.lastEma !== undefined) {
                let instantaneousSlew = ch.ema - ch.lastEma;
                ch.slew = (ch.slew === undefined) ? instantaneousSlew : (instantaneousSlew * 0.05) + (ch.slew * 0.95);
                
                if (ch.lastSlew !== undefined) {
                    if (ch.lastSlew > 0 && ch.slew <= 0) ch.peakFlag = 45; 
                    if (ch.lastSlew < 0 && ch.slew >= 0) ch.troughFlag = 45;
                }
                ch.lastSlew = ch.slew;
            }
            ch.lastEma = ch.ema;

            ch.acc.sum += ch.ema; 
            ch.acc.count++;
            if (ch.ema < ch.acc.min) ch.acc.min = ch.ema;
            if (ch.ema > ch.acc.max) ch.acc.max = ch.ema;

            let now = Date.now();
            if (now - ch.acc.lastSec >= 1000) {
                ch.history.push({ avg: ch.acc.sum / ch.acc.count, min: ch.acc.min, max: ch.acc.max });
                if (ch.history.length > 300) ch.history.shift(); 
                ch.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: now };
            }

            let finalPitch = null;
            let isEvent = 0;

            if (ch.analysisBuffer.length >= pConfig.sampleSize) {
                let maxim = 0, minim = 1000000, averg = 0, stdevi = 0;
                for (let j = 0; j < ch.analysisBuffer.length; j++) {
                    let val = CALIBRATION_FACTOR / ch.analysisBuffer[j];
                    if (val > maxim) maxim = val;
                    if (val < minim) minim = val;
                    averg += val;
                    stdevi += val * val; 
                }
                averg = averg / pConfig.sampleSize;
                let variance = (stdevi / pConfig.sampleSize) - (averg * averg);
                stdevi = variance > 0 ? Math.sqrt(variance) : 1.0;
                if (stdevi < 1.0) stdevi = 1.0;
                let delta = maxim - minim;
                
                if (delta > (stdevi * pConfig.threshold)) {
                    if (now - ch.lastTrigger > 50) { 
                        let mapScale = (v, inMin, inMax, outMin, outMax) => (v - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
                        let dur = 150 + mapScale(delta % 127, 0, 127, 100, 5500);
                        let vel = mapScale(delta % 127, 0, 127, 80, 110);
                        let rawNote = mapScale(averg % 127, 0, 127, pConfig.minNote, pConfig.maxNote);
                        let modifiedPitch = applyPitchMods(chIdx, rawNote);
                        
                        if (modifiedPitch !== null) {
                            isEvent = 1;
                            finalPitch = sendMidiNote(chIdx, modifiedPitch, vel, dur);
                            ch.notes.push({ n: finalPitch, t: now, dur: dur, v: vel });
                        }
                        ch.lastTrigger = now;
                    }
                }
                ch.analysisBuffer = [];
            }
            
            if (isEvent) { ch.vis.evt = 1; ch.vis.pitch = finalPitch; }
            ch.vis.counter++;
            
            if (ch.vis.counter >= DECIMATION_RATE) {
                if (!ch.renderQueue) ch.renderQueue = [];
                // Added raw ticks to the payload for the HUD
                ch.renderQueue.push({ r: rawAdmittance, s: ch.ema, evt: ch.vis.evt, n: ch.vis.pitch, ticks: ch.emaTicks });
                ch.vis.counter = 0;
                ch.vis.evt = 0;
                ch.vis.pitch = null;
            }
        });
    }
}
