# Binance USDⓈ-M 5m Chart (Android Pro)

A high-performance, mobile-optimized TradingView candlestick charting dashboard for Binance USDⓈ-M Futures, featuring 5m candle close timer, live ticker ribbons, 24h high/low markers, TradingView-style position drawing tool with drag handles, automated risk/reward sizing, and Binance order execution.

---

## 🚀 How to Deploy on Netlify

This project is built with zero-build static web standards and is 100% ready for instant Netlify hosting.

### Method 1: Git Integration (Recommended)
1. Push this repository to **GitHub**, **GitLab**, or **Bitbucket**.
2. Log in to [Netlify](https://app.netlify.com/).
3. Click **Add new site** > **Import an existing project**.
4. Select your repository.
5. Netlify will auto-detect the configuration from `netlify.toml`:
   - **Publish directory:** `.` (or root)
   - **Build command:** (leave empty)
6. Click **Deploy site**. Any future `git push` will trigger an automated continuous deployment!

### Method 2: Netlify Drop (Instant Drag & Drop)
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag and drop the entire project directory into the browser.
3. Your site is live in seconds with a custom `.netlify.app` URL and free SSL!

### Method 3: Netlify CLI
Run the following in your terminal:
```bash
# Install Netlify CLI globally
npm install -g netlify-cli

# Login and deploy
netlify deploy --prod
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
