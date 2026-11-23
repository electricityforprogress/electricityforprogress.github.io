/**
 * js/uiController.js
 * bioQuad Control Surface, Tooltips, Presets & Additive CC Sync
 */

window.syncTimers = {};
window.debouncedHardwareSync = function(chIdx) {
    if (typeof window.isHardwareConnected === 'function' ? !window.isHardwareConnected() : !window.bleTxCharacteristic) return;
    clearTimeout(window.syncTimers[chIdx]);
    window.syncTimers[chIdx] = setTimeout(() => {
        if (typeof window.syncParamsToHardware === 'function') {
            window.syncParamsToHardware(chIdx);
        }
    }, 100); 
};

let hwNoticeTimer = null;
window.showHardwareNotice = function(msg, durationMs = 4500, options = {}) {
    const banner = document.getElementById('hw-toast-banner');
    const textEl = document.getElementById('hw-toast-text');
    const actionLink = document.getElementById('hw-toast-action-link');
    const needsStandalone = Boolean(options && options.needsStandaloneTab);
    if (!banner || !textEl) {
        console.info('[bioQuad]', msg);
        return;
    }
    textEl.textContent = msg;
    if (actionLink) {
        actionLink.href = window.location.href;
        actionLink.style.display = needsStandalone ? 'inline-flex' : 'none';
    }
    banner.style.display = 'flex';
    clearTimeout(hwNoticeTimer);
    hwNoticeTimer = setTimeout(() => {
        banner.style.display = 'none';
    }, durationMs);
};

