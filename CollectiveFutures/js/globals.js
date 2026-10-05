/**
 * js/globals.js
 * 
 * FUTURE ENHANCEMENT: As you process new densities of information and larger arrays,
 * this global state management could be transitioned into a structured store (like Redux)
 * or Web Workers to keep the UI thread clear.
 */

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = audioCtx.createGain(); 
masterGain.gain.value = 1.0; 
masterGain.connect(audioCtx.destination);

// State vars
let isMasterMuted = false;
let activeSynthIndex = 0;
const synthChannels = [];

// Shared Buffers
let rampDownWave, noiseBuffer;

// Connectivity
let bleTxCharacteristic = null;
let bleBuffer = "";
let midiOutput = null;

// FUTURE ENHANCEMENT: Increase buffer limits here as data array sizes grow.
let chData = [
    { waveBuffer: [], notes: [] },
    { waveBuffer: [], notes: [] },
    { waveBuffer: [], notes: [] },
    { waveBuffer: [], notes: [] }
];

// Presets
let globalPresets = {};