/**
 * js/main.js
 * bioQuad Master Orchestration
 */

function ensureSynths() {
    if (synthChannels.length === 0) {
        if (typeof window.noiseBuffer === 'undefined') initCustomWaves(); 
        for(let i=0; i<4; i++) synthChannels.push(new PolyChannel(i));
        
        initKnobs(); 
        syncUI(); 
    }
}

window.toggleSynthUI = function() {
    const synthPanel = document.getElementById('synth-inspector');
    const synthToggleBtn = document.getElementById('toggle-synth-btn');
    if (!synthPanel) return;
    
    const isHidden = synthPanel.classList.toggle('ui-hidden');
    synthPanel.style.display = isHidden ? 'none' : 'block';
    
    if (synthToggleBtn) synthToggleBtn.style.opacity = isHidden ? '0.5' : '1.0';
    setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 50);
};

window.initBioQuadApp = function() { 
    initVisualizer();
    initCustomWaves(); 
    ensureSynths(); 
    initPiano(); 
    syncPianoUI(); 
    buildMixerAndMidiUI();
    loadPresetsFromStorage();
    requestAnimationFrame(renderLoop);
    
    // Unlock Web Audio context on user gesture
    ['click', 'touchstart', 'keydown'].forEach(evt => {
        document.body.addEventListener(evt, () => {
            if (window.audioCtx && window.audioCtx.state === 'suspended') {
                window.audioCtx.resume().catch(()=>{});
            }
        }, { once: true });
    });

    window.addEventListener('resize', () => {
        // Redraw on window resize
    });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.initBioQuadApp);
} else {
    window.initBioQuadApp();
}

// --- FIRMWARE DOWNLOADER ---
window.downloadFirmwareZip = async function() {
    const btn = document.getElementById('btn-download-firmware');
    if (btn) btn.innerText = "PACKAGING...";
    
    const JSZipLib = window.JSZip || (typeof JSZip !== 'undefined' ? JSZip : null);
    if (!JSZipLib) {
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
            s.onload = resolve; 
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }
    
    const zip = new (window.JSZip)();
    const folder = zip.folder("biodata_firmware");

    // FIX: Only fetch the single consolidated .ino file
    // IMPORTANT: Change "Biodata_Mono_031.ino" to the exact filename sitting in your /firmware/ folder
    const files = [
        { path: "/firmware/biodata_quad.ino", name: "biodata_quad.ino" } 
    ];

    try {
        for (let file of files) {
            // Append a cache-busting timestamp so it never grabs an old cached version
            let res = await fetch(`${file.path}?t=${new Date().getTime()}`);
            if (!res.ok) throw new Error(`Could not fetch ${file.path}`);
            let content = await res.text();
            folder.file(file.name, content);
        }

        const zipBlob = await zip.generateAsync({ type: "blob" });
        const downloadUrl = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = "biodata_esp32_firmware.zip";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(downloadUrl);
    } catch(err) {
        console.error("Failed to bundle zip:", err);
        alert("Failed to download firmware bundle. Ensure the filename in JS matches the file on your server.");
    } finally {
        if (btn) btn.innerText = "FIRMWARE";
    }
};

