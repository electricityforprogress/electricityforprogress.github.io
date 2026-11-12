/**
 * js/dataStreamer.js
 * bioQuad Local Data File Streaming, Timestamp Synchronization & Session Storage Engine
 * 
 * Capabilities:
 * - Universal file ingestion (CSV, TSV, TXT, JSON, XML, arbitrary delimited)
 * - Auto-heuristic column detection:
 *     * Identifier (Sensor ID / Channel / Device / Group)
 *     * Data point (Numeric value / Reading / Conductance / Voltage / Admittance)
 *     * Timestamp (ISO8601 / Dates / Epoch ms / Relative seconds / Cadence)
 * - Exact Delta-Timestamp Playback Engine:
 *     * Strictly respects real timestamps during playback at the exact rate recorded
 *     * Normalized relative millisecond offsets (tMs)
 *     * Horizontal speed multiplier slider
 *     * Cadence setting for un-timed data files
 * - Transparent Signal Routing to bioQuad Audio & Visualizers:
 *     * Feeds waveBuffer, vizBuffer, HUD resistance/conductance/slew metrics
 *     * 1-Second rollup pushes directly to ch.history for historical trend visualizer
 *     * Snaps visualizer bounds cleanly on file load so oscilloscope never distorts
 *     * Calls synthChannels[ch].play(pitch, velocity, durationMs)
 * - Persistent Session & Take Manager (IndexedDB):
 *     * Zero V8 heap RAM bloat; protects browser memory during multi-hour/multi-day takes
 *     * Auto-saves finished takes into IndexedDB on stop
 *     * Take library for instant cueing into player, CSV export, and deletion
 */

