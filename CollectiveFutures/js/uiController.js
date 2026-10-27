/**
 * js/uiController.js
 */

window.syncTimers = {};
window.debouncedHardwareSync = function(chIdx) {
    if (!window.bleTxCharacteristic) return;
    clearTimeout(window.syncTimers[chIdx]);
    window.syncTimers[chIdx] = setTimeout(() => {
        if (typeof window.syncParamsToHardware === 'function') {
            window.syncParamsToHardware(chIdx);
        }
    }, 100); 
};

const paramTooltip = document.createElement('div');
paramTooltip.id = 'param-tooltip';
paramTooltip.style.cssText = 'position: fixed; pointer-events: none; opacity: 0; transition: opacity 0.2s ease; background: rgba(10, 13, 18, 0.95); border: 1px solid var(--border); padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 14px; z-index: 9999; transform: translate(-50%, -150%); font-family: monospace; box-shadow: 0 4px 10px rgba(0,0,0,0.8);';
document.body.appendChild(paramTooltip);

let tooltipTimer;

const paramFormats = {
    'cutoff': v => Math.round(v) + ' Hz',
    'drvTone': v => Math.round(v) + ' Hz',
    'damp': v => Math.round(v) + ' Hz',
    'hpf': v => Math.round(v) + ' Hz',
    'rate': v => v < 10 ? v.toFixed(2) + ' Hz' : Math.round(v) + ' Hz',
    'atk': v => v.toFixed(2) + 's',
    'dec': v => v.toFixed(2) + 's',
    'rel': v => v.toFixed(2) + 's',
    'glide': v => v.toFixed(2) + 's',
    'time': v => v.toFixed(2) + 's',
    'depth': v => Math.round(v * 100) + '%',
    'sus': v => Math.round(v * 100) + '%',
    'spread': v => Math.round(v) + '%',
    'density': v => Math.round(v) + '%',
    'drv': v => Math.round(v * 100) + '%',
    'drvGrit': v => Math.round(v) + '%',
    'drvLvl': v => Math.round(v * 100) + '%',
    'feedback': v => Math.round(v * 100) + '%',
    'toRev': v => Math.round(v * 100) + '%',
    'level': v => Math.round(v * 100) + '%',
    'mixVol': v => Math.round(v * 100) + '%',
    'res': v => v.toFixed(1),
    'durMult': v => {
        let maxMs = v <= 1.0 
            ? 500 + ((v - 0.1) / 0.9) * 5150 
            : 5650 + ((v - 1.0) / 4.0) * 24350;
        return `MAX: ${(maxMs / 1000).toFixed(1)}s`;
    },
    'size': v => v.toFixed(1) + 'x',
    'voices': v => Math.round(v),
    'quantize': v => { const q = ['FR', '/64', '/32', '/16', '/8', '/4', '/4T', '/2', '1B']; return `QUANT: ${q[Math.round(v)]}`; },
    'noteMin': v => { let m = Math.round(v); return `MIN: ${['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][m%12]}${Math.floor(m/12)-2}`; },
    'noteMax': v => { let m = Math.round(v); return `MAX: ${['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][m%12]}${Math.floor(m/12)-2}`; },
    'velMin': v => `MIN: ${Math.round(v)}`,
    'velMax': v => `MAX: ${Math.round(v)}`,
    'default': v => v.toFixed(2)
};

function getParamColor(param, group, el) {
    if (el.classList.contains('slider-master')) return 'var(--cyan)';
    if (el.id.startsWith('ch-vol-')) {
        const ch = parseInt(el.id.replace('ch-vol-', ''));
        return window.CH_COLORS[ch];
    }
    if (group === 'filter') return 'var(--green)';
    if (group === 'lfo' || group === 'env') return 'var(--mod-color)';
    if (group === 'fx' || (group && group.startsWith('globalFx'))) return 'var(--fx-color)';
    return 'var(--cyan)';
}

function showTooltip(x, y, val, param, group, el) {
    clearTimeout(tooltipTimer);
    const formatter = paramFormats[param] || paramFormats.default;
    paramTooltip.innerText = formatter(val);
    paramTooltip.style.color = getParamColor(param, group, el);
    paramTooltip.style.left = x + 'px';
    paramTooltip.style.top = y + 'px';
    paramTooltip.style.opacity = 1;
}

function hideTooltip() {
    tooltipTimer = setTimeout(() => { paramTooltip.style.opacity = 0; }, 800);
}

document.addEventListener('input', (e) => {
    
    // --- THE FIX: Aggressive Wildcard Catch for ANY Threshold Slider ---
    if (e.target.id && (e.target.id.toLowerCase().includes('thresh') || e.target.id.toLowerCase().includes('window'))) {
        let ch = activeSynthIndex; // Default to active tab if no number found
        let match = e.target.id.match(/\d+/);
        if (match) ch = parseInt(match[0]);
        
        if (synthChannels[ch]) {
            if (e.target.id.toLowerCase().includes('thresh')) {
                synthChannels[ch].params.threshold = parseFloat(e.target.value);
            } else {
                synthChannels[ch].params.sampleSize = parseInt(e.target.value);
            }
            window.debouncedHardwareSync(ch);
        }
    }

    if (e.target.classList.contains('v-slider') || e.target.classList.contains('dual-slider-input')) {
        if (e.target.id === 'ui-test-injector') return; 

        let slider = e.target;
        let val = parseFloat(slider.value);
        
        let param = 'default';
        let group = '';
        
        if (slider.id.startsWith('ui-env-')) {
            param = slider.id.replace('ui-env-', ''); group = 'env';
        } else if (slider.id === 'ui-fx-drv-lvl') {
            param = 'drvLvl'; group = 'fx';
        } else if (slider.id === 'ui-fx-torev') {
            param = 'toRev'; group = 'fx';
        } else if (slider.id === 'ui-fx-rev-hpf') {
            param = 'hpf'; group = 'fx';
        } else if (slider.id.includes('vol')) {
            param = 'mixVol';
        } else if (slider.id === 'ui-note-min') param = 'noteMin';
        else if (slider.id === 'ui-note-max') param = 'noteMax';
        else if (slider.id === 'ui-vel-min') param = 'velMin';
        else if (slider.id === 'ui-vel-max') param = 'velMax';
        
        let rect = slider.getBoundingClientRect();
        let x, y;
        
        if (slider.classList.contains('v-slider')) {
            x = rect.left + (rect.width / 2);
            y = rect.top - 15; 
        } else {
            let min = parseFloat(slider.min) || 0;
            let max = parseFloat(slider.max) || 127;
            let pct = (val - min) / (max - min);
            x = rect.left + (rect.width * pct);
            y = rect.top - 15;
        }
        
        showTooltip(x, y, val, param, group, slider);
    }
});

