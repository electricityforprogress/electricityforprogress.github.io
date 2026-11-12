/**
 * js/visualizer.js
 * bioQuad 4-Channel Oscilloscope, HUD & Parallax-Fixed Meter
 */

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

// Smooth drag-to-adjust threshold maximum (1.0x to 10.0x)
window.setThresholdMax = function(ch, newMax) {
    if (!window.synthChannels || !window.synthChannels[ch]) return;
    const p = window.synthChannels[ch].params;
    newMax = Math.max(1.0, Math.min(10.0, Math.round(newMax * 20) / 20)); 
    p.threshMax = newMax;
    p.threshold = Math.max(1.0, Math.min(10.0, Math.min(newMax, p.threshold || 2.0)));
    
    const tSlider = document.getElementById(`ch-mini-thresh-${ch}`);
    if (tSlider) {
        tSlider.min = "1.00";
        tSlider.max = newMax.toFixed(2);
        tSlider.step = newMax <= 2.5 ? "0.01" : "0.02";
        tSlider.value = p.threshold.toFixed(2);
        const tVal = document.getElementById(`ch-val-thresh-${ch}`);
        if (tVal) tVal.innerText = `${p.threshold.toFixed(2)}x`;
    }
    
    const maxBtn = document.getElementById(`ch-max-btn-${ch}`);
    if (maxBtn) maxBtn.innerText = `${newMax.toFixed(2)}x`;
    
    if (typeof window.debouncedHardwareSync === 'function') window.debouncedHardwareSync(ch);
}

window.initThreshMaxDrag = function() {
    document.querySelectorAll('.ch-thresh-max-btn').forEach(badge => {
        let isDragging = false, startY = 0, startMax = 5.0, hasMoved = false;
        let ch = parseInt(badge.dataset.ch);
        
        badge.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            isDragging = true; hasMoved = false; startY = e.clientY;
            startMax = (synthChannels[ch] && synthChannels[ch].params.threshMax) ? synthChannels[ch].params.threshMax : 5.0;
            badge.setPointerCapture(e.pointerId);
            badge.style.borderColor = 'var(--cyan)';
            badge.style.color = 'var(--cyan)';
            e.preventDefault();
        });
        
        badge.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            let deltaY = startY - e.clientY;
            if (Math.abs(deltaY) > 2) hasMoved = true;
            let newMax = Math.max(1.0, Math.min(10.0, startMax + (deltaY * 0.025)));
            window.setThresholdMax(ch, newMax);
            let rect = badge.getBoundingClientRect();
            if (typeof showTooltip === 'function') showTooltip(rect.left + rect.width / 2, rect.top - 12, newMax, 'threshMax', '', badge);
        });
        
        const stopDrag = (e) => {
            if (!isDragging) return;
            isDragging = false;
            badge.releasePointerCapture(e.pointerId);
            badge.style.borderColor = ''; badge.style.color = '';
            if (typeof hideTooltip === 'function') hideTooltip();
            if (!hasMoved) {
                let cur = (synthChannels[ch] && synthChannels[ch].params.threshMax) ? synthChannels[ch].params.threshMax : 5.0;
                let entered = prompt(`Enter Channel ${ch + 1} Threshold Limit (1.0 to 10.0):`, cur.toFixed(2));
                if (entered !== null) {
                    let num = parseFloat(entered);
                    if (!isNaN(num) && num >= 1.0 && num <= 10.0) window.setThresholdMax(ch, num);
                }
            }
        };
        badge.addEventListener('pointerup', stopDrag);
        badge.addEventListener('pointercancel', stopDrag);
    });
}

