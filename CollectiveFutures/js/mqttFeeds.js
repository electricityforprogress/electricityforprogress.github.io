/**
 * js/mqttFeeds.js
 * bioQuad Cloud MQTT Active Data Feeds & Multi-User Playout Sync Engine
 *
 * Features:
 * - Zero-dependency MQTT 3.1.1 over WebSockets ('wss://') client
 * - Live remote feed discovery (bioquad/feeds/+/meta) & telemetry subscription (bioquad/feeds/+/stream)
 * - Broadcast local USB / BLE / File streams to cloud MQTT rooms with UTC timestamps
 * - PlayoutSyncController schedules incoming MIDI notes & raw biodata spikes onto a shared
 *   jitter-buffered timeline so multiple listeners on laptops, phones, and tablets stay synced
 * - Built-in UTC-Locked Virtual Botanical Feeds (phase-synced across devices via wall-clock UTC)
 *   for instant collaborative multi-device testing without external hardware setup
 */
(function (window) {
  'use strict';

  const Core = window.BioQuadCore;

  const BROKER_PRESETS = {
    emqx: 'wss://broker.emqx.io:8084/mqtt',
    mosquitto: 'wss://test.mosquitto.org:8081/mqtt',
    hivemq: 'wss://broker.hivemq.com:8884/mqtt'
  };

  // Deterministic UTC-synchronized Botanical Feeds so multiple devices opening the app
  // simultaneously hear and visualize phase-locked plant biodata even before connecting an ESP32
  const UTC_BOTANICAL_FEEDS = [
    {
      feedId: 'utc-monstera-deliciosa',
      name: 'Conservatory Monstera #1',
      location: 'UTC Synced · Leaf Lamina',
      species: 'Monstera deliciosa',
      isVirtualUtc: true,
      baseTicks: 185000,
      swingTicks: 24000,
      seed: 0x1A2B3C4D,
      channels: 2,
      patches: [
        {
          patchName: 'Monstera Pluck',
          params: {
            voices: 6, stealMode: 'oldest', steal: 'oldest', legato: 0, glide: 0.04,
            minNote: 48, maxNote: 76, durMult: 0.85, density: 85, threshold: 2.0,
            scaleRoot: 2, scaleType: 'pentatonic_minor',
            sources: { osc1: { type: 'triangle', level: 1.0 }, noise: { level: 0.04 } },
            filter: { cutoff: 1850, res: 3.5 },
            ampEnv: { atk: 0.03, dec: 0.32, sus: 0.25, rel: 1.1, amt: 1.0, timeMode: 'norm' },
            filterEnv: { atk: 0.02, dec: 0.35, sus: 0.2, rel: 0.7, amt: 0.45, timeMode: 'norm' },
            fx: { drv: 0.05, drvGrit: 8, drvTone: 2200, drvLvl: 1.0, dly: 0.28, rev: 0.38 }
          }
        },
        {
          patchName: 'Leaf Sub Drone',
          params: {
            voices: 1, stealMode: 'env', steal: 'env', legato: 1, glide: 0.22,
            minNote: 30, maxNote: 50, durMult: 3.2, density: 60, threshold: 2.1,
            scaleRoot: 2, scaleType: 'pentatonic_minor',
            sources: { osc1: { type: 'sine', level: 1.0 }, noise: { level: 0.0 } },
            filter: { cutoff: 900, res: 1.8 },
            ampEnv: { atk: 0.45, dec: 0.8, sus: 0.85, rel: 2.4, amt: 1.0, timeMode: 'norm' },
            fx: { drv: 0.0, drvGrit: 10, drvTone: 1800, drvLvl: 1.0, dly: 0.15, rev: 0.45 }
          }
        }
      ]
    },
    {
      feedId: 'utc-mycelium-log',
      name: 'Deep Forest Mycelium Log',
      location: 'UTC Synced · Sapwood Colonization',
      species: 'Pleurotus ostreatus',
      isVirtualUtc: true,
      baseTicks: 245000,
      swingTicks: 38000,
      seed: 0x5E6F7788,
      channels: 2,
      patches: [
        {
          patchName: 'Sapwood Hirajoshi',
          params: {
            voices: 4, stealMode: 'oldest', steal: 'oldest', legato: 0, glide: 0.08,
            minNote: 44, maxNote: 78, durMult: 1.25, density: 75, threshold: 1.9,
            scaleRoot: 7, scaleType: 'hirajoshi',
            sources: { osc1: { type: 'sawtooth', level: 0.9 }, noise: { level: 0.06 } },
            filter: { cutoff: 1200, res: 4.5 },
            ampEnv: { atk: 0.08, dec: 0.45, sus: 0.4, rel: 1.6, amt: 1.0, timeMode: 'norm' },
            filterEnv: { atk: 0.06, dec: 0.5, sus: 0.3, rel: 0.9, amt: 0.5, timeMode: 'norm' },
            fx: { drv: 0.12, drvGrit: 12, drvTone: 1600, drvLvl: 1.0, dly: 0.35, rev: 0.52 }
          }
        },
        {
          patchName: 'Spore Pulse',
          params: {
            voices: 4, stealMode: 'oldest', steal: 'oldest', legato: 0, glide: 0.0,
            minNote: 36, maxNote: 54, durMult: 0.4, density: 50, quantize: 3, threshold: 2.2,
            scaleRoot: 7, scaleType: 'hirajoshi',
            sources: { osc1: { type: 'square', level: 0.8 }, noise: { level: 0.08 } },
            filter: { cutoff: 1600, res: 5.0 },
            ampEnv: { atk: 0.01, dec: 0.18, sus: 0.1, rel: 0.45, amt: 1.0, timeMode: 'norm' },
            fx: { drv: 0.08, drvGrit: 10, drvTone: 2000, drvLvl: 1.0, dly: 0.25, rev: 0.25 }
          }
        }
      ]
    },
    {
      feedId: 'utc-orchid-epiphyte',
      name: 'Cloud Forest Orchid Rig',
      location: 'UTC Synced · Aerial Root',
      species: 'Phalaenopsis',
      isVirtualUtc: true,
      baseTicks: 152000,
      swingTicks: 19000,
      seed: 0x91827364,
      channels: 1,
      patches: [
        {
          patchName: 'Orchid Glass Arp',
          params: {
            voices: 6, stealMode: 'oldest', steal: 'oldest', legato: 0, glide: 0.02,
            minNote: 60, maxNote: 92, durMult: 0.55, density: 90, quantize: 4, threshold: 1.85,
            scaleRoot: 0, scaleType: 'pentatonic_major',
            sources: { osc1: { type: 'sine', level: 1.0 }, noise: { level: 0.02 } },
            filter: { cutoff: 3600, res: 2.5 },
            ampEnv: { atk: 0.015, dec: 0.24, sus: 0.15, rel: 1.3, amt: 1.0, timeMode: 'norm' },
            fx: { drv: 0.0, drvGrit: 10, drvTone: 2400, drvLvl: 1.0, dly: 0.42, rev: 0.58 }
          }
        }
      ]
    }
  ];

  function hash32(x) {
    let t = (x + 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function makeEmptyChStats() {
    return Array.from({ length: 4 }, () => ({ msgCount: 0, lastSeen: 0 }));
  }

  class BioquadFeedsManager {
    constructor() {
      this.brokerUrl = localStorage.getItem('bioquad_mqtt_url') || BROKER_PRESETS.emqx;
      this.brokerUser = localStorage.getItem('bioquad_mqtt_user') || '';
      this.brokerPass = (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('bioquad_mqtt_pass') : '') || '';
      this.clientId = 'bq_' + Math.random().toString(36).slice(2, 10);
      this.ws = null;
      this.emptyBytes = new Uint8Array(0);
      this.rxRemainder = this.emptyBytes;
      this.isConnected = false;
      this.isConnecting = false;
      this.statusText = 'Standby';
      this.pingTimer = null;
      this.packetIdCounter = 1;

      // Discovered remote MQTT feeds: Map<feedId, { feedId, name, location, channels, lastSeen, msgCount, chStats, isVirtualUtc }>
      this.feeds = new Map();
      UTC_BOTANICAL_FEEDS.forEach(f => {
        this.feeds.set(f.feedId, { ...f, lastSeen: Date.now(), msgCount: 0, chStats: makeEmptyChStats() });
      });

      // Local Channel Routing: [ { feedId, remoteCh, followPatch } | null, ... ] for local CH 0..3
      this.channelRoutes = [null, null, null, null];
      this.lastAppliedPatchSig = [null, null, null, null];

      // Playout Synchronization per feedId
      this.playoutBufferMs = parseInt(localStorage.getItem('bioquad_sync_buffer_ms') || '180', 10);
      this.syncControllers = new Map();

      // Live Broker Wire Telemetry (for transparent verification in AI Studio & production)
      this.connectedHost = '';
      this.txCount = 0;
      this.rxCount = 0;
      this.echoCount = 0;
      this.lastRttMs = null;
      this.lastTopic = '';
      this.lastPingSentAt = 0;
      this.pendingTestPing = false;
      this.lastTelemetryEmitMs = 0;
      this.clearedRetainedTopics = new Set();

      // Local Broadcaster state + per-channel outgoing TX telemetry
      this.isPublishing = false;
      this.publishFeedId = localStorage.getItem('bioquad_pub_feed_id') || 'my-plant-rig-01';
      this.publishName = localStorage.getItem('bioquad_pub_feed_name') || 'Live BioQuad Rig';
      this.txChStats = makeEmptyChStats();
      this.metaAnnounceTimer = null;
      this.patchBroadcastTimers = [null, null, null, null];

      // Per-local-channel smooth raw sample playout queues (eliminates 100-200ms MQTT burst jumps)
      this.rawSampleQueues = [[], [], [], []];
      this.rawPacerStates = [null, null, null, null];
      this.rawPacerRafId = null;
      this.lastRafDrainMs = 0;

      // UTC Virtual Botanical Generator loop
      this.virtualTickTimer = null;
      this.lastProcessedUtcSlot = 0;
      this.virtualWindows = new Map();
      this.virtualLastTriggerMs = new Map();
      this.startVirtualUtcLoop();
    }

    captureLocalShareablePatch(chIdx) {
      if (!window.synthChannels || !window.synthChannels[chIdx] || !window.synthChannels[chIdx].params) {
        return null;
      }
      const ch = window.synthChannels[chIdx];
      if (Core && typeof Core.extractShareablePatch === 'function') {
        return Core.extractShareablePatch(ch.params, ch.patchName || 'INIT');
      }
      return {
        patchName: ch.patchName || 'INIT',
        params: JSON.parse(JSON.stringify(ch.params))
      };
    }

    captureAllLocalShareablePatches() {
      return [0, 1, 2, 3].map(ch => this.captureLocalShareablePatch(ch));
    }

    applyFeedPatchToLocalChannel(localCh, feedId, remoteCh, patchObj, force = false) {
      if (localCh < 0 || localCh > 3 || !patchObj) return false;
      const route = this.channelRoutes[localCh];
      if (!route || route.feedId !== feedId || (route.remoteCh || 0) !== remoteCh) return false;
      if (route.followPatch === false) return false;

      const sig = `${feedId}:${remoteCh}:${JSON.stringify(patchObj)}`;
      if (!force && this.lastAppliedPatchSig[localCh] === sig) {
        return false;
      }
      if (typeof window.applyRemotePatchToChannel === 'function') {
        const applied = window.applyRemotePatchToChannel(localCh, patchObj);
        if (applied) {
          this.lastAppliedPatchSig[localCh] = sig;
        }
        return applied;
      }
      return false;
    }

    notifyLocalSynthChanged(chIdx, attr = '') {
      if (chIdx < 0 || chIdx > 3) return;

      // 1. Listener customization override: if this channel is following a remote artist's patch,
      //    manually tweaking a synth knob/slider/scale immediately switches to CUSTOM mode so
      //    subsequent artist heartbeats/automation never clobber the user's custom sound!
      const route = this.channelRoutes[chIdx];
      if (route && route.followPatch !== false) {
        route.followPatch = false;
        this.lastAppliedPatchSig[chIdx] = null;
        this.emitUpdate();
      }

      // 2. Broadcaster live automation: if publishing, debounce-broadcast the updated channel patch
      //    to all subscribed listeners (unless this channel is purely receiving a remote stream).
      if (this.isPublishing && this.isConnected) {
        const isPureReceiver = Boolean(route && !(route.feedId === this.publishFeedId && (route.remoteCh || 0) === chIdx));
        if (!isPureReceiver) {
          if (this.patchBroadcastTimers[chIdx]) clearTimeout(this.patchBroadcastTimers[chIdx]);
          this.patchBroadcastTimers[chIdx] = setTimeout(() => {
            this.patchBroadcastTimers[chIdx] = null;
            this.broadcastChannelPatch(chIdx);
          }, 120);
        }
      }
    }

    broadcastChannelPatch(chIdx) {
      if (!this.isPublishing || !this.isConnected || chIdx < 0 || chIdx > 3) return false;
      const patch = this.captureLocalShareablePatch(chIdx);
      if (!patch) return false;

      const selfEntry = this.feeds.get(this.publishFeedId);
      if (selfEntry) {
        if (!Array.isArray(selfEntry.patches)) selfEntry.patches = [null, null, null, null];
        selfEntry.patches[chIdx] = patch;
      }

      return this.publishMqtt(`bioquad/feeds/${this.publishFeedId}/stream`, {
        type: 'patch',
        ch: chIdx,
        patch,
        name: this.publishName,
        senderId: this.clientId,
        feedId: this.publishFeedId,
        ts: Date.now()
      }, false);
    }

    extractHost(url) {
      try {
        return new URL(url).host;
      } catch (e) {
        return String(url || '').replace(/^wss?:\/\//i, '').split('/')[0];
      }
    }

    getSyncController(feedId) {
      if (!this.syncControllers.has(feedId)) {
        const ctrl = Core
          ? new Core.PlayoutSyncController({ playoutBufferMs: this.playoutBufferMs })
          : null;
        this.syncControllers.set(feedId, ctrl);
      }
      return this.syncControllers.get(feedId);
    }

    setPlayoutBufferMs(ms) {
      const clamped = Math.max(40, Math.min(1000, parseInt(ms, 10) || 180));
      this.playoutBufferMs = clamped;
      localStorage.setItem('bioquad_sync_buffer_ms', String(clamped));
      this.syncControllers.forEach(ctrl => {
        if (ctrl) ctrl.setPlayoutBufferMs(clamped);
      });
      this.emitUpdate();
    }

    setBrokerUrl(url) {
      const clean = String(url || '').trim();
      if (!clean) return;
      this.brokerUrl = clean;
      localStorage.setItem('bioquad_mqtt_url', clean);
      this.emitUpdate();
    }

    setBrokerCredentials(username = '', password = '') {
      this.brokerUser = String(username || '').trim();
      this.brokerPass = String(password || '');
      try {
        localStorage.setItem('bioquad_mqtt_user', this.brokerUser);
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('bioquad_mqtt_pass', this.brokerPass);
        }
      } catch (e) {}
    }

    switchBroker(newUrl, username, password) {
      const clean = String(newUrl || '').trim();
      if (!clean) return;
      const changedUrl = clean !== this.brokerUrl;
      const changedCreds = (username !== undefined && String(username).trim() !== this.brokerUser) ||
        (password !== undefined && String(password) !== this.brokerPass);
      if (username !== undefined || password !== undefined) {
        this.setBrokerCredentials(
          username !== undefined ? username : this.brokerUser,
          password !== undefined ? password : this.brokerPass
        );
      }
      this.setBrokerUrl(clean);
      if (this.isConnected || this.isConnecting) {
        if (changedUrl || changedCreds) {
          this.disconnectBroker();
          this.connectBroker(clean);
        }
      }
    }

    connectBroker(customUrl, customUser, customPass) {
      if (customUser !== undefined || customPass !== undefined) {
        this.setBrokerCredentials(
          customUser !== undefined ? customUser : this.brokerUser,
          customPass !== undefined ? customPass : this.brokerPass
        );
      }
      if (customUrl) this.setBrokerUrl(customUrl);
      if (this.isConnected || this.isConnecting) {
        this.disconnectBroker();
        return;
      }

      if (!Core || !Core.MqttCodec) {
        this.statusText = 'MQTT codec unavailable';
        this.emitUpdate();
        return;
      }

      this.isConnecting = true;
      this.connectedHost = '';
      this.txCount = 0;
      this.rxCount = 0;
      this.echoCount = 0;
      this.lastRttMs = null;
      this.lastTopic = '';
      this.txChStats = makeEmptyChStats();
      this.clearedRetainedTopics.clear();
      const targetHost = this.extractHost(this.brokerUrl);
      this.statusText = `Connecting ${targetHost}...`;
      this.rxRemainder = this.emptyBytes;
      this.emitUpdate();

      try {
        const ws = new WebSocket(this.brokerUrl, 'mqtt');
        ws.binaryType = 'arraybuffer';
        this.ws = ws;

        const connTimeout = setTimeout(() => {
          if (!this.isConnected && this.ws === ws) {
            try { ws.close(); } catch (e) {}
            this.isConnecting = false;
            this.statusText = 'Timeout';
            this.emitUpdate();
          }
        }, 8000);

        ws.onopen = () => {
          if (this.ws !== ws) return;
          const connectPkt = Core.MqttCodec.encodeConnect(
            this.clientId,
            30,
            this.brokerUser || '',
            this.brokerPass || ''
          );
          ws.send(connectPkt);
        };

        ws.onmessage = (evt) => {
          if (this.ws !== ws) return;
          if (!(evt.data instanceof ArrayBuffer)) return;
          const incoming = new Uint8Array(evt.data);
          const combined = this.rxRemainder.length > 0
            ? Core.concatBytes([this.rxRemainder, incoming])
            : incoming;
          const decoded = Core.MqttCodec.decodePackets(combined);
          this.rxRemainder = decoded.remaining.length > 0
            ? (combined === incoming ? decoded.remaining.slice() : decoded.remaining)
            : this.emptyBytes;

          for (let i = 0; i < decoded.packets.length; i++) {
            const pkt = decoded.packets[i];
            if (pkt.type === 'connack') {
              clearTimeout(connTimeout);
              if (pkt.returnCode === 0) {
                this.isConnected = true;
                this.isConnecting = false;
                this.connectedHost = targetHost;
                this.statusText = `Connected · ${targetHost}`;
                this.subscribeTopics([
                  'bioquad/feeds/+/meta',
                  'bioquad/feeds/+/stream',
                  'bioquad/feeds/+/ping'
                ]);
                this.startPingLoop();
                if (this.isPublishing) {
                  this.announceLocalFeedMeta();
                }
                if (this.pendingTestPing) {
                  this.pendingTestPing = false;
                  setTimeout(() => this.sendTestPing(), 80);
                }
                this.emitUpdate();
              } else {
                const authErr = (pkt.returnCode === 4 || pkt.returnCode === 5);
                this.disconnectBroker();
                this.statusText = authErr ? 'Auth Rejected (check User/Pass)' : `Rejected (${pkt.returnCode})`;
                this.emitUpdate();
              }
            } else if (pkt.type === 'suback') {
              // Confirm broker subscription is live
              this.emitTelemetryTick();
            } else if (pkt.type === 'pingresp') {
              if (this.lastPingSentAt > 0) {
                this.lastRttMs = Math.max(1, Date.now() - this.lastPingSentAt);
                this.lastPingSentAt = 0;
                this.emitTelemetryTick();
              }
            } else if (pkt.type === 'publish') {
              this.handleIncomingPublish(pkt.topic, pkt.payloadText, Boolean(pkt.retain));
            }
          }
        };

        ws.onerror = () => {
          if (this.ws !== ws) return;
          clearTimeout(connTimeout);
          this.statusText = 'Unreachable';
          this.isConnecting = false;
          this.isConnected = false;
          this.connectedHost = '';
          this.emitUpdate();
        };

        ws.onclose = () => {
          if (this.ws !== ws) return;
          clearTimeout(connTimeout);
          const wasActive = this.isConnected;
          this.isConnected = false;
          this.isConnecting = false;
          this.connectedHost = '';
          this.stopPingLoop();
          if (wasActive) {
            this.statusText = 'Disconnected';
          }
          this.emitUpdate();
        };
      } catch (err) {
        this.isConnecting = false;
        this.isConnected = false;
        this.connectedHost = '';
        this.statusText = 'Invalid URL';
        this.emitUpdate();
      }
    }

    disconnectBroker() {
      this.stopPingLoop();
      this.pendingTestPing = false;
      if (this.metaAnnounceTimer) {
        clearInterval(this.metaAnnounceTimer);
        this.metaAnnounceTimer = null;
      }
      const oldWs = this.ws;
      this.ws = null;
      if (oldWs) {
        try {
          if (oldWs.readyState === WebSocket.OPEN && Core?.MqttCodec) {
            oldWs.send(Core.MqttCodec.encodeDisconnect());
          }
          oldWs.close();
        } catch (e) {}
      }
      this.isConnected = false;
      this.isConnecting = false;
      this.connectedHost = '';
      this.statusText = 'Standby';
      // Prune remote/echoed MQTT feeds when disconnected from broker so STREAMS stays truthful
      for (const [fid, f] of this.feeds.entries()) {
        if (!f.isVirtualUtc) {
          this.feeds.delete(fid);
        }
      }
      if (window.chData) {
        for (let c = 0; c < 4; c++) {
          if (window.chData[c]) window.chData[c].mqttEnvSensor = null;
        }
      }
      if (typeof window.refreshAllSensorHUDs === 'function') {
        window.refreshAllSensorHUDs();
      }
      this.emitUpdate();
    }

    subscribeTopics(topics) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !Core?.MqttCodec) return;
      const pktId = (this.packetIdCounter++ & 0xFFFF) || 1;
      const pkt = Core.MqttCodec.encodeSubscribe(pktId, topics);
      this.ws.send(pkt);
    }

    publishMqtt(topic, objOrStr, retain = false) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isConnected || !Core?.MqttCodec) return false;
      const text = typeof objOrStr === 'string' ? objOrStr : JSON.stringify(objOrStr);
      const pkt = Core.MqttCodec.encodePublish(topic, text, retain);
      try {
        this.ws.send(pkt);
        this.txCount++;
        this.lastTopic = topic;
        this.emitTelemetryTick();
        return true;
      } catch (e) {
        return false;
      }
    }

    sendTestPing() {
      if (!this.isConnected) {
        this.pendingTestPing = true;
        if (!this.isConnecting) {
          this.connectBroker();
        }
        return false;
      }
      const probeTopic = `bioquad/feeds/${this.publishFeedId}/ping`;
      return this.publishMqtt(probeTopic, {
        type: 'ping',
        senderId: this.clientId,
        feedId: this.publishFeedId,
        ts: Date.now()
      }, false);
    }

    clearRetainedTopic(topic) {
      if (!topic || this.clearedRetainedTopics.has(topic)) return false;
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isConnected || !Core?.MqttCodec) return false;
      this.clearedRetainedTopics.add(topic);
      try {
        // MQTT 3.1.1 Section 3.3.1.3: zero-byte payload with RETAIN=1 deletes the retained message on the broker
        const pkt = Core.MqttCodec.encodePublish(topic, '', true);
        this.ws.send(pkt);
        return true;
      } catch (e) {
        return false;
      }
    }

    purgeStaleFeeds(forceAllIdle = false) {
      const now = Date.now();
      let changed = false;
      for (const [fid, f] of this.feeds.entries()) {
        if (f.isVirtualUtc) continue;
        const isRouted = this.channelRoutes.some(r => r && r.feedId === fid);
        const isOwnActive = this.isPublishing && fid === this.publishFeedId;
        if (isRouted || isOwnActive) continue;
        const isStale = (now - (f.lastSeen || 0)) > 35000;
        const isIdle = (f.msgCount || 0) === 0;
        if (isStale || (forceAllIdle && isIdle)) {
          this.clearRetainedTopic(`bioquad/feeds/${fid}/meta`);
          this.feeds.delete(fid);
          changed = true;
        }
      }
      if (changed) this.emitUpdate();
      return changed;
    }

    startPingLoop() {
      this.stopPingLoop();
      this.pingTimer = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN && Core?.MqttCodec) {
          try {
            this.lastPingSentAt = Date.now();
            this.ws.send(Core.MqttCodec.encodePingReq());
          } catch (e) {}
        }
        this.purgeStaleFeeds(false);
      }, 15000);
    }

    stopPingLoop() {
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
    }

    togglePublishLocal(enable, feedIdInput, feedNameInput) {
      const prevFeedId = this.publishFeedId;
      if (feedIdInput) {
        this.publishFeedId = Core
          ? Core.sanitizeSessionFilename(feedIdInput, 'feed').toLowerCase()
          : String(feedIdInput).replace(/[^a-zA-Z0-9_-]/g, '-');
        localStorage.setItem('bioquad_pub_feed_id', this.publishFeedId);
      }
      if (feedNameInput) {
        this.publishName = String(feedNameInput).trim().slice(0, 48) || 'Live BioQuad Rig';
        localStorage.setItem('bioquad_pub_feed_name', this.publishName);
      }

      if (prevFeedId && prevFeedId !== this.publishFeedId) {
        const oldSelf = this.feeds.get(prevFeedId);
        if (oldSelf && oldSelf.isSelfBroadcast) {
          this.feeds.delete(prevFeedId);
        }
      }

      this.isPublishing = enable !== undefined ? Boolean(enable) : !this.isPublishing;

      if (this.isPublishing) {
        this.txChStats = makeEmptyChStats();
        // Ensure local loopback entry appears immediately in STREAMS so user can pre-assign mirror routes
        const existing = this.feeds.get(this.publishFeedId);
        this.feeds.set(this.publishFeedId, {
          feedId: this.publishFeedId,
          name: this.publishName,
          location: `Loopback · ${this.connectedHost || 'Broker'}`,
          species: 'Active Broadcast',
          channels: 4,
          isVirtualUtc: false,
          isSelfBroadcast: true,
          lastSeen: Date.now(),
          msgCount: existing ? (existing.msgCount || 0) : 0,
          chStats: existing && Array.isArray(existing.chStats) ? existing.chStats : makeEmptyChStats(),
          patches: this.captureAllLocalShareablePatches()
        });

        if (!this.isConnected && !this.isConnecting) {
          this.connectBroker();
        } else if (this.isConnected) {
          this.announceLocalFeedMeta();
        }
        if (this.metaAnnounceTimer) clearInterval(this.metaAnnounceTimer);
        this.metaAnnounceTimer = setInterval(() => {
          if (this.isPublishing && this.isConnected) this.announceLocalFeedMeta();
        }, 8000);
      } else {
        if (this.metaAnnounceTimer) {
          clearInterval(this.metaAnnounceTimer);
          this.metaAnnounceTimer = null;
        }
        for (let ch = 0; ch < 4; ch++) {
          if (this.patchBroadcastTimers[ch]) {
            clearTimeout(this.patchBroadcastTimers[ch]);
            this.patchBroadcastTimers[ch] = null;
          }
        }
        if (this.isConnected) {
          this.clearRetainedTopic(`bioquad/feeds/${this.publishFeedId}/meta`);
          this.publishMqtt(`bioquad/feeds/${this.publishFeedId}/meta`, {
            feedId: this.publishFeedId,
            name: this.publishName,
            senderId: this.clientId,
            ts: Date.now(),
            online: false
          }, false);
        }
        const isRouted = this.channelRoutes.some(r => r && r.feedId === this.publishFeedId);
        if (!isRouted) {
          this.feeds.delete(this.publishFeedId);
        }
      }
      this.emitUpdate();
    }

    announceLocalFeedMeta() {
      if (!this.isConnected) return;
      // Clear any legacy retained message on our own meta topic first, then publish non-retained live heartbeat
      this.clearRetainedTopic(`bioquad/feeds/${this.publishFeedId}/meta`);
      const patches = this.captureAllLocalShareablePatches();
      const selfEntry = this.feeds.get(this.publishFeedId);
      if (selfEntry) selfEntry.patches = patches;
      const localEnv = window.localHwEnvSensor || null;
      const meta = {
        feedId: this.publishFeedId,
        name: this.publishName,
        location: 'Live Browser / USB Gateway',
        channels: 4,
        patches,
        ...(localEnv ? {
          sensor: localEnv.sensor || 'sht4x',
          tC: localEnv.tC,
          tF: localEnv.tF,
          rh: localEnv.rh
        } : {}),
        senderId: this.clientId,
        ts: Date.now(),
        online: true
      };
      this.publishMqtt(`bioquad/feeds/${this.publishFeedId}/meta`, meta, false);
    }

    broadcastTelemetryEvent(payload) {
      if (!this.isPublishing || !this.isConnected || !payload) return;
      const hasCh = typeof payload.ch === 'number' && payload.ch >= 0 && payload.ch <= 3;
      const ch = hasCh ? payload.ch : 0;
      const now = Date.now();
      const packet = {
        ...payload,
        name: this.publishName,
        senderId: this.clientId,
        feedId: this.publishFeedId,
        ts: payload.ts && payload.ts > 1700000000000 ? payload.ts : now
      };
      if (this.publishMqtt(`bioquad/feeds/${this.publishFeedId}/stream`, packet, false)) {
        if (hasCh && payload.type !== 'env') {
          const wasIdleTx = this.txChStats[ch].msgCount === 0;
          this.txChStats[ch].msgCount += 1;
          this.txChStats[ch].lastSeen = now;
          if (wasIdleTx) {
            this.emitUpdate();
          }
        }
      }
    }

    handleIncomingPublish(topic, payloadText, isRetained = false) {
      if (!topic || !payloadText) return;
      const parts = topic.split('/');
      if (parts.length < 4 || parts[0] !== 'bioquad' || parts[1] !== 'feeds') return;
      const feedId = parts[2];
      const subType = parts[3];

      let data = null;
      try {
        data = JSON.parse(payloadText.trim());
      } catch (e) {
        return;
      }
      if (!data) return;

      if (subType === 'meta') {
        const isFresh = Core && typeof Core.isLiveFeedMetaFresh === 'function'
          ? Core.isLiveFeedMetaFresh(data, Date.now(), 25000, isRetained)
          : (data.online !== false && (!isRetained || (typeof data.ts === 'number' && Math.abs(Date.now() - data.ts) <= 25000)));

        if (!isFresh) {
          // Stale retained message from a past session on public broker: wipe it off the broker and ignore it!
          if (isRetained) {
            this.clearRetainedTopic(topic);
          }
          const isRouted = this.channelRoutes.some(r => r && r.feedId === feedId);
          if (!isRouted && this.feeds.has(feedId)) {
            this.feeds.delete(feedId);
            this.emitUpdate();
          }
          return;
        }
      }

      this.rxCount++;
      this.lastTopic = topic;

      const isSelfEcho = Boolean((data.senderId && data.senderId === this.clientId) || (this.isPublishing && feedId === this.publishFeedId));
      if (data.senderId && data.senderId === this.clientId) {
        this.echoCount++;
        if (typeof data.ts === 'number' && data.ts > 1700000000000) {
          this.lastRttMs = Math.max(1, Date.now() - data.ts);
        }
      }

      if (subType === 'ping') {
        this.emitTelemetryTick(true);
        return;
      }

      if (subType === 'meta') {
        if (isRetained) {
          this.clearRetainedTopic(topic);
        }
        const hadPrev = this.feeds.has(feedId);
        const prev = this.feeds.get(feedId) || {};
        const nextName = data.name || feedId;
        const nextLoc = isSelfEcho ? `Loopback · ${this.connectedHost || 'Broker'}` : (data.location || 'Remote Cloud Feed');
        const nextSpecies = isSelfEcho ? 'Active Broadcast' : (data.species || 'Live Plant Sensor');
        const nextChannels = data.channels || 4;
        const nextPatches = Array.isArray(data.patches)
          ? data.patches.slice(0, 4)
          : (Array.isArray(prev.patches) ? prev.patches : [null, null, null, null]);
        const nextPatchSig = Array.isArray(data.patches) ? JSON.stringify(nextPatches) : (prev._patchSig || '');
        const metaEnv = (Core && typeof Core.normalizeEnvSensorPayload === 'function')
          ? Core.normalizeEnvSensorPayload(data)
          : null;
        const nextEnv = metaEnv || prev.env || null;

        const metaChanged = !hadPrev ||
          prev.name !== nextName ||
          prev.location !== nextLoc ||
          prev.species !== nextSpecies ||
          prev.channels !== nextChannels ||
          Boolean(prev.isSelfBroadcast) !== isSelfEcho ||
          prev._patchSig !== nextPatchSig;

        this.feeds.set(feedId, {
          feedId,
          name: nextName,
          location: nextLoc,
          species: nextSpecies,
          channels: nextChannels,
          isVirtualUtc: false,
          isSelfBroadcast: isSelfEcho,
          lastSeen: Date.now(),
          msgCount: prev.msgCount || 0,
          chStats: Array.isArray(prev.chStats) && prev.chStats.length === 4 ? prev.chStats : makeEmptyChStats(),
          patches: nextPatches,
          _patchSig: nextPatchSig,
          env: nextEnv
        });

        // Apply artist patches & refresh environmental sensor HUD for any local channels routed to this feed
        for (let localCh = 0; localCh < 4; localCh++) {
          const rt = this.channelRoutes[localCh];
          if (rt && rt.feedId === feedId) {
            if (nextEnv && window.chData && window.chData[localCh] && !window.chData[localCh].mqttEnvSensor) {
              window.chData[localCh].mqttEnvSensor = nextEnv;
            }
            if (rt.followPatch !== false && metaChanged) {
              const pObj = nextPatches[rt.remoteCh || 0];
              if (pObj) {
                this.applyFeedPatchToLocalChannel(localCh, feedId, rt.remoteCh || 0, pObj, false);
              }
            }
          }
        }
        if (nextEnv && typeof window.refreshAllSensorHUDs === 'function') {
          window.refreshAllSensorHUDs();
        }
        if (metaChanged) {
          this.emitUpdate();
        } else {
          this.emitTelemetryTick();
        }
        return;
      }

      if (subType === 'stream') {
        const isNewFeed = !this.feeds.has(feedId);
        if (isNewFeed) {
          this.feeds.set(feedId, {
            feedId,
            name: isSelfEcho ? this.publishName : (data.name || feedId),
            location: isSelfEcho ? `Loopback · ${this.connectedHost || 'Broker'}` : 'Remote Cloud Stream',
            species: isSelfEcho ? 'Active Broadcast' : 'Live Sensor',
            channels: 4,
            isVirtualUtc: false,
            isSelfBroadcast: isSelfEcho,
            lastSeen: Date.now(),
            msgCount: 0,
            chStats: makeEmptyChStats(),
            patches: [null, null, null, null],
            env: null
          });
        }
        const entry = this.feeds.get(feedId);
        if (data.name && !isSelfEcho) entry.name = data.name;
        if (isSelfEcho) entry.isSelfBroadcast = true;
        if (!Array.isArray(entry.chStats) || entry.chStats.length < 4) {
          entry.chStats = makeEmptyChStats();
        }
        if (!Array.isArray(entry.patches) || entry.patches.length < 4) {
          entry.patches = [null, null, null, null];
        }
        const rCh = Math.max(0, Math.min(3, typeof data.ch === 'number' ? data.ch : 0));
        entry.lastSeen = Date.now();

        if (data.type === 'patch' && data.patch) {
          entry.patches[rCh] = data.patch;
          for (let localCh = 0; localCh < 4; localCh++) {
            const rt = this.channelRoutes[localCh];
            if (rt && rt.feedId === feedId && (rt.remoteCh || 0) === rCh && rt.followPatch !== false) {
              this.applyFeedPatchToLocalChannel(localCh, feedId, rCh, data.patch, false);
            }
          }
          this.emitUpdate();
          return;
        }

        if (data.type === 'env') {
          const envObj = (Core && typeof Core.normalizeEnvSensorPayload === 'function')
            ? Core.normalizeEnvSensorPayload(data)
            : null;
          entry.msgCount = (entry.msgCount || 0) + 1;
          if (envObj) {
            entry.env = envObj;
            for (let localCh = 0; localCh < 4; localCh++) {
              const rt = this.channelRoutes[localCh];
              if (!rt || rt.feedId !== feedId) continue;
              if (envObj.ch === null || envObj.ch === undefined || (rt.remoteCh || 0) === envObj.ch) {
                if (window.chData && window.chData[localCh]) {
                  window.chData[localCh].mqttEnvSensor = envObj;
                }
              }
            }
            if (typeof window.refreshAllSensorHUDs === 'function') {
              window.refreshAllSensorHUDs();
            }
          }
          if (isNewFeed) this.emitUpdate();
          else this.emitTelemetryTick();
          return;
        }

        const wasIdleCh = entry.chStats[rCh].msgCount === 0;
        entry.msgCount = (entry.msgCount || 0) + 1;
        entry.chStats[rCh].msgCount += 1;
        if (data.type === 'raw') {
          entry.chStats[rCh].rawCount = (entry.chStats[rCh].rawCount || 0) + 1;
        } else if (data.type === 'note') {
          entry.chStats[rCh].noteCount = (entry.chStats[rCh].noteCount || 0) + 1;
        }
        entry.chStats[rCh].lastSeen = entry.lastSeen;

        if (isNewFeed || wasIdleCh) {
          this.emitUpdate();
        } else {
          this.emitTelemetryTick();
        }

        // Dispatch incoming stream packet to any local channel routed to (feedId, rCh)
        this.dispatchSyncedFeedPacket(feedId, data);
      }
    }

    resetChannelBuffers(localCh) {
      if (localCh >= 0 && localCh <= 3) {
        this.rawSampleQueues[localCh] = [];
        this.rawPacerStates[localCh] = null;
      }
      if (window.chData && window.chData[localCh]) {
        window.chData[localCh].waveBuffer = [];
        window.chData[localCh].vizBuffer = [];
        window.chData[localCh].notes = [];
        window.chData[localCh].mqttEnvSensor = null;
      }
    }

    assignRoute(localCh, feedIdOrEmpty, remoteCh = 0, followPatch = true) {
      if (localCh < 0 || localCh > 3) return;
      const prev = this.channelRoutes[localCh];
      if (!feedIdOrEmpty) {
        if (prev) this.resetChannelBuffers(localCh);
        this.channelRoutes[localCh] = null;
        this.lastAppliedPatchSig[localCh] = null;
      } else {
        if (window.audioCtx && window.audioCtx.state === 'suspended') {
          window.audioCtx.resume().catch(() => {});
        }
        if (typeof window.ensureSynths === 'function') window.ensureSynths();
        const rCh = Math.max(0, Math.min(3, parseInt(remoteCh, 10) || 0));
        const routeChanged = !prev || prev.feedId !== feedIdOrEmpty || prev.remoteCh !== rCh;
        if (routeChanged) {
          this.resetChannelBuffers(localCh);
          this.lastAppliedPatchSig[localCh] = null;
        }
        const shouldFollow = followPatch !== undefined ? Boolean(followPatch) : true;
        this.channelRoutes[localCh] = {
          feedId: feedIdOrEmpty,
          remoteCh: rCh,
          followPatch: shouldFollow
        };

        const feed = this.feeds.get(feedIdOrEmpty);
        if (feed && feed.env && window.chData && window.chData[localCh]) {
          window.chData[localCh].mqttEnvSensor = feed.env;
        }

        if (shouldFollow) {
          let patchObj = feed && Array.isArray(feed.patches) ? feed.patches[rCh] : null;
          if (!patchObj && this.isPublishing && feedIdOrEmpty === this.publishFeedId) {
            patchObj = this.captureLocalShareablePatch(rCh);
          }
          if (patchObj) {
            this.applyFeedPatchToLocalChannel(localCh, feedIdOrEmpty, rCh, patchObj, true);
          }
        }
      }
      if (typeof window.refreshAllSensorHUDs === 'function') {
        window.refreshAllSensorHUDs();
      }
      this.emitUpdate();
    }

    setRouteFollowPatch(localCh, enable) {
      if (localCh < 0 || localCh > 3) return false;
      const route = this.channelRoutes[localCh];
      if (!route) return false;
      const nextFollow = Boolean(enable);
      route.followPatch = nextFollow;
      if (nextFollow) {
        this.lastAppliedPatchSig[localCh] = null;
        const feed = this.feeds.get(route.feedId);
        let patchObj = feed && Array.isArray(feed.patches) ? feed.patches[route.remoteCh || 0] : null;
        if (!patchObj && this.isPublishing && route.feedId === this.publishFeedId) {
          patchObj = this.captureLocalShareablePatch(route.remoteCh || 0);
        }
        if (patchObj) {
          this.applyFeedPatchToLocalChannel(localCh, route.feedId, route.remoteCh || 0, patchObj, true);
        }
      }
      this.emitUpdate();
      return nextFollow;
    }

    toggleRouteFollowPatch(localCh) {
      if (localCh < 0 || localCh > 3) return false;
      const route = this.channelRoutes[localCh];
      if (!route) return false;
      return this.setRouteFollowPatch(localCh, route.followPatch === false);
    }

    toggleRoute(localCh, feedId, remoteCh = 0) {
      if (localCh < 0 || localCh > 3) return null;
      const nextRoutes = Core && typeof Core.toggleChannelRoute === 'function'
        ? Core.toggleChannelRoute(this.channelRoutes, localCh, feedId, remoteCh, true)
        : (() => {
            const copy = this.channelRoutes.slice();
            const cur = copy[localCh];
            const rCh = Math.max(0, Math.min(3, parseInt(remoteCh, 10) || 0));
            copy[localCh] = (cur && cur.feedId === feedId && cur.remoteCh === rCh)
              ? null
              : (feedId ? { feedId: String(feedId), remoteCh: rCh, followPatch: true } : null);
            return copy;
          })();
      const target = nextRoutes[localCh];
      if (target) {
        this.assignRoute(localCh, target.feedId, target.remoteCh, target.followPatch !== false);
      } else {
        this.assignRoute(localCh, null);
      }
      return this.channelRoutes[localCh];
    }

    clearAllRoutes() {
      for (let ch = 0; ch < 4; ch++) {
        if (this.channelRoutes[ch]) this.resetChannelBuffers(ch);
      }
      this.channelRoutes = [null, null, null, null];
      this.lastAppliedPatchSig = [null, null, null, null];
      if (typeof window.refreshAllSensorHUDs === 'function') {
        window.refreshAllSensorHUDs();
      }
      this.emitUpdate();
    }

    getActiveRouteCount() {
      return this.channelRoutes.filter(Boolean).length;
    }

    isLocalChPlayingFileStream(localCh) {
      return Boolean(
        window.dataStreamer &&
        typeof window.dataStreamer.isChannelPlayingStream === 'function' &&
        window.dataStreamer.isChannelPlayingStream(localCh)
      );
    }

    dispatchSyncedFeedPacket(feedId, packet) {
      const remoteCh = typeof packet.ch === 'number' ? packet.ch : 0;
      const matchingLocalChs = [];
      for (let localCh = 0; localCh < 4; localCh++) {
        const route = this.channelRoutes[localCh];
        if (route && route.feedId === feedId && route.remoteCh === remoteCh) {
          if (!this.isLocalChPlayingFileStream(localCh)) {
            matchingLocalChs.push(localCh);
          }
        }
      }
      if (matchingLocalChs.length === 0) return;

      const syncCtrl = this.getSyncController(feedId);
      const nowMs = Date.now();
      const sched = syncCtrl
        ? syncCtrl.schedule(packet.ts || nowMs, nowMs)
        : { delayMs: 15, audioTimeOffsetSec: 0.015, dropped: false };

      if (sched.dropped) return;

      const baseTargetAudioTime = (window.audioCtx ? window.audioCtx.currentTime : 0) + sched.audioTimeOffsetSec;
      const feedEntry = this.feeds.get(feedId);
      const chStat = (feedEntry && Array.isArray(feedEntry.chStats)) ? feedEntry.chStats[remoteCh] : null;
      const hasRawStream = Boolean(
        (feedEntry && feedEntry.isVirtualUtc) ||
        (chStat && (chStat.rawCount || 0) > 0)
      );
      const isRawOnlyRemote = Boolean(
        feedEntry &&
        !feedEntry.isVirtualUtc &&
        chStat &&
        (chStat.rawCount || 0) >= 6 &&
        (chStat.noteCount || 0) === 0
      );

      for (let i = 0; i < matchingLocalChs.length; i++) {
        const targetLocalCh = matchingLocalChs[i];
        const route = this.channelRoutes[targetLocalCh];
        const isCustomMode = Boolean(route && route.followPatch === false);

        if (packet.type === 'note') {
          // If listener switched this channel to CUSTOM and the feed provides raw biodata,
          // let local Threshold/Window/Density/Scale evaluate the raw stream instead of sender's pre-baked notes.
          if (isCustomMode && hasRawStream) {
            continue;
          }

          let chAudioTime = baseTargetAudioTime;
          let chDelayMs = Math.max(0, sched.delayMs);
          const synthCh = window.synthChannels ? window.synthChannels[targetLocalCh] : null;
          const quantStep = (synthCh && synthCh.params) ? Math.round(Number(synthCh.params.quantize) || 0) : 0;
          if (quantStep > 0 && window.bioClock && typeof window.bioClock.quantizeAudioTime === 'function') {
            chAudioTime = window.bioClock.quantizeAudioTime(baseTargetAudioTime, quantStep);
            const nowAudio = window.audioCtx ? window.audioCtx.currentTime : 0;
            chDelayMs = Math.max(0, (chAudioTime - nowAudio) * 1000);
          }

          if (typeof window.sendMidiNote === 'function') {
            window.sendMidiNote(targetLocalCh, packet.n, packet.v, packet.d || 250, chAudioTime);
          }
          setTimeout(() => {
            if (this.isLocalChPlayingFileStream(targetLocalCh)) return;
            if (typeof window.processBiodata === 'function') {
              window.processBiodata(
                { ...packet, ch: targetLocalCh, _audioAlreadyScheduled: true },
                'mqtt'
              );
            }
          }, Math.min(4000, Math.round(chDelayMs)));
        } else if (packet.type === 'raw' && Array.isArray(packet.p) && packet.p.length > 0) {
          const sonifyRawLocally = isCustomMode || isRawOnlyRemote;
          this.enqueueSmoothRawPacket(targetLocalCh, packet.p, Math.max(0, sched.delayMs), sonifyRawLocally);
        }
      }
    }

    enqueueSmoothRawPacket(localCh, rawSamples, delayMs, sonifyLocally) {
      if (localCh < 0 || localCh > 3 || !Array.isArray(rawSamples) || rawSamples.length === 0) return;
      const nowPerf = (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();

      let scheduledItems;
      if (Core && typeof Core.planSmoothRawBatchSchedule === 'function') {
        const res = Core.planSmoothRawBatchSchedule(
          rawSamples,
          nowPerf,
          delayMs,
          this.rawPacerStates[localCh],
          { playoutBufferMs: this.playoutBufferMs }
        );
        this.rawPacerStates[localCh] = res.state;
        scheduledItems = res.scheduled;
      } else {
        const step = 96 / rawSamples.length;
        const start = Math.max(nowPerf, nowPerf + delayMs - 96);
        scheduledItems = rawSamples
          .filter(t => t && t > 0)
          .map((ticks, idx) => ({ dueMs: start + (idx + 1) * step, ticks }));
      }

      const q = this.rawSampleQueues[localCh];
      for (let i = 0; i < scheduledItems.length; i++) {
        q.push({
          dueMs: scheduledItems[i].dueMs,
          ticks: scheduledItems[i].ticks,
          sonifyLocally
        });
      }

      // Strictly cap per-channel backlog so memory never grows if OS suspends tab
      if (q.length > 200) {
        q.splice(0, q.length - 140);
      }

      this.ensureRawPacerLoop();
    }

    ensureRawPacerLoop() {
      if (this.rawPacerRafId !== null) return;
      const step = () => {
        this.rawPacerRafId = null;
        const nowPerf = (typeof performance !== 'undefined' && typeof performance.now === 'function')
          ? performance.now()
          : Date.now();
        if (this.drainRawSampleQueues(nowPerf)) {
          this.ensureRawPacerLoop();
        }
      };
      if (typeof window.requestAnimationFrame === 'function') {
        this.rawPacerRafId = window.requestAnimationFrame(step);
      } else {
        this.rawPacerRafId = setTimeout(step, 16);
      }
    }

    drainRawSampleQueues(nowPerf) {
      this.lastRafDrainMs = nowPerf;
      let hasRemaining = false;

      for (let localCh = 0; localCh < 4; localCh++) {
        const q = this.rawSampleQueues[localCh];
        if (!q || q.length === 0) continue;

        if (!this.channelRoutes[localCh] || this.isLocalChPlayingFileStream(localCh)) {
          q.length = 0;
          this.rawPacerStates[localCh] = null;
          continue;
        }

        if (q[0].dueMs <= nowPerf) {
          const sonifyFlag = Boolean(q[0].sonifyLocally);
          const dueTicks = [];
          const maxDrainPerTick = (typeof document !== 'undefined' && document.hidden) ? 32 : 12;
          let drainCount = 0;
          while (
            drainCount < q.length &&
            drainCount < maxDrainPerTick &&
            q[drainCount].dueMs <= nowPerf &&
            Boolean(q[drainCount].sonifyLocally) === sonifyFlag
          ) {
            dueTicks.push(q[drainCount].ticks);
            drainCount++;
          }
          if (drainCount > 0) {
            q.splice(0, drainCount);
            if (typeof window.processBiodata === 'function') {
              window.processBiodata(
                { type: 'raw', ch: localCh, p: dueTicks, _sonifyRawLocally: sonifyFlag },
                'mqtt'
              );
            }
          }
        }

        if (q.length > 0) {
          hasRemaining = true;
        }
      }

      return hasRemaining;
    }

    /**
     * Deterministic UTC-Synchronized Botanical Feed Generator:
     * Runs every 80ms; evaluates 80ms UTC slots `Math.floor(Date.now() / 80)`.
     * Only computes packets for UTC feeds that at least one local channel is currently routed to!
     */
    startVirtualUtcLoop() {
      if (this.virtualTickTimer) clearInterval(this.virtualTickTimer);
      this.virtualTickTimer = setInterval(() => {
        // Background-tab safety drain when requestAnimationFrame is paused by the browser
        const nowPerf = (typeof performance !== 'undefined' && typeof performance.now === 'function')
          ? performance.now()
          : Date.now();
        if ((typeof document !== 'undefined' && document.hidden) || (nowPerf - this.lastRafDrainMs > 75)) {
          this.drainRawSampleQueues(nowPerf);
        }

        const routedUtcFeedIds = new Set();
        for (let ch = 0; ch < 4; ch++) {
          const r = this.channelRoutes[ch];
          if (r && r.feedId && r.feedId.startsWith('utc-')) {
            routedUtcFeedIds.add(r.feedId);
          }
        }
        if (routedUtcFeedIds.size === 0) return;

        const nowMs = Date.now();
        const slot = Math.floor(nowMs / 80);
        if (slot === this.lastProcessedUtcSlot) return;
        this.lastProcessedUtcSlot = slot;
        const slotTimestampMs = slot * 80;

        UTC_BOTANICAL_FEEDS.forEach((vf) => {
          if (!routedUtcFeedIds.has(vf.feedId)) return;
          const feedMeta = this.feeds.get(vf.feedId);
          if (feedMeta) {
            feedMeta.lastSeen = nowMs;
            feedMeta.msgCount = (feedMeta.msgCount || 0) + 1;
          }

          for (let rCh = 0; rCh < vf.channels; rCh++) {
            const isChRouted = this.channelRoutes.some(r => r && r.feedId === vf.feedId && r.remoteCh === rCh);
            if (!isChRouted) continue;

            const tSec = slotTimestampMs / 1000;
            const chSeed = vf.seed ^ (rCh * 0x9E3779B9);
            // Multi-harmonic slow organic plant potential drift + occasional action-potential spike
            const slowWave = Math.sin(tSec * 0.42 + rCh * 1.7) * 0.55 + Math.cos(tSec * 0.13 + rCh) * 0.35;
            const microWave = Math.sin(tSec * 2.3 + rCh * 0.9) * 0.15;
            const spikeRoll = hash32(slot ^ chSeed);
            const actionSpike = spikeRoll > 0.93 ? ((spikeRoll - 0.93) / 0.07) * 2.8 : 0;

            const pulseSamples = [];
            for (let s = 0; s < 5; s++) {
              const jitter = (hash32((slot * 8 + s) ^ chSeed) - 0.5) * (vf.swingTicks * 0.14);
              const ticks = Math.max(
                45000,
                Math.round(vf.baseTicks - (slowWave + microWave + actionSpike * (s / 4)) * vf.swingTicks + jitter)
              );
              pulseSamples.push(ticks);
            }

            this.dispatchSyncedFeedPacket(vf.feedId, {
              type: 'raw',
              ch: rCh,
              ts: slotTimestampMs,
              p: pulseSamples
            });

            // Deterministic UTC note generation using the exact same sample-by-sample rolling window
            // & 150ms refractory math as ESP32 hardware and DataStreamer playback!
            const winKey = `${vf.feedId}:${rCh}`;
            if (!this.virtualWindows.has(winKey)) this.virtualWindows.set(winKey, []);
            const win = this.virtualWindows.get(winKey);
            const localTarget = this.channelRoutes.findIndex(r => r && r.feedId === vf.feedId && r.remoteCh === rCh);
            const synthParams = (localTarget >= 0 && window.synthChannels && window.synthChannels[localTarget])
              ? window.synthChannels[localTarget].params
              : window.defaultParams;
            const sampleWindow = Math.max(2, Math.min(2000, Math.round(Number(synthParams?.sampleSize) || 40)));
            const thresh = synthParams ? (synthParams.threshold || 2.0) : 2.0;

            for (let s = 0; s < pulseSamples.length; s++) {
              const rVal = 10000000 / pulseSamples[s];
              win.push(rVal);
              while (win.length > sampleWindow) win.shift();

              if (win.length >= Math.min(10, sampleWindow) && Core && typeof Core.evaluateBioSampleWindow === 'function') {
                const stats = Core.evaluateBioSampleWindow(win, rVal, thresh, true);
                const sampleTs = slotTimestampMs - 80 + (s + 1) * 16;
                const lastTrig = this.virtualLastTriggerMs.get(winKey) || 0;
                if (stats.isOverThreshold && (sampleTs - lastTrig > 150)) {
                  const mapped = Core.sonifyBioSample(
                    stats,
                    rVal,
                    synthParams,
                    hash32((slot * 8 + s + 777) ^ chSeed)
                  );
                  const densityPass = (hash32((slot * 8 + s + 999) ^ chSeed) * 100) <= (synthParams?.density ?? 100);
                  if (densityPass) {
                    this.virtualLastTriggerMs.set(winKey, sampleTs);
                    this.dispatchSyncedFeedPacket(vf.feedId, {
                      type: 'note',
                      ch: rCh,
                      ts: sampleTs,
                      n: mapped.note,
                      v: mapped.velocity,
                      d: mapped.duration
                    });
                  } else if (typeof window.triggerDensityVisualizer === 'function') {
                    for (let lCh = 0; lCh < 4; lCh++) {
                      const rt = this.channelRoutes[lCh];
                      if (rt && rt.feedId === vf.feedId && rt.remoteCh === rCh && rt.followPatch !== false && !this.isLocalChPlayingFileStream(lCh)) {
                        window.triggerDensityVisualizer(lCh, 'drop', mapped.note, mapped.velocity, mapped.duration);
                      }
                    }
                  }
                }
              }
            }
          }
        });
      }, 80);
    }

    getAggregateSyncStats() {
      let activeCtrl = null;
      for (let ch = 0; ch < 4; ch++) {
        const r = this.channelRoutes[ch];
        if (r && this.syncControllers.has(r.feedId)) {
          activeCtrl = this.syncControllers.get(r.feedId);
          break;
        }
      }
      if (!activeCtrl) {
        return {
          playoutBufferMs: this.playoutBufferMs,
          offsetMs: 0,
          jitterMs: 0,
          syncedCount: 0,
          lateCount: 0
        };
      }
      return activeCtrl.getDiagnostics();
    }

    getState() {
      const sortedFeeds = Array.from(this.feeds.values()).sort((a, b) => {
        const aVirt = a.isVirtualUtc ? 1 : 0;
        const bVirt = b.isVirtualUtc ? 1 : 0;
        if (aVirt !== bVirt) return aVirt - bVirt;
        if (Boolean(a.isSelfBroadcast) !== Boolean(b.isSelfBroadcast)) {
          return a.isSelfBroadcast ? -1 : 1;
        }
        return 0;
      });

      return {
        brokerUrl: this.brokerUrl,
        brokerUser: this.brokerUser,
        hasBrokerPass: Boolean(this.brokerPass),
        connectedHost: this.connectedHost,
        isConnected: this.isConnected,
        isConnecting: this.isConnecting,
        statusText: this.statusText,
        txCount: this.txCount,
        rxCount: this.rxCount,
        echoCount: this.echoCount,
        lastRttMs: this.lastRttMs,
        lastTopic: this.lastTopic,
        isPublishing: this.isPublishing,
        publishFeedId: this.publishFeedId,
        publishName: this.publishName,
        txChStats: this.txChStats.map(s => ({ ...s })),
        playoutBufferMs: this.playoutBufferMs,
        channelRoutes: this.channelRoutes.slice(),
        activeRouteCount: this.getActiveRouteCount(),
        feeds: sortedFeeds,
        syncStats: this.getAggregateSyncStats()
      };
    }

    getFeedById(feedId) {
      return feedId ? (this.feeds.get(feedId) || null) : null;
    }

    emitTelemetryTick(forceImmediate = false) {
      const now = Date.now();
      if (!forceImmediate && now - this.lastTelemetryEmitMs < 250) return;
      this.lastTelemetryEmitMs = now;
      window.dispatchEvent(new CustomEvent('bioquad_mqtt_telemetry'));
    }

    emitUpdate() {
      const state = this.getState();
      window.dispatchEvent(new CustomEvent('bioquad_feeds_update', { detail: state }));
    }
  }

  window.BROKER_PRESETS = BROKER_PRESETS;
  window.bioquadFeeds = new BioquadFeedsManager();
})(window);
