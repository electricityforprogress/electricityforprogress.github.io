/**
 * js/visualizer.js
 */

const SYNTH_UI_SELECTOR = '#synth-inspector'; 
const CH_COLORS = ['#ff3333', '#39ff14', '#33ccff', '#b84dff']; 

let sCtxs = [], rCtxs = [];

function initVisualizer() {
    const dash = document.getElementById('dashboard');
    
    if (!document.getElementById('biodata-grid-styles')) {
        const style = document.createElement('style');
        style.id = 'biodata-grid-styles';
        style.innerHTML = `
            #biodata-visualizer-workspace {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 15px;
                width: 100%;
            }
            .canvas-wrapper {
                position: relative;
                width: 100%;
                background: #000;
                border: 1px solid var(--border);
                border-radius: 4px;
                overflow: hidden;
            }
            .canvas-wrapper canvas {
                position: absolute;
                top: 0; left: 0; width: 100%; height: 100%;
            }
        `;
        document.head.appendChild(style);
    }
    
    const visWorkspace = document.createElement('div');
    visWorkspace.id = 'biodata-visualizer-workspace';
    
    let html = ``;

    for(let i=0; i<4; i++) {
        if(!chData[i]) chData[i] = { waveBuffer: [], renderQueue: [], notes: [], acc: {}, history: [] };
        chData[i].config = { zoom: 500, smooth: 0.05, freeze: false };
        
        // Deep Zoom Slider (Max 5000)
        html += `
        <div class="card" style="display: flex; flex-direction: column; background: #0d1117; padding: 15px; border: 1px solid var(--border); border-radius: 4px; min-width: 0;">
            
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 10px; gap: 10px;">
                <span style="color: ${CH_COLORS[i]}; font-size: 1.1em; font-weight: bold;">CH ${i+1}</span>
                
                <div style="display: flex; gap: 10px; align-items: center; font-size: 10px; color: #888; flex-wrap: nowrap;">
                    <label style="display: flex; align-items: center; gap: 3px;" title="Zoom (Timebase)">
                        Z <input type="range" id="ch-zoom-${i}" min="50" max="5000" value="500" style="width: 45px; min-width: 45px; cursor: pointer; margin: 0; padding: 0;">
                    </label>
                    <label style="display: flex; align-items: center; gap: 3px;" title="Smooth (EMA)">
                        S <input type="range" id="ch-smooth-${i}" min="0.01" max="1.0" step="0.01" value="0.05" style="width: 45px; min-width: 45px; cursor: pointer; margin: 0; padding: 0;">
                    </label>
                    <button id="ch-freeze-${i}" style="background: transparent; color: #888; border: 1px solid #444; padding: 2px 6px; border-radius: 3px; cursor: pointer; font-size: 9px; font-weight: bold;">
                        FRZ
                    </button>
                </div>
            </div>
            
            <div class="canvas-wrapper" style="height: 180px; margin-bottom: 15px;">
                <canvas class="scope" id="scope-${i}"></canvas>
            </div>
            
            <div style="display: flex; gap: 15px; height: 130px; min-width: 0;">
                <div class="canvas-wrapper" style="flex: 1; max-width: 50%; height: 100%;">
                    <canvas class="roll" id="roll-${i}"></canvas>
                </div>
                <div id="hud-${i}" style="flex: 1; display: flex; flex-direction: column; justify-content: space-between; background: #0a0d12; padding: 10px; border: 1px solid var(--border); border-radius: 4px; font-family: monospace; min-width: 0; overflow: hidden;"></div>
            </div>
        </div>`;
    }
    
    visWorkspace.innerHTML = html;
    dash.appendChild(visWorkspace);

    for(let i=0; i<4; i++) {
        document.getElementById(`ch-zoom-${i}`).addEventListener('input', (e) => chData[i].config.zoom = parseInt(e.target.value));
        document.getElementById(`ch-smooth-${i}`).addEventListener('input', (e) => chData[i].config.smooth = parseFloat(e.target.value));
        document.getElementById(`ch-freeze-${i}`).addEventListener('click', (e) => {
            chData[i].config.freeze = !chData[i].config.freeze;
            e.target.style.background = chData[i].config.freeze ? '#ff3333' : 'transparent';
            e.target.style.color = chData[i].config.freeze ? '#fff' : '#888';
            e.target.style.borderColor = chData[i].config.freeze ? '#ff3333' : '#444';
        });
    }

    sCtxs = [0,1,2,3].map(i => document.getElementById(`scope-${i}`).getContext('2d'));
    rCtxs = [0,1,2,3].map(i => document.getElementById(`roll-${i}`).getContext('2d'));
    
    window.addEventListener('resize', resize); 
    resize();
}

