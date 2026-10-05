/**
 * js/audioEngine.js
 * 
 * Core DSP logic - Refactored for Modular Expansion
 */

// --- UTILITIES & GLOBALS ---
function initCustomWaves() {
    const numHarms = 32; 
    const real = new Float32Array(numHarms), imag = new Float32Array(numHarms);
    for (let i = 1; i < numHarms; i++) imag[i] = -(2 / (i * Math.PI)); 
    rampDownWave = audioCtx.createPeriodicWave(real, imag);
    
    const bufSize = audioCtx.sampleRate * 2;
    noiseBuffer = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) output[i] = Math.random() * 2 - 1;
}

const SCALES = { /* ... (Keep your original SCALES object) ... */ };
function applyPitchMods(chIndex, rawPitch) { /* ... (Keep your original applyPitchMods logic) ... */ }

// --- 1. MODULATION & ENVELOPES ---

class EnvelopeGen {
    static apply(param, now, stopTime, envConfig, type, peakVal, baseVal = 0) {
        const { atk, dec, sus, rel, amt } = envConfig;
        const silenceFloor = 0.00001; 
        
        param.cancelScheduledValues(now);

        if (type === 'amp') {
            // --- ATTACK & DECAY ---
            param.setValueAtTime(silenceFloor, now);
            param.exponentialRampToValueAtTime(Math.max(peakVal * amt, 0.01), now + atk);
            param.setTargetAtTime(Math.max(peakVal * amt * sus, silenceFloor), now + atk, dec / 3);
            
            // --- RELEASE ---
            param.cancelScheduledValues(stopTime); 
            
            // Smoothly grab whatever the current volume is if the note is cut off early
            if (typeof param.cancelAndHoldAtTime === 'function') {
                param.cancelAndHoldAtTime(stopTime);
            }

            // Exponentially drop to the near-silent floor
            param.exponentialRampToValueAtTime(silenceFloor, stopTime + rel);
            
            // THE DRONE KILLER: Force the VCA to absolute mathematical zero right after 
            // the release finishes to completely silence the voice.
            param.linearRampToValueAtTime(0, stopTime + rel + 0.01); 
        } 
        else if (type === 'filter') {
            const targetCutoff = baseVal + (5000 * amt); 
            param.setValueAtTime(baseVal, now);
            param.exponentialRampToValueAtTime(targetCutoff, now + atk); 
            param.setTargetAtTime(baseVal + ((targetCutoff - baseVal) * sus), now + atk, dec / 3);
            
            param.cancelScheduledValues(stopTime);
            if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(stopTime);
            param.setTargetAtTime(baseVal, stopTime, rel / 3);
        } 
        else if (type === 'pitch') {
            const detunePeak = 2400 * amt; // 2 octaves max depth
            param.setValueAtTime(0, now);
            param.linearRampToValueAtTime(detunePeak, now + atk);
            param.setTargetAtTime(detunePeak * sus, now + atk, dec / 3);
            
            param.cancelScheduledValues(stopTime);
            if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(stopTime);
            param.setTargetAtTime(0, stopTime, rel / 3);
        }
    }
}

// --- 2. SOUND SOURCES (Extensible) ---

/** Base class for any sound generator (Analog, PCM, Wavetable) */
class SourceModule {
    constructor() {
        this.output = audioCtx.createGain();
        this.detuneNode = null; // Set this if the source supports detuning
    }
    connect(destination) { this.output.connect(destination); }
    start() {}
    setFrequency(freq, time, glide = 0) {}
    setPlaybackRate(rate, time, glide = 0) {}
}

class AnalogOscillator extends SourceModule {
    constructor(type = 'sawtooth') {
        super();
        this.osc = audioCtx.createOscillator();
        this.osc.type = type;
        this.detuneNode = this.osc.detune;
        this.osc.connect(this.output);
        this.osc.start();
    }
    setFrequency(freq, time, glide) {
        if (glide > 0) this.osc.frequency.linearRampToValueAtTime(freq, time + glide);
        else { this.osc.frequency.cancelScheduledValues(time); this.osc.frequency.setValueAtTime(freq, time); }
    }
}

