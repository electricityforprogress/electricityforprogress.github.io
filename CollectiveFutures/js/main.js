/**
 * main.js
 * Application Orchestrator for Collective Futures Biorhythm Interface.
 * Binds State, BLE, Web Worker Sequencer, UI components, and User Parameters.
 */

import { AppStateStore } from './state/store.js';
import { MidiOutputController } from './midi/output.js';
import { BiodataBleManager, BioChannelProcessor } from './ble/connection.js';
import { TelemetryController } from './ui/telemetryChart.js';

class AppOrchestrator {
  constructor() {
    // 1. Initialize Core State & Output Modules[cite: 1]
    this.store = new AppStateStore();
    this.midiOut = new MidiOutputController();
    
    // Initialize the dual-canvas visualizer (Oscilloscope & Piano Roll)[cite: 1]
    this.telemetryUI = new TelemetryController('oscillator-canvas', 'piano-roll-canvas');
    
    // Create processors for incoming hardware channels (10Hz sampling)
    this.ch1Processor = new BioChannelProcessor(10); 
    
    // 2. Initialize Background Worker (The rhythm engine)[cite: 1]
    this.worker = new Worker('js/rhythm/worker.js', { type: 'module' });
    this.setupWorkerListeners();

    // 3. Initialize BLE Manager with JSON payload parsing
    this.bleManager = new BiodataBleManager((packet) => this.handleBleData(packet));

    // 4. Bind UI Controls & Biorhythm Sliders
    this.bindDOMEvents();
  }

  setupWorkerListeners() {
    // Listen for messages coming back from the sequencer worker thread[cite: 1]
    this.worker.onmessage = (e) => {
      const { type, payload } = e.data;
      
      switch (type) {
        case 'TRIGGER_NOTE':
          // Route the sequenced note directly to Ableton via Web MIDI[cite: 2]
          this.midiOut.sendNote(
            payload.midiChannel,
            payload.pitch,
            payload.velocity,
            payload.durationMs,
            payload.delayMs
          );
          
          // Flash the UI Piano Roll
          if (this.telemetryUI) {
             // We pass eventFlag=1, plus the MIDI details for the piano roll
             this.telemetryUI.update(
               Math.floor(Date.now() / 1000), 
               0, 0, 0, 1, payload.pitch, payload.velocity, payload.durationMs
             );
          }
          break;
      }
    };
  }

handleBleData(packet) {
    const rawPulse = packet.raw[0]; 
    if (!rawPulse || rawPulse <= 0) return;

    const result = this.ch1Processor.processReading(rawPulse);
    const nowTimestamp = Math.floor(Date.now() / 1000);

    // This ensures the raw pulse is passed, fixing the blank Ohms readout
    this.telemetryUI.update(nowTimestamp, result.normalizedBase, result.volatility, result.raw, 0);

    // Send the raw math values to the worker for the Generative engine
    this.worker.postMessage({
      type: 'UPDATE_PLANT_DATA',
      payload: { 
        ch1_raw: result.raw,
        ch1_mean: result.mesoAvg,
        ch1_stdDev: result.volatility,
        ch1_norm: result.normalizedBase
      }
    });
  }

  bindVoiceUI(voiceKey) {
    const toggle = document.getElementById(`${voiceKey}-strudel-enable`);
    const thresh = document.getElementById(`${voiceKey}-thresh`);
    const threshVal = document.getElementById(`${voiceKey}-thresh-val`);
    const density = document.getElementById(`${voiceKey}-density`);
    const applyBtn = document.getElementById(`${voiceKey}-apply-btn`);
    const inputArea = document.getElementById(`${voiceKey}-sequence-input`);
    const presetSelect = document.getElementById(`${voiceKey}-preset-select`);

    if (!inputArea) return;

    const updateWorkerState = () => {
      this.worker.postMessage({
        type: 'UPDATE_SEQUENCE',
        payload: {
          voiceKey: voiceKey,
          config: {
            useStrudel: toggle.value === "true",
            sequence: inputArea.value.trim(),
            threshold: thresh ? parseFloat(thresh.value) : 2.0,
            densityClamp: density ? parseInt(density.value, 10) : 16,
            velocity: {
              min: parseInt(document.getElementById(`${voiceKey}-vel-min`).value, 10),
              max: parseInt(document.getElementById(`${voiceKey}-vel-max`).value, 10)
            }
          }
        }
      });
    };

    // Bind real-time sliders
    if (toggle) toggle.addEventListener('change', updateWorkerState);
    if (thresh) thresh.addEventListener('input', (e) => { threshVal.innerText = e.target.value; updateWorkerState(); });
    if (density) density.addEventListener('input', (e) => { document.getElementById(`${voiceKey}-density-val`).innerText = e.target.value; updateWorkerState(); });
    
    // Preset and Sequence Applier
    applyBtn.addEventListener('click', updateWorkerState);
    if (presetSelect) {
      presetSelect.addEventListener('change', (e) => {
        inputArea.value = e.target.value;
        updateWorkerState(); // Immediately push the preset to the worker
      });
    }
  }

