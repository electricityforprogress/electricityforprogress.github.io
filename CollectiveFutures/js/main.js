/**
 * main.js
 * Application Orchestrator for Collective Futures Biorhythm Interface.
 * Binds State, BLE, Web Worker Sequencer, and UI components.
 */

import { AppStateStore } from './state/store.js';
import { MidiOutputController } from './midi/output.js';
import { BiodataBleManager, BioChannelProcessor } from './ble/connection.js';
import { TelemetryController } from './ui/telemetryChart.js';

class AppOrchestrator {
  constructor() {
    // 1. Initialize Core Modules
    this.store = new AppStateStore();
    this.midiOut = new MidiOutputController();
    this.telemetryUI = new TelemetryController('chart-micro');
    
    // Create processors for the incoming hardware channels
    this.ch1Processor = new BioChannelProcessor(10); // 10Hz sampling
    
    // 2. Initialize Background Worker (The rhythm engine)
    this.worker = new Worker('js/rhythm/worker.js', { type: 'module' });
    this.setupWorkerListeners();

    // 3. Initialize BLE Manager with the data callback
    this.bleManager = new BiodataBleManager((packet) => this.handleBleData(packet));

    // 4. Bind UI Controls
    this.bindDOMEvents();
  }

  setupWorkerListeners() {
    // Listen for messages coming back from the worker thread
    this.worker.onmessage = (e) => {
      const { type, payload, cycle, bpm } = e.data;
      
      switch (type) {
        case 'TRIGGER_NOTE':
          // Route the sequenced note directly to Ableton via IAC MIDI
          this.midiOut.sendNote(
            payload.midiChannel,
            payload.pitch,
            payload.velocity,
            payload.durationMs,
            payload.delayMs
          );
          
          // (Optional: Dispatch an event here to trigger UI canvas visualizer bursts)
          break;
          
        case 'CYCLE_WRAP':
          // The sequencer has completed a measure
          // Useful for updating UI progress bars or logging BPM changes
          // console.log(`Cycle: ${cycle} | Global BPM: ${Math.round(bpm)}`);
          break;
      }
    };
  }

  handleBleData(packet) {
    // packet.raw is an array of raw pulse widths [ch1, ch2, ch3, ch4]
    const rawPulse = packet.raw[0]; 
    if (!rawPulse || rawPulse <= 0) return;

    // 1. Process data through the Leaky Integrator
    const result = this.ch1Processor.processReading(rawPulse);
    const nowTimestamp = Math.floor(Date.now() / 1000);

    // 2. Update the UI charts and readouts (Ohms / µS)
    this.telemetryUI.update(nowTimestamp, result.normalizedBase, result.volatility, result.raw);

    // 3. Send normalized bio-influence to the Sequencer Worker
    this.worker.postMessage({
      type: 'UPDATE_PLANT_DATA',
      payload: { 
        ch1: result.normalizedBase,
        ch1_volatility: result.volatility
      }
    });
  }

  bindDOMEvents() {
    // Connect to hardware
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

    // Start/Stop Master Clock and MIDI
    const startBtn = document.getElementById('btn-start');
    if (startBtn) {
      startBtn.addEventListener('click', async () => {
        if (!this.midiOut.midiAccess) {
          await this.midiOut.init('IAC'); // Target IAC driver for Ableton
        }

        if (startBtn.classList.contains('playing')) {
          // Stop Engine
          this.worker.postMessage({ type: 'STOP' });
          this.midiOut.panic(); // Send note-offs to prevent hung notes
          startBtn.classList.remove('playing');
          startBtn.innerText = "Start Sequencer";
        } else {
          // Start Engine
          this.pushInitialStateToWorker();
          this.worker.postMessage({ type: 'START' });
          startBtn.classList.add('playing');
          startBtn.innerText = "Stop Sequencer";
        }
      });
    }
  }

  pushInitialStateToWorker() {
    // Send all saved sequence strings and parameters to the worker before starting
    const state = this.store.state;
    
    // Example: Push Channel 1 Kick configuration
    this.worker.postMessage({
      type: 'UPDATE_SEQUENCE',
      payload: {
        voiceKey: 'kick',
        config: {
          midiChannel: state.channel1_percussion.midiChannel,
          midiNote: state.channel1_percussion.kick.midiNote,
          sequence: state.channel1_percussion.kick.sequenceString,
          densityClamp: state.channel1_percussion.kick.densityClamp,
          velocity: state.channel1_percussion.kick.velocity
        }
      }
    });

    // (You would repeat this for snare, cymbal, ch2_bass, etc., 
    // or write an iterator to loop through store.state and push them all)
  }
}

// Boot the application once the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.App = new AppOrchestrator();
});