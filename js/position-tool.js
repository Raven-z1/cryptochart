/**
 * TradingView-Style Long / Short Position Drawing Tool & Drag Interactivity
 */

// =========================================================
// TradingView-Style Long / Short Position Drawing Tool
// =========================================================
var positionState = {
  active: false,
  type: 'long', // 'long' | 'short'
  entryPrice: 0,
  tpPrice: 0,
  slPrice: 0,
  startLogical: 0,
  endLogical: 0,
  startTime: null,
  priceLines: {
    entry: null,
    tp: null,
    sl: null,
    series: null,
  },
};

function getPositionMetrics() {
  const isLong = positionState.type === 'long';
  const entry = positionState.entryPrice || 0;
  const tp = positionState.tpPrice || 0;
  const sl = positionState.slPrice || 0;

  let tpDiff = 0, tpPct = 0, slDiff = 0, slPct = 0, rr = 0;
  if (entry > 0) {
    if (isLong) {
      tpDiff = tp - entry;
      tpPct = (tpDiff / entry) * 100;
      slDiff = entry - sl;
      slPct = (slDiff / entry) * 100;
      rr = slDiff > 0 ? (tpDiff / slDiff) : 0;
    } else {
      tpDiff = entry - tp;
      tpPct = (tpDiff / entry) * 100;
      slDiff = sl - entry;
      slPct = (slDiff / entry) * 100;
      rr = slDiff > 0 ? (tpDiff / slDiff) : 0;
    }
  }

  return {
    isLong,
    entry,
    tp,
    sl,
    tpDiff: Math.abs(tpDiff),
    tpPct: Math.abs(tpPct),
    slDiff: Math.abs(slDiff),
    slPct: Math.abs(slPct),
    rr: Math.max(0, rr),
  };
}

function drawPosition(type) {
  haptic(20);
  const curPrice = state.currentPrice || (state.rawCandles && state.rawCandles.length ? state.rawCandles[state.rawCandles.length - 1].close : 0);
  if (!curPrice || isNaN(curPrice)) {
    showToast('Live price loading, please wait...');
    return;
  }

  positionState.active = true;
  positionState.type = type;
  positionState.entryPrice = curPrice;

  // Default standard 1:2 R:R setup
  if (type === 'long') {
    positionState.tpPrice = curPrice * 1.02; // +2.00%
    positionState.slPrice = curPrice * 0.99; // -1.00%
  } else {
    positionState.tpPrice = curPrice * 0.98; // -2.00%
    positionState.slPrice = curPrice * 1.01; // +1.00%
  }

  const candleCount = state.rawCandles ? state.rawCandles.length : 0;
  const lastIdx = Math.max(0, candleCount - 1);
  positionState.startLogical = lastIdx;
  positionState.endLogical = lastIdx + 22;
  positionState.startTime = candleCount > 0 ? state.rawCandles[lastIdx].time : null;

  updatePositionUI();
  const m = getPositionMetrics();
  showToast(`${type.toUpperCase()} @ $${formatPrice(m.entry)} | TP: $${formatPrice(m.tp)} (+${m.tpPct.toFixed(2)}%) | SL: $${formatPrice(m.sl)} (-${m.slPct.toFixed(2)}%) | R:R ${m.rr.toFixed(2)}`);
}