window.refreshHardwareStatusUI = function() {
    const usbHw = window.usbHardware || null;
    const usbActive = Boolean(usbHw && usbHw.isConnected);
    const usbConnecting = Boolean(usbHw && usbHw.isConnecting);
    const usbErr = (usbHw && usbHw.lastError) ? usbHw.lastError : '';

    const bleActive = Boolean(window.activeBleDevice && window.activeBleDevice.gatt && window.activeBleDevice.gatt.connected);
    const bleConnecting = Boolean(window.bleIsConnecting);
    const bleState = window.bleStatusState || 'idle';
    const bleErr = window.bleLastError || '';

    const anyConnected = usbActive || bleActive;

    // 1. Top Toolbar CONNECT Pill
    const dot = document.getElementById('hw-conn-dot');
    const lbl = document.getElementById('hw-conn-label');
    if (dot) {
        dot.className = anyConnected ? 'status-online' : 'status-offline';
    }
    if (lbl) {
        if (usbActive && bleActive) lbl.textContent = 'USB+BLE';
        else if (usbActive) lbl.textContent = 'USB LIVE';
        else if (bleActive) lbl.textContent = 'BLE LIVE';
        else if (usbConnecting || bleConnecting) lbl.textContent = 'LINKING';
        else lbl.textContent = 'CONNECT';
    }

    // 2. Connect Hub Dropdown Cards
    const usbDot = document.getElementById('usb-hub-dot');
    const usbStatus = document.getElementById('usb-hub-status');
    const usbBtn = document.getElementById('btn-usb-connect');
    if (usbDot) usbDot.className = usbActive ? 'status-online' : 'status-offline';
    if (usbStatus) {
        if (usbActive) {
            const devName = usbHw.deviceName || 'ESP32 USB Serial';
            const pktInfo = usbHw.rxPacketCount > 0 ? ` · ${usbHw.rxPacketCount} pkts` : '';
            usbStatus.textContent = `${devName} · Raw Active${pktInfo}`;
            usbStatus.style.color = 'var(--green)';
        } else if (usbConnecting) {
            usbStatus.textContent = 'Opening USB port...';
            usbStatus.style.color = 'var(--cyan)';
        } else if (usbErr) {
            usbStatus.textContent = usbErr;
            usbStatus.style.color = '#ff7b72';
        } else {
            const caps = usbHw ? usbHw.getCapabilities() : { supported: false };
            usbStatus.textContent = caps.supported ? '115200 baud' : 'Unsupported';
            usbStatus.style.color = 'var(--text-muted)';
        }
    }
    if (usbBtn) {
        usbBtn.textContent = usbActive ? 'DISCONNECT USB' : (usbConnecting ? 'CONNECTING...' : 'CONNECT USB');
        usbBtn.classList.toggle('danger', usbActive);
    }

    const bleDot = document.getElementById('ble-hub-dot');
    const bleStatus = document.getElementById('ble-hub-status');
    const bleBtn = document.getElementById('btn-ble-connect');
    if (bleDot) bleDot.className = bleActive ? 'status-online' : 'status-offline';
    if (bleStatus) {
        if (bleActive) {
            bleStatus.textContent = usbActive
                ? 'USB priority'
                : `${window.activeBleDevice.name || 'Biodata-Q4'} · GATT Active`;
            bleStatus.style.color = 'var(--green)';
        } else if (bleConnecting) {
            bleStatus.textContent = bleState === 'linking' ? 'Linking...' : 'Scanning...';
            bleStatus.style.color = 'var(--cyan)';
        } else if (bleErr) {
            bleStatus.textContent = bleErr;
            bleStatus.style.color = '#ff7b72';
        } else {
            bleStatus.textContent = (navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function')
                ? 'Standby'
                : 'Unsupported';
            bleStatus.style.color = 'var(--text-muted)';
        }
    }
    if (bleBtn) {
        bleBtn.textContent = bleActive
            ? 'DISCONNECT BLE'
            : (bleConnecting ? (bleState === 'linking' ? 'LINKING...' : 'SCANNING...') : 'CONNECT BLE');
        bleBtn.classList.toggle('danger', bleActive);
    }

    // Show standalone tab launch button ONLY if an embedded preview frame actually blocked Web Serial / BLE
    const standaloneLink = document.getElementById('hw-hub-standalone-link');
    if (standaloneLink) {
        const showStandalone = !anyConnected && Boolean((usbHw && usbHw.needsStandaloneTab) || window.bleNeedsStandaloneTab);
        standaloneLink.href = window.location.href;
        standaloneLink.style.display = showStandalone ? 'inline-flex' : 'none';
    }

    if (typeof window.refreshHardwareNetUI === 'function') {
        window.refreshHardwareNetUI(false);
    }
};

// --- ESP32 WIFI & CLOUD MQTT PROVISIONING CONTROLLER (BLE GATT / USB SERIAL) ---
window.hwNetFormState = {
    en: true,
    tls: false,
    authOpen: false
};

window.syncHwBrokerPresetHighlight = function() {
    const Core = window.BioQuadCore;
    const hostInput = document.getElementById('hw-mqtt-host');
    const cleanHost = (hostInput ? hostInput.value : '').trim().toLowerCase();
    const btns = document.querySelectorAll('.hw-broker-preset-btn');
    btns.forEach((btn) => {
        const key = btn.getAttribute('data-hw-preset');
        const preset = (Core && Core.HW_BROKER_PRESETS && key) ? Core.HW_BROKER_PRESETS[key] : null;
        const isMatch = Boolean(preset && preset.host === cleanHost);
        btn.classList.toggle('is-active', isMatch);
    });
};

window.refreshHardwareNetUI = function(syncFieldsFromHw = false, explicitRead = false) {
    const usbHw = window.usbHardware || null;
    const usbActive = Boolean(usbHw && usbHw.isConnected);
    const bleActive = Boolean(window.activeBleDevice && window.activeBleDevice.gatt && window.activeBleDevice.gatt.connected);
    const anyConnected = usbActive || bleActive;
    const st = anyConnected ? (window.hwNetStatus || null) : null;

    const dotEl = document.getElementById('hw-net-dot');
    const badgeEl = document.getElementById('hw-net-status-badge');
    const ssidEl = document.getElementById('hw-wifi-ssid');
    const wpassEl = document.getElementById('hw-wifi-pass');
    const hostEl = document.getElementById('hw-mqtt-host');
    const portEl = document.getElementById('hw-mqtt-port');
    const muserEl = document.getElementById('hw-mqtt-user');
    const mpassEl = document.getElementById('hw-mqtt-pass');
    const nameEl = document.getElementById('hw-mqtt-name');
    const idEl = document.getElementById('hw-mqtt-id');
    const cloudBtn = document.getElementById('btn-hw-cloud-enable');
    const tlsBtn = document.getElementById('btn-hw-mqtt-tls');
    const envRateSelect = document.getElementById('hw-env-rate-select');
    const envSummaryEl = document.getElementById('hw-env-live-summary');

    // 1. Live WiFi & MQTT status badge
    if (dotEl && badgeEl) {
        if (!anyConnected) {
            dotEl.className = 'status-offline';
            dotEl.style.color = '';
            badgeEl.textContent = 'Connect BLE or USB';
            badgeEl.style.color = 'var(--text-muted)';
        } else if (!st) {
            dotEl.className = 'status-offline';
            dotEl.style.color = '';
            badgeEl.textContent = 'Link Active · Flash v011 for WiFi/MQTT';
            badgeEl.style.color = 'var(--text-muted)';
        } else if (!st.en) {
            dotEl.className = 'status-offline';
            dotEl.style.color = '';
            badgeEl.textContent = st.ssid ? `Cloud Off · ${st.ssid} (Radio Off)` : 'Cloud Off (WiFi Radio Off)';
            badgeEl.style.color = 'var(--text-muted)';
        } else if (st.wifi === 1) {
            dotEl.className = 'status-offline';
            dotEl.style.color = 'var(--cyan)';
            badgeEl.textContent = `WiFi Linking · ${st.ssid || '...'}`;
            badgeEl.style.color = 'var(--cyan)';
        } else if (st.wifi === 3) {
            dotEl.className = 'status-offline';
            dotEl.style.color = '#ff7b72';
            badgeEl.textContent = `WiFi Failed · ${st.ssid || 'Check 2.4GHz SSID/Pass'}`;
            badgeEl.style.color = '#ff7b72';
        } else if (st.wifi === 2 && st.mqtt === 2) {
            dotEl.className = 'status-online';
            dotEl.style.color = '';
            const rssiText = typeof st.rssi === 'number' ? ` (${st.rssi} dBm)` : '';
            badgeEl.textContent = `MQTT Live · ${st.id || 'esp32'}${rssiText}`;
            badgeEl.style.color = 'var(--green)';
        } else if (st.wifi === 2 && st.mqtt === 3) {
            dotEl.className = 'status-offline';
            dotEl.style.color = '#ff7b72';
            badgeEl.textContent = `WiFi ${st.ip || 'OK'} · Broker Err (${st.merr ?? '?'})`;
            badgeEl.style.color = '#ff7b72';
        } else if (st.wifi === 2) {
            dotEl.className = 'status-offline';
            dotEl.style.color = 'var(--cyan)';
            badgeEl.textContent = `WiFi ${st.ip || 'OK'} · MQTT Linking...`;
            badgeEl.style.color = 'var(--cyan)';
        } else {
            dotEl.className = 'status-offline';
            dotEl.style.color = '';
            badgeEl.textContent = 'WiFi Standby';
            badgeEl.style.color = 'var(--text-muted)';
        }
    }

    // 2. Password placeholders reflect NVS secret presence without exposing raw passwords
    if (wpassEl) {
        wpassEl.placeholder = (st && st.hasWpass)
            ? 'Saved in ESP32 NVS (leave blank to keep)'
            : 'WiFi Password';
    }
    if (mpassEl) {
        mpassEl.placeholder = (st && st.hasMpass)
            ? 'Saved in ESP32 NVS (leave blank to keep)'
            : 'MQTT Password (custom broker)';
    }

    // 3. Populate fields when connecting or clicking READ (never clobbering focused input)
    if (syncFieldsFromHw && st) {
        const activeEl = document.activeElement;
        if (ssidEl && activeEl !== ssidEl && (st.ssid || explicitRead)) {
            ssidEl.value = st.ssid || '';
        }
        if (hostEl && activeEl !== hostEl && st.host) {
            hostEl.value = st.host;
        }
        if (portEl && activeEl !== portEl && st.port) {
            portEl.value = String(st.port);
        }
        if (muserEl && activeEl !== muserEl) {
            muserEl.value = st.muser || '';
        }
        if (idEl && activeEl !== idEl && st.id) {
            idEl.value = st.id;
        }
        if (nameEl && activeEl !== nameEl && st.name) {
            nameEl.value = st.name;
        }

        // On factory-fresh boards (en===0 && !ssid), keep UI toggle at AUTO ON ready to save
        // unless user explicitly clicked READ
        if (st.en || st.ssid || explicitRead) {
            window.hwNetFormState.en = Boolean(st.en);
        }
        window.hwNetFormState.tls = Boolean(st.tls);

        if (st.envMs !== undefined && window.BioQuadCore && typeof window.BioQuadCore.normalizeEnvRateMs === 'function') {
            window.envSensorRateMs = window.BioQuadCore.normalizeEnvRateMs(st.envMs);
            try { localStorage.setItem('bioquad_env_rate_ms', String(window.envSensorRateMs)); } catch (e) {}
        }

        if (st.muser || st.hasMpass) {
            window.toggleHwMqttAuthRow(true);
        }
    }

    if (envRateSelect && document.activeElement !== envRateSelect) {
        const curRateStr = String(window.envSensorRateMs !== undefined ? window.envSensorRateMs : 15000);
        if (Array.from(envRateSelect.options).some(opt => opt.value === curRateStr)) {
            envRateSelect.value = curRateStr;
        }
    }

    if (envSummaryEl) {
        if (window.envSensorRateMs === 0) {
            envSummaryEl.textContent = 'Sensor Polling Off';
            envSummaryEl.style.color = '#6e7681';
        } else if (window.localHwEnvSensor && window.BioQuadCore && typeof window.BioQuadCore.formatEnvSensorTooltip === 'function') {
            envSummaryEl.textContent = window.BioQuadCore.formatEnvSensorTooltip(window.localHwEnvSensor) || 'SHT4x Active';
            envSummaryEl.style.color = 'var(--green)';
        } else if (st && st.sht === 1) {
            envSummaryEl.textContent = 'SHT4x Ready · SDA 8 / SCL 9';
            envSummaryEl.style.color = 'var(--cyan)';
        } else {
            envSummaryEl.textContent = 'SDA 8 · SCL 9';
            envSummaryEl.style.color = 'var(--text-muted)';
        }
    }

    if (cloudBtn) {
        const isOn = Boolean(window.hwNetFormState.en);
        cloudBtn.textContent = isOn ? 'AUTO ON' : 'AUTO OFF';
        cloudBtn.classList.toggle('is-on', isOn);
        cloudBtn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    }
    if (tlsBtn) {
        const isTls = Boolean(window.hwNetFormState.tls);
        tlsBtn.classList.toggle('is-tls', isTls);
        tlsBtn.setAttribute('aria-pressed', isTls ? 'true' : 'false');
    }

    window.syncHwBrokerPresetHighlight();
};

window.setHardwareEnvRate = function(rawVal) {
    const Core = window.BioQuadCore;
    const ms = (Core && typeof Core.normalizeEnvRateMs === 'function')
        ? Core.normalizeEnvRateMs(rawVal)
        : (parseInt(rawVal, 10) || 15000);

    window.envSensorRateMs = ms;
    window.lastEmittedLocalEnv = null;
    try { localStorage.setItem('bioquad_env_rate_ms', String(ms)); } catch (e) {}

    if (ms === 0) {
        window.localHwEnvSensor = null;
        if (window.chData) {
            for (let i = 0; i < 4; i++) {
                if (window.chData[i]) window.chData[i].localEnvSensor = null;
            }
        }
    }

    if (typeof window.isHardwareConnected === 'function' && window.isHardwareConnected()) {
        const cmdObj = (Core && typeof Core.buildHardwareEnvConfigCommand === 'function')
            ? Core.buildHardwareEnvConfigCommand(ms)
            : { command: `ENVCFG:${JSON.stringify({ ms })}\n` };
        if (typeof window.sendHardwareCommand === 'function') {
            window.sendHardwareCommand(cmdObj.command);
        }
        const label = (Core && typeof Core.formatEnvRateLabel === 'function') ? Core.formatEnvRateLabel(ms) : `${ms}ms`;
        if (typeof window.showHardwareNotice === 'function') {
            window.showHardwareNotice(`I2C sensor rate set to ${label} (saved to ESP32 NVS).`, 3000);
        }
    }

    if (typeof window.refreshAllSensorHUDs === 'function') window.refreshAllSensorHUDs();
    window.refreshHardwareNetUI(false);
    return ms;
};

window.toggleHwCloudEnable = function() {
    window.hwNetFormState.en = !window.hwNetFormState.en;
    window.refreshHardwareNetUI(false);
};

window.toggleHwMqttTls = function() {
    window.hwNetFormState.tls = !window.hwNetFormState.tls;
    const portEl = document.getElementById('hw-mqtt-port');
    if (portEl) {
        const curPort = parseInt(portEl.value, 10);
        if (window.hwNetFormState.tls && (isNaN(curPort) || curPort === 1883)) {
            portEl.value = '8883';
        } else if (!window.hwNetFormState.tls && curPort === 8883) {
            portEl.value = '1883';
        }
    }
    window.refreshHardwareNetUI(false);
};

window.toggleHwMqttAuthRow = function(force) {
    const row = document.getElementById('hw-mqtt-auth-row');
    const btn = document.getElementById('btn-hw-mqtt-auth-toggle');
    if (!row) return false;
    const isOpen = force !== undefined ? Boolean(force) : (row.style.display === 'none');
    window.hwNetFormState.authOpen = isOpen;
    row.style.display = isOpen ? 'grid' : 'none';
    if (btn) {
        btn.classList.toggle('is-tls', isOpen);
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
    return isOpen;
};

window.applyHwBrokerPreset = function(presetKey) {
    const Core = window.BioQuadCore;
    const preset = (Core && Core.HW_BROKER_PRESETS) ? Core.HW_BROKER_PRESETS[presetKey] : null;
    if (!preset) return;
    const hostEl = document.getElementById('hw-mqtt-host');
    const portEl = document.getElementById('hw-mqtt-port');
    if (hostEl) hostEl.value = preset.host;
    window.hwNetFormState.tls = Boolean(preset.tls);
    if (portEl) portEl.value = String(window.hwNetFormState.tls ? preset.tlsPort : preset.port);
    window.refreshHardwareNetUI(false);
};

window.requestHardwareNetStatus = function() {
    if (typeof window.isHardwareConnected === 'function' && !window.isHardwareConnected()) {
        if (typeof window.showHardwareNotice === 'function') {
            window.showHardwareNotice('Connect your ESP32 via Bluetooth LE or USB-C first.', 3600);
        }
        return false;
    }
    window._hwNetPendingSync = true;
    if (typeof window.sendHardwareCommand === 'function') {
        window.sendHardwareCommand('NETGET\n');
    }
    return true;
};

window.saveHardwareNetConfig = function() {
    if (typeof window.isHardwareConnected === 'function' && !window.isHardwareConnected()) {
        if (typeof window.showHardwareNotice === 'function') {
            window.showHardwareNotice('Connect your ESP32 via Bluetooth LE or USB-C first to save WiFi & MQTT settings.', 4200);
        }
        return false;
    }

    const Core = window.BioQuadCore;
    if (!Core || typeof Core.buildHardwareNetConfigCommand !== 'function') return false;

    const ssidEl = document.getElementById('hw-wifi-ssid');
    const wpassEl = document.getElementById('hw-wifi-pass');
    const hostEl = document.getElementById('hw-mqtt-host');
    const portEl = document.getElementById('hw-mqtt-port');
    const muserEl = document.getElementById('hw-mqtt-user');
    const mpassEl = document.getElementById('hw-mqtt-pass');
    const nameEl = document.getElementById('hw-mqtt-name');
    const idEl = document.getElementById('hw-mqtt-id');

    const ssidVal = ssidEl ? ssidEl.value.trim() : '';
    if (window.hwNetFormState.en && !ssidVal) {
        if (typeof window.showHardwareNotice === 'function') {
            window.showHardwareNotice('Enter a 2.4GHz WiFi SSID (or toggle AUTO OFF to disable hardware WiFi).', 4200);
        }
        if (ssidEl) ssidEl.focus();
        return false;
    }

    const built = Core.buildHardwareNetConfigCommand({
        en: window.hwNetFormState.en,
        ssid: ssidVal,
        wpass: wpassEl ? wpassEl.value : '',
        host: hostEl ? hostEl.value : 'test.mosquitto.org',
        port: portEl ? portEl.value : 1883,
        tls: window.hwNetFormState.tls,
        muser: muserEl ? muserEl.value : '',
        mpass: mpassEl ? mpassEl.value : '',
        id: idEl ? idEl.value : 'esp32-bioquad-01',
        name: nameEl ? nameEl.value : 'ESP32 BioQuad',
        envMs: window.envSensorRateMs
    }, window.hwNetStatus || null);

    // Reflect normalized host/port/tls/id back into inputs
    if (hostEl) hostEl.value = built.payload.host;
    if (portEl) portEl.value = String(built.payload.port);
    if (idEl) idEl.value = built.payload.id;
    window.hwNetFormState.tls = Boolean(built.payload.tls);

    // Clear plaintext password inputs once dispatched (ESP32 NVS stores & reports hasWpass/hasMpass)
    if (wpassEl && wpassEl.value) wpassEl.value = '';
    if (mpassEl && mpassEl.value) mpassEl.value = '';

    if (typeof window.sendHardwareCommand === 'function') {
        window.sendHardwareCommand(built.command);
    }
    window.refreshHardwareNetUI(false);

    if (typeof window.showHardwareNotice === 'function') {
        window.showHardwareNotice(
            built.payload.en
                ? `Sending WiFi & MQTT (${built.payload.host}:${built.payload.port}) to ESP32 NVS...`
                : 'Disabling ESP32 WiFi radio in NVS...',
            3600
        );
    }
    return true;
};

window.openHwFeedInStream = function() {
    const Core = window.BioQuadCore;
    const hostEl = document.getElementById('hw-mqtt-host');
    const muserEl = document.getElementById('hw-mqtt-user');
    const mpassEl = document.getElementById('hw-mqtt-pass');
    const idEl = document.getElementById('hw-mqtt-id');

    const rawHost = hostEl ? hostEl.value : 'test.mosquitto.org';
    const curWss = (window.bioquadFeeds && window.bioquadFeeds.brokerUrl) ? window.bioquadFeeds.brokerUrl : '';
    const targetWss = (Core && typeof Core.resolveWssUrlForHardwareHost === 'function')
        ? Core.resolveWssUrlForHardwareHost(rawHost, window.hwNetFormState.tls, curWss)
        : 'wss://test.mosquitto.org:8081/mqtt';

    if (window.bioquadFeeds) {
        const hwUser = muserEl ? muserEl.value.trim() : '';
        const hwPass = mpassEl ? mpassEl.value : '';
        if (hwUser) {
            const streamUserEl = document.getElementById('mqtt-broker-user-input');
            const streamPassEl = document.getElementById('mqtt-broker-pass-input');
            if (streamUserEl) streamUserEl.value = hwUser;
            if (streamPassEl && hwPass) streamPassEl.value = hwPass;
            window.bioquadFeeds.setBrokerCredentials(hwUser, hwPass || window.bioquadFeeds.brokerPass || '');
            if (typeof window.toggleMqttAuthRow === 'function') window.toggleMqttAuthRow(true);
        }
        const brokerInput = document.getElementById('mqtt-broker-url-input');
        if (brokerInput) brokerInput.value = targetWss;
        window.bioquadFeeds.switchBroker(targetWss);
    }

    const searchEl = document.getElementById('stream-dir-search');
    const targetId = idEl ? idEl.value.trim() : '';
    if (searchEl && targetId && searchEl.value) {
        // Clear stale search filter if it wouldn't match this hardware feed
        if (!targetId.toLowerCase().includes(searchEl.value.trim().toLowerCase())) {
            searchEl.value = '';
            if (window.streamDirectoryFilter) window.streamDirectoryFilter.query = '';
        }
    }

    if (typeof window.openFeedsModal === 'function') {
        window.openFeedsModal();
    }
};

const paramTooltip = document.createElement('div');
paramTooltip.id = 'param-tooltip';
paramTooltip.style.cssText = 'position: fixed; pointer-events: none; opacity: 0; transition: opacity 0.2s ease; background: rgba(10, 13, 18, 0.95); border: 1px solid var(--border); padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 14px; z-index: 9999; transform: translate(-50%, -150%); font-family: monospace; box-shadow: 0 4px 10px rgba(0,0,0,0.8);';
document.body.appendChild(paramTooltip);

let tooltipTimer;

const paramFormats = {
    'cutoff': v => Math.round(v) + ' Hz',
    'drvTone': v => Math.round(v) + ' Hz',
    'damp': v => Math.round(v) + ' Hz',
    'hpf': v => Math.round(v) + ' Hz',
    'rate': v => v < 10 ? v.toFixed(2) + ' Hz' : Math.round(v) + ' Hz',
    'atk': v => v.toFixed(2) + 's',
    'dec': v => v.toFixed(2) + 's',
    'rel': v => v.toFixed(2) + 's',
    'glide': v => v.toFixed(2) + 's',
    'time': v => v.toFixed(2) + 's',
    'depth': v => Math.round(v * 100) + '%',
    'sus': v => Math.round(v * 100) + '%',
    'spread': v => Math.round(v) + '%',
    'density': v => Math.round(v) + '%',
    'drv': v => Math.round(v * 100) + '%',
    'drvGrit': v => Math.round(v) + '%',
    'drvLvl': v => Math.round(v * 100) + '%',
    'feedback': v => Math.round(v * 100) + '%',
    'toRev': v => Math.round(v * 100) + '%',
    'level': v => Math.round(v * 100) + '%',
    'mixVol': v => Math.round(v * 100) + '%',
    'res': v => v.toFixed(1),
    'durMult': v => {
        let maxMs = v <= 1.0 
            ? 500 + ((v - 0.1) / 0.9) * 5150 
            : 5650 + ((v - 1.0) / 4.0) * 24350;
        return `MAX: ${(maxMs / 1000).toFixed(1)}s`;
    },
    'size': v => v.toFixed(1) + 'x',
    'voices': v => Math.round(v),
    'quantize': v => { const q = ['FR', '/64', '/32', '/16', '/8', '/4', '/4T', '/2', '1B']; return `QUANT: ${q[Math.round(v)]}`; },
    'noteMin': v => { let m = Math.round(v); return `MIN: ${['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][m%12]}${Math.floor(m/12)-2}`; },
    'noteMax': v => { let m = Math.round(v); return `MAX: ${['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][m%12]}${Math.floor(m/12)-2}`; },
    'velMin': v => `MIN: ${Math.round(v)}`,
    'velMax': v => `MAX: ${Math.round(v)}`,
    'threshold': v => v.toFixed(2) + 'x',
    'threshMax': v => 'MAX: ' + v.toFixed(2) + 'x',
    'default': v => v.toFixed(2)
};

function getParamColor(param, group, el) {
    if (el.classList.contains('slider-master')) return 'var(--cyan)';
    if (el.id === 'fx-vol-slider' || el.classList.contains('slider-fx')) return 'var(--orange)';
    if (el.id.startsWith('ch-vol-')) {
        const ch = parseInt(el.id.replace('ch-vol-', ''));
        return window.CH_COLORS[ch];
    }
    if (group === 'filter') return 'var(--green)';
    if (group === 'lfo' || group === 'env') return 'var(--mod-color)';
    if (group === 'fx' || (group && group.startsWith('globalFx'))) return 'var(--fx-color)';
    return 'var(--cyan)';
}

function showTooltip(x, y, val, param, group, el) {
    clearTimeout(tooltipTimer);
    const formatter = paramFormats[param] || paramFormats.default;
    paramTooltip.innerText = formatter(val);
    paramTooltip.style.color = getParamColor(param, group, el);
    paramTooltip.style.left = x + 'px';
    paramTooltip.style.top = y + 'px';
    paramTooltip.style.opacity = 1;
}

function hideTooltip() {
    tooltipTimer = setTimeout(() => { paramTooltip.style.opacity = 0; }, 800);
}

document.addEventListener('input', (e) => {
    if (e.target.id && (e.target.id.toLowerCase().includes('thresh') || e.target.id.toLowerCase().includes('window'))) {
        let ch = activeSynthIndex;
        let match = e.target.id.match(/\d+/);
        if (match) ch = parseInt(match[0]);
        
        if (synthChannels[ch]) {
            if (e.target.id.toLowerCase().includes('thresh')) {
                synthChannels[ch].params.threshold = parseFloat(e.target.value);
                let vEl = document.getElementById(`ch-val-thresh-${ch}`);
                if (vEl) vEl.innerText = parseFloat(e.target.value).toFixed(2) + 'x';
            } else {
                synthChannels[ch].params.sampleSize = parseInt(e.target.value);
                let wEl = document.getElementById(`ch-val-window-${ch}`);
                if (wEl) wEl.innerText = e.target.value;
            }
            window.debouncedHardwareSync(ch);
        }
    }

    if (e.target.classList.contains('v-slider') || e.target.classList.contains('dual-slider-input')) {

        let slider = e.target;
        let val = parseFloat(slider.value);
        
        let param = 'default';
        let group = '';
        
        if (slider.id.startsWith('ui-env-')) {
            param = slider.id.replace('ui-env-', ''); group = 'env';
        } else if (slider.id === 'ui-fx-drv-lvl') {
            param = 'drvLvl'; group = 'fx';
        } else if (slider.id === 'ui-fx-torev') {
            param = 'toRev'; group = 'fx';
        } else if (slider.id === 'ui-fx-rev-hpf') {
            param = 'hpf'; group = 'fx';
        } else if (slider.id.includes('vol')) {
            param = 'mixVol';
        } else if (slider.id === 'ui-note-min') param = 'noteMin';
        else if (slider.id === 'ui-note-max') param = 'noteMax';
        else if (slider.id === 'ui-vel-min') param = 'velMin';
        else if (slider.id === 'ui-vel-max') param = 'velMax';
        
        let rect = slider.getBoundingClientRect();
        let x, y;
        
        if (slider.classList.contains('v-slider')) {
            x = rect.left + (rect.width / 2);
            y = rect.top - 15; 
        } else {
            let min = parseFloat(slider.min) || 0;
            let max = parseFloat(slider.max) || 127;
            let pct = (val - min) / (max - min);
            x = rect.left + (rect.width * pct);
            y = rect.top - 15;
        }
        
        showTooltip(x, y, val, param, group, slider);
    }
});

document.addEventListener('pointerup', (e) => {
    if (e.target.classList.contains('v-slider') || e.target.classList.contains('dual-slider-input')) {
        hideTooltip();
    }
});

function hydrateLoadedChannelParams(rawParams) {
    const base = window.defaultParams ? JSON.parse(JSON.stringify(window.defaultParams)) : {};
    const src = (rawParams && typeof rawParams === 'object') ? JSON.parse(JSON.stringify(rawParams)) : {};
    const merged = Object.assign(base, src);
    ['sources', 'filter', 'lfo', 'pitchLfo', 'filterLfo', 'ampLfo', 'env', 'pitchEnv', 'filterEnv', 'ampEnv', 'fx'].forEach(k => {
        if (base[k] && typeof base[k] === 'object') {
            merged[k] = Object.assign({}, base[k], (src[k] && typeof src[k] === 'object') ? src[k] : {});
            if (k === 'sources') {
                merged.sources.osc1 = Object.assign({}, base.sources.osc1, src.sources && src.sources.osc1 ? src.sources.osc1 : {});
                merged.sources.noise = Object.assign({}, base.sources.noise, src.sources && src.sources.noise ? src.sources.noise : {});
            }
        }
    });
    if (src.activeScaleBits === undefined) {
        delete merged.activeScaleBits;
    }
    if (typeof window.normalizeScaleParams === 'function') {
        window.normalizeScaleParams(merged);
    }
    return merged;
}
window.hydrateLoadedChannelParams = hydrateLoadedChannelParams;

window.applyRemotePatchToChannel = function(chIdx, remotePatch) {
    if (chIdx < 0 || chIdx > 3 || !remotePatch) return false;
    if (typeof window.ensureSynths === 'function') window.ensureSynths();
    if (!synthChannels || !synthChannels[chIdx]) return false;

    window.isApplyingRemotePatch = true;
    try {
        const currentParams = synthChannels[chIdx].params || {};
        const merged = (window.BioQuadCore && typeof window.BioQuadCore.mergeRemotePatchIntoLocal === 'function')
            ? window.BioQuadCore.mergeRemotePatchIntoLocal(currentParams, remotePatch, window.defaultParams)
            : hydrateLoadedChannelParams(Object.assign({}, currentParams, remotePatch.params || remotePatch));

        if (typeof window.normalizeScaleParams === 'function') {
            window.normalizeScaleParams(merged);
        }

        synthChannels[chIdx].params = merged;
        synthChannels[chIdx].patchName = String(remotePatch.patchName || synthChannels[chIdx].patchName || 'INIT');
        synthChannels[chIdx].isDirty = false;
        synthChannels[chIdx].applyParams();

        const maxScale = synthChannels[chIdx].params.threshMax || 5.0;
        const miniT = document.getElementById(`ch-mini-thresh-${chIdx}`);
        const miniV = document.getElementById(`ch-val-thresh-${chIdx}`);
        const maxBtn = document.getElementById(`ch-max-btn-${chIdx}`);
        if (miniT) {
            miniT.max = maxScale.toString();
            miniT.value = synthChannels[chIdx].params.threshold;
        }
        if (miniV) miniV.innerText = parseFloat(synthChannels[chIdx].params.threshold).toFixed(2) + 'x';
        if (maxBtn) maxBtn.innerText = `${maxScale.toFixed(2)}x`;

        const miniW = document.getElementById(`ch-window-${chIdx}`);
        const miniWV = document.getElementById(`ch-val-window-${chIdx}`);
        if (miniW) miniW.value = synthChannels[chIdx].params.sampleSize;
        if (miniWV) miniWV.innerText = synthChannels[chIdx].params.sampleSize;

        if (activeSynthIndex === chIdx) {
            if (typeof updateChannelPresetDropdowns === 'function') updateChannelPresetDropdowns();
            if (typeof syncUI === 'function') syncUI();
        }
        return true;
    } finally {
        window.isApplyingRemotePatch = false;
    }
};

function togglePianoKey(noteIdx) {
    if(!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    const decoded = typeof window.decodeScaleBits === 'function' ? window.decodeScaleBits(p.activeScaleBits) : null;
    p.activeScaleBits = decoded || new Array(12).fill(true);
    p.activeScaleBits[noteIdx] = !p.activeScaleBits[noteIdx];

    if (typeof window.detectScaleFromBits === 'function') {
        const detected = window.detectScaleFromBits(p.activeScaleBits, p.scaleRoot);
        p.scaleType = detected.scaleType;
        p.scaleRoot = detected.scaleRoot;
    } else {
        p.scaleType = 'custom';
    }

    const scaleRootEl = document.getElementById('ui-scaleRoot');
    if (scaleRootEl) scaleRootEl.value = String(p.scaleRoot);
    const scaleTypeEl = document.getElementById('ui-scaleType');
    if (scaleTypeEl) scaleTypeEl.value = p.scaleType || 'custom';

    synthChannels[activeSynthIndex].applyParams();
    window.markChannelDirty(activeSynthIndex);
    window.recordPerfParam(activeSynthIndex + 1, 'scaleRoot', p.scaleRoot, true);
    window.recordPerfParam(activeSynthIndex + 1, 'scaleType', p.scaleType, true);
    window.recordPerfParam(activeSynthIndex + 1, 'activeScaleBits', p.activeScaleBits, true);
    syncPianoUI();
    window.debouncedHardwareSync(activeSynthIndex);
}

function applyScalePreset() {
    if(!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    p.scaleRoot = ((parseInt(p.scaleRoot, 10) || 0) % 12 + 12) % 12;
    if (p.scaleType === 'custom') return;
    if (typeof window.buildScaleBitsFromPreset === 'function') {
        p.activeScaleBits = window.buildScaleBitsFromPreset(p.scaleType, p.scaleRoot);
    } else {
        if (!Array.isArray(p.activeScaleBits) || p.activeScaleBits.length !== 12) {
            p.activeScaleBits = new Array(12).fill(true);
        }
        const degrees = (window.SCALES && window.SCALES[p.scaleType]) ? window.SCALES[p.scaleType] : (window.SCALES ? window.SCALES.chromatic : []);
        p.activeScaleBits.fill(false);
        degrees.forEach(deg => {
            p.activeScaleBits[(p.scaleRoot + deg) % 12] = true;
        });
    }
    syncPianoUI();
}

function syncPianoUI() {
    if(!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    const decoded = typeof window.decodeScaleBits === 'function' ? window.decodeScaleBits(p.activeScaleBits) : null;
    if (decoded) p.activeScaleBits = decoded;
    else if (!Array.isArray(p.activeScaleBits) || p.activeScaleBits.length !== 12) p.activeScaleBits = new Array(12).fill(true);
    const bits = p.activeScaleBits;
    for(let i = 0; i < 12; i++) { 
        let k = document.getElementById(`pkey-${i}`); 
        if(k) k.classList.toggle('active', Boolean(bits[i])); 
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.body.addEventListener('pointerdown', () => {
        if (typeof window.audioCtx !== 'undefined' && window.audioCtx.state === 'suspended') {
            window.audioCtx.resume().catch(()=>{});
        }
    }, { once: true });
    
    const makeSlidersDraggable = () => {
        document.querySelectorAll('input[type="range"]').forEach(slider => {
            if (slider.classList.contains('v-slider') || slider.classList.contains('dual-slider-input')) return; 
            
            let isDragging = false, startY = 0, startX = 0, startVal = 0;
            
            slider.addEventListener('mousedown', (e) => {
                isDragging = true; 
                let min = parseFloat(slider.min) || 0;
                let max = parseFloat(slider.max) || 100;
                let step = parseFloat(slider.step) || 1;
                
                let rect = slider.getBoundingClientRect();
                let clickPct = (e.clientX - rect.left) / rect.width;
                let clickedVal = min + clickPct * (max - min);
                let steppedVal = Math.round(clickedVal / step) * step;
                
                slider.value = steppedVal;
                slider.dispatchEvent(new Event('input'));
                
                startY = e.clientY; 
                startX = e.clientX;
                startVal = parseFloat(slider.value);
                e.preventDefault(); 
            });

            window.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                let min = parseFloat(slider.min) || 0;
                let max = parseFloat(slider.max) || 100;
                let step = parseFloat(slider.step) || 1;
                
                let deltaX = e.clientX - startX;
                let deltaY = startY - e.clientY; 
                let width = slider.clientWidth || 100;
                
                let coarseChange = (deltaX / width) * (max - min);
                let fineChange = (deltaY / 1000) * (max - min);
                
                let newVal = startVal + coarseChange + fineChange;
                newVal = Math.max(min, Math.min(max, newVal));
                let steppedVal = Math.round(newVal / step) * step;
                
                if (Math.abs(parseFloat(slider.value) - steppedVal) >= step/2) {
                    slider.value = steppedVal;
                    slider.dispatchEvent(new Event('input')); 
                    
                    let param = slider.id.replace('ui-env-', '').replace('ui-fx-', '');
                    if (slider.id.includes('vol')) param = 'mixVol';
                    if (slider.id.includes('density')) param = 'density';
                    if (slider.id === 'ui-quantize') param = 'quantize';
                    if (slider.id.includes('thresh')) param = 'threshold';
                    
                    let group = '';
                    if (slider.id.includes('env')) group = 'env';
                    if (slider.id.includes('fx')) group = 'fx';
                    
                    showTooltip(e.clientX, e.clientY - 20, steppedVal, param, group, slider);
                }
            });

            window.addEventListener('mouseup', () => { 
                isDragging = false;
                hideTooltip();
            });
        });
    };

    let bpmDisplay = document.getElementById('ui-bpm-display');
    if (bpmDisplay) {
        let isDraggingBpm = false, startX = 0, startY = 0, startBpm = 120, dragPointerType = 'mouse';
        bpmDisplay.addEventListener('pointerdown', (e) => {
            if (window.midiClockMode === 'in') return;
            isDraggingBpm = true;
            dragPointerType = e.pointerType || 'mouse';
            startX = e.clientX;
            startY = e.clientY;
            startBpm = window.masterBPM;
            if (dragPointerType !== 'touch') {
                e.preventDefault();
            }
        });
        window.addEventListener('pointermove', (e) => {
            if (!isDraggingBpm) return;
            let delta = 0;
            if (dragPointerType === 'touch') {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
                    isDraggingBpm = false;
                    return;
                }
                if (Math.abs(dx) < 4) return;
                delta = dx;
            } else {
                delta = startY - e.clientY;
            }
            let newBpm = startBpm + (delta * 0.5);
            newBpm = Math.max(60, Math.min(240, newBpm));
            if (window.bioClock && typeof window.bioClock.reanchorForBpmChange === 'function') {
                window.bioClock.reanchorForBpmChange(newBpm);
            }
            window.masterBPM = newBpm;
            window.recordPerfParam(0, 'master.bpm', newBpm, false);
            syncUI();
            if (typeof window.isHardwareConnected === 'function' && window.isHardwareConnected() && typeof window.sendHardwareCC === 'function') {
                window.sendHardwareCC(0, 92, Math.min(127, Math.max(0, ((window.masterBPM - 60) / 180) * 127)));
            }
        });
        window.addEventListener('pointerup', () => { isDraggingBpm = false; });
        window.addEventListener('pointercancel', () => { isDraggingBpm = false; });
    }

    const attachSlider = (id, paramKey, labelId, formatFn) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            let val = parseFloat(e.target.value);
            if (synthChannels[activeSynthIndex]) {
                synthChannels[activeSynthIndex].params[paramKey] = val;
                if (labelId && formatFn) {
                    let lbl = document.getElementById(labelId);
                    if (lbl) lbl.innerText = formatFn(val);
                }
                window.recordPerfParam(activeSynthIndex + 1, paramKey, val, false);
                window.debouncedHardwareSync(activeSynthIndex);
            }
        });
    };

    attachSlider('ui-slider-density', 'density', 'ui-density-display', v => v + '%');

    const nMin = document.getElementById('ui-note-min'), nMax = document.getElementById('ui-note-max');
    const nFill = document.getElementById('note-fill'), nText = document.getElementById('note-range-text');
    const midiToNote = (m) => ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][m%12] + (Math.floor(m/12)-2);
    
    const updateNote = () => {
        if(!synthChannels[activeSynthIndex]) return;
        let min = parseInt(nMin.value), max = parseInt(nMax.value);
        if (min > max) { let t = min; min = max; max = t; }
        if(nFill) { nFill.style.left = (min / 127 * 100) + '%'; nFill.style.width = ((max - min) / 127 * 100) + '%'; }
        if(nText) nText.innerText = `${midiToNote(min)} (${min}) ↔ ${midiToNote(max)} (${max})`;
        synthChannels[activeSynthIndex].params.minNote = min;
        synthChannels[activeSynthIndex].params.maxNote = max;
        window.recordPerfParam(activeSynthIndex + 1, 'minNote', min, false);
        window.recordPerfParam(activeSynthIndex + 1, 'maxNote', max, false);
        window.debouncedHardwareSync(activeSynthIndex);
    };
    if(nMin) nMin.addEventListener('input', updateNote);
    if(nMax) nMax.addEventListener('input', updateNote);

    const vMin = document.getElementById('ui-vel-min'), vMax = document.getElementById('ui-vel-max');
    const vFill = document.getElementById('vel-fill');
    const vText = document.getElementById('ui-vel-text');
    
    const updateVel = () => {
        if(!synthChannels[activeSynthIndex]) return;
        let min = parseInt(vMin.value), max = parseInt(vMax.value);
        if (min > max) { let t = min; min = max; max = t; }
        if(vFill) { vFill.style.left = (min / 127 * 100) + '%'; vFill.style.width = ((max - min) / 127 * 100) + '%'; }
        if(vText) vText.innerText = `${min} ↔ ${max}`;
        synthChannels[activeSynthIndex].params.velMin = min;
        synthChannels[activeSynthIndex].params.velMax = max;
        window.recordPerfParam(activeSynthIndex + 1, 'velMin', min, false);
        window.recordPerfParam(activeSynthIndex + 1, 'velMax', max, false);
        window.debouncedHardwareSync(activeSynthIndex);
    };
    if(vMin) vMin.addEventListener('input', updateVel);
    if(vMax) vMax.addEventListener('input', updateVel);

    const syncQuantizeTicksUI = (val) => {
        const ticksWrap = document.getElementById('ui-quantize-ticks');
        const spans = ticksWrap
            ? ticksWrap.querySelectorAll('span')
            : (qSlider && qSlider.nextElementSibling ? qSlider.nextElementSibling.querySelectorAll('span') : []);
        spans.forEach(s => { s.style.color = '#7d8590'; s.style.fontWeight = 'normal'; });
        if (spans[val]) { spans[val].style.color = 'var(--cyan)'; spans[val].style.fontWeight = 'bold'; }
    };

    const qSlider = document.getElementById('ui-quantize');
    if (qSlider) {
        qSlider.addEventListener('input', (e) => {
            if (!synthChannels[activeSynthIndex]) return;
            let val = parseInt(e.target.value, 10);
            synthChannels[activeSynthIndex].params.quantize = val;
            syncQuantizeTicksUI(val);
            window.recordPerfParam(activeSynthIndex + 1, 'quantize', val, false);
            window.debouncedHardwareSync(activeSynthIndex);
        });
    }

    window.setQuantizeStep = function(stepIdx) {
        const qs = document.getElementById('ui-quantize');
        if (!qs) return;
        const clamped = Math.max(0, Math.min(8, parseInt(stepIdx, 10) || 0));
        qs.value = String(clamped);
        qs.dispatchEvent(new Event('input', { bubbles: true }));
    };

    setTimeout(makeSlidersDraggable, 500); 
    setTimeout(() => { selectTab(0); }, 100);
});

