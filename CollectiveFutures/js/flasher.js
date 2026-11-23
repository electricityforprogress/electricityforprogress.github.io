/**
 * js/flasher.js
 * Self-contained, zero-dependency ESP32 Web Serial Firmware Uploader Portal.
 * Dynamically imports Espressif's esptool-js@0.5.4 from esm.sh on demand.
 */

(function(globalScope) {
    'use strict';

    const ESPTOOL_CDN_URL = 'https://esm.sh/esptool-js@0.5.4';
    const DEFAULT_MANIFEST_URL = './firmware/manifest.json';

    // ========================================================================
    // Pure Zero-Dependency Utilities (RFC 1321 MD5, Hex Offset Parser, Format)
    // ========================================================================

    function parseHexOffset(raw) {
        if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
            return Math.floor(raw);
        }
        const clean = String(raw ?? '').trim();
        if (!clean) return 0x0;
        const isHex = /^0x[0-9a-f]+$/i.test(clean);
        const isDec = /^\d+$/.test(clean);
        if (!isHex && !isDec) return null;
        const parsed = isHex ? parseInt(clean, 16) : parseInt(clean, 10);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0x10000000) return null;
        return parsed;
    }

    function formatHexOffset(num) {
        const val = Number.isFinite(num) && num >= 0 ? Math.floor(num) : 0;
        return '0x' + val.toString(16);
    }

    function formatBytes(bytes) {
        const n = Number(bytes) || 0;
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    }

    function uint8ToBinaryString(u8) {
        const chunkSize = 0x8000;
        const parts = [];
        for (let i = 0; i < u8.length; i += chunkSize) {
            parts.push(String.fromCharCode.apply(null, u8.subarray(i, i + chunkSize)));
        }
        return parts.join('');
    }

    function binaryInputToUint8(input) {
        if (input instanceof Uint8Array) return input;
        if (input instanceof ArrayBuffer) return new Uint8Array(input);
        const str = String(input ?? '');
        const out = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) {
            out[i] = str.charCodeAt(i) & 0xff;
        }
        return out;
    }

    // Pure RFC 1321 MD5 over Uint8Array or binary string (returns 32-char lowercase hex)
    const MD5_S = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    ];
    const MD5_K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) {
        MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
    }

    function md5Hex(input) {
        const bytes = binaryInputToUint8(input);
        const len = bytes.length;
        const bitLenLow = (len << 3) >>> 0;
        const bitLenHigh = (len >>> 29) >>> 0;

        const paddedLen = (((len + 8) >>> 6) + 1) << 6;
        const buf = new Uint8Array(paddedLen);
        buf.set(bytes);
        buf[len] = 0x80;

        const view = new DataView(buf.buffer);
        view.setUint32(paddedLen - 8, bitLenLow, true);
        view.setUint32(paddedLen - 4, bitLenHigh, true);

        let a0 = 0x67452301;
        let b0 = 0xefcdab89;
        let c0 = 0x98badcfe;
        let d0 = 0x10325476;
        const M = new Uint32Array(16);

        for (let offset = 0; offset < paddedLen; offset += 64) {
            for (let j = 0; j < 16; j++) {
                M[j] = view.getUint32(offset + (j << 2), true);
            }
            let A = a0, B = b0, C = c0, D = d0;
            for (let i = 0; i < 64; i++) {
                let F, g;
                if (i < 16) {
                    F = (B & C) | ((~B) & D);
                    g = i;
                } else if (i < 32) {
                    F = (D & B) | ((~D) & C);
                    g = (5 * i + 1) & 15;
                } else if (i < 48) {
                    F = B ^ C ^ D;
                    g = (3 * i + 5) & 15;
                } else {
                    F = C ^ (B | (~D));
                    g = (7 * i) & 15;
                }
                const tmp = D;
                D = C;
                C = B;
                const sum = (A + F + MD5_K[i] + M[g]) >>> 0;
                const shift = MD5_S[i];
                const rot = ((sum << shift) | (sum >>> (32 - shift))) >>> 0;
                B = (B + rot) >>> 0;
                A = tmp;
            }
            a0 = (a0 + A) >>> 0;
            b0 = (b0 + B) >>> 0;
            c0 = (c0 + C) >>> 0;
            d0 = (d0 + D) >>> 0;
        }

        const toHexLE = (n) => {
            let hex = '';
            for (let i = 0; i < 4; i++) {
                hex += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
            }
            return hex;
        };
        return toHexLE(a0) + toHexLE(b0) + toHexLE(c0) + toHexLE(d0);
    }

    function normalizeManifest(raw) {
        const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.builds) ? raw.builds : []);
        return list
            .filter((item) => item && typeof item === 'object' && (item.binUrl || item.url || item.path))
            .map((item, idx) => {
                const parsedOffset = parseHexOffset(item.offset ?? 0x0);
                return {
                    id: String(item.id || `build-${idx}`),
                    name: String(item.name || item.version || `Firmware Build ${idx + 1}`),
                    version: String(item.version || ''),
                    chip: String(item.chip || 'ESP32'),
                    offset: parsedOffset === null ? 0x0 : parsedOffset,
                    baudrate: Number(item.baudrate) || 460800,
                    binUrl: String(item.binUrl || item.url || item.path),
                    inoUrl: item.inoUrl ? String(item.inoUrl) : '',
                    releaseNotes: String(item.releaseNotes || item.notes || '')
                };
            });
    }

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ========================================================================
    // ESP32 Web Serial Flasher Portal Controller
    // ========================================================================

    class EspFlasherPortal {
        constructor(rootEl, options = {}) {
            this.root = rootEl;
            this.manifestUrl = options.manifestUrl || rootEl.dataset.manifestUrl || DEFAULT_MANIFEST_URL;
            this.mode = 'hosted'; // 'hosted' | 'custom'
            this.state = 'idle'; // 'idle' | 'connecting' | 'connected' | 'flashing' | 'verifying' | 'verified' | 'error'
            this.builds = [];
            this.selectedBuildId = '';
            this.customFile = null;
            this.esptoolModule = null;

            this.serialPort = null;
            this.transport = null;
            this.espLoader = null;
            this.detectedChip = '';
            this.detectedMac = '';
            this.lastMd5 = '';
            this.terminalOpen = false;
            this.webSerialSupported = Boolean(
                typeof navigator !== 'undefined' &&
                navigator.serial &&
                typeof navigator.serial.requestPort === 'function'
            );

            this.renderSkeleton();
            this.cacheElements();
            this.bindEvents();
            this.applyBrowserCheck();
            this.setState('idle');
            this.loadManifest();
        }

        renderSkeleton() {
            this.root.classList.add('esp-flasher');
            this.root.dataset.state = 'idle';
            this.root.innerHTML = `
                <div class="esp-flasher-shell">
                    <div class="esp-flasher-steps" role="list" aria-label="Firmware Update Progress">
                        <div class="esp-flasher-step" data-ef-step="idle" role="listitem">
                            <span class="esp-flasher-step-num">1</span>
                            <span>IDLE</span>
                        </div>
                        <div class="esp-flasher-step" data-ef-step="connected" role="listitem">
                            <span class="esp-flasher-step-num">2</span>
                            <span>CONNECTED</span>
                        </div>
                        <div class="esp-flasher-step" data-ef-step="flashing" role="listitem">
                            <span class="esp-flasher-step-num">3</span>
                            <span>FLASHING</span>
                        </div>
                        <div class="esp-flasher-step" data-ef-step="verified" role="listitem">
                            <span class="esp-flasher-step-num">4</span>
                            <span>VERIFIED</span>
                        </div>
                    </div>

                    <div class="esp-flasher-notice" data-ef="notice" role="status" aria-live="polite">
                        <span data-ef="notice-text"></span>
                    </div>

                    <div class="esp-flasher-grid">
                        <!-- Column 1: Firmware Selection -->
                        <div class="esp-flasher-card">
                            <div class="esp-flasher-card-head">
                                <span class="esp-flasher-card-title">Firmware Image</span>
                                <div class="esp-flasher-tabs" role="tablist" aria-label="Firmware Source Mode">
                                    <button type="button" class="esp-flasher-tab is-selected" data-ef-mode="hosted" role="tab" aria-selected="true">Hosted Builds</button>
                                    <button type="button" class="esp-flasher-tab" data-ef-mode="custom" role="tab" aria-selected="false">Custom .bin</button>
                                </div>
                            </div>

                            <!-- Hosted Builds Panel -->
                            <div data-ef="hosted-panel">
                                <label class="esp-flasher-field-label" for="ef-hosted-select">SELECT BUILD</label>
                                <select id="ef-hosted-select" class="esp-flasher-select" data-ef="hosted-select">
                                    <option value="">Loading manifest.json...</option>
                                </select>

                                <div class="esp-flasher-meta" style="margin-top: 8px;" data-ef="hosted-meta">
                                    <div class="esp-flasher-meta-line">
                                        <span>Target:</span>
                                        <span class="esp-flasher-meta-chip" data-ef="meta-chip">--</span>
                                        <span>·</span>
                                        <span>Offset:</span>
                                        <span data-ef="meta-offset">0x0</span>
                                    </div>
                                    <p class="esp-flasher-notes" data-ef="meta-notes">Fetching hosted release notes...</p>
                                </div>
                            </div>

                            <!-- Custom .bin Upload Panel -->
                            <div data-ef="custom-panel" style="display: none;">
                                <div class="esp-flasher-dropzone" data-ef="dropzone" tabindex="0" role="button" aria-label="Choose or drop local .bin firmware file">
                                    <input type="file" accept=".bin,application/octet-stream" data-ef="file-input" style="display: none;">
                                    <div class="esp-flasher-dropzone-title" data-ef="dropzone-title">Drop .bin firmware or click to browse</div>
                                    <div class="esp-flasher-dropzone-sub" data-ef="dropzone-sub">Merged ESP32 / ESP32-S3 binary image</div>
                                </div>

                                <details class="esp-flasher-details" style="margin-top: 8px;" data-ef="advanced-details">
                                    <summary>Advanced Flash Options</summary>
                                    <div class="esp-flasher-details-body">
                                        <div class="esp-flasher-adv-row">
                                            <div>
                                                <label class="esp-flasher-field-label" for="ef-offset-input">FLASH OFFSET</label>
                                                <input type="text" id="ef-offset-input" class="esp-flasher-input" data-ef="offset-input" value="0x0" placeholder="0x0" autocomplete="off">
                                            </div>
                                            <div>
                                                <label class="esp-flasher-field-label" for="ef-baud-select">FLASH BAUD</label>
                                                <select id="ef-baud-select" class="esp-flasher-select" data-ef="baud-select">
                                                    <option value="460800" selected>460800 (Fast)</option>
                                                    <option value="115200">115200 (Safe)</option>
                                                </select>
                                            </div>
                                        </div>
                                        <label class="esp-flasher-checkbox">
                                            <input type="checkbox" data-ef="erase-chk">
                                            <span>Erase Flash before writing</span>
                                        </label>
                                    </div>
                                </details>
                            </div>
                        </div>

                        <!-- Column 2: USB Connection, Chip Detection & Flash -->
                        <div class="esp-flasher-card">
                            <div class="esp-flasher-card-head">
                                <span class="esp-flasher-card-title">USB Serial Device</span>
                                <span style="font-size: 10px; color: var(--ef-muted);" data-ef="baud-pill">460800 baud</span>
                            </div>

                            <div class="esp-flasher-device-grid">
                                <div class="esp-flasher-stat">
                                    <div class="esp-flasher-stat-lbl">Detected Chip</div>
                                    <div class="esp-flasher-stat-val" data-ef="chip-val">Not connected</div>
                                </div>
                                <div class="esp-flasher-stat">
                                    <div class="esp-flasher-stat-lbl">MAC Address</div>
                                    <div class="esp-flasher-stat-val" data-ef="mac-val">--</div>
                                </div>
                            </div>

                            <div class="esp-flasher-actions">
                                <button type="button" class="esp-flasher-btn" data-ef="connect-btn">Connect Device</button>
                                <button type="button" class="esp-flasher-btn esp-flasher-btn-primary" data-ef="flash-btn" disabled>Flash Firmware</button>
                            </div>

                            <div class="esp-flasher-progress-wrap">
                                <div class="esp-flasher-progress-head">
                                    <span class="esp-flasher-progress-label" data-ef="progress-label">Ready to connect ESP32 via USB</span>
                                    <span class="esp-flasher-progress-pct" data-ef="progress-pct">0%</span>
                                </div>
                                <div class="esp-flasher-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-ef="progress-bar">
                                    <div class="esp-flasher-progress-fill" data-ef="progress-fill"></div>
                                </div>
                                <div class="esp-flasher-md5-row" data-ef="md5-row"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Collapsible Terminal Log Drawer -->
                    <div class="esp-flasher-terminal-wrap" data-ef="terminal-wrap">
                        <div class="esp-flasher-terminal-bar" data-ef="terminal-bar">
                            <button type="button" class="esp-flasher-terminal-toggle" data-ef="terminal-toggle" aria-expanded="false">
                                <span data-ef="terminal-arrow">▸</span>
                                <span>Terminal Log</span>
                                <span data-ef="terminal-count" style="color: #6e7681;">(0 lines)</span>
                            </button>
                            <div class="esp-flasher-terminal-actions">
                                <button type="button" class="esp-flasher-mini-btn" data-ef="terminal-copy">Copy</button>
                                <button type="button" class="esp-flasher-mini-btn" data-ef="terminal-clear">Clear</button>
                            </div>
                        </div>
                        <pre class="esp-flasher-terminal-log" data-ef="terminal-log"></pre>
                    </div>
                </div>
            `;
        }

        cacheElements() {
            const q = (sel) => this.root.querySelector(sel);
            this.els = {
                steps: Array.from(this.root.querySelectorAll('[data-ef-step]')),
                notice: q('[data-ef="notice"]'),
                noticeText: q('[data-ef="notice-text"]'),
                modeTabs: Array.from(this.root.querySelectorAll('[data-ef-mode]')),
                hostedPanel: q('[data-ef="hosted-panel"]'),
                customPanel: q('[data-ef="custom-panel"]'),
                hostedSelect: q('[data-ef="hosted-select"]'),
                metaChip: q('[data-ef="meta-chip"]'),
                metaOffset: q('[data-ef="meta-offset"]'),
                metaNotes: q('[data-ef="meta-notes"]'),
                dropzone: q('[data-ef="dropzone"]'),
                fileInput: q('[data-ef="file-input"]'),
                dropzoneTitle: q('[data-ef="dropzone-title"]'),
                dropzoneSub: q('[data-ef="dropzone-sub"]'),
                offsetInput: q('[data-ef="offset-input"]'),
                baudSelect: q('[data-ef="baud-select"]'),
                baudPill: q('[data-ef="baud-pill"]'),
                eraseChk: q('[data-ef="erase-chk"]'),
                chipVal: q('[data-ef="chip-val"]'),
                macVal: q('[data-ef="mac-val"]'),
                connectBtn: q('[data-ef="connect-btn"]'),
                flashBtn: q('[data-ef="flash-btn"]'),
                progressLabel: q('[data-ef="progress-label"]'),
                progressPct: q('[data-ef="progress-pct"]'),
                progressBar: q('[data-ef="progress-bar"]'),
                progressFill: q('[data-ef="progress-fill"]'),
                md5Row: q('[data-ef="md5-row"]'),
                terminalWrap: q('[data-ef="terminal-wrap"]'),
                terminalBar: q('[data-ef="terminal-bar"]'),
                terminalToggle: q('[data-ef="terminal-toggle"]'),
                terminalArrow: q('[data-ef="terminal-arrow"]'),
                terminalCount: q('[data-ef="terminal-count"]'),
                terminalCopy: q('[data-ef="terminal-copy"]'),
                terminalClear: q('[data-ef="terminal-clear"]'),
                terminalLog: q('[data-ef="terminal-log"]')
            };
            this.logLineCount = 0;
        }

        bindEvents() {
            this.els.modeTabs.forEach((btn) => {
                btn.addEventListener('click', () => {
                    if (this.state === 'flashing' || this.state === 'verifying') return;
                    this.setMode(btn.dataset.efMode);
                });
            });

            this.els.hostedSelect.addEventListener('change', () => {
                this.selectedBuildId = this.els.hostedSelect.value;
                this.renderSelectedBuildMeta();
                this.updateButtonStates();
            });

            const openPicker = () => {
                if (this.state === 'flashing' || this.state === 'verifying') return;
                this.els.fileInput.click();
            };
            this.els.dropzone.addEventListener('click', openPicker);
            this.els.dropzone.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openPicker();
                }
            });
            this.els.fileInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) this.setCustomFile(file);
            });
            ['dragenter', 'dragover'].forEach((evt) => {
                this.els.dropzone.addEventListener(evt, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.els.dropzone.classList.add('is-dragover');
                });
            });
            ['dragleave', 'drop'].forEach((evt) => {
                this.els.dropzone.addEventListener(evt, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.els.dropzone.classList.remove('is-dragover');
                });
            });
            this.els.dropzone.addEventListener('drop', (e) => {
                const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                if (file) this.setCustomFile(file);
            });

            this.els.baudSelect.addEventListener('change', () => {
                this.els.baudPill.textContent = `${this.els.baudSelect.value} baud`;
            });

            this.els.connectBtn.addEventListener('click', () => {
                if (this.espLoader) {
                    this.disconnectDevice();
                } else {
                    this.connectDevice();
                }
            });

            this.els.flashBtn.addEventListener('click', () => {
                this.flashSelectedFirmware();
            });

            this.els.terminalBar.addEventListener('click', (e) => {
                if (e.target.closest('.esp-flasher-terminal-actions')) return;
                this.toggleTerminal();
            });
            this.els.terminalClear.addEventListener('click', () => this.clearLog());
            this.els.terminalCopy.addEventListener('click', async () => {
                const text = this.els.terminalLog.textContent || '';
                if (!text) return;
                try {
                    await navigator.clipboard.writeText(text);
                    this.els.terminalCopy.textContent = 'Copied';
                    setTimeout(() => { this.els.terminalCopy.textContent = 'Copy'; }, 1400);
                } catch (_) {
                    this.log('Clipboard write unavailable in this context.');
                }
            });
        }

        applyBrowserCheck() {
            if (!this.webSerialSupported) {
                this.els.connectBtn.disabled = true;
                this.els.flashBtn.disabled = true;
                this.showNotice(
                    'Web Serial API is not supported in this browser. Please open this page in Google Chrome or Microsoft Edge on desktop to flash your ESP32 over USB.',
                    'warning'
                );
                this.log('Browser check: navigator.serial unavailable. Recommend Chrome or Edge.');
            } else {
                this.clearNotice();
                this.log('Web Serial API detected. Ready to connect ESP32.');
            }
        }

        showNotice(msg, kind = 'warning') {
            this.els.noticeText.textContent = msg;
            this.els.notice.className = 'esp-flasher-notice is-visible' +
                (kind === 'error' ? ' is-error' : (kind === 'success' ? ' is-success' : ''));
        }

        clearNotice() {
            this.els.notice.className = 'esp-flasher-notice';
            this.els.noticeText.textContent = '';
        }

        toggleTerminal(forceOpen) {
            this.terminalOpen = forceOpen !== undefined ? Boolean(forceOpen) : !this.terminalOpen;
            this.els.terminalWrap.classList.toggle('is-open', this.terminalOpen);
            this.els.terminalToggle.setAttribute('aria-expanded', this.terminalOpen ? 'true' : 'false');
            this.els.terminalArrow.textContent = this.terminalOpen ? '▾' : '▸';
            if (this.terminalOpen) {
                this.els.terminalLog.scrollTop = this.els.terminalLog.scrollHeight;
            }
        }

        log(msg, inline = false) {
            const clean = String(msg ?? '').replace(/\r/g, '');
            if (!clean && !inline) return;
            const suffix = inline ? '' : (clean.endsWith('\n') ? '' : '\n');
            this.els.terminalLog.textContent += clean + suffix;
            this.logLineCount = (this.els.terminalLog.textContent.match(/\n/g) || []).length;
            this.els.terminalCount.textContent = `(${this.logLineCount} lines)`;
            if (this.terminalOpen) {
                this.els.terminalLog.scrollTop = this.els.terminalLog.scrollHeight;
            }
        }

        clearLog() {
            this.els.terminalLog.textContent = '';
            this.logLineCount = 0;
            this.els.terminalCount.textContent = '(0 lines)';
        }

        setMode(mode) {
            this.mode = mode === 'custom' ? 'custom' : 'hosted';
            this.els.modeTabs.forEach((btn) => {
                const active = btn.dataset.efMode === this.mode;
                btn.classList.toggle('is-selected', active);
                btn.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            this.els.hostedPanel.style.display = this.mode === 'hosted' ? 'block' : 'none';
            this.els.customPanel.style.display = this.mode === 'custom' ? 'block' : 'none';
            this.updateButtonStates();
        }

        setCustomFile(file) {
            if (!file.name.toLowerCase().endsWith('.bin')) {
                this.showNotice(`"${file.name}" does not have a .bin extension. Please select a compiled ESP32 .bin firmware image.`, 'error');
                return;
            }
            this.customFile = file;
            this.els.dropzoneTitle.textContent = file.name;
            this.els.dropzoneSub.textContent = `${formatBytes(file.size)} · Ready to flash`;
            this.clearNotice();
            this.log(`Selected custom binary: ${file.name} (${formatBytes(file.size)})`);
            this.updateButtonStates();
        }

        async loadManifest() {
            try {
                const res = await fetch(`${this.manifestUrl}?t=${Date.now()}`, { cache: 'no-store' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                this.builds = normalizeManifest(json);
                if (this.builds.length === 0) {
                    this.els.hostedSelect.innerHTML = '<option value="">No hosted builds listed</option>';
                    this.els.metaChip.textContent = '--';
                    this.els.metaOffset.textContent = '0x0';
                    this.els.metaNotes.textContent = 'Switch to Custom .bin to flash a local firmware binary.';
                    return;
                }
                this.els.hostedSelect.innerHTML = this.builds
                    .map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)} (${escapeHtml(b.chip)})</option>`)
                    .join('');
                this.selectedBuildId = this.builds[0].id;
                this.els.hostedSelect.value = this.selectedBuildId;
                this.renderSelectedBuildMeta();
                this.log(`Loaded firmware manifest (${this.builds.length} hosted build${this.builds.length === 1 ? '' : 's'}).`);
            } catch (err) {
                this.builds = [];
                this.els.hostedSelect.innerHTML = '<option value="">Manifest unavailable</option>';
                this.els.metaChip.textContent = '--';
                this.els.metaOffset.textContent = '0x0';
                this.els.metaNotes.textContent = 'Could not load ./firmware/manifest.json. Use Custom .bin to flash a local image.';
                this.log(`Manifest load skipped: ${err.message}`);
            } finally {
                this.updateButtonStates();
            }
        }

        getSelectedHostedBuild() {
            return this.builds.find((b) => b.id === this.selectedBuildId) || null;
        }

        renderSelectedBuildMeta() {
            const build = this.getSelectedHostedBuild();
            if (!build) {
                this.els.metaChip.textContent = '--';
                this.els.metaOffset.textContent = '0x0';
                this.els.metaNotes.textContent = 'Select a hosted firmware build.';
                return;
            }
            this.els.metaChip.textContent = build.chip;
            this.els.metaOffset.textContent = formatHexOffset(build.offset);
            this.els.metaNotes.textContent = build.releaseNotes || 'Standard release build.';
        }

        setProgress(pct, label) {
            const clamped = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
            this.els.progressFill.style.width = `${clamped}%`;
            this.els.progressPct.textContent = `${clamped}%`;
            this.els.progressBar.setAttribute('aria-valuenow', String(clamped));
            if (label !== undefined) {
                this.els.progressLabel.textContent = label;
            }
        }

        setState(nextState) {
            this.state = nextState;
            this.root.dataset.state = nextState;

            const order = { idle: 0, connecting: 0, connected: 1, flashing: 2, verifying: 2, verified: 3, error: this.espLoader ? 1 : 0 };
            const currentIdx = order[nextState] ?? 0;

            this.els.steps.forEach((stepEl, idx) => {
                stepEl.classList.remove('is-active', 'is-done');
                if (nextState === 'verified') {
                    stepEl.classList.add('is-done');
                } else if (idx < currentIdx) {
                    stepEl.classList.add('is-done');
                } else if (idx === currentIdx) {
                    stepEl.classList.add('is-active');
                }
            });

            this.updateButtonStates();
        }

        updateButtonStates() {
            const busy = this.state === 'connecting' || this.state === 'flashing' || this.state === 'verifying';
            const isConnected = Boolean(this.espLoader);
            const hasFirmware = this.mode === 'custom'
                ? Boolean(this.customFile)
                : Boolean(this.getSelectedHostedBuild());

            this.els.connectBtn.disabled = !this.webSerialSupported || busy;
            if (this.state === 'connecting') {
                this.els.connectBtn.textContent = 'Connecting...';
                this.els.connectBtn.classList.remove('esp-flasher-btn-danger');
            } else if (isConnected) {
                this.els.connectBtn.textContent = 'Disconnect';
                this.els.connectBtn.classList.add('esp-flasher-btn-danger');
            } else {
                this.els.connectBtn.textContent = 'Connect Device';
                this.els.connectBtn.classList.remove('esp-flasher-btn-danger');
            }

            this.els.flashBtn.disabled = !this.webSerialSupported || !isConnected || !hasFirmware || busy;
            if (this.state === 'flashing') {
                this.els.flashBtn.textContent = 'Flashing...';
            } else if (this.state === 'verifying') {
                this.els.flashBtn.textContent = 'Verifying MD5...';
            } else if (this.state === 'verified') {
                this.els.flashBtn.textContent = 'Flash Again';
            } else {
                this.els.flashBtn.textContent = 'Flash Firmware';
            }
        }

        async loadEsptool() {
            if (!this.esptoolModule) {
                this.log(`Loading esptool-js@0.5.4 from ${ESPTOOL_CDN_URL}...`);
                // Dynamic ESM import works natively in modern browsers from both classic & module scripts
                this.esptoolModule = await import(ESPTOOL_CDN_URL);
            }
            return this.esptoolModule;
        }

        makeTerminalAdapter() {
            const self = this;
            return {
                clean() {
                    self.clearLog();
                },
                writeLine(data) {
                    self.log(data, false);
                },
                writeln(data) {
                    self.log(data, false);
                },
                write(data) {
                    self.log(data, true);
                }
            };
        }

        async connectDevice() {
            if (!this.webSerialSupported) return;
            this.clearNotice();
            this.els.md5Row.classList.remove('is-visible');
            this.els.md5Row.textContent = '';

            try {
                if (typeof window !== 'undefined' && window.usbHardware && window.usbHardware.isConnected) {
                    this.log('Pausing live bioQuad USB Serial stream to open bootloader...');
                    await window.usbHardware.disconnect();
                }

                this.setState('connecting');
                this.setProgress(0, 'Select your ESP32 USB port...');

                const port = await navigator.serial.requestPort();
                this.serialPort = port;

                const { ESPLoader, Transport } = await this.loadEsptool();
                const targetBaud = Number(this.els.baudSelect.value) || 460800;
                this.els.baudPill.textContent = `${targetBaud} baud`;

                this.setProgress(0, 'Syncing ESP32 bootloader...');
                this.log(`Opening Web Serial transport at ${targetBaud} baud...`);

                const transport = new Transport(port, false);
                this.transport = transport;

                const loader = new ESPLoader({
                    transport,
                    baudrate: targetBaud,
                    romBaudrate: 115200,
                    terminal: this.makeTerminalAdapter()
                });

                const chipDesc = await loader.main();
                this.espLoader = loader;
                this.detectedChip = String(chipDesc || (loader.chip && loader.chip.CHIP_NAME) || 'ESP32');

                let mac = '';
                try {
                    if (loader.chip && typeof loader.chip.readMac === 'function') {
                        mac = await loader.chip.readMac(loader);
                    } else if (typeof loader.readMac === 'function') {
                        mac = await loader.readMac();
                    }
                } catch (macErr) {
                    this.log(`MAC readout note: ${macErr.message}`);
                }
                this.detectedMac = mac || 'Unavailable';

                this.els.chipVal.textContent = this.detectedChip;
                this.els.chipVal.classList.add('is-live');
                this.els.macVal.textContent = this.detectedMac;
                this.els.macVal.classList.add('is-live');

                this.log(`Connected: ${this.detectedChip} | MAC: ${this.detectedMac}`);
                this.setProgress(0, `Connected to ${this.detectedChip}. Ready to flash.`);
                this.setState('connected');
            } catch (err) {
                await this.cleanupTransport();
                const isCancel = err && (err.name === 'NotFoundError' || /No port selected/i.test(err.message || ''));
                if (isCancel) {
                    this.log('Port selection canceled.');
                    this.setProgress(0, 'Ready to connect ESP32 via USB');
                    this.setState('idle');
                    return;
                }
                const msg = err && err.message ? err.message : String(err);
                this.log(`Connection error: ${msg}`);
                this.showNotice(
                    `Could not connect to ESP32: ${msg}. If your board does not auto-reset, hold BOOT while clicking Connect Device.`,
                    'error'
                );
                this.setProgress(0, 'Connection failed');
                this.setState('error');
                this.toggleTerminal(true);
            }
        }

        async disconnectDevice() {
            await this.cleanupTransport();
            this.els.chipVal.textContent = 'Not connected';
            this.els.chipVal.classList.remove('is-live');
            this.els.macVal.textContent = '--';
            this.els.macVal.classList.remove('is-live');
            this.setProgress(0, 'Disconnected. Ready to connect ESP32 via USB');
            this.log('Serial port disconnected.');
            this.setState('idle');
        }

        async cleanupTransport() {
            try {
                if (this.transport && typeof this.transport.disconnect === 'function') {
                    await this.transport.disconnect();
                }
            } catch (_) {}
            try {
                if (this.serialPort && this.serialPort.readable) {
                    await this.serialPort.close();
                }
            } catch (_) {}
            this.espLoader = null;
            this.transport = null;
            this.serialPort = null;
            this.detectedChip = '';
            this.detectedMac = '';
        }

        async resolveFirmwarePayload() {
            if (this.mode === 'custom') {
                if (!this.customFile) {
                    throw new Error('Select a local .bin firmware file first.');
                }
                const offset = parseHexOffset(this.els.offsetInput.value);
                if (offset === null) {
                    throw new Error(`Invalid flash offset "${this.els.offsetInput.value}". Use hex like 0x0 or 0x10000.`);
                }
                const buf = await this.customFile.arrayBuffer();
                const bytes = new Uint8Array(buf);
                if (bytes.length === 0) {
                    throw new Error('Selected .bin file is empty.');
                }
                return {
                    label: this.customFile.name,
                    bytes,
                    address: offset,
                    eraseAll: Boolean(this.els.eraseChk.checked)
                };
            }

            const build = this.getSelectedHostedBuild();
            if (!build) {
                throw new Error('Select a hosted firmware build first.');
            }

            this.log(`Fetching hosted firmware binary: ${build.binUrl}`);
            const res = await fetch(`${build.binUrl}?t=${Date.now()}`, { cache: 'no-store' });
            const contentType = (res.headers.get('content-type') || '').toLowerCase();
            if (!res.ok || contentType.includes('text/html')) {
                throw new Error(
                    `Prebuilt binary "${build.binUrl}" is not hosted yet. Upload your compiled .bin in Custom .bin mode (or place the merged .bin at ${build.binUrl}).`
                );
            }
            const buf = await res.arrayBuffer();
            const bytes = new Uint8Array(buf);
            if (bytes.length < 16) {
                throw new Error('Downloaded firmware binary is invalid or empty.');
            }
            return {
                label: build.name,
                bytes,
                address: build.offset,
                eraseAll: Boolean(this.els.eraseChk.checked)
            };
        }

        async performHardReset() {
            const loader = this.espLoader;
            const transport = this.transport;
            this.log('Performing hardware reset...');
            try {
                if (loader && typeof loader.after === 'function') {
                    await loader.after('hard_reset', true);
                    return;
                }
                if (loader && typeof loader.hardReset === 'function') {
                    await loader.hardReset();
                    return;
                }
                if (transport && typeof transport.setDTR === 'function' && typeof transport.setRTS === 'function') {
                    await transport.setDTR(false);
                    await transport.setRTS(true);
                    await new Promise((r) => setTimeout(r, 120));
                    await transport.setRTS(false);
                }
            } catch (resetErr) {
                this.log(`Reset notice: ${resetErr.message}`);
            }
        }

        async flashSelectedFirmware() {
            if (!this.espLoader) {
                this.showNotice('Connect an ESP32 device over USB before flashing.', 'warning');
                return;
            }
            this.clearNotice();
            this.els.md5Row.classList.remove('is-visible');
            this.els.md5Row.textContent = '';

            try {
                this.setState('flashing');
                this.setProgress(0, 'Preparing firmware binary...');

                const payload = await this.resolveFirmwarePayload();
                const expectedMd5 = md5Hex(payload.bytes);
                const binaryStr = uint8ToBinaryString(payload.bytes);

                this.log(
                    `Flashing ${payload.label} (${formatBytes(payload.bytes.length)}) @ ${formatHexOffset(payload.address)} | Erase: ${payload.eraseAll ? 'YES' : 'NO'}`
                );
                this.log(`Expected MD5: ${expectedMd5}`);

                await this.espLoader.writeFlash({
                    fileArray: [{ data: binaryStr, address: payload.address }],
                    flashSize: 'keep',
                    flashMode: 'keep',
                    flashFreq: 'keep',
                    eraseAll: payload.eraseAll,
                    compress: true,
                    reportProgress: (_fileIndex, written, total) => {
                        const pct = total > 0 ? Math.min(100, Math.round((written / total) * 100)) : 0;
                        this.setProgress(
                            pct,
                            `Writing ${formatBytes(written)} / ${formatBytes(total)}...`
                        );
                    },
                    calculateMD5Hash: (image) => md5Hex(image)
                });

                this.setState('verifying');
                this.setProgress(100, 'Verifying flash MD5 checksum...');

                if (typeof this.espLoader.flashMd5sum === 'function') {
                    const chipMd5 = String(await this.espLoader.flashMd5sum(payload.address, payload.bytes.length) || '').trim().toLowerCase();
                    if (chipMd5 && chipMd5 !== expectedMd5) {
                        throw new Error(`MD5 verification mismatch (chip: ${chipMd5}, file: ${expectedMd5}).`);
                    }
                    if (chipMd5) {
                        this.log(`Chip MD5 verified: ${chipMd5}`);
                    }
                }

                await this.performHardReset();
                this.lastMd5 = expectedMd5;
                this.els.md5Row.textContent = `MD5 Verified: ${expectedMd5} · Device reset complete`;
                this.els.md5Row.classList.add('is-visible');
                this.setProgress(100, `Flashed & verified ${payload.label}`);
                this.showNotice(`Firmware flashed, MD5 verified, and ${this.detectedChip} restarted successfully.`, 'success');
                this.setState('verified');
            } catch (err) {
                const msg = err && err.message ? err.message : String(err);
                this.log(`Flash error: ${msg}`);
                this.showNotice(msg, 'error');
                this.setProgress(0, 'Flash interrupted');
                this.setState('error');
                this.toggleTerminal(true);
            }
        }
    }

    // ========================================================================
    // Auto-Mount, Global bioQuad Portal Hooks & CommonJS Test Exports
    // ========================================================================

    function mountFlasherPortals() {
        if (typeof document === 'undefined') return;
        const root = document.getElementById('esp-flasher-root');
        if (root && !root.__espFlasherPortal) {
            const portal = new EspFlasherPortal(root);
            root.__espFlasherPortal = portal;
            if (typeof window !== 'undefined') {
                window.espFlasherPortal = portal;
            }
        }
    }

    const exportedApi = {
        EspFlasherPortal,
        parseHexOffset,
        formatHexOffset,
        formatBytes,
        uint8ToBinaryString,
        binaryInputToUint8,
        md5Hex,
        normalizeManifest,
        mountFlasherPortals
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exportedApi;
    }

    if (globalScope) {
        globalScope.BioQuadFlasher = exportedApi;
        globalScope.EspFlasherPortal = EspFlasherPortal;
    }

    if (typeof window !== 'undefined') {
        window.openFirmwarePortal = function() {
            mountFlasherPortals();
            if (typeof window.setWorkspaceCardOpen === 'function') {
                return window.setWorkspaceCardOpen('firmware-portal-card', 'btn-open-firmware-portal', true);
            }
            const card = document.getElementById('firmware-portal-card');
            if (card) {
                card.classList.remove('ui-hidden');
                card.style.display = 'flex';
            }
            return true;
        };

        window.closeFirmwarePortal = function() {
            if (typeof window.setWorkspaceCardOpen === 'function') {
                return window.setWorkspaceCardOpen('firmware-portal-card', 'btn-open-firmware-portal', false);
            }
            const card = document.getElementById('firmware-portal-card');
            if (card) {
                card.classList.add('ui-hidden');
                card.style.display = 'none';
            }
            return false;
        };

        window.toggleFirmwarePortal = function() {
            mountFlasherPortals();
            const card = document.getElementById('firmware-portal-card');
            const willOpen = card ? card.classList.contains('ui-hidden') : true;
            if (typeof window.setWorkspaceCardOpen === 'function') {
                const isOpen = window.setWorkspaceCardOpen('firmware-portal-card', 'btn-open-firmware-portal', willOpen);
                if (isOpen && card) {
                    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
                return isOpen;
            }
            return willOpen ? window.openFirmwarePortal() : window.closeFirmwarePortal();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', mountFlasherPortals);
        } else {
            mountFlasherPortals();
        }
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}));
