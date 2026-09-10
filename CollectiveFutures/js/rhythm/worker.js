/**
 * Master Clock & Unified Sequencer Worker (Drums + Melodic Voices)
 * Provides microsecond-accurate scheduling independent of UI/Canvas thread load.
 */
import { BioStrudelParser } from './syntaxParser.js';
import { ScaleEngine } from '../voice/scaleEngine.js';

let timerId = null;
let isRunning = false;
let bpm = 110;
let cycle = 0;
let measurePosition = 0.0;
let lastTickTime = performance.now();

// State mirrors (Overwritten by store.js on boot)
let sequenceConfigs = {
  kick: { midiChannel: 1, midiNote: 36, sequence: '1000' },
  snare: { midiChannel: 1, midiNote: 38, sequence: '0010' },
  cymbal: { midiChannel: 1, midiNote: 42, sequence: '0001' },
  channel2_bass: { midiChannel: 2, sequence: 'c2' },
  channel3_lead: { midiChannel: 3, sequence: 'c4' },
  channel4_guest: { midiChannel: 4, sequence: 'c3' }
};

let cachedSchedules = {};
let activePitches = {};
let plantActivity = { ch1: 0.5, ch2: 0.5, ch3: 0.5, ch4: 0.5 };
let dynamicBpmConfig = { min: 70, max: 135, elasticity: 0.5 };

const TICK_INTERVAL_MS = 10;

self.onmessage = function(e) {
  const { type, payload } = e.data;

  switch (type) {
    case 'START':
      if (!isRunning) {
        isRunning = true;
        lastTickTime = performance.now();
        compileAllSequences();
        runTick();
      }
      break;

    case 'STOP':
      isRunning = false;
      clearTimeout(timerId);
      measurePosition = 0.0;
      cycle = 0;
      break;

    case 'UPDATE_SEQUENCE':
      // payload: { voiceKey, config }
      if (sequenceConfigs[payload.voiceKey]) {
        sequenceConfigs[payload.voiceKey] = { ...sequenceConfigs[payload.voiceKey], ...payload.config };
        compileSequence(payload.voiceKey);
      }
      break;

    case 'UPDATE_PLANT_DATA':
      plantActivity = { ...plantActivity, ...payload };
      updateDynamicBpm();
      break;

    case 'UPDATE_GLOBAL':
      dynamicBpmConfig = { ...dynamicBpmConfig, ...payload };
      updateDynamicBpm();
      break;
  }
};

function updateDynamicBpm() {
  const targetBpm = dynamicBpmConfig.min + (dynamicBpmConfig.max - dynamicBpmConfig.min) * plantActivity.ch1;
  bpm += (targetBpm - bpm) * 0.05;
}

function compileSequence(voiceKey) {
  const voice = sequenceConfigs[voiceKey];
  cachedSchedules[voiceKey] = BioStrudelParser.parse(voice.sequence, cycle);

  if (voice.scale) {
    activePitches[voiceKey] = ScaleEngine.generateScalePitches(
      voice.scale.root,
      voice.scale.type,
      voice.scale.octaveMin,
      voice.scale.octaveMax,
      voice.scale.customPitches || []
    );
  }
}

function compileAllSequences() {
  Object.keys(sequenceConfigs).forEach(k => compileSequence(k));
}

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
    compileAllSequences();
    self.postMessage({ type: 'CYCLE_WRAP', cycle, bpm });
  }

  const elapsed = performance.now() - now;
  timerId = setTimeout(runTick, Math.max(0, TICK_INTERVAL_MS - elapsed));
}

