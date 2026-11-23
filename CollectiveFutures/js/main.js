/**
 * js/main.js
 * bioQuad Master Orchestration & Offline Firmware Bundler
 */

function ensureSynths() {
    if (synthChannels.length === 0) {
        if (typeof window.noiseBuffer === 'undefined') initCustomWaves();
        for (let i = 0; i < 4; i++) synthChannels.push(new PolyChannel(i));

        initKnobs();
        syncUI();
    }
}
window.ensureSynths = ensureSynths;

window.toggleSynthUI = function() {
    const synthPanel = document.getElementById('synth-inspector');
    const synthToggleBtn = document.getElementById('toggle-synth-btn');
    if (!synthPanel) return;

    const isHidden = synthPanel.classList.toggle('ui-hidden');
    synthPanel.style.display = isHidden ? 'none' : 'block';

    if (synthToggleBtn) {
        synthToggleBtn.classList.toggle('is-active', !isHidden);
        synthToggleBtn.style.opacity = '';
        synthToggleBtn.style.borderColor = '';
    }
    setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 50);
};

window.setWorkspaceCardOpen = function(cardId, btnId, shouldOpen) {
    const card = document.getElementById(cardId);
    const btn = document.getElementById(btnId);
    if (!card) return false;
    const isOpen = shouldOpen !== undefined ? Boolean(shouldOpen) : card.classList.contains('ui-hidden');
    card.classList.toggle('ui-hidden', !isOpen);
    card.style.display = isOpen ? 'flex' : 'none';
    if (btn) {
        btn.classList.toggle('is-active', isOpen);
    }
    return isOpen;
};

window.openConnectCard = function() { return window.setWorkspaceCardOpen('connect-portal-card', 'btn-hw-connect', true); };
window.closeConnectCard = function() { return window.setWorkspaceCardOpen('connect-portal-card', 'btn-hw-connect', false); };
window.toggleConnectCard = function() {
    const isOpen = window.setWorkspaceCardOpen('connect-portal-card', 'btn-hw-connect');
    if (isOpen && typeof window.refreshHardwareStatusUI === 'function') {
        window.refreshHardwareStatusUI();
    }
    return isOpen;
};

window.openMidiCard = function() { return window.setWorkspaceCardOpen('midi-portal-card', 'btn-midi-dropdown', true); };
window.closeMidiCard = function() { return window.setWorkspaceCardOpen('midi-portal-card', 'btn-midi-dropdown', false); };
window.toggleMidiCard = function() { return window.setWorkspaceCardOpen('midi-portal-card', 'btn-midi-dropdown'); };

window.initBioQuadApp = function() {
    initVisualizer();
    initCustomWaves();
    ensureSynths();
    initPiano();
    syncPianoUI();
    buildMixerAndMidiUI();
    loadPresetsFromStorage();
    const synthPanel = document.getElementById('synth-inspector');
    const synthToggleBtn = document.getElementById('toggle-synth-btn');
    if (synthPanel && synthToggleBtn) {
        synthToggleBtn.classList.toggle('is-active', !synthPanel.classList.contains('ui-hidden'));
    }
    if (typeof window.refreshHardwareStatusUI === 'function') {
        window.refreshHardwareStatusUI();
    }
    requestAnimationFrame(renderLoop);

    // Unlock Web Audio context on first user gesture
    ['click', 'touchstart', 'keydown'].forEach(evt => {
        document.body.addEventListener(evt, () => {
            if (window.audioCtx && window.audioCtx.state === 'suspended') {
                window.audioCtx.resume().catch(() => {});
            }
        }, { once: true });
    });

    // Optional ?autostart=1 query param for instant active UTC botanical feed preview
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('autostart') === '1' && window.bioquadFeeds) {
            window.bioquadFeeds.assignRoute(0, 'utc-monstera-deliciosa', 0);
            window.bioquadFeeds.assignRoute(1, 'utc-mycelium-log', 0);
        }
    } catch (e) {}
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.initBioQuadApp);
} else {
    window.initBioQuadApp();
}

// --- ZERO-DEPENDENCY OFFLINE FIRMWARE ZIP DOWNLOADER ---
window.downloadFirmwareZip = async function() {
    const btn = document.getElementById('btn-download-firmware');
    const prevLabel = btn ? btn.innerText : '↓ .INO ZIP';
    if (btn) btn.innerText = 'PACKAGING...';

    try {
        const res = await fetch(`./firmware/biodata_quad.ino?t=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const inoText = await res.text();

        const readmeText = [
            'bioQuad ESP32-S3 Firmware v011 (Installation Edition: BLE + USB + Headless WiFi/MQTT + Configurable I2C)',
            '=========================================================================================================',
            '1. Open biodata_quad/biodata_quad.ino in Arduino IDE (2.x) with ESP32 board support.',
            '2. Install Arduino libraries: PubSubClient (Nick O\'Leary), Adafruit TinyUSB, MIDI, Adafruit NeoPixel, Adafruit SHT4x.',
            '3. Select ESP32S3 Dev Module and enable "USB CDC On Boot: Enabled", then upload.',
            '4. Configure WiFi & Cloud MQTT from the web app (no code edits or captive portal needed):',
            '   - Click CONNECT -> CONNECT BLE (or CONNECT USB).',
            '   - Under WIFI & CLOUD MQTT, choose Mosquitto (test.mosquitto.org:1883) or enter your custom broker',
            '     (enable TLS for port 8883 and AUTH for username/password if using HiveMQ Cloud / EMQX Cloud).',
            '   - Enter your 2.4GHz WiFi SSID & Password, keep AUTO ON enabled, and click SAVE TO ESP32.',
            '5. Configurable I2C Header Telemetry (SHT4x / Wind / Env on SDA=8, SCL=9):',
            '   - Set RATE under CONNECT: ON CHANGE (±0.5°F / ±1.5% RH anti-jitter deadband), 250ms (4Hz fast mode),',
            '     500ms, 1s, 5s, 15s (default), 30s, 60s, or OFF — persisted in ESP32 NVS across power cycles.',
            '6. Installation / Power-Hiccup Recovery:',
            '   - All credentials, sensor rate, and Stream ID persist in ESP32 NVS flash.',
            '   - On power-up or WiFi/router drop, the ESP32 automatically reconnects and resumes 4-channel',
            '     MQTT streaming (bioquad/feeds/<id>/stream & /meta) headlessly with no laptop or phone required.'
        ].join('\n');

        const encoder = new TextEncoder();
        if (typeof window.buildZipBlob === 'function') {
            const zipBlob = window.buildZipBlob([
                { name: 'biodata_quad/biodata_quad.ino', data: encoder.encode(inoText) },
                { name: 'biodata_quad/README.txt', data: encoder.encode(readmeText) }
            ]);
            const downloadUrl = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = 'biodata_esp32_firmware_v011.zip';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
        } else {
            const blob = new Blob([inoText], { type: 'text/plain;charset=utf-8' });
            const downloadUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = 'biodata_quad.ino';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
        }

        if (typeof window.showHardwareNotice === 'function') {
            window.showHardwareNotice('Downloaded bioQuad ESP32-S3 v011 firmware bundle (BLE + USB + WiFi/MQTT + Configurable I2C).', 3600);
        }
    } catch (err) {
        console.error('Failed to bundle firmware:', err);
        if (typeof window.showHardwareNotice === 'function') {
            window.showHardwareNotice('Could not download firmware bundle. Check ./firmware/biodata_quad.ino.', 4000);
        }
    } finally {
        if (btn) btn.innerText = prevLabel;
    }
};
