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
                level: 0.85,
                muted: false,
                dly: { time: 0.5, feedback: 0.5, tone: 2000, toRev: 0.2 },
                rev: { size: 2.0, damp: 3000, hpf: 100 }
            };
        }
        if (window.globalFX.level === undefined) window.globalFX.level = 0.85;
        if (window.globalFX.muted === undefined) window.globalFX.muted = false;

        this.dlyIn = window.audioCtx.createGain();
        this.revIn = window.audioCtx.createGain();

        // Unified FX Return Bus (Delay + Reverb -> Headroom Compressor -> FX Return Level -> FX VU Analyser -> Master)
        this.fxSum = window.audioCtx.createGain();
        this.fxCompressor = window.audioCtx.createDynamicsCompressor();
        this.fxCompressor.threshold.value = -5;
        this.fxCompressor.knee.value = 12;
        this.fxCompressor.ratio.value = 6;
        this.fxCompressor.attack.value = 0.004;
        this.fxCompressor.release.value = 0.16;

        this.fxOut = window.audioCtx.createGain();
        this.fxAnalyser = window.audioCtx.createAnalyser();
        this.fxAnalyser.fftSize = 256;

        this.fxSum.connect(this.fxCompressor);
        this.fxCompressor.connect(this.fxOut);
        this.fxOut.connect(this.fxAnalyser);
        this.fxOut.connect(window.masterGain);

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
        this.dlyToMaster.connect(this.fxSum);

        this.delay.connect(this.dlyToRev);
        this.dlyToRev.connect(this.revIn);

        // 2. ALGORITHMIC REVERB
        this.revHpf = window.audioCtx.createBiquadFilter();
        this.revHpf.type = 'highpass';
        this.convolver = window.audioCtx.createConvolver();
        this.revFilter = window.audioCtx.createBiquadFilter();
        this.revFilter.type = 'lowpass';

        this.revIn.connect(this.revHpf);
        this.revHpf.connect(this.convolver);
        this.convolver.connect(this.revFilter);
        this.revFilter.connect(this.fxSum);

        this.updateParams(window.globalFX);
    }

    setLevel(val) {
        const parsed = parseFloat(val);
        const safeLvl = Number.isFinite(parsed) ? Math.max(0, Math.min(1.25, parsed)) : 0.85;
        if (window.globalFX) window.globalFX.level = safeLvl;
        const muted = Boolean(window.globalFX && window.globalFX.muted);
        if (this.fxOut && window.audioCtx) {
            this.fxOut.gain.setTargetAtTime(muted ? 0 : safeLvl, window.audioCtx.currentTime, 0.015);
        }
        if (typeof window.recordPerfParam === 'function') {
            window.recordPerfParam(0, 'globalFX.level', safeLvl, false);
        }
    }

    toggleMute() {
        if (!window.globalFX) return;
        window.globalFX.muted = !window.globalFX.muted;
        const safeLvl = Number.isFinite(Number(window.globalFX.level)) ? Math.max(0, Math.min(1.25, Number(window.globalFX.level))) : 0.85;
        if (this.fxOut && window.audioCtx) {
            this.fxOut.gain.setTargetAtTime(window.globalFX.muted ? 0 : safeLvl, window.audioCtx.currentTime, 0.015);
        }
        if (typeof window.recordPerfParam === 'function') {
            window.recordPerfParam(0, 'globalFX.muted', window.globalFX.muted, true);
        }
    }

    makeReverbImpulse(time) {
        const safeTime = Math.max(0.1, Math.min(8.0, Number.isFinite(time) ? time : 2.0));
        const length = Math.max(1, Math.floor(window.audioCtx.sampleRate * safeTime));
        const norm = 0.22 / Math.sqrt(Math.max(0.5, safeTime));
        const impulse = window.audioCtx.createBuffer(2, length, window.audioCtx.sampleRate);
        for (let i = 0; i < 2; i++) {
            const channelData = impulse.getChannelData(i);
            for (let j = 0; j < length; j++) {
                channelData[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 3) * norm;
            }
        }
        return impulse;
    }

    updateParams(p) {
        if (!window.audioCtx) return;
        const now = window.audioCtx.currentTime;
        const nyqSafe = Math.min(20000, window.audioCtx.sampleRate * 0.45);
        const safeNum = (v, fallback, min, max) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return fallback;
            return Math.min(max, Math.max(min, n));
        };

        const fxLevel = safeNum(p ? p.level : undefined, 0.85, 0, 1.25);
        const fxMuted = Boolean(p && p.muted);
        if (p) {
            if (p.level === undefined) p.level = fxLevel;
            if (p.muted === undefined) p.muted = fxMuted;
        }
        if (this.fxOut) {
            this.fxOut.gain.setTargetAtTime(fxMuted ? 0 : fxLevel, now, 0.02);
        }

        const dlyTime = safeNum(p && p.dly ? p.dly.time : undefined, 0.5, 0.005, 10.0);
        const dlyFbk = safeNum(p && p.dly ? p.dly.feedback : undefined, 0.5, 0, 0.96);
        const dlyTone = safeNum(p && p.dly ? p.dly.tone : undefined, 2000, 40, nyqSafe);
        const cascade = safeNum(p && p.dly ? p.dly.toRev : undefined, 0.2, 0, 1);

        const revSize = safeNum(p && p.rev ? p.rev.size : undefined, 2.0, 0.1, 8.0);
        const revDamp = safeNum(p && p.rev ? p.rev.damp : undefined, 3000, 100, nyqSafe);
        const revHpf = safeNum(p && p.rev ? p.rev.hpf : undefined, 100, 20, nyqSafe);

        this.delay.delayTime.setTargetAtTime(dlyTime, now, 0.1);
        this.feedback.gain.setTargetAtTime(dlyFbk, now, 0.1);
        this.dlyFilter.frequency.setTargetAtTime(dlyTone, now, 0.1);

        this.dlyToRev.gain.setTargetAtTime(Math.sin(cascade * Math.PI / 2), now, 0.1);
        this.dlyToMaster.gain.setTargetAtTime(Math.cos(cascade * Math.PI / 2), now, 0.1);

        if (this.lastRevTime !== revSize) {
            clearTimeout(this.revTimer);
            this.revTimer = setTimeout(() => {
                if (!window.audioCtx) return;
                this.convolver.buffer = this.makeReverbImpulse(revSize);
                this.lastRevTime = revSize;
            }, 250);
        }
        this.revFilter.frequency.setTargetAtTime(revDamp, now, 0.1);
        this.revHpf.frequency.setTargetAtTime(revHpf, now, 0.1);
    }
}

