/**
 * UnoRouter AI Trading Agent Integration
 * Connects to UnoRouter (OpenAI-compatible AI Gateway) to analyze Binance 5m USDⓈ-M charts,
 * calculate technical indicators, and automatically draw Long / Short positions with TP & SL.
 */

// =========================================================================
// 1. TECHNICAL INDICATORS & MARKET CONTEXT HELPERS
// =========================================================================

function computeEMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function computeATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  if (trs.length < period) return null;
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function computeRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function computeBollingerBands(closes, period = 20, multiplier = 2) {
  if (!closes || closes.length < period) return null;
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    middle: sma,
    upper: sma + multiplier * stdDev,
    lower: sma - multiplier * stdDev,
    bandwidthPct: sma > 0 ? ((multiplier * 2 * stdDev) / sma) * 100 : 0
  };
}

/**
 * Compiles a rich quantitative market snapshot of the current chart
 */
function getMarketTechnicalSnapshot() {
  const candles = state.rawCandles || [];
  const curPrice = state.currentPrice || (candles.length ? candles[candles.length - 1].close : 0);
  const closes = candles.map(c => c.close);
  const prec = getPrecision(state.symbol);

  // Indicators
  const ema9 = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const ema50 = computeEMA(closes, 50);
  const atr = computeATR(candles, 14);
  const rsi = computeRSI(closes, 14);
  const bb = computeBollingerBands(closes, 20, 2);

  // Swing Highs & Lows in recent 30 candles
  const recentWindow = candles.slice(-30);
  const windowHigh = recentWindow.length ? Math.max(...recentWindow.map(c => c.high)) : curPrice;
  const windowLow = recentWindow.length ? Math.min(...recentWindow.map(c => c.low)) : curPrice;

  // Last 12 candles compact representation
  const recentCandleSummary = candles.slice(-12).map((c, i) => {
    const isBull = c.close >= c.open;
    const chg = c.open > 0 ? (((c.close - c.open) / c.open) * 100).toFixed(2) : '0';
    return `[#${i + 1} O:${c.open.toFixed(prec)} H:${c.high.toFixed(prec)} L:${c.low.toFixed(prec)} C:${c.close.toFixed(prec)} (${isBull ? '+' : ''}${chg}%) Vol:${Math.round(c.volume)}]`;
  });

  return {
    symbol: state.symbol,
    interval: state.interval,
    currentPrice: curPrice,
    precision: prec,
    high24h: state.high24h,
    low24h: state.low24h,
    indicators: {
      atr: atr ? parseFloat(atr.toFixed(prec)) : null,
      rsi: rsi ? parseFloat(rsi.toFixed(1)) : null,
      ema9: ema9 ? parseFloat(ema9.toFixed(prec)) : null,
      ema21: ema21 ? parseFloat(ema21.toFixed(prec)) : null,
      ema50: ema50 ? parseFloat(ema50.toFixed(prec)) : null,
      bb: bb ? {
        upper: parseFloat(bb.upper.toFixed(prec)),
        middle: parseFloat(bb.middle.toFixed(prec)),
        lower: parseFloat(bb.lower.toFixed(prec)),
        bandwidthPct: parseFloat(bb.bandwidthPct.toFixed(2))
      } : null,
    },
    levels: {
      recentSwingHigh30: parseFloat(windowHigh.toFixed(prec)),
      recentSwingLow30: parseFloat(windowLow.toFixed(prec)),
      distTo24hHighPct: (state.high24h > 0 && curPrice > 0) ? parseFloat((((curPrice - state.high24h) / state.high24h) * 100).toFixed(2)) : 0,
      distTo24hLowPct: (state.low24h > 0 && curPrice > 0) ? parseFloat((((curPrice - state.low24h) / state.low24h) * 100).toFixed(2)) : 0
    },
    recentCandles: recentCandleSummary
  };
}

// =========================================================================
// 2. UNOROUTER API CLIENT & PROMPT GENERATION
// =========================================================================

/**
 * Builds the AI prompt with strict JSON formatting instructions
 */
