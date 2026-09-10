/**
 * TelemetryController
 * Manages uPlot charting and live numeric readouts for the UI.
 */
export class TelemetryController {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.ohmsReadout = document.getElementById('readout-ohms');
    this.siemensReadout = document.getElementById('readout-siemens');
    
    // Arrays for uPlot: [ [Timestamps], [Normalized Base], [Volatility] ]
    this.data = [ [], [], [] ];
    
    const opts = {
      title: "Bio-Activity (Meso/Micro)",
      width: this.container.clientWidth || 800,
      height: 250,
      scales: {
        x: { time: true },
        y: { range: [0, 1] }
      },
      series: [
        {}, // X-axis
        {
          label: "Base Activity",
          stroke: "#00ff00",
          width: 2
        },
        {
          label: "Volatility",
          stroke: "#ff00ff",
          width: 2
        }
      ]
    };

    // Initialize uPlot
    this.chart = new uPlot(opts, this.data, this.container);
    
    // Handle window resizing gracefully
    window.addEventListener("resize", () => {
      this.chart.setSize({ width: this.container.clientWidth, height: 250 });
    });
  }

  update(timestamp, base, volatility, rawPulse) {
    // 1. Update Chart Data
    this.data[0].push(timestamp);
    this.data[1].push(base);
    this.data[2].push(volatility);

    // Keep the array length manageable for real-time memory stability
    if (this.data[0].length > 300) {
      this.data[0].shift();
      this.data[1].shift();
      this.data[2].shift();
    }
    this.chart.setData(this.data);

    // 2. Update Numeric Readouts
    if (this.ohmsReadout && this.siemensReadout) {
      const ohms = this.calculateOhms(rawPulse);
      const microSiemens = this.calculateMicroSiemens(ohms);
      
      const ohmsDisplay = ohms > 10000 
        ? `${(ohms / 1000).toFixed(1)} kΩ` 
        : `${Math.round(ohms)} Ω`;

      this.ohmsReadout.innerText = ohmsDisplay;
      this.siemensReadout.innerText = `${microSiemens.toFixed(2)} µS`;
    }
  }

  // Uses the CHANGE ISR half-period math
  calculateOhms(pulseWidthUs) {
    const cF = 4.2e-9;   
    const halfRa = 1950; 
    const tSec = pulseWidthUs * 1e-6; 
    const rPlant = (tSec / (Math.LN2 * cF)) - halfRa;
    return Math.max(0, rPlant); 
  }

  calculateMicroSiemens(ohms) {
    return ohms <= 0 ? 0 : (1000000 / ohms); 
  }
}