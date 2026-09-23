/**
 * Hugging Face AI Trading Agent Integration
 * Connects to Hugging Face (OpenAI-compatible AI Gateway) to analyze Binance 5m USDⓈ-M charts,
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
// 2. HUGGINGFACE API CLIENT & PROMPT GENERATION
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

// ---- Request timeout, cancellation & friendly error mapping ----
const AI_REQ_TIMEOUT_MS = 45000;
const AI_TEST_TIMEOUT_MS = 15000;

/** Maps raw gateway HTTP errors to actionable, human-friendly messages. */
function friendlyGatewayError(status, rawMsg = '') {
  const raw = (rawMsg || '').trim();
  if (status === 401 || status === 403) {
    return `Token rejected (HTTP ${status}). Make sure your hf_... token is valid and has "Make calls to inference providers" enabled.`;
  }
  if (status === 402) {
    return 'Hugging Face free credits are exhausted. Wait for the monthly reset, upgrade to PRO, or point the Gateway URL at another OpenAI-compatible provider.';
  }
  if (status === 404) {
    return raw || 'Model or endpoint not found (HTTP 404). Pick a different model or check the Model ID.';
  }
  if (status === 408 || status === 504) {
    return 'The gateway timed out (the provider may be cold-starting). Try again in a moment.';
  }
  if (status === 429) {
    return 'Rate limited (HTTP 429). Wait a few seconds, then retry.';
  }
  if (status >= 500) {
    return `Hugging Face provider error (HTTP ${status}). ${raw || 'Try again shortly.'}`;
  }
  return raw || `HTTP ${status}`;
}

function endpointHost(endpoint) {
  try { return new URL(endpoint).host; } catch (_) { return endpoint; }
}

/**
 * POST helper with timeout + cancellation.
 * Errors carry `.cancelled` (user abort), `.timedOut`, or `.network` flags
 * so callers can react appropriately.
 */
