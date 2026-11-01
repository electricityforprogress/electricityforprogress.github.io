/**
 * js/audioEngine.js
 * bioQuad Polyphonic Modular Synthesizer DSP Engine
 */

function initCustomWaves() {
    if (!window.audioCtx) return;
    const numHarms = 32; 
    const real = new Float32Array(numHarms), imag = new Float32Array(numHarms);
    for (let i = 1; i < numHarms; i++) imag[i] = -(2 / (i * Math.PI)); 
    window.rampDownWave = window.audioCtx.createPeriodicWave(real, imag);
    
    const bufSize = window.audioCtx.sampleRate * 2;
    window.noiseBuffer = window.audioCtx.createBuffer(1, bufSize, window.audioCtx.sampleRate);
    const output = window.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) output[i] = Math.random() * 2 - 1;
}

class MasterFXBus {
    constructor() {
        if (!window.globalFX) {
            window.globalFX = {
                dly: { time: 0.5, feedback: 0.5, tone: 2000, toRev: 0.2 },
                rev: { size: 2.0, damp: 3000, hpf: 100 }
            };
        }
        
        this.dlyIn = window.audioCtx.createGain();
        this.revIn = window.audioCtx.createGain();

        // 1. TAPE DELAY
        this.delay = window.audioCtx.createDelay(10.0); 
        this.feedback = window.audioCtx.createGain();
        this.dlyFilter = window.audioCtx.createBiquadFilter();
        this.dlyFilter.type = 'lowpass';
        
        this.dlyToMaster = window.audioCtx.createGain();
        this.dlyToRev = window.audioCtx.createGain();
        
        this.dlyIn.connect(this.delay);
        this.delay.connect(this.feedback);
        this.feedback.connect(this.dlyFilter);
        this.dlyFilter.connect(this.delay);
        
        this.delay.connect(this.dlyToMaster);
        this.dlyToMaster.connect(window.masterGain);
        
        this.delay.connect(this.dlyToRev);
        this.dlyToRev.connect(this.revIn);

        // 2. ALGORITHMIC REVERB
        this.revHpf = window.audioCtx.createBiquadFilter();
        this.revHpf.type = 'highpass';
        this.convolver = window.audioCtx.createConvolver();
        this.revFilter = window.audioCtx.createBiquadFilter();
        this.revFilter.type = 'lowpass';
        
        // Routing: revIn -> revHpf -> convolver -> revFilter -> masterGain
        this.revIn.connect(this.revHpf);
        this.revHpf.connect(this.convolver);
        this.convolver.connect(this.revFilter);
        this.revFilter.connect(window.masterGain);
        
        this.updateParams(window.globalFX);
    }

    makeReverbImpulse(time) {
        let length = Math.max(0.1, window.audioCtx.sampleRate * time);
        let impulse = window.audioCtx.createBuffer(2, length, window.audioCtx.sampleRate);
        for (let i = 0; i < 2; i++) {
            let channelData = impulse.getChannelData(i);
            for (let j = 0; j < length; j++) {
                channelData[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 3);
            }
        }
        return impulse;
    }

