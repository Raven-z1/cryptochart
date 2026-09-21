/**
 * Utility Functions: Audio, Haptics, Formatting, and Technical Indicators
 */

function haptic(duration = 15) {
  if (state.alerts.vibrate && navigator.vibrate) {
    try {
      navigator.vibrate(duration);
    } catch (e) {}
  }
}

// Android Toast Helper
let toastTimer = null;
function showToast(msg, duration = 2000) {
  dom.androidToast.textContent = msg;
  dom.androidToast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.androidToast.classList.remove('show');
  }, duration);
}

// Web Audio API Chime (Zero external dependencies)
function playChime() {
  if (!state.alerts.sound) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12); // E6

    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {}
}


// Calculations: Bollinger Bands, Heikin-Ashi
function calculateBollingerBands(data, period = 20, multiplier = 2) {
  if (data.length < period) return { upper: [], middle: [], lower: [] };
  const upper = [], middle = [], lower = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j].close;
    const sma = sum / period;
    let vsum = 0;
    for (let j = 0; j < period; j++) vsum += Math.pow(data[i - j].close - sma, 2);
    const std = Math.sqrt(vsum / period);
    const t = data[i].time;
    middle.push({ time: t, value: sma });
    upper.push({ time: t, value: sma + multiplier * std });
    lower.push({ time: t, value: sma - multiplier * std });
  }
  return { upper, middle, lower };
}

function computeHeikinAshi(candles) {
  if (!candles || candles.length === 0) return [];
  const ha = [];
  let prevHaOpen = candles[0].open;
  let prevHaClose = candles[0].close;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen = i === 0 ? (c.open + c.close) / 2 : (prevHaOpen + prevHaClose) / 2;
    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);
    ha.push({ time: c.time, open: haOpen, high: haHigh, low: haLow, close: haClose });
    prevHaOpen = haOpen;
    prevHaClose = haClose;
  }
  return ha;
}

// Formatting
function getPrecision(sym) {
  return state.symbolsMeta[sym]?.pricePrecision !== undefined ? state.symbolsMeta[sym].pricePrecision : 2;
}

function formatPrice(val, sym = state.symbol) {
  if (val === null || val === undefined || isNaN(val)) return '--';
  const p = getPrecision(sym);
  return Number(val).toLocaleString(undefined, { minimumFractionDigits: p, maximumFractionDigits: p });
}

function formatVol(val) {
  if (!val || isNaN(val)) return '--';
  if (val >= 1e9) return (val / 1e9).toFixed(2) + 'B';
  if (val >= 1e6) return (val / 1e6).toFixed(2) + 'M';
  if (val >= 1e3) return (val / 1e3).toFixed(1) + 'K';
  return Number(val).toFixed(1);
}

// Legend update

function parseIntervalMs(intv) {
  if (!intv || typeof intv !== 'string') return 5 * 60 * 1000;
  const num = parseInt(intv) || 5;
  if (intv.endsWith('m')) return num * 60 * 1000;
  if (intv.endsWith('h')) return num * 60 * 60 * 1000;
  if (intv.endsWith('d')) return num * 24 * 60 * 60 * 1000;
  if (intv.endsWith('w')) return num * 7 * 24 * 60 * 60 * 1000;
  if (intv.endsWith('M')) return num * 30 * 24 * 60 * 60 * 1000;
  return 5 * 60 * 1000;
}

// Helper: display name for coin chips (e.g. 1000PEPEUSDT -> PEPE, BTCUSDT -> BTC)
function getCoinDisplayName(sym) {
  if (!sym) return '';
  let base = sym.replace(/USDT$/, '').replace(/BUSD$/, '');
  if (base.startsWith('1000')) base = base.slice(4);
  return base;
}

// Helper: get the list of symbols for the currently active category/tab

// Expose utils globally
window.haptic = haptic;
window.showToast = showToast;
window.playChime = playChime;
window.calculateBollingerBands = calculateBollingerBands;
window.computeHeikinAshi = computeHeikinAshi;
window.getPrecision = getPrecision;
window.formatPrice = formatPrice;
window.formatVol = formatVol;
window.parseIntervalMs = parseIntervalMs;
window.getCoinDisplayName = getCoinDisplayName;
