/**
 * js/visualizer.js
 * bioQuad Focused 1CH / 2CH / 4CH Oscilloscope, Touch HUD & Parallax-Fixed Meter
 */

let sCtxs = [], rCtxs = [];
let lastRenderTime = 0;

function resizeCanvasToDisplaySize(canvas) {
    if (!canvas) return false;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return false;
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    return true;
}

// --- FOCUSED VIEW MODE ORCHESTRATION (1CH, 2CH, 4CH) ---
window.getVisibleChannels = function() {
    const mode = window.viewMode || '2ch';
    if (mode === '1ch') {
        const f = Math.max(0, Math.min(3, parseInt(window.focusedChannel, 10) || 0));
        return [f];
    }
    if (mode === '2ch') {
        const pair = Array.isArray(window.dualChannels) && window.dualChannels.length === 2
            ? window.dualChannels
            : [0, 1];
        return pair.slice().sort((a, b) => a - b);
    }
    return [0, 1, 2, 3];
};

window.applyDashboardViewMode = function() {
    const mode = window.viewMode || '2ch';
    const visible = window.getVisibleChannels();
    const dash = document.getElementById('dashboard');
    if (dash) {
        dash.setAttribute('data-view-mode', mode);
    }

    for (let i = 0; i < 4; i++) {
        const card = document.getElementById(`ch-card-${i}`);
        if (card) {
            const isVis = visible.includes(i);
            card.classList.toggle('ui-hidden', !isVis);
            card.classList.toggle('is-active-synth', i === window.activeSynthIndex);
        }

        const focusBtn = document.getElementById(`focus-ch-btn-${i}`);
        if (focusBtn) {
            const isVis = visible.includes(i);
            const isPrimary = i === window.activeSynthIndex;
            focusBtn.classList.toggle('is-visible', isVis);
            focusBtn.classList.toggle('is-primary', isPrimary);
            focusBtn.setAttribute('aria-pressed', isVis ? 'true' : 'false');
        }
    }

    ['1ch', '2ch', '4ch'].forEach(m => {
        const mBtn = document.getElementById(`view-mode-${m}`);
        if (mBtn) {
            const active = m === mode;
            mBtn.classList.toggle('active-view-mode', active);
            mBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
        }
    });
};

window.setViewMode = function(mode) {
    if (!['1ch', '2ch', '4ch'].includes(mode)) return;
    window.viewMode = mode;
    try { localStorage.setItem('bioquad_view_mode', mode); } catch (e) {}

    if (mode === '1ch') {
        window.focusedChannel = window.activeSynthIndex ?? window.focusedChannel ?? 0;
        try { localStorage.setItem('bioquad_focused_ch', String(window.focusedChannel)); } catch (e) {}
    } else if (mode === '2ch') {
        if (!Array.isArray(window.dualChannels) || window.dualChannels.length !== 2) {
            window.dualChannels = [0, 1];
        }
        if (!window.dualChannels.includes(window.activeSynthIndex)) {
            window.dualChannels = [window.activeSynthIndex, (window.activeSynthIndex + 1) % 4].sort((a, b) => a - b);
            try { localStorage.setItem('bioquad_dual_chs', JSON.stringify(window.dualChannels)); } catch (e) {}
        }
    }
    window.applyDashboardViewMode();
};

window.selectChannelInCurrentView = function(chIdx) {
    const ch = Math.max(0, Math.min(3, parseInt(chIdx, 10) || 0));
    const mode = window.viewMode || '2ch';

    if (mode === '1ch') {
        window.focusedChannel = ch;
        try { localStorage.setItem('bioquad_focused_ch', String(ch)); } catch (e) {}
    } else if (mode === '2ch') {
        let pair = Array.isArray(window.dualChannels) && window.dualChannels.length === 2
            ? window.dualChannels.slice()
            : [0, 1];
        if (!pair.includes(ch)) {
            // Keep the currently active synth channel if it's in the pair, otherwise replace second slot
            const keep = pair.includes(window.activeSynthIndex) ? window.activeSynthIndex : pair[0];
            pair = [keep, ch].sort((a, b) => a - b);
            if (pair[0] === pair[1]) pair[1] = (pair[0] + 1) % 4;
            window.dualChannels = pair;
            try { localStorage.setItem('bioquad_dual_chs', JSON.stringify(pair)); } catch (e) {}
        }
    }

    if (typeof window.selectTab === 'function') {
        window.selectTab(ch);
    } else {
        window.activeSynthIndex = ch;
    }
    window.applyDashboardViewMode();
};

// Smooth drag-to-adjust threshold maximum (1.0x to 10.0x)
window.setThresholdMax = function(ch, newMax) {
    if (!window.synthChannels || !window.synthChannels[ch]) return;
    const p = window.synthChannels[ch].params;
    newMax = Math.max(1.0, Math.min(10.0, Math.round(newMax * 20) / 20));
    p.threshMax = newMax;
    p.threshold = Math.max(1.0, Math.min(10.0, Math.min(newMax, p.threshold || 2.0)));

    const tSlider = document.getElementById(`ch-mini-thresh-${ch}`);
    if (tSlider) {
        tSlider.min = "1.00";
        tSlider.max = newMax.toFixed(2);
        tSlider.step = newMax <= 2.5 ? "0.01" : "0.02";
        tSlider.value = p.threshold.toFixed(2);
        const tVal = document.getElementById(`ch-val-thresh-${ch}`);
        if (tVal) tVal.innerText = `${p.threshold.toFixed(2)}x`;
    }

    const maxBtn = document.getElementById(`ch-max-btn-${ch}`);
    if (maxBtn) maxBtn.innerText = `${newMax.toFixed(2)}x`;

    if (typeof window.recordPerfParam === 'function') {
        window.recordPerfParam(ch + 1, 'threshMax', newMax, false);
        window.recordPerfParam(ch + 1, 'threshold', p.threshold, false);
    }
    if (typeof window.debouncedHardwareSync === 'function') window.debouncedHardwareSync(ch);
};

window.initThreshMaxDrag = function() {
    document.querySelectorAll('.ch-thresh-max-btn').forEach(badge => {
        let isDragging = false, startX = 0, startY = 0, startMax = 5.0, hasMoved = false, activePointerType = 'mouse';
        const ch = parseInt(badge.dataset.ch, 10);

        badge.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
            isDragging = true;
            hasMoved = false;
            activePointerType = e.pointerType || 'mouse';
            startX = e.clientX;
            startY = e.clientY;
            startMax = (synthChannels[ch] && synthChannels[ch].params.threshMax) ? synthChannels[ch].params.threshMax : 5.0;

            // On touch screens, never capture pointer or preventDefault on pointerdown so vertical page scrolling stays effortless
            if (activePointerType !== 'touch') {
                if (badge.setPointerCapture) {
                    try { badge.setPointerCapture(e.pointerId); } catch (err) {}
                }
                badge.style.borderColor = 'var(--cyan)';
                badge.style.color = 'var(--cyan)';
                e.preventDefault();
            }
        });

        badge.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            if (activePointerType === 'touch') {
                if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) {
                    hasMoved = true;
                    isDragging = false;
                }
                return;
            }
            const deltaY = startY - e.clientY;
            if (Math.abs(deltaY) > 2) hasMoved = true;
            const newMax = Math.max(1.0, Math.min(10.0, startMax + (deltaY * 0.025)));
            window.setThresholdMax(ch, newMax);
            const rect = badge.getBoundingClientRect();
            if (typeof showTooltip === 'function') showTooltip(rect.left + rect.width / 2, rect.top - 12, newMax, 'threshMax', '', badge);
        });

        const stopDrag = (e) => {
            if (!isDragging) return;
            isDragging = false;
            if (activePointerType !== 'touch' && badge.releasePointerCapture && e.pointerId !== undefined) {
                try { badge.releasePointerCapture(e.pointerId); } catch (err) {}
            }
            badge.style.borderColor = '';
            badge.style.color = '';
            if (typeof hideTooltip === 'function') hideTooltip();
            if (!hasMoved) {
                // Tap-to-cycle common scale ceilings (phone & tablet scroll-safe, no blocking prompt)
                const steps = [2.5, 5.0, 7.5, 10.0];
                const cur = (synthChannels[ch] && synthChannels[ch].params.threshMax) ? synthChannels[ch].params.threshMax : 5.0;
                const nextIdx = steps.findIndex(s => s > cur + 0.1);
                const nextMax = nextIdx >= 0 ? steps[nextIdx] : steps[0];
                window.setThresholdMax(ch, nextMax);
            }
        };
        badge.addEventListener('pointerup', stopDrag);
        badge.addEventListener('pointercancel', stopDrag);
    });
};

