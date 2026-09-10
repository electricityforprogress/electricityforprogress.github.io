/**
 * Web MIDI Interface
 * Maps triggers from the sequencer engine directly to the macOS IAC Driver.
 */
export class MidiOutputController {
  constructor() {
    this.midiAccess = null;
    this.selectedOutput = null;
    this.isMuted = false;
    this.activeNoteTimeouts = new Set();
  }

  async init(preferredPortName = 'IAC') {
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI API is not supported.');
    this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    this.bindOutput(preferredPortName);
    this.midiAccess.onstatechange = (e) => {
      if (e.port.type === 'output') this.bindOutput(preferredPortName);
    };
    return this.getAvailableOutputs();
  }

  bindOutput(preferredPortName) {
    const outputs = Array.from(this.midiAccess.outputs.values());
    this.selectedOutput = outputs.find(out => out.name.includes(preferredPortName)) || outputs[0] || null;
  }

  getAvailableOutputs() {
    if (!this.midiAccess) return [];
    return Array.from(this.midiAccess.outputs.values()).map(o => ({ id: o.id, name: o.name }));
  }

  setOutput(portId) {
    if (!this.midiAccess) return;
    this.selectedOutput = this.midiAccess.outputs.get(portId) || this.selectedOutput;
  }

  setMute(muteState) {
    this.isMuted = Boolean(muteState);
    if (this.isMuted) this.panic();
  }

  sendNote(channel, pitch, velocity, durationMs = 80, delayMs = 0) {
    if (this.isMuted || !this.selectedOutput) return;
    const midiChan = Math.max(0, Math.min(15, channel - 1));
    const statusNoteOn = 0x90 | midiChan;
    const statusNoteOff = 0x80 | midiChan;

    const execute = () => {
      if (this.isMuted) return;
      this.selectedOutput.send([statusNoteOn, pitch & 0x7F, velocity & 0x7F]);
      const offTimeout = setTimeout(() => {
        if (this.selectedOutput) this.selectedOutput.send([statusNoteOff, pitch & 0x7F, 0]);
        this.activeNoteTimeouts.delete(offTimeout);
      }, Math.max(10, durationMs));
      this.activeNoteTimeouts.add(offTimeout);
    };

    if (delayMs > 0) {
      const delayTimeout = setTimeout(() => {
        execute();
        this.activeNoteTimeouts.delete(delayTimeout);
      }, delayMs);
      this.activeNoteTimeouts.add(delayTimeout);
    } else {
      execute();
    }
  }

  sendCC(channel, ccNumber, value) {
    if (!this.selectedOutput) return;
    const midiChan = Math.max(0, Math.min(15, channel - 1));
    this.selectedOutput.send([0xB0 | midiChan, ccNumber & 0x7F, value & 0x7F]);
  }

  panic() {
    this.activeNoteTimeouts.forEach(t => clearTimeout(t));
    this.activeNoteTimeouts.clear();
    if (!this.selectedOutput) return;
    for (let ch = 0; ch < 16; ch++) {
      this.selectedOutput.send([0xB0 | ch, 123, 0]);
      this.selectedOutput.send([0xB0 | ch, 120, 0]);
    }
  }
}