function renderPositionOverlay() {
  if (!dom.tvPosGroup) return;
  if (!positionState.active) {
    dom.tvPosGroup.style.display = 'none';
    if (dom.posHudActive) dom.posHudActive.classList.add('hidden');
    if (dom.btnPosLong) dom.btnPosLong.classList.remove('active');
    if (dom.btnPosShort) dom.btnPosShort.classList.remove('active');
    clearPriceLines();
    return;
  }

  const targetSeries = (state.chartStyle === 'line' ? lineSeries : candleSeries);
  if (!targetSeries || !dom.chartContainer) return;

  const entryY = targetSeries.priceToCoordinate(positionState.entryPrice);
  const tpY = targetSeries.priceToCoordinate(positionState.tpPrice);
  const slY = targetSeries.priceToCoordinate(positionState.slPrice);

  if (entryY === null || tpY === null || slY === null) return;

  let startX = chart.timeScale().logicalToCoordinate(positionState.startLogical);
  let endX = chart.timeScale().logicalToCoordinate(positionState.endLogical);

  if (startX === null || isNaN(startX)) {
    if (positionState.startTime && state.rawCandles && state.rawCandles.length > 0) {
      const idx = state.rawCandles.findIndex(c => c.time === positionState.startTime);
      if (idx !== -1) {
        positionState.startLogical = idx;
        startX = chart.timeScale().logicalToCoordinate(idx);
      }
    }
  }

  const timeScaleWidth = chart.timeScale().width ? chart.timeScale().width() : dom.chartContainer.clientWidth;
  const containerHeight = dom.chartContainer.clientHeight;

  if (dom.paneClipRect) {
    dom.paneClipRect.setAttribute('width', Math.max(0, timeScaleWidth));
    dom.paneClipRect.setAttribute('height', containerHeight);
  }

  if (startX === null || isNaN(startX)) startX = 50;
  if (endX === null || isNaN(endX)) endX = startX + 180;
  if (endX < startX + 35) endX = startX + 35;

  const boxWidth = endX - startX;
  const isLong = positionState.type === 'long';
  const metrics = getPositionMetrics();

  dom.tvPosGroup.style.display = '';

  let targetTop, targetHeight, stopTop, stopHeight;
  if (isLong) {
    targetTop = Math.min(tpY, entryY);
    targetHeight = Math.abs(entryY - tpY);
    stopTop = Math.min(entryY, slY);
    stopHeight = Math.abs(slY - entryY);
  } else {
    targetTop = Math.min(entryY, tpY);
    targetHeight = Math.abs(tpY - entryY);
    stopTop = Math.min(slY, entryY);
    stopHeight = Math.abs(entryY - slY);
  }

  dom.tvTargetBox.setAttribute('x', startX);
  dom.tvTargetBox.setAttribute('y', targetTop);
  dom.tvTargetBox.setAttribute('width', boxWidth);
  dom.tvTargetBox.setAttribute('height', Math.max(2, targetHeight));

  dom.tvStopBox.setAttribute('x', startX);
  dom.tvStopBox.setAttribute('y', stopTop);
  dom.tvStopBox.setAttribute('width', boxWidth);
  dom.tvStopBox.setAttribute('height', Math.max(2, stopHeight));

  dom.tvTpLine.setAttribute('x1', startX);
  dom.tvTpLine.setAttribute('y1', tpY);
  dom.tvTpLine.setAttribute('x2', endX);
  dom.tvTpLine.setAttribute('y2', tpY);

  dom.tvEntryLine.setAttribute('x1', startX);
  dom.tvEntryLine.setAttribute('y1', entryY);
  dom.tvEntryLine.setAttribute('x2', endX);
  dom.tvEntryLine.setAttribute('y2', entryY);

  dom.tvSlLine.setAttribute('x1', startX);
  dom.tvSlLine.setAttribute('y1', slY);
  dom.tvSlLine.setAttribute('x2', endX);
  dom.tvSlLine.setAttribute('y2', slY);

  const topBorderY = Math.min(targetTop, stopTop);
  const btmBorderY = Math.max(targetTop + targetHeight, stopTop + stopHeight);

  dom.tvLeftLine.setAttribute('x1', startX);
  dom.tvLeftLine.setAttribute('y1', topBorderY);
  dom.tvLeftLine.setAttribute('x2', startX);
  dom.tvLeftLine.setAttribute('y2', btmBorderY);

  dom.tvRightLine.setAttribute('x1', endX);
  dom.tvRightLine.setAttribute('y1', topBorderY);
  dom.tvRightLine.setAttribute('x2', endX);
  dom.tvRightLine.setAttribute('y2', btmBorderY);

  // Wide hit-test lines for seamless finger grabbing
  if (dom.tvTpHit) {
    dom.tvTpHit.setAttribute('x1', startX);
    dom.tvTpHit.setAttribute('y1', tpY);
    dom.tvTpHit.setAttribute('x2', endX);
    dom.tvTpHit.setAttribute('y2', tpY);
  }
  if (dom.tvEntryHit) {
    dom.tvEntryHit.setAttribute('x1', startX);
    dom.tvEntryHit.setAttribute('y1', entryY);
    dom.tvEntryHit.setAttribute('x2', endX);
    dom.tvEntryHit.setAttribute('y2', entryY);
  }
  if (dom.tvSlHit) {
    dom.tvSlHit.setAttribute('x1', startX);
    dom.tvSlHit.setAttribute('y1', slY);
    dom.tvSlHit.setAttribute('x2', endX);
    dom.tvSlHit.setAttribute('y2', slY);
  }
  if (dom.tvRightHit) {
    dom.tvRightHit.setAttribute('x1', endX);
    dom.tvRightHit.setAttribute('y1', topBorderY);
    dom.tvRightHit.setAttribute('x2', endX);
    dom.tvRightHit.setAttribute('y2', btmBorderY);
  }
  if (dom.tvLeftHit) {
    dom.tvLeftHit.setAttribute('x1', startX);
    dom.tvLeftHit.setAttribute('y1', topBorderY);
    dom.tvLeftHit.setAttribute('x2', startX);
    dom.tvLeftHit.setAttribute('y2', btmBorderY);
  }

  const midX = startX + boxWidth / 2;
  dom.tvHandleTpGroup.setAttribute('transform', `translate(${midX}, ${tpY})`);
  dom.tvHandleSlGroup.setAttribute('transform', `translate(${midX}, ${slY})`);
  dom.tvHandleEntryGroup.setAttribute('transform', `translate(${startX}, ${entryY})`);
  dom.tvHandleWidthGroup.setAttribute('transform', `translate(${endX}, ${(topBorderY + btmBorderY) / 2})`);

  // 1. Target (TP) Badge — Outside of the box, short text
  const tpText = `TP: $${formatPrice(metrics.tp)} (+${metrics.tpPct.toFixed(2)}%)`;
  const tpPillWidth = Math.max(115, tpText.length * 6.5 + 18);
  const tpPillHeight = 20;
  let targetBadgeY;
  if (isLong) {
    // Long: TP is above the green box
    targetBadgeY = tpY - tpPillHeight - 5;
  } else {
    // Short: TP is below the green box
    targetBadgeY = tpY + 5;
  }
  targetBadgeY = Math.max(2, Math.min(containerHeight - tpPillHeight - 2, targetBadgeY));
  const targetBadgeX = Math.max(2, Math.min(timeScaleWidth - tpPillWidth - 2, midX - tpPillWidth / 2));

  if (dom.tvInfoTarget) {
    dom.tvInfoTarget.setAttribute('transform', `translate(${targetBadgeX}, ${targetBadgeY})`);
    if (dom.tvBgTarget) {
      dom.tvBgTarget.setAttribute('width', tpPillWidth);
      dom.tvBgTarget.setAttribute('height', tpPillHeight);
    }
    if (dom.tvTxtTargetStats) {
      dom.tvTxtTargetStats.textContent = tpText;
      dom.tvTxtTargetStats.setAttribute('x', tpPillWidth / 2);
      dom.tvTxtTargetStats.setAttribute('y', 10);
    }
    dom.tvInfoTarget.style.display = '';
  }

  // 2. Stop (SL) Badge — Outside of the box, short text
  const slText = `SL: $${formatPrice(metrics.sl)} (-${metrics.slPct.toFixed(2)}%)`;
  const slPillWidth = Math.max(115, slText.length * 6.5 + 18);
  const slPillHeight = 20;
  let stopBadgeY;
  if (isLong) {
    // Long: SL is below the red box
    stopBadgeY = slY + 5;
  } else {
    // Short: SL is above the red box
    stopBadgeY = slY - slPillHeight - 5;
  }
  stopBadgeY = Math.max(2, Math.min(containerHeight - slPillHeight - 2, stopBadgeY));
  const stopBadgeX = Math.max(2, Math.min(timeScaleWidth - slPillWidth - 2, midX - slPillWidth / 2));

  if (dom.tvInfoStop) {
    dom.tvInfoStop.setAttribute('transform', `translate(${stopBadgeX}, ${stopBadgeY})`);
    if (dom.tvBgStop) {
      dom.tvBgStop.setAttribute('width', slPillWidth);
      dom.tvBgStop.setAttribute('height', slPillHeight);
    }
    if (dom.tvTxtStopStats) {
      dom.tvTxtStopStats.textContent = slText;
      dom.tvTxtStopStats.setAttribute('x', slPillWidth / 2);
      dom.tvTxtStopStats.setAttribute('y', 10);
    }
    dom.tvInfoStop.style.display = '';
  }

  // 3. R:R Ratio Badge — In the middle, just short text
  const rrVal = (isFinite(metrics.rr) && metrics.rr > 0) ? metrics.rr.toFixed(2) : '--';
  const rrText = `R:R ${rrVal}`;
  const rrPillWidth = 68;
  const rrPillHeight = 20;
  const rrBadgeX = Math.max(2, Math.min(timeScaleWidth - rrPillWidth - 2, midX - rrPillWidth / 2));
  const rrBadgeY = Math.max(2, Math.min(containerHeight - rrPillHeight - 2, entryY - rrPillHeight / 2));

  if (dom.tvInfoRr) {
    dom.tvInfoRr.setAttribute('transform', `translate(${rrBadgeX}, ${rrBadgeY})`);
    if (dom.tvBgRr) {
      dom.tvBgRr.setAttribute('width', rrPillWidth);
      dom.tvBgRr.setAttribute('height', rrPillHeight);
    }
    if (dom.tvTxtRrLabel) {
      dom.tvTxtRrLabel.textContent = rrText;
      dom.tvTxtRrLabel.setAttribute('x', rrPillWidth / 2);
      dom.tvTxtRrLabel.setAttribute('y', 10);
    }
    dom.tvInfoRr.style.display = '';
  }

  // 4. Optional Entry Price Label (left edge if width >= 220)
  if (dom.tvInfoEntry) {
    if (boxWidth >= 220) {
      const entryText = `Open: $${formatPrice(metrics.entry)}`;
      const entryPillWidth = Math.min(130, entryText.length * 6.5 + 16);
      dom.tvInfoEntry.setAttribute('transform', `translate(${startX + 14}, ${entryY - 10})`);
      if (dom.tvBgEntry) {
        dom.tvBgEntry.setAttribute('width', entryPillWidth);
        dom.tvBgEntry.setAttribute('height', 20);
      }
      if (dom.tvTxtEntryLabel) {
        dom.tvTxtEntryLabel.textContent = entryText;
        dom.tvTxtEntryLabel.setAttribute('x', 6);
        dom.tvTxtEntryLabel.setAttribute('y', 10);
      }
      dom.tvInfoEntry.style.display = '';
    } else {
      dom.tvInfoEntry.style.display = 'none';
    }
  }

  // Update Floating HUD in Toolbar
  if (dom.posHudActive) {
    dom.posHudActive.classList.remove('hidden');
    dom.posHudTag.textContent = positionState.type.toUpperCase();
    dom.posHudTag.className = `pos-hud-tag ${positionState.type}`;
    dom.posHudRr.textContent = metrics.rr.toFixed(2);

    document.querySelectorAll('.pos-hud-rr-btn').forEach(b => {
      const val = parseFloat(b.dataset.rr);
      b.classList.toggle('active', Math.abs(val - metrics.rr) < 0.05);
    });
  }

  if (dom.btnPosLong) dom.btnPosLong.classList.toggle('active', positionState.type === 'long');
  if (dom.btnPosShort) dom.btnPosShort.classList.toggle('active', positionState.type === 'short');
}