function buildAiPrompt(actionType, userNote = '') {
  const snapshot = getMarketTechnicalSnapshot();
  const prec = snapshot.precision;
  const strat = state.aiAgent.strategy || 'scalp';

  const systemPrompt = `You are an elite cryptocurrency futures algorithmic trading agent and quantitative risk manager.
Your job is to analyze live Binance USDⓈ-M candle data, market structure, volatility, and technical indicators to construct an optimal trade setup.
You must output a precise trade recommendation with ENTRY, TAKE PROFIT (TP), and STOP LOSS (SL) price levels.

CRITICAL MATHEMATICAL & RISK RULES:
1. For LONG positions:
   - Take Profit MUST be strictly greater than Entry Price (TP > Entry).
   - Stop Loss MUST be strictly less than Entry Price (SL < Entry).
2. For SHORT positions:
   - Take Profit MUST be strictly less than Entry Price (TP < Entry).
   - Stop Loss MUST be strictly greater than Entry Price (SL > Entry).
3. Risk-to-Reward ratio (R:R) MUST be between 1.5 and 3.5. (Reward / Risk >= 1.5).
4. Realistic Stop Loss placement: Stop Loss should be anchored logically (e.g. beyond recent swing low/high, outside Bollinger Band, or 1.5x - 2.5x ATR distance), NEVER zero and NEVER arbitrary.
5. All price values must match the exact price scale and tick size of ${snapshot.symbol} (current price ~$${snapshot.currentPrice}).
6. Strictly output ONLY a valid JSON object matching the schema below. No markdown backticks outside, no conversational preamble.

REQUIRED JSON SCHEMA:
{
  "signal": "LONG" | "SHORT",
  "entryPrice": <number>,
  "tpPrice": <number>,
  "slPrice": <number>,
  "riskReward": <number>,
  "confidence": <integer 50-95>,
  "strategy": "<Strategy Name, e.g. 5m Liquidity Sweep Reversal, EMA Pullback, Breakout Continuation>",
  "rationale": "<2-3 clear, actionable sentences explaining technical reasoning, key level tested, and confluence>",
  "invalidation": "<exact price or market event that completely invalidates this trade setup>"
}`;

  let actionDirective = '';
  if (actionType === 'long') {
    actionDirective = 'Generate the highest probability LONG trade setup based on bullish structure, support, or momentum.';
  } else if (actionType === 'short') {
    actionDirective = 'Generate the highest probability SHORT trade setup based on bearish structure, resistance, or rejection.';
  } else {
    actionDirective = 'Evaluate current trend, momentum, and volatility. Determine whether a LONG or SHORT setup offers superior risk/reward right now.';
  }

  const userPrompt = `MARKET SNAPSHOT FOR ${snapshot.symbol} (${snapshot.interval} Timeframe):
- Current Live Price: $${snapshot.currentPrice}
- 24h High: $${snapshot.high24h} | 24h Low: $${snapshot.low24h}
- Technical Indicators:
  * ATR (14): $${snapshot.indicators.atr || 'N/A'} (Typical candle volatility range)
  * RSI (14): ${snapshot.indicators.rsi || 'N/A'}
  * EMA 9: $${snapshot.indicators.ema9 || 'N/A'}
  * EMA 21: $${snapshot.indicators.ema21 || 'N/A'}
  * EMA 50: $${snapshot.indicators.ema50 || 'N/A'}
  * Bollinger Bands (20,2): Upper $${snapshot.indicators.bb ? snapshot.indicators.bb.upper : 'N/A'}, Mid $${snapshot.indicators.bb ? snapshot.indicators.bb.middle : 'N/A'}, Lower $${snapshot.indicators.bb ? snapshot.indicators.bb.lower : 'N/A'}
- Recent 30-Candle Swing High: $${snapshot.levels.recentSwingHigh30} | Swing Low: $${snapshot.levels.recentSwingLow30}
- Recent 12 Candlesticks (Oldest to Newest):
${snapshot.recentCandles.join('\n')}

SELECTED STRATEGY STYLE: ${strat.toUpperCase()}
USER REQUEST / NOTES: ${userNote || 'None'}
DIRECTIVE: ${actionDirective}

Return strictly the JSON trade plan now.`;

  return { systemPrompt, userPrompt, snapshot };
}

/**
 * Sends request to UnoRouter OpenAI-compatible AI Gateway
 */