class EnvelopeGen {
    static anchorParam(param, time, exactVal) {
        const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0;
        if (typeof param.cancelAndHoldAtTime === 'function') {
            param.cancelAndHoldAtTime(safeTime);
            if (exactVal !== undefined && Number.isFinite(exactVal)) {
                param.setValueAtTime(exactVal, safeTime);
            }
        } else {
            param.cancelScheduledValues(safeTime);
            const fallback = Number.isFinite(param.value) ? param.value : 0;
            param.setValueAtTime(exactVal !== undefined && Number.isFinite(exactVal) ? exactVal : fallback, safeTime);
        }
    }

    static getSafeTimings(envConfig, type, companionAmpRel = 0) {
        if (window.BioQuadCore && typeof window.BioQuadCore.computeSafeEnvelopeTimings === 'function') {
            return window.BioQuadCore.computeSafeEnvelopeTimings(envConfig, type, companionAmpRel);
        }
        const rawAtk = Number(envConfig && envConfig.atk);
        const rawDec = Number(envConfig && envConfig.dec);
        const rawRel = Number(envConfig && envConfig.rel);
        if (type === 'filter') {
            return {
                safeAtk: Math.max(0.012, isFinite(rawAtk) && rawAtk > 0 ? rawAtk : 0.02),
                safeDec: Math.max(0.045, isFinite(rawDec) && rawDec > 0 ? rawDec : 0.08),
                safeRel: Math.max(0.050, isFinite(rawRel) && rawRel > 0 ? rawRel : 0.08)
            };
        }
        return {
            safeAtk: Math.max(0.006, isFinite(rawAtk) && rawAtk > 0 ? rawAtk : 0.01),
            safeDec: Math.max(0.024, isFinite(rawDec) && rawDec > 0 ? rawDec : 0.024),
            safeRel: Math.max(0.024, isFinite(rawRel) && rawRel > 0 ? rawRel : 0.024)
        };
    }

    static scheduleADSR(param, startTime, stopTime, startVal, peakVal, susVal, endVal, safeAtk, safeDec, safeRel, exponential = false) {
        const safeStart = Number.isFinite(startTime) ? Math.max(0, startTime) : 0;
        const safeStopTime = Number.isFinite(stopTime) ? Math.max(safeStart + 0.012, stopTime) : safeStart + 0.05;
        const noteDur = Math.max(0.012, safeStopTime - safeStart);
        const relEnd = safeStopTime + Math.max(0.012, Number.isFinite(safeRel) ? safeRel : 0.024);

        const sanitize = (v) => {
            const n = Number.isFinite(v) ? v : (exponential ? 0.0001 : 0);
            return exponential ? Math.max(0.0001, n) : n;
        };

        const sVal = sanitize(startVal);
        const pVal = sanitize(peakVal);
        const uVal = sanitize(susVal);
        const eVal = sanitize(endVal);

        const rampTo = (v, t) => {
            const sv = sanitize(v);
            const st = Math.max(safeStart + 0.0001, Number.isFinite(t) ? t : safeStopTime);
            if (exponential) {
                param.exponentialRampToValueAtTime(sv, st);
            } else {
                param.linearRampToValueAtTime(sv, st);
            }
        };

        const interp = (a, b, frac) => {
            const f = Math.max(0, Math.min(1, frac));
            if (exponential) {
                const sa = Math.max(0.0001, a);
                const sb = Math.max(0.0001, b);
                return sa * Math.pow(sb / sa, f);
            }
            return a + (b - a) * f;
        };

        param.setValueAtTime(sVal, safeStart);

        if (noteDur <= safeAtk) {
            const frac = noteDur / safeAtk;
            const releaseStart = interp(sVal, pVal, frac);
            rampTo(releaseStart, safeStopTime);
            rampTo(eVal, relEnd);
        } else if (noteDur <= safeAtk + safeDec) {
            const atkEnd = safeStart + safeAtk;
            const frac = (noteDur - safeAtk) / safeDec;
            const releaseStart = interp(pVal, uVal, frac);
            rampTo(pVal, atkEnd);
            rampTo(releaseStart, safeStopTime);
            rampTo(eVal, relEnd);
        } else {
            rampTo(pVal, safeStart + safeAtk);
            rampTo(uVal, safeStart + safeAtk + safeDec);
            param.setValueAtTime(uVal, safeStopTime);
            rampTo(eVal, relEnd);
        }

        return {
            relEnd,
            seg: {
                startTime: safeStart,
                stopTime: safeStopTime,
                relEnd,
                startVal: sVal,
                peakVal: pVal,
                susVal: uVal,
                endVal: eVal,
                safeAtk,
                safeDec,
                exponential
            }
        };
    }

