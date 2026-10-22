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
                <div class="v-slider-container"><input type="range" id="ch-vol-${i}" class="v-slider" style="--slider-color: ${window.CH_COLORS[i]};" min="0" max="1" step="0.01" value="0.8" oninput="synthChannels[${i}].setVolume(this.value)"></div>
                <canvas class="vu ch-vu" id="vu-${i}"></canvas>
            </div>
            <button id="mute-btn-${i}" onclick="synthChannels[${i}].toggleMute(); this.style.backgroundColor = synthChannels[${i}].params.muted ? 'var(--red)' : 'transparent'; this.style.color = synthChannels[${i}].params.muted ? '#000' : 'var(--text)';" style="width: 100%; margin-top: 5px; padding: 4px 0; font-size: 11px; font-weight: bold; background: transparent; border: 1px solid var(--border); color: var(--text); cursor: pointer; border-radius: 2px;">M</button>
        </div>`;
    }
    
    html += `
        <div class="strip master" style="border-left: 1px solid var(--border); padding-left: 15px;">
            <div class="strip-label" style="color: var(--cyan); margin-bottom: 5px;">MIX</div>
            <div class="strip-controls" style="justify-content: center; width: 100%;">
                <div class="v-slider-container"><input type="range" id="master-vol-slider" class="v-slider" min="0" max="1" step="0.01" value="1.0" oninput="window.masterVolumeLevel = parseFloat(this.value); if(!window.isMasterMuted) window.masterGain.gain.value = window.masterVolumeLevel;"></div>
            </div>
            <div style="height: 25px; margin-top: 5px;"></div>
        </div>`;
    mixerContent.innerHTML = html;
}

function updateMidiChannel(synthCh, midiCh) { if (synthChannels[synthCh]) synthChannels[synthCh].params.midiOutCh = parseInt(midiCh); }

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
        if(newBpm >= 60 && newBpm <= 240) { window.masterBPM = newBpm; syncUI(); }
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

function updateActiveSynth(param, value) {
    if (param === 'bpm') {
        if (window.midiClockMode === 'in') return;
        window.masterBPM = isNaN(value) ? window.masterBPM : parseFloat(value);
        syncUI();
        return;
    }
    
    if (!synthChannels[activeSynthIndex]) return;
    if (param === 'stealMode' || param === 'scaleType') {
        synthChannels[activeSynthIndex].params[param] = value;
    } else {
        synthChannels[activeSynthIndex].params[param] = isNaN(value) ? value : parseFloat(value);
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
    if(!select) return;
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
        channels: synthChannels.map(ch => JSON.parse(JSON.stringify(ch.params))),
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
            if (group) updateNestedSynth(group, param, newVal);
            else updateActiveSynth(param, newVal);

            // Polyphony specifics
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
        
        // Force the UI update logic for Poly slider to reflect correctly on tab change
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