(function(window) {
    'use strict';

    // --- 1. PERSISTENT TAKE & SESSION STORAGE ENGINE (INDEXEDDB) ---
    class BioquadStorage {
        constructor() {
            this.dbName = 'bioquad_db';
            this.storeName = 'takes';
            this.db = null;
        }

        async getDb() {
            if (this.db) return this.db;
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(this.dbName, 1);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        db.createObjectStore(this.storeName, { keyPath: 'id' });
                    }
                };
                req.onsuccess = (e) => {
                    this.db = e.target.result;
                    resolve(this.db);
                };
                req.onerror = (e) => reject(e.target.error);
            });
        }

        async saveTake(take) {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                store.put(take);
                tx.oncomplete = () => resolve(take);
                tx.onerror = (e) => reject(e.target.error);
            });
        }

        async getAllTakes() {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readonly');
                const store = tx.objectStore(this.storeName);
                const req = store.getAll();
                req.onsuccess = () => {
                    const results = req.result || [];
                    results.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                    resolve(results);
                };
                req.onerror = (e) => reject(e.target.error);
            });
        }

        async deleteTake(id) {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                store.delete(id);
                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => reject(e.target.error);
            });
        }

        async clearAllTakes() {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                store.clear();
                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => reject(e.target.error);
            });
        }
    }

    // Helper: Parse any raw timestamp token into epoch milliseconds
    function parseRawTimeToMs(raw) {
        if (raw === null || raw === undefined || raw === '') return null;
        if (typeof raw === 'number') {
            if (raw > 1e11) return raw; // Epoch ms
            if (raw > 1e8) return raw * 1000; // Epoch seconds
            return raw * 1000; // Relative seconds -> ms
        }
        const str = String(raw).trim();
        const parsedDt = Date.parse(str);
        if (!isNaN(parsedDt)) return parsedDt;
        const num = parseFloat(str);
        if (!isNaN(num) && isFinite(str)) {
            if (num > 1e11) return num;
            if (num > 1e8) return num * 1000;
            return num * 1000;
        }
        return null;
    }

    class DataStreamerEngine {
        constructor() {
            // Master state
            this.activeChannels = [null, null, null, null];
            this.loadedFile = null;
            
            // Transport state
            this.isPlaying = false;
            this.isPaused = false;
            this.isLooping = true;
            this.playbackRate = 1.0; // Horizontal slider speed multiplier (0.1x to 5.0x)
            this.targetCadenceRps = 30; // Cadence for data without timestamps (records per sec)
            this.hasRealTimestamps = false;
            
            this.currentIndex = 0;
            this.totalRecords = 0;
            this.playbackElapsedMs = 0;
            this.totalDurationMs = 0;
            
            this.timerId = null;
            this.lastFrameTime = 0;
            this.lastUiEmitTime = 0;

            // Channel streams data buffers
            // Each channel has: { data: [ { value, rawTime, tMs, id, note, velocity, ticks } ], index: 0, label, sourceFile }
            this.channelFeeds = [
                { data: [], index: 0, label: 'Unassigned', sourceFile: '' },
                { data: [], index: 0, label: 'Unassigned', sourceFile: '' },
                { data: [], index: 0, label: 'Unassigned', sourceFile: '' },
                { data: [], index: 0, label: 'Unassigned', sourceFile: '' }
            ];

            // Listeners for UI updates
            this.listeners = new Set();
        }

        subscribe(callback) {
            this.listeners.add(callback);
            return () => this.listeners.delete(callback);
        }

        emitChange(eventType = 'state_change') {
            const state = this.getState();
            this.listeners.forEach(fn => {
                try { fn(eventType, state); } catch (e) { console.error('DataStreamer listener error:', e); }
            });
            window.dispatchEvent(new CustomEvent('bioquad_stream_update', { detail: { type: eventType, state } }));
        }

        getState() {
            return {
                isPlaying: this.isPlaying,
                isPaused: this.isPaused,
                isLooping: this.isLooping,
                playbackRate: this.playbackRate,
                targetCadenceRps: this.targetCadenceRps,
                hasTimestamps: this.hasRealTimestamps,
                currentIndex: this.currentIndex,
                totalRecords: this.totalRecords,
                playbackElapsedMs: this.playbackElapsedMs,
                totalDurationMs: this.totalDurationMs,
                progress: this.totalDurationMs > 0 ? (this.playbackElapsedMs / this.totalDurationMs) : (this.totalRecords > 0 ? (this.currentIndex / this.totalRecords) : 0),
                activeChannels: this.channelFeeds.map(f => ({
                    active: f.data.length > 0,
                    count: f.data.length,
                    index: f.index,
                    label: f.label,
                    sourceFile: f.sourceFile,
                    currentVal: f.data[f.index] ? f.data[f.index].value : null
                })),
                loadedFile: this.loadedFile ? {
                    name: this.loadedFile.name,
                    rowCount: this.loadedFile.rows.length,
                    columns: this.loadedFile.columns,
                    guesses: this.loadedFile.guesses,
                    recommendedWindow: this.loadedFile.recommendedWindow,
                    recommendedZoom: this.loadedFile.recommendedZoom
                } : null
            };
        }

        // --- UNIVERSAL FILE PARSER & AUTO-GUESSING PORTAL ---
        parseFileContent(rawText, fileName = 'stream_data.csv') {
            const trimmed = rawText.trim();
            if (!trimmed) throw new Error('File content is empty');

            let rows = [];
            let columns = [];
            let formatType = 'csv';

            // 1. JSON parsing check
            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                try {
                    const parsedJson = JSON.parse(trimmed);
                    formatType = 'json';
                    
                    if (Array.isArray(parsedJson)) {
                        if (parsedJson.length > 0 && typeof parsedJson[0] === 'object' && parsedJson[0] !== null) {
                            columns = Object.keys(parsedJson[0]);
                            rows = parsedJson;
                        } else {
                            columns = ['value'];
                            rows = parsedJson.map((v, idx) => ({ value: v, index: idx }));
                        }
                    } else if (typeof parsedJson === 'object') {
                        const keys = Object.keys(parsedJson);
                        const arrayKeys = keys.filter(k => Array.isArray(parsedJson[k]));
                        if (arrayKeys.length > 0) {
                            const maxLen = Math.max(...arrayKeys.map(k => parsedJson[k].length));
                            columns = arrayKeys;
                            for (let i = 0; i < maxLen; i++) {
                                let rowObj = {};
                                arrayKeys.forEach(k => { rowObj[k] = parsedJson[k][i]; });
                                rows.push(rowObj);
                            }
                        } else {
                            columns = keys;
                            rows = [parsedJson];
                        }
                    }
                } catch (jsonErr) {}
            }

            // 2. Delimited text parsing (CSV, TSV, semicolon, whitespace)
            if (rows.length === 0) {
                const lines = trimmed.split(/\r?\n/).filter(line => line.trim().length > 0);
                if (lines.length === 0) throw new Error('No valid data lines found in file');

                const firstLine = lines[0];
                let delimiter = ',';
                if (firstLine.includes('\t')) delimiter = '\t';
                else if (firstLine.includes(';') && (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length) delimiter = ';';
                else if (firstLine.includes('|')) delimiter = '|';
                else if (!firstLine.includes(',') && firstLine.split(/\s+/).length > 1) delimiter = /\s+/;

                let headerTokens = typeof delimiter === 'string' ? firstLine.split(delimiter).map(s => s.trim().replace(/^["']|["']$/g, '')) : firstLine.split(delimiter);
                
                const isFirstLineNumeric = headerTokens.every(t => !isNaN(parseFloat(t)) && isFinite(t));
                let startIndex = 1;
                
                if (isFirstLineNumeric) {
                    startIndex = 0;
                    columns = headerTokens.map((_, i) => `Col_${i + 1}`);
                } else {
                    columns = headerTokens.map((h, i) => h.length > 0 ? h : `Col_${i + 1}`);
                }

                for (let i = startIndex; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
                    
                    const tokens = typeof delimiter === 'string' ? line.split(delimiter).map(s => s.trim().replace(/^["']|["']$/g, '')) : line.split(delimiter);
                    let rowObj = {};
                    columns.forEach((col, cIdx) => {
                        let raw = tokens[cIdx];
                        if (raw !== undefined) {
                            let num = parseFloat(raw);
                            rowObj[col] = (!isNaN(num) && isFinite(raw)) ? num : raw;
                        } else {
                            rowObj[col] = null;
                        }
                    });
                    rows.push(rowObj);
                }
            }

            if (rows.length === 0) throw new Error('Could not parse records from this file');

            const guesses = this.detectColumnRoles(columns, rows);

            const N = rows.length;
            let recommendedWindow = 40;
            let recommendedZoom = 500;

            if (N < 250) {
                recommendedWindow = Math.max(10, Math.round(N / 8));
                recommendedZoom = Math.min(250, N);
            } else if (N < 1500) {
                recommendedWindow = Math.max(20, Math.min(50, Math.round(N / 25)));
                recommendedZoom = Math.min(500, Math.round(N * 0.7));
            } else if (N < 8000) {
                recommendedWindow = Math.max(40, Math.min(90, Math.round(N / 80)));
                recommendedZoom = Math.min(2000, Math.round(N * 0.4));
            } else {
                recommendedWindow = Math.max(60, Math.min(180, Math.round(N / 120)));
                recommendedZoom = Math.min(8000, Math.round(N * 0.25));
            }

            this.loadedFile = {
                name: fileName,
                format: formatType,
                columns,
                rows,
                sampleRows: rows.slice(0, 10),
                guesses,
                recommendedWindow,
                recommendedZoom
            };

            return this.loadedFile;
        }

        // Heuristics for detecting Identifier, Data Point, and Timestamp
        detectColumnRoles(columns, rows) {
            // Scan across sample to identify column types
            const sample = rows.slice(0, Math.min(500, rows.length));
            const colStats = {};

            columns.forEach(col => {
                let numericCount = 0;
                let dateCount = 0;
                let uniqueValues = new Set();
                let nums = [];

                // Scan up to 2000 rows for unique values so multi-channel IDs aren't missed
                const scanLimit = Math.min(2000, rows.length);
                for (let r = 0; r < scanLimit; r++) {
                    const val = rows[r][col];
                    if (val !== null && val !== undefined && val !== '') {
                        uniqueValues.add(String(val));
                    }
                }

                sample.forEach(row => {
                    const val = row[col];
                    if (val === null || val === undefined || val === '') return;
                    
                    if (typeof val === 'number') {
                        numericCount++;
                        nums.push(val);
                    } else if (typeof val === 'string') {
                        const parsedNum = parseFloat(val);
                        if (!isNaN(parsedNum) && isFinite(val.trim())) {
                            numericCount++;
                            nums.push(parsedNum);
                        } else {
                            const dt = Date.parse(val);
                            if (!isNaN(dt) && (val.includes('-') || val.includes('/') || val.includes(':') || val.includes('T'))) {
                                dateCount++;
                            }
                        }
                    }
                });

                const numRatio = nums.length / (sample.length || 1);
                let variance = 0;
                let isMonotonic = false;
                if (nums.length > 2) {
                    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
                    variance = nums.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / nums.length;
                    
                    let increasing = true;
                    for (let k = 1; k < Math.min(20, nums.length); k++) {
                        if (nums[k] < nums[k - 1]) { increasing = false; break; }
                    }
                    isMonotonic = increasing && (nums[1] - nums[0] > 0);
                }

                colStats[col] = {
                    name: col,
                    numRatio,
                    dateRatio: dateCount / (sample.length || 1),
                    uniqueCount: uniqueValues.size,
                    uniqueValuesList: Array.from(uniqueValues),
                    variance,
                    isMonotonic
                };
            });

            // 1. Timestamp candidate
            let timestampCol = null;
            let timeScore = -1;
            columns.forEach(col => {
                const s = colStats[col];
                let score = 0;
                const lower = col.toLowerCase();
                
                if (/(time|date|timestamp|datetime|epoch|iso|dt|sec|ms|tick)/i.test(lower)) score += 50;
                if (s.dateRatio > 0.6) score += 60;
                if (s.isMonotonic && s.numRatio > 0.8) score += 30;
                
                if (score > timeScore && score > 20) {
                    timeScore = score;
                    timestampCol = col;
                }
            });

            // 2. Identifier candidate
            let identifierCol = null;
            let idScore = -1;
            columns.forEach(col => {
                if (col === timestampCol) return;
                const s = colStats[col];
                let score = 0;
                const lower = col.toLowerCase();
                
                if (/(sensor|sensor_id|probe|channel|ch|device|node|id|tag|source|leaf|zone|matrix)/i.test(lower)) score += 60;
                if (s.uniqueCount >= 2 && s.uniqueCount <= 12 && s.numRatio < 0.9) score += 40;
                else if (s.uniqueCount >= 2 && s.uniqueCount <= 8) score += 20;

                if (score > idScore && score > 25) {
                    idScore = score;
                    identifierCol = col;
                }
            });

            // 3. Data Point candidate
            let valueCols = [];
            columns.forEach(col => {
                if (col === timestampCol || col === identifierCol) return;
                const s = colStats[col];
                let score = 0;
                const lower = col.toLowerCase();

                if (s.numRatio > 0.7) score += 40;
                if (/(val|value|conductance|admittance|us|reading|signal|resist|voltage|volt|amp|temp|hum|flux|raw|ec|bio|metric)/i.test(lower)) score += 50;
                if (s.variance > 0.001) score += 20;
                if (!s.isMonotonic) score += 10;

                if (score > 30) {
                    valueCols.push({ col, score, variance: s.variance });
                }
            });

            valueCols.sort((a, b) => b.score - a.score || b.variance - a.variance);
            const primaryValueCol = valueCols.length > 0 ? valueCols[0].col : (columns.find(c => c !== timestampCol && c !== identifierCol) || columns[0]);

            return {
                timestampCol,
                identifierCol,
                primaryValueCol,
                detectedValueCols: valueCols.map(v => v.col),
                sensorList: identifierCol ? colStats[identifierCol].uniqueValuesList : [],
                colStats
            };
        }

        // --- MULTI-CHANNEL ROUTING & TIMESTAMP NORMALIZATION ---
        applyMappingConfig(config) {
            if (!this.loadedFile) throw new Error('No file loaded to apply mapping');

            const { rows, recommendedWindow, recommendedZoom, name } = this.loadedFile;
            const mode = config.mode || 'multi_sensor_id';
            const cadenceRps = config.cadenceRps || this.targetCadenceRps || 30;
            this.targetCadenceRps = cadenceRps;
            const timeCol = config.timestampCol !== undefined ? config.timestampCol : this.loadedFile.guesses.timestampCol;

            if (mode === 'single_channel') {
                const targetCh = config.targetChannel !== undefined ? config.targetChannel : 0;
                const valCol = config.valueCol || this.loadedFile.guesses.primaryValueCol;
                
                const channelData = [];
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const numVal = parseFloat(row[valCol]);
                    if (!isNaN(numVal) && isFinite(numVal)) {
                        const noteRaw = row['note_event'] ?? row['note'] ?? row['midi_note'] ?? null;
                        const velRaw = row['velocity'] ?? row['vel'] ?? null;
                        channelData.push({
                            value: numVal,
                            rawTime: timeCol && row[timeCol] !== undefined ? row[timeCol] : null,
                            note: (noteRaw !== null && noteRaw !== undefined && noteRaw !== '' && !isNaN(parseInt(noteRaw))) ? parseInt(noteRaw) : null,
                            velocity: (velRaw !== null && velRaw !== undefined && velRaw !== '' && !isNaN(parseInt(velRaw))) ? parseInt(velRaw) : null,
                            ticks: row['raw_ticks'] || row['ticks'] || null,
                            index: i
                        });
                    }
                }

                const hasNotes = channelData.some(pt => pt.note !== null);

                this.channelFeeds[targetCh] = {
                    data: channelData,
                    index: 0,
                    label: `${name} (${valCol})`,
                    sourceFile: name,
                    hasRecordedNotes: hasNotes
                };

                if (config.autoApplyWindow !== false && window.synthChannels && window.synthChannels[targetCh]) {
                    window.synthChannels[targetCh].params.sampleSize = recommendedWindow;
                    if (window.chData && window.chData[targetCh] && window.chData[targetCh].config) {
                        window.chData[targetCh].config.zoom = recommendedZoom;
                    }
                }
            } 
            else if (mode === 'multi_sensor_id') {
                const idCol = config.identifierCol || this.loadedFile.guesses.identifierCol;
                const valCol = config.valueCol || this.loadedFile.guesses.primaryValueCol;
                const sensorMap = config.sensorToChannelMap || {};

                // Scan all unique sensor IDs from rows if not explicitly provided
                if (Object.keys(sensorMap).length === 0) {
                    const uniqueSensors = new Set();
                    rows.forEach(r => {
                        if (idCol && r[idCol] !== undefined && r[idCol] !== null && r[idCol] !== '') {
                            uniqueSensors.add(String(r[idCol]));
                        }
                    });

                    const sList = Array.from(uniqueSensors);
                    sList.forEach((sId, idx) => {
                        const match = sId.match(/ch(?:annel)?[_\s-]?([1-4])/i);
                        if (match) {
                            sensorMap[sId] = parseInt(match[1]) - 1;
                        } else if (idx < 4) {
                            sensorMap[sId] = idx;
                        }
                    });
                }

                const partitioned = [[], [], [], []];
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    let targetCh = undefined;

                    // Support explicit channel column (1..4)
                    if (row.channel !== undefined && row.channel >= 1 && row.channel <= 4) {
                        targetCh = row.channel - 1;
                    } else if (idCol && row[idCol] !== undefined) {
                        const sensorId = String(row[idCol]);
                        targetCh = sensorMap[sensorId];
                    }

                    if (targetCh !== undefined && targetCh >= 0 && targetCh < 4) {
                        const numVal = parseFloat(row[valCol]);
                        if (!isNaN(numVal) && isFinite(numVal)) {
                            const noteRaw = row['note_event'] ?? row['note'] ?? row['midi_note'] ?? null;
                            const velRaw = row['velocity'] ?? row['vel'] ?? null;
                            partitioned[targetCh].push({
                                value: numVal,
                                rawTime: timeCol && row[timeCol] !== undefined ? row[timeCol] : null,
                                id: idCol ? String(row[idCol]) : `CH_${targetCh + 1}`,
                                note: (noteRaw !== null && noteRaw !== undefined && noteRaw !== '' && !isNaN(parseInt(noteRaw))) ? parseInt(noteRaw) : null,
                                velocity: (velRaw !== null && velRaw !== undefined && velRaw !== '' && !isNaN(parseInt(velRaw))) ? parseInt(velRaw) : null,
                                ticks: row['raw_ticks'] || row['ticks'] || null,
                                index: i
                            });
                        }
                    }
                }

                for (let ch = 0; ch < 4; ch++) {
                    if (partitioned[ch].length > 0) {
                        const matchedSensor = Object.keys(sensorMap).find(s => sensorMap[s] === ch) || `CH ${ch+1}`;
                        const hasNotes = partitioned[ch].some(pt => pt.note !== null);
                        this.channelFeeds[ch] = {
                            data: partitioned[ch],
                            index: 0,
                            label: `${matchedSensor} (${valCol})`,
                            sourceFile: name,
                            hasRecordedNotes: hasNotes
                        };

                        if (config.autoApplyWindow !== false && window.synthChannels && window.synthChannels[ch]) {
                            window.synthChannels[ch].params.sampleSize = recommendedWindow;
                            if (window.chData && window.chData[ch] && window.chData[ch].config) {
                                window.chData[ch].config.zoom = recommendedZoom;
                            }
                        }
                    }
                }
            }
            else if (mode === 'multi_value_cols') {
                const colMap = config.columnToChannelMap || {};
                const detected = this.loadedFile.guesses.detectedValueCols;
                if (Object.keys(colMap).length === 0 && detected.length > 0) {
                    detected.slice(0, 4).forEach((col, ch) => {
                        colMap[col] = ch;
                    });
                }

                const assignedChannels = new Set(Object.values(colMap));
                assignedChannels.forEach(ch => {
                    const targetCol = Object.keys(colMap).find(c => colMap[c] === ch);
                    if (targetCol) {
                        const channelData = [];
                        for (let i = 0; i < rows.length; i++) {
                            const row = rows[i];
                            const numVal = parseFloat(row[targetCol]);
                            if (!isNaN(numVal) && isFinite(numVal)) {
                                const noteRaw = row['note_event'] ?? row['note'] ?? row['midi_note'] ?? null;
                                const velRaw = row['velocity'] ?? row['vel'] ?? null;
                                channelData.push({
                                    value: numVal,
                                    rawTime: timeCol && row[timeCol] !== undefined ? row[timeCol] : null,
                                    note: (noteRaw !== null && noteRaw !== undefined && noteRaw !== '' && !isNaN(parseInt(noteRaw))) ? parseInt(noteRaw) : null,
                                    velocity: (velRaw !== null && velRaw !== undefined && velRaw !== '' && !isNaN(parseInt(velRaw))) ? parseInt(velRaw) : null,
                                    ticks: row['raw_ticks'] || row['ticks'] || null,
                                    index: i
                                });
                            }
                        }

                        const hasNotes = channelData.some(pt => pt.note !== null);
                        this.channelFeeds[ch] = {
                            data: channelData,
                            index: 0,
                            label: `${name} [${targetCol}]`,
                            sourceFile: name,
                            hasRecordedNotes: hasNotes
                        };

                        if (config.autoApplyWindow !== false && window.synthChannels && window.synthChannels[ch]) {
                            window.synthChannels[ch].params.sampleSize = recommendedWindow;
                            if (window.chData && window.chData[ch] && window.chData[ch].config) {
                                window.chData[ch].config.zoom = recommendedZoom;
                            }
                        }
                    }
                });
            }

            // --- NORMALIZE TIMESTAMPS FOR EXACT DELTA PLAYBACK ---
            let minTimeMs = Infinity;
            let validTimeCount = 0;

            for (let ch = 0; ch < 4; ch++) {
                const feed = this.channelFeeds[ch];
                if (!feed || feed.data.length === 0) continue;
                for (let i = 0; i < feed.data.length; i++) {
                    const pt = feed.data[i];
                    if (pt.rawTime !== null && pt.rawTime !== undefined) {
                        const ms = parseRawTimeToMs(pt.rawTime);
                        if (ms !== null && isFinite(ms)) {
                            pt.parsedMs = ms;
                            if (ms < minTimeMs) minTimeMs = ms;
                            validTimeCount++;
                        }
                    }
                }
            }

            const hasRealTimestamps = validTimeCount >= 2 && minTimeMs !== Infinity;
            this.hasRealTimestamps = hasRealTimestamps;

            let maxDurationMs = 0;

            for (let ch = 0; ch < 4; ch++) {
                const feed = this.channelFeeds[ch];
                if (!feed || feed.data.length === 0) continue;

                let lastTMs = 0;
                for (let i = 0; i < feed.data.length; i++) {
                    const pt = feed.data[i];
                    if (hasRealTimestamps && pt.parsedMs !== undefined) {
                        let tOffset = Math.max(0, pt.parsedMs - minTimeMs);
                        if (tOffset < lastTMs) tOffset = lastTMs;
                        pt.tMs = tOffset;
                        lastTMs = tOffset;
                    } else {
                        // Pace un-timed data strictly by user-defined cadenceRps
                        const tOffset = (i / cadenceRps) * 1000;
                        pt.tMs = tOffset;
                        lastTMs = tOffset;
                    }
                    if (pt.tMs > maxDurationMs) maxDurationMs = pt.tMs;
                }
            }

            this.totalDurationMs = maxDurationMs > 0 ? maxDurationMs : ((this.totalRecords / cadenceRps) * 1000);
            this.playbackElapsedMs = 0;

            // Sync total length
            const lengths = this.channelFeeds.map(f => f.data.length).filter(len => len > 0);
            this.totalRecords = lengths.length > 0 ? Math.max(...lengths) : 0;
            this.currentIndex = 0;

            // Pre-warm visualizers with clean bounds
            for (let ch = 0; ch < 4; ch++) {
                const feed = this.channelFeeds[ch];
                const chVisual = window.chData ? window.chData[ch] : null;
                if (feed && feed.data.length > 0 && chVisual) {
                    let dMin = Infinity, dMax = -Infinity;
                    for (let k = 0; k < feed.data.length; k++) {
                        const val = feed.data[k].value;
                        if (val < dMin) dMin = val;
                        if (val > dMax) dMax = val;
                    }
                    if (isFinite(dMin) && isFinite(dMax) && dMax > dMin) {
                        chVisual.bounds = { min: dMin, max: dMax };
                        chVisual.boundsNeedSnap = true;
                    }
                    chVisual.waveBuffer = [];
                    chVisual.vizBuffer = [];
                    chVisual.history = [];
                    chVisual.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: Date.now() };

                    const preWarmCount = Math.min(25, feed.data.length);
                    for (let p = 0; p < preWarmCount; p++) {
                        const rVal = feed.data[p].value;
                        const ticks = Math.round(10000000 / (rVal || 1));
                        chVisual.waveBuffer.push({ r: rVal, ticks: ticks, evt: 0 });
                        chVisual.vizBuffer.push(rVal);
                    }
                }
            }

            if (typeof window.syncUI === 'function') window.syncUI();
            this.emitChange('mapping_applied');
        }

        // --- TRANSPORT CONTROLS ---
        play() {
            if (this.totalRecords === 0) return;

            if (window.audioCtx && window.audioCtx.state === 'suspended') {
                window.audioCtx.resume().catch(() => {});
            }

            this.isPlaying = true;
            this.isPaused = false;
            this.lastFrameTime = performance.now();
            this.lastUiEmitTime = performance.now();

            if (this.timerId) cancelAnimationFrame(this.timerId);
            this.runStreamLoop();
            this.emitChange('play');
        }

        pause() {
            this.isPlaying = false;
            this.isPaused = true;
            if (this.timerId) {
                cancelAnimationFrame(this.timerId);
                this.timerId = null;
            }
            this.emitChange('pause');
        }

        stop() {
            this.isPlaying = false;
            this.isPaused = false;
            if (this.timerId) {
                cancelAnimationFrame(this.timerId);
                this.timerId = null;
            }
            this.rewind();
            this.emitChange('stop');
        }

        rewind() {
            this.playbackElapsedMs = 0;
            this.currentIndex = 0;
            for (let i = 0; i < 4; i++) {
                if (this.channelFeeds[i]) {
                    this.channelFeeds[i].index = 0;
                    if (this.channelFeeds[i].data.length > 0) {
                        this.processChannelRecord(i, this.channelFeeds[i].data[0]);
                    }
                }
            }
            this.emitChange('rewind');
        }

        seek(targetIndex) {
            targetIndex = Math.max(0, Math.min(this.totalRecords - 1, Math.round(targetIndex)));
            this.currentIndex = targetIndex;
            
            const ratio = this.totalRecords > 1 ? targetIndex / (this.totalRecords - 1) : 0;
            this.playbackElapsedMs = ratio * this.totalDurationMs;

            for (let ch = 0; ch < 4; ch++) {
                const feed = this.channelFeeds[ch];
                if (feed && feed.data.length > 0) {
                    let targetIdx = Math.min(feed.data.length - 1, Math.floor(ratio * feed.data.length));
                    for (let k = 0; k < feed.data.length; k++) {
                        if (feed.data[k].tMs >= this.playbackElapsedMs) {
                            targetIdx = k;
                            break;
                        }
                    }
                    feed.index = targetIdx;
                    this.processChannelRecord(ch, feed.data[targetIdx]);
                }
            }
            this.emitChange('seek');
        }

        step(forward = true) {
            if (this.isPlaying) this.pause();
            const stepDelta = forward ? 1 : -1;
            const newIdx = Math.max(0, Math.min(this.totalRecords - 1, this.currentIndex + stepDelta));
            this.seek(newIdx);
            this.emitChange('step');
        }

        setPlaybackRate(multiplier) {
            this.playbackRate = Math.max(0.1, Math.min(5.0, multiplier));
            this.emitChange('rate_change');
        }

        setCadenceRps(rps) {
            this.targetCadenceRps = Math.max(1, Math.min(500, rps));
            // If data has no timestamps, update totalDurationMs accordingly
            if (!this.hasRealTimestamps && this.totalRecords > 0) {
                this.totalDurationMs = (this.totalRecords / this.targetCadenceRps) * 1000;
                for (let ch = 0; ch < 4; ch++) {
                    const feed = this.channelFeeds[ch];
                    if (feed) {
                        for (let i = 0; i < feed.data.length; i++) {
                            feed.data[i].tMs = (i / this.targetCadenceRps) * 1000;
                        }
                    }
                }
            }
            this.emitChange('rate_change');
        }

        toggleLoop() {
            this.isLooping = !this.isLooping;
            this.emitChange('loop_change');
        }

        clearChannel(ch) {
            if (this.channelFeeds[ch]) {
                this.channelFeeds[ch].data = [];
                this.channelFeeds[ch].index = 0;
                this.channelFeeds[ch].label = 'Unassigned';
                this.channelFeeds[ch].sourceFile = '';
                
                const lengths = this.channelFeeds.map(f => f.data.length).filter(len => len > 0);
                this.totalRecords = lengths.length > 0 ? Math.max(...lengths) : 0;
                this.emitChange('channel_cleared');
            }
        }

        clearAll() {
            this.stop();
            for (let i = 0; i < 4; i++) {
                this.channelFeeds[i] = { data: [], index: 0, label: 'Unassigned', sourceFile: '' };
            }
            this.totalRecords = 0;
            this.currentIndex = 0;
            this.playbackElapsedMs = 0;
            this.totalDurationMs = 0;
            this.loadedFile = null;
            this.emitChange('cleared_all');
        }

        // --- REAL-TIME DELTA TIMESTAMP STREAM LOOP ---
        runStreamLoop() {
            if (!this.isPlaying) return;

            const now = performance.now();
            let deltaMs = now - this.lastFrameTime;
            this.lastFrameTime = now;
            if (deltaMs > 250) deltaMs = 250;

            this.playbackElapsedMs += deltaMs * this.playbackRate;

            if (this.playbackElapsedMs >= this.totalDurationMs) {
                if (this.isLooping) {
                    this.rewind();
                    this.lastFrameTime = performance.now();
                    this.timerId = requestAnimationFrame(() => this.runStreamLoop());
                    return;
                } else {
                    this.playbackElapsedMs = this.totalDurationMs;
                    this.pause();
                    this.seek(this.totalRecords - 1);
                    return;
                }
            }

            for (let chIdx = 0; chIdx < 4; chIdx++) {
                const feed = this.channelFeeds[chIdx];
                if (!feed || feed.data.length === 0) continue;

                let stepsThisFrame = 0;
                while (feed.index < feed.data.length - 1 && feed.data[feed.index + 1].tMs <= this.playbackElapsedMs && stepsThisFrame < 100) {
                    feed.index++;
                    stepsThisFrame++;
                    this.processChannelRecord(chIdx, feed.data[feed.index]);
                }
            }

            const primaryFeed = this.channelFeeds.find(f => f.data.length === this.totalRecords) || this.channelFeeds[0];
            if (primaryFeed && primaryFeed.data.length > 0) {
                this.currentIndex = primaryFeed.index;
            }

            if (now - this.lastUiEmitTime > 35) {
                this.lastUiEmitTime = now;
                this.emitChange('tick');
            }

            this.timerId = requestAnimationFrame(() => this.runStreamLoop());
        }

        processChannelRecord(chIdx, record) {
            const CALIBRATION_FACTOR = 10000000;
            const nowMs = Date.now();

            if (!record || record.value === undefined || record.value === null) return;

            let rawVal = record.value;
            let rVal = Math.abs(rawVal);
            if (rVal < 0.1) rVal = 0.1;
            if (rVal > 10000) {
                rVal = CALIBRATION_FACTOR / rVal;
            }

            const synthCh = window.synthChannels ? window.synthChannels[chIdx] : null;
            const p = synthCh ? synthCh.params : window.defaultParams;
            const sampleWindow = p.sampleSize || 40;

            const chVisual = window.chData ? window.chData[chIdx] : null;
            if (!chVisual) return;

            if (!chVisual.waveBuffer) chVisual.waveBuffer = [];
            if (!chVisual.vizBuffer) chVisual.vizBuffer = [];
            if (!chVisual.acc || chVisual.acc.lastSec === undefined) {
                chVisual.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: nowMs };
            }

            const ticks = record.ticks || Math.round(CALIBRATION_FACTOR / rVal);
            
            chVisual.acc.sum += rVal;
            chVisual.acc.count++;
            if (rVal < chVisual.acc.min) chVisual.acc.min = rVal;
            if (rVal > chVisual.acc.max) chVisual.acc.max = rVal;

            chVisual.waveBuffer.push({ r: rVal, ticks: ticks, evt: 0 });
            chVisual.vizBuffer.push(rVal);

            while (chVisual.waveBuffer.length > 120000) chVisual.waveBuffer.shift();
            while (chVisual.vizBuffer.length > sampleWindow) chVisual.vizBuffer.shift();

            // 1-Second Historical Data Rollup
            if (nowMs - chVisual.acc.lastSec >= 1000) {
                if (!chVisual.history) chVisual.history = [];
                if (chVisual.acc.count > 0) {
                    chVisual.history.push({
                        avg: chVisual.acc.sum / chVisual.acc.count,
                        min: chVisual.acc.min,
                        max: chVisual.acc.max
                    });
                }
                if (chVisual.history.length > 300) chVisual.history.shift();
                chVisual.acc = { sum: 0, count: 0, min: 1000000, max: 0, lastSec: nowMs };
            }

            if (chVisual.vizBuffer.length > 1) {
                const vLen = chVisual.vizBuffer.length;
                chVisual.slew = chVisual.vizBuffer[vLen - 1] - chVisual.vizBuffer[vLen - 2];
            }

            // Biodata Rolling Mean and Standard Deviation
            const bufferLen = chVisual.vizBuffer.length;
            let sum = 0, maxim = 0, minim = 1000000;
            for (let j = 0; j < bufferLen; j++) {
                const v = chVisual.vizBuffer[j];
                sum += v;
                if (v > maxim) maxim = v;
                if (v < minim) minim = v;
            }
            const mean = bufferLen > 0 ? sum / bufferLen : rVal;

            let sumSqDev = 0, maxDev = 0;
            for (let j = 0; j < bufferLen; j++) {
                const dev = Math.abs(chVisual.vizBuffer[j] - mean);
                sumSqDev += dev * dev;
                if (dev > maxDev) maxDev = dev;
            }

            const variance = bufferLen > 0 ? (sumSqDev / bufferLen) : 0;
            let stdevi = variance > 0 ? Math.sqrt(variance) : 1.0;
            if (stdevi < 0.1) stdevi = 1.0;

            chVisual.lastStdevi = stdevi;
            chVisual.lastMaxDev = maxDev;
            chVisual.lastBlockTime = nowMs;

            const threshold = p.threshold || 2.0;
            const currentRatio = maxDev / stdevi;
            const isOverThreshold = currentRatio >= threshold;

            const feed = this.channelFeeds[chIdx];
            const hasRecordedNotes = feed ? !!feed.hasRecordedNotes : false;

            const hasNote = record.note !== null && record.note !== undefined && record.note !== '' && !isNaN(parseInt(record.note));

            // 1. Playback exact recorded note event if present
            if (hasNote) {
                const n = parseInt(record.note);
                const v = (record.velocity !== null && record.velocity !== undefined && record.velocity !== '') ? parseInt(record.velocity) : 80;
                const d = (record.duration !== null && record.duration !== undefined && record.duration !== '') ? parseInt(record.duration) : 260;
                
                // processBiodata handles MIDI output, synth play, note roll visualizer, tab LED, and VU spike
                if (typeof window.processBiodata === 'function') {
                    window.processBiodata({ type: 'note', ch: chIdx, n: n, v: v, d: d });
                } else if (synthCh && typeof synthCh.play === 'function') {
                    synthCh.play(n, v, d);
                }

                if (chVisual.waveBuffer.length > 0) {
                    chVisual.waveBuffer[chVisual.waveBuffer.length - 1].evt = 1;
                    chVisual.waveBuffer[chVisual.waveBuffer.length - 1].n = n;
                }
            } 
            // 2. Fallback software threshold sonification ONLY for external datasets without recorded notes
            else if (!hasRecordedNotes && isOverThreshold && bufferLen >= Math.min(10, sampleWindow)) {
                const density = p.density !== undefined ? p.density : 100;
                const passesDensity = (Math.random() * 100) <= density;

                if (passesDensity) {
                    if (!this.channelFeeds[chIdx].lastNoteTime || (nowMs - this.channelFeeds[chIdx].lastNoteTime > 45)) {
                        this.channelFeeds[chIdx].lastNoteTime = nowMs;

                        const minN = p.minNote || 36;
                        const maxN = p.maxNote || 84;
                        const span = Math.max(1.0, maxim - minim);
                        let normPitch = Math.max(0, Math.min(1, (rVal - minim) / span));

                        if (typeof window.applySpreadCurve === 'function') {
                            normPitch = window.applySpreadCurve(normPitch, p.spread || 75);
                        }

                        const rawNote = Math.round(minN + normPitch * (maxN - minN));
                        let scaledNote = rawNote;
                        if (typeof window.scaleNote === 'function') {
                            scaledNote = window.scaleNote(rawNote, p.scaleType, p.scaleRoot, p.activeScaleBits, minN, maxN);
                        }

                        const velMin = p.velMin || 60;
                        const velMax = p.velMax || 110;
                        const devOver = Math.min(3.0, (currentRatio - threshold) / threshold);
                        const vel = Math.round(velMin + devOver * (velMax - velMin));
                        const durMult = p.durMult || 1.0;
                        const dur = Math.round((140 + Math.random() * 300) * durMult);

                        if (typeof window.processBiodata === 'function') {
                            window.processBiodata({
                                type: 'note',
                                ch: chIdx,
                                n: scaledNote,
                                v: vel,
                                d: dur
                            });
                        } else if (synthCh && typeof synthCh.play === 'function') {
                            synthCh.play(scaledNote, vel, dur);
                        }

                        if (chVisual.waveBuffer.length > 0) {
                            chVisual.waveBuffer[chVisual.waveBuffer.length - 1].evt = 1;
                            chVisual.waveBuffer[chVisual.waveBuffer.length - 1].n = scaledNote;
                        }
                    }
                } else {
                    if (typeof window.triggerDensityVisualizer === 'function') {
                        window.triggerDensityVisualizer(chIdx, 'drop');
                    }
                }
            }
        }

        loadTake(take) {
            if (!take || !Array.isArray(take.records) || take.records.length === 0) {
                throw new Error('Take contains no records');
            }

            // Restore full saved synth preset / channel parameters if present in take
            if (take.preset && Array.isArray(take.preset.channels)) {
                try {
                    const chDataPreset = take.preset.channels;
                    for (let i = 0; i < 4; i++) {
                        if (chDataPreset[i] && window.synthChannels && window.synthChannels[i]) {
                            window.synthChannels[i].params = JSON.parse(JSON.stringify(chDataPreset[i]));
                            window.synthChannels[i].applyParams();
                            
                            // Sync UI elements to restored take parameters
                            const miniT = document.getElementById(`ch-mini-thresh-${i}`);
                            const miniV = document.getElementById(`ch-val-thresh-${i}`);
                            const maxBtn = document.getElementById(`ch-max-btn-${i}`);
                            const maxScale = window.synthChannels[i].params.threshMax || 5.0;
                            if (miniT) {
                                miniT.max = maxScale.toString();
                                miniT.value = window.synthChannels[i].params.threshold;
                            }
                            if (miniV) miniV.innerText = parseFloat(window.synthChannels[i].params.threshold).toFixed(2) + 'x';
                            if (maxBtn) maxBtn.innerText = `${maxScale.toFixed(2)}x`;

                            const miniW = document.getElementById(`ch-window-${i}`);
                            const miniWV = document.getElementById(`ch-val-window-${i}`);
                            if (miniW) miniW.value = window.synthChannels[i].params.sampleSize;
                            if (miniWV) miniWV.innerText = window.synthChannels[i].params.sampleSize;
                        }

                        if (take.preset.viz && take.preset.viz[i] && window.chData && window.chData[i]) {
                            window.chData[i].config = JSON.parse(JSON.stringify(take.preset.viz[i]));
                        }
                    }

                    if (typeof window.syncUI === 'function') window.syncUI();
                } catch(presetErr) {
                    console.warn('Could not restore take preset snapshot:', presetErr);
                }
            }

            // Backfill notes from take.midiNotes if records lack note fields (e.g. takes recorded in earlier sessions)
            if (Array.isArray(take.midiNotes) && take.midiNotes.length > 0 && Array.isArray(take.records) && take.records.length > 0) {
                const firstRecTime = take.records[0].timestamp_ms || (take.records[0].timestamp ? new Date(take.records[0].timestamp).getTime() : 0);
                take.midiNotes.forEach(m => {
                    const noteAbsTime = firstRecTime + (m.timeMs || 0);
                    const ch = (m.channel !== undefined ? m.channel : 0) + 1;
                    let closest = null;
                    let minDiff = Infinity;
                    take.records.forEach(r => {
                        if (r.channel === ch) {
                            const rTime = r.timestamp_ms || (r.timestamp ? new Date(r.timestamp).getTime() : 0);
                            const diff = Math.abs(rTime - noteAbsTime);
                            if (diff < minDiff) {
                                minDiff = diff;
                                closest = r;
                            }
                        }
                    });
                    if (closest && minDiff < 500 && (!closest.note || closest.note === '')) {
                        closest.note = m.pitch;
                        closest.velocity = m.velocity || 80;
                        closest.duration = m.durationMs || 260;
                    }
                });
            }

            const headers = ['timestamp_iso', 'sensor_id', 'conductance_uS', 'channel', 'raw_ticks', 'note_event', 'velocity'];
            const lines = [headers.join(',')];

            take.records.forEach(r => {
                const noteVal = (r.note !== null && r.note !== undefined && r.note !== '') ? r.note : (r.note_event || '');
                const velVal = (r.velocity !== null && r.velocity !== undefined && r.velocity !== '') ? r.velocity : '';
                lines.push([
                    r.timestamp || '',
                    r.sensor_id || `CH_${r.channel || 1}_Sensor`,
                    r.conductance_uS !== undefined ? r.conductance_uS : (r.value || 50),
                    r.channel || 1,
                    r.ticks || '',
                    noteVal,
                    velVal
                ].join(','));
            });

            const csvContent = lines.join('\n');
            const fname = `${take.name || 'take'}.csv`;
            const parsed = this.parseFileContent(csvContent, fname);

            this.applyMappingConfig({
                mode: 'multi_sensor_id',
                identifierCol: 'sensor_id',
                valueCol: 'conductance_uS',
                timestampCol: 'timestamp_iso',
                cadenceRps: 30,
                autoApplyWindow: !take.preset // Keep restored windows if preset exists
            });

            return parsed;
        }
    }

    // --- 2. BIODATA RECORDER ENGINE ---
    class BiodataRecorderEngine {
        constructor() {
            this.isRecording = false;
            this.isPaused = false;
            this.sessionName = 'take';
            this.startTimeMs = 0;
            this.pauseTimeAccumulatedMs = 0;
            this.pauseStartMs = 0;
            this.records = [];
            this.totalPointsRecorded = 0;
            this.timerInterval = null;
            this.listeners = new Set();
            this.maxRecords = 50000;
            this.latestChannelValues = [0, 0, 0, 0];
            this.lastPacketTimeByCh = [0, 0, 0, 0];
        }

        subscribe(callback) {
            this.listeners.add(callback);
            return () => this.listeners.delete(callback);
        }

        emitChange(eventType = 'recorder_change') {
            const state = this.getState();
            this.listeners.forEach(fn => {
                try { fn(eventType, state); } catch(e) { console.error('Recorder listener err:', e); }
            });
            window.dispatchEvent(new CustomEvent('bioquad_recorder_update', { detail: { type: eventType, state } }));
        }

        getState() {
            let elapsedMs = 0;
            if (this.isRecording) {
                if (this.isPaused) {
                    elapsedMs = this.pauseStartMs - this.startTimeMs - this.pauseTimeAccumulatedMs;
                } else {
                    elapsedMs = Date.now() - this.startTimeMs - this.pauseTimeAccumulatedMs;
                }
            }

            return {
                isRecording: this.isRecording,
                isPaused: this.isPaused,
                sessionName: this.sessionName,
                recordCount: this.records.length,
                totalPointsRecorded: this.totalPointsRecorded || this.records.length,
                elapsedMs: Math.max(0, elapsedMs),
                elapsedFormatted: this.formatElapsed(elapsedMs),
                hasData: this.records.length > 0
            };
        }

        formatElapsed(ms) {
            const totalSec = Math.floor(ms / 1000);
            const m = Math.floor(totalSec / 60);
            const s = totalSec % 60;
            const tenths = Math.floor((ms % 1000) / 100);
            return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
        }

        start(sessionName = '') {
            const now = new Date();
            const y = now.getFullYear();
            const mo = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const h = String(now.getHours()).padStart(2, '0');
            const mi = String(now.getMinutes()).padStart(2, '0');
            const sec = String(now.getSeconds()).padStart(2, '0');
            const defaultDateName = `bioQuad_${y}${mo}${d}_${h}${mi}${sec}`;

            if (sessionName && sessionName.trim()) {
                this.sessionName = sessionName.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
            } else {
                this.sessionName = defaultDateName;
            }

            // Capture complete session preset snapshot (thresholds, windows, synth parameters)
            this.sessionPreset = this.captureCurrentPreset();
            this.recordedMidiNotes = []; // Stores MIDI notes for companion .mid file export

            this.records = [];
            this.totalPointsRecorded = 0;
            this.isRecording = true;
            this.isPaused = false;
            this.startTimeMs = Date.now();
            this.pauseTimeAccumulatedMs = 0;
            this.lastPacketTimeByCh = [0, 0, 0, 0];

            if (this.timerInterval) clearInterval(this.timerInterval);
            this.timerInterval = setInterval(() => {
                if (this.isRecording && !this.isPaused) {
                    this.emitChange('tick');
                }
            }, 100);

            this.emitChange('start');
        }

        captureCurrentPreset() {
            try {
                const channels = (window.synthChannels || []).map(ch => {
                    const p = JSON.parse(JSON.stringify(ch.params || {}));
                    p.savedPatchName = ch.patchName || "INIT";
                    return p;
                });
                return {
                    channels,
                    master: {
                        vol: window.masterVolumeLevel ?? 0.8,
                        muted: window.isMasterMuted ?? false,
                        bpm: window.masterBPM ?? 120
                    },
                    viz: (window.chData || []).map(ch => JSON.parse(JSON.stringify(ch.config || {}))),
                    globalFX: window.globalFX ? JSON.parse(JSON.stringify(window.globalFX)) : null
                };
            } catch(e) {
                console.warn('Could not capture synth preset snapshot:', e);
                return null;
            }
        }

        pause() {
            if (!this.isRecording || this.isPaused) return;
            this.isPaused = true;
            this.pauseStartMs = Date.now();
            this.emitChange('pause');
        }

        resume() {
            if (!this.isRecording || !this.isPaused) return;
            this.pauseTimeAccumulatedMs += (Date.now() - this.pauseStartMs);
            this.isPaused = false;
            this.emitChange('resume');
        }

        async stop(autoArm = true) {
            if (!this.isRecording) return;
            this.isRecording = false;
            this.isPaused = false;
            if (this.timerInterval) {
                clearInterval(this.timerInterval);
                this.timerInterval = null;
            }

            const elapsedMs = Math.max(0, Date.now() - this.startTimeMs - this.pauseTimeAccumulatedMs);

            if (this.records.length > 0) {
                const takeObj = {
                    id: `take_${Date.now()}`,
                    name: this.sessionName,
                    date: new Date().toLocaleString(),
                    timestamp: Date.now(),
                    durationMs: elapsedMs,
                    durationFormatted: this.formatElapsed(elapsedMs),
                    sampleCount: this.records.length,
                    totalPointsRecorded: this.totalPointsRecorded || this.records.length,
                    preset: this.sessionPreset || this.captureCurrentPreset(),
                    midiNotes: [...(this.recordedMidiNotes || [])],
                    records: [...this.records]
                };

                try {
                    await window.bioquadStorage.saveTake(takeObj);
                    window.dispatchEvent(new CustomEvent('bioquad_takes_updated', { detail: takeObj }));
                } catch(e) {
                    console.warn('Could not auto-save take to IndexedDB:', e);
                }
            }

            if (autoArm && this.records.length > 0) {
                try {
                    this.loadRecordingIntoStreamer();
                } catch(e) {
                    console.warn("Auto-arm player notice:", e);
                }
            }
            this.emitChange('stop');
        }

        clear() {
            this.stop(false);
            this.records = [];
            this.recordedMidiNotes = [];
            this.totalPointsRecorded = 0;
            this.emitChange('clear');
        }

        recordRaw(chIdx, ticksArray) {
            if (!this.isRecording || this.isPaused || !Array.isArray(ticksArray)) return;

            const CALIBRATION_FACTOR = 10000000;
            const now = Date.now();
            const sensorId = `CH_${chIdx + 1}_Sensor`;

            const count = ticksArray.length;
            const lastTime = this.lastPacketTimeByCh[chIdx] || (now - 50);
            this.lastPacketTimeByCh[chIdx] = now;
            const intervalMs = Math.max(10, Math.min(200, now - lastTime));

            // Record pure raw biological pulse data with microsecond-calibrated conductance
            for (let i = 0; i < count; i++) {
                const rawTicks = ticksArray[i];
                let rVal = rawTicks > 0 ? (CALIBRATION_FACTOR / rawTicks) : 0;
                rVal = Math.max(0.1, parseFloat(rVal.toFixed(2)));
                this.latestChannelValues[chIdx] = rVal;

                this.totalPointsRecorded = (this.totalPointsRecorded || 0) + 1;

                if (this.records.length >= this.maxRecords) {
                    this.records.shift();
                }

                const tickTimeMs = count > 1 
                    ? Math.round(lastTime + ((i + 1) / count) * intervalMs)
                    : now;

                this.records.push({
                    timestamp: new Date(tickTimeMs).toISOString(),
                    timestamp_ms: tickTimeMs,
                    sensor_id: sensorId,
                    channel: chIdx + 1,
                    conductance_uS: rVal,
                    ticks: rawTicks,
                    note: null,
                    velocity: null,
                    duration: null
                });
            }
        }

        // Companion MIDI note tracker and stream note associator for 1-to-1 sonification parity
        recordNote(chIdx, note, velocity, duration) {
            if (!this.isRecording || this.isPaused) return;
            const now = Date.now();
            const timeOffsetMs = Math.max(0, now - this.startTimeMs - this.pauseTimeAccumulatedMs);

            if (!this.recordedMidiNotes) this.recordedMidiNotes = [];
            this.recordedMidiNotes.push({
                timeMs: timeOffsetMs,
                channel: chIdx,
                pitch: note,
                velocity: velocity || 80,
                durationMs: duration || 260
            });

            // Tag note onto the active data stream for this channel
            let tagged = false;
            for (let i = this.records.length - 1; i >= 0 && i >= this.records.length - 50; i--) {
                const rec = this.records[i];
                if (rec.channel === (chIdx + 1) && Math.abs(rec.timestamp_ms - now) < 150 && (!rec.note || rec.note === '')) {
                    rec.note = note;
                    rec.velocity = velocity || 80;
                    rec.duration = duration || 260;
                    tagged = true;
                    break;
                }
            }

            // If no recent raw tick record was found for this channel (e.g. standard BLE MIDI mode), insert a discrete record
            if (!tagged) {
                const sensorId = `CH_${chIdx + 1}_Sensor`;
                const rVal = this.latestChannelValues[chIdx] || 50;
                const ticks = Math.round(10000000 / (rVal || 1));
                this.records.push({
                    timestamp: new Date(now).toISOString(),
                    timestamp_ms: now,
                    sensor_id: sensorId,
                    channel: chIdx + 1,
                    conductance_uS: rVal,
                    ticks: ticks,
                    note: note,
                    velocity: velocity || 80,
                    duration: duration || 260
                });
                this.totalPointsRecorded = (this.totalPointsRecorded || 0) + 1;
            }
        }

        generateCsv(format = 'standard') {
            if (this.records.length === 0) return '';

            const delimiter = format === 'tsv' ? '\t' : ',';
            const headers = ['timestamp_iso', 'sensor_id', 'conductance_uS', 'channel', 'raw_ticks', 'note_event', 'velocity'];
            const lines = [headers.join(delimiter)];

            this.records.forEach(r => {
                const noteVal = (r.note !== null && r.note !== undefined && r.note !== '') ? r.note : (r.note_event || '');
                const velVal = (r.velocity !== null && r.velocity !== undefined && r.velocity !== '') ? r.velocity : '';
                lines.push([
                    r.timestamp,
                    r.sensor_id,
                    r.conductance_uS,
                    r.channel,
                    r.ticks,
                    noteVal,
                    velVal
                ].join(delimiter));
            });

            return lines.join('\n');
        }

        // Build standard Type 0 Standard MIDI File (.mid) with optional channel filtering and track name
        generateMidiBlob(midiNotes = null, targetChannel = null, trackName = '') {
            let notes = midiNotes || this.recordedMidiNotes || [];
            if (targetChannel !== null && targetChannel !== undefined) {
                notes = notes.filter(n => n.channel === targetChannel);
            }
            if (notes.length === 0) return null;

            const ticksPerQuarter = 480;
            const bpm = (window.masterBPM && !isNaN(window.masterBPM)) ? window.masterBPM : 120;
            const msPerTick = (60000 / bpm) / ticksPerQuarter;

            // Sort note on/off events by tick
            const events = [];
            notes.forEach(n => {
                const startTick = Math.max(0, Math.round(n.timeMs / msPerTick));
                const endTick = Math.max(startTick + 1, Math.round((n.timeMs + n.durationMs) / msPerTick));
                const ch = (targetChannel !== null && targetChannel !== undefined) ? 0 : Math.max(0, Math.min(15, n.channel || 0));
                
                events.push({ tick: startTick, type: 0x90, channel: ch, note: n.pitch, vel: n.velocity || 80 });
                events.push({ tick: endTick, type: 0x80, channel: ch, note: n.pitch, vel: 0 });
            });

            events.sort((a, b) => a.tick - b.tick || a.type - b.type);

            // Variable-length quantity encoder
            function writeVarLen(val) {
                const bytes = [];
                let buffer = val & 0x7F;
                while ((val >>= 7)) {
                    buffer <<= 8;
                    buffer |= ((val & 0x7F) | 0x80);
                }
                while (true) {
                    bytes.push(buffer & 0xFF);
                    if (buffer & 0x80) buffer >>= 8;
                    else break;
                }
                return bytes;
            }

            const trackBytes = [];
            let lastTick = 0;

            // Set Tempo Meta Event (500,000 microseconds per quarter for 120 BPM)
            const mpqn = Math.round(60000000 / bpm);
            trackBytes.push(0x00, 0xFF, 0x51, 0x03, (mpqn >> 16) & 0xFF, (mpqn >> 8) & 0xFF, mpqn & 0xFF);

            // Track Name Meta Event (useful in Ableton Live and other DAWs)
            if (trackName) {
                const nameBytes = Array.from(new TextEncoder().encode(trackName));
                trackBytes.push(0x00, 0xFF, 0x03, ...writeVarLen(nameBytes.length), ...nameBytes);
            }

            events.forEach(ev => {
                const delta = Math.max(0, ev.tick - lastTick);
                lastTick = ev.tick;
                trackBytes.push(...writeVarLen(delta));
                trackBytes.push(ev.type | (ev.channel & 0x0F));
                trackBytes.push(ev.note & 0x7F);
                trackBytes.push(ev.vel & 0x7F);
            });

            // End of track meta event
            trackBytes.push(0x00, 0xFF, 0x2F, 0x00);

            // MIDI Header: 'MThd' (4 bytes), length 6, format 0, 1 track, ticksPerQuarter
            const header = [
                0x4D, 0x54, 0x68, 0x64, // 'MThd'
                0x00, 0x00, 0x00, 0x06, // length 6
                0x00, 0x00,             // format 0 (single track)
                0x00, 0x01,             // 1 track
                (ticksPerQuarter >> 8) & 0xFF, ticksPerQuarter & 0xFF
            ];

            // Track Header: 'MTrk' (4 bytes), length (4 bytes)
            const trackLen = trackBytes.length;
            const trackHeader = [
                0x4D, 0x54, 0x72, 0x6B, // 'MTrk'
                (trackLen >> 24) & 0xFF,
                (trackLen >> 16) & 0xFF,
                (trackLen >> 8) & 0xFF,
                trackLen & 0xFF
            ];

            const fullBytes = new Uint8Array([...header, ...trackHeader, ...trackBytes]);
            return new Blob([fullBytes], { type: 'audio/midi' });
        }

        downloadRecordingFile(format = 'standard') {
            const ext = format === 'tsv' ? 'tsv' : 'csv';
            const content = this.generateCsv(format);
            if (!content) return;

            const blob = new Blob([content], { type: format === 'tsv' ? 'text/tab-separated-values' : 'text/csv' });
            this.triggerDownloadBlob(blob, `${this.sessionName}.${ext}`);
            return `${this.sessionName}.${ext}`;
        }

        downloadMidiFile() {
            const allNotes = this.recordedMidiNotes || [];
            const baseName = this.sessionName || 'bioQuad';
            const activeChannels = [0, 1, 2, 3].filter(ch => allNotes.some(n => n.channel === ch));

            if (activeChannels.length === 0) {
                const blob = this.generateMidiBlob(allNotes, null, 'bioQuad');
                if (blob) {
                    this.triggerDownloadBlob(blob, `${baseName}.mid`);
                    return `${baseName}.mid`;
                }
                return;
            }

            activeChannels.forEach((ch, idx) => {
                setTimeout(() => {
                    const blob = this.generateMidiBlob(allNotes, ch, `CH ${ch + 1}`);
                    if (blob) {
                        this.triggerDownloadBlob(blob, `${baseName}_ch${ch + 1}.mid`);
                    }
                }, idx * 120);
            });
            return `${baseName}_ch*.mid`;
        }

        triggerDownloadBlob(blob, fname) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fname;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        loadRecordingIntoStreamer() {
            const content = this.generateCsv('standard');
            if (!content) return;

            if (!window.dataStreamer) return;
            const fname = `${this.sessionName}.csv`;
            const parsed = window.dataStreamer.parseFileContent(content, fname);
            
            window.dataStreamer.applyMappingConfig({
                mode: 'multi_sensor_id',
                identifierCol: 'sensor_id',
                valueCol: 'conductance_uS',
                timestampCol: 'timestamp_iso',
                cadenceRps: 30,
                autoApplyWindow: false
            });

            return parsed;
        }
    }

    // Export singletons on window
    window.BioquadStorage = BioquadStorage;
    window.bioquadStorage = new BioquadStorage();
    window.DataStreamer = DataStreamerEngine;
    window.dataStreamer = new DataStreamerEngine();
    window.BiodataRecorder = BiodataRecorderEngine;
    window.biodataRecorder = new BiodataRecorderEngine();

})(window);