async function postChatCompletion(endpoint, payload, apiKey, timeoutMs = AI_REQ_TIMEOUT_MS) {
  const controller = new AbortController();
  state.aiAgent.abortController = controller;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (err) {
    if (controller.signal.aborted) {
      const e = timedOut
        ? new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s. The model may be loading — try again or pick a faster model.`)
        : new Error('Analysis cancelled.');
      if (timedOut) { e.timedOut = true; } else { e.cancelled = true; }
      throw e;
    }
    const e = new Error(`Could not reach ${endpointHost(endpoint)} — check your internet connection. If this keeps happening, the gateway may be blocking browser (CORS) requests.`);
    e.network = true;
    throw e;
  } finally {
    clearTimeout(timer);
    if (state.aiAgent.abortController === controller) state.aiAgent.abortController = null;
  }
}

/**
 * Sends request to Hugging Face OpenAI-compatible AI Gateway
 */
async function callHuggingFace(systemPrompt, userPrompt) {
  const current = (typeof getHuggingFaceInputValues === 'function') ? getHuggingFaceInputValues() : {};
  const rawBase = (state.aiAgent.gatewayUrl || current.base || 'https://router.huggingface.co/v1').trim();
  const apiKey = (state.aiAgent.apiKey || current.key || '').trim();
  const model = (state.aiAgent.model || current.model || 'openai/gpt-oss-120b').trim();

  if (!apiKey) {
    throw new Error('Hugging Face API Key is missing. Please configure your API Key in the settings below.');
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

  let res = await postChatCompletion(endpoint, payload, apiKey, AI_REQ_TIMEOUT_MS);

  // Fallback retry if model doesn't support response_format: { type: "json_object" }
  if (res.status === 400) {
    const errBody = await res.text().catch(() => '');
    if (errBody.includes('response_format') || errBody.includes('json_object')) {
      delete payload.response_format;
      res = await postChatCompletion(endpoint, payload, apiKey, AI_REQ_TIMEOUT_MS);
    } else {
      let errJson;
      try { errJson = JSON.parse(errBody); } catch (_) {}
      const raw = (errJson && errJson.error && errJson.error.message) || errBody.slice(0, 150);
      throw new Error(friendlyGatewayError(400, raw));
    }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let raw = '';
    try {
      const j = JSON.parse(errText);
      raw = (j.error && j.error.message) || '';
    } catch (_) {}
    if (!raw) raw = errText.slice(0, 150);
    throw new Error(friendlyGatewayError(res.status, raw));
  }

  let data;
  try {
    data = await res.json();
  } catch (_) {
    throw new Error('Hugging Face returned a malformed (non-JSON) response. Try again or switch models.');
  }
  if (!data.choices || !data.choices.length || !data.choices[0].message) {
    throw new Error('Hugging Face returned an empty response (no choices). Try a different model.');
  }

  return data.choices[0].message.content || '';
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
    throw new Error('The model did not return a JSON trade plan. Tap Retry, or switch to a more reliable model (e.g. openai/gpt-oss-20b).');
  }

  let result;
  try {
    result = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error('JSON parsing failed: ' + e.message + ' — tap Retry or switch models.');
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

  let conf = parseInt(result.confidence, 10);
  if (!Number.isFinite(conf)) conf = 75;
  conf = Math.min(99, Math.max(1, conf));

  return {
    signal: isShort ? 'SHORT' : 'LONG',
    entryPrice: parseFloat(entry.toFixed(prec)),
    tpPrice: parseFloat(tp.toFixed(prec)),
    slPrice: parseFloat(sl.toFixed(prec)),
    riskReward: parseFloat(actualRr.toFixed(2)),
    confidence: conf,
    strategy: String(result.strategy || 'Hugging Face AI Setup').slice(0, 120),
    rationale: String(result.rationale || 'Technical structure and momentum setup generated by Hugging Face AI.').slice(0, 600),
    invalidation: String(result.invalidation || `Price breaks beyond stop loss at $${sl.toFixed(prec)}`).slice(0, 240)
  };
}

// =========================================================================
// 3. EXECUTION ENGINE & UI CONTROLLER
// =========================================================================

function hideAiErrorCard() {
  if (dom.aiErrorCard) dom.aiErrorCard.classList.add('hidden');
}

function renderAiErrorCard(message, title = 'Analysis failed') {
  if (!dom.aiErrorCard) return;
  if (dom.aiErrorTitle) dom.aiErrorTitle.textContent = title;
  if (dom.aiErrorMsg) dom.aiErrorMsg.textContent = message;
  dom.aiErrorCard.classList.remove('hidden');
  try { dom.aiErrorCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}
}

function cancelAiAnalysis() {
  haptic(10);
  const controller = state.aiAgent.abortController;
  if (controller) {
    if (dom.aiLoadingSubtext) dom.aiLoadingSubtext.textContent = 'Cancelling…';
    controller.abort();
  } else {
    state.aiAgent.isAnalyzing = false;
    updateAiUiLoadingState(false);
    showToast('⏹ Analysis cancelled');
  }
}

/**
 * Main trigger to execute an AI Agent analysis & draw position
 */
async function runAiTradeAnalysis(actionType = 'auto', customQuery = '') {
  if (state.aiAgent.isAnalyzing) return;
  haptic(20);

  let apiKey = (state.aiAgent.apiKey || '').trim();
  if (!apiKey && typeof getHuggingFaceInputValues === 'function') {
    const current = getHuggingFaceInputValues();
    if (current.key) {
      apiKey = current.key;
      saveHuggingFaceConfig(current.base, current.key, current.model, false);
    }
  }

  if (!apiKey) {
    showToast('🔑 Hugging Face API Key required. Please configure below.');
    if (dom.aiConfigCard) dom.aiConfigCard.classList.remove('hidden');
    const inputToFocus = document.getElementById('ai-key-input') || document.getElementById('huggingface-modal-key-input');
    if (inputToFocus) inputToFocus.focus();
    return;
  }

  state.aiAgent.lastAction = actionType;
  state.aiAgent.lastQuery = customQuery;
  hideAiErrorCard();

  try {
    state.aiAgent.isAnalyzing = true;
    updateAiUiLoadingState(true, actionType);

    const { systemPrompt, userPrompt, snapshot } = buildAiPrompt(actionType, customQuery);

    updateAiLoadingStep('Sending market data to Hugging Face AI gateway...');
    const rawAiOutput = await callHuggingFace(systemPrompt, userPrompt);

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
    showToast(`✨ Hugging Face AI: ${plan.signal} Setup Plotted!`);
  } catch (err) {
    console.error('Hugging Face AI Error:', err);
    if (err && err.cancelled) {
      showToast('⏹ Analysis cancelled');
    } else {
      const msg = (err && err.message) || 'Unknown error';
      renderAiErrorCard(msg);
      showToast(`⚠️ ${msg.length > 90 ? msg.slice(0, 90) + '…' : msg}`);
    }
  } finally {
    state.aiAgent.isAnalyzing = false;
    state.aiAgent.abortController = null;
    updateAiUiLoadingState(false);
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
    hideAiErrorCard();
  }

  if (isLoading) {
    if (dom.aiLoadingText) {
      dom.aiLoadingText.textContent = `Analyzing ${state.symbol} (${state.interval})...`;
    }
    if (dom.aiLoadingSubtext) {
      dom.aiLoadingSubtext.textContent = 'Calculating ATR, RSI, EMAs, and querying Hugging Face AI...';
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
    const conf = parseInt(plan.confidence, 10);
    dom.aiConfBadge.textContent = `${Number.isFinite(conf) ? Math.min(99, Math.max(1, conf)) : 75}% Conf`;
  }

  if (dom.aiResEntry) dom.aiResEntry.textContent = `$${formatPrice(entry)}`;
  if (dom.aiResTp) dom.aiResTp.textContent = `$${formatPrice(tp)}`;
  if (dom.aiResTpPct) dom.aiResTpPct.textContent = `+${Math.abs(tpPct).toFixed(2)}%`;
  if (dom.aiResSl) dom.aiResSl.textContent = `$${formatPrice(sl)}`;
  if (dom.aiResSlPct) dom.aiResSlPct.textContent = `-${Math.abs(slPct).toFixed(2)}%`;
  const rr = Number(plan.riskReward);
  if (dom.aiResRr) dom.aiResRr.textContent = (Number.isFinite(rr) && rr > 0) ? `1:${rr.toFixed(2)}` : '1:2.00';

  if (dom.aiRationaleTitle) dom.aiRationaleTitle.textContent = `Strategy: ${plan.strategy}`;
  if (dom.aiRationaleText) dom.aiRationaleText.textContent = plan.rationale;
  if (dom.aiInvalidationText) dom.aiInvalidationText.textContent = `Invalidation: ${plan.invalidation}`;

  if (dom.aiResultMeta) {
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    dom.aiResultMeta.textContent = `${state.aiAgent.model || 'openai/gpt-oss-120b'} · ${state.symbol} ${state.interval} · ${t}`;
  }

  dom.aiResultCard.classList.remove('hidden');
}

// =========================================================================
// 4. CONFIGURATION & UI EVENT BINDINGS
// =========================================================================

function updateGatewayStatusBadge() {
  const key = (state.aiAgent.apiKey || '').trim();
  const model = state.aiAgent.model || 'openai/gpt-oss-120b';

  if (dom.aiGatewayStatusDot) {
    dom.aiGatewayStatusDot.className = `ai-dot ${key ? 'configured' : 'warning'}`;
  }
  if (dom.aiGatewayStatusText) {
    dom.aiGatewayStatusText.textContent = key ? 'Token saved · Ready' : 'Token required';
  }
  if (dom.aiModelCurrentBadge) {
    dom.aiModelCurrentBadge.textContent = model;
  }
}

// Helper to retrieve current Hugging Face inputs from DOM, state, or localStorage
function getHuggingFaceInputValues() {
  const base = (
    (document.getElementById('huggingface-modal-base-input') && document.getElementById('huggingface-modal-base-input').value) ||
    (document.getElementById('ai-gateway-base-input') && document.getElementById('ai-gateway-base-input').value) ||
    state.aiAgent.gatewayUrl ||
    (function () { try { return localStorage.getItem('cc_huggingface_base') || ''; } catch (_) { return ''; } })() ||
    'https://router.huggingface.co/v1'
  ).trim();

  const key = (
    (document.getElementById('huggingface-modal-key-input') && document.getElementById('huggingface-modal-key-input').value) ||
    (document.getElementById('ai-key-input') && document.getElementById('ai-key-input').value) ||
    state.aiAgent.apiKey ||
    (function () { try { return localStorage.getItem('cc_huggingface_key') || ''; } catch (_) { return ''; } })() ||
    ''
  ).trim();

  const model = (
    (document.getElementById('huggingface-modal-model-input') && document.getElementById('huggingface-modal-model-input').value) ||
    (document.getElementById('ai-model-input') && document.getElementById('ai-model-input').value) ||
    state.aiAgent.model ||
    (function () { try { return localStorage.getItem('cc_huggingface_model') || ''; } catch (_) { return ''; } })() ||
    'openai/gpt-oss-120b'
  ).trim();

  return { base, key, model };
}

// Synchronize Hugging Face configuration inputs across modals
function syncHuggingFaceInputs() {
  const current = getHuggingFaceInputValues();
  const base = current.base;
  const key = current.key;
  const model = current.model;

  state.aiAgent.gatewayUrl = base;
  state.aiAgent.apiKey = key;
  state.aiAgent.model = model;

  const aiBase = document.getElementById('ai-gateway-base-input');
  const huggingfaceBase = document.getElementById('huggingface-modal-base-input');
  const aiKey = document.getElementById('ai-key-input');
  const huggingfaceKey = document.getElementById('huggingface-modal-key-input');
  const aiModel = document.getElementById('ai-model-input');
  const huggingfaceModel = document.getElementById('huggingface-modal-model-input');

  if (aiBase && aiBase.value !== base) aiBase.value = base;
  if (huggingfaceBase && huggingfaceBase.value !== base) huggingfaceBase.value = base;
  if (aiKey && aiKey.value !== key) aiKey.value = key;
  if (huggingfaceKey && huggingfaceKey.value !== key) huggingfaceKey.value = key;
  if (aiModel && aiModel.value !== model) aiModel.value = model;
  if (huggingfaceModel && huggingfaceModel.value !== model) huggingfaceModel.value = model;

  document.querySelectorAll('.ai-model-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.model === model);
  });

  updateGatewayStatusBadge();
}

function saveHuggingFaceConfig(baseVal, keyVal, modelVal, showNotification = true) {
  haptic(15);
  const current = getHuggingFaceInputValues();
  const base = (baseVal !== undefined && baseVal !== null ? baseVal : current.base).trim() || 'https://router.huggingface.co/v1';
  const key = (keyVal !== undefined && keyVal !== null ? keyVal : current.key).trim();
  const model = (modelVal !== undefined && modelVal !== null ? modelVal : current.model).trim() || 'openai/gpt-oss-120b';

  state.aiAgent.gatewayUrl = base;
  state.aiAgent.apiKey = key;
  state.aiAgent.model = model;

  let storageOk = true;
  try {
    localStorage.setItem('cc_huggingface_base', base);
    if (key) {
      localStorage.setItem('cc_huggingface_key', key);
    } else {
      localStorage.removeItem('cc_huggingface_key');
    }
    localStorage.setItem('cc_huggingface_model', model);
  } catch (err) {
    storageOk = false;
    console.warn('localStorage error:', err);
  }

  syncHuggingFaceInputs();
  updateGatewayStatusBadge();

  if (dom.aiConfigCard && key) {
    dom.aiConfigCard.classList.add('hidden');
  }

  if (showNotification) {
    if (key) {
      showToast(storageOk ? '🔒 Hugging Face token saved in browser storage' : '⚠️ Browser storage blocked — token active this session only');
    } else {
      showToast('Hugging Face API Key cleared');
    }
  }
  return storageOk;
}

function clearHuggingFaceConfig() {
  haptic(15);
  state.aiAgent.apiKey = '';
  try {
    localStorage.removeItem('cc_huggingface_key');
  } catch (_) {}

  const aiKey = document.getElementById('ai-key-input');
  const huggingfaceKey = document.getElementById('huggingface-modal-key-input');
  if (aiKey) aiKey.value = '';
  if (huggingfaceKey) huggingfaceKey.value = '';

  syncHuggingFaceInputs();
  updateGatewayStatusBadge();

  const r1 = document.getElementById('huggingface-modal-test-result');
  const r2 = document.getElementById('ai-sheet-test-result');
  [r1, r2, dom.huggingfaceModalTestResult, dom.aiSheetTestResult].forEach(el => {
    if (el) {
      el.classList.add('hidden');
      el.textContent = '';
    }
  });

  showToast('Hugging Face API Key disconnected from browser');
}

async function testHuggingFaceConnection(targetResultEl, testBase, testKey, testModel) {
  haptic(10);
  const current = getHuggingFaceInputValues();
  const base = (testBase !== undefined && testBase !== null ? testBase : current.base).trim();
  const key = (testKey !== undefined && testKey !== null ? testKey : current.key).trim();
  const model = (testModel !== undefined && testModel !== null ? testModel : current.model).trim();

  if (!key) {
    if (targetResultEl) {
      targetResultEl.className = 'api-test-result fail';
      targetResultEl.textContent = '❌ Please enter an Hugging Face API Key first.';
      targetResultEl.classList.remove('hidden');
    }
    showToast('Enter Hugging Face API Key first');
    return;
  }

  if (targetResultEl) {
    targetResultEl.className = 'api-test-result';
    targetResultEl.textContent = `⏳ Testing connection to Hugging Face (${model})...`;
    targetResultEl.classList.remove('hidden');
  }

  let endpoint = base.replace(/\/+$/, '');
  if (!endpoint.endsWith('/chat/completions')) {
    endpoint = endpoint + '/chat/completions';
  }

  const startTime = Date.now();
  try {
    const res = await postChatCompletion(endpoint, {
      model: model,
      messages: [{ role: 'user', content: 'Ping' }],
      max_tokens: 3
    }, key, AI_TEST_TIMEOUT_MS);

    const elapsed = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let raw = '';
      try {
        const j = JSON.parse(errText);
        raw = (j.error && j.error.message) || '';
      } catch (_) {}
      if (!raw) raw = errText.slice(0, 120);
      throw new Error(friendlyGatewayError(res.status, raw));
    }

    if (targetResultEl) {
      targetResultEl.className = 'api-test-result success';
      targetResultEl.textContent = `✅ Success! Authenticated with Hugging Face (${model}). Latency: ${elapsed}ms.`;
      targetResultEl.classList.remove('hidden');
    }
    // Auto-save the verified working key!
    const saved = saveHuggingFaceConfig(base, key, model, false);
    showToast(saved ? `✅ Hugging Face connected (${elapsed}ms) & saved` : `✅ Connected (${elapsed}ms) — ⚠️ storage blocked, token kept this session`);
  } catch (err) {
    if (targetResultEl) {
      targetResultEl.className = 'api-test-result fail';
      targetResultEl.textContent = `❌ ${err.message}`;
      targetResultEl.classList.remove('hidden');
    }
    showToast(`❌ Connection failed: ${err.message}`);
  }
}

function initAiAgent() {
  // Populate inputs from saved state & browser storage
  syncHuggingFaceInputs();
  if (dom.aiPromptInput && state.aiAgent.customPrompt) {
    dom.aiPromptInput.value = state.aiAgent.customPrompt;
  }

  // Real-time auto-saving & input synchronization on typing or pasting
  const setupKeyInput = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const onKeyInput = () => {
      const val = el.value.trim();
      state.aiAgent.apiKey = val;
      const otherId = id === 'ai-key-input' ? 'huggingface-modal-key-input' : 'ai-key-input';
      const other = document.getElementById(otherId);
      if (other && other.value !== el.value) {
        other.value = el.value;
      }
      try {
        if (val) {
          localStorage.setItem('cc_huggingface_key', val);
        } else {
          localStorage.removeItem('cc_huggingface_key');
        }
      } catch (_) {}
      updateGatewayStatusBadge();
    };

    el.addEventListener('input', onKeyInput);
    el.addEventListener('change', () => {
      onKeyInput();
      if (el.value.trim()) {
        showToast('🔒 Hugging Face key stored in browser');
      }
    });
    el.addEventListener('paste', () => {
      setTimeout(onKeyInput, 10);
    });
  };
  setupKeyInput('ai-key-input');
  setupKeyInput('huggingface-modal-key-input');

  // Base URL auto-sync
  const setupBaseInput = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const onBaseInput = () => {
      const val = el.value.trim() || 'https://router.huggingface.co/v1';
      state.aiAgent.gatewayUrl = val;
      const otherId = id === 'ai-gateway-base-input' ? 'huggingface-modal-base-input' : 'ai-gateway-base-input';
      const other = document.getElementById(otherId);
      if (other && other.value !== el.value) {
        other.value = el.value;
      }
      try { localStorage.setItem('cc_huggingface_base', val); } catch (_) {}
    };
    el.addEventListener('input', onBaseInput);
    el.addEventListener('change', onBaseInput);
  };
  setupBaseInput('ai-gateway-base-input');
  setupBaseInput('huggingface-modal-base-input');

  // Model input auto-sync
  const setupModelInput = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const onModelInput = () => {
      const val = el.value.trim() || 'openai/gpt-oss-120b';
      state.aiAgent.model = val;
      const otherId = id === 'ai-model-input' ? 'huggingface-modal-model-input' : 'ai-model-input';
      const other = document.getElementById(otherId);
      if (other && other.value !== el.value) {
        other.value = el.value;
      }
      document.querySelectorAll('.ai-model-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.model === val);
      });
      try { localStorage.setItem('cc_huggingface_model', val); } catch (_) {}
      updateGatewayStatusBadge();
    };
    el.addEventListener('input', onModelInput);
    el.addEventListener('change', onModelInput);
  };
  setupModelInput('ai-model-input');
  setupModelInput('huggingface-modal-model-input');

  // Model chips selection across both panels
  document.querySelectorAll('.ai-model-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      haptic(10);
      const m = chip.dataset.model;
      state.aiAgent.model = m;
      const m1 = document.getElementById('ai-model-input');
      const m2 = document.getElementById('huggingface-modal-model-input');
      if (m1) m1.value = m;
      if (m2) m2.value = m;
      document.querySelectorAll('.ai-model-chip').forEach(c => c.classList.toggle('active', c.dataset.model === m));
      try { localStorage.setItem('cc_huggingface_model', m); } catch (_) {}
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
      try { localStorage.setItem('cc_huggingface_strat', s); } catch (_) {}
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
  if (dom.btnToggleHuggingFaceModalVis && dom.huggingfaceModalKeyInput) {
    dom.btnToggleHuggingFaceModalVis.addEventListener('click', () => {
      const isPass = dom.huggingfaceModalKeyInput.type === 'password';
      dom.huggingfaceModalKeyInput.type = isPass ? 'text' : 'password';
      dom.btnToggleHuggingFaceModalVis.textContent = isPass ? '🔒' : '👁';
    });
  }

  // Unified API Sheet Tab Switching
  if (dom.tabBtnBinance && dom.tabBtnHuggingFace) {
    dom.tabBtnBinance.addEventListener('click', () => {
      haptic(10);
      dom.tabBtnBinance.classList.add('active');
      dom.tabBtnHuggingFace.classList.remove('active');
      if (dom.panelApiBinance) dom.panelApiBinance.classList.remove('hidden');
      if (dom.panelApiHuggingFace) dom.panelApiHuggingFace.classList.add('hidden');
    });

    dom.tabBtnHuggingFace.addEventListener('click', () => {
      haptic(10);
      dom.tabBtnHuggingFace.classList.add('active');
      dom.tabBtnBinance.classList.remove('active');
      if (dom.panelApiHuggingFace) dom.panelApiHuggingFace.classList.remove('hidden');
      if (dom.panelApiBinance) dom.panelApiBinance.classList.add('hidden');
      syncHuggingFaceInputs();
    });
  }

  // Save Hugging Face Config (Unified API Sheet)
  const huggingfaceModalSaveBtn = document.getElementById('btn-huggingface-modal-save') || dom.btnHuggingFaceModalSave;
  if (huggingfaceModalSaveBtn) {
    huggingfaceModalSaveBtn.addEventListener('click', () => {
      saveHuggingFaceConfig();
      closeAllSheets();
    });
  }

  // Disconnect Hugging Face (Unified API Sheet)
  const huggingfaceModalClearBtn = document.getElementById('btn-huggingface-modal-clear') || dom.btnHuggingFaceModalClear;
  if (huggingfaceModalClearBtn) {
    huggingfaceModalClearBtn.addEventListener('click', clearHuggingFaceConfig);
  }

  // Test Hugging Face (Unified API Sheet)
  const huggingfaceModalTestBtn = document.getElementById('btn-huggingface-modal-test') || dom.btnHuggingFaceModalTest;
  if (huggingfaceModalTestBtn) {
    huggingfaceModalTestBtn.addEventListener('click', () => {
      const resEl = document.getElementById('huggingface-modal-test-result') || dom.huggingfaceModalTestResult;
      testHuggingFaceConnection(resEl);
    });
  }

  // Save Hugging Face Config (AI Bottom Sheet)
  const saveAiConfigBtn = document.getElementById('btn-save-ai-config') || dom.btnSaveAiConfig;
  if (saveAiConfigBtn) {
    saveAiConfigBtn.addEventListener('click', () => {
      saveHuggingFaceConfig();
    });
  }

  // Disconnect Hugging Face (AI Bottom Sheet)
  const clearAiConfigBtn = document.getElementById('btn-clear-ai-config') || dom.btnClearAiConfig;
  if (clearAiConfigBtn) {
    clearAiConfigBtn.addEventListener('click', clearHuggingFaceConfig);
  }

  // Test Hugging Face (AI Bottom Sheet)
  const testAiConfigBtn = document.getElementById('btn-test-ai-config') || dom.btnTestAiConfig;
  if (testAiConfigBtn) {
    testAiConfigBtn.addEventListener('click', () => {
      const resEl = document.getElementById('ai-sheet-test-result') || dom.aiSheetTestResult;
      testHuggingFaceConnection(resEl);
    });
  }

  // Cancel a running analysis
  if (dom.btnAiCancel) {
    dom.btnAiCancel.addEventListener('click', cancelAiAnalysis);
  }

  // Error card actions: retry with the same request, or open gateway settings
  if (dom.btnAiRetry) {
    dom.btnAiRetry.addEventListener('click', () => {
      hideAiErrorCard();
      runAiTradeAnalysis(state.aiAgent.lastAction || 'auto', state.aiAgent.lastQuery || '');
    });
  }
  if (dom.btnAiErrorSettings) {
    dom.btnAiErrorSettings.addEventListener('click', () => {
      hideAiErrorCard();
      if (dom.aiConfigCard) dom.aiConfigCard.classList.remove('hidden');
      const keyInput = document.getElementById('ai-key-input');
      if (keyInput) {
        try { keyInput.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}
        keyInput.focus();
      }
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
        try { localStorage.setItem('cc_huggingface_prompt', prompt); } catch (_) {}
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
  syncHuggingFaceInputs();
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
window.syncHuggingFaceInputs = syncHuggingFaceInputs;
window.saveHuggingFaceConfig = saveHuggingFaceConfig;
window.clearHuggingFaceConfig = clearHuggingFaceConfig;
window.testHuggingFaceConnection = testHuggingFaceConnection;

// Initialize once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAiAgent);
} else {
  initAiAgent();
}
