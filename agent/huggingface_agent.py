#!/usr/bin/env python3
"""
Autonomous AI Trading Agent using Hugging Face AI Gateway
-------------------------------------------------------
Analyzes Binance USDⓈ-M futures market data and calculates optimal
Long / Short trade positions with Take Profit (TP) and Stop Loss (SL).
Outputs the position parameters and generates a deep-link URL to draw
the position directly on the interactive CryptoChart.

Usage:
    export HUGGINGFACE_API_KEY="your-huggingface-api-key"
    python3 agent/huggingface_agent.py --symbol BTCUSDT --timeframe 5m --direction auto
"""

import os
import sys
import json
import argparse
import urllib.request
import urllib.error
import urllib.parse
import webbrowser

DEFAULT_HUGGINGFACE_BASE = "https://router.huggingface.co/v1"
DEFAULT_MODEL = "openai/gpt-oss-120b"
BINANCE_FAPI_BASE = "https://fapi.binance.com"


def fetch_klines(symbol="BTCUSDC", interval="5m", limit=50):
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


def fetch_24h_ticker(symbol="BTCUSDC"):
    url = f"{BINANCE_FAPI_BASE}/fapi/v1/ticker/24hr?symbol={symbol.upper()}"
    req = urllib.request.Request(url, headers={"User-Agent": "CryptoChart-AIAgent/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))



def call_huggingface(api_key, model, system_prompt, user_prompt, base_url=DEFAULT_HUGGINGFACE_BASE):
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
        raise RuntimeError(f"Hugging Face HTTP {e.code}: {err_msg}")


def main():
    parser = argparse.ArgumentParser(description="Hugging Face Autonomous Crypto AI Agent")
    parser.add_argument("--symbol", default="BTCUSDC", help="Trading symbol (e.g. BTCUSDC, ETHUSDC)")
    parser.add_argument("--timeframe", default="5m", help="Candle interval (e.g. 5m, 15m, 1h)")
    parser.add_argument("--direction", default="auto", choices=["long", "short", "auto"], help="Setup bias")
    parser.add_argument("--strategy", default="scalp", help="Strategy (scalp, breakout, orderblock, pullback)")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="AI model via Hugging Face (e.g. openai/gpt-oss-120b, openai/gpt-oss-20b, Qwen/Qwen3.5-9B, meta-llama/Llama-3.3-70B-Instruct)")
    parser.add_argument("--base-url", default=os.getenv("HUGGINGFACE_BASE_URL", DEFAULT_HUGGINGFACE_BASE), help="Hugging Face gateway base URL")
    parser.add_argument("--chart-url", default="http://localhost:8080/index.html", help="Base URL of CryptoChart web app")
    parser.add_argument("--open", action="store_true", help="Automatically open chart in default web browser")
    args = parser.parse_args()

    api_key = os.getenv("HUGGINGFACE_API_KEY", "").strip()
    if not api_key:
        print("ERROR: HUGGINGFACE_API_KEY environment variable is not set.", file=sys.stderr)
        print("Set it using: export HUGGINGFACE_API_KEY='your-key-here'", file=sys.stderr)
        sys.exit(1)

    print(f"[*] Fetching live Binance market data for {args.symbol} ({args.timeframe})...")
    candles = fetch_klines(args.symbol, args.timeframe, limit=50)
    ticker24h = fetch_24h_ticker(args.symbol)

    cur_price = candles[-1]["close"]
    high24h = float(ticker24h.get("highPrice", 0))
    low24h = float(ticker24h.get("lowPrice", 0))

    print(f"[*] Live Price: ${cur_price:.2f} | 24h High: ${high24h:.2f} | 24h Low: ${low24h:.2f} | Candles: {len(candles)}")
    print(f"[*] Calling Hugging Face AI Gateway ({args.model})...")

    system_prompt = f"""You are an elite cryptocurrency futures technical analyst and algorithmic risk manager.
Your job is to analyze real-time pure raw OHLCV candle data and market structure for {args.symbol} and output an optimal Long or Short position setup with Take Profit (TP) and Stop Loss (SL) without technical indicators.

RULES:
1. For LONG: TP MUST be greater than Entry (TP > Entry). SL MUST be less than Entry (SL < Entry).
2. For SHORT: TP MUST be less than Entry (TP < Entry). SL MUST be greater than Entry (SL > Entry).
3. Risk-to-Reward ratio (R:R) MUST be between 1.0 and 1.6. (Reward / Risk >= 1.0).
4. Stop Loss MUST be placed beyond key structural price levels (recent swing high/low or wick rejections).
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

    prec = 4 if cur_price < 1 else 2
    raw_window = candles[-40:]
    formatted_candles = [
        f"#{i+1} Open:{c['open']:.{prec}f} High:{c['high']:.{prec}f} Low:{c['low']:.{prec}f} Close:{c['close']:.{prec}f} Volume:{c['volume']}"
        for i, c in enumerate(raw_window)
    ]
    raw_candles_str = "\n".join(formatted_candles)

    user_prompt = f"""RAW OHLCV CANDLE DATA FOR {args.symbol} ({args.timeframe} Timeframe):
- Current Price: ${cur_price}
- 24h Range: Low ${low24h} to High ${high24h}
- Direction Requested: {args.direction.upper()}
- Strategy Focus: {args.strategy}
- Total Raw Candles ({len(raw_window)}):
{raw_candles_str}

Generate the JSON trade plan now."""

    raw_resp = call_huggingface(api_key, args.model, system_prompt, user_prompt, args.base_url)

    # Clean response
    cleaned = raw_resp.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").replace("json\n", "", 1).strip()
    
    plan = json.loads(cleaned)

    is_long = plan["signal"].upper() == "LONG"
    entry = float(plan["entryPrice"])
    tp = float(plan["tpPrice"])
    sl = float(plan["slPrice"])
    rr = float(plan.get("riskReward", 1.0))
    conf = plan.get("confidence", 80)
    strat = plan.get("strategy", "Hugging Face AI Setup")
    rationale = plan.get("rationale", "")

    tp_pct = abs((tp - entry) / entry * 100)
    sl_pct = abs((entry - sl) / entry * 100)

    print("\n" + "=" * 55)
    print(f"🤖 HUGGING FACE AI TRADE RECOMMENDATION")
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
