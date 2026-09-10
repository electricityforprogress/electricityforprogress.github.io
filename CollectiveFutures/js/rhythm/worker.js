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
    const steps = cachedSchedules[voiceKey] || [];
    const bioVal = plantActivity[voice.bioSource || 'ch1'];
    let triggeredCount = 0;

    steps.forEach(step => {
      if (step.isRest) return;

      const inWindow = (windowStart < windowEnd)
        ? (step.start >= windowStart && step.start < windowEnd)
        : (step.start >= windowStart || step.start < windowEnd);

      if (inWindow) {
        if (triggeredCount >= (voice.densityClamp || 16)) return;

        // 1. Bio-Probability
        if (!evaluateProbability(step.probability, bioVal)) return;

        // 2. Microtiming (Bio-Swing)
        let delayMs = step.microTiming.staticMs;
        if (step.microTiming.bioMaxMs > 0) {
          delayMs += (1.0 - plantActivity.ch1) * step.microTiming.bioMaxMs;
        }

        // 3. Resolve Pitch (Specific Note vs Scale Quantization vs Drum Override)
        let pitch = voice.midiNote; 
        if (!pitch) { 
          if (step.noteTarget) {
            pitch = ScaleEngine.noteNameToMidi(step.noteTarget);
          } else if (step.scaleDegree !== null && activePitches[voiceKey]) {
            const pitches = activePitches[voiceKey];
            pitch = pitches[step.scaleDegree % pitches.length] || 60;
          } else if (activePitches[voiceKey]) {
            pitch = ScaleEngine.quantize(bioVal, activePitches[voiceKey], voice.density || 0.8, voice.spread || 0.5);
          } else {
            pitch = 60;
          }
        }

        // 4. Ratchets & Rolls
        let ratchetCount = step.ratchet.count;
        if (step.ratchet.bioRange) {
          const [rMin, rMax] = step.ratchet.bioRange;
          ratchetCount = Math.round(rMin + (rMax - rMin) * bioVal);
        }

        for (let r = 0; r < ratchetCount; r++) {
          const subFraction = r / Math.max(1, ratchetCount);
          const velocity = calculateStepVelocity(step, voice, subFraction, bioVal);
          const ratchetOffsetMs = (r / ratchetCount) * (step.duration * (240 / bpm) * 1000);
          const totalDelay = Math.max(0, delayMs + ratchetOffsetMs);

          triggeredCount++;

          self.postMessage({
            type: 'TRIGGER_NOTE',
            payload: {
              voiceKey,
              midiChannel: voice.midiChannel, 
              pitch: pitch,                   
              velocity,
              delayMs: totalDelay,
              durationMs: 120
            }
          });
        }
      }
    });
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
