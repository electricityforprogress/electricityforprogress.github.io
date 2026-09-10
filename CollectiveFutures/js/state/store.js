/**
 * Central State Store & Preset Serialization
 * Includes explicit MIDI channel routing and drum note mappings.
 */
export class AppStateStore {
  constructor() {
    this.state = {
      meta: {
        presetName: 'CollectiveFutures_OpeningNight',
        timestamp: new Date().toISOString()
      },
      global: {
        clock: { bpmMin: 60, bpmMax: 140, masterSwing: 0, elasticityInfluence: 0.5 }
      },
      channel1_percussion: {
        midiChannel: 1, // Master Drum Channel
        kick: {
          midiNote: 36, // C1 - General MIDI Kick
          patternSelect: 'DnB_kick',
          sequenceString: '[8A] 1000',
          bioInfluence: 0.5,
          densityClamp: 4,
          velocity: { base: 127, min: 80, max: 127 }
        },
        snare: {
          midiNote: 38, // D1 - General MIDI Snare
          patternSelect: 'Breakbeat_snare',
          sequenceString: '[~ 1>B(30)] <[1?B(5,50)] [1*B(2,4)v<60~120>]> 1v127',
          bioInfluence: 0.6,
          densityClamp: 6,
          velocity: { base: 100, min: 60, max: 127 }
        },
        cymbal: {
          midiNote: 42, // F#1 - General MIDI Closed Hi-Hat
          patternSelect: 'Sparse_sync',
          sequenceString: '0001[101]000',
          bioInfluence: 0.8,
          densityClamp: 12,
          velocity: { base: 85, min: 40, max: 110 }
        }
      },
      channel2_bass: {
        midiChannel: 2, // Bass Synth Channel
        syncSource: 'ch1',
        patternSelect: 'Dub_bass_line',
        sequenceString: '[d1 [~ d1]] <[f1 a1] [g1 bb1]>',
        scale: { root: 'D', type: 'Minor', customPitches: [] },
        range: { octaveMin: 1, octaveMax: 2 },
        density: 0.8,
        spread: 0.3
      },
      channel3_lead: {
        midiChannel: 3, // Lead Synth Channel
        syncSource: 'ch1',
        patternSelect: 'Hirajoshi_arps',
        sequenceString: '<[d3 f3 a3] [c4 e4 g4]>*2',
        scale: { root: 'D', type: 'Minor', customPitches: [] },
        range: { octaveMin: 4, octaveMax: 5 },
        density: 0.5,
        spread: 0.7
      },
      channel4_guest: {
        midiChannel: 4, // Guest Interaction Channel
        syncSource: 'ch1',
        patternSelect: 'Touch_burst',
        sequenceString: '1(5,8)?B(10,90)',
        scale: { root: 'D', type: 'Minor', customPitches: [] },
        range: { octaveMin: 3, octaveMax: 4 },
        density: 0.9,
        spread: 0.5
      },
      telemetry: {
        loggingEnabled: false,
        zoomLevel: 1.0,
        windowingIntervalSeconds: 10,
        dynamicRangeMin: 0,
        dynamicRangeMax: 1024,
        autoGain: true
      }
    };
  }

  exportPreset() {
    this.state.meta.timestamp = new Date().toISOString();
    return JSON.stringify(this.state, null, 2);
  }

  importPreset(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      this.state = { ...this.state, ...parsed };
      return true;
    } catch (e) {
      console.error('Invalid Preset JSON', e);
      return false;
    }
  }
}
