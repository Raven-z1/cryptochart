/**
 * Market Data, WebSockets, Navigation, Sheets, and UI State Management
 */

// Binance USD-M API
async function loadExchangeInfo() {
  try {
    const res = await fetch(`${CONFIG.restBase}/fapi/v1/exchangeInfo`);
    const data = await res.json();
    data.symbols.forEach(s => {
      if (s.quoteAsset === 'USDT' && s.status === 'TRADING') {
        const pf = s.filters.find(f => f.filterType === 'PRICE_FILTER');
        const lf = s.filters.find(f => f.filterType === 'LOT_SIZE');
        const nf = s.filters.find(f => f.filterType === 'MIN_NOTIONAL');
        state.symbolsMeta[s.symbol] = {
          pricePrecision: s.pricePrecision,
          quantityPrecision: s.quantityPrecision,
          tickSize: pf ? pf.tickSize : '0.01',
          stepSize: lf ? lf.stepSize : '0.001',
          minQty: lf ? lf.minQty : '0.001',
          minNotional: nf ? parseFloat(nf.notional || '5.0') : 5.0,
          baseAsset: s.baseAsset,
        };
      }
    });
  } catch (e) {
    console.warn('exchangeInfo fallback:', e);
  }
}

async function load24hTickers() {
  try {
    const res = await fetch(`${CONFIG.restBase}/fapi/v1/ticker/24hr`);
    const list = await res.json();
    if (Array.isArray(list)) {
      state.allTickers = list
        .filter(t => t.symbol && t.symbol.endsWith('USDT') && /^[A-Z0-9]+$/.test(t.symbol))
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
      renderSheetCoins();
      renderQuickSwitcher();
      updateStatsRibbon();
    }
  } catch (e) {
    console.error('24hr ticker error:', e);
  }
}

// 24h Price Lines on Chart