function syncPriceLines() {
  if (!positionState.active) {
    clearPriceLines();
    return;
  }
  const targetSeries = (state.chartStyle === 'line' ? lineSeries : candleSeries);
  if (!targetSeries) return;

  if (positionState.priceLines.series && positionState.priceLines.series !== targetSeries) {
    clearPriceLines();
  }

  const metrics = getPositionMetrics();
  const entryOpts = {
    price: positionState.entryPrice,
    color: 'rgba(234, 236, 239, 0.85)',
    lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dotted,
    axisLabelVisible: true,
    title: 'ENTRY',
  };

  const tpOpts = {
    price: positionState.tpPrice,
    color: '#0ecb81',
    lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Solid,
    axisLabelVisible: true,
    title: `TP (+${metrics.tpPct.toFixed(1)}%)`,
  };

  const slOpts = {
    price: positionState.slPrice,
    color: '#f6465d',
    lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Solid,
    axisLabelVisible: true,
    title: `SL (-${metrics.slPct.toFixed(1)}%)`,
  };

  try {
    if (!positionState.priceLines.entry) {
      positionState.priceLines.entry = targetSeries.createPriceLine(entryOpts);
    } else {
      positionState.priceLines.entry.applyOptions(entryOpts);
    }

    if (!positionState.priceLines.tp) {
      positionState.priceLines.tp = targetSeries.createPriceLine(tpOpts);
    } else {
      positionState.priceLines.tp.applyOptions(tpOpts);
    }

    if (!positionState.priceLines.sl) {
      positionState.priceLines.sl = targetSeries.createPriceLine(slOpts);
    } else {
      positionState.priceLines.sl.applyOptions(slOpts);
    }

    positionState.priceLines.series = targetSeries;
  } catch (err) {
    console.error('syncPriceLines error:', err);
  }
}

