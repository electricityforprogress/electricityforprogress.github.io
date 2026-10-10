/**
 * js/bleMidi.js
 */

navigator.requestMIDIAccess({ sysex: false }).then(access => {
    const select = document.getElementById('midi-out-select');
    const pop = () => { select.innerHTML = '<option value="none">No Output</option>'; Array.from(access.outputs.values()).forEach(p => { let opt = document.createElement('option'); opt.value = p.id; opt.text = p.name; select.appendChild(opt); }); }
    pop(); access.onstatechange = pop; select.addEventListener('change', (e) => midiOutput = access.outputs.get(e.target.value) || null);
}).catch(()=>{});

function sendMidiNote(channel, pitch, velocity, duration) {
    if (synthChannels[channel]) synthChannels[channel].play(pitch, velocity, duration);
    
    if (midiOutput) { 
        let midiCh = synthChannels[channel].params.midiOutCh || channel; 
        midiOutput.send([0x90 + midiCh, pitch, velocity]); 
        setTimeout(() => { 
            if (midiOutput) midiOutput.send([0x80 + midiCh, pitch, 0]); 
        }, duration); 
    }
    return pitch; 
}

async function connectBLE() {
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    ensureSynths(); 
    
    try {
        // FIXED: Now accepts both lowercase and uppercase 'biodata'
        const device = await navigator.bluetooth.requestDevice({ 
            filters: [{ namePrefix: "biodata" }, { namePrefix: "Biodata" }], 
            optionalServices: ["6e400001-b5a3-f393-e0a9-e50e24dcca9e"] 
        });
        document.getElementById('ble-status').innerText = 'CONNECTING...';
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
        bleTxCharacteristic = await service.getCharacteristic("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
        const rxChar = await service.getCharacteristic("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
        
        device.addEventListener('gattserverdisconnected', () => { 
            document.getElementById('ble-status').innerText = 'OFFLINE'; 
            document.getElementById('ble-status').style.color = 'var(--red)'; 
        });
        
        await rxChar.startNotifications();
        rxChar.addEventListener('characteristicvaluechanged', (e) => {
            bleBuffer += new TextDecoder().decode(e.target.value);
            let lines = bleBuffer.split('\n'); bleBuffer = lines.pop(); 
            for (let line of lines) { 
                if (line.trim().startsWith('{')) { 
                    try { processBiodata(JSON.parse(line)); } catch(err){} 
                } 
            }
        });
        document.getElementById('ble-status').innerText = 'ONLINE'; 
        document.getElementById('ble-status').style.color = 'var(--green)';
    } catch (error) { 
        console.error("BLE Connect Error:", error);
        document.getElementById('ble-status').innerText = 'FAILED'; 
    }
}

function sendThresholdBLE(ch, val) { 
    document.getElementById(`t-val-${ch}`).innerText = val; 
    if (bleTxCharacteristic) bleTxCharacteristic.writeValueWithoutResponse(new TextEncoder().encode(`T${ch}:${val}\n`)); 
}

function processBiodata(payload) {
    // FIXED: Correctly iterates through the new high-density array of integers: "p": [1000, 1050, 1100]
    if (payload.type === 'raw' && typeof payload.ch === 'number' && Array.isArray(payload.p)) {
        let chIdx = payload.ch;
        let ch = chData[chIdx];
        let pConfig = synthChannels[chIdx] ? synthChannels[chIdx].params : null;
        
        if (!pConfig) return;
        
        // Ensure properties exist on first run
        if (!ch.analysisBuffer) ch.analysisBuffer = [];
        if (!ch.lastTrigger) ch.lastTrigger = 0;

        payload.p.forEach(rawPulse => {
            ch.analysisBuffer.push(rawPulse);
            
            let finalPitch = null;
            let isEvent = 0;

            if (ch.analysisBuffer.length >= pConfig.sampleSize) {
                let maxim = 0, minim = 1000000, averg = 0, stdevi = 0;
                
                for (let j = 0; j < ch.analysisBuffer.length; j++) {
                    let val = ch.analysisBuffer[j];
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
                    let now = Date.now();
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
            
            ch.waveBuffer.push({ g: rawPulse, evt: isEvent, n: finalPitch });
            
            // Expanded to 600 points (about half a second of history) so the wave is readable
            if (ch.waveBuffer.length > 600) ch.waveBuffer.shift(); 
        });
    }
}