function resize() { 
    for(let i=0; i<4; i++) { 
        if(sCtxs[i] && rCtxs[i]) {
            let sWrap = sCtxs[i].canvas.parentElement;
            sCtxs[i].canvas.width = sWrap.clientWidth; 
            sCtxs[i].canvas.height = sWrap.clientHeight; 
            
            let rWrap = rCtxs[i].canvas.parentElement;
            rCtxs[i].canvas.width = rWrap.clientWidth; 
            rCtxs[i].canvas.height = rWrap.clientHeight; 
        }
    } 
}

function renderLoop() {
    const nowMs = performance.now();
    const nowAudio = audioCtx.currentTime;

    if (synthChannels[activeSynthIndex]) {
        const p = synthChannels[activeSynthIndex].params;
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
        if(!ch.config) ch.config = { zoom: 500, smooth: 0.05, freeze: false };
        
        // 1. DATA INGESTION & DEEP CACHE
        if (ch.config.freeze) {
            // When frozen, discard new incoming data to prevent queue blowout
            ch.renderQueue = []; 
            ch.lastFrameTime = nowMs;
        } else {
            if (ch.renderQueue && ch.renderQueue.length > 0) {
                let deltaMs = nowMs - (ch.lastFrameTime || nowMs);
                ch.lastFrameTime = nowMs;
                if (deltaMs > 100) deltaMs = 100; 

                ch.timeAcc = (ch.timeAcc || 0) + deltaMs;

                while (ch.renderQueue.length > 0) {
                    let nextSample = ch.renderQueue[0];
                    let sampleMs = nextSample.ticks / 240000; 

                    if (ch.timeAcc >= sampleMs) {
                        ch.timeAcc -= sampleMs;
                        ch.waveBuffer.push(ch.renderQueue.shift());
                    } else {
                        break; 
                    }
                }
                if (ch.renderQueue.length > 500) ch.renderQueue = ch.renderQueue.slice(-100);
            } else {
                ch.lastFrameTime = nowMs;
            }

            // Always store a deep cache of 5,000 points regardless of zoom slider
            while (ch.waveBuffer.length > 5000) ch.waveBuffer.shift();
        }

        let sCtx = sCtxs[i], rCtx = rCtxs[i], sw = sCtx.canvas.width, sh = sCtx.canvas.height, rw = rCtx.canvas.width, rh = rCtx.canvas.height;
        sCtx.clearRect(0, 0, sw, sh);
        
        // 2. SLICE BY ZOOM & COMPUTE INSTANT SMOOTHING
        // Pull exactly the number of points requested by the Zoom slider from the end of the deep cache
        let displayCount = Math.min(ch.config.zoom, ch.waveBuffer.length);
        let displayBuf = ch.waveBuffer.slice(-displayCount);
        
        if(displayBuf.length > 1) {
            // Compute real-time EMA array based on the Smooth slider
            let smoothAlpha = ch.config.smooth;
            let visualS = new Float32Array(displayBuf.length);
            let currentEma = displayBuf[0].r;
            
            let min = 1000000, max = 0;
            for (let j = 0; j < displayBuf.length; j++) {
                currentEma = (displayBuf[j].r * smoothAlpha) + (currentEma * (1 - smoothAlpha));
                visualS[j] = currentEma;
                if (currentEma < min) min = currentEma;
                if (currentEma > max) max = currentEma;
            }

            // Draw Grid
            sCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            sCtx.lineWidth = 1;
            sCtx.beginPath();
            for(let g=1; g<4; g++) { sCtx.moveTo(0, sh * (g/4)); sCtx.lineTo(sw, sh * (g/4)); }
            for(let g=1; g<10; g++) { sCtx.moveTo(sw * (g/10), 0); sCtx.lineTo(sw * (g/10), sh); }
            sCtx.stroke();

            // Draw Smoothed Line
            let range = max - min || 1;
            let paddedMin = min - (range * 0.1);
            let paddedRange = range * 1.2;
            let getPathY = (val) => sh - ((val - paddedMin) / paddedRange * sh);

            sCtx.strokeStyle = CH_COLORS[i]; 
            sCtx.lineWidth = 2; 
            sCtx.beginPath();
            for(let j=0; j<displayBuf.length; j++) {
                let x = j * (sw / (displayCount - 1));
                let y = getPathY(visualS[j]);
                
                // Overlay MIDI Event Flags at correct X positions
                if(displayBuf[j].evt === 1 && displayBuf[j].n) {
                    sCtx.save();
                    sCtx.strokeStyle = `hsla(${(displayBuf[j].n % 12) * 30}, 100%, 50%, 0.7)`;
                    sCtx.lineWidth = 1; sCtx.beginPath(); sCtx.moveTo(x, 0); sCtx.lineTo(x, sh); sCtx.stroke();
                    sCtx.restore(); sCtx.beginPath(); sCtx.moveTo(x, y);
                } else {
                    if (j === 0) sCtx.moveTo(x, y); else sCtx.lineTo(x, y);
                }
            }
            sCtx.stroke();

            // 3. UPDATE HUD
            let hud = document.getElementById(`hud-${i}`);
            let curVal = visualS[visualS.length-1] || 0; // Read from the instantly smoothed array
            let curTicks = displayBuf[displayBuf.length-1].ticks || 0;
            let kOhm = curVal > 0 ? (1000 / curVal) : 0;
            
            let slw = (ch.slew || 0) * 100;
            let tCol = slw > 0.1 ? CH_COLORS[i] : (slw < -0.1 ? '#ff0055' : '#888');
            let tIcon = slw > 0.1 ? '▲' : (slw < -0.1 ? '▼' : '—');
            
            let pFlag = ch.peakFlag > 0 ? `<span style="color:#ffff00;">PEAK</span>` : ``;
            let tFlag = ch.troughFlag > 0 ? `<span style="color:#00f0ff;">TROUGH</span>` : ``;
            if(ch.peakFlag > 0) ch.peakFlag--;
            if(ch.troughFlag > 0) ch.troughFlag--;

            hud.innerHTML = `
                <div style="font-size: 10px; color: #888; display:flex; justify-content:space-between;">
                    <span>ADMITTANCE</span> <b>${pFlag} ${tFlag}</b>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: baseline;">
                    <span style="font-size: 18px; font-weight: bold; color: ${CH_COLORS[i]};">${curVal.toFixed(1)} µS</span>
                    <span style="font-size: 12px; color: #ccc;">${kOhm.toFixed(1)} kΩ</span>
                </div>
                
                <div style="font-size: 10px; color: #888; margin-top: 2px;">PULSE DURATION</div>
                <div style="font-size: 13px; font-weight: bold; color: #ccc;">${Math.round(curTicks).toLocaleString()} Ticks</div>
                
                <div style="font-size: 10px; color: #888; margin-top: 2px;">SLEW / TREND</div>
                <div style="font-size: 14px; font-weight: bold; color: ${tCol};">${tIcon} ${Math.abs(slw).toFixed(2)}</div>
            `;
        }
        
        // 4. DRAW HISTORICAL ROLL
        rCtx.clearRect(0, 0, rw, rh);
        rCtx.strokeStyle = '#30363d'; rCtx.lineWidth = 1;
        for(let j=0; j<12; j++) { rCtx.beginPath(); rCtx.moveTo(0, j*(rh/12)); rCtx.lineTo(rw, j*(rh/12)); rCtx.stroke(); }
        
        if (ch.history && ch.history.length > 1) {
            let hMin = 1000000, hMax = 0;
            ch.history.forEach(h => { if (h.min < hMin) hMin = h.min; if (h.max > hMax) hMax = h.max; });
            let hRange = hMax - hMin || 1;
            let pMin = hMin - (hRange * 0.1);
            let pRange = hRange * 1.2;
            let getY = (val) => rh - ((val - pMin) / pRange * rh);
            
            rCtx.fillStyle = CH_COLORS[i] + '1A'; 
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
            
            rCtx.strokeStyle = CH_COLORS[i] + '80'; 
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
