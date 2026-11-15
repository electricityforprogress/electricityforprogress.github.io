/**
 * js/globals.js
 * bioQuad Master State & Calibration Matrix
 */
window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

window.isMasterMuted = false;
window.masterVolumeLevel = 0.75; 
window.masterGain = window.audioCtx.createGain();
window.masterGain.gain.value = 0.75;
window.masterLimiter = window.audioCtx.createDynamicsCompressor();
window.masterLimiter.threshold.value = -2.0;
window.masterLimiter.knee.value = 3.0;
window.masterLimiter.ratio.value = 12.0;
window.masterLimiter.attack.value = 0.001;
window.masterLimiter.release.value = 0.12;
window.masterAnalyser = window.audioCtx.createAnalyser();
window.masterGain.connect(window.masterLimiter);
window.masterLimiter.connect(window.masterAnalyser);
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
window.isApplyingAutomation = false;
window.recordPerfParam = function(channelOneBased, attr, value, immediate = false) {
    if (window.isApplyingAutomation) return;
    if (window.biodataRecorder && typeof window.biodataRecorder.recordParam === 'function') {
        window.biodataRecorder.recordParam(channelOneBased, attr, value, immediate);
    }
};
window.recordPerfSnapshotDelta = function(chIdxOrNull = null) {
    if (window.isApplyingAutomation) return;
    if (window.biodataRecorder && typeof window.biodataRecorder.recordSnapshotDelta === 'function') {
        window.biodataRecorder.recordSnapshotDelta(chIdxOrNull);
    }
};
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
    sources: { osc1: { type: 'sawtooth', level: 1.0 }, noise: { level: 0.0 } },
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
    activeScaleBits: new Array(12).fill(true)
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

window.decodeScaleBits = function(rawBits) {
    if (rawBits === null || rawBits === undefined) return null;

    const fromMask = (mask) => {
        const m = Number(mask) & 0x0FFF;
        return Array.from({ length: 12 }, (_, i) => ((m >> i) & 1) !== 0);
    };

    if (typeof rawBits === 'number' && isFinite(rawBits)) {
        return fromMask(rawBits);
    }

    if (Array.isArray(rawBits)) {
        if (rawBits.length === 12) {
            return rawBits.map(b => Boolean(typeof b === 'string' ? (b === '1' || b.toLowerCase() === 'true') : b));
        }
        if (rawBits.length === 2) {
            const lo = Number(rawBits[0]) & 0xFF;
            const hi = Number(rawBits[1]) & 0x0F;
            return fromMask(lo | (hi << 8));
        }
        if (rawBits.length > 0 && rawBits.length < 12) {
            return Array.from({ length: 12 }, (_, i) => Boolean(rawBits[i]));
        }
        return null;
    }

    if (typeof rawBits === 'string') {
        const s = rawBits.trim();
        if (!s) return null;
        if (/^[01]{12}$/.test(s)) {
            return s.split('').map(c => c === '1');
        }
        if (/^0x[0-9a-f]+$/i.test(s)) {
            return fromMask(parseInt(s, 16));
        }
        if (s.includes(',')) {
            const parts = s.split(',').map(p => p.trim());
            if (parts.length === 2) {
                const lo = parseInt(parts[0], 10);
                const hi = parseInt(parts[1], 10);
                if (!isNaN(lo) && !isNaN(hi)) return fromMask((lo & 0xFF) | ((hi & 0x0F) << 8));
            }
            if (parts.length >= 1) {
                return Array.from({ length: 12 }, (_, i) => {
                    const tok = String(parts[i] ?? '').trim().toLowerCase();
                    return tok === '1' || tok === 'true' || tok === 'yes';
                });
            }
        }
        if (/^\d+$/.test(s)) {
            const num = parseInt(s, 10);
            if (!isNaN(num) && num >= 0 && num <= 4095) return fromMask(num);
        }
        return null;
    }

    if (typeof rawBits === 'object') {
        if (ArrayBuffer.isView(rawBits)) {
            return window.decodeScaleBits(Array.from(rawBits));
        }
        const keys = Object.keys(rawBits);
        if (keys.includes('0') && keys.includes('11')) {
            return Array.from({ length: 12 }, (_, i) => Boolean(rawBits[i]));
        }
        if (keys.length === 2 && keys.includes('0') && keys.includes('1')) {
            return fromMask((Number(rawBits[0]) & 0xFF) | ((Number(rawBits[1]) & 0x0F) << 8));
        }
    }

    return null;
};

window.encodeScaleMask = function(activeScaleBits) {
    const bits = window.decodeScaleBits(activeScaleBits);
    if (!bits) return 0x0FFF;
    let mask = 0;
    for (let i = 0; i < 12; i++) {
        if (bits[i]) mask |= (1 << i);
    }
    return mask;
};