// Distance from 24h High & Low Calculator & Renderer
function updateHighLowDistances() {
  const cur = state.currentPrice;
  const high = state.high24h;
  const low = state.low24h;

  if (!cur || !high || !low || high <= 0 || low <= 0) {
    if (dom.statHighDist) dom.statHighDist.textContent = '--';
    if (dom.statLowDist) dom.statLowDist.textContent = '--';
    if (dom.statRangePos) dom.statRangePos.textContent = '--';
    if (dom.statRangeDesc) dom.statRangeDesc.textContent = '--';
    if (dom.hudLowDist) dom.hudLowDist.textContent = 'L: --';
    if (dom.hudHighDist) dom.hudHighDist.textContent = 'H: --';
    if (dom.hudPosBadge) dom.hudPosBadge.textContent = '--%';
    if (dom.hudFill) dom.hudFill.style.width = '50%';
    if (dom.hudPin) dom.hudPin.style.left = '50%';
    return;
  }

  // Dynamic boundaries in case live price breaks 24h boundaries
  const effectiveHigh = Math.max(high, cur);
  const effectiveLow = Math.min(low, cur);

  // Distance to 24h High (cur - effectiveHigh <= 0)
  const highDiff = effectiveHigh - cur; // >= 0
  const highPct = effectiveHigh > 0 ? ((-highDiff / effectiveHigh) * 100) : 0;

  // Distance from 24h Low (cur - effectiveLow >= 0)
  const lowDiff = cur - effectiveLow; // >= 0
  const lowPct = effectiveLow > 0 ? ((lowDiff / effectiveLow) * 100) : 0;

  // Position in 24h range (0% at low, 100% at high)
  const rangeSpan = effectiveHigh - effectiveLow;
  const posPct = rangeSpan > 0 ? Math.min(100, Math.max(0, ((cur - effectiveLow) / rangeSpan) * 100)) : 50;

  // Qualitative range position description
  let posDesc = 'Mid Range';
  if (posPct >= 88) posDesc = 'At 24h High';
  else if (posPct >= 65) posDesc = 'Near High';
  else if (posPct <= 12) posDesc = 'At 24h Low';
  else if (posPct <= 35) posDesc = 'Near Low';
  else if (posPct > 50) posDesc = 'Upper Half';
  else if (posPct < 50) posDesc = 'Lower Half';

  // Secondary Stat Columns
  const mode = state.distDisplayMode || 'both'; // 'both' | 'percent' | 'price'
  const formattedHighDiff = formatPrice(highDiff);
  const formattedLowDiff = formatPrice(lowDiff);

  if (dom.statHighDist) {
    if (highDiff === 0) {
      dom.statHighDist.textContent = '0.00% (At High)';
    } else if (mode === 'percent') {
      dom.statHighDist.textContent = `${highPct.toFixed(2)}% to High`;
    } else if (mode === 'price') {
      dom.statHighDist.textContent = `-${formattedHighDiff}`;
    } else {
      dom.statHighDist.textContent = `${highPct.toFixed(2)}% (-${formattedHighDiff})`;
    }
  }

  if (dom.statLowDist) {
    if (lowDiff === 0) {
      dom.statLowDist.textContent = '0.00% (At Low)';
    } else if (mode === 'percent') {
      dom.statLowDist.textContent = `+${lowPct.toFixed(2)}% from Low`;
    } else if (mode === 'price') {
      dom.statLowDist.textContent = `+${formattedLowDiff}`;
    } else {
      dom.statLowDist.textContent = `+${lowPct.toFixed(2)}% (+${formattedLowDiff})`;
    }
  }

  if (dom.statRangePos) {
    dom.statRangePos.textContent = `${posPct.toFixed(1)}%`;
  }
  if (dom.statRangeDesc) {
    dom.statRangeDesc.textContent = posDesc;
  }

  // HUD / Mini Range Meter
  if (dom.hudLowDist) {
    dom.hudLowDist.textContent = mode === 'price' ? `L +${formatVol(lowDiff)}` : `L +${lowPct.toFixed(1)}%`;
  }
  if (dom.hudHighDist) {
    dom.hudHighDist.textContent = mode === 'price' ? `H -${formatVol(highDiff)}` : `H ${highPct.toFixed(1)}%`;
  }
  if (dom.hudPosBadge) {
    dom.hudPosBadge.textContent = `${Math.round(posPct)}%`;
  }
  if (dom.hudFill) {
    dom.hudFill.style.width = `${posPct.toFixed(1)}%`;
  }
  if (dom.hudPin) {
    dom.hudPin.style.left = `${posPct.toFixed(1)}%`;
  }

  // Update chart lines
  updateChartHighLowLines(effectiveHigh, effectiveLow, highPct, lowPct);
}

function cycleDistMode() {
  haptic(15);
  if (state.distDisplayMode === 'both') {
    state.distDisplayMode = 'percent';
  } else if (state.distDisplayMode === 'percent') {
    state.distDisplayMode = 'price';
  } else {
    state.distDisplayMode = 'both';
  }
  try {
    localStorage.setItem('cc_dist_mode', state.distDisplayMode);
  } catch (_) {}
  const labels = {
    both: 'Distance: Percentage & Dollar Difference',
    percent: 'Distance: Percentage Only (%)',
    price: 'Distance: Dollar Amount Difference ($)',
  };
  showToast(labels[state.distDisplayMode]);
  updateHighLowDistances();
}

function updateStatsRibbon() {
  const t = state.allTickers.find(x => x.symbol === state.symbol);
  if (!t) return;

  state.high24h = parseFloat(t.highPrice);
  state.low24h = parseFloat(t.lowPrice);

  const p = parseFloat(t.lastPrice);
  updateLivePrice(p);

  const chg = parseFloat(t.priceChangePercent);
  const isBull = chg >= 0;
  dom.priceChange.textContent = `${isBull ? '+' : ''}${chg.toFixed(2)}%`;
  dom.priceChange.className = `change-badge ${isBull ? 'bull' : 'bear'}`;

  dom.statHigh.textContent = formatPrice(t.highPrice);
  dom.statLow.textContent = formatPrice(t.lowPrice);
  dom.statTurnover.textContent = `$${formatVol(t.quoteVolume)}`;

  updateHighLowDistances();
}

