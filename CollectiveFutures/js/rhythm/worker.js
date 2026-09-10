import { BioStrudelParser } from './syntaxParser.js';
import { ScaleEngine } from '../voice/scaleEngine.js';

let isRunning = false;
let bpm = 110;
let cycle = 0;
let measurePosition = 0.0;
let lastTickTime = performance.now();

let sequenceConfigs = {};
let cachedSchedules = {};
let activePitches = {};

// We now track raw, mean, and stdDev to do the threshold math
let plantActivity = { 
  ch1_raw: 2500, 
  ch1_mean: 2500, 
  ch1_stdDev: 0, 
  ch1_norm: 0.5 
};

self.onmessage = function(e) {
  const { type, payload } = e.data;
  switch (type) {
    case 'START':
      if (!isRunning) {
        isRunning = true;
        lastTickTime = performance.now();
        runTick();
      }
      break;
    case 'STOP':
      isRunning = false;
      break;
    case 'UPDATE_SEQUENCE':
      // Cleanly overwrite the config and re-parse the preset
      sequenceConfigs[payload.voiceKey] = { ...sequenceConfigs[payload.voiceKey], ...payload.config };
      if (payload.config.sequence) {
        cachedSchedules[payload.voiceKey] = BioStrudelParser.parse(payload.config.sequence, cycle);
      }
      break;
    case 'UPDATE_PLANT_DATA':
      plantActivity = { ...plantActivity, ...payload };
      break;
  }
};

function runTick() {
  if (!isRunning) return;
  const now = performance.now();
  const delta = now - lastTickTime;
  lastTickTime = now;
  
  const measureDurationMs = (240 / bpm) * 1000;
  const advance = delta / measureDurationMs;
  const prevPos = measurePosition;
  measurePosition += advance;
  
  evaluateAllVoices(prevPos, measurePosition);
  
  if (measurePosition >= 1.0) {
    measurePosition -= 1.0;
    cycle++;
    // Re-parse all sequences on cycle wrap for alternations < >
    Object.keys(sequenceConfigs).forEach(k => {
       if (sequenceConfigs[k].sequence) {
         cachedSchedules[k] = BioStrudelParser.parse(sequenceConfigs[k].sequence, cycle);
       }
    });
  }
  setTimeout(runTick, 10);
}

function evaluateAllVoices(windowStart, windowEnd) {
  Object.keys(sequenceConfigs).forEach(voiceKey => {
    const voice = sequenceConfigs[voiceKey];
    let triggeredCount = 0;

    if (voice.useStrudel && cachedSchedules[voiceKey]) {
      // --- MODE A: STRUDEL ACTIVE ---
      const steps = cachedSchedules[voiceKey];
      steps.forEach(step => {
        if (step.isRest) return;
        const inWindow = (windowStart < windowEnd)
          ? (step.start >= windowStart && step.start < windowEnd)
          : (step.start >= windowStart || step.start < windowEnd);
          
        if (inWindow && triggeredCount < (voice.densityClamp || 16)) {
          self.postMessage({
            type: 'TRIGGER_NOTE',
            payload: { voiceKey, midiChannel: 1, pitch: voice.midiNote || 60, velocity: voice.velocity?.max || 127, durationMs: 120 }
          });
          triggeredCount++;
        }
      });
    } else {
      // --- MODE B: GENERATIVE BIORHYTHM (Threshold Math) ---
      const stepDuration = 1.0 / 16; // Evaluate on 16th note grid
      const currentStep = Math.floor(windowStart / stepDuration);
      const stepStart = currentStep * stepDuration;
      
      const inWindow = (windowStart < windowEnd)
        ? (stepStart >= windowStart && stepStart < windowEnd)
        : (stepStart >= windowStart || stepStart < windowEnd);

      if (inWindow && triggeredCount < (voice.densityClamp || 16)) {
        
        const raw = plantActivity.ch1_raw;
        const mean = plantActivity.ch1_mean;
        const stdDev = plantActivity.ch1_stdDev;
        const thresh = voice.threshold || 2.0;

        // Is there a significant biological shift?
        if (Math.abs(raw - mean) > (thresh * stdDev) && stdDev > 2.0) {
          
          // Calculate dynamic velocity based on the intensity of the spike
          const intensity = Math.abs(raw - mean) / stdDev;
          const vMin = voice.velocity?.min || 60;
          const vMax = voice.velocity?.max || 127;
          
          let dynamicVel = vMin + (intensity * 15); // Scale velocity up with intensity
          dynamicVel = Math.min(vMax, Math.max(vMin, Math.round(dynamicVel)));

          self.postMessage({
            type: 'TRIGGER_NOTE',
            payload: { voiceKey, midiChannel: 1, pitch: voice.midiNote || 60, velocity: dynamicVel, durationMs: 120 }
          });
          triggeredCount++;
        }
      }
    }
  });
}
