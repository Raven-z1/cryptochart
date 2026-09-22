/**
 * Binance USDⓈ-M 5m Chart - Event Listeners & Application Bootstrap
 */

dom.dockIndicatorsBtn.addEventListener('click', () => openSheet(dom.indBackdrop));
dom.indCloseBtn.addEventListener('click', closeAllSheets);
dom.indBackdrop.addEventListener('click', e => {
  if (e.target === dom.indBackdrop) closeAllSheets();
});

// Indicator toggles
if (dom.togHighLow) {
  dom.togHighLow.checked = !!state.indicators.highLowLines;
  dom.togHighLow.addEventListener('change', e => {
    haptic(15);
    state.indicators.highLowLines = e.target.checked;
    try {
      localStorage.setItem('cc_ind_highlow', state.indicators.highLowLines ? '1' : '0');
    } catch (_) {}
    updateHighLowDistances();
    showToast(e.target.checked ? '24h High/Low Lines Shown' : '24h High/Low Lines Hidden');
  });
}

// Range HUD & 24h Stat columns click-to-cycle display format (% / $ / both)
if (dom.rangeHud) dom.rangeHud.addEventListener('click', cycleDistMode);
if (dom.col24hHigh) dom.col24hHigh.addEventListener('click', cycleDistMode);
if (dom.col24hLow) dom.col24hLow.addEventListener('click', cycleDistMode);
if (dom.col24hRange) dom.col24hRange.addEventListener('click', cycleDistMode);

dom.togBb.addEventListener('change', e => {
  haptic(15);
  state.indicators.bb = e.target.checked;
  bbUpperSeries.applyOptions({ visible: e.target.checked });
  bbMiddleSeries.applyOptions({ visible: e.target.checked });
  bbLowerSeries.applyOptions({ visible: e.target.checked });
  if (e.target.checked) renderChartData();
});

dom.togVol.addEventListener('change', e => {
  haptic(15);
  state.indicators.volume = e.target.checked;
  volumeSeries.applyOptions({ visible: e.target.checked });
});

dom.togHa.addEventListener('change', e => {
  haptic(15);
  state.chartStyle = e.target.checked ? 'heikin' : 'candles';
  state.isHeikinAshi = e.target.checked;
  try {
    localStorage.setItem('cc_chart_style', state.chartStyle);
  } catch (_) {}
  renderChartData();
  showToast(e.target.checked ? 'Heikin-Ashi Enabled' : 'Candlestick Enabled');
});

// Header Category Tag click listener (cycle category Gainers -> Volume -> Losers -> Watchlist)
if (dom.headCatTag) {
  dom.headCatTag.addEventListener('click', () => {
    haptic(15);
    const order = ['gainers', 'volume', 'losers', 'watchlist'];
    const curIdx = order.indexOf(state.activeCategory);
    const nextCat = order[(curIdx + 1) % order.length];
    setActiveCategory(nextCat);
    showToast(`Category: ${getCategoryDisplayName(nextCat)}`);
  });
}

if (dom.prevChartBtn) {
  dom.prevChartBtn.addEventListener('click', switchChartPrev);
}

if (dom.nextChartBtn) {
  dom.nextChartBtn.addEventListener('click', switchChartNext);
}

if (dom.chartStyleBtn) {
  dom.chartStyleBtn.addEventListener('click', cycleChartStyle);
}

// Swipe Gestures on Top App Bar & Stats Ribbon
if (dom.statsRibbon) setupSwipeNavigation(dom.statsRibbon);
if (dom.appHeader) setupSwipeNavigation(dom.appHeader);