function buildMixerAndMidiUI() {
    for (let i = 0; i < 4; i++) {
        const select = document.getElementById(`ui-midi-ch-${i}`);
        if (select) {
            select.innerHTML = '';
            for (let ch = 0; ch < 16; ch++) {
                let opt = document.createElement('option');
                opt.value = ch; opt.text = String(ch + 1);
                if (ch === i) opt.selected = true;
                select.appendChild(opt);
            }
        }
    }

    const mixerContent = document.getElementById('mixer-dropdown-content');
    if (!mixerContent) return;

    let html = '';
    for (let i = 0; i < 4; i++) {
        const chColor = window.CH_COLORS ? window.CH_COLORS[i] : '#00f0ff';
        html += `
        <div class="strip" data-strip="ch-${i}">
            <div class="strip-label" style="color: ${chColor};">CH ${i + 1}</div>
            <div class="strip-controls">
                <div class="v-slider-container"><input type="range" id="ch-vol-${i}" aria-label="Channel ${i + 1} Level" class="v-slider slider-ch-${i}" min="0" max="1" step="0.01" value="0.5" oninput="window.setChannelMixVolume(${i}, this.value)"></div>
                <canvas class="vu ch-vu" id="vu-${i}" width="12" height="104"></canvas>
            </div>
            <div id="ch-vol-val-${i}" class="strip-readout tabular-nums">50%</div>
            <button type="button" id="mute-btn-${i}" class="strip-mute-btn" onclick="window.toggleChannelMixMute(${i})">M</button>
        </div>`;
    }

    html += `
        <div class="strip fx-strip" data-strip="fx">
            <div class="strip-label" style="color: var(--orange);">FX</div>
            <div class="strip-controls">
                <div class="v-slider-container"><input type="range" id="fx-vol-slider" aria-label="FX Bus Level" class="v-slider slider-fx" min="0" max="1.25" step="0.01" value="0.85" oninput="window.setFxBusLevel(this.value)"></div>
                <canvas class="vu fx-vu" id="vu-fx" width="12" height="104"></canvas>
            </div>
            <div id="fx-vol-val" class="strip-readout tabular-nums">85%</div>
            <button type="button" id="fx-mute-btn" class="strip-mute-btn" onclick="window.toggleFxBusMute()">M</button>
        </div>
        <div class="strip master" data-strip="main">
            <div class="strip-label" style="color: var(--cyan);">MAIN</div>
            <div class="strip-controls">
                <div class="v-slider-container"><input type="range" id="master-vol-slider" aria-label="Main Mix Level" class="v-slider slider-master" min="0" max="1" step="0.01" value="0.75" oninput="window.setMasterVolume(this.value)"></div>
                <canvas class="vu main-vu" id="master-vu-vt" width="12" height="104"></canvas>
            </div>
            <div id="master-vol-val" class="strip-readout tabular-nums">75%</div>
            <button type="button" id="mixer-master-mute-btn" class="strip-mute-btn" onclick="toggleMasterMute()">M</button>
        </div>`;
    mixerContent.innerHTML = html;
    window.syncMixerControlsUI();
}

