/**
 * js/visualizer.js
 */

const CH_COLORS = ['#ff3333', '#39ff14', '#33ccff', '#b84dff']; 

let sCtxs = [], rCtxs = [];
let lastRenderTime = 0; 

function resizeCanvasToDisplaySize(canvas) {
    if (!canvas) return false;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return false; 
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    return true;
}

function initVisualizer() {
    const dash = document.getElementById('dashboard');
    if (dash) dash.className = ''; 
    
    if (!document.getElementById('biodata-grid-styles')) {
        const style = document.createElement('style');
        style.id = 'biodata-grid-styles';
        style.innerHTML = `
            #dashboard { display: grid !important; grid-template-columns: repeat(2, 1fr) !important; gap: 15px !important; width: 100% !important; padding-bottom: 20px; box-sizing: border-box; }
            @media (max-width: 800px) { #dashboard { grid-template-columns: 1fr !important; } }
            
            .canvas-wrapper { position: relative; width: 100%; background: #000; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; box-sizing: border-box; }
            .canvas-wrapper canvas { position: absolute !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; margin: 0 !important; padding: 0 !important; border: none !important; }
            
            .ui-hidden { display: none !important; }
            
            .split-hud { display: flex !important; flex-direction: row !important; flex-wrap: nowrap !important; gap: 10px !important; width: 100% !important; align-items: stretch !important; box-sizing: border-box; }
            .roll-container { flex: 1 1 40% !important; min-width: 0 !important; height: 120px !important; }
            .hud-container { flex: 1 1 60% !important; min-width: 0 !important; display: flex; flex-direction: column; justify-content: center; background: #0a0d12; padding: 5px 10px; border: 1px solid var(--border); border-radius: 4px; font-family: monospace; box-sizing: border-box; overflow: hidden; height: 120px !important; }
        `;
        document.head.appendChild(style);
    }
    
    let html = ``;

    for(let i=0; i<4; i++) {
        if(!chData[i]) chData[i] = {};
        if(!chData[i].waveBuffer) chData[i].waveBuffer = [];
        if(!chData[i].renderQueue) chData[i].renderQueue = [];
        if(!chData[i].notes) chData[i].notes = [];
        if(!chData[i].history) chData[i].history = [];
        if(!chData[i].densityEvents) chData[i].densityEvents = [];
        if(!chData[i].config) chData[i].config = { zoom: 500, smooth: 0.05, freeze: false };
        if(!chData[i].bounds) chData[i].bounds = { min: 0, max: 10 }; 
        if(!chData[i].acc) chData[i].acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: Date.now() };
        if(chData[i].vizDeltaPct === undefined) chData[i].vizDeltaPct = 0; 
        
        html += `
        <div class="card" style="display: flex; flex-direction: column; background: #0d1117; padding: 15px; border: 1px solid var(--border); border-radius: 4px; min-width: 0;">
            
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: nowrap; border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 10px; gap: 10px;">
                <span style="color: ${CH_COLORS[i]}; font-size: 1.2em; font-weight: bold; flex-shrink: 0;">CH ${i+1}</span>
                
                <div style="flex-grow: 1; display: flex; align-items: center; gap: 8px; position: relative; min-width: 100px; margin: 0 10px;">
                    <span style="font-size: 12px; color: #888; font-weight: bold;">T</span>
                    <div style="position: relative; flex-grow: 1; height: 24px;">
                        <canvas id="ch-mini-vu-thresh-${i}" style="position: absolute; top: 0; left: 0; width: 100%; height: 24px; background: #111; border-radius: 4px; pointer-events: none; border: 1px solid #222; box-sizing: border-box;"></canvas>
                        <input type="range" id="ch-mini-thresh-${i}" class="pro-slider" min="0.5" max="5.0" step="0.01" value="2.0" style="position: absolute; top: 9px; left: 0; margin: 0; width: 100%; z-index: 2;">
                    </div>
                    <span id="ch-val-thresh-${i}" style="font-size: 12px; color: #ccc; width: 35px; text-align: right; font-weight: bold;">2.00x</span>
                </div>

                <div class="dropdown-widget" style="flex-shrink: 0;">
                    <button style="background: transparent; border: 1px solid var(--border); font-size: 14px; cursor: pointer; padding: 4px 8px; border-radius: 3px;">⚙️</button>
                    <div class="dropdown-content" style="right: 0; left: auto; padding: 15px; min-width: 180px; z-index: 200;">
                        <button id="ch-freeze-${i}" style="width: 100%; margin-bottom: 15px; background: transparent; color: #888; border: 1px solid #444; padding: 6px; border-radius: 3px; cursor: pointer; font-size: 14px; font-weight: bold;">❄️ FREEZE</button>
                        
                        <div style="display: flex; flex-direction: column; gap: 12px; font-size: 11px; color: #888;">
                            <label style="display: flex; align-items: center; justify-content: space-between;" title="Zoom (Timebase)">
                                <span style="font-weight: bold; width: 15px;">Z</span>
                                <div style="position: relative; flex-grow: 1; height: 20px; margin: 0 10px;">
                                    <input type="range" id="ch-zoom-${i}" class="pro-slider" min="0" max="1000" value="230" style="position: absolute; top: 7px; left: 0; margin: 0; width: 100%; background: #333;">
                                </div>
                                <span id="ch-val-zoom-${i}" style="color: #ccc; width: 45px; text-align: right;">500</span>
                            </label>
                            
                            <label style="display: flex; align-items: center; justify-content: space-between;" title="Smooth (EMA)">
                                <span style="font-weight: bold; width: 15px;">S</span>
                                <div style="position: relative; flex-grow: 1; height: 20px; margin: 0 10px;">
                                    <input type="range" id="ch-smooth-${i}" class="pro-slider" min="0.01" max="1.0" step="0.01" value="0.05" style="position: absolute; top: 7px; left: 0; margin: 0; width: 100%; background: #333;">
                                </div>
                                <span id="ch-val-smooth-${i}" style="color: #ccc; width: 45px; text-align: right;">0.05</span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="canvas-wrapper" style="height: 180px; margin-bottom: 15px;"><canvas class="scope" id="scope-${i}"></canvas></div>
            
            <div class="split-hud">
                <div class="canvas-wrapper roll-container"><canvas class="roll" id="roll-${i}"></canvas></div>
                <div id="hud-${i}" class="hud-container"></div>
            </div>
        </div>`;
    }
    
    if (dash) dash.innerHTML = html;

    for(let i=0; i<4; i++) {
        let zSlider = document.getElementById(`ch-zoom-${i}`);
        let sSlider = document.getElementById(`ch-smooth-${i}`);
        let tSlider = document.getElementById(`ch-mini-thresh-${i}`);
        let fBtn = document.getElementById(`ch-freeze-${i}`);
        
        let zVal = document.getElementById(`ch-val-zoom-${i}`);
        let sVal = document.getElementById(`ch-val-smooth-${i}`);
        let tVal = document.getElementById(`ch-val-thresh-${i}`);
        
        // CRITICAL FIX: The new high-res logarithmic math for the Zoom Slider
        if (zSlider) zSlider.addEventListener('input', (e) => {
            let pct = parseFloat(e.target.value) / 1000.0;
            let minL = Math.log(50), maxL = Math.log(120000);
            let val = Math.round(Math.exp(minL + pct * (maxL - minL)));
            chData[i].config.zoom = val;
            if (zVal) zVal.innerText = val;
        });
        
        if (sSlider) sSlider.addEventListener('input', (e) => {
            let val = parseFloat(e.target.value);
            chData[i].config.smooth = val;
            if (sVal) sVal.innerText = val.toFixed(2);
        });
        
        if (tSlider) tSlider.addEventListener('input', (e) => {
            let val = parseFloat(e.target.value);
            if (typeof synthChannels !== 'undefined' && synthChannels[i]) {
                synthChannels[i].params.threshold = val;
                if (tVal) tVal.innerText = val.toFixed(2) + 'x';
                
                if (activeSynthIndex === i) {
                    let mainSlider = document.getElementById('ui-slider-threshold');
                    let mainText = document.getElementById('ui-thresh-display');
                    if (mainSlider) mainSlider.value = val;
                    if (mainText) mainText.innerText = val.toFixed(2) + 'x';
                }
                
                if (typeof bleTxCharacteristic !== 'undefined' && bleTxCharacteristic) {
                    bleTxCharacteristic.writeValueWithoutResponse(new TextEncoder().encode(`T${i}:${val}\n`));
                }
            }
        });

        if (fBtn) fBtn.addEventListener('click', (e) => {
            chData[i].config.freeze = !chData[i].config.freeze;
            e.target.style.background = chData[i].config.freeze ? '#ff3333' : 'transparent';
            e.target.style.color = chData[i].config.freeze ? '#fff' : '#888';
            e.target.style.borderColor = chData[i].config.freeze ? '#ff3333' : '#444';
        });
    }

    sCtxs = [0,1,2,3].map(i => { let el = document.getElementById(`scope-${i}`); return el ? el.getContext('2d') : null; });
    rCtxs = [0,1,2,3].map(i => { let el = document.getElementById(`roll-${i}`); return el ? el.getContext('2d') : null; });
}

