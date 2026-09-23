#!/usr/bin/env python3
"""
Autonomous AI Trading Agent using OpenRouter AI Gateway
-------------------------------------------------------
Analyzes Binance USDⓈ-M futures market data and calculates optimal
Long / Short trade positions with Take Profit (TP) and Stop Loss (SL).
Outputs the position parameters and generates a deep-link URL to draw
the position directly on the interactive CryptoChart.

Usage:
    export OPENROUTER_API_KEY="your-openrouter-api-key"
    python3 agent/openrouter_agent.py --symbol BTCUSDT --timeframe 5m --direction auto
"""

import os
import sys
import json
import argparse
import urllib.request
import urllib.error
import urllib.parse
import webbrowser

DEFAULT_OPENROUTER_BASE = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "openai/gpt-4o-mini"
BINANCE_FAPI_BASE = "https://fapi.binance.com"


def fetch_klines(symbol="BTCUSDT", interval="5m", limit=50):
    url = f"{BINANCE_FAPI_BASE}/fapi/v1/klines?symbol={symbol.upper()}&interval={interval}&limit={limit}"
    req = urllib.request.Request(url, headers={"User-Agent": "CryptoChart-AIAgent/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    
    candles = []
    for k in data:
        candles.append({
            "open_time": k[0],
            "open": float(k[1]),
            "high": float(k[2]),
            "low": float(k[3]),
            "close": float(k[4]),
            "volume": float(k[5]),
            "close_time": k[6]
        })
    return candles


def fetch_24h_ticker(symbol="BTCUSDT"):
    url = f"{BINANCE_FAPI_BASE}/fapi/v1/ticker/24hr?symbol={symbol.upper()}"
    req = urllib.request.Request(url, headers={"User-Agent": "CryptoChart-AIAgent/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def calculate_atr(candles, period=14):
    if len(candles) < period + 1:
        return None
    trs = []
    for i in range(1, len(candles)):
        h, l = candles[i]["high"], candles[i]["low"]
        pc = candles[i - 1]["close"]
        tr = max(h - l, abs(h - pc), abs(l - pc))
        trs.append(tr)
    atr = sum(trs[:period]) / period
    for i in range(period, len(trs)):
        atr = (atr * (period - 1) + trs[i]) / period
    return atr


def calculate_rsi(closes, period=14):
    if len(closes) < period + 1:
        return None
    gains, losses = 0.0, 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        if d >= 0:
            gains += d
        else:
            losses += abs(d)
    avg_gain = gains / period
    avg_loss = losses / period
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        if d >= 0:
            avg_gain = (avg_gain * (period - 1) + d) / period
            avg_loss = (avg_loss * (period - 1)) / period
        else:
            avg_gain = (avg_gain * (period - 1)) / period
            avg_loss = (avg_loss * (period - 1) + abs(d)) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def call_openrouter(api_key, model, system_prompt, user_prompt, base_url=DEFAULT_OPENROUTER_BASE):
    endpoint = base_url.rstrip("/")
    if not endpoint.endswith("/chat/completions"):
        endpoint += "/chat/completions"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"}
    }

    req_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=req_data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "CryptoChart-AIAgent/1.0"
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8")
        # Retry without response_format if model rejected it
        if "response_format" in err_msg or "json_object" in err_msg:
            del payload["response_format"]
            req_data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                endpoint,
                data=req_data,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                    "User-Agent": "CryptoChart-AIAgent/1.0"
                }
            )
            with urllib.request.urlopen(req, timeout=30) as resp2:
                data2 = json.loads(resp2.read().decode("utf-8"))
                return data2["choices"][0]["message"]["content"]
        raise RuntimeError(f"OpenRouter HTTP {e.code}: {err_msg}")


def main():
    parser = argparse.ArgumentParser(description="OpenRouter Autonomous Crypto AI Agent")
    parser.add_argument("--symbol", default="BTCUSDT", help="Trading symbol (e.g. BTCUSDT, ETHUSDT)")
    parser.add_argument("--timeframe", default="5m", help="Candle interval (e.g. 5m, 15m, 1h)")
    parser.add_argument("--direction", default="auto", choices=["long", "short", "auto"], help="Setup bias")
    parser.add_argument("--strategy", default="scalp", help="Strategy (scalp, breakout, orderblock, pullback)")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="AI model via OpenRouter (e.g. openai/gpt-4o-mini, openai/gpt-4o, anthropic/claude-3.5-sonnet, deepseek/deepseek-chat)")
    parser.add_argument("--base-url", default=os.getenv("OPENROUTER_BASE_URL", DEFAULT_OPENROUTER_BASE), help="OpenRouter gateway base URL")
    parser.add_argument("--chart-url", default="http://localhost:8080/index.html", help="Base URL of CryptoChart web app")
    parser.add_argument("--open", action="store_true", help="Automatically open chart in default web browser")
    args = parser.parse_args()

    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        print("ERROR: OPENROUTER_API_KEY environment variable is not set.", file=sys.stderr)
        print("Set it using: export OPENROUTER_API_KEY='your-key-here'", file=sys.stderr)
        sys.exit(1)

    print(f"[*] Fetching live Binance market data for {args.symbol} ({args.timeframe})...")
    candles = fetch_klines(args.symbol, args.timeframe, limit=50)
    ticker24h = fetch_24h_ticker(args.symbol)

    cur_price = candles[-1]["close"]
    closes = [c["close"] for c in candles]
    atr = calculate_atr(candles, 14)
    rsi = calculate_rsi(closes, 14)

    high24h = float(ticker24h.get("highPrice", 0))
    low24h = float(ticker24h.get("lowPrice", 0))

    print(f"[*] Live Price: ${cur_price:.2f} | ATR: ${atr:.2f} | RSI: {rsi:.1f} | 24h High: ${high24h:.2f} | 24h Low: ${low24h:.2f}")
    print(f"[*] Calling OpenRouter AI Gateway ({args.model})...")

    system_prompt = f"""You are an elite cryptocurrency futures technical analyst and algorithmic risk manager.
Your job is to analyze real-time market data for {args.symbol} and output an optimal Long or Short position setup with Take Profit (TP) and Stop Loss (SL).

RULES:
1. For LONG: TP MUST be greater than Entry (TP > Entry). SL MUST be less than Entry (SL < Entry).
2. For SHORT: TP MUST be less than Entry (TP < Entry). SL MUST be greater than Entry (SL > Entry).
3. Risk-to-Reward ratio (R:R) MUST be between 1.5 and 3.5.
4. Stop Loss MUST be placed beyond key structural levels (or 1.5x-2.5x ATR).
5. Output strictly JSON matching:
{{
  "signal": "LONG" | "SHORT",
  "entryPrice": <float>,
  "tpPrice": <float>,
  "slPrice": <float>,
  "riskReward": <float>,
  "confidence": <int 50-95>,
  "strategy": "<Strategy Name>",
  "rationale": "<2-3 sentences explaining technical reasons>",
  "invalidation": "<price or level that invalidates trade>"
}}"""

    user_prompt = f"""MARKET CONTEXT FOR {args.symbol} ({args.timeframe}):
- Current Price: ${cur_price}
- ATR(14): ${atr:.2f}
- RSI(14): {rsi:.1f}
- 24h Range: Low ${low24h} to High ${high24h}
- Direction Requested: {args.direction.upper()}
- Strategy Focus: {args.strategy}

Last 10 Closes: {[round(c, 2) for c in closes[-10:]]}

Generate the JSON trade plan now."""

    raw_resp = call_openrouter(api_key, args.model, system_prompt, user_prompt, args.base_url)

    # Clean response
    cleaned = raw_resp.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").replace("json\n", "", 1).strip()
    
    plan = json.loads(cleaned)

    is_long = plan["signal"].upper() == "LONG"
    entry = float(plan["entryPrice"])
    tp = float(plan["tpPrice"])
    sl = float(plan["slPrice"])
    rr = float(plan.get("riskReward", 2.0))
    conf = plan.get("confidence", 80)
    strat = plan.get("strategy", "OpenRouter AI Setup")
    rationale = plan.get("rationale", "")

    tp_pct = abs((tp - entry) / entry * 100)
    sl_pct = abs((entry - sl) / entry * 100)

    print("\n" + "=" * 55)
    print(f"🤖 OPENROUTER AI TRADE RECOMMENDATION")
    print("=" * 55)
    print(f"Direction  : {'🟢 LONG' if is_long else '🔴 SHORT'}")
    print(f"Asset      : {args.symbol} ({args.timeframe})")
    print(f"Entry Price: ${entry:,.2f}")
    print(f"Take Profit: ${tp:,.2f} (+{tp_pct:.2f}%)")
    print(f"Stop Loss  : ${sl:,.2f} (-{sl_pct:.2f}%)")
    print(f"R:R Ratio  : 1:{rr:.2f}")
    print(f"Confidence : {conf}%")
    print(f"Strategy   : {strat}")
    print(f"Rationale  : {rationale}")
    print("=" * 55)

    # Generate Chart Deep Link URL
    query_params = {
        "symbol": args.symbol.upper(),
        "pos": "long" if is_long else "short",
        "entry": str(entry),
        "tp": str(tp),
        "sl": str(sl),
        "note": f"AI:{strat[:20]}"
    }
    deep_link = f"{args.chart_url}?{urllib.parse.urlencode(query_params)}"
    print(f"\n📈 Open & Draw in CryptoChart:\n{deep_link}\n")

    if args.open:
        print("[*] Opening chart in default browser...")
        webbrowser.open(deep_link)


if __name__ == "__main__":
    main()