function initVisualizer() {
    const dash = document.getElementById('dashboard');
    if (dash) dash.className = '';
          
    if (!document.getElementById('biodata-grid-styles')) {
        const style = document.createElement('style');
        style.id = 'biodata-grid-styles';
        style.innerHTML = `
            #dashboard { display: grid !important; grid-template-columns: repeat(2, 1fr) !important; gap: 15px !important; width: 100% !important; padding-bottom: 20px; box-sizing: border-box; }
            @media (max-width: 900px) { #dashboard { grid-template-columns: 1fr !important; } }
            .canvas-wrapper { position: relative; width: 100%; background: #000; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; box-sizing: border-box; }
            .canvas-wrapper canvas { position: absolute !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; margin: 0 !important; padding: 0 !important; border: none !important; }
            .ui-hidden { display: none !important; }
            .split-hud { display: flex !important; flex-direction: row !important; flex-wrap: nowrap !important; gap: 10px !important; width: 100% !important; align-items: stretch !important; box-sizing: border-box; }
            .roll-container { flex: 1 1 40% !important; min-width: 0 !important; height: 120px !important; }
            .hud-container { flex: 1 1 60% !important; min-width: 0 !important; display: flex; flex-direction: column; justify-content: center; background: #0a0d12; padding: 5px 10px; border: 1px solid var(--border); border-radius: 4px; font-family: monospace; box-sizing: border-box; overflow: hidden; height: 120px !important; position: relative; }
            .hud-settings-wrapper { position: absolute; top: 0; right: 0; width: 30px; height: 30px; z-index: 20; transition: width 0.2s ease-in-out, height 0.2s ease-in-out; border-radius: 0 4px 0 4px; overflow: hidden; background: transparent; }
            .hud-settings-wrapper:hover { width: 100%; height: 100%; background: rgba(10, 13, 18, 0.98); border-left: 1px solid var(--border); border-bottom: 1px solid var(--border); border-radius: 0; }
            .hud-settings-menu { opacity: 0; visibility: hidden; transition: opacity 0.2s; display: flex; flex-direction: column; justify-content: center; height: 100%; padding: 10px; box-sizing: border-box; }
            .hud-settings-wrapper:hover .hud-settings-menu { opacity: 1; visibility: visible; transition-delay: 0.1s; }
            .hud-gear-icon { position: absolute; top: 4px; right: 6px; font-size: 14px; color: #666; transition: 0.2s; cursor: pointer; }
            .hud-settings-wrapper:hover .hud-gear-icon { opacity: 0; visibility: hidden; }
        `;
        document.head.appendChild(style);
    }
         
    let html = ``;
    for(let i=0; i<4; i++) {
        if(!chData[i]) chData[i] = {};
        if(!chData[i].waveBuffer) chData[i].waveBuffer = [];
        if(!chData[i].notes) chData[i].notes = [];
        if(!chData[i].history) chData[i].history = [];
        if(!chData[i].densityEvents) chData[i].densityEvents = [];
        if(!chData[i].config) chData[i].config = { zoom: 500, smooth: 0.05, freeze: false };
        if(!chData[i].bounds) chData[i].bounds = { min: 0, max: 10 }; 
        if(!chData[i].acc || chData[i].acc.lastSec === undefined) chData[i].acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: Date.now() };
        if(chData[i].vizDeltaPct === undefined) chData[i].vizDeltaPct = 0;
                  
        let initialThresh = (window.synthChannels[i] && window.synthChannels[i].params) ? window.synthChannels[i].params.threshold : 2.0;
        let initialMax = (window.synthChannels[i] && window.synthChannels[i].params && window.synthChannels[i].params.threshMax) ? window.synthChannels[i].params.threshMax : 5.0;
        
        html += `
        <div class="card" style="display: flex; flex-direction: column; background: #0d1117; padding: 15px; border: 1px solid var(--border); border-radius: 4px; min-width: 0;">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: nowrap; border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 10px; gap: 8px;">
                <span style="color: ${window.CH_COLORS[i]}; font-size: 1.1em; font-weight: bold; flex-shrink: 0;">CH ${i+1}</span>
                <div style="flex-grow: 1; display: flex; align-items: center; gap: 6px; position: relative; min-width: 100px; margin: 0 4px;">
                    <span style="font-size: 11px; color: #888; font-weight: bold;">T</span>
                    
                    <div style="position: relative; flex-grow: 1; height: 24px; background: #111; border-radius: 4px; border: 1px solid #222; box-sizing: border-box;">
                        <canvas id="ch-mini-vu-thresh-${i}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; border-radius: 3px;"></canvas>
                        <input type="range" id="ch-mini-thresh-${i}" class="pro-slider" min="1.00" max="${initialMax.toFixed(2)}" step="0.01" value="${Math.max(1.0, initialThresh).toFixed(2)}" style="position: absolute; top: 8px; left: 0; margin: 0; width: 100%; z-index: 2;">
                    </div>

                    <span id="ch-val-thresh-${i}" style="font-size: 11px; color: #ccc; width: 38px; text-align: right; font-weight: bold; font-family: monospace;">${Math.max(1.0, initialThresh).toFixed(2)}x</span>
                    <div id="ch-max-btn-${i}" class="ch-thresh-max-btn" data-ch="${i}" title="Drag Up/Down to Adjust Limit (1.0x to 10.0x)">${initialMax.toFixed(2)}x</div>
                </div>
            </div>
            
            <div class="canvas-wrapper" style="height: 180px; margin-bottom: 15px;"><canvas class="scope" id="scope-${i}"></canvas></div>
            
            <div class="split-hud">
                <div class="canvas-wrapper roll-container"><canvas class="roll" id="roll-${i}"></canvas></div>
                <div class="hud-container" style="position: relative;">
                    <div style="font-size: 10px; color: #888; margin-bottom: 4px; text-align: center;">ADMITTANCE</div>
                    <div style="display: flex; justify-content: space-around; border-bottom: 1px solid #222; padding-bottom: 6px; margin-bottom: 6px;">
                        <div style="color: ${window.CH_COLORS[i]}; display: flex; align-items: baseline;">
                            <div id="hud-val-${i}" style="text-align: right; font-size: 18px; font-weight: bold; font-variant-numeric: tabular-nums;">0.0</div>
                            <div style="font-size: 12px; margin-left: 4px;"> µS</div>
                        </div>
                        <div style="color: #ccc; display: flex; align-items: baseline;">
                            <div id="hud-kohm-${i}" style="text-align: right; font-size: 13px; font-weight: bold; font-variant-numeric: tabular-nums;">0.0</div>
                            <div style="font-size: 10px; margin-left: 4px;">kΩ</div>
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-around;">
                        <div style="display: flex; flex-direction: column; align-items: center;">
                            <div style="font-size: 10px; color: #888; margin-bottom: 2px;">WIDTH</div>
                            <div style="color: #ccc; display: flex; align-items: baseline; justify-content: center;">
                                <div id="hud-ticks-${i}" style="text-align: right; font-size: 13px; font-weight: bold; font-variant-numeric: tabular-nums;">0</div>
                                <div style="font-size: 10px; color: #666; margin-left: 4px;">T</div>
                            </div>
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: center;">
                            <div style="font-size: 10px; color: #888; margin-bottom: 2px;">SLEW</div>
                            <div id="hud-slew-color-${i}" style="color: #888; display: flex; align-items: baseline; justify-content: center;">
                                <div id="hud-slew-icon-${i}" style="text-align: right; font-size: 11px; margin-right: 2px;">~</div>
                                <div id="hud-slew-val-${i}" style="text-align: right; font-size: 14px; font-weight: bold; font-variant-numeric: tabular-nums;">0.00</div>
                                <div style="font-size: 9px; color: #666; margin-left: 3px; line-height: 14px;">µS</div>
                            </div>
                        </div>
                    </div>
                    <div class="hud-settings-wrapper">
                        <div class="hud-gear-icon">⚙</div>
                        <div class="hud-settings-menu">
                            <div style="display: flex; gap: 4px; margin-bottom: 8px;">
                                <button id="ch-freeze-${i}" style="flex: 1; background: transparent; color: #888; border: 1px solid #444; padding: 4px; border-radius: 12px; cursor: pointer; font-size: 11px; font-weight: bold; transition: 0.2s;">❄ FREEZE</button>
                                <button id="ch-clear-${i}" style="flex: 0 0 50px; background: transparent; color: var(--red); border: 1px solid var(--border); padding: 4px; border-radius: 12px; cursor: pointer; font-size: 10px; font-weight: bold; transition: 0.2s;">✕ CLR</button>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 8px; font-size: 11px; color: #888;">
                                <label style="display: flex; align-items: center; justify-content: space-between;">
                                    <span style="font-weight: bold; width: 12px;">Z</span>
                                    <input type="range" id="ch-zoom-${i}" class="pro-slider" min="0" max="1000" value="230" style="flex-grow: 1; margin: 0 8px; background: #333;">
                                    <span id="ch-val-zoom-${i}" style="color: #ccc; width: 30px; text-align: right;">500</span>
                                </label>
                                <label style="display: flex; align-items: center; justify-content: space-between;">
                                    <span style="font-weight: bold; width: 12px;">S</span>
                                    <input type="range" id="ch-smooth-${i}" class="pro-slider" min="0.01" max="1.0" step="0.01" value="0.05" style="flex-grow: 1; margin: 0 8px; background: #333;">
                                    <span id="ch-val-smooth-${i}" style="color: #ccc; width: 30px; text-align: right;">0.05</span>
                                </label>
                                <label style="display: flex; align-items: center; justify-content: space-between;">
                                    <span style="font-weight: bold; width: 12px;">W</span>
                                    <input type="range" id="ch-window-${i}" class="pro-slider" min="10" max="100" step="1" value="40" style="flex-grow: 1; margin: 0 8px; background: #333;">
                                    <span id="ch-val-window-${i}" style="color: #ccc; width: 30px; text-align: right;">40</span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    }
         
    if (dash) dash.innerHTML = html;
    
    for(let i=0; i<4; i++) {
        let zSlider = document.getElementById(`ch-zoom-${i}`);
        let sSlider = document.getElementById(`ch-smooth-${i}`);
        let tSlider = document.getElementById(`ch-mini-thresh-${i}`);
        let wSlider = document.getElementById(`ch-window-${i}`);
        let fBtn = document.getElementById(`ch-freeze-${i}`);
        let cBtn = document.getElementById(`ch-clear-${i}`);
                 
        let zVal = document.getElementById(`ch-val-zoom-${i}`);
        let sVal = document.getElementById(`ch-val-smooth-${i}`);
        let tVal = document.getElementById(`ch-val-thresh-${i}`);
        let wVal = document.getElementById(`ch-val-window-${i}`);
                 
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
            if (window.synthChannels && window.synthChannels[i]) {
                window.synthChannels[i].params.threshold = val;
                if (tVal) tVal.innerText = val.toFixed(2) + 'x';
                if (typeof window.debouncedHardwareSync === 'function') window.debouncedHardwareSync(i);
            }
        });
        
        if (wSlider) wSlider.addEventListener('input', (e) => {
            let val = parseInt(e.target.value);
            if (window.synthChannels && window.synthChannels[i]) {
                window.synthChannels[i].params.sampleSize = val;
                if (wVal) wVal.innerText = val;
                if (typeof window.debouncedHardwareSync === 'function') window.debouncedHardwareSync(i);
            }
        });
        
        if (fBtn) fBtn.addEventListener('click', (e) => {
            if(chData[i]) {
                chData[i].config.freeze = !chData[i].config.freeze;
                e.target.style.background = chData[i].config.freeze ? '#ff3333' : 'transparent';
                e.target.style.color = chData[i].config.freeze ? '#fff' : '#888';
                e.target.style.borderColor = chData[i].config.freeze ? '#ff3333' : '#444';
            }
        });
        
        if (cBtn) cBtn.addEventListener('click', (e) => {
            if (chData[i]) {
                chData[i].waveBuffer = [];
                chData[i].vizBuffer = [];
                chData[i].history = [];
                chData[i].notes = [];
                chData[i].frozenWaveBuffer = null;
                chData[i].frozenVizBuffer = null;
                chData[i].peak = { val: 0, time: 0, vel: 0 };
            }
            e.target.style.background = 'var(--red)';
            e.target.style.color = '#fff';
            setTimeout(() => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--red)'; }, 200);
        });
    }
    
    sCtxs = [0,1,2,3].map(i => { let el = document.getElementById(`scope-${i}`); return el ? el.getContext('2d') : null; });
    rCtxs = [0,1,2,3].map(i => { let el = document.getElementById(`roll-${i}`); return el ? el.getContext('2d') : null; });
         
    if (typeof window.initThreshMaxDrag === 'function') {
        window.initThreshMaxDrag();
    }
}

window.triggerDensityVisualizer = function(chIdx, type) {
    if (chData[chIdx]) {
        if (!chData[chIdx].densityEvents) chData[chIdx].densityEvents = [];
        chData[chIdx].densityEvents.push({ type: type, t: Date.now() });
    }
}

function renderLoop() {
    requestAnimationFrame(renderLoop);
    try {
        const nowMs = Date.now();
        if (nowMs - lastRenderTime < 33) return;
        lastRenderTime = nowMs;
        const nowAudio = (typeof audioCtx !== 'undefined') ? audioCtx.currentTime : 0;
        
        let beatInterval = 60000 / (window.masterBPM || 120);
        if (nowMs - window.lastBeatTime > beatInterval) {
            window.lastBeatTime = nowMs;
            let bpmLed = document.getElementById('top-bpm-led');
            if (bpmLed) {
                bpmLed.style.backgroundColor = 'var(--red)';
                bpmLed.style.boxShadow = '0 0 10px var(--red)';
                setTimeout(() => { bpmLed.style.backgroundColor = '#222'; bpmLed.style.boxShadow = 'none'; }, 50);
            }
        }
        
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
                    ctx.fillStyle = window.CH_COLORS[i];
                    ctx.fillRect(0, vu.height - fill, vu.width, fill);
                }
            }
        }
                 
        let mVu = document.getElementById('master-vu-hz');
        if (mVu && window.masterAnalyser && resizeCanvasToDisplaySize(mVu)) {
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
            if(!ch.config) ch.config = { zoom: 500, smooth: 0.05, freeze: false };
            if(!ch.bounds) ch.bounds = { min: 0, max: 10 }; 
            if(!ch.densityEvents) ch.densityEvents = [];
            if(!ch.notes) ch.notes = [];
            if(!ch.history) ch.history = [];
            if(!ch.acc || ch.acc.lastSec === undefined) ch.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: nowMs };
                         
            while (ch.waveBuffer.length > 120000) ch.waveBuffer.shift();
            
            if (ch.config.freeze) {
                if (!ch.frozenWaveBuffer) ch.frozenWaveBuffer = [...ch.waveBuffer];
                if (!ch.frozenVizBuffer) ch.frozenVizBuffer = ch.vizBuffer ? [...ch.vizBuffer] : [];
            } else {
                ch.frozenWaveBuffer = null;
                ch.frozenVizBuffer = null;
            }
                         
            let renderWave = ch.config.freeze ? ch.frozenWaveBuffer : ch.waveBuffer;
            let renderViz = ch.config.freeze ? ch.frozenVizBuffer : (ch.vizBuffer || []);
                         
            let sCtx = sCtxs[i], rCtx = rCtxs[i];
            let sw = sCtx.canvas.clientWidth, sh = sCtx.canvas.clientHeight;
            let rw = rCtx.canvas.clientWidth, rh = rCtx.canvas.clientHeight;
                         
            if (sw === 0 || sh === 0) continue; 
            if (sCtx.canvas.width !== sw) sCtx.canvas.width = sw;
            if (sCtx.canvas.height !== sh) sCtx.canvas.height = sh;
            if (rCtx.canvas.width !== rw) rCtx.canvas.width = rw;
            if (rCtx.canvas.height !== rh) rCtx.canvas.height = rh;
            
            sCtx.clearRect(0, 0, sw, sh);
            
            let displayCount = Math.min(ch.config.zoom, renderWave.length);
            let avgVal = 0;
            
            // --- FIX: SAFE DEFAULT INITIALIZATION TO PREVENT CANVAS CRASH ---
            let rawMinTrack = 1000000, rawMaxTrack = -1000000; 
            let targetMin = 1000000, targetMax = -1000000, sum = 0;
            let binnedData = [];
            
            if(displayCount > 1) {
				let startIndex = renderWave.length - displayCount;
				let smoothAlpha = ch.config.smooth;
				
				// Pull enough hidden data off the left edge to settle the double-EMA
				let requiredPreWarm = Math.floor(5.0 / smoothAlpha); 
				let preWarmIndex = Math.max(0, startIndex - requiredPreWarm);
				
				// 1. Initial Seed (Average of the first 20 hidden points)
				let seedSum = 0, seedCount = 0;
				for(let j = 0; j < 20 && (preWarmIndex + j) < renderWave.length; j++) {
					if (isFinite(renderWave[preWarmIndex + j].r)) { seedSum += renderWave[preWarmIndex + j].r; seedCount++; }
				}
				let currentEma1 = seedCount > 0 ? (seedSum / seedCount) : (ch.ema || 1000);
				let currentEma2 = currentEma1;
				
				// 2. THE FIX: Actually run the math engine over the hidden pre-warm data 
				// so the line enters the left edge of the screen completely stabilized
				for (let j = preWarmIndex; j < startIndex; j++) {
					let rawVal = renderWave[j].r;
					if (isFinite(rawVal)) {
						currentEma1 = (rawVal * smoothAlpha) + (currentEma1 * (1 - smoothAlpha));
						currentEma2 = (currentEma1 * smoothAlpha) + (currentEma2 * (1 - smoothAlpha));
					}
				}
				
				let pointsPerPixel = displayCount / sw;
				
                for (let px = 0; px < sw; px++) {
                    let chunkStart = Math.floor(px * pointsPerPixel);
                    let chunkEnd = Math.floor((px + 1) * pointsPerPixel);
                    if (chunkEnd <= chunkStart) chunkEnd = chunkStart + 1; 
                    if (chunkEnd > displayCount) chunkEnd = displayCount;
                    
                    let binMin = 1000000, binMax = -1000000;
                    let rawMin = 1000000, rawMax = -1000000;
                    
                    for (let j = chunkStart; j < chunkEnd; j++) {
                        let rawVal = renderWave[startIndex + j].r || currentEma1;
                        if (!isFinite(rawVal)) rawVal = currentEma1;
                        
                        if (rawVal < rawMin) rawMin = rawVal;
                        if (rawVal > rawMax) rawMax = rawVal;

                        currentEma1 = (rawVal * smoothAlpha) + (currentEma1 * (1 - smoothAlpha));
                        currentEma2 = (currentEma1 * smoothAlpha) + (currentEma2 * (1 - smoothAlpha));
                        if (isNaN(currentEma2)) currentEma2 = 0;
                        
                        sum += currentEma2;
                        
                        if (currentEma2 < binMin) binMin = currentEma2;
                        if (currentEma2 > binMax) binMax = currentEma2;
                    }
                    
                    if (chunkStart < chunkEnd) {
                        binnedData.push({ x: px, yMin: binMin, yMax: binMax, rawMin: rawMin, rawMax: rawMax });
                        if (rawMin < rawMinTrack) rawMinTrack = rawMin;
                        if (rawMax > rawMaxTrack) rawMaxTrack = rawMax;
                        if (binMin < targetMin) targetMin = binMin;
                        if (binMax > targetMax) targetMax = binMax;
                    }
                }
                avgVal = displayCount > 0 ? (sum / displayCount) : 0;
                
                // Safe fallbacks if no data was found
                if (rawMinTrack > rawMaxTrack) { rawMinTrack = 0; rawMaxTrack = 10; }
                if (targetMin > targetMax) { targetMin = 0; targetMax = 10; }
                
                // --- AXIS 1: RAW GHOST JITTER (Independent Auto-Scaling) ---
                let rSpan = rawMaxTrack - rawMinTrack;
                if (rSpan < 0.1) {
                    let center = rawMinTrack + (rSpan / 2);
                    rawMinTrack = center - 0.5;
                    rawMaxTrack = center + 0.5;
                    rSpan = 1.0;
                }
                let paddedRawMin = rawMinTrack - (rSpan * 0.05);
                let paddedRawRange = rSpan * 1.1;
                let getPathY_Raw = (val) => sh - ((val - paddedRawMin) / paddedRawRange * sh);

                // --- AXIS 2: SMOOTH CHANNEL TREND (Strict Variance Scale) ---
                let targetRange = targetMax - targetMin;
                if (targetRange < 2.0) { 
                    let center = targetMin + (targetRange / 2); 
                    targetMin = center - 1.0; 
                    targetMax = center + 1.0; 
                }
                
                let maxDiff = Math.abs(targetMax - ch.bounds.max);
                let isDramaticallyOff = maxDiff > (Math.abs(ch.bounds.max) * 0.75 + 5);
                if (ch.boundsNeedSnap || (ch.bounds.max <= 10 && targetMax > 40) || isDramaticallyOff) { 
                    ch.bounds.min = targetMin; 
                    ch.bounds.max = targetMax; 
                    ch.boundsNeedSnap = false;
                } else { 
                    ch.bounds.min = (ch.bounds.min * 0.93) + (targetMin * 0.07); 
                    ch.bounds.max = (ch.bounds.max * 0.93) + (targetMax * 0.07); 
                }
                
                let range = ch.bounds.max - ch.bounds.min;
                let paddedMin = ch.bounds.min - (range * 0.1);
                let paddedRange = range * 1.2;
                let getPathY_Smooth = (val) => sh - ((val - paddedMin) / paddedRange * sh);

				// --- PASS 1: RAW GHOST JITTER (Drawn on Axis 1) ---
                sCtx.strokeStyle = 'rgba(255, 255, 255, 0.25)'; 
                sCtx.lineWidth = 1; 
                sCtx.beginPath();
                if (binnedData.length > 0) {
                    sCtx.moveTo(binnedData[0].x, getPathY_Raw(binnedData[0].rawMax));
                    for (let b = 1; b < binnedData.length; b++) {
                        sCtx.lineTo(binnedData[b].x, getPathY_Raw(binnedData[b].rawMax));
                        // Draw the vertical electrical spike if variance in this bin is noticeable
                        if (binnedData[b].rawMax - binnedData[b].rawMin > (rSpan * 0.005)) {
                            sCtx.lineTo(binnedData[b].x, getPathY_Raw(binnedData[b].rawMin));
                            sCtx.moveTo(binnedData[b].x, getPathY_Raw(binnedData[b].rawMax));
                        }
                    }
                }
                sCtx.stroke();

                // --- PASS 2: SMOOTH CHANNEL TREND (Drawn on Axis 2) ---
                sCtx.strokeStyle = window.CH_COLORS[i]; 
                sCtx.lineWidth = 2.5; 
                sCtx.lineJoin = "round"; 
                sCtx.lineCap = "round"; 
                sCtx.beginPath();
                if (binnedData.length > 0) {
                    sCtx.moveTo(binnedData[0].x, getPathY_Smooth((binnedData[0].yMin + binnedData[0].yMax) / 2));
                    for (let b = 1; b < binnedData.length; b++) {
                        let yMid = getPathY_Smooth((binnedData[b].yMin + binnedData[b].yMax) / 2);
                        sCtx.lineTo(binnedData[b].x, yMid);
                    }
                }
                sCtx.stroke();

                // --- PASS 3: NOTE HIGHLIGHTS ---
                let step = Math.max(1, Math.floor(displayCount / (sw > 0 ? sw : 500)));
                for(let j=0; j<displayCount; j+=step) {
                    let hasEvent = false; let eventNote = null;
                    for(let k=0; k<step && (j+k)<displayCount; k++) { let pt = renderWave[startIndex + j + k]; if(pt.evt === 1 && pt.n) { hasEvent = true; eventNote = pt.n; break; } }
                    if(hasEvent && eventNote) {
                        let x = j * (sw / (displayCount - 1));
                        sCtx.save();
                        sCtx.strokeStyle = `hsla(${(eventNote % 12) * 30}, 100%, 50%, 0.7)`;
                        sCtx.lineWidth = 1; sCtx.beginPath(); sCtx.moveTo(x, 0); sCtx.lineTo(x, sh); sCtx.stroke();
                        sCtx.restore();
                    }
                }
                                 
                if (!ch.lastHudTime || nowMs - ch.lastHudTime > 200) {
                    ch.lastHudTime = nowMs;
                    let curVal = renderWave[renderWave.length - 1].r || 0; 
                    let curTicks = renderWave.length > 0 ? renderWave[renderWave.length-1].ticks : 0;
                                         
                    if (renderViz && renderViz.length > 1) {
                        let vLen = renderViz.length;
                        ch.slew = renderViz[vLen - 1] - renderViz[vLen - 2];
                    }
                    let kOhm = curVal > 0 ? (1000 / curVal) : 0; 
                    let slw = (ch.slew || 0) * 100;
                                         
                    let valEl = document.getElementById(`hud-val-${i}`);
                    if(valEl) valEl.innerText = curVal.toFixed(1);
                    let kOhmEl = document.getElementById(`hud-kohm-${i}`);
                    if(kOhmEl) kOhmEl.innerText = kOhm.toFixed(1);
                    let ticksEl = document.getElementById(`hud-ticks-${i}`);
                    if(ticksEl) ticksEl.innerText = Math.round(curTicks);
                                         
                    let slewIconEl = document.getElementById(`hud-slew-icon-${i}`);
                    let slewValEl = document.getElementById(`hud-slew-val-${i}`);
                    if(slewIconEl && slewValEl) {
                        slewIconEl.innerText = slw > 0.1 ? '↑' : (slw < -0.1 ? '↓' : '~');
                        slewValEl.innerText = Math.abs(slw).toFixed(2);
                        let tCol = slw > 0.1 ? window.CH_COLORS[i] : (slw < -0.1 ? '#ff0055' : '#888');
                        let colEl = document.getElementById(`hud-slew-color-${i}`);
                        if(colEl) colEl.style.color = tCol;
                    }
                }
            }
                         
            sCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)'; 
            sCtx.lineWidth = 1; 
            sCtx.beginPath();
            for(let g=1; g<4; g++) { sCtx.moveTo(0, sh * (g/4)); sCtx.lineTo(sw, sh * (g/4)); }
            for(let g=1; g<10; g++) { sCtx.moveTo(sw * (g/10), 0); sCtx.lineTo(sw * (g/10), sh); }
            sCtx.stroke();
            
            sCtx.fillStyle = 'rgba(255, 255, 255, 0.6)'; sCtx.font = '11px monospace'; sCtx.textAlign = 'left'; sCtx.textBaseline = 'top';
            sCtx.fillText(`MAX: ${ch.bounds.max.toFixed(1)}`, 5, 5); sCtx.fillText(`AVG: ${avgVal.toFixed(1)}`, 5, 19);
            sCtx.textBaseline = 'bottom'; sCtx.fillText(`MIN: ${ch.bounds.min.toFixed(1)}`, 5, sh - 5);
                         
            rCtx.clearRect(0, 0, rw, rh); rCtx.strokeStyle = '#30363d'; rCtx.lineWidth = 1;
            for(let j=0; j<12; j++) { rCtx.beginPath(); rCtx.moveTo(0, j*(rh/12)); rCtx.lineTo(rw, j*(rh/12)); rCtx.stroke(); }
                         
            let validHist = ch.history ? ch.history.filter(h => h && isFinite(h.avg) && h.avg > 0.01) : [];
            if (validHist.length > 1) {
                let hMin = 1000000, hMax = 0;
                validHist.forEach(h => { if (h.min < hMin) hMin = h.min; if (h.max > hMax) hMax = h.max; });
                let hRange = hMax - hMin || 1; 
                let pMin = hMin - (hRange * 0.05); 
                let pRange = hRange * 1.1; 
                let getY = (val) => rh - ((val - pMin) / pRange * rh);
                                 
                rCtx.fillStyle = window.CH_COLORS[i] + '33'; 
                rCtx.beginPath();
                for(let j=0; j<validHist.length; j++) { let x = rw - ((validHist.length - 1 - j) * (rw / 300)); if (j === 0) rCtx.moveTo(x, getY(validHist[j].max)); else rCtx.lineTo(x, getY(validHist[j].max)); }
                for(let j=validHist.length-1; j>=0; j--) { let x = rw - ((validHist.length - 1 - j) * (rw / 300)); rCtx.lineTo(x, getY(validHist[j].min)); }
                rCtx.fill();
                                 
                rCtx.strokeStyle = '#ffffff'; 
                rCtx.lineWidth = 1.5; 
                rCtx.beginPath();
                for(let j=0; j<validHist.length; j++) { let x = rw - ((validHist.length - 1 - j) * (rw / 300)); if (j === 0) rCtx.moveTo(x, getY(validHist[j].avg)); else rCtx.lineTo(x, getY(validHist[j].avg)); }
                rCtx.stroke();
            }
                         
            if (ch.notes) {
                ch.notes = ch.notes.filter(n => nowMs - n.t < Math.max(30000, n.dur + 1000));
                ch.notes.forEach(note => {
                    rCtx.fillStyle = `hsla(${(note.n % 12) * 30}, 100%, 50%, ${Math.max(0.3, note.v / 127)})`; 
                    let visDur = note.dur; 
                    let w = (visDur / 30000) * rw;
                    rCtx.fillRect(rw - ((nowMs - note.t) / 30000 * rw) - w, Math.max(0, rh - ((note.n / 127) * rh) - 4), w, 8); 
                });
            }

            // --- THE THRESHOLD CONTROL METER WITH ZERO-PARALLAX DYNAMIC GEOMETRY ---
            let miniTC = document.getElementById(`ch-mini-vu-thresh-${i}`);
            if (miniTC && resizeCanvasToDisplaySize(miniTC) && window.synthChannels[i] && window.synthChannels[i].params) {
                let ctx = miniTC.getContext('2d');
                let w = miniTC.width, h = miniTC.height;
                ctx.clearRect(0, 0, w, h);
                
                let minMult = 1.0;
                let maxMult = Math.max(1.0, Math.min(10.0, window.synthChannels[i].params.threshMax || 5.0));
                let threshVal = Math.max(1.0, Math.min(maxMult, window.synthChannels[i].params.threshold));
                let span = Math.max(0.01, maxMult - minMult);
                let threshPct = Math.max(0, Math.min(1, (threshVal - minMult) / span));
                
                let currentMult = (ch.lastStdevi > 0) ? (ch.lastMaxDev / ch.lastStdevi) : 0;
                let targetPct = Math.max(0, Math.min(1, (currentMult - minMult) / span));
                
                if (ch.vizDeltaPct === undefined) ch.vizDeltaPct = 0;
                
                // Analog VU Dynamics
                if (targetPct > ch.vizDeltaPct) {
                    ch.vizDeltaPct += (targetPct - ch.vizDeltaPct) * 0.35; 
                } else {
                    ch.vizDeltaPct += (targetPct - ch.vizDeltaPct) * 0.06; 
                }
                
                if (!ch.peak) ch.peak = { val: 0, time: 0, vel: 0 };
                if (ch.vizDeltaPct > ch.peak.val) {
                    ch.peak.val = ch.vizDeltaPct;
                    ch.peak.time = nowMs;
                    ch.peak.vel = 0;
                } else if (nowMs - ch.peak.time > 400) {
                    ch.peak.vel += 0.001; 
                    ch.peak.val -= ch.peak.vel;
                    if (ch.peak.val < 0) { ch.peak.val = 0; ch.peak.vel = 0; }
                }
                let chColor = window.CH_COLORS[i] || '#00f0ff';
                
                const thumbW = 6;
                const trackW = Math.max(1, w - thumbW);
                const getX = (pct) => (thumbW / 2) + (pct * trackW);
                
                const threshX = getX(threshPct);
                const signalX = getX(ch.vizDeltaPct);
                const peakX = getX(ch.peak.val);
                
                ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
                ctx.fillRect(0, 0, w, h);
                
                let baseFillX = Math.min(signalX, threshX);
                ctx.globalAlpha = 0.2;
                ctx.fillStyle = chColor;
                ctx.fillRect(0, 0, baseFillX, h);
                
                if (signalX > threshX) {
                    let grd = ctx.createLinearGradient(threshX, 0, signalX, 0);
                    grd.addColorStop(0, chColor);
                    grd.addColorStop(1, '#ffffff');
                    ctx.globalAlpha = 0.65;
                    ctx.fillStyle = grd;
                    ctx.fillRect(threshX, 0, signalX - threshX, h);
                }
                
                ctx.globalAlpha = 1.0;
                ctx.fillStyle = chColor;
                ctx.fillRect(Math.max(0, signalX - 1), 0, 1.5, h);
                
                if (ch.peak.val > 0) {
                    let isOver = (ch.peak.val > threshPct);
                    ctx.fillStyle = isOver ? '#ffffff' : chColor;
                    ctx.globalAlpha = isOver ? 1.0 : 0.6;
                    if (isOver) { ctx.shadowBlur = 5; ctx.shadowColor = chColor; }
                    ctx.fillRect(Math.max(0, peakX - 1), h * 0.25, 2, h * 0.5);
                    ctx.shadowBlur = 0;
                }
                
                ctx.globalAlpha = 0.9;
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(Math.round(threshX), 0, 1.5, h);
                
                ctx.globalAlpha = 0.15;
                for (let t = 0.2; t < 1.0; t += 0.2) {
                    let tx = getX(t);
                    ctx.fillRect(Math.round(tx), h - 3, 1, 3);
                }
                ctx.globalAlpha = 1.0;
            }
        }
        
        if (typeof activeSynthIndex !== 'undefined' && chData[activeSynthIndex]) {
            let actCh = chData[activeSynthIndex];
            let cColor = window.CH_COLORS[activeSynthIndex] || '#fff';
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
    } catch (err) { console.error("Visualizer Render Error:", err); }
}