document.addEventListener('pointerup', (e) => {
    if (e.target.classList.contains('v-slider') || e.target.classList.contains('dual-slider-input')) {
        hideTooltip();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    
    document.body.addEventListener('pointerdown', () => {
        if (typeof window.audioCtx !== 'undefined' && window.audioCtx.state === 'suspended') {
            window.audioCtx.resume().catch(()=>{});
        }
    }, { once: true });
    
    const makeSlidersDraggable = () => {
        document.querySelectorAll('input[type="range"]').forEach(slider => {
            if (slider.classList.contains('v-slider') || slider.classList.contains('dual-slider-input')) return; 
            
            let isDragging = false, startY = 0, startX = 0, startVal = 0;
            
            slider.addEventListener('mousedown', (e) => {
                isDragging = true; 
                let min = parseFloat(slider.min) || 0;
                let max = parseFloat(slider.max) || 100;
                let step = parseFloat(slider.step) || 1;
                
                let rect = slider.getBoundingClientRect();
                let clickPct = (e.clientX - rect.left) / rect.width;
                let clickedVal = min + clickPct * (max - min);
                let steppedVal = Math.round(clickedVal / step) * step;
                
                slider.value = steppedVal;
                slider.dispatchEvent(new Event('input'));
                
                startY = e.clientY; 
                startX = e.clientX;
                startVal = parseFloat(slider.value);
                
                e.preventDefault(); 
            });

            window.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                
                let min = parseFloat(slider.min) || 0;
                let max = parseFloat(slider.max) || 100;
                let step = parseFloat(slider.step) || 1;
                
                let deltaX = e.clientX - startX;
                let deltaY = startY - e.clientY; 
                
                let width = slider.clientWidth || 100;
                
                let coarseChange = (deltaX / width) * (max - min);
                let fineChange = (deltaY / 1000) * (max - min);
                
                let newVal = startVal + coarseChange + fineChange;
                newVal = Math.max(min, Math.min(max, newVal));
                
                let steppedVal = Math.round(newVal / step) * step;
                
                if (Math.abs(parseFloat(slider.value) - steppedVal) >= step/2) {
                    slider.value = steppedVal;
                    slider.dispatchEvent(new Event('input')); 
                    
                    let param = slider.id.replace('ui-env-', '').replace('ui-fx-', '');
                    if (slider.id.includes('vol')) param = 'mixVol';
                    if (slider.id.includes('density')) param = 'density';
                    if (slider.id === 'ui-quantize') param = 'quantize';
                    
                    let group = '';
                    if (slider.id.includes('env')) group = 'env';
                    if (slider.id.includes('fx')) group = 'fx';
                    
                    if (slider.id !== 'ui-test-injector') showTooltip(e.clientX, e.clientY - 20, steppedVal, param, group, slider);
                }
            });

            window.addEventListener('mouseup', () => { 
                isDragging = false;
                hideTooltip();
            });
        });
    };

    let bpmDisplay = document.getElementById('ui-bpm-display');
    if (bpmDisplay) {
        let isDraggingBpm = false, startY = 0, startBpm = 120;
        bpmDisplay.addEventListener('pointerdown', (e) => {
            if (window.midiClockMode === 'in') return; 
            isDraggingBpm = true;
            startY = e.clientY;
            startBpm = window.masterBPM;
            e.preventDefault();
        });
        window.addEventListener('pointermove', (e) => {
            if (!isDraggingBpm) return;
            let deltaY = startY - e.clientY; 
            let newBpm = startBpm + (deltaY * 0.5); 
            newBpm = Math.max(60, Math.min(240, newBpm));
            window.masterBPM = newBpm;
            syncUI(); 
        });
        window.addEventListener('pointerup', () => { isDraggingBpm = false; });
    }

    const attachSlider = (id, paramKey, labelId, formatFn) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            let val = parseFloat(e.target.value);
            if (synthChannels[activeSynthIndex]) {
                synthChannels[activeSynthIndex].params[paramKey] = val;
                if (labelId && formatFn) document.getElementById(labelId).innerText = formatFn(val);
                if (paramKey !== 'testIntensity') window.debouncedHardwareSync(activeSynthIndex);
            }
        });
    };

    attachSlider('ui-slider-density', 'density', 'ui-density-display', v => v + '%');

    const nMin = document.getElementById('ui-note-min'), nMax = document.getElementById('ui-note-max');
    const nFill = document.getElementById('note-fill'), nText = document.getElementById('note-range-text');
    const midiToNote = (m) => ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][m%12] + (Math.floor(m/12)-2);
    
    const updateNote = () => {
        if(!synthChannels[activeSynthIndex]) return;
        let min = parseInt(nMin.value), max = parseInt(nMax.value);
        if (min > max) { let t = min; min = max; max = t; }
        if(nFill) { nFill.style.left = (min / 127 * 100) + '%'; nFill.style.width = ((max - min) / 127 * 100) + '%'; }
        if(nText) nText.innerText = `${midiToNote(min)} (${min}) ↔ ${midiToNote(max)} (${max})`;
        synthChannels[activeSynthIndex].params.minNote = min;
        synthChannels[activeSynthIndex].params.maxNote = max;
        window.debouncedHardwareSync(activeSynthIndex);
    };
    if(nMin) nMin.addEventListener('input', updateNote);
    if(nMax) nMax.addEventListener('input', updateNote);

    const vMin = document.getElementById('ui-vel-min'), vMax = document.getElementById('ui-vel-max');
    const vFill = document.getElementById('vel-fill');
    const vText = document.getElementById('ui-vel-text');
    
    const updateVel = () => {
        if(!synthChannels[activeSynthIndex]) return;
        let min = parseInt(vMin.value), max = parseInt(vMax.value);
        if (min > max) { let t = min; min = max; max = t; }
        if(vFill) { vFill.style.left = (min / 127 * 100) + '%'; vFill.style.width = ((max - min) / 127 * 100) + '%'; }
        if(vText) vText.innerText = `${min} ↔ ${max}`;
        synthChannels[activeSynthIndex].params.velMin = min;
        synthChannels[activeSynthIndex].params.velMax = max;
        window.debouncedHardwareSync(activeSynthIndex);
    };
    if(vMin) vMin.addEventListener('input', updateVel);
    if(vMax) vMax.addEventListener('input', updateVel);

    const qSlider = document.getElementById('ui-quantize');
    if(qSlider) {
        qSlider.addEventListener('input', (e) => {
            if(!synthChannels[activeSynthIndex]) return;
            let val = parseInt(e.target.value);
            synthChannels[activeSynthIndex].params.quantize = val;
            const spans = e.target.nextElementSibling.querySelectorAll('span');
            spans.forEach(s => { s.style.color = '#666'; s.style.fontWeight = 'normal'; });
            if(spans[val]) { spans[val].style.color = 'var(--cyan)'; spans[val].style.fontWeight = 'bold'; }
            window.debouncedHardwareSync(activeSynthIndex);
        });
    }

    setTimeout(makeSlidersDraggable, 500); 
    setTimeout(() => { selectTab(0); }, 100);
});