    static apply(param, startTime, stopTime, envConfig, type, peakVal, baseVal = 0, startOverride = null, companionAmpRel = 0) {
        const { sus, amt } = envConfig || {};
        const silenceFloor = 0.00001;
        const { safeAtk, safeDec, safeRel } = this.getSafeTimings(envConfig, type, companionAmpRel);
        const safeStart = Number.isFinite(startTime) ? Math.max(0, startTime) : 0;
        const safeStop = Math.max(safeStart + 0.012, Number.isFinite(stopTime) ? stopTime : safeStart + 0.05);

        if (type === 'amp') {
            const safeAmt = Number.isFinite(Number(amt)) ? Math.max(0, Math.min(2, Number(amt))) : 1.0;
            const safePeakIn = Number.isFinite(Number(peakVal)) ? Math.max(0, Math.min(2, Number(peakVal))) : 0.7;
            const safeSus = Number.isFinite(Number(sus)) ? Math.max(0, Math.min(1, Number(sus))) : 1.0;
            const peak = Math.max(safePeakIn * safeAmt, 0.02);
            const susLevel = Math.max(peak * safeSus, silenceFloor);
            const startAmp = (startOverride !== null && Number.isFinite(Number(startOverride)))
                ? Math.max(silenceFloor, Number(startOverride))
                : silenceFloor;

            this.anchorParam(param, safeStart, startAmp);
            const res = this.scheduleADSR(
                param, safeStart, safeStop,
                startAmp, peak, susLevel, silenceFloor,
                safeAtk, safeDec, safeRel,
                false
            );
            // Smooth asymptotic tail to true 0 without a hard step jump
            param.setTargetAtTime(0, res.relEnd, 0.010);
            return res;
        }
        if (type === 'filter') {
            const maxNyquistSafe = Math.min(18000, (window.audioCtx ? window.audioCtx.sampleRate : 44100) * 0.45);
            const clampFreq = (f) => {
                const n = Number(f);
                if (!Number.isFinite(n)) return 8000;
                return Math.min(maxNyquistSafe, Math.max(40, n));
            };
            const base = clampFreq(baseVal !== undefined && baseVal !== null ? baseVal : 8000);
            const filterAmt = Number.isFinite(Number(amt)) ? Math.max(-2, Math.min(2, Number(amt))) : 0.5;
            // Octave-proportional filter sweep (up to ~3.2 octaves above base cutoff, capped safely below Nyquist)
            const targetCutoff = clampFreq(Math.max(base * Math.pow(2, 3.2 * filterAmt), base + (3600 * filterAmt)));
            const susRatio = Math.max(0, Math.min(1, Number.isFinite(Number(sus)) ? Number(sus) : 1.0));
            const susCutoff = clampFreq(base * Math.pow(targetCutoff / base, susRatio));
            const startFreq = clampFreq(startOverride !== null && startOverride !== undefined ? startOverride : base);

            this.anchorParam(param, safeStart, startFreq);
            return this.scheduleADSR(
                param, safeStart, safeStop,
                startFreq, targetCutoff, susCutoff, base,
                safeAtk, safeDec, safeRel,
                true
            );
        }
        if (type === 'pitch') {
            const safeAmt = Number.isFinite(Number(amt)) ? Math.max(-2, Math.min(2, Number(amt))) : 0;
            const safeSus = Number.isFinite(Number(sus)) ? Math.max(0, Math.min(1, Number(sus))) : 0;
            const detunePeak = 2400 * safeAmt;
            const susDetune = detunePeak * safeSus;
            const startDetune = (startOverride !== null && Number.isFinite(Number(startOverride))) ? Number(startOverride) : 0;

            this.anchorParam(param, safeStart, startDetune);
            return this.scheduleADSR(
                param, safeStart, safeStop,
                startDetune, detunePeak, susDetune, 0,
                safeAtk, safeDec, safeRel,
                false
            );
        }
        return { relEnd: safeStop + safeRel, seg: null };
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
        const nyqSafe = window.audioCtx ? Math.min(20000, window.audioCtx.sampleRate * 0.45) : 18000;
        const safeFreq = Math.min(nyqSafe, Math.max(8, Number.isFinite(freq) ? freq : 440));
        const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0;
        const safeGlide = Number.isFinite(glide) && glide > 0 ? Math.min(5, glide) : 0;
        if (safeGlide > 0) {
            if (typeof this.osc.frequency.cancelAndHoldAtTime === 'function') {
                this.osc.frequency.cancelAndHoldAtTime(safeTime);
            } else {
                this.osc.frequency.cancelScheduledValues(safeTime);
            }
            this.osc.frequency.setTargetAtTime(safeFreq, safeTime, Math.max(0.002, safeGlide / 3));
        } else {
            this.osc.frequency.cancelScheduledValues(safeTime);
            this.osc.frequency.setValueAtTime(safeFreq, safeTime);
        }
    }
}

