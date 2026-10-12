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

// THE MASTER GRID
window.masterBPM = 120;
window.midiClockMode = 'out'; // 'in' or 'out'

window.SCALES = {
    'chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    'major': [0, 2, 4, 5, 7, 9, 11],
    'minor': [0, 2, 3, 5, 7, 8, 10],
    'pentatonic_major': [0, 2, 4, 7, 9],
    'pentatonic_minor': [0, 3, 5, 7, 10],
    'hirajoshi': [0, 2, 3, 7, 8]
};

window.defaultParams = {
    mixVol: 0.8, muted: false, mode: 'poly', glide: 0.1,
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

window.scaleNote = function(rawNote, scaleType, root) {
    if (scaleType === 'chromatic') return rawNote;
    let scale = window.SCALES[scaleType] || window.SCALES['major'];
    root = parseInt(root);
    let octave = Math.floor(rawNote / 12);
    let noteClass = rawNote % 12;
    let shiftedClass = (noteClass - root + 12) % 12;
    let closest = scale[0], minDiff = 12;
    for (let i = 0; i < scale.length; i++) {
        let diff = Math.abs(scale[i] - shiftedClass);
        if (diff < minDiff) { minDiff = diff; closest = scale[i]; }
    }
    return (octave * 12) + closest + root;
};