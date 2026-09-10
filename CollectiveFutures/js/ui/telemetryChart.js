/**
 * TelemetryController
 * Manages uPlot charting and live numeric readouts for the UI.
 */
export class TelemetryController {
  constructor(scopeId, rollId) {
    this.scope = document.getElementById(scopeId);
    this.roll = document.getElementById(rollId);
    this.sCtx = this.scope.getContext('2d');
    this.rCtx = this.roll.getContext('2d');
    
    this.waveBuffer = [];
    this.notes = [];
    this.MAX_PTS = 60; 
    
    window.addEventListener('resize', () => this.resize());
    this.resize();
    requestAnimationFrame(() => this.renderLoop());
  }

  resize() {
    this.scope.width = this.scope.clientWidth;
    this.scope.height = this.scope.clientHeight;
    this.roll.width = this.roll.clientWidth;
    this.roll.height = this.roll.clientHeight;
  }

  update(timestamp, base, volatility, rawPulse, eventFlag = 0, pitch = 60, velocity = 100, duration = 500) {
    // Buffer the raw pulse for dynamic visual scaling
    this.waveBuffer.push({ val: rawPulse, evt: eventFlag, n: pitch });
    if (this.waveBuffer.length > this.MAX_PTS) this.waveBuffer.shift();

    if (eventFlag === 1) {
      this.notes.push({ n: pitch, t: Date.now(), dur: duration, v: velocity });
    }
  }

  getPitchColor(pitch, alpha = 1.0) {
    return `hsla(${(pitch % 12) * 30}, 100%, 50%, ${alpha})`;
  }

  renderLoop() {
    const now = Date.now();
    const timeWindow = 4000; 
    const sw = this.scope.width, sh = this.scope.height;
    const rw = this.roll.width, rh = this.roll.height;

    // --- 1. Render Oscilloscope ---
    this.sCtx.fillStyle = '#000'; 
    this.sCtx.fillRect(0, 0, sw, sh);
    
    if (this.waveBuffer.length > 1) {
      // Dynamically auto-scale to the current buffer[cite: 4]
      let min = Math.min(...this.waveBuffer.map(b => b.val));
      let max = Math.max(...this.waveBuffer.map(b => b.val));
      let range = max - min || 1;
      
      let pts = this.waveBuffer.map((b, idx) => ({
        x: idx * (sw / (this.MAX_PTS - 1)),
        y: sh - ((b.val - min) / range * (sh * 0.8)) - (sh * 0.1),
        e: b.evt, 
        n: b.n
      }));

      // Draw trigger lines[cite: 4]
      pts.forEach(p => {
        if (p.e === 1) {
          this.sCtx.strokeStyle = this.getPitchColor(p.n, 0.7); 
          this.sCtx.lineWidth = 1; 
          this.sCtx.beginPath(); 
          this.sCtx.moveTo(p.x, 0); 
          this.sCtx.lineTo(p.x, sh); 
          this.sCtx.stroke();
        }
      });

      // Draw continuous green wave[cite: 4]
      this.sCtx.strokeStyle = '#39ff14'; 
      this.sCtx.lineWidth = 2; 
      this.sCtx.beginPath(); 
      this.sCtx.moveTo(pts[0].x, pts[0].y);
      for (let j = 0; j < pts.length - 1; j++) {
        this.sCtx.lineTo(pts[j].x, pts[j].y);
      }
      this.sCtx.stroke();
    }

    // --- 2. Render Piano Roll ---
    this.rCtx.fillStyle = '#000'; 
    this.rCtx.fillRect(0, 0, rw, rh);
    this.rCtx.strokeStyle = '#30363d'; 
    this.rCtx.lineWidth = 1;
    
    for (let j = 0; j < 12; j++) { 
      this.rCtx.beginPath(); 
      this.rCtx.moveTo(0, j * (rh / 12)); 
      this.rCtx.lineTo(rw, j * (rh / 12)); 
      this.rCtx.stroke(); 
    }
    
    // Animate falling notes[cite: 4]
    this.notes = this.notes.filter(n => now - n.t < timeWindow);
    this.notes.forEach(note => {
      let x = rw - ((now - note.t) / timeWindow * rw);
      let y = rh - ((note.n / 127) * rh); 
      let noteW = (note.dur / timeWindow) * rw;
      
      this.rCtx.fillStyle = this.getPitchColor(note.n, Math.max(0.3, note.v / 127)); 
      this.rCtx.fillRect(x - noteW, Math.max(0, y - 4), noteW, 8); 
    });

    requestAnimationFrame(() => this.renderLoop());
  }
}