function clearPriceLines() {
  if (positionState.priceLines.series) {
    const s = positionState.priceLines.series;
    try {
      if (positionState.priceLines.entry) s.removePriceLine(positionState.priceLines.entry);
      if (positionState.priceLines.tp) s.removePriceLine(positionState.priceLines.tp);
      if (positionState.priceLines.sl) s.removePriceLine(positionState.priceLines.sl);
    } catch (_) {}
  }
  positionState.priceLines.entry = null;
  positionState.priceLines.tp = null;
  positionState.priceLines.sl = null;
  positionState.priceLines.series = null;
}

function clearPosition(notify = true) {
  clearPriceLines();
  positionState.active = false;
  if (dom.tvPosGroup) dom.tvPosGroup.style.display = 'none';
  if (dom.posHudActive) dom.posHudActive.classList.add('hidden');
  if (dom.btnPosLong) dom.btnPosLong.classList.remove('active');
  if (dom.btnPosShort) dom.btnPosShort.classList.remove('active');
  if (notify) {
    haptic(15);
    showToast('Position tool cleared');
  }
}

function setRRRatio(targetRR) {
  if (!positionState.active) return;
  haptic(15);
  const entry = positionState.entryPrice;
  const isLong = positionState.type === 'long';

  if (isLong) {
    const risk = entry - positionState.slPrice;
    if (risk > 0) {
      positionState.tpPrice = entry + targetRR * risk;
    }
  } else {
    const risk = positionState.slPrice - entry;
    if (risk > 0) {
      positionState.tpPrice = entry - targetRR * risk;
    }
  }

  updatePositionUI();
  const m = getPositionMetrics();
  showToast(`R:R set to 1:${targetRR.toFixed(1)} (TP: $${formatPrice(m.tp)})`);
}

function updatePositionUI() {
  renderPositionOverlay();
  syncPriceLines();
}

// Drag Handlers with global window tracking & requestAnimationFrame
let activeDrag = null;
let dragRaf = null;
let latestPointerEvent = null;

// Instant Double-Tap and Double-Click state
let lastPosTouchDownTime = 0;
let lastPosTouchDownX = 0;
let lastPosTouchDownY = 0;
let lastSheetOpenTime = 0;

