/**
 * bioQuad Stream - Pure Vanilla Data Stream, Saved Sessions & Cloud Feeds UI Controller
 * Runs directly in the browser without React, Tailwind, or external runtime libraries.
 * Designed for real-time performance & static GitHub Pages deployment.
 */

(function () {
  'use strict';

  const SAMPLE_DATASETS = [
    { id: 'nasa', name: 'NASA ISS Telemetry', file: './datasets/nasa_telemetry_iss.csv' },
    { id: 'ekg', name: 'Cardiac GSR', file: './datasets/ekg_heart_biometrics.csv' },
    { id: 'crypto', name: 'Crypto Tick HFT', file: './datasets/market_crypto_hft.csv' },
    { id: 'forest', name: 'Deep Forest Mycelium', file: './datasets/deep_forest_mycelium.csv' }
  ];

  const CH_COLORS = ['#ff3333', '#39ff14', '#33ccff', '#b84dff'];

  let isBoxVisible = localStorage.getItem('bioquad_file_deck_open') === 'true';
  let isPortalModalOpen = false;
  let isFeedsModalOpen = false;
  let isExportModalOpen = false;
  let currentExportObjectUrl = null;
  let currentExportBlob = null;
  let currentExportFile = null;
  let currentExportFilename = '';
  let parsedPreview = null;
  let mappingMode = 'multi_sensor_id';
  let targetSingleChannel = 0;
  let activeImportSourceCh = null;
  let sensorToChMap = {};
  let colToChMap = {};
  let selectedIdCol = '';
  let selectedValueCol = '';
  let selectedTimeCol = '';
  let autoApplyWindow = true;
  let cadenceRate = 30;

  // Saved Data Manager UI state
  let savedTakesSearch = '';
  let savedTakesSort = 'newest';
  let editingTakeId = null;
  let clearAllTakesArmed = false;
  let clearAllTakesTimer = null;
  let sessionSavedFeedbackTimer = null;
  let showSimFeeds = false;
  let showIdleStreams = false;
  let streamSearchQuery = '';

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  // --- 1. COMPACT RECORD BAR + EXPANDABLE FILE MANAGER DETAILS ---
  function setFileWorkspaceOpen(shouldOpen, expandDetails) {
    isBoxVisible = Boolean(shouldOpen);
    if (!isBoxVisible) {
      isPortalModalOpen = false;
      editingTakeId = null;
    } else if (expandDetails !== undefined) {
      isPortalModalOpen = Boolean(expandDetails);
    }
    try { localStorage.setItem('bioquad_file_deck_open', String(isBoxVisible)); } catch (e) {}
    updateDeckVisibility();
  }

  window.toggleDataPortalUI = function () {
    setFileWorkspaceOpen(!isBoxVisible, false);
  };

  window.openDataPortal = function () {
    setFileWorkspaceOpen(true);
  };

  window.closeDataPortalUI = function () {
    setFileWorkspaceOpen(false, false);
  };

  window.openFileDetailsPanel = function () {
    isBoxVisible = true;
    isPortalModalOpen = true;
    try { localStorage.setItem('bioquad_file_deck_open', 'true'); } catch (e) {}
    updateDeckVisibility();
  };

  window.closeFileDetailsPanel = function () {
    isPortalModalOpen = false;
    editingTakeId = null;
    updateDeckVisibility();
  };

  window.toggleFileDetailsPanel = function () {
    if (!isBoxVisible) {
      window.openFileDetailsPanel();
    } else {
      isPortalModalOpen = !isPortalModalOpen;
      if (!isPortalModalOpen) editingTakeId = null;
      updateDeckVisibility();
    }
  };

  function updateDeckVisibility() {
    const deck = $('stream-transport-deck');
    const modal = $('file-portal-modal');
    const toggleBtn = $('toggle-portal-btn');
    const expandBtn = $('btn-expand-file-manager');

    if (deck) {
      deck.classList.toggle('ui-hidden', !isBoxVisible);
      deck.style.display = isBoxVisible ? 'flex' : 'none';
    }
    const showDetails = isBoxVisible && isPortalModalOpen;
    if (modal) {
      modal.classList.toggle('ui-hidden', !showDetails);
      modal.style.display = showDetails ? 'flex' : 'none';
      if (showDetails) {
        renderChannelsInModal();
        renderSavedTakes();
        renderMappingSection();
      }
    }
    if (expandBtn) {
      expandBtn.classList.toggle('is-active', showDetails);
      expandBtn.setAttribute('aria-expanded', showDetails ? 'true' : 'false');
      expandBtn.textContent = showDetails ? 'FILES ▴' : 'FILES ▾';
    }
    if (toggleBtn) {
      toggleBtn.classList.toggle('is-active', isBoxVisible);
      toggleBtn.style.opacity = '';
      toggleBtn.style.borderColor = '';
    }
  }

  function updateToolbarIndicator() {
    const ind = $('file-portal-indicator');
    if (ind) {
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

    // Sync Cloud Feeds Toolbar Pill & Channel Feed Badges (zero-allocation O(1) reads)
    const feedsMgr = window.bioquadFeeds;
    if (feedsMgr) {
      const activeRouteCount = typeof feedsMgr.getActiveRouteCount === 'function'
        ? feedsMgr.getActiveRouteCount()
        : (feedsMgr.channelRoutes ? feedsMgr.channelRoutes.filter(Boolean).length : 0);
      const routes = feedsMgr.channelRoutes || [];
      const fDot = $('feeds-toolbar-dot');
      const fLbl = $('feeds-toolbar-label');
      if (fDot) {
        const live = activeRouteCount > 0 || feedsMgr.isConnected || feedsMgr.isPublishing;
        const nextCls = live ? 'status-online' : 'status-offline';
        if (fDot.className !== nextCls) fDot.className = nextCls;
      }
      if (fLbl) {
        const nextLbl = activeRouteCount > 0 ? `STREAM (${activeRouteCount})` : 'STREAM';
        if (fLbl.textContent !== nextLbl) fLbl.textContent = nextLbl;
      }

      for (let ch = 0; ch < 4; ch++) {
        const badge = $(`ch-feed-badge-${ch}`);
        const route = routes[ch];
        if (badge) {
          if (route && route.feedId) {
            const meta = typeof feedsMgr.getFeedById === 'function'
              ? feedsMgr.getFeedById(route.feedId)
              : (feedsMgr.feeds ? feedsMgr.feeds.get(route.feedId) : null);
            const shortName = meta ? meta.name : route.feedId;
            const streamNum = (route.remoteCh || 0) + 1;
            const modeTag = route.followPatch === false ? 'CUSTOM' : 'AUTO';
            const nextBadge = `${shortName} · S${streamNum} · ${modeTag}`;
            if (badge.textContent !== nextBadge) badge.textContent = nextBadge;
            if (badge.style.display !== 'inline-flex') badge.style.display = 'inline-flex';
          } else if (badge.style.display !== 'none') {
            badge.style.display = 'none';
          }
        }
      }
      updateSynthFeedAutoBar();
    }
  }

  function updateSynthFeedAutoBar(fStateOverride = null) {
    const bar = $('synth-feed-auto-bar');
    const feedsMgr = window.bioquadFeeds;
    if (!bar || !feedsMgr) return;
    const activeCh = typeof window.activeSynthIndex === 'number' ? window.activeSynthIndex : 0;
    const routes = fStateOverride ? fStateOverride.channelRoutes : (feedsMgr.channelRoutes || []);
    const route = routes[activeCh];

    if (!route || !route.feedId) {
      if (bar.style.display !== 'none') bar.style.display = 'none';
      return;
    }

    const feed = fStateOverride
      ? fStateOverride.feeds.find(f => f.feedId === route.feedId)
      : (typeof feedsMgr.getFeedById === 'function' ? feedsMgr.getFeedById(route.feedId) : null);
    const feedName = feed ? (feed.name || feed.feedId) : route.feedId;
    const streamNum = (route.remoteCh || 0) + 1;
    const isAuto = route.followPatch !== false;
    const patchObj = feed && Array.isArray(feed.patches) ? feed.patches[route.remoteCh || 0] : null;
    const patchSummary = (patchObj && window.BioQuadCore && window.BioQuadCore.summarizePatch)
      ? window.BioQuadCore.summarizePatch(patchObj)
      : (patchObj && patchObj.patchName ? patchObj.patchName : '');

    if (bar.style.display !== 'flex') bar.style.display = 'flex';
    const srcEl = $('synth-feed-source-label');
    const nextSrcText = `CH ${activeCh + 1} ← ${feedName} · S${streamNum}`;
    if (srcEl && srcEl.textContent !== nextSrcText) srcEl.textContent = nextSrcText;

    const patchEl = $('synth-feed-patch-label');
    const nextPatchText = patchSummary ? `(${patchSummary})` : '';
    if (patchEl && patchEl.textContent !== nextPatchText) {
      patchEl.textContent = nextPatchText;
    }

    const btn = $('btn-synth-feed-auto');
    if (btn) {
      const nextBtnText = isAuto ? 'AUTO' : 'CUSTOM';
      if (btn.textContent !== nextBtnText) {
        btn.textContent = nextBtnText;
        btn.setAttribute('aria-pressed', isAuto ? 'true' : 'false');
        btn.style.borderColor = isAuto ? 'var(--green)' : 'var(--yellow)';
        btn.style.color = isAuto ? 'var(--green)' : 'var(--yellow)';
        btn.style.background = isAuto ? 'rgba(57,255,20,0.12)' : 'rgba(255,215,0,0.12)';
      }
    }
  }

  window.updateSynthFeedAutoBar = updateSynthFeedAutoBar;

  window.toggleActiveSynthFeedAuto = function () {
    if (!window.bioquadFeeds) return;
    const activeCh = typeof window.activeSynthIndex === 'number' ? window.activeSynthIndex : 0;
    window.bioquadFeeds.toggleRouteFollowPatch(activeCh);
    updateSynthFeedAutoBar();
    if (isFeedsModalOpen) renderFeedsModal(false);
  };

  window.toggleFeedPatchFollow = function (localCh) {
    if (!window.bioquadFeeds) return;
    window.bioquadFeeds.toggleRouteFollowPatch(localCh);
    updateSynthFeedAutoBar();
    if (isFeedsModalOpen) renderFeedsModal(false);
    updateToolbarIndicator();
  };

  // --- 2. INLINE WORKSPACE CARD CONTROLS (FILE & STREAM) ---
  function openPortalModal() {
    window.openFileDetailsPanel();
  }

  function closePortalModal() {
    window.closeFileDetailsPanel();
  }

  window.openPortalModal = openPortalModal;
  window.closePortalModal = closePortalModal;
  window.togglePortalModal = function () {
    window.toggleFileDetailsPanel();
  };

  window.openFeedsModal = function () {
    isFeedsModalOpen = true;
    const modal = $('feeds-portal-modal');
    const feedsBtn = $('btn-open-feeds');
    if (feedsBtn) feedsBtn.classList.add('is-active');
    if (modal) {
      modal.classList.remove('ui-hidden');
      modal.style.display = 'flex';
      renderFeedsModal(true);
    }
  };

  window.closeFeedsModal = function () {
    isFeedsModalOpen = false;
    const modal = $('feeds-portal-modal');
    const feedsBtn = $('btn-open-feeds');
    if (feedsBtn) feedsBtn.classList.remove('is-active');
    if (modal) {
      modal.classList.add('ui-hidden');
      modal.style.display = 'none';
    }
  };

  window.toggleFeedsModal = function () {
    if (isFeedsModalOpen) window.closeFeedsModal();
    else window.openFeedsModal();
  };

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

    if (shareBtn) { shareBtn.style.display = 'none'; shareBtn.disabled = true; }
    if (dlLink) { dlLink.style.display = 'none'; }
    if (copyBtn) { copyBtn.style.display = 'none'; }
    if (feedback) { feedback.style.display = 'none'; feedback.textContent = ''; }

    setExportStatus('working', 'PREPARING', 'Packaging...');
  }

  window.closeExportModal = function () {
    isExportModalOpen = false;
    const modal = $('export-file-modal');
    if (modal) modal.style.display = 'none';
    revokeExportResources();
  };

  // --- 3. SESSION FILENAME BAR & TRANSPORT DECK ---
  async function commitSessionNameFromInput() {
    const input = $('stream-session-name');
    const rec = window.biodataRecorder;
    if (!input || !rec) return;
    const clean = await rec.setSessionName(input.value, true);
    input.value = clean;
    const savedTag = $('session-name-saved-tag');
    if (savedTag) {
      savedTag.style.display = 'inline-block';
      clearTimeout(sessionSavedFeedbackTimer);
      sessionSavedFeedbackTimer = setTimeout(() => {
        savedTag.style.display = 'none';
      }, 1800);
    }
  }

  window.applySessionFilename = commitSessionNameFromInput;

  window.resetSessionFilename = function () {
    const rec = window.biodataRecorder;
    const input = $('stream-session-name');
    if (!rec) return;
    const fresh = rec.resetSessionNameToTimestamp();
    if (input) input.value = fresh;
  };

  window.toggleRecordAutomationUI = function () {
    if (!window.biodataRecorder || typeof window.biodataRecorder.toggleRecordAutomation !== 'function') return;
    window.biodataRecorder.toggleRecordAutomation();
    updateTransportDeck();
  };

  function updateTransportDeck() {
    const ds = window.dataStreamer;
    const rec = window.biodataRecorder;
    if (!ds) return;

    const streamState = ds.getState();
    const isStreamingActive = streamState && streamState.totalRecords > 0;
    const isRecording = rec && rec.isRecording;

    // 1. Record button, automation recording toggle, session filename input & data points
    const recBtn = $('btn-rec-stream');
    const recAutoBtn = $('btn-rec-auto');
    const ptsCounter = $('stream-pts-counter');
    const sessionInput = $('stream-session-name');

    if (recBtn) {
      if (isRecording) {
        recBtn.classList.add('recording');
        recBtn.innerHTML = '● STOP REC';
      } else {
        recBtn.classList.remove('recording');
        recBtn.innerHTML = '● REC';
      }
    }

    if (recAutoBtn) {
      const recAutoOn = Boolean(rec && rec.recordAutomation);
      recAutoBtn.classList.toggle('active-auto', recAutoOn);
      recAutoBtn.setAttribute('aria-pressed', recAutoOn ? 'true' : 'false');
      recAutoBtn.textContent = recAutoOn ? '● REC AUTO' : 'REC AUTO';
    }

    if (sessionInput && rec && document.activeElement !== sessionInput) {
      if (sessionInput.value !== rec.sessionName) {
        sessionInput.value = rec.sessionName || '';
      }
    }

    if (ptsCounter) {
      if (isRecording) {
        ptsCounter.style.color = '#ff5577';
        ptsCounter.textContent = `${(rec.totalPointsRecorded || rec.recordCount || 0).toLocaleString()} pts`;
      } else if (rec && (rec.totalPointsRecorded || rec.recordCount)) {
        ptsCounter.style.color = '#c9d1d9';
        ptsCounter.textContent = `${(rec.totalPointsRecorded || rec.recordCount || 0).toLocaleString()} pts`;
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

    const loopBtn = $('btn-loop-stream');
    if (loopBtn) {
      loopBtn.classList.toggle('active-loop', Boolean(streamState.isLooping));
    }

    const autoBtn = $('btn-auto-stream');
    if (autoBtn) {
      const hasAuto = !!streamState.hasAutomation;
      autoBtn.disabled = !hasAuto;
      autoBtn.classList.toggle('active-auto', hasAuto && !!streamState.followAutomation);
      autoBtn.setAttribute('aria-pressed', (hasAuto && !!streamState.followAutomation) ? 'true' : 'false');
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
      timeDisp.textContent = isStreamingActive
        ? `${formatMs(streamState.playbackElapsedMs)} / ${formatMs(streamState.totalDurationMs)}`
        : '00:00 / 00:00';
    }
    if (idxDisp) {
      idxDisp.textContent = isStreamingActive ? `#${(streamState.currentIndex || 0).toLocaleString()}` : '#0';
    }

    const cadenceBox = $('stream-cadence-box');
    if (cadenceBox) {
      cadenceBox.style.display = (isStreamingActive && !streamState.hasTimestamps) ? 'flex' : 'none';
    }

    const speedVal = $('stream-speed-val');
    if (speedVal) speedVal.textContent = `${(streamState.playbackRate || 1.0).toFixed(1)}x`;

    // 6. Channel status cards (shows file stream OR active Cloud Feed route via O(1) lookup)
    const feedsMgr = window.bioquadFeeds;
    const mqttRoutes = feedsMgr && feedsMgr.channelRoutes ? feedsMgr.channelRoutes : null;
    for (let ch = 0; ch < 4; ch++) {
      const feed = streamState.activeChannels && streamState.activeChannels[ch];
      const hasFileData = feed && feed.active;
      const mqttRoute = mqttRoutes ? mqttRoutes[ch] : null;
      const mqttMeta = (mqttRoute && feedsMgr)
        ? (typeof feedsMgr.getFeedById === 'function' ? feedsMgr.getFeedById(mqttRoute.feedId) : null)
        : null;

      const labelEl = $(`stream-ch-label-${ch}`);
      const valEl = $(`stream-ch-val-${ch}`);
      const clearBtn = $(`stream-ch-clear-${ch}`);

      if (labelEl) {
        if (hasFileData) {
          if (labelEl.textContent !== feed.label) labelEl.textContent = feed.label;
          labelEl.style.color = '#c9d1d9';
        } else if (mqttRoute) {
          const streamNum = (mqttRoute.remoteCh || 0) + 1;
          const nextRouteLbl = `${mqttMeta ? mqttMeta.name : mqttRoute.feedId} · S${streamNum}`;
          if (labelEl.textContent !== nextRouteLbl) labelEl.textContent = nextRouteLbl;
          labelEl.style.color = 'var(--cyan)';
        } else {
          if (labelEl.textContent !== 'Empty') labelEl.textContent = 'Empty';
          labelEl.style.color = '#6e7681';
        }
      }

      if (valEl) {
        if (hasFileData && feed.currentVal !== null && feed.currentVal !== undefined) {
          valEl.textContent = (window.BioQuadCore && typeof window.BioQuadCore.formatChannelMetricValue === 'function')
            ? window.BioQuadCore.formatChannelMetricValue(feed.currentVal, feed.metricMeta, true)
            : `${feed.currentVal.toFixed(1)}`;
          valEl.style.display = 'inline';
        } else if (mqttRoute && window.chData && window.chData[ch] && window.chData[ch].waveBuffer && window.chData[ch].waveBuffer.length > 0) {
          const latest = window.chData[ch].waveBuffer[window.chData[ch].waveBuffer.length - 1];
          valEl.textContent = `${latest.r.toFixed(1)} µS`;
          valEl.style.display = 'inline';
        } else {
          valEl.style.display = 'none';
        }
      }

      if (clearBtn) {
        clearBtn.style.display = (hasFileData || mqttRoute) ? 'inline-block' : 'none';
      }
    }

    updateToolbarIndicator();
  }

  // --- 4. FILE INGESTION & MAPPING ---
  function scrollPortalMappingIntoView() {
    const modal = $('file-portal-modal');
    const body = $('file-portal-modal-body') || (modal ? modal.querySelector('.modal-body') : null);
    if (body) {
      body.scrollTo({ top: 0, behavior: 'smooth' });
    }
    const section = $('portal-mapping-section');
    if (section && typeof section.scrollIntoView === 'function') {
      requestAnimationFrame(() => {
        try { section.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
      });
    }
  }

  function processFileText(text, fileName, targetChannelOverride) {
    const ds = window.dataStreamer;
    if (!ds) return;

    try {
      const parsed = ds.parseFileContent(text, fileName);
      parsedPreview = parsed;
      activeImportSourceCh = (targetChannelOverride !== undefined && targetChannelOverride !== null)
        ? targetChannelOverride
        : null;

      const guesses = parsed.guesses || {};
      selectedIdCol = guesses.identifierCol || '';
      selectedValueCol = guesses.primaryValueCol || (parsed.columns[0] || '');
      selectedTimeCol = guesses.timestampCol || '';

      // Always initialize BOTH sensor and column maps freshly for this file so switching modes works cleanly
      sensorToChMap = {};
      if (Array.isArray(guesses.sensorList) && guesses.sensorList.length > 0) {
        guesses.sensorList.slice(0, 4).forEach((s, idx) => {
          sensorToChMap[s] = idx;
        });
      }

      colToChMap = {};
      const detectedCols = Array.isArray(guesses.detectedValueCols) && guesses.detectedValueCols.length > 0
        ? guesses.detectedValueCols
        : parsed.columns.filter(c => c !== selectedTimeCol && c !== selectedIdCol);
      detectedCols.slice(0, 4).forEach((c, idx) => {
        colToChMap[c] = idx;
      });

      if (activeImportSourceCh !== null) {
        mappingMode = 'single_channel';
        targetSingleChannel = activeImportSourceCh;
      } else if (guesses.identifierCol && guesses.sensorList && guesses.sensorList.length >= 2) {
        mappingMode = 'multi_sensor_id';
      } else if (guesses.detectedValueCols && guesses.detectedValueCols.length >= 2) {
        mappingMode = 'multi_value_cols';
      } else {
        mappingMode = 'single_channel';
        targetSingleChannel = 0;
      }

      hidePortalError();
      window.openFileDetailsPanel();
      renderMappingSection();
      renderChannelsInModal();
      scrollPortalMappingIntoView();
    } catch (err) {
      window.openFileDetailsPanel();
      showPortalError(err.message || 'Error parsing file format');
      scrollPortalMappingIntoView();
    }
  }

  function handleFileInputChange(file, targetCh) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      processFileText(e.target.result, file.name, targetCh);
    };
    reader.onerror = () => {
      showPortalError('Failed to read file from disk');
      scrollPortalMappingIntoView();
    };
    reader.readAsText(file);
  }

  window.dismissMappingSection = function () {
    parsedPreview = null;
    activeImportSourceCh = null;
    const section = $('portal-mapping-section');
    if (section) section.style.display = 'none';
  };

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
      scrollPortalMappingIntoView();
    }
  };

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

      // Disconnect any active Cloud Feed routes on channels that now have file data loaded
      if (window.bioquadFeeds) {
        const st = ds.getState();
        for (let ch = 0; ch < 4; ch++) {
          if (st.activeChannels && st.activeChannels[ch] && st.activeChannels[ch].active) {
            const fState = window.bioquadFeeds.getState();
            if (fState.channelRoutes && fState.channelRoutes[ch]) {
              window.bioquadFeeds.assignRoute(ch, null);
            }
          }
        }
      }

      parsedPreview = null;
      activeImportSourceCh = null;
      const section = $('portal-mapping-section');
      if (section) section.style.display = 'none';

      renderChannelsInModal();
      ds.play();
      updateTransportDeck();
    } catch (err) {
      showPortalError(err.message || 'Error applying mapping');
    }
  };

  // --- 5. SAVED DATA MANAGER (SEARCH, SORT & INLINE RENAME) ---
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
      const allTakes = await window.bioquadStorage.getAllTakes();
      if (countBadge) {
        countBadge.textContent = allTakes.length;
        countBadge.style.display = allTakes.length > 0 ? 'inline-block' : 'none';
      }
      if (clearAllBtn) {
        clearAllBtn.style.display = allTakes.length > 0 ? 'inline-flex' : 'none';
        clearAllBtn.textContent = clearAllTakesArmed ? 'Confirm Clear All?' : 'Clear All';
      }

      if (allTakes.length === 0) {
        container.innerHTML = '<div style="color: #6e7681; padding: 12px; text-align: center; font-size: 11px;">No saved sessions</div>';
        return;
      }

      const query = savedTakesSearch.trim().toLowerCase();
      let filtered = allTakes.filter(t => {
        if (!query) return true;
        return String(t.name || '').toLowerCase().includes(query) || String(t.date || '').toLowerCase().includes(query);
      });

      filtered.sort((a, b) => {
        if (savedTakesSort === 'oldest') return (a.timestamp || 0) - (b.timestamp || 0);
        if (savedTakesSort === 'name_asc') return String(a.name || '').localeCompare(String(b.name || ''));
        if (savedTakesSort === 'points_desc') {
          const pa = a.totalPointsRecorded || a.sampleCount || 0;
          const pb = b.totalPointsRecorded || b.sampleCount || 0;
          return pb - pa;
        }
        return (b.timestamp || 0) - (a.timestamp || 0);
      });

      if (filtered.length === 0) {
        container.innerHTML = '<div style="color: #6e7681; padding: 12px; text-align: center; font-size: 11px;">No matches</div>';
        return;
      }

      let html = '';
      filtered.forEach((take) => {
        const storedPts = take.storedRecordCount !== undefined ? take.storedRecordCount : (take.sampleCount || 0);
        const totalPts = take.totalPointsRecorded || storedPts;
        const ptsText = `${totalPts.toLocaleString()} pts`;
        const dur = take.durationFormatted || '00:00.0';
        const isEditing = editingTakeId === take.id;
        const safeName = escapeHtml(take.name);

        html += `
          <div class="saved-take-card">
            <div style="flex: 1; min-width: 200px;">
              ${isEditing ? `
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px; flex-wrap: wrap;">
                  <input type="text" id="rename-take-input-${take.id}" value="${safeName}" aria-label="New filename for ${safeName}"
                    style="background: #0d1117; color: var(--cyan); border: 1px solid var(--cyan); border-radius: 4px; padding: 4px 8px; font-size: 11px; font-family: inherit; font-weight: 700; min-width: 180px; flex: 1;"
                    onkeydown="if(event.key==='Enter'){window.commitRenameTake('${take.id}');}else if(event.key==='Escape'){window.cancelRenameTake();}">
                  <button class="stream-btn rename-save-btn" aria-label="Save new filename" onclick="window.commitRenameTake('${take.id}')" style="min-height: 28px; width: auto; min-width: 58px; padding: 2px 10px; background: #0f2c1c; color: #39ff14; border-color: #2ea043;">Save</button>
                  <button class="stream-btn" aria-label="Cancel rename" onclick="window.cancelRenameTake()" style="min-height: 28px; padding: 2px 8px;">Cancel</button>
                </div>
              ` : `
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-weight: 700; font-size: 12px; color: #fff;">${safeName}</span>
                  <button class="stream-btn" onclick="window.startRenameTake('${take.id}')" title="Rename saved session" aria-label="Rename ${safeName}" style="min-height: 22px; padding: 1px 7px; font-size: 10px; color: var(--cyan); border-color: rgba(0,240,255,0.35);">✎ Rename</button>
                </div>
              `}
              <div class="tabular-nums" style="font-size: 10px; color: #8b949e; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 3px;">
                <span>${escapeHtml(take.date)}</span>
                <span style="color: var(--green); font-weight: 700;">⏱ ${escapeHtml(dur)}</span>
                <span style="color: var(--cyan); font-weight: 700;">${ptsText}</span>
                ${take.hasAutomation ? `<span style="color: var(--yellow); font-weight: 700;">· + Automation</span>` : ''}
              </div>
            </div>
            <div class="saved-take-actions">
              <button class="stream-btn play-btn" onclick="window.playSavedTake('${take.id}')">▶ Play</button>
              <button class="stream-btn" onclick="window.exportTakeCsv('${take.id}')">CSV</button>
              <button class="stream-btn" onclick="window.exportTakeMidi('${take.id}')" style="color: var(--cyan); border-color: rgba(0,240,255,0.4);" title="Export all channels as a single MIDI ZIP bundle">MIDI</button>
              <button class="stream-btn" onclick="window.deleteSavedTake('${take.id}')" aria-label="Delete ${safeName}" style="color: #ff5577; border-color: rgba(255,85,119,0.4); min-width: 40px;" title="Delete take">✕</button>
            </div>
          </div>
        `;
      });
      container.innerHTML = html;

      if (editingTakeId) {
        const inp = $(`rename-take-input-${editingTakeId}`);
        if (inp) {
          inp.focus();
          inp.select();
        }
      }
    } catch (e) {
      console.warn('Error reading saved takes:', e);
    }
  }

  window.startRenameTake = function (takeId) {
    editingTakeId = takeId;
    renderSavedTakes();
  };

  window.cancelRenameTake = function () {
    editingTakeId = null;
    renderSavedTakes();
  };

  window.commitRenameTake = async function (takeId) {
    if (!window.bioquadStorage) return;
    const inp = $(`rename-take-input-${takeId}`);
    const newVal = inp ? inp.value : '';
    editingTakeId = null;
    const updated = await window.bioquadStorage.renameTake(takeId, newVal);
    if (updated && window.biodataRecorder && window.biodataRecorder.lastSavedTakeId === takeId && !window.biodataRecorder.isRecording) {
      window.biodataRecorder.sessionName = updated.name;
    }
    renderSavedTakes();
  };

  window.playSavedTake = async function (takeId) {
    if (!window.bioquadStorage || !window.dataStreamer) return;
    try {
      hidePortalError();
      await window.dataStreamer.loadTakeById(takeId);
      renderChannelsInModal();
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
    if (!clearAllTakesArmed) {
      clearAllTakesArmed = true;
      renderSavedTakes();
      clearTimeout(clearAllTakesTimer);
      clearAllTakesTimer = setTimeout(() => {
        clearAllTakesArmed = false;
        renderSavedTakes();
      }, 4000);
      return;
    }
    clearAllTakesArmed = false;
    clearTimeout(clearAllTakesTimer);
    await window.bioquadStorage.clearAllTakes();
    renderSavedTakes();
  };

  // --- 6. CLOUD MQTT FEEDS & MULTI-USER PLAYOUT SYNC UI ---
  function updateFeedsSyncTelemetryOnly() {
    const mgr = window.bioquadFeeds;
    if (!mgr) return;
    const st = mgr.getState();
    const sync = st.syncStats || {};

    if ($('sync-buffer-val')) $('sync-buffer-val').textContent = `${st.playoutBufferMs} ms`;
    if ($('sync-offset-val')) $('sync-offset-val').textContent = `${sync.offsetMs >= 0 ? '+' : ''}${sync.offsetMs || 0} ms`;
    if ($('sync-jitter-val')) $('sync-jitter-val').textContent = `±${sync.jitterMs || 0} ms`;
    if ($('sync-pkt-val')) $('sync-pkt-val').textContent = `${(sync.syncedCount || 0).toLocaleString()} synced`;

    if ($('mqtt-tx-val')) $('mqtt-tx-val').textContent = (st.txCount || 0).toLocaleString();
    if ($('mqtt-rx-val')) $('mqtt-rx-val').textContent = (st.rxCount || 0).toLocaleString();
    if ($('mqtt-rtt-val')) {
      $('mqtt-rtt-val').textContent = st.lastRttMs !== null && st.lastRttMs !== undefined
        ? `${st.lastRttMs} ms`
        : '--';
      $('mqtt-rtt-val').style.color = st.lastRttMs !== null ? 'var(--green)' : '#fff';
    }
    if ($('mqtt-topic-val')) {
      $('mqtt-topic-val').textContent = st.lastTopic
        ? st.lastTopic
        : (st.isConnected ? `Subscribed · bioquad/feeds/+` : 'Idle');
      $('mqtt-topic-val').style.color = st.lastTopic ? 'var(--cyan)' : '#8b949e';
    }

    const pubBadge = $('mqtt-pub-status-badge');
    if (pubBadge) {
      if (st.isPublishing && st.isConnected) {
        pubBadge.textContent = `Live · ${st.publishFeedId}`;
        pubBadge.style.color = 'var(--green)';
      } else if (st.isPublishing) {
        pubBadge.textContent = `Connecting · ${st.publishFeedId}`;
        pubBadge.style.color = 'var(--cyan)';
      } else {
        pubBadge.textContent = 'Off';
        pubBadge.style.color = '#8b949e';
      }
    }

    // 1. Outgoing per-channel TX status cards (CH 1 -> S1 .. CH 4 -> S4)
    const txStats = st.txChStats || [];
    for (let ch = 0; ch < 4; ch++) {
      const dotEl = $(`mqtt-tx-dot-${ch}`);
      const statEl = $(`mqtt-tx-stat-${ch}`);
      const route = st.channelRoutes[ch];
      const isReceiving = Boolean(route && !(st.isPublishing && route.feedId === st.publishFeedId && route.remoteCh === ch));
      const sentCount = txStats[ch] ? (txStats[ch].msgCount || 0) : 0;

      if (!st.isPublishing) {
        if (dotEl) { dotEl.textContent = '○'; dotEl.style.color = '#484f58'; }
        if (statEl) {
          statEl.textContent = isReceiving ? `RX · S${(route.remoteCh || 0) + 1}` : 'Off';
          statEl.style.color = isReceiving ? 'var(--cyan)' : '#6e7681';
        }
      } else if (isReceiving) {
        if (dotEl) { dotEl.textContent = '↳'; dotEl.style.color = 'var(--cyan)'; }
        if (statEl) {
          statEl.textContent = `RX · S${(route.remoteCh || 0) + 1}`;
          statEl.style.color = 'var(--cyan)';
        }
      } else if (sentCount > 0) {
        if (dotEl) { dotEl.textContent = '●'; dotEl.style.color = 'var(--green)'; }
        if (statEl) {
          statEl.textContent = `${sentCount.toLocaleString()} pkts`;
          statEl.style.color = 'var(--green)';
        }
      } else {
        if (dotEl) { dotEl.textContent = '○'; dotEl.style.color = '#8b949e'; }
        if (statEl) {
          statEl.textContent = st.isConnected ? 'Waiting' : 'Connecting';
          statEl.style.color = '#8b949e';
        }
      }
    }

    // 2. Live feeds summary + Clear Idle visibility
    const liveMqttFeeds = st.feeds.filter(f => !f.isVirtualUtc);
    const idleRemoteCount = liveMqttFeeds.filter(f => !f.isSelfBroadcast && (f.msgCount || 0) === 0).length;
    if ($('mqtt-live-feeds-summary')) {
      const activeStreamTotal = liveMqttFeeds.reduce((acc, f) => {
        const activeChs = Array.isArray(f.chStats) ? f.chStats.filter(c => c.msgCount > 0).length : 0;
        return acc + activeChs;
      }, 0);
      $('mqtt-live-feeds-summary').textContent = activeStreamTotal > 0
        ? `${activeStreamTotal} active stream${activeStreamTotal === 1 ? '' : 's'}`
        : (liveMqttFeeds.length > 0 ? `${liveMqttFeeds.length} ready` : 'Local');
      $('mqtt-live-feeds-summary').style.color = activeStreamTotal > 0 ? 'var(--green)' : '#8b949e';
    }
    if ($('btn-mqtt-clear-stale')) {
      $('btn-mqtt-clear-stale').style.display = idleRemoteCount > 0 ? 'inline-flex' : 'none';
    }

    // 3. In-place packet counter updates for rendered live stream rows (O(1) Map lookup, zero DOM flicker)
    document.querySelectorAll('[data-stream-pkt-key]').forEach(el => {
      const key = el.getAttribute('data-stream-pkt-key') || '';
      const parsed = window.BioQuadCore && window.BioQuadCore.parseStreamSelectValue
        ? window.BioQuadCore.parseStreamSelectValue(key)
        : null;
      if (!parsed) return;
      const f = typeof mgr.getFeedById === 'function'
        ? mgr.getFeedById(parsed.feedId)
        : st.feeds.find(item => item.feedId === parsed.feedId);
      if (!f || f.isVirtualUtc) return;
      const rxPkts = Array.isArray(f.chStats) && f.chStats[parsed.remoteCh]
        ? f.chStats[parsed.remoteCh].msgCount
        : 0;
      const txPkts = f.isSelfBroadcast && st.txChStats && st.txChStats[parsed.remoteCh]
        ? st.txChStats[parsed.remoteCh].msgCount
        : 0;
      const count = Math.max(rxPkts, txPkts);
      const nextPktTxt = count > 0 ? `${count.toLocaleString()} pkts` : 'Idle';
      if (el.textContent !== nextPktTxt) el.textContent = nextPktTxt;
      el.style.color = count > 0 ? 'var(--green)' : '#6e7681';
    });
  }

  function renderFeedsModal(syncInputs = false) {
    const mgr = window.bioquadFeeds;
    if (!mgr) return;
    const st = mgr.getState();

    if (syncInputs) {
      const urlInp = $('mqtt-broker-url-input');
      if (urlInp && document.activeElement !== urlInp) urlInp.value = st.brokerUrl;
      const userInp = $('mqtt-broker-user-input');
      if (userInp && document.activeElement !== userInp) userInp.value = st.brokerUser || '';
      const passInp = $('mqtt-broker-pass-input');
      if (passInp && document.activeElement !== passInp && window.bioquadFeeds) {
        passInp.value = window.bioquadFeeds.brokerPass || '';
      }
      if ((st.brokerUser || st.hasBrokerPass) && $('mqtt-auth-row')) {
        $('mqtt-auth-row').style.display = 'grid';
      }
      const pubNameInp = $('mqtt-pub-name-input');
      if (pubNameInp && document.activeElement !== pubNameInp) pubNameInp.value = st.publishName;
      const pubIdInp = $('mqtt-pub-id-input');
      if (pubIdInp && document.activeElement !== pubIdInp) pubIdInp.value = st.publishFeedId;
      const bufSlider = $('sync-buffer-slider');
      if (bufSlider && document.activeElement !== bufSlider) bufSlider.value = st.playoutBufferMs;
      const searchInp = $('feeds-stream-search');
      if (searchInp && document.activeElement !== searchInp) searchInp.value = streamSearchQuery;
    }

    const authBtn = $('btn-mqtt-auth-toggle');
    const authRow = $('mqtt-auth-row');
    if (authBtn && authRow) {
      const isAuthOpen = authRow.style.display !== 'none';
      const hasAuth = Boolean(st.brokerUser || st.hasBrokerPass);
      authBtn.classList.toggle('is-tls', isAuthOpen || hasAuth);
      authBtn.setAttribute('aria-expanded', isAuthOpen ? 'true' : 'false');
    }

    document.querySelectorAll('.mqtt-preset-btn').forEach(btn => {
      const isMatch = btn.dataset.presetUrl === st.brokerUrl;
      btn.style.borderColor = isMatch ? 'var(--cyan)' : 'var(--border)';
      btn.style.color = isMatch ? 'var(--cyan)' : 'var(--text)';
      btn.style.background = isMatch ? 'rgba(0,240,255,0.12)' : '';
    });

    const statusBadge = $('mqtt-broker-status-badge');
    if (statusBadge) {
      statusBadge.textContent = st.statusText;
      statusBadge.style.color = st.isConnected ? 'var(--green)' : (st.isConnecting ? 'var(--cyan)' : 'var(--text-muted)');
    }

    const connBtn = $('btn-mqtt-connect');
    if (connBtn) {
      connBtn.textContent = st.isConnected ? 'Disconnect' : (st.isConnecting ? 'Connecting...' : 'Connect');
      connBtn.classList.toggle('danger', st.isConnected);
      connBtn.classList.toggle('play-btn', !st.isConnected);
    }

    const pubBtn = $('btn-mqtt-publish-toggle');
    if (pubBtn) {
      pubBtn.textContent = st.isPublishing ? 'Stop' : 'Broadcast';
      pubBtn.classList.toggle('recording', st.isPublishing);
    }

    const idleChk = $('feeds-show-idle-chk');
    if (idleChk) idleChk.checked = showIdleStreams;

    const simChk = $('feeds-show-sim-chk');
    if (simChk) simChk.checked = showSimFeeds;

    // 1. Active Routed Channels Strip (per-channel AUTO / CUSTOM toggle + unroute)
    const routedStrip = $('feeds-routed-strip');
    if (routedStrip) {
      const activeRoutes = [];
      for (let localCh = 0; localCh < 4; localCh++) {
        if (st.channelRoutes[localCh]) {
          activeRoutes.push({ localCh, route: st.channelRoutes[localCh] });
        }
      }

      if (activeRoutes.length === 0) {
        routedStrip.style.display = 'none';
        routedStrip.innerHTML = '';
      } else {
        routedStrip.style.display = 'flex';
        let rHtml = `<div style="display: flex; justify-content: space-between; align-items: center; font-size: 9px; font-weight: 700; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px;">
          <span>ACTIVE ROUTES</span>
          <span>SYNTH PATCH</span>
        </div>`;
        activeRoutes.forEach(({ localCh, route }) => {
          const col = CH_COLORS[localCh];
          const feed = st.feeds.find(f => f.feedId === route.feedId);
          const feedLabel = feed ? (feed.name || feed.feedId) : route.feedId;
          const streamNum = (route.remoteCh || 0) + 1;
          const isAuto = route.followPatch !== false;
          const safeFeedLabel = escapeHtml(feedLabel);

          rHtml += `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 3px 0; border-top: 1px solid #1d2530;">
              <div style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;">
                <span style="font-weight: 700; font-size: 11px; color: ${col}; flex-shrink: 0;">CH ${localCh + 1}</span>
                <span style="font-size: 11px; color: #e6edf3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">← ${safeFeedLabel} · S${streamNum}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 5px; flex-shrink: 0;">
                <button type="button" id="btn-route-auto-${localCh}" class="stream-btn"
                  onclick="window.toggleFeedPatchFollow(${localCh})"
                  aria-pressed="${isAuto ? 'true' : 'false'}"
                  title="${isAuto ? 'Following artist synth patch and live automation. Click to customize locally.' : 'Custom local synth active. Click to re-sync artist patch.'}"
                  style="min-height: 22px; padding: 1px 8px; font-size: 9.5px; font-weight: 700; border-color: ${isAuto ? 'var(--green)' : 'var(--yellow)'}; color: ${isAuto ? 'var(--green)' : 'var(--yellow)'}; background: ${isAuto ? 'rgba(57,255,20,0.12)' : 'rgba(255,215,0,0.12)'};">
                  ${isAuto ? 'AUTO' : 'CUSTOM'}
                </button>
                <button type="button" class="stream-btn" onclick="window.handleChannelStreamSelect(${localCh}, '')" aria-label="Disconnect Channel ${localCh + 1}" style="min-height: 22px; min-width: 24px; padding: 1px 5px; font-size: 9.5px; color: #ff5577; border-color: rgba(255,85,119,0.4);">✕</button>
              </div>
            </div>
          `;
        });
        routedStrip.innerHTML = rHtml;
      }
    }

    // 2. Scalable Live Stream Rows Directory with Direct [CH 1] [CH 2] [CH 3] [CH 4] Buttons
    const listEl = $('feeds-active-list');
    if (!listEl) {
      updateFeedsSyncTelemetryOnly();
      return;
    }

    const rows = (window.BioQuadCore && typeof window.BioQuadCore.filterStreamDirectoryRows === 'function')
      ? window.BioQuadCore.filterStreamDirectoryRows(st.feeds, {
          query: streamSearchQuery,
          showIdle: showIdleStreams,
          showSim: showSimFeeds,
          channelRoutes: st.channelRoutes,
          txChStats: st.txChStats
        })
      : [];

    if ($('feeds-visible-count')) {
      $('feeds-visible-count').textContent = `${rows.length} shown`;
    }

    if (rows.length === 0) {
      const emptyMsg = streamSearchQuery.trim()
        ? 'No matching streams'
        : (st.isConnected ? 'No active streams' : 'Disconnected');
      listEl.innerHTML = `<div style="font-size: 11px; color: #8b949e; text-align: center; padding: 12px 8px; background: #161b22; border: 1px dashed var(--border); border-radius: 8px;">${emptyMsg}</div>`;
      updateFeedsSyncTelemetryOnly();
      return;
    }

    let html = '';
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const safeFeedId = escapeHtml(row.feedId);
      const safeName = escapeHtml(row.feedName);
      const safePatch = escapeHtml(row.patchSummary);
      const isRouted = row.routedLocalChs.length > 0;
      const dotColor = row.isVirtualUtc ? 'var(--yellow)' : (row.pktCount > 0 ? 'var(--green)' : '#6e7681');
      const dotChar = row.isVirtualUtc ? '●' : (row.pktCount > 0 ? '●' : '○');
      const tagText = row.isVirtualUtc ? 'UTC' : (row.isSelfBroadcast ? 'SELF' : 'LIVE');
      const tagColor = row.isVirtualUtc ? 'var(--yellow)' : (row.isSelfBroadcast ? 'var(--cyan)' : 'var(--green)');
      const pktText = row.isVirtualUtc ? 'UTC' : (row.pktCount > 0 ? `${row.pktCount.toLocaleString()} pkts` : 'Idle');
      const pktColor = row.isVirtualUtc ? 'var(--yellow)' : (row.pktCount > 0 ? 'var(--green)' : '#6e7681');

      let chBtnsHtml = '';
      for (let lCh = 0; lCh < 4; lCh++) {
        const active = row.routedLocalChs.includes(lCh);
        const col = CH_COLORS[lCh];
        chBtnsHtml += `
          <button type="button" class="stream-btn feed-route-btn"
            data-feed-id="${safeFeedId}" data-remote-ch="${row.remoteCh}" data-local-ch="${lCh}"
            onclick="window.toggleFeedRoute(${lCh}, '${safeFeedId}', ${row.remoteCh})"
            aria-pressed="${active ? 'true' : 'false'}"
            style="min-height: 24px; min-width: 40px; padding: 2px 6px; font-size: 10px; font-weight: 700; border-color: ${active ? col : 'var(--border)'}; color: ${active ? '#000' : col}; background: ${active ? col : '#0d1117'};">
            CH ${lCh + 1}
          </button>
        `;
      }

      html += `
        <div class="stream-dir-row" data-stream-row="${safeFeedId}:${row.remoteCh}"
          style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; background: #161b22; border: 1px solid ${isRouted ? 'rgba(0,240,255,0.55)' : 'var(--border)'}; border-radius: 14px; padding: 6px 11px;">
          <div style="display: flex; flex-direction: column; gap: 2px; min-width: 170px; flex: 1; overflow: hidden;">
            <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
              <span style="color: ${dotColor}; font-size: 10px; flex-shrink: 0;">${dotChar}</span>
              <span style="font-weight: 700; font-size: 11px; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${safeName}</span>
              <span style="font-size: 9.5px; font-weight: 700; color: var(--cyan); background: rgba(0,240,255,0.1); border: 1px solid rgba(0,240,255,0.28); border-radius: 999px; padding: 0 7px; flex-shrink: 0;">${row.streamLabel}</span>
              <span style="font-size: 9px; font-weight: 700; color: ${tagColor}; flex-shrink: 0;">${tagText}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; font-size: 10px; color: #8b949e; overflow: hidden;">
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${safePatch ? `♪ ${safePatch}` : safeFeedId}</span>
              <span data-stream-pkt-key="${safeFeedId}:${row.remoteCh}" class="tabular-nums" style="color: ${pktColor}; font-weight: 700; flex-shrink: 0;">${pktText}</span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 5px; flex-shrink: 0;">
            ${chBtnsHtml}
          </div>
        </div>
      `;
    }

    listEl.innerHTML = html;
    updateFeedsSyncTelemetryOnly();
  }

  window.handleFeedsSearchInput = function (val) {
    streamSearchQuery = String(val || '');
    renderFeedsModal(false);
  };

  window.toggleShowIdleStreams = function (checked) {
    showIdleStreams = Boolean(checked);
    renderFeedsModal(false);
  };

  window.toggleShowSimFeeds = function (checked) {
    showSimFeeds = Boolean(checked);
    renderFeedsModal(false);
  };

  window.handlePurgeStaleFeeds = function () {
    if (!window.bioquadFeeds) return;
    window.bioquadFeeds.purgeStaleFeeds(true);
    renderFeedsModal(false);
  };

  window.handleChannelStreamSelect = function (localCh, rawValue) {
    if (!window.bioquadFeeds) return;
    const parsed = window.BioQuadCore && window.BioQuadCore.parseStreamSelectValue
      ? window.BioQuadCore.parseStreamSelectValue(rawValue)
      : null;

    if (!parsed) {
      window.bioquadFeeds.assignRoute(localCh, null);
    } else {
      window.bioquadFeeds.assignRoute(localCh, parsed.feedId, parsed.remoteCh, true);
      if (window.dataStreamer) {
        const dsState = window.dataStreamer.getState();
        if (dsState && dsState.activeChannels && dsState.activeChannels[localCh] && dsState.activeChannels[localCh].active) {
          window.dataStreamer.clearChannel(localCh);
        }
      }
      if (window.viewMode === '1ch' && typeof window.selectChannelInCurrentView === 'function') {
        window.selectChannelInCurrentView(localCh);
      }
    }
    renderFeedsModal(false);
    updateTransportDeck();
  };

  window.toggleMqttAuthRow = function (forceShow) {
    const row = $('mqtt-auth-row');
    const btn = $('btn-mqtt-auth-toggle');
    if (!row) return;
    const nextOpen = forceShow !== undefined ? Boolean(forceShow) : (row.style.display === 'none');
    row.style.display = nextOpen ? 'grid' : 'none';
    if (btn) {
      btn.classList.toggle('is-tls', nextOpen);
      btn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    }
  };

  window.selectMqttPreset = function (url) {
    const inp = $('mqtt-broker-url-input');
    if (inp) inp.value = url;
    // Public preset brokers do not require authentication
    if (window.bioquadFeeds) {
      const uInp = $('mqtt-broker-user-input');
      const pInp = $('mqtt-broker-pass-input');
      if (uInp) uInp.value = '';
      if (pInp) pInp.value = '';
      window.bioquadFeeds.switchBroker(url, '', '');
    }
  };

  window.handleMqttConnectClick = function () {
    if (!window.bioquadFeeds) return;
    const inp = $('mqtt-broker-url-input');
    const url = inp ? inp.value.trim() : '';
    const userInp = $('mqtt-broker-user-input');
    const passInp = $('mqtt-broker-pass-input');
    const uVal = userInp ? userInp.value.trim() : undefined;
    const pVal = passInp ? passInp.value : undefined;
    if (window.bioquadFeeds.isConnected || window.bioquadFeeds.isConnecting) {
      window.bioquadFeeds.disconnectBroker();
    } else {
      window.bioquadFeeds.connectBroker(url, uVal, pVal);
    }
  };

  window.handleMqttPingClick = function () {
    if (!window.bioquadFeeds) return;
    const inp = $('mqtt-broker-url-input');
    const url = inp ? inp.value.trim() : '';
    const userInp = $('mqtt-broker-user-input');
    const passInp = $('mqtt-broker-pass-input');
    const uVal = userInp ? userInp.value.trim() : undefined;
    const pVal = passInp ? passInp.value : undefined;
    if (url && (url !== window.bioquadFeeds.brokerUrl || (uVal !== undefined && uVal !== window.bioquadFeeds.brokerUser))) {
      window.bioquadFeeds.switchBroker(url, uVal, pVal);
    }
    window.bioquadFeeds.sendTestPing();
  };

  window.handleMqttBroadcastToggle = function () {
    if (!window.bioquadFeeds) return;
    const pubName = $('mqtt-pub-name-input') ? $('mqtt-pub-name-input').value : '';
    const pubId = $('mqtt-pub-id-input') ? $('mqtt-pub-id-input').value : '';
    window.bioquadFeeds.togglePublishLocal(!window.bioquadFeeds.isPublishing, pubId, pubName);
  };

  window.handleSyncBufferInput = function (val) {
    if (!window.bioquadFeeds) return;
    window.bioquadFeeds.setPlayoutBufferMs(val);
    updateFeedsSyncTelemetryOnly();
  };

  window.toggleFeedRoute = function (localCh, feedId, remoteCh = 0) {
    if (!window.bioquadFeeds) return;
    const activeRoute = window.bioquadFeeds.toggleRoute(localCh, feedId, remoteCh);
    if (activeRoute) {
      if (window.dataStreamer) {
        const dsState = window.dataStreamer.getState();
        if (dsState && dsState.activeChannels && dsState.activeChannels[localCh] && dsState.activeChannels[localCh].active) {
          window.dataStreamer.clearChannel(localCh);
        }
      }
      if (window.viewMode === '1ch' && typeof window.selectChannelInCurrentView === 'function') {
        window.selectChannelInCurrentView(localCh);
      }
    }
    renderFeedsModal(false);
    updateTransportDeck();
  };

  // --- 7. EXPORT HELPERS ---
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

    setExportStatus('ready', 'READY', filename);

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
  window.clearPortalChannel = function (ch) {
    if (window.dataStreamer) {
      window.dataStreamer.clearChannel(ch);
    }
    if (window.bioquadFeeds) {
      const fState = window.bioquadFeeds.getState();
      if (fState.channelRoutes && fState.channelRoutes[ch]) {
        window.bioquadFeeds.assignRoute(ch, null);
      }
    }
    renderChannelsInModal();
    updateTransportDeck();
  };

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
        <div style="background: #121720; border: 1px solid ${hasData ? 'rgba(0,240,255,0.4)' : 'var(--border)'}; border-radius: 14px; padding: 9px 11px; display: flex; flex-direction: column; justify-content: space-between; gap: 7px;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
            <span style="display: inline-flex; align-items: center; gap: 6px; font-weight: 700; color: ${color}; font-size: 11px;">
              <span class="ch-pill-dot" style="background: ${color};"></span>
              <span>CH ${ch + 1}</span>
            </span>
            ${hasData ? `<button type="button" class="stream-btn" onclick="window.clearPortalChannel(${ch})" style="min-height: 20px; padding: 0 7px; font-size: 9px; color: #ff5577;">✕</button>` : ''}
          </div>
          <div style="font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${hasData ? '#c9d1d9' : '#6e7681'};">
            ${hasData ? escapeHtml(feed.label) : 'Empty'}
          </div>
          <button type="button" class="stream-btn" onclick="document.getElementById('portal-ch-file-input-${ch}').click()" style="width: 100%; justify-content: center; padding: 4px 10px; font-size: 10px;">
            Select File
          </button>
          <input type="file" id="portal-ch-file-input-${ch}" style="display:none;" accept=".csv,.tsv,.tab,.txt,.json,.xml,.dat,.log,text/csv,text/plain,application/json" onchange="window.handlePortalChFile(this, ${ch})">
        </div>
      `;
    }
    container.innerHTML = html;
  }

  window.handlePortalChFile = function (input, ch) {
    const file = input && input.files && input.files[0] ? input.files[0] : null;
    if (input) input.value = '';
    if (file) {
      handleFileInputChange(file, ch);
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

    const mappingControls = $('portal-mode-controls');
    if (mappingControls) {
      let html = '';
      if (mappingMode === 'multi_value_cols') {
        html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px;">';
        for (let ch = 0; ch < 4; ch++) {
          const activeCol = Object.keys(colToChMap).find(c => colToChMap[c] === ch) || '';
          html += `
            <div style="background: #161b22; padding: 8px; border: 1px solid var(--border); border-radius: 8px;">
              <div style="font-weight: 700; font-size: 10px; margin-bottom: 4px; color: ${CH_COLORS[ch]};">CH ${ch + 1}</div>
              <select onchange="window.setColMapping('${ch}', this.value)" style="width: 100%; background: #0d1117; color: #fff; border: 1px solid var(--border); padding: 4px 8px; border-radius: 999px; font-size: 11px;">
                <option value="">-- Ignore --</option>
                ${parsedPreview.columns.map(c => `<option value="${escapeHtml(c)}" ${c === activeCol ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
              </select>
            </div>
          `;
        }
        html += '</div>';
      } else if (mappingMode === 'multi_sensor_id') {
        const sensors = parsedPreview.guesses.sensorList || [];
        if (sensors.length >= 1) {
          html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px;">';
          sensors.slice(0, 4).forEach((s, idx) => {
            const chTarget = sensorToChMap[s] !== undefined ? sensorToChMap[s] : idx;
            const safeS = escapeHtml(s);
            html += `
              <div style="background: #161b22; padding: 8px; border: 1px solid var(--border); border-radius: 8px;">
                <div style="font-weight: 700; font-size: 10px; margin-bottom: 4px; color: #fff; overflow:hidden; text-overflow:ellipsis;">${safeS}</div>
                <select data-sensor="${safeS}" onchange="window.setSensorMapping(this.dataset.sensor, this.value)" style="width: 100%; background: #0d1117; color: ${CH_COLORS[chTarget]}; border: 1px solid var(--border); padding: 4px 8px; border-radius: 999px; font-size: 11px; font-weight: 700;">
                  <option value="0" ${chTarget === 0 ? 'selected' : ''}>CH 1</option>
                  <option value="1" ${chTarget === 1 ? 'selected' : ''}>CH 2</option>
                  <option value="2" ${chTarget === 2 ? 'selected' : ''}>CH 3</option>
                  <option value="3" ${chTarget === 3 ? 'selected' : ''}>CH 4</option>
                </select>
              </div>
            `;
          });
          html += '</div>';
        } else {
          html += '<div style="font-size: 11px; color: #6e7681;">No discrete series</div>';
        }
      } else if (mappingMode === 'single_channel') {
        html += '<div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">';
        html += '<span style="font-size: 11px; color: #8b949e;">Target:</span>';
        for (let ch = 0; ch < 4; ch++) {
          const active = targetSingleChannel === ch;
          html += `
            <button type="button" class="stream-btn" onclick="window.setTargetSingleCh(${ch})" style="color: ${CH_COLORS[ch]}; border-color: ${active ? 'var(--cyan)' : 'var(--border)'}; background: ${active ? '#000' : '#161b22'};">
              Channel ${ch + 1}
            </button>
          `;
        }
        html += '</div>';
      }
      mappingControls.innerHTML = html;
    }

    const idColWrap = $('portal-id-col-wrap');
    const idColSelect = $('portal-id-col-select');
    if (idColWrap && idColSelect) {
      idColWrap.style.display = mappingMode === 'multi_sensor_id' ? 'block' : 'none';
      idColSelect.innerHTML = '<option value="">None (Single Stream)</option>' +
        parsedPreview.columns.map(c => `<option value="${escapeHtml(c)}" ${c === selectedIdCol ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
    }

    const valColWrap = $('portal-val-col-wrap');
    const valColSelect = $('portal-val-col-select');
    if (valColWrap && valColSelect) {
      valColWrap.style.display = mappingMode !== 'multi_value_cols' ? 'block' : 'none';
      valColSelect.innerHTML = parsedPreview.columns.map(c => `<option value="${escapeHtml(c)}" ${c === selectedValueCol ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
    }

    const timeColSelect = $('portal-time-col-select');
    if (timeColSelect) {
      timeColSelect.innerHTML = '<option value="">Fixed Cadence Rate</option>' +
        parsedPreview.columns.map(c => `<option value="${escapeHtml(c)}" ${c === selectedTimeCol ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
    }

    const cadenceRateWrap = $('portal-cadence-rate-wrap');
    if (cadenceRateWrap) {
      cadenceRateWrap.style.display = !selectedTimeCol ? 'block' : 'none';
    }

    const tableHeader = $('portal-table-head');
    const tableBody = $('portal-table-body');
    if (tableHeader && tableBody) {
      tableHeader.innerHTML = parsedPreview.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('');
      let tbodyHtml = '';
      parsedPreview.sampleRows.slice(0, 5).forEach((row) => {
        tbodyHtml += '<tr>' + parsedPreview.columns.map(c => `<td>${row[c] !== null && row[c] !== undefined ? escapeHtml(row[c]) : '-'}</td>`).join('') + '</tr>';
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
    const ch = parseInt(chStr, 10);
    Object.keys(colToChMap).forEach(k => {
      if (colToChMap[k] === ch) delete colToChMap[k];
    });
    if (col) colToChMap[col] = ch;
  };

  window.setSensorMapping = function (sensor, chStr) {
    sensorToChMap[sensor] = parseInt(chStr, 10);
    renderMappingSection();
  };

  function showPortalError(msg) {
    const alertBox = $('portal-error-alert');
    if (alertBox) {
      alertBox.style.display = 'flex';
      $('portal-error-text').textContent = msg;
    }
  }

  function hidePortalError() {
    const alertBox = $('portal-error-alert');
    if (alertBox) alertBox.style.display = 'none';
  }

  window.hidePortalError = hidePortalError;

  // --- 9. EVENT LISTENERS & SETUP ---
  document.addEventListener('DOMContentLoaded', () => {
    updateDeckVisibility();

    const recBtn = $('btn-rec-stream');
    if (recBtn) {
      recBtn.addEventListener('click', () => {
        const rec = window.biodataRecorder;
        if (!rec) return;
        const sessionInput = $('stream-session-name');
        if (rec.isRecording) {
          rec.stop();
        } else {
          const typedName = sessionInput ? sessionInput.value.trim() : '';
          rec.start(typedName);
        }
      });
    }

    const sessionInput = $('stream-session-name');
    if (sessionInput) {
      if (window.biodataRecorder) {
        sessionInput.value = window.biodataRecorder.sessionName;
      }
      sessionInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitSessionNameFromInput();
          sessionInput.blur();
        }
      });
      sessionInput.addEventListener('change', () => {
        commitSessionNameFromInput();
      });
    }

    const searchInput = $('portal-takes-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        savedTakesSearch = e.target.value || '';
        renderSavedTakes();
      });
    }

    const sortSelect = $('portal-takes-sort');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        savedTakesSort = e.target.value || 'newest';
        renderSavedTakes();
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

    const recAutoBtn = $('btn-rec-auto');
    if (recAutoBtn) recAutoBtn.addEventListener('click', window.toggleRecordAutomationUI);

    const loopBtn = $('btn-loop-stream');
    if (loopBtn) loopBtn.addEventListener('click', () => window.dataStreamer?.toggleLoop());

    const autoBtn = $('btn-auto-stream');
    if (autoBtn) autoBtn.addEventListener('click', () => window.dataStreamer?.toggleFollowAutomation());

    const scrubber = $('stream-scrubber');
    if (scrubber) {
      scrubber.addEventListener('input', (e) => {
        window.dataStreamer?.seek(parseInt(e.target.value, 10));
      });
    }

    const speedBox = $('stream-speed-box') || $('stream-speed-val');
    if (speedBox) {
      let isDraggingSpeed = false;
      let speedStartX = 0;
      let speedStartY = 0;
      let speedStartRate = 1.0;
      let speedPointerType = 'mouse';

      speedBox.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
        const ds = window.dataStreamer;
        if (!ds) return;
        isDraggingSpeed = true;
        speedPointerType = e.pointerType || 'mouse';
        speedStartX = e.clientX;
        speedStartY = e.clientY;
        speedStartRate = ds.playbackRate || 1.0;
        speedBox.classList.add('is-dragging');
        if (speedPointerType !== 'touch') {
          if (speedBox.setPointerCapture) {
            try { speedBox.setPointerCapture(e.pointerId); } catch (err) {}
          }
          e.preventDefault();
        }
      });

      speedBox.addEventListener('pointermove', (e) => {
        if (!isDraggingSpeed) return;
        const ds = window.dataStreamer;
        if (!ds) return;
        let delta = 0;
        if (speedPointerType === 'touch') {
          const dx = e.clientX - speedStartX;
          const dy = e.clientY - speedStartY;
          if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
            isDraggingSpeed = false;
            speedBox.classList.remove('is-dragging');
            return;
          }
          if (Math.abs(dx) < 4) return;
          delta = dx;
        } else {
          delta = speedStartY - e.clientY;
        }
        const nextRate = Math.max(0.1, Math.min(5.0, Math.round((speedStartRate + delta * 0.02) * 10) / 10));
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
        window.dataStreamer?.setCadenceRps(parseInt(e.target.value, 10) || 30);
      });
    }

    const loadBtn = $('btn-open-portal');
    if (loadBtn) loadBtn.addEventListener('click', window.togglePortalModal);

    // Channel clear handlers (clears either file stream OR active Cloud Feed route)
    for (let ch = 0; ch < 4; ch++) {
      const clearBtn = $(`stream-ch-clear-${ch}`);
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          const ds = window.dataStreamer;
          const st = ds ? ds.getState() : null;
          if (st && st.activeChannels && st.activeChannels[ch] && st.activeChannels[ch].active) {
            ds.clearChannel(ch);
          } else if (window.bioquadFeeds) {
            window.bioquadFeeds.assignRoute(ch, null);
          }
          updateTransportDeck();
        });
      }
    }

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
        const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
        e.target.value = '';
        if (file) {
          handleFileInputChange(file);
        }
      });
    }

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
        cadenceRate = Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 30));
      });
    }

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
              if (feedback) feedback.textContent = 'Shared or saved via Share Sheet.';
            }).catch((err) => {
              if (!feedback) return;
              feedback.textContent = (err && err.name === 'AbortError')
                ? 'Share dismissed. Tap Share again or use Download File below.'
                : 'Share unavailable here. Tap Download File below instead.';
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
            feedback.textContent = 'Clipboard copy blocked. Use Download File instead.';
          }
        }
      });
    }

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
        else if (isFeedsModalOpen) window.closeFeedsModal();
        else if (isPortalModalOpen) closePortalModal();
      }
    });

    window.addEventListener('bioquad_stream_update', updateTransportDeck);
    window.addEventListener('bioquad_recorder_update', updateTransportDeck);
    window.addEventListener('bioquad_takes_updated', renderSavedTakes);
    window.addEventListener('bioquad_feeds_update', () => {
      if (isFeedsModalOpen) renderFeedsModal(false);
      updateToolbarIndicator();
    });
    window.addEventListener('bioquad_mqtt_telemetry', () => {
      if (isFeedsModalOpen) updateFeedsSyncTelemetryOnly();
    });

    setInterval(() => {
      if (isBoxVisible || (window.dataStreamer && window.dataStreamer.isPlaying) || (window.biodataRecorder && window.biodataRecorder.isRecording)) {
        updateTransportDeck();
      } else {
        updateToolbarIndicator();
      }
    }, 250);
    updateTransportDeck();
    renderSavedTakes();
  });

  window.updateStreamUI = updateTransportDeck;
})();
