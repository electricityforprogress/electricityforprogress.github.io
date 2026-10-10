/**
 * js/visualizer.js
 */

let sCtxs = [], rCtxs = [];

function initVisualizer() {
    const dash = document.getElementById('dashboard');
    for(let i=0; i<4; i++) {
        dash.innerHTML += `
        <div class="card">
            <div class="card-header">
                <span class="ch-title" style="color:hsl(${i*90}, 100%, 60%)">CHANNEL ${i+1}</span>
            </div>
            <canvas class="scope" id="scope-${i}"></canvas>
            <canvas class="roll" id="roll-${i}"></canvas>
        </div>`;
    }

    sCtxs = [0,1,2,3].map(i => document.getElementById(`scope-${i}`).getContext('2d'));
    rCtxs = [0,1,2,3].map(i => document.getElementById(`roll-${i}`).getContext('2d'));
    
    window.addEventListener('resize', resize); 
    resize();
}

function drawSegmentedVU(canvas, level, isHorizontal = false) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const numSegments = isHorizontal ? 20 : 15;
    const gap = 1;
    
    for (let i = 0; i < numSegments; i++) {
        const threshold = (i + 1) / numSegments;
        const isOn = level >= (i / numSegments);
        
        let color = '#39ff14'; // Green
        if (threshold > 0.7) color = '#ffff00'; // Yellow
        if (threshold > 0.9) color = '#ff0055'; // Red
        
        ctx.fillStyle = isOn ? color : '#111'; // #111 is unlit background LED
        
        if (isHorizontal) {
            let w = (canvas.width / numSegments) - gap;
            ctx.fillRect(i * (w + gap), 0, w, canvas.height);
        } else {
            let h = (canvas.height / numSegments) - gap;
            let y = canvas.height - ((i + 1) * (h + gap));
            ctx.fillRect(0, y, canvas.width, h);
        }
    }
}

function resize() { 
    for(let i=0; i<4; i++) { 
        if(sCtxs[i] && rCtxs[i]) {
            sCtxs[i].canvas.width = sCtxs[i].canvas.clientWidth; 
            sCtxs[i].canvas.height = sCtxs[i].canvas.clientHeight; 
            rCtxs[i].canvas.width = rCtxs[i].canvas.clientWidth; 
            rCtxs[i].canvas.height = rCtxs[i].canvas.clientHeight; 
        }
    } 
}

let lastBeatCount = 0;