class NoiseGenerator extends SourceModule {
    constructor() {
        super();
        this.noise = audioCtx.createBufferSource();
        this.noise.buffer = noiseBuffer;
        this.noise.loop = true;
        this.noise.connect(this.output);
        this.noise.start();
    }
    setPlaybackRate(rate, time, glide) {
        if (glide > 0) this.noise.playbackRate.linearRampToValueAtTime(rate, time + glide);
        else { this.noise.playbackRate.cancelScheduledValues(time); this.noise.playbackRate.setValueAtTime(rate, time); }
    }
}

// FUTURE ENHANCEMENT: Add WavetableSource and PCMSource here extending SourceModule
// class PCMSource extends SourceModule { ... }


// --- 3. SYNTH VOICE ---

class SynthVoice {
    constructor(channelOut) {
        this.activeUntil = 0;
        
        // Modules
        this.sources = {
            osc1: new AnalogOscillator('sawtooth'),
            sub: new AnalogOscillator('square'),
            noise: new NoiseGenerator()
            // Expand here later: pcm1: new PCMSource(), etc.
        };

        // Voice DSP Pipeline
        this.vcf = audioCtx.createBiquadFilter();
        this.vcf.type = 'lowpass';
        
        this.vca = audioCtx.createGain();
        this.vca.gain.value = 0.00001;

        // Routing
        Object.values(this.sources).forEach(src => src.connect(this.vcf));
        this.vcf.connect(this.vca);
        this.vca.connect(channelOut);
    }

    applySourceParams(params) {
        this.sources.osc1.osc.type = params.sources.osc1.type;
        this.sources.osc1.output.gain.value = params.sources.osc1.level;
        this.sources.sub.output.gain.value = params.sources.sub.level;
        this.sources.noise.output.gain.value = params.sources.noise.level;
        this.vcf.Q.value = params.filter.res;
    }

    trigger(freq, velocity, now, stopTime, params) {
        this.activeUntil = stopTime + params.ampEnv.rel;
        const overlapping = (params.mode === '303' && now < this.activeUntil);
        const glide = overlapping ? params.glide : 0;

        // 1. Set Frequencies
        this.sources.osc1.setFrequency(freq, now, glide);
        this.sources.sub.setFrequency(freq / 2, now, glide);
        this.sources.noise.setPlaybackRate(freq / 440, now, glide);

        // 2. Apply Envelopes (if not just gliding in mono mode)
        if (!overlapping) {
            EnvelopeGen.apply(this.vca.gain, now, stopTime, params.ampEnv, 'amp', velocity / 127);
            EnvelopeGen.apply(this.vcf.frequency, now, stopTime, params.filterEnv, 'filter', null, params.filter.cutoff);
            
            // Pitch envelopes routed to supported sources
            if (params.pitchEnv.amt > 0) {
                EnvelopeGen.apply(this.sources.osc1.detuneNode, now, stopTime, params.pitchEnv, 'pitch');
                EnvelopeGen.apply(this.sources.sub.detuneNode, now, stopTime, params.pitchEnv, 'pitch');
            } else {
                this.sources.osc1.detuneNode.setValueAtTime(0, now);
                this.sources.sub.detuneNode.setValueAtTime(0, now);
            }
        }
    }
}


// --- 4. CHANNEL MANAGER ---

