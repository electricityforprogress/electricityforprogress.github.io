/**
 * js/uiController.js
 */

document.addEventListener('DOMContentLoaded', () => {
    
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
                }
            });

            window.addEventListener('mouseup', () => { isDragging = false; });
        });
    };

    const attachSlider = (id, paramKey, labelId, formatFn) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            let val = parseFloat(e.target.value);
            if (synthChannels[activeSynthIndex]) {
                synthChannels[activeSynthIndex].params[paramKey] = val;
                if (labelId && formatFn) document.getElementById(labelId).innerText = formatFn(val);
                
                if (paramKey === 'threshold') {
                    let miniT = document.getElementById(`ch-mini-thresh-${activeSynthIndex}`);
                    let miniVal = document.getElementById(`ch-val-thresh-${activeSynthIndex}`);
                    if (miniT) miniT.value = val;
                    if (miniVal) miniVal.innerText = val.toFixed(2) + 'x';

                    if (typeof bleTxCharacteristic !== 'undefined' && bleTxCharacteristic) {
                        bleTxCharacteristic.writeValueWithoutResponse(new TextEncoder().encode(`T${activeSynthIndex}:${val}\n`));
                    }
                }
            }
        });
    };

    attachSlider('ui-slider-threshold', 'threshold', 'ui-thresh-display', v => v.toFixed(2) + 'x');
    attachSlider('ui-slider-density', 'density', 'ui-density-display', v => v + '%');
    attachSlider('ui-slider-window', 'sampleSize', 'ui-window-display', v => v + ' TICKS');

    const nMin = document.getElementById('ui-note-min'), nMax = document.getElementById('ui-note-max');
    const nFill = document.getElementById('note-fill'), nText = document.getElementById('note-range-text');
    const midiToNote = (m) => ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][m%12] + (Math.floor(m/12)-1);
    
    const updateNote = () => {
        if(!synthChannels[activeSynthIndex]) return;
        let min = parseInt(nMin.value), max = parseInt(nMax.value);
        if (min > max) { let t = min; min = max; max = t; }
        if(nFill) { nFill.style.left = (min / 127 * 100) + '%'; nFill.style.width = ((max - min) / 127 * 100) + '%'; }
        if(nText) nText.innerText = `${midiToNote(min)} (${min}) ↔ ${midiToNote(max)} (${max})`;
        synthChannels[activeSynthIndex].params.minNote = min;
        synthChannels[activeSynthIndex].params.maxNote = max;
    };
    if(nMin) nMin.addEventListener('input', updateNote);
    if(nMax) nMax.addEventListener('input', updateNote);

    const vMin = document.getElementById('ui-vel-min'), vMax = document.getElementById('ui-vel-max');
    const vFill = document.getElementById('vel-fill');
    const vMinTxt = document.getElementById('ui-vel-min-txt'), vMaxTxt = document.getElementById('ui-vel-max-txt');
    
    const updateVel = () => {
        if(!synthChannels[activeSynthIndex]) return;
        let min = parseInt(vMin.value), max = parseInt(vMax.value);
        if (min > max) { let t = min; min = max; max = t; }
        if(vFill) { vFill.style.left = (min / 127 * 100) + '%'; vFill.style.width = ((max - min) / 127 * 100) + '%'; }
        if(vMinTxt) vMinTxt.innerText = min; 
        if(vMaxTxt) vMaxTxt.innerText = max;
        synthChannels[activeSynthIndex].params.velMin = min;
        synthChannels[activeSynthIndex].params.velMax = max;
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
        });
    }

    setTimeout(makeSlidersDraggable, 500); 
});