    updateParams(p) {
        const dlyTime = (p && p.dly && p.dly.time !== undefined) ? p.dly.time : 0.5;
        const dlyFbk = (p && p.dly && p.dly.feedback !== undefined) ? p.dly.feedback : 0.5;
        const dlyTone = (p && p.dly && p.dly.tone !== undefined) ? p.dly.tone : 2000;
        const cascade = (p && p.dly && p.dly.toRev !== undefined) ? p.dly.toRev : 0.2;
        
        const revSize = (p && p.rev && p.rev.size !== undefined) ? p.rev.size : 2.0;
        const revDamp = (p && p.rev && p.rev.damp !== undefined) ? p.rev.damp : 3000;
        const revHpf = (p && p.rev && p.rev.hpf !== undefined) ? p.rev.hpf : 100;

        this.delay.delayTime.setTargetAtTime(dlyTime, window.audioCtx.currentTime, 0.1);
        this.feedback.gain.setTargetAtTime(dlyFbk, window.audioCtx.currentTime, 0.1);
        this.dlyFilter.frequency.setTargetAtTime(dlyTone, window.audioCtx.currentTime, 0.1);
        
        this.dlyToRev.gain.setTargetAtTime(Math.sin(cascade * Math.PI / 2), window.audioCtx.currentTime, 0.1);
        this.dlyToMaster.gain.setTargetAtTime(Math.cos(cascade * Math.PI / 2), window.audioCtx.currentTime, 0.1);
        
        if (this.lastRevTime !== revSize) {
            clearTimeout(this.revTimer);
            this.revTimer = setTimeout(() => {
                this.convolver.buffer = this.makeReverbImpulse(revSize);
                this.lastRevTime = revSize;
            }, 250); 
        }
        this.revFilter.frequency.setTargetAtTime(revDamp, window.audioCtx.currentTime, 0.1);
        this.revHpf.frequency.setTargetAtTime(revHpf, window.audioCtx.currentTime, 0.1);
    }
}

class EnvelopeGen {
    static apply(param, now, stopTime, envConfig, type, peakVal, baseVal = 0) {
        const { atk, dec, sus, rel, amt } = envConfig;
        const silenceFloor = 0.00001; 
        
        param.cancelScheduledValues(now);

        const safeAtk = Math.max(0.005, atk || 0.01);
        const safeDec = Math.max(0.005, dec || 0.01);
        const safeRel = Math.max(0.005, rel || 0.01);

        if (type === 'amp') {
            const peak = Math.max(peakVal * (amt !== undefined ? amt : 1.0), 0.02);
            const susLevel = Math.max(peak * (sus !== undefined ? sus : 1.0), silenceFloor);

            param.setValueAtTime(silenceFloor, now);
            param.linearRampToValueAtTime(peak, now + safeAtk);
            param.linearRampToValueAtTime(susLevel, now + safeAtk + safeDec);
            
            param.setValueAtTime(susLevel, stopTime);
            param.linearRampToValueAtTime(silenceFloor, stopTime + safeRel);
            param.setValueAtTime(0, stopTime + safeRel + 0.005);
        } 
        else if (type === 'filter') {
            const base = baseVal !== undefined && baseVal !== null ? baseVal : 8000;
            const filterAmt = (amt !== undefined ? amt : 0.5);
            const targetCutoff = Math.min(20000, Math.max(40, base + (5000 * filterAmt))); 
            const susCutoff = Math.min(20000, Math.max(40, base + ((targetCutoff - base) * (sus !== undefined ? sus : 1.0))));

            param.setValueAtTime(base, now);
            param.linearRampToValueAtTime(targetCutoff, now + safeAtk); 
            param.linearRampToValueAtTime(susCutoff, now + safeAtk + safeDec);
            
            param.setValueAtTime(susCutoff, stopTime);
            param.linearRampToValueAtTime(base, stopTime + safeRel);
        } 
        else if (type === 'pitch') {
            const detunePeak = 2400 * (amt || 0); 
            const susDetune = detunePeak * (sus !== undefined ? sus : 0);

            param.setValueAtTime(0, now);
            param.linearRampToValueAtTime(detunePeak, now + safeAtk);
            param.linearRampToValueAtTime(susDetune, now + safeAtk + safeDec);
            
            param.setValueAtTime(susDetune, stopTime);
            param.linearRampToValueAtTime(0, stopTime + safeRel);
        }
    }
}

class SourceModule {
    constructor() { this.output = window.audioCtx.createGain(); this.detuneNode = null; }
    connect(destination) { this.output.connect(destination); }
    start() {}
    setFrequency(freq, time, glide = 0) {}
    setPlaybackRate(rate, time, glide = 0) {}
}