class NoiseGenerator extends SourceModule {
    constructor() {
        super();
        if (!window.noiseBuffer && window.audioCtx) {
            const bufSize = window.audioCtx.sampleRate * 2;
            window.noiseBuffer = window.audioCtx.createBuffer(1, bufSize, window.audioCtx.sampleRate);
            const output = window.noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufSize; i++) output[i] = Math.random() * 2 - 1;
        }

        this.noise = window.audioCtx.createBufferSource();
        this.noise.buffer = window.noiseBuffer;
        this.noise.loop = true;
        this.noise.connect(this.output);
        this.noise.start(0, Math.random() * 1.9);
    }
}

class ProceduralDrums {
    static _scheduleCleanup(sourceNode, nodesToDisconnect) {
        if (!sourceNode) return;
        sourceNode.onended = () => {
            sourceNode.onended = null;
            for (let i = 0; i < nodesToDisconnect.length; i++) {
                try { nodesToDisconnect[i].disconnect(); } catch (e) {}
            }
        };
    }

    static trigger(note, time, vel, destination) {
        const ctx = window.audioCtx;
        if (!ctx || !window.noiseBuffer || !destination) return;
        const safeTime = Math.max(ctx.currentTime, Number.isFinite(time) ? time : ctx.currentTime);
        const safeNote = Math.max(0, Math.min(127, Math.round(Number.isFinite(note) ? note : 36)));
        const v = Math.max(0.01, Math.min(1.0, (Number.isFinite(vel) ? vel : 80) / 127));
        const maxNyquistSafe = Math.min(18000, ctx.sampleRate * 0.45);

        const gain = ctx.createGain();
        gain.connect(destination);

        let type = 'perc';
        if (safeNote <= 36) type = 'kick';
        else if (safeNote === 37) type = 'rim';
        else if (safeNote === 38 || safeNote === 39 || safeNote === 40) type = 'snare';
        else if (safeNote === 42 || safeNote === 44) type = 'closed_hat';
        else if (safeNote === 46) type = 'open_hat';
        else if (safeNote === 41 || safeNote === 43 || safeNote === 45 || safeNote === 47 || safeNote === 48 || safeNote === 50) type = 'tom';
        else if (safeNote === 49 || safeNote === 51 || safeNote === 52 || safeNote === 55 || safeNote === 57) type = 'cymbal';

        if (type === 'kick') {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(150, safeTime);
            osc.frequency.exponentialRampToValueAtTime(28, safeTime + 0.3);
            gain.gain.setValueAtTime(v, safeTime);
            gain.gain.exponentialRampToValueAtTime(0.001, safeTime + 0.3);
            osc.connect(gain);
            this._scheduleCleanup(osc, [osc, gain]);
            osc.start(safeTime); osc.stop(safeTime + 0.31);
        }
        else if (type === 'rim') {
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(920, safeTime);
            osc.frequency.exponentialRampToValueAtTime(340, safeTime + 0.045);
            gain.gain.setValueAtTime(v * 0.7, safeTime);
            gain.gain.exponentialRampToValueAtTime(0.001, safeTime + 0.065);
            osc.connect(gain);
            this._scheduleCleanup(osc, [osc, gain]);
            osc.start(safeTime); osc.stop(safeTime + 0.07);
        }
        else if (type === 'snare') {
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(250, safeTime);
            const oscGain = ctx.createGain();
            oscGain.gain.setValueAtTime(v * 0.5, safeTime);
            oscGain.gain.exponentialRampToValueAtTime(0.001, safeTime + 0.2);
            osc.connect(oscGain); oscGain.connect(gain);
            this._scheduleCleanup(osc, [osc, oscGain]);
            osc.start(safeTime); osc.stop(safeTime + 0.21);

            const noise = ctx.createBufferSource();
            noise.buffer = window.noiseBuffer;
            noise.loop = true;
            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'highpass';
            noiseFilter.frequency.value = 1000;
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(v * 0.8, safeTime);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, safeTime + 0.25);
            noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(gain);
            this._scheduleCleanup(noise, [noise, noiseFilter, noiseGain, gain]);
            noise.start(safeTime); noise.stop(safeTime + 0.26);
        }
        else if (type === 'closed_hat' || type === 'open_hat') {
            const dec = type === 'closed_hat' ? 0.08 : 0.4;
            const noise = ctx.createBufferSource();
            noise.buffer = window.noiseBuffer;
            noise.loop = true;
            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'bandpass';
            noiseFilter.frequency.value = Math.min(maxNyquistSafe, 8000);
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(v * 0.6, safeTime);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, safeTime + dec);
            noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(gain);
            this._scheduleCleanup(noise, [noise, noiseFilter, noiseGain, gain]);
            noise.start(safeTime); noise.stop(safeTime + dec + 0.01);
        }
        else if (type === 'tom' || type === 'perc') {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            const rawBase = type === 'tom' ? (100 + ((safeNote - 41) * 15)) : (400 + ((safeNote - 58) * 30));
            const baseFreq = Math.min(maxNyquistSafe * 0.65, Math.max(45, rawBase));
            const startFreq = Math.min(maxNyquistSafe, Math.max(baseFreq + 1, baseFreq * 1.5));
            osc.frequency.setValueAtTime(startFreq, safeTime);
            osc.frequency.exponentialRampToValueAtTime(baseFreq, safeTime + 0.15);
            gain.gain.setValueAtTime(v * 0.8, safeTime);
            gain.gain.exponentialRampToValueAtTime(0.001, safeTime + 0.4);
            osc.connect(gain);
            this._scheduleCleanup(osc, [osc, gain]);
            osc.start(safeTime); osc.stop(safeTime + 0.41);
        }
        else if (type === 'cymbal') {
            const noise = ctx.createBufferSource();
            noise.buffer = window.noiseBuffer;
            noise.loop = true;
            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'highpass';
            noiseFilter.frequency.value = Math.min(maxNyquistSafe, 5000);
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(v * 0.5, safeTime);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, safeTime + 1.5);
            noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(gain);
            this._scheduleCleanup(noise, [noise, noiseFilter, noiseGain, gain]);
            noise.start(safeTime); noise.stop(safeTime + 1.52);
        }
    }
}