window.buildScaleBitsFromPreset = function(scaleType, scaleRoot = 0) {
    const root = ((parseInt(scaleRoot, 10) || 0) % 12 + 12) % 12;
    const degrees = (window.SCALES && window.SCALES[scaleType]) ? window.SCALES[scaleType] : null;
    if (!degrees || scaleType === 'chromatic') {
        return new Array(12).fill(true);
    }
    const bits = new Array(12).fill(false);
    degrees.forEach(deg => {
        bits[(root + deg) % 12] = true;
    });
    return bits;
};

window.detectScaleFromBits = function(activeScaleBits, preferredRoot = 0) {
    const normRoot = ((parseInt(preferredRoot, 10) || 0) % 12 + 12) % 12;
    const bits = window.decodeScaleBits(activeScaleBits);
    if (!bits) {
        return { scaleType: 'custom', scaleRoot: normRoot };
    }
    if (bits.every(Boolean)) {
        return { scaleType: 'chromatic', scaleRoot: normRoot };
    }
    const activeCount = bits.filter(Boolean).length;
    if (activeCount === 0) {
        return { scaleType: 'custom', scaleRoot: normRoot };
    }

    const rootsToTry = [normRoot];
    for (let r = 0; r < 12; r++) {
        if (!rootsToTry.includes(r)) rootsToTry.push(r);
    }

    const scaleNames = Object.keys(window.SCALES || {}).filter(k => k !== 'chromatic');
    for (const root of rootsToTry) {
        for (const name of scaleNames) {
            const degrees = window.SCALES[name];
            if (degrees.length !== activeCount) continue;
            const matches = degrees.every(deg => bits[(root + deg) % 12]);
            if (matches) {
                return { scaleType: name, scaleRoot: root };
            }
        }
    }
    return { scaleType: 'custom', scaleRoot: normRoot };
};

window.normalizeScaleParams = function(params) {
    if (!params || typeof params !== 'object') return params;

    const root = ((parseInt(params.scaleRoot ?? params.root ?? 0, 10) || 0) % 12 + 12) % 12;
    params.scaleRoot = root;

    const rawScaleSource = params.activeScaleBits !== undefined
        ? params.activeScaleBits
        : (params.scaleBits !== undefined
            ? params.scaleBits
            : (params.scaleMask !== undefined
                ? params.scaleMask
                : (params.scl !== undefined
                    ? params.scl
                    : params.scaleBytes)));

    let bits = window.decodeScaleBits(rawScaleSource);
    const rawScaleType = params.scaleType !== undefined ? params.scaleType : params.scale;
    const hasNamedScale = Boolean(rawScaleType && window.SCALES && window.SCALES[rawScaleType]);

    if (!bits) {
        if (hasNamedScale) {
            bits = window.buildScaleBitsFromPreset(rawScaleType, root);
        } else {
            bits = new Array(12).fill(true);
            params.scaleType = 'chromatic';
        }
    } else if (bits.every(Boolean) && hasNamedScale && rawScaleType !== 'chromatic') {
        // Legacy preset had scaleType specified (e.g., major/minor) while activeScaleBits stayed untouched default all-true
        bits = window.buildScaleBitsFromPreset(rawScaleType, root);
    }

    params.activeScaleBits = bits;
    const detected = window.detectScaleFromBits(bits, root);
    params.scaleType = detected.scaleType;
    params.scaleRoot = detected.scaleRoot;
    return params;
};

window.scaleNote = function(rawNote, scaleType, root, activeScaleBits, minNote = 0, maxNote = 127) {
    let snappedNote = Math.max(minNote, Math.min(maxNote, rawNote));
    let bits = window.decodeScaleBits(activeScaleBits);
    if (!bits && scaleType && window.SCALES && window.SCALES[scaleType]) {
        bits = window.buildScaleBitsFromPreset(scaleType, root);
    }
    if (!bits) return snappedNote;
    if (bits.every(Boolean) || bits.every(b => !b)) return snappedNote;
    if (bits[snappedNote % 12]) return snappedNote;

    for (let offset = 1; offset <= 12; offset++) {
        let up = snappedNote + offset;
        if (up <= maxNote && bits[up % 12]) return up;
        let down = snappedNote - offset;
        if (down >= minNote && bits[down % 12]) return down;
    }
    return snappedNote;
};

window.globalFX = {
    dly: { time: 0.5, feedback: 0.5, tone: 2000, toRev: 0.2 },
    rev: { size: 2.0, damp: 3000, hpf: 100 }
};

