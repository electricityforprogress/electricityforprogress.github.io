/**
 * js/visualizer.js
 * 
 * Drives the Canvas rendering loop.
 * FUTURE ENHANCEMENT: As we implement more elaborate charts/graphs and handle
 * new densities of information, you might consider migrating this Canvas logic to 
 * WebGL (via Three.js/Pixi.js) or a dedicated charting library (like Chart.js/D3)
 * if timescale zooming and panning are required.
 */

let sCtxs = [], rCtxs = [];

function initVisualizer() {
    const dash = document.getElementById('dashboard');
    for(let i=0; i<4; i++) {
        dash.innerHTML += `
        <div class="card">
            <div class="card-header">
                <span class="ch-title" style="color:hsl(${i*90}, 100%, 60%)">CHANNEL ${i+1}</span>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button id="mute-btn-${i}" onclick="toggleMute(${i})" style="padding: 2px 6px; font-size: 0.7em; margin-left:10px;">MUTE</button>
                    <input type="range" min="0" max="1" step="0.05" value="0.8" oninput="setVolume(${i}, this.value)" style="width: 50px;">
                    <span style="font-size:0.75em; margin-left:5px;">Thresh (<span id="t-val-${i}">2.0</span>x)</span>
                    <input type="range" min="0.5" max="5.0" step="0.1" value="2.0" onchange="sendThresholdBLE(${i}, this.value)" style="width:50px">
                </div>
            </div>
            <canvas class="scope" id="scope-${i}"></canvas>
            <canvas class="roll" id="roll-${i}"></canvas>
        </div>`;
    }

    sCtxs = [0,1,2,3].map(i => document.getElementById(`scope-${i}`).getContext('2d'));
    rCtxs = [0,1,2,3].map(i => document.getElementById(`roll-${i}`).getContext('2d'));
    
    window.addEventListener('resize', resize); 
    resize();
}

function resize() { 
    for(let i=0; i<4; i++) { 
        if(sCtxs[i] && rCtxs[i]) {
            sCtxs[i].canvas.width = sCtxs[i].canvas.clientWidth; 
            sCtxs[i].canvas.height = sCtxs[i].canvas.clientHeight; 
            rCtxs[i].canvas.width = rCtxs[i].canvas.clientWidth; 
            rCtxs[i].canvas.height = rCtxs[i].canvas.clientHeight; 
        }
    } 
}

let lastBeatCount = 0;

function renderLoop() {
    const nowMs = performance.now();
    const nowAudio = audioCtx.currentTime;
    
    if (synthChannels[activeSynthIndex]) {
        const p = synthChannels[activeSynthIndex].params;
        
        // BPM Flasher
        const msPerBeat = 60000 / p.bpm;
        const currentBeatCount = Math.floor(nowMs / msPerBeat);
        if (currentBeatCount !== lastBeatCount) {
            lastBeatCount = currentBeatCount;
            document.getElementById('ui-bpm-led').classList.add('active');
            setTimeout(() => document.getElementById('ui-bpm-led').classList.remove('active'), 50);
        }

        // LFO LED Feedback
        let phase = (nowAudio * p.lfoRate) % 1.0;
        let bright = 0;
        if (p.lfoShape === 'sine') bright = (Math.sin(phase * Math.PI * 2) + 1) / 2;
        else if (p.lfoShape === 'square') bright = phase < 0.5 ? 1 : 0;
        else if (p.lfoShape === 'triangle') bright = phase < 0.5 ? phase * 2 : 2 - (phase * 2);
        else if (p.lfoShape === 'sawtooth') bright = phase;
        else if (p.lfoShape === 'rampdown') bright = 1 - phase;
        else if (p.lfoShape === 'random') bright = (synthChannels[activeSynthIndex].shValue + 1) / 2;
        document.getElementById('ui-lfo-led').style.opacity = 0.1 + (bright * 0.9);
    }

    // Custom S&H LFO Processing
    synthChannels.forEach(ch => {
        const p = ch.params;
        if (p.lfoShape === 'random') {
            if (nowMs - ch.lastShTime > (1000 / p.lfoRate)) {
                ch.lastShTime = nowMs;
                ch.shValue = (Math.random() * 2) - 1; 
                if (p.lfoDest === 'pitch') { ch.voices.forEach(v => { v.vco.detune.setTargetAtTime(ch.shValue * p.lfoDepth * 200, nowAudio, 0.02); v.sub.detune.setTargetAtTime(ch.shValue * p.lfoDepth * 200, nowAudio, 0.02); }); } 
                else if (p.lfoDest === 'filter') { ch.voices.forEach(v => v.vcf.detune.setTargetAtTime(ch.shValue * p.lfoDepth * 2000, nowAudio, 0.02)); } 
                else if (p.lfoDest === 'volume') { ch.tremoloGain.gain.setTargetAtTime(1.0 + (ch.shValue * p.lfoDepth), nowAudio, 0.02); }
            }
        }
    });
    
    // Data Visualization Scopes
    for(let i=0; i<4; i++) {
        if(!sCtxs[i]) continue;
        let sCtx = sCtxs[i], rCtx = rCtxs[i], sw = sCtx.canvas.width, sh = sCtx.canvas.height, rw = rCtx.canvas.width, rh = rCtx.canvas.height;
        sCtx.fillStyle = '#000'; sCtx.fillRect(0, 0, sw, sh);
        let buf = chData[i].waveBuffer;
        
        if(buf.length > 1) {
            let min = Math.min(...buf.map(b => b.g)), max = Math.max(...buf.map(b => b.g)), range = max - min || 1;
            // FUTURE ENHANCEMENT: Modify scalar mapping here for new data arrays and time scales
            let pts = buf.map((b, idx) => ({ x: idx * (sw / (buf.length - 1)), y: sh - ((b.g - min) / range * (sh * 0.8)) - (sh * 0.1), e: b.evt, n: b.n }));
            pts.forEach(p => { if(p.e === 1) { sCtx.strokeStyle = `hsla(${(p.n % 12) * 30}, 100%, 50%, 0.7)`; sCtx.lineWidth = 1; sCtx.beginPath(); sCtx.moveTo(p.x, 0); sCtx.lineTo(p.x, sh); sCtx.stroke(); } });
            sCtx.strokeStyle = '#39ff14'; sCtx.lineWidth = 2; sCtx.beginPath(); sCtx.moveTo(pts[0].x, pts[0].y);
            for (let j = 0; j < pts.length - 1; j++) sCtx.lineTo(pts[j].x, pts[j].y); sCtx.stroke();
        }
        
        rCtx.fillStyle = '#000'; rCtx.fillRect(0, 0, rw, rh);
        rCtx.strokeStyle = '#30363d'; rCtx.lineWidth = 1;
        for(let j=0; j<12; j++) { rCtx.beginPath(); rCtx.moveTo(0, j*(rh/12)); rCtx.lineTo(rw, j*(rh/12)); rCtx.stroke(); }
        
        chData[i].notes = chData[i].notes.filter(n => Date.now() - n.t < 4000);
        chData[i].notes.forEach(note => {
            rCtx.fillStyle = `hsla(${(note.n % 12) * 30}, 100%, 50%, ${Math.max(0.3, note.v / 127)})`; 
            rCtx.fillRect(rw - ((Date.now() - note.t) / 4000 * rw) - ((note.dur / 4000) * rw), Math.max(0, rh - ((note.n / 127) * rh) - 4), ((note.dur / 4000) * rw), 8); 
        });
    }
    
    requestAnimationFrame(renderLoop);
}