function checkPositionDoubleTap(e) {
  if (!positionState.active) return false;
  const now = Date.now();

  // Suppress rapid repeated calls within 650ms of opening
  if (now - lastSheetOpenTime < 650) {
    return true;
  }

  const timeSince = now - lastPosTouchDownTime;
  const dist = Math.hypot(e.clientX - lastPosTouchDownX, e.clientY - lastPosTouchDownY);

  // Instant double-tap detected on touch-down: between 35ms and 600ms, within 85px
  if (timeSince > 35 && timeSince < 600 && dist < 85) {
    lastPosTouchDownTime = 0;
    lastSheetOpenTime = now;
    activeDrag = null;
    openPositionSheet();
    return true;
  }

  lastPosTouchDownTime = now;
  lastPosTouchDownX = e.clientX;
  lastPosTouchDownY = e.clientY;
  return false;
}

function startDrag(e, mode) {
  if (!positionState.active) return;
  if (e.button !== undefined && e.button !== 0) return;

  // Check for double-tap IMMEDIATELY on touch/pointer down!
  if (checkPositionDoubleTap(e)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  const targetSeries = (state.chartStyle === 'line' ? lineSeries : candleSeries);
  if (!targetSeries || !dom.chartContainer) return;

  const rect = dom.chartContainer.getBoundingClientRect();
  const curY = e.clientY - rect.top;
  const curX = e.clientX - rect.left;

  const clampedY = Math.max(6, Math.min(rect.height - 6, curY));
  const startPrice = targetSeries.coordinateToPrice(clampedY) || positionState.entryPrice;
  const startLogical = chart.timeScale().coordinateToLogical(curX);

  activeDrag = {
    mode,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    startTime: Date.now(),
    startPrice,
    startLogical: startLogical !== null ? startLogical : positionState.startLogical,
    initEntry: positionState.entryPrice,
    initTp: positionState.tpPrice,
    initSl: positionState.slPrice,
    initStartLog: positionState.startLogical,
    initEndLog: positionState.endLogical,
    hasMoved: false,
  };

  latestPointerEvent = {
    clientX: e.clientX,
    clientY: e.clientY,
  };

  if (e.target && e.target.setPointerCapture) {
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch (_) {}
  }

  document.body.classList.add('tv-dragging');
  if (mode === 'width') {
    document.body.style.cursor = 'ew-resize';
    if (dom.tvHandleWidthGroup) dom.tvHandleWidthGroup.classList.add('dragging');
  } else if (mode === 'body') {
    document.body.style.cursor = 'move';
  } else if (mode === 'tp') {
    document.body.style.cursor = 'ns-resize';
    if (dom.tvHandleTpGroup) dom.tvHandleTpGroup.classList.add('dragging');
  } else if (mode === 'sl') {
    document.body.style.cursor = 'ns-resize';
    if (dom.tvHandleSlGroup) dom.tvHandleSlGroup.classList.add('dragging');
  } else if (mode === 'entry') {
    document.body.style.cursor = 'ns-resize';
    if (dom.tvHandleEntryGroup) dom.tvHandleEntryGroup.classList.add('dragging');
  }

  window.addEventListener('pointermove', onGlobalPointerMove, { passive: false });
  window.addEventListener('pointerup', onGlobalPointerUp);
  window.addEventListener('pointercancel', onGlobalPointerUp);
  window.addEventListener('blur', onGlobalPointerUp);
}

function onGlobalPointerMove(e) {
  if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
  e.preventDefault();

  latestPointerEvent = {
    clientX: e.clientX,
    clientY: e.clientY,
  };

  if (!dragRaf) {
    dragRaf = requestAnimationFrame(handleDragFrame);
  }
}

function handleDragFrame() {
  dragRaf = null;
  if (!activeDrag || !latestPointerEvent) return;

  const dist = Math.hypot(latestPointerEvent.clientX - activeDrag.startX, latestPointerEvent.clientY - activeDrag.startY);
  if (!activeDrag.hasMoved) {
    // Intentional drag threshold: 16px to prevent stationary finger tap wobble from triggering drag
    if (dist > 16) {
      activeDrag.hasMoved = true;
    } else {
      return;
    }
  }

  const targetSeries = (state.chartStyle === 'line' ? lineSeries : candleSeries);
  if (!targetSeries || !dom.chartContainer) return;

  const rect = dom.chartContainer.getBoundingClientRect();
  const curY = latestPointerEvent.clientY - rect.top;
  const curX = latestPointerEvent.clientX - rect.left;

  const clampedY = Math.max(6, Math.min(rect.height - 6, curY));
  const curPrice = targetSeries.coordinateToPrice(clampedY);
  const curLogical = chart.timeScale().coordinateToLogical(curX);

  if (curPrice === null || curPrice <= 0) return;

  const isLong = positionState.type === 'long';
  const precision = getPrecision(state.symbol);
  const minTick = Math.pow(10, -precision);
  const minDiff = minTick * 2;

  if (activeDrag.mode === 'tp') {
    if (isLong) {
      positionState.tpPrice = Math.max(positionState.entryPrice + minDiff, curPrice);
    } else {
      positionState.tpPrice = Math.min(positionState.entryPrice - minDiff, curPrice);
    }
  } else if (activeDrag.mode === 'sl') {
    if (isLong) {
      positionState.slPrice = Math.min(positionState.entryPrice - minDiff, curPrice);
    } else {
      positionState.slPrice = Math.max(positionState.entryPrice + minDiff, curPrice);
    }
  } else if (activeDrag.mode === 'entry') {
    const priceDelta = curPrice - activeDrag.startPrice;
    const newEntry = activeDrag.initEntry + priceDelta;
    const newTp = activeDrag.initTp + priceDelta;
    const newSl = activeDrag.initSl + priceDelta;
    if (newEntry > 0 && newTp > 0 && newSl > 0) {
      positionState.entryPrice = newEntry;
      positionState.tpPrice = newTp;
      positionState.slPrice = newSl;
    }
  } else if (activeDrag.mode === 'width') {
    if (curLogical !== null) {
      const minEnd = positionState.startLogical + 2;
      positionState.endLogical = Math.max(minEnd, Math.round(curLogical));
    }
  } else if (activeDrag.mode === 'body') {
    const priceDelta = curPrice - activeDrag.startPrice;
    const newEntry = activeDrag.initEntry + priceDelta;
    const newTp = activeDrag.initTp + priceDelta;
    const newSl = activeDrag.initSl + priceDelta;
    if (newEntry > 0 && newTp > 0 && newSl > 0) {
      positionState.entryPrice = newEntry;
      positionState.tpPrice = newTp;
      positionState.slPrice = newSl;
    }
    if (curLogical !== null && activeDrag.startLogical !== null) {
      const logDelta = Math.round(curLogical - activeDrag.startLogical);
      positionState.startLogical = activeDrag.initStartLog + logDelta;
      positionState.endLogical = activeDrag.initEndLog + logDelta;
    }
  }

  updatePositionUI();
}

function onGlobalPointerUp(e) {
  if (!activeDrag) return;
  if (e && e.pointerId !== undefined && e.pointerId !== activeDrag.pointerId) return;

  if (dragRaf) {
    cancelAnimationFrame(dragRaf);
    dragRaf = null;
    handleDragFrame();
  }

  const hadMoved = activeDrag.hasMoved;
  if (hadMoved) {
    // If the user dragged, clear tap time so dragging is never followed by an accidental double-tap
    lastPosTouchDownTime = 0;
    haptic(10);
  }

  activeDrag = null;
  latestPointerEvent = null;

  document.body.classList.remove('tv-dragging');
  document.body.style.cursor = '';

  if (dom.tvHandleTpGroup) dom.tvHandleTpGroup.classList.remove('dragging');
  if (dom.tvHandleSlGroup) dom.tvHandleSlGroup.classList.remove('dragging');
  if (dom.tvHandleEntryGroup) dom.tvHandleEntryGroup.classList.remove('dragging');
  if (dom.tvHandleWidthGroup) dom.tvHandleWidthGroup.classList.remove('dragging');

  window.removeEventListener('pointermove', onGlobalPointerMove);
  window.removeEventListener('pointerup', onGlobalPointerUp);
  window.removeEventListener('pointercancel', onGlobalPointerUp);
  window.removeEventListener('blur', onGlobalPointerUp);
}

function attachDrag(element, mode) {
  if (!element) return;
  element.addEventListener('pointerdown', (e) => startDrag(e, mode), { passive: false });
}

// Initialize Drag Handles, Hit-Lines, Boxes, and Badges
attachDrag(dom.tvHandleTpGroup, 'tp');
attachDrag(dom.tvTpHit, 'tp');
attachDrag(dom.tvTpLine, 'tp');

attachDrag(dom.tvHandleSlGroup, 'sl');
attachDrag(dom.tvSlHit, 'sl');
attachDrag(dom.tvSlLine, 'sl');

attachDrag(dom.tvHandleEntryGroup, 'entry');
attachDrag(dom.tvEntryHit, 'entry');
attachDrag(dom.tvEntryLine, 'entry');

attachDrag(dom.tvHandleWidthGroup, 'width');
attachDrag(dom.tvRightHit, 'width');
attachDrag(dom.tvRightLine, 'width');

attachDrag(dom.tvTargetBox, 'body');
attachDrag(dom.tvStopBox, 'body');
attachDrag(dom.tvLeftHit, 'body');
attachDrag(dom.tvLeftLine, 'body');

// Drag / Tap interaction on Badges
attachDrag(dom.tvInfoTarget, 'tp');
attachDrag(dom.tvBgTarget, 'tp');
attachDrag(dom.tvInfoStop, 'sl');
attachDrag(dom.tvBgStop, 'sl');
attachDrag(dom.tvInfoRr, 'body');
attachDrag(dom.tvBgRr, 'body');
attachDrag(dom.tvInfoEntry, 'body');
attachDrag(dom.tvBgEntry, 'body');

// Direct fallback listener on tvPosGroup
if (dom.tvPosGroup) {
  dom.tvPosGroup.addEventListener('pointerdown', (e) => {
    if (checkPositionDoubleTap(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, { passive: false });
}

// Single click on R:R Badge opens settings directly
if (dom.tvInfoRr) {
  dom.tvInfoRr.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPositionSheet();
  });
}

// Position Parameters Bottom Sheet Logic
function openPositionSheet() {
  if (!positionState.active) return;
  haptic(15);
  const m = getPositionMetrics();
  const prec = getPrecision(state.symbol);
  dom.posSheetTitle.textContent = `${positionState.type.toUpperCase()} Position Settings`;
  dom.posPillLong.classList.toggle('active', positionState.type === 'long');
  dom.posPillShort.classList.toggle('active', positionState.type === 'short');

  dom.posInEntry.value = positionState.entryPrice.toFixed(prec);
  dom.posInTp.value = positionState.tpPrice.toFixed(prec);
  dom.posInSl.value = positionState.slPrice.toFixed(prec);
  dom.posInTpPct.value = m.tpPct.toFixed(2);
  dom.posInSlPct.value = m.slPct.toFixed(2);
  dom.posSheetRr.textContent = m.rr.toFixed(2);

  openSheet(dom.posBackdrop);
}

function updateSheetCalculations(trigger) {
  const isLong = dom.posPillLong.classList.contains('active');
  const entry = parseFloat(dom.posInEntry.value) || 0;
  if (entry <= 0) return;

  const prec = getPrecision(state.symbol);

  if (trigger === 'tp_price') {
    const tp = parseFloat(dom.posInTp.value) || 0;
    const diff = isLong ? (tp - entry) : (entry - tp);
    const pct = (diff / entry) * 100;
    dom.posInTpPct.value = pct.toFixed(2);
  } else if (trigger === 'tp_pct') {
    const pct = parseFloat(dom.posInTpPct.value) || 0;
    const tp = isLong ? (entry * (1 + pct / 100)) : (entry * (1 - pct / 100));
    dom.posInTp.value = tp.toFixed(prec);
  } else if (trigger === 'sl_price') {
    const sl = parseFloat(dom.posInSl.value) || 0;
    const diff = isLong ? (entry - sl) : (sl - entry);
    const pct = (diff / entry) * 100;
    dom.posInSlPct.value = pct.toFixed(2);
  } else if (trigger === 'sl_pct') {
    const pct = parseFloat(dom.posInSlPct.value) || 0;
    const sl = isLong ? (entry * (1 - pct / 100)) : (entry * (1 + pct / 100));
    dom.posInSl.value = sl.toFixed(prec);
  }

  const curTp = parseFloat(dom.posInTp.value) || 0;
  const curSl = parseFloat(dom.posInSl.value) || 0;
  const reward = isLong ? (curTp - entry) : (entry - curTp);
  const risk = isLong ? (entry - curSl) : (curSl - entry);
  const rr = (risk > 0 && reward > 0) ? (reward / risk) : 0;
  dom.posSheetRr.textContent = rr.toFixed(2);
}

// Toolbar Button Listeners
if (dom.btnPosLong) {
  dom.btnPosLong.addEventListener('click', () => drawPosition('long'));
}
if (dom.btnPosShort) {
  dom.btnPosShort.addEventListener('click', () => drawPosition('short'));
}
if (dom.btnPosEdit) {
  dom.btnPosEdit.addEventListener('click', openPositionSheet);
}
if (dom.btnPosClose) {
  dom.btnPosClose.addEventListener('click', () => clearPosition(true));
}

// Toolbar R:R Presets
document.querySelectorAll('.pos-hud-rr-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const rr = parseFloat(btn.dataset.rr);
    if (rr) setRRRatio(rr);
  });
});