function evaluateAllVoices(windowStart, windowEnd) {
  Object.keys(sequenceConfigs).forEach(voiceKey => {
    const voice = sequenceConfigs[voiceKey];
    const bioVal = plantActivity[voice.bioSource || 'ch1']; // Normalized 0.0 to 1.0
    const volatility = plantActivity.ch1_volatility || 0;
    
    let triggeredCount = 0;

    if (voice.useStrudel && cachedSchedules[voiceKey]) {
      // ========================================================
      // MODE A: STRUDEL OVERRIDE ENABLED
      // ========================================================
      const steps = cachedSchedules[voiceKey];
      steps.forEach(step => {
        if (step.isRest) return;
        
        const inWindow = (windowStart < windowEnd)
          ? (step.start >= windowStart && step.start < windowEnd)
          : (step.start >= windowStart || step.start < windowEnd);
          
        if (inWindow) {
          if (triggeredCount >= (voice.densityClamp || 16)) return;
          
          // 1. Evaluate Strudel-specific probabilities (?B)
          if (!evaluateProbability(step.probability, bioVal)) return;
          
          // 2. Resolve Pitch & Calculate Velocity
          let pitch = voice.midiNote || 60; // Expand for synth logic later
          let velocity = calculateStepVelocity(step, voice, 1.0, bioVal);

          self.postMessage({
            type: 'TRIGGER_NOTE',
            payload: { voiceKey, midiChannel: voice.midiChannel, pitch, velocity, delayMs: 0, durationMs: 120 }
          });
          triggeredCount++;
        }
      });

    } else {
      // ========================================================
      // MODE B: STRUDEL BYPASSED (RAW GENERATIVE MODE)
      // ========================================================
      // We check for triggers on a fixed subdivision (e.g., 16th notes)
      // windowStart represents our progression through the measure (0.0 to 1.0)
      
      const totalSubdivisions = 16;
      const stepDuration = 1.0 / totalSubdivisions;
      const currentStep = Math.floor(windowStart / stepDuration);
      const stepStart = currentStep * stepDuration;
      
      const inWindow = (windowStart < windowEnd)
        ? (stepStart >= windowStart && stepStart < windowEnd)
        : (stepStart >= windowStart || stepStart < windowEnd);

      if (inWindow) {
        if (triggeredCount >= (voice.densityClamp || 16)) return; // Strict Anti-Cacophony clamp

        // Generative Probability: Baseline activity + momentary volatility
        const triggerThreshold = 0.8 - (bioVal * 0.4); 
        
        if (Math.random() + volatility > triggerThreshold) {
          
          let pitch = voice.midiNote || 60; 
          
          // Apply Bio-Velocity Influence[cite: 2]
          const vMin = voice.velocity?.min || 40;
          const vMax = voice.velocity?.max || 127;
          const vRange = vMax - vMin;
          const bioInfluence = voice.velocity?.bioInfluence || 0.5; // 0.0 to 1.0
          
          // Modulate base velocity by the plant's current baseline state
          const dynamicVelocity = vMin + (vRange * (bioVal * bioInfluence));
          const finalVelocity = Math.min(vMax, Math.max(vMin, Math.round(dynamicVelocity)));

          self.postMessage({
            type: 'TRIGGER_NOTE',
            payload: { voiceKey, midiChannel: voice.midiChannel, pitch, velocity: finalVelocity, delayMs: 0, durationMs: 120 }
          });
          triggeredCount++;
        }
      }
    }
  });
}

function evaluateProbability(prob, bioVal) {
  if (prob.type === 'static') return Math.random() < prob.value;
  if (prob.type === 'bio') {
    return Math.random() < (prob.min + (prob.max - prob.min) * bioVal);
  }
  if (prob.type === 'inverseBio') return bioVal < prob.threshold;
  return true;
}

function calculateStepVelocity(step, config, subRatio, bioVal) {
  let base = config.velocity?.base || 100;
  if (step.velocity.type === 'static') return Math.min(127, Math.max(1, step.velocity.value));
  if (step.velocity.type === 'ramp') {
    const [s, e] = step.velocity.ramp;
    return Math.round(s + (e - s) * subRatio);
  }
  if (step.velocity.type === 'bio') {
    return Math.round(step.velocity.min + (step.velocity.max - step.velocity.min) * bioVal);
  }
  return Math.min(config.velocity?.max || 127, Math.max(config.velocity?.min || 40, Math.round(base + (bioVal - 0.5) * 30)));
}
