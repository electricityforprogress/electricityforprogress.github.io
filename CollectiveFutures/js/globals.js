/**
 * js/globals.js
 */
window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

window.isMasterMuted = false;
window.masterVolumeLevel = 1.0; 
window.masterGain = window.audioCtx.createGain();
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

// The Master Grid
window.masterBPM = 120;
window.midiClockMode = 'out'; 
window.lastBeatTime = 0; // For flashing the global LED

window.SCALES = {
    'chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    'major': [0, 2, 4, 5, 7, 9, 11],
    'minor': [0, 2, 3, 5, 7, 8, 10],
    'pentatonic_major': [0, 2, 4, 7, 9],
    'pentatonic_minor': [0, 3, 5, 7, 10],
    'hirajoshi': [0, 2, 3, 7, 8]
};

window.defaultParams = {
    mixVol: 0.8, muted: false, 
    voices: 5, stealMode: 'oldest', legato: 0, glide: 0.1,
    sources: { osc1: { type: 'sawtooth', level: 1.0 }, sub: { level: 0.5 }, noise: { level: 0.0 } },
    filter: { cutoff: 2000, res: 6 },
    
    lfo:       { shape: 'sine', rate: 2.0, rateMode: 'lo', depth: 0 },
    pitchLfo:  { shape: 'sine', rate: 2.0, rateMode: 'lo', depth: 0 },
    filterLfo: { shape: 'sine', rate: 2.0, rateMode: 'lo', depth: 0 },
    ampLfo:    { shape: 'sine', rate: 2.0, rateMode: 'lo', depth: 0 },
    
    env: { atk: 0.1, dec: 0.2, sus: 0.5, rel: 1.0, amt: 0.5 },
    pitchEnv: { atk: 0.0, dec: 0.0, sus: 0.0, rel: 0.0, amt: 0.0 },
    filterEnv: { atk: 0.05, dec: 0.2, sus: 0.4, rel: 0.6, amt: 0.5 },
    ampEnv: { atk: 0.05, dec: 0.2, sus: 0.4, rel: 0.6, amt: 1.0 },
    
    fx: { drv: 0, drvGrit: 10, drvTone: 2000, drvLvl: 1.0, dly: 0, rev: 0 },
    
    threshold: 2.0, density: 100, quantize: 0, sampleSize: 40,
    minNote: 36, maxNote: 84, velMin: 60, velMax: 110,
    spread: 75, durMult: 1.0, 
    scaleRoot: 0, scaleType: 'chromatic',
    activeScaleBits: new Array(12).fill(true) 
};

window.mapScale = function(value, inMin, inMax, outMin, outMax) { return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin; };

window.applySpreadCurve = function(normPitch, spread) {
    let spreadNorm = spread / 100.0;
    let deviation = normPitch - 0.5;
    let sign = Math.sign(deviation);
    let pow = spreadNorm < 0.5 ? window.mapScale(spreadNorm, 0, 0.5, 3.0, 1.0) : window.mapScale(spreadNorm, 0.5, 1.0, 1.0, 0.33);
    return 0.5 + (sign * Math.pow(Math.abs(deviation) * 2, pow) / 2);
};

window.scaleNote = function(rawNote, scaleType, root, activeScaleBits, minNote = 0, maxNote = 127) {
    let allowedClasses = [];
    
    // 1. Gather valid note classes (0-11) based on scale mode
    if (scaleType === 'custom' && activeScaleBits) {
        for (let i = 0; i < 12; i++) {
            if (activeScaleBits[i]) allowedClasses.push(i);
        }
        if (allowedClasses.length === 0) allowedClasses = [0,2,4,5,7,9,11]; 
    } else if (scaleType !== 'chromatic') {
        let scale = window.SCALES[scaleType] || window.SCALES['major'];
        root = parseInt(root);
        for (let i = 0; i < scale.length; i++) {
            allowedClasses.push((scale[i] + root) % 12);
        }
    } else {
        allowedClasses = [0,1,2,3,4,5,6,7,8,9,10,11];
    }

    // 2. Generate a strict, sorted array of ONLY the valid MIDI notes within the bounds
    let validNotes = [];
    for (let note = minNote; note <= maxNote; note++) {
        if (allowedClasses.includes(note % 12)) validNotes.push(note);
    }
    
    if (validNotes.length === 0) return Math.max(minNote, Math.min(maxNote, 60));

    // 3. Convert the incoming rawNote back into a 0.0 - 1.0 percentage across the slider bounds
    let pct = (rawNote - minNote) / (maxNote - minNote || 1);
    
    // 4. Map that percentage evenly across the available valid notes
    let index = Math.round(pct * (validNotes.length - 1));
    index = Math.max(0, Math.min(validNotes.length - 1, index));
    
    return validNotes[index];
};

window.globalFX = {
    dly: { time: 0.5, feedback: 0.5, tone: 2000, toRev: 0.2 },
    rev: { size: 2.0, damp: 3000, hpf: 100 }
};
