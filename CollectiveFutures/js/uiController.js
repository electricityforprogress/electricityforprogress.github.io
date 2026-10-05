/**
 * js/uiController.js
 * 
 * Handles DOM interactions, rendering synth panels, routing knobs/sliders,
 * and preset functionality.
 * 
 * FUTURE ENHANCEMENT: The preset functions below (savePreset, loadPreset, etc.)
 * are ready to be attached to the new "preset pop box" HTML modal when built.
 */

function toggleMasterMute() {
    isMasterMuted = !isMasterMuted;
    masterGain.gain.value = isMasterMuted ? 0 : 1.0;
    const btn = document.getElementById('btn-master-mute');
    // FUTURE ENHANCEMENT: Mute button state changes to 'LOGGING ACTIVE' to support upcoming background data tasks
    btn.innerText = isMasterMuted ? 'AUDIO MUTED (LOGGING ACTIVE)' : 'MUTE ALL AUDIO';
    btn.style.backgroundColor = isMasterMuted ? 'var(--red)' : 'var(--border)';
    btn.style.color = isMasterMuted ? 'var(--bg)' : 'var(--text)';
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
    
    if (param === 'bpm') {
        document.getElementById('ui-bpm-display').innerText = Math.round(value).toString().padStart(3, '0');
    }
    
    // Push threshold updates back to hardware so physical LEDs match
    if (param === 'threshold' && typeof bleTxCharacteristic !== 'undefined' && bleTxCharacteristic) {
        bleTxCharacteristic.writeValueWithoutResponse(new TextEncoder().encode(`T${activeSynthIndex}:${value}\n`));
    }
    
    synthChannels[activeSynthIndex].applyParams();
}

// --- Preset Management (Ready to hook into new Pop-box Modal) ---
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
    const presetData = synthChannels.map(ch => JSON.parse(JSON.stringify(ch.params)));
    globalPresets[name] = presetData;
    localStorage.setItem('biodataPresets', JSON.stringify(globalPresets));
    updatePresetDropdown();
    document.getElementById('preset-select').value = name;
}

function loadPreset(name) {
    if (!name || !globalPresets[name]) return;
    ensureSynths();
    const presetData = globalPresets[name];
    for (let i = 0; i < 4; i++) {
        if (presetData[i] && synthChannels[i]) {
            synthChannels[i].params = JSON.parse(JSON.stringify(presetData[i]));
            synthChannels[i].applyParams();
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

// --- Context UI State ---
let activeLfoView = 'pitchLfo';
let activeEnvView = 'ampEnv';

function switchModView(type, targetView) {
    if (type === 'lfo') activeLfoView = targetView;
    if (type === 'env') activeEnvView = targetView;
    syncUI(); // Re-render sliders and knobs to match the selected destination
}

function updateNestedSynth(group, param, value) {
    if (!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    
    let targetObj;
    if (group === 'lfo') targetObj = p[activeLfoView];
    else if (group === 'env') targetObj = p[activeEnvView];
    else if (group === 'filter') targetObj = p.filter;
    else if (group === 'sources') targetObj = p.sources;
    
    // Handle deep dot notation (e.g., 'osc1.type' or 'sub.level')
    if (param.includes('.')) {
        const keys = param.split('.');
        targetObj[keys[0]][keys[1]] = isNaN(value) ? value : parseFloat(value);
    } else {
        targetObj[param] = isNaN(value) ? value : parseFloat(value);
    }
    
    synthChannels[activeSynthIndex].applyParams();
    updateModLEDs(); 
}

// --- Dynamic Knobs ---
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
            
            knob.dataset.val = newVal; 
            updateDial(newVal); 
            
            // Route data to the correct param level
            const group = knob.dataset.group;
            if (group) {
                updateNestedSynth(group, knob.dataset.param, newVal);
            } else {
                updateActiveSynth(knob.dataset.param, newVal);
            }
        });
        window.addEventListener('mouseup', () => isDragging = false);
    });
}

function syncUI() {
    if (!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    
    // Sync Standard Selects
    ['ui-scaleRoot', 'ui-scaleType', 'ui-mode'].forEach(id => { 
        let el = document.getElementById(id); if(el) el.value = p[id.replace('ui-', '')]; 
    });
    
    // Sync Wave selector to the new modular architecture
    const waveEl = document.getElementById('ui-wave');
    if(waveEl) waveEl.value = p.sources.osc1.type;
    
    // Sync LFO and ENV Selects/Sliders mapped to current view
    document.getElementById('ui-lfo-shape').value = p[activeLfoView].shape;
    ['atk', 'dec', 'sus', 'rel'].forEach(id => {
        let el = document.getElementById(`ui-env-${id}`);
        if(el) el.value = p[activeEnvView][id];
    });

    document.getElementById('ui-bpm-display').innerText = Math.round(p.bpm).toString().padStart(3, '0');
    
    // Sync Context-Aware Knobs
    document.querySelectorAll('.synth-inspector .knob-track').forEach(knob => {
        const param = knob.dataset.param; 
        const group = knob.dataset.group;
        let val;
        
        if (group === 'lfo') val = p[activeLfoView][param];
        else if (group === 'env') val = p[activeEnvView][param];
        else if (group === 'filter') val = p.filter[param];
        else if (group === 'sources') {
            const keys = param.split('.');
            val = p.sources[keys[0]][keys[1]];
        }
        else val = p[param]; // Root level fallback

        knob.dataset.val = val;
        const min = parseFloat(knob.dataset.min), max = parseFloat(knob.dataset.max), isLog = knob.dataset.log === "true";
        let pct = isLog ? (Math.log(val) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (val - min) / (max - min);
        knob.querySelector('.knob-dial').style.transform = `rotate(${-135 + (pct * 270)}deg)`;
    });
    
    syncPianoUI();
    updateModLEDs();
}

// Visual feedback for non-selected destinations
function updateModLEDs() {
    if (!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    
    const setLed = (id, val, maxVal = 1.0) => {
        const el = document.getElementById(id);
        if (el) el.style.opacity = 0.1 + (0.9 * (val / maxVal));
    };

    // LFO LEDs are now animated dynamically in visualizer.js
    // We only need to statically update the Envelope amount LEDs here
    setLed('ind-env-pitchEnv', p.pitchEnv.amt);
    setLed('ind-env-filterEnv', p.filterEnv.amt);
    setLed('ind-env-ampEnv', p.ampEnv.amt);
}

// --- Deleting Presets ---
function clearAllPresets() {
    if(confirm("Are you sure you want to delete all saved presets? This cannot be undone.")) {
        localStorage.removeItem('biodataPresets');
        globalPresets = {};
        updatePresetDropdown();
        alert("All presets have been cleared.");
    }
}