function buildMixerAndMidiUI() {
    for (let i = 0; i < 4; i++) {
        const select = document.getElementById(`ui-midi-ch-${i}`);
        if(select) {
            select.innerHTML = ''; 
            for (let ch = 0; ch < 16; ch++) {
                let opt = document.createElement('option');
                opt.value = ch; opt.text = `MIDI CH ${ch + 1}`;
                if (ch === i) opt.selected = true; 
                select.appendChild(opt);
            }
        }
    }

    const mixerContent = document.getElementById('mixer-dropdown-content');
    if (!mixerContent) return;
    
    let html = '';
    for(let i=0; i<4; i++) {
        html += `
        <div class="strip">
            <div class="strip-label" style="color: ${window.CH_COLORS ? window.CH_COLORS[i] : 'hsl('+(i*90)+', 100%, 60%)'}; margin-bottom: 5px;">CH ${i+1}</div>
            <div class="strip-controls">
                <div class="v-slider-container"><input type="range" id="ch-vol-${i}" class="v-slider slider-ch-${i}" min="0" max="1" step="0.01" value="0.8" oninput="synthChannels[${i}].setVolume(this.value)"></div>
                <canvas class="vu ch-vu" id="vu-${i}"></canvas>
            </div>
            <button id="mute-btn-${i}" onclick="synthChannels[${i}].toggleMute(); this.style.backgroundColor = synthChannels[${i}].params.muted ? 'var(--red)' : 'transparent'; this.style.color = synthChannels[${i}].params.muted ? '#000' : 'var(--text)';" style="width: 100%; margin-top: 5px; padding: 4px 0; font-size: 11px; font-weight: bold; background: transparent; border: 1px solid var(--border); color: var(--text); cursor: pointer; border-radius: 12px;">M</button>        </div>`;
    }
    
    html += `
        <div class="strip master" style="border-left: 1px solid var(--border); padding-left: 15px; border-right: none !important;">
            <div class="strip-label" style="color: var(--cyan); margin-bottom: 5px;">MIX</div>
            <div class="strip-controls" style="justify-content: center; width: 100%;">
                <div class="v-slider-container"><input type="range" id="master-vol-slider" class="v-slider slider-master" min="0" max="1" step="0.01" value="1.0" oninput="window.masterVolumeLevel = parseFloat(this.value); if(!window.isMasterMuted) window.masterGain.gain.value = window.masterVolumeLevel;"></div>
            </div>
            <div style="height: 25px; margin-top: 5px;"></div>
        </div>`;
    mixerContent.innerHTML = html;
}

function updateMidiChannel(synthCh, midiCh) { 
    if (synthChannels[synthCh]) {
        synthChannels[synthCh].params.midiOutCh = parseInt(midiCh); 
        window.debouncedHardwareSync(synthCh);
    }
}

function toggleMasterMute() {
    window.isMasterMuted = !window.isMasterMuted;
    if(window.masterGain) window.masterGain.gain.value = window.isMasterMuted ? 0 : window.masterVolumeLevel;
    const btn = document.getElementById('btn-master-mute');
    if(btn) {
        btn.style.backgroundColor = window.isMasterMuted ? 'var(--red)' : 'transparent';
        btn.style.color = window.isMasterMuted ? '#000' : 'var(--red)';
    }
}

function tapTempo() {
    if (window.midiClockMode === 'in') return;
    const now = performance.now();
    if (!window.tapTimes) window.tapTimes = [];
    window.tapTimes.push(now);
    if (window.tapTimes.length > 4) window.tapTimes.shift();
    if (window.tapTimes.length >= 2) {
        let intervals = [];
        for(let i=1; i<window.tapTimes.length; i++) intervals.push(window.tapTimes[i] - window.tapTimes[i-1]);
        let avg = intervals.reduce((a,b)=>a+b)/intervals.length;
        let newBpm = 60000 / avg;
        if(newBpm >= 60 && newBpm <= 240) { 
            window.masterBPM = newBpm; 
            syncUI(); 
            if (window.bleTxCharacteristic && typeof window.sendHardwareCC === 'function') {
                for (let i=0; i<4; i++) window.sendHardwareCC(i, 92, Math.min(127, Math.max(0, ((window.masterBPM - 60) / 180) * 127)));
            }
        }
    }
    
    let bpmLed = document.getElementById('top-bpm-led');
    if(bpmLed) {
        bpmLed.style.backgroundColor = 'var(--red)';
        bpmLed.style.boxShadow = '0 0 10px var(--red)';
        setTimeout(() => { bpmLed.style.backgroundColor = '#222'; bpmLed.style.boxShadow = 'none'; }, 50);
    }
}

function initPiano() {
    const p = document.getElementById('piano-keys'); 
    if (!p) return;
    p.innerHTML = '';
    
    const whiteKeys = [0, 2, 4, 5, 7, 9, 11];
    const blackKeys = [1, 3, null, 6, 8, 10]; 
    
    whiteKeys.forEach(noteIdx => { 
        let k = document.createElement('div'); 
        k.className = 'key-w active'; 
        k.id = `pkey-${noteIdx}`; 
        k.addEventListener('pointerdown', (e) => {
            e.preventDefault(); 
            togglePianoKey(noteIdx);
        });
        p.appendChild(k); 
    });
    
    blackKeys.forEach((noteIdx, i) => { 
        if (noteIdx !== null) { 
            let k = document.createElement('div'); 
            k.className = 'key-b active'; 
            k.id = `pkey-${noteIdx}`; 
            k.style.left = `${(i + 1) * 14.28}%`; 
            k.addEventListener('pointerdown', (e) => {
                e.preventDefault(); 
                togglePianoKey(noteIdx);
            });
            p.appendChild(k); 
        } 
    });
}

function selectTab(index) { 
    activeSynthIndex = index; 
    document.querySelectorAll('.synth-tab').forEach((t, i) => {
        t.classList.toggle('active', i === index);
        let led = t.querySelector('.led');
        if (led) {
            if (i === index) {
                led.style.backgroundColor = window.CH_COLORS[i];
                led.style.boxShadow = `0 0 8px ${window.CH_COLORS[i]}`;
            } else {
                led.style.backgroundColor = '#222';
                led.style.boxShadow = 'inset 0px 2px 4px rgba(0,0,0,0.8)';
            }
        }
    }); 
    syncUI(); 
}

function triggerLED(index) { const led = document.getElementById(`led-${index}`); if (led) { led.classList.add('active'); setTimeout(() => led.classList.remove('active'), 100); } }
function setVolume(ch, val) { if (synthChannels[ch]) synthChannels[ch].setVolume(val); }
function toggleMute(ch) { if (synthChannels[ch]) synthChannels[ch].toggleMute(); }