async function callUnoRouter(systemPrompt, userPrompt) {
  const rawBase = (state.aiAgent.gatewayUrl || 'https://api.unorouter.com/v1').trim();
  const apiKey = (state.aiAgent.apiKey || '').trim();
  const model = (state.aiAgent.model || 'gpt-4o-mini').trim();

  if (!apiKey) {
    throw new Error('UnoRouter API Key is missing. Please configure your API Key in the settings below.');
  }

  // Normalize base URL
  let endpoint = rawBase.replace(/\/+$/, '');
  if (!endpoint.endsWith('/chat/completions')) {
    endpoint = endpoint + '/chat/completions';
  }

  const payload = {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' }
  };

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });
  } catch (netErr) {
    throw new Error(`Failed to connect to UnoRouter at ${endpoint}. Check your internet connection and gateway URL.`);
  }

  // Fallback retry if model doesn't support response_format: { type: "json_object" }
  if (res.status === 400) {
    const errBody = await res.text();
    if (errBody.includes('response_format') || errBody.includes('json_object')) {
      delete payload.response_format;
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });
    } else {
      let errJson;
      try { errJson = JSON.parse(errBody); } catch (_) {}
      throw new Error(errJson && errJson.error ? errJson.error.message : `UnoRouter HTTP 400: ${errBody.slice(0, 150)}`);
    }
  }

  if (!res.ok) {
    let errMessage = `UnoRouter API error (HTTP ${res.status})`;
    try {
      const errData = await res.json();
      if (errData && errData.error && errData.error.message) {
        errMessage = errData.error.message;
      }
    } catch (_) {
      const errText = await res.text().catch(() => '');
      if (errText) errMessage += `: ${errText.slice(0, 120)}`;
    }
    throw new Error(errMessage);
  }

  const data = await res.json();
  if (!data.choices || !data.choices.length || !data.choices[0].message) {
    throw new Error('UnoRouter returned an empty or invalid response format.');
  }

  return data.choices[0].message.content;
}

/**
 * Extracts and validates JSON from LLM output
 */
function parseAiResponse(rawContent, snapshot) {
  let content = (rawContent || '').trim();

  // Strip markdown code fences if present
  if (content.startsWith('```')) {
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }

  // Regex extract JSON block
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse valid JSON from AI Agent response.');
  }

  let result;
  try {
    result = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error('JSON parsing failed: ' + e.message);
  }

  const signal = ((result.signal || 'LONG') + '').toUpperCase();
  const isShort = signal === 'SHORT';
  const curPrice = snapshot.currentPrice;
  const prec = snapshot.precision;

  let entry = parseFloat(result.entryPrice);
  let tp = parseFloat(result.tpPrice);
  let sl = parseFloat(result.slPrice);

  if (!entry || isNaN(entry) || entry <= 0) entry = curPrice;
  if (!tp || isNaN(tp) || tp <= 0) tp = isShort ? entry * 0.98 : entry * 1.02;
  if (!sl || isNaN(sl) || sl <= 0) sl = isShort ? entry * 1.01 : entry * 0.99;

  // Enforce logical validity
  if (isShort) {
    if (tp >= entry) tp = entry * 0.98;
    if (sl <= entry) sl = entry * 1.01;
  } else {
    if (tp <= entry) tp = entry * 1.02;
    if (sl >= entry) sl = entry * 0.99;
  }

  // Calculate actual R:R
  const risk = isShort ? (sl - entry) : (entry - sl);
  const reward = isShort ? (entry - tp) : (tp - entry);
  const actualRr = (risk > 0 && reward > 0) ? (reward / risk) : 2.0;

  return {
    signal: isShort ? 'SHORT' : 'LONG',
    entryPrice: parseFloat(entry.toFixed(prec)),
    tpPrice: parseFloat(tp.toFixed(prec)),
    slPrice: parseFloat(sl.toFixed(prec)),
    riskReward: parseFloat(actualRr.toFixed(2)),
    confidence: parseInt(result.confidence || 75, 10),
    strategy: result.strategy || 'UnoRouter AI Setup',
    rationale: result.rationale || 'Technical structure and momentum setup generated by UnoRouter AI.',
    invalidation: result.invalidation || `Price breaks beyond stop loss at $${sl.toFixed(prec)}`
  };
}

// =========================================================================
// 3. EXECUTION ENGINE & UI CONTROLLER
// =========================================================================

/**
 * Main trigger to execute an AI Agent analysis & draw position
 */