const WAVE_GAIN_TRIM = {
    square: 0.55,
    sawtooth: 0.70,
    triangle: 1.00,
    sine: 1.05,
    noise: 0.42,
    drums: 0.85
};

class SynthVoice {
    constructor(channelOut) {
        this.activeUntil = 0;
        this.noteOffTime = 0;
        this.lastTriggerTime = 0;
        this.currentPitch = 0;
        this.ampSeg = null;
        this.filterSeg = null;
        this.pitchSeg = null;
        this.sources = {
            osc1: new AnalogOscillator('sawtooth'),
            noise: new NoiseGenerator()
        };
        this.vcf = window.audioCtx.createBiquadFilter();
        this.vcf.type = 'lowpass';
        this.vcf.frequency.value = 8000;
        this.vca = window.audioCtx.createGain();
        this.vca.gain.value = 0;

        Object.values(this.sources).forEach(src => src.connect(this.vcf));
        this.vcf.connect(this.vca);
        this.vca.connect(channelOut);
    }

    evalAmpAt(time) {
        if (this.ampSeg && window.BioQuadCore && typeof window.BioQuadCore.evalAdsrAtTime === 'function') {
            return window.BioQuadCore.evalAdsrAtTime(this.ampSeg, time);
        }
        return time < this.activeUntil ? Math.max(0, this.vca.gain.value) : 0;
    }

    evalFilterAt(time, fallbackCutoff) {
        if (this.filterSeg && window.BioQuadCore && typeof window.BioQuadCore.evalAdsrAtTime === 'function') {
            return window.BioQuadCore.evalAdsrAtTime(this.filterSeg, time);
        }
        return fallbackCutoff || 8000;
    }

    applySourceParams(params) {
        const now = window.audioCtx ? window.audioCtx.currentTime : 0;
        const oscType = (params.sources && params.sources.osc1 && params.sources.osc1.type) || 'sawtooth';
        const oscLevel = (params.sources && params.sources.osc1 && params.sources.osc1.level !== undefined) ? params.sources.osc1.level : 1.0;

        const safeRes = Math.min(18, Math.max(0, params.filter.res || 0));
        // Gentle automatic Q headroom compensation prevents resonant filter sweeps from clipping channel compressor
        const resComp = 1.0 / (1.0 + safeRes * 0.045);

        if (oscType === 'noise') {
            this.sources.osc1.output.gain.setTargetAtTime(0, now, 0.015);
            this.sources.noise.output.gain.setTargetAtTime(oscLevel * WAVE_GAIN_TRIM.noise * resComp, now, 0.015);
        } else if (oscType === 'drums') {
            this.sources.osc1.output.gain.setTargetAtTime(0, now, 0.015);
            this.sources.noise.output.gain.setTargetAtTime(0, now, 0.015);
        } else {
            const validTypes = ['sine', 'square', 'sawtooth', 'triangle'];
            if (validTypes.includes(oscType)) {
                this.sources.osc1.osc.type = oscType;
            }
            const trim = WAVE_GAIN_TRIM[oscType] || 0.75;
            this.sources.osc1.output.gain.setTargetAtTime(oscLevel * trim * resComp, now, 0.015);
            this.sources.noise.output.gain.setTargetAtTime((params.sources.noise?.level || 0) * WAVE_GAIN_TRIM.noise * resComp, now, 0.015);
        }

        this.vcf.Q.setTargetAtTime(safeRes, now, 0.02);

        if (now >= this.activeUntil) {
            const maxNyquistSafe = Math.min(18000, window.audioCtx.sampleRate * 0.45);
            const safeCutoff = Math.min(maxNyquistSafe, Math.max(40, params.filter.cutoff || 8000));
            this.vcf.frequency.setTargetAtTime(safeCutoff, now, 0.025);
        }
    }