window.syncParamsToHardware = function(chIdx) {
    if (!synthChannels[chIdx]) return;
    const p = synthChannels[chIdx].params;
    
    if (typeof window.sendHardwareCC === 'function') {
        window.sendHardwareCC(chIdx, 81, Math.min(127, Math.max(0, ((p.threshold - 0.05) / 4.95) * 127)));
        window.sendHardwareCC(chIdx, 82, Math.min(127, Math.max(0, ((p.sampleSize - 10) / 90) * 127)));
        window.sendHardwareCC(chIdx, 83, Math.min(127, Math.max(0, (p.density / 100) * 127))); 
        window.sendHardwareCC(chIdx, 84, p.minNote);
        window.sendHardwareCC(chIdx, 85, p.maxNote);
        window.sendHardwareCC(chIdx, 86, p.velMin);
        window.sendHardwareCC(chIdx, 87, p.velMax);
        window.sendHardwareCC(chIdx, 88, Math.min(127, Math.max(0, (p.spread / 100) * 127)));
        window.sendHardwareCC(chIdx, 89, Math.min(127, Math.max(0, ((p.durMult - 0.1) / 4.9) * 127)));
        window.sendHardwareCC(chIdx, 90, Math.min(127, Math.max(0, (p.quantize / 8) * 127)));
        window.sendHardwareCC(chIdx, 91, Math.min(127, Math.max(0, (p.midiOutCh / 15) * 127)));
        window.sendHardwareCC(chIdx, 92, Math.min(127, Math.max(0, ((window.masterBPM - 60) / 180) * 127)));
        window.sendHardwareCC(chIdx, 93, Math.min(127, Math.max(0, ((p.voices - 1) / 7) * 127)));
        
        let stealVal = p.stealMode === 'oldest' ? 0 : (p.stealMode === 'lowest' ? 42 : (p.stealMode === 'highest' ? 84 : 127));
        window.sendHardwareCC(chIdx, 94, stealVal);
        window.sendHardwareCC(chIdx, 95, p.legato === 1 ? 127 : 0);
    }
    
    let mask = 0;
    for (let i = 0; i < 12; i++) {
        if (p.activeScaleBits[i]) mask |= (1 << i);
    }
    if (typeof window.sendHardwareScale === 'function') window.sendHardwareScale(chIdx, mask);
};

function updateActiveSynth(param, value) {
    if (param === 'bpm') {
        if (window.midiClockMode === 'in') return;
        window.masterBPM = isNaN(value) ? window.masterBPM : parseFloat(value);
        syncUI();
        if (window.bleTxCharacteristic && typeof window.sendHardwareCC === 'function') {
            for (let i=0; i<4; i++) window.sendHardwareCC(i, 92, Math.min(127, Math.max(0, ((window.masterBPM - 60) / 180) * 127)));
        }
        return;
    }
    
    if (!synthChannels[activeSynthIndex]) return;
    
    if (param === 'stealMode' || param === 'scaleType' || param === 'scaleRoot') {
        synthChannels[activeSynthIndex].params[param] = value;
    } else {
        synthChannels[activeSynthIndex].params[param] = isNaN(value) ? value : parseFloat(value);
    }
    
    if (param === 'scaleType' || param === 'scaleRoot') {
        const p = synthChannels[activeSynthIndex].params;
        if (p.scaleType !== 'custom') {
            p.activeScaleBits.fill(false); 
            window.SCALES[p.scaleType].forEach(deg => { 
                p.activeScaleBits[(parseInt(p.scaleRoot) + deg) % 12] = true; 
            });
            if (typeof syncPianoUI === 'function') syncPianoUI();
        }
    }
    
    synthChannels[activeSynthIndex].applyParams();
    window.markChannelDirty(activeSynthIndex);

    if (param !== 'testIntensity' && param !== 'testInjector') {
        window.debouncedHardwareSync(activeSynthIndex);
    }
}

function togglePianoKey(noteIdx) {
    if(!synthChannels[activeSynthIndex]) return;
    
    synthChannels[activeSynthIndex].params.activeScaleBits[noteIdx] = !synthChannels[activeSynthIndex].params.activeScaleBits[noteIdx];
    document.getElementById('ui-scaleType').value = 'custom'; 
    updateActiveSynth('scaleType', 'custom'); 
    syncPianoUI();
}

// --- GLOBAL PRESET ENGINE ---
let globalPresets = {};

function loadPresetsFromStorage() {
    try {
        const stored = localStorage.getItem('biodataPresets');
        if (stored) globalPresets = JSON.parse(stored);
        else globalPresets = {};
    } catch(e) { console.error("Error loading presets", e); }
    updatePresetDropdown();
    
    if (typeof loadChannelPresetsFromStorage === 'function') {
        loadChannelPresetsFromStorage(); 
    }
}

function updatePresetDropdown() {
    const select = document.getElementById('preset-select');
    if(!select) return;
    
    select.onchange = (e) => {
        loadPreset(e.target.value);
    };

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Select --</option>';
    Object.keys(globalPresets).forEach(name => {
        let opt = document.createElement('option');
        opt.value = name; opt.text = name; select.appendChild(opt);
    });
    select.value = globalPresets[currentVal] ? currentVal : "";
}

function savePreset(forceNew = false) {
    if(typeof ensureSynths === 'function') ensureSynths();
    const select = document.getElementById('preset-select');
    let name = select ? select.value : "";

    if (forceNew || !name || name === "") {
        name = prompt("Enter a name for this preset:");
        if (!name || name.trim() === "") return;
    }
    
    const presetData = {
        channels: synthChannels.map(ch => {
            let p = JSON.parse(JSON.stringify(ch.params));
            p.savedPatchName = ch.patchName || "INIT";
            return p;
        }),
        master: { vol: window.masterVolumeLevel, muted: window.isMasterMuted, bpm: window.masterBPM },
        viz: chData.map(ch => JSON.parse(JSON.stringify(ch.config))),
        globalFX: window.globalFX ? JSON.parse(JSON.stringify(window.globalFX)) : null
    }; 
    
    globalPresets[name] = presetData;
    localStorage.setItem('biodataPresets', JSON.stringify(globalPresets));
    updatePresetDropdown();
    if(select) select.value = name;
}

function deleteCurrentPreset() {
    const select = document.getElementById('preset-select');
    let name = select ? select.value : "";
    if (!name || name === "") return alert("No preset selected to delete.");
    
    if(confirm(`Are you sure you want to delete the preset "${name}"?`)) {
        delete globalPresets[name];
        localStorage.setItem('biodataPresets', JSON.stringify(globalPresets));
        updatePresetDropdown();
        if(select) select.value = "";
    }
}