async function runAiTradeAnalysis(actionType = 'auto', customQuery = '') {
  if (state.aiAgent.isAnalyzing) return;
  haptic(20);

  const apiKey = (state.aiAgent.apiKey || '').trim();
  if (!apiKey) {
    showToast('🔑 UnoRouter API Key required. Please configure below.');
    if (dom.aiConfigCard) dom.aiConfigCard.classList.remove('hidden');
    if (dom.aiKeyInput) dom.aiKeyInput.focus();
    return;
  }

  try {
    state.aiAgent.isAnalyzing = true;
    updateAiUiLoadingState(true, actionType);

    const { systemPrompt, userPrompt, snapshot } = buildAiPrompt(actionType, customQuery);

    updateAiLoadingStep('Sending market data to UnoRouter AI gateway...');
    const rawAiOutput = await callUnoRouter(systemPrompt, userPrompt);

    updateAiLoadingStep('Parsing trade brackets & risk invalidation...');
    const plan = parseAiResponse(rawAiOutput, snapshot);

    state.aiAgent.lastResult = plan;

    // Draw directly onto chart!
    drawAiPosition({
      type: plan.signal.toLowerCase(),
      entryPrice: plan.entryPrice,
      tpPrice: plan.tpPrice,
      slPrice: plan.slPrice,
      strategy: plan.strategy,
      note: `${plan.signal} (${plan.strategy})`
    });

    renderAiResultCard(plan);
    updateAiUiLoadingState(false);
    showToast(`✨ UnoRouter AI: ${plan.signal} Setup Plotted!`);
  } catch (err) {
    console.error('UnoRouter AI Error:', err);
    updateAiUiLoadingState(false);
    showToast(`⚠️ AI Agent Error: ${err.message}`);
    if (dom.aiLoadingSubtext) {
      dom.aiLoadingSubtext.textContent = err.message;
    }
  } finally {
    state.aiAgent.isAnalyzing = false;
  }
}

function updateAiUiLoadingState(isLoading, actionType = 'auto') {
  if (dom.aiLoadingCard) {
    dom.aiLoadingCard.classList.toggle('hidden', !isLoading);
  }
  if (dom.aiResultCard && isLoading) {
    dom.aiResultCard.classList.add('hidden');
  }

  if (isLoading) {
    if (dom.aiLoadingText) {
      dom.aiLoadingText.textContent = `Analyzing ${state.symbol} (${state.interval})...`;
    }
    if (dom.aiLoadingSubtext) {
      dom.aiLoadingSubtext.textContent = 'Calculating ATR, RSI, EMAs, and querying UnoRouter AI...';
    }
  }

  [dom.btnAiLong, dom.btnAiShort, dom.btnAiAuto, dom.btnAiRunCustom].forEach(btn => {
    if (btn) btn.disabled = isLoading;
  });
}

function updateAiLoadingStep(stepText) {
  if (dom.aiLoadingSubtext) {
    dom.aiLoadingSubtext.textContent = stepText;
  }
}

function renderAiResultCard(plan) {
  if (!dom.aiResultCard) return;

  const isLong = plan.signal === 'LONG';
  const entry = plan.entryPrice;
  const tp = plan.tpPrice;
  const sl = plan.slPrice;
  const tpDiff = isLong ? (tp - entry) : (entry - tp);
  const tpPct = entry > 0 ? (tpDiff / entry) * 100 : 0;
  const slDiff = isLong ? (entry - sl) : (sl - entry);
  const slPct = entry > 0 ? (slDiff / entry) * 100 : 0;

  if (dom.aiSignalBadge) {
    dom.aiSignalBadge.className = `ai-signal-badge ${isLong ? 'long' : 'short'}`;
    dom.aiSignalBadge.textContent = `${isLong ? '▲' : '▼'} ${plan.signal}`;
  }

  if (dom.aiConfBadge) {
    dom.aiConfBadge.textContent = `${plan.confidence}% Conf`;
  }

  if (dom.aiResEntry) dom.aiResEntry.textContent = `$${formatPrice(entry)}`;
  if (dom.aiResTp) dom.aiResTp.textContent = `$${formatPrice(tp)}`;
  if (dom.aiResTpPct) dom.aiResTpPct.textContent = `+${Math.abs(tpPct).toFixed(2)}%`;
  if (dom.aiResSl) dom.aiResSl.textContent = `$${formatPrice(sl)}`;
  if (dom.aiResSlPct) dom.aiResSlPct.textContent = `-${Math.abs(slPct).toFixed(2)}%`;
  if (dom.aiResRr) dom.aiResRr.textContent = `1:${plan.riskReward.toFixed(2)}`;

  if (dom.aiRationaleTitle) dom.aiRationaleTitle.textContent = `Strategy: ${plan.strategy}`;
  if (dom.aiRationaleText) dom.aiRationaleText.textContent = plan.rationale;
  if (dom.aiInvalidationText) dom.aiInvalidationText.textContent = `Invalidation: ${plan.invalidation}`;

  dom.aiResultCard.classList.remove('hidden');
}

