/**
 * js/visualizer.js
 * The Biological Entropy & Threshold Gradient Visualizer
 */

window.startVisualizers = function() {
    
    function draw() {
        requestAnimationFrame(draw);

        for (let i = 0; i < 4; i++) {
            if (!synthChannels[i] || !chData[i]) continue;
            let ch = chData[i];
            let params = synthChannels[i].params;

            // --- 1. MIXER VU METERS ---
            let vu = document.getElementById(`vu-${i}`);
            if (vu) {
                let vCtx = vu.getContext('2d');
                let vw = vu.width;
                let vh = vu.height;
                vCtx.clearRect(0, 0, vw, vh);

                // Draw VU background
                vCtx.fillStyle = '#111';
                vCtx.fillRect(0, 0, vw, vh);

                let level = 0;
                if (ch.notes && ch.notes.length > 0) {
                    let now = Date.now();
                    // Clean up old notes
                    ch.notes = ch.notes.filter(n => now - n.t < n.dur);
                    if (ch.notes.length > 0) {
                        // Find the loudest active note
                        let maxVel = Math.max(...ch.notes.map(n => n.v));
                        level = maxVel / 127.0;
                    }
                }

                if (level > 0) {
                    let fillHeight = level * vh;
                    let color = (window.CH_COLORS && window.CH_COLORS[i]) ? window.CH_COLORS[i] : '#00FFCC';
                    vCtx.fillStyle = color;
                    vCtx.fillRect(0, vh - fillHeight, vw, fillHeight);
                }
            }

            // --- 2. MAIN THRESHOLD WAVEFORM ---
            // Catch whichever ID your HTML uses for the rolling graph
            let canvas = document.getElementById(`ch-canvas-${i}`) || document.getElementById(`viz-ch-${i}`);
            if (!canvas) continue;

            let ctx = canvas.getContext('2d');
            let w = canvas.width;
            let h = canvas.height;

            ctx.clearRect(0, 0, w, h);

            if (!ch.vizBuffer || ch.vizBuffer.length < 2) {
                // Draw standby center line if no data
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, h/2);
                ctx.lineTo(w, h/2);
                ctx.stroke();
                continue;
            }

            // EXACT MATH MATCH TO HARDWARE V023
            let sum = 0;
            for(let j = 0; j < ch.vizBuffer.length; j++) sum += ch.vizBuffer[j];
            let mean = sum / ch.vizBuffer.length;

            let sumSq = 0;
            for(let j = 0; j < ch.vizBuffer.length; j++) sumSq += Math.pow(ch.vizBuffer[j] - mean, 2);
            let stdDev = Math.sqrt(sumSq / ch.vizBuffer.length);
            
            // Replicate the hardware's 0.5f noise floor minimum
            let minStdDev = mean * 0.005;
            if (stdDev < minStdDev) stdDev = minStdDev;
            if (stdDev < 0.5) stdDev = 0.5;

            // Anchor the Y-Axis to exactly 5.0 Standard Deviations.
            // This guarantees the UI slider (0-5.0) visually locks to the canvas height perfectly.
            let yRangeMax = mean + (5.0 * stdDev);
            let yRangeMin = mean - (5.0 * stdDev);
            let absoluteRange = yRangeMax - yRangeMin;

            // Pixel mapping function
            const getY = (val) => h - ((val - yRangeMin) / absoluteRange) * h;

            let yMean = getY(mean);
            let yUpper = getY(mean + (params.threshold * stdDev));
            let yLower = getY(mean - (params.threshold * stdDev));

            // --- A. DRAW THE HOLLOW GLOWING THRESHOLD TUBE ---
            let grad = ctx.createLinearGradient(0, yUpper, 0, yLower);
            let colorBase = (window.CH_COLORS && window.CH_COLORS[i]) ? window.CH_COLORS[i] : 'rgba(0, 255, 200,';
            
            // Extract rgb from hex/hsl to build the gradient if necessary, 
            // or just use a stunning generic cyan/purple glow
            grad.addColorStop(0, 'rgba(0, 200, 255, 0.35)');
            grad.addColorStop(0.5, 'rgba(0, 200, 255, 0.02)');
            grad.addColorStop(1, 'rgba(0, 200, 255, 0.35)');

            ctx.fillStyle = grad;
            ctx.fillRect(0, yUpper, w, yLower - yUpper);

            // Glowing Boundary Dashes
            ctx.strokeStyle = 'rgba(0, 200, 255, 0.8)';
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, yUpper); ctx.lineTo(w, yUpper);
            ctx.moveTo(0, yLower); ctx.lineTo(w, yLower);
            ctx.stroke();
            ctx.setLineDash([]); // Reset dash

            // Draw faint center Mean line
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.beginPath();
            ctx.moveTo(0, yMean); ctx.lineTo(w, yMean);
            ctx.stroke();

            // --- B. DRAW THE BIOLOGICAL SIGNAL ---
            let step = w / (ch.vizBuffer.length - 1);
            let highlightColor = (window.CH_COLORS && window.CH_COLORS[i]) ? window.CH_COLORS[i] : '#00FFCC';

            // Base Pass: Draw the entire waveform as a thin ghost line
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

            // Highlight Pass: Draw thick, bright lines ONLY when the signal punctures the Threshold Tube
            ctx.strokeStyle = highlightColor;
            ctx.lineWidth = 3;
            ctx.beginPath();
            let isDrawingHighlight = false;

            for (let j = 0; j < ch.vizBuffer.length; j++) {
                let val = ch.vizBuffer[j];
                let x = j * step;
                let y = getY(val);
                
                // Does this specific data point puncture the threshold?
                let isPunctured = Math.abs(val - mean) > (params.threshold * stdDev);

                if (isPunctured) {
                    if (!isDrawingHighlight) {
                        ctx.beginPath();
                        // Anchor to the previous point so the line emerges smoothly from the tube
                        if (j > 0) ctx.moveTo((j-1) * step, getY(ch.vizBuffer[j-1]));
                        else ctx.moveTo(x, y);
                        isDrawingHighlight = true;
                    }
                    ctx.lineTo(x, y);
                } else {
                    if (isDrawingHighlight) {
                        ctx.lineTo(x, y); // Tie back into the safe zone
                        ctx.stroke();
                        isDrawingHighlight = false;
                    }
                }
            }
            if (isDrawingHighlight) ctx.stroke(); // Flush any remaining highlighted path
        }
    }
    
    // Kick off the animation loop
    requestAnimationFrame(draw);
};

// Initialize when the DOM is fully loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.startVisualizers);
} else {
    window.startVisualizers();
}