window.toggleHudMenu = function(chIdx, forceState) {
    const wrap = document.getElementById(`hud-settings-wrap-${chIdx}`);
    if (!wrap) return;
    const next = forceState !== undefined ? Boolean(forceState) : !wrap.classList.contains('is-open');
    document.querySelectorAll('.hud-settings-wrapper.is-open').forEach(el => {
        if (el !== wrap) el.classList.remove('is-open');
    });
    wrap.classList.toggle('is-open', next);
};

// --- ENVIRONMENTAL SENSOR HUD READOUT (SHT4x °F / °C IN DATA BLOCK) ---
window.resolveChannelEnvSensor = function(chIdx) {
    const ch = (window.chData && window.chData[chIdx]) ? window.chData[chIdx] : null;

    // 1. File playback isolation: only show file-sourced env if present
    if (window.dataStreamer && typeof window.dataStreamer.isChannelPlayingStream === 'function' && window.dataStreamer.isChannelPlayingStream(chIdx)) {
        return (ch && ch.fileEnvSensor) || null;
    }

    // 2. Cloud MQTT stream route: show the routed remote feed's SHT4x reading
    if (window.bioquadFeeds && Array.isArray(window.bioquadFeeds.channelRoutes)) {
        const route = window.bioquadFeeds.channelRoutes[chIdx];
        if (route && route.feedId) {
            const feed = (window.bioquadFeeds.feeds && typeof window.bioquadFeeds.feeds.get === 'function')
                ? window.bioquadFeeds.feeds.get(route.feedId)
                : null;
            return (ch && ch.mqttEnvSensor) || (feed && feed.env) || null;
        }
    }

    // 3. Local USB Serial / BLE GATT hardware sensor
    const candidate = (ch && ch.localEnvSensor) || window.localHwEnvSensor || null;
    if (!candidate) return null;
    const hwLive = (typeof window.isHardwareConnected === 'function' && window.isHardwareConnected()) ||
        Boolean(window.usbHardware && window.usbHardware.isConnected) ||
        Boolean(window.activeBleDevice && window.activeBleDevice.gatt && window.activeBleDevice.gatt.connected);
    const freshLocal = candidate.receivedAt && ((Date.now() - candidate.receivedAt) < 30000);
    return (hwLive || freshLocal) ? candidate : null;
};

window.refreshChannelSensorHUD = function(chIdx) {
    const el = document.getElementById(`hud-sensor-${chIdx}`);
    if (!el) return;
    const Core = window.BioQuadCore;
    const env = window.resolveChannelEnvSensor(chIdx);
    const label = (env && Core && typeof Core.formatEnvSensorDisplay === 'function')
        ? Core.formatEnvSensorDisplay(env, window.envTempUnit || 'F')
        : '';

    if (!label) {
        if (el.style.display !== 'none') {
            el.style.display = 'none';
            el.textContent = '';
            el.title = '';
        }
        return;
    }

    if (el.textContent !== label) {
        el.textContent = label;
    }
    const tip = (Core && typeof Core.formatEnvSensorTooltip === 'function')
        ? Core.formatEnvSensorTooltip(env)
        : label;
    if (el.title !== tip) {
        el.title = tip;
    }
    if (el.style.display !== 'inline-flex') {
        el.style.display = 'inline-flex';
    }
};

window.refreshAllSensorHUDs = function() {
    for (let i = 0; i < 4; i++) {
        window.refreshChannelSensorHUD(i);
    }
};

window.toggleEnvTempUnit = function() {
    window.envTempUnit = (window.envTempUnit === 'C') ? 'F' : 'C';
    try { localStorage.setItem('bioquad_temp_unit', window.envTempUnit); } catch (e) {}
    window.refreshAllSensorHUDs();
};

