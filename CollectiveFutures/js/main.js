/**
 * js/main.js
 */

function ensureSynths() {
    if (synthChannels.length === 0) {
        if (typeof window.noiseBuffer === 'undefined') initCustomWaves(); 
        for(let i=0; i<4; i++) synthChannels.push(new PolyChannel(i));
        
        initKnobs(); 
        syncUI(); 
    }
}

// THIS OVERWRITES THE BROKEN FUNCTION IN VISUALIZER.JS SAFELY
window.toggleSynthUI = function() {
    const synthPanel = document.getElementById('synth-inspector');
    const synthToggleBtn = document.getElementById('toggle-synth-btn');
    if (!synthPanel) return;
    
    // Toggle the native CSS class
    const isHidden = synthPanel.classList.toggle('ui-hidden');
    
    // Brute-force the display directly to guarantee the CSS conflict is bypassed
    synthPanel.style.display = isHidden ? 'none' : 'block';
    
    if (synthToggleBtn) synthToggleBtn.style.opacity = isHidden ? '0.5' : '1.0';
    
    setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 50);
};

function initTestInjector() {
    const testSlider = document.getElementById('ui-test-injector');
    if (!testSlider) return;

    setInterval(() => {
        const intensity = parseInt(testSlider.value);
        if (intensity === 0) return;

        // Map slider (1-100) to a random chance per 50ms tick. 
        // At 100, we max out around a 30% chance per tick for rapid-fire testing.
        const chance = (intensity / 100) * 0.3; 

        if (Math.random() < chance) {
            const randomCh = Math.floor(Math.random() * 4);
            const fakeTicks = [];
            
            // Generate a 40-sample payload with massive variance (10k-25k ticks) 
            // to instantly force a trigger regardless of current threshold settings
            for (let i = 0; i < 40; i++) {
                fakeTicks.push(10000 + (Math.random() * 15000));
            }
            
            window.processBiodata({
                type: 'raw',
                ch: randomCh,
                p: fakeTicks
            });
        }
    }, 50);
}

window.onload = () => { 
    initVisualizer();
    initCustomWaves(); 
    ensureSynths(); 
    initPiano(); 
    syncPianoUI(); 
    buildMixerAndMidiUI();
    loadPresetsFromStorage();
    initTestInjector();
    requestAnimationFrame(renderLoop);
    
    // THE AUDIO UNLOCKER: Wakes up the DSP engine on your first click
    document.body.addEventListener('click', () => {
        if (window.audioCtx && window.audioCtx.state === 'suspended') {
            window.audioCtx.resume();
        }
    });
};