function updateLivePrice(newPrice) {
  if (!newPrice) return;
  const old = state.currentPrice;
  state.currentPrice = newPrice;
  dom.livePrice.textContent = `$${formatPrice(newPrice)}`;

  if (old > 0 && newPrice !== old) {
    dom.livePrice.classList.remove('flash-up', 'flash-down');
    void dom.livePrice.offsetWidth;
    dom.livePrice.classList.add(newPrice > old ? 'flash-up' : 'flash-down');
  }

  updateHighLowDistances();
}

const VALID_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];

let fetchAbortController = null;

function reanchorPositionToCandles() {
  if (positionState.active && positionState.startTime && state.rawCandles && state.rawCandles.length > 0) {
    const foundIdx = state.rawCandles.findIndex(c => c.time >= positionState.startTime);
    if (foundIdx !== -1) {
      const diff = positionState.endLogical - positionState.startLogical;
      positionState.startLogical = foundIdx;
      positionState.endLogical = foundIdx + (diff > 0 ? diff : 22);
    }
  }
}

async function fetchKlines(symbol, interval) {
  if (!symbol || typeof symbol !== 'string') symbol = state.symbol || 'BTCUSDT';
  if (!interval || typeof interval !== 'string' || !VALID_INTERVALS.includes(interval)) {
    interval = '5m';
    state.interval = '5m';
  }

  // Abort previous in-flight fetch when switching charts quickly
  if (fetchAbortController) {
    fetchAbortController.abort();
  }
  fetchAbortController = new AbortController();
  const signal = fetchAbortController.signal;

  const cacheKey = `${symbol}_${interval}`;
  const cached = chartCache.get(cacheKey);

  let renderedFromCache = false;
  if (cached && cached.rawCandles && cached.rawCandles.length > 0) {
    state.rawCandles = [...cached.rawCandles];
    const last = state.rawCandles[state.rawCandles.length - 1];
    state.currentCandleCloseTime = last.closeTimeMs;
    state.currentPrice = last.close;
    reanchorPositionToCandles();
    renderChartData();
    zoomToDefaultCandles();
    updateCountdownTimer();
    renderedFromCache = true;
  }

  if (!renderedFromCache) {
    dom.chartLoader.classList.add('show');
  }

  try {
    const url = `${CONFIG.restBase}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${CONFIG.candleLimit}`;
    const res = await fetch(url, { signal });
    if (!res.ok) {
      let detail = '';
      try {
        const err = await res.json();
        if (err && err.msg) detail = `: ${err.msg}`;
      } catch (_) {}
      throw new Error(`HTTP ${res.status}${detail}`);
    }
    const raw = await res.json();

    const candles = raw.map(k => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTimeMs: k[6],
    }));

    chartCache.set(cacheKey, { rawCandles: candles, timestamp: Date.now() });

    state.rawCandles = candles;
    if (state.rawCandles.length > 0) {
      const last = state.rawCandles[state.rawCandles.length - 1];
      state.currentCandleCloseTime = last.closeTimeMs;
      state.currentPrice = last.close;
    }

    reanchorPositionToCandles();
    renderChartData();
    zoomToDefaultCandles();
    updateCountdownTimer();
  } catch (e) {
    if (e.name === 'AbortError') return; // Cancelled because chart switched quickly
    console.error('fetchKlines error:', e);
    showToast(`Network error: ${e.message}`);
  } finally {
    dom.chartLoader.classList.remove('show');
  }
}

