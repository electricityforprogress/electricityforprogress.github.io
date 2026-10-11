/**
 * js/visualizer.js
 */

let sCtxs = [], rCtxs = [];
const VISUAL_POINTS = 250; 
const CH_COLORS = ['#ff3333', '#39ff14', '#33ccff', '#b84dff']; // Red, Green, Blue, Purple

function initVisualizer() {
    const dash = document.getElementById('dashboard');
    // Enforce 2x2 grid via flexbox logic in the container
    dash.style.display = 'grid';
    dash.style.gridTemplateColumns = 'repeat(auto-fit, minmax(45%, 1fr))';
    dash.style.gap = '15px';
    
    let html = `
        <div style="grid-column: 1 / -1; display: flex; gap: 30px; background: #0a0d12; padding: 15px; border: 1px solid var(--border); border-radius: 4px; align-items: center; margin-bottom: 10px; flex-wrap: wrap;">
            <div style="color: var(--cyan); font-weight: bold; font-size: 1.1em; min-width: 120px;">DSP MATH</div>
            <div style="flex: 1; display: flex; flex-direction: column; min-width: 200px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.7em; color: #888; font-weight: bold; margin-bottom: 5px;">
                    <span>SPEED (DOWNSAMPLING)</span>
                    <span id="ui-val-xspeed" style="color: var(--text);">1:2 Rate</span>
                </div>
                <input type="range" id="ui-xspeed" min="1" max="60" value="2" style="width: 100%; cursor: pointer;">
            </div>
            <div style="flex: 1; display: flex; flex-direction: column; min-width: 200px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.7em; color: #888; font-weight: bold; margin-bottom: 5px;">
                    <span>SMOOTHING (LOW-PASS EMA)</span>
                    <span id="ui-val-ysmooth" style="color: var(--text);">0.05 α</span>
                </div>
                <input type="range" id="ui-ysmooth" min="0.01" max="1.0" step="0.01" value="0.05" style="width: 100%; cursor: pointer;">
            </div>
        </div>
    `;

    for(let i=0; i<4; i++) {
        html += `
        <div class="card" style="display: flex; flex-direction: column; background: #0d1117; padding: 15px;">
            <div class="card-header" style="color: ${CH_COLORS[i]}; font-size: 1.2em; border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 10px;">
                CHANNEL ${i+1}
            </div>
            
            <!-- Top: Main Scope -->
            <canvas class="scope" id="scope-${i}" style="width: 100%; height: 180px; background: #000; border: 1px solid var(--border); border-radius: 4px; margin-bottom: 15px;"></canvas>
            
            <!-- Bottom: Split Roll & HUD -->
            <div style="display: flex; gap: 15px; height: 130px;">
                <!-- Left: Square Piano Roll / History -->
                <canvas class="roll" id="roll-${i}" style="flex: 1; max-width: 50%; height: 100%; background: #000; border: 1px solid var(--border); border-radius: 4px;"></canvas>
                
                <!-- Right: HTML Text HUD -->
                <div id="hud-${i}" style="flex: 1; display: flex; flex-direction: column; justify-content: space-between; background: #0a0d12; padding: 10px; border: 1px solid var(--border); border-radius: 4px; font-family: monospace;">
                    <!-- HUD injected via JS -->
                </div>
            </div>
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

function renderLoop() {
    const nowMs = performance.now();
    const nowAudio = audioCtx.currentTime;

    if (synthChannels[activeSynthIndex]) {
        const p = synthChannels[activeSynthIndex].params;
        const msPerBeat = 60000 / p.bpm;
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
        
        // --- PERFECT CONTINUOUS DRIP FEED ---
        // Smears the 100ms BLE chunks perfectly evenly over the visual frames
        if (ch.renderQueue && ch.renderQueue.length > 0) {
            if (ch.dripFloat === undefined) ch.dripFloat = 0;
            ch.dripFloat += (ch.renderQueue.length / 6); // 100ms = ~6 frames at 60fps
            
            let drainThisFrame = Math.floor(ch.dripFloat);
            if (drainThisFrame > ch.renderQueue.length) drainThisFrame = ch.renderQueue.length;
            
            ch.dripFloat -= drainThisFrame;
            for (let k = 0; k < drainThisFrame; k++) ch.waveBuffer.push(ch.renderQueue.shift());
        }
        
        while (ch.waveBuffer.length > VISUAL_POINTS) ch.waveBuffer.shift();

        let sCtx = sCtxs[i], rCtx = rCtxs[i], sw = sCtx.canvas.width, sh = sCtx.canvas.height, rw = rCtx.canvas.width, rh = rCtx.canvas.height;
        sCtx.fillStyle = '#000'; sCtx.fillRect(0, 0, sw, sh);
        let buf = ch.waveBuffer;
        
        if(buf.length > 1) {
            // GRID LINES
            sCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            sCtx.lineWidth = 1;
            sCtx.beginPath();
            for(let g=1; g<4; g++) { sCtx.moveTo(0, sh * (g/4)); sCtx.lineTo(sw, sh * (g/4)); }
            for(let g=1; g<10; g++) { sCtx.moveTo(sw * (g/10), 0); sCtx.lineTo(sw * (g/10), sh); }
            sCtx.stroke();

            // MAIN CLEAN TRACE 
            let min = 1000000, max = 0;
            for(let j=0; j<buf.length; j++) {
                if (buf[j].s < min) min = buf[j].s;
                if (buf[j].s > max) max = buf[j].s;
            }
            let range = max - min || 1;
            let paddedMin = min - (range * 0.1);
            let paddedRange = range * 1.2;
            let getPathY = (val) => sh - ((val - paddedMin) / paddedRange * sh);

            // Colored based on channel mapping
            sCtx.strokeStyle = CH_COLORS[i]; 
            sCtx.lineWidth = 2; 
            sCtx.beginPath();
            for(let j=0; j<buf.length; j++) {
                let x = j * (sw / (VISUAL_POINTS - 1));
                let y = getPathY(buf[j].s);
                
                // Draw Event Spikes behind main line
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

            // --- HTML DOM HUD INJECTION ---
            let hud = document.getElementById(`hud-${i}`);
            let curVal = buf[buf.length-1].s || 0;
            let slw = (ch.slew || 0) * 100;
            let tCol = slw > 0.1 ? CH_COLORS[i] : (slw < -0.1 ? '#ff0055' : '#888');
            let tIcon = slw > 0.1 ? '▲' : (slw < -0.1 ? '▼' : '—');
            
            let hMin = 0, hMax = 0;
            if (ch.history && ch.history.length > 0) {
                hMin = 1000000;
                ch.history.forEach(h => { if(h.min<hMin) hMin=h.min; if(h.max>hMax) hMax=h.max; });
            }
            
            let pFlag = ch.peakFlag > 0 ? `<span style="color:#ffff00;">PEAK</span>` : ``;
            let tFlag = ch.troughFlag > 0 ? `<span style="color:#00f0ff;">TROUGH</span>` : ``;
            if(ch.peakFlag > 0) ch.peakFlag--;
            if(ch.troughFlag > 0) ch.troughFlag--;

            hud.innerHTML = `
                <div style="font-size: 10px; color: #888; display:flex; justify-content:space-between;">
                    <span>ADMITTANCE</span> <b>${pFlag} ${tFlag}</b>
                </div>
                <div style="font-size: 22px; font-weight: bold; color: ${CH_COLORS[i]};">${curVal.toFixed(1)} µS</div>
                
                <div style="font-size: 10px; color: #888; margin-top: 5px;">SLEW / TREND</div>
                <div style="font-size: 16px; font-weight: bold; color: ${tCol};">${tIcon} ${Math.abs(slw).toFixed(2)}</div>
                
                <div style="font-size: 10px; color: #888; margin-top: 5px;">5-MIN RANGE</div>
                <div style="font-size: 12px; color: #ccc;">${hMin.toFixed(1)} - ${hMax.toFixed(1)}</div>
            `;
        }
        
        // --- 5-MIN ROLL / PIANO ROLL (Now a Square) ---
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
            
            // Channel Colored Envelope
            rCtx.fillStyle = CH_COLORS[i] + '1A'; // Adds 10% opacity hex to the channel color
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
            
            rCtx.strokeStyle = CH_COLORS[i] + '80'; // 50% opacity line
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