// Desktop Double-Click Fallback Listeners across entire Position UI
function onPositionDblClick(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const now = Date.now();
  if (now - lastSheetOpenTime < 650) return;
  lastSheetOpenTime = now;
  openPositionSheet();
}

[
  dom.tvPosGroup,
  dom.tvPositionOverlay,
  dom.tvTargetBox,
  dom.tvStopBox,
  dom.tvInfoTarget,
  dom.tvBgTarget,
  dom.tvInfoStop,
  dom.tvBgStop,
  dom.tvInfoRr,
  dom.tvBgRr,
  dom.tvInfoEntry,
  dom.tvBgEntry,
  dom.tvHandleTpGroup,
  dom.tvHandleSlGroup,
  dom.tvHandleEntryGroup,
  dom.tvHandleWidthGroup,
  dom.tvTpLine,
  dom.tvSlLine,
  dom.tvEntryLine,
  dom.tvLeftLine,
  dom.tvRightLine,
  dom.tvTpHit,
  dom.tvSlHit,
  dom.tvEntryHit,
  dom.tvLeftHit,
  dom.tvRightHit
].forEach(el => {
  if (el) el.addEventListener('dblclick', onPositionDblClick);
});

// Position Settings Sheet Events
if (dom.posSheetClose) {
  dom.posSheetClose.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeAllSheets();
  });
}
if (dom.posSheetCancel) {
  dom.posSheetCancel.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeAllSheets();
  });
}
if (dom.posBackdrop) {
  dom.posBackdrop.addEventListener('click', (e) => {
    if (e.target === dom.posBackdrop) {
      e.preventDefault();
      e.stopPropagation();
      closeAllSheets();
    }
  });
  const dragHandle = dom.posBackdrop.querySelector('.sheet-drag-handle');
  if (dragHandle) {
    dragHandle.addEventListener('click', closeAllSheets);
  }
}

