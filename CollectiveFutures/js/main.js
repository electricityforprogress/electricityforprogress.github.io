/**
 * js/main.js
 * 
 * Primary entry point. Bootstraps the application, ensures components 
 * load in the correct order, and initiates the render loop.
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
    initPiano(); 
    initKnobs(); 
    loadPresetsFromStorage();
    
    // Kick off the global render loop
    requestAnimationFrame(renderLoop);
};