class PolyChannel {
    constructor(id) {
        this.id = id; this.muted = false; this.masterVolume = 0.8;
        this.lastTriggerTime = 0; this.lastDuration = 0; this.voiceIndex = 0;

        // NEW STRUCTURED PARAMS
        this.params = {
            // Core logic
            bpm: 120, mode: 'poly', glide: 0.1,
            threshold: 2.0, sampleSize: 32, 
            scaleRoot: '0', scaleType: 'pentatonic_minor', activeScaleBits: new Array(12).fill(true),
            minNote: 36, maxNote: 84, spread: 75, density: 100,

            // Sound Generation
            sources: {
                osc1: { type: 'sawtooth', level: 1.0 },
                sub: { level: 0.5 },
                noise: { level: 0.0 }
            },
            filter: { cutoff: 2000, res: 6.0 },

            // Split Envelopes
            ampEnv: { atk: 0.05, dec: 0.2, sus: 0.4, rel: 0.6, amt: 1.0 },
            filterEnv: { atk: 0.05, dec: 0.2, sus: 0.4, rel: 0.6, amt: 0.5 },
            pitchEnv: { atk: 0.0, dec: 0.0, sus: 0.0, rel: 0.0, amt: 0.0 },

            // Split LFOs
            ampLfo: { shape: 'sine', rate: 2.0, depth: 0 },
            filterLfo: { shape: 'sine', rate: 2.0, depth: 0 },
            pitchLfo: { shape: 'sine', rate: 2.0, depth: 0 }
        };

        // Output Routing
        this.channelOut = audioCtx.createGain(); 
        this.channelOut.gain.value = this.masterVolume;
        
        // Tremolo gain for Amp LFO
        this.ampLfoNode = audioCtx.createGain(); 
        this.channelOut.connect(this.ampLfoNode); 
        this.ampLfoNode.connect(masterGain); 

        // Init LFOs
        this.lfos = {
            pitch: { osc: audioCtx.createOscillator(), gain: audioCtx.createGain() },
            filter: { osc: audioCtx.createOscillator(), gain: audioCtx.createGain() },
            amp: { osc: audioCtx.createOscillator(), gain: audioCtx.createGain() }
        };

        Object.values(this.lfos).forEach(lfo => {
            lfo.osc.connect(lfo.gain);
            lfo.osc.start();
        });
        
        // Wire up global Amp LFO
        this.lfos.amp.gain.connect(this.ampLfoNode.gain);

        // Init Voices
        this.voices = [];
        for (let i = 0; i < 5; i++) {
            let voice = new SynthVoice(this.channelOut);
            
            // Wire up Pitch and Filter LFOs to each voice
            this.lfos.pitch.gain.connect(voice.sources.osc1.detuneNode);
            this.lfos.pitch.gain.connect(voice.sources.sub.detuneNode);
            this.lfos.filter.gain.connect(voice.vcf.detune);
            
            this.voices.push(voice);
        }
        
        this.applyParams();
    }

    setVolume(val) { this.masterVolume = parseFloat(val); this.channelOut.gain.value = this.muted ? 0 : this.masterVolume; }
    
    toggleMute() { /* ... (Keep your original UI mute logic) ... */ }

    applyParams() {
        const p = this.params;

        // Apply LFO configs
        const configureLFO = (lfoKey, config, depthMult) => {
            const lfo = this.lfos[lfoKey];
            if (config.shape === 'random') lfo.gain.gain.value = 0; // Requires different logic (S&H)
            else {
                if (config.shape === 'rampdown' && typeof rampDownWave !== 'undefined') lfo.osc.setPeriodicWave(rampDownWave); 
                else lfo.osc.type = config.shape;
                
                lfo.osc.frequency.value = config.rate;
                lfo.gain.gain.value = config.depth * depthMult;
            }
        };

        configureLFO('pitch', p.pitchLfo, 200);   // +/- 200 cents
        configureLFO('filter', p.filterLfo, 2000); // +/- 2000 cents (detune works in cents)
        configureLFO('amp', p.ampLfo, 1.0);       // 0.0 to 1.0 amplitude depth

        // Update Voices
        this.voices.forEach(v => v.applySourceParams(p));
    }
    
    play(pitch, velocity, durationMs) {
        if (this.muted) return;
        
        // 15ms lookahead for smooth, click-free audio envelopes
        const now = audioCtx.currentTime + 0.015; 
        const freq = 440 * Math.pow(2, (pitch - 69) / 12);
        
        // Voice Allocation
        let freeIdx = -1;
        for (let i = 0; i < 5; i++) { if (now >= this.voices[i].activeUntil) { freeIdx = i; break; } }
        
        if (this.params.mode === 'poly') { 
            if (freeIdx === -1) return; // Note stealing logic could go here
            this.voiceIndex = freeIdx; 
        } else { 
            this.voiceIndex = 0; // Mono mode uses first voice
        }
        
        this.lastTriggerTime = now; 
        this.lastDuration = Math.min(durationMs / 1000, 8.0); 
        const stopTime = now + this.lastDuration;

        // Trigger Voice
        this.voices[this.voiceIndex].trigger(freq, velocity, now, stopTime, this.params);
    }
}