if (dom.posPillLong && dom.posPillShort) {
  dom.posPillLong.addEventListener('click', () => {
    haptic(10);
    dom.posPillLong.classList.add('active');
    dom.posPillShort.classList.remove('active');
    updateSheetCalculations('tp_pct');
    updateSheetCalculations('sl_pct');
  });
  dom.posPillShort.addEventListener('click', () => {
    haptic(10);
    dom.posPillShort.classList.add('active');
    dom.posPillLong.classList.remove('active');
    updateSheetCalculations('tp_pct');
    updateSheetCalculations('sl_pct');
  });
}

if (dom.posInTp) dom.posInTp.addEventListener('input', () => updateSheetCalculations('tp_price'));
if (dom.posInTpPct) dom.posInTpPct.addEventListener('input', () => updateSheetCalculations('tp_pct'));
if (dom.posInSl) dom.posInSl.addEventListener('input', () => updateSheetCalculations('sl_price'));
if (dom.posInSlPct) dom.posInSlPct.addEventListener('input', () => updateSheetCalculations('sl_pct'));
if (dom.posInEntry) dom.posInEntry.addEventListener('input', () => updateSheetCalculations('tp_pct'));

document.querySelectorAll('.pos-sheet-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    haptic(10);
    const rr = parseFloat(btn.dataset.rr);
    const isLong = dom.posPillLong.classList.contains('active');
    const entry = parseFloat(dom.posInEntry.value) || 0;
    const sl = parseFloat(dom.posInSl.value) || 0;
    const risk = isLong ? (entry - sl) : (sl - entry);
    const prec = getPrecision(state.symbol);
    if (risk > 0 && entry > 0) {
      const reward = rr * risk;
      const newTp = isLong ? (entry + reward) : (entry - reward);
      dom.posInTp.value = newTp.toFixed(prec);
      updateSheetCalculations('tp_price');
    }
  });
});