window.setChannelMixVolume = function(chIdx, val) {
    if (!synthChannels || !synthChannels[chIdx]) return;
    synthChannels[chIdx].setVolume(val);
    const lbl = document.getElementById(`ch-vol-val-${chIdx}`);
    if (lbl) lbl.textContent = `${Math.round(parseFloat(val) * 100)}%`;
};

window.toggleChannelMixMute = function(chIdx) {
    if (!synthChannels || !synthChannels[chIdx]) return;
    synthChannels[chIdx].toggleMute();
    window.syncMixerControlsUI();
};

window.setFxBusLevel = function(val) {
    const parsed = Math.max(0, Math.min(1.25, parseFloat(val)));
    if (isNaN(parsed)) return;
    if (!window.globalFX) window.globalFX = { level: 0.85, muted: false, dly: { time: 0.4, feedback: 0.45, toRev: 0.35 }, rev: { size: 3.5, damp: 3500, hpf: 120 } };
    window.globalFX.level = parsed;
    if (window.masterFX && typeof window.masterFX.setLevel === 'function') {
        window.masterFX.setLevel(parsed);
    } else if (window.masterFX) {
        window.masterFX.updateParams(window.globalFX);
    }
    const lbl = document.getElementById('fx-vol-val');
    if (lbl) lbl.textContent = `${Math.round(parsed * 100)}%`;
    window.recordPerfParam(0, 'globalFX.level', parsed, false);
};

window.toggleFxBusMute = function() {
    if (!window.globalFX) return;
    if (window.masterFX && typeof window.masterFX.toggleMute === 'function') {
        window.masterFX.toggleMute();
    } else {
        window.globalFX.muted = !window.globalFX.muted;
        if (window.masterFX) window.masterFX.updateParams(window.globalFX);
    }
    window.recordPerfParam(0, 'globalFX.muted', Boolean(window.globalFX.muted), true);
    window.syncMixerControlsUI();
};

window.setMasterVolume = function(val) {
    const parsed = Math.max(0, Math.min(1.0, parseFloat(val)));
    if (isNaN(parsed)) return;
    window.masterVolumeLevel = parsed;
    if (!window.isMasterMuted && window.masterGain && window.audioCtx) {
        window.masterGain.gain.setTargetAtTime(parsed, window.audioCtx.currentTime, 0.015);
    }
    const lbl = document.getElementById('master-vol-val');
    if (lbl) lbl.textContent = `${Math.round(parsed * 100)}%`;
    window.recordPerfParam(0, 'master.vol', parsed, false);
};

window.syncMixerControlsUI = function() {
    for (let i = 0; i < 4; i++) {
        if (!synthChannels || !synthChannels[i]) continue;
        const p = synthChannels[i].params;
        const volSlider = document.getElementById(`ch-vol-${i}`);
        if (volSlider) volSlider.value = p.mixVol;
        const volLbl = document.getElementById(`ch-vol-val-${i}`);
        if (volLbl) volLbl.textContent = `${Math.round((p.mixVol ?? 0.5) * 100)}%`;
        const muteBtn = document.getElementById(`mute-btn-${i}`);
        if (muteBtn) {
            muteBtn.classList.toggle('is-muted', Boolean(p.muted));
            muteBtn.style.backgroundColor = p.muted ? 'var(--red)' : 'transparent';
            muteBtn.style.color = p.muted ? '#000' : 'var(--text)';
            muteBtn.style.borderColor = p.muted ? 'var(--red)' : 'var(--border)';
        }
    }

    const fxLvl = (window.globalFX && typeof window.globalFX.level === 'number') ? window.globalFX.level : 0.85;
    const fxMuted = Boolean(window.globalFX && window.globalFX.muted);
    const fxSlider = document.getElementById('fx-vol-slider');
    if (fxSlider) fxSlider.value = fxLvl;
    const fxLbl = document.getElementById('fx-vol-val');
    if (fxLbl) fxLbl.textContent = `${Math.round(fxLvl * 100)}%`;
    const fxMuteBtn = document.getElementById('fx-mute-btn');
    if (fxMuteBtn) {
        fxMuteBtn.classList.toggle('is-muted', fxMuted);
        fxMuteBtn.style.backgroundColor = fxMuted ? 'var(--red)' : 'transparent';
        fxMuteBtn.style.color = fxMuted ? '#000' : 'var(--text)';
        fxMuteBtn.style.borderColor = fxMuted ? 'var(--red)' : 'var(--border)';
    }

    const mVol = typeof window.masterVolumeLevel === 'number' ? window.masterVolumeLevel : 0.75;
    const mMuted = Boolean(window.isMasterMuted);
    const mSlider = document.getElementById('master-vol-slider');
    if (mSlider) mSlider.value = mVol;
    const mLbl = document.getElementById('master-vol-val');
    if (mLbl) mLbl.textContent = `${Math.round(mVol * 100)}%`;

    const toolbarMuteBtn = document.getElementById('btn-master-mute');
    if (toolbarMuteBtn) {
        toolbarMuteBtn.style.backgroundColor = mMuted ? 'var(--red)' : 'transparent';
        toolbarMuteBtn.style.color = mMuted ? '#000' : 'var(--red)';
    }
    const mixerMasterMuteBtn = document.getElementById('mixer-master-mute-btn');
    if (mixerMasterMuteBtn) {
        mixerMasterMuteBtn.classList.toggle('is-muted', mMuted);
        mixerMasterMuteBtn.style.backgroundColor = mMuted ? 'var(--red)' : 'transparent';
        mixerMasterMuteBtn.style.color = mMuted ? '#000' : 'var(--text)';
        mixerMasterMuteBtn.style.borderColor = mMuted ? 'var(--red)' : 'var(--border)';
    }
};

function updateMidiChannel(synthCh, midiCh) { 
    if (synthChannels[synthCh]) {
        synthChannels[synthCh].params.midiOutCh = parseInt(midiCh); 
        window.recordPerfParam(synthCh + 1, 'midiOutCh', synthChannels[synthCh].params.midiOutCh, true);
        window.debouncedHardwareSync(synthCh);
    }
}

function toggleMasterMute() {
    window.isMasterMuted = !window.isMasterMuted;
    if (window.masterGain) window.masterGain.gain.value = window.isMasterMuted ? 0 : window.masterVolumeLevel;
    window.recordPerfParam(0, 'master.muted', window.isMasterMuted, true);
    window.syncMixerControlsUI();
}