// =========================================================================
// 4. CONFIGURATION & UI EVENT BINDINGS
// =========================================================================

function updateGatewayStatusBadge() {
  const key = (state.aiAgent.apiKey || '').trim();
  const model = state.aiAgent.model || 'gpt-4o-mini';

  if (dom.aiGatewayStatusDot) {
    dom.aiGatewayStatusDot.className = `ai-dot ${key ? 'configured' : 'warning'}`;
  }
  if (dom.aiGatewayStatusText) {
    dom.aiGatewayStatusText.textContent = key ? 'UnoRouter Stored in Browser' : 'API Key Required';
  }
  if (dom.aiModelCurrentBadge) {
    dom.aiModelCurrentBadge.textContent = model;
  }
}

// Synchronize UnoRouter configuration inputs across modals
function syncUnoRouterInputs() {
  const base = state.aiAgent.gatewayUrl || 'https://api.unorouter.com/v1';
  const key = state.aiAgent.apiKey || '';
  const model = state.aiAgent.model || 'gpt-4o-mini';

  if (dom.aiGatewayBaseInput) dom.aiGatewayBaseInput.value = base;
  if (dom.unoModalBaseInput) dom.unoModalBaseInput.value = base;

  if (dom.aiKeyInput) dom.aiKeyInput.value = key;
  if (dom.unoModalKeyInput) dom.unoModalKeyInput.value = key;

  if (dom.aiModelInput) dom.aiModelInput.value = model;
  if (dom.unoModalModelInput) dom.unoModalModelInput.value = model;

  document.querySelectorAll('.ai-model-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.model === model);
  });
}

function saveUnoRouterConfig(baseVal, keyVal, modelVal) {
  haptic(15);
  const base = (baseVal || 'https://api.unorouter.com/v1').trim() || 'https://api.unorouter.com/v1';
  const key = (keyVal || '').trim();
  const model = (modelVal || 'gpt-4o-mini').trim() || 'gpt-4o-mini';

  state.aiAgent.gatewayUrl = base;
  state.aiAgent.apiKey = key;
  state.aiAgent.model = model;

  try {
    localStorage.setItem('cc_unorouter_base', base);
    if (key) {
      localStorage.setItem('cc_unorouter_key', key);
    } else {
      localStorage.removeItem('cc_unorouter_key');
    }
    localStorage.setItem('cc_unorouter_model', model);
  } catch (_) {}

  syncUnoRouterInputs();
  updateGatewayStatusBadge();

  if (dom.aiConfigCard) dom.aiConfigCard.classList.add('hidden');
  showToast(key ? '🔒 UnoRouter Key saved in browser storage' : 'UnoRouter API Key cleared');
}

function clearUnoRouterConfig() {
  haptic(15);
  state.aiAgent.apiKey = '';
  try {
    localStorage.removeItem('cc_unorouter_key');
  } catch (_) {}

  syncUnoRouterInputs();
  updateGatewayStatusBadge();

  [dom.unoModalTestResult, dom.aiSheetTestResult].forEach(el => {
    if (el) {
      el.classList.add('hidden');
      el.textContent = '';
    }
  });

  showToast('UnoRouter API Key disconnected from browser');
}

