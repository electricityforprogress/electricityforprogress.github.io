/**
 * Note Scaling & Pitch Translation
 */
export const MUSICAL_SCALES = {
  Minor: [0, 2, 3, 5, 7, 8, 10],
  Major: [0, 2, 4, 5, 7, 9, 11],
  Hirajoshi: [0, 2, 3, 7, 8],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  PentatonicMinor: [0, 3, 5, 7, 10],
  Chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
};

export const ROOT_OFFSETS = {
  c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4,
  f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9,
  'a#': 10, bb: 10, b: 11
};

export class ScaleEngine {
  static noteNameToMidi(str) {
    if (!str) return 60;
    const match = str.toLowerCase().match(/^([a-g][#b]?)(-?\d+)$/);
    if (!match) return 60;
    const name = match[1];
    const oct = parseInt(match[2], 10);
    const offset = ROOT_OFFSETS[name] ?? 0;
    return (oct + 1) * 12 + offset;
  }

  static generateScalePitches(rootName, scaleType, octaveMin, octaveMax, customPitches = []) {
    if (scaleType === 'Custom' && customPitches.length > 0) {
      return customPitches.filter(p => p >= octaveMin * 12 && p <= (octaveMax + 1) * 12);
    }
    const root = rootName ? rootName.toLowerCase() : 'd';
    const rootOffset = ROOT_OFFSETS[root] ?? 2;
    const intervals = MUSICAL_SCALES[scaleType] || MUSICAL_SCALES.Minor;
    const pitches = [];
    for (let oct = octaveMin; oct <= octaveMax; oct++) {
      const baseMidi = (oct + 1) * 12 + rootOffset;
      intervals.forEach(interval => {
        const pitch = baseMidi + interval;
        if (pitch <= 127) pitches.push(pitch);
      });
    }
    return pitches;
  }

  static quantize(rawBio, fullScale, density = 1.0, spread = 0.5) {
    if (!fullScale || fullScale.length === 0) return 60;
    let activeScale = fullScale;
    if (density < 0.9 && fullScale.length > 3) {
      activeScale = fullScale.filter((_, idx) => {
        const degree = idx % 7;
        if (density < 0.3) return degree === 0;
        if (density < 0.6) return degree === 0 || degree === 4;
        return true;
      });
      if (activeScale.length === 0) activeScale = fullScale;
    }
    const centerIndex = Math.floor(activeScale.length / 2);
    const maxOffset = Math.floor((activeScale.length / 2) * Math.max(0.1, spread));
    const offsetRange = (rawBio - 0.5) * 2;
    const targetIndex = Math.round(centerIndex + (offsetRange * maxOffset));
    return activeScale[Math.max(0, Math.min(activeScale.length - 1, targetIndex))];
  }
}
