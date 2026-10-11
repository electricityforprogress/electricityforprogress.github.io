function processBiodata(payload) {
    if (payload.type === 'raw' && typeof payload.ch === 'number' && Array.isArray(payload.p)) {
        let chIdx = payload.ch;
        let ch = chData[chIdx];
        let pConfig = synthChannels[chIdx] ? synthChannels[chIdx].params : null;
        
        if (!pConfig) return;
        
        if (!ch.analysisBuffer) ch.analysisBuffer = [];
        if (!ch.lastTrigger) ch.lastTrigger = 0;
        if (ch.ema === undefined) ch.ema = null;
        if (!ch.history) ch.history = [];
        if (!ch.acc) ch.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: Date.now() };
        if (!ch.vis) ch.vis = { counter: 0, evt: 0, pitch: null };

        const CALIBRATION_FACTOR = 10000000; 
        
        // --- LIVE DSP COMPUTATION VALUES ---
        const xSpeedEl = document.getElementById('ui-xspeed');
        const ySmoothEl = document.getElementById('ui-ysmooth');
        const DECIMATION_RATE = xSpeedEl ? parseInt(xSpeedEl.value) : 6;
        const EMA_ALPHA = ySmoothEl ? parseFloat(ySmoothEl.value) : 0.15;

        payload.p.forEach(rawTicks => {
            ch.analysisBuffer.push(rawTicks);
            
            // --- MATHEMATICAL SMOOTHING (Y-AXIS CONTROL) ---
            let rawAdmittance = CALIBRATION_FACTOR / rawTicks;
            ch.ema = (ch.ema === null) ? rawAdmittance : (rawAdmittance * EMA_ALPHA) + (ch.ema * (1 - EMA_ALPHA));

            if (ch.lastEma !== undefined) {
                let instantaneousSlew = ch.ema - ch.lastEma;
                ch.slew = (ch.slew === undefined) ? instantaneousSlew : (instantaneousSlew * 0.05) + (ch.slew * 0.95);
                
                if (ch.lastSlew !== undefined) {
                    if (ch.lastSlew > 0 && ch.slew <= 0) ch.peakFlag = 45; 
                    if (ch.lastSlew < 0 && ch.slew >= 0) ch.troughFlag = 45;
                }
                ch.lastSlew = ch.slew;
            }
            ch.lastEma = ch.ema;

            ch.acc.sum += ch.ema; ch.acc.count++;
            if (ch.ema < ch.acc.min) ch.acc.min = ch.ema;
            if (ch.ema > ch.acc.max) ch.acc.max = ch.ema;

            let now = Date.now();
            if (now - ch.acc.lastSec >= 1000) {
                ch.history.push({ avg: ch.acc.sum / ch.acc.count, min: ch.acc.min, max: ch.acc.max });
                if (ch.history.length > 300) ch.history.shift(); 
                ch.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: now };
            }

            let finalPitch = null;
            let isEvent = 0;

            if (ch.analysisBuffer.length >= pConfig.sampleSize) {
                let maxim = 0, minim = 1000000, averg = 0, stdevi = 0;
                for (let j = 0; j < ch.analysisBuffer.length; j++) {
                    let val = CALIBRATION_FACTOR / ch.analysisBuffer[j];
                    if (val > maxim) maxim = val;
                    if (val < minim) minim = val;
                    averg += val;
                    stdevi += val * val; 
                }
                averg = averg / pConfig.sampleSize;
                let variance = (stdevi / pConfig.sampleSize) - (averg * averg);
                stdevi = variance > 0 ? Math.sqrt(variance) : 1.0;
                if (stdevi < 1.0) stdevi = 1.0;
                let delta = maxim - minim;
                
                if (delta > (stdevi * pConfig.threshold)) {
                    if (now - ch.lastTrigger > 50) { 
                        let mapScale = (v, inMin, inMax, outMin, outMax) => (v - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
                        let dur = 150 + mapScale(delta % 127, 0, 127, 100, 5500);
                        let vel = mapScale(delta % 127, 0, 127, 80, 110);
                        let rawNote = mapScale(averg % 127, 0, 127, pConfig.minNote, pConfig.maxNote);
                        let modifiedPitch = applyPitchMods(chIdx, rawNote);
                        
                        if (modifiedPitch !== null) {
                            isEvent = 1;
                            finalPitch = sendMidiNote(chIdx, modifiedPitch, vel, dur);
                            ch.notes.push({ n: finalPitch, t: now, dur: dur, v: vel });
                        }
                        ch.lastTrigger = now;
                    }
                }
                ch.analysisBuffer = [];
            }
            
            // --- MATHEMATICAL DOWNSAMPLING (X-AXIS CONTROL) ---
            if (isEvent) { ch.vis.evt = 1; ch.vis.pitch = finalPitch; }
            ch.vis.counter++;
            
            // The canvas now receives points based on the user's Downsampling rate
            if (ch.vis.counter >= DECIMATION_RATE) {
                if (!ch.renderQueue) ch.renderQueue = [];
                ch.renderQueue.push({ r: rawAdmittance, s: ch.ema, evt: ch.vis.evt, n: ch.vis.pitch });
                ch.vis.counter = 0;
                ch.vis.evt = 0;
                ch.vis.pitch = null;
            }
        });
    }
}
