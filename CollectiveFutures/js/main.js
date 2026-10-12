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

window.onload = () => { 
    initVisualizer();
    initCustomWaves(); 
    ensureSynths(); 
    initPiano(); 
    syncPianoUI(); 
    buildMixerAndMidiUI();
    loadPresetsFromStorage();
    
    // Kick off the global render loop
    requestAnimationFrame(renderLoop);
};