function tapTempo() {
    if (window.midiClockMode === 'in') return;
    const now = performance.now();
    if (!window.tapTimes) window.tapTimes = [];
    if (window.tapTimes.length > 0 && (now - window.tapTimes[window.tapTimes.length - 1]) > 2200) {
        window.tapTimes = [];
    }
    if (window.tapTimes.length === 0 && window.bioClock && typeof window.bioClock.resetToBeatOne === 'function') {
        window.bioClock.resetToBeatOne(true);
    }
    window.tapTimes.push(now);
    if (window.tapTimes.length > 4) window.tapTimes.shift();
    if (window.tapTimes.length >= 2) {
        let intervals = [];
        for (let i = 1; i < window.tapTimes.length; i++) intervals.push(window.tapTimes[i] - window.tapTimes[i - 1]);
        let avg = intervals.reduce((a, b) => a + b) / intervals.length;
        let newBpm = 60000 / avg;
        if (newBpm >= 60 && newBpm <= 240) {
            if (window.bioClock && typeof window.bioClock.reanchorForBpmChange === 'function') {
                window.bioClock.reanchorForBpmChange(newBpm);
            }
            window.masterBPM = newBpm;
            window.recordPerfParam(0, 'master.bpm', newBpm, true);
            syncUI();
            if ((typeof window.isHardwareConnected === 'function' ? window.isHardwareConnected() : window.bleTxCharacteristic) && typeof window.sendHardwareCC === 'function') {
                for (let i = 0; i < 4; i++) window.sendHardwareCC(i, 92, Math.min(127, Math.max(0, ((window.masterBPM - 60) / 180) * 127)));
            }
        }
    }
}

function initPiano() {
    const p = document.getElementById('piano-keys'); 
    if (!p) return;
    p.innerHTML = '';
    
    const whiteKeys = [0, 2, 4, 5, 7, 9, 11];
    const blackKeys = [1, 3, null, 6, 8, 10]; 
    
    whiteKeys.forEach(noteIdx => { 
        let k = document.createElement('div'); 
        k.className = 'key-w active'; 
        k.id = `pkey-${noteIdx}`; 
        k.addEventListener('pointerdown', (e) => {
            e.preventDefault(); 
            togglePianoKey(noteIdx);
        });
        p.appendChild(k); 
    });
    
    blackKeys.forEach((noteIdx, i) => { 
        if (noteIdx !== null) { 
            let k = document.createElement('div'); 
            k.className = 'key-b active'; 
            k.id = `pkey-${noteIdx}`; 
            k.style.left = `${(i + 1) * 14.28}%`; 
            k.addEventListener('pointerdown', (e) => {
                e.preventDefault(); 
                togglePianoKey(noteIdx);
            });
            p.appendChild(k); 
        } 
    });
}

function selectTab(index) {
    const clamped = Math.max(0, Math.min(3, parseInt(index, 10) || 0));
    activeSynthIndex = clamped;
    window.activeSynthIndex = clamped;

    const synthInspector = document.getElementById('synth-inspector');
    if (synthInspector) {
        synthInspector.setAttribute('data-ch', String(clamped));
    }

    document.querySelectorAll('.synth-tab').forEach((t, i) => {
        t.classList.toggle('active', i === clamped);
    });

    if (typeof window.toggleChannelNewPresetRow === 'function') {
        window.toggleChannelNewPresetRow(clamped, false);
    }
    if (typeof updateChannelPresetDropdowns === 'function') {
        updateChannelPresetDropdowns();
    }
    syncUI();
    if (typeof window.updateSynthFeedAutoBar === 'function') {
        window.updateSynthFeedAutoBar();
    }
    if (typeof window.applyDashboardViewMode === 'function') {
        window.applyDashboardViewMode();
    }
}
window.selectTab = selectTab;

const channelLedTimers = {};
window.triggerChannelLED = function(index) {
    const ch = parseInt(index, 10);
    if (isNaN(ch) || ch < 0 || ch > 3) return;

    const tabLed = document.getElementById(`led-${ch}`);
    const focusLed = document.getElementById(`focus-led-${ch}`);
    const cardLed = document.getElementById(`card-led-${ch}`);
    const focusPill = document.getElementById(`focus-ch-btn-${ch}`);
    const synthTab = document.querySelector(`.synth-tab[data-ch="${ch}"]`);

    if (tabLed) tabLed.classList.add('active');
    if (focusLed) focusLed.classList.add('active');
    if (cardLed) cardLed.classList.add('active');
    if (focusPill) focusPill.classList.add('note-flash');
    if (synthTab) synthTab.classList.add('note-flash');

    clearTimeout(channelLedTimers[ch]);
    channelLedTimers[ch] = setTimeout(() => {
        if (tabLed) tabLed.classList.remove('active');
        if (focusLed) focusLed.classList.remove('active');
        if (cardLed) cardLed.classList.remove('active');
        if (focusPill) focusPill.classList.remove('note-flash');
        if (synthTab) synthTab.classList.remove('note-flash');
    }, 115);
};

function triggerLED(index) { 
    window.triggerChannelLED(index);
}

// --- ADDITIVE HARDWARE SYNC PROTOCOL ---
window.syncParamsToHardware = function(chIdx) {
    if (!synthChannels[chIdx]) return;
    const p = synthChannels[chIdx].params;
         
    if (typeof window.sendHardwareCC === 'function') {
        // ADDITIVE THRESHOLD (CC 81 Base: 1.0..5.0 + CC 80 Boost: 0..5.0, Total 1.0..10.0)
        const thresh = Math.min(10.0, Math.max(1.0, p.threshold));
        const baseVal = Math.min(5.0, thresh);
        const boostVal = Math.max(0.0, thresh - 5.0);
        
        const cc81Val = Math.min(127, Math.max(0, Math.round(((baseVal - 1.0) / 4.0) * 127)));
        const cc80Val = Math.min(127, Math.max(0, Math.round((boostVal / 5.0) * 127))); 
        
        window.sendHardwareCC(chIdx, 81, cc81Val);
        window.sendHardwareCC(chIdx, 80, cc80Val);
        
        // --- FIXED 1:1 DISCRETE TRANSMISSIONS ---
        window.sendHardwareCC(chIdx, 82, Math.round(p.sampleSize));
        window.sendHardwareCC(chIdx, 83, Math.round(p.density)); 
        
        window.sendHardwareCC(chIdx, 84, Math.round(p.minNote));
        window.sendHardwareCC(chIdx, 85, Math.round(p.maxNote));
        window.sendHardwareCC(chIdx, 86, Math.round(p.velMin));
        window.sendHardwareCC(chIdx, 87, Math.round(p.velMax));
        
        window.sendHardwareCC(chIdx, 88, Math.round(p.spread));
        window.sendHardwareCC(chIdx, 89, Math.round(p.durMult * 10)); // Scale for float recovery
        window.sendHardwareCC(chIdx, 90, Math.round(p.quantize));
        window.sendHardwareCC(chIdx, 91, Math.round(p.midiOutCh));
        window.sendHardwareCC(chIdx, 92, Math.min(127, Math.max(0, Math.round(((Math.round(window.masterBPM) - 60) / 180) * 127)))); // BPM maintains 127-step scaling
        
        window.sendHardwareCC(chIdx, 93, Math.round(p.voices));
        
        let stealVal = p.stealMode === 'oldest' ? 0 : (p.stealMode === 'lowest' ? 1 : (p.stealMode === 'highest' ? 2 : 3));
        window.sendHardwareCC(chIdx, 94, stealVal);
        window.sendHardwareCC(chIdx, 95, p.legato === 1 ? 127 : 0);
    }
    
    const mask = typeof window.encodeScaleMask === 'function' ? window.encodeScaleMask(p.activeScaleBits) : 0x0FFF;
    if (typeof window.sendHardwareScale === 'function') window.sendHardwareScale(chIdx, mask);
};

