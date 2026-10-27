/**
 * js/visualizer.js
 * Self-Healing Diagnostic Multi-Channel Visualizer
 */

window.chData = window.chData || [
    { config: { zoom: 1000, smooth: 0.5 }, waveBuffer: [], vizBuffer: [], history: [], notes: [] },
    { config: { zoom: 1000, smooth: 0.5 }, waveBuffer: [], vizBuffer: [], history: [], notes: [] },
    { config: { zoom: 1000, smooth: 0.5 }, waveBuffer: [], vizBuffer: [], history: [], notes: [] },
    { config: { zoom: 1000, smooth: 0.5 }, waveBuffer: [], vizBuffer: [], history: [], notes: [] }
];

window.defaultParams = window.defaultParams || { threshold: 2.5, sampleSize: 40 };

window.triggerDensityVisualizer = function(chIdx, type) {
    let el = document.getElementById(`density-flash-${chIdx}`) || document.getElementById(`viz-ch-${chIdx}`);
    if (el) {
        el.classList.add('density-active');
        setTimeout(() => el.classList.remove('density-active'), 150);
    }
};

window.startVisualizers = function() {
    
    // Ensure a fallback container exists if no visualizers are found in the DOM
    let diagnosticContainer = document.getElementById('diagnostic-viz-container');
    if (!diagnosticContainer) {
        diagnosticContainer = document.createElement('div');
        diagnosticContainer.id = 'diagnostic-viz-container';
        diagnosticContainer.style.cssText = 'position: fixed; bottom: 10px; right: 10px; z-index: 99999; background: rgba(10,13,18,0.9); border: 1px solid #00ffcc; padding: 10px; border-radius: 8px; max-width: 320px; font-family: monospace; font-size: 11px; color: #00ffcc; pointer-events: none;';
        diagnosticContainer.innerHTML = '<div style="font-weight:bold; margin-bottom:5px;">BIO-DIAGNOSTIC VIZ</div><div id="diag-status">Waiting for data...</div>';
        document.body.appendChild(diagnosticContainer);
    }

    function draw() {
        requestAnimationFrame(draw);

        let activeCount = (typeof synthChannels !== 'undefined' && synthChannels.length) ? synthChannels.length : 1;
        let totalReceivedPoints = 0;

        for (let i = 0; i < activeCount; i++) {
            if (!chData[i]) continue;
            let ch = chData[i];
            if (ch.vizBuffer) totalReceivedPoints += ch.vizBuffer.length;
            
            let params = (typeof synthChannels !== 'undefined' && synthChannels[i] && synthChannels[i].params) 
                ? synthChannels[i].params 
                : window.defaultParams;

            // --- 1. MIXER VU METERS ---
            let vu = document.getElementById(`vu-${i}`);
            if (vu) {
                let vCtx = vu.getContext('2d');
                let vw = vu.width || 30;
                let vvh = vu.height || 120;
                if (vu.width !== vw || vu.height !== vvh) { vu.width = vw; vu.height = vvh; }
                
                vCtx.clearRect(0, 0, vw, vvh);
                vCtx.fillStyle = '#0a0d12';
                vCtx.fillRect(0, 0, vw, vvh);

                let level = 0;
                if (ch.notes && ch.notes.length > 0) {
                    let now = Date.now();
                    ch.notes = ch.notes.filter(n => now - n.t < 300);
                    if (ch.notes.length > 0) level = Math.max(...ch.notes.map(n => n.v)) / 127.0;
                }
                if (level > 0) {
                    vCtx.fillStyle = (window.CH_COLORS && window.CH_COLORS[i]) ? window.CH_COLORS[i] : '#00FFCC';
                    vCtx.fillRect(0, vvh - (level * vvh), vw, level * vvh);
                }
            }

            // --- 2. MULTI-STRATEGY CANVAS FINDER & AUTO-INJECTOR ---
            let canvas = document.getElementById(`ch-canvas-${i}`) || 
                         document.getElementById(`viz-ch-${i}`) || 
                         document.querySelector(`.synth-tab-content:nth-child(${i+1}) canvas`) ||
                         document.querySelector(`canvas`);

            if (!canvas) {
                // If the app layout lacks a canvas entirely, build one inside the active UI container
                let targetPanel = document.querySelector(`.synth-inspector`) || document.body;
                canvas = document.createElement('canvas');
                canvas.id = `ch-canvas-${i}`;
                canvas.width = 500;
                canvas.height = 120;
                canvas.style.cssText = 'width: 100%; height: 110px; display: block; background: #080a0f; border: 1px solid rgba(0,255,200,0.2); border-radius: 4px; margin: 5px 0;';
                targetPanel.appendChild(canvas);
            }

            let ctx = canvas.getContext('2d');
            let w = canvas.width || canvas.clientWidth || 400;
            let h = canvas.height || canvas.clientHeight || 120;
            if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

            ctx.clearRect(0, 0, w, h);

            if (!ch.vizBuffer || ch.vizBuffer.length < 2) {
                // Standby line so you know the canvas is active
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, h/2); ctx.lineTo(w, h/2);
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

            // LOCKED Y-AXIS: Exactly 5.0 Standard Deviations
            let yRangeMax = mean + (5.0 * stdDev);
            let yRangeMin = mean - (5.0 * stdDev);
            let absoluteRange = yRangeMax - yRangeMin;
            if (absoluteRange <= 0) absoluteRange = 1.0;

            const getY = (val) => h - ((val - yRangeMin) / absoluteRange) * h;

            let yUpper = getY(mean + (params.threshold * stdDev));
            let yLower = getY(mean - (params.threshold * stdDev));

            // --- A. GLOWING THRESHOLD TUBE ---
            let grad = ctx.createLinearGradient(0, yUpper, 0, yLower);
            grad.addColorStop(0, 'rgba(0, 200, 255, 0.4)');
            grad.addColorStop(0.5, 'rgba(0, 200, 255, 0.02)');
            grad.addColorStop(1, 'rgba(0, 200, 255, 0.4)');

            ctx.fillStyle = grad;
            ctx.fillRect(0, yUpper, w, yLower - yUpper);

            ctx.strokeStyle = 'rgba(0, 200, 255, 0.9)';
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(0, yUpper); ctx.lineTo(w, yUpper);
            ctx.moveTo(0, yLower); ctx.lineTo(w, yLower);
            ctx.stroke();
            ctx.setLineDash([]);

            // --- B. SIGNAL WAVEFORM ---
            let step = w / (ch.vizBuffer.length - 1);
            let highlightColor = (window.CH_COLORS && window.CH_COLORS[i]) ? window.CH_COLORS[i] : '#00FFCC';

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let j = 0; j < ch.vizBuffer.length; j++) {
                let x = j * step;
                let y = getY(ch.vizBuffer[j]);
                if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Puncture highlight
            ctx.strokeStyle = highlightColor;
            ctx.lineWidth = 3;
            let drawing = false;
            for (let j = 0; j < ch.vizBuffer.length; j++) {
                let val = ch.vizBuffer[j];
                let x = j * step;
                let y = getY(val);
                let punctured = Math.abs(val - mean) > (params.threshold * stdDev);

                if (punctured) {
                    if (!drawing) { ctx.beginPath(); ctx.moveTo(x, y); drawing = true; }
                    ctx.lineTo(x, y);
                } else if (drawing) {
                    ctx.stroke(); drawing = false;
                }
            }
            if (drawing) ctx.stroke();
        }

        // Update diagnostic overlay box
        let diagStatus = document.getElementById('diag-status');
        if (diagStatus) {
            diagStatus.innerHTML = totalReceivedPoints > 0 
                ? `<span style="color:#00ffcc;">● ACTIVE (${totalReceivedPoints} samples)</span>` 
                : `<span style="color:#ffaa00;">○ CONNECTED (Waiting for Plant data...)</span>`;
            if (totalReceivedPoints > 100 && diagnosticContainer) {
                // Auto-hide diagnostic box once we know canvases are rendering normally
                setTimeout(() => { diagnosticContainer.style.display = 'none'; }, 3000);
            }
        }
    }
    
    requestAnimationFrame(draw);
};

window.initVisualizer = function() { if (typeof window.startVisualizers === 'function') window.startVisualizers(); };
window.renderLoop = function() {
    if (typeof window.startVisualizers === 'function' && !window._visRunning) {
        window._visRunning = true;
        window.startVisualizers();
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.startVisualizers);
} else {
    window.startVisualizers();
}
