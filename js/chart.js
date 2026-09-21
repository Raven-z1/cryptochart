/**
 * TradingView Lightweight Charts Setup, Series, and Data Rendering
 */

// Initialize Lightweight Charts for Mobile Touch
if (typeof LightweightCharts === 'undefined') {
  alert('Could not load chart library. Please ensure you are connected to internet.');
}

var chart = (typeof LightweightCharts !== 'undefined') ? LightweightCharts.createChart(dom.chartContainer, {
  layout: {
    background: { color: '#0b0e11' },
    textColor: '#848e9c',
    fontFamily: "'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: 10,
  },
  grid: {
    vertLines: { color: 'rgba(35, 39, 46, 0.4)' },
    horzLines: { color: 'rgba(35, 39, 46, 0.4)' },
  },
  crosshair: {
    mode: LightweightCharts.CrosshairMode.Normal,
    vertLine: {
      color: '#4f5b70',
      width: 1,
      style: LightweightCharts.LineStyle.Dashed,
      labelBackgroundColor: '#181a20',
    },
    horzLine: {
      color: '#4f5b70',
      width: 1,
      style: LightweightCharts.LineStyle.Dashed,
      labelBackgroundColor: '#181a20',
    },
  },
  rightPriceScale: {
    borderColor: '#23272e',
    scaleMargins: {
      top: 0.08,
      bottom: 0.15,
    },
  },
  timeScale: {
    borderColor: '#23272e',
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 6,
    minBarSpacing: 1,
  },
  handleScroll: {
    mouseWheel: true,
    pressedMouseMove: true,
    horzTouchDrag: true,
    vertTouchDrag: true,
  },
  handleScale: {
    axisPressedMouseMove: true,
    mouseWheel: true,
    pinch: true,
  },
}) : null;

// Candlestick Series
var candleSeries = chart.addCandlestickSeries({
  upColor: '#0ecb81',
  downColor: '#f6465d',
  borderVisible: false,
  wickUpColor: '#0ecb81',
  wickDownColor: '#f6465d',
});

// Area / Line Series for Line Chart Style
var lineSeries = chart.addAreaSeries({
  topColor: 'rgba(240, 185, 11, 0.35)',
  bottomColor: 'rgba(240, 185, 11, 0.02)',
  lineColor: '#f0b90b',
  lineWidth: 2,
  visible: false,
});

// Volume Series
var volumeSeries = chart.addHistogramSeries({
  color: '#26a69a',
  priceFormat: { type: 'volume' },
  priceScaleId: '',
});

volumeSeries.priceScale().applyOptions({
  scaleMargins: { top: 0.84, bottom: 0 },
});