function loadPreset(name) {
    if (!name || !globalPresets[name]) return;
    if(typeof ensureSynths === 'function') ensureSynths();
    const presetData = globalPresets[name];
    const channelData = presetData.channels || presetData; 
    
    for (let i = 0; i < 4; i++) {
        if (channelData[i] && synthChannels[i]) {
            synthChannels[i].params = JSON.parse(JSON.stringify(channelData[i]));
            synthChannels[i].applyParams();
            
            synthChannels[i].patchName = synthChannels[i].params.savedPatchName || "INIT";
            
            if (synthChannels[i].channelOut) {
                synthChannels[i].channelOut.gain.value = synthChannels[i].params.muted ? 0 : synthChannels[i].params.mixVol;
            }
            
            let volSlider = document.getElementById(`ch-vol-${i}`);
            if (volSlider) volSlider.value = synthChannels[i].params.mixVol;
            let muteBtn = document.getElementById(`mute-btn-${i}`);
            if (muteBtn) {
                muteBtn.style.backgroundColor = synthChannels[i].params.muted ? 'var(--red)' : 'transparent';
                muteBtn.style.color = synthChannels[i].params.muted ? '#000' : 'var(--text)';
            }

            let midiSel = document.getElementById(`ui-midi-ch-${i}`);
            if (midiSel) midiSel.value = synthChannels[i].params.midiOutCh;
            
            let miniT = document.getElementById(`ch-mini-thresh-${i}`);
            let miniV = document.getElementById(`ch-val-thresh-${i}`);
            if (miniT) miniT.value = synthChannels[i].params.threshold;
            if (miniV) miniV.innerText = parseFloat(synthChannels[i].params.threshold).toFixed(2) + 'x';
            
            let miniW = document.getElementById(`ch-window-${i}`);
            let miniWV = document.getElementById(`ch-val-window-${i}`);
            if (miniW) miniW.value = synthChannels[i].params.sampleSize;
            if (miniWV) miniWV.innerText = synthChannels[i].params.sampleSize;
        }
        
        if (presetData.viz && presetData.viz[i] && chData[i]) {
            chData[i].config = JSON.parse(JSON.stringify(presetData.viz[i]));
            let z = document.getElementById(`ch-zoom-${i}`);
            let s = document.getElementById(`ch-smooth-${i}`);
            let zVal = document.getElementById(`ch-val-zoom-${i}`);
            let sVal = document.getElementById(`ch-val-smooth-${i}`);
            
            if(z) { 
                let minL = Math.log(50), maxL = Math.log(120000);
                let zPos = ((Math.log(chData[i].config.zoom) - minL) / (maxL - minL)) * 1000;
                z.value = zPos;
            }
            if(s) { s.value = chData[i].config.smooth; }
            if(zVal) zVal.innerText = Math.round(chData[i].config.zoom);
            if(sVal) sVal.innerText = chData[i].config.smooth.toFixed(2); 
        }

        if (synthChannels[i]) {
            synthChannels[i].isDirty = false;
            let pName = synthChannels[i].patchName;
            
            if (pName !== "INIT") {
                if (globalChannelPresets[pName]) {
                    let canonical = globalChannelPresets[pName];
                    
                    let cParams = JSON.parse(JSON.stringify(canonical.params));
                    let currParams = JSON.parse(JSON.stringify(synthChannels[i].params));
                    delete cParams.savedPatchName;
                    delete currParams.savedPatchName;
                    
                    let isParamDirty = JSON.stringify(cParams) !== JSON.stringify(currParams);
                    let isConfigDirty = false;
                    
                    if (canonical.config && chData[i]) {
                        isConfigDirty = JSON.stringify(canonical.config) !== JSON.stringify(chData[i].config);
                    }
                    
                    if (isParamDirty || isConfigDirty) {
                        synthChannels[i].isDirty = true;
                    }
                } else {
                    synthChannels[i].isDirty = true;
                }
            }
        }
    }
    
    if (presetData.master) {
        window.masterVolumeLevel = presetData.master.vol;
        window.isMasterMuted = presetData.master.muted;
        if(window.masterGain) window.masterGain.gain.value = window.isMasterMuted ? 0 : window.masterVolumeLevel;
        
        let mSlider = document.getElementById('master-vol-slider');
        if (mSlider) mSlider.value = window.masterVolumeLevel;
        
        const btn = document.getElementById('btn-master-mute');
        if (btn) {
            btn.style.backgroundColor = window.isMasterMuted ? 'var(--red)' : 'transparent';
            btn.style.color = window.isMasterMuted ? '#000' : 'var(--red)';
        }
        
        if (presetData.master.bpm) { 
            window.masterBPM = presetData.master.bpm; 
        }
    }

    if (presetData.globalFX && window.globalFX) {
        window.globalFX = JSON.parse(JSON.stringify(presetData.globalFX));
        if (window.masterFX) window.masterFX.updateParams(window.globalFX);
    }
    
    if (typeof updateChannelPresetDropdowns === 'function') updateChannelPresetDropdowns();
    
    syncUI();

    for (let i=0; i<4; i++) {
        if (typeof window.syncParamsToHardware === 'function') window.syncParamsToHardware(i);
    }
}

function exportPresets() {
    if (Object.keys(globalPresets).length === 0) { alert("No presets to export."); return; }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(globalPresets, null, 2));
    const downloadNode = document.createElement('a');
    downloadNode.setAttribute("href", dataStr);
    downloadNode.setAttribute("download", "biodata_presets.json");
    document.body.appendChild(downloadNode); downloadNode.click(); downloadNode.remove();
}

function importPresets(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (typeof imported === 'object' && imported !== null) {
                globalPresets = { ...globalPresets, ...imported };
                localStorage.setItem('biodataPresets', JSON.stringify(globalPresets));
                updatePresetDropdown();
                alert("Presets imported successfully!");
            } else alert("Invalid preset file format.");
        } catch(err) { alert("Error parsing preset file."); }
        event.target.value = "";
    };
    reader.readAsText(file);
}

function clearAllPresets() {
    if(confirm("Are you sure you want to delete all saved presets? This cannot be undone.")) {
        localStorage.removeItem('biodataPresets');
        globalPresets = {};
        updatePresetDropdown();
        alert("All presets have been cleared.");
    }
}

let activeLfoView = 'pitchLfo';
let activeEnvView = 'ampEnv';
let activeFxView = 'drv';

