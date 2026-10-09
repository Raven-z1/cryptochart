/**
 * Binance Open Positions & Account Balance Management Module
 * Real-time live synchronization, WebSocket mark price streaming & adaptive polling
 */

// =========================================================================
// REAL-TIME POSITIONS & BALANCE ENGINE
// =========================================================================

let isLoadingPositions = false;

const posLiveState = {
  activePositions: [],
  activeSymbolsSignature: '',
  walletBalance: 0,
  marginBalance: 0,
  availableBalance: 0,
  unrealizedProfit: 0,
  isSheetOpen: false,
  pollTimer: null,
  ws: null,
  wsSymbolsKey: '',
  lastSyncTime: 0,
  consecutiveErrors: 0,
  isInitialized: false,
};

/**
 * Format and render individual position card HTML
 */
function renderPositionCardHtml(pos) {
  const sym = pos.symbol;
  const amt = parseFloat(pos.positionAmt);
  const isLong = amt > 0;
  const absAmt = Math.abs(amt);
  const entryPrice = parseFloat(pos.entryPrice || 0);
  const markPrice = parseFloat(pos.markPrice || 0) || entryPrice;
  const pnl = parseFloat(pos.unRealizedProfit || pos.unrealizedProfit || 0);
  const liqPrice = parseFloat(pos.liquidationPrice || 0);
  const leverage = parseInt(pos.leverage || 10, 10);
  const notional = Math.abs(parseFloat(pos.notional || (amt * markPrice)));
  const margin = leverage > 0 ? (notional / leverage) : 0;
  const roe = margin > 0 ? ((pnl / margin) * 100) : 0;
  const isPnlBull = pnl >= 0;
  const baseAsset = sym.replace(/USDT$/, '');

  return `
    <div class="pos-card" data-sym="${sym}">
      <div class="pos-card-top">
        <div class="pos-card-title-wrap">
          <span class="pos-card-sym">${sym}</span>
          <span class="pos-card-side ${isLong ? 'long' : 'short'}">${isLong ? 'LONG' : 'SHORT'}</span>
          <span class="pos-card-lev">${leverage}x</span>
        </div>
        <div class="pos-card-pnl ${isPnlBull ? 'bull' : 'bear'}">
          <span class="pos-card-pnl-val">${isPnlBull ? '+' : ''}$${pnl.toFixed(2)}</span>
          <span class="pos-card-pnl-pct">(${isPnlBull ? '+' : ''}${roe.toFixed(2)}%)</span>
        </div>
      </div>

      <div class="pos-card-grid">
        <div class="pos-grid-cell">
          <span class="pos-grid-lbl">Size</span>
          <span class="pos-grid-val pos-val-size">${absAmt} ${baseAsset}</span>
        </div>
        <div class="pos-grid-cell">
          <span class="pos-grid-lbl">Entry Price</span>
          <span class="pos-grid-val pos-val-entry">$${formatPrice(entryPrice, sym)}</span>
        </div>
        <div class="pos-grid-cell">
          <span class="pos-grid-lbl">Mark Price</span>
          <span class="pos-grid-val pos-val-mark">$${formatPrice(markPrice, sym)}</span>
        </div>
        <div class="pos-grid-cell">
          <span class="pos-grid-lbl">Margin (USDT)</span>
          <span class="pos-grid-val pos-val-margin">$${margin.toFixed(2)}</span>
        </div>
        <div class="pos-grid-cell">
          <span class="pos-grid-lbl">Liq. Price</span>
          <span class="pos-grid-val pos-val-liq ${liqPrice > 0 ? 'bear' : ''}">${liqPrice > 0 ? '$' + formatPrice(liqPrice, sym) : 'N/A'}</span>
        </div>
        <div class="pos-grid-cell">
          <span class="pos-grid-lbl">Notional</span>
          <span class="pos-grid-val pos-val-notional">$${notional.toFixed(1)}</span>
        </div>
      </div>

      <div class="pos-card-footer">
        <button type="button" class="pos-card-btn pos-btn-chart" data-action="chart" data-sym="${sym}">Chart</button>
        <button type="button" class="pos-card-btn pos-btn-close-market" data-action="close" data-sym="${sym}" data-amt="${amt}">Market Close</button>
      </div>
    </div>
  `;
}

/**
 * Perform surgical, flicker-free in-place DOM updates on existing position cards
 */