class AnalogOscillator extends SourceModule {
    constructor(type = 'sawtooth') {
        super();
        this.osc = window.audioCtx.createOscillator();
        this.osc.type = type;
        this.detuneNode = this.osc.detune;
        this.osc.connect(this.output);
        this.osc.start();
    }
    setFrequency(freq, time, glide) {
        if (glide > 0) {
            this.osc.frequency.setTargetAtTime(freq, time, glide / 3);
        } else { 
            this.osc.frequency.cancelScheduledValues(time); 
            this.osc.frequency.setValueAtTime(freq, time); 
        }
    }
}

class NoiseGenerator extends SourceModule {
    constructor() {
        super();
        const bufSize = window.audioCtx.sampleRate * 2;
        const buffer = window.audioCtx.createBuffer(1, bufSize, window.audioCtx.sampleRate);
        const output = buffer.getChannelData(0);
        for (let i = 0; i < bufSize; i++) output[i] = Math.random() * 2 - 1;
        
        this.noise = window.audioCtx.createBufferSource();
        this.noise.buffer = buffer;
        this.noise.loop = true;
        this.noise.connect(this.output);
        this.noise.start(0, Math.random() * 2);
    }
}

class ProceduralDrums {
    static trigger(note, time, vel, destination) {
        const ctx = window.audioCtx;
        if (!ctx || !window.noiseBuffer) return;
        const gain = ctx.createGain();
        const v = Math.max(0.01, vel / 127);
        gain.connect(destination);
        
        let type = 'perc';
        if (note <= 36) type = 'kick';
        else if (note === 38 || note === 39 || note === 40) type = 'snare';
        else if (note === 42 || note === 44) type = 'closed_hat';
        else if (note === 46) type = 'open_hat';
        else if (note === 41 || note === 43 || note === 45 || note === 47 || note === 48 || note === 50) type = 'tom';
        else if (note === 49 || note === 51 || note === 52 || note === 55 || note === 57) type = 'cymbal';
        
        if (type === 'kick') {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(150, time);
            osc.frequency.exponentialRampToValueAtTime(10, time + 0.3);
            gain.gain.setValueAtTime(v, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
            osc.connect(gain);
            osc.start(time); osc.stop(time + 0.3);
        } 
        else if (type === 'snare') {
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(250, time);
            const oscGain = ctx.createGain();
            oscGain.gain.setValueAtTime(v * 0.5, time);
            oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
            osc.connect(oscGain); oscGain.connect(gain);
            osc.start(time); osc.stop(time + 0.2);
            
            const noise = ctx.createBufferSource();
            noise.buffer = window.noiseBuffer;
            noise.loop = true;
            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'highpass';
            noiseFilter.frequency.value = 1000;
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(v * 0.8, time);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
            noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(gain);
            noise.start(time); noise.stop(time + 0.25);
        }
        else if (type === 'closed_hat' || type === 'open_hat') {
            const dec = type === 'closed_hat' ? 0.08 : 0.4;
            const noise = ctx.createBufferSource();
            noise.buffer = window.noiseBuffer;
            noise.loop = true;
            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'bandpass';
            noiseFilter.frequency.value = 8000;
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(v * 0.6, time);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, time + dec);
            noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(gain);
            noise.start(time); noise.stop(time + dec);
        }
        else if (type === 'tom' || type === 'perc') {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            const baseFreq = type === 'tom' ? 100 + ((note - 41) * 15) : 400 + ((note - 58) * 30);
            osc.frequency.setValueAtTime(baseFreq * 1.5, time);
            osc.frequency.exponentialRampToValueAtTime(baseFreq, time + 0.15);
            gain.gain.setValueAtTime(v * 0.8, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
            osc.connect(gain);
            osc.start(time); osc.stop(time + 0.4);
        }
        else if (type === 'cymbal') {
            const noise = ctx.createBufferSource();
            noise.buffer = window.noiseBuffer;
            noise.loop = true;
            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'highpass';
            noiseFilter.frequency.value = 5000;
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(v * 0.5, time);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 1.5);
            noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(gain);
            noise.start(time); noise.stop(time + 1.5);
        }
    }
}

