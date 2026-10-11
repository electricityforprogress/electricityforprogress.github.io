/**
 * js/main.js
 */

function ensureSynths() {
    if (synthChannels.length === 0) {
        // Safe check prevents ReferenceError if audio is suspended
        if (typeof window.noiseBuffer === 'undefined') initCustomWaves(); 
        
        for(let i=0; i<4; i++) synthChannels.push(new PolyChannel(i));
        
        document.getElementById('synth-inspector').style.display = 'block';
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