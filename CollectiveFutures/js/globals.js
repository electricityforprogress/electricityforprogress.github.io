/**
 * js/globals.js
 * bioQuad Master State & Calibration Matrix
 */
window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

window.isMasterMuted = false;
window.masterVolumeLevel = 0.75; 
window.masterGain = window.audioCtx.createGain();
window.masterGain.gain.value = 0.75;
window.masterAnalyser = window.audioCtx.createAnalyser();
window.masterGain.connect(window.masterAnalyser);
window.masterAnalyser.connect(window.audioCtx.destination);

window.synthChannels = [];
window.chData = [{}, {}, {}, {}];
window.activeSynthIndex = 0;
window.midiOutput = null;

// Global UI Constants
window.CH_COLORS = ['#ff3333', '#39ff14', '#33ccff', '#b84dff']; 
window.ZOOM_STEPS = [50, 100, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 120000];

// Master Clock & Grid
window.masterBPM = 120;
window.midiClockMode = 'out'; 
window.lastBeatTime = 0; 

window.SCALES = {
    'chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    'major': [0, 2, 4, 5, 7, 9, 11],
    'minor': [0, 2, 3, 5, 7, 8, 10],
    'pentatonic_major': [0, 2, 4, 7, 9],
    'pentatonic_minor': [0, 3, 5, 7, 10],
    'hirajoshi': [0, 2, 3, 7, 8]
};

window.defaultParams = {
    mixVol: 0.50, muted: false, 
    voices: 5, stealMode: 'none', steal: 'none', legato: 0, glide: 0.0,
    sources: { osc1: { type: 'sawtooth', level: 1.0 }, sub: { level: 0.0 }, noise: { level: 0.0 } },
    filter: { cutoff: 8000, res: 2 },
    
    lfo:       { shape: 'sine', rate: 2.0, rateMode: 'lo', depth: 0 },
    pitchLfo:  { shape: 'sine', rate: 2.0, rateMode: 'lo', depth: 0 },
    filterLfo: { shape: 'sine', rate: 2.0, rateMode: 'lo', depth: 0 },
    ampLfo:    { shape: 'sine', rate: 2.0, rateMode: 'lo', depth: 0 },
    
    env: { atk: 0.01, dec: 0.01, sus: 1.0, rel: 0.01, amt: 0.5, timeMode: 'norm' },
    pitchEnv: { atk: 0.0, dec: 0.0, sus: 0.0, rel: 0.0, amt: 0.0, timeMode: 'norm' },
    filterEnv: { atk: 0.01, dec: 0.01, sus: 1.0, rel: 0.01, amt: 0.5, timeMode: 'norm' },
    ampEnv: { atk: 0.01, dec: 0.01, sus: 1.0, rel: 0.01, amt: 1.0, timeMode: 'norm' },
    
    fx: { drv: 0, drvGrit: 10, drvTone: 2000, drvLvl: 1.0, dly: 0, rev: 0 },
    
    threshold: 2.0, 
    threshMax: 5.0, // Scalable: 1.0 to 10.0
    noiseFloor: 0.1, 
    density: 100, 
    quantize: 0, 
    sampleSize: 40,
    minNote: 36, maxNote: 84, velMin: 60, velMax: 110,
    spread: 75, durMult: 1.0, 
    scaleRoot: 0, scaleType: 'chromatic',
    activeScaleBits: new Array(12).fill(true),
    testIntensity: 0
};

window.mapScale = function(value, inMin, inMax, outMin, outMax) { 
    return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin; 
};

window.applySpreadCurve = function(normPitch, spread) {
    let spreadNorm = spread / 100.0;
    let deviation = normPitch - 0.5;
    let sign = Math.sign(deviation);
    let pow = spreadNorm < 0.5 ? window.mapScale(spreadNorm, 0, 0.5, 3.0, 1.0) : window.mapScale(spreadNorm, 0.5, 1.0, 1.0, 0.33);
    return 0.5 + (sign * Math.pow(Math.abs(deviation) * 2, pow) / 2);
};