async function testUnoRouterConnection(targetResultEl, testBase, testKey, testModel) {
  haptic(10);
  const base = (testBase || state.aiAgent.gatewayUrl || 'https://api.unorouter.com/v1').trim();
  const key = (testKey !== undefined ? testKey : state.aiAgent.apiKey || '').trim();
  const model = (testModel || state.aiAgent.model || 'gpt-4o-mini').trim();

  if (!key) {
    if (targetResultEl) {
      targetResultEl.className = 'api-test-result fail';
      targetResultEl.textContent = '❌ Please enter an UnoRouter API Key first.';
      targetResultEl.classList.remove('hidden');
    }
    showToast('Enter UnoRouter API Key first');
    return;
  }

  if (targetResultEl) {
    targetResultEl.className = 'api-test-result';
    targetResultEl.textContent = `⏳ Testing connection to UnoRouter (${model})...`;
    targetResultEl.classList.remove('hidden');
  }

  let endpoint = base.replace(/\/+$/, '');
  if (!endpoint.endsWith('/chat/completions')) {
    endpoint = endpoint + '/chat/completions';
  }

  const startTime = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'Ping' }],
        max_tokens: 3
      })
    });

    const elapsed = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text();
      let msg = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(errText);
        if (j.error && j.error.message) msg = j.error.message;
      } catch (_) {
        if (errText) msg = errText.slice(0, 100);
      }
      throw new Error(msg);
    }

    if (targetResultEl) {
      targetResultEl.className = 'api-test-result success';
      targetResultEl.textContent = `✅ Success! Authenticated with UnoRouter (${model}). Latency: ${elapsed}ms.`;
    }
    showToast(`✅ UnoRouter connected (${elapsed}ms)`);
  } catch (err) {
    if (targetResultEl) {
      targetResultEl.className = 'api-test-result fail';
      targetResultEl.textContent = `❌ ${err.message}`;
    }
    showToast(`❌ Connection failed: ${err.message}`);
  }
}

