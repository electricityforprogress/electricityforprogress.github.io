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

    // --- 0. ZERO-DEPENDENCY OFFLINE CRC32 ZIP ARCHIVE BUILDER ---
    const CRC32_TABLE = (() => {
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[i] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) {
            crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    /**
     * Packages multiple files cleanly into an uncompressed Store-mode .zip Blob.
     * Works 100% offline with zero external libraries.
     * @param {Array<{name: string, data: Uint8Array|ArrayBuffer}>} entries
     * @returns {Blob}
     */
    function buildZipBlob(entries) {
        const encoder = new TextEncoder();
        const localParts = [];
        const centralParts = [];
        let offset = 0;

        const now = new Date();
        const dosTime = ((now.getHours() & 0x1F) << 11) | ((now.getMinutes() & 0x3F) << 5) | ((now.getSeconds() >> 1) & 0x1F);
        const dosDate = (((Math.max(1980, now.getFullYear()) - 1980) & 0x7F) << 9) | (((now.getMonth() + 1) & 0x0F) << 5) | (now.getDate() & 0x1F);

        entries.forEach((entry) => {
            const nameBytes = encoder.encode(entry.name);
            const dataBytes = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
            const sum = crc32(dataBytes);
            const len = dataBytes.length;

            // Local file header (30 bytes + filename)
            const localHdr = new Uint8Array(30 + nameBytes.length);
            const lv = new DataView(localHdr.buffer);
            lv.setUint32(0, 0x04034B50, true); // Local file header signature
            lv.setUint16(4, 20, true);         // Version needed (2.0)
            lv.setUint16(6, 0x0800, true);     // UTF-8 filename flag
            lv.setUint16(8, 0, true);          // Compression method: 0 (Store)
            lv.setUint16(10, dosTime, true);
            lv.setUint16(12, dosDate, true);
            lv.setUint32(14, sum, true);
            lv.setUint32(18, len, true);
            lv.setUint32(22, len, true);
            lv.setUint16(26, nameBytes.length, true);
            lv.setUint16(28, 0, true);         // Extra field length
            localHdr.set(nameBytes, 30);

            localParts.push(localHdr, dataBytes);

            // Central directory file header (46 bytes + filename)
            const centralHdr = new Uint8Array(46 + nameBytes.length);
            const cv = new DataView(centralHdr.buffer);
            cv.setUint32(0, 0x02014B50, true); // Central dir signature
            cv.setUint16(4, 20, true);         // Version made by
            cv.setUint16(6, 20, true);         // Version needed
            cv.setUint16(8, 0x0800, true);     // UTF-8 flag
            cv.setUint16(10, 0, true);         // Store
            cv.setUint16(12, dosTime, true);
            cv.setUint16(14, dosDate, true);
            cv.setUint32(16, sum, true);
            cv.setUint32(20, len, true);
            cv.setUint32(24, len, true);
            cv.setUint16(28, nameBytes.length, true);
            cv.setUint16(30, 0, true);
            cv.setUint16(32, 0, true);
            cv.setUint16(34, 0, true);
            cv.setUint16(36, 0, true);
            cv.setUint32(38, 0, true);
            cv.setUint32(42, offset, true);    // Relative offset of local header
            centralHdr.set(nameBytes, 46);

            centralParts.push(centralHdr);
            offset += localHdr.length + len;
        });

        let centralSize = 0;
        centralParts.forEach(p => { centralSize += p.length; });

        // End of central directory record (22 bytes)
        const eocd = new Uint8Array(22);
        const ev = new DataView(eocd.buffer);
        ev.setUint32(0, 0x06054B50, true);
        ev.setUint16(4, 0, true);
        ev.setUint16(6, 0, true);
        ev.setUint16(8, entries.length, true);
        ev.setUint16(10, entries.length, true);
        ev.setUint32(12, centralSize, true);
        ev.setUint32(16, offset, true);
        ev.setUint16(20, 0, true);

        return new Blob([...localParts, ...centralParts, eocd], { type: 'application/zip' });
    }

    // --- 1. PERSISTENT CHUNKED TAKE & SESSION STORAGE ENGINE (INDEXEDDB v2) ---
    class BioquadStorage {
        constructor() {
            this.dbName = 'bioquad_db';
            this.dbVersion = 2;
            this.storeName = 'takes';
            this.chunkStoreName = 'take_chunks';
            this.defaultChunkSize = 5000;
            this.db = null;
        }

        async getDb() {
            if (this.db) return this.db;
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(this.dbName, this.dbVersion);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        db.createObjectStore(this.storeName, { keyPath: 'id' });
                    }
                    if (!db.objectStoreNames.contains(this.chunkStoreName)) {
                        const chunkStore = db.createObjectStore(this.chunkStoreName, { keyPath: 'chunkKey' });
                        chunkStore.createIndex('by_take', 'takeId', { unique: false });
                    }
                };
                req.onsuccess = (e) => {
                    this.db = e.target.result;
                    resolve(this.db);
                };
                req.onerror = (e) => reject(e.target.error);
            });
        }

        async saveTakeMeta(meta) {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                store.put(meta);
                tx.oncomplete = () => resolve(meta);
                tx.onerror = (e) => reject(e.target.error);
            });
        }

        async saveChunk(takeId, chunkIndex, records, midiNotes = [], paramEvents = []) {
            const db = await this.getDb();
            const chunkKey = `${takeId}_${String(chunkIndex).padStart(6, '0')}`;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.chunkStoreName, 'readwrite');
                const store = tx.objectStore(this.chunkStoreName);
                store.put({
                    chunkKey,
                    takeId,
                    chunkIndex,
                    records: records || [],
                    midiNotes: midiNotes || [],
                    paramEvents: paramEvents || []
                });
                tx.oncomplete = () => resolve(chunkKey);
                tx.onerror = (e) => reject(e.target.error);
            });
        }

        async saveTake(take) {
            // If take has large inline records, automatically split into chunks so IndexedDB never stores giant monoliths
            const recs = Array.isArray(take.records) ? take.records : [];
            const notes = Array.isArray(take.midiNotes) ? take.midiNotes : [];
            const params = Array.isArray(take.paramEvents) ? take.paramEvents : [];

            if (recs.length === 0 && params.length === 0 && take.schemaVersion === 2) {
                return this.saveTakeMeta(take);
            }

            const chunkSize = this.defaultChunkSize;
            const totalChunks = Math.max(1, Math.ceil(recs.length / chunkSize));

            for (let i = 0; i < totalChunks; i++) {
                const sliceRecs = recs.slice(i * chunkSize, (i + 1) * chunkSize);
                const sliceNotes = i === 0 ? notes : [];
                const sliceParams = i === 0 ? params : [];
                await this.saveChunk(take.id, i, sliceRecs, sliceNotes, sliceParams);
            }

            const meta = {
                id: take.id,
                name: take.name,
                date: take.date,
                timestamp: take.timestamp,
                durationMs: take.durationMs,
                durationFormatted: take.durationFormatted,
                sampleCount: take.sampleCount || recs.length,
                totalPointsRecorded: take.totalPointsRecorded || recs.length,
                chunkCount: totalChunks,
                schemaVersion: 2,
                hasAutomation: !!(take.hasAutomation || params.length > 0),
                automationCount: take.automationCount || params.length,
                preset: take.preset || null
            };
            return this.saveTakeMeta(meta);
        }

        async getTakeMeta(id) {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readonly');
                const store = tx.objectStore(this.storeName);
                const req = store.get(id);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = (e) => reject(e.target.error);
            });
        }

        /**
         * Reads ONLY lightweight metadata using a cursor so opening the File Portal
         * never loads 500,000-row record arrays into JS heap RAM at once.
         */
        async getAllTakeMetadata() {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readonly');
                const store = tx.objectStore(this.storeName);
                const req = store.openCursor();
                const results = [];

                req.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        const v = cursor.value;
                        const hasInlineRecords = Array.isArray(v.records);
                        const storedCount = (v.schemaVersion === 2 || !hasInlineRecords)
                            ? (v.totalPointsRecorded || v.sampleCount || 0)
                            : v.records.length;
                        results.push({
                            id: v.id,
                            name: v.name,
                            date: v.date,
                            timestamp: v.timestamp,
                            durationMs: v.durationMs || 0,
                            durationFormatted: v.durationFormatted || '00:00.0',
                            sampleCount: v.sampleCount || storedCount,
                            totalPointsRecorded: v.totalPointsRecorded || v.sampleCount || storedCount,
                            storedRecordCount: storedCount,
                            chunkCount: v.chunkCount || 0,
                            schemaVersion: v.schemaVersion || 1,
                            isRecordingActive: !!v.isRecordingActive,
                            hasPreset: !!v.preset,
                            hasAutomation: !!(v.hasAutomation || (v.automationCount || 0) > 0),
                            automationCount: v.automationCount || 0
                        });
                        cursor.continue();
                    } else {
                        results.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                        resolve(results);
                    }
                };
                req.onerror = (e) => reject(e.target.error);
            });
        }

        // Alias kept for external callers; returns lightweight metadata list!
        async getAllTakes() {
            return this.getAllTakeMetadata();
        }

        /**
         * Iterates chunks of a single take ONE CHUNK AT A TIME so exporting 500k–2M+ records
         * never loads all chunks into JS heap simultaneously.
         * Supports both v2 chunked takes and legacy v1 monolithic takes seamlessly.
         */
        async iterateTakeChunks(takeId, onChunk) {
            const takeMeta = await this.getTakeMeta(takeId);
            if (!takeMeta) throw new Error('Recording not found in storage');

            // Legacy v1 take fallback: records stored inline inside takes store
            if (Array.isArray(takeMeta.records) && takeMeta.records.length > 0 && (!takeMeta.chunkCount || takeMeta.schemaVersion !== 2)) {
                const chunkSize = this.defaultChunkSize;
                const total = takeMeta.records.length;
                const numSlices = Math.ceil(total / chunkSize);
                for (let i = 0; i < numSlices; i++) {
                    const recSlice = takeMeta.records.slice(i * chunkSize, (i + 1) * chunkSize);
                    const noteSlice = i === 0 ? (takeMeta.midiNotes || []) : [];
                    const paramSlice = i === 0 ? (takeMeta.paramEvents || []) : [];
                    await onChunk({
                        chunkIndex: i,
                        totalChunks: numSlices,
                        records: recSlice,
                        midiNotes: noteSlice,
                        paramEvents: paramSlice
                    }, takeMeta);
                }
                return takeMeta;
            }

            // v2 chunked storage: fetch chunk primary keys only, sort, then stream one chunk at a time
            const db = await this.getDb();
            const chunkKeys = await new Promise((resolve, reject) => {
                const tx = db.transaction(this.chunkStoreName, 'readonly');
                const store = tx.objectStore(this.chunkStoreName);
                const idx = store.index('by_take');
                const req = idx.getAllKeys(IDBKeyRange.only(takeId));
                req.onsuccess = () => {
                    const keys = (req.result || []).slice().sort();
                    resolve(keys);
                };
                req.onerror = (e) => reject(e.target.error);
            });

            if (chunkKeys.length === 0) {
                return takeMeta;
            }

            for (let i = 0; i < chunkKeys.length; i++) {
                const chunk = await new Promise((resolve, reject) => {
                    const tx = db.transaction(this.chunkStoreName, 'readonly');
                    const store = tx.objectStore(this.chunkStoreName);
                    const req = store.get(chunkKeys[i]);
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = (e) => reject(e.target.error);
                });
                if (!chunk) continue;
                await onChunk({
                    chunkIndex: i,
                    totalChunks: chunkKeys.length,
                    records: chunk.records || [],
                    midiNotes: chunk.midiNotes || [],
                    paramEvents: chunk.paramEvents || []
                }, takeMeta);
            }

            return takeMeta;
        }

        /**
         * Builds a memory-safe CSV Blob chunk-by-chunk for takes of any length (500k–2M+ records).
         * Merges telemetry rows and inline PERF_PARAM automation rows in chronological order.
         */
        async exportTakeCsvBlob(takeId, onProgress) {
            const preMeta = await this.getTakeMeta(takeId);
            const includeAutoCols = Boolean(preMeta && (preMeta.hasAutomation || (preMeta.automationCount || 0) > 0));
            const headers = includeAutoCols
                ? 'timestamp_iso,sensor_id,conductance_uS,channel,raw_ticks,note_event,velocity,param_attr,param_value\n'
                : 'timestamp_iso,sensor_id,conductance_uS,channel,raw_ticks,note_event,velocity\n';
            const blobParts = [headers];
            let recordCount = 0;
            let automationCount = 0;

            const formatRecRow = (r) => {
                const noteVal = (r.note !== null && r.note !== undefined && r.note !== '') ? r.note : (r.note_event || '');
                const velVal = (r.velocity !== null && r.velocity !== undefined && r.velocity !== '') ? r.velocity : '';
                const condVal = r.conductance_uS !== undefined ? r.conductance_uS : (r.value !== undefined ? r.value : 50);
                const baseRow = `${csvEscape(r.timestamp || '')},${csvEscape(r.sensor_id || ('CH_' + (r.channel || 1) + '_Sensor'))},${condVal},${r.channel || 1},${r.ticks || ''},${noteVal},${velVal}`;
                return includeAutoCols ? `${baseRow},,` : baseRow;
            };

            const formatParamRow = (ev) => {
                const iso = ev.timestamp || (ev.timestamp_ms !== undefined ? new Date(ev.timestamp_ms).toISOString() : '');
                const ch = (ev.channel !== null && ev.channel !== undefined) ? ev.channel : 0;
                return `${csvEscape(iso)},PERF_PARAM,,${ch},,,,${csvEscape(ev.attr || '')},${csvEscape(ev.value ?? '')}`;
            };

            const takeMeta = await this.iterateTakeChunks(takeId, async (chunk) => {
                const recs = chunk.records || [];
                const pevs = includeAutoCols
                    ? (chunk.paramEvents || []).slice().sort((a, b) => (a.timestamp_ms || 0) - (b.timestamp_ms || 0))
                    : [];
                const lines = [];

                let ri = 0;
                let pi = 0;
                while (ri < recs.length || pi < pevs.length) {
                    if (pi >= pevs.length) {
                        lines.push(formatRecRow(recs[ri++]));
                        recordCount++;
                    } else if (ri >= recs.length) {
                        lines.push(formatParamRow(pevs[pi++]));
                        automationCount++;
                    } else {
                        const rMs = recs[ri].timestamp_ms !== undefined ? recs[ri].timestamp_ms : (recs[ri].timestamp ? Date.parse(recs[ri].timestamp) : 0);
                        const pMs = pevs[pi].timestamp_ms !== undefined ? pevs[pi].timestamp_ms : (pevs[pi].timestamp ? Date.parse(pevs[pi].timestamp) : 0);
                        if (pMs <= rMs) {
                            lines.push(formatParamRow(pevs[pi++]));
                            automationCount++;
                        } else {
                            lines.push(formatRecRow(recs[ri++]));
                            recordCount++;
                        }
                    }
                }

                if (lines.length > 0) {
                    // Wrap each chunk in a sub-Blob immediately so JS strings can be garbage collected
                    blobParts.push(new Blob([lines.join('\n') + '\n'], { type: 'text/plain' }));
                }
                if (typeof onProgress === 'function') {
                    onProgress(chunk.chunkIndex + 1, chunk.totalChunks, recordCount);
                }
            });

            const safeName = (takeMeta.name || 'bioQuad').replace(/[^a-zA-Z0-9_-]/g, '_');
            const blob = new Blob(blobParts, { type: 'text/csv;charset=utf-8' });
            return {
                blob,
                filename: `${safeName}.csv`,
                recordCount,
                automationCount,
                byteSize: blob.size,
                takeMeta
            };
        }

        /**
         * Extracts all MIDI notes across chunks and bundles active channels (CH 1..4) into a single offline .zip Blob.
         */
        async exportTakeMidiZipBlob(takeId, onProgress) {
            const allNotes = [];
            let firstRecTime = null;
            let processedPoints = 0;

            const takeMeta = await this.iterateTakeChunks(takeId, async (chunk) => {
                const recs = chunk.records || [];
                if (firstRecTime === null && recs.length > 0) {
                    firstRecTime = recs[0].timestamp_ms || (recs[0].timestamp ? new Date(recs[0].timestamp).getTime() : 0);
                }

                if (Array.isArray(chunk.midiNotes) && chunk.midiNotes.length > 0) {
                    for (let i = 0; i < chunk.midiNotes.length; i++) {
                        allNotes.push(chunk.midiNotes[i]);
                    }
                } else if (recs.length > 0) {
                    const baseTime = firstRecTime || 0;
                    for (let i = 0; i < recs.length; i++) {
                        const r = recs[i];
                        if (r.note !== null && r.note !== undefined && r.note !== '' && !isNaN(parseInt(r.note))) {
                            const rMs = r.timestamp_ms || (r.timestamp ? new Date(r.timestamp).getTime() : baseTime);
                            allNotes.push({
                                timeMs: Math.max(0, rMs - baseTime),
                                channel: Math.max(0, Math.min(3, (r.channel || 1) - 1)),
                                pitch: parseInt(r.note),
                                velocity: r.velocity || 80,
                                durationMs: r.duration || 260
                            });
                        }
                    }
                }
                processedPoints += recs.length;
                if (typeof onProgress === 'function') {
                    onProgress(chunk.chunkIndex + 1, chunk.totalChunks, processedPoints);
                }
            });

            const rec = window.biodataRecorder;
            const safeName = (takeMeta.name || 'bioQuad').replace(/[^a-zA-Z0-9_-]/g, '_');
            const takeBpm = takeMeta.preset?.master?.bpm || window.masterBPM || 120;
            const activeChannels = [0, 1, 2, 3].filter(ch => allNotes.some(n => n.channel === ch));

            const zipEntries = [];
            if (activeChannels.length > 0) {
                activeChannels.forEach((ch) => {
                    const bytes = rec.generateMidiBytes(allNotes, ch, `CH ${ch + 1}`, takeBpm);
                    if (bytes) {
                        zipEntries.push({
                            name: `${safeName}_ch${ch + 1}.mid`,
                            data: bytes
                        });
                    }
                });
            }

            if (zipEntries.length === 0) {
                throw new Error('This recording has no MIDI note events to export');
            }

            const zipBlob = buildZipBlob(zipEntries);
            return {
                blob: zipBlob,
                filename: `${safeName}_midi.zip`,
                fileCount: zipEntries.length,
                channelList: activeChannels.map(ch => `CH ${ch + 1}`),
                noteCount: allNotes.length,
                byteSize: zipBlob.size,
                takeMeta
            };
        }

        async renameTake(id, rawNewName) {
            if (!id) return null;
            const takeMeta = await this.getTakeMeta(id);
            if (!takeMeta) return null;
            const cleanName = (window.BioQuadCore && typeof window.BioQuadCore.sanitizeSessionFilename === 'function')
                ? window.BioQuadCore.sanitizeSessionFilename(rawNewName, 'bioQuad')
                : (String(rawNewName || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_') || takeMeta.name);
            takeMeta.name = cleanName;
            await this.saveTakeMeta(takeMeta);
            window.dispatchEvent(new CustomEvent('bioquad_takes_updated', { detail: takeMeta }));
            return takeMeta;
        }

        async deleteTake(id) {
            const db = await this.getDb();
            // 1. Delete all chunks belonging to this takeId
            await new Promise((resolve, reject) => {
                const tx = db.transaction(this.chunkStoreName, 'readwrite');
                const store = tx.objectStore(this.chunkStoreName);
                const idx = store.index('by_take');
                const req = idx.openCursor(IDBKeyRange.only(id));
                req.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        cursor.delete();
                        cursor.continue();
                    }
                };
                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => reject(e.target.error);
            });

            // 2. Delete take metadata
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
            await new Promise((resolve, reject) => {
                const tx = db.transaction(this.chunkStoreName, 'readwrite');
                tx.objectStore(this.chunkStoreName).clear();
                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => reject(e.target.error);
            });
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                tx.objectStore(this.storeName).clear();
                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => reject(e.target.error);
            });
        }
    }

    // --- PERFORMANCE AUTOMATION CODEC & CSV HELPERS ---
    function csvEscape(val) {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    function splitDelimitedRow(line, delimiter) {
        if (delimiter instanceof RegExp) {
            return line.split(delimiter).map(s => s.trim().replace(/^["']|["']$/g, ''));
        }
        const out = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (line[i + 1] === '"') {
                        cur += '"';
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    cur += ch;
                }
            } else if (ch === '"') {
                inQuotes = true;
            } else if (ch === delimiter) {
                out.push(cur.trim());
                cur = '';
            } else {
                cur += ch;
            }
        }
        out.push(cur.trim());
        return out;
    }

    function normalizeParamValue(attr, val) {
        if (attr === 'activeScaleBits') {
            const bits = (typeof window.decodeScaleBits === 'function') ? window.decodeScaleBits(val) : null;
            if (bits) {
                return bits.map(b => (b ? '1' : '0')).join('');
            }
            if (Array.isArray(val)) {
                return Array.from({ length: 12 }, (_, i) => (val[i] ? '1' : '0')).join('');
            }
            const s = String(val || '').replace(/[^01]/g, '');
            if (s.length >= 12) return s.slice(0, 12);
            return '111111111111';
        }
        if (typeof val === 'boolean') return val ? '1' : '0';
        if (typeof val === 'number') {
            if (!isFinite(val)) return '0';
            return String(Math.round(val * 10000) / 10000);
        }
        return String(val ?? '');
    }

    function parseBoolParam(val) {
        if (typeof val === 'boolean') return val;
        const s = String(val ?? '').trim().toLowerCase();
        return s === '1' || s === 'true' || s === 'yes';
    }

    function extractFullStateEvents(timestampMs) {
        const events = [];
        const iso = new Date(timestampMs).toISOString();
        const pushEv = (channel, attr, val) => {
            events.push({
                timestamp: iso,
                timestamp_ms: timestampMs,
                channel,
                attr,
                value: normalizeParamValue(attr, val)
            });
        };

        pushEv(0, 'master.vol', window.masterVolumeLevel ?? 0.75);
        pushEv(0, 'master.muted', !!window.isMasterMuted);
        pushEv(0, 'master.bpm', window.masterBPM ?? 120);

        if (window.globalFX) {
            pushEv(0, 'globalFX.level', window.globalFX.level ?? 0.85);
            pushEv(0, 'globalFX.muted', !!window.globalFX.muted);
            if (window.globalFX.dly) {
                ['time', 'feedback', 'tone', 'toRev'].forEach(k => pushEv(0, `globalFX.dly.${k}`, window.globalFX.dly[k]));
            }
            if (window.globalFX.rev) {
                ['size', 'damp', 'hpf'].forEach(k => pushEv(0, `globalFX.rev.${k}`, window.globalFX.rev[k]));
            }
        }

        const channels = window.synthChannels || [];
        for (let i = 0; i < 4; i++) {
            const chObj = channels[i];
            const p = chObj ? chObj.params : window.defaultParams;
            if (!p) continue;
            const ch = i + 1;

            pushEv(ch, 'mixVol', p.mixVol ?? 0.5);
            pushEv(ch, 'muted', !!p.muted);
            pushEv(ch, 'midiOutCh', p.midiOutCh !== undefined ? p.midiOutCh : i);
            pushEv(ch, 'threshold', p.threshold ?? 2.0);
            pushEv(ch, 'threshMax', p.threshMax ?? 5.0);
            pushEv(ch, 'sampleSize', p.sampleSize ?? 40);
            pushEv(ch, 'scaleRoot', p.scaleRoot ?? 0);
            pushEv(ch, 'scaleType', p.scaleType || 'chromatic');
            pushEv(ch, 'activeScaleBits', p.activeScaleBits || new Array(12).fill(true));
            pushEv(ch, 'quantize', p.quantize ?? 0);
            pushEv(ch, 'density', p.density ?? 100);
            pushEv(ch, 'durMult', p.durMult ?? 1.0);
            pushEv(ch, 'spread', p.spread ?? 75);
            pushEv(ch, 'minNote', p.minNote ?? 36);
            pushEv(ch, 'maxNote', p.maxNote ?? 84);
            pushEv(ch, 'velMin', p.velMin ?? 60);
            pushEv(ch, 'velMax', p.velMax ?? 110);
            pushEv(ch, 'voices', p.voices ?? 5);
            pushEv(ch, 'glide', p.glide ?? 0.0);
            pushEv(ch, 'legato', p.legato ?? 0);
            pushEv(ch, 'stealMode', p.stealMode || p.steal || 'none');

            if (p.sources && p.sources.osc1) pushEv(ch, 'sources.osc1.type', p.sources.osc1.type || 'sawtooth');
            if (p.sources && p.sources.noise) pushEv(ch, 'sources.noise.level', p.sources.noise.level ?? 0);
            if (p.filter) {
                pushEv(ch, 'filter.cutoff', p.filter.cutoff ?? 8000);
                pushEv(ch, 'filter.res', p.filter.res ?? 2);
            }

            ['ampEnv', 'filterEnv', 'pitchEnv'].forEach(envKey => {
                const env = p[envKey];
                if (!env) return;
                ['atk', 'dec', 'sus', 'rel', 'amt', 'timeMode'].forEach(k => {
                    if (env[k] !== undefined) pushEv(ch, `${envKey}.${k}`, env[k]);
                });
            });

            ['ampLfo', 'filterLfo', 'pitchLfo'].forEach(lfoKey => {
                const lfo = p[lfoKey];
                if (!lfo) return;
                ['shape', 'rate', 'depth', 'rateMode'].forEach(k => {
                    if (lfo[k] !== undefined) pushEv(ch, `${lfoKey}.${k}`, lfo[k]);
                });
            });

            if (p.fx) {
                ['drv', 'drvGrit', 'drvTone', 'drvLvl', 'dly', 'rev'].forEach(k => {
                    if (p.fx[k] !== undefined) pushEv(ch, `fx.${k}`, p.fx[k]);
                });
            }

            pushEv(ch, 'patchName', (chObj && chObj.patchName) ? chObj.patchName : (p.savedPatchName || 'INIT'));
        }

        return events;
    }

    function applyPerfEvent(ev, touched) {
        if (!ev || !ev.attr) return;
        const ch = parseInt(ev.channel);
        const attr = String(ev.attr).trim();
        const val = ev.value;

        // Global / Master / GlobalFX events (channel === 0)
        if (!ch || ch === 0) {
            if (attr === 'master.vol') {
                const num = parseFloat(val);
                if (!isNaN(num)) {
                    window.masterVolumeLevel = Math.max(0, Math.min(1, num));
                    if (window.masterGain && !window.isMasterMuted) {
                        window.masterGain.gain.value = window.masterVolumeLevel;
                    }
                    const slider = document.getElementById('master-vol-slider');
                    if (slider) slider.value = window.masterVolumeLevel;
                }
                touched.ui = true;
                return;
            }
            if (attr === 'master.muted') {
                const muted = parseBoolParam(val);
                window.isMasterMuted = muted;
                if (window.masterGain) {
                    window.masterGain.gain.value = muted ? 0 : window.masterVolumeLevel;
                }
                const btn = document.getElementById('btn-master-mute');
                if (btn) {
                    btn.style.backgroundColor = muted ? 'var(--red)' : 'transparent';
                    btn.style.color = muted ? '#000' : 'var(--red)';
                }
                touched.ui = true;
                return;
            }
            if (attr === 'master.bpm') {
                const bpm = parseFloat(val);
                if (!isNaN(bpm)) {
                    window.masterBPM = Math.max(60, Math.min(240, bpm));
                    touched.ui = true;
                }
                return;
            }
            if (attr.startsWith('globalFX.') && window.globalFX) {
                const parts = attr.split('.');
                if (parts.length === 2) {
                    if (parts[1] === 'level') {
                        const num = parseFloat(val);
                        if (!isNaN(num)) {
                            window.globalFX.level = Math.max(0, Math.min(1.25, num));
                            const fxS = document.getElementById('fx-vol-slider');
                            if (fxS) fxS.value = window.globalFX.level;
                            const fxV = document.getElementById('fx-vol-val');
                            if (fxV) fxV.textContent = `${Math.round(window.globalFX.level * 100)}%`;
                            touched.globalFx = true;
                        }
                    } else if (parts[1] === 'muted') {
                        window.globalFX.muted = parseBoolParam(val);
                        if (typeof window.syncMixerControlsUI === 'function') window.syncMixerControlsUI();
                        touched.globalFx = true;
                    }
                    touched.ui = true;
                } else if (parts.length === 3 && window.globalFX[parts[1]]) {
                    const num = parseFloat(val);
                    window.globalFX[parts[1]][parts[2]] = isNaN(num) ? val : num;
                    touched.globalFx = true;
                    touched.ui = true;
                }
                return;
            }
            return;
        }

        // Channel events (1..4)
        const chIdx = ch - 1;
        const chObj = window.synthChannels ? window.synthChannels[chIdx] : null;
        if (!chObj || !chObj.params) return;
        const p = chObj.params;

        if (attr === 'patchName') {
            chObj.patchName = String(val || 'INIT');
            chObj.isDirty = false;
            touched.patchNames = true;
            return;
        }
        if (attr === 'mixVol') {
            const num = parseFloat(val);
            if (!isNaN(num)) {
                p.mixVol = Math.max(0, Math.min(1, num));
                if (chObj.channelOut) {
                    chObj.channelOut.gain.value = p.muted ? 0 : p.mixVol;
                }
                const volSlider = document.getElementById(`ch-vol-${chIdx}`);
                if (volSlider) volSlider.value = p.mixVol;
            }
            return;
        }
        if (attr === 'muted') {
            const muted = parseBoolParam(val);
            p.muted = muted;
            if (chObj.channelOut) {
                chObj.channelOut.gain.value = muted ? 0 : p.mixVol;
            }
            const muteBtn = document.getElementById(`mute-btn-${chIdx}`);
            if (muteBtn) {
                muteBtn.style.backgroundColor = muted ? 'var(--red)' : 'transparent';
                muteBtn.style.color = muted ? '#000' : 'var(--text)';
            }
            return;
        }
        if (attr === 'midiOutCh') {
            const mch = parseInt(val);
            if (!isNaN(mch)) {
                p.midiOutCh = Math.max(0, Math.min(15, mch));
                const sel = document.getElementById(`ui-midi-ch-${chIdx}`);
                if (sel) sel.value = p.midiOutCh;
            }
            return;
        }
        if (attr === 'threshold') {
            const num = parseFloat(val);
            if (!isNaN(num)) {
                p.threshold = Math.max(1.0, Math.min(10.0, num));
                const miniT = document.getElementById(`ch-mini-thresh-${chIdx}`);
                const miniV = document.getElementById(`ch-val-thresh-${chIdx}`);
                if (miniT) {
                    if (p.threshold > parseFloat(miniT.max || 5)) {
                        p.threshMax = Math.max(p.threshMax || 5, p.threshold);
                        miniT.max = p.threshMax.toString();
                    }
                    miniT.value = p.threshold;
                }
                if (miniV) miniV.innerText = p.threshold.toFixed(2) + 'x';
            }
            return;
        }
        if (attr === 'threshMax') {
            const num = parseFloat(val);
            if (!isNaN(num)) {
                p.threshMax = Math.max(1.0, Math.min(10.0, num));
                const miniT = document.getElementById(`ch-mini-thresh-${chIdx}`);
                const maxBtn = document.getElementById(`ch-max-btn-${chIdx}`);
                if (miniT) miniT.max = p.threshMax.toString();
                if (maxBtn) maxBtn.innerText = `${p.threshMax.toFixed(2)}x`;
            }
            return;
        }
        if (attr === 'sampleSize') {
            const num = parseInt(val);
            if (!isNaN(num)) {
                p.sampleSize = num;
                const miniW = document.getElementById(`ch-window-${chIdx}`);
                const miniWV = document.getElementById(`ch-val-window-${chIdx}`);
                if (miniW) miniW.value = num;
                if (miniWV) miniWV.innerText = num;
            }
            return;
        }
        if (attr === 'activeScaleBits') {
            const decoded = (typeof window.decodeScaleBits === 'function') ? window.decodeScaleBits(val) : null;
            if (decoded) {
                p.activeScaleBits = decoded;
            } else {
                const s = String(val || '').trim();
                if (/^[01]{12}$/.test(s)) {
                    p.activeScaleBits = s.split('').map(c => c === '1');
                } else if (s.includes(',')) {
                    const parts = s.split(',');
                    p.activeScaleBits = Array.from({ length: 12 }, (_, idx) => parseBoolParam(parts[idx]));
                }
            }
            if (touched.scaleBitsChannels) touched.scaleBitsChannels.add(chIdx);
            if (touched.lastScaleSourceByCh) touched.lastScaleSourceByCh[chIdx] = 'bits';
            touched.channels.add(chIdx);
            if (chIdx === window.activeSynthIndex) touched.piano = true;
            touched.ui = true;
            return;
        }
        if (attr === 'scaleRoot') {
            p.scaleRoot = ((parseInt(val, 10) || 0) % 12 + 12) % 12;
            if (touched.scaleMetaChannels) touched.scaleMetaChannels.add(chIdx);
            if (touched.lastScaleSourceByCh) touched.lastScaleSourceByCh[chIdx] = 'meta';
            touched.channels.add(chIdx);
            return;
        }
        if (attr === 'scaleType') {
            p.scaleType = String(val || 'chromatic');
            if (touched.scaleMetaChannels) touched.scaleMetaChannels.add(chIdx);
            if (touched.lastScaleSourceByCh) touched.lastScaleSourceByCh[chIdx] = 'meta';
            touched.channels.add(chIdx);
            return;
        }
        if (attr === 'stealMode' || attr === 'steal') {
            const mode = String(val || 'none');
            p.stealMode = mode;
            p.steal = mode;
            touched.channels.add(chIdx);
            return;
        }

        if (attr.includes('.')) {
            const parts = attr.split('.');
            let obj = p;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!obj[parts[i]]) obj[parts[i]] = {};
                obj = obj[parts[i]];
            }
            const leaf = parts[parts.length - 1];
            const isStringLeaf = (leaf === 'type' || leaf === 'shape' || leaf === 'rateMode' || leaf === 'timeMode');
            if (isStringLeaf) {
                obj[leaf] = String(val);
            } else {
                const num = parseFloat(val);
                obj[leaf] = isNaN(num) ? val : num;
            }
            touched.channels.add(chIdx);
            return;
        }

        const num = parseFloat(val);
        p[attr] = isNaN(num) ? val : num;
        touched.channels.add(chIdx);
    }

    function commitPerfBatch(touched) {
        if (!touched) return;
        window.isApplyingAutomation = true;
        try {
            const scaleTouchChannels = new Set([
                ...(touched.scaleBitsChannels ? touched.scaleBitsChannels : []),
                ...(touched.scaleMetaChannels ? touched.scaleMetaChannels : [])
            ]);
            scaleTouchChannels.forEach(chIdx => {
                const chObj = window.synthChannels ? window.synthChannels[chIdx] : null;
                if (!chObj || !chObj.params) return;
                const p = chObj.params;
                const lastSource = touched.lastScaleSourceByCh ? touched.lastScaleSourceByCh[chIdx] : null;
                if (lastSource === 'bits' && typeof window.detectScaleFromBits === 'function') {
                    const detected = window.detectScaleFromBits(p.activeScaleBits, p.scaleRoot);
                    p.scaleType = detected.scaleType;
                    p.scaleRoot = detected.scaleRoot;
                } else if (lastSource === 'meta' && p.scaleType !== 'custom' && typeof window.buildScaleBitsFromPreset === 'function') {
                    p.activeScaleBits = window.buildScaleBitsFromPreset(p.scaleType, p.scaleRoot);
                    if (chIdx === window.activeSynthIndex) touched.piano = true;
                } else if (typeof window.normalizeScaleParams === 'function') {
                    window.normalizeScaleParams(p);
                }
            });
            if (touched.channels && window.synthChannels) {
                touched.channels.forEach(chIdx => {
                    if (window.synthChannels[chIdx] && typeof window.synthChannels[chIdx].applyParams === 'function') {
                        window.synthChannels[chIdx].applyParams();
                    }
                });
            }
            if (touched.globalFx && window.masterFX && window.globalFX) {
                window.masterFX.updateParams(window.globalFX);
            }
            if (touched.patchNames && typeof window.updateChannelPresetDropdowns === 'function') {
                window.updateChannelPresetDropdowns();
            }
            if ((touched.ui || (touched.channels && touched.channels.size > 0) || touched.globalFx) && typeof window.syncUI === 'function') {
                window.syncUI();
            }
            if ((touched.piano || (touched.channels && touched.channels.has(window.activeSynthIndex))) && typeof window.syncPianoUI === 'function') {
                window.syncPianoUI();
            }
        } finally {
            window.isApplyingAutomation = false;
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

            // Performance Automation playback state
            this.automationEvents = [];
            this.automationCursor = 0;
            this.followAutomation = false;
            this.basePresetSnapshot = null;
            
            this.timerId = null;
            this.lastFrameTime = 0;
            this.lastUiEmitTime = 0;

            // Channel streams data buffers
            // Each channel has: { data: [ { value, rawTime, tMs, id, note, velocity, ticks } ], index: 0, label, sourceFile, metricMeta }
            const defaultBioMeta = { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' };
            this.channelFeeds = [
                { data: [], index: 0, label: 'Unassigned', sourceFile: '', metricMeta: Object.assign({}, defaultBioMeta) },
                { data: [], index: 0, label: 'Unassigned', sourceFile: '', metricMeta: Object.assign({}, defaultBioMeta) },
                { data: [], index: 0, label: 'Unassigned', sourceFile: '', metricMeta: Object.assign({}, defaultBioMeta) },
                { data: [], index: 0, label: 'Unassigned', sourceFile: '', metricMeta: Object.assign({}, defaultBioMeta) }
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

        isChannelPlayingStream(chIdx) {
            return Boolean(
                this.isPlaying &&
                chIdx >= 0 &&
                chIdx < 4 &&
                this.channelFeeds[chIdx] &&
                Array.isArray(this.channelFeeds[chIdx].data) &&
                this.channelFeeds[chIdx].data.length > 0
            );
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
                hasAutomation: this.automationEvents.length > 0,
                automationCount: this.automationEvents.length,
                followAutomation: this.followAutomation,
                progress: this.totalDurationMs > 0 ? (this.playbackElapsedMs / this.totalDurationMs) : (this.totalRecords > 0 ? (this.currentIndex / this.totalRecords) : 0),
                activeChannels: this.channelFeeds.map(f => ({
                    active: f.data.length > 0,
                    count: f.data.length,
                    index: f.index,
                    label: f.label,
                    sourceFile: f.sourceFile,
                    metricMeta: f.metricMeta || { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' },
                    isBiodata: !f.metricMeta || f.metricMeta.isBiodata !== false,
                    unit: f.metricMeta ? (f.metricMeta.unit ?? '\u00B5S') : '\u00B5S',
                    currentVal: f.data[f.index] ? f.data[f.index].value : null
                })),
                loadedFile: this.loadedFile ? {
                    name: this.loadedFile.name,
                    rowCount: this.loadedFile.rows.length,
                    automationCount: (this.loadedFile.automationRows || []).length,
                    columns: this.loadedFile.columns,
                    guesses: this.loadedFile.guesses,
                    recommendedWindow: this.loadedFile.recommendedWindow,
                    recommendedZoom: this.loadedFile.recommendedZoom
                } : null
            };
        }

        // --- UNIVERSAL FILE PARSER & AUTO-GUESSING PORTAL ---
        parseFileContent(rawText, fileName = 'stream_data.csv') {
            const trimmed = String(rawText || '').replace(/^\uFEFF/, '').trim();
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
                const lines = trimmed.split(/\r?\n/).filter(line => {
                    const t = line.trim();
                    return t.length > 0 && !t.startsWith('#') && !t.startsWith('//');
                });
                if (lines.length === 0) throw new Error('No valid data lines found in file');

                const firstLine = lines[0];
                let delimiter = ',';
                if (firstLine.includes('\t')) delimiter = '\t';
                else if (firstLine.includes(';') && (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length) delimiter = ';';
                else if (firstLine.includes('|')) delimiter = '|';
                else if (!firstLine.includes(',') && firstLine.split(/\s+/).length > 1) delimiter = /\s+/;

                let headerTokens = splitDelimitedRow(firstLine, delimiter);
                
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
                    
                    const tokens = splitDelimitedRow(line, delimiter);
                    let rowObj = {};
                    columns.forEach((col, cIdx) => {
                        let raw = tokens[cIdx];
                        if (raw !== undefined) {
                            let num = parseFloat(raw);
                            // Keep param_value & activeScaleBits strings intact so bitmasks like '101011010101' aren't coerced to numbers
                            if (col === 'param_value' || col === 'param_attr' || col === 'sensor_id') {
                                rowObj[col] = raw;
                            } else {
                                rowObj[col] = (!isNaN(num) && isFinite(raw)) ? num : raw;
                            }
                        } else {
                            rowObj[col] = null;
                        }
                    });
                    rows.push(rowObj);
                }
            }

            // Separate inline performance automation rows BEFORE column detection and window recommendations
            const telemetryRows = [];
            const automationRows = [];
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                const isPerfRow = String(r.sensor_id || '').trim() === 'PERF_PARAM' ||
                    (r.param_attr !== undefined && r.param_attr !== null && String(r.param_attr).trim() !== '');
                if (isPerfRow) {
                    automationRows.push(r);
                } else {
                    telemetryRows.push(r);
                }
            }
            rows = telemetryRows;

            if (rows.length === 0 && automationRows.length === 0) throw new Error('Could not parse records from this file');

            const guesses = rows.length > 0
                ? this.detectColumnRoles(columns, rows)
                : { timestampCol: columns.find(c => /time|date|iso/i.test(c)) || null, identifierCol: null, primaryValueCol: columns[0], detectedValueCols: [], sensorList: [], colStats: {} };

            const N = rows.length;
            let recommendedWindow = 40;
            let recommendedZoom = 500;

            if (N < 250) {
                recommendedWindow = Math.max(10, Math.round(N / 8));
                recommendedZoom = Math.min(250, Math.max(10, N));
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
                automationRows,
                hasAutomation: automationRows.length > 0,
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

            if (this.isPlaying) {
                this.pause();
            }

            this.automationEvents = [];
            this.automationCursor = 0;
            this.followAutomation = false;
            this.basePresetSnapshot = null;

            const { rows, recommendedWindow, recommendedZoom, name } = this.loadedFile;
            const autoRows = this.loadedFile.automationRows || [];
            const mode = config.mode || 'multi_sensor_id';
            const cadenceRps = Math.max(1, Math.min(500, Number(config.cadenceRps || this.targetCadenceRps) || 30));
            this.targetCadenceRps = cadenceRps;
            const timeCol = config.timestampCol !== undefined ? config.timestampCol : this.loadedFile.guesses.timestampCol;

            const Core = window.BioQuadCore;
            const fileCols = this.loadedFile.columns || [];
            const resolveColMeta = (colName) => {
                if (Core && typeof Core.inferColumnMetricMeta === 'function') {
                    return Core.inferColumnMetricMeta(colName, fileCols);
                }
                const isBio = /conductance|admittance|_us$|_µs$|biometric_us/i.test(String(colName || ''));
                return isBio
                    ? { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' }
                    : { isBiodata: false, unit: '', heading: String(colName || 'RAW DATA').toUpperCase().slice(0, 16) };
            };

            // In multi-channel modes, clear all 4 slots first so switching from a 4-ch dataset
            // (e.g. NASA/Forest) to a 2-ch or 3-ch dataset (e.g. EKG/Crypto) never leaves stale
            // channels playing or corrupts timestamp alignment.
            if (mode === 'multi_sensor_id' || mode === 'multi_value_cols') {
                for (let ch = 0; ch < 4; ch++) {
                    this.channelFeeds[ch] = {
                        data: [],
                        index: 0,
                        label: 'Unassigned',
                        sourceFile: '',
                        metricMeta: { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' }
                    };
                }
            }

            if (mode === 'single_channel') {
                const targetCh = Math.max(0, Math.min(3, config.targetChannel !== undefined ? config.targetChannel : 0));
                const valCol = config.valueCol || this.loadedFile.guesses.primaryValueCol;
                const metricMeta = resolveColMeta(valCol);
                
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
                    hasRecordedNotes: hasNotes,
                    metricMeta
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
                const baseMetricMeta = resolveColMeta(valCol);

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
                        const chHeading = (!baseMetricMeta.isBiodata && matchedSensor)
                            ? String(matchedSensor).replace(/[_\s-]+/g, ' ').trim().toUpperCase().slice(0, 16)
                            : baseMetricMeta.heading;
                        this.channelFeeds[ch] = {
                            data: partitioned[ch],
                            index: 0,
                            label: `${matchedSensor} (${valCol})`,
                            sourceFile: name,
                            hasRecordedNotes: hasNotes,
                            metricMeta: Object.assign({}, baseMetricMeta, { heading: chHeading || baseMetricMeta.heading })
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
                        const metricMeta = resolveColMeta(targetCol);
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
                            hasRecordedNotes: hasNotes,
                            metricMeta
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
            let maxStartMs = -Infinity;
            let validTimeCount = 0;
            const chMinTimeMs = [Infinity, Infinity, Infinity, Infinity];

            for (let ch = 0; ch < 4; ch++) {
                const feed = this.channelFeeds[ch];
                if (!feed || feed.data.length === 0) continue;
                for (let i = 0; i < feed.data.length; i++) {
                    const pt = feed.data[i];
                    if (pt.rawTime !== null && pt.rawTime !== undefined) {
                        const ms = parseRawTimeToMs(pt.rawTime);
                        if (ms !== null && isFinite(ms)) {
                            pt.parsedMs = ms;
                            if (ms < chMinTimeMs[ch]) chMinTimeMs[ch] = ms;
                            if (ms < minTimeMs) minTimeMs = ms;
                            validTimeCount++;
                        }
                    }
                }
                if (chMinTimeMs[ch] !== Infinity && chMinTimeMs[ch] > maxStartMs) {
                    maxStartMs = chMinTimeMs[ch];
                }
            }

            // Include automation rows when establishing unified t=0 origin
            const parsedAutoRows = [];
            for (let i = 0; i < autoRows.length; i++) {
                const ar = autoRows[i];
                const rawT = (timeCol && ar[timeCol] !== undefined) ? ar[timeCol] : (ar.timestamp_iso ?? ar.timestamp ?? null);
                const ms = parseRawTimeToMs(rawT);
                if (ms !== null && isFinite(ms)) {
                    if (ms < minTimeMs) minTimeMs = ms;
                    validTimeCount++;
                }
                const chParsed = parseInt(ar.channel);
                parsedAutoRows.push({
                    parsedMs: (ms !== null && isFinite(ms)) ? ms : null,
                    channel: isNaN(chParsed) ? 0 : chParsed,
                    attr: String(ar.param_attr || '').trim(),
                    value: ar.param_value !== undefined && ar.param_value !== null ? ar.param_value : ''
                });
            }

            // If channels loaded individually come from disjoint epochs (> 1 hour apart, e.g. 2024 sample + 2026 recording),
            // normalize each channel against its own t=0 so totalDurationMs doesn't explode to multi-year spans.
            const usePerChannelOrigin = (minTimeMs !== Infinity && maxStartMs !== -Infinity && (maxStartMs - minTimeMs) > 3600000);
            const hasRealTimestamps = validTimeCount >= 2 && minTimeMs !== Infinity;
            this.hasRealTimestamps = hasRealTimestamps;

            let maxDurationMs = 0;

            for (let ch = 0; ch < 4; ch++) {
                const feed = this.channelFeeds[ch];
                if (!feed || feed.data.length === 0) continue;
                const originMs = (usePerChannelOrigin && chMinTimeMs[ch] !== Infinity) ? chMinTimeMs[ch] : minTimeMs;

                let lastTMs = 0;
                for (let i = 0; i < feed.data.length; i++) {
                    const pt = feed.data[i];
                    if (hasRealTimestamps && pt.parsedMs !== undefined) {
                        let tOffset = Math.max(0, pt.parsedMs - originMs);
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

            // Build sorted automation timeline aligned to minTimeMs
            if (parsedAutoRows.length > 0) {
                for (let i = 0; i < parsedAutoRows.length; i++) {
                    const pa = parsedAutoRows[i];
                    if (!pa.attr) continue;
                    const tOffset = (hasRealTimestamps && pa.parsedMs !== null) ? Math.max(0, pa.parsedMs - minTimeMs) : 0;
                    if (tOffset > maxDurationMs) maxDurationMs = tOffset;
                    this.automationEvents.push({
                        tMs: tOffset,
                        channel: pa.channel,
                        attr: pa.attr,
                        value: pa.value
                    });
                }
                this.automationEvents.sort((a, b) => a.tMs - b.tMs);
                this.followAutomation = this.automationEvents.length > 0;
            }

            // Sync total length
            const lengths = this.channelFeeds.map(f => f.data.length).filter(len => len > 0);
            this.totalRecords = lengths.length > 0 ? Math.max(...lengths) : 0;
            this.totalDurationMs = (maxDurationMs > 0 && isFinite(maxDurationMs))
                ? maxDurationMs
                : ((this.totalRecords / cadenceRps) * 1000);
            this.playbackElapsedMs = 0;
            this.currentIndex = 0;

            // Pre-warm visualizers with clean bounds & metric metadata
            for (let ch = 0; ch < 4; ch++) {
                const feed = this.channelFeeds[ch];
                const chVisual = window.chData ? window.chData[ch] : null;
                if (feed && feed.data.length > 0 && chVisual) {
                    const isBio = !feed.metricMeta || feed.metricMeta.isBiodata !== false;
                    chVisual.metricMeta = feed.metricMeta || { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' };
                    let dMin = Infinity, dMax = -Infinity;
                    for (let k = 0; k < feed.data.length; k++) {
                        let val = feed.data[k].value;
                        if (isBio) {
                            val = Math.abs(val);
                            if (val < 0.1) val = 0.1;
                            if (val > 10000) val = 10000000 / val;
                        }
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
                    chVisual.acc = { sum: 0, count: 0, min: Infinity, max: -Infinity, lastSec: Date.now() };

                    const preWarmCount = Math.min(25, feed.data.length);
                    for (let p = 0; p < preWarmCount; p++) {
                        let rVal = feed.data[p].value;
                        let ticks = 0;
                        if (isBio) {
                            rVal = Math.abs(rVal);
                            if (rVal < 0.1) rVal = 0.1;
                            if (rVal > 10000) rVal = 10000000 / rVal;
                            ticks = feed.data[p].ticks || Math.round(10000000 / rVal);
                        } else {
                            ticks = Number(feed.data[p].ticks) || 0;
                        }
                        chVisual.waveBuffer.push({ r: rVal, ticks: ticks, evt: 0 });
                        chVisual.vizBuffer.push(rVal);
                    }
                } else if (chVisual && (mode === 'multi_sensor_id' || mode === 'multi_value_cols')) {
                    chVisual.metricMeta = { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' };
                    chVisual.waveBuffer = [];
                    chVisual.vizBuffer = [];
                    chVisual.history = [];
                    chVisual.lastMaxDev = 0;
                    chVisual.lastStdevi = 1.0;
                    chVisual.rawStdev = 0;
                }
            }

            if (this.automationEvents.length > 0 && window.biodataRecorder) {
                this.basePresetSnapshot = window.biodataRecorder.captureCurrentPreset();
                if (this.followAutomation) {
                    this.reconcileAutomationToTime(0);
                }
            }

            if (typeof window.syncUI === 'function') window.syncUI();
            this.emitChange('mapping_applied');
        }

        // --- TRANSPORT CONTROLS ---
        play() {
            if (this.totalRecords === 0) return;

            if (this.totalDurationMs > 0 && this.playbackElapsedMs >= this.totalDurationMs) {
                this.rewind();
            }

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
            if (this.followAutomation && this.automationEvents.length > 0) {
                this.reconcileAutomationToTime(0);
            } else {
                this.automationCursor = 0;
            }
            for (let i = 0; i < 4; i++) {
                if (this.channelFeeds[i]) {
                    this.channelFeeds[i].index = 0;
                    this.channelFeeds[i].lastNoteTime = 0;
                    this.channelFeeds[i].lastCandidateTime = 0;
                    if (this.channelFeeds[i].data.length > 0) {
                        this.processChannelRecord(i, this.channelFeeds[i].data[0], { silent: true });
                    }
                }
            }
            this.emitChange('rewind');
        }

        seek(targetIndex) {
            if (this.totalRecords <= 0) {
                this.currentIndex = 0;
                this.playbackElapsedMs = 0;
                this.emitChange('seek');
                return;
            }
            const safeIdx = Number.isFinite(Number(targetIndex)) ? Math.round(Number(targetIndex)) : 0;
            targetIndex = Math.max(0, Math.min(this.totalRecords - 1, safeIdx));
            this.currentIndex = targetIndex;
            
            const ratio = this.totalRecords > 1 ? targetIndex / (this.totalRecords - 1) : 0;
            this.playbackElapsedMs = ratio * (this.totalDurationMs || 0);

            if (this.automationEvents.length > 0) {
                if (this.followAutomation) {
                    this.reconcileAutomationToTime(this.playbackElapsedMs);
                } else {
                    let c = 0;
                    while (c < this.automationEvents.length && this.automationEvents[c].tMs <= this.playbackElapsedMs) c++;
                    this.automationCursor = c;
                }
            }

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
                    this.processChannelRecord(ch, feed.data[targetIdx], { silent: true });
                }
            }
            this.emitChange('seek');
        }

        reconcileAutomationToTime(targetMs) {
            if (!this.automationEvents || this.automationEvents.length === 0) return;

            window.isApplyingAutomation = true;
            try {
                if (this.basePresetSnapshot) {
                    this.restorePresetSnapshot(this.basePresetSnapshot, true);
                }

                const latestByKey = new Map();
                let cursor = 0;
                for (let i = 0; i < this.automationEvents.length; i++) {
                    const ev = this.automationEvents[i];
                    if (ev.tMs <= targetMs) {
                        latestByKey.set(`${ev.channel}:${ev.attr}`, { idx: i, ev });
                        cursor = i + 1;
                    } else {
                        break;
                    }
                }

                const ordered = Array.from(latestByKey.values()).sort((a, b) => a.idx - b.idx);
                const touched = { channels: new Set(), scaleBitsChannels: new Set(), scaleMetaChannels: new Set(), lastScaleSourceByCh: {}, globalFx: false, ui: false, piano: false, patchNames: false };
                for (let i = 0; i < ordered.length; i++) {
                    applyPerfEvent(ordered[i].ev, touched);
                }
                commitPerfBatch(touched);
                this.automationCursor = cursor;
            } finally {
                window.isApplyingAutomation = false;
            }
        }

        toggleFollowAutomation() {
            if (this.automationEvents.length === 0) return;
            this.followAutomation = !this.followAutomation;
            if (this.followAutomation) {
                this.reconcileAutomationToTime(this.playbackElapsedMs);
            }
            this.emitChange('automation_mode_change');
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
                this.channelFeeds[ch].metricMeta = { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' };
                if (window.chData && window.chData[ch]) {
                    window.chData[ch].metricMeta = { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' };
                    window.chData[ch].waveBuffer = [];
                    window.chData[ch].vizBuffer = [];
                    window.chData[ch].history = [];
                }
                
                const lengths = this.channelFeeds.map(f => f.data.length).filter(len => len > 0);
                this.totalRecords = lengths.length > 0 ? Math.max(...lengths) : 0;
                if (this.totalRecords === 0) {
                    this.stop();
                    this.totalDurationMs = 0;
                } else {
                    let maxDur = 0;
                    for (let i = 0; i < 4; i++) {
                        const f = this.channelFeeds[i];
                        if (f && f.data.length > 0) {
                            const lastT = f.data[f.data.length - 1].tMs || 0;
                            if (lastT > maxDur) maxDur = lastT;
                        }
                    }
                    this.totalDurationMs = maxDur > 0 ? maxDur : ((this.totalRecords / (this.targetCadenceRps || 30)) * 1000);
                }
                this.emitChange('channel_cleared');
            }
        }

        clearAll() {
            this.stop();
            for (let i = 0; i < 4; i++) {
                this.channelFeeds[i] = {
                    data: [],
                    index: 0,
                    label: 'Unassigned',
                    sourceFile: '',
                    metricMeta: { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' }
                };
                if (window.chData && window.chData[i]) {
                    window.chData[i].metricMeta = { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' };
                    window.chData[i].waveBuffer = [];
                    window.chData[i].vizBuffer = [];
                    window.chData[i].history = [];
                }
            }
            this.totalRecords = 0;
            this.currentIndex = 0;
            this.playbackElapsedMs = 0;
            this.totalDurationMs = 0;
            this.loadedFile = null;
            this.automationEvents = [];
            this.automationCursor = 0;
            this.followAutomation = false;
            this.basePresetSnapshot = null;
            this.emitChange('cleared_all');
        }

        // --- REAL-TIME DELTA TIMESTAMP STREAM LOOP ---
        runStreamLoop() {
            if (!this.isPlaying) return;
            if (this.totalRecords <= 0 || !isFinite(this.totalDurationMs) || this.totalDurationMs <= 0) {
                this.pause();
                return;
            }

            const now = performance.now();
            let deltaMs = now - this.lastFrameTime;
            this.lastFrameTime = now;
            if (!isFinite(deltaMs) || deltaMs < 0) deltaMs = 0;
            if (deltaMs > 250) deltaMs = 250;

            this.playbackElapsedMs += deltaMs * this.playbackRate;

            if (this.playbackElapsedMs >= this.totalDurationMs) {
                if (this.isLooping) {
                    try {
                        this.rewind();
                    } catch (err) {
                        console.warn('[DataStreamer] Rewind error:', err);
                    }
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

            try {
                if (this.followAutomation && this.automationEvents.length > 0) {
                    const touched = { channels: new Set(), scaleBitsChannels: new Set(), scaleMetaChannels: new Set(), lastScaleSourceByCh: {}, globalFx: false, ui: false, piano: false, patchNames: false };
                    let appliedAny = false;
                    while (this.automationCursor < this.automationEvents.length &&
                           this.automationEvents[this.automationCursor].tMs <= this.playbackElapsedMs) {
                        applyPerfEvent(this.automationEvents[this.automationCursor], touched);
                        this.automationCursor++;
                        appliedAny = true;
                    }
                    if (appliedAny) {
                        commitPerfBatch(touched);
                    }
                }

                for (let chIdx = 0; chIdx < 4; chIdx++) {
                    const feed = this.channelFeeds[chIdx];
                    if (!feed || feed.data.length === 0) continue;

                    let stepsThisFrame = 0;
                    while (feed.index < feed.data.length - 1 && feed.data[feed.index + 1].tMs <= this.playbackElapsedMs && stepsThisFrame < 100) {
                        feed.index++;
                        stepsThisFrame++;
                        try {
                            this.processChannelRecord(chIdx, feed.data[feed.index]);
                        } catch (recErr) {
                            if (!this._lastLoopErrTime || now - this._lastLoopErrTime > 2000) {
                                this._lastLoopErrTime = now;
                                console.warn('[DataStreamer] Record playback error on CH', chIdx + 1, recErr);
                            }
                        }
                    }

                    if (window.bioquadFeeds && window.bioquadFeeds.isPublishing && this.mqttRawBatch && this.mqttRawBatch[chIdx] && this.mqttRawBatch[chIdx].length > 0) {
                        const nowMs = Date.now();
                        if (nowMs - (this.mqttRawLastFlush ? this.mqttRawLastFlush[chIdx] : 0) >= 75) {
                            const batch = this.mqttRawBatch[chIdx].slice();
                            this.mqttRawBatch[chIdx].length = 0;
                            this.mqttRawLastFlush[chIdx] = nowMs;
                            window.bioquadFeeds.broadcastTelemetryEvent({
                                type: 'raw',
                                ch: chIdx,
                                p: batch,
                                ts: nowMs
                            });
                        }
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
            } catch (loopErr) {
                if (!this._lastLoopErrTime || now - this._lastLoopErrTime > 2000) {
                    this._lastLoopErrTime = now;
                    console.warn('[DataStreamer] Stream loop recovered from error:', loopErr);
                }
            }

            if (this.isPlaying) {
                this.timerId = requestAnimationFrame(() => this.runStreamLoop());
            }
        }

        processChannelRecord(chIdx, record, opts = {}) {
            const CALIBRATION_FACTOR = 10000000;
            const nowMs = Date.now();
            const silent = Boolean(opts && opts.silent);

            if (!record || record.value === undefined || record.value === null) return;

            let rawVal = Number(record.value);
            if (!isFinite(rawVal)) return;

            const feed = this.channelFeeds[chIdx];
            const metricMeta = (feed && feed.metricMeta) ? feed.metricMeta : { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' };
            const isBiodata = metricMeta.isBiodata !== false;

            let rVal;
            if (isBiodata) {
                rVal = Math.abs(rawVal);
                if (rVal < 0.1) rVal = 0.1;
                if (rVal > 10000) {
                    rVal = CALIBRATION_FACTOR / rVal;
                }
            } else {
                // Uploaded raw data file: preserve exact signed & large/small datapoint values without 555-timer tick inversion
                rVal = rawVal;
            }

            const synthCh = window.synthChannels ? window.synthChannels[chIdx] : null;
            const p = synthCh ? synthCh.params : window.defaultParams;
            const sampleWindow = Math.max(2, Math.min(2000, Math.round(Number(p.sampleSize) || 40)));

            const chVisual = window.chData ? window.chData[chIdx] : null;
            if (!chVisual) return;

            chVisual.metricMeta = metricMeta;
            if (!chVisual.waveBuffer) chVisual.waveBuffer = [];
            if (!chVisual.vizBuffer) chVisual.vizBuffer = [];
            if (!chVisual.acc || chVisual.acc.lastSec === undefined) {
                chVisual.acc = { sum: 0, count: 0, min: Infinity, max: -Infinity, lastSec: nowMs };
            }

            const ticks = isBiodata
                ? (record.ticks || Math.round(CALIBRATION_FACTOR / rVal))
                : (Number(record.ticks) || 0);

            if (!silent && window.bioquadFeeds && window.bioquadFeeds.isPublishing) {
                if (!this.mqttRawBatch) this.mqttRawBatch = [[], [], [], []];
                if (!this.mqttRawLastFlush) this.mqttRawLastFlush = [0, 0, 0, 0];
                const mqttTicks = ticks > 0 ? ticks : Math.round(CALIBRATION_FACTOR / Math.max(0.1, Math.abs(rVal)));
                this.mqttRawBatch[chIdx].push(mqttTicks);
                if (this.mqttRawBatch[chIdx].length >= 4 || (nowMs - this.mqttRawLastFlush[chIdx]) >= 75) {
                    const batch = this.mqttRawBatch[chIdx].slice();
                    this.mqttRawBatch[chIdx].length = 0;
                    this.mqttRawLastFlush[chIdx] = nowMs;
                    window.bioquadFeeds.broadcastTelemetryEvent({
                        type: 'raw',
                        ch: chIdx,
                        p: batch,
                        ts: nowMs
                    });
                }
            }
            
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
                chVisual.acc = { sum: 0, count: 0, min: Infinity, max: -Infinity, lastSec: nowMs };
            }

            if (chVisual.vizBuffer.length > 1) {
                const vLen = chVisual.vizBuffer.length;
                chVisual.slew = chVisual.vizBuffer[vLen - 1] - chVisual.vizBuffer[vLen - 2];
            }

            // Rolling Mean and Standard Deviation
            const bufferLen = chVisual.vizBuffer.length;
            let sum = 0, maxim = -Infinity, minim = Infinity;
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
            const rawStdev = variance > 0 ? Math.sqrt(variance) : 0;
            const stdevi = isBiodata
                ? (rawStdev >= 0.1 ? rawStdev : 1.0)
                : (rawStdev > 1e-6 ? rawStdev : 1.0);

            // Keep chVisual.lastMaxDev & lastStdevi intact for the zero-parallax Threshold VU meter
            chVisual.rawStdev = rawStdev;
            chVisual.lastStdevi = stdevi;
            chVisual.lastMaxDev = maxDev;
            chVisual.lastBlockTime = nowMs;

            if (silent) return;

            const isMidiOnly = Boolean(feed && feed.isMidiOnly);
            const hasNote = record.note !== null && record.note !== undefined && record.note !== '' && !isNaN(parseInt(record.note));

            // 1. Pure MIDI-only recordings (zero raw conductance sensors): replay stored MIDI event
            if (isMidiOnly && hasNote) {
                const n = parseInt(record.note, 10);
                const v = (record.velocity !== null && record.velocity !== undefined && record.velocity !== '') ? parseInt(record.velocity, 10) : 80;
                const d = (record.duration !== null && record.duration !== undefined && record.duration !== '') ? parseInt(record.duration, 10) : 260;

                if (typeof window.processBiodata === 'function') {
                    window.processBiodata({ type: 'note', ch: chIdx, n, v, d }, 'stream');
                } else if (synthCh && typeof synthCh.play === 'function') {
                    synthCh.play(n, v, d);
                }

                if (chVisual.waveBuffer.length > 0) {
                    chVisual.waveBuffer[chVisual.waveBuffer.length - 1].evt = 1;
                    chVisual.waveBuffer[chVisual.waveBuffer.length - 1].n = n;
                }
                return;
            }

            // 2. Real-time sonification from rolling window deviation (matches ESP32 biodata_quad.ino):
            //    Tests CURRENT sample deviation against rolling window (abs(rVal - mean) > threshold * std_dev,
            //    std_dev > abs(mean) * 0.005) with a 150ms refractory period so spikes never machine-gun re-trigger.
            const threshold = p.threshold || 2.0;
            const minStdDev = isBiodata
                ? Math.max(0.015, mean * 0.005)
                : Math.max(1e-5, Math.abs(mean) * 0.005);
            const sampleDev = Math.abs(rVal - mean);
            const isOverThreshold = (rawStdev > minStdDev) && (sampleDev > (threshold * rawStdev));

            if (isOverThreshold && bufferLen >= Math.min(10, sampleWindow)) {
                const refractoryMs = Math.max(45, Math.round(150 / Math.max(1, this.playbackRate || 1)));
                const pastRefractory = !feed || !feed.lastCandidateTime || (nowMs - feed.lastCandidateTime >= refractoryMs);
                if (!pastRefractory) return;

                if (feed) feed.lastCandidateTime = nowMs;

                const minN = p.minNote ?? 36;
                const maxN = p.maxNote ?? 84;
                const span = Math.max(isBiodata ? 0.5 : 1e-5, maxim - minim);
                let normPitch = Math.max(0, Math.min(1, (rVal - minim) / span));

                if (typeof window.applySpreadCurve === 'function') {
                    normPitch = window.applySpreadCurve(normPitch, p.spread ?? 75);
                }

                const rawNote = Math.round(minN + normPitch * (maxN - minN));
                let scaledNote = rawNote;
                if (typeof window.scaleNote === 'function') {
                    scaledNote = window.scaleNote(rawNote, p.scaleType, p.scaleRoot, p.activeScaleBits, minN, maxN);
                }
                scaledNote = Math.max(0, Math.min(127, Math.round(isFinite(scaledNote) ? scaledNote : 60)));

                const velMin = p.velMin ?? 60;
                const velMax = p.velMax ?? 110;
                const normalized = (threshold * rawStdev) > 0 ? (sampleDev / (threshold * rawStdev)) : 1.0;
                const normPct = Math.max(1.0, Math.min(2.0, normalized)) - 1.0;
                const vel = Math.max(1, Math.min(127, Math.round(velMin + normPct * (velMax - velMin))));
                const durMult = p.durMult || 1.0;
                const dur = Math.round((160 + Math.random() * 300) * durMult);

                const density = p.density !== undefined ? p.density : 100;
                const passesDensity = (Math.random() * 100) <= density;

                if (passesDensity) {
                    if (feed) feed.lastNoteTime = nowMs;

                    if (typeof window.processBiodata === 'function') {
                        window.processBiodata({
                            type: 'note',
                            ch: chIdx,
                            n: scaledNote,
                            v: vel,
                            d: dur
                        }, 'stream');
                    } else if (synthCh && typeof synthCh.play === 'function') {
                        synthCh.play(scaledNote, vel, dur);
                    }

                    if (chVisual.waveBuffer.length > 0) {
                        chVisual.waveBuffer[chVisual.waveBuffer.length - 1].evt = 1;
                        chVisual.waveBuffer[chVisual.waveBuffer.length - 1].n = scaledNote;
                    }
                } else if (typeof window.triggerDensityVisualizer === 'function') {
                    window.triggerDensityVisualizer(chIdx, 'drop', scaledNote, vel, dur);
                }
            }
        }

        restorePresetSnapshot(preset, skipSyncUI = false) {
            if (!preset || !Array.isArray(preset.channels)) return;
            window.isApplyingAutomation = true;
            try {
                const chDataPreset = preset.channels;
                for (let i = 0; i < 4; i++) {
                    if (chDataPreset[i] && window.synthChannels && window.synthChannels[i]) {
                        const base = window.defaultParams ? JSON.parse(JSON.stringify(window.defaultParams)) : {};
                        const cloned = JSON.parse(JSON.stringify(chDataPreset[i]));
                        window.synthChannels[i].params = Object.assign(base, cloned);
                        if (cloned.activeScaleBits === undefined) {
                            delete window.synthChannels[i].params.activeScaleBits;
                        }
                        if (typeof window.normalizeScaleParams === 'function') {
                            window.normalizeScaleParams(window.synthChannels[i].params);
                        }
                        window.synthChannels[i].patchName = window.synthChannels[i].params.savedPatchName || window.synthChannels[i].patchName || 'INIT';
                        window.synthChannels[i].isDirty = false;
                        window.synthChannels[i].applyParams();

                        if (window.synthChannels[i].channelOut) {
                            window.synthChannels[i].channelOut.gain.value = window.synthChannels[i].params.muted ? 0 : window.synthChannels[i].params.mixVol;
                        }
                        const volSlider = document.getElementById(`ch-vol-${i}`);
                        if (volSlider) volSlider.value = window.synthChannels[i].params.mixVol;
                        const muteBtn = document.getElementById(`mute-btn-${i}`);
                        if (muteBtn) {
                            muteBtn.style.backgroundColor = window.synthChannels[i].params.muted ? 'var(--red)' : 'transparent';
                            muteBtn.style.color = window.synthChannels[i].params.muted ? '#000' : 'var(--text)';
                        }
                        const midiSel = document.getElementById(`ui-midi-ch-${i}`);
                        if (midiSel && window.synthChannels[i].params.midiOutCh !== undefined) {
                            midiSel.value = window.synthChannels[i].params.midiOutCh;
                        }

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

                    if (preset.viz && preset.viz[i] && window.chData && window.chData[i]) {
                        window.chData[i].config = JSON.parse(JSON.stringify(preset.viz[i]));
                    }
                }

                if (preset.master) {
                    if (preset.master.vol !== undefined) window.masterVolumeLevel = preset.master.vol;
                    if (preset.master.muted !== undefined) window.isMasterMuted = !!preset.master.muted;
                    if (window.masterGain) {
                        window.masterGain.gain.value = window.isMasterMuted ? 0 : window.masterVolumeLevel;
                    }
                    const mSlider = document.getElementById('master-vol-slider');
                    if (mSlider) mSlider.value = window.masterVolumeLevel;
                    const mBtn = document.getElementById('btn-master-mute');
                    if (mBtn) {
                        mBtn.style.backgroundColor = window.isMasterMuted ? 'var(--red)' : 'transparent';
                        mBtn.style.color = window.isMasterMuted ? '#000' : 'var(--red)';
                    }
                    if (preset.master.bpm !== undefined) window.masterBPM = preset.master.bpm;
                }

                if (preset.globalFX && window.globalFX) {
                    const nextFx = JSON.parse(JSON.stringify(preset.globalFX));
                    if (nextFx.level === undefined) nextFx.level = 0.85;
                    if (nextFx.muted === undefined) nextFx.muted = false;
                    window.globalFX = nextFx;
                    if (window.masterFX) window.masterFX.updateParams(window.globalFX);
                    if (typeof window.syncMixerControlsUI === 'function') window.syncMixerControlsUI();
                }

                if (!skipSyncUI) {
                    if (typeof window.updateChannelPresetDropdowns === 'function') window.updateChannelPresetDropdowns();
                    if (typeof window.syncUI === 'function') window.syncUI();
                }
            } catch (presetErr) {
                console.warn('Could not restore take preset snapshot:', presetErr);
            } finally {
                window.isApplyingAutomation = false;
            }
        }

        /**
         * Fast, memory-safe chunked take loader for both v2 chunked takes (500k+ records) and legacy v1 takes.
         */
        async loadTakeById(takeId) {
            if (!window.bioquadStorage) throw new Error('Storage engine not available');
            this.stop();

            this.automationEvents = [];
            this.automationCursor = 0;
            this.followAutomation = false;
            this.basePresetSnapshot = null;

            const partitioned = [[], [], [], []];
            const collectedMidiNotes = [];
            const collectedParamEvents = [];
            let firstRecTime = null;
            let takeMeta = null;

            takeMeta = await window.bioquadStorage.iterateTakeChunks(takeId, async (chunk) => {
                const recs = chunk.records || [];
                if (firstRecTime === null && recs.length > 0) {
                    firstRecTime = recs[0].timestamp_ms || (recs[0].timestamp ? new Date(recs[0].timestamp).getTime() : 0);
                }

                for (let i = 0; i < recs.length; i++) {
                    const r = recs[i];
                    if (String(r.sensor_id || '').trim() === 'PERF_PARAM' || (r.param_attr !== undefined && r.param_attr !== null && String(r.param_attr).trim() !== '')) {
                        const pRawT = r.timestamp_ms || (r.timestamp ? Date.parse(r.timestamp) : null);
                        const chNum = parseInt(r.channel);
                        collectedParamEvents.push({
                            timestamp: r.timestamp || null,
                            timestamp_ms: (pRawT !== null && isFinite(pRawT)) ? pRawT : 0,
                            channel: isNaN(chNum) ? 0 : chNum,
                            attr: String(r.param_attr || '').trim(),
                            value: r.param_value ?? ''
                        });
                        continue;
                    }
                    const ch = Math.max(0, Math.min(3, (r.channel || 1) - 1));
                    const val = parseFloat(r.conductance_uS !== undefined ? r.conductance_uS : (r.value || 50));
                    if (!isNaN(val) && isFinite(val)) {
                        const rawT = r.timestamp_ms || (r.timestamp ? Date.parse(r.timestamp) : null);
                        const noteRaw = (r.note !== null && r.note !== undefined && r.note !== '') ? parseInt(r.note) : (r.note_event ? parseInt(r.note_event) : null);
                        const velRaw = (r.velocity !== null && r.velocity !== undefined && r.velocity !== '') ? parseInt(r.velocity) : null;
                        partitioned[ch].push({
                            value: val,
                            rawTime: r.timestamp || r.timestamp_ms || null,
                            parsedMs: (rawT !== null && isFinite(rawT)) ? rawT : undefined,
                            id: r.sensor_id || `CH_${ch + 1}_Sensor`,
                            note: !isNaN(noteRaw) ? noteRaw : null,
                            velocity: !isNaN(velRaw) ? velRaw : null,
                            duration: r.duration || null,
                            ticks: r.ticks || null,
                            isMidiOnly: Boolean(r.isMidiOnly || String(r.sensor_id || '').endsWith('_MIDI')),
                            index: partitioned[ch].length
                        });
                    }
                }

                if (Array.isArray(chunk.midiNotes) && chunk.midiNotes.length > 0) {
                    for (let j = 0; j < chunk.midiNotes.length; j++) {
                        collectedMidiNotes.push(chunk.midiNotes[j]);
                    }
                }

                if (Array.isArray(chunk.paramEvents) && chunk.paramEvents.length > 0) {
                    for (let k = 0; k < chunk.paramEvents.length; k++) {
                        collectedParamEvents.push(chunk.paramEvents[k]);
                    }
                }
            });

            if (takeMeta && takeMeta.preset) {
                this.restorePresetSnapshot(takeMeta.preset);
                this.basePresetSnapshot = JSON.parse(JSON.stringify(takeMeta.preset));
            } else if (window.biodataRecorder) {
                this.basePresetSnapshot = window.biodataRecorder.captureCurrentPreset();
            }

            // Only synthesize note timeline entries from collectedMidiNotes if a channel had ZERO raw conductance records
            // (e.g., pure MIDI-Input recording with no plant sensor). Never backfill onto raw conductance streams!
            if (collectedMidiNotes.length > 0) {
                const originMs = firstRecTime !== null ? firstRecTime : (takeMeta?.timestamp || Date.now());
                collectedMidiNotes.sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0));
                for (let ch = 0; ch < 4; ch++) {
                    if (partitioned[ch].length > 0) continue;
                    const chNotes = collectedMidiNotes.filter(m => Math.max(0, Math.min(3, m.channel ?? 0)) === ch);
                    for (let i = 0; i < chNotes.length; i++) {
                        const m = chNotes[i];
                        const absMs = originMs + (m.timeMs || 0);
                        partitioned[ch].push({
                            value: 50,
                            rawTime: new Date(absMs).toISOString(),
                            parsedMs: absMs,
                            id: `CH_${ch + 1}_MIDI`,
                            note: m.pitch,
                            velocity: m.velocity || 80,
                            duration: m.durationMs || 260,
                            ticks: 200000,
                            isMidiOnly: true,
                            index: partitioned[ch].length
                        });
                    }
                }
            }

            const fname = `${takeMeta?.name || 'take'}.csv`;
            let minTimeMs = Infinity;
            let validTimeCount = 0;

            for (let ch = 0; ch < 4; ch++) {
                const arr = partitioned[ch];
                for (let i = 0; i < arr.length; i++) {
                    if (arr[i].parsedMs !== undefined) {
                        if (arr[i].parsedMs < minTimeMs) minTimeMs = arr[i].parsedMs;
                        validTimeCount++;
                    }
                }
            }

            for (let i = 0; i < collectedParamEvents.length; i++) {
                const ev = collectedParamEvents[i];
                const ms = ev.timestamp_ms !== undefined ? ev.timestamp_ms : (ev.timestamp ? Date.parse(ev.timestamp) : null);
                if (ms !== null && isFinite(ms)) {
                    ev.timestamp_ms = ms;
                    if (ms < minTimeMs) minTimeMs = ms;
                    validTimeCount++;
                }
            }

            const hasRealTimestamps = validTimeCount >= 2 && minTimeMs !== Infinity;
            this.hasRealTimestamps = hasRealTimestamps;
            let maxDurationMs = 0;

            for (let ch = 0; ch < 4; ch++) {
                const arr = partitioned[ch];
                if (arr.length === 0) {
                    this.channelFeeds[ch] = {
                        data: [],
                        index: 0,
                        label: 'Unassigned',
                        sourceFile: '',
                        metricMeta: { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' }
                    };
                    if (window.chData && window.chData[ch]) {
                        window.chData[ch].metricMeta = { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' };
                    }
                    continue;
                }

                let lastTMs = 0;
                for (let i = 0; i < arr.length; i++) {
                    const pt = arr[i];
                    if (hasRealTimestamps && pt.parsedMs !== undefined) {
                        let tOffset = Math.max(0, pt.parsedMs - minTimeMs);
                        if (tOffset < lastTMs) tOffset = lastTMs;
                        pt.tMs = tOffset;
                        lastTMs = tOffset;
                    } else {
                        const tOffset = (i / 30) * 1000;
                        pt.tMs = tOffset;
                        lastTMs = tOffset;
                    }
                    if (pt.tMs > maxDurationMs) maxDurationMs = pt.tMs;
                }

                const hasNotes = arr.some(pt => pt.note !== null);
                const isMidiOnly = arr.length > 0 && arr.every(pt => Boolean(pt.isMidiOnly));
                const takeMetricMeta = isMidiOnly
                    ? { isBiodata: false, unit: '', heading: 'MIDI EVENTS' }
                    : { isBiodata: true, unit: '\u00B5S', heading: 'ADMITTANCE' };
                this.channelFeeds[ch] = {
                    data: arr,
                    index: 0,
                    label: `CH ${ch + 1} Recorded`,
                    sourceFile: fname,
                    hasRecordedNotes: hasNotes,
                    isMidiOnly,
                    metricMeta: takeMetricMeta
                };

                const chVisual = window.chData ? window.chData[ch] : null;
                if (chVisual) {
                    chVisual.metricMeta = takeMetricMeta;
                    let dMin = Infinity, dMax = -Infinity;
                    for (let k = 0; k < arr.length; k++) {
                        if (arr[k].value < dMin) dMin = arr[k].value;
                        if (arr[k].value > dMax) dMax = arr[k].value;
                    }
                    if (isFinite(dMin) && isFinite(dMax) && dMax > dMin) {
                        chVisual.bounds = { min: dMin, max: dMax };
                        chVisual.boundsNeedSnap = true;
                    }
                    chVisual.waveBuffer = [];
                    chVisual.vizBuffer = [];
                    chVisual.history = [];
                    chVisual.acc = { sum: 0, count: 0, min: Infinity, max: -Infinity, lastSec: Date.now() };
                    const preWarm = Math.min(25, arr.length);
                    for (let p = 0; p < preWarm; p++) {
                        const rVal = arr[p].value;
                        chVisual.waveBuffer.push({ r: rVal, ticks: Math.round(10000000 / (rVal || 1)), evt: 0 });
                        chVisual.vizBuffer.push(rVal);
                    }
                }
            }

            if (collectedParamEvents.length > 0) {
                for (let i = 0; i < collectedParamEvents.length; i++) {
                    const ev = collectedParamEvents[i];
                    if (!ev.attr) continue;
                    const tOffset = (hasRealTimestamps && ev.timestamp_ms !== undefined) ? Math.max(0, ev.timestamp_ms - minTimeMs) : 0;
                    if (tOffset > maxDurationMs) maxDurationMs = tOffset;
                    const chParsed = parseInt(ev.channel);
                    this.automationEvents.push({
                        tMs: tOffset,
                        channel: isNaN(chParsed) ? 0 : chParsed,
                        attr: ev.attr,
                        value: ev.value
                    });
                }
                this.automationEvents.sort((a, b) => a.tMs - b.tMs);
                this.followAutomation = this.automationEvents.length > 0;
            }

            const lengths = this.channelFeeds.map(f => f.data.length).filter(len => len > 0);
            this.totalRecords = lengths.length > 0 ? Math.max(...lengths) : 0;
            this.currentIndex = 0;
            this.playbackElapsedMs = 0;
            this.totalDurationMs = maxDurationMs > 0 ? maxDurationMs : ((this.totalRecords / 30) * 1000);

            if (this.followAutomation && this.automationEvents.length > 0) {
                this.reconcileAutomationToTime(0);
            }

            if (typeof window.syncUI === 'function') window.syncUI();
            this.emitChange('mapping_applied');
            return takeMeta;
        }

        // Compatibility wrapper for direct in-memory take objects
        loadTake(take) {
            if (!take) throw new Error('Invalid take');
            if (take.id && (!Array.isArray(take.records) || take.records.length === 0)) {
                return this.loadTakeById(take.id);
            }
            if (!Array.isArray(take.records) || take.records.length === 0) {
                throw new Error('Take contains no records');
            }
            if (take.preset) this.restorePresetSnapshot(take.preset);

            // Only synthesize records from midiNotes if take.records had zero raw conductance samples
            if (Array.isArray(take.midiNotes) && take.midiNotes.length > 0 && take.records.length === 0) {
                const originMs = take.timestamp || Date.now();
                take.midiNotes.forEach(m => {
                    const absMs = originMs + (m.timeMs || 0);
                    const ch = (m.channel !== undefined ? m.channel : 0) + 1;
                    take.records.push({
                        timestamp: new Date(absMs).toISOString(),
                        timestamp_ms: absMs,
                        sensor_id: `CH_${ch}_MIDI`,
                        channel: ch,
                        conductance_uS: 50,
                        ticks: 200000,
                        note: m.pitch,
                        velocity: m.velocity || 80,
                        duration: m.durationMs || 260,
                        isMidiOnly: true
                    });
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
                autoApplyWindow: !take.preset
            });

            return parsed;
        }
    }

    // --- 2. UNLIMITED CHUNK-STREAMING BIODATA RECORDER ENGINE ---
    class BiodataRecorderEngine {
        constructor() {
            this.isRecording = false;
            this.isPaused = false;
            this.recordAutomation = false; // Default OFF so student/novice CSVs stay clean unless toggled ON
            this.hasCapturedAutomationBaseline = false;
            this.sessionName = (window.BioQuadCore && typeof window.BioQuadCore.makeTimestampSlug === 'function')
                ? window.BioQuadCore.makeTimestampSlug('bioQuad')
                : 'bioQuad_session';
            this.customNameSet = false;
            this.lastSavedTakeId = null;
            this.activeTakeId = null;
            this.startTimeMs = 0;
            this.pauseTimeAccumulatedMs = 0;
            this.pauseStartMs = 0;
            this.records = [];
            this.recordedMidiNotes = [];
            this.paramEvents = [];
            this.pendingParamTimers = {};
            this.pendingParamLatest = {};
            this.lastParamValues = {};
            this.totalPointsRecorded = 0;
            this.totalParamEventsRecorded = 0;
            this.nextChunkIndex = 0;
            this.chunkSize = 5000;
            this.flushQueue = Promise.resolve();
            this.timerInterval = null;
            this.listeners = new Set();
            this.latestChannelValues = [0, 0, 0, 0];
            this.lastPacketTimeByCh = [0, 0, 0, 0];
            this.hasReceivedRawByCh = [false, false, false, false];

            // Crash / app-suspend protection on iOS iPadOS WebViews (Blueify)
            if (typeof window !== 'undefined') {
                const emergencyFlush = () => {
                    if (this.isRecording) {
                        this.flushCurrentBuffers(false);
                    }
                };
                window.addEventListener('pagehide', emergencyFlush);
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'hidden') emergencyFlush();
                });
            }
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

        getElapsedMs() {
            if (!this.isRecording) return 0;
            if (this.isPaused) {
                return Math.max(0, this.pauseStartMs - this.startTimeMs - this.pauseTimeAccumulatedMs);
            }
            return Math.max(0, Date.now() - this.startTimeMs - this.pauseTimeAccumulatedMs);
        }

        getState() {
            const elapsedMs = this.getElapsedMs();
            const totalPts = this.totalPointsRecorded || this.records.length;
            return {
                isRecording: this.isRecording,
                isPaused: this.isPaused,
                recordAutomation: this.recordAutomation,
                sessionName: this.sessionName,
                customNameSet: this.customNameSet,
                lastSavedTakeId: this.lastSavedTakeId,
                activeTakeId: this.activeTakeId,
                recordCount: totalPts,
                totalPointsRecorded: totalPts,
                automationCount: this.totalParamEventsRecorded,
                hasAutomation: this.totalParamEventsRecorded > 0,
                chunkCount: this.nextChunkIndex,
                elapsedMs,
                elapsedFormatted: this.formatElapsed(elapsedMs),
                hasData: totalPts > 0
            };
        }

        setRecordAutomation(enabled) {
            const next = Boolean(enabled);
            if (this.recordAutomation === next) return this.recordAutomation;

            if (!next) {
                this.clearPendingParamTimers();
                this.recordAutomation = false;
                this.emitChange('record_automation_toggle');
                return false;
            }

            this.recordAutomation = true;
            if (this.isRecording && !this.isPaused) {
                const nowMs = Date.now();
                if (!this.hasCapturedAutomationBaseline) {
                    const baseline = extractFullStateEvents(nowMs);
                    for (let i = 0; i < baseline.length; i++) {
                        const ev = baseline[i];
                        this.lastParamValues[`${ev.channel}:${ev.attr}`] = ev.value;
                        this.paramEvents.push(ev);
                        this.totalParamEventsRecorded++;
                    }
                    this.hasCapturedAutomationBaseline = true;
                } else {
                    this.recordSnapshotDelta(null);
                }
            }
            this.emitChange('record_automation_toggle');
            return true;
        }

        toggleRecordAutomation() {
            return this.setRecordAutomation(!this.recordAutomation);
        }

        async setSessionName(rawName, renameLastIfIdle = false) {
            const clean = (window.BioQuadCore && typeof window.BioQuadCore.sanitizeSessionFilename === 'function')
                ? window.BioQuadCore.sanitizeSessionFilename(rawName, 'bioQuad')
                : (String(rawName || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'bioQuad_session');
            this.sessionName = clean;
            this.customNameSet = true;

            if (this.isRecording && this.activeTakeId && window.bioquadStorage) {
                try {
                    const meta = await window.bioquadStorage.getTakeMeta(this.activeTakeId);
                    if (meta) {
                        meta.name = clean;
                        await window.bioquadStorage.saveTakeMeta(meta);
                    }
                } catch (e) {}
            } else if (renameLastIfIdle && this.lastSavedTakeId && window.bioquadStorage) {
                try {
                    await window.bioquadStorage.renameTake(this.lastSavedTakeId, clean);
                } catch (e) {}
            }

            this.emitChange('session_name_change');
            return clean;
        }

        resetSessionNameToTimestamp() {
            this.sessionName = (window.BioQuadCore && typeof window.BioQuadCore.makeTimestampSlug === 'function')
                ? window.BioQuadCore.makeTimestampSlug('bioQuad')
                : `bioQuad_${Date.now()}`;
            this.customNameSet = false;
            this.emitChange('session_name_change');
            return this.sessionName;
        }

        formatElapsed(ms) {
            const totalSec = Math.floor(ms / 1000);
            const m = Math.floor(totalSec / 60);
            const s = totalSec % 60;
            const tenths = Math.floor((ms % 1000) / 100);
            return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
        }

        _commitPendingParam(key) {
            const entry = this.pendingParamLatest[key];
            if (this.pendingParamTimers[key]) {
                clearTimeout(this.pendingParamTimers[key]);
                delete this.pendingParamTimers[key];
            }
            delete this.pendingParamLatest[key];
            if (!entry || !this.isRecording || this.isPaused || !this.recordAutomation) return;
            if (this.lastParamValues[key] === entry.val) return;
            this.lastParamValues[key] = entry.val;
            this.paramEvents.push({
                timestamp: new Date(entry.ts).toISOString(),
                timestamp_ms: entry.ts,
                channel: entry.ch,
                attr: entry.attr,
                value: entry.val
            });
            this.totalParamEventsRecorded++;
        }

        flushPendingParams() {
            const keys = new Set([
                ...Object.keys(this.pendingParamTimers),
                ...Object.keys(this.pendingParamLatest)
            ]);
            keys.forEach(k => this._commitPendingParam(k));
        }

        clearPendingParamTimers() {
            Object.keys(this.pendingParamTimers).forEach(k => clearTimeout(this.pendingParamTimers[k]));
            this.pendingParamTimers = {};
            this.pendingParamLatest = {};
        }

        recordParam(channelOneBased, attr, value, immediate = false) {
            if (!this.isRecording || this.isPaused || !this.recordAutomation || !attr) return;
            const ch = (channelOneBased === null || channelOneBased === undefined) ? 0 : parseInt(channelOneBased);
            const normVal = normalizeParamValue(attr, value);
            const key = `${ch}:${attr}`;

            if (immediate) {
                if (this.pendingParamTimers[key]) {
                    clearTimeout(this.pendingParamTimers[key]);
                    delete this.pendingParamTimers[key];
                }
                delete this.pendingParamLatest[key];
                if (this.lastParamValues[key] === normVal) return;
                const nowMs = Date.now();
                this.lastParamValues[key] = normVal;
                this.paramEvents.push({
                    timestamp: new Date(nowMs).toISOString(),
                    timestamp_ms: nowMs,
                    channel: ch,
                    attr,
                    value: normVal
                });
                this.totalParamEventsRecorded++;
                return;
            }

            this.pendingParamLatest[key] = { ch, attr, val: normVal, ts: Date.now() };
            if (!this.pendingParamTimers[key]) {
                this.pendingParamTimers[key] = setTimeout(() => {
                    this._commitPendingParam(key);
                }, 35);
            }
        }

        recordSnapshotDelta(chIdxOrNull = null) {
            if (!this.isRecording || this.isPaused || !this.recordAutomation) return;
            this.flushPendingParams();
            const nowMs = Date.now();
            const all = extractFullStateEvents(nowMs);
            for (let i = 0; i < all.length; i++) {
                const ev = all[i];
                if (chIdxOrNull !== null && chIdxOrNull !== undefined) {
                    if (ev.channel !== 0 && ev.channel !== (chIdxOrNull + 1)) continue;
                }
                this.recordParam(ev.channel, ev.attr, ev.value, true);
            }
        }

        start(sessionName = '') {
            const defaultDateName = (window.BioQuadCore && typeof window.BioQuadCore.makeTimestampSlug === 'function')
                ? window.BioQuadCore.makeTimestampSlug('bioQuad')
                : `bioQuad_${Date.now()}`;

            if (sessionName && sessionName.trim()) {
                this.sessionName = (window.BioQuadCore && typeof window.BioQuadCore.sanitizeSessionFilename === 'function')
                    ? window.BioQuadCore.sanitizeSessionFilename(sessionName, 'bioQuad')
                    : sessionName.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
                this.customNameSet = true;
            } else if (!this.customNameSet || !this.sessionName) {
                this.sessionName = defaultDateName;
            }

            this.clearPendingParamTimers();
            this.activeTakeId = `take_${Date.now()}`;
            this.sessionPreset = this.captureCurrentPreset();
            this.recordedMidiNotes = [];
            this.records = [];
            this.paramEvents = [];
            this.lastParamValues = {};
            this.totalPointsRecorded = 0;
            this.totalParamEventsRecorded = 0;
            this.hasCapturedAutomationBaseline = false;
            this.nextChunkIndex = 0;
            this.flushQueue = Promise.resolve();

            this.isRecording = true;
            this.isPaused = false;
            this.startTimeMs = Date.now();
            this.pauseTimeAccumulatedMs = 0;
            this.latestChannelValues = [0, 0, 0, 0];
            this.lastPacketTimeByCh = [0, 0, 0, 0];
            this.hasReceivedRawByCh = [false, false, false, false];

            // Capture t=0 baseline performance automation snapshot ONLY if automation recording is enabled
            if (this.recordAutomation) {
                const baseline = extractFullStateEvents(this.startTimeMs);
                for (let i = 0; i < baseline.length; i++) {
                    const ev = baseline[i];
                    this.lastParamValues[`${ev.channel}:${ev.attr}`] = ev.value;
                    this.paramEvents.push(ev);
                }
                this.totalParamEventsRecorded = this.paramEvents.length;
                this.hasCapturedAutomationBaseline = true;
            }

            // Persist initial take metadata immediately so even crash recovery has the header
            const initialMeta = {
                id: this.activeTakeId,
                name: this.sessionName,
                date: new Date().toLocaleString(),
                timestamp: Date.now(),
                durationMs: 0,
                durationFormatted: '00:00.0',
                sampleCount: 0,
                totalPointsRecorded: 0,
                hasAutomation: this.totalParamEventsRecorded > 0,
                automationCount: this.totalParamEventsRecorded,
                chunkCount: 0,
                schemaVersion: 2,
                isRecordingActive: true,
                preset: this.sessionPreset
            };
            this.flushQueue = this.flushQueue
                .then(() => window.bioquadStorage?.saveTakeMeta(initialMeta))
                .catch(err => console.warn('Initial take metadata save failed:', err));

            if (this.timerInterval) clearInterval(this.timerInterval);
            this.timerInterval = setInterval(() => {
                if (this.isRecording && !this.isPaused) {
                    this.emitChange('tick');
                }
            }, 100);

            this.emitChange('start');
        }

        flushCurrentBuffers(isFinal = false) {
            if (!this.activeTakeId || !window.bioquadStorage) return Promise.resolve();

            this.flushPendingParams();

            const recBatch = this.records;
            const noteBatch = this.recordedMidiNotes;
            const paramBatch = this.paramEvents;
            const hasBatchData = recBatch.length > 0 || noteBatch.length > 0 || paramBatch.length > 0;

            if (hasBatchData) {
                this.records = [];
                this.recordedMidiNotes = [];
                this.paramEvents = [];
            }

            const chunkIdx = hasBatchData ? this.nextChunkIndex++ : this.nextChunkIndex;
            const totalPts = this.totalPointsRecorded;
            const totalAuto = this.totalParamEventsRecorded;
            const elapsedMs = this.getElapsedMs();
            const takeId = this.activeTakeId;

            const metaSnapshot = {
                id: takeId,
                name: this.sessionName,
                date: new Date().toLocaleString(),
                timestamp: this.startTimeMs || Date.now(),
                durationMs: elapsedMs,
                durationFormatted: this.formatElapsed(elapsedMs),
                sampleCount: totalPts,
                totalPointsRecorded: totalPts,
                hasAutomation: totalAuto > 0,
                automationCount: totalAuto,
                chunkCount: this.nextChunkIndex,
                schemaVersion: 2,
                isRecordingActive: !isFinal,
                preset: this.sessionPreset || this.captureCurrentPreset()
            };

            this.flushQueue = this.flushQueue.then(async () => {
                if (hasBatchData) {
                    await window.bioquadStorage.saveChunk(takeId, chunkIdx, recBatch, noteBatch, paramBatch);
                }
                if (totalPts > 0 || totalAuto > 0 || isFinal) {
                    await window.bioquadStorage.saveTakeMeta(metaSnapshot);
                }
            }).catch(err => {
                console.warn('IndexedDB chunk flush error:', err);
            });

            return this.flushQueue;
        }

        captureCurrentPreset() {
            try {
                const channels = (window.synthChannels || []).map(ch => {
                    const p = JSON.parse(JSON.stringify(ch.params || {}));
                    if (typeof window.normalizeScaleParams === 'function') {
                        window.normalizeScaleParams(p);
                    }
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
            this.flushPendingParams();
            this.isPaused = true;
            this.pauseStartMs = Date.now();
            this.flushCurrentBuffers(false);
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
            this.flushPendingParams();
            const elapsedMs = this.getElapsedMs();
            this.isRecording = false;
            this.isPaused = false;
            if (this.timerInterval) {
                clearInterval(this.timerInterval);
                this.timerInterval = null;
            }

            const takeId = this.activeTakeId;
            const totalPts = this.totalPointsRecorded;
            const totalAuto = this.totalParamEventsRecorded;

            if (totalPts > 0 || this.records.length > 0 || this.recordedMidiNotes.length > 0 || this.paramEvents.length > 0) {
                // Capture duration before isRecording became false
                const recBatch = this.records;
                const noteBatch = this.recordedMidiNotes;
                const paramBatch = this.paramEvents;
                this.records = [];
                this.recordedMidiNotes = [];
                this.paramEvents = [];

                const hasBatch = recBatch.length > 0 || noteBatch.length > 0 || paramBatch.length > 0;
                const chunkIdx = hasBatch ? this.nextChunkIndex++ : this.nextChunkIndex;

                const finalMeta = {
                    id: takeId,
                    name: this.sessionName,
                    date: new Date().toLocaleString(),
                    timestamp: Date.now(),
                    durationMs: elapsedMs,
                    durationFormatted: this.formatElapsed(elapsedMs),
                    sampleCount: totalPts,
                    totalPointsRecorded: totalPts,
                    hasAutomation: totalAuto > 0,
                    automationCount: totalAuto,
                    chunkCount: this.nextChunkIndex,
                    schemaVersion: 2,
                    isRecordingActive: false,
                    preset: this.sessionPreset || this.captureCurrentPreset()
                };

                try {
                    await this.flushQueue;
                    if (hasBatch) {
                        await window.bioquadStorage.saveChunk(takeId, chunkIdx, recBatch, noteBatch, paramBatch);
                    }
                    await window.bioquadStorage.saveTakeMeta(finalMeta);
                    this.lastSavedTakeId = takeId;
                    this.customNameSet = false;
                    window.dispatchEvent(new CustomEvent('bioquad_takes_updated', { detail: finalMeta }));
                } catch(e) {
                    console.warn('Could not finalize streamed take in IndexedDB:', e);
                }

                if (autoArm && window.dataStreamer) {
                    try {
                        await window.dataStreamer.loadTakeById(takeId);
                    } catch(e) {
                        console.warn("Auto-arm player notice:", e);
                    }
                }
            } else if (takeId && window.bioquadStorage) {
                // Clean up empty take metadata if 0 points were recorded
                try { await window.bioquadStorage.deleteTake(takeId); } catch(e) {}
            }

            this.emitChange('stop');
        }

        clear() {
            this.stop(false);
            this.clearPendingParamTimers();
            this.records = [];
            this.recordedMidiNotes = [];
            this.paramEvents = [];
            this.lastParamValues = {};
            this.totalPointsRecorded = 0;
            this.totalParamEventsRecorded = 0;
            this.nextChunkIndex = 0;
            this.emitChange('clear');
        }

        recordRaw(chIdx, ticksArray) {
            if (!this.isRecording || this.isPaused || !Array.isArray(ticksArray)) return;

            const CALIBRATION_FACTOR = 10000000;
            const now = Date.now();
            const sensorId = `CH_${chIdx + 1}_Sensor`;

            this.hasReceivedRawByCh[chIdx] = true;
            const count = ticksArray.length;
            const lastTime = this.lastPacketTimeByCh[chIdx] || (now - 50);
            this.lastPacketTimeByCh[chIdx] = now;
            const intervalMs = Math.max(10, Math.min(200, now - lastTime));

            // Push points into the active chunk buffer (no 50k cap, no Array.shift)
            for (let i = 0; i < count; i++) {
                const rawTicks = ticksArray[i];
                let rVal = rawTicks > 0 ? (CALIBRATION_FACTOR / rawTicks) : 0;
                rVal = Math.max(0.1, parseFloat(rVal.toFixed(2)));
                this.latestChannelValues[chIdx] = rVal;

                this.totalPointsRecorded = (this.totalPointsRecorded || 0) + 1;

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

            // Stream chunk to IndexedDB seamlessly whenever buffer reaches chunkSize
            if (this.records.length >= this.chunkSize) {
                this.flushCurrentBuffers(false);
            }
        }

        // Companion MIDI note tracker (for .mid ZIP export & CSV metadata logging; never injects fake conductance into raw streams)
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

            // Tag note metadata onto the closest recent raw sample on this channel if within 150ms
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

            // Only create a synthetic MIDI-only row if this channel has NEVER received real raw conductance telemetry
            if (!tagged && !this.hasReceivedRawByCh[chIdx]) {
                const sensorId = `CH_${chIdx + 1}_MIDI`;
                this.records.push({
                    timestamp: new Date(now).toISOString(),
                    timestamp_ms: now,
                    sensor_id: sensorId,
                    channel: chIdx + 1,
                    conductance_uS: 50,
                    ticks: 200000,
                    note: note,
                    velocity: velocity || 80,
                    duration: duration || 260,
                    isMidiOnly: true
                });
                this.totalPointsRecorded = (this.totalPointsRecorded || 0) + 1;
                if (this.records.length >= this.chunkSize) {
                    this.flushCurrentBuffers(false);
                }
            }
        }

        generateCsv(format = 'standard') {
            this.flushPendingParams();
            const pevs = this.recordAutomation
                ? (this.paramEvents || []).slice().sort((a, b) => (a.timestamp_ms || 0) - (b.timestamp_ms || 0))
                : [];
            const recs = this.records || [];
            if (recs.length === 0 && pevs.length === 0) return '';

            const includeAutoCols = pevs.length > 0;
            const delimiter = format === 'tsv' ? '\t' : ',';
            const esc = (v) => delimiter === ',' ? csvEscape(v) : String(v ?? '').replace(/\t/g, ' ');
            const headers = includeAutoCols
                ? ['timestamp_iso', 'sensor_id', 'conductance_uS', 'channel', 'raw_ticks', 'note_event', 'velocity', 'param_attr', 'param_value']
                : ['timestamp_iso', 'sensor_id', 'conductance_uS', 'channel', 'raw_ticks', 'note_event', 'velocity'];
            const lines = [headers.join(delimiter)];

            const pushRec = (r) => {
                const noteVal = (r.note !== null && r.note !== undefined && r.note !== '') ? r.note : (r.note_event || '');
                const velVal = (r.velocity !== null && r.velocity !== undefined && r.velocity !== '') ? r.velocity : '';
                const baseCols = [
                    esc(r.timestamp),
                    esc(r.sensor_id),
                    r.conductance_uS,
                    r.channel,
                    r.ticks,
                    noteVal,
                    velVal
                ];
                if (includeAutoCols) baseCols.push('', '');
                lines.push(baseCols.join(delimiter));
            };

            const pushParam = (ev) => {
                lines.push([
                    esc(ev.timestamp || (ev.timestamp_ms !== undefined ? new Date(ev.timestamp_ms).toISOString() : '')),
                    'PERF_PARAM',
                    '',
                    ev.channel ?? 0,
                    '',
                    '',
                    '',
                    esc(ev.attr || ''),
                    esc(ev.value ?? '')
                ].join(delimiter));
            };

            let ri = 0, pi = 0;
            while (ri < recs.length || pi < pevs.length) {
                if (pi >= pevs.length) {
                    pushRec(recs[ri++]);
                } else if (ri >= recs.length) {
                    pushParam(pevs[pi++]);
                } else {
                    const rMs = recs[ri].timestamp_ms ?? 0;
                    const pMs = pevs[pi].timestamp_ms ?? 0;
                    if (pMs <= rMs) pushParam(pevs[pi++]);
                    else pushRec(recs[ri++]);
                }
            }

            return lines.join('\n');
        }

        // Build standard Type 0 Standard MIDI File Uint8Array for direct or ZIP export
        generateMidiBytes(midiNotes = null, targetChannel = null, trackName = '', bpmOverride = null) {
            let notes = midiNotes || this.recordedMidiNotes || [];
            if (targetChannel !== null && targetChannel !== undefined) {
                notes = notes.filter(n => n.channel === targetChannel);
            }
            if (notes.length === 0) return null;

            const ticksPerQuarter = 480;
            const bpm = (bpmOverride && !isNaN(bpmOverride)) ? bpmOverride : ((window.masterBPM && !isNaN(window.masterBPM)) ? window.masterBPM : 120);
            const msPerTick = (60000 / bpm) / ticksPerQuarter;

            const events = [];
            notes.forEach(n => {
                const startTick = Math.max(0, Math.round(n.timeMs / msPerTick));
                const endTick = Math.max(startTick + 1, Math.round((n.timeMs + n.durationMs) / msPerTick));
                const ch = (targetChannel !== null && targetChannel !== undefined) ? 0 : Math.max(0, Math.min(15, n.channel || 0));
                
                events.push({ tick: startTick, type: 0x90, channel: ch, note: n.pitch, vel: n.velocity || 80 });
                events.push({ tick: endTick, type: 0x80, channel: ch, note: n.pitch, vel: 0 });
            });

            events.sort((a, b) => a.tick - b.tick || a.type - b.type);

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

            const mpqn = Math.round(60000000 / bpm);
            trackBytes.push(0x00, 0xFF, 0x51, 0x03, (mpqn >> 16) & 0xFF, (mpqn >> 8) & 0xFF, mpqn & 0xFF);

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

            trackBytes.push(0x00, 0xFF, 0x2F, 0x00);

            const header = [
                0x4D, 0x54, 0x68, 0x64,
                0x00, 0x00, 0x00, 0x06,
                0x00, 0x00,
                0x00, 0x01,
                (ticksPerQuarter >> 8) & 0xFF, ticksPerQuarter & 0xFF
            ];

            const trackLen = trackBytes.length;
            const trackHeader = [
                0x4D, 0x54, 0x72, 0x6B,
                (trackLen >> 24) & 0xFF,
                (trackLen >> 16) & 0xFF,
                (trackLen >> 8) & 0xFF,
                trackLen & 0xFF
            ];

            return new Uint8Array([...header, ...trackHeader, ...trackBytes]);
        }

        generateMidiBlob(midiNotes = null, targetChannel = null, trackName = '', bpmOverride = null) {
            const bytes = this.generateMidiBytes(midiNotes, targetChannel, trackName, bpmOverride);
            return bytes ? new Blob([bytes], { type: 'audio/midi' }) : null;
        }

        async downloadRecordingFile(format = 'standard') {
            if (this.activeTakeId && window.bioquadStorage) {
                return window.bioquadStorage.exportTakeCsvBlob(this.activeTakeId);
            }
            const ext = format === 'tsv' ? 'tsv' : 'csv';
            const content = this.generateCsv(format);
            if (!content) return null;
            const blob = new Blob([content], { type: format === 'tsv' ? 'text/tab-separated-values' : 'text/csv' });
            this.triggerDownloadBlob(blob, `${this.sessionName}.${ext}`);
            return `${this.sessionName}.${ext}`;
        }

        async downloadMidiFile() {
            if (this.activeTakeId && window.bioquadStorage) {
                const res = await window.bioquadStorage.exportTakeMidiZipBlob(this.activeTakeId);
                this.triggerDownloadBlob(res.blob, res.filename);
                return res.filename;
            }
            return null;
        }

        triggerDownloadBlob(blob, fname) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fname;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        }

        async loadRecordingIntoStreamer() {
            if (this.activeTakeId && window.dataStreamer) {
                return window.dataStreamer.loadTakeById(this.activeTakeId);
            }
        }
    }

    // Export utilities & singletons on window
    window.buildZipBlob = buildZipBlob;
    window.BioquadStorage = BioquadStorage;
    window.bioquadStorage = new BioquadStorage();
    window.DataStreamer = DataStreamerEngine;
    window.dataStreamer = new DataStreamerEngine();
    window.BiodataRecorder = BiodataRecorderEngine;
    window.biodataRecorder = new BiodataRecorderEngine();

})(window);