function cloneWithDefaults(overrides) {
    const base = JSON.parse(JSON.stringify(window.defaultParams));
    const next = Object.assign(base, overrides || {});
    if (overrides && overrides.sources) next.sources = JSON.parse(JSON.stringify(overrides.sources));
    if (overrides && overrides.filter) next.filter = JSON.parse(JSON.stringify(overrides.filter));
    if (overrides && overrides.ampEnv) next.ampEnv = JSON.parse(JSON.stringify(overrides.ampEnv));
    if (overrides && overrides.filterEnv) next.filterEnv = JSON.parse(JSON.stringify(overrides.filterEnv));
    if (overrides && overrides.pitchEnv) next.pitchEnv = JSON.parse(JSON.stringify(overrides.pitchEnv));
    if (overrides && overrides.fx) next.fx = JSON.parse(JSON.stringify(overrides.fx));
    return window.normalizeScaleParams(next);
}

// --- FACTORY CHANNEL PRESETS (Individual Synth Tracks) ---
window.FACTORY_CHANNEL_PRESETS = {
    "Deep Sub Drone": {
        params: cloneWithDefaults({ mixVol: 0.8, voices: 1, legato: 1, stealMode: 'env', steal: 'env', glide: 0.2, minNote: 24, maxNote: 48, durMult: 4.0, sources: { osc1: { type: 'sine', level: 1.0 }, noise: { level: 0.0 } }, ampEnv: { atk: 2.0, dec: 1.0, sus: 1.0, rel: 4.0, amt: 1.0, timeMode: 'norm' } }),
        config: { zoom: 500, smooth: 0.05, freeze: false }
    },
    "Soft Plucks": {
        params: cloneWithDefaults({ mixVol: 0.6, voices: 6, stealMode: 'oldest', steal: 'oldest', minNote: 48, maxNote: 72, durMult: 0.5, sources: { osc1: { type: 'triangle', level: 1.0 }, noise: { level: 0.0 } }, ampEnv: { atk: 0.05, dec: 0.3, sus: 0.2, rel: 1.5, amt: 1.0, timeMode: 'norm' }, filter: { cutoff: 2000, res: 4 } }),
        config: { zoom: 500, smooth: 0.05, freeze: false }
    },
    "Shimmer Arp": {
        params: cloneWithDefaults({ mixVol: 0.5, voices: 4, stealMode: 'oldest', steal: 'oldest', minNote: 72, maxNote: 96, quantize: 4, durMult: 0.2, sources: { osc1: { type: 'sawtooth', level: 1.0 }, noise: { level: 0.0 } }, ampEnv: { atk: 0.01, dec: 0.1, sus: 0.0, rel: 0.5, amt: 1.0, timeMode: 'norm' } }),
        config: { zoom: 500, smooth: 0.05, freeze: false }
    },
    "Bio Percussion": {
        params: cloneWithDefaults({ mixVol: 0.7, voices: 4, stealMode: 'oldest', steal: 'oldest', density: 15, quantize: 3, minNote: 36, maxNote: 50, sources: { osc1: { type: 'drums', level: 1.0 }, noise: { level: 0.0 } } }),
        config: { zoom: 500, smooth: 0.05, freeze: false }
    }
};

// --- FACTORY GLOBAL PRESETS (The 4-Channel Master State) ---
window.FACTORY_PRESETS = {
    "Ambient Orchid": {
        master: { vol: 0.75, muted: false, bpm: 90 },
        globalFX: { dly: { time: 0.75, feedback: 0.6, tone: 1500, toRev: 0.4 }, rev: { size: 3.5, damp: 2000, hpf: 150 } },
        channels: [
            { ...JSON.parse(JSON.stringify(window.FACTORY_CHANNEL_PRESETS["Deep Sub Drone"].params)), savedPatchName: "Deep Sub Drone" },
            { ...JSON.parse(JSON.stringify(window.FACTORY_CHANNEL_PRESETS["Soft Plucks"].params)), savedPatchName: "Soft Plucks" },
            { ...JSON.parse(JSON.stringify(window.FACTORY_CHANNEL_PRESETS["Shimmer Arp"].params)), savedPatchName: "Shimmer Arp" },
            { ...JSON.parse(JSON.stringify(window.FACTORY_CHANNEL_PRESETS["Bio Percussion"].params)), savedPatchName: "Bio Percussion" }
        ],
        viz: [
            JSON.parse(JSON.stringify(window.FACTORY_CHANNEL_PRESETS["Deep Sub Drone"].config)),
            JSON.parse(JSON.stringify(window.FACTORY_CHANNEL_PRESETS["Soft Plucks"].config)),
            JSON.parse(JSON.stringify(window.FACTORY_CHANNEL_PRESETS["Shimmer Arp"].config)),
            JSON.parse(JSON.stringify(window.FACTORY_CHANNEL_PRESETS["Bio Percussion"].config))
        ]
    }
};