function switchModView(type, targetView) {
    const root = document.documentElement;
    if (type === 'lfo') {
        activeLfoView = targetView;
        const modColorMap = { 'pitchLfo': 'var(--red)', 'filterLfo': 'var(--green)', 'ampLfo': 'var(--cyan)' };
        root.style.setProperty('--mod-color', modColorMap[targetView]);
    }
    if (type === 'env') {
        activeEnvView = targetView;
    }
    if (type === 'fx') {
        activeFxView = targetView;
        const fxColorMap = { 'drv': 'var(--orange)', 'dly': 'var(--purple)', 'rev': 'var(--yellow)' };
        root.style.setProperty('--fx-color', fxColorMap[targetView]);

        document.querySelectorAll('.fx-params').forEach(el => el.style.display = 'none');
        let targetGroup = document.querySelectorAll(`.fx-${targetView}-params`);
        if (targetGroup) targetGroup.forEach(el => el.style.display = 'flex');
        
        let sendKnob = document.getElementById('fx-send-knob');
        if (sendKnob) sendKnob.dataset.param = targetView;

        const fxLabels = {
            'drv': { p1: 'GRIT', p2: 'TONE', s: 'LVL' },
            'dly': { p1: 'TIME', p2: 'FDBK', s: '>REV' },
            'rev': { p1: 'SIZE', p2: 'DAMP', s: 'HPF' }
        };
        let l1 = document.getElementById('fx-lbl-p1');
        let l2 = document.getElementById('fx-lbl-p2');
        let ls = document.getElementById('fx-lbl-s');
        if(l1) { l1.style.opacity = 0; setTimeout(()=> { l1.textContent = fxLabels[targetView].p1; l1.style.opacity = 1; }, 150); }
        if(l2) { l2.style.opacity = 0; setTimeout(()=> { l2.textContent = fxLabels[targetView].p2; l2.style.opacity = 1; }, 150); }
        if(ls) { ls.style.opacity = 0; setTimeout(()=> { ls.textContent = fxLabels[targetView].s; ls.style.opacity = 1; }, 150); }
    }
    syncUI();
}