function connectWebSocket(symbol, interval) {
  clearTimeout(state.wsReconnectTimer);
  if (state.ws) {
    state.ws.onclose = null;
    state.ws.onerror = null;
    state.ws.close();
    state.ws = null;
  }

  dom.wsStatusText.textContent = `Connecting...`;
  const ws = new WebSocket(`${CONFIG.wsBase}/${symbol.toLowerCase()}@kline_${interval}`);
  state.ws = ws;

  ws.onopen = () => {
    dom.wsStatusText.textContent = `${interval} LIVE`;
  };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.e !== 'kline' || !msg.k) return;

      const k = msg.k;
      const cTime = Math.floor(k.t / 1000);
      const o = parseFloat(k.o);
      const h = parseFloat(k.h);
      const l = parseFloat(k.l);
      const c = parseFloat(k.c);
      const v = parseFloat(k.v);

      state.currentCandleCloseTime = k.T;
      updateLivePrice(c);

      const cObj = { time: cTime, open: o, high: h, low: l, close: c, volume: v, closeTimeMs: k.T };
      const len = state.rawCandles.length;
      if (len > 0 && state.rawCandles[len - 1].time === cTime) {
        state.rawCandles[len - 1] = cObj;
      } else if (len > 0 && cTime > state.rawCandles[len - 1].time) {
        state.rawCandles.push(cObj);
        if (state.rawCandles.length > CONFIG.candleLimit) state.rawCandles.shift();
      }

      if (state.chartStyle === 'line') {
        lineSeries.update({ time: cTime, value: c });
      } else if (state.chartStyle === 'heikin') {
        const ha = computeHeikinAshi(state.rawCandles);
        candleSeries.update(ha[ha.length - 1]);
      } else {
        candleSeries.update({ time: cTime, open: o, high: h, low: l, close: c });
      }

      volumeSeries.update({
        time: cTime,
        value: v,
        color: c >= o ? 'rgba(14, 203, 129, 0.45)' : 'rgba(246, 70, 93, 0.45)',
      });

      updateLegend(cObj);
    } catch (e) {}
  };

  ws.onclose = () => {
    dom.wsStatusText.textContent = 'Offline';
    clearTimeout(state.wsReconnectTimer);
    state.wsReconnectTimer = setTimeout(() => {
      connectWebSocket(state.symbol, state.interval);
    }, 3000);
  };
}

// Candle Countdown & Alerts
function updateCountdownTimer() {
  if (!state.currentCandleCloseTime) {
    const now = Date.now();
    const ms = parseIntervalMs(state.interval);
    state.currentCandleCloseTime = (Math.floor(now / ms) + 1) * ms - 1;
  }

  const remainingMs = Math.max(0, state.currentCandleCloseTime - Date.now());
  const totalSec = Math.floor(remainingMs / 1000);

  if (totalSec >= 3600) {
    const hrs = Math.floor(totalSec / 3600);
    const remMins = Math.floor((totalSec % 3600) / 60);
    const remSecs = totalSec % 60;
    dom.candleTimer.textContent = `${hrs}:${String(remMins).padStart(2, '0')}:${String(remSecs).padStart(2, '0')}`;
  } else {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    dom.candleTimer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  if (state.alerts.urgency && totalSec <= 15) {
    dom.candleTimer.classList.add('urgent');
  } else {
    dom.candleTimer.classList.remove('urgent');
  }

  // Trigger Candle Close Alert exactly once per candle close boundary
  if (totalSec === 0 && state.lastAlertTriggeredTime !== state.currentCandleCloseTime) {
    state.lastAlertTriggeredTime = state.currentCandleCloseTime;
    haptic(80); // Android phone vibration
    playChime(); // Audio chime
    showToast(`🔔 ${state.symbol} ${state.interval} Candle Closed!`);
  }
}


function getActiveCategorySymbols() {
  if (!state.allTickers || state.allTickers.length === 0) {
    return (state.watchlist && state.watchlist.length > 0) ? state.watchlist : CONFIG.defaultWatchlist;
  }

  const validPairs = state.allTickers.filter(t => t.symbol && t.symbol.endsWith('USDT') && /^[A-Z0-9]+$/.test(t.symbol));

  if (state.activeCategory === 'gainers') {
    return [...validPairs]
      .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
      .slice(0, 50)
      .map(t => t.symbol);
  }

  if (state.activeCategory === 'losers') {
    return [...validPairs]
      .sort((a, b) => parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent))
      .slice(0, 50)
      .map(t => t.symbol);
  }

  if (state.activeCategory === 'volume') {
    return [...validPairs]
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 50)
      .map(t => t.symbol);
  }

  // 'watchlist'
  return (state.watchlist && state.watchlist.length > 0) ? state.watchlist : CONFIG.defaultWatchlist;
}