class SynthVoice {
    constructor(channelOut) {
        this.activeUntil = 0;
        this.lastTriggerTime = 0;
        this.currentPitch = 0;
        this.sources = {
            osc1: new AnalogOscillator('sawtooth'),
            sub: new AnalogOscillator('square'),
            noise: new NoiseGenerator()
        };
        this.vcf = window.audioCtx.createBiquadFilter();
        this.vcf.type = 'lowpass';
        this.vca = window.audioCtx.createGain();
        this.vca.gain.value = 0.00001;

        Object.values(this.sources).forEach(src => src.connect(this.vcf));
        this.vcf.connect(this.vca);
        this.vca.connect(channelOut);
    }

    applySourceParams(params) {
        if (params.sources.osc1.type === 'noise') {
            this.sources.osc1.output.gain.value = 0; 
            this.sources.noise.output.gain.value = params.sources.osc1.level; 
        } 
        else if (params.sources.osc1.type === 'drums') {
            this.sources.osc1.output.gain.value = 0; 
            this.sources.noise.output.gain.value = 0; 
        } else {
            const validTypes = ['sine', 'square', 'sawtooth', 'triangle'];
            if (validTypes.includes(params.sources.osc1.type)) {
                this.sources.osc1.osc.type = params.sources.osc1.type;
            }
            this.sources.osc1.output.gain.value = params.sources.osc1.level;
            this.sources.noise.output.gain.value = params.sources.noise?.level || 0;
        }
        
        this.sources.sub.output.gain.value = params.sources.sub.level;
        this.vcf.Q.value = params.filter.res;
    }

    trigger(pitch, freq, velocity, now, stopTime, params) {
        this.activeUntil = stopTime + params.ampEnv.rel;
        
        const isMono = (Math.round(params.voices || 5) === 1);
        const is303 = (params.legato === 1);
        const isDrums = (params.sources.osc1.type === 'drums');
        const overlapping = (now < this.activeUntil);
        
        const applyGlide = (is303 || isMono) && overlapping && params.glide > 0;
        const glideTime = applyGlide ? params.glide : 0;

        if (isDrums) {
            ProceduralDrums.trigger(pitch, now, velocity, this.vcf);
        } else {
            this.sources.osc1.setFrequency(freq, now, glideTime);
            this.sources.sub.setFrequency(freq / 2, now, glideTime);
        }

        const skipEnvelopes = (is303 && isMono && overlapping);

        if (!skipEnvelopes) {
            EnvelopeGen.apply(this.vca.gain, now, stopTime, params.ampEnv, 'amp', velocity / 127);
            EnvelopeGen.apply(this.vcf.frequency, now, stopTime, params.filterEnv, 'filter', null, params.filter.cutoff);
            if (params.pitchEnv.amt > 0 && !isDrums) {
                EnvelopeGen.apply(this.sources.osc1.detuneNode, now, stopTime, params.pitchEnv, 'pitch');
                EnvelopeGen.apply(this.sources.sub.detuneNode, now, stopTime, params.pitchEnv, 'pitch');
            } else {
                this.sources.osc1.detuneNode.setValueAtTime(0, now);
                this.sources.sub.detuneNode.setValueAtTime(0, now);
            }
        } else {
            let curAmp = this.vca.gain.value;
            this.vca.gain.cancelScheduledValues(now);
            this.vca.gain.setValueAtTime(curAmp, now);
            this.vca.gain.setTargetAtTime(Math.max((velocity/127) * params.ampEnv.amt * params.ampEnv.sus, 0.00001), now, params.ampEnv.dec / 3);
            this.vca.gain.setTargetAtTime(0, stopTime, params.ampEnv.rel / 3);

            let curFilter = this.vcf.frequency.value;
            this.vcf.frequency.cancelScheduledValues(now);
            this.vcf.frequency.setValueAtTime(curFilter, now);
            this.vcf.frequency.setTargetAtTime(params.filter.cutoff + ((5000 * params.filterEnv.amt) * params.filterEnv.sus), now, params.filterEnv.dec / 3);
            this.vcf.frequency.setTargetAtTime(params.filter.cutoff, stopTime, params.filterEnv.rel / 3);
        }
    }
}