function initAiAgent() {
  // Populate inputs from saved state
  syncUnoRouterInputs();
  if (dom.aiPromptInput && state.aiAgent.customPrompt) {
    dom.aiPromptInput.value = state.aiAgent.customPrompt;
  }

  // Model chips selection across both panels
  document.querySelectorAll('.ai-model-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      haptic(10);
      const m = chip.dataset.model;
      state.aiAgent.model = m;
      if (dom.aiModelInput) dom.aiModelInput.value = m;
      if (dom.unoModalModelInput) dom.unoModalModelInput.value = m;
      document.querySelectorAll('.ai-model-chip').forEach(c => c.classList.toggle('active', c.dataset.model === m));
      try { localStorage.setItem('cc_unorouter_model', m); } catch (_) {}
      updateGatewayStatusBadge();
    });
  });

  // Highlight active strategy pill
  document.querySelectorAll('.ai-strat-pill').forEach(pill => {
    const s = pill.dataset.strat;
    pill.classList.toggle('active', s === state.aiAgent.strategy);
    pill.addEventListener('click', () => {
      haptic(10);
      document.querySelectorAll('.ai-strat-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.aiAgent.strategy = s;
      try { localStorage.setItem('cc_unorouter_strat', s); } catch (_) {}
    });
  });

  // Toggle Config Panel in AI Sheet
  if (dom.btnToggleAiConfig && dom.aiConfigCard) {
    dom.btnToggleAiConfig.addEventListener('click', () => {
      haptic(10);
      dom.aiConfigCard.classList.toggle('hidden');
    });
  }

  // Toggle Key Visibility in AI Sheet
  if (dom.btnToggleAiKeyVis && dom.aiKeyInput) {
    dom.btnToggleAiKeyVis.addEventListener('click', () => {
      const isPass = dom.aiKeyInput.type === 'password';
      dom.aiKeyInput.type = isPass ? 'text' : 'password';
      dom.btnToggleAiKeyVis.textContent = isPass ? '🔒' : '👁';
    });
  }

  // Toggle Key Visibility in Unified API Sheet
  if (dom.btnToggleUnoModalVis && dom.unoModalKeyInput) {
    dom.btnToggleUnoModalVis.addEventListener('click', () => {
      const isPass = dom.unoModalKeyInput.type === 'password';
      dom.unoModalKeyInput.type = isPass ? 'text' : 'password';
      dom.btnToggleUnoModalVis.textContent = isPass ? '🔒' : '👁';
    });
  }

  // Unified API Sheet Tab Switching
  if (dom.tabBtnBinance && dom.tabBtnUnoRouter) {
    dom.tabBtnBinance.addEventListener('click', () => {
      haptic(10);
      dom.tabBtnBinance.classList.add('active');
      dom.tabBtnUnoRouter.classList.remove('active');
      if (dom.panelApiBinance) dom.panelApiBinance.classList.remove('hidden');
      if (dom.panelApiUnoRouter) dom.panelApiUnoRouter.classList.add('hidden');
    });

    dom.tabBtnUnoRouter.addEventListener('click', () => {
      haptic(10);
      dom.tabBtnUnoRouter.classList.add('active');
      dom.tabBtnBinance.classList.remove('active');
      if (dom.panelApiUnoRouter) dom.panelApiUnoRouter.classList.remove('hidden');
      if (dom.panelApiBinance) dom.panelApiBinance.classList.add('hidden');
      syncUnoRouterInputs();
    });
  }

  // Save UnoRouter Config (Unified API Sheet)
  if (dom.btnUnoModalSave) {
    dom.btnUnoModalSave.addEventListener('click', () => {
      const base = dom.unoModalBaseInput ? dom.unoModalBaseInput.value : '';
      const key = dom.unoModalKeyInput ? dom.unoModalKeyInput.value : '';
      const model = dom.unoModalModelInput ? dom.unoModalModelInput.value : '';
      saveUnoRouterConfig(base, key, model);
      closeAllSheets();
    });
  }

  // Disconnect UnoRouter (Unified API Sheet)
  if (dom.btnUnoModalClear) {
    dom.btnUnoModalClear.addEventListener('click', clearUnoRouterConfig);
  }

  // Test UnoRouter (Unified API Sheet)
  if (dom.btnUnoModalTest) {
    dom.btnUnoModalTest.addEventListener('click', () => {
      const base = dom.unoModalBaseInput ? dom.unoModalBaseInput.value : '';
      const key = dom.unoModalKeyInput ? dom.unoModalKeyInput.value : '';
      const model = dom.unoModalModelInput ? dom.unoModalModelInput.value : '';
      testUnoRouterConnection(dom.unoModalTestResult, base, key, model);
    });
  }

  // Save UnoRouter Config (AI Bottom Sheet)
  if (dom.btnSaveAiConfig) {
    dom.btnSaveAiConfig.addEventListener('click', () => {
      const base = dom.aiGatewayBaseInput ? dom.aiGatewayBaseInput.value : '';
      const key = dom.aiKeyInput ? dom.aiKeyInput.value : '';
      const model = dom.aiModelInput ? dom.aiModelInput.value : '';
      saveUnoRouterConfig(base, key, model);
    });
  }

  // Disconnect UnoRouter (AI Bottom Sheet)
  if (dom.btnClearAiConfig) {
    dom.btnClearAiConfig.addEventListener('click', clearUnoRouterConfig);
  }

  // Test UnoRouter (AI Bottom Sheet)
  if (dom.btnTestAiConfig) {
    dom.btnTestAiConfig.addEventListener('click', () => {
      const base = dom.aiGatewayBaseInput ? dom.aiGatewayBaseInput.value : '';
      const key = dom.aiKeyInput ? dom.aiKeyInput.value : '';
      const model = dom.aiModelInput ? dom.aiModelInput.value : '';
      testUnoRouterConnection(dom.aiSheetTestResult, base, key, model);
    });
  }

  // Quick Action Buttons
  if (dom.btnAiLong) {
    dom.btnAiLong.addEventListener('click', () => runAiTradeAnalysis('long'));
  }
  if (dom.btnAiShort) {
    dom.btnAiShort.addEventListener('click', () => runAiTradeAnalysis('short'));
  }
  if (dom.btnAiAuto) {
    dom.btnAiAuto.addEventListener('click', () => runAiTradeAnalysis('auto'));
  }

  // Custom Prompt Execution
  if (dom.btnAiRunCustom) {
    dom.btnAiRunCustom.addEventListener('click', () => {
      const prompt = dom.aiPromptInput ? dom.aiPromptInput.value.trim() : '';
      if (prompt) {
        try { localStorage.setItem('cc_unorouter_prompt', prompt); } catch (_) {}
      }
      runAiTradeAnalysis('auto', prompt);
    });
  }

  // Result Card: Re-draw Button
  if (dom.btnAiDrawChart) {
    dom.btnAiDrawChart.addEventListener('click', () => {
      if (state.aiAgent.lastResult) {
        const plan = state.aiAgent.lastResult;
        drawAiPosition({
          type: plan.signal.toLowerCase(),
          entryPrice: plan.entryPrice,
          tpPrice: plan.tpPrice,
          slPrice: plan.slPrice,
          strategy: plan.strategy,
          note: `${plan.signal} (${plan.strategy})`
        });
        closeAllSheets();
      }
    });
  }

  // Result Card: Execute on Binance Button
  if (dom.btnAiExecuteOrder) {
    dom.btnAiExecuteOrder.addEventListener('click', () => {
      closeAllSheets();
      if (typeof window.openOrderConfirmationSheet === 'function') {
        window.openOrderConfirmationSheet();
      }
    });
  }

  // Open Sheet Triggers
  if (dom.btnPosAi) {
    dom.btnPosAi.addEventListener('click', openAiSheet);
  }
  if (dom.btnAiAgentHeader) {
    dom.btnAiAgentHeader.addEventListener('click', openAiSheet);
  }
  if (dom.aiSheetClose) {
    dom.aiSheetClose.addEventListener('click', closeAllSheets);
  }
  if (dom.aiBackdrop) {
    dom.aiBackdrop.addEventListener('click', (e) => {
      if (e.target === dom.aiBackdrop) closeAllSheets();
    });
    const dragHandle = dom.aiBackdrop.querySelector('.sheet-drag-handle');
    if (dragHandle) dragHandle.addEventListener('click', closeAllSheets);
  }

  updateGatewayStatusBadge();
  checkUrlParamsForAiPositions();
}