function updateActiveSynth(param, value) {
    if (param === 'bpm') {
        if (window.midiClockMode === 'in') return;
        const parsedBpm = isNaN(value) ? window.masterBPM : parseFloat(value);
        if (window.bioClock && typeof window.bioClock.reanchorForBpmChange === 'function') {
            window.bioClock.reanchorForBpmChange(parsedBpm);
        }
        window.masterBPM = parsedBpm;
        window.recordPerfParam(0, 'master.bpm', window.masterBPM, false);
        syncUI();
        if ((typeof window.isHardwareConnected === 'function' ? window.isHardwareConnected() : window.bleTxCharacteristic) && typeof window.sendHardwareCC === 'function') {
            for (let i=0; i<4; i++) window.sendHardwareCC(i, 92, Math.min(127, Math.max(0, ((window.masterBPM - 60) / 180) * 127)));
        }
        return;
    }
    
    if (!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    
    if (param === 'stealMode' || param === 'steal') {
        p.stealMode = value || 'none';
        p.steal = value || 'none';
        window.recordPerfParam(activeSynthIndex + 1, 'stealMode', p.stealMode, true);
    } else if (param === 'scaleRoot') {
        const normRoot = ((parseInt(value, 10) || 0) % 12 + 12) % 12;
        p.scaleRoot = normRoot;
        window.recordPerfParam(activeSynthIndex + 1, 'scaleRoot', normRoot, true);
    } else if (param === 'scaleType') {
        p.scaleType = String(value || 'chromatic');
        window.recordPerfParam(activeSynthIndex + 1, 'scaleType', p.scaleType, true);
    } else {
        p[param] = isNaN(value) ? value : parseFloat(value);
        window.recordPerfParam(activeSynthIndex + 1, param, p[param], param === 'legato');
    }
    
    if (param === 'scaleType' || param === 'scaleRoot') {
        if (p.scaleType !== 'custom') {
            if (typeof window.buildScaleBitsFromPreset === 'function') {
                p.activeScaleBits = window.buildScaleBitsFromPreset(p.scaleType, p.scaleRoot);
            } else {
                if (!Array.isArray(p.activeScaleBits) || p.activeScaleBits.length !== 12) {
                    p.activeScaleBits = new Array(12).fill(true);
                }
                const degrees = (window.SCALES && window.SCALES[p.scaleType]) ? window.SCALES[p.scaleType] : (window.SCALES ? window.SCALES.chromatic : []);
                p.activeScaleBits.fill(false);
                degrees.forEach(deg => {
                    p.activeScaleBits[(p.scaleRoot + deg) % 12] = true;
                });
            }
            window.recordPerfParam(activeSynthIndex + 1, 'activeScaleBits', p.activeScaleBits, true);
            if (typeof syncPianoUI === 'function') syncPianoUI();
        }
        const scaleRootEl = document.getElementById('ui-scaleRoot');
        if (scaleRootEl) scaleRootEl.value = String(p.scaleRoot);
        const scaleTypeEl = document.getElementById('ui-scaleType');
        if (scaleTypeEl) scaleTypeEl.value = p.scaleType;
    }
    
    synthChannels[activeSynthIndex].applyParams();
    window.markChannelDirty(activeSynthIndex);

    window.debouncedHardwareSync(activeSynthIndex);
}

// --- GLOBAL PRESETS ---
let globalPresets = {};

function normalizePresetEntry(presetData) {
    if (!presetData || typeof presetData !== 'object') return presetData;
    const channelData = presetData.channels || presetData;
    if (Array.isArray(channelData)) {
        for (let i = 0; i < 4; i++) {
            if (channelData[i]) channelData[i] = hydrateLoadedChannelParams(channelData[i]);
        }
    }
    if (presetData.globalFX && typeof presetData.globalFX === 'object') {
        if (typeof presetData.globalFX.level !== 'number' || isNaN(presetData.globalFX.level)) {
            presetData.globalFX.level = 0.85;
        }
        if (typeof presetData.globalFX.muted !== 'boolean') {
            presetData.globalFX.muted = false;
        }
    }
    return presetData;
}

function getActiveChannelPresetMap() {
    try {
        const raw = localStorage.getItem('biodataActiveChannelPresets');
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
        return {};
    }
}

function setActiveChannelPresetOverride(ch, name) {
    try {
        const map = getActiveChannelPresetMap();
        if (name) map[String(ch)] = name;
        else delete map[String(ch)];
        localStorage.setItem('biodataActiveChannelPresets', JSON.stringify(map));
    } catch (e) {}
}

function clearActiveChannelPresetOverrides() {
    try { localStorage.removeItem('biodataActiveChannelPresets'); } catch (e) {}
}

function loadPresetsFromStorage() {
    window.isBootstrappingPresets = true;
    try {
    let storedPresets = {};
    try {
        const stored = localStorage.getItem('biodataPresets');
        if (stored) storedPresets = JSON.parse(stored) || {};
    } catch(e) { console.error("Error loading presets", e); }

    const hasStoredAmbientOrchid = Boolean(storedPresets && Object.prototype.hasOwnProperty.call(storedPresets, 'Ambient Orchid'));
    globalPresets = { ...storedPresets };

    Object.keys(globalPresets).forEach(key => {
        globalPresets[key] = normalizePresetEntry(globalPresets[key]);
    });
    
    if (window.FACTORY_PRESETS) {
        Object.keys(window.FACTORY_PRESETS).forEach(key => {
            if (!globalPresets[key]) globalPresets[key] = normalizePresetEntry(JSON.parse(JSON.stringify(window.FACTORY_PRESETS[key])));
        });
    }
    
    updatePresetDropdown();

    let storedChannelPresets = {};
    try {
        const storedCh = localStorage.getItem('biodataChannelPresets');
        if (storedCh) storedChannelPresets = JSON.parse(storedCh) || {};
    } catch(e) {}
    
    if (typeof loadChannelPresetsFromStorage === 'function') {
        loadChannelPresetsFromStorage(); 
    }

    // If Ambient Orchid is still using its factory composite and the user saved custom scales
    // onto any of the default channel patches (Deep Sub Drone, Soft Plucks, etc.), reflect those
    // saved channel patches on initial load.
    if (!hasStoredAmbientOrchid && globalPresets["Ambient Orchid"] && Array.isArray(globalPresets["Ambient Orchid"].channels)) {
        globalPresets["Ambient Orchid"].channels = globalPresets["Ambient Orchid"].channels.map(chParams => {
            const patchName = chParams && chParams.savedPatchName;
            if (patchName && Object.prototype.hasOwnProperty.call(storedChannelPresets, patchName) && globalChannelPresets[patchName] && globalChannelPresets[patchName].params) {
                const updated = hydrateLoadedChannelParams(globalChannelPresets[patchName].params);
                updated.savedPatchName = patchName;
                return updated;
            }
            return chParams;
        });
    }

    let savedActive = null;
    try { savedActive = localStorage.getItem('biodataActivePreset'); } catch(e) {}
    const initialPreset = (savedActive && globalPresets[savedActive])
        ? savedActive
        : (globalPresets["Ambient Orchid"] ? "Ambient Orchid" : (Object.keys(globalPresets)[0] || ""));

    if (initialPreset) {
        loadPreset(initialPreset, { preserveChannelOverrides: true });
    }

    const chOverrides = getActiveChannelPresetMap();
    for (let ch = 0; ch < 4; ch++) {
        const overrideName = chOverrides[String(ch)];
        if (overrideName && globalChannelPresets[overrideName]) {
            loadChannelPreset(ch, overrideName, { skipTabSelect: true, skipPersistOverride: true });
        }
    }
    if (typeof selectTab === 'function') {
        selectTab(0);
    }
    } finally {
        window.isBootstrappingPresets = false;
    }
}

function updatePresetDropdown() {
    const select = document.getElementById('preset-select');
    if(!select) return;
    
    select.onchange = (e) => {
        loadPreset(e.target.value);
    };

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Select --</option>';
    Object.keys(globalPresets).forEach(name => {
        let opt = document.createElement('option');
        opt.value = name; opt.text = name; select.appendChild(opt);
    });
    select.value = globalPresets[currentVal] ? currentVal : "";
}

window.toggleGlobalNewPresetRow = function(forceState) {
    const row = document.getElementById('global-new-preset-row');
    const inp = document.getElementById('new-preset-name-input');
    if (!row) return;
    const isCurrentlyOpen = row.style.display !== 'none';
    const next = forceState !== undefined ? Boolean(forceState) : !isCurrentlyOpen;
    row.style.display = next ? 'flex' : 'none';
    if (next) {
        if (inp) setTimeout(() => inp.focus(), 20);
        const widget = row.closest('.dropdown-widget');
        if (widget && typeof window.positionDropdownPanel === 'function') window.positionDropdownPanel(widget);
    } else if (inp) {
        inp.value = '';
    }
};

window.toggleChannelNewPresetRow = function(ch, forceState) {
    const row = document.getElementById('ui-voice-new-preset-row') || document.getElementById(`ch-new-preset-row-${ch}`);
    const inp = document.getElementById('ui-voice-new-preset-input') || document.getElementById(`ch-new-preset-input-${ch}`);
    if (!row) return;
    const isCurrentlyOpen = row.style.display !== 'none';
    const next = forceState !== undefined ? Boolean(forceState) : !isCurrentlyOpen;
    row.style.display = next ? 'flex' : 'none';
    if (next) {
        if (inp) setTimeout(() => inp.focus(), 20);
        const widget = row.closest('.dropdown-widget');
        if (widget && typeof window.positionDropdownPanel === 'function') window.positionDropdownPanel(widget);
    } else if (inp) {
        inp.value = '';
    }
};

window.collapseAllNewPresetRows = function() {
    window.toggleGlobalNewPresetRow(false);
    window.toggleChannelNewPresetRow(activeSynthIndex, false);
};

function savePreset(forceNew = false) {
    if (typeof ensureSynths === 'function') ensureSynths();
    const select = document.getElementById('preset-select');
    const nameInput = document.getElementById('new-preset-name-input');
    let name = select ? select.value : "";

    if (forceNew || !name || name === "") {
        const typed = nameInput ? nameInput.value.trim() : "";
        if (typed) {
            name = typed;
            window.toggleGlobalNewPresetRow(false);
        } else {
            window.toggleGlobalNewPresetRow(true);
            window.showHardwareNotice("Enter a name for the new preset, then press Enter or SAVE.");
            return;
        }
    } else {
        window.toggleGlobalNewPresetRow(false);
    }

    const presetData = {
        channels: synthChannels.map(ch => {
            let p = hydrateLoadedChannelParams(ch.params);
            ch.params = hydrateLoadedChannelParams(p);
            p.savedPatchName = ch.patchName || "INIT";
            return p;
        }),
        master: { vol: window.masterVolumeLevel, muted: window.isMasterMuted, bpm: window.masterBPM },
        viz: chData.map(ch => JSON.parse(JSON.stringify(ch.config))),
        globalFX: window.globalFX ? JSON.parse(JSON.stringify(window.globalFX)) : null
    };

    globalPresets[name] = presetData;
    localStorage.setItem('biodataPresets', JSON.stringify(globalPresets));
    try { localStorage.setItem('biodataActivePreset', name); } catch (e) {}
    clearActiveChannelPresetOverrides();
    updatePresetDropdown();
    if (select) select.value = name;
    window.showHardwareNotice(`Saved global preset "${name}".`, 2200);
}

function deleteCurrentPreset() {
    const select = document.getElementById('preset-select');
    let name = select ? select.value : "";
    if (!name || name === "") {
        window.showHardwareNotice("Select a preset first to delete.");
        return;
    }
    delete globalPresets[name];
    localStorage.setItem('biodataPresets', JSON.stringify(globalPresets));
    try {
        if (localStorage.getItem('biodataActivePreset') === name) {
            localStorage.removeItem('biodataActivePreset');
        }
    } catch(e) {}
    updatePresetDropdown();
    if(select) select.value = "";
    window.showHardwareNotice(`Deleted preset "${name}".`, 2200);
}

function loadPreset(name, options = {}) {
    if (!name || !globalPresets[name]) return;
    if(typeof ensureSynths === 'function') ensureSynths();
    try { localStorage.setItem('biodataActivePreset', name); } catch(e) {}
    if (!options || !options.preserveChannelOverrides) {
        clearActiveChannelPresetOverrides();
    }
    const sel = document.getElementById('preset-select');
    if (sel) sel.value = name;
    const presetData = globalPresets[name];
    const channelData = presetData.channels || presetData; 
    
    for (let i = 0; i < 4; i++) {
        if (channelData[i] && synthChannels[i]) {
            synthChannels[i].params = hydrateLoadedChannelParams(channelData[i]);
            synthChannels[i].applyParams();
            synthChannels[i].patchName = synthChannels[i].params.savedPatchName || "INIT";
            
            if (synthChannels[i].channelOut && window.audioCtx) {
                const targetG = synthChannels[i].params.muted ? 0 : synthChannels[i].params.mixVol;
                synthChannels[i].channelOut.gain.setTargetAtTime(targetG, window.audioCtx.currentTime, 0.015);
            }
            
            let volSlider = document.getElementById(`ch-vol-${i}`);
            if (volSlider) volSlider.value = synthChannels[i].params.mixVol;
            let muteBtn = document.getElementById(`mute-btn-${i}`);
            if (muteBtn) {
                muteBtn.style.backgroundColor = synthChannels[i].params.muted ? 'var(--red)' : 'transparent';
                muteBtn.style.color = synthChannels[i].params.muted ? '#000' : 'var(--text)';
            }

            let midiSel = document.getElementById(`ui-midi-ch-${i}`);
            if (midiSel) midiSel.value = synthChannels[i].params.midiOutCh;
            
            let maxScale = synthChannels[i].params.threshMax || 5.0;
            let miniT = document.getElementById(`ch-mini-thresh-${i}`);
            let miniV = document.getElementById(`ch-val-thresh-${i}`);
            let maxBtn = document.getElementById(`ch-max-btn-${i}`);
            if (miniT) {
                miniT.max = maxScale.toString();
                miniT.value = synthChannels[i].params.threshold;
            }
            if (miniV) miniV.innerText = parseFloat(synthChannels[i].params.threshold).toFixed(2) + 'x';
            if (maxBtn) maxBtn.innerText = `${maxScale.toFixed(2)}x`;
            
            let miniW = document.getElementById(`ch-window-${i}`);
            let miniWV = document.getElementById(`ch-val-window-${i}`);
            if (miniW) miniW.value = synthChannels[i].params.sampleSize;
            if (miniWV) miniWV.innerText = synthChannels[i].params.sampleSize;
        }
        
        if (presetData.viz && presetData.viz[i] && chData[i]) {
            chData[i].config = JSON.parse(JSON.stringify(presetData.viz[i]));
            let z = document.getElementById(`ch-zoom-${i}`);
            let s = document.getElementById(`ch-smooth-${i}`);
            let zVal = document.getElementById(`ch-val-zoom-${i}`);
            let sVal = document.getElementById(`ch-val-smooth-${i}`);
            
            if(z) { 
                let minL = Math.log(50), maxL = Math.log(120000);
                let zPos = ((Math.log(chData[i].config.zoom) - minL) / (maxL - minL)) * 1000;
                z.value = zPos;
            }
            if(s) { s.value = chData[i].config.smooth; }
            if(zVal) zVal.innerText = Math.round(chData[i].config.zoom);
            if(sVal) sVal.innerText = chData[i].config.smooth.toFixed(2); 
        }

        if (synthChannels[i]) {
            synthChannels[i].isDirty = false;
        }
    }
    
    if (presetData.master) {
        window.masterVolumeLevel = presetData.master.vol;
        window.isMasterMuted = presetData.master.muted;
        if (window.masterGain && window.audioCtx) {
            const targetM = window.isMasterMuted ? 0 : window.masterVolumeLevel;
            window.masterGain.gain.setTargetAtTime(targetM, window.audioCtx.currentTime, 0.015);
        }
        
        let mSlider = document.getElementById('master-vol-slider');
        if (mSlider) mSlider.value = window.masterVolumeLevel;
        
        const btn = document.getElementById('btn-master-mute');
        if (btn) {
            btn.style.backgroundColor = window.isMasterMuted ? 'var(--red)' : 'transparent';
            btn.style.color = window.isMasterMuted ? '#000' : 'var(--red)';
        }
        
        if (presetData.master.bpm) {
            if (window.bioClock && typeof window.bioClock.reanchorForBpmChange === 'function') {
                window.bioClock.reanchorForBpmChange(presetData.master.bpm);
            }
            window.masterBPM = presetData.master.bpm;
        }
    }

    if (presetData.globalFX && window.globalFX) {
        const nextFx = JSON.parse(JSON.stringify(presetData.globalFX));
        if (typeof nextFx.level !== 'number' || isNaN(nextFx.level)) nextFx.level = 0.85;
        if (typeof nextFx.muted !== 'boolean') nextFx.muted = false;
        window.globalFX = nextFx;
        if (window.masterFX) window.masterFX.updateParams(window.globalFX);
    }

    if (typeof window.syncMixerControlsUI === 'function') window.syncMixerControlsUI();
    if (typeof updateChannelPresetDropdowns === 'function') updateChannelPresetDropdowns();
    syncUI();
    window.recordPerfSnapshotDelta(null);

    for (let i=0; i<4; i++) {
        if (typeof window.syncParamsToHardware === 'function') window.syncParamsToHardware(i);
    }
}

function exportPresets() {
    if (Object.keys(globalPresets).length === 0) { window.showHardwareNotice("No presets to export."); return; }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(globalPresets, null, 2));
    const downloadNode = document.createElement('a');
    downloadNode.setAttribute("href", dataStr);
    downloadNode.setAttribute("download", "biodata_presets.json");
    document.body.appendChild(downloadNode); downloadNode.click(); downloadNode.remove();
}

function importPresets(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (typeof imported === 'object' && imported !== null) {
                Object.keys(imported).forEach(key => {
                    imported[key] = normalizePresetEntry(imported[key]);
                });
                globalPresets = { ...globalPresets, ...imported };
                localStorage.setItem('biodataPresets', JSON.stringify(globalPresets));
                updatePresetDropdown();
                window.showHardwareNotice("Presets imported.");
            } else window.showHardwareNotice("Invalid preset file format.");
        } catch(err) { window.showHardwareNotice("Error parsing preset JSON file."); }
        event.target.value = "";
    };
    reader.readAsText(file);
}

let clearPresetsArmed = false;
function clearAllPresets() {
    if (!clearPresetsArmed) {
        clearPresetsArmed = true;
        window.showHardwareNotice("Click ALL again within 4s to confirm resetting user presets.", 4000);
        setTimeout(() => { clearPresetsArmed = false; }, 4000);
        return;
    }
    clearPresetsArmed = false;
    localStorage.removeItem('biodataPresets');
    localStorage.removeItem('biodataActivePreset');
    clearActiveChannelPresetOverrides();
    globalPresets = {};
    loadPresetsFromStorage();
    window.showHardwareNotice("Presets reset to factory defaults.");
}

let activeLfoView = 'pitchLfo';
let activeEnvView = 'ampEnv';
let activeFxView = 'drv';

function switchModView(type, targetView) {
    const root = document.documentElement;
    if (type === 'lfo') {
        activeLfoView = targetView;
        const modColorMap = { 'pitchLfo': 'var(--red)', 'filterLfo': 'var(--green)', 'ampLfo': 'var(--cyan)' };
        root.style.setProperty('--mod-color', modColorMap[targetView]);
    }
    if (type === 'env') {
        activeEnvView = targetView;
    }
    if (type === 'fx') {
        activeFxView = targetView;
        const fxColorMap = { 'drv': 'var(--orange)', 'dly': 'var(--purple)', 'rev': 'var(--yellow)' };
        root.style.setProperty('--fx-color', fxColorMap[targetView]);

        document.querySelectorAll('.fx-params').forEach(el => el.style.display = 'none');
        let targetGroup = document.querySelectorAll(`.fx-${targetView}-params`);
        if (targetGroup) targetGroup.forEach(el => el.style.display = 'flex');
        
        let sendKnob = document.getElementById('fx-send-knob');
        if (sendKnob) sendKnob.dataset.param = targetView;

        const fxLabels = {
            'drv': { p1: 'GRIT', p2: 'TONE', s: 'LVL' },
            'dly': { p1: 'TIME', p2: 'FDBK', s: '>REV' },
            'rev': { p1: 'SIZE', p2: 'DAMP', s: 'HPF' }
        };
        let l1 = document.getElementById('fx-lbl-p1');
        let l2 = document.getElementById('fx-lbl-p2');
        let ls = document.getElementById('fx-lbl-s');
        if(l1) { l1.style.opacity = 0; setTimeout(()=> { l1.textContent = fxLabels[targetView].p1; l1.style.opacity = 1; }, 150); }
        if(l2) { l2.style.opacity = 0; setTimeout(()=> { l2.textContent = fxLabels[targetView].p2; l2.style.opacity = 1; }, 150); }
        if(ls) { ls.style.opacity = 0; setTimeout(()=> { ls.textContent = fxLabels[targetView].s; ls.style.opacity = 1; }, 150); }
    }
    syncUI();
}