class PolyChannel {
    constructor(id) {
        this.id = id; this.masterVolume = 0.50;
        this.lastTriggerTime = 0; this.lastDuration = 0; this.voiceIndex = 0;
        this.params = JSON.parse(JSON.stringify(window.defaultParams));
        this.params.mixVol = 0.50;
        this.params.stealMode = this.params.stealMode || 'none';
        this.params.steal = this.params.stealMode;
        this.params.midiOutCh = id;

        this.voiceMix = window.audioCtx.createGain();

        this.distNode = window.audioCtx.createWaveShaper();
        this.distNode.oversample = '4x';
        this.distFilter = window.audioCtx.createBiquadFilter();
        this.distFilter.type = 'lowpass';
        this.distOut = window.audioCtx.createGain(); 
        this.dryOut = window.audioCtx.createGain();  

        this.channelOut = window.audioCtx.createGain(); 
        this.channelOut.gain.value = 0.50;
        
        this.voiceMix.connect(this.distNode);
        this.distNode.connect(this.distFilter);
        this.distFilter.connect(this.distOut);
        
        this.voiceMix.connect(this.dryOut);
        
        this.distOut.connect(this.channelOut);
        this.dryOut.connect(this.channelOut);

        this.analyser = window.audioCtx.createAnalyser();
        this.channelOut.connect(this.analyser);
        
        this.ampLfoNode = window.audioCtx.createGain(); 
        this.channelOut.connect(this.ampLfoNode); 
        this.ampLfoNode.connect(window.masterGain); 

        this.sends = { dly: window.audioCtx.createGain(), rev: window.audioCtx.createGain() };
        this.channelOut.connect(this.sends.dly);
        this.channelOut.connect(this.sends.rev);

        if (!window.masterFX) window.masterFX = new MasterFXBus();
        this.sends.dly.connect(window.masterFX.dlyIn);
        this.sends.rev.connect(window.masterFX.revIn);

        this.lfos = {
            pitch: { osc: window.audioCtx.createOscillator(), gain: window.audioCtx.createGain() },
            filter: { osc: window.audioCtx.createOscillator(), gain: window.audioCtx.createGain() },
            amp: { osc: window.audioCtx.createOscillator(), gain: window.audioCtx.createGain() }
        };

        Object.values(this.lfos).forEach(lfo => { lfo.osc.connect(lfo.gain); lfo.osc.start(); });
        this.lfos.amp.gain.connect(this.ampLfoNode.gain);

        this.voices = [];
        for (let i = 0; i < 8; i++) {
            let voice = new SynthVoice(this.voiceMix);
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

    makeDistortionCurve(amount) {
        let n = 44100, curve = new Float32Array(n);
        let drive = Math.max(1, amount); 
        
        for (let i = 0; i < n; ++i) {
            let x = i * 2 / n - 1;
            let y = x * drive;
            if (y > 1.0) y = 1.0 + (y - 1.0) * 0.05; 
            else if (y < -0.8) y = -0.8; 
            curve[i] = y * 0.7; 
        }
        return curve;
    }

    applyParams() {
        const p = this.params;
        if (!p.fx) p.fx = { drv: 0, drvGrit: 10, drvTone: 2000, drvLvl: 1.0, dly: 0, rev: 0 };

        const configureLFO = (lfoKey, config, depthMult) => {
            const lfo = this.lfos[lfoKey];
            if (config.shape === 'random') lfo.gain.gain.value = 0; 
            else {
                if (config.shape === 'rampdown' && typeof window.rampDownWave !== 'undefined') lfo.osc.setPeriodicWave(window.rampDownWave); 
                else lfo.osc.type = config.shape;
                lfo.osc.frequency.value = config.rate;
                lfo.gain.gain.value = config.depth * depthMult;
            }
        };
        configureLFO('pitch', p.pitchLfo, 200);   
        configureLFO('filter', p.filterLfo, 2000); 
        configureLFO('amp', p.ampLfo, 1.0);       

        this.distNode.curve = this.makeDistortionCurve(p.fx.drvGrit);
        this.distFilter.frequency.setTargetAtTime(p.fx.drvTone, window.audioCtx.currentTime, 0.05);
        
        let drvLvl = p.fx.drvLvl !== undefined ? p.fx.drvLvl : 1.0;
        this.distOut.gain.setTargetAtTime(p.fx.drv * drvLvl, window.audioCtx.currentTime, 0.05);
        this.dryOut.gain.setTargetAtTime(1.0 - p.fx.drv, window.audioCtx.currentTime, 0.05);

        this.sends.dly.gain.setTargetAtTime(p.fx.dly, window.audioCtx.currentTime, 0.05);
        this.sends.rev.gain.setTargetAtTime(p.fx.rev, window.audioCtx.currentTime, 0.05);

        this.voices.forEach(v => v.applySourceParams(p));
    }
    
    play(pitch, velocity, durationMs, scheduleTime) {
        const now = scheduleTime || (window.audioCtx.currentTime + 0.015); 
        const freq = 440 * Math.pow(2, (pitch - 69) / 12);
        
		let maxVoices = this.params.voices !== undefined ? Math.round(this.params.voices) : 5;
        let stealMode = this.params.stealMode || this.params.steal || 'none';
        
        let targetIdx = -1;
        let oldestTime = now + 1000;
        let oldestIdx = 0;
        let lowestPitch = 1000;
        let lowestIdx = 0;
        let highestPitch = -1;
        let highestIdx = 0;

        if (maxVoices === 1) {
            // Strictly protect the mono voice if Env or Off mode is active and the release trail is still playing
            if ((stealMode === 'none' || stealMode === 'env') && now < this.voices[0].activeUntil) {
                targetIdx = -1; 
            } else {
                targetIdx = 0;
            }
        } else {
            for (let i = 0; i < maxVoices; i++) {
                let v = this.voices[i];
                if (now >= v.activeUntil) {
                     targetIdx = i; break;
                 }
                
                let tTime = v.lastTriggerTime || 0;
                if (tTime < oldestTime) { oldestTime = tTime; oldestIdx = i; }
                
                let p = v.currentPitch || 0;
                if (p < lowestPitch) { lowestPitch = p; lowestIdx = i; }
                if (p > highestPitch) { highestPitch = p; highestIdx = i; }
            }
            
            // Steal a voice ONLY if we aren't in Env or Off mode
            if (targetIdx === -1 && stealMode !== 'none' && stealMode !== 'env') {
                if (stealMode === 'lowest') targetIdx = lowestIdx;
                else if (stealMode === 'highest') targetIdx = highestIdx;
                else targetIdx = oldestIdx;
            }
        }
        
        if (targetIdx === -1) return false; // Drops the note, allowing the current ADSR trails to ring out
        
        this.voiceIndex = targetIdx;
        this.lastTriggerTime = now; 
        this.lastDuration = Math.min(durationMs / 1000, 30.0); 
        let stopTime = now + this.lastDuration;
        
        let v = this.voices[this.voiceIndex];

        if (maxVoices === 1 && this.params.legato === 1 && now < v.activeUntil) {
            let oldStopTime = v.activeUntil - this.params.ampEnv.rel;
            if (oldStopTime > stopTime) {
                stopTime = oldStopTime; 
            }
        }

        v.activeUntil = stopTime + this.params.ampEnv.rel;
        v.lastTriggerTime = now;
        v.currentPitch = pitch;
        
        if (!this.params.muted && !window.isMasterMuted) {
            v.trigger(pitch, freq, velocity, now, stopTime, this.params);
        }
        return true; 
    }
}