if (dom.posSheetDelete) {
  dom.posSheetDelete.addEventListener('click', () => {
    clearPosition(true);
    closeAllSheets();
  });
}

if (dom.posSheetApply) {
  dom.posSheetApply.addEventListener('click', () => {
    haptic(15);
    const newType = dom.posPillLong.classList.contains('active') ? 'long' : 'short';
    const newEntry = parseFloat(dom.posInEntry.value);
    const newTp = parseFloat(dom.posInTp.value);
    const newSl = parseFloat(dom.posInSl.value);

    if (!newEntry || !newTp || !newSl) {
      showToast('Please enter valid numeric prices');
      return;
    }

    if (newType === 'long') {
      if (newTp <= newEntry || newSl >= newEntry) {
        showToast('For Long: TP must be > Entry and SL must be < Entry');
        return;
      }
    } else {
      if (newTp >= newEntry || newSl <= newEntry) {
        showToast('For Short: TP must be < Entry and SL must be > Entry');
        return;
      }
    }

    positionState.type = newType;
    positionState.entryPrice = newEntry;
    positionState.tpPrice = newTp;
    positionState.slPrice = newSl;
    positionState.active = true;

    updatePositionUI();
    closeAllSheets();
    const m = getPositionMetrics();
    showToast(`Updated ${newType.toUpperCase()}: R:R ${m.rr.toFixed(2)}`);
  });
}

// Chart pan / zoom / resize sync subscriptions
chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
  if (positionState.active && !activeDrag) renderPositionOverlay();
});
chart.timeScale().subscribeVisibleTimeRangeChange(() => {
  if (positionState.active && !activeDrag) renderPositionOverlay();
});

let chartSyncRaf = null;
function requestChartOverlaySync() {
  if (!positionState.active || activeDrag) return;
  if (!chartSyncRaf) {
    chartSyncRaf = requestAnimationFrame(() => {
      chartSyncRaf = null;
      if (positionState.active && !activeDrag) renderPositionOverlay();
    });
  }
}

if (dom.chartContainer) {
  dom.chartContainer.addEventListener('pointermove', requestChartOverlaySync);
  dom.chartContainer.addEventListener('wheel', requestChartOverlaySync, { passive: true });
  dom.chartContainer.addEventListener('touchmove', requestChartOverlaySync, { passive: true });
}


// Expose position tool state and methods globally
window.positionState = positionState;
window.getPositionMetrics = getPositionMetrics;
window.drawPosition = drawPosition;
window.renderPositionOverlay = renderPositionOverlay;
window.syncPriceLines = syncPriceLines;
window.clearPriceLines = clearPriceLines;
window.clearPosition = clearPosition;
window.setRRRatio = setRRRatio;
window.updatePositionUI = updatePositionUI;
window.openPositionSheet = openPositionSheet;
window.requestChartOverlaySync = requestChartOverlaySync;