window.updateLfoRateMode = function(val) {
    if (!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    p[activeLfoView].rateMode = val;
    let rate = p[activeLfoView].rate;
    if (val === 'lo' && rate > 20) p[activeLfoView].rate = 20;
    if (val === 'hi' && rate < 20) p[activeLfoView].rate = 20;
    synthChannels[activeSynthIndex].applyParams();
    syncUI();
    window.debouncedHardwareSync(activeSynthIndex);
};

function updateNestedSynth(group, param, value) {
    if (group && group.startsWith('globalFx') && window.globalFX) {
        const fxType = group.split('.')[1];
        window.globalFX[fxType][param] = isNaN(value) ? value : parseFloat(value);
        if (window.masterFX) window.masterFX.updateParams(window.globalFX);
        return;
    }
    
    if (!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    let targetObj;
    
    if (group === 'lfo') targetObj = p[activeLfoView];
    else if (group === 'env') targetObj = p[activeEnvView];
    else if (group === 'filter') targetObj = p.filter;
    else if (group === 'sources') targetObj = p.sources;
    else if (group === 'fx') targetObj = p.fx;
    
    if (targetObj) {
        if (param.includes('.')) {
            const keys = param.split('.');
            targetObj[keys[0]][keys[1]] = isNaN(value) ? value : parseFloat(value);
        } else { 
            targetObj[param] = isNaN(value) ? value : parseFloat(value); 
        }
    }
    
    synthChannels[activeSynthIndex].applyParams();
    window.markChannelDirty(activeSynthIndex);
}

function initKnobs() {
    document.querySelectorAll('.knob-track').forEach(knob => {
        let isDragging = false, startY = 0, startVal = 0;
        
        knob.style.touchAction = 'none';

        const updateDial = (val) => {
            const min = parseFloat(knob.dataset.min), max = parseFloat(knob.dataset.max), isLog = knob.dataset.log === "true";
            let pct = isLog ? (Math.log(val) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (val - min) / (max - min);
            let dial = knob.querySelector('.knob-dial');
            if(dial) dial.style.transform = `rotate(${-135 + (pct * 270)}deg)`;
        };
        
        let initVal = parseFloat(knob.dataset.val);
        if (!isNaN(initVal)) updateDial(initVal);

        const handleMove = (clientY) => {
            if (!isDragging) return;
            const min = parseFloat(knob.dataset.min), max = parseFloat(knob.dataset.max), isLog = knob.dataset.log === "true";
            let deltaY = startY - clientY, newVal;
            
            if (isLog) {
                let pct = (Math.log(startVal) - Math.log(min)) / (Math.log(max) - Math.log(min));
                pct = Math.max(0, Math.min(1, pct + (deltaY / 150)));
                newVal = Math.exp(Math.log(min) + pct * (Math.log(max) - Math.log(min)));
            } else { 
                newVal = Math.max(min, Math.min(max, startVal + (deltaY / 150) * (max - min))); 
            }
            
            knob.dataset.val = newVal; 
            updateDial(newVal); 
            
            const group = knob.dataset.group;
            const param = knob.dataset.param;

            let rect = knob.getBoundingClientRect();
            let centerX = rect.left + (rect.width / 2);
            let topY = rect.top;
            
            if (param !== 'testIntensity') {
                showTooltip(centerX, topY, newVal, param, group, knob);
            }
            
            if (group) updateNestedSynth(group, param, newVal);
            else updateActiveSynth(param, newVal);

            if (param === 'voices') {
                let intVal = Math.round(newVal);
                let readout = document.getElementById('poly-readout');
                if(readout) readout.innerText = intVal;
                
                let legatoWrapper = document.getElementById('legato-wrapper');
                let legatoBtn = document.getElementById('ui-legato');
                if (legatoWrapper && legatoBtn) {
                    if (intVal > 1) {
                        legatoWrapper.style.opacity = '0.3';
                        legatoWrapper.style.pointerEvents = 'none';
                        if (legatoBtn.checked) {
                            legatoBtn.checked = false;
                            updateActiveSynth('legato', 0);
                        }
                    } else {
                        legatoWrapper.style.opacity = '1.0';
                        legatoWrapper.style.pointerEvents = 'auto';
                    }
                }
            }
        };
        
        knob.addEventListener('pointerdown', (e) => { 
            isDragging = true; startY = e.clientY; 
            startVal = parseFloat(knob.dataset.val); 
            knob.setPointerCapture(e.pointerId);
            e.preventDefault(); 
        });
        
        knob.addEventListener('pointermove', (e) => {
            if (isDragging) handleMove(e.clientY);
        });
        
        const stopDrag = (e) => { 
            if(isDragging) { 
                isDragging = false; 
                knob.releasePointerCapture(e.pointerId);
                hideTooltip(); 
            } 
        };
        
        knob.addEventListener('pointerup', stopDrag);
        knob.addEventListener('pointercancel', stopDrag);
    });
}

function syncUI() {
    if (!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    
    ['ui-scaleRoot', 'ui-scaleType', 'ui-steal'].forEach(id => { let el = document.getElementById(id); if(el) el.value = p[id.replace('ui-', '')]; });
    const waveEl = document.getElementById('ui-wave'); if(waveEl) waveEl.value = p.sources.osc1.type;
    
    let legEl = document.getElementById('ui-legato');
    if (legEl) legEl.checked = (p.legato === 1);

    let lfoShape = document.getElementById('ui-lfo-shape');
    if(lfoShape && p[activeLfoView]) lfoShape.value = p[activeLfoView].shape;
    
    ['atk', 'dec', 'sus', 'rel'].forEach(id => { let el = document.getElementById(`ui-env-${id}`); if(el && p[activeEnvView]) el.value = p[activeEnvView][id]; });
    
    let bpmDisplay = document.getElementById('ui-bpm-display');
    if (bpmDisplay) bpmDisplay.innerText = Math.round(window.masterBPM).toString().padStart(3, '0');
    
    if (p[activeLfoView]) {
        let rateMode = p[activeLfoView].rateMode || 'lo';
        let rmEl = document.getElementById(rateMode === 'lo' ? 'rate-lo' : 'rate-hi');
        if (rmEl) rmEl.checked = true;
        
        let rateKnob = document.querySelector('.knob-track[data-param="rate"][data-group="lfo"]');
        if (rateKnob) {
            if (rateMode === 'lo') { rateKnob.dataset.min = "0.01"; rateKnob.dataset.max = "20"; } 
            else { rateKnob.dataset.min = "20"; rateKnob.dataset.max = "2000"; }
            rateKnob.dataset.log = "true";
        }
    }
    
    const setV = (id, v) => { let el = document.getElementById(id); if(el) el.value = v; };
    const setT = (id, t) => { let el = document.getElementById(id); if(el) el.innerText = t; };

    setV('ui-slider-density', p.density); setT('ui-density-display', p.density + '%');
    
    setV('ui-quantize', p.quantize);
    let testInj = document.getElementById('ui-test-injector');
    if (testInj) testInj.value = p.testIntensity || 0;
    let qSlider = document.getElementById('ui-quantize');
    if (qSlider) {
        const spans = qSlider.nextElementSibling.querySelectorAll('span');
        spans.forEach(s => { s.style.color = '#666'; s.style.fontWeight = 'normal'; });
        if(spans[p.quantize]) { spans[p.quantize].style.color = 'var(--cyan)'; spans[p.quantize].style.fontWeight = 'bold'; }
    }

    setV('ui-note-min', p.minNote); setV('ui-note-max', p.maxNote);
    const midiToNote = (m) => ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][m%12] + (Math.floor(m/12)-2);
    setT('note-range-text', `${midiToNote(p.minNote)} (${p.minNote}) ↔ ${midiToNote(p.maxNote)} (${p.maxNote})`);
    let nFill = document.getElementById('note-fill');
    if (nFill) { nFill.style.left = (p.minNote / 127 * 100) + '%'; nFill.style.width = ((p.maxNote - p.minNote) / 127 * 100) + '%'; }

    setV('ui-vel-min', p.velMin); setV('ui-vel-max', p.velMax);
    setT('ui-vel-text', `${p.velMin} ↔ ${p.velMax}`);
    let vFill = document.getElementById('vel-fill');
    if (vFill) { vFill.style.left = (p.velMin / 127 * 100) + '%'; vFill.style.width = ((p.velMax - p.velMin) / 127 * 100) + '%'; }

    document.querySelectorAll('.synth-inspector .knob-track').forEach(knob => {
        const param = knob.dataset.param, group = knob.dataset.group;
        if (param === 'bpm') return; 
        
        let val;
        if (group && group.startsWith('globalFx') && window.globalFX) {
            const fxType = group.split('.')[1];
            if (window.globalFX[fxType]) val = window.globalFX[fxType][param];
        } 
        else if (group === 'lfo' && p[activeLfoView]) val = p[activeLfoView][param];
        else if (group === 'env' && p[activeEnvView]) val = p[activeEnvView][param];
        else if (group === 'fx' && p.fx) val = p.fx[param];
        else if (group === 'filter' && p.filter) val = p.filter[param];
        else if (group === 'sources' && p.sources) { const keys = param.split('.'); val = p.sources[keys[0]][keys[1]]; }
        else val = p[param]; 

        if (val === undefined || isNaN(val)) return;

        knob.dataset.val = val;
        const min = parseFloat(knob.dataset.min), max = parseFloat(knob.dataset.max), isLog = knob.dataset.log === "true";
        let pct = isLog ? (Math.log(val) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (val - min) / (max - min);
        let dial = knob.querySelector('.knob-dial');
        if (dial) dial.style.transform = `rotate(${-135 + (pct * 270)}deg)`;
        
        if (param === 'voices') {
            let intVal = Math.round(val);
            let readout = document.getElementById('poly-readout');
            if(readout) readout.innerText = intVal;
            let legatoWrapper = document.getElementById('legato-wrapper');
            let legatoBtn = document.getElementById('ui-legato');
            if (legatoWrapper && legatoBtn) {
                if (intVal > 1) {
                    legatoWrapper.style.opacity = '0.3';
                    legatoWrapper.style.pointerEvents = 'none';
                } else {
                    legatoWrapper.style.opacity = '1.0';
                    legatoWrapper.style.pointerEvents = 'auto';
                }
            }
        }
    });
    
    let drvLvl = document.getElementById('ui-fx-drv-lvl');
    if (drvLvl && p.fx) drvLvl.value = p.fx.drvLvl !== undefined ? p.fx.drvLvl : 1.0;
    
    let toRevEl = document.getElementById('ui-fx-torev');
    if (toRevEl && window.globalFX) toRevEl.value = window.globalFX.dly.toRev;

    let revHpfEl = document.getElementById('ui-fx-rev-hpf');
    if (revHpfEl && window.globalFX) revHpfEl.value = window.globalFX.rev.hpf;

    syncPianoUI();
}

/// --- CHANNEL PRESET ENGINE ---
let globalChannelPresets = {};

function loadChannelPresetsFromStorage() {
    try {
        const stored = localStorage.getItem('biodataChannelPresets');
        if (stored) globalChannelPresets = JSON.parse(stored);
    } catch(e) { console.error("Error loading channel presets", e); }
    updateChannelPresetDropdowns();
}

function updateChannelPresetDropdowns() {
    for(let i=0; i<4; i++) {
        const select = document.getElementById(`ch-preset-select-${i}`);
        if(!select) continue;
        
        select.onchange = (e) => {
            loadChannelPreset(i, e.target.value);
        };

        const currentVal = select.value;
        select.innerHTML = '<option value="">-- Select --</option>';
        Object.keys(globalChannelPresets).forEach(name => {
            let opt = document.createElement('option');
            opt.value = name; opt.text = name; 
            select.appendChild(opt);
        });
        select.value = globalChannelPresets[currentVal] ? currentVal : "";
        
        const btn = document.getElementById(`ch-preset-btn-${i}`);
        if (btn) {
            let patchName = (synthChannels[i] && synthChannels[i].patchName) ? synthChannels[i].patchName : "INIT";
            let dirtyStar = (synthChannels[i] && synthChannels[i].isDirty && patchName !== "INIT") ? "*" : "";
            btn.innerHTML = `${patchName}${dirtyStar} ▼`;
            
            btn.onpointerdown = (e) => { 
                selectTab(i); 
                e.stopPropagation(); 
            };
        }
    }
}

function saveChannelPreset(ch, forceNew = false) {
    if(typeof ensureSynths === 'function') ensureSynths();
    selectTab(ch);
    
    const select = document.getElementById(`ch-preset-select-${ch}`);
    let name = select ? select.value : "";
    
    if (synthChannels[ch].patchName && !forceNew) {
        name = synthChannels[ch].patchName;
    }

    if (forceNew || !name || name === "") {
        name = prompt(`Enter a name for Channel ${ch + 1} voice patch:`);
        if (!name || name.trim() === "") return;
    }
    
    const presetData = {
        params: JSON.parse(JSON.stringify(synthChannels[ch].params)),
        config: chData[ch] && chData[ch].config ? JSON.parse(JSON.stringify(chData[ch].config)) : null
    };
    
    globalChannelPresets[name] = presetData;
    localStorage.setItem('biodataChannelPresets', JSON.stringify(globalChannelPresets));
    
    synthChannels[ch].patchName = name;
    synthChannels[ch].isDirty = false;
    updateChannelPresetDropdowns();
    if (select) select.value = name;
    
    setTimeout(() => {
        let btn = document.getElementById(`ch-preset-btn-${ch}`);
        if(btn && btn.parentElement) btn.parentElement.classList.remove('show');
    }, 150);
}

function loadChannelPreset(ch, name) {
    if (!name || !globalChannelPresets[name]) return;
    if(typeof ensureSynths === 'function') ensureSynths();
    
    const presetData = globalChannelPresets[name];
    
    if (presetData.params && synthChannels[ch]) {
        synthChannels[ch].params = JSON.parse(JSON.stringify(presetData.params));
        synthChannels[ch].applyParams();
        
        if (synthChannels[ch].channelOut) {
            synthChannels[ch].channelOut.gain.value = synthChannels[ch].params.muted ? 0 : synthChannels[ch].params.mixVol;
        }
        
        let volSlider = document.getElementById(`ch-vol-${ch}`);
        if (volSlider) volSlider.value = synthChannels[ch].params.mixVol;
        let muteBtn = document.getElementById(`mute-btn-${ch}`);
        if (muteBtn) {
            muteBtn.style.backgroundColor = synthChannels[ch].params.muted ? 'var(--red)' : 'transparent';
            muteBtn.style.color = synthChannels[ch].params.muted ? '#000' : 'var(--text)';
        }
        
        let midiSel = document.getElementById(`ui-midi-ch-${ch}`);
        if (midiSel) midiSel.value = synthChannels[ch].params.midiOutCh;
        
        let miniT = document.getElementById(`ch-mini-thresh-${ch}`);
        let miniV = document.getElementById(`ch-val-thresh-${ch}`);
        if (miniT) miniT.value = synthChannels[ch].params.threshold;
        if (miniV) miniV.innerText = parseFloat(synthChannels[ch].params.threshold).toFixed(2) + 'x';
        
        let miniW = document.getElementById(`ch-window-${ch}`);
        let miniWV = document.getElementById(`ch-val-window-${ch}`);
        if (miniW) miniW.value = synthChannels[ch].params.sampleSize;
        if (miniWV) miniWV.innerText = synthChannels[ch].params.sampleSize;

        let floorS = document.getElementById(`ch-floor-${ch}`);
        let floorV = document.getElementById(`ch-val-floor-${ch}`);
        if (floorS && synthChannels[ch].params.noiseFloor !== undefined) floorS.value = synthChannels[ch].params.noiseFloor;
        if (floorV && synthChannels[ch].params.noiseFloor !== undefined) floorV.innerText = synthChannels[ch].params.noiseFloor.toFixed(1);
    }
    
    if (presetData.config && chData[ch]) {
        chData[ch].config = JSON.parse(JSON.stringify(presetData.config));
        let z = document.getElementById(`ch-zoom-${ch}`);
        let s = document.getElementById(`ch-smooth-${ch}`);
        let zVal = document.getElementById(`ch-val-zoom-${ch}`);
        let sVal = document.getElementById(`ch-val-smooth-${ch}`);
        
        if(z) { 
            let minL = Math.log(50), maxL = Math.log(120000);
            z.value = ((Math.log(chData[ch].config.zoom) - minL) / (maxL - minL)) * 1000;
        }
        if(s) s.value = chData[ch].config.smooth;
        if(zVal) zVal.innerText = Math.round(chData[ch].config.zoom);
        if(sVal) sVal.innerText = chData[ch].config.smooth.toFixed(2);
    }
    
    synthChannels[ch].patchName = name;
    synthChannels[ch].isDirty = false;
    updateChannelPresetDropdowns();
    
    let select = document.getElementById(`ch-preset-select-${ch}`);
    if(select) select.value = name;
    
    selectTab(ch); 
    
    setTimeout(() => {
        let btn = document.getElementById(`ch-preset-btn-${ch}`);
        if(btn && btn.parentElement) btn.parentElement.classList.remove('show');
    }, 150);
    
    window.debouncedHardwareSync(ch);
}

function deleteChannelPreset(ch) {
    selectTab(ch); 
    const select = document.getElementById(`ch-preset-select-${ch}`);
    let name = select ? select.value : "";
    if (!name || name === "") return alert("No channel preset selected to delete.");
    
    if(confirm(`Are you sure you want to delete the channel preset "${name}"?`)) {
        delete globalChannelPresets[name];
        localStorage.setItem('biodataChannelPresets', JSON.stringify(globalChannelPresets));
        if (synthChannels[ch].patchName === name) {
            synthChannels[ch].patchName = "INIT";
            synthChannels[ch].isDirty = false;
        }
        updateChannelPresetDropdowns();
        if(select) select.value = "";
        
        setTimeout(() => {
            let btn = document.getElementById(`ch-preset-btn-${ch}`);
            if(btn && btn.parentElement) btn.parentElement.classList.remove('show');
        }, 150);
    }
}

window.markChannelDirty = function(ch) {
    if (!synthChannels[ch] || synthChannels[ch].patchName === "INIT" || !synthChannels[ch].patchName) return;
    if (!synthChannels[ch].isDirty) {
        synthChannels[ch].isDirty = true;
        let btn = document.getElementById(`ch-preset-btn-${ch}`);
        if (btn) btn.innerHTML = `${synthChannels[ch].patchName}* ▼`;
    }
};
