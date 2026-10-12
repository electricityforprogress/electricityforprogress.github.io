/**
 * js/audioEngine.js
 */

function initCustomWaves() {
    const numHarms = 32; 
    const real = new Float32Array(numHarms), imag = new Float32Array(numHarms);
    for (let i = 1; i < numHarms; i++) imag[i] = -(2 / (i * Math.PI)); 
    window.rampDownWave = audioCtx.createPeriodicWave(real, imag);
    
    const bufSize = audioCtx.sampleRate * 2;
    window.noiseBuffer = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) output[i] = Math.random() * 2 - 1;
}

class EnvelopeGen {
    static apply(param, now, stopTime, envConfig, type, peakVal, baseVal = 0) {
        const { atk, dec, sus, rel, amt } = envConfig;
        const silenceFloor = 0.00001; 
        
        param.cancelScheduledValues(now);

        if (type === 'amp') {
            param.setValueAtTime(silenceFloor, now);
            param.exponentialRampToValueAtTime(Math.max(peakVal * amt, 0.01), now + atk);
            param.setTargetAtTime(Math.max(peakVal * amt * sus, silenceFloor), now + atk, dec / 3);
            
            param.cancelScheduledValues(stopTime); 
            if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(stopTime);

            param.exponentialRampToValueAtTime(silenceFloor, stopTime + rel);
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
            const detunePeak = 2400 * amt; 
            param.setValueAtTime(0, now);
            param.linearRampToValueAtTime(detunePeak, now + atk);
            param.setTargetAtTime(detunePeak * sus, now + atk, dec / 3);
            
            param.cancelScheduledValues(stopTime);
            if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(stopTime);
            param.setTargetAtTime(0, stopTime, rel / 3);
        }
    }
}

class SourceModule {
    constructor() { this.output = audioCtx.createGain(); this.detuneNode = null; }
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

class SynthVoice {
    constructor(channelOut) {
        this.activeUntil = 0;
        this.sources = {
            osc1: new AnalogOscillator('sawtooth'),
            sub: new AnalogOscillator('square'),
            noise: new NoiseGenerator()
        };
        this.vcf = audioCtx.createBiquadFilter();
        this.vcf.type = 'lowpass';
        this.vca = audioCtx.createGain();
        this.vca.gain.value = 0.00001;

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

        this.sources.osc1.setFrequency(freq, now, glide);
        this.sources.sub.setFrequency(freq / 2, now, glide);
        this.sources.noise.setPlaybackRate(freq / 440, now, glide);

        if (!overlapping) {
            EnvelopeGen.apply(this.vca.gain, now, stopTime, params.ampEnv, 'amp', velocity / 127);
            EnvelopeGen.apply(this.vcf.frequency, now, stopTime, params.filterEnv, 'filter', null, params.filter.cutoff);
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

class PolyChannel {
    constructor(id) {
        this.id = id; this.masterVolume = 0.8;
        this.lastTriggerTime = 0; this.lastDuration = 0; this.voiceIndex = 0;
        this.params = JSON.parse(JSON.stringify(window.defaultParams));
        this.params.midiOutCh = id;

        this.channelOut = audioCtx.createGain(); 
        this.channelOut.gain.value = this.masterVolume;
        
        this.analyser = audioCtx.createAnalyser();
        this.channelOut.connect(this.analyser);
        
        this.ampLfoNode = audioCtx.createGain(); 
        this.channelOut.connect(this.ampLfoNode); 
        this.ampLfoNode.connect(masterGain); 

        this.lfos = {
            pitch: { osc: audioCtx.createOscillator(), gain: audioCtx.createGain() },
            filter: { osc: audioCtx.createOscillator(), gain: audioCtx.createGain() },
            amp: { osc: audioCtx.createOscillator(), gain: audioCtx.createGain() }
        };

        Object.values(this.lfos).forEach(lfo => { lfo.osc.connect(lfo.gain); lfo.osc.start(); });
        this.lfos.amp.gain.connect(this.ampLfoNode.gain);

        this.voices = [];
        for (let i = 0; i < 5; i++) {
            let voice = new SynthVoice(this.channelOut);
            this.lfos.pitch.gain.connect(voice.sources.osc1.detuneNode);
            this.lfos.pitch.gain.connect(voice.sources.sub.detuneNode);
            this.lfos.filter.gain.connect(voice.vcf.detune);
            this.voices.push(voice);
        }
        this.applyParams();
    }

   setVolume(val) { 
        this.params.mixVol = parseFloat(val); 
        this.channelOut.gain.value = this.params.muted ? 0 : this.params.mixVol; 
    }
    toggleMute() { 
        this.params.muted = !this.params.muted; 
        this.channelOut.gain.value = this.params.muted ? 0 : this.params.mixVol; 
    }
    applyParams() {
        const p = this.params;
        const configureLFO = (lfoKey, config, depthMult) => {
            const lfo = this.lfos[lfoKey];
            if (config.shape === 'random') lfo.gain.gain.value = 0; 
            else {
                if (config.shape === 'rampdown' && typeof rampDownWave !== 'undefined') lfo.osc.setPeriodicWave(rampDownWave); 
                else lfo.osc.type = config.shape;
                lfo.osc.frequency.value = config.rate;
                lfo.gain.gain.value = config.depth * depthMult;
            }
        };
        configureLFO('pitch', p.pitchLfo, 200);   
        configureLFO('filter', p.filterLfo, 2000); 
        configureLFO('amp', p.ampLfo, 1.0);       
        this.voices.forEach(v => v.applySourceParams(p));
    }
    
    play(pitch, velocity, durationMs, scheduleTime) {
        // Find play time based on quantization delay passed from bleMidi
        const now = scheduleTime || (audioCtx.currentTime + 0.015); 
        const freq = 440 * Math.pow(2, (pitch - 69) / 12);
        
        let freeIdx = -1;
        let polyLimit = (this.params.mode === 'poly') ? 5 : 1;
        for (let i = 0; i < polyLimit; i++) { 
            if (now >= this.voices[i].activeUntil) { freeIdx = i; break; } 
        }
        
        if (this.params.mode !== '303') { 
            if (freeIdx === -1) return false; 
            this.voiceIndex = freeIdx; 
        } else { 
            this.voiceIndex = 0; 
        }
        
        this.lastTriggerTime = now; 
        this.lastDuration = Math.min(durationMs / 1000, 8.0); 
        const stopTime = now + this.lastDuration;
        
        // CRITICAL FIX: Book the physical polyphony slot regardless of mute status
        this.voices[this.voiceIndex].activeUntil = stopTime + this.params.ampEnv.rel;
        
        // THE DSP BYPASS: CPU is completely spared if muted, but MIDI engine still receives the "True" return below
        if (!this.params.muted && !window.isMasterMuted) {
            this.voices[this.voiceIndex].trigger(freq, velocity, now, stopTime, this.params);
        }
        
        return true; 
    }
}