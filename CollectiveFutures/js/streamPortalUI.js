/**
 * bioQuad Stream - Pure Vanilla Data Stream & File Portal UI Controller
 * Runs directly in the browser without React, Vite, Node, or any build step.
 * Designed for offline-first PWA on GitHub Pages.
 */

(function () {
  'use strict';

  // Sample Datasets definitions with dense time-series data
  const SAMPLE_DATASETS = [
    {
      id: 'nasa',
      name: 'NASA ISS Telemetry',
      badge: '5,000 rows · Multi-Column',
      desc: 'Solar array volts, cabin pressure kPa, coolant temp °C, gyro drift rate',
      file: './datasets/nasa_telemetry_iss.csv'
    },
    {
      id: 'ekg',
      name: 'EKG Cardiac & GSR',
      badge: '6,000 rows · Multi-Series',
      desc: 'Lead_I_Heart wave (P-Q-R-S-T) + Lead_II_GSR galvanic skin response',
      file: './datasets/ekg_heart_biometrics.csv'
    },
    {
      id: 'crypto',
      name: 'Crypto Tick HFT',
      badge: '5,000 rows · Multi-Series',
      desc: 'BTC_USDT, ETH_USDT, and SOL_USDT high-density prices and tick volume',
      file: './datasets/market_crypto_hft.csv'
    },
    {
      id: 'forest',
      name: 'Deep Forest Mycelium',
      badge: '8,000 rows · 4 Channels',
      desc: 'Oak canopy, fern spore, mycelium network, and moss bio-conductance',
      file: './datasets/deep_forest_mycelium.csv'
    }
  ];

  const CH_COLORS = ['#ff3333', '#39ff14', '#33ccff', '#b84dff'];

  // Local UI State
  let isBoxVisible = localStorage.getItem('bioquad_portal_box_visible') !== 'false';
  let isPortalModalOpen = false;
  let parsedPreview = null;
  let mappingMode = 'multi_sensor_id';
  let targetSingleChannel = 0;
  let sensorToChMap = {};
  let colToChMap = {};
  let selectedIdCol = '';
  let selectedValueCol = '';
  let selectedTimeCol = '';
  let autoApplyWindow = true;
  let cadenceRate = 30;

  // DOM utility
  function $(id) {
    return document.getElementById(id);
  }

  function formatMs(ms) {
    if (!ms || !isFinite(ms)) return '00:00';
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // --- 1. VISIBILITY & TOOLBAR SYNC ---
  window.toggleDataPortalUI = function () {
    isBoxVisible = !isBoxVisible;
    localStorage.setItem('bioquad_portal_box_visible', String(isBoxVisible));
    updateDeckVisibility();
  };

  window.openDataPortal = function () {
    isBoxVisible = true;
    localStorage.setItem('bioquad_portal_box_visible', 'true');
    updateDeckVisibility();
    openPortalModal();
  };

  function updateDeckVisibility() {
    const deck = $('stream-transport-deck');
    const toggleBtn = $('toggle-portal-btn');
    if (deck) {
      deck.style.display = isBoxVisible ? 'flex' : 'none';
    }
    if (toggleBtn) {
      toggleBtn.style.opacity = isBoxVisible ? '1.0' : '0.6';
      toggleBtn.style.borderColor = isBoxVisible ? 'var(--cyan)' : 'var(--border)';
    }
  }

  function updateToolbarIndicator() {
    const ind = $('file-portal-indicator');
    if (!ind) return;

    const ds = window.dataStreamer;
    const rec = window.biodataRecorder;
    const isRecording = rec && rec.isRecording;
    const isPlaying = ds && ds.isPlaying;

    if (isRecording) {
      ind.innerHTML = '';
      ind.style.display = 'inline-block';
      ind.style.width = '7px';
      ind.style.height = '7px';
      ind.style.borderRadius = '50%';
      ind.style.background = '#ff0033';
      ind.style.boxShadow = '0 0 8px #ff0033';
    } else if (isPlaying) {
      ind.innerHTML = '▶';
      ind.style.display = 'inline-block';
      ind.style.width = 'auto';
      ind.style.height = 'auto';
      ind.style.background = 'transparent';
      ind.style.boxShadow = 'none';
      ind.style.color = 'var(--cyan, #00f0ff)';
      ind.style.fontSize = '8px';
      ind.style.lineHeight = '1';
    } else {
      ind.innerHTML = '';
      ind.style.display = 'inline-block';
      ind.style.width = '6px';
      ind.style.height = '6px';
      ind.style.borderRadius = '50%';
      ind.style.background = '#661111';
      ind.style.boxShadow = 'none';
    }
  }

  // --- 2. MODAL CONTROLS ---
  function openPortalModal() {
    isPortalModalOpen = true;
    const modal = $('file-portal-modal');
    if (modal) {
      modal.style.display = 'flex';
      renderChannelsInModal();
      renderSavedTakes();
    }
  }

  function closePortalModal() {
    isPortalModalOpen = false;
    const modal = $('file-portal-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  window.closePortalModal = closePortalModal;

  // --- 3. TRANSPORT DECK RENDERING & SYNC ---
  function updateTransportDeck() {
    const ds = window.dataStreamer;
    const rec = window.biodataRecorder;
    if (!ds) return;

    const streamState = ds.getState();
    const isStreamingActive = streamState && streamState.totalRecords > 0;
    const isRecording = rec && rec.isRecording;

    // 1. Record button & data points
    const recBtn = $('btn-rec-stream');
    const ptsCounter = $('stream-pts-counter');
    if (recBtn) {
      if (isRecording) {
        recBtn.classList.add('recording');
        recBtn.innerHTML = '● STOP REC';
      } else {
        recBtn.classList.remove('recording');
        recBtn.innerHTML = '● REC';
      }
    }
    if (ptsCounter) {
      if (isRecording) {
        ptsCounter.style.color = '#ff5577';
        ptsCounter.textContent = `${(rec.totalPointsRecorded || rec.recordCount || 0).toLocaleString()} pts`;
      } else if (rec && rec.hasData) {
        ptsCounter.style.color = '#c9d1d9';
        ptsCounter.textContent = `${rec.recordCount.toLocaleString()} pts`;
      } else {
        ptsCounter.style.color = '#6e7681';
        ptsCounter.textContent = '0 pts';
      }
    }

    // 2. Play / Pause button
    const playBtn = $('btn-play-stream');
    if (playBtn) {
      playBtn.disabled = !isStreamingActive;
      if (streamState.isPlaying) {
        playBtn.classList.add('playing');
        playBtn.innerHTML = '⏸ PAUSE';
      } else {
        playBtn.classList.remove('playing');
        playBtn.innerHTML = '▶ PLAY';
      }
    }

    // Transport buttons state
    const stepBackBtn = $('btn-step-back');
    const stepFwdBtn = $('btn-step-forward');
    const stopBtn = $('btn-stop-stream');
    const loopBtn = $('btn-loop-stream');

    if (stepBackBtn) stepBackBtn.disabled = !isStreamingActive;
    if (stepFwdBtn) stepFwdBtn.disabled = !isStreamingActive;
    if (stopBtn) stopBtn.disabled = !isStreamingActive;
    if (loopBtn) {
      if (streamState.isLooping) {
        loopBtn.classList.add('active-loop');
      } else {
        loopBtn.classList.remove('active-loop');
      }
    }

    // 3. Scrubber slider & time display
    const scrubber = $('stream-scrubber');
    const timeDisp = $('stream-time-display');
    const idxDisp = $('stream-index-display');
    if (scrubber) {
      scrubber.disabled = !isStreamingActive;
      scrubber.max = Math.max(1, (streamState.totalRecords || 1) - 1);
      scrubber.value = streamState.currentIndex || 0;
    }
    if (timeDisp) {
      if (isStreamingActive) {
        timeDisp.textContent = `${formatMs(streamState.playbackElapsedMs)} / ${formatMs(streamState.totalDurationMs)}`;
      } else {
        timeDisp.textContent = '00:00 / 00:00';
      }
    }
    if (idxDisp) {
      idxDisp.textContent = isStreamingActive ? `#${(streamState.currentIndex || 0).toLocaleString()}` : '#0';
    }

    // 4. Cadence box (for datasets without timestamps)
    const cadenceBox = $('stream-cadence-box');
    if (cadenceBox) {
      cadenceBox.style.display = (isStreamingActive && !streamState.hasTimestamps) ? 'flex' : 'none';
    }

    // 5. Playback speed
    const speedSlider = $('stream-speed-slider');
    const speedVal = $('stream-speed-val');
    if (speedSlider) speedSlider.value = streamState.playbackRate || 1.0;
    if (speedVal) speedVal.textContent = `${(streamState.playbackRate || 1.0).toFixed(1)}x`;

    // 6. Channel status cards
    for (let ch = 0; ch < 4; ch++) {
      const feed = streamState.activeChannels && streamState.activeChannels[ch];
      const hasData = feed && feed.active;
      const synthCh = window.synthChannels && window.synthChannels[ch];
      const winSize = synthCh && synthCh.params ? synthCh.params.sampleSize : 40;

      const labelEl = $(`stream-ch-label-${ch}`);
      const valEl = $(`stream-ch-val-${ch}`);
      const winEl = $(`stream-ch-win-${ch}`);
      const clearBtn = $(`stream-ch-clear-${ch}`);

      if (labelEl) {
        labelEl.textContent = hasData ? feed.label : 'Empty';
        labelEl.style.color = hasData ? '#c9d1d9' : '#6e7681';
      }
      if (valEl) {
        if (hasData && feed.currentVal !== null && feed.currentVal !== undefined) {
          valEl.textContent = `${feed.currentVal.toFixed(1)} µS`;
          valEl.style.display = 'inline';
        } else {
          valEl.style.display = 'none';
        }
      }
      if (winEl) winEl.textContent = `W:${winSize}`;
      if (clearBtn) clearBtn.style.display = hasData ? 'inline-block' : 'none';
    }

    updateToolbarIndicator();
  }

  // --- 4. FILE INGESTION & PROCESSING ---
  function processFileText(text, fileName, targetChannelOverride) {
    const ds = window.dataStreamer;
    if (!ds) return;

    try {
      const parsed = ds.parseFileContent(text, fileName);
      parsedPreview = parsed;

      const guesses = parsed.guesses;
      selectedIdCol = guesses.identifierCol || '';
      selectedValueCol = guesses.primaryValueCol || (parsed.columns[0] || '');
      selectedTimeCol = guesses.timestampCol || '';

      if (targetChannelOverride !== undefined) {
        mappingMode = 'single_channel';
        targetSingleChannel = targetChannelOverride;
      } else if (guesses.identifierCol && guesses.sensorList && guesses.sensorList.length >= 2) {
        mappingMode = 'multi_sensor_id';
        sensorToChMap = {};
        guesses.sensorList.slice(0, 4).forEach((s, idx) => {
          sensorToChMap[s] = idx;
        });
      } else if (guesses.detectedValueCols && guesses.detectedValueCols.length >= 2) {
        mappingMode = 'multi_value_cols';
        colToChMap = {};
        guesses.detectedValueCols.slice(0, 4).forEach((c, idx) => {
          colToChMap[c] = idx;
        });
      } else {
        mappingMode = 'single_channel';
        targetSingleChannel = 0;
      }

      hidePortalError();
      renderMappingSection();
      renderChannelsInModal();
    } catch (err) {
      showPortalError(err.message || 'Error parsing file format');
    }
  }

  function handleFileInputChange(file, targetCh) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      processFileText(text, file.name, targetCh);
    };
    reader.onerror = () => showPortalError('Failed to read file from disk');
    reader.readAsText(file);
  }

  // --- 5. TEST DATASETS LOADER ---
  window.loadSampleDataset = async function (sampleId) {
    const sample = SAMPLE_DATASETS.find(s => s.id === sampleId);
    if (!sample) return;

    try {
      hidePortalError();
      const res = await fetch(sample.file);
      if (!res.ok) throw new Error(`Could not load dataset file (${res.status})`);
      const text = await res.text();
      processFileText(text, sample.file.split('/').pop() || 'dataset.csv');
    } catch (err) {
      showPortalError(err.message || 'Error loading sample dataset');
    }
  };

  // --- 6. APPLY MAPPING & START PLAYER ---
  window.applyStreamMapping = function () {
    const ds = window.dataStreamer;
    if (!ds || !parsedPreview) return;

    try {
      ds.applyMappingConfig({
        mode: mappingMode,
        targetChannel: targetSingleChannel,
        sensorToChannelMap: sensorToChMap,
        columnToChannelMap: colToChMap,
        valueCol: selectedValueCol,
        identifierCol: selectedIdCol,
        timestampCol: selectedTimeCol || undefined,
        autoApplyWindow: autoApplyWindow,
        cadenceRps: cadenceRate
      });

      closePortalModal();
      ds.play();
    } catch (err) {
      showPortalError(err.message || 'Error applying mapping');
    }
  };

  // --- 7. SAVED DATA & TAKES HANDLERS ---
  async function renderSavedTakes() {
    const container = $('portal-saved-takes-list');
    const countBadge = $('portal-saved-count-badge');
    const clearAllBtn = $('portal-clear-all-takes-btn');
    if (!container) return;

    if (!window.bioquadStorage) {
      container.innerHTML = '<div style="color: #6e7681; padding: 12px; text-align: center;">IndexedDB storage ready</div>';
      return;
    }

    try {
      const takes = await window.bioquadStorage.getAllTakes();
      if (countBadge) {
        countBadge.textContent = takes.length;
        countBadge.style.display = takes.length > 0 ? 'inline-block' : 'none';
      }
      if (clearAllBtn) {
        clearAllBtn.style.display = takes.length > 0 ? 'inline-flex' : 'none';
      }

      if (takes.length === 0) {
        container.innerHTML = '<div style="color: #6e7681; padding: 16px; text-align: center; font-size: 11px;">No saved data yet. Click REC on the transport bar to record live biodata.</div>';
        return;
      }

      let html = '';
      takes.forEach((take) => {
        const pts = (take.totalPointsRecorded || take.sampleCount || 0).toLocaleString();
        const dur = take.durationFormatted || '00:00.0';
        html += `
          <div style="background: #161b22; border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px;">
            <div>
              <div style="font-weight: 700; font-size: 11px; color: #fff;">${take.name}</div>
              <div style="font-size: 10px; color: #8b949e; display: flex; gap: 8px; margin-top: 2px;">
                <span>${take.date}</span>
                <span style="color: var(--green); font-weight: 700;">⏱ ${dur}</span>
                <span style="color: var(--cyan); font-weight: 700;">${pts} pts</span>
              </div>
            </div>
            <div style="display: flex; gap: 6px; align-items: center;">
              <button class="stream-btn play-btn" onclick="window.playSavedTake('${take.id}')" style="padding: 3px 10px; font-size: 10px;">▶ Play</button>
              <button class="stream-btn" onclick="window.exportTakeCsv('${take.id}')" style="padding: 3px 8px; font-size: 10px;">CSV</button>
              <button class="stream-btn" onclick="window.exportTakeMidi('${take.id}')" style="padding: 3px 8px; font-size: 10px; color: var(--cyan); border-color: rgba(0,240,255,0.4);" title="Export separate MIDI files for each channel">MIDI</button>
              <button class="stream-btn" onclick="window.deleteSavedTake('${take.id}')" style="padding: 3px 6px; font-size: 10px; color: #ff5577; border-color: rgba(255,85,119,0.4);" title="Delete take">✕</button>
            </div>
          </div>
        `;
      });
      container.innerHTML = html;
    } catch (e) {
      console.warn('Error reading saved takes:', e);
    }
  }

  window.playSavedTake = async function (takeId) {
    if (!window.bioquadStorage || !window.dataStreamer) return;
    const takes = await window.bioquadStorage.getAllTakes();
    const take = takes.find(t => t.id === takeId);
    if (take) {
      window.dataStreamer.loadTake(take);
      closePortalModal();
      window.dataStreamer.play();
    }
  };

  window.deleteSavedTake = async function (takeId) {
    if (!window.bioquadStorage) return;
    await window.bioquadStorage.deleteTake(takeId);
    renderSavedTakes();
  };

  window.clearAllSavedTakes = async function () {
    if (!window.bioquadStorage) return;
    if (confirm('Clear all saved biodata recordings?')) {
      await window.bioquadStorage.clearAllTakes();
      renderSavedTakes();
    }
  };

  window.exportTakeCsv = async function (takeId) {
    if (!window.bioquadStorage) return;
    const takes = await window.bioquadStorage.getAllTakes();
    const take = takes.find(t => t.id === takeId);
    if (!take || !Array.isArray(take.records)) return;

    const headers = ['timestamp_iso', 'sensor_id', 'conductance_uS', 'channel', 'raw_ticks', 'note_event', 'velocity'];
    const lines = [headers.join(',')];
    take.records.forEach((r) => {
      lines.push([
        r.timestamp || '',
        r.sensor_id || `CH_${r.channel || 1}_Sensor`,
        r.conductance_uS !== undefined ? r.conductance_uS : (r.value || 50),
        r.channel || 1,
        r.ticks || '',
        r.note || r.note_event || '',
        r.velocity || ''
      ].join(','));
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${take.name || 'bioQuad'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  window.exportTakeMidi = async function (takeId) {
    if (!window.bioquadStorage) return;
    const takes = await window.bioquadStorage.getAllTakes();
    const take = takes.find(t => t.id === takeId);
    if (!take) return;

    const rec = window.biodataRecorder;
    if (!rec || typeof rec.generateMidiBlob !== 'function') return;

    let notesToExport = [...(take.midiNotes || [])];
    if (notesToExport.length === 0 && Array.isArray(take.records)) {
      const firstTime = take.records[0]?.timestamp_ms || 0;
      take.records.forEach((r) => {
        if (r.note && !isNaN(parseInt(r.note))) {
          const ch = Math.max(0, Math.min(3, (r.channel || 1) - 1));
          notesToExport.push({
            timeMs: Math.max(0, (r.timestamp_ms || firstTime) - firstTime),
            channel: ch,
            pitch: parseInt(r.note),
            velocity: r.velocity || 80,
            durationMs: r.duration || 260
          });
        }
      });
    }

    const baseName = take.name || 'bioQuad';
    const activeChannels = [0, 1, 2, 3].filter(ch => notesToExport.some(n => n.channel === ch));

    const triggerDownload = (blob, fname) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    if (activeChannels.length === 0) {
      const blob = rec.generateMidiBlob(notesToExport, null, 'bioQuad');
      if (blob) triggerDownload(blob, `${baseName}.mid`);
      return;
    }

    // Export separate MIDI files per channel (ready for Ableton Live)
    activeChannels.forEach((ch, idx) => {
      setTimeout(() => {
        const blob = rec.generateMidiBlob(notesToExport, ch, `CH ${ch + 1}`);
        if (blob) {
          triggerDownload(blob, `${baseName}_ch${ch + 1}.mid`);
        }
      }, idx * 150);
    });
  };

  // --- 8. MODAL INNER RENDERERS ---
  function renderChannelsInModal() {
    const container = $('portal-channels-grid');
    if (!container) return;

    const ds = window.dataStreamer;
    const streamState = ds ? ds.getState() : null;

    let html = '';
    for (let ch = 0; ch < 4; ch++) {
      const feed = streamState && streamState.activeChannels && streamState.activeChannels[ch];
      const hasData = feed && feed.active;
      const color = CH_COLORS[ch];

      html += `
        <div style="background: #161b22; border: 1px solid var(--border); border-left: 3px solid ${color}; border-radius: 4px; padding: 10px; display: flex; flex-direction: column; justify-content: space-between; gap: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: 700; color: ${color}; font-size: 11px;">Channel ${ch + 1}</span>
            ${hasData ? `<button class="stream-btn" onclick="window.dataStreamer.clearChannel(${ch}); window.updateStreamUI();" style="padding: 1px 5px; font-size: 9px; color: #ff5577;">Clear</button>` : ''}
          </div>
          <div style="font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${hasData ? '#c9d1d9' : '#6e7681'};">
            ${hasData ? feed.label : 'Empty'}
          </div>
          <button class="stream-btn" onclick="document.getElementById('portal-ch-file-input-${ch}').click()" style="width: 100%; justify-content: center; padding: 4px; font-size: 10px;">
            📁 Select File
          </button>
          <input type="file" id="portal-ch-file-input-${ch}" style="display:none;" accept=".csv,.tsv,.tab,.txt,.json,.xml,.dat,.log" onchange="window.handlePortalChFile(this, ${ch})">
        </div>
      `;
    }
    container.innerHTML = html;
  }

  window.handlePortalChFile = function (input, ch) {
    if (input.files && input.files[0]) {
      handleFileInputChange(input.files[0], ch);
    }
  };

  function renderMappingSection() {
    const section = $('portal-mapping-section');
    if (!section || !parsedPreview) {
      if (section) section.style.display = 'none';
      return;
    }

    section.style.display = 'flex';
    $('portal-file-summary').textContent = `${parsedPreview.name} · ${parsedPreview.rows.length.toLocaleString()} rows · ${parsedPreview.columns.length} columns`;
    $('portal-auto-win-label').textContent = `Auto Window (${parsedPreview.recommendedWindow} pts)`;

    // Update Mode Buttons
    ['multi_value_cols', 'multi_sensor_id', 'single_channel'].forEach((m) => {
      const btn = $(`portal-mode-btn-${m}`);
      if (btn) {
        if (mappingMode === m) {
          btn.style.background = 'rgba(0, 240, 255, 0.2)';
          btn.style.borderColor = 'var(--cyan)';
          btn.style.color = 'var(--cyan)';
        } else {
          btn.style.background = '#161b22';
          btn.style.borderColor = 'var(--border)';
          btn.style.color = 'var(--text-muted)';
        }
      }
    });

    // Render Mode Specific Mapping Controls
    const mappingControls = $('portal-mode-controls');
    if (mappingControls) {
      let html = '';
      if (mappingMode === 'multi_value_cols') {
        html += '<div style="font-size: 10px; color: #8b949e; margin-bottom: 4px;">Assign Columns to Channels:</div>';
        html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px;">';
        for (let ch = 0; ch < 4; ch++) {
          const activeCol = Object.keys(colToChMap).find(c => colToChMap[c] === ch) || (parsedPreview.guesses.detectedValueCols && parsedPreview.guesses.detectedValueCols[ch]) || '';
          html += `
            <div style="background: #161b22; padding: 8px; border: 1px solid var(--border); border-radius: 4px;">
              <div style="font-weight: 700; font-size: 10px; margin-bottom: 4px; color: ${CH_COLORS[ch]};">Channel ${ch + 1}:</div>
              <select onchange="window.setColMapping('${ch}', this.value)" style="width: 100%; background: #0d1117; color: #fff; border: 1px solid var(--border); padding: 4px; border-radius: 4px; font-size: 11px;">
                <option value="">-- Ignore --</option>
                ${parsedPreview.columns.map(c => `<option value="${c}" ${c === activeCol ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </div>
          `;
        }
        html += '</div>';
      } else if (mappingMode === 'multi_sensor_id') {
        const sensors = parsedPreview.guesses.sensorList || [];
        html += '<div style="font-size: 10px; color: #8b949e; margin-bottom: 4px;">Map Series / Sensor IDs to Channels:</div>';
        if (sensors.length >= 1) {
          html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px;">';
          sensors.slice(0, 4).forEach((s, idx) => {
            const chTarget = sensorToChMap[s] !== undefined ? sensorToChMap[s] : idx;
            html += `
              <div style="background: #161b22; padding: 8px; border: 1px solid var(--border); border-radius: 4px;">
                <div style="font-weight: 700; font-size: 10px; margin-bottom: 4px; color: #fff; overflow:hidden; text-overflow:ellipsis;">${s}</div>
                <select onchange="window.setSensorMapping('${s}', this.value)" style="width: 100%; background: #0d1117; color: ${CH_COLORS[chTarget]}; border: 1px solid var(--border); padding: 4px; border-radius: 4px; font-size: 11px; font-weight: 700;">
                  <option value="0" ${chTarget === 0 ? 'selected' : ''}>Channel 1</option>
                  <option value="1" ${chTarget === 1 ? 'selected' : ''}>Channel 2</option>
                  <option value="2" ${chTarget === 2 ? 'selected' : ''}>Channel 3</option>
                  <option value="3" ${chTarget === 3 ? 'selected' : ''}>Channel 4</option>
                </select>
              </div>
            `;
          });
          html += '</div>';
        } else {
          html += '<div style="font-size: 11px; color: #6e7681; font-style: italic;">No discrete series detected. Select Series ID column below.</div>';
        }
      } else if (mappingMode === 'single_channel') {
        html += '<div style="display: flex; align-items: center; gap: 8px;">';
        html += '<span style="font-size: 11px; color: #8b949e;">Target:</span>';
        for (let ch = 0; ch < 4; ch++) {
          const active = targetSingleChannel === ch;
          html += `
            <button class="stream-btn" onclick="window.setTargetSingleCh(${ch})" style="color: ${CH_COLORS[ch]}; border-color: ${active ? 'var(--cyan)' : 'var(--border)'}; background: ${active ? '#000' : '#161b22'};">
              Channel ${ch + 1}
            </button>
          `;
        }
        html += '</div>';
      }
      mappingControls.innerHTML = html;
    }

    // Populate Column Selectors
    const idColWrap = $('portal-id-col-wrap');
    const idColSelect = $('portal-id-col-select');
    if (idColWrap && idColSelect) {
      idColWrap.style.display = mappingMode === 'multi_sensor_id' ? 'block' : 'none';
      idColSelect.innerHTML = '<option value="">None (Single Stream)</option>' +
        parsedPreview.columns.map(c => `<option value="${c}" ${c === selectedIdCol ? 'selected' : ''}>${c}</option>`).join('');
    }

    const valColWrap = $('portal-val-col-wrap');
    const valColSelect = $('portal-val-col-select');
    if (valColWrap && valColSelect) {
      valColWrap.style.display = mappingMode !== 'multi_value_cols' ? 'block' : 'none';
      valColSelect.innerHTML = parsedPreview.columns.map(c => `<option value="${c}" ${c === selectedValueCol ? 'selected' : ''}>${c}</option>`).join('');
    }

    const timeColSelect = $('portal-time-col-select');
    if (timeColSelect) {
      timeColSelect.innerHTML = '<option value="">Fixed Cadence Rate</option>' +
        parsedPreview.columns.map(c => `<option value="${c}" ${c === selectedTimeCol ? 'selected' : ''}>${c}</option>`).join('');
    }

    const cadenceRateWrap = $('portal-cadence-rate-wrap');
    if (cadenceRateWrap) {
      cadenceRateWrap.style.display = !selectedTimeCol ? 'block' : 'none';
    }

    // Render Preview Table
    const tableHeader = $('portal-table-head');
    const tableBody = $('portal-table-body');
    if (tableHeader && tableBody) {
      tableHeader.innerHTML = parsedPreview.columns.map(c => `<th>${c}</th>`).join('');
      let tbodyHtml = '';
      parsedPreview.sampleRows.slice(0, 5).forEach((row) => {
        tbodyHtml += '<tr>' + parsedPreview.columns.map(c => `<td>${row[c] !== null && row[c] !== undefined ? row[c] : '-'}</td>`).join('') + '</tr>';
      });
      tableBody.innerHTML = tbodyHtml;
    }
  }

  window.setMappingMode = function (m) {
    mappingMode = m;
    renderMappingSection();
  };

  window.setTargetSingleCh = function (ch) {
    targetSingleChannel = ch;
    renderMappingSection();
  };

  window.setColMapping = function (chStr, col) {
    const ch = parseInt(chStr);
    Object.keys(colToChMap).forEach(k => {
      if (colToChMap[k] === ch) delete colToChMap[k];
    });
    if (col) colToChMap[col] = ch;
  };

  window.setSensorMapping = function (sensor, chStr) {
    sensorToChMap[sensor] = parseInt(chStr);
    renderMappingSection();
  };

  function showPortalError(msg) {
    const alert = $('portal-error-alert');
    if (alert) {
      alert.style.display = 'flex';
      $('portal-error-text').textContent = msg;
    }
  }

  function hidePortalError() {
    const alert = $('portal-error-alert');
    if (alert) alert.style.display = 'none';
  }

  window.hidePortalError = hidePortalError;

  // --- 9. EVENT LISTENERS & SETUP ---
  document.addEventListener('DOMContentLoaded', () => {
    updateDeckVisibility();

    // Hook up transport clicks
    const recBtn = $('btn-rec-stream');
    if (recBtn) {
      recBtn.addEventListener('click', () => {
        const rec = window.biodataRecorder;
        if (!rec) return;
        if (rec.isRecording) rec.stop();
        else rec.start();
      });
    }

    const playBtn = $('btn-play-stream');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        const ds = window.dataStreamer;
        if (!ds) return;
        if (ds.isPlaying) ds.pause();
        else ds.play();
      });
    }

    const stepBackBtn = $('btn-step-back');
    if (stepBackBtn) stepBackBtn.addEventListener('click', () => window.dataStreamer?.step(false));

    const stepFwdBtn = $('btn-step-forward');
    if (stepFwdBtn) stepFwdBtn.addEventListener('click', () => window.dataStreamer?.step(true));

    const stopBtn = $('btn-stop-stream');
    if (stopBtn) stopBtn.addEventListener('click', () => window.dataStreamer?.stop());

    const loopBtn = $('btn-loop-stream');
    if (loopBtn) loopBtn.addEventListener('click', () => window.dataStreamer?.toggleLoop());

    const scrubber = $('stream-scrubber');
    if (scrubber) {
      scrubber.addEventListener('input', (e) => {
        window.dataStreamer?.seek(parseInt(e.target.value));
      });
    }

    const speedSlider = $('stream-speed-slider');
    if (speedSlider) {
      speedSlider.addEventListener('input', (e) => {
        window.dataStreamer?.setPlaybackRate(parseFloat(e.target.value));
      });
    }

    const cadenceInput = $('stream-cadence-val');
    if (cadenceInput) {
      cadenceInput.addEventListener('change', (e) => {
        window.dataStreamer?.setCadenceRps(parseInt(e.target.value) || 30);
      });
    }

    const loadBtn = $('btn-open-portal');
    if (loadBtn) loadBtn.addEventListener('click', openPortalModal);

    // Channel clear handlers
    for (let ch = 0; ch < 4; ch++) {
      const clearBtn = $(`stream-ch-clear-${ch}`);
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          window.dataStreamer?.clearChannel(ch);
          updateTransportDeck();
        });
      }
    }

    // Dropzone setup
    const dropzone = $('portal-dropzone');
    const fileInput = $('portal-file-input');
    if (dropzone && fileInput) {
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleFileInputChange(e.dataTransfer.files[0]);
        }
      });
      dropzone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          handleFileInputChange(e.target.files[0]);
        }
      });
    }

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      const ds = window.dataStreamer;

      if (e.code === 'Space') {
        e.preventDefault();
        if (ds) {
          if (ds.isPlaying) ds.pause();
          else ds.play();
        }
      } else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
        ds?.rewind();
      } else if (e.code === 'ArrowRight') {
        ds?.step(true);
      } else if (e.code === 'ArrowLeft') {
        ds?.step(false);
      } else if (e.code === 'Escape' && isPortalModalOpen) {
        closePortalModal();
      }
    });

    // Subscriptions & Loop
    window.addEventListener('bioquad_stream_update', updateTransportDeck);
    window.addEventListener('bioquad_recorder_update', updateTransportDeck);
    window.addEventListener('bioquad_takes_updated', renderSavedTakes);

    setInterval(updateTransportDeck, 80);
    renderSavedTakes();
  });

  window.updateStreamUI = updateTransportDeck;
})();