function updatePositionCard(card, pos, oldMark) {
  if (!card) return;
  const sym = pos.symbol;
  const amt = parseFloat(pos.positionAmt);
  const isLong = amt > 0;
  const absAmt = Math.abs(amt);
  const entryPrice = parseFloat(pos.entryPrice || 0);
  const markPrice = parseFloat(pos.markPrice || 0) || entryPrice;
  const pnl = parseFloat(pos.unRealizedProfit || pos.unrealizedProfit || 0);
  const liqPrice = parseFloat(pos.liquidationPrice || 0);
  const leverage = parseInt(pos.leverage || 10, 10);
  const notional = Math.abs(parseFloat(pos.notional || (amt * markPrice)));
  const margin = leverage > 0 ? (notional / leverage) : 0;
  const roe = margin > 0 ? ((pnl / margin) * 100) : 0;
  const isPnlBull = pnl >= 0;
  const baseAsset = sym.replace(/USDT$/, '');

  // PnL & ROE
  const pnlWrap = card.querySelector('.pos-card-pnl');
  if (pnlWrap) {
    pnlWrap.className = `pos-card-pnl ${isPnlBull ? 'bull' : 'bear'}`;
    const pnlVal = pnlWrap.querySelector('.pos-card-pnl-val');
    if (pnlVal) pnlVal.textContent = `${isPnlBull ? '+' : ''}$${pnl.toFixed(2)}`;
    const pnlPct = pnlWrap.querySelector('.pos-card-pnl-pct');
    if (pnlPct) pnlPct.textContent = `(${isPnlBull ? '+' : ''}${roe.toFixed(2)}%)`;
  }

  // Mark Price & Flash
  const markEl = card.querySelector('.pos-val-mark');
  if (markEl) {
    const formattedMark = `$${formatPrice(markPrice, sym)}`;
    if (markEl.textContent !== formattedMark) {
      markEl.textContent = formattedMark;
      if (oldMark && markPrice !== oldMark) {
        markEl.classList.remove('tick-up', 'tick-down');
        void markEl.offsetWidth; // Reflow to restart animation
        markEl.classList.add(markPrice > oldMark ? 'tick-up' : 'tick-down');
      }
    }
  }

  // Grid fields
  const sizeEl = card.querySelector('.pos-val-size');
  if (sizeEl) sizeEl.textContent = `${absAmt} ${baseAsset}`;

  const entryEl = card.querySelector('.pos-val-entry');
  if (entryEl) entryEl.textContent = `$${formatPrice(entryPrice, sym)}`;

  const marginEl = card.querySelector('.pos-val-margin');
  if (marginEl) marginEl.textContent = `$${margin.toFixed(2)}`;

  const liqEl = card.querySelector('.pos-val-liq');
  if (liqEl) {
    liqEl.className = `pos-grid-val pos-val-liq ${liqPrice > 0 ? 'bear' : ''}`;
    liqEl.textContent = liqPrice > 0 ? `$${formatPrice(liqPrice, sym)}` : 'N/A';
  }

  const notionalEl = card.querySelector('.pos-val-notional');
  if (notionalEl) notionalEl.textContent = `$${notional.toFixed(1)}`;

  const levEl = card.querySelector('.pos-card-lev');
  if (levEl) levEl.textContent = `${leverage}x`;

  const closeBtn = card.querySelector('.pos-btn-close-market');
  if (closeBtn) closeBtn.dataset.amt = `${amt}`;
}

/**
 * Recalculate total unrealized profit and update balance overview card in real-time
 */
