/**
 * js/bleMidi.js
 * 
 * Manages Bluetooth connection, data parsing, and WebMIDI outbound routing.
 * 
 * FUTURE ENHANCEMENT: Integrate indexedDB or a structured logging service here 
 * to handle recording the raw data over extended durations.
 */

navigator.requestMIDIAccess({ sysex: false }).then(access => {
    const select = document.getElementById('midi-out-select');
    const pop = () => { select.innerHTML = '<option value="none">No Output</option>'; Array.from(access.outputs.values()).forEach(p => { let opt = document.createElement('option'); opt.value = p.id; opt.text = p.name; select.appendChild(opt); }); }
    pop(); access.onstatechange = pop; select.addEventListener('change', (e) => midiOutput = access.outputs.get(e.target.value) || null);
}).catch(()=>{});

function sendMidiNote(channel, pitch, velocity, duration) {
    triggerLED(channel);
    if (synthChannels[channel]) synthChannels[channel].play(pitch, velocity, duration);
    if (midiOutput) { midiOutput.send([0x90 + channel, pitch, velocity]); setTimeout(() => { if (midiOutput) midiOutput.send([0x80 + channel, pitch, 0]); }, duration); }
    return pitch; 
}

async function connectBLE() {
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    if (!rampDownWave) initCustomWaves();
    ensureSynths();
    try {
        const device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: "Biodata" }], optionalServices: ["6e400001-b5a3-f393-e0a9-e50e24dcca9e"] });
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
                    try { 
                        // FUTURE ENHANCEMENT: Hook logging functions into this pipeline
                        processBiodata(JSON.parse(line)); 
                    } catch(err){} 
                } 
            }
        });
        document.getElementById('ble-status').innerText = 'ONLINE'; 
        document.getElementById('ble-status').style.color = 'var(--green)';
    } catch (error) { document.getElementById('ble-status').innerText = 'FAILED'; }
}

function sendThresholdBLE(ch, val) { 
    document.getElementById(`t-val-${ch}`).innerText = val; 
    if (bleTxCharacteristic) bleTxCharacteristic.writeValueWithoutResponse(new TextEncoder().encode(`T${ch}:${val}\n`)); 
}

function processBiodata(payload) {
    // Optionally, you can now grab payload.t (Temp) and payload.h (Humidity) here
    
    if (payload.ch) {
        payload.ch.forEach(p => {
            let i = p.c;
            
            // ESP32 now sends raw microsecond high-time.
            // We pass it directly into the graph scaler.
            let rawPulse = p.p; 
            
            let finalPitch = p.n;
            if (p.e === 1 && synthChannels[i]) {
                let modifiedPitch = applyPitchMods(i, p.n);
                if (modifiedPitch !== null) { 
                    finalPitch = sendMidiNote(i, modifiedPitch, p.v, p.d);
                    chData[i].notes.push({ n: finalPitch, t: Date.now(), dur: p.d, v: p.v });
                }
            }
            
            chData[i].waveBuffer.push({ g: rawPulse, evt: p.e, n: finalPitch });
            
            // Increased to 100 to map nicely to the new 10Hz payload delivery
            if (chData[i].waveBuffer.length > 100) chData[i].waveBuffer.shift();
        });
    }
}