window.getChannelMetricMeta = function(chIdx) {
    const ch = (window.chData && window.chData[chIdx]) ? window.chData[chIdx] : null;
    if (ch && ch.metricMeta && typeof ch.metricMeta === 'object') {
        return ch.metricMeta;
    }
    return { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' };
};

window.syncChannelHudLabels = function(chIdx) {
    const ch = (window.chData && window.chData[chIdx]) ? window.chData[chIdx] : null;
    if (!ch) return;
    const meta = window.getChannelMetricMeta(chIdx);
    const isBio = meta.isBiodata !== false;
    const unit = isBio ? '\u00B5S' : String(meta.unit || '');
    const heading = isBio ? 'ADMITTANCE' : String(meta.heading || 'RAW DATA');
    const sig = `${isBio ? '1' : '0'}|${heading}|${unit}`;
    if (ch._appliedMetricSig === sig) return;
    ch._appliedMetricSig = sig;

    const headingEl = document.getElementById(`hud-heading-${chIdx}`);
    const unitEl = document.getElementById(`hud-unit-${chIdx}`);
    const kohmWrap = document.getElementById(`hud-kohm-wrap-${chIdx}`);
    const subLeftLbl = document.getElementById(`hud-sub-left-lbl-${chIdx}`);
    const subLeftUnit = document.getElementById(`hud-sub-left-unit-${chIdx}`);
    const slewUnitEl = document.getElementById(`hud-slew-unit-${chIdx}`);

    if (headingEl) headingEl.textContent = heading;
    if (unitEl) {
        unitEl.textContent = unit;
        unitEl.style.display = unit ? '' : 'none';
    }
    if (kohmWrap) {
        kohmWrap.style.display = isBio ? 'flex' : 'none';
    }
    if (subLeftLbl) {
        subLeftLbl.textContent = isBio ? 'WIDTH' : 'DEV';
    }
    if (subLeftUnit) {
        subLeftUnit.textContent = isBio ? 'T' : '\u03C3';
    }
    if (slewUnitEl) {
        slewUnitEl.textContent = isBio ? '\u00B5S' : unit;
        slewUnitEl.style.display = (isBio || unit) ? '' : 'none';
    }
};

function initVisualizer() {
    const dash = document.getElementById('dashboard');
    if (dash) dash.className = '';

    let html = ``;
    for (let i = 0; i < 4; i++) {
        if (!chData[i]) chData[i] = {};
        if (!chData[i].waveBuffer) chData[i].waveBuffer = [];
        if (!chData[i].notes) chData[i].notes = [];
        if (!chData[i].history) chData[i].history = [];
        if (!chData[i].densityEvents) chData[i].densityEvents = [];
        if (!chData[i].config) chData[i].config = { zoom: 500, smooth: 0.05, freeze: false };
        if (!chData[i].bounds) chData[i].bounds = { min: 0, max: 10 };
        if (!chData[i].acc || chData[i].acc.lastSec === undefined) chData[i].acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: Date.now() };
        if (chData[i].vizDeltaPct === undefined) chData[i].vizDeltaPct = 0;

        const initialThresh = (window.synthChannels[i] && window.synthChannels[i].params) ? window.synthChannels[i].params.threshold : 2.0;
        const initialMax = (window.synthChannels[i] && window.synthChannels[i].params && window.synthChannels[i].params.threshMax) ? window.synthChannels[i].params.threshMax : 5.0;

        html += `
        <div class="card ch-viz-card" id="ch-card-${i}" data-ch="${i}" data-testid="ch-card-${i}">
            <div class="card-header">
                <button type="button" class="ch-card-title-btn" onclick="if(typeof selectTab==='function') selectTab(${i}); window.applyDashboardViewMode();" title="Inspect Channel ${i + 1} Synth" aria-label="Inspect Channel ${i + 1}">
                    <span id="card-led-${i}" class="ch-card-led"></span>
                    <span style="color: ${window.CH_COLORS[i]}; font-size: 1.08em; font-weight: bold;">CH ${i + 1}</span>
                    <span id="ch-feed-badge-${i}" class="ch-feed-route-pill" style="display: none;">LIVE</span>
                </button>
                <div class="ch-thresh-bar-group">
                    <span class="hw-param-tag" title="Threshold">T</span>

                    <div class="ch-thresh-meter-wrap">
                        <canvas id="ch-mini-vu-thresh-${i}" class="ch-thresh-vu-canvas"></canvas>
                        <input type="range" id="ch-mini-thresh-${i}" aria-label="Channel ${i + 1} Threshold" class="pro-slider ch-thresh-slider" min="1.00" max="${initialMax.toFixed(2)}" step="0.01" value="${Math.max(1.0, initialThresh).toFixed(2)}">
                    </div>

                    <span id="ch-val-thresh-${i}" class="ch-thresh-readout tabular-nums">${Math.max(1.0, initialThresh).toFixed(2)}x</span>
                    <button type="button" id="ch-max-btn-${i}" class="ch-thresh-max-btn" data-ch="${i}" aria-label="Channel ${i + 1} Max Threshold Ceiling">${initialMax.toFixed(2)}x</button>
                </div>
            </div>

            <div class="canvas-wrapper scope-wrapper"><canvas class="scope" id="scope-${i}"></canvas></div>

            <div class="split-hud">
                <div class="canvas-wrapper roll-container"><canvas class="roll" id="roll-${i}"></canvas></div>
                <div class="hud-container">
                    <button type="button" id="hud-sensor-${i}" class="hud-sensor-readout tabular-nums" onclick="event.stopPropagation(); window.toggleEnvTempUnit && window.toggleEnvTempUnit();" aria-label="Channel ${i + 1} Sensor Temperature" style="display: none;"></button>
                    <div class="hud-heading" id="hud-heading-${i}">ADMITTANCE</div>
                    <div class="hud-top-metrics">
                        <div style="color: ${window.CH_COLORS[i]}; display: flex; align-items: baseline;">
                            <div id="hud-val-${i}" class="hud-primary-us tabular-nums">0.0</div>
                            <div id="hud-unit-${i}" style="font-size: 11px; margin-left: 3px;">µS</div>
                        </div>
                        <div id="hud-kohm-wrap-${i}" style="color: #ccc; display: flex; align-items: baseline;">
                            <div id="hud-kohm-${i}" class="hud-kohm-val tabular-nums">0.0</div>
                            <div style="font-size: 10px; margin-left: 3px;">kΩ</div>
                        </div>
                    </div>
                    <div class="hud-bottom-metrics">
                        <div style="display: flex; flex-direction: column; align-items: center;">
                            <div id="hud-sub-left-lbl-${i}" style="font-size: 9px; color: #888; margin-bottom: 2px;">WIDTH</div>
                            <div style="color: #ccc; display: flex; align-items: baseline; justify-content: center;">
                                <div id="hud-ticks-${i}" style="font-size: 12px; font-weight: bold;" class="tabular-nums">0</div>
                                <div id="hud-sub-left-unit-${i}" style="font-size: 9px; color: #666; margin-left: 3px;">T</div>
                            </div>
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: center;">
                            <div style="font-size: 9px; color: #888; margin-bottom: 2px;">SLEW</div>
                            <div id="hud-slew-color-${i}" style="color: #888; display: flex; align-items: baseline; justify-content: center;">
                                <div id="hud-slew-icon-${i}" style="font-size: 11px; margin-right: 2px;">~</div>
                                <div id="hud-slew-val-${i}" style="font-size: 13px; font-weight: bold;" class="tabular-nums">0.00</div>
                                <div id="hud-slew-unit-${i}" style="font-size: 9px; color: #666; margin-left: 3px;">µS</div>
                            </div>
                        </div>
                    </div>
                    <div class="hud-settings-wrapper" id="hud-settings-wrap-${i}">
                        <button type="button" class="hud-gear-icon" aria-label="Channel ${i + 1} Scope Settings" onclick="event.stopPropagation(); window.toggleHudMenu(${i});">⚙</button>
                        <div class="hud-settings-menu" onclick="event.stopPropagation();">
                            <div style="display: flex; gap: 4px; margin-bottom: 6px; align-items: center;">
                                <button type="button" id="ch-freeze-${i}" class="hud-mini-btn">❄ FREEZE</button>
                                <button type="button" id="ch-clear-${i}" class="hud-mini-btn hud-clr-btn" title="Clear Scope" aria-label="Clear Channel ${i + 1} Scope"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg></button>
                                <button type="button" class="hud-mini-btn hud-close-btn" title="Close Scope Settings" aria-label="Close Channel ${i + 1} Scope Settings" onclick="window.toggleHudMenu(${i}, false);">✕</button>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 6px; font-size: 10px; color: #888;">
                                <label style="display: flex; align-items: center; justify-content: space-between;">
                                    <span style="font-weight: bold; width: 18px;" title="Oscilloscope Zoom">Z</span>
                                    <input type="range" id="ch-zoom-${i}" class="pro-slider" min="0" max="1000" value="230" style="flex-grow: 1; margin: 0 6px; background: #333;">
                                    <span id="ch-val-zoom-${i}" class="tabular-nums" style="color: #ccc; width: 34px; text-align: right;">500</span>
                                </label>
                                <label style="display: flex; align-items: center; justify-content: space-between;">
                                    <span style="font-weight: bold; width: 18px;" title="EMA Smoothing">S</span>
                                    <input type="range" id="ch-smooth-${i}" class="pro-slider" min="0.01" max="1.0" step="0.01" value="0.05" style="flex-grow: 1; margin: 0 6px; background: #333;">
                                    <span id="ch-val-smooth-${i}" class="tabular-nums" style="color: #ccc; width: 34px; text-align: right;">0.05</span>
                                </label>
                                <label style="display: flex; align-items: center; justify-content: space-between;">
                                    <span style="font-weight: bold; width: 18px;" title="Sample Window">W</span>
                                    <input type="range" id="ch-window-${i}" class="pro-slider" min="10" max="100" step="1" value="40" style="flex-grow: 1; margin: 0 6px; background: #333;">
                                    <span id="ch-val-window-${i}" class="tabular-nums" style="color: #ccc; width: 34px; text-align: right;">40</span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    if (dash) dash.innerHTML = html;

    for (let i = 0; i < 4; i++) {
        const zSlider = document.getElementById(`ch-zoom-${i}`);
        const sSlider = document.getElementById(`ch-smooth-${i}`);
        const tSlider = document.getElementById(`ch-mini-thresh-${i}`);
        const wSlider = document.getElementById(`ch-window-${i}`);
        const fBtn = document.getElementById(`ch-freeze-${i}`);
        const cBtn = document.getElementById(`ch-clear-${i}`);

        const zVal = document.getElementById(`ch-val-zoom-${i}`);
        const sVal = document.getElementById(`ch-val-smooth-${i}`);
        const tVal = document.getElementById(`ch-val-thresh-${i}`);
        const wVal = document.getElementById(`ch-val-window-${i}`);

        if (zSlider) zSlider.addEventListener('input', (e) => {
            const pct = parseFloat(e.target.value) / 1000.0;
            const minL = Math.log(50), maxL = Math.log(120000);
            const val = Math.round(Math.exp(minL + pct * (maxL - minL)));
            chData[i].config.zoom = val;
            if (zVal) zVal.innerText = val;
        });

        if (sSlider) sSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            chData[i].config.smooth = val;
            if (sVal) sVal.innerText = val.toFixed(2);
        });

        if (tSlider) tSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (window.synthChannels && window.synthChannels[i]) {
                window.synthChannels[i].params.threshold = val;
                if (tVal) tVal.innerText = val.toFixed(2) + 'x';
                if (typeof window.debouncedHardwareSync === 'function') window.debouncedHardwareSync(i);
            }
        });

        if (wSlider) wSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            if (window.synthChannels && window.synthChannels[i]) {
                window.synthChannels[i].params.sampleSize = val;
                if (wVal) wVal.innerText = val;
                if (typeof window.debouncedHardwareSync === 'function') window.debouncedHardwareSync(i);
            }
        });

        if (fBtn) fBtn.addEventListener('click', (e) => {
            if (chData[i]) {
                chData[i].config.freeze = !chData[i].config.freeze;
                e.currentTarget.style.background = chData[i].config.freeze ? '#ff3333' : 'transparent';
                e.currentTarget.style.color = chData[i].config.freeze ? '#fff' : '#888';
                e.currentTarget.style.borderColor = chData[i].config.freeze ? '#ff3333' : '#444';
            }
        });

        if (cBtn) cBtn.addEventListener('click', (e) => {
            if (chData[i]) {
                chData[i].waveBuffer = [];
                chData[i].vizBuffer = [];
                chData[i].history = [];
                chData[i].notes = [];
                chData[i].frozenWaveBuffer = null;
                chData[i].frozenVizBuffer = null;
                chData[i].peak = { val: 0, time: 0, vel: 0 };
            }
            const focusValEl = document.getElementById(`focus-val-${i}`);
            if (focusValEl) focusValEl.textContent = '--';
            const btn = e.currentTarget;
            btn.style.background = 'var(--red)';
            btn.style.color = '#fff';
            setTimeout(() => { btn.style.background = 'transparent'; btn.style.color = 'var(--red)'; }, 200);
        });
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.hud-settings-wrapper')) {
            document.querySelectorAll('.hud-settings-wrapper.is-open').forEach(el => el.classList.remove('is-open'));
        }
    });

    sCtxs = [0, 1, 2, 3].map(i => { const el = document.getElementById(`scope-${i}`); return el ? el.getContext('2d') : null; });
    rCtxs = [0, 1, 2, 3].map(i => { const el = document.getElementById(`roll-${i}`); return el ? el.getContext('2d') : null; });

    if (typeof window.initThreshMaxDrag === 'function') {
        window.initThreshMaxDrag();
    }
    window.applyDashboardViewMode();
    window.refreshAllSensorHUDs();
}

function hexToRgba(hex, alpha) {
    const clean = String(hex || '#00f0ff').replace('#', '');
    const full = clean.length === 3
        ? clean.split('').map(c => c + c).join('')
        : clean.padEnd(6, '0').slice(0, 6);
    const num = parseInt(full, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

window.triggerDensityVisualizer = function(chIdx, type, pitch = null, velocity = 85, durationMs = 260) {
    if (!chData[chIdx]) return;
    if (!chData[chIdx].densityEvents) chData[chIdx].densityEvents = [];
    const p = (window.synthChannels && window.synthChannels[chIdx] && window.synthChannels[chIdx].params)
        ? window.synthChannels[chIdx].params
        : (window.defaultParams || {});
    const minN = p.minNote ?? 36;
    const maxN = p.maxNote ?? 84;
    let resolvedPitch = (pitch !== null && pitch !== undefined && !isNaN(Number(pitch))) ? Number(pitch) : null;
    if (resolvedPitch === null) {
        const wb = chData[chIdx].waveBuffer;
        const b = chData[chIdx].bounds;
        if (wb && wb.length > 0 && b && b.max > b.min) {
            const latestR = wb[wb.length - 1].r || 0;
            const norm = Math.max(0, Math.min(1, (latestR - b.min) / Math.max(0.5, b.max - b.min)));
            resolvedPitch = Math.round(minN + norm * (maxN - minN));
        } else {
            resolvedPitch = Math.round((minN + maxN) * 0.5);
        }
    }
    chData[chIdx].densityEvents.push({
        type: type === 'pass' ? 'pass' : 'drop',
        t: Date.now(),
        pitch: resolvedPitch,
        vel: Number(velocity) || 85,
        dur: Number(durationMs) || 260
    });
    if (chData[chIdx].densityEvents.length > 260) {
        chData[chIdx].densityEvents.splice(0, chData[chIdx].densityEvents.length - 260);
    }
};

const vuMeterBallistics = {};
let vuScratchBuf = null;

function sampleAnalyserPeak(analyser, gainBoost = 1.0) {
    if (!analyser) return 0;
    const len = analyser.frequencyBinCount;
    if (!vuScratchBuf || vuScratchBuf.length !== len) {
        vuScratchBuf = new Uint8Array(len);
    }
    analyser.getByteTimeDomainData(vuScratchBuf);
    let max = 0;
    for (let j = 0; j < len; j++) {
        const v = Math.abs(vuScratchBuf[j] - 128);
        if (v > max) max = v;
    }
    return Math.min(1.0, (max / 128) * gainBoost);
}

function drawVerticalVuMeter(canvasId, analyser, baseColor, nowMs, opts = {}) {
    const vu = document.getElementById(canvasId);
    if (!vu || !analyser || !resizeCanvasToDisplaySize(vu)) return;

    const rawLevel = sampleAnalyserPeak(analyser, opts.gainBoost || 1.15);
    let st = vuMeterBallistics[canvasId];
    if (!st) {
        st = { val: 0, peak: 0, peakTime: 0 };
        vuMeterBallistics[canvasId] = st;
    }

    if (rawLevel > st.val) {
        st.val += (rawLevel - st.val) * 0.55;
    } else {
        st.val += (rawLevel - st.val) * 0.16;
        if (st.val < 0.004) st.val = 0;
    }

    if (st.val >= st.peak) {
        st.peak = st.val;
        st.peakTime = nowMs;
    } else if (nowMs - st.peakTime > 480) {
        st.peak = Math.max(st.val, st.peak - 0.025);
    }

    const w = vu.width;
    const h = vu.height;
    const ctx = vu.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    // Subtle dB tick marks
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    for (let t = 0.25; t < 1.0; t += 0.25) {
        ctx.fillRect(0, Math.round(h * t), w, 1);
    }

    const fillH = Math.round(st.val * h);
    if (fillH > 0) {
        const hotThreshold = opts.hotThreshold || 0.88;
        const hotZoneH = Math.round((1 - hotThreshold) * h);
        const yTop = h - fillH;

        ctx.fillStyle = baseColor;
        ctx.fillRect(0, Math.max(hotZoneH, yTop), w, h - Math.max(hotZoneH, yTop));

        if (yTop < hotZoneH) {
            ctx.fillStyle = opts.hotColor || '#ff0055';
            ctx.fillRect(0, yTop, w, hotZoneH - yTop);
        }
    }

    if (st.peak > 0.02) {
        const peakY = Math.max(0, Math.min(h - 2, Math.round(h - st.peak * h)));
        ctx.fillStyle = st.peak >= (opts.hotThreshold || 0.88) ? '#ff0055' : '#ffffff';
        ctx.fillRect(0, peakY, w, 2);
    }
}

function renderLoop() {
    requestAnimationFrame(renderLoop);
    try {
        const nowMs = Date.now();
        if (nowMs - lastRenderTime < 33) return;
        lastRenderTime = nowMs;
        const nowAudio = (typeof audioCtx !== 'undefined') ? audioCtx.currentTime : 0;

        // Beat Clock Flash on TAP Button (Green on Beat 1, Cyan/White on Beats 2–4)
        if (window.bioClock && typeof window.bioClock.getState === 'function') {
            const clk = window.bioClock.getState();
            const tapBtn = document.getElementById('btn-tap-tempo');
            if (tapBtn) {
                const beatSec = 60 / Math.max(20, clk.bpm || 120);
                const flashDuty = Math.max(0.22, Math.min(0.32, 0.13 / beatSec));
                const inFlashWindow = Boolean(clk.running && clk.beatPhase < flashDuty);
                tapBtn.classList.toggle('is-beat-one', inFlashWindow && Boolean(clk.isDownbeat));
                tapBtn.classList.toggle('is-beat-pulse', inFlashWindow && !clk.isDownbeat);
            }
        }

        if (typeof synthChannels !== 'undefined') {
            for (let i = 0; i < 4; i++) {
                if (synthChannels[i] && synthChannels[i].analyser) {
                    drawVerticalVuMeter(`vu-${i}`, synthChannels[i].analyser, window.CH_COLORS[i], nowMs, {
                        gainBoost: 1.15,
                        hotThreshold: 0.90
                    });
                }
            }
        }

        if (window.masterFX && window.masterFX.fxAnalyser) {
            drawVerticalVuMeter('vu-fx', window.masterFX.fxAnalyser, '#ff8c00', nowMs, {
                gainBoost: 1.35,
                hotThreshold: 0.84,
                hotColor: '#ff0055'
            });
        }

        if (window.masterAnalyser) {
            drawVerticalVuMeter('master-vu-vt', window.masterAnalyser, '#00f0ff', nowMs, {
                gainBoost: 1.35,
                hotThreshold: 0.90,
                hotColor: '#ff0055'
            });

            const mVu = document.getElementById('master-vu-hz');
            if (mVu && resizeCanvasToDisplaySize(mVu)) {
                const mPeak = sampleAnalyserPeak(window.masterAnalyser, 1.5);
                const fill = Math.min(mVu.width, mPeak * mVu.width);
                const ctx = mVu.getContext('2d');
                ctx.clearRect(0, 0, mVu.width, mVu.height);
                const threshPx = mVu.width * 0.92;
                ctx.fillStyle = '#00f0ff';
                ctx.fillRect(0, 0, Math.min(fill, threshPx), mVu.height);
                if (fill > threshPx) {
                    ctx.fillStyle = '#ff0055';
                    ctx.fillRect(threshPx, 0, fill - threshPx, mVu.height);
                }
            }
        }

        if (typeof synthChannels !== 'undefined' && synthChannels[activeSynthIndex] && synthChannels[activeSynthIndex].params) {
            const p = synthChannels[activeSynthIndex].params;
            const lfos = [
                { key: 'pitchLfo', id: 'ind-lfo-pitchLfo' },
                { key: 'filterLfo', id: 'ind-lfo-filterLfo' },
                { key: 'ampLfo', id: 'ind-lfo-ampLfo' }
            ];
            lfos.forEach(lfo => {
                const config = p[lfo.key];
                if (config && config.rate !== undefined) {
                    const phase = (nowAudio * config.rate) % 1.0;
                    let bright = 0;
                    if (config.shape === 'sine') bright = (Math.sin(phase * Math.PI * 2) + 1) / 2;
                    else if (config.shape === 'square') bright = phase < 0.5 ? 1 : 0;
                    else if (config.shape === 'triangle') bright = phase < 0.5 ? phase * 2 : 2 - (phase * 2);
                    else if (config.shape === 'sawtooth') bright = phase;
                    else if (config.shape === 'rampdown') bright = 1 - phase;
                    else if (config.shape === 'random') bright = Math.random();
                    const ledEl = document.getElementById(lfo.id);
                    if (ledEl) ledEl.style.opacity = 0.1 + (bright * (config.depth > 0 ? 0.9 : 0.25));
                }
            });
        }

        if (typeof synthChannels !== 'undefined') {
            synthChannels.forEach(ch => {
                if (!ch || !ch.params) return;
                if (!ch.shState) ch.shState = { pitch: 0, filter: 0, amp: 0 };
                const p = ch.params;
                ['pitch', 'filter', 'amp'].forEach(dest => {
                    const lfoParam = p[`${dest}Lfo`];
                    const lfoRate = lfoParam ? Math.max(0.05, Number(lfoParam.rate) || 1) : 1;
                    const lfoDepth = lfoParam ? Math.max(0, Math.min(1, Number(lfoParam.depth) || 0)) : 0;
                    if (lfoParam && lfoParam.shape === 'random' && nowMs - ch.shState[dest] > (1000 / lfoRate)) {
                        ch.shState[dest] = nowMs;
                        const shVal = (Math.random() * 2) - 1;
                        if (dest === 'pitch' && ch.voices) {
                            ch.voices.forEach(v => { if (v && v.sources && v.sources.osc1 && v.sources.osc1.detuneNode) v.sources.osc1.detuneNode.setTargetAtTime(shVal * lfoDepth * 200, nowAudio, 0.02); });
                        } else if (dest === 'filter' && ch.voices) {
                            ch.voices.forEach(v => { if (v && v.vcf && v.vcf.detune) v.vcf.detune.setTargetAtTime(shVal * lfoDepth * 2000, nowAudio, 0.02); });
                        } else if (dest === 'amp' && ch.ampLfoNode) {
                            ch.ampLfoNode.gain.setTargetAtTime(Math.max(0, (1.0 - lfoDepth * 0.5) + (shVal * lfoDepth * 0.5)), nowAudio, 0.02);
                        }
                    }
                });
            });
        }

        for (let i = 0; i < 4; i++) {
            if (!sCtxs[i] || !chData[i]) continue;
            const ch = chData[i];

            if (!ch.waveBuffer) ch.waveBuffer = [];
            if (!ch.config) ch.config = { zoom: 500, smooth: 0.05, freeze: false };
            if (!ch.bounds) ch.bounds = { min: 0, max: 10 };
            if (!ch.densityEvents) ch.densityEvents = [];
            if (!ch.notes) ch.notes = [];
            if (!ch.history) ch.history = [];
            if (!ch.acc || ch.acc.lastSec === undefined) ch.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: nowMs };

            if (ch.waveBuffer.length > 120000) {
                ch.waveBuffer.splice(0, ch.waveBuffer.length - 108000);
            }

            if (ch.config.freeze) {
                if (!ch.frozenWaveBuffer) ch.frozenWaveBuffer = [...ch.waveBuffer];
                if (!ch.frozenVizBuffer) ch.frozenVizBuffer = ch.vizBuffer ? [...ch.vizBuffer] : [];
            } else {
                ch.frozenWaveBuffer = null;
                ch.frozenVizBuffer = null;
            }

            const renderWave = ch.config.freeze ? ch.frozenWaveBuffer : ch.waveBuffer;
            const renderViz = ch.config.freeze ? ch.frozenVizBuffer : (ch.vizBuffer || []);

            const sCtx = sCtxs[i], rCtx = rCtxs[i];
            const sw = sCtx.canvas.clientWidth, sh = sCtx.canvas.clientHeight;
            const rw = rCtx.canvas.clientWidth, rh = rCtx.canvas.clientHeight;

            const metricMeta = window.getChannelMetricMeta(i);
            window.syncChannelHudLabels(i);

            // Update mini focus readout and periodic sensor HUD sync even when card is hidden or scope is idle
            const focusValEl = document.getElementById(`focus-val-${i}`);
            if (renderWave.length > 0) {
                const latestVal = renderWave[renderWave.length - 1].r ?? 0;
                if (focusValEl) {
                    const formattedFocus = (window.BioQuadCore && typeof window.BioQuadCore.formatChannelMetricValue === 'function')
                        ? window.BioQuadCore.formatChannelMetricValue(latestVal, metricMeta, true)
                        : (metricMeta.isBiodata !== false ? `${latestVal.toFixed(1)} \u00B5S` : latestVal.toFixed(1));
                    if (focusValEl.textContent !== formattedFocus) {
                        focusValEl.textContent = formattedFocus;
                    }
                }
            } else if (focusValEl && focusValEl.textContent !== '--') {
                focusValEl.textContent = '--';
            }
            if (!ch._lastEnvHudSync || nowMs - ch._lastEnvHudSync > 500) {
                ch._lastEnvHudSync = nowMs;
                window.refreshChannelSensorHUD(i);
            }

            if (sw === 0 || sh === 0) continue;
            if (sCtx.canvas.width !== sw) sCtx.canvas.width = sw;
            if (sCtx.canvas.height !== sh) sCtx.canvas.height = sh;
            if (rCtx.canvas.width !== rw) rCtx.canvas.width = rw;
            if (rCtx.canvas.height !== rh) rCtx.canvas.height = rh;

            sCtx.clearRect(0, 0, sw, sh);

            const displayCount = Math.min(ch.config.zoom, renderWave.length);
            let avgVal = 0;

            let rawMinTrack = 1000000, rawMaxTrack = -1000000;
            let targetMin = 1000000, targetMax = -1000000, sum = 0, sumCount = 0;
            const binnedData = [];

            if (displayCount > 1) {
                const startIndex = renderWave.length - displayCount;
                const smoothAlpha = Math.max(0.01, Math.min(1.0, Number(ch.config.smooth) || 0.05));

                const requiredPreWarm = Math.min(500, Math.floor(5.0 / smoothAlpha));
                const preWarmIndex = Math.max(0, startIndex - requiredPreWarm);

                let seedSum = 0, seedCount = 0;
                for (let j = 0; j < 20 && (preWarmIndex + j) < renderWave.length; j++) {
                    if (isFinite(renderWave[preWarmIndex + j].r)) {
                        seedSum += renderWave[preWarmIndex + j].r;
                        seedCount++;
                    }
                }
                let currentEma1 = seedCount > 0 ? (seedSum / seedCount) : (ch.ema ?? 0);
                let currentEma2 = currentEma1;

                for (let j = preWarmIndex; j < startIndex; j++) {
                    const rawVal = renderWave[j].r;
                    if (isFinite(rawVal)) {
                        currentEma1 = (rawVal * smoothAlpha) + (currentEma1 * (1 - smoothAlpha));
                        currentEma2 = (currentEma1 * smoothAlpha) + (currentEma2 * (1 - smoothAlpha));
                    }
                }

                const pointsPerPixel = displayCount / sw;

                for (let px = 0; px < sw; px++) {
                    const chunkStart = Math.floor(px * pointsPerPixel);
                    let chunkEnd = Math.floor((px + 1) * pointsPerPixel);
                    if (chunkEnd <= chunkStart) chunkEnd = chunkStart + 1;
                    if (chunkEnd > displayCount) chunkEnd = displayCount;

                    let binMin = 1000000, binMax = -1000000;
                    let rawMin = 1000000, rawMax = -1000000;

                    for (let j = chunkStart; j < chunkEnd; j++) {
                        let rawVal = renderWave[startIndex + j].r ?? currentEma1;
                        if (!isFinite(rawVal)) rawVal = currentEma1;

                        if (rawVal < rawMin) rawMin = rawVal;
                        if (rawVal > rawMax) rawMax = rawVal;

                        currentEma1 = (rawVal * smoothAlpha) + (currentEma1 * (1 - smoothAlpha));
                        currentEma2 = (currentEma1 * smoothAlpha) + (currentEma2 * (1 - smoothAlpha));
                        if (isNaN(currentEma2)) currentEma2 = 0;

                        sum += currentEma2;
                        sumCount++;

                        if (currentEma2 < binMin) binMin = currentEma2;
                        if (currentEma2 > binMax) binMax = currentEma2;
                    }

                    if (chunkStart < chunkEnd) {
                        binnedData.push({ x: px, yMin: binMin, yMax: binMax, rawMin, rawMax });
                        if (rawMin < rawMinTrack) rawMinTrack = rawMin;
                        if (rawMax > rawMaxTrack) rawMaxTrack = rawMax;
                        if (binMin < targetMin) targetMin = binMin;
                        if (binMax > targetMax) targetMax = binMax;
                    }
                }
                avgVal = sumCount > 0 ? (sum / sumCount) : 0;

                if (rawMinTrack > rawMaxTrack) { rawMinTrack = 0; rawMaxTrack = 10; }
                if (targetMin > targetMax) { targetMin = 0; targetMax = 10; }

                // --- PASS 1 AXIS: RAW GHOST JITTER ---
                let rSpan = rawMaxTrack - rawMinTrack;
                if (rSpan < 0.1) {
                    const center = rawMinTrack + (rSpan / 2);
                    rawMinTrack = center - 0.5;
                    rawMaxTrack = center + 0.5;
                    rSpan = 1.0;
                }
                const paddedRawMin = rawMinTrack - (rSpan * 0.05);
                const paddedRawRange = rSpan * 1.1;
                const getPathY_Raw = (val) => sh - ((val - paddedRawMin) / paddedRawRange * sh);

                // --- PASS 2 AXIS: SMOOTH CHANNEL TREND ---
                const targetRange = targetMax - targetMin;
                if (targetRange < 2.0) {
                    const center = targetMin + (targetRange / 2);
                    targetMin = center - 1.0;
                    targetMax = center + 1.0;
                }

                const maxDiff = Math.abs(targetMax - ch.bounds.max);
                const isDramaticallyOff = maxDiff > (Math.abs(ch.bounds.max) * 0.75 + 5);
                if (ch.boundsNeedSnap || (ch.bounds.max <= 10 && targetMax > 40) || isDramaticallyOff) {
                    ch.bounds.min = targetMin;
                    ch.bounds.max = targetMax;
                    ch.boundsNeedSnap = false;
                } else {
                    ch.bounds.min = (ch.bounds.min * 0.93) + (targetMin * 0.07);
                    ch.bounds.max = (ch.bounds.max * 0.93) + (targetMax * 0.07);
                }

                if (!Number.isFinite(ch.bounds.min) || !Number.isFinite(ch.bounds.max)) {
                    ch.bounds.min = targetMin;
                    ch.bounds.max = targetMax;
                }
                const range = Math.max(0.1, ch.bounds.max - ch.bounds.min);
                const paddedMin = ch.bounds.min - (range * 0.1);
                const paddedRange = Math.max(0.1, range * 1.2);
                const getPathY_Smooth = (val) => sh - ((val - paddedMin) / paddedRange * sh);

                // --- PASS 1: RAW GHOST JITTER ---
                sCtx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
                sCtx.lineWidth = 1;
                sCtx.beginPath();
                if (binnedData.length > 0) {
                    sCtx.moveTo(binnedData[0].x, getPathY_Raw(binnedData[0].rawMax));
                    for (let b = 1; b < binnedData.length; b++) {
                        sCtx.lineTo(binnedData[b].x, getPathY_Raw(binnedData[b].rawMax));
                        if (binnedData[b].rawMax - binnedData[b].rawMin > (rSpan * 0.005)) {
                            sCtx.lineTo(binnedData[b].x, getPathY_Raw(binnedData[b].rawMin));
                            sCtx.moveTo(binnedData[b].x, getPathY_Raw(binnedData[b].rawMax));
                        }
                    }
                }
                sCtx.stroke();

                // --- PASS 2: SMOOTH CHANNEL TREND ---
                sCtx.strokeStyle = window.CH_COLORS[i];
                sCtx.lineWidth = 2.5;
                sCtx.lineJoin = "round";
                sCtx.lineCap = "round";
                sCtx.beginPath();
                if (binnedData.length > 0) {
                    sCtx.moveTo(binnedData[0].x, getPathY_Smooth((binnedData[0].yMin + binnedData[0].yMax) / 2));
                    for (let b = 1; b < binnedData.length; b++) {
                        const yMid = getPathY_Smooth((binnedData[b].yMin + binnedData[b].yMax) / 2);
                        sCtx.lineTo(binnedData[b].x, yMid);
                    }
                }
                sCtx.stroke();

                // --- PASS 3: NOTE HIGHLIGHTS ---
                const step = Math.max(1, Math.floor(displayCount / (sw > 0 ? sw : 500)));
                for (let j = 0; j < displayCount; j += step) {
                    let hasEvent = false, eventNote = null;
                    for (let k = 0; k < step && (j + k) < displayCount; k++) {
                        const pt = renderWave[startIndex + j + k];
                        if (pt.evt === 1 && pt.n) { hasEvent = true; eventNote = pt.n; break; }
                    }
                    if (hasEvent && eventNote) {
                        const x = j * (sw / (displayCount - 1));
                        sCtx.save();
                        sCtx.strokeStyle = `hsla(${(eventNote % 12) * 30}, 100%, 50%, 0.7)`;
                        sCtx.lineWidth = 1;
                        sCtx.beginPath();
                        sCtx.moveTo(x, 0);
                        sCtx.lineTo(x, sh);
                        sCtx.stroke();
                        sCtx.restore();
                    }
                }

                if (!ch.lastHudTime || nowMs - ch.lastHudTime > 200) {
                    ch.lastHudTime = nowMs;
                    const curVal = renderWave[renderWave.length - 1].r ?? 0;
                    const curTicks = renderWave.length > 0 ? renderWave[renderWave.length - 1].ticks : 0;
                    const isBio = metricMeta.isBiodata !== false;
                    const Core = window.BioQuadCore;

                    if (renderViz && renderViz.length > 1) {
                        const vLen = renderViz.length;
                        ch.slew = renderViz[vLen - 1] - renderViz[vLen - 2];
                    }

                    const valEl = document.getElementById(`hud-val-${i}`);
                    const kOhmEl = document.getElementById(`hud-kohm-${i}`);
                    const ticksEl = document.getElementById(`hud-ticks-${i}`);
                    const slewIconEl = document.getElementById(`hud-slew-icon-${i}`);
                    const slewValEl = document.getElementById(`hud-slew-val-${i}`);
                    const colEl = document.getElementById(`hud-slew-color-${i}`);

                    if (isBio) {
                        const kOhm = curVal > 0 ? (1000 / curVal) : 0;
                        const slw = (ch.slew || 0) * 100;
                        if (valEl) valEl.innerText = curVal.toFixed(1);
                        if (kOhmEl) kOhmEl.innerText = kOhm.toFixed(1);
                        if (ticksEl) ticksEl.innerText = Math.round(curTicks);
                        if (slewIconEl && slewValEl) {
                            slewIconEl.innerText = slw > 0.1 ? '↑' : (slw < -0.1 ? '↓' : '~');
                            slewValEl.innerText = Math.abs(slw).toFixed(2);
                            if (colEl) colEl.style.color = slw > 0.1 ? window.CH_COLORS[i] : (slw < -0.1 ? '#ff0055' : '#888');
                        }
                    } else {
                        const fmtNum = (n) => (Core && typeof Core.formatChannelMetricValue === 'function')
                            ? Core.formatChannelMetricValue(n, metricMeta, false)
                            : Number(n || 0).toFixed(1);
                        const stdevVal = ch.rawStdev !== undefined ? ch.rawStdev : (ch.lastStdevi || 0);
                        const rawDelta = ch.slew || 0;
                        const deadzone = Math.max(1e-4, stdevVal * 0.05);
                        if (valEl) valEl.innerText = fmtNum(curVal);
                        if (ticksEl) ticksEl.innerText = fmtNum(stdevVal);
                        if (slewIconEl && slewValEl) {
                            slewIconEl.innerText = rawDelta > deadzone ? '↑' : (rawDelta < -deadzone ? '↓' : '~');
                            slewValEl.innerText = fmtNum(Math.abs(rawDelta));
                            if (colEl) colEl.style.color = rawDelta > deadzone ? window.CH_COLORS[i] : (rawDelta < -deadzone ? '#ff0055' : '#888');
                        }
                    }
                }
            }

            sCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            sCtx.lineWidth = 1;
            sCtx.beginPath();
            for (let g = 1; g < 4; g++) { sCtx.moveTo(0, sh * (g / 4)); sCtx.lineTo(sw, sh * (g / 4)); }
            for (let g = 1; g < 10; g++) { sCtx.moveTo(sw * (g / 10), 0); sCtx.lineTo(sw * (g / 10), sh); }
            sCtx.stroke();

            const fmtAxis = (v) => (metricMeta.isBiodata === false && window.BioQuadCore && typeof window.BioQuadCore.formatChannelMetricValue === 'function')
                ? window.BioQuadCore.formatChannelMetricValue(v, metricMeta, false)
                : Number(v || 0).toFixed(1);
            sCtx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            sCtx.font = '11px monospace';
            sCtx.textAlign = 'left';
            sCtx.textBaseline = 'top';
            sCtx.fillText(`MAX: ${fmtAxis(ch.bounds.max)}`, 5, 5);
            sCtx.fillText(`AVG: ${fmtAxis(avgVal)}`, 5, 19);
            sCtx.textBaseline = 'bottom';
            sCtx.fillText(`MIN: ${fmtAxis(ch.bounds.min)}`, 5, sh - 5);

            rCtx.clearRect(0, 0, rw, rh);
            rCtx.strokeStyle = '#30363d';
            rCtx.lineWidth = 1;
            for (let j = 0; j < 12; j++) {
                rCtx.beginPath();
                rCtx.moveTo(0, j * (rh / 12));
                rCtx.lineTo(rw, j * (rh / 12));
                rCtx.stroke();
            }

            const validHist = ch.history ? ch.history.filter(h => h && isFinite(h.avg)) : [];
            if (validHist.length > 1) {
                let hMin = Infinity, hMax = -Infinity;
                validHist.forEach(h => { if (h.min < hMin) hMin = h.min; if (h.max > hMax) hMax = h.max; });
                const hRange = hMax - hMin || 1;
                const pMin = hMin - (hRange * 0.05);
                const pRange = hRange * 1.1;
                const getY = (val) => rh - ((val - pMin) / pRange * rh);

                rCtx.fillStyle = window.CH_COLORS[i] + '33';
                rCtx.beginPath();
                for (let j = 0; j < validHist.length; j++) {
                    const x = rw - ((validHist.length - 1 - j) * (rw / 300));
                    if (j === 0) rCtx.moveTo(x, getY(validHist[j].max));
                    else rCtx.lineTo(x, getY(validHist[j].max));
                }
                for (let j = validHist.length - 1; j >= 0; j--) {
                    const x = rw - ((validHist.length - 1 - j) * (rw / 300));
                    rCtx.lineTo(x, getY(validHist[j].min));
                }
                rCtx.fill();

                rCtx.strokeStyle = '#ffffff';
                rCtx.lineWidth = 1.5;
                rCtx.beginPath();
                for (let j = 0; j < validHist.length; j++) {
                    const x = rw - ((validHist.length - 1 - j) * (rw / 300));
                    if (j === 0) rCtx.moveTo(x, getY(validHist[j].avg));
                    else rCtx.lineTo(x, getY(validHist[j].avg));
                }
                rCtx.stroke();
            }

            if (ch.notes) {
                ch.notes = ch.notes.filter(n => nowMs - n.t < Math.max(30000, n.dur + 1000));
                ch.notes.forEach(note => {
                    rCtx.fillStyle = `hsla(${(note.n % 12) * 30}, 100%, 50%, ${Math.max(0.3, note.v / 127)})`;
                    const visDur = note.dur;
                    const w = Math.max(2, (visDur / 30000) * rw);
                    rCtx.fillRect(rw - ((nowMs - note.t) / 30000 * rw) - w, Math.max(0, rh - ((note.n / 127) * rh) - 4), w, 8);
                });
            }

            // --- ZERO-PARALLAX THRESHOLD CONTROL METER ---
            const miniTC = document.getElementById(`ch-mini-vu-thresh-${i}`);
            if (miniTC && resizeCanvasToDisplaySize(miniTC) && window.synthChannels[i] && window.synthChannels[i].params) {
                const ctx = miniTC.getContext('2d');
                const w = miniTC.width, h = miniTC.height;
                ctx.clearRect(0, 0, w, h);

                const minMult = 1.0;
                const maxMult = Math.max(1.0, Math.min(10.0, window.synthChannels[i].params.threshMax || 5.0));
                const threshVal = Math.max(1.0, Math.min(maxMult, window.synthChannels[i].params.threshold));
                const span = Math.max(0.01, maxMult - minMult);
                const threshPct = Math.max(0, Math.min(1, (threshVal - minMult) / span));

                const currentMult = (ch.lastStdevi > 0) ? (ch.lastMaxDev / ch.lastStdevi) : 0;
                const targetPct = Math.max(0, Math.min(1, (currentMult - minMult) / span));

                if (ch.vizDeltaPct === undefined) ch.vizDeltaPct = 0;

                if (targetPct > ch.vizDeltaPct) {
                    ch.vizDeltaPct += (targetPct - ch.vizDeltaPct) * 0.35;
                } else {
                    ch.vizDeltaPct += (targetPct - ch.vizDeltaPct) * 0.06;
                }

                if (!ch.peak) ch.peak = { val: 0, time: 0, vel: 0 };
                if (ch.vizDeltaPct > ch.peak.val) {
                    ch.peak.val = ch.vizDeltaPct;
                    ch.peak.time = nowMs;
                    ch.peak.vel = 0;
                } else if (nowMs - ch.peak.time > 400) {
                    ch.peak.vel += 0.001;
                    ch.peak.val -= ch.peak.vel;
                    if (ch.peak.val < 0) { ch.peak.val = 0; ch.peak.vel = 0; }
                }
                const chColor = window.CH_COLORS[i] || '#00f0ff';

                const thumbW = 6;
                const trackW = Math.max(1, w - thumbW);
                const getX = (pct) => (thumbW / 2) + (pct * trackW);

                const threshX = getX(threshPct);
                const signalX = getX(ch.vizDeltaPct);
                const peakX = getX(ch.peak.val);

                ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
                ctx.fillRect(0, 0, w, h);

                const baseFillX = Math.min(signalX, threshX);
                ctx.globalAlpha = 0.2;
                ctx.fillStyle = chColor;
                ctx.fillRect(0, 0, baseFillX, h);

                if (signalX > threshX) {
                    const grd = ctx.createLinearGradient(threshX, 0, signalX, 0);
                    grd.addColorStop(0, chColor);
                    grd.addColorStop(1, '#ffffff');
                    ctx.globalAlpha = 0.65;
                    ctx.fillStyle = grd;
                    ctx.fillRect(threshX, 0, signalX - threshX, h);
                }

                ctx.globalAlpha = 1.0;
                ctx.fillStyle = chColor;
                ctx.fillRect(Math.max(0, signalX - 1), 0, 1.5, h);

                if (ch.peak.val > 0) {
                    const isOver = (ch.peak.val > threshPct);
                    ctx.fillStyle = isOver ? '#ffffff' : chColor;
                    ctx.globalAlpha = isOver ? 1.0 : 0.6;
                    if (isOver) { ctx.shadowBlur = 5; ctx.shadowColor = chColor; }
                    ctx.fillRect(Math.max(0, peakX - 1), h * 0.25, 2, h * 0.5);
                    ctx.shadowBlur = 0;
                }

                ctx.globalAlpha = 0.9;
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(Math.round(threshX), 0, 1.5, h);

                ctx.globalAlpha = 0.15;
                for (let t = 0.2; t < 1.0; t += 0.2) {
                    const tx = getX(t);
                    ctx.fillRect(Math.round(tx), h - 3, 1, 3);
                }
                ctx.globalAlpha = 1.0;
            }
        }

        if (typeof activeSynthIndex !== 'undefined' && chData[activeSynthIndex]) {
            const actCh = chData[activeSynthIndex];
            const cColor = window.CH_COLORS[activeSynthIndex] || '#fff';
            const dC = document.getElementById('vu-density');
            if (dC && resizeCanvasToDisplaySize(dC)) {
                const ctx = dC.getContext('2d');
                const w = dC.width;
                const h = dC.height;
                const windowMs = 4200;

                ctx.clearRect(0, 0, w, h);

                // Subtle pitch-band guides + right-edge arrival marker
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, Math.round(h * 0.25) + 0.5);
                ctx.lineTo(w, Math.round(h * 0.25) + 0.5);
                ctx.moveTo(0, Math.round(h * 0.5) + 0.5);
                ctx.lineTo(w, Math.round(h * 0.5) + 0.5);
                ctx.moveTo(0, Math.round(h * 0.75) + 0.5);
                ctx.lineTo(w, Math.round(h * 0.75) + 0.5);
                ctx.stroke();

                const activeParams = (window.synthChannels && window.synthChannels[activeSynthIndex] && window.synthChannels[activeSynthIndex].params)
                    ? window.synthChannels[activeSynthIndex].params
                    : (window.defaultParams || {});
                const minN = activeParams.minNote ?? 36;
                const maxN = Math.max(minN + 1, activeParams.maxNote ?? 84);
                const padY = 4.5;
                const usableH = Math.max(4, h - padY * 2);
                const pitchToY = (nVal) => {
                    const clamped = Math.max(minN, Math.min(maxN, Number(nVal) || Math.round((minN + maxN) * 0.5)));
                    const norm = (clamped - minN) / Math.max(1, maxN - minN);
                    return padY + (1 - norm) * usableH;
                };

                if (actCh.densityEvents && actCh.densityEvents.length > 0) {
                    actCh.densityEvents = actCh.densityEvents.filter(e => (nowMs - e.t) < windowMs);
                    const evts = actCh.densityEvents;

                    // Pass 1: Unsounded / gated-out candidate notes (smaller muted grey pips + faint short wisps)
                    for (let k = 0; k < evts.length; k++) {
                        const e = evts[k];
                        if (e.type !== 'drop') continue;
                        const age = nowMs - e.t;
                        const ageFrac = Math.max(0, Math.min(1, age / windowMs));
                        const x = (w - 4) - ageFrac * (w - 8);
                        const y = pitchToY(e.pitch);
                        const alpha = Math.max(0.08, (1 - ageFrac) * 0.75);
                        const wispLen = Math.min(11, Math.max(5, w * 0.045));
                        const xTail = Math.max(0, x - wispLen);

                        if (x > xTail + 1) {
                            const gDrop = ctx.createLinearGradient(xTail, y, x, y);
                            gDrop.addColorStop(0, 'rgba(139, 148, 158, 0)');
                            gDrop.addColorStop(1, `rgba(155, 164, 174, ${(alpha * 0.55).toFixed(3)})`);
                            ctx.fillStyle = gDrop;
                            ctx.fillRect(xTail, y - 0.8, x - xTail, 1.6);
                        }

                        ctx.fillStyle = `rgba(168, 177, 187, ${alpha.toFixed(3)})`;
                        ctx.beginPath();
                        ctx.arc(x, y, 1.65, 0, Math.PI * 2);
                        ctx.fill();
                    }

                    // Pass 2: Sounded notes (active channel color with smooth fading horizontal smears/tails)
                    for (let k = 0; k < evts.length; k++) {
                        const e = evts[k];
                        if (e.type !== 'pass') continue;
                        const age = nowMs - e.t;
                        const ageFrac = Math.max(0, Math.min(1, age / windowMs));
                        const x = (w - 4) - ageFrac * (w - 8);
                        const y = pitchToY(e.pitch);
                        const velScale = 0.74 + (Math.max(1, Math.min(127, e.vel || 85)) / 127) * 0.26;
                        const alpha = Math.max(0.12, Math.pow(1 - ageFrac, 0.85) * velScale);
                        const durMs = Math.max(130, Math.min(1400, e.dur || 280));
                        const tailLen = Math.max(16, Math.min(w * 0.34, (durMs / windowMs) * w * 1.45));
                        const xTail = Math.max(0, x - tailLen);

                        if (x > xTail + 1) {
                            const grd = ctx.createLinearGradient(xTail, y, x, y);
                            grd.addColorStop(0, hexToRgba(cColor, 0));
                            grd.addColorStop(0.55, hexToRgba(cColor, alpha * 0.38));
                            grd.addColorStop(1, hexToRgba(cColor, alpha * 0.9));
                            ctx.fillStyle = grd;
                            ctx.beginPath();
                            if (typeof ctx.roundRect === 'function') {
                                ctx.roundRect(xTail, y - 1.75, x - xTail, 3.5, 1.75);
                            } else {
                                ctx.rect(xTail, y - 1.75, x - xTail, 3.5);
                            }
                            ctx.fill();
                        }

                        ctx.fillStyle = hexToRgba(cColor, Math.min(1, alpha * 1.05));
                        ctx.beginPath();
                        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
                        ctx.fill();

                        if (age < 380) {
                            const flash = (1 - age / 380) * 0.85;
                            ctx.fillStyle = `rgba(255, 255, 255, ${flash.toFixed(3)})`;
                            ctx.beginPath();
                            ctx.arc(x, y, 1.2, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }
                }
            }
            const keys = document.querySelectorAll('.piano-wrapper div');
            if (keys && keys.length > 0) {
                keys.forEach(k => { k.style.background = ''; k.style.boxShadow = ''; });
                if (actCh.notes) {
                    actCh.notes.forEach(n => {
                        if (nowMs - n.t < 200) {
                            const keyIdx = n.n % 12;
                            const keyEl = document.getElementById(`pkey-${keyIdx}`);
                            if (keyEl) { keyEl.style.background = '#fff'; keyEl.style.boxShadow = `0 0 15px #fff`; }
                        }
                    });
                }
            }
        }
    } catch (err) {
        console.error("Visualizer Render Error:", err);
    }
}
