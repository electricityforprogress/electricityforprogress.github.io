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

window.onload = () => { 
    initVisualizer();
    initCustomWaves(); 
    ensureSynths(); 
    initPiano(); 
    syncPianoUI(); 
    buildMixerAndMidiUI();
    loadPresetsFromStorage();
    
    requestAnimationFrame(renderLoop);
    
    // THE AUDIO UNLOCKER: Wakes up the DSP engine on your first click
    document.body.addEventListener('click', () => {
        if (window.audioCtx && window.audioCtx.state === 'suspended') {
            window.audioCtx.resume();
        }
    });
};