function renderLoop() {
    const nowMs = performance.now();
    const nowAudio = audioCtx.currentTime;

    // Update Channel VUs & calculate Master Peak
    let masterPeak = 0;
    for (let i = 0; i < 4; i++) {
        if (synthChannels[i]) {
            synthChannels[i].analyser.getFloatTimeDomainData(synthChannels[i].vuData);
            let peak = 0;
            for (let j = 0; j < synthChannels[i].vuData.length; j++) {
                let abs = Math.abs(synthChannels[i].vuData[j]);
                if (abs > peak) peak = abs;
            }
            
            synthChannels[i].vuLevel = synthChannels[i].vuLevel ? Math.max(peak, synthChannels[i].vuLevel - 0.04) : peak;
            masterPeak = Math.max(masterPeak, synthChannels[i].vuLevel);
            
            drawSegmentedVU(document.getElementById(`vu-${i}`), Math.min(1.0, synthChannels[i].vuLevel * 1.5), false);
        }
    }
    
    if (synthChannels[activeSynthIndex]) {
        const p = synthChannels[activeSynthIndex].params;
        
        // BPM Flasher
        const msPerBeat = 60000 / p.bpm;
        const currentBeatCount = Math.floor(nowMs / msPerBeat);
        if (currentBeatCount !== lastBeatCount) {
            lastBeatCount = currentBeatCount;
            const bpmLed = document.getElementById('ui-bpm-led');
            if(bpmLed) {
                bpmLed.classList.add('active');
                setTimeout(() => bpmLed.classList.remove('active'), 50);
            }
        }

        // Free-Running Multi-LFO LED Feedback
        const lfos = [
            { key: 'pitchLfo', id: 'ind-lfo-pitchLfo' },
            { key: 'filterLfo', id: 'ind-lfo-filterLfo' },
            { key: 'ampLfo', id: 'ind-lfo-ampLfo' }
        ];

        lfos.forEach(lfo => {
            const config = p[lfo.key];
            let phase = (nowAudio * config.rate) % 1.0;
            let bright = 0;
            
            if (config.shape === 'sine') bright = (Math.sin(phase * Math.PI * 2) + 1) / 2;
            else if (config.shape === 'square') bright = phase < 0.5 ? 1 : 0;
            else if (config.shape === 'triangle') bright = phase < 0.5 ? phase * 2 : 2 - (phase * 2);
            else if (config.shape === 'sawtooth') bright = phase;
            else if (config.shape === 'rampdown') bright = 1 - phase;
            else if (config.shape === 'random') bright = Math.random(); 

            const ledEl = document.getElementById(lfo.id);
            if (ledEl) {
                const intensity = config.depth > 0 ? 0.9 : 0.25; 
                ledEl.style.opacity = 0.1 + (bright * intensity);
            }
        });
    }

    // Modular S&H LFO Processing
    synthChannels.forEach(ch => {
        if(!ch.shState) ch.shState = { pitch: 0, filter: 0, amp: 0 };
        const p = ch.params;
        
        ['pitch', 'filter', 'amp'].forEach(dest => {
            const lfoParam = p[`${dest}Lfo`];
            if (lfoParam.shape === 'random') {
                if (nowMs - ch.shState[dest] > (1000 / lfoParam.rate)) {
                    ch.shState[dest] = nowMs;
                    const shVal = (Math.random() * 2) - 1; 
                    
                    if (dest === 'pitch') { 
                        ch.voices.forEach(v => { 
                            v.sources.osc1.detuneNode.setTargetAtTime(shVal * lfoParam.depth * 200, nowAudio, 0.02); 
                            v.sources.sub.detuneNode.setTargetAtTime(shVal * lfoParam.depth * 200, nowAudio, 0.02); 
                        }); 
                    } 
                    else if (dest === 'filter') { ch.voices.forEach(v => v.vcf.detune.setTargetAtTime(shVal * lfoParam.depth * 2000, nowAudio, 0.02)); } 
                    else if (dest === 'amp') { ch.ampLfoNode.gain.setTargetAtTime(1.0 + (shVal * lfoParam.depth), nowAudio, 0.02); }
                }
            }
        });
    });
    
    // Data Visualization Scopes (High-Efficiency Rendering)
    for(let i=0; i<4; i++) {
        if(!sCtxs[i]) continue;
        let sCtx = sCtxs[i], rCtx = rCtxs[i], sw = sCtx.canvas.width, sh = sCtx.canvas.height, rw = rCtx.canvas.width, rh = rCtx.canvas.height;
        sCtx.fillStyle = '#000'; sCtx.fillRect(0, 0, sw, sh);
        let buf = chData[i].waveBuffer;
        
        if(buf.length > 1) {
            // Optimized Min/Max loop prevents memory garbage collection spikes
            let min = 1000000, max = 0;
            for(let j=0; j<buf.length; j++) {
                if (buf[j].g < min) min = buf[j].g;
                if (buf[j].g > max) max = buf[j].g;
            }
            let range = max - min || 1;
            
            sCtx.strokeStyle = '#39ff14'; 
            sCtx.lineWidth = 2; 
            sCtx.beginPath();
            
            for(let j=0; j<buf.length; j++) {
                let x = j * (sw / (buf.length - 1));
                let y = sh - ((buf[j].g - min) / range * (sh * 0.8)) - (sh * 0.1);
                
                // Draw event trigger spikes behind the waveform
                if(buf[j].evt === 1 && buf[j].n) {
                    sCtx.save();
                    sCtx.strokeStyle = `hsla(${(buf[j].n % 12) * 30}, 100%, 50%, 0.7)`;
                    sCtx.lineWidth = 1;
                    sCtx.beginPath();
                    sCtx.moveTo(x, 0);
                    sCtx.lineTo(x, sh);
                    sCtx.stroke();
                    sCtx.restore();
                    sCtx.beginPath(); // Resume main wave path
                    sCtx.moveTo(x, y);
                } else {
                    if (j === 0) sCtx.moveTo(x, y);
                    else sCtx.lineTo(x, y);
                }
            }
            sCtx.stroke();
        }
        
        rCtx.fillStyle = '#000'; rCtx.fillRect(0, 0, rw, rh);
        rCtx.strokeStyle = '#30363d'; rCtx.lineWidth = 1;
        for(let j=0; j<12; j++) { rCtx.beginPath(); rCtx.moveTo(0, j*(rh/12)); rCtx.lineTo(rw, j*(rh/12)); rCtx.stroke(); }
        
        chData[i].notes = chData[i].notes.filter(n => Date.now() - n.t < 4000);
        chData[i].notes.forEach(note => {
            rCtx.fillStyle = `hsla(${(note.n % 12) * 30}, 100%, 50%, ${Math.max(0.3, note.v / 127)})`; 
            rCtx.fillRect(rw - ((Date.now() - note.t) / 4000 * rw) - ((note.dur / 4000) * rw), Math.max(0, rh - ((note.n / 127) * rh) - 4), ((note.dur / 4000) * rw), 8); 
        });
    }
    
    requestAnimationFrame(renderLoop);
}
