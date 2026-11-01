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

function initTestInjector() {
    setInterval(() => {
        if (typeof synthChannels === 'undefined' || synthChannels.length === 0) return;
        
        for (let i = 0; i < 4; i++) {
            const intensity = synthChannels[i].params.testIntensity || 0;
            if (intensity === 0) continue;

            const p = synthChannels[i].params;
            const chance = (intensity / 100) * 0.4; 
            
            if (Math.random() < chance) {
                // 1. Generate realistic raw ticks so the oscilloscope dances
                const fakeTicks = [];
                const baseTicks = 12000 + (i * 2000);
                const varianceSpan = (intensity / 100) * 25000;
                const isSpike = Math.random() < 0.4;
                const spikeVal = isSpike ? (Math.random() > 0.5 ? 40000 : 5000) : 0;

                for (let j = 0; j < 40; j++) {
                    let t = baseTicks + (Math.random() * varianceSpan) + (j === 39 && isSpike ? spikeVal : 0);
                    fakeTicks.push(Math.round(t));
                }
                
                window.processBiodata({
                    type: 'raw',
                    ch: i,
                    p: fakeTicks
                });

                // 2. Trigger notes when variance occurs (proportional to test intensity & density)
                const density = p.density !== undefined ? p.density : 100;
                const noteChance = (intensity / 100) * (density / 100) * 0.5;
                
                if (Math.random() < noteChance) {
                    if (window.audioCtx && window.audioCtx.state === 'suspended') {
                        window.audioCtx.resume().catch(()=>{});
                    }

                    const minN = p.minNote || 36;
                    const maxN = p.maxNote || 84;
                    const normPitch = Math.random();
                    const rawNote = Math.round(minN + normPitch * (maxN - minN));
                    const scaledNote = window.scaleNote(rawNote, p.scaleType, p.scaleRoot, p.activeScaleBits, minN, maxN);
                    
                    const velMin = p.velMin || 60;
                    const velMax = p.velMax || 110;
                    const vel = Math.round(velMin + Math.random() * (velMax - velMin));
                    const durMult = p.durMult || 1.0;
                    const dur = Math.round((120 + Math.random() * 450) * durMult);

                    window.processBiodata({
                        type: 'note',
                        ch: i,
                        n: scaledNote,
                        v: vel,
                        d: dur
                    });
                }
            }
        }
    }, 60);
}

window.initBioQuadApp = function() { 
    initVisualizer();
    initCustomWaves(); 
    ensureSynths(); 
    initPiano(); 
    syncPianoUI(); 
    buildMixerAndMidiUI();
    loadPresetsFromStorage();
    initTestInjector();
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