function openAiSheet() {
  haptic(15);
  openSheet(dom.aiBackdrop);
  updateGatewayStatusBadge();

  // If no API key set yet, open config panel automatically
  if (!state.aiAgent.apiKey && dom.aiConfigCard) {
    dom.aiConfigCard.classList.remove('hidden');
  }

  // If we already have a previous result, display it
  if (state.aiAgent.lastResult && dom.aiResultCard) {
    renderAiResultCard(state.aiAgent.lastResult);
  }
}

// =========================================================================
// 5. EXTERNAL PROGRAMMATIC APIS & WEBHOOKS
// =========================================================================

/**
 * Allows external AI agents, Python scripts, or bots to draw positions
 * via window.postMessage, URL query parameters, or global JS functions.
 */

// Window PostMessage Listener
window.addEventListener('message', (event) => {
  if (!event || !event.data || typeof event.data !== 'object') return;
  const msg = event.data;

  if (msg.action === 'drawPosition' || msg.action === 'drawAiPosition') {
    drawAiPosition(msg);
  } else if (msg.action === 'getMarketData' || msg.action === 'getChartState') {
    const snapshot = getMarketTechnicalSnapshot();
    if (event.source && typeof event.source.postMessage === 'function') {
      event.source.postMessage({ action: 'marketDataResponse', data: snapshot }, '*');
    }
  }
});

// URL Query Parameter Deep-Linking
function checkUrlParamsForAiPositions() {
  try {
    const params = new URLSearchParams(window.location.search);
    const pos = params.get('pos') || params.get('position');
    if (pos) {
      const type = pos.toLowerCase();
      const entry = parseFloat(params.get('entry') || '0');
      const tp = parseFloat(params.get('tp') || '0');
      const sl = parseFloat(params.get('sl') || '0');
      const note = params.get('note') || params.get('strategy') || 'External AI Agent';
      const autoConfirm = params.get('execute') === '1' || params.get('confirm') === '1';

      setTimeout(() => {
        drawAiPosition({
          type: type,
          entryPrice: entry > 0 ? entry : undefined,
          tpPrice: tp > 0 ? tp : undefined,
          slPrice: sl > 0 ? sl : undefined,
          note: note,
          autoOpenConfirm: autoConfirm
        });
      }, 800);
    }
  } catch (_) {}
}

// Expose AI Agent Methods Globally
window.runAiTradeAnalysis = runAiTradeAnalysis;
window.openAiSheet = openAiSheet;
window.getMarketTechnicalSnapshot = getMarketTechnicalSnapshot;
window.initAiAgent = initAiAgent;
window.syncUnoRouterInputs = syncUnoRouterInputs;
window.saveUnoRouterConfig = saveUnoRouterConfig;
window.clearUnoRouterConfig = clearUnoRouterConfig;
window.testUnoRouterConnection = testUnoRouterConnection;

// Initialize once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAiAgent);
} else {
  initAiAgent();
}
