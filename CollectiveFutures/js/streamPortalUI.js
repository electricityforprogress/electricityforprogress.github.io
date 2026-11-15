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
  let isExportModalOpen = false;
  let currentExportObjectUrl = null;
  let currentExportBlob = null;
  let currentExportFile = null;
  let currentExportFilename = '';
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

  function formatBytes(bytes) {
    if (!bytes || bytes < 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function isIOSorBlueify() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isBluefy = /Bluefy|WebBLE/i.test(ua);
    return isIOS || isBluefy;
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

  function revokeExportResources() {
    if (currentExportObjectUrl) {
      try { URL.revokeObjectURL(currentExportObjectUrl); } catch (e) {}
      currentExportObjectUrl = null;
    }
    currentExportBlob = null;
    currentExportFile = null;
    currentExportFilename = '';
    const dlLink = $('btn-export-download');
    if (dlLink) {
      dlLink.removeAttribute('href');
      dlLink.style.display = 'none';
    }
  }

  function setExportStatus(kind, badgeText, statusText) {
    const badge = $('export-status-badge');
    const textEl = $('export-status-text');
    if (badge) {
      badge.className = `export-status-badge is-${kind}`;
      badge.textContent = badgeText;
    }
    if (textEl) {
      textEl.textContent = statusText;
    }
  }

  function openExportModal(initialName, formatLabel) {
    revokeExportResources();
    isExportModalOpen = true;
    const modal = $('export-file-modal');
    if (modal) modal.style.display = 'flex';

    if ($('export-meta-filename')) $('export-meta-filename').textContent = initialName || '--';
    if ($('export-meta-format')) $('export-meta-format').textContent = formatLabel || '--';
    if ($('export-meta-count')) $('export-meta-count').textContent = '...';
    if ($('export-meta-size')) $('export-meta-size').textContent = '...';

    const shareBtn = $('btn-export-share');
    const dlLink = $('btn-export-download');
    const copyBtn = $('btn-export-copy');
    const feedback = $('export-feedback-text');
    const iosHint = $('export-ios-hint');

    if (shareBtn) { shareBtn.style.display = 'none'; shareBtn.disabled = true; }
    if (dlLink) { dlLink.style.display = 'none'; }
    if (copyBtn) { copyBtn.style.display = 'none'; }
    if (feedback) { feedback.style.display = 'none'; feedback.textContent = ''; }
    if (iosHint) { iosHint.style.display = isIOSorBlueify() ? 'block' : 'none'; }

    setExportStatus('working', 'PREPARING', 'Reading chunks from storage...');
  }

  window.closeExportModal = function () {
    isExportModalOpen = false;
    const modal = $('export-file-modal');
    if (modal) modal.style.display = 'none';
    revokeExportResources();
  };

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

    // Loop & Auto toggle state
    const loopBtn = $('btn-loop-stream');
    if (loopBtn) {
      if (streamState.isLooping) {
        loopBtn.classList.add('active-loop');
      } else {
        loopBtn.classList.remove('active-loop');
      }
    }

    const autoBtn = $('btn-auto-stream');
    if (autoBtn) {
      const hasAuto = !!streamState.hasAutomation;
      autoBtn.disabled = !hasAuto;
      autoBtn.classList.toggle('active-auto', hasAuto && !!streamState.followAutomation);
      autoBtn.setAttribute('aria-pressed', (hasAuto && !!streamState.followAutomation) ? 'true' : 'false');
      autoBtn.title = !hasAuto
        ? 'No parameter automation in loaded file'
        : (streamState.followAutomation
          ? 'Following recorded synth automation (click for manual control)'
          : 'Manual control active (click to follow recorded automation)');
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
    const speedVal = $('stream-speed-val');
    if (speedVal) speedVal.textContent = `${(streamState.playbackRate || 1.0).toFixed(1)}x`;

    // 6. Channel status cards
    for (let ch = 0; ch < 4; ch++) {
      const feed = streamState.activeChannels && streamState.activeChannels[ch];
      const hasData = feed && feed.active;

      const labelEl = $(`stream-ch-label-${ch}`);
      const valEl = $(`stream-ch-val-${ch}`);
      const clearBtn = $(`stream-ch-clear-${ch}`);

      if (labelEl) {
        labelEl.textContent = hasData ? feed.label : 'Empty';
        labelEl.style.color = hasData ? '#c9d1d9' : '#6e7681';
      }
      if (valEl) {
        if (hasData && feed.currentVal !== null && feed.currentVal !== undefined) {
          valEl.textContent = `${feed.currentVal.toFixed(1)}`;
          valEl.style.display = 'inline';
        } else {
          valEl.style.display = 'none';
        }
      }
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
        const storedPts = take.storedRecordCount !== undefined ? take.storedRecordCount : (take.sampleCount || 0);
        const totalPts = take.totalPointsRecorded || storedPts;
        const isLegacyCapped = take.schemaVersion !== 2 && storedPts > 0 && totalPts > storedPts;
        const ptsText = isLegacyCapped
          ? `${storedPts.toLocaleString()} / ${totalPts.toLocaleString()} pts (legacy cap)`
          : `${totalPts.toLocaleString()} pts`;
        const dur = take.durationFormatted || '00:00.0';
        html += `
          <div class="saved-take-card">
            <div>
              <div style="font-weight: 700; font-size: 11px; color: #fff;">${take.name}</div>
              <div class="tabular-nums" style="font-size: 10px; color: #8b949e; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px;">
                <span>${take.date}</span>
                <span style="color: var(--green); font-weight: 700;">⏱ ${dur}</span>
                <span style="color: var(--cyan); font-weight: 700;">${ptsText}</span>
                ${take.hasAutomation ? `<span style="color: var(--yellow); font-weight: 700;">· + Automation</span>` : ''}
              </div>
            </div>
            <div class="saved-take-actions">
              <button class="stream-btn play-btn" onclick="window.playSavedTake('${take.id}')">▶ Play</button>
              <button class="stream-btn" onclick="window.exportTakeCsv('${take.id}')">CSV</button>
              <button class="stream-btn" onclick="window.exportTakeMidi('${take.id}')" style="color: var(--cyan); border-color: rgba(0,240,255,0.4);" title="Export all channels as a single MIDI ZIP bundle">MIDI</button>
              <button class="stream-btn" onclick="window.deleteSavedTake('${take.id}')" style="color: #ff5577; border-color: rgba(255,85,119,0.4); min-width: 40px;" title="Delete take">✕</button>
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
    try {
      hidePortalError();
      await window.dataStreamer.loadTakeById(takeId);
      closePortalModal();
      window.dataStreamer.play();
    } catch (err) {
      showPortalError(err.message || 'Could not load saved recording');
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

  function finalizePreparedExport({ blob, filename, formatLabel, contentsText, allowClipboard }) {
    currentExportBlob = blob;
    currentExportFilename = filename;
    currentExportObjectUrl = URL.createObjectURL(blob);

    if (typeof File !== 'undefined') {
      try {
        currentExportFile = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      } catch (e) {
        currentExportFile = null;
      }
    } else {
      currentExportFile = null;
    }

    if ($('export-meta-filename')) $('export-meta-filename').textContent = filename;
    if ($('export-meta-format')) $('export-meta-format').textContent = formatLabel;
    if ($('export-meta-count')) $('export-meta-count').textContent = contentsText;
    if ($('export-meta-size')) $('export-meta-size').textContent = formatBytes(blob.size);

    const shareBtn = $('btn-export-share');
    let canUseShareSheet = false;
    if (shareBtn && currentExportFile && typeof navigator.share === 'function') {
      if (typeof navigator.canShare === 'function') {
        try {
          canUseShareSheet = navigator.canShare({ files: [currentExportFile] });
        } catch (e) {
          canUseShareSheet = false;
        }
      } else {
        canUseShareSheet = true;
      }
    }

    if (shareBtn) {
      shareBtn.style.display = canUseShareSheet ? 'inline-flex' : 'none';
      shareBtn.disabled = !canUseShareSheet;
    }

    const dlLink = $('btn-export-download');
    if (dlLink) {
      dlLink.href = currentExportObjectUrl;
      dlLink.download = filename;
      dlLink.style.display = 'inline-flex';
    }

    const copyBtn = $('btn-export-copy');
    if (copyBtn) {
      const canCopy = allowClipboard && blob.size <= 2 * 1024 * 1024 && navigator.clipboard && typeof navigator.clipboard.writeText === 'function';
      copyBtn.style.display = canCopy ? 'inline-flex' : 'none';
    }

    setExportStatus('ready', 'READY', isIOSorBlueify()
      ? 'File is ready. Tap Share / Save to Files to save on iPad.'
      : 'File is ready. Download started or use actions below.');

    // Auto-trigger standard anchor download on desktop browsers (iOS/Blueify uses Share Sheet / link tap)
    if (!isIOSorBlueify()) {
      const autoA = document.createElement('a');
      autoA.href = currentExportObjectUrl;
      autoA.download = filename;
      autoA.style.display = 'none';
      document.body.appendChild(autoA);
      autoA.click();
      autoA.remove();
    }
  }

  window.exportTakeCsv = async function (takeId) {
    if (!window.bioquadStorage) return;
    openExportModal('preparing.csv', 'CSV (Biodata Stream)');

    try {
      const res = await window.bioquadStorage.exportTakeCsvBlob(takeId, (chunkIdx, totalChunks, count) => {
        setExportStatus('working', 'PREPARING', `Packaging chunk ${chunkIdx} / ${totalChunks} (${count.toLocaleString()} pts)...`);
      });

      if (!res || (res.recordCount === 0 && (res.automationCount || 0) === 0)) {
        setExportStatus('error', 'EMPTY', 'This recording has no biodata points to export.');
        return;
      }

      const autoCount = res.automationCount || 0;
      const contentsSummary = autoCount > 0
        ? `${res.recordCount.toLocaleString()} records · ${autoCount.toLocaleString()} automation`
        : `${res.recordCount.toLocaleString()} records`;

      finalizePreparedExport({
        blob: res.blob,
        filename: res.filename,
        formatLabel: 'CSV (text/csv)',
        contentsText: contentsSummary,
        allowClipboard: true
      });
    } catch (err) {
      setExportStatus('error', 'FAILED', err.message || 'Could not package CSV recording.');
    }
  };

  window.exportTakeMidi = async function (takeId) {
    if (!window.bioquadStorage) return;
    openExportModal('preparing_midi.zip', 'ZIP Archive (.mid per channel)');

    try {
      const res = await window.bioquadStorage.exportTakeMidiZipBlob(takeId, (chunkIdx, totalChunks, count) => {
        setExportStatus('working', 'PREPARING', `Scanning chunk ${chunkIdx} / ${totalChunks} (${count.toLocaleString()} pts)...`);
      });

      finalizePreparedExport({
        blob: res.blob,
        filename: res.filename,
        formatLabel: `MIDI ZIP (${res.channelList.join(', ')})`,
        contentsText: `${res.noteCount.toLocaleString()} notes · ${res.fileCount} .mid file${res.fileCount === 1 ? '' : 's'}`,
        allowClipboard: false
      });
    } catch (err) {
      setExportStatus('error', 'NO MIDI', err.message || 'Could not build MIDI archive.');
    }
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
    const parsedAutoCount = parsedPreview.automationRows ? parsedPreview.automationRows.length : 0;
    const autoText = parsedAutoCount > 0 ? ` · ${parsedAutoCount.toLocaleString()} automation events` : '';
    $('portal-file-summary').textContent = `${parsedPreview.name} · ${parsedPreview.rows.length.toLocaleString()} rows · ${parsedPreview.columns.length} columns${autoText}`;
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

    const loopBtn = $('btn-loop-stream');
    if (loopBtn) loopBtn.addEventListener('click', () => window.dataStreamer?.toggleLoop());

    const autoBtn = $('btn-auto-stream');
    if (autoBtn) autoBtn.addEventListener('click', () => window.dataStreamer?.toggleFollowAutomation());

    const scrubber = $('stream-scrubber');
    if (scrubber) {
      scrubber.addEventListener('input', (e) => {
        window.dataStreamer?.seek(parseInt(e.target.value));
      });
    }

    const speedBox = $('stream-speed-box') || $('stream-speed-val');
    if (speedBox) {
      let isDraggingSpeed = false;
      let speedStartY = 0;
      let speedStartRate = 1.0;

      speedBox.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
        const ds = window.dataStreamer;
        if (!ds) return;
        isDraggingSpeed = true;
        speedStartY = e.clientY;
        speedStartRate = ds.playbackRate || 1.0;
        speedBox.classList.add('is-dragging');
        if (speedBox.setPointerCapture) {
          try { speedBox.setPointerCapture(e.pointerId); } catch (err) {}
        }
        e.preventDefault();
      });

      speedBox.addEventListener('pointermove', (e) => {
        if (!isDraggingSpeed) return;
        const ds = window.dataStreamer;
        if (!ds) return;
        const deltaY = speedStartY - e.clientY;
        const nextRate = Math.max(0.1, Math.min(5.0, Math.round((speedStartRate + deltaY * 0.02) * 10) / 10));
        ds.setPlaybackRate(nextRate);
      });

      const stopSpeedDrag = (e) => {
        if (!isDraggingSpeed) return;
        isDraggingSpeed = false;
        speedBox.classList.remove('is-dragging');
        if (speedBox.releasePointerCapture && e.pointerId !== undefined) {
          try { speedBox.releasePointerCapture(e.pointerId); } catch (err) {}
        }
      };

      speedBox.addEventListener('pointerup', stopSpeedDrag);
      speedBox.addEventListener('pointercancel', stopSpeedDrag);
      speedBox.addEventListener('dblclick', (e) => {
        e.preventDefault();
        window.dataStreamer?.setPlaybackRate(1.0);
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

    // Mapping controls listeners
    const autoWinChk = $('portal-auto-win-chk');
    if (autoWinChk) {
      autoWinChk.addEventListener('change', (e) => {
        autoApplyWindow = !!e.target.checked;
      });
    }

    const idColSelect = $('portal-id-col-select');
    if (idColSelect) {
      idColSelect.addEventListener('change', (e) => {
        selectedIdCol = e.target.value;
        if (parsedPreview && parsedPreview.rows) {
          const unique = new Set();
          const scanLimit = Math.min(2000, parsedPreview.rows.length);
          for (let r = 0; r < scanLimit; r++) {
            const v = parsedPreview.rows[r][selectedIdCol];
            if (v !== null && v !== undefined && v !== '') unique.add(String(v));
          }
          parsedPreview.guesses.sensorList = Array.from(unique);
          sensorToChMap = {};
          parsedPreview.guesses.sensorList.slice(0, 4).forEach((s, idx) => {
            sensorToChMap[s] = idx;
          });
        }
        renderMappingSection();
      });
    }

    const valColSelect = $('portal-val-col-select');
    if (valColSelect) {
      valColSelect.addEventListener('change', (e) => {
        selectedValueCol = e.target.value;
      });
    }

    const timeColSelect = $('portal-time-col-select');
    if (timeColSelect) {
      timeColSelect.addEventListener('change', (e) => {
        selectedTimeCol = e.target.value;
        const cadenceRateWrap = $('portal-cadence-rate-wrap');
        if (cadenceRateWrap) {
          cadenceRateWrap.style.display = !selectedTimeCol ? 'block' : 'none';
        }
      });
    }

    const portalCadenceInput = $('portal-cadence-rate-val');
    if (portalCadenceInput) {
      portalCadenceInput.addEventListener('change', (e) => {
        cadenceRate = Math.max(1, Math.min(500, parseInt(e.target.value) || 30));
      });
    }

    // Export Modal handlers (synchronous Share Sheet trigger for iOS / Blueify)
    const exportShareBtn = $('btn-export-share');
    if (exportShareBtn) {
      exportShareBtn.addEventListener('click', () => {
        if (!currentExportFile || typeof navigator.share !== 'function') return;
        const feedback = $('export-feedback-text');
        if (feedback) {
          feedback.style.display = 'block';
          feedback.textContent = 'Opening Share Sheet...';
        }
        try {
          const sharePromise = navigator.share({
            files: [currentExportFile],
            title: currentExportFilename
          });
          if (sharePromise && typeof sharePromise.then === 'function') {
            sharePromise.then(() => {
              if (feedback) feedback.textContent = 'Shared or saved via iOS Share Sheet.';
            }).catch((err) => {
              if (!feedback) return;
              if (err && err.name === 'AbortError') {
                feedback.textContent = 'Share dismissed. Tap Share again or use Download File below.';
              } else {
                feedback.textContent = 'Share unavailable here. Tap Download File below instead.';
              }
            });
          }
        } catch (err) {
          if (feedback) {
            feedback.style.display = 'block';
            feedback.textContent = 'Share unavailable here. Tap Download File below instead.';
          }
        }
      });
    }

    const exportCopyBtn = $('btn-export-copy');
    if (exportCopyBtn) {
      exportCopyBtn.addEventListener('click', async () => {
        if (!currentExportBlob) return;
        const feedback = $('export-feedback-text');
        try {
          const txt = await currentExportBlob.text();
          await navigator.clipboard.writeText(txt);
          if (feedback) {
            feedback.style.display = 'block';
            feedback.textContent = 'CSV copied to clipboard.';
          }
        } catch (err) {
          if (feedback) {
            feedback.style.display = 'block';
            feedback.textContent = 'Clipboard copy blocked. Use Share / Save to Files instead.';
          }
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
      } else if (e.code === 'Escape') {
        if (isExportModalOpen) window.closeExportModal();
        else if (isPortalModalOpen) closePortalModal();
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