function updateAggregatedBalances() {
  if (!posLiveState.activePositions) return;

  let totalUnrealized = 0;
  for (const p of posLiveState.activePositions) {
    const pnl = parseFloat(p.unRealizedProfit || p.unrealizedProfit || 0);
    totalUnrealized += pnl;
  }
  posLiveState.unrealizedProfit = totalUnrealized;

  const walletBal = posLiveState.walletBalance || 0;
  const marginBal = walletBal + totalUnrealized;
  posLiveState.marginBalance = marginBal;

  if (dom.balMarginTotal) {
    dom.balMarginTotal.textContent = `$${marginBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  if (dom.balUnrealizedPnl) {
    const isBull = totalUnrealized >= 0;
    const pnlPct = walletBal > 0 ? ((totalUnrealized / walletBal) * 100) : 0;
    dom.balUnrealizedPnl.className = `bal-val bal-pnl-val ${isBull ? 'bull' : 'bear'}`;
    dom.balUnrealizedPnl.textContent = `${isBull ? '+' : ''}$${totalUnrealized.toFixed(2)} (${isBull ? '+' : ''}${pnlPct.toFixed(2)}%)`;
  }
}

/**
 * Handle live mark price update from WebSocket or Chart ticker
 */
function handleLiveMarkPriceUpdate(sym, newMarkPrice) {
  if (!posLiveState.activePositions || posLiveState.activePositions.length === 0) return;

  const pos = posLiveState.activePositions.find(p => p.symbol === sym);
  if (!pos) return;

  const oldMark = parseFloat(pos.markPrice || 0);
  if (oldMark === newMarkPrice) return;

  pos.markPrice = newMarkPrice;
  const amt = parseFloat(pos.positionAmt || 0);
  const entryPrice = parseFloat(pos.entryPrice || 0);
  const leverage = parseInt(pos.leverage || 10, 10);

  // Recalculate PnL
  const livePnl = (newMarkPrice - entryPrice) * amt;
  pos.unRealizedProfit = livePnl;
  pos.unrealizedProfit = livePnl;

  const notional = Math.abs(amt * newMarkPrice);
  pos.notional = notional;

  // Update card in DOM if sheet is open and card exists
  if (dom.openPositionsContainer) {
    const card = dom.openPositionsContainer.querySelector(`.pos-card[data-sym="${sym}"]`);
    if (card) {
      updatePositionCard(card, pos, oldMark);
    }
  }

  // Recalculate total unrealized profit and update balance header
  updateAggregatedBalances();
}

/**
 * Connect WebSocket for active position mark prices (1s ticks)
 */
function syncPositionsWebSocket(activePositions) {
  if (!activePositions || activePositions.length === 0) {
    disconnectPositionsWebSocket();
    return;
  }

  // Only run WS if sheet is open to preserve mobile battery
  if (!posLiveState.isSheetOpen) {
    disconnectPositionsWebSocket();
    return;
  }

  const symbols = [...new Set(activePositions.map(p => p.symbol.toUpperCase()))];
  const symbolsKey = symbols.sort().join(',');
  if (posLiveState.wsSymbolsKey === symbolsKey && posLiveState.ws && posLiveState.ws.readyState <= WebSocket.OPEN) {
    return; // Already connected to these symbols
  }

  disconnectPositionsWebSocket();
  posLiveState.wsSymbolsKey = symbolsKey;

  try {
    let wsUrl = '';
    if (symbols.length === 1) {
      wsUrl = `${CONFIG.wsBase}/${symbols[0].toLowerCase()}@markPrice@1s`;
    } else {
      const streamParams = symbols.map(s => `${s.toLowerCase()}@markPrice@1s`).join('/');
      wsUrl = `wss://fstream.binance.com/stream?streams=${streamParams}`;
    }

    const ws = new WebSocket(wsUrl);
    posLiveState.ws = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const data = msg.data || msg;
        if (data && (data.e === 'markPriceUpdate' || data.p)) {
          const sym = data.s;
          const markPrice = parseFloat(data.p);
          if (sym && !isNaN(markPrice) && markPrice > 0) {
            handleLiveMarkPriceUpdate(sym, markPrice);
          }
        }
      } catch (_) {}
    };

    ws.onerror = () => {
      // Background REST poll automatically covers updates
    };

    ws.onclose = () => {
      posLiveState.ws = null;
      if (posLiveState.isSheetOpen && posLiveState.activePositions.length > 0) {
        setTimeout(() => {
          if (posLiveState.isSheetOpen) syncPositionsWebSocket(posLiveState.activePositions);
        }, 3000);
      }
    };
  } catch (err) {
    console.warn('Positions WebSocket error:', err.message);
  }
}

function disconnectPositionsWebSocket() {
  if (posLiveState.ws) {
    try {
      posLiveState.ws.onclose = null;
      posLiveState.ws.onerror = null;
      posLiveState.ws.onmessage = null;
      posLiveState.ws.close();
    } catch (_) {}
    posLiveState.ws = null;
  }
  posLiveState.wsSymbolsKey = '';
}

/**
 * Adaptive Polling Scheduler
 * High frequency (2.5s) when sheet is open; background frequency (12s) when closed
 */
function scheduleNextPoll() {
  clearTimeout(posLiveState.pollTimer);
  if (document.hidden) return; // Paused when tab is hidden

  const key = (state.binanceApi.key || '').trim();
  const secret = (state.binanceApi.secret || '').trim();
  if (!key || !secret) return;

  const interval = posLiveState.isSheetOpen ? 2500 : 12000;
  posLiveState.pollTimer = setTimeout(async () => {
    await loadPositionsAndBalance({ silent: true });
  }, interval);
}