function getCategoryDisplayName(cat) {
  const labels = { gainers: 'Top Gainers', volume: 'Top Volume', losers: 'Top Losers', watchlist: 'Watchlist' };
  return labels[cat] || 'Top Gainers';
}

function setActiveCategory(cat) {
  if (!['gainers', 'volume', 'losers', 'watchlist'].includes(cat)) cat = 'gainers';
  state.activeCategory = cat;
  sheetFilter = cat;
  try {
    localStorage.setItem('cc_active_category', cat);
  } catch (_) {}
  updateCategoryBadgeUI();
  renderQuickSwitcher();
  renderSheetCoins();
}

function updateCategoryBadgeUI() {
  const cat = state.activeCategory || 'gainers';
  const meta = {
    gainers: { icon: '🚀', label: 'GAINERS' },
    volume: { icon: '🔥', label: 'VOLUME' },
    losers: { icon: '📉', label: 'LOSERS' },
    watchlist: { icon: '⭐', label: 'WATCH' },
  }[cat] || { icon: '🚀', label: 'GAINERS' };

  if (dom.quickCatIcon) dom.quickCatIcon.textContent = meta.icon;
  if (dom.quickCatName) dom.quickCatName.textContent = meta.label;
  if (dom.headCatTag) dom.headCatTag.textContent = meta.label;

  document.querySelectorAll('.sheet-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === cat);
  });
}

// Add to custom watchlist
function addToWatchlist(sym) {
  if (!sym) return;
  sym = sym.trim().toUpperCase();
  const idx = state.watchlist.indexOf(sym);
  if (idx !== -1) {
    state.watchlist.splice(idx, 1);
    state.watchlist.unshift(sym);
  } else {
    state.watchlist.unshift(sym);
    if (state.watchlist.length > 30) state.watchlist.pop();
  }
  try {
    localStorage.setItem('cc_watchlist', JSON.stringify(state.watchlist));
  } catch (_) {}
  if (state.activeCategory === 'watchlist') {
    renderQuickSwitcher();
  }
}

// Quick Charts Switcher Ribbon removed
function renderQuickSwitcher() {}

// Quick Switch: Next Chart in Active Tab (Gainers / Volume / Losers / Watchlist)
function switchChartNext() {
  const list = getActiveCategorySymbols();
  if (!list || list.length === 0) return;
  let idx = state.symbol ? list.indexOf(state.symbol) : -1;
  let nextSym;
  let nextIdx;
  if (idx === -1 || idx === list.length - 1) {
    nextIdx = 0;
    nextSym = list[0];
  } else {
    nextIdx = idx + 1;
    nextSym = list[nextIdx];
  }

  const cat = state.activeCategory || 'gainers';
  const icons = { gainers: '🚀', volume: '🔥', losers: '📉', watchlist: '⭐' };
  const icon = icons[cat] || '🚀';
  const t = state.allTickers.find(x => x.symbol === nextSym);
  let chgText = '';
  if (t) {
    const chg = parseFloat(t.priceChangePercent);
    chgText = ` (${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%)`;
  }
  showToast(`${icon} ${cat.toUpperCase()} [${nextIdx + 1}/${list.length}]: ${nextSym}${chgText}`);
  setSymbol(nextSym);
}