window.updateEnvTimeMode = function(val) {
    if (!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    p[activeEnvView].timeMode = val;
    let env = p[activeEnvView];
    
    // Clamp values if switching from EXT down to NRM
    if (val === 'norm') {
        if (env.atk > 2.0) env.atk = 2.0;
        if (env.dec > 2.0) env.dec = 2.0;
        if (env.rel > 5.0) env.rel = 5.0;
    }
    
    window.recordPerfParam(activeSynthIndex + 1, `${activeEnvView}.timeMode`, val, true);
    window.recordPerfParam(activeSynthIndex + 1, `${activeEnvView}.atk`, env.atk, true);
    window.recordPerfParam(activeSynthIndex + 1, `${activeEnvView}.dec`, env.dec, true);
    window.recordPerfParam(activeSynthIndex + 1, `${activeEnvView}.rel`, env.rel, true);

    synthChannels[activeSynthIndex].applyParams();
    syncUI();
    window.markChannelDirty(activeSynthIndex);
};

window.updateLfoRateMode = function(val) {
    if (!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    p[activeLfoView].rateMode = val;
    let rate = p[activeLfoView].rate;
    if (val === 'lo' && rate > 20) p[activeLfoView].rate = 20;
    if (val === 'hi' && rate < 20) p[activeLfoView].rate = 20;
    window.recordPerfParam(activeSynthIndex + 1, `${activeLfoView}.rateMode`, val, true);
    window.recordPerfParam(activeSynthIndex + 1, `${activeLfoView}.rate`, p[activeLfoView].rate, true);
    synthChannels[activeSynthIndex].applyParams();
    syncUI();
    window.debouncedHardwareSync(activeSynthIndex);
};

function updateNestedSynth(group, param, value) {
    if (group && group.startsWith('globalFx') && window.globalFX) {
        const fxType = group.split('.')[1];
        const parsed = isNaN(value) ? value : parseFloat(value);
        window.globalFX[fxType][param] = parsed;
        if (window.masterFX) window.masterFX.updateParams(window.globalFX);
        window.recordPerfParam(0, `globalFX.${fxType}.${param}`, parsed, false);
        return;
    }
    
    if (!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    let targetObj;
    let prefix = group;
    
    if (group === 'lfo') { targetObj = p[activeLfoView]; prefix = activeLfoView; }
    else if (group === 'env') { targetObj = p[activeEnvView]; prefix = activeEnvView; }
    else if (group === 'filter') targetObj = p.filter;
    else if (group === 'sources') targetObj = p.sources;
    else if (group === 'fx') targetObj = p.fx;
    
    const parsedVal = isNaN(value) ? value : parseFloat(value);
    if (targetObj) {
        if (param.includes('.')) {
            const keys = param.split('.');
            targetObj[keys[0]][keys[1]] = parsedVal;
        } else { 
            targetObj[param] = parsedVal; 
        }
        const isDiscrete = (param === 'shape' || param === 'osc1.type');
        window.recordPerfParam(activeSynthIndex + 1, `${prefix}.${param}`, parsedVal, isDiscrete);
    }
    
    synthChannels[activeSynthIndex].applyParams();
    window.markChannelDirty(activeSynthIndex);
}

function initKnobs() {
    document.querySelectorAll('.knob-track').forEach(knob => {
        let isDragging = false, startY = 0, startVal = 0;
        knob.style.touchAction = 'none';

        const updateDial = (val) => {
            const min = parseFloat(knob.dataset.min), max = parseFloat(knob.dataset.max), isLog = knob.dataset.log === "true";
            let pct = isLog ? (Math.log(val) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (val - min) / (max - min);
            let dial = knob.querySelector('.knob-dial');
            if(dial) dial.style.transform = `rotate(${-135 + (pct * 270)}deg)`;
        };
        
        let initVal = parseFloat(knob.dataset.val);
        if (!isNaN(initVal)) updateDial(initVal);

        const handleMove = (clientY) => {
            if (!isDragging) return;
            const min = parseFloat(knob.dataset.min), max = parseFloat(knob.dataset.max), isLog = knob.dataset.log === "true";
            let deltaY = startY - clientY, newVal;
            
            if (isLog) {
                let pct = (Math.log(startVal) - Math.log(min)) / (Math.log(max) - Math.log(min));
                pct = Math.max(0, Math.min(1, pct + (deltaY / 150)));
                newVal = Math.exp(Math.log(min) + pct * (Math.log(max) - Math.log(min)));
            } else { 
                newVal = Math.max(min, Math.min(max, startVal + (deltaY / 150) * (max - min))); 
            }
            
            knob.dataset.val = newVal; 
            updateDial(newVal); 
            
            const group = knob.dataset.group;
            const param = knob.dataset.param;

            let rect = knob.getBoundingClientRect();
            let centerX = rect.left + (rect.width / 2);
            let topY = rect.top;
            
            if (param !== 'testIntensity') {
                showTooltip(centerX, topY, newVal, param, group, knob);
            }
            
            if (group) updateNestedSynth(group, param, newVal);
            else updateActiveSynth(param, newVal);

            if (param === 'voices') {
                let intVal = Math.round(newVal);
                let readout = document.getElementById('poly-readout');
                if(readout) readout.innerText = intVal;
                
                let legatoWrapper = document.getElementById('legato-wrapper');
                let legatoBtn = document.getElementById('ui-legato');
                if (legatoWrapper && legatoBtn) {
                    if (intVal > 1) {
                        legatoWrapper.style.opacity = '0.3';
                        legatoWrapper.style.pointerEvents = 'none';
                        if (legatoBtn.checked) {
                            legatoBtn.checked = false;
                            updateActiveSynth('legato', 0);
                        }
                    } else {
                        legatoWrapper.style.opacity = '1.0';
                        legatoWrapper.style.pointerEvents = 'auto';
                    }
                }
            }
        };
        
        knob.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            isDragging = true; startY = e.clientY; 
            startVal = parseFloat(knob.dataset.val); 
            knob.setPointerCapture(e.pointerId);
            e.preventDefault(); 
        });
        
        knob.addEventListener('pointermove', (e) => {
            if (isDragging) handleMove(e.clientY);
        });
        
        const stopDrag = (e) => { 
            if(isDragging) { 
                isDragging = false; 
                knob.releasePointerCapture(e.pointerId);
                hideTooltip(); 
            } 
        };
        
        knob.addEventListener('pointerup', stopDrag);
        knob.addEventListener('pointercancel', stopDrag);
    });
}

function syncUI() {
    if (!synthChannels[activeSynthIndex]) return;
    const p = synthChannels[activeSynthIndex].params;
    
    const normRoot = ((parseInt(p.scaleRoot, 10) || 0) % 12 + 12) % 12;
    p.scaleRoot = normRoot;
    const scaleRootEl = document.getElementById('ui-scaleRoot');
    if (scaleRootEl) scaleRootEl.value = String(normRoot);
    const scaleTypeEl = document.getElementById('ui-scaleType');
    if (scaleTypeEl) {
        const targetType = p.scaleType || 'chromatic';
        const hasOpt = Array.from(scaleTypeEl.options || []).some(opt => opt.value === targetType);
        scaleTypeEl.value = hasOpt ? targetType : 'custom';
    }
    const stealEl = document.getElementById('ui-steal');
    if (stealEl) stealEl.value = p.stealMode || p.steal || 'none';
    const waveEl = document.getElementById('ui-wave'); if(waveEl) waveEl.value = p.sources.osc1.type;
    
    let legEl = document.getElementById('ui-legato');
    if (legEl) legEl.checked = (p.legato === 1);

    let lfoShape = document.getElementById('ui-lfo-shape');
    if(lfoShape && p[activeLfoView]) lfoShape.value = p[activeLfoView].shape;
    
    if (p[activeEnvView]) {
        let timeMode = p[activeEnvView].timeMode || 'norm';
        let tmEl = document.getElementById(timeMode === 'norm' ? 'env-time-norm' : 'env-time-ext');
        if (tmEl) tmEl.checked = true;
        
        let atkEl = document.getElementById('ui-env-atk');
        let decEl = document.getElementById('ui-env-dec');
        let relEl = document.getElementById('ui-env-rel');
        if (atkEl && decEl && relEl) {
            if (timeMode === 'norm') {
                atkEl.max = "2"; decEl.max = "2"; relEl.max = "5";
            } else {
                atkEl.max = "10"; decEl.max = "10"; relEl.max = "20";
            }
        }
    }
    
    ['atk', 'dec', 'sus', 'rel'].forEach(id => { let el = document.getElementById(`ui-env-${id}`); if(el && p[activeEnvView]) el.value = p[activeEnvView][id]; });
    
    let bpmDisplay = document.getElementById('ui-bpm-display');
    if (bpmDisplay) bpmDisplay.innerText = Math.round(window.masterBPM).toString().padStart(3, '0');

    let midiClockSelect = document.getElementById('midi-clock-dir');
    if (midiClockSelect && window.midiClockMode) {
        midiClockSelect.value = window.midiClockMode;
    }

    const synthInspector = document.getElementById('synth-inspector');
    if (synthInspector) {
        synthInspector.setAttribute('data-ch', String(activeSynthIndex));
    }
    
    if (p[activeLfoView]) {
        let rateMode = p[activeLfoView].rateMode || 'lo';
        let rmEl = document.getElementById(rateMode === 'lo' ? 'rate-lo' : 'rate-hi');
        if (rmEl) rmEl.checked = true;
        
        let rateKnob = document.querySelector('.knob-track[data-param="rate"][data-group="lfo"]');
        if (rateKnob) {
            if (rateMode === 'lo') { rateKnob.dataset.min = "0.01"; rateKnob.dataset.max = "20"; } 
            else { rateKnob.dataset.min = "20"; rateKnob.dataset.max = "2000"; }
            rateKnob.dataset.log = "true";
        }
    }
    
    const setV = (id, v) => { let el = document.getElementById(id); if(el) el.value = v; };
    const setT = (id, t) => { let el = document.getElementById(id); if(el) el.innerText = t; };

    setV('ui-slider-density', p.density); setT('ui-density-display', p.density + '%');
    setV('ui-quantize', p.quantize);
    
    let qSlider = document.getElementById('ui-quantize');
    if (qSlider) {
        const ticksWrap = document.getElementById('ui-quantize-ticks');
        const spans = ticksWrap
            ? ticksWrap.querySelectorAll('span')
            : (qSlider.nextElementSibling ? qSlider.nextElementSibling.querySelectorAll('span') : []);
        spans.forEach(s => { s.style.color = '#7d8590'; s.style.fontWeight = 'normal'; });
        if (spans[p.quantize]) { spans[p.quantize].style.color = 'var(--cyan)'; spans[p.quantize].style.fontWeight = 'bold'; }
    }

    setV('ui-note-min', p.minNote); setV('ui-note-max', p.maxNote);
    const midiToNote = (m) => ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][m%12] + (Math.floor(m/12)-2);
    setT('note-range-text', `${midiToNote(p.minNote)} (${p.minNote}) ↔ ${midiToNote(p.maxNote)} (${p.maxNote})`);
    let nFill = document.getElementById('note-fill');
    if (nFill) { nFill.style.left = (p.minNote / 127 * 100) + '%'; nFill.style.width = ((p.maxNote - p.minNote) / 127 * 100) + '%'; }

    setV('ui-vel-min', p.velMin); setV('ui-vel-max', p.velMax);
    setT('ui-vel-text', `${p.velMin} ↔ ${p.velMax}`);
    let vFill = document.getElementById('vel-fill');
    if (vFill) { vFill.style.left = (p.velMin / 127 * 100) + '%'; vFill.style.width = ((p.velMax - p.velMin) / 127 * 100) + '%'; }

    document.querySelectorAll('.synth-inspector .knob-track').forEach(knob => {
        const param = knob.dataset.param, group = knob.dataset.group;
        if (param === 'bpm') return; 
        
        let val;
        if (group && group.startsWith('globalFx') && window.globalFX) {
            const fxType = group.split('.')[1];
            if (window.globalFX[fxType]) val = window.globalFX[fxType][param];
        } 
        else if (group === 'lfo' && p[activeLfoView]) val = p[activeLfoView][param];
        else if (group === 'env' && p[activeEnvView]) val = p[activeEnvView][param];
        else if (group === 'fx' && p.fx) val = p.fx[param];
        else if (group === 'filter' && p.filter) val = p.filter[param];
        else if (group === 'sources' && p.sources) { const keys = param.split('.'); val = p.sources[keys[0]][keys[1]]; }
        else val = p[param]; 

        if (val === undefined || isNaN(val)) return;

        knob.dataset.val = val;
        const min = parseFloat(knob.dataset.min), max = parseFloat(knob.dataset.max), isLog = knob.dataset.log === "true";
        let pct = isLog ? (Math.log(val) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (val - min) / (max - min);
        let dial = knob.querySelector('.knob-dial');
        if (dial) dial.style.transform = `rotate(${-135 + (pct * 270)}deg)`;
        
        if (param === 'voices') {
            let intVal = Math.round(val);
            let readout = document.getElementById('poly-readout');
            if(readout) readout.innerText = intVal;
            let legatoWrapper = document.getElementById('legato-wrapper');
            let legatoBtn = document.getElementById('ui-legato');
            if (legatoWrapper && legatoBtn) {
                if (intVal > 1) {
                    legatoWrapper.style.opacity = '0.3';
                    legatoWrapper.style.pointerEvents = 'none';
                } else {
                    legatoWrapper.style.opacity = '1.0';
                    legatoWrapper.style.pointerEvents = 'auto';
                }
            }
        }
    });
    
    let drvLvl = document.getElementById('ui-fx-drv-lvl');
    if (drvLvl && p.fx) drvLvl.value = p.fx.drvLvl !== undefined ? p.fx.drvLvl : 1.0;
    
    let toRevEl = document.getElementById('ui-fx-torev');
    if (toRevEl && window.globalFX) toRevEl.value = window.globalFX.dly.toRev;

    let revHpfEl = document.getElementById('ui-fx-rev-hpf');
    if (revHpfEl && window.globalFX) revHpfEl.value = window.globalFX.rev.hpf;

    if (typeof updateChannelPresetDropdowns === 'function') {
        updateChannelPresetDropdowns();
    }
    syncPianoUI();
}

// --- CHANNEL PRESET ENGINE ---
let globalChannelPresets = {};

function loadChannelPresetsFromStorage() {
    try {
        const stored = localStorage.getItem('biodataChannelPresets');
        if (stored) globalChannelPresets = JSON.parse(stored);
    } catch(e) { console.error("Error loading channel presets", e); }
    
    Object.keys(globalChannelPresets).forEach(key => {
        if (globalChannelPresets[key] && globalChannelPresets[key].params) {
            globalChannelPresets[key].params = hydrateLoadedChannelParams(globalChannelPresets[key].params);
        }
    });

    // Inject factory channel presets into the dropdowns
    if (window.FACTORY_CHANNEL_PRESETS) {
        Object.keys(window.FACTORY_CHANNEL_PRESETS).forEach(key => {
            if (!globalChannelPresets[key]) {
                globalChannelPresets[key] = JSON.parse(JSON.stringify(window.FACTORY_CHANNEL_PRESETS[key]));
                if (globalChannelPresets[key].params) {
                    globalChannelPresets[key].params = hydrateLoadedChannelParams(globalChannelPresets[key].params);
                }
            }
        });
    }

    updateChannelPresetDropdowns();
}

function updateChannelPresetDropdowns() {
    const activeCh = Math.max(0, Math.min(3, parseInt(activeSynthIndex, 10) || 0));
    const voiceSelect = document.getElementById('ui-voice-preset-select');
    const voiceBtn = document.getElementById('ui-voice-preset-btn');
    const activePatchName = (synthChannels[activeCh] && synthChannels[activeCh].patchName)
        ? synthChannels[activeCh].patchName
        : 'INIT';

    if (voiceSelect) {
        const currentVal = voiceSelect.value;
        voiceSelect.innerHTML = '<option value="">-- Select Patch --</option>';
        Object.keys(globalChannelPresets).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.text = name;
            voiceSelect.appendChild(opt);
        });
        voiceSelect.value = globalChannelPresets[activePatchName]
            ? activePatchName
            : (globalChannelPresets[currentVal] ? currentVal : '');
    }

    if (voiceBtn) {
        const dirtyStar = (synthChannels[activeCh] && synthChannels[activeCh].isDirty && activePatchName !== 'INIT') ? '*' : '';
        voiceBtn.textContent = `${activePatchName}${dirtyStar} ▼`;
    }
}

