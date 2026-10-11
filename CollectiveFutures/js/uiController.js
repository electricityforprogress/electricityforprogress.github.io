/**
 * js/uiController.js
 */

document.addEventListener('DOMContentLoaded', () => {
    const attachSlider = (id, paramKey, labelId, formatFn) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            let val = parseFloat(e.target.value);
            if (synthChannels[activeSynthIndex]) {
                synthChannels[activeSynthIndex].params[paramKey] = val;
                if (labelId && formatFn) document.getElementById(labelId).innerText = formatFn(val);
                if (paramKey === 'threshold' && typeof bleTxCharacteristic !== 'undefined' && bleTxCharacteristic) {
                    bleTxCharacteristic.writeValueWithoutResponse(new TextEncoder().encode(`T${activeSynthIndex}:${val}\n`));
                }
            }
        });
    };

    attachSlider('ui-slider-threshold', 'threshold', 'ui-thresh-display', v => v.toFixed(1) + 'x');
    attachSlider('ui-slider-density', 'density', 'ui-density-display', v => v + '%');

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
            <div class="strip-label" style="color: hsl(${i*90}, 100%, 60%)">CH ${i+1}</div>
            <div class="strip-controls">
                <div class="slider-col"><input type="range" class="v-slider" min="0" max="1" step="0.01" value="0.8" oninput="synthChannels[${i}].setVolume(this.value)"></div>
                <canvas class="vu ch-vu" id="vu-${i}" width="12" height="100" style="background:#000; border-radius:2px;"></canvas>
            </div>
            <button class="danger" id="mute-btn-${i}" onclick="synthChannels[${i}].toggleMute(); this.innerText = synthChannels[${i}].params.muted ? 'MUTED' : 'M'; this.style.backgroundColor = synthChannels[${i}].params.muted ? 'var(--red)' : ''; this.style.color = synthChannels[${i}].params.muted ? '#000' : '';" style="padding: 2px 6px; font-size: 0.7em;">M</button>
        </div>`;
    }
    html += `
        <div class="strip master">
            <div class="strip-label" style="color: var(--cyan)">MASTER</div>
            <div class="strip-controls">
                <div class="slider-col"><input type="range" id="master-vol-slider" class="v-slider" min="0" max="1" step="0.01" value="1.0" oninput="window.masterGain.gain.value = this.value"></div>
            </div>
        </div>`;
    mixerContent.innerHTML = html;
}

function updateMidiChannel(synthCh, midiCh) { if (synthChannels[synthCh]) synthChannels[synthCh].params.midiOutCh = parseInt(midiCh); }

function toggleMasterMute() {
    window.isMasterMuted = !window.isMasterMuted;
    window.masterGain.gain.value = window.isMasterMuted ? 0 : 1.0;
    const btn = document.getElementById('btn-master-mute');
    btn.innerText = window.isMasterMuted ? 'AUDIO MUTED' : 'MUTE ALL';
    btn.style.backgroundColor = window.isMasterMuted ? 'var(--red)' : 'transparent';
    btn.style.color = window.isMasterMuted ? '#000' : 'var(--red)';
}

let tapTimes = [];
function tapTempo() {
    if(!synthChannels[activeSynthIndex]) return;
    const now = performance.now();
    tapTimes.push(now);
    if (tapTimes.length > 4) tapTimes.shift();
    if (tapTimes.length >= 2) {
        let intervals = [];
        for(let i=1; i<tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i-1]);
        let avg = intervals.reduce((a,b)=>a+b)/intervals.length;
        let newBpm = 60000 / avg;
        if(newBpm >= 60 && newBpm <= 240) { updateActiveSynth('bpm', newBpm); syncUI(); }
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
    p.activeScaleBits.fill(false); SCALES[p.scaleType].forEach(deg => { p.activeScaleBits[(parseInt(p.scaleRoot) + deg) % 12] = true; });
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
    if (!synthChannels[activeSynthIndex]) return;
    synthChannels[activeSynthIndex].params[param] = isNaN(value) ? value : parseFloat(value);
    if (param === 'bpm') document.getElementById('ui-bpm-display').innerText = Math.round(value).toString().padStart(3, '0');
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
        master: { vol: masterGain.gain.value, muted: isMasterMuted }
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
        }
    }
    if (presetData.master) {
        masterGain.gain.value = presetData.master.vol;
        isMasterMuted = presetData.master.muted;
        document.getElementById('master-vol-slider').value = presetData.master.vol;
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
    document.getElementById('ui-bpm-display').innerText = Math.round(p.bpm).toString().padStart(3, '0');
    
    const setV = (id, v) => { let el = document.getElementById(id); if(el) el.value = v; };
    const setT = (id, t) => { let el = document.getElementById(id); if(el) el.innerText = t; };

    setV('ui-slider-threshold', p.threshold); setT('ui-thresh-display', parseFloat(p.threshold).toFixed(1) + 'x');
    setV('ui-slider-density', p.density); setT('ui-density-display', p.density + '%');
    
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