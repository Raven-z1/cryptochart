/**
 * Binance Open Positions & Account Balance Management Module
 */

// =========================================================================
// BINANCE OPEN POSITIONS & ACCOUNT BALANCE MODULE
// =========================================================================

let isLoadingPositions = false;
async function loadPositionsAndBalance() {
  if (isLoadingPositions) return;

  const key = (state.binanceApi.key || '').trim();
  const secret = (state.binanceApi.secret || '').trim();

  const isLive = state.binanceApi.env === 'live';
  if (dom.posListEnvTag) {
    dom.posListEnvTag.className = `pos-env-tag ${isLive ? 'live' : 'testnet'}`;
    dom.posListEnvTag.textContent = isLive ? 'LIVE' : 'TESTNET';
  }

  if (!key || !secret) {
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
    if (dom.btnRefreshPositions) dom.btnRefreshPositions.classList.add('rotating');

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

    if (!dom.openPositionsContainer) return;

    if (activePositions.length === 0) {
      dom.openPositionsContainer.innerHTML = `
        <div class="pos-empty-state">
          <span style="font-size: 32px; margin-bottom: 8px;">📈</span>
          <span style="font-weight: 700; color: var(--text-main); margin-bottom: 4px; font-size: 14px;">No Open Positions</span>
          <span style="font-size: 12px; color: var(--text-muted); text-align: center; line-height: 1.4; max-width: 260px;">You have no active USDⓈ-M Futures positions open on Binance.</span>
        </div>
      `;
      return;
    }

    dom.openPositionsContainer.innerHTML = activePositions.map(pos => {
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
              <span>${isPnlBull ? '+' : ''}$${pnl.toFixed(2)}</span>
              <span class="pos-card-pnl-pct">(${isPnlBull ? '+' : ''}${roe.toFixed(2)}%)</span>
            </div>
          </div>

          <div class="pos-card-grid">
            <div class="pos-grid-cell">
              <span class="pos-grid-lbl">Size</span>
              <span class="pos-grid-val">${absAmt} ${baseAsset}</span>
            </div>
            <div class="pos-grid-cell">
              <span class="pos-grid-lbl">Entry Price</span>
              <span class="pos-grid-val">$${formatPrice(entryPrice, sym)}</span>
            </div>
            <div class="pos-grid-cell">
              <span class="pos-grid-lbl">Mark Price</span>
              <span class="pos-grid-val">$${formatPrice(markPrice, sym)}</span>
            </div>
            <div class="pos-grid-cell">
              <span class="pos-grid-lbl">Margin (USDT)</span>
              <span class="pos-grid-val">$${margin.toFixed(2)}</span>
            </div>
            <div class="pos-grid-cell">
              <span class="pos-grid-lbl">Liq. Price</span>
              <span class="pos-grid-val ${liqPrice > 0 ? 'bear' : ''}">${liqPrice > 0 ? '$' + formatPrice(liqPrice, sym) : 'N/A'}</span>
            </div>
            <div class="pos-grid-cell">
              <span class="pos-grid-lbl">Notional</span>
              <span class="pos-grid-val">$${notional.toFixed(1)}</span>
            </div>
          </div>

          <div class="pos-card-footer">
            <button type="button" class="pos-card-btn pos-btn-chart" data-action="chart" data-sym="${sym}">Chart</button>
            <button type="button" class="pos-card-btn pos-btn-close-market" data-action="close" data-sym="${sym}" data-amt="${amt}">Market Close</button>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Failed to load positions & balance:', err);
    if (dom.openPositionsContainer) {
      dom.openPositionsContainer.innerHTML = `
        <div class="pos-empty-state">
          <span style="font-size: 32px; margin-bottom: 8px;">⚠️</span>
          <span style="font-weight: 700; color: var(--color-bear); margin-bottom: 4px;">Failed to Load Positions</span>
          <span style="font-size: 12px; color: var(--text-muted); text-align: center; margin-bottom: 12px; max-width: 260px;">${err.message || 'Check your network or API keys.'}</span>
          <button type="button" class="pos-sheet-preset" id="btn-retry-pos-load" style="height: 32px; padding: 0 14px; font-size: 12px; font-weight: 700;">🔄 Retry</button>
        </div>
      `;
      const retryBtn = document.getElementById('btn-retry-pos-load');
      if (retryBtn) retryBtn.addEventListener('click', loadPositionsAndBalance);
    }
  } finally {
    isLoadingPositions = false;
    if (dom.btnRefreshPositions) dom.btnRefreshPositions.classList.remove('rotating');
  }
}

function openPositionsSheet() {
  haptic(15);
  openSheet(dom.posListBackdrop);
  loadPositionsAndBalance();
}

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
    loadPositionsAndBalance();
  });
}
if (dom.posListBackdrop) {
  dom.posListBackdrop.addEventListener('click', (e) => {
    if (e.target === dom.posListBackdrop) closeAllSheets();
  });
}

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
        await loadPositionsAndBalance();
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
