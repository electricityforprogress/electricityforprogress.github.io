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
            opt.value = p.id; 
            opt.text = p.name; 
            if (p.id === currentVal) opt.selected = true; 
            select.appendChild(opt); 
        }); 
        
        window.midiOutput = access.outputs.get(select.value) || null;
    }
    pop(); 
    access.onstatechange = pop; 
    select.addEventListener('change', (e) => window.midiOutput = access.outputs.get(e.target.value) || null);
}).catch(()=>{});

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

window.connectBLE = async function() {
    const btn = document.getElementById('btn-ble');
    if (window.activeBleDevice && window.activeBleDevice.gatt && window.activeBleDevice.gatt.connected) {
        window.activeBleDevice.gatt.disconnect();
        return; 
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
    } catch (error) { 
        console.error("BLE Connect Error:", error);
        if(btn) btn.innerHTML = 'FAILED <span id="ble-status" class="status-offline" style="color: var(--red);">●</span>';
        setTimeout(() => {
            if(btn && (!window.activeBleDevice || !window.activeBleDevice.gatt.connected)) {
                btn.innerHTML = 'CONNECT <span id="ble-status" class="status-offline">●</span>';
            }
        }, 3000);
    }
};

window.processBiodata = function(payload) {
    if (payload.type === 'raw' && typeof payload.ch === 'number' && Array.isArray(payload.p)) {
        let chIdx = payload.ch;
        let ch = chData[chIdx];
        let pConfig = synthChannels[chIdx] ? synthChannels[chIdx].params : window.defaultParams;
        if (!pConfig) return;
        
        if (!ch.analysisBuffer) ch.analysisBuffer = [];
        if (!ch.tickBuffer) ch.tickBuffer = []; 
        if (!ch.lastTrigger) ch.lastTrigger = 0;
        if (ch.ema === undefined) ch.ema = null;
        if (ch.emaTicks === undefined) ch.emaTicks = null;
        if (!ch.history) ch.history = [];
        if (!ch.acc || ch.acc.lastSec === undefined) ch.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: Date.now() };

        const CALIBRATION_FACTOR = 10000000; 
        const AUDIO_EMA_ALPHA = 0.05; 

        payload.p.forEach(rawTicks => {
            let rawAdmittance = CALIBRATION_FACTOR / rawTicks;
            ch.ema = (ch.ema === null) ? rawAdmittance : (rawAdmittance * AUDIO_EMA_ALPHA) + (ch.ema * (1 - AUDIO_EMA_ALPHA));
            ch.emaTicks = (ch.emaTicks === null) ? rawTicks : (rawTicks * 0.05) + (ch.emaTicks * 0.95);

            if (ch.lastEma !== undefined) {
                let instantaneousSlew = ch.ema - ch.lastEma;
                ch.slew = (ch.slew === undefined) ? instantaneousSlew : (instantaneousSlew * 0.05) + (ch.slew * 0.95);
            }
            ch.lastEma = ch.ema;

            ch.acc.sum += ch.ema; 
            ch.acc.count++;
            if (ch.ema < ch.acc.min) ch.acc.min = ch.ema;
            if (ch.ema > ch.acc.max) ch.acc.max = ch.ema;

            let nowMs = Date.now();
            if (nowMs - ch.acc.lastSec >= 1000) {
                if (ch.acc.count > 0) ch.history.push({ avg: ch.acc.sum / ch.acc.count, min: ch.acc.min, max: ch.acc.max });
                else ch.history.push({ avg: ch.ema || 0, min: ch.ema || 0, max: ch.ema || 0 });
                
                if (ch.history.length > 300) ch.history.shift(); 
                ch.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: nowMs };
            }

            ch.analysisBuffer.push(ch.ema);
            ch.tickBuffer.push(ch.emaTicks);
            
            let finalPitch = null;
            let isEvent = 0;
            let sampleWindow = pConfig.sampleSize || 40;

            if (ch.analysisBuffer.length >= sampleWindow) {
                let maxim = 0, minim = 1000000, averg = 0, stdevi = 0;
                let tMaxim = 0, tMinim = 10000000; 
                
                for (let j = 0; j < ch.analysisBuffer.length; j++) {
                    let val = ch.analysisBuffer[j];
                    if (val > maxim) maxim = val;
                    if (val < minim) minim = val;
                    averg += val;
                    stdevi += val * val; 
                    
                    let tVal = ch.tickBuffer[j];
                    if (tVal > tMaxim) tMaxim = tVal;
                    if (tVal < tMinim) tMinim = tVal;
                }
                
                averg = averg / sampleWindow;
                let variance = (stdevi / sampleWindow) - (averg * averg);
                stdevi = variance > 0 ? Math.sqrt(variance) : 1.0;
                if (stdevi < 1.0) stdevi = 1.0; 
                
                let delta = maxim - minim;
                let tickDelta = tMaxim - tMinim; 
                let thresh = pConfig.threshold || 2.0;
                
                ch.lastDelta = delta;
                ch.lastStdevi = stdevi;
                ch.lastBlockTime = nowMs;
                
                // --- NEW VECTOR "WIGGLE" TARGET GENERATOR ---
                // Maps the Magnitude of Change (Delta) and Direction (Slew) to a 0-127 target destination
                let magnitude = (stdevi > 0) ? (delta / stdevi) : 0;
                let direction = (ch.slew > 0) ? 1 : -1;
                ch.wiggleTarget = Math.max(0, Math.min(127, 64 + (direction * magnitude * 20)));

                // --- DENSITY CC OUTPUT (CC 81) ---
                let recentEvents = (ch.densityEvents || []).filter(e => e.type === 'pass' && (nowMs - e.t < 4000)).length;
                let densityVal = Math.max(0, Math.min(127, Math.round((recentEvents / 15) * 127)));
               // window.sendMidiCC(chIdx, 81, densityVal);
                
                if (delta > (stdevi * thresh)) {
                    let densityGate = pConfig.density !== undefined ? pConfig.density : 100;
                    if (Math.random() * 100 <= densityGate) {
                        if (nowMs - ch.lastTrigger > 50) { 
                            let durMult = pConfig.durMult !== undefined ? pConfig.durMult : 1.0;
                            let dur = (150 + window.mapScale(tickDelta % 127, 0, 127, 100, 5500)) * durMult;
                            let vel = window.mapScale(tickDelta % 127, 0, 127, pConfig.velMin || 60, pConfig.velMax || 110);
                            
                            let actualTicks = ch.emaTicks || 10000;
                            let rawPitchNorm = (actualTicks % 127) / 127.0; 
                            
                            let spread = pConfig.spread !== undefined ? pConfig.spread : 75;
                            let shapedPitch = window.applySpreadCurve(rawPitchNorm, spread);
                            let rawNote = Math.round(window.mapScale(shapedPitch, 0, 1.0, pConfig.minNote || 36, pConfig.maxNote || 84));
                            finalPitch = window.scaleNote(
                                rawNote, 
                                pConfig.scaleType || 'chromatic', 
                                pConfig.scaleRoot || 0,
                                pConfig.activeScaleBits,     // Adds the custom piano UI states
                                pConfig.minNote || 36,       // Enforces the bottom of the range
                                pConfig.maxNote || 84        // Enforces the top of the range
                            );
                            isEvent = 1;
                            
                            if (window.masterStartTime === undefined) window.masterStartTime = window.audioCtx.currentTime;
                            let nowAudio = window.audioCtx.currentTime;
                            let playTimeAudioCtx = nowAudio + 0.015; 
                            let qVal = pConfig.quantize || 0;
                            
                            if (qVal > 0) {
                                let beatSecs = 60.0 / (window.masterBPM || 120);
                                let divSecs = 0;
                                if (qVal===1) divSecs = beatSecs/16;
                                else if (qVal===2) divSecs = beatSecs/8;
                                else if (qVal===3) divSecs = beatSecs/4;
                                else if (qVal===4) divSecs = beatSecs/2;
                                else if (qVal===5) divSecs = beatSecs;
                                else if (qVal===6) divSecs = beatSecs * (2/3); 
                                else if (qVal===7) divSecs = beatSecs * 2;
                                else if (qVal===8) divSecs = beatSecs * 4;
                                
                                let elapsed = nowAudio - window.masterStartTime;
                                let nextDiv = Math.ceil(elapsed / divSecs) * divSecs;
                                playTimeAudioCtx = window.masterStartTime + nextDiv;
                            }
                            
                            let played = window.sendMidiNote(chIdx, finalPitch, vel, dur, playTimeAudioCtx);
                            
                            if (played) {
                                let delayMs = (playTimeAudioCtx - nowAudio) * 1000;
                                setTimeout(() => {
                                    ch.notes.push({ n: finalPitch, t: Date.now(), dur: dur, v: vel });
                                }, Math.max(0, delayMs));
                                
                                ch.lastTrigger = nowMs;
                                if (typeof window.triggerDensityVisualizer === 'function') window.triggerDensityVisualizer(chIdx, 'pass');
                            } else {
                                if (typeof window.triggerDensityVisualizer === 'function') window.triggerDensityVisualizer(chIdx, 'drop');
                            }
                        }
                    } else {
                        if (typeof window.triggerDensityVisualizer === 'function') window.triggerDensityVisualizer(chIdx, 'drop');
                    }
                }
                ch.analysisBuffer = [];
                ch.tickBuffer = [];
            }
            if (!ch.renderQueue) ch.renderQueue = [];
            ch.renderQueue.push({ r: rawAdmittance, evt: isEvent, n: finalPitch, ticks: rawTicks });
        });
    }
};