window.triggerDensityVisualizer = function(chIdx, type) {
    if (chData[chIdx]) {
        if (!chData[chIdx].densityEvents) chData[chIdx].densityEvents = [];
        chData[chIdx].densityEvents.push({ type: type, t: Date.now() });
    }
};

window.toggleSynthUI = function() {
    const synthPanel = document.getElementById('synth-inspector');
    const synthToggleBtn = document.getElementById('toggle-synth-btn');
    if (!synthPanel) return;
    
    const isHidden = synthPanel.classList.toggle('ui-hidden');
    synthPanel.style.setProperty('display', isHidden ? 'none' : 'block', 'important');
    
    if (synthToggleBtn) synthToggleBtn.style.opacity = isHidden ? '0.5' : '1.0';
    setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 50);
};

function renderLoop() {
    requestAnimationFrame(renderLoop);
    try {
        const nowMs = Date.now();
        if (nowMs - lastRenderTime < 33) return; 
        lastRenderTime = nowMs;
        const nowAudio = (typeof audioCtx !== 'undefined') ? audioCtx.currentTime : 0;

        if (typeof synthChannels !== 'undefined') {
            for (let i = 0; i < 4; i++) {
                let vu = document.getElementById(`vu-${i}`);
                if (vu && synthChannels[i] && synthChannels[i].analyser) {
                    let data = new Uint8Array(synthChannels[i].analyser.frequencyBinCount);
                    synthChannels[i].analyser.getByteTimeDomainData(data);
                    let max = 0; for(let j=0; j<data.length; j++) { let v = Math.abs(data[j] - 128); if(v > max) max = v; }
                    let fill = (max / 128) * vu.height;
                    let ctx = vu.getContext('2d');
                    ctx.clearRect(0, 0, vu.width, vu.height);
                    ctx.fillStyle = CH_COLORS[i];
                    ctx.fillRect(0, vu.height - fill, vu.width, fill);
                }
            }
        }
        
        let mVu = document.getElementById('master-vu-hz');
        if (mVu && window.masterAnalyser) {
            let data = new Uint8Array(window.masterAnalyser.frequencyBinCount);
            window.masterAnalyser.getByteTimeDomainData(data);
            let max = 0; for(let j=0; j<data.length; j++) { let v = Math.abs(data[j] - 128); if(v > max) max = v; }
            let fill = Math.min(mVu.width, (max / 128) * mVu.width * 1.5); 
            let ctx = mVu.getContext('2d');
            ctx.clearRect(0, 0, mVu.width, mVu.height);
            let threshPx = mVu.width * 0.95;
            ctx.fillStyle = '#00f0ff';
            ctx.fillRect(0, 0, Math.min(fill, threshPx), mVu.height);
            if (fill > threshPx) { ctx.fillStyle = '#ff0055'; ctx.fillRect(threshPx, 0, fill - threshPx, mVu.height); }
        }

        if (typeof synthChannels !== 'undefined' && synthChannels[activeSynthIndex] && synthChannels[activeSynthIndex].params) {
            const p = synthChannels[activeSynthIndex].params;
            const lfos = [ { key: 'pitchLfo', id: 'ind-lfo-pitchLfo' }, { key: 'filterLfo', id: 'ind-lfo-filterLfo' }, { key: 'ampLfo', id: 'ind-lfo-ampLfo' } ];
            lfos.forEach(lfo => {
                const config = p[lfo.key];
                if (config && config.rate !== undefined) {
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
                }
            });
        }

        if (typeof synthChannels !== 'undefined') {
            synthChannels.forEach(ch => {
                if(!ch || !ch.params) return;
                if(!ch.shState) ch.shState = { pitch: 0, filter: 0, amp: 0 };
                const p = ch.params;
                ['pitch', 'filter', 'amp'].forEach(dest => {
                    const lfoParam = p[`${dest}Lfo`];
                    if (lfoParam && lfoParam.shape === 'random' && nowMs - ch.shState[dest] > (1000 / lfoParam.rate)) {
                        ch.shState[dest] = nowMs;
                        const shVal = (Math.random() * 2) - 1; 
                        if (dest === 'pitch' && ch.voices) { ch.voices.forEach(v => { if(v && v.sources && v.sources.osc1 && v.sources.osc1.detuneNode) v.sources.osc1.detuneNode.setTargetAtTime(shVal * lfoParam.depth * 200, nowAudio, 0.02); if(v && v.sources && v.sources.sub && v.sources.sub.detuneNode) v.sources.sub.detuneNode.setTargetAtTime(shVal * lfoParam.depth * 200, nowAudio, 0.02); }); } 
                        else if (dest === 'filter' && ch.voices) { ch.voices.forEach(v => { if(v && v.vcf && v.vcf.detune) v.vcf.detune.setTargetAtTime(shVal * lfoParam.depth * 2000, nowAudio, 0.02); }); } 
                        else if (dest === 'amp' && ch.ampLfoNode) { ch.ampLfoNode.gain.setTargetAtTime(1.0 + (shVal * lfoParam.depth), nowAudio, 0.02); }
                    }
                });
            });
        }
        
        for(let i=0; i<4; i++) {
            if(!sCtxs[i] || !chData[i]) continue;
            let ch = chData[i];
            
            if(!ch.waveBuffer) ch.waveBuffer = [];
            if(!ch.renderQueue) ch.renderQueue = [];
            if(!ch.config) ch.config = { zoom: 500, smooth: 0.05, freeze: false };
            if(!ch.bounds) ch.bounds = { min: 0, max: 10 }; 
            if(!ch.densityEvents) ch.densityEvents = [];
            if(!ch.notes) ch.notes = [];
            if(!ch.history) ch.history = [];
            if(!ch.acc || ch.acc.lastSec === undefined) ch.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: nowMs };
            if(ch.vizDeltaPct === undefined) ch.vizDeltaPct = 0;
            
            let sCtx = sCtxs[i], rCtx = rCtxs[i];
            let sw = sCtx.canvas.clientWidth, sh = sCtx.canvas.clientHeight;
            let rw = rCtx.canvas.clientWidth, rh = rCtx.canvas.clientHeight;
            
            if (sw === 0 || sh === 0) continue; 
            if (sCtx.canvas.width !== sw) sCtx.canvas.width = sw;
            if (sCtx.canvas.height !== sh) sCtx.canvas.height = sh;
            if (rCtx.canvas.width !== rw) rCtx.canvas.width = rw;
            if (rCtx.canvas.height !== rh) rCtx.canvas.height = rh;

            if (ch.config.freeze) { ch.renderQueue = []; } 
            else {
                if (ch.renderQueue && ch.renderQueue.length > 0) {
                    while (ch.renderQueue.length > 0) ch.waveBuffer.push(ch.renderQueue.shift());
                }
                while (ch.waveBuffer.length > 120000) ch.waveBuffer.shift();
            }

            sCtx.clearRect(0, 0, sw, sh);
            let displayCount = Math.min(ch.config.zoom, ch.waveBuffer.length);
            let avgVal = 0;
            
            if(displayCount > 1) {
                let startIndex = ch.waveBuffer.length - displayCount;
                let smoothAlpha = ch.config.smooth;
                let requiredPreWarm = Math.floor(3.0 / smoothAlpha); 
                let preWarmIndex = Math.max(0, startIndex - requiredPreWarm);
                
                let seedSum = 0, seedCount = 0;
                for(let j = 0; j < 20 && (preWarmIndex + j) < ch.waveBuffer.length; j++) {
                    if (isFinite(ch.waveBuffer[preWarmIndex + j].r)) { seedSum += ch.waveBuffer[preWarmIndex + j].r; seedCount++; }
                }
                let currentEma1 = seedCount > 0 ? (seedSum / seedCount) : (ch.ema || 1000);
                let currentEma2 = currentEma1;
                
                for(let j = preWarmIndex; j < startIndex; j++) {
                    let rVal = ch.waveBuffer[j].r;
                    if (!isFinite(rVal)) rVal = currentEma1;
                    currentEma1 = (rVal * smoothAlpha) + (currentEma1 * (1 - smoothAlpha));
                    currentEma2 = (currentEma1 * smoothAlpha) + (currentEma2 * (1 - smoothAlpha));
                }

                let visualS = new Float32Array(displayCount);
                let targetMin = 1000000, targetMax = 0, sum = 0;
                
                for (let j = 0; j < displayCount; j++) {
                    let rVal = ch.waveBuffer[startIndex + j].r;
                    if (!isFinite(rVal)) rVal = currentEma1;
                    currentEma1 = (rVal * smoothAlpha) + (currentEma1 * (1 - smoothAlpha));
                    currentEma2 = (currentEma1 * smoothAlpha) + (currentEma2 * (1 - smoothAlpha));
                    if (isNaN(currentEma2)) currentEma2 = 0;
                    visualS[j] = currentEma2;
                    sum += currentEma2;
                    if (currentEma2 < targetMin) targetMin = currentEma2;
                    if (currentEma2 > targetMax) targetMax = currentEma2;
                }

                avgVal = displayCount > 0 ? (sum / displayCount) : 0;
                let targetRange = targetMax - targetMin;
                if (targetRange < 2.0) { let center = targetMin + (targetRange / 2); targetMin = center - 1.0; targetMax = center + 1.0; }
                
                if (ch.bounds.max <= 10 && targetMax > 100) { ch.bounds.min = targetMin; ch.bounds.max = targetMax; } 
                else { ch.bounds.min = (ch.bounds.min * 0.95) + (targetMin * 0.05); ch.bounds.max = (ch.bounds.max * 0.95) + (targetMax * 0.05); }

                let range = ch.bounds.max - ch.bounds.min;
                let paddedMin = ch.bounds.min - (range * 0.1);
                let paddedRange = range * 1.2;
                let getPathY = (val) => sh - ((val - paddedMin) / paddedRange * sh);

                let step = Math.max(1, Math.floor(displayCount / (sw > 0 ? sw : 500)));
                let pts = [];
                for(let j=0; j<displayCount; j+=step) pts.push({ x: j * (sw / (displayCount - 1)), y: getPathY(visualS[j]) });
                if ((displayCount - 1) % step !== 0) pts.push({ x: (displayCount - 1) * (sw / (displayCount - 1)), y: getPathY(visualS[displayCount - 1]) });

                sCtx.strokeStyle = CH_COLORS[i]; sCtx.lineWidth = 2.5; sCtx.lineJoin = "round"; sCtx.lineCap = "round"; sCtx.beginPath();
                if (pts.length > 0) {
                    sCtx.moveTo(pts[0].x, pts[0].y);
                    for (let k = 0; k < pts.length - 1; k++) { let xc = (pts[k].x + pts[k+1].x) / 2; let yc = (pts[k].y + pts[k+1].y) / 2; sCtx.quadraticCurveTo(pts[k].x, pts[k].y, xc, yc); }
                    sCtx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
                }
                sCtx.stroke();

                for(let j=0; j<displayCount; j+=step) {
                    let hasEvent = false; let eventNote = null;
                    for(let k=0; k<step && (j+k)<displayCount; k++) { let pt = ch.waveBuffer[startIndex + j + k]; if(pt.evt === 1 && pt.n) { hasEvent = true; eventNote = pt.n; break; } }
                    if(hasEvent && eventNote) {
                        let x = j * (sw / (displayCount - 1)); let y = getPathY(visualS[j]);
                        sCtx.save();
                        sCtx.strokeStyle = `hsla(${(eventNote % 12) * 30}, 100%, 50%, 0.7)`;
                        sCtx.lineWidth = 1; sCtx.beginPath(); sCtx.moveTo(x, 0); sCtx.lineTo(x, sh); sCtx.stroke();
                        sCtx.beginPath(); sCtx.arc(x, y, 3, 0, Math.PI * 2); sCtx.fillStyle = sCtx.strokeStyle; sCtx.fill();
                        sCtx.restore();
                    }
                }
                
                if (!ch.lastHudTime || nowMs - ch.lastHudTime > 400) {
                    ch.lastHudTime = nowMs;
                    let hud = document.getElementById(`hud-${i}`);
                    let curVal = visualS && visualS.length > 0 ? visualS[visualS.length-1] : 0; 
                    let curTicks = ch.waveBuffer && ch.waveBuffer.length > 0 ? ch.waveBuffer[ch.waveBuffer.length-1].ticks : 0;
                    let kOhm = curVal > 0 ? (1000 / curVal) : 0; let slw = (ch.slew || 0) * 100;
                    let tCol = slw > 0.1 ? CH_COLORS[i] : (slw < -0.1 ? '#ff0055' : '#888');
                    let tIcon = slw > 0.1 ? '▲' : (slw < -0.1 ? '▼' : '—');
                    if (hud) hud.innerHTML = `
                        <div style="font-size: 10px; color: #888; margin-bottom: 4px; text-align: center;">ADMITTANCE</div>
                        <div style="display: flex; justify-content: space-around; border-bottom: 1px solid #222; padding-bottom: 6px; margin-bottom: 6px;">
                            <div style="color: ${CH_COLORS[i]}; display: flex; align-items: baseline;">
                                <div style="text-align: right; font-size: 18px; font-weight: bold; font-variant-numeric: tabular-nums;">${curVal.toFixed(1)}</div>
                                <div style="font-size: 12px; margin-left: 4px;">µS</div>
                            </div>
                            <div style="color: #ccc; display: flex; align-items: baseline;">
                                <div style="text-align: right; font-size: 13px; font-weight: bold; font-variant-numeric: tabular-nums;">${kOhm.toFixed(1)}</div>
                                <div style="font-size: 10px; margin-left: 4px;">kΩ</div>
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-around;">
                            <div style="display: flex; flex-direction: column; align-items: center;">
                                <div style="font-size: 10px; color: #888; margin-bottom: 2px;">WIDTH</div>
                                <div style="color: #ccc; display: flex; align-items: baseline; justify-content: center;">
                                    <div style="text-align: right; font-size: 13px; font-weight: bold; font-variant-numeric: tabular-nums;">${Math.round(curTicks)}</div>
                                    <div style="font-size: 10px; color: #666; margin-left: 4px;">T</div>
                                </div>
                            </div>
                            <div style="display: flex; flex-direction: column; align-items: center;">
                                <div style="font-size: 10px; color: #888; margin-bottom: 2px;">SLEW</div>
                                <div style="color: ${tCol}; display: flex; align-items: baseline; justify-content: center;">
                                    <div style="text-align: right; font-size: 11px; margin-right: 2px;">${tIcon}</div>
                                    <div style="text-align: right; font-size: 14px; font-weight: bold; font-variant-numeric: tabular-nums;">${Math.abs(slw).toFixed(2)}</div>
                                </div>
                            </div>
                        </div>`;
                }
            }
            
            sCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)'; sCtx.lineWidth = 1; sCtx.beginPath();
            for(let g=1; g<4; g++) { sCtx.moveTo(0, sh * (g/4)); sCtx.lineTo(sw, sh * (g/4)); }
            for(let g=1; g<10; g++) { sCtx.moveTo(sw * (g/10), 0); sCtx.lineTo(sw * (g/10), sh); }
            sCtx.stroke();
            sCtx.fillStyle = 'rgba(255, 255, 255, 0.6)'; sCtx.font = '11px monospace'; sCtx.textAlign = 'left'; sCtx.textBaseline = 'top';
            sCtx.fillText(`MAX: ${ch.bounds.max.toFixed(1)}`, 5, 5); sCtx.fillText(`AVG: ${avgVal.toFixed(1)}`, 5, 19);
            sCtx.textBaseline = 'bottom'; sCtx.fillText(`MIN: ${ch.bounds.min.toFixed(1)}`, 5, sh - 5);
            
            rCtx.clearRect(0, 0, rw, rh); rCtx.strokeStyle = '#30363d'; rCtx.lineWidth = 1;
            for(let j=0; j<12; j++) { rCtx.beginPath(); rCtx.moveTo(0, j*(rh/12)); rCtx.lineTo(rw, j*(rh/12)); rCtx.stroke(); }
            
            if (ch.history && ch.history.length > 1) {
                let hMin = 1000000, hMax = 0;
                ch.history.forEach(h => { if (h.min < hMin) hMin = h.min; if (h.max > hMax) hMax = h.max; });
                let hRange = hMax - hMin || 1; let pMin = hMin - (hRange * 0.1); let pRange = hRange * 1.2;
                let getY = (val) => rh - ((val - pMin) / pRange * rh);
                rCtx.fillStyle = CH_COLORS[i] + '1A'; rCtx.beginPath();
                for(let j=0; j<ch.history.length; j++) { let x = rw - ((ch.history.length - 1 - j) * (rw / 300)); if (j === 0) rCtx.moveTo(x, getY(ch.history[j].max)); else rCtx.lineTo(x, getY(ch.history[j].max)); }
                for(let j=ch.history.length-1; j>=0; j--) { let x = rw - ((ch.history.length - 1 - j) * (rw / 300)); rCtx.lineTo(x, getY(ch.history[j].min)); }
                rCtx.fill();
                rCtx.strokeStyle = CH_COLORS[i] + '80'; rCtx.lineWidth = 1.5; rCtx.beginPath();
                for(let j=0; j<ch.history.length; j++) { let x = rw - ((ch.history.length - 1 - j) * (rw / 300)); if (j === 0) rCtx.moveTo(x, getY(ch.history[j].avg)); else rCtx.lineTo(x, getY(ch.history[j].avg)); }
                rCtx.stroke();
                rCtx.fillStyle = 'rgba(255, 255, 255, 0.5)'; rCtx.font = '11px monospace'; rCtx.textBaseline = 'bottom'; rCtx.textAlign = 'left';
                let mins = Math.floor(ch.history.length / 60), secs = ch.history.length % 60;
                rCtx.fillText(`-${mins}:${secs.toString().padStart(2, '0')}`, 5, rh - 5);
            }
            
            if (ch.notes) {
                ch.notes = ch.notes.filter(n => nowMs - n.t < 8000);
                ch.notes.forEach(note => {
                    rCtx.fillStyle = `hsla(${(note.n % 12) * 30}, 100%, 50%, ${Math.max(0.3, note.v / 127)})`; 
                    let visDur = Math.min(note.dur, 2000); 
                    let w = (visDur / 8000) * rw;
                    rCtx.fillRect(rw - ((nowMs - note.t) / 8000 * rw) - w, Math.max(0, rh - ((note.n / 127) * rh) - 4), w, 8); 
                });
            }

            let miniTC = document.getElementById(`ch-mini-vu-thresh-${i}`);
            if (miniTC && resizeCanvasToDisplaySize(miniTC) && synthChannels[i] && synthChannels[i].params) {
                let ctx = miniTC.getContext('2d');
                ctx.clearRect(0,0,miniTC.width,miniTC.height);
                
                let minMult = 0.5, maxMult = 5.0;
                let threshPct = (synthChannels[i].params.threshold - minMult) / (maxMult - minMult);
                let currentMult = (ch.lastStdevi > 0) ? (ch.lastDelta / ch.lastStdevi) : 0;
                let deltaPct = Math.max(0, Math.min(1, (currentMult - minMult) / (maxMult - minMult)));
                
                if (deltaPct > ch.vizDeltaPct) ch.vizDeltaPct = deltaPct;
                else ch.vizDeltaPct = (deltaPct * 0.1) + (ch.vizDeltaPct * 0.9);
                
                let age = nowMs - (ch.lastBlockTime || nowMs);
                let alpha = Math.max(0.1, 1 - (age / 1500));
                
                ctx.globalAlpha = alpha;
                let baseFillPct = Math.min(ch.vizDeltaPct, threshPct);
                ctx.fillStyle = CH_COLORS[i];
                ctx.fillRect(0, 0, baseFillPct * miniTC.width, miniTC.height);
                
                if (ch.vizDeltaPct > threshPct) {
                    ctx.fillStyle = '#ffd700'; 
                    ctx.fillRect(threshPct * miniTC.width, 0, (ch.vizDeltaPct - threshPct) * miniTC.width, miniTC.height);
                }
                
                ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.fillRect(threshPct * miniTC.width - 1, 0, 2, miniTC.height);
                ctx.globalAlpha = 1.0;
            }
        }

        if (typeof activeSynthIndex !== 'undefined' && chData[activeSynthIndex]) {
            let actCh = chData[activeSynthIndex];
            let params = (typeof synthChannels !== 'undefined' && synthChannels[activeSynthIndex]) ? synthChannels[activeSynthIndex].params : window.defaultParams;
            let cColor = CH_COLORS[activeSynthIndex] || '#fff';

            if (actCh.bounds && params) {
                let tC = document.getElementById('vu-threshold');
                if (tC && resizeCanvasToDisplaySize(tC)) {
                    let ctx = tC.getContext('2d');
                    ctx.clearRect(0,0,tC.width,tC.height);
                    
                    let minMult = 0.5, maxMult = 5.0;
                    let threshPct = (params.threshold - minMult) / (maxMult - minMult);
                    let currentMult = (actCh.lastStdevi > 0) ? (actCh.lastDelta / actCh.lastStdevi) : 0;
                    let deltaPct = Math.max(0, Math.min(1, (currentMult - minMult) / (maxMult - minMult)));
                    
                    if (actCh.vizDeltaPct > threshPct) actCh.vizDeltaPct = deltaPct;
                    else actCh.vizDeltaPct = (deltaPct * 0.1) + (actCh.vizDeltaPct * 0.9);
                    
                    let age = nowMs - (actCh.lastBlockTime || nowMs);
                    let alpha = Math.max(0.1, 1 - (age / 1500));
                    
                    ctx.globalAlpha = alpha;
                    
                    let baseFillPct = Math.min(actCh.vizDeltaPct, threshPct);
                    ctx.fillStyle = cColor;
                    ctx.fillRect(0, 0, baseFillPct * tC.width, tC.height);
                    
                    if (actCh.vizDeltaPct > threshPct) {
                        ctx.fillStyle = '#ffd700'; 
                        ctx.fillRect(threshPct * tC.width, 0, (actCh.vizDeltaPct - threshPct) * tC.width, tC.height);
                    }
                    
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                    ctx.fillRect(threshPct * tC.width - 1, 0, 2, tC.height);
                    
                    ctx.globalAlpha = 1.0;
                }

                let dC = document.getElementById('vu-density');
                if (dC && resizeCanvasToDisplaySize(dC)) {
                    let ctx = dC.getContext('2d');
                    ctx.fillStyle = 'rgba(0,0,0,0.1)'; 
                    ctx.fillRect(0,0,dC.width,dC.height); 
                    if (actCh.densityEvents) {
                        actCh.densityEvents = actCh.densityEvents.filter(e => nowMs - e.t < 4000);
                        actCh.densityEvents.forEach(e => {
                            let age = nowMs - e.t;
                            let x = dC.width - (age / 4000 * dC.width);
                            if (e.type === 'pass') { ctx.fillStyle = cColor; ctx.fillRect(x, 2, 2, dC.height - 4); } 
                            else if (e.type === 'drop') { ctx.fillStyle = '#555'; ctx.fillRect(x, dC.height/2 - 1, 2, 2); }
                        });
                    }
                }

                let keys = document.querySelectorAll('.piano-wrapper div');
                if (keys && keys.length > 0) {
                    keys.forEach(k => { k.style.background = ''; k.style.boxShadow = ''; });
                    if (actCh.notes) {
                        actCh.notes.forEach(n => {
                            if (nowMs - n.t < 200) { 
                                let keyIdx = n.n % 12;
                                let keyEl = document.getElementById(`pkey-${keyIdx}`);
                                if (keyEl) { keyEl.style.background = '#fff'; keyEl.style.boxShadow = `0 0 15px #fff`; }
                            }
                        });
                    }
                }
            }
        }
    } catch (err) { console.error("Visualizer Render Error:", err); }
}