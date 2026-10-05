/**
 * js/main.js
 */

function ensureSynths() {
    if (synthChannels.length === 0) {
        for(let i=0; i<4; i++) synthChannels.push(new PolyChannel(i));
        document.getElementById('synth-inspector').style.display = 'block';
        initKnobs(); 
        syncUI(); 
    }
}

window.onload = () => { 
    initVisualizer();
    // Build the synth UI immediately on load so the Connect button doesn't shift
    ensureSynths(); 
    initPiano(); 
    syncPianoUI(); // Force scale colors to update
    loadPresetsFromStorage();
    
    // Kick off the global render loop
    requestAnimationFrame(renderLoop);
};
