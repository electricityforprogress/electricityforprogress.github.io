/**
 * js/visualizer.js
 */

let sCtxs = [], rCtxs = [];

function initVisualizer() {
    const dash = document.getElementById('dashboard');
    
    // Inject the new Scope Menu directly above the grid
    let scopeMenu = document.createElement('div');
    scopeMenu.style.cssText = "grid-column: 1 / -1; display: flex; gap: 30px; background: #0a0d12; padding: 15px; border: 1px solid var(--border); border-radius: 4px; align-items: center; margin-bottom: 10px; flex-wrap: wrap;";
    scopeMenu.innerHTML = `
        <div style="color: var(--cyan); font-weight: bold; font-size: 1.1em; min-width: 120px;">SCOPE MENU</div>
        <div style="flex: 1; display: flex; flex-direction: column; min-width: 200px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.7em; color: #888; font-weight: bold; margin-bottom: 5px;">
                <span>SPEED / TIMEBASE (X-AXIS)</span>
                <span id="ui-val-timebase" style="color: var(--text);">200 Samples</span>
            </div>
            <input type="range" id="ui-timebase" min="20" max="1000" value="200" style="width: 100%; cursor: pointer;">
        </div>
        <div style="flex: 1; display: flex; flex-direction: column; min-width: 200px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.7em; color: #888; font-weight: bold; margin-bottom: 5px;">
                <span>DEPTH / ZOOM (Y-AXIS)</span>
                <span id="ui-val-ydepth" style="color: var(--text);">Auto-Fit</span>
            </div>
            <input type="range" id="ui-ydepth" min="0" max="5000" step="50" value="0" style="width: 100%; cursor: pointer;">
        </div>
    `;
    dash.appendChild(scopeMenu);

    // Build the 4 Channel Cards
    for(let i=0; i<4; i++) {
        dash.innerHTML += `
        <div class="card">
            <div class="card-header">
                <span class="ch-title" style="color:hsl(${i*90}, 100%, 60%)">CHANNEL ${i+1}</span>
            </div>
            <canvas class="scope" id="scope-${i}"></canvas>
            <canvas class="roll" id="roll-${i}"></canvas>
        </div>`;
    }

    // Attach listeners to update the UI text labels dynamically
    document.getElementById('ui-timebase').addEventListener('input', (e) => {
        document.getElementById('ui-val-timebase').innerText = e.target.value + ' Samples';
    });
    document.getElementById('ui-ydepth').addEventListener('input', (e) => {
        document.getElementById('ui-val-ydepth').innerText = e.target.value == 0 ? 'Auto-Fit' : e.target.value + ' µs Range';
    });

    sCtxs = [0,1,2,3].map(i => document.getElementById(`scope-${i}`).getContext('2d'));
    rCtxs = [0,1,2,3].map(i => document.getElementById(`roll-${i}`).getContext('2d'));
    
    window.addEventListener('resize', resize); 
    resize();
}

function drawSegmentedVU(canvas, level, isHorizontal = false) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const numSegments = isHorizontal ? 20 : 15;
    const gap = 1;
    
    for (let i = 0; i < numSegments; i++) {
        const threshold = (i + 1) / numSegments;
        const isOn = level >= (i / numSegments);
        
        let color = '#39ff14';
        if (threshold > 0.7) color = '#ffff00';
        if (threshold > 0.9) color = '#ff0055';
        
        ctx.fillStyle = isOn ? color : '#111'; 
        
        if (isHorizontal) {
            let w = (canvas.width / numSegments) - gap;
            ctx.fillRect(i * (w + gap), 0, w, canvas.height);
        } else {
            let h = (canvas.height / numSegments) - gap;
            let y = canvas.height - ((i + 1) * (h + gap));
            ctx.fillRect(0, y, canvas.width, h);
        }
    }
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

    // Fetch the live slider values from the DOM
    const targetTimebase = parseInt(document.getElementById('ui-timebase').value);
    const targetDepth = parseInt(document.getElementById('ui-ydepth').value);

    let masterPeak = 0;
    for (let i = 0; i < 4; i++) {
        if (synthChannels[i]) {
            let peak = 0;
            if (synthChannels[i].analyser && synthChannels[i].vuData) {
                synthChannels[i].analyser.getFloatTimeDomainData(synthChannels[i].vuData);
                for (let j = 0; j < synthChannels[i].vuData.length; j++) {
                    let abs = Math.abs(synthChannels[i].vuData[j]);
                    if (abs > peak) peak = abs;
                }
            }
            synthChannels[i].vuLevel = synthChannels[i].vuLevel ? Math.max(peak, synthChannels[i].vuLevel - 0.04) : peak;
            masterPeak = Math.max(masterPeak, synthChannels[i].vuLevel);
            drawSegmentedVU(document.getElementById(`vu-${i}`), Math.min(1.0, synthChannels[i].vuLevel * 1.5), false);
        }
    }
    
    if (synthChannels[activeSynthIndex]) {
        const p = synthChannels[activeSynthIndex].params;
        
        const msPerBeat = 60000 / p.bpm;
        const currentBeatCount = Math.floor(nowMs / msPerBeat);
        if (currentBeatCount !== lastBeatCount) {
            lastBeatCount = currentBeatCount;
            const bpmLed = document.getElementById('ui-bpm-led');
            if(bpmLed) {
                bpmLed.classList.add('active');
                setTimeout(() => bpmLed.classList.remove('active'), 50);
            }
        }

        const lfos = [
            { key: 'pitchLfo', id: 'ind-lfo-pitchLfo' },
            { key: 'filterLfo', id: 'ind-lfo-filterLfo' },
            { key: 'ampLfo', id: 'ind-lfo-ampLfo' }
        ];

        lfos.forEach(lfo => {
            const config = p[lfo.key];
            let phase = (nowAudio * config.rate) % 1.0;
            let bright = 0;
            if (config.shape === 'sine') bright = (Math.sin(phase * Math.PI * 2) + 1) / 2;
            else if (config.shape === 'square') bright = phase < 0.5 ? 1 : 0;
            else if (config.shape === 'triangle') bright = phase < 0.5 ? phase * 2 : 2 - (phase * 2);
            else if (config.shape === 'sawtooth') bright = phase;
            else if (config.shape === 'rampdown') bright = 1 - phase;
            else if (config.shape === 'random') bright = Math.random(); 

            const ledEl = document.getElementById(lfo.id);
            if (ledEl) {
                const intensity = config.depth > 0 ? 0.9 : 0.25; 
                ledEl.style.opacity = 0.1 + (bright * intensity);
            }
        });
    }

    synthChannels.forEach(ch => {
        if(!ch.shState) ch.
