/**
 * js/visualizer.js
 */

let sCtxs = [], rCtxs = [];
const VISUAL_POINTS = 250; // The canvas always holds exactly 250 points

function initVisualizer() {
    const dash = document.getElementById('dashboard');
    
    let html = `
        <div style="grid-column: 1 / -1; display: flex; gap: 30px; background: #0a0d12; padding: 15px; border: 1px solid var(--border); border-radius: 4px; align-items: center; margin-bottom: 10px; flex-wrap: wrap;">
            <div style="color: var(--cyan); font-weight: bold; font-size: 1.1em; min-width: 120px;">DSP MATH</div>
            <div style="flex: 1; display: flex; flex-direction: column; min-width: 200px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.7em; color: #888; font-weight: bold; margin-bottom: 5px;">
                    <span>SPEED (DOWNSAMPLING)</span>
                    <span id="ui-val-xspeed" style="color: var(--text);">1:6 Rate</span>
                </div>
                <input type="range" id="ui-xspeed" min="1" max="60" value="6" style="width: 100%; cursor: pointer;">
            </div>
            <div style="flex: 1; display: flex; flex-direction: column; min-width: 200px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.7em; color: #888; font-weight: bold; margin-bottom: 5px;">
                    <span>SMOOTHING (LOW-PASS EMA)</span>
                    <span id="ui-val-ysmooth" style="color: var(--text);">0.15 α</span>
                </div>
                <input type="range" id="ui-ysmooth" min="0.01" max="1.0" step="0.01" value="0.15" style="width: 100%; cursor: pointer;">
            </div>
        </div>
    `;

    for(let i=0; i<4; i++) {
        html += `
        <div class="card">
            <div class="card-header">
                <span class="ch-title" style="color:hsl(${i*90}, 100%, 60%)">CHANNEL ${i+1}</span>
            </div>
            <canvas class="scope" id="scope-${i}"></canvas>
            <canvas class="roll" id="roll-${i}"></canvas>
        </div>`;
    }
    
    dash.innerHTML = html;

    document.getElementById('ui-xspeed').addEventListener('input', (e) => {
        document.getElementById('ui-val-xspeed').innerText = '1:' + e.target.value + ' Rate';
    });
    document.getElementById('ui-ysmooth').addEventListener('input', (e) => {
        document.getElementById('ui-val-ysmooth').innerText = e.target.value + ' α';
    });

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
        let color = '#39ff14';
        if (threshold > 0.7) color = '#ffff00';
        if (threshold > 0.9) color = '#ff0055';
        ctx.fillStyle = isOn ? color : '#111'; 
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

    let masterPeak = 0;
    for (let i = 0; i < 4; i++) {
        if (synthChannels[i]) {
            let peak = 0;
            if (synthChannels[i].analyser && synthChannels[i].vuData) {
                synthChannels[i].analyser.getFloatTimeDomainData(synthChannels[i].vuData);
                for (let j = 0; j < synthChannels[i].vuData.length; j++) {
                    let abs = Math.abs(synthChannels[i].vuData[j]);
                    if (abs > peak) peak = abs;
                }
            }
            synthChannels[i].vuLevel = synthChannels[i].vuLevel ? Math.max(peak, synthChannels[i].vuLevel - 0.04) : peak;
            masterPeak = Math.max(masterPeak, synthChannels[i].vuLevel);
            drawSegmentedVU(document.getElementById(`vu-${i}`), Math.min(1.0, synthChannels[i].vuLevel * 1.5), false);
        }
    }
    
    if (synthChannels[activeSynthIndex]) {
        const p = synthChannels[activeSynthIndex].params;
        const msPerBeat = 60000 / p.bpm;
        const currentBeatCount = Math.floor(nowMs / msPerBeat);
        if (currentBeatCount !== lastBeatCount) {
            lastBeatCount = currentBeatCount;
            const bpmLed = document.getElementById('ui-bpm-led');
            if(bpmLed) { bpmLed.classList.add('active'); setTimeout(() => bpmLed.classList.remove('active'), 50); }
        }

        const lfos = [ { key: 'pitchLfo', id: 'ind-lfo-pitchLfo' }, { key: 'filterLfo', id: 'ind-lfo-filterLfo' }, { key: 'ampLfo', id: 'ind-lfo-ampLfo' } ];
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
            if (ledEl) { ledEl.style.opacity = 0.1 + (bright * (config.depth > 0 ? 0.9 : 0.25)); }
        });
    }

    synthChannels.forEach(ch => {
        if(!ch.shState) ch.shState = { pitch: 0, filter: 0, amp: 0 };
        const p = ch.params;
        ['pitch', 'filter', 'amp'].forEach(dest => {
            const lfoParam = p[`${dest}Lfo`];
            if (lfoParam.shape === 'random' && nowMs - ch.shState[dest] > (1000 / lfoParam.rate)) {
                ch.shState[dest] = nowMs;
                const shVal = (Math.random() * 2) - 1; 
                if (dest === 'pitch') { ch.voices.forEach(v => { if(v.sources.osc1.detuneNode) v.sources.osc1.detuneNode.setTargetAtTime(shVal * lfoParam.depth * 200, nowAudio, 0.02); if(v.sources.sub.detuneNode) v.sources.sub.detuneNode.setTargetAtTime(shVal * lfoParam.depth * 200, nowAudio, 0.02); }); } 
                else if (dest === 'filter') { ch.voices.forEach(v => v.vcf.detune.setTargetAtTime(shVal * lfoParam.depth * 2000, nowAudio, 0.02)); } 
                else if (dest === 'amp') { if(ch.ampLfoNode) ch.ampLfoNode.gain.setTargetAtTime(1.0 + (shVal * lfoParam.depth), nowAudio, 0.02); }
            }
        });
    });
    
    for(let i=0; i<4; i++) {
        if(!sCtxs[i]) continue;
        let ch = chData[i];
        
        if (ch.renderQueue && ch.renderQueue.length > 0) {
            if (typeof ch.drainAcc === 'undefined') { ch.drainAcc = 0; ch.drainVel = 1; ch.lastQ = 0; }
            if (ch.renderQueue.length > ch.lastQ + 2) ch.drainVel = ch.renderQueue.length / 5.5; 
            ch.lastQ = ch.renderQueue.length;
            
            ch.drainAcc += ch.drainVel;
            let drainThisFrame = Math.min(Math.floor(ch.drainAcc), ch.renderQueue.length);
            ch.drainAcc -= drainThisFrame;
            for (let k = 0; k < drainThisFrame; k++) ch.waveBuffer.push(ch.renderQueue.shift());
        }
        
        // The array is always trimmed to the constant visual width
        while (ch.waveBuffer.length > VISUAL_POINTS) ch.waveBuffer.shift();

        let sCtx = sCtxs[i], rCtx = rCtxs[i], sw = sCtx.canvas.width, sh = sCtx.canvas.height, rw = rCtx.canvas.width, rh = rCtx.canvas.height;
        sCtx.fillStyle = '#000'; sCtx.fillRect(0, 0, sw, sh);
        let buf = ch.waveBuffer;
        
        if(buf.length > 1) {
            // LAYER 3: BACKGROUND HISTORY
            if (ch.history && ch.history.length > 1) {
                let hMin = 1000000, hMax = 0;
                ch.history.forEach(h => { if (h.min < hMin) hMin = h.min; if (h.max > hMax) hMax = h.max; });
                let hRange = hMax - hMin || 1;
                let getHistY = (val) => sh - ((val - hMin) / hRange * sh);
                
                sCtx.fillStyle = 'rgba(255, 255, 255, 0.04)'; 
                sCtx.beginPath();
                for(let j=0; j<ch.history.length; j++) {
                    let x = sw - ((ch.history.length - 1 - j) * (sw / 300));
                    if (j === 0) sCtx.moveTo(x, getHistY(ch.history[j].max)); else sCtx.lineTo(x, getHistY(ch.history[j].max));
                }
                for(let j=ch.history.length-1; j>=0; j--) {
                    let x = sw - ((ch.history.length - 1 - j) * (sw / 300));
                    sCtx.lineTo(x, getHistY(ch.history[j].min));
                }
                sCtx.fill();
            }

            sCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            sCtx.lineWidth = 1;
            sCtx.beginPath();
            for(let g=1; g<4; g++) { sCtx.moveTo(0, sh * (g/4)); sCtx.lineTo(sw, sh * (g/4)); }
            for(let g=1; g<10; g++) { sCtx.moveTo(sw * (g/10), 0); sCtx.lineTo(sw * (g/10), sh); }
            sCtx.stroke();

            // LAYER 2: MAIN TRACE (Auto-scales perfectly every frame)
            let min = 1000000, max = 0;
            for(let j=0; j<buf.length; j++) {
                if (buf[j].s < min) min = buf[j].s;
                if (buf[j].s > max) max = buf[j].s;
            }
            let range = max - min || 1;
            let paddedMin = min - (range * 0.1);
            let paddedRange = range * 1.2;
            let getPathY = (val) => sh - ((val - paddedMin) / paddedRange * sh);

            sCtx.strokeStyle = '#39ff14'; 
            sCtx.lineWidth = 2; 
            sCtx.beginPath();
            for(let j=0; j<buf.length; j++) {
                let x = j * (sw / (VISUAL_POINTS - 1));
                let y = getPathY(buf[j].s);
                
                if(buf[j].evt === 1 && buf[j].n) {
                    sCtx.save();
                    sCtx.strokeStyle = `hsla(${(buf[j].n % 12) * 30}, 100%, 50%, 0.7)`;
                    sCtx.lineWidth = 1; sCtx.beginPath(); sCtx.moveTo(x, 0); sCtx.lineTo(x, sh); sCtx.stroke();
                    sCtx.restore(); sCtx.beginPath(); sCtx.moveTo(x, y);
                } else {
                    if (j === 0) sCtx.moveTo(x, y); else sCtx.lineTo(x, y);
                }
            }
            sCtx.stroke();

            // LAYER 1: MICRO RAW INSET BOX
            let insetW = sw * 0.35; 
            let insetH = sh * 0.35; 
            let insetX = sw - insetW - 10;
            let insetY = sh - insetH - 10;

            sCtx.fillStyle = 'rgba(10, 13, 18, 0.9)';
            sCtx.strokeStyle = '#30363d';
            sCtx.lineWidth = 1;
            sCtx.fillRect(insetX, insetY, insetW, insetH);
            sCtx.strokeRect(insetX, insetY, insetW, insetH);

            let microLen = Math.min(buf.length, 100);
            let microBuf = buf.slice(-microLen);
            
            let mMin = 1000000, mMax = 0;
            for(let j=0; j<microBuf.length; j++) {
                if (microBuf[j].r < mMin) mMin = microBuf[j].r;
                if (microBuf[j].r > mMax) mMax = microBuf[j].r;
            }
            let mRange = mMax - mMin || 1;
            
            sCtx.strokeStyle = 'rgba(57, 255, 20, 0.6)';
            sCtx.beginPath();
            for(let j=0; j<microBuf.length; j++) {
                let mx = insetX + (j * (insetW / (microBuf.length - 1)));
                let my = insetY + insetH - ((microBuf[j].r - mMin) / mRange * insetH);
                if (j===0) sCtx.moveTo(mx, my); else sCtx.lineTo(mx, my);
            }
            sCtx.stroke();
            
            sCtx.fillStyle = '#888';
            sCtx.font = '9px monospace';
            sCtx.textAlign = 'left';
            sCtx.fillText('MICRO (RAW)', insetX + 4, insetY + 12);

            // ANALYTICAL HUD
            let curVal = buf[buf.length-1].s || 0;
            sCtx.font = '10px monospace';
            sCtx.fillStyle = '#888';
            sCtx.fillText('SMOOTH ADMITTANCE', 10, 16);
            sCtx.font = 'bold 16px monospace';
            sCtx.fillStyle = '#39ff14';
            sCtx.fillText(`${curVal.toFixed(1)} µS`, 10, 32);
            
            let slewScale = (ch.slew || 0) * 100;
            let tColor = slewScale > 0.5 ? '#39ff14' : (slewScale < -0.5 ? '#ff0055' : '#888');
            let tIcon = slewScale > 0.5 ? '▲' : (slewScale < -0.5 ? '▼' : '—');
            
            sCtx.font = '10px monospace';
            sCtx.fillStyle = '#888';
            sCtx.fillText('SLEW / TREND', 150, 16);
            sCtx.font = 'bold 16px monospace';
            sCtx.fillStyle = tColor;
            sCtx.fillText(`${tIcon} ${Math.abs(slewScale).toFixed(2)}`, 150, 32);

            if (ch.history && ch.history.length > 0) {
                let hMin = 1000000, hMax = 0;
                ch.history.forEach(h => { if (h.min < hMin) hMin = h.min; if (h.max > hMax) hMax = h.max; });
                sCtx.font = '10px monospace';
                sCtx.fillStyle = '#888';
                sCtx.fillText(`5-MIN RANGE: ${hMin.toFixed(1)} µS - ${hMax.toFixed(1)} µS`, 10, sh - 10);
            }

            sCtx.textAlign = 'right';
            if (ch.peakFlag > 0) {
                sCtx.font = 'bold 14px monospace';
                sCtx.fillStyle = '#ffff00';
                sCtx.fillText(`[ PEAK ]`, sw - 10, 24);
                ch.peakFlag--;
            } else if (ch.troughFlag > 0) {
                sCtx.font = 'bold 14px monospace';
                sCtx.fillStyle = '#00f0ff';
                sCtx.fillText(`[ TROUGH ]`, sw - 10, 24);
                ch.troughFlag--;
            }
        }
        
        // 5-MIN ROLL RENDER
        rCtx.fillStyle = '#000'; rCtx.fillRect(0, 0, rw, rh);
        rCtx.strokeStyle = '#30363d'; rCtx.lineWidth = 1;
        for(let j=0; j<12; j++) { rCtx.beginPath(); rCtx.moveTo(0, j*(rh/12)); rCtx.lineTo(rw, j*(rh/12)); rCtx.stroke(); }
        
        if (ch.history && ch.history.length > 1) {
            let hMin = 1000000, hMax = 0;
            ch.history.forEach(h => { if (h.min < hMin) hMin = h.min; if (h.max > hMax) hMax = h.max; });
            let hRange = hMax - hMin || 1;
            let pMin = hMin - (hRange * 0.1);
            let pRange = hRange * 1.2;
            let getY = (val) => rh - ((val - pMin) / pRange * rh);
            
            rCtx.fillStyle = 'rgba(57, 255, 20, 0.1)';
            rCtx.beginPath();
            for(let j=0; j<ch.history.length; j++) {
                let x = rw - ((ch.history.length - 1 - j) * (rw / 300));
                if (j === 0) rCtx.moveTo(x, getY(ch.history[j].max)); else rCtx.lineTo(x, getY(ch.history[j].max));
            }
            for(let j=ch.history.length-1; j>=0; j--) {
                let x = rw - ((ch.history.length - 1 - j) * (rw / 300));
                rCtx.lineTo(x, getY(ch.history[j].min));
            }
            rCtx.fill();
            
            rCtx.strokeStyle = 'rgba(57, 255, 20, 0.5)';
            rCtx.lineWidth = 1.5;
            rCtx.beginPath();
            for(let j=0; j<ch.history.length; j++) {
                let x = rw - ((ch.history.length - 1 - j) * (rw / 300));
                if (j === 0) rCtx.moveTo(x, getY(ch.history[j].avg)); else rCtx.lineTo(x, getY(ch.history[j].avg));
            }
            rCtx.stroke();
        }
        
        ch.notes = ch.notes.filter(n => Date.now() - n.t < 4000);
        ch.notes.forEach(note => {
            rCtx.fillStyle = `hsla(${(note.n % 12) * 30}, 100%, 50%, ${Math.max(0.3, note.v / 127)})`; 
            rCtx.fillRect(rw - ((Date.now() - note.t) / 4000 * rw) - ((note.dur / 4000) * rw), Math.max(0, rh - ((note.n / 127) * rh) - 4), ((note.dur / 4000) * rw), 8); 
        });
    }
    
    requestAnimationFrame(renderLoop);
}