  bindDOMEvents() {
    // ==========================================
    // Master Connection Controls
    // ==========================================
    const connectBtn = document.getElementById('btn-connect');
    if (connectBtn) {
      connectBtn.addEventListener('click', async () => {
        try {
          await this.bleManager.connect();
          connectBtn.innerText = "Connected";
          connectBtn.classList.add('active');
        } catch (err) {
          console.error("BLE Connection Failed:", err);
        }
      });
    }

    const startBtn = document.getElementById('btn-start');
    if (startBtn) {
      startBtn.addEventListener('click', async () => {
        if (!this.midiOut.midiAccess) {
          await this.midiOut.init('IAC'); // Target IAC driver for Ableton[cite: 2]
        }

        if (startBtn.classList.contains('playing')) {
          this.worker.postMessage({ type: 'STOP' });
          this.midiOut.panic(); 
          startBtn.classList.remove('playing');
          startBtn.innerText = "Start Sequencer";
        } else {
          this.pushInitialStateToWorker();
          this.worker.postMessage({ type: 'START' });
          startBtn.classList.add('playing');
          startBtn.innerText = "Stop Sequencer";
        }
      });
    }

    // ==========================================
    // Channel 1: Kick Drum UI Bindings
    // ==========================================
    this.bindVoiceUI('kick');
    // You can replicate this for 'snare' and 'cymbal' once the HTML is ready:
    // this.bindVoiceUI('snare');
    // this.bindVoiceUI('cymbal');
  }

  bindVoiceUI(voiceKey) {
    // Grab all DOM elements dynamically based on the voiceKey prefix (e.g., 'kick-')
    const toggle = document.getElementById(`${voiceKey}-strudel-enable`);
    const density = document.getElementById(`${voiceKey}-density`);
    const densityVal = document.getElementById(`${voiceKey}-density-val`);
    const velMin = document.getElementById(`${voiceKey}-vel-min`);
    const velMax = document.getElementById(`${voiceKey}-vel-max`);
    const bioVel = document.getElementById(`${voiceKey}-bio-vel`);
    const bioVelVal = document.getElementById(`${voiceKey}-bio-vel-val`);
    const applyBtn = document.getElementById(`${voiceKey}-apply-btn`);
    const inputArea = document.getElementById(`${voiceKey}-sequence-input`);
    const presetSelect = document.getElementById(`${voiceKey}-preset-select`);
    const saveBtn = document.getElementById(`${voiceKey}-save-new`);

    if (!inputArea) return; // Skip if HTML isn't built yet

    // Helper to package the current UI state and send it to the worker
    const updateWorkerState = () => {
      this.worker.postMessage({
        type: 'UPDATE_SEQUENCE',
        payload: {
          voiceKey: voiceKey,
          config: {
            useStrudel: toggle ? toggle.checked : true,
            sequence: inputArea.value.trim(),
            densityClamp: density ? parseInt(density.value, 10) : 16,
            velocity: {
              min: velMin ? parseInt(velMin.value, 10) : 40,
              max: velMax ? parseInt(velMax.value, 10) : 127,
              bioInfluence: bioVel ? parseInt(bioVel.value, 10) / 100 : 0.5
            }
          }
        }
      });
    };

    // 1. Strudel Toggle (Bypass Mode)
    if (toggle) toggle.addEventListener('change', updateWorkerState);

    // 2. Sliders (Auto-send updates)
    if (density) {
      density.addEventListener('input', (e) => {
        densityVal.innerText = e.target.value;
        updateWorkerState();
      });
    }
    if (bioVel) {
      bioVel.addEventListener('input', (e) => {
        bioVelVal.innerText = `${e.target.value}%`;
        updateWorkerState();
      });
    }
    if (velMin) velMin.addEventListener('change', updateWorkerState);
    if (velMax) velMax.addEventListener('change', updateWorkerState);

    // 3. Text Editor (Dirty State)
    inputArea.addEventListener('input', () => {
      // Highlight the apply button in neon green to indicate uncommitted text changes
      applyBtn.style.borderColor = "var(--accent-primary)"; 
      applyBtn.style.color = "var(--accent-primary)";
    });

    // 4. Apply Sequence Button
    applyBtn.addEventListener('click', () => {
      updateWorkerState();
      // Remove highlight
      applyBtn.style.borderColor = "var(--accent-border)";
      applyBtn.style.color = "var(--text-primary)";
    });

    // 5. Preset Dropdown Selection
    if (presetSelect) {
      presetSelect.addEventListener('change', (e) => {
        inputArea.value = e.target.value;
        applyBtn.click(); // Auto-apply when a preset is loaded
      });
    }

    // 6. Save as Custom Preset
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const name = prompt(`Name your custom ${voiceKey} sequence:`);
        if (name) {
          const opt = document.createElement('option');
          opt.text = name;
          opt.value = inputArea.value;
          
          const customGroup = document.getElementById(`${voiceKey}-custom-presets`);
          if (customGroup) {
            customGroup.appendChild(opt);
            presetSelect.value = opt.value; // Select the newly created preset
          }
          
          // TODO: Sync this new custom preset into this.store.state for JSON export[cite: 1]
        }
      });
    }
  }

  pushInitialStateToWorker() {
    const state = this.store.state;
    
    // Push the Kick initial config[cite: 1]
    this.worker.postMessage({
      type: 'UPDATE_SEQUENCE',
      payload: {
        voiceKey: 'kick',
        config: {
          midiChannel: state.channel1_percussion.midiChannel,
          midiNote: state.channel1_percussion.kick.midiNote,
          sequence: document.getElementById('kick-sequence-input')?.value || state.channel1_percussion.kick.sequenceString,
          useStrudel: document.getElementById('kick-strudel-enable')?.checked ?? true,
          densityClamp: parseInt(document.getElementById('kick-density')?.value || state.channel1_percussion.kick.densityClamp, 10),
          velocity: {
            base: state.channel1_percussion.kick.velocity.base,
            min: parseInt(document.getElementById('kick-vel-min')?.value || state.channel1_percussion.kick.velocity.min, 10),
            max: parseInt(document.getElementById('kick-vel-max')?.value || state.channel1_percussion.kick.velocity.max, 10),
            bioInfluence: parseInt(document.getElementById('kick-bio-vel')?.value || 50, 10) / 100
          }
        }
      }
    });
  }
}

// Boot the application once the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.App = new AppOrchestrator();
});