// Global Keyboard Shortcuts for Lightning Chart Switching
window.addEventListener('keydown', (e) => {
  const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    if (e.key === 'Escape') {
      closeAllSheets();
    }
    return;
  }

  if (e.key === 'Escape') {
    closeAllSheets();
    return;
  }

  // Delete active position drawing
  if ((e.key === 'Delete' || e.key === 'Backspace') && positionState.active) {
    e.preventDefault();
    clearPosition(true);
    return;
  }

  // Quick shortcuts: Alt+L or Shift+L for Long, Alt+S or Shift+S for Short
  if ((e.key === 'l' || e.key === 'L') && (e.altKey || e.shiftKey)) {
    e.preventDefault();
    drawPosition('long');
    return;
  }
  if ((e.key === 's' || e.key === 'S') && (e.altKey || e.shiftKey)) {
    e.preventDefault();
    drawPosition('short');
    return;
  }

  // Switch next / prev chart: Right / Left arrows, brackets [ ], or j / k
  if (e.key === 'ArrowRight' || e.key === ']' || e.key === 'j') {
    e.preventDefault();
    switchChartNext();
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === '[' || e.key === 'k') {
    e.preventDefault();
    switchChartPrev();
    return;
  }

  // Switch timeframe: Up / Down arrows
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    const curIdx = VALID_INTERVALS.indexOf(state.interval);
    if (curIdx > 0) setTimeframe(VALID_INTERVALS[curIdx - 1]);
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const curIdx = VALID_INTERVALS.indexOf(state.interval);
    if (curIdx !== -1 && curIdx < VALID_INTERVALS.length - 1) setTimeframe(VALID_INTERVALS[curIdx + 1]);
    return;
  }

  // Number keys for timeframes: 1=1m, 2=3m, 3=5m, 4=15m, 5=30m, 6=1h, 7=4h, 8=1d
  const numMap = { '1': '1m', '2': '3m', '3': '5m', '4': '15m', '5': '30m', '6': '1h', '7': '4h', '8': '1d' };
  if (numMap[e.key]) {
    setTimeframe(numMap[e.key]);
    return;
  }

  // 'c' or 'C' key to cycle chart style (Candlestick / Heikin-Ashi / Line)
  if (e.key.toLowerCase() === 'c') {
    cycleChartStyle();
    return;
  }

  // '/' or any single letter key A-Z: open pair search with that letter
  if (e.key === '/' || (/^[a-zA-Z]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey)) {
    e.preventDefault();
    openSheet(dom.marketBackdrop);
    dom.coinSearchInput.value = e.key === '/' ? '' : e.key.toUpperCase();
    renderSheetCoins();
    setTimeout(() => {
      dom.coinSearchInput.focus();
      dom.coinSearchInput.setSelectionRange(dom.coinSearchInput.value.length, dom.coinSearchInput.value.length);
    }, 60);
  }
});

// Alert Sheet
dom.openAlertBtn.addEventListener('click', () => openSheet(dom.alertBackdrop));
dom.dockAlertBtn.addEventListener('click', () => openSheet(dom.alertBackdrop));
dom.alertCloseBtn.addEventListener('click', closeAllSheets);
dom.alertBackdrop.addEventListener('click', e => {
  if (e.target === dom.alertBackdrop) closeAllSheets();
});

dom.togVibrate.addEventListener('change', e => {
  state.alerts.vibrate = e.target.checked;
  if (e.target.checked) haptic(30);
});
dom.togSound.addEventListener('change', e => {
  state.alerts.sound = e.target.checked;
  if (e.target.checked) playChime();
});
dom.togUrgency.addEventListener('change', e => {
  state.alerts.urgency = e.target.checked;
});

// Timeframe Sheet Listeners (Slide-in from bottom)
function openTimeframeSheet() {
  openSheet(dom.tfSheetBackdrop);
  updateTimeframeUI();
}
if (dom.dockTfBtn) {
  dom.dockTfBtn.addEventListener('click', openTimeframeSheet);
}
if (dom.tfSheetClose) {
  dom.tfSheetClose.addEventListener('click', closeAllSheets);
}
if (dom.tfSheetBackdrop) {
  dom.tfSheetBackdrop.addEventListener('click', (e) => {
    if (e.target === dom.tfSheetBackdrop) closeAllSheets();
  });
}
if (dom.tfSheetBody) {
  dom.tfSheetBody.addEventListener('click', (e) => {
    const card = e.target.closest('.tf-card');
    if (card && card.dataset.interval) {
      setTimeframe(card.dataset.interval);
    }
  });
}

// Also tap chart watermark to open timeframe selector
if (dom.chartWatermark) {
  dom.chartWatermark.style.cursor = 'pointer';
  dom.chartWatermark.addEventListener('click', openTimeframeSheet);
}

// Fit / Reset View (100 Candles Mobile Default)
dom.fitBtn.addEventListener('click', () => {
  haptic(15);
  const range = chart.timeScale().getVisibleLogicalRange();
  if (range && Math.abs((range.to - range.from) - 106) < 20) {
    chart.timeScale().fitContent();
    showToast('Zoom: Fit All');
  } else {
    zoomToDefaultCandles(100);
    showToast('Zoom: 100 Candles (Default)');
  }
});

// Rotate / Fullscreen
dom.rotateBtn.addEventListener('click', toggleLandscapeFullscreen);

// Visibility Change (App resume)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.symbol) {
    fetchKlines(state.symbol, state.interval);
  }
});

// App Init
async function init() {
  showToast('Connecting Binance USD-M 5m...');
  updateTimeframeUI();
  updateChartStyleBtnUI();
  updateCategoryBadgeUI();
  renderQuickSwitcher();
  updateApiEnvDisplay();
  syncBinanceServerTime();
  if (state.binanceApi.key && state.binanceApi.secret) {
    loadPositionsAndBalance();
  }
  await Promise.all([loadExchangeInfo(), load24hTickers()]);
  await fetchKlines(state.symbol, state.interval);
  connectWebSocket(state.symbol, state.interval);

  state.candleTimerInterval = window.setInterval(updateCountdownTimer, 1000);
  state.statRefreshInterval = window.setInterval(load24hTickers, 15000);
}

init();

// Application Bootstrap
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