/**
 * Main Data Loader & Reconciler
 */
async function loadPositionsAndBalance(options = {}) {
  const isForce = !!options.force;
  const isSilent = !!options.silent && !isForce;

  if (isLoadingPositions) return;

  const key = (state.binanceApi.key || '').trim();
  const secret = (state.binanceApi.secret || '').trim();

  const isLive = state.binanceApi.env === 'live';
  if (dom.posListEnvTag) {
    dom.posListEnvTag.className = `pos-env-tag ${isLive ? 'live' : 'testnet'}`;
  }
  if (dom.posEnvLabel) {
    dom.posEnvLabel.textContent = isLive ? 'LIVE' : 'TESTNET';
  }

  // Handle Missing API Keys
  if (!key || !secret) {
    disconnectPositionsWebSocket();
    clearTimeout(posLiveState.pollTimer);

    if (dom.openPositionsContainer) {
      dom.openPositionsContainer.innerHTML = `
        <div class="pos-empty-state">
          <span style="font-size: 32px; margin-bottom: 8px;">🔑</span>
          <span style="font-weight: 700; color: var(--text-main); margin-bottom: 4px; font-size: 14px;">Binance API Keys Required</span>
          <span style="font-size: 12px; color: var(--text-muted); text-align: center; margin-bottom: 14px; max-width: 280px; line-height: 1.4;">Configure your Binance API Key and Secret to view your real-time open positions and account balance.</span>
          <button type="button" class="pos-sheet-preset" id="btn-open-api-from-pos" style="height: 36px; padding: 0 16px; font-size: 12px; font-weight: 700;">🔑 Configure API Keys</button>
        </div>
      `;
      const cfgBtn = document.getElementById('btn-open-api-from-pos');
      if (cfgBtn) {
        cfgBtn.addEventListener('click', () => {
          closeAllSheets();
          openApiSheet();
        });
      }
    }
    if (dom.balTotalWallet) dom.balTotalWallet.textContent = '$0.00';
    if (dom.balMarginTotal) dom.balMarginTotal.textContent = '$0.00';
    if (dom.balAvailable) dom.balAvailable.textContent = '$0.00';
    if (dom.balUnrealizedPnl) {
      dom.balUnrealizedPnl.className = 'bal-val bal-pnl-val';
      dom.balUnrealizedPnl.textContent = '$0.00';
    }
    if (dom.posSecCount) dom.posSecCount.textContent = '0 Open';
    if (dom.dockPosBadge) dom.dockPosBadge.classList.add('hidden');
    return;
  }

  try {
    isLoadingPositions = true;
    if (isForce || !isSilent) {
      if (dom.btnRefreshPositions) dom.btnRefreshPositions.classList.add('rotating');
    }

    await syncBinanceServerTime();

    // Fetch account data and position risks in parallel
    const [accountData, riskData] = await Promise.all([
      binanceSignedRequest('/fapi/v2/account', 'GET'),
      binanceSignedRequest('/fapi/v2/positionRisk', 'GET').catch(() => null)
    ]);

    // Account Balance Overview
    const walletBalance = parseFloat(accountData.totalWalletBalance || 0);
    const marginBalance = parseFloat(accountData.totalMarginBalance || 0);
    const unrealizedProfit = parseFloat(accountData.totalUnrealizedProfit || 0);
    const availableBalance = parseFloat(accountData.availableBalance || 0);

    posLiveState.walletBalance = walletBalance;
    posLiveState.marginBalance = marginBalance;
    posLiveState.unrealizedProfit = unrealizedProfit;
    posLiveState.availableBalance = availableBalance;

    state.binanceApi.availBalance = availableBalance;
    state.binanceApi.totalBalance = walletBalance;

    if (dom.balTotalWallet) {
      dom.balTotalWallet.textContent = `$${walletBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (dom.balMarginTotal) {
      dom.balMarginTotal.textContent = `$${marginBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (dom.balAvailable) {
      dom.balAvailable.textContent = `$${availableBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    if (dom.balUnrealizedPnl) {
      const isBull = unrealizedProfit >= 0;
      const pnlPct = walletBalance > 0 ? ((unrealizedProfit / walletBalance) * 100) : 0;
      dom.balUnrealizedPnl.className = `bal-val bal-pnl-val ${isBull ? 'bull' : 'bear'}`;
      dom.balUnrealizedPnl.textContent = `${isBull ? '+' : ''}$${unrealizedProfit.toFixed(2)} (${isBull ? '+' : ''}${pnlPct.toFixed(2)}%)`;
    }

    // Merge Active Positions
    const sourceList = (Array.isArray(riskData) && riskData.length > 0) ? riskData : (accountData.positions || []);
    const activePositions = sourceList.filter(p => Math.abs(parseFloat(p.positionAmt || 0)) > 0);
    posLiveState.activePositions = activePositions;

    // Update Dock Count Badge
    if (dom.dockPosBadge) {
      if (activePositions.length > 0) {
        dom.dockPosBadge.textContent = activePositions.length;
        dom.dockPosBadge.classList.remove('hidden');
      } else {
        dom.dockPosBadge.classList.add('hidden');
      }
    }

    if (dom.posSecCount) {
      dom.posSecCount.textContent = `${activePositions.length} Open`;
    }

    // Reconcile Positions Container
    if (dom.openPositionsContainer) {
      if (activePositions.length === 0) {
        disconnectPositionsWebSocket();
        posLiveState.activeSymbolsSignature = '';
        dom.openPositionsContainer.innerHTML = `
          <div class="pos-empty-state">
            <span style="font-size: 32px; margin-bottom: 8px;">📈</span>
            <span style="font-weight: 700; color: var(--text-main); margin-bottom: 4px; font-size: 14px;">No Open Positions</span>
            <span style="font-size: 12px; color: var(--text-muted); text-align: center; line-height: 1.4; max-width: 260px;">You have no active USDⓈ-M Futures positions open on Binance.</span>
          </div>
        `;
      } else {
        const newSig = activePositions.map(p => `${p.symbol}:${p.positionSide || ''}:${parseFloat(p.positionAmt) > 0 ? 'L' : 'S'}`).sort().join('|');
        const hasExistingCards = !!dom.openPositionsContainer.querySelector('.pos-card');

        if (newSig === posLiveState.activeSymbolsSignature && hasExistingCards) {
          // Perform in-place update for seamless non-flickering display
          activePositions.forEach(pos => {
            const card = dom.openPositionsContainer.querySelector(`.pos-card[data-sym="${pos.symbol}"]`);
            if (card) updatePositionCard(card, pos);
          });
        } else {
          // Structural change: re-render full card HTML
          posLiveState.activeSymbolsSignature = newSig;
          dom.openPositionsContainer.innerHTML = activePositions.map(pos => renderPositionCardHtml(pos)).join('');
        }

        // Keep WebSocket active for active symbols
        syncPositionsWebSocket(activePositions);
      }
    }

    posLiveState.lastSyncTime = Date.now();
    posLiveState.consecutiveErrors = 0;

  } catch (err) {
    posLiveState.consecutiveErrors++;
    console.warn('Positions sync error:', err.message);

    // Only render full error empty state if forced, persistent errors, or no cards currently displayed
    const hasExistingCards = dom.openPositionsContainer && !!dom.openPositionsContainer.querySelector('.pos-card');
    if (dom.openPositionsContainer && (isForce || posLiveState.consecutiveErrors >= 3 || !hasExistingCards)) {
      dom.openPositionsContainer.innerHTML = `
        <div class="pos-empty-state">
          <span style="font-size: 32px; margin-bottom: 8px;">⚠️</span>
          <span style="font-weight: 700; color: var(--color-bear); margin-bottom: 4px;">Failed to Load Positions</span>
          <span style="font-size: 12px; color: var(--text-muted); text-align: center; margin-bottom: 12px; max-width: 260px;">${err.message || 'Check your network or API keys.'}</span>
          <button type="button" class="pos-sheet-preset" id="btn-retry-pos-load" style="height: 32px; padding: 0 14px; font-size: 12px; font-weight: 700;">🔄 Retry</button>
        </div>
      `;
      const retryBtn = document.getElementById('btn-retry-pos-load');
      if (retryBtn) retryBtn.addEventListener('click', () => loadPositionsAndBalance({ force: true }));
    }
  } finally {
    isLoadingPositions = false;
    if (dom.btnRefreshPositions && (isForce || !isSilent)) {
      dom.btnRefreshPositions.classList.remove('rotating');
    }
    scheduleNextPoll();
  }
}

/**
 * Open Positions Sheet & Trigger Instant Fast Sync
 */
function openPositionsSheet() {
  haptic(15);
  openSheet(dom.posListBackdrop);
  posLiveState.isSheetOpen = true;
  loadPositionsAndBalance({ silent: false, force: false });
  syncPositionsWebSocket(posLiveState.activePositions);
  scheduleNextPoll();
}

/**
 * Positions Manager Lifecycle Initializer
 */
function initPositionsManager() {
  if (posLiveState.isInitialized) {
    loadPositionsAndBalance({ force: true });
    return;
  }
  posLiveState.isInitialized = true;

  // Observe Positions Bottom Sheet Open/Close State
  if (dom.posListBackdrop) {
    posLiveState.isSheetOpen = dom.posListBackdrop.classList.contains('open');

    const sheetObserver = new MutationObserver(() => {
      const isOpen = dom.posListBackdrop.classList.contains('open');
      if (isOpen !== posLiveState.isSheetOpen) {
        posLiveState.isSheetOpen = isOpen;
        if (isOpen) {
          // Instantly sync and switch to fast mode
          loadPositionsAndBalance({ silent: false, force: false });
          syncPositionsWebSocket(posLiveState.activePositions);
          scheduleNextPoll();
        } else {
          // Closed: disconnect WebSocket and throttle to background poll
          disconnectPositionsWebSocket();
          scheduleNextPoll();
        }
      }
    });
    sheetObserver.observe(dom.posListBackdrop, { attributes: true, attributeFilter: ['class'] });
  }

  // Initial load if API keys configured
  const key = (state.binanceApi.key || '').trim();
  const secret = (state.binanceApi.secret || '').trim();
  if (key && secret) {
    loadPositionsAndBalance({ silent: true });
  }
}

// Live Price Tick Hook for Chart Symbol
window.onLivePriceTick = function(symbol, price) {
  if (posLiveState.activePositions && posLiveState.activePositions.length > 0) {
    handleLiveMarkPriceUpdate(symbol, price);
  }
};

// Positions Sheet Listeners
if (dom.dockPositionsBtn) {
  dom.dockPositionsBtn.addEventListener('click', openPositionsSheet);
}
if (dom.posListClose) {
  dom.posListClose.addEventListener('click', closeAllSheets);
}
if (dom.btnRefreshPositions) {
  dom.btnRefreshPositions.addEventListener('click', () => {
    haptic(15);
    loadPositionsAndBalance({ force: true });
  });
}
if (dom.posListBackdrop) {
  dom.posListBackdrop.addEventListener('click', (e) => {
    if (e.target === dom.posListBackdrop) closeAllSheets();
  });
}

// Position Card Actions (Chart Switch & Market Close)
if (dom.openPositionsContainer) {
  dom.openPositionsContainer.addEventListener('click', async (e) => {
    const chartBtn = e.target.closest('button[data-action="chart"]');
    if (chartBtn && chartBtn.dataset.sym) {
      haptic(15);
      closeAllSheets();
      setSymbol(chartBtn.dataset.sym);
      return;
    }

    const closeBtn = e.target.closest('button[data-action="close"]');
    if (closeBtn && closeBtn.dataset.sym && closeBtn.dataset.amt) {
      haptic(25);
      const sym = closeBtn.dataset.sym;
      const amt = parseFloat(closeBtn.dataset.amt);
      const side = amt > 0 ? 'SELL' : 'BUY';
      const absAmt = Math.abs(amt);
      const qty = quantizeQuantity(sym, absAmt);

      const confirmed = window.confirm(`Close ${sym} ${amt > 0 ? 'LONG' : 'SHORT'} position (${qty}) at market price?`);
      if (!confirmed) return;

      try {
        closeBtn.disabled = true;
        closeBtn.textContent = 'Closing...';
        await binanceSignedRequest('/fapi/v1/order', 'POST', {
          symbol: sym,
          side,
          type: 'MARKET',
          quantity: qty,
          reduceOnly: 'true',
        });
        showToast(`✅ ${sym} position closed at market!`);
        haptic(35);
        playChime();
        await loadPositionsAndBalance({ force: true });
      } catch (err) {
        console.error('Market close failed:', err);
        showToast(`❌ Close failed: ${err.message}`, 4000);
      } finally {
        closeBtn.disabled = false;
        closeBtn.textContent = 'Market Close';
      }
    }
  });
}

// Expose position manager methods globally
window.loadPositionsAndBalance = loadPositionsAndBalance;
window.openPositionsSheet = openPositionsSheet;
window.initPositionsManager = initPositionsManager;
window.syncPositionsWebSocket = syncPositionsWebSocket;
window.handleLiveMarkPriceUpdate = handleLiveMarkPriceUpdate;
