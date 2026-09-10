/**
 * Bio-Strudel Syntax Parser
 * Translates syntax strings into structured time-division trees.
 */
export class BioStrudelParser {
  static parse(input, cycle = 0) {
    if (!input || typeof input !== 'string') return [];
    let sanitized = input.trim().replace(/~/g, '0');
    sanitized = this.resolveHexShorthand(sanitized);
    sanitized = this.resolveAlternations(sanitized, cycle);
    sanitized = this.resolveEuclidean(sanitized, cycle);
    const tree = this.tokenizeBrackets(sanitized);
    const flattened = [];
    this.flattenBranch(tree, 0.0, 1.0, flattened);
    return flattened.map(item => this.parseStepModifiers(item.raw, item.start, item.duration));
  }

  static resolveHexShorthand(str) {
    return str.replace(/\[([0-9a-fA-F]{2,8})\]/g, (_, hex) => {
      const bits = [];
      for (let i = 0; i < hex.length; i++) {
        const nibble = parseInt(hex[i], 16);
        bits.push(
          (nibble & 8 ? '1' : '0'), (nibble & 4 ? '1' : '0'),
          (nibble & 2 ? '1' : '0'), (nibble & 1 ? '1' : '0')
        );
      }
      return `[${bits.join(' ')}]`;
    });
  }

  static resolveAlternations(str, cycle) {
    return str.replace(/<([^>]+)>/g, (_, inner) => {
      const items = this.splitTopLevel(inner.trim(), ' ');
      if (items.length === 0) return '0';
      const index = Math.floor(cycle) % items.length;
      return items[index];
    });
  }

  static resolveEuclidean(str, cycle) {
    return str.replace(/([a-gA-G][#b]?-?\d+|n\d+|1)?\(\s*([0-9<> ]+)\s*,\s*(\d+)\s*\)/g, (_, token, kExpr, nStr) => {
      const pulseToken = token || '1';
      let kStr = kExpr;
      if (kExpr.includes('<')) kStr = this.resolveAlternations(kExpr, cycle);
      const k = parseInt(kStr.trim(), 10) || 0;
      const n = parseInt(nStr.trim(), 10) || 1;
      const pattern = this.generateBjorklund(k, n, pulseToken);
      return `[${pattern.join(' ')}]`;
    });
  }

  static generateBjorklund(k, n, pulseToken = '1') {
    if (k <= 0) return new Array(n).fill('0');
    if (k >= n) return new Array(n).fill(pulseToken);
    let pattern = [];
    for (let i = 0; i < n; i++) pattern.push(i < k ? [pulseToken] : ['0']);
    let count = n - k;
    k = Math.min(k, count);
    while (k > 0) {
      for (let i = 0; i < k; i++) pattern[i] = pattern[i].concat(pattern.pop());
      count = pattern.length - k;
      k = Math.min(k, count);
    }
    return pattern.flat();
  }

  static tokenizeBrackets(str) {
    let current = [];
    let stack = [current];
    let buffer = '';
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (char === '[') {
        if (buffer.trim()) current.push(buffer.trim());
        buffer = '';
        const next = [];
        current.push(next);
        stack.push(next);
        current = next;
      } else if (char === ']') {
        if (buffer.trim()) current.push(buffer.trim());
        buffer = '';
        stack.pop();
        current = stack[stack.length - 1];
      } else if (char === ' ' && !buffer.includes('(')) {
        if (buffer.trim()) current.push(buffer.trim());
        buffer = '';
      } else {
        buffer += char;
      }
    }
    if (buffer.trim()) current.push(buffer.trim());
    return stack[0];
  }

  static flattenBranch(node, start, end, result) {
    if (!Array.isArray(node)) {
      if (node !== '') result.push({ raw: node, start, duration: end - start });
      return;
    }
    const len = node.length;
    if (len === 0) return;
    const stepDuration = (end - start) / len;
    for (let i = 0; i < len; i++) {
      this.flattenBranch(node[i], start + i * stepDuration, start + (i + 1) * stepDuration, result);
    }
  }

  static parseStepModifiers(raw, start, duration) {
    const isRest = raw === '0' || raw.startsWith('0');
    const step = {
      isRest, start, duration, raw,
      noteTarget: null, scaleDegree: null,
      probability: { type: 'static', value: 1.0 },
      velocity: { type: 'default', value: null, ramp: null },
      ratchet: { count: 1, bioRange: null },
      microTiming: { staticMs: 0, bioMaxMs: 0 }
    };

    if (isRest) return step;

    const noteMatch = raw.match(/^([a-gA-G][#b]?-?\d+)/);
    const degreeMatch = raw.match(/^n(\d+)/);
    if (noteMatch) step.noteTarget = noteMatch[1].toLowerCase();
    else if (degreeMatch) step.scaleDegree = parseInt(degreeMatch[1], 10);

    const probBioMatch = raw.match(/\?B\((\d+)\s*,\s*(\d+)\)/);
    const probStaticMatch = raw.match(/\?(\d+)/);
    if (probBioMatch) step.probability = { type: 'bio', min: parseInt(probBioMatch[1], 10) / 100, max: parseInt(probBioMatch[2], 10) / 100 };
    else if (probStaticMatch) step.probability = { type: 'static', value: parseInt(probStaticMatch[1], 10) / 100 };
    else if (raw.includes('!')) step.probability = { type: 'inverseBio', threshold: 0.3 };

    const ratchetBioMatch = raw.match(/\*B\((\d+)\s*,\s*(\d+)\)/);
    const ratchetStaticMatch = raw.match(/\*(\d+)/);
    if (ratchetBioMatch) step.ratchet = { count: 1, bioRange: [parseInt(ratchetBioMatch[1], 10), parseInt(ratchetBioMatch[2], 10)] };
    else if (ratchetStaticMatch) step.ratchet = { count: parseInt(ratchetStaticMatch[1], 10), bioRange: null };

    const velRampMatch = raw.match(/v<(\d+)~(\d+)>/);
    const velBioMatch = raw.match(/vB\((\d+)\s*,\s*(\d+)\)/);
    const velStaticMatch = raw.match(/v(\d+)/);
    if (velRampMatch) step.velocity = { type: 'ramp', ramp: [parseInt(velRampMatch[1], 10), parseInt(velRampMatch[2], 10)] };
    else if (velBioMatch) step.velocity = { type: 'bio', min: parseInt(velBioMatch[1], 10), max: parseInt(velBioMatch[2], 10) };
    else if (velStaticMatch) step.velocity = { type: 'static', value: parseInt(velStaticMatch[1], 10) };

    const microBioMatch = raw.match(/>B\((\d+)\)/);
    const microPushMatch = raw.match(/>(\d+)/);
    const microPullMatch = raw.match(/<(\d+)/);
    if (microBioMatch) step.microTiming.bioMaxMs = parseInt(microBioMatch[1], 10);
    else if (microPushMatch) step.microTiming.staticMs = parseInt(microPushMatch[1], 10);
    else if (microPullMatch) step.microTiming.staticMs = -parseInt(microPullMatch[1], 10);

    return step;
  }

  static splitTopLevel(str, separator = ' ') {
    const results = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (char === '[' || char === '<' || char === '(') depth++;
      if (char === ']' || char === '>' || char === ')') depth--;
      if (char === separator && depth === 0) {
        if (current.trim()) results.push(current.trim());
        current = '';
      } else current += char;
    }
    if (current.trim()) results.push(current.trim());
    return results;
  }
}
