/**
 * js/visualizer.js
 */

const SYNTH_UI_SELECTOR = '#synth-inspector'; 
const CH_COLORS = ['#ff3333', '#39ff14', '#33ccff', '#b84dff']; 

let sCtxs = [], rCtxs = [];

function initVisualizer() {
    const dash = document.getElementById('dashboard');
    
    if (!document.getElementById('biodata-grid-styles')) {
        const style = document.createElement('style');
        style.id = 'biodata-grid-styles';
        style.innerHTML = `
            #biodata-visualizer-workspace {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 15px;
                width: 100%;
            }
            .canvas-wrapper {
                position: relative;
                width: 100%;
                background: #000;
                border: 1px solid var(--border);
                border-radius: 4px;
                overflow: hidden;
            }
            .canvas-wrapper canvas {
                position: absolute;
                top: 0; left: 0; width: 100%; height: 100%;
            }
        `;
        document.head.appendChild(style);
    }
    
    const visWorkspace = document.createElement('div');
    visWorkspace.id = 'biodata-visualizer-workspace';
    
    let html = ``;

    for(let i=0; i<4; i++) {
        if(!chData[i]) chData[i] = { waveBuffer: [], renderQueue: [], notes: [], acc: {}, history: [] };
        chData[i].config = { zoom: 500, smooth: 0.05, freeze: false };
        
        // Deep Zoom Slider (Max 5000)
        html += `
        <div class="card" style="display: flex; flex-direction: column; background: #0d1117; padding: 15px; border: 1px solid var(--border); border-radius: 4px; min-width: 0;">
            
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 10px; gap: 10px;">
                <span style="color: ${CH_COLORS[i]}; font-size: 1.1em; font-weight: bold;">CH ${i+1}</span>
                
                <div style="display: flex; gap: 10px; align-items: center; font-size: 10px; color: #888; flex-wrap: nowrap;">
                    <label style="display: flex; align-items: center; gap: 3px;" title="Zoom (Timebase)">
                        Z <input type="range" id="ch-zoom-${i}" min="50" max="5000" value="500" style="width: 45px; min-width: 45px; cursor: pointer; margin: 0; padding: 0;">
                    </label>
                    <label style="display: flex; align-items: center; gap: 3px;" title="Smooth (EMA)">
                        S <input type="range" id="ch-smooth-${i}" min="0.01" max="1.0" step="0.01" value="0.05" style="width: 45px; min-width: 45px; cursor: pointer; margin: 0; padding: 0;">
                    </label>
                    <button id="ch-freeze-${i}" style="background: transparent; color: #888; border: 1px solid #444; padding: 2px 6px; border-radius: 3px; cursor: pointer; font-size: 9px; font-weight: bold;">
                        FRZ
                    </button>
                </div>
            </div>
            
            <div class="canvas-wrapper" style="height: 180px; margin-bottom: 15px;">
                <canvas class="scope" id="scope-${i}"></canvas>
            </div>
            
            <div style="display: flex; gap: 15px; height: 130px; min-width: 0;">
                <div class="canvas-wrapper" style="flex: 1; max-width: 50%; height: 100%;">
                    <canvas class="roll" id="roll-${i}"></canvas>
                </div>
                <div id="hud-${i}" style="flex: 1; display: flex; flex-direction: column; justify-content: space-between; background: #0a0d12; padding: 10px; border: 1px solid var(--border); border-radius: 4px; font-family: monospace; min-width: 0; overflow: hidden;"></div>
            </div>
        </div>`;
    }
    
    visWorkspace.innerHTML = html;
    dash.appendChild(visWorkspace);

    for(let i=0; i<4; i++) {
        document.getElementById(`ch-zoom-${i}`).addEventListener('input', (e) => chData[i].config.zoom = parseInt(e.target.value));
        document.getElementById(`ch-smooth-${i}`).addEventListener('input', (e) => chData[i].config.smooth = parseFloat(e.target.value));