    trigger(pitch, freq, velocity, now, stopTime, params, wasActive = false) {
        const isMono = (Math.round(params.voices || 5) === 1);
        const is303 = (params.legato === 1);
        const isDrums = (params.sources.osc1.type === 'drums');
        const overlapping = wasActive;

        const applyGlide = (is303 || isMono) && overlapping && params.glide > 0;
        const glideTime = applyGlide ? params.glide : 0;
        const skipEnvelopes = (is303 && isMono && overlapping);

        const maxNyquistSafe = Math.min(18000, window.audioCtx.sampleRate * 0.45);
        const baseCutoff = Math.min(maxNyquistSafe, Math.max(40, params.filter.cutoff || 8000));
        const silenceFloor = 0.00001;

        let tNoteStart = now;
        const curAmp = wasActive ? this.evalAmpAt(now) : 0;
        const curCut = wasActive ? this.evalFilterAt(now, baseCutoff) : baseCutoff;

        // If stealing or retriggering an audible voice without glide/legato, perform a 5ms
        // silent micro-declick ramp BEFORE switching oscillator pitch or resetting filter cutoff!
        if (wasActive && !applyGlide && !skipEnvelopes && !isDrums && curAmp > 0.0003) {
            const declickSec = 0.005;
            tNoteStart = now + declickSec;
            EnvelopeGen.anchorParam(this.vca.gain, now, curAmp);
            this.vca.gain.linearRampToValueAtTime(silenceFloor, tNoteStart);
            EnvelopeGen.anchorParam(this.vcf.frequency, now, curCut);
            this.vcf.frequency.setValueAtTime(curCut, tNoteStart - 0.0002);
        }

        const safeStop = Math.max(tNoteStart + 0.015, stopTime);

        if (isDrums) {
            ProceduralDrums.trigger(pitch, tNoteStart, Math.round(velocity * WAVE_GAIN_TRIM.drums), this.vcf);
        } else {
            this.sources.osc1.setFrequency(freq, tNoteStart, glideTime);
        }

        if (!skipEnvelopes) {
            const ampTimings = EnvelopeGen.getSafeTimings(params.ampEnv, 'amp', 0);
            const startAmpForNew = (applyGlide && wasActive) ? Math.max(silenceFloor, curAmp) : silenceFloor;
            const startCutForNew = (applyGlide && wasActive) ? curCut : baseCutoff;

            const ampRes = EnvelopeGen.apply(
                this.vca.gain, tNoteStart, safeStop,
                params.ampEnv, 'amp', velocity / 127, 0,
                startAmpForNew, 0
            );
            const fltRes = EnvelopeGen.apply(
                this.vcf.frequency, tNoteStart, safeStop,
                params.filterEnv, 'filter', null, baseCutoff,
                startCutForNew, ampTimings.safeRel
            );

            this.ampSeg = ampRes.seg;
            this.filterSeg = fltRes.seg;

            if (params.pitchEnv.amt > 0 && !isDrums) {
                const pitchRes = EnvelopeGen.apply(this.sources.osc1.detuneNode, tNoteStart, safeStop, params.pitchEnv, 'pitch', 0, 0, 0, 0);
                this.pitchSeg = pitchRes.seg;
            } else {
                EnvelopeGen.anchorParam(this.sources.osc1.detuneNode, tNoteStart, 0);
                this.pitchSeg = null;
            }

            this.noteOffTime = safeStop;
            this.activeUntil = Math.max(ampRes.relEnd, fltRes.relEnd) + 0.030;
        } else {
            const ampTimings = EnvelopeGen.getSafeTimings(params.ampEnv, 'amp', 0);
            const fltTimings = EnvelopeGen.getSafeTimings(params.filterEnv, 'filter', ampTimings.safeRel);
            const targetAmp = Math.max((velocity / 127) * (params.ampEnv.amt ?? 1.0) * Math.max(0.15, params.ampEnv.sus ?? 1.0), silenceFloor);

            EnvelopeGen.anchorParam(this.vca.gain, now, Math.max(silenceFloor, curAmp));
            this.vca.gain.setTargetAtTime(targetAmp, now, Math.max(0.010, ampTimings.safeDec / 3));
            this.vca.gain.setTargetAtTime(0, safeStop, Math.max(0.012, ampTimings.safeRel / 3));

            const filterAmt = params.filterEnv.amt !== undefined ? params.filterEnv.amt : 0.5;
            const peakCut = Math.min(maxNyquistSafe, Math.max(40, Math.max(baseCutoff * Math.pow(2, 3.2 * filterAmt), baseCutoff + 3600 * filterAmt)));
            const susRatio = Math.max(0, Math.min(1, params.filterEnv.sus !== undefined ? params.filterEnv.sus : 1.0));
            const targetCut = Math.min(maxNyquistSafe, Math.max(40, baseCutoff * Math.pow(peakCut / baseCutoff, susRatio)));

            EnvelopeGen.anchorParam(this.vcf.frequency, now, curCut);
            this.vcf.frequency.setTargetAtTime(targetCut, now, Math.max(0.015, fltTimings.safeDec / 3));
            this.vcf.frequency.setTargetAtTime(baseCutoff, safeStop, Math.max(0.018, fltTimings.safeRel / 3));

            this.noteOffTime = safeStop;
            this.activeUntil = safeStop + Math.max(ampTimings.safeRel, fltTimings.safeRel) + 0.030;
        }
        return this.activeUntil;
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

        this.channelCompressor = window.audioCtx.createDynamicsCompressor();
        this.channelCompressor.threshold.value = -16.0;
        this.channelCompressor.knee.value = 12.0;
        this.channelCompressor.ratio.value = 6.0;
        this.channelCompressor.attack.value = 0.003;
        this.channelCompressor.release.value = 0.16;

        this.channelOut = window.audioCtx.createGain();
        this.channelOut.gain.value = 0.50;

        this.voiceMix.connect(this.distNode);
        this.distNode.connect(this.distFilter);
        this.distFilter.connect(this.distOut);

        this.voiceMix.connect(this.dryOut);

        this.distOut.connect(this.channelCompressor);
        this.dryOut.connect(this.channelCompressor);
        this.channelCompressor.connect(this.channelOut);

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
            this.lfos.filter.gain.connect(voice.vcf.detune);
            this.voices.push(voice);
        }
        this.applyParams();
    }

    setVolume(val) {
        const parsed = parseFloat(val);
        this.params.mixVol = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.5;
        const target = this.params.muted ? 0 : this.params.mixVol;
        if (window.audioCtx) {
            this.channelOut.gain.setTargetAtTime(target, window.audioCtx.currentTime, 0.015);
        }
        if (typeof window.recordPerfParam === 'function') window.recordPerfParam(this.id + 1, 'mixVol', this.params.mixVol, false);
    }

    toggleMute() {
        this.params.muted = !this.params.muted;
        const target = this.params.muted ? 0 : (Number.isFinite(this.params.mixVol) ? this.params.mixVol : 0.5);
        if (window.audioCtx) {
            this.channelOut.gain.setTargetAtTime(target, window.audioCtx.currentTime, 0.015);
        }
        if (typeof window.recordPerfParam === 'function') window.recordPerfParam(this.id + 1, 'muted', this.params.muted, true);
    }

    makeDistortionCurve(amount) {
        const n = 4096;
        const curve = new Float32Array(n);
        const safeAmt = Number.isFinite(Number(amount)) ? Number(amount) : 10;
        const drive = Math.max(1, Math.min(200, safeAmt));

        for (let i = 0; i < n; ++i) {
            const x = i * 2 / n - 1;
            let y = x * drive;
            if (y > 1.0) y = 1.0 + (y - 1.0) * 0.05;
            else if (y < -0.8) y = -0.8;
            curve[i] = y * 0.7;
        }
        return curve;
    }

    applyParams() {
        if (!window.audioCtx) return;
        const p = this.params;
        const now = window.audioCtx.currentTime;
        const nyqSafe = Math.min(20000, window.audioCtx.sampleRate * 0.45);
        if (!p.fx) p.fx = { drv: 0, drvGrit: 10, drvTone: 2000, drvLvl: 1.0, dly: 0, rev: 0 };

        const safeNum = (v, fallback, min, max) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return fallback;
            return Math.min(max, Math.max(min, n));
        };

        const validLfoShapes = ['sine', 'square', 'triangle', 'sawtooth'];
        const configureLFO = (lfoKey, config, depthMult) => {
            const lfo = this.lfos[lfoKey];
            if (!config || config.shape === 'random') {
                lfo.gain.gain.setTargetAtTime(0, now, 0.02);
            } else {
                if (config.shape === 'rampdown' && typeof window.rampDownWave !== 'undefined') lfo.osc.setPeriodicWave(window.rampDownWave);
                else if (validLfoShapes.includes(config.shape)) lfo.osc.type = config.shape;
                const rate = safeNum(config.rate, 1, 0.01, 60);
                const depth = safeNum(config.depth, 0, 0, 1);
                lfo.osc.frequency.setTargetAtTime(rate, now, 0.02);
                lfo.gain.gain.setTargetAtTime(depth * depthMult, now, 0.02);
            }
        };
        configureLFO('pitch', p.pitchLfo, 200);
        configureLFO('filter', p.filterLfo, 2000);
        configureLFO('amp', p.ampLfo, 0.5);
        const ampDepth = (p.ampLfo && p.ampLfo.shape !== 'random') ? safeNum(p.ampLfo.depth, 0, 0, 1) : 0;
        this.ampLfoNode.gain.setTargetAtTime(Math.max(0, 1.0 - (ampDepth * 0.5)), now, 0.02);

        const grit = safeNum(p.fx.drvGrit, 10, 0, 200);
        if (this._lastDistGrit !== grit) {
            this._lastDistGrit = grit;
            this.distNode.curve = this.makeDistortionCurve(grit);
        }
        const drvTone = safeNum(p.fx.drvTone, 2000, 40, nyqSafe);
        this.distFilter.frequency.setTargetAtTime(drvTone, now, 0.05);

        const drv = safeNum(p.fx.drv, 0, 0, 1);
        const drvLvl = safeNum(p.fx.drvLvl, 1.0, 0, 2);
        this.distOut.gain.setTargetAtTime(drv * drvLvl, now, 0.05);
        this.dryOut.gain.setTargetAtTime(Math.max(0, 1.0 - drv), now, 0.05);

        this.sends.dly.gain.setTargetAtTime(safeNum(p.fx.dly, 0, 0, 1), now, 0.05);
        this.sends.rev.gain.setTargetAtTime(safeNum(p.fx.rev, 0, 0, 1), now, 0.05);

        this.voices.forEach(v => v.applySourceParams(p));
    }

    play(pitch, velocity, durationMs, scheduleTime) {
        if (!window.audioCtx) return false;
        const safePitch = Math.max(0, Math.min(127, Math.round(Number.isFinite(Number(pitch)) ? Number(pitch) : 60)));
        const safeVel = Math.max(1, Math.min(127, Math.round(Number.isFinite(Number(velocity)) ? Number(velocity) : 80)));
        const safeDurMs = Number.isFinite(Number(durationMs)) ? Number(durationMs) : 250;
        const sched = Number.isFinite(Number(scheduleTime)) ? Number(scheduleTime) : (window.audioCtx.currentTime + 0.015);
        const safeNow = Math.max(window.audioCtx.currentTime + 0.005, sched);
        const freq = 440 * Math.pow(2, (safePitch - 69) / 12);

        let maxVoices = this.params.voices !== undefined ? Math.max(1, Math.min(this.voices.length, Math.round(Number(this.params.voices) || 5))) : 5;
        let stealMode = this.params.stealMode || this.params.steal || 'none';

        let targetIdx = -1;
        let oldestTime = Infinity;
        let oldestIdx = 0;
        let oldestReleasingTime = Infinity;
        let oldestReleasingIdx = -1;
        let lowestPitch = 1000;
        let lowestIdx = 0;
        let highestPitch = -1;
        let highestIdx = 0;

        if (maxVoices === 1) {
            if ((stealMode === 'none' || stealMode === 'env') && safeNow < this.voices[0].activeUntil) {
                targetIdx = -1;
            } else {
                targetIdx = 0;
            }
        } else {
            for (let i = 0; i < maxVoices; i++) {
                let v = this.voices[i];
                if (safeNow >= v.activeUntil) {
                    targetIdx = i;
                    break;
                }

                let tTime = v.lastTriggerTime || 0;
                if (tTime < oldestTime) { oldestTime = tTime; oldestIdx = i; }
                if (v.noteOffTime && safeNow >= v.noteOffTime && tTime < oldestReleasingTime) {
                    oldestReleasingTime = tTime;
                    oldestReleasingIdx = i;
                }

                let p = v.currentPitch || 0;
                if (p < lowestPitch) { lowestPitch = p; lowestIdx = i; }
                if (p > highestPitch) { highestPitch = p; highestIdx = i; }
            }

            if (targetIdx === -1 && stealMode !== 'none' && stealMode !== 'env') {
                if (stealMode === 'lowest') targetIdx = lowestIdx;
                else if (stealMode === 'highest') targetIdx = highestIdx;
                else targetIdx = oldestReleasingIdx !== -1 ? oldestReleasingIdx : oldestIdx;
            }
        }

        if (targetIdx === -1) return false;

        this.voiceIndex = targetIdx;
        this.lastTriggerTime = safeNow;
        this.lastDuration = Math.max(0.025, Math.min(safeDurMs / 1000, 30.0));
        let stopTime = safeNow + this.lastDuration;

        let v = this.voices[this.voiceIndex];
        const wasActive = (safeNow < v.activeUntil);

        if (maxVoices === 1 && this.params.legato === 1 && wasActive) {
            if (v.noteOffTime > stopTime) {
                stopTime = v.noteOffTime;
            }
        }

        v.lastTriggerTime = safeNow;
        v.currentPitch = safePitch;

        if (!this.params.muted && !window.isMasterMuted) {
            v.activeUntil = v.trigger(safePitch, freq, safeVel, safeNow, stopTime, this.params, wasActive);
        } else {
            const ampTimings = EnvelopeGen.getSafeTimings(this.params.ampEnv, 'amp', 0);
            v.noteOffTime = stopTime;
            v.activeUntil = stopTime + ampTimings.safeRel + 0.02;
        }
        return true;
    }
}