// Quick Switch: Previous Chart in Active Tab
function switchChartPrev() {
  const list = getActiveCategorySymbols();
  if (!list || list.length === 0) return;
  let idx = state.symbol ? list.indexOf(state.symbol) : -1;
  let prevSym;
  let prevIdx;
  if (idx <= 0) {
    prevIdx = list.length - 1;
    prevSym = list[prevIdx];
  } else {
    prevIdx = idx - 1;
    prevSym = list[prevIdx];
  }

  const cat = state.activeCategory || 'gainers';
  const icons = { gainers: '🚀', volume: '🔥', losers: '📉', watchlist: '⭐' };
  const icon = icons[cat] || '🚀';
  const t = state.allTickers.find(x => x.symbol === prevSym);
  let chgText = '';
  if (t) {
    const chg = parseFloat(t.priceChangePercent);
    chgText = ` (${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%)`;
  }
  showToast(`${icon} ${cat.toUpperCase()} [${prevIdx + 1}/${list.length}]: ${prevSym}${chgText}`);
  setSymbol(prevSym);
}

// Swipe Navigation for Touchscreens
function setupSwipeNavigation(element) {
  if (!element) return;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;

  element.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
  }, { passive: true });

  element.addEventListener('touchend', (e) => {
    if (e.changedTouches.length !== 1) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const deltaY = e.changedTouches[0].clientY - touchStartY;
    const deltaTime = Date.now() - touchStartTime;

    // Horizontal swipe: distance >= 40px, predominantly horizontal, under 600ms
    if (Math.abs(deltaX) >= 40 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3 && deltaTime < 600) {
      if (deltaX < 0) {
        switchChartNext();
      } else {
        switchChartPrev();
      }
    }
  }, { passive: true });
}

// Switch Symbol
function setSymbol(sym) {
  if (!sym || typeof sym !== 'string') return;
  sym = sym.trim().toUpperCase();
  if (sym === state.symbol) return;
  haptic(20);
  if (positionState.active) clearPosition(false);
  state.symbol = sym;
  dom.headSymbol.textContent = sym;
  
  // In watchlist mode, track in custom watchlist
  if (state.activeCategory === 'watchlist') {
    addToWatchlist(sym);
  }

  closeAllSheets();
  fetchKlines(state.symbol, state.interval);
  connectWebSocket(state.symbol, state.interval);
  updateStatsRibbon();
}

// Update Timeframe UI (dock button, bottom sheet cards, watermark, alerts)
function updateTimeframeUI() {
  const intv = state.interval;
  if (dom.dockTfBadge) dom.dockTfBadge.textContent = intv;
  if (dom.dockTfLabel) dom.dockTfLabel.textContent = `${intv} ▾`;
  if (dom.tfSheetCurrentBadge) dom.tfSheetCurrentBadge.textContent = `Current: ${intv}`;
  if (dom.alertDockText) dom.alertDockText.textContent = `${intv} Alert`;

  // Highlight active timeframe card
  document.querySelectorAll('.tf-card').forEach(card => {
    card.classList.toggle('active', card.dataset.interval === intv);
  });

  if (dom.chartWatermark) {
    const styleSuffix = state.chartStyle === 'heikin' ? ' HA' : state.chartStyle === 'line' ? ' LINE' : '';
    dom.chartWatermark.textContent = `${state.symbol} ${state.interval.toUpperCase()}${styleSuffix}`;
  }
}

