# Binance USDⓈ-M 5m Chart (Android Pro)

A high-performance, mobile-optimized TradingView candlestick charting dashboard for Binance USDⓈ-M Futures, featuring 5m candle close timer, live ticker ribbons, 24h high/low markers, TradingView-style position drawing tool with drag handles, automated risk/reward sizing, and Binance order execution.

---

## 🚀 How to Deploy

This project is built with zero-build static web standards and is 100% ready for instant hosting on **Vercel** or **Netlify**.

### Option A: Deploy to Vercel (Recommended)

#### Method 1: Git Integration
1. Go to [vercel.com/new](https://vercel.com/new).
2. Connect your GitHub account and select **`Raven-z1/cryptochart`**.
3. Vercel automatically detects the configuration from [vercel.json](file:///sdcard/aic/cc/vercel.json):
   - **Framework Preset:** Other
   - **Root Directory:** `./`
   - **Build Command:** *(leave empty)*
   - **Output Directory:** `.`
4. Click **Deploy**. Your site will be live at `https://cryptochart-xxx.vercel.app` with instant global CDN and SSL!

#### Method 2: Vercel CLI
Run from the project directory:
```bash
# Deploy with Vercel CLI
npx vercel --prod
```

---

### Option B: Deploy to Netlify

#### Method 1: Git Integration
1. Go to [Netlify Dashboard](https://app.netlify.com/).
2. Click **Add new site** > **Import an existing project** and select **`Raven-z1/cryptochart`**.
3. Netlify will auto-detect settings from [netlify.toml](file:///sdcard/aic/cc/netlify.toml):
   - **Publish directory:** `.`
   - **Build command:** *(leave empty)*
4. Click **Deploy site**.

#### Method 2: Netlify Drop (Instant Drag & Drop)
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag and drop the project folder into the browser to deploy immediately.

#### Method 3: Netlify CLI
```bash
npx netlify deploy --prod
```

---

## 📁 Project Architecture & Modular File Structure

The project has been separated from a monolithic 7,600-line single file into clean, modular files:

```
├── index.html               # Clean HTML markup & entry point (~930 lines)
├── netlify.toml             # Netlify configuration (SPA redirects, cache & security headers)
├── .gitignore               # Ignored temporary files & OS artifacts
├── README.md                # Project documentation & deployment guide
│
├── css/                     # Modular Stylesheets
│   ├── style.css            # Master stylesheet (@import aggregator)
│   ├── base.css             # CSS variables, layout, header, dock, ribbons, toasts, responsive pro mode
│   ├── chart.css            # Chart container, watermark, touch legend
│   ├── position-tool.css    # TradingView position drawing toolbar, SVG overlay, drag handles & badges
│   └── sheets.css           # Bottom sheets (coins search, timeframe, indicators, order confirm, API modal)
│
└── js/                      # Modular JavaScript Logic
    ├── config.js            # Configuration constants, runtime state, and DOM element cache
    ├── utils.js             # Haptics, audio chime, toasts, price/volume formatters, BB & HA math
    ├── chart.js             # TradingView Lightweight Charts setup, series, and rendering
    ├── ui.js                # Market data fetching, WebSockets, navigation, chevrons, and sheet helpers
    ├── position-tool.js     # Interactive Long/Short position tool, SVG overlay, and drag handlers
    ├── binance-api.js       # Binance Futures REST/WS integration, HMAC SHA-256 crypto, and order placement
    ├── positions-manager.js # Binance open positions list, wallet balance, and market close handler
    └── app.js               # Keyboard shortcuts, event listeners, and application bootstrap (init)
```

---

## 💻 Local Development

You can run the app locally using any static web server:

```bash
# Using Python
python3 -m http.server 8000

# Using Node / npx
npx serve .

# Using Netlify CLI
netlify dev
```

Open `http://localhost:8000` in your browser.