function buildMixerAndMidiUI() {
    for (let i = 0; i < 4; i++) {
        const select = document.getElementById(`ui-midi-ch-${i}`);
        if(select) {
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
            <div class="strip-label" style="color: hsl(${i*90}, 100%, 60%); margin-bottom: 5px;">CH ${i+1}</div>
            <div class="strip-controls">
                <div class="slider-col"><input type="range" class="v-slider" min="0" max="1" step="0.01" value="0.8" oninput="synthChannels[${i}].setVolume(this.value)"></div>
                <canvas class="vu ch-vu" id="vu-${i}" width="12" height="100" style="background:#000; border-radius:2px;"></canvas>
            </div>
            <button id="mute-btn-${i}" onclick="synthChannels[${i}].toggleMute(); this.style.backgroundColor = synthChannels[${i}].params.muted ? 'var(--red)' : 'transparent'; this.style.color = synthChannels[${i}].params.muted ? '#000' : 'var(--text)';" style="width: 100%; margin-top: 5px; padding: 4px 0; font-size: 11px; font-weight: bold; background: transparent; border: 1px solid var(--border); color: var(--text); cursor: pointer; border-radius: 2px;">M</button>
        </div>`;
    }
    
    html += `
        <div class="strip master" style="border-left: 1px solid var(--border); padding-left: 15px;">
            <div class="strip-label" style="color: var(--cyan); margin-bottom: 5px;">MIX</div>
            <div class="strip-controls" style="justify-content: center; width: 100%;">
                <div class="slider-col"><input type="range" id="master-vol-slider" class="v-slider" min="0" max="1" step="0.01" value="1.0" oninput="window.masterVolumeLevel = parseFloat(this.value); if(!window.isMasterMuted) window.masterGain.gain.value = window.masterVolumeLevel;"></div>
            </div>
            <div style="height: 25px; margin-top: 5px;"></div>
        </div>`;
    mixerContent.innerHTML = html;
}

function updateMidiChannel(synthCh, midiCh) { if (synthChannels[synthCh]) synthChannels[synthCh].params.midiOutCh = parseInt(midiCh); }

function toggleMasterMute() {
    window.isMasterMuted = !window.isMasterMuted;
    window.masterGain.gain.value = window.isMasterMuted ? 0 : window.masterVolumeLevel;
    const btn = document.getElementById('btn-master-mute');
    btn.style.backgroundColor = window.isMasterMuted ? 'var(--red)' : 'transparent';
    btn.style.color = window.isMasterMuted ? '#000' : 'var(--red)';
}

// UPDATE: Tap Tempo now controls the Global window.masterBPM
let tapTimes = [];
function tapTempo() {
    if (window.midiClockMode === 'in') return; // Disable tap if slaved to external clock
    
    const now = performance.now();
    tapTimes.push(now);
    if (tapTimes.length > 4) tapTimes.shift();
    if (tapTimes.length >= 2) {
        let intervals = [];
        for(let i=1; i<tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i-1]);
        let avg = intervals.reduce((a,b)=>a+b)/intervals.length;
        let newBpm = 60000 / avg;
        if(newBpm >= 60 && newBpm <= 240) { 
            window.masterBPM = newBpm;
            syncUI(); 
        }
    }
    document.getElementById('ui-bpm-led').classList.add('active');
    setTimeout(() => document.getElementById('ui-bpm-led').classList.remove('active'), 50);
}

function initPiano() {
    const p = document.getElementById('piano-keys'); p.innerHTML = '';
    const whiteKeys = [0, 2, 4, 5, 7, 9, 11], blackKeys = [1, 3, null, 6, 8, 10]; 
    whiteKeys.forEach(noteIdx => { let k = document.createElement('div'); k.className = 'key-w active'; k.id = `pkey-${noteIdx}`; k.onclick = () => togglePianoKey(noteIdx); p.appendChild(k); });
    blackKeys.forEach((noteIdx, i) => { if (noteIdx !== null) { let k = document.createElement('div'); k.className = 'key-b active'; k.id = `pkey-${noteIdx}`; k.style.left = `${(i + 1) * 14.28}%`; k.onclick = () => togglePianoKey(noteIdx); p.appendChild(k); } });
}

function togglePianoKey(noteIdx) {
    if(!synthChannels[activeSynthIndex]) return;
    synthChannels[activeSynthIndex].params.activeScaleBits[noteIdx] = !synthChannels[activeSynthIndex].params.activeScaleBits[noteIdx];
    document.getElementById('ui-scaleType').value = 'custom'; updateActiveSynth('scaleType', 'custom'); syncPianoUI();
}

function applyScalePreset() {
    if(!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    if (p.scaleType === 'custom') return; 
    p.activeScaleBits.fill(false); window.SCALES[p.scaleType].forEach(deg => { p.activeScaleBits[(parseInt(p.scaleRoot) + deg) % 12] = true; });
    syncPianoUI();
}

function syncPianoUI() {
    if(!synthChannels[activeSynthIndex]) return;
    const bits = synthChannels[activeSynthIndex].params.activeScaleBits;
    for(let i=0; i<12; i++) { let k = document.getElementById(`pkey-${i}`); if(k) k.classList.toggle('active', bits[i]); }
}

function selectTab(index) { activeSynthIndex = index; document.querySelectorAll('.synth-tab').forEach((t, i) => t.classList.toggle('active', i === index)); syncUI(); }
function triggerLED(index) { const led = document.getElementById(`led-${index}`); if (led) { led.classList.add('active'); setTimeout(() => led.classList.remove('active'), 100); } }
function setVolume(ch, val) { if (synthChannels[ch]) synthChannels[ch].setVolume(val); }
function toggleMute(ch) { if (synthChannels[ch]) synthChannels[ch].toggleMute(); }

function updateActiveSynth(param, value) {
    // NEW: If adjusting BPM, update the global Master BPM
    if (param === 'bpm') {
        if (window.midiClockMode === 'in') return;
        window.masterBPM = isNaN(value) ? window.masterBPM : parseFloat(value);
        syncUI();
        return;
    }
    
    if (!synthChannels[activeSynthIndex]) return;
    synthChannels[activeSynthIndex].params[param] = isNaN(value) ? value : parseFloat(value);
    
    if (param === 'threshold' && typeof bleTxCharacteristic !== 'undefined' && bleTxCharacteristic) {
        bleTxCharacteristic.writeValueWithoutResponse(new TextEncoder().encode(`T${activeSynthIndex}:${value}\n`));
    }
    synthChannels[activeSynthIndex].applyParams();
}

function loadPresetsFromStorage() {
    try {
        const stored = localStorage.getItem('biodataPresets');
        if (stored) globalPresets = JSON.parse(stored);
        else globalPresets = {};
    } catch(e) { console.error("Error loading presets", e); }
    updatePresetDropdown();
}

function updatePresetDropdown() {
    const select = document.getElementById('preset-select');
    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Select --</option>';
    Object.keys(globalPresets).forEach(name => {
        let opt = document.createElement('option');
        opt.value = name; opt.text = name; select.appendChild(opt);
    });
    select.value = globalPresets[currentVal] ? currentVal : "";
}

function savePreset() {
    ensureSynths();
    const name = prompt("Enter a name for this global preset:");
    if (!name || name.trim() === "") return;
    
    const presetData = {
        channels: synthChannels.map(ch => JSON.parse(JSON.stringify(ch.params))),
        master: { vol: window.masterVolumeLevel, muted: window.isMasterMuted, bpm: window.masterBPM },
        viz: chData.map(ch => JSON.parse(JSON.stringify(ch.config)))
    };
    
    globalPresets[name] = presetData;
    localStorage.setItem('biodataPresets', JSON.stringify(globalPresets));
    updatePresetDropdown();
    document.getElementById('preset-select').value = name;
}

function loadPreset(name) {
    if (!name || !globalPresets[name]) return;
    ensureSynths();
    const presetData = globalPresets[name];
    const channelData = presetData.channels || presetData; 
    
    for (let i = 0; i < 4; i++) {
        if (channelData[i] && synthChannels[i]) {
            synthChannels[i].params = JSON.parse(JSON.stringify(channelData[i]));
            synthChannels[i].applyParams();
            let midiSel = document.getElementById(`ui-midi-ch-${i}`);
            if (midiSel) midiSel.value = synthChannels[i].params.midiOutCh;
            
            let miniT = document.getElementById(`ch-mini-thresh-${i}`);
            let miniV = document.getElementById(`ch-val-thresh-${i}`);
            if (miniT) miniT.value = synthChannels[i].params.threshold;
            if (miniV) miniV.innerText = parseFloat(synthChannels[i].params.threshold).toFixed(2) + 'x';
        }
        
        if (presetData.viz && presetData.viz[i] && chData[i]) {
            chData[i].config = JSON.parse(JSON.stringify(presetData.viz[i]));
            let z = document.getElementById(`ch-zoom-${i}`);
            let s = document.getElementById(`ch-smooth-${i}`);
            let zVal = document.getElementById(`ch-val-zoom-${i}`);
            let sVal = document.getElementById(`ch-val-smooth-${i}`);
            
            // Map saved literal zoom value back to slider 0-1000 range via math
            if(z) { 
                let minL = Math.log(50), maxL = Math.log(120000);
                let zPos = ((Math.log(chData[i].config.zoom) - minL) / (maxL - minL)) * 1000;
                z.value = zPos;
            }
            if(s) { s.value = chData[i].config.smooth; }
            if(zVal) zVal.innerText = Math.round(chData[i].config.zoom);
            if(sVal) sVal.innerText = chData[i].config.smooth.toFixed(2);
        }
    }
    
    if (presetData.master) {
        window.masterVolumeLevel = presetData.master.vol;
        window.isMasterMuted = presetData.master.muted;
        window.masterGain.gain.value = window.isMasterMuted ? 0 : window.masterVolumeLevel;
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
    syncUI();
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

let activeLfoView = 'pitchLfo';
let activeEnvView = 'ampEnv';

function switchModView(type, targetView) {
    if (type === 'lfo') activeLfoView = targetView;
    if (type === 'env') activeEnvView = targetView;
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
};

function updateNestedSynth(group, param, value) {
    if (!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    let targetObj;
    if (group === 'lfo') targetObj = p[activeLfoView];
    else if (group === 'env') targetObj = p[activeEnvView];
    else if (group === 'filter') targetObj = p.filter;
    else if (group === 'sources') targetObj = p.sources;
    
    if (param.includes('.')) {
        const keys = param.split('.');
        targetObj[keys[0]][keys[1]] = isNaN(value) ? value : parseFloat(value);
    } else { targetObj[param] = isNaN(value) ? value : parseFloat(value); }
    
    synthChannels[activeSynthIndex].applyParams();
    updateModLEDs(); 
}

function initKnobs() {
    document.querySelectorAll('.knob-track').forEach(knob => {
        let isDragging = false, startY = 0, startVal = 0;
        const updateDial = (val) => {
            const min = parseFloat(knob.dataset.min), max = parseFloat(knob.dataset.max), isLog = knob.dataset.log === "true";
            let pct = isLog ? (Math.log(val) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (val - min) / (max - min);
            knob.querySelector('.knob-dial').style.transform = `rotate(${-135 + (pct * 270)}deg)`;
        };
        updateDial(parseFloat(knob.dataset.val));
        knob.addEventListener('mousedown', (e) => { isDragging = true; startY = e.clientY; startVal = parseFloat(knob.dataset.val); e.preventDefault(); });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const min = parseFloat(knob.dataset.min), max = parseFloat(knob.dataset.max), isLog = knob.dataset.log === "true";
            let deltaY = startY - e.clientY, newVal;
            if (isLog) {
                let pct = (Math.log(startVal) - Math.log(min)) / (Math.log(max) - Math.log(min));
                pct = Math.max(0, Math.min(1, pct + (deltaY / 150)));
                newVal = Math.exp(Math.log(min) + pct * (Math.log(max) - Math.log(min)));
            } else { newVal = Math.max(min, Math.min(max, startVal + (deltaY / 150) * (max - min))); }
            
            knob.dataset.val = newVal; updateDial(newVal); 
            const group = knob.dataset.group;
            if (group) updateNestedSynth(group, knob.dataset.param, newVal);
            else updateActiveSynth(knob.dataset.param, newVal);
        });
        window.addEventListener('mouseup', () => isDragging = false);
    });
}

function syncUI() {
    if (!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    
    ['ui-scaleRoot', 'ui-scaleType', 'ui-mode'].forEach(id => { let el = document.getElementById(id); if(el) el.value = p[id.replace('ui-', '')]; });
    const waveEl = document.getElementById('ui-wave'); if(waveEl) waveEl.value = p.sources.osc1.type;
    document.getElementById('ui-lfo-shape').value = p[activeLfoView].shape;
    ['atk', 'dec', 'sus', 'rel'].forEach(id => { let el = document.getElementById(`ui-env-${id}`); if(el) el.value = p[activeEnvView][id]; });
    
    // MASTER BPM SYNC
    let bpmDisplay = document.getElementById('ui-bpm-display');
    if (bpmDisplay) bpmDisplay.innerText = Math.round(window.masterBPM).toString().padStart(3, '0');
    let bpmKnob = document.getElementById('master-tempo-knob');
    if (bpmKnob) {
        bpmKnob.dataset.val = window.masterBPM;
        const min = parseFloat(bpmKnob.dataset.min), max = parseFloat(bpmKnob.dataset.max);
        let pct = (window.masterBPM - min) / (max - min);
        bpmKnob.querySelector('.knob-dial').style.transform = `rotate(${-135 + (pct * 270)}deg)`;
        
        // Dim out tempo controls if listening to external clock
        let tapBtn = document.getElementById('ui-tap-btn');
        if (window.midiClockMode === 'in') {
            bpmKnob.style.opacity = '0.3';
            bpmKnob.style.pointerEvents = 'none';
            if (tapBtn) { tapBtn.style.opacity = '0.3'; tapBtn.style.pointerEvents = 'none'; }
        } else {
            bpmKnob.style.opacity = '1.0';
            bpmKnob.style.pointerEvents = 'auto';
            if (tapBtn) { tapBtn.style.opacity = '1.0'; tapBtn.style.pointerEvents = 'auto'; }
        }
    }
    
    let rateMode = p[activeLfoView].rateMode || 'lo';
    let rmEl = document.getElementById('ui-lfo-rateMode');
    if (rmEl) rmEl.value = rateMode;
    
    let rateKnob = document.querySelector('.knob-track[data-param="rate"][data-group="lfo"]');
    if (rateKnob) {
        if (rateMode === 'lo') {
            rateKnob.dataset.min = "0.01";
            rateKnob.dataset.max = "20";
        } else {
            rateKnob.dataset.min = "20";
            rateKnob.dataset.max = "2000";
        }
        rateKnob.dataset.log = "true";
    }
    
    const setV = (id, v) => { let el = document.getElementById(id); if(el) el.value = v; };
    const setT = (id, t) => { let el = document.getElementById(id); if(el) el.innerText = t; };

    setV('ui-slider-threshold', p.threshold); setT('ui-thresh-display', parseFloat(p.threshold).toFixed(2) + 'x');
    setV('ui-slider-density', p.density); setT('ui-density-display', p.density + '%');
    setV('ui-slider-window', p.sampleSize); setT('ui-window-display', p.sampleSize + ' TICKS');
    
    setV('ui-quantize', p.quantize);
    let qSlider = document.getElementById('ui-quantize');
    if (qSlider) {
        const spans = qSlider.nextElementSibling.querySelectorAll('span');
        spans.forEach(s => { s.style.color = '#666'; s.style.fontWeight = 'normal'; });
        if(spans[p.quantize]) { spans[p.quantize].style.color = 'var(--cyan)'; spans[p.quantize].style.fontWeight = 'bold'; }
    }

    setV('ui-note-min', p.minNote); setV('ui-note-max', p.maxNote);
    const midiToNote = (m) => ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][m%12] + (Math.floor(m/12)-1);
    setT('note-range-text', `${midiToNote(p.minNote)} (${p.minNote}) ↔ ${midiToNote(p.maxNote)} (${p.maxNote})`);
    let nFill = document.getElementById('note-fill');
    if (nFill) { nFill.style.left = (p.minNote / 127 * 100) + '%'; nFill.style.width = ((p.maxNote - p.minNote) / 127 * 100) + '%'; }

    setV('ui-vel-min', p.velMin); setV('ui-vel-max', p.velMax);
    setT('ui-vel-min-txt', p.velMin); setT('ui-vel-max-txt', p.velMax);
    let vFill = document.getElementById('vel-fill');
    if (vFill) { vFill.style.left = (p.velMin / 127 * 100) + '%'; vFill.style.width = ((p.velMax - p.velMin) / 127 * 100) + '%'; }

    document.querySelectorAll('.synth-inspector .knob-track').forEach(knob => {
        const param = knob.dataset.param, group = knob.dataset.group;
        
        if (param === 'bpm') return; // Master BPM is handled above uniquely
        
        let val;
        if (group === 'lfo') val = p[activeLfoView][param];
        else if (group === 'env') val = p[activeEnvView][param];
        else if (group === 'filter') val = p.filter[param];
        else if (group === 'sources') { const keys = param.split('.'); val = p.sources[keys[0]][keys[1]]; }
        else val = p[param]; 

        knob.dataset.val = val;
        const min = parseFloat(knob.dataset.min), max = parseFloat(knob.dataset.max), isLog = knob.dataset.log === "true";
        let pct = isLog ? (Math.log(val) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (val - min) / (max - min);
        knob.querySelector('.knob-dial').style.transform = `rotate(${-135 + (pct * 270)}deg)`;
    });
    
    syncPianoUI();
    updateModLEDs();
}

function updateModLEDs() {
    if (!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    const setLed = (id, val, maxVal = 1.0) => { const el = document.getElementById(id); if (el) el.style.opacity = 0.1 + (0.9 * (val / maxVal)); };
    setLed('ind-env-pitchEnv', p.pitchEnv.amt);
    setLed('ind-env-filterEnv', p.filterEnv.amt);
    setLed('ind-env-ampEnv', p.ampEnv.amt);
}

function clearAllPresets() {
    if(confirm("Are you sure you want to delete all saved presets? This cannot be undone.")) {
        localStorage.removeItem('biodataPresets');
        globalPresets = {};
        updatePresetDropdown();
        alert("All presets have been cleared.");
    }
}