function saveChannelPreset(ch, forceNew = false) {
    if (typeof ensureSynths === 'function') ensureSynths();
    const targetCh = Math.max(0, Math.min(3, parseInt(ch ?? activeSynthIndex, 10) || 0));
    if (activeSynthIndex !== targetCh) selectTab(targetCh);

    const select = document.getElementById('ui-voice-preset-select') || document.getElementById(`ch-preset-select-${targetCh}`);
    let name = select ? select.value : "";

    if (!forceNew && synthChannels[targetCh].patchName && synthChannels[targetCh].patchName !== "INIT") {
        name = synthChannels[targetCh].patchName;
    }

    if (forceNew || !name || name === "" || name === "INIT") {
        const chInput = document.getElementById('ui-voice-new-preset-input') || document.getElementById(`ch-new-preset-input-${targetCh}`);
        const typed = chInput ? chInput.value.trim() : "";
        if (typed) {
            name = typed;
            window.toggleChannelNewPresetRow(targetCh, false);
        } else {
            window.toggleChannelNewPresetRow(targetCh, true);
            window.showHardwareNotice(`Enter a name for CH ${targetCh + 1} patch, then press Enter or SAVE.`);
            return;
        }
    } else {
        window.toggleChannelNewPresetRow(targetCh, false);
    }

    const normalizedParams = hydrateLoadedChannelParams(synthChannels[targetCh].params);
    synthChannels[targetCh].params = hydrateLoadedChannelParams(normalizedParams);
    const presetData = {
        params: normalizedParams,
        config: chData[targetCh] && chData[targetCh].config ? JSON.parse(JSON.stringify(chData[targetCh].config)) : null
    };

    globalChannelPresets[name] = presetData;
    localStorage.setItem('biodataChannelPresets', JSON.stringify(globalChannelPresets));
    setActiveChannelPresetOverride(targetCh, name);

    synthChannels[targetCh].patchName = name;
    synthChannels[targetCh].isDirty = false;
    updateChannelPresetDropdowns();
    if (select) select.value = name;
    window.showHardwareNotice(`Saved CH ${targetCh + 1} patch "${name}".`, 2200);

    setTimeout(() => {
        const widget = document.getElementById('active-voice-preset-widget');
        if (widget) widget.classList.remove('show');
    }, 150);
}

function loadChannelPreset(ch, name, options = {}) {
    if (!name || !globalChannelPresets[name]) return;
    if (typeof ensureSynths === 'function') ensureSynths();
    const targetCh = Math.max(0, Math.min(3, parseInt(ch ?? activeSynthIndex, 10) || 0));

    const presetData = globalChannelPresets[name];

    if (presetData.params && synthChannels[targetCh]) {
        synthChannels[targetCh].params = hydrateLoadedChannelParams(presetData.params);
        synthChannels[targetCh].applyParams();

        if (synthChannels[targetCh].channelOut) {
            synthChannels[targetCh].channelOut.gain.value = synthChannels[targetCh].params.muted ? 0 : synthChannels[targetCh].params.mixVol;
        }

        let volSlider = document.getElementById(`ch-vol-${targetCh}`);
        if (volSlider) volSlider.value = synthChannels[targetCh].params.mixVol;
        let muteBtn = document.getElementById(`mute-btn-${targetCh}`);
        if (muteBtn) {
            muteBtn.style.backgroundColor = synthChannels[targetCh].params.muted ? 'var(--red)' : 'transparent';
            muteBtn.style.color = synthChannels[targetCh].params.muted ? '#000' : 'var(--text)';
        }

        let midiSel = document.getElementById(`ui-midi-ch-${targetCh}`);
        if (midiSel) midiSel.value = synthChannels[targetCh].params.midiOutCh;

        let maxScale = synthChannels[targetCh].params.threshMax || 5.0;
        let miniT = document.getElementById(`ch-mini-thresh-${targetCh}`);
        let miniV = document.getElementById(`ch-val-thresh-${targetCh}`);
        let maxBtn = document.getElementById(`ch-max-btn-${targetCh}`);
        if (miniT) {
            miniT.max = maxScale.toString();
            miniT.value = synthChannels[targetCh].params.threshold;
        }
        if (miniV) miniV.innerText = parseFloat(synthChannels[targetCh].params.threshold).toFixed(2) + 'x';
        if (maxBtn) maxBtn.innerText = `${maxScale.toFixed(2)}x`;

        let miniW = document.getElementById(`ch-window-${targetCh}`);
        let miniWV = document.getElementById(`ch-val-window-${targetCh}`);
        if (miniW) miniW.value = synthChannels[targetCh].params.sampleSize;
        if (miniWV) miniWV.innerText = synthChannels[targetCh].params.sampleSize;
    }

    if (presetData.config && chData[targetCh]) {
        chData[targetCh].config = JSON.parse(JSON.stringify(presetData.config));
        let z = document.getElementById(`ch-zoom-${targetCh}`);
        let s = document.getElementById(`ch-smooth-${targetCh}`);
        let zVal = document.getElementById(`ch-val-zoom-${targetCh}`);
        let sVal = document.getElementById(`ch-val-smooth-${targetCh}`);

        if (z) {
            let minL = Math.log(50), maxL = Math.log(120000);
            z.value = ((Math.log(chData[targetCh].config.zoom) - minL) / (maxL - minL)) * 1000;
        }
        if (s) s.value = chData[targetCh].config.smooth;
        if (zVal) zVal.innerText = Math.round(chData[targetCh].config.zoom);
        if (sVal) sVal.innerText = chData[targetCh].config.smooth.toFixed(2);
    }

    synthChannels[targetCh].patchName = name;
    synthChannels[targetCh].isDirty = false;
    if (!options || !options.skipPersistOverride) {
        setActiveChannelPresetOverride(targetCh, name);
    }

    if (!options || !options.skipTabSelect) {
        selectTab(targetCh);
    } else {
        updateChannelPresetDropdowns();
    }
    if (typeof window.syncMixerControlsUI === 'function') window.syncMixerControlsUI();
    window.recordPerfSnapshotDelta(targetCh);

    setTimeout(() => {
        const widget = document.getElementById('active-voice-preset-widget');
        if (widget) widget.classList.remove('show');
    }, 150);

    window.debouncedHardwareSync(targetCh);
}

function deleteChannelPreset(ch) {
    const targetCh = Math.max(0, Math.min(3, parseInt(ch ?? activeSynthIndex, 10) || 0));
    if (activeSynthIndex !== targetCh) selectTab(targetCh);
    const select = document.getElementById('ui-voice-preset-select') || document.getElementById(`ch-preset-select-${targetCh}`);
    let name = select ? select.value : "";
    if (!name || name === "") {
        window.showHardwareNotice("Select a channel voice preset to delete.");
        return;
    }
    delete globalChannelPresets[name];
    localStorage.setItem('biodataChannelPresets', JSON.stringify(globalChannelPresets));
    const overrides = getActiveChannelPresetMap();
    Object.keys(overrides).forEach(k => {
        if (overrides[k] === name) setActiveChannelPresetOverride(parseInt(k, 10), null);
    });
    if (synthChannels[targetCh].patchName === name) {
        synthChannels[targetCh].patchName = "INIT";
        synthChannels[targetCh].isDirty = false;
    }
    updateChannelPresetDropdowns();
    if (select) select.value = "";
    window.showHardwareNotice(`Deleted voice preset "${name}".`, 2200);

    setTimeout(() => {
        const widget = document.getElementById('active-voice-preset-widget');
        if (widget) widget.classList.remove('show');
    }, 150);
}

window.markChannelDirty = function(ch) {
    if (!synthChannels[ch] || synthChannels[ch].patchName === "INIT" || !synthChannels[ch].patchName) return;
    if (!synthChannels[ch].isDirty) {
        synthChannels[ch].isDirty = true;
        if (ch === activeSynthIndex) {
            const btn = document.getElementById('ui-voice-preset-btn');
            if (btn) btn.textContent = `${synthChannels[ch].patchName}* ▼`;
        }
    }
};

const catchVisualizerSliders = (e) => {
    if (e.target.id && (e.target.id.includes('mini-thresh') || e.target.id.includes('window'))) {
        let ch = parseInt(e.target.id.replace(/[^\d]/g, ''));
        if (!isNaN(ch) && synthChannels[ch]) {
            if (e.target.id.includes('thresh')) {
                let maxLimit = Math.min(10.0, Math.max(1.0, synthChannels[ch].params.threshMax || 5.0));
                let val = Math.max(1.0, Math.min(maxLimit, Math.min(10.0, parseFloat(e.target.value))));
                synthChannels[ch].params.threshold = val;
                let vEl = document.getElementById(`ch-val-thresh-${ch}`);
                if (vEl) vEl.innerText = val.toFixed(2) + 'x';
                window.recordPerfParam(ch + 1, 'threshold', val, false);
            } else {
                synthChannels[ch].params.sampleSize = parseInt(e.target.value);
                let wEl = document.getElementById(`ch-val-window-${ch}`);
                if (wEl) wEl.innerText = e.target.value;
                window.recordPerfParam(ch + 1, 'sampleSize', synthChannels[ch].params.sampleSize, false);
            }
            if (typeof window.debouncedHardwareSync === 'function') window.debouncedHardwareSync(ch);
        }
    }
};

document.addEventListener('input', catchVisualizerSliders, true);
document.addEventListener('change', catchVisualizerSliders, true);

window.positionDropdownPanel = function(widget) {
    if (!widget || !widget.classList.contains('show')) return;
    const panel = widget.querySelector('.dropdown-content');
    if (!panel) return;

    panel.style.left = '';
    panel.style.right = '';
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const margin = 12;
    panel.style.maxWidth = Math.max(180, vw - margin * 2) + 'px';

    const wRect = widget.getBoundingClientRect();
    let pRect = panel.getBoundingClientRect();

    if (pRect.left < margin) {
        panel.style.left = '0px';
        panel.style.right = 'auto';
        pRect = panel.getBoundingClientRect();
    }

    if (pRect.right > vw - margin) {
        const targetViewportLeft = Math.max(margin, vw - margin - pRect.width);
        panel.style.left = (targetViewportLeft - wRect.left) + 'px';
        panel.style.right = 'auto';
    } else if (pRect.left < margin) {
        panel.style.left = (margin - wRect.left) + 'px';
        panel.style.right = 'auto';
    }
};

window.toggleDropdownWidget = function(widget, event) {
    if (event) event.stopPropagation();
    if (!widget) return;
    const willShow = !widget.classList.contains('show');
    document.querySelectorAll('.dropdown-widget.show').forEach(w => {
        if (w !== widget) w.classList.remove('show');
    });
    if (typeof window.collapseAllNewPresetRows === 'function') {
        window.collapseAllNewPresetRows();
    }
    widget.classList.toggle('show', willShow);
    if (willShow) {
        window.positionDropdownPanel(widget);
    }
};

document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown-widget')) {
        document.querySelectorAll('.dropdown-widget.show').forEach(w => w.classList.remove('show'));
        if (typeof window.collapseAllNewPresetRows === 'function') {
            window.collapseAllNewPresetRows();
        }
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.dropdown-widget.show').forEach(w => w.classList.remove('show'));
        if (typeof window.collapseAllNewPresetRows === 'function') {
            window.collapseAllNewPresetRows();
        }
    }
});

window.addEventListener('resize', () => {
    document.querySelectorAll('.dropdown-widget.show').forEach(w => {
        window.positionDropdownPanel(w);
    });
});