// Switch Timeframe
function setTimeframe(intv) {
  if (!intv || typeof intv !== 'string') return;
  if (!VALID_INTERVALS.includes(intv)) {
    const matched = VALID_INTERVALS.find(v => v.toLowerCase() === intv.toLowerCase());
    intv = matched || '5m';
  }
  if (intv === state.interval) {
    closeAllSheets();
    return;
  }
  haptic(20);
  state.interval = intv;
  state.currentCandleCloseTime = null; // Re-align countdown timer to new timeframe boundary
  updateTimeframeUI();
  closeAllSheets();
  showToast(`Timeframe: ${intv}`);
  fetchKlines(state.symbol, state.interval);
  connectWebSocket(state.symbol, state.interval);
}

// Bottom Sheet Rendering: Coins List
let sheetFilter = state.activeCategory || 'gainers';
function renderSheetCoins() {
  if (!dom.sheetCoinList) return;
  const q = dom.coinSearchInput.value.trim().toUpperCase();
  let list = [...state.allTickers];
  if (q) list = list.filter(t => t.symbol.includes(q));

  if (sheetFilter === 'gainers') {
    list.sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));
  } else if (sheetFilter === 'losers') {
    list.sort((a, b) => parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent));
  } else if (sheetFilter === 'watchlist') {
    const wl = state.watchlist || [];
    list = list.filter(t => wl.includes(t.symbol));
    list.sort((a, b) => wl.indexOf(a.symbol) - wl.indexOf(b.symbol));
  } else {
    list.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
  }

  if (list.length === 0) {
    dom.sheetCoinList.innerHTML = `<div style="padding:32px 16px;text-align:center;color:var(--text-muted);font-size:13px;">No matching pairs found</div>`;
    return;
  }

  dom.sheetCoinList.innerHTML = list.slice(0, 60).map(t => {
    const chg = parseFloat(t.priceChangePercent);
    const isBull = chg >= 0;
    const isActive = t.symbol === state.symbol;
    const volM = (parseFloat(t.quoteVolume) / 1e6).toFixed(1);
    return `
      <div class="coin-row ${isActive ? 'active' : ''}" data-symbol="${t.symbol}">
        <div class="cr-left">
          <span class="cr-symbol">${t.symbol}</span>
          <span class="cr-vol">$${volM}M Vol</span>
        </div>
        <div class="cr-right">
          <span class="cr-price">${formatPrice(t.lastPrice, t.symbol)}</span>
          <span class="cr-change ${isBull ? 'bull' : 'bear'}">${isBull ? '+' : ''}${chg.toFixed(2)}%</span>
        </div>
      </div>
    `;
  }).join('');
}

// Bottom Sheet Open / Close Helpers
function openSheet(backdrop) {
  haptic(15);
  backdrop.classList.add('open');
}

function closeAllSheets() {
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  document.querySelectorAll('.sheet-backdrop').forEach(b => b.classList.remove('open'));
  if (dom.marketBackdrop) dom.marketBackdrop.classList.remove('open');
  if (dom.indBackdrop) dom.indBackdrop.classList.remove('open');
  if (dom.alertBackdrop) dom.alertBackdrop.classList.remove('open');
  if (dom.posBackdrop) dom.posBackdrop.classList.remove('open');
  if (dom.posConfirmBackdrop) dom.posConfirmBackdrop.classList.remove('open');
  if (dom.apiSheetBackdrop) dom.apiSheetBackdrop.classList.remove('open');
  if (dom.posListBackdrop) dom.posListBackdrop.classList.remove('open');
  if (dom.tfSheetBackdrop) dom.tfSheetBackdrop.classList.remove('open');
  if (dom.aiBackdrop) dom.aiBackdrop.classList.remove('open');
}

// Android Fullscreen & Landscape Rotate Handler
async function toggleLandscapeFullscreen() {
  haptic(25);
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('landscape').catch(() => {});
      }
      showToast('Landscape Pro Mode');
    } else {
      if (screen.orientation && screen.orientation.unlock) {
        screen.orientation.unlock();
      }
      await document.exitFullscreen().catch(() => {});
      showToast('Portrait Mode');
    }
  } catch (e) {
    // fallback
  } finally {
    setTimeout(() => zoomToDefaultCandles(), 100);
  }
}