window.scaleNote = function(rawNote, scaleType, root, activeScaleBits, minNote = 0, maxNote = 127) {
    let snappedNote = Math.max(minNote, Math.min(maxNote, rawNote));
    
    if (scaleType === 'chromatic') return snappedNote;
    if (activeScaleBits[snappedNote % 12]) return snappedNote;

    for (let offset = 1; offset <= 12; offset++) {
        let up = snappedNote + offset;
        if (up <= maxNote && activeScaleBits[up % 12]) return up;
        let down = snappedNote - offset;
        if (down >= minNote && activeScaleBits[down % 12]) return down;
    }
    return snappedNote;
};

window.globalFX = {
    dly: { time: 0.5, feedback: 0.5, tone: 2000, toRev: 0.2 },
    rev: { size: 2.0, damp: 3000, hpf: 100 }
};

// --- FACTORY CHANNEL PRESETS (Individual Synth Tracks) ---
window.FACTORY_CHANNEL_PRESETS = {
    "Deep Sub Drone": {
        params: { ...window.defaultParams, mixVol: 0.8, voices: 1, legato: 1, stealMode: 'env', steal: 'env', glide: 0.2, minNote: 24, maxNote: 48, durMult: 4.0, sources: { osc1: { type: 'sine', level: 1.0 }, sub: { level: 0.0 }, noise: { level: 0.0 } }, ampEnv: { atk: 2.0, dec: 1.0, sus: 1.0, rel: 4.0, amt: 1.0, timeMode: 'norm' } },
        config: { zoom: 500, smooth: 0.05, freeze: false }
    },
    "Soft Plucks": {
        params: { ...window.defaultParams, mixVol: 0.6, voices: 6, stealMode: 'oldest', steal: 'oldest', minNote: 48, maxNote: 72, durMult: 0.5, sources: { osc1: { type: 'triangle', level: 1.0 }, sub: { level: 0.0 }, noise: { level: 0.0 } }, ampEnv: { atk: 0.05, dec: 0.3, sus: 0.2, rel: 1.5, amt: 1.0, timeMode: 'norm' }, filter: { cutoff: 2000, res: 4 } },
        config: { zoom: 500, smooth: 0.05, freeze: false }
    },
    "Shimmer Arp": {
        params: { ...window.defaultParams, mixVol: 0.5, voices: 4, stealMode: 'oldest', steal: 'oldest', minNote: 72, maxNote: 96, quantize: 4, durMult: 0.2, sources: { osc1: { type: 'sawtooth', level: 1.0 }, sub: { level: 0.0 }, noise: { level: 0.0 } }, ampEnv: { atk: 0.01, dec: 0.1, sus: 0.0, rel: 0.5, amt: 1.0, timeMode: 'norm' } },
        config: { zoom: 500, smooth: 0.05, freeze: false }
    },
    "Bio Percussion": {
        params: { ...window.defaultParams, mixVol: 0.7, voices: 4, stealMode: 'oldest', steal: 'oldest', density: 15, quantize: 3, minNote: 36, maxNote: 50, sources: { osc1: { type: 'drums', level: 1.0 }, sub: { level: 0.0 }, noise: { level: 0.0 } } },
        config: { zoom: 500, smooth: 0.05, freeze: false }
    }
};

// --- FACTORY GLOBAL PRESETS (The 4-Channel Master State) ---
window.FACTORY_PRESETS = {
    "Ambient Orchid": {
        master: { vol: 0.75, muted: false, bpm: 90 },
        globalFX: { dly: { time: 0.75, feedback: 0.6, tone: 1500, toRev: 0.4 }, rev: { size: 3.5, damp: 2000, hpf: 150 } },
        channels: [
            { ...window.FACTORY_CHANNEL_PRESETS["Deep Sub Drone"].params, savedPatchName: "Deep Sub Drone" },
            { ...window.FACTORY_CHANNEL_PRESETS["Soft Plucks"].params, savedPatchName: "Soft Plucks" },
            { ...window.FACTORY_CHANNEL_PRESETS["Shimmer Arp"].params, savedPatchName: "Shimmer Arp" },
            { ...window.FACTORY_CHANNEL_PRESETS["Bio Percussion"].params, savedPatchName: "Bio Percussion" }
        ],
        viz: [
            window.FACTORY_CHANNEL_PRESETS["Deep Sub Drone"].config,
            window.FACTORY_CHANNEL_PRESETS["Soft Plucks"].config,
            window.FACTORY_CHANNEL_PRESETS["Shimmer Arp"].config,
            window.FACTORY_CHANNEL_PRESETS["Bio Percussion"].config
        ]
    }
};
