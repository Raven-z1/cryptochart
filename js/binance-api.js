/**
 * Binance USDⓈ-M API Integration, Cryptography, and Order Execution Engine
 */

// =========================================================================
// BINANCE USDⓈ-M EXECUTION ENGINE & API MANAGEMENT
// =========================================================================

// Cryptography: Native Web Crypto HMAC-SHA256
async function hmacSha256(secret, message) {
  const enc = new TextEncoder();
  const keyData = enc.encode(secret);
  const msgData = enc.encode(message);
  const key = await window.crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await window.crypto.subtle.sign('HMAC', key, msgData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// REST Base URL Resolver
function getBinanceRestBase() {
  if (state.binanceApi.proxy && state.binanceApi.proxy.trim()) {
    return state.binanceApi.proxy.trim().replace(/\/+$/, '');
  }
  return state.binanceApi.env === 'testnet'
    ? 'https://testnet.binancefuture.com'
    : 'https://fapi.binance.com';
}

// Clock Drift Synchronizer
async function syncBinanceServerTime() {
  try {
    const base = getBinanceRestBase();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${base}/fapi/v1/time`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data && data.serverTime) {
        state.binanceApi.serverOffset = data.serverTime - Date.now();
      }
    }
  } catch (err) {
    console.warn('Binance time sync error:', err.message);
  }
}

function getBinanceTimestamp() {
  return Date.now() + (state.binanceApi.serverOffset || 0);
}

// Signed Request Dispatcher with Error Handling & Auto Clock Re-sync
async function binanceSignedRequest(endpoint, method = 'GET', params = {}, isRetry = false) {
  if (!navigator.onLine) {
    throw new Error('No internet connection. Please verify your network.');
  }

  const key = (state.binanceApi.key || '').trim();
  const secret = (state.binanceApi.secret || '').trim();
  if (!key || !secret) {
    throw new Error('Binance API Key or Secret missing. Please configure them in API Settings.');
  }

  const base = getBinanceRestBase();
  const timestamp = getBinanceTimestamp();
  const recvWindow = 10000;

  const allParams = { ...params, timestamp, recvWindow };
  const queryString = Object.entries(allParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const signature = await hmacSha256(secret, queryString);
  const signedQuery = `${queryString}&signature=${signature}`;

  const isGetOrDelete = (method === 'GET' || method === 'DELETE');
  const url = isGetOrDelete ? `${base}${endpoint}?${signedQuery}` : `${base}${endpoint}`;

  const headers = {
    'X-MBX-APIKEY': key,
  };

  const fetchOptions = {
    method,
    headers,
  };

  if (!isGetOrDelete) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    fetchOptions.body = signedQuery;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  fetchOptions.signal = controller.signal;

  let res;
  try {
    res = await fetch(url, fetchOptions);
  } catch (fetchErr) {
    clearTimeout(timeoutId);
    if (fetchErr.name === 'AbortError') {
      throw new Error('Request timed out (12s). Binance did not respond.');
    }
    if (!navigator.onLine) {
      throw new Error('Internet disconnected during request.');
    }
    throw new Error(`Connection failed: ${fetchErr.message || 'Check network / CORS proxy.'}`);
  }
  clearTimeout(timeoutId);

  let data;
  try {
    data = await res.json();
  } catch (parseErr) {
    throw new Error(`Invalid response received from Binance (HTTP ${res.status})`);
  }

  if (!res.ok || (data && typeof data.code === 'number' && data.code < 0)) {
    // Auto re-sync on -1021 timestamp drift
    if (data && data.code === -1021 && !isRetry) {
      console.warn('Clock drift (-1021) encountered. Re-synchronizing server time...');
      await syncBinanceServerTime();
      return binanceSignedRequest(endpoint, method, params, true);
    }

    const errorMap = {
      [-1021]: 'Timestamp outside of recvWindow. Server time re-synchronized; please try again.',
      [-2015]: 'Invalid API-key, IP, or permissions. Ensure "Enable Futures" is active on Binance.',
      [-2019]: 'Margin is insufficient for this trade size. Reduce order size or increase leverage.',
      [-4164]: 'Order size below minimum required notional value.',
      [-1111]: 'Precision exceeds symbol filter rules (lot size / tick size).',
      [-1013]: 'Filter failure: invalid quantity or price for this market.',
      [-4003]: 'Quantity is less than minimum quantity permitted.',
      [-1003]: 'Too many requests. Rate limit hit; wait a few seconds.',
      [-2021]: 'Order would immediately trigger (stopPrice above/below mark price).',
    };

    const friendlyMsg = errorMap[data.code] || data.msg || `Binance Error ${data.code || res.status}`;
    const err = new Error(friendlyMsg);
    err.code = data.code;
    err.raw = data;
    throw err;
  }

  return data;
}

// Quantity & Price Quantization Helpers
function quantizeQuantity(symbol, qty) {
  const meta = state.symbolsMeta[symbol] || {};
  const stepSize = meta.stepSize || '0.001';
  const step = parseFloat(stepSize) || 0.001;
  const stepParts = stepSize.split('.');
  const decimals = stepParts.length > 1 ? stepParts[1].replace(/0+$/, '').length || stepParts[1].length : 0;
  const factor = Math.round(1 / step);
  const floored = Math.floor(qty * factor) / factor;
  return parseFloat(floored.toFixed(decimals));
}

function quantizeQuantityStr(symbol, qty) {
  const meta = state.symbolsMeta[symbol] || {};
  const stepSize = meta.stepSize || '0.001';
  const step = parseFloat(stepSize) || 0.001;
  const stepParts = stepSize.split('.');
  const decimals = stepParts.length > 1 ? stepParts[1].replace(/0+$/, '').length || stepParts[1].length : 0;
  const factor = Math.round(1 / step);
  const floored = Math.floor(qty * factor) / factor;
  return floored.toFixed(decimals);
}

function quantizePrice(symbol, price) {
  const meta = state.symbolsMeta[symbol] || {};
  let decimals = getPrecision(symbol);
  let tick = 1 / Math.pow(10, decimals);
  if (meta.tickSize) {
    tick = parseFloat(meta.tickSize) || tick;
    const parts = meta.tickSize.split('.');
    if (parts.length > 1) {
      decimals = parts[1].replace(/0+$/, '').length || parts[1].length;
    }
  }
  const quantized = Math.round(price / tick) * tick;
  return parseFloat(quantized.toFixed(decimals));
}

function quantizePriceStr(symbol, price) {
  const meta = state.symbolsMeta[symbol] || {};
  let decimals = getPrecision(symbol);
  let tick = 1 / Math.pow(10, decimals);
  if (meta.tickSize) {
    tick = parseFloat(meta.tickSize) || tick;
    const parts = meta.tickSize.split('.');
    if (parts.length > 1) {
      decimals = parts[1].replace(/0+$/, '').length || parts[1].length;
    }
  }
  const quantized = Math.round(price / tick) * tick;
  return quantized.toFixed(decimals);
}

// Account Balance & Leverage Fetchers
async function fetchBinanceBalance() {
  try {
    if (!state.binanceApi.key || !state.binanceApi.secret) return null;
    const balances = await binanceSignedRequest('/fapi/v2/balance', 'GET');
    if (Array.isArray(balances)) {
      const usdt = balances.find(b => b.asset === 'USDT');
      if (usdt) {
        const avail = parseFloat(usdt.availableBalance || usdt.balance || 0);
        const total = parseFloat(usdt.balance || usdt.availableBalance || 0);
        state.binanceApi.availBalance = avail;
        state.binanceApi.totalBalance = total;
        if (dom.confirmAvailBal) {
          dom.confirmAvailBal.textContent = `Avail: $${avail.toFixed(2)} USDT`;
        }
        return { avail, total };
      }
    }
  } catch (err) {
    console.warn('Failed to fetch Binance balance:', err.message);
  }
  return null;
}

async function setSymbolLeverage(symbol, leverage) {
  try {
    return await binanceSignedRequest('/fapi/v1/leverage', 'POST', {
      symbol,
      leverage: parseInt(leverage, 10),
    });
  } catch (err) {
    console.warn('Leverage setting notice:', err.message);
    return null;
  }
}

async function setSymbolMarginType(symbol, marginType = 'CROSSED') {
  try {
    return await binanceSignedRequest('/fapi/v1/marginType', 'POST', {
      symbol,
      marginType,
    });
  } catch (err) {
    // Binance code -4046: "No need to change margin type."
    if (err && (String(err.message).includes('-4046') || String(err.message).toLowerCase().includes('no need to change'))) {
      return { msg: 'success' };
    }
    console.warn('Margin type setting notice:', err.message);
    return null;
  }
}

// API Settings Modal Display & Management
function updateApiEnvDisplay() {
  const isLive = state.binanceApi.env === 'live';
  if (dom.btnEnvLive) dom.btnEnvLive.classList.toggle('active', isLive);
  if (dom.btnEnvTestnet) dom.btnEnvTestnet.classList.toggle('active', !isLive);
  if (dom.apiEnvHint) {
    dom.apiEnvHint.textContent = isLive ? 'Connected to https://fapi.binance.com' : 'Connected to https://testnet.binancefuture.com';
  }
  if (dom.posExchangeEnvTag) {
    dom.posExchangeEnvTag.textContent = isLive ? 'LIVE' : 'TESTNET';
    dom.posExchangeEnvTag.className = `pos-env-tag ${isLive ? 'live' : 'testnet'}`;
  }
  if (dom.btnApiSettings) {
    dom.btnApiSettings.title = `Binance API (${isLive ? 'Live' : 'Testnet'})`;
    dom.btnApiSettings.style.color = (state.binanceApi.key && state.binanceApi.secret) ? 'var(--binance-gold)' : '';
  }
}

function openApiSheet(initialTab = 'binance') {
  haptic(15);
  if (dom.apiKeyInput) dom.apiKeyInput.value = state.binanceApi.key || '';
  if (dom.apiSecretInput) dom.apiSecretInput.value = state.binanceApi.secret || '';
  if (dom.apiProxyInput) dom.apiProxyInput.value = state.binanceApi.proxy || '';
  if (dom.apiTestResult) {
    dom.apiTestResult.classList.add('hidden');
    dom.apiTestResult.textContent = '';
  }
  updateApiEnvDisplay();

  // Switch to selected tab
  if (initialTab === 'openrouter') {
    if (dom.tabBtnOpenRouter) dom.tabBtnOpenRouter.classList.add('active');
    if (dom.tabBtnBinance) dom.tabBtnBinance.classList.remove('active');
    if (dom.panelApiOpenRouter) dom.panelApiOpenRouter.classList.remove('hidden');
    if (dom.panelApiBinance) dom.panelApiBinance.classList.add('hidden');
  } else {
    if (dom.tabBtnBinance) dom.tabBtnBinance.classList.add('active');
    if (dom.tabBtnOpenRouter) dom.tabBtnOpenRouter.classList.remove('active');
    if (dom.panelApiBinance) dom.panelApiBinance.classList.remove('hidden');
    if (dom.panelApiOpenRouter) dom.panelApiOpenRouter.classList.add('hidden');
  }

  if (typeof window.syncOpenRouterInputs === 'function') {
    window.syncOpenRouterInputs();
  }

  openSheet(dom.apiSheetBackdrop);
}

function saveApiConfig() {
  const key = (dom.apiKeyInput ? dom.apiKeyInput.value : '').trim();
  const secret = (dom.apiSecretInput ? dom.apiSecretInput.value : '').trim();
  const proxy = (dom.apiProxyInput ? dom.apiProxyInput.value : '').trim();

  state.binanceApi.key = key;
  state.binanceApi.secret = secret;
  state.binanceApi.proxy = proxy;

  try {
    localStorage.setItem('cc_binance_key', key);
    localStorage.setItem('cc_binance_secret', secret);
    localStorage.setItem('cc_binance_env', state.binanceApi.env);
    localStorage.setItem('cc_binance_proxy', proxy);
  } catch (_) {}

  updateApiEnvDisplay();
  showToast(key && secret ? 'Binance API Config Saved' : 'API Keys Cleared');
  closeAllSheets();
}

async function testApiConnection() {
  const testKey = (dom.apiKeyInput ? dom.apiKeyInput.value : '').trim();
  const testSecret = (dom.apiSecretInput ? dom.apiSecretInput.value : '').trim();
  const testProxy = (dom.apiProxyInput ? dom.apiProxyInput.value : '').trim();

  if (!testKey || !testSecret) {
    if (dom.apiTestResult) {
      dom.apiTestResult.className = 'api-test-result fail';
      dom.apiTestResult.textContent = '❌ Please enter both API Key and API Secret.';
      dom.apiTestResult.classList.remove('hidden');
    }
    return;
  }

  if (dom.apiTestResult) {
    dom.apiTestResult.className = 'api-test-result';
    dom.apiTestResult.textContent = '⏳ Testing connection to Binance USDⓈ-M...';
    dom.apiTestResult.classList.remove('hidden');
  }

  const backupApi = { ...state.binanceApi };
  state.binanceApi.key = testKey;
  state.binanceApi.secret = testSecret;
  state.binanceApi.proxy = testProxy;

  try {
    await syncBinanceServerTime();
    const balances = await binanceSignedRequest('/fapi/v2/balance', 'GET');
    const usdt = Array.isArray(balances) ? balances.find(b => b.asset === 'USDT') : null;
    const avail = usdt ? parseFloat(usdt.availableBalance || 0).toFixed(2) : '0.00';

    if (dom.apiTestResult) {
      dom.apiTestResult.className = 'api-test-result success';
      dom.apiTestResult.textContent = `✅ Success! Futures API authenticated. Available: $${avail} USDT.`;
    }
  } catch (err) {
    if (dom.apiTestResult) {
      dom.apiTestResult.className = 'api-test-result fail';
      dom.apiTestResult.textContent = `❌ ${err.message}`;
    }
  } finally {
    state.binanceApi.key = backupApi.key;
    state.binanceApi.secret = backupApi.secret;
    state.binanceApi.proxy = backupApi.proxy;
  }
}

// Order Confirmation Modal Helpers & Real-time Calculations
function showConfirmError(msg) {
  if (!dom.confirmErrorBanner) return;
  dom.confirmErrorBanner.textContent = msg;
  dom.confirmErrorBanner.classList.remove('hidden');
}

function hideConfirmError() {
  if (!dom.confirmErrorBanner) return;
  dom.confirmErrorBanner.textContent = '';
  dom.confirmErrorBanner.classList.add('hidden');
}

function setSubmitButtonLoading(isLoading) {
  if (!dom.btnConfirmSubmit) return;
  dom.btnConfirmSubmit.disabled = isLoading;
  if (dom.submitSpinner) {
    dom.submitSpinner.classList.toggle('hidden', !isLoading);
  }
  if (dom.btnConfirmSubmitText) {
    dom.btnConfirmSubmitText.textContent = isLoading ? 'Placing Orders...' : 'Confirm & Enter Position';
  }
}

function applyRiskSizing(riskPct) {
  riskPct = parseFloat(riskPct) || 5;
  state.orderForm.riskPct = riskPct;

  if (!positionState.active) return;
  const symbol = state.symbol;
  const isLimit = state.orderForm.type === 'LIMIT';
  const entryPrice = isLimit
    ? (parseFloat(dom.confirmLimitPrice ? dom.confirmLimitPrice.value : 0) || positionState.entryPrice)
    : (state.currentPrice || positionState.entryPrice);
  const slPrice = positionState.slPrice;

  if (entryPrice <= 0 || !slPrice || slPrice === entryPrice) return;

  const slDistance = Math.abs(entryPrice - slPrice);
  const slDistancePct = slDistance / entryPrice;
  if (slDistancePct <= 0) return;

  // Base risk sizing on total wallet balance if available, else available balance, else 100 USDT demo baseline
  const totalBal = (state.binanceApi.totalBalance && state.binanceApi.totalBalance > 0)
    ? state.binanceApi.totalBalance
    : ((state.binanceApi.availBalance && state.binanceApi.availBalance > 0)
      ? state.binanceApi.availBalance
      : 100);

  const riskAmount = totalBal * (riskPct / 100);
  // Position Size (Notional USDT) such that Loss on Stop Loss = riskAmount
  // Loss = Qty * slDistance = (PositionSize / entryPrice) * slDistance = PositionSize * slDistancePct
  // Therefore PositionSize = riskAmount / slDistancePct
  let calculatedNotional = riskAmount / slDistancePct;

  const meta = state.symbolsMeta[symbol] || {};
  const minNotional = meta.minNotional || 5.0;
  if (calculatedNotional < minNotional) {
    calculatedNotional = minNotional;
  }

  if (dom.confirmSizeUsdt) {
    dom.confirmSizeUsdt.value = calculatedNotional.toFixed(2);
  }

  // Auto-adjust leverage so required margin fits safely within available balance in Cross Margin
  const availBal = (state.binanceApi.availBalance && state.binanceApi.availBalance > 0)
    ? state.binanceApi.availBalance
    : totalBal;

  // Use at most 60% of available balance for initial margin
  const targetMarginBudget = Math.max(1, availBal * 0.6);
  const neededLev = Math.ceil(calculatedNotional / targetMarginBudget);

  let selectedLev = 10;
  if (neededLev <= 5) selectedLev = 5;
  else if (neededLev <= 10) selectedLev = 10;
  else if (neededLev <= 20) selectedLev = 20;
  else if (neededLev <= 50) selectedLev = 50;
  else selectedLev = Math.min(neededLev, 50);

  state.orderForm.leverage = selectedLev;
  if (dom.confirmLeverageVal) {
    dom.confirmLeverageVal.textContent = `${selectedLev}x`;
  }
  document.querySelectorAll('.confirm-lev-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.lev, 10) === selectedLev);
  });

  updateConfirmCalculations();
}

function updateConfirmCalculations() {
  const symbol = state.symbol;
  const isLong = positionState.type === 'long';
  const isLimit = state.orderForm.type === 'LIMIT';
  const entryPrice = isLimit
    ? (parseFloat(dom.confirmLimitPrice ? dom.confirmLimitPrice.value : 0) || positionState.entryPrice)
    : (state.currentPrice || positionState.entryPrice);

  // Position size input represents exact Notional Value ($), decoupled from leverage
  const positionNotional = parseFloat(dom.confirmSizeUsdt ? dom.confirmSizeUsdt.value : 0) || 0;
  const leverage = state.orderForm.leverage || 10;
  const marginCost = leverage > 0 ? (positionNotional / leverage) : positionNotional;

  const meta = state.symbolsMeta[symbol] || {};
  const minNotional = meta.minNotional || 5.0;
  const minQty = parseFloat(meta.minQty) || 0.001;

  const totalBal = (state.binanceApi.totalBalance && state.binanceApi.totalBalance > 0)
    ? state.binanceApi.totalBalance
    : ((state.binanceApi.availBalance && state.binanceApi.availBalance > 0) ? state.binanceApi.availBalance : 0);

  const slDistance = Math.abs(entryPrice - (positionState.slPrice || entryPrice));
  const slDistPct = entryPrice > 0 ? ((slDistance / entryPrice) * 100) : 0;

  if (dom.confirmSlDistLbl) {
    dom.confirmSlDistLbl.textContent = `SL Dist: ${slDistPct.toFixed(2)}%`;
  }
  if (dom.confirmMarginCostLbl) {
    dom.confirmMarginCostLbl.textContent = `Margin Cost: $${marginCost.toFixed(2)} USDT`;
  }
  if (dom.confirmPlanNotional) {
    dom.confirmPlanNotional.textContent = `$${positionNotional.toFixed(2)}`;
  }
  if (dom.confirmPlanMargin) {
    dom.confirmPlanMargin.textContent = `$${marginCost.toFixed(2)} (${leverage}x)`;
  }

  const riskPct = state.orderForm.riskPct || 5;
  if (dom.confirmRiskSubtext) {
    if (totalBal > 0) {
      const riskAmt = totalBal * (riskPct / 100);
      dom.confirmRiskSubtext.textContent = `Risk ${riskPct}%: $${riskAmt.toFixed(2)} of $${totalBal.toFixed(2)}`;
    } else {
      dom.confirmRiskSubtext.textContent = `Risk ${riskPct}% of Total Balance`;
    }
  }

  if (entryPrice > 0 && positionNotional > 0) {
    const rawQty = positionNotional / entryPrice;
    const quantizedQty = quantizeQuantity(symbol, rawQty);
    const baseAsset = symbol.replace(/USDT$/, '');
    if (dom.confirmSizeEquiv) {
      dom.confirmSizeEquiv.textContent = `≈ ${quantizedQty} ${baseAsset}`;
    }

    const tpDiff = isLong ? (positionState.tpPrice - entryPrice) : (entryPrice - positionState.tpPrice);
    const slDiff = isLong ? (entryPrice - positionState.slPrice) : (positionState.slPrice - entryPrice);

    const estProfit = quantizedQty * tpDiff;
    const estLoss = quantizedQty * slDiff;

    if (dom.confirmEstProfit) {
      const profitPct = totalBal > 0 ? ((estProfit / totalBal) * 100) : 0;
      dom.confirmEstProfit.textContent = `+$${Math.max(0, estProfit).toFixed(2)}${totalBal > 0 ? ` (+${profitPct.toFixed(1)}%)` : ''}`;
    }
    if (dom.confirmEstLoss) {
      const lossPct = totalBal > 0 ? ((estLoss / totalBal) * 100) : 0;
      dom.confirmEstLoss.textContent = `-$${Math.max(0, estLoss).toFixed(2)}${totalBal > 0 ? ` (-${lossPct.toFixed(1)}%)` : ''}`;
    }

    if (positionNotional < minNotional) {
      showConfirmError(`⚠️ Position size is below minimum notional ($${minNotional} USDT). Current: $${positionNotional.toFixed(1)}`);
      if (dom.btnConfirmSubmit) dom.btnConfirmSubmit.disabled = true;
    } else if (quantizedQty < minQty) {
      showConfirmError(`⚠️ Quantity (${quantizedQty}) is below minimum (${minQty} ${baseAsset}). Increase size.`);
      if (dom.btnConfirmSubmit) dom.btnConfirmSubmit.disabled = true;
    } else if (state.binanceApi.availBalance !== null && marginCost > state.binanceApi.availBalance) {
      showConfirmError(`⚠️ Required margin ($${marginCost.toFixed(2)}) exceeds available balance ($${state.binanceApi.availBalance.toFixed(2)} USDT). Increase leverage or decrease size.`);
      if (dom.btnConfirmSubmit) dom.btnConfirmSubmit.disabled = true;
    } else {
      hideConfirmError();
      if (dom.btnConfirmSubmit) dom.btnConfirmSubmit.disabled = false;
    }
  } else {
    if (dom.confirmSizeEquiv) dom.confirmSizeEquiv.textContent = '≈ 0.000 QTY';
    if (dom.confirmEstProfit) dom.confirmEstProfit.textContent = '+$0.00';
    if (dom.confirmEstLoss) dom.confirmEstLoss.textContent = '-$0.00';
    if (positionNotional <= 0) {
      showConfirmError('Please specify a position size greater than 0.');
      if (dom.btnConfirmSubmit) dom.btnConfirmSubmit.disabled = true;
    }
  }
}

function openOrderConfirmationSheet() {
  if (!positionState.active) {
    showToast('Please draw a position on chart first');
    return;
  }

  if (!state.binanceApi.key || !state.binanceApi.secret) {
    showToast('Configure your Binance API keys first 🔑');
    openApiSheet();
    return;
  }

  haptic(15);
  const isLive = state.binanceApi.env === 'live';
  if (dom.confirmEnvBadge) {
    dom.confirmEnvBadge.className = `confirm-env-badge ${isLive ? 'live' : 'testnet'}`;
  }
  if (dom.confirmEnvText) {
    dom.confirmEnvText.textContent = isLive ? 'Binance USDⓈ-M Futures (Live)' : 'Binance Futures Testnet (Demo)';
  }

  const isLong = positionState.type === 'long';
  if (dom.confirmTypeTag) {
    dom.confirmTypeTag.className = `confirm-type-tag ${isLong ? 'bull' : 'bear'}`;
    dom.confirmTypeTag.textContent = isLong ? 'LONG' : 'SHORT';
  }
  if (dom.confirmSym) dom.confirmSym.textContent = state.symbol;
  if (dom.confirmCurrPrice) {
    dom.confirmCurrPrice.textContent = `Market: $${formatPrice(state.currentPrice, state.symbol)}`;
  }
  if (dom.confirmPlanEntry) {
    dom.confirmPlanEntry.textContent = `$${formatPrice(positionState.entryPrice, state.symbol)}`;
  }
  if (dom.confirmPlanTp) {
    dom.confirmPlanTp.textContent = `$${formatPrice(positionState.tpPrice, state.symbol)}`;
  }
  if (dom.confirmPlanSl) {
    dom.confirmPlanSl.textContent = `$${formatPrice(positionState.slPrice, state.symbol)}`;
  }
  const m = getPositionMetrics();
  if (dom.confirmPlanRr) dom.confirmPlanRr.textContent = m.rr.toFixed(2);

  // Limit price input setup
  if (dom.confirmLimitPrice) {
    dom.confirmLimitPrice.value = positionState.entryPrice.toFixed(getPrecision(state.symbol));
  }

  // Order Type buttons setup
  const isLimit = state.orderForm.type === 'LIMIT';
  if (dom.btnOrderTypeMarket) dom.btnOrderTypeMarket.classList.toggle('active', !isLimit);
  if (dom.btnOrderTypeLimit) dom.btnOrderTypeLimit.classList.toggle('active', isLimit);
  if (dom.confirmLimitPriceGroup) dom.confirmLimitPriceGroup.classList.toggle('hidden', !isLimit);

  // Setup default 5% risk sizing
  const curRisk = state.orderForm.riskPct || 5;
  document.querySelectorAll('.confirm-risk-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.risk, 10) === curRisk);
  });

  // Apply 5% risk sizing and auto-calculate leverage
  applyRiskSizing(curRisk);

  hideConfirmError();
  setSubmitButtonLoading(false);
  updateConfirmCalculations();
  if (dom.posConfirmBody) {
    dom.posConfirmBody.scrollTop = 0;
  }

  openSheet(dom.posConfirmBackdrop);

  // Async balance and drift synchronization
  syncBinanceServerTime();
  fetchBinanceBalance().then(() => {
    if (state.orderForm.riskPct) {
      applyRiskSizing(state.orderForm.riskPct);
    } else {
      updateConfirmCalculations();
    }
  });
}

// Order Execution Pipeline
let isExecutingOrder = false;

// Helper to place Binance Futures Conditional TP/SL Orders via dedicated Algo Service
async function placeAlgoConditionalOrder({ symbol, side, type, triggerPrice, orderQty, positionSide }) {
  // Strategy 1: Modern Binance USDⓈ-M algoOrder endpoint with closePosition: 'true' (No quantity required)
  try {
    const params = {
      algoType: 'CONDITIONAL',
      symbol,
      side,
      type,
      triggerPrice,
      closePosition: 'true',
      workingType: 'MARK_PRICE',
    };
    if (positionSide) params.positionSide = positionSide;
    return await binanceSignedRequest('/fapi/v1/algoOrder', 'POST', params);
  } catch (err1) {
    console.warn(`algoOrder closePosition failed for ${type}:`, err1.message);

    const isEndpointError = err1.message && (
      err1.message.includes('404') ||
      err1.message.includes('-1002') ||
      err1.message.includes('not supported')
    );

    if (!isEndpointError) {
      // Strategy 2: Modern Binance USDⓈ-M algoOrder with explicit quantity and reduceOnly: 'true'
      try {
        const params2 = {
          algoType: 'CONDITIONAL',
          symbol,
          side,
          type,
          triggerPrice,
          quantity: orderQty,
          reduceOnly: 'true',
          workingType: 'MARK_PRICE',
        };
        if (positionSide) params2.positionSide = positionSide;
        return await binanceSignedRequest('/fapi/v1/algoOrder', 'POST', params2);
      } catch (err2) {
        console.warn(`algoOrder reduceOnly failed for ${type}:`, err2.message);
      }
    }

    // Strategy 3: Legacy /fapi/v1/order with stopPrice and closePosition: 'true' (for older testnet/mock environments)
    try {
      const legacyParams = {
        symbol,
        side,
        type,
        stopPrice: triggerPrice,
        closePosition: 'true',
        workingType: 'MARK_PRICE',
      };
      if (positionSide && positionSide !== 'BOTH') legacyParams.positionSide = positionSide;
      return await binanceSignedRequest('/fapi/v1/order', 'POST', legacyParams);
    } catch (legacyErr) {
      // Strategy 4: Legacy /fapi/v1/order with explicit quantity and reduceOnly: 'true'
      try {
        const legacyParams2 = {
          symbol,
          side,
          type,
          stopPrice: triggerPrice,
          quantity: orderQty,
          reduceOnly: 'true',
          workingType: 'MARK_PRICE',
        };
        if (positionSide && positionSide !== 'BOTH') legacyParams2.positionSide = positionSide;
        return await binanceSignedRequest('/fapi/v1/order', 'POST', legacyParams2);
      } catch (finalErr) {
        throw new Error(err1.message || finalErr.message);
      }
    }
  }
}

async function executeBinancePosition() {
  if (isExecutingOrder) return;
  if (!positionState.active) {
    showToast('No active position drawing found.');
    return;
  }

  const symbol = state.symbol;
  const isLong = positionState.type === 'long';
  const primarySide = isLong ? 'BUY' : 'SELL';
  const exitSide = isLong ? 'SELL' : 'BUY';
  const isLimit = state.orderForm.type === 'LIMIT';
  const leverage = state.orderForm.leverage || 10;
  const positionNotional = parseFloat(dom.confirmSizeUsdt ? dom.confirmSizeUsdt.value : 0) || 0;

  if (positionNotional <= 0) {
    showConfirmError('Please specify a valid position size in USDT.');
    return;
  }

  const entryPrice = isLimit
    ? quantizePrice(symbol, parseFloat(dom.confirmLimitPrice ? dom.confirmLimitPrice.value : 0) || positionState.entryPrice)
    : quantizePrice(symbol, state.currentPrice || positionState.entryPrice);

  const rawQty = positionNotional / entryPrice;
  const orderQty = quantizeQuantity(symbol, rawQty);

  const meta = state.symbolsMeta[symbol] || {};
  const minNotional = meta.minNotional || 5.0;
  const minQty = parseFloat(meta.minQty) || 0.001;

  if (orderQty <= 0 || orderQty < minQty) {
    showConfirmError(`Calculated quantity (${orderQty}) is below minimum allowed (${minQty}). Increase position size.`);
    return;
  }
  if (orderQty * entryPrice < minNotional) {
    showConfirmError(`Position size ($${(orderQty * entryPrice).toFixed(2)}) is below minimum notional ($${minNotional}). Increase size.`);
    return;
  }

  const tpPrice = quantizePrice(symbol, positionState.tpPrice);
  const slPrice = quantizePrice(symbol, positionState.slPrice);

  if (isLong) {
    if (tpPrice <= entryPrice) {
      showConfirmError(`For Long: TP ($${tpPrice}) must be higher than Entry ($${entryPrice}).`);
      return;
    }
    if (slPrice >= entryPrice) {
      showConfirmError(`For Long: SL ($${slPrice}) must be lower than Entry ($${entryPrice}).`);
      return;
    }
  } else {
    if (tpPrice >= entryPrice) {
      showConfirmError(`For Short: TP ($${tpPrice}) must be lower than Entry ($${entryPrice}).`);
      return;
    }
    if (slPrice <= entryPrice) {
      showConfirmError(`For Short: SL ($${slPrice}) must be higher than Entry ($${entryPrice}).`);
      return;
    }
  }

  try {
    isExecutingOrder = true;
    setSubmitButtonLoading(true);
    hideConfirmError();

    // Step 1: Set Margin Mode to CROSSED on Binance Futures
    await setSymbolMarginType(symbol, 'CROSSED');

    // Step 2: Set Leverage on Binance Futures
    await setSymbolLeverage(symbol, leverage);

    // Step 3: Check dual position side mode (Hedge vs One-Way)
    let positionSide = 'BOTH';
    try {
      const dualRes = await binanceSignedRequest('/fapi/v1/positionSide/dual', 'GET');
      if (dualRes && (dualRes.dualSidePosition === true || dualRes.dualSidePosition === 'true')) {
        positionSide = isLong ? 'LONG' : 'SHORT';
      }
    } catch (dualErr) {
      console.warn('dualSidePosition check failed, defaulting to BOTH:', dualErr);
    }

    // Step 4: String quantize values to avoid floating-point inaccuracies
    const orderQtyStr = quantizeQuantityStr(symbol, rawQty);
    const entryPriceStr = quantizePriceStr(symbol, entryPrice);
    const tpPriceStr = quantizePriceStr(symbol, positionState.tpPrice);
    const slPriceStr = quantizePriceStr(symbol, positionState.slPrice);

    // Step 5: Place Primary Entry Order
    const primaryParams = {
      symbol,
      side: primarySide,
      type: isLimit ? 'LIMIT' : 'MARKET',
      quantity: orderQtyStr,
    };
    if (positionSide !== 'BOTH') {
      primaryParams.positionSide = positionSide;
    }
    if (isLimit) {
      primaryParams.timeInForce = 'GTC';
      primaryParams.price = entryPriceStr;
    }

    const primaryOrder = await binanceSignedRequest('/fapi/v1/order', 'POST', primaryParams);
    console.log('Primary order placed successfully:', primaryOrder);

    // Step 6: Native Exchange Bracket TP & SL Orders via Binance Algo Order Service
    let bracketWarning = '';

    // Take Profit Order
    try {
      await placeAlgoConditionalOrder({
        symbol,
        side: exitSide,
        type: 'TAKE_PROFIT_MARKET',
        triggerPrice: tpPriceStr,
        orderQty: orderQtyStr,
        positionSide,
      });
    } catch (tpErr) {
      console.error('Take Profit algo order failed:', tpErr);
      bracketWarning += `TP failed: ${tpErr.message}. `;
    }

    // Stop Loss Order
    try {
      await placeAlgoConditionalOrder({
        symbol,
        side: exitSide,
        type: 'STOP_MARKET',
        triggerPrice: slPriceStr,
        orderQty: orderQtyStr,
        positionSide,
      });
    } catch (slErr) {
      console.error('Stop Loss algo order failed:', slErr);
      bracketWarning += `SL failed: ${slErr.message}. `;
    }

    haptic(35);
    playChime();

    if (bracketWarning) {
      showToast(`Primary Order Filled! ⚠️ ${bracketWarning}Please check in Binance app.`, 7000);
    } else {
      showToast(`🚀 ${positionState.type.toUpperCase()} position opened with Cross Margin & native TP/SL!`, 4000);
    }

    closeAllSheets();

    // Refresh balance in background
    fetchBinanceBalance().catch(() => {});
  } catch (err) {
    console.error('Order execution error:', err);
    showConfirmError(err.message || 'Order failed. Please verify your margin & API permissions.');
    haptic(50);
  } finally {
    isExecutingOrder = false;
    setSubmitButtonLoading(false);
  }
}

// Wire Binance Modals & Controls Event Listeners
if (dom.btnApiSettings) {
  dom.btnApiSettings.addEventListener('click', () => {
    closeAllSheets();
    openApiSheet();
  });
}
if (dom.btnPosApiCfg) {
  dom.btnPosApiCfg.addEventListener('click', () => {
    closeAllSheets();
    openApiSheet();
  });
}
if (dom.btnPosExchange) {
  dom.btnPosExchange.addEventListener('click', () => {
    closeAllSheets();
    openOrderConfirmationSheet();
  });
}
if (dom.btnPosHudTrade) {
  dom.btnPosHudTrade.addEventListener('click', () => {
    openOrderConfirmationSheet();
  });
}

// Order Confirmation Modal Listeners
if (dom.posConfirmClose) {
  dom.posConfirmClose.addEventListener('click', closeAllSheets);
}
if (dom.btnConfirmCancel) {
  dom.btnConfirmCancel.addEventListener('click', closeAllSheets);
}
if (dom.posConfirmBackdrop) {
  dom.posConfirmBackdrop.addEventListener('click', (e) => {
    if (e.target === dom.posConfirmBackdrop) closeAllSheets();
  });
}

if (dom.btnOrderTypeMarket) {
  dom.btnOrderTypeMarket.addEventListener('click', () => {
    haptic(10);
    state.orderForm.type = 'MARKET';
    dom.btnOrderTypeMarket.classList.add('active');
    if (dom.btnOrderTypeLimit) dom.btnOrderTypeLimit.classList.remove('active');
    if (dom.confirmLimitPriceGroup) dom.confirmLimitPriceGroup.classList.add('hidden');
    updateConfirmCalculations();
  });
}
if (dom.btnOrderTypeLimit) {
  dom.btnOrderTypeLimit.addEventListener('click', () => {
    haptic(10);
    state.orderForm.type = 'LIMIT';
    dom.btnOrderTypeLimit.classList.add('active');
    if (dom.btnOrderTypeMarket) dom.btnOrderTypeMarket.classList.remove('active');
    if (dom.confirmLimitPriceGroup) dom.confirmLimitPriceGroup.classList.remove('hidden');
    if (dom.confirmLimitPrice && (!dom.confirmLimitPrice.value || parseFloat(dom.confirmLimitPrice.value) <= 0)) {
      dom.confirmLimitPrice.value = positionState.entryPrice.toFixed(getPrecision(state.symbol));
    }
    updateConfirmCalculations();
  });
}

if (dom.confirmLimitPrice) {
  dom.confirmLimitPrice.addEventListener('input', updateConfirmCalculations);
}
if (dom.confirmSizeUsdt) {
  dom.confirmSizeUsdt.addEventListener('input', () => {
    // Manual input decouples from risk chips
    document.querySelectorAll('.confirm-risk-btn').forEach(b => b.classList.remove('active'));
    state.orderForm.riskPct = null;
    updateConfirmCalculations();
  });
}

// Risk Sizing Button Listeners (1%, 2%, 3%, 5%, 10%)
document.querySelectorAll('.confirm-risk-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    haptic(10);
    document.querySelectorAll('.confirm-risk-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.confirm-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const risk = parseFloat(btn.dataset.risk) || 5;
    applyRiskSizing(risk);
  });
});

// Fixed Size Quick Chips ($25, $50, $100, $250, $500)
document.querySelectorAll('.confirm-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    haptic(10);
    document.querySelectorAll('.confirm-risk-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.confirm-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');

    if (chip.dataset.val) {
      dom.confirmSizeUsdt.value = chip.dataset.val;
    }
    state.orderForm.riskPct = null;
    updateConfirmCalculations();
  });
});

// Leverage Buttons (5x, 10x, 20x, 50x)
document.querySelectorAll('.confirm-lev-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    haptic(10);
    document.querySelectorAll('.confirm-lev-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const lev = parseInt(btn.dataset.lev, 10) || 10;
    state.orderForm.leverage = lev;
    if (dom.confirmLeverageVal) {
      dom.confirmLeverageVal.textContent = `${lev}x`;
    }
    // Changing leverage adjusts required margin cost while keeping entered position size identical
    updateConfirmCalculations();
  });
});

if (dom.btnConfirmSubmit) {
  dom.btnConfirmSubmit.addEventListener('click', executeBinancePosition);
}

// API Management Modal Listeners
if (dom.apiSheetClose) {
  dom.apiSheetClose.addEventListener('click', closeAllSheets);
}
if (dom.apiSheetBackdrop) {
  dom.apiSheetBackdrop.addEventListener('click', (e) => {
    if (e.target === dom.apiSheetBackdrop) closeAllSheets();
  });
}
if (dom.btnEnvLive) {
  dom.btnEnvLive.addEventListener('click', () => {
    haptic(10);
    state.binanceApi.env = 'live';
    updateApiEnvDisplay();
  });
}
if (dom.btnEnvTestnet) {
  dom.btnEnvTestnet.addEventListener('click', () => {
    haptic(10);
    state.binanceApi.env = 'testnet';
    updateApiEnvDisplay();
  });
}
if (dom.btnToggleKeyVis && dom.apiKeyInput) {
  dom.btnToggleKeyVis.addEventListener('click', () => {
    const isPw = dom.apiKeyInput.type === 'password';
    dom.apiKeyInput.type = isPw ? 'text' : 'password';
    dom.btnToggleKeyVis.textContent = isPw ? '🔒' : '👁';
  });
}
if (dom.btnToggleSecVis && dom.apiSecretInput) {
  dom.btnToggleSecVis.addEventListener('click', () => {
    const isPw = dom.apiSecretInput.type === 'password';
    dom.apiSecretInput.type = isPw ? 'text' : 'password';
    dom.btnToggleSecVis.textContent = isPw ? '🔒' : '👁';
  });
}
if (dom.btnApiClear) {
  dom.btnApiClear.addEventListener('click', () => {
    haptic(15);
    if (dom.apiKeyInput) dom.apiKeyInput.value = '';
    if (dom.apiSecretInput) dom.apiSecretInput.value = '';
    if (dom.apiProxyInput) dom.apiProxyInput.value = '';
    saveApiConfig();
  });
}
if (dom.btnApiTest) {
  dom.btnApiTest.addEventListener('click', testApiConnection);
}
if (dom.btnApiSave) {
  dom.btnApiSave.addEventListener('click', saveApiConfig);
}


// Expose Binance API methods globally
window.hmacSha256 = hmacSha256;
window.getBinanceRestBase = getBinanceRestBase;
window.syncBinanceServerTime = syncBinanceServerTime;
window.getBinanceTimestamp = getBinanceTimestamp;
window.binanceSignedRequest = binanceSignedRequest;
window.quantizeQuantity = quantizeQuantity;
window.quantizeQuantityStr = quantizeQuantityStr;
window.quantizePrice = quantizePrice;
window.quantizePriceStr = quantizePriceStr;
window.fetchBinanceBalance = fetchBinanceBalance;
window.setSymbolLeverage = setSymbolLeverage;
window.setSymbolMarginType = setSymbolMarginType;
window.updateApiEnvDisplay = updateApiEnvDisplay;
window.openApiSheet = openApiSheet;
window.saveApiConfig = saveApiConfig;
window.testApiConnection = testApiConnection;
window.openOrderConfirmationSheet = openOrderConfirmationSheet;
window.executeBinancePosition = executeBinancePosition;