// Event Listeners
dom.openMarketBtn.addEventListener('click', () => {
  dom.coinSearchInput.value = '';
  updateCategoryBadgeUI();
  renderSheetCoins();
  openSheet(dom.marketBackdrop);
});
dom.dockMarketBtn.addEventListener('click', () => dom.openMarketBtn.click());
dom.marketCloseBtn.addEventListener('click', closeAllSheets);
dom.marketBackdrop.addEventListener('click', e => {
  if (e.target === dom.marketBackdrop) closeAllSheets();
});

function handlePairInput() {
  let raw = (dom.coinSearchInput.value || '').trim().toUpperCase();
  if (!raw) return;

  // Auto-complete USDT if omitted
  let candidate = raw;
  if (!candidate.endsWith('USDT') && !candidate.endsWith('BUSD')) {
    candidate = candidate + 'USDT';
  }

  // 1. Direct match in allTickers
  const direct = state.allTickers.find(t => t.symbol === candidate);
  if (direct) {
    setSymbol(direct.symbol);
    return;
  }

  // 2. Exact match with raw
  const exact = state.allTickers.find(t => t.symbol === raw);
  if (exact) {
    setSymbol(exact.symbol);
    return;
  }

  // 3. Substring match (e.g. PEPE -> 1000PEPEUSDT, BONK -> 1000BONKUSDT)
  const sub = state.allTickers.find(t => t.symbol.includes(raw.replace('USDT', '')));
  if (sub) {
    setSymbol(sub.symbol);
    return;
  }

  // 4. Default try setting candidate
  setSymbol(candidate);
}

if (dom.pairGoBtn) {
  dom.pairGoBtn.addEventListener('click', handlePairInput);
}
if (dom.pairInputForm) {
  dom.pairInputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handlePairInput();
  });
}
dom.coinSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handlePairInput();
  }
});

dom.coinSearchInput.addEventListener('input', renderSheetCoins);
document.querySelectorAll('.sheet-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    haptic(10);
    if (btn.dataset.filter) {
      setActiveCategory(btn.dataset.filter);
    }
  });
});

dom.sheetCoinList.addEventListener('click', e => {
  const row = e.target.closest('.coin-row');
  if (row && row.dataset.symbol) setSymbol(row.dataset.symbol);
});

// Indicators Sheet

// Expose UI methods globally
window.loadExchangeInfo = loadExchangeInfo;
window.load24hTickers = load24hTickers;
window.updateHighLowDistances = updateHighLowDistances;
window.cycleDistMode = cycleDistMode;
window.updateStatsRibbon = updateStatsRibbon;
window.updateLivePrice = updateLivePrice;
window.fetchKlines = fetchKlines;
window.connectWebSocket = connectWebSocket;
window.updateCountdownTimer = updateCountdownTimer;
window.getActiveCategorySymbols = getActiveCategorySymbols;
window.setActiveCategory = setActiveCategory;
window.updateCategoryBadgeUI = updateCategoryBadgeUI;
window.addToWatchlist = addToWatchlist;
window.renderQuickSwitcher = renderQuickSwitcher;
window.switchChartNext = switchChartNext;
window.switchChartPrev = switchChartPrev;
window.setupSwipeNavigation = setupSwipeNavigation;
window.setSymbol = setSymbol;
window.updateTimeframeUI = updateTimeframeUI;
window.setTimeframe = setTimeframe;
window.renderSheetCoins = renderSheetCoins;
window.openSheet = openSheet;
window.closeAllSheets = closeAllSheets;
window.toggleLandscapeFullscreen = toggleLandscapeFullscreen;
window.handlePairInput = handlePairInput;
window.reanchorPositionToCandles = reanchorPositionToCandles;
