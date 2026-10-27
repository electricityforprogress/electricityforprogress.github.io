/**
 * js/visualizer.js
 * Fully Restored Multi-Channel Visualizer (Supports Mono & Quad Hardware)
 */

window.chData = window.chData || [
    { config: { zoom: 1000, smooth: 0.5 }, waveBuffer: [], vizBuffer: [], history: [], notes: [] },
    { config: { zoom: 1000, smooth: 0.5 }, waveBuffer: [], vizBuffer: [], history: [], notes: [] },
    { config: { zoom: 1000, smooth: 0.5 }, waveBuffer: [], vizBuffer: [], history: [], notes: [] },
    { config: { zoom: 1000, smooth: 0.5 }, waveBuffer: [], vizBuffer: [], history: [], notes: [] }
];

window.defaultParams = window.defaultParams || { threshold: 2.5, sampleSize: 40 };

// Density visual flash trigger
window.triggerDensityVisualizer = function(chIdx, type) {
    let el = document.getElementById(`density-flash-${chIdx}`) || document.getElementById(`viz-ch-${chIdx}`);
    if (el) {
        el.classList.add('density-active');
        setTimeout(() => el.classList.remove('density-active'), 150);
    }
};

window.startVisualizers = function() {
    
    for (let i = 0; i < 4; i++) {
        let zSlider = document.getElementById(`ch-zoom-${i}`);
        let sSlider = document.getElementById(`ch-smooth-${i}`);
        
        if (zSlider) {
            zSlider.addEventListener('input', (e) => {
                let val = parseFloat(e.target.value);
                let minLog = Math.log(50), maxLog = Math.log(120000);
                chData[i].config.zoom = Math.exp(minLog + (val / 1000) * (maxLog - minLog));
                let zVal = document.getElementById(`ch-val-zoom-${i}`);
                if(zVal) zVal.innerText = Math.round(chData[i].config.zoom);
            });
        }
        
        if (sSlider) {
            sSlider.addEventListener('input', (e) => {
                chData[i].config.smooth = parseFloat(e.target.value);
                let sVal = document.getElementById(`ch-val-smooth-${i}`);
                if(sVal) sVal.innerText = chData[i].config.smooth.toFixed(2);
            });
        }
    }

    function draw() {
        requestAnimationFrame(draw);

        // Determine active channels (Supports Mono single-channel or Quad multi-channel)
        let activeCount = (typeof synthChannels !== 'undefined' && synthChannels.length) ? synthChannels.length : 4;

        for (let i = 0; i < activeCount; i++) {
            if (!chData[i]) continue;
            let ch = chData[i];
            
            let params = (typeof synthChannels !== 'undefined' && synthChannels[i] && synthChannels[i].params) 
                ? synthChannels[i].params 
                : window.defaultParams;

            // --- 1. RESTORED MIXER VU METERS ---
            let vu = document.getElementById(`vu-${i}`);
            if (vu) {
                let vCtx = vu.getContext('2d');
                let vw = vu.width || vu.clientWidth || 30;
                let vvh = vu.height || vu.clientHeight || 120;
                if (vu.width !== vw || vu.height !== vvh) { vu.width = vw; vu.height = vvh; }
                
                vCtx.clearRect(0, 0, vw, vvh);
                vCtx.fillStyle = '#0a0d12';
                vCtx.fillRect(0, 0, vw, vvh);

                let level = 0;
                if (ch.notes && ch.notes.length > 0) {
                    let now = Date.now();
                    ch.notes = ch.notes.filter(n => now - n.t < (n.dur || 300));
                    if (ch.notes.length > 0) {
                        let maxVel = Math.max(...ch.notes.map(n => n.v));
                        level = maxVel / 127.0;
                    }
                }

                if (level > 0) {
                    let fillHeight = level * vvh;
                    let color = (window.CH_COLORS && window.CH_COLORS[i]) ? window.CH_COLORS[i] : '#00FFCC';
                    vCtx.fillStyle = color;
                    vCtx.fillRect(0, vvh - fillHeight, vw, fillHeight);
                }
            }

            // --- 2. NUMERIC STATS DISPLAY ---
            let valThresh = document.getElementById(`ch-val-thresh-${i}`);
            if (valThresh) valThresh.innerText = parseFloat(params.threshold).toFixed(2) + 'x';

            let valAvg = document.getElementById(`ch-val-avg-${i}`);
            if (valAvg && ch.vizBuffer && ch.vizBuffer.length > 0) {
                let sum = ch.vizBuffer.reduce((a, b) => a + b, 0);
                valAvg.innerText = (sum / ch.vizBuffer.length).toFixed(3);
            }

            let valSlew = document.getElementById(`ch-val-slew-${i}`);
            if (valSlew) {
                valSlew.innerText = (ch.lastSlew !== undefined ? ch.lastSlew : 0).toFixed(3);
            }

            // --- 3. MAIN THRESHOLD WAVEFORM CANVAS & GRADIENT TUBE ---
            let canvas = document.getElementById(`ch-canvas-${i}`) || document.getElementById(`viz-ch-${i}`);
            if (!canvas) continue;

            let ctx = canvas.getContext('2d');
            let w = canvas.width || canvas.clientWidth || 600;
            let h = canvas.height || canvas.clientHeight || 150;
            if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

            ctx.clearRect(0, 0, w, h);

            if (!ch.vizBuffer || ch.vizBuffer.length < 2) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, h/2);
                ctx.lineTo(w, h/2);
                ctx.stroke();
                continue;
            }

            // Math alignment to Hardware V023
            let sum = 0;
            for(let j = 0; j < ch.vizBuffer.length; j++) sum += ch.vizBuffer[j];
            let mean = sum / ch.vizBuffer.length;

            let sumSq = 0;
            for(let j = 0; j < ch.vizBuffer.length; j++) sumSq += Math.pow(ch.vizBuffer[j] - mean, 2);
            let stdDev = Math.sqrt(sumSq / ch.vizBuffer.length);
            
            let minStdDev = mean * 0.005;
            if (stdDev < minStdDev) stdDev = minStdDev;
            if (stdDev < 0.5) stdDev = 0.5;

            // LOCKED Y-AXIS: Exactly 5.0 Standard Deviations for slider synchronization
            let yRangeMax = mean + (5.0 * stdDev);
            let yRangeMin = mean - (5.0 * stdDev);
            let absoluteRange = yRangeMax - yRangeMin;

            const getY = (val) => h - ((val - yRangeMin) / absoluteRange) * h;

            let yMean = getY(mean);
            let yUpper = getY(mean + (params.threshold * stdDev));
            let yLower = getY(mean - (params.threshold * stdDev));

            // --- A. GLOWING THRESHOLD TUBE ---
            let grad = ctx.createLinearGradient(0, yUpper, 0, yLower);
            grad.addColorStop(0, 'rgba(0, 200, 255, 0.35)');
            grad.addColorStop(0.5, 'rgba(0, 200, 255, 0.02)');
            grad.addColorStop(1, 'rgba(0, 200, 255, 0.35)');

            ctx.fillStyle = grad;
            ctx.fillRect(0, yUpper, w, yLower - yUpper);

            ctx.strokeStyle = 'rgba(0, 200, 255, 0.8)';
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, yUpper); ctx.lineTo(w, yUpper);
            ctx.moveTo(0, yLower); ctx.lineTo(w, yLower);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.beginPath();
            ctx.moveTo(0, yMean); ctx.lineTo(w, yMean);
            ctx.stroke();

            // --- B. BIOLOGICAL SIGNAL & PUNCTURE HIGHLIGHTING ---
            let step = w / (ch.vizBuffer.length - 1);
            let highlightColor = (window.CH_COLORS && window.CH_COLORS[i]) ? window.CH_COLORS[i] : '#00FFCC';

            // Ghost baseline
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let j = 0; j < ch.vizBuffer.length; j++) {
                let x = j * step;
                let y = getY(ch.vizBuffer[j]);
                if (j === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Highlight punctures
            ctx.strokeStyle = highlightColor;
            ctx.lineWidth = 3;
            ctx.beginPath();
            let isDrawingHighlight = false;

            for (let j = 0; j < ch.vizBuffer.length; j++) {
                let val = ch.vizBuffer[j];
                let x = j * step;
                let y = getY(val);
                let isPunctured = Math.abs(val - mean) > (params.threshold * stdDev);

                if (isPunctured) {
                    if (!isDrawingHighlight) {
                        ctx.beginPath();
                        if (j > 0) ctx.moveTo((j-1) * step, getY(ch.vizBuffer[j-1]));
                        else ctx.moveTo(x, y);
                        isDrawingHighlight = true;
                    }
                    ctx.lineTo(x, y);
                } else {
                    if (isDrawingHighlight) {
                        ctx.lineTo(x, y);
                        ctx.stroke();
                        isDrawingHighlight = false;
                    }
                }
            }
            if (isDrawingHighlight) ctx.stroke();
        }
    }
    
    requestAnimationFrame(draw);
};

// --- COMPATIBILITY BINDINGS ---
window.initVisualizer = function() {
    if (typeof window.startVisualizers === 'function') window.startVisualizers();
};

window.renderLoop = function() {
    if (typeof window.startVisualizers === 'function' && !window._visualizerStarted) {
        window._visualizerStarted = true;
        window.startVisualizers();
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.startVisualizers);
} else {
    window.startVisualizers();
}