// Bollinger Bands Series
var bbUpperSeries = chart.addLineSeries({ color: 'rgba(56, 189, 248, 0.6)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, visible: false });
var bbMiddleSeries = chart.addLineSeries({ color: '#38bdf8', lineWidth: 1, visible: false });
var bbLowerSeries = chart.addLineSeries({ color: 'rgba(56, 189, 248, 0.6)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, visible: false });

// Resize observer
var resizeObserver = new ResizeObserver(entries => {
  if (!entries || entries.length === 0) return;
  const { width, height } = entries[0].contentRect;
  chart.applyOptions({ width, height });
});
resizeObserver.observe(dom.chartContainer);

function updateLegend(candle) {
  if (!candle) return;
  dom.legOpen.textContent = formatPrice(candle.open);
  dom.legHigh.textContent = formatPrice(candle.high);
  dom.legLow.textContent = formatPrice(candle.low);
  dom.legClose.textContent = formatPrice(candle.close);
  const chg = candle.close - candle.open;
  const chgPct = ((chg / candle.open) * 100).toFixed(2);
  dom.legChange.textContent = `${chg >= 0 ? '+' : ''}${chgPct}%`;
  dom.legChange.style.color = chg >= 0 ? 'var(--color-bull)' : 'var(--color-bear)';
  if (candle.volume !== undefined) dom.legVol.textContent = formatVol(candle.volume);
}

chart.subscribeCrosshairMove(param => {
  if (!param || !param.time || !param.seriesData) {
    if (state.rawCandles.length > 0) {
      updateLegend(state.rawCandles[state.rawCandles.length - 1]);
    }
    return;
  }
  let cd = param.seriesData.get(candleSeries);
  if (!cd && state.rawCandles) {
    cd = state.rawCandles.find(c => c.time === param.time);
  }
  const vd = param.seriesData.get(volumeSeries);
  if (cd) {
    updateLegend(
      { open: cd.open, high: cd.high, low: cd.low, close: cd.close, volume: vd?.value !== undefined ? vd.value : cd.volume }
    );
  }
});

// In-Memory Chart Cache for Instant 0ms Switching
var chartCache = new Map();
window.chartCache = chartCache;

// Update Chart Style Button UI
function updateChartStyleBtnUI() {
  if (!dom.chartStyleBtn) return;
  if (state.chartStyle === 'line') {
    dom.chartStyleBtn.textContent = '📈 Line';
  } else if (state.chartStyle === 'heikin') {
    dom.chartStyleBtn.textContent = '📊 Heikin';
  } else {
    dom.chartStyleBtn.textContent = '🕯️ Candles';
  }
  if (dom.togHa) dom.togHa.checked = (state.chartStyle === 'heikin');
}

function cycleChartStyle() {
  haptic(15);
  if (state.chartStyle === 'candles') {
    state.chartStyle = 'heikin';
  } else if (state.chartStyle === 'heikin') {
    state.chartStyle = 'line';
  } else {
    state.chartStyle = 'candles';
  }
  state.isHeikinAshi = (state.chartStyle === 'heikin');
  try {
    localStorage.setItem('cc_chart_style', state.chartStyle);
  } catch (_) {}
  renderChartData();
  const names = { candles: 'Candlestick', heikin: 'Heikin-Ashi', line: 'Line (Area)' };
  showToast(`Chart: ${names[state.chartStyle]}`);
}

// Mobile Default Zoom: 100 Candles
function zoomToDefaultCandles(count = CONFIG.defaultVisibleCandles || 100, rightOffset = 6) {
  const len = state.rawCandles ? state.rawCandles.length : 0;
  if (len === 0) return;
  if (len <= count) {
    chart.timeScale().fitContent();
    return;
  }
  const from = Math.max(0, len - count);
  const to = (len - 1) + rightOffset;
  chart.timeScale().setVisibleLogicalRange({ from, to });
}

// Render chart data
function renderChartData() {
  if (!state.rawCandles || state.rawCandles.length === 0) return;

  const prec = getPrecision(state.symbol);
  const minMove = state.symbolsMeta[state.symbol]?.tickSize ? parseFloat(state.symbolsMeta[state.symbol].tickSize) : Math.pow(10, -prec);
  candleSeries.applyOptions({ priceFormat: { type: 'price', precision: prec, minMove: minMove } });
  lineSeries.applyOptions({ priceFormat: { type: 'price', precision: prec, minMove: minMove } });

  if (state.chartStyle === 'line') {
    candleSeries.applyOptions({ visible: false });
    lineSeries.applyOptions({ visible: true });
    lineSeries.setData(state.rawCandles.map(c => ({ time: c.time, value: c.close })));
  } else if (state.chartStyle === 'heikin') {
    lineSeries.applyOptions({ visible: false });
    candleSeries.applyOptions({ visible: true });
    candleSeries.setData(computeHeikinAshi(state.rawCandles));
  } else {
    lineSeries.applyOptions({ visible: false });
    candleSeries.applyOptions({ visible: true });
    candleSeries.setData(state.rawCandles);
  }

  const vol = state.rawCandles.map(c => ({
    time: c.time,
    value: c.volume,
    color: c.close >= c.open ? 'rgba(14, 203, 129, 0.45)' : 'rgba(246, 70, 93, 0.45)',
  }));
  volumeSeries.setData(vol);

  if (state.indicators.bb) {
    const bb = calculateBollingerBands(state.rawCandles, 20, 2);
    bbUpperSeries.setData(bb.upper);
    bbMiddleSeries.setData(bb.middle);
    bbLowerSeries.setData(bb.lower);
  }

  updateLegend(state.rawCandles[state.rawCandles.length - 1]);
  const styleSuffix = state.chartStyle === 'heikin' ? ' HA' : state.chartStyle === 'line' ? ' LINE' : '';
  dom.chartWatermark.textContent = `${state.symbol} ${state.interval.toUpperCase()}${styleSuffix}`;
  updateChartStyleBtnUI();
  updateHighLowDistances();
  if (positionState.active) {
    updatePositionUI();
  }
}


let highPriceLine = null;
let lowPriceLine = null;
let activePriceLineSeries = null;

function updateChartHighLowLines(high, low, highPct, lowPct) {
  const targetSeries = (state.chartStyle === 'line' ? lineSeries : candleSeries);
  if (!targetSeries || !state.indicators.highLowLines || !high || !low) {
    if (activePriceLineSeries) {
      if (highPriceLine) { try { activePriceLineSeries.removePriceLine(highPriceLine); } catch (_) {} highPriceLine = null; }
      if (lowPriceLine) { try { activePriceLineSeries.removePriceLine(lowPriceLine); } catch (_) {} lowPriceLine = null; }
      activePriceLineSeries = null;
    }
    return;
  }

  // If target series changed (e.g. toggled to line style)
  if (activePriceLineSeries && activePriceLineSeries !== targetSeries) {
    if (highPriceLine) { try { activePriceLineSeries.removePriceLine(highPriceLine); } catch (_) {} highPriceLine = null; }
    if (lowPriceLine) { try { activePriceLineSeries.removePriceLine(lowPriceLine); } catch (_) {} lowPriceLine = null; }
    activePriceLineSeries = null;
  }

  const hTitle = `24h High (${highPct >= 0 ? '0.0%' : highPct.toFixed(1) + '%'})`;
  const lTitle = `24h Low (+${lowPct.toFixed(1)}%)`;

  const highOpts = {
    price: high,
    color: 'rgba(246, 70, 93, 0.75)',
    lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true,
    title: hTitle,
  };

  const lowOpts = {
    price: low,
    color: 'rgba(14, 203, 129, 0.75)',
    lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true,
    title: lTitle,
  };

  try {
    if (!highPriceLine) {
      highPriceLine = targetSeries.createPriceLine(highOpts);
      activePriceLineSeries = targetSeries;
    } else {
      highPriceLine.applyOptions(highOpts);
    }

    if (!lowPriceLine) {
      lowPriceLine = targetSeries.createPriceLine(lowOpts);
    } else {
      lowPriceLine.applyOptions(lowOpts);
    }
  } catch (_) {}
}


// Expose chart series and methods globally
window.chart = chart;
window.candleSeries = candleSeries;
window.lineSeries = lineSeries;
window.volumeSeries = volumeSeries;
window.bbUpperSeries = bbUpperSeries;
window.bbMiddleSeries = bbMiddleSeries;
window.bbLowerSeries = bbLowerSeries;
window.renderChartData = renderChartData;
window.updateLegend = updateLegend;
window.updateChartStyleBtnUI = updateChartStyleBtnUI;
window.cycleChartStyle = cycleChartStyle;
window.zoomToDefaultCandles = zoomToDefaultCandles;
window.updateChartHighLowLines = updateChartHighLowLines;
