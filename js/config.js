/**
 * Binance USDⓈ-M 5m Chart - Configuration & State
 */

var CONFIG = {
  restBase: 'https://fapi.binance.com',
  wsBase: 'wss://fstream.binance.com/ws',
  defaultSymbol: 'BTCUSDT',
  defaultInterval: '5m',
  candleLimit: 500,
  defaultVisibleCandles: 100,
  defaultWatchlist: [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
    'DOGEUSDT', '1000PEPEUSDT', 'SUIUSDT', 'AVAXUSDT', 'LINKUSDT', 'NEARUSDT', 'ADAUSDT'
  ],
};

var state = {
  symbol: CONFIG.defaultSymbol,
  interval: CONFIG.defaultInterval,
  isHeikinAshi: false,
  activeCategory: (function () {
    try {
      const s = localStorage.getItem('cc_active_category');
      if (['gainers', 'volume', 'losers', 'watchlist'].includes(s)) return s;
    } catch (_) {}
    return 'gainers';
  })(),
  chartStyle: (function () {
    try {
      const s = localStorage.getItem('cc_chart_style');
      if (['candles', 'heikin', 'line'].includes(s)) return s;
    } catch (_) {}
    return 'candles';
  })(),
  watchlist: (function () {
    try {
      const w = JSON.parse(localStorage.getItem('cc_watchlist'));
      if (Array.isArray(w) && w.length > 0) return w;
    } catch (_) {}
    return [...CONFIG.defaultWatchlist];
  })(),
  indicators: {
    bb: false,
    volume: true,
    highLowLines: (function () {
      try {
        const v = localStorage.getItem('cc_ind_highlow');
        if (v !== null) return v === '1';
      } catch (_) {}
      return true;
    })(),
  },
  distDisplayMode: (function () {
    try {
      const m = localStorage.getItem('cc_dist_mode');
      if (['both', 'percent', 'price'].includes(m)) return m;
    } catch (_) {}
    return 'both';
  })(),
  high24h: 0,
  low24h: 0,
  alerts: {
    vibrate: true,
    sound: true,
    urgency: true,
  },
  rawCandles: [],
  symbolsMeta: {},
  allTickers: [],
  currentPrice: 0,
  currentCandleCloseTime: 0,
  lastAlertTriggeredTime: 0,
  ws: null,
  wsReconnectTimer: null,
  candleTimerInterval: null,
  statRefreshInterval: null,
  binanceApi: {
    key: (function () { try { return localStorage.getItem('cc_binance_key') || ''; } catch (_) { return ''; } })(),
    secret: (function () { try { return localStorage.getItem('cc_binance_secret') || ''; } catch (_) { return ''; } })(),
    env: (function () { try { return localStorage.getItem('cc_binance_env') || 'live'; } catch (_) { return 'live'; } })(),
    proxy: (function () { try { return localStorage.getItem('cc_binance_proxy') || ''; } catch (_) { return ''; } })(),
    serverOffset: 0,
    availBalance: null,
    totalBalance: null,
  },
  orderForm: {
    type: 'MARKET',
    leverage: 10,
    riskPct: 5,
  },
};

// Synchronize Heikin-Ashi initial state with chartStyle
if (state.chartStyle === 'heikin') {
  state.isHeikinAshi = true;
}

// DOM Cache
var dom = {
  chartContainer: document.getElementById('chart-container'),
  headSymbol: document.getElementById('head-symbol'),
  headCatTag: document.getElementById('head-cat-tag'),
  openMarketBtn: document.getElementById('open-market-btn'),
  prevChartBtn: document.getElementById('prev-chart-btn'),
  nextChartBtn: document.getElementById('next-chart-btn'),
  chartStyleBtn: document.getElementById('chart-style-btn'),
  statsRibbon: document.querySelector('.stats-ribbon'),
  appHeader: document.querySelector('.app-header'),
  candleTimer: document.getElementById('candle-timer'),
  openAlertBtn: document.getElementById('open-alert-btn'),
  livePrice: document.getElementById('live-price'),
  priceChange: document.getElementById('price-change'),
  statHigh: document.getElementById('stat-high'),
  statHighDist: document.getElementById('stat-high-dist'),
  statLow: document.getElementById('stat-low'),
  statLowDist: document.getElementById('stat-low-dist'),
  statTurnover: document.getElementById('stat-turnover'),
  statRangePos: document.getElementById('stat-range-pos'),
  statRangeDesc: document.getElementById('stat-range-desc'),
  rangeHud: document.getElementById('range-hud'),
  hudLowDist: document.getElementById('hud-low-dist'),
  hudHighDist: document.getElementById('hud-high-dist'),
  hudPosBadge: document.getElementById('hud-pos-badge'),
  hudFill: document.getElementById('hud-fill'),
  hudPin: document.getElementById('hud-pin'),
  col24hHigh: document.getElementById('col-24h-high'),
  col24hLow: document.getElementById('col-24h-low'),
  col24hRange: document.getElementById('col-24h-range'),
  wsStatusText: document.getElementById('ws-status-text'),
  chartLoader: document.getElementById('chart-loader'),
  chartWatermark: document.getElementById('chart-watermark'),
  androidToast: document.getElementById('android-toast'),
  rotateBtn: document.getElementById('rotate-btn'),
  fitBtn: document.getElementById('fit-btn'),
  // Dock buttons
  dockMarketBtn: document.getElementById('dock-market-btn'),
  dockTfBtn: document.getElementById('dock-tf-btn'),
  dockTfBadge: document.getElementById('dock-tf-badge'),
  dockTfLabel: document.getElementById('dock-tf-label'),
  dockIndicatorsBtn: document.getElementById('dock-indicators-btn'),
  dockAlertBtn: document.getElementById('dock-alert-btn'),
  alertDockText: document.getElementById('alert-dock-text'),
  dockPositionsBtn: document.getElementById('dock-positions-btn'),
  dockPosBadge: document.getElementById('dock-pos-badge'),
  // Sheets
  tfSheetBackdrop: document.getElementById('tf-sheet-backdrop'),
  tfSheetClose: document.getElementById('tf-sheet-close'),
  tfSheetCurrentBadge: document.getElementById('tf-sheet-current-badge'),
  tfSheetBody: document.getElementById('tf-sheet-body'),
  marketBackdrop: document.getElementById('market-sheet-backdrop'),
  marketCloseBtn: document.getElementById('market-sheet-close'),
  coinSearchInput: document.getElementById('coin-search-input'),
  pairInputForm: document.getElementById('pair-input-form'),
  pairGoBtn: document.getElementById('pair-go-btn'),
  sheetCoinList: document.getElementById('sheet-coin-list'),
  indBackdrop: document.getElementById('ind-sheet-backdrop'),
  indCloseBtn: document.getElementById('ind-sheet-close'),
  alertBackdrop: document.getElementById('alert-sheet-backdrop'),
  alertCloseBtn: document.getElementById('alert-sheet-close'),
  // Legend
  legOpen: document.getElementById('leg-open'),
  legHigh: document.getElementById('leg-high'),
  legLow: document.getElementById('leg-low'),
  legClose: document.getElementById('leg-close'),
  legChange: document.getElementById('leg-change'),
  legVol: document.getElementById('leg-vol'),
  // Toggles
  togHighLow: document.getElementById('tog-high-low'),
  togBb: document.getElementById('tog-bb'),
  togVol: document.getElementById('tog-vol'),
  togHa: document.getElementById('tog-ha'),
  togVibrate: document.getElementById('tog-vibrate'),
  togSound: document.getElementById('tog-sound'),
  togUrgency: document.getElementById('tog-urgency'),
  // Position Tool Toolbar & Controls
  chartPosToolbar: document.getElementById('chart-pos-toolbar'),
  btnPosLong: document.getElementById('btn-pos-long'),
  btnPosShort: document.getElementById('btn-pos-short'),
  posHudActive: document.getElementById('pos-hud-active'),
  posHudTag: document.getElementById('pos-hud-tag'),
  posHudRr: document.getElementById('pos-hud-rr'),
  btnPosEdit: document.getElementById('btn-pos-edit'),
  btnPosClose: document.getElementById('btn-pos-close'),
  // Position SVG Overlay & Shapes
  tvPositionOverlay: document.getElementById('tv-position-overlay'),
  paneClipRect: document.getElementById('pane-clip-rect'),
  tvPosGroup: document.getElementById('tv-pos-group'),
  tvTargetBox: document.getElementById('tv-target-box'),
  tvStopBox: document.getElementById('tv-stop-box'),
  tvTpLine: document.getElementById('tv-tp-line'),
  tvEntryLine: document.getElementById('tv-entry-line'),
  tvSlLine: document.getElementById('tv-sl-line'),
  tvLeftLine: document.getElementById('tv-left-line'),
  tvRightLine: document.getElementById('tv-right-line'),
  tvTpHit: document.getElementById('tv-tp-hit'),
  tvSlHit: document.getElementById('tv-sl-hit'),
  tvEntryHit: document.getElementById('tv-entry-hit'),
  tvRightHit: document.getElementById('tv-right-hit'),
  tvLeftHit: document.getElementById('tv-left-hit'),
  // Drag Handles
  tvHandleTpGroup: document.getElementById('tv-handle-tp-group'),
  tvHandleSlGroup: document.getElementById('tv-handle-sl-group'),
  tvHandleEntryGroup: document.getElementById('tv-handle-entry-group'),
  tvHandleWidthGroup: document.getElementById('tv-handle-width-group'),
  // Cards & Text Badges
  // Badges & Labels
  tvInfoTarget: document.getElementById('tv-info-target'),
  tvBgTarget: document.getElementById('tv-bg-target'),
  tvTxtTargetStats: document.getElementById('tv-txt-target-stats'),
  tvInfoStop: document.getElementById('tv-info-stop'),
  tvBgStop: document.getElementById('tv-bg-stop'),
  tvTxtStopStats: document.getElementById('tv-txt-stop-stats'),
  tvInfoRr: document.getElementById('tv-info-rr'),
  tvBgRr: document.getElementById('tv-bg-rr'),
  tvTxtRrLabel: document.getElementById('tv-txt-rr-label'),
  tvInfoEntry: document.getElementById('tv-info-entry'),
  tvBgEntry: document.getElementById('tv-bg-entry'),
  tvTxtEntryLabel: document.getElementById('tv-txt-entry-label'),
  // Position Settings Sheet
  posBackdrop: document.getElementById('pos-sheet-backdrop'),
  posSheetClose: document.getElementById('pos-sheet-close'),
  posSheetTitle: document.getElementById('pos-sheet-title'),
  posPillLong: document.getElementById('pos-pill-long'),
  posPillShort: document.getElementById('pos-pill-short'),
  posInEntry: document.getElementById('pos-in-entry'),
  posInTp: document.getElementById('pos-in-tp'),
  posInTpPct: document.getElementById('pos-in-tppct'),
  posInSl: document.getElementById('pos-in-sl'),
  posInSlPct: document.getElementById('pos-in-slpct'),
  posSheetRr: document.getElementById('pos-sheet-rr'),
  posSheetDelete: document.getElementById('pos-sheet-delete'),
  posSheetApply: document.getElementById('pos-sheet-apply'),
  posSheetCancel: document.getElementById('pos-sheet-cancel'),
  btnPosExchange: document.getElementById('btn-pos-exchange'),
  posExchangeEnvTag: document.getElementById('pos-exchange-env-tag'),
  btnPosApiCfg: document.getElementById('btn-pos-api-cfg'),
  btnPosHudTrade: document.getElementById('btn-pos-hud-trade'),
  btnApiSettings: document.getElementById('btn-api-settings'),

  // Order Confirmation Sheet
  posConfirmBackdrop: document.getElementById('pos-confirm-backdrop'),
  posConfirmClose: document.getElementById('pos-confirm-close'),
  posConfirmSheet: document.getElementById('pos-confirm-sheet'),
  posConfirmBody: document.getElementById('pos-confirm-body'),
  confirmEnvBadge: document.getElementById('confirm-env-badge'),
  confirmEnvText: document.getElementById('confirm-env-text'),
  confirmMarginModeTag: document.getElementById('confirm-margin-mode-tag'),
  confirmTypeTag: document.getElementById('confirm-type-tag'),
  confirmSym: document.getElementById('confirm-sym'),
  confirmCurrPrice: document.getElementById('confirm-curr-price'),
  btnOrderTypeMarket: document.getElementById('btn-ordertype-market'),
  btnOrderTypeLimit: document.getElementById('btn-ordertype-limit'),
  confirmLimitPriceGroup: document.getElementById('confirm-limit-price-group'),
  confirmLimitPrice: document.getElementById('confirm-limit-price'),
  confirmRiskSubtext: document.getElementById('confirm-risk-subtext'),
  confirmAvailBal: document.getElementById('confirm-avail-bal'),
  confirmSizeUsdt: document.getElementById('confirm-size-usdt'),
  confirmSizeEquiv: document.getElementById('confirm-size-equiv'),
  confirmMarginCostLbl: document.getElementById('confirm-margin-cost-lbl'),
  confirmSlDistLbl: document.getElementById('confirm-sl-dist-lbl'),
  confirmLeverageVal: document.getElementById('confirm-leverage-val'),
  confirmPlanEntry: document.getElementById('confirm-plan-entry'),
  confirmPlanTp: document.getElementById('confirm-plan-tp'),
  confirmPlanSl: document.getElementById('confirm-plan-sl'),
  confirmPlanRr: document.getElementById('confirm-plan-rr'),
  confirmPlanNotional: document.getElementById('confirm-plan-notional'),
  confirmPlanMargin: document.getElementById('confirm-plan-margin'),
  confirmEstProfit: document.getElementById('confirm-est-profit'),
  confirmEstLoss: document.getElementById('confirm-est-loss'),
  confirmErrorBanner: document.getElementById('confirm-error-banner'),
  btnConfirmCancel: document.getElementById('btn-confirm-cancel'),
  btnConfirmSubmit: document.getElementById('btn-confirm-submit'),
  submitSpinner: document.getElementById('submit-spinner'),
  btnConfirmSubmitText: document.getElementById('btn-confirm-submit-text'),

  // Binance API Modal
  apiSheetBackdrop: document.getElementById('api-sheet-backdrop'),
  apiSheetClose: document.getElementById('api-sheet-close'),
  btnEnvLive: document.getElementById('btn-env-live'),
  btnEnvTestnet: document.getElementById('btn-env-testnet'),
  apiEnvHint: document.getElementById('api-env-hint'),
  apiKeyInput: document.getElementById('api-key-input'),
  apiSecretInput: document.getElementById('api-secret-input'),
  btnToggleKeyVis: document.getElementById('btn-toggle-key-vis'),
  btnToggleSecVis: document.getElementById('btn-toggle-sec-vis'),
  apiProxyInput: document.getElementById('api-proxy-input'),
  apiTestResult: document.getElementById('api-test-result'),
  btnApiClear: document.getElementById('btn-api-clear'),
  btnApiTest: document.getElementById('btn-api-test'),
  btnApiSave: document.getElementById('btn-api-save'),

  // Binance Open Positions & Account Balance Sheet
  posListBackdrop: document.getElementById('pos-list-backdrop'),
  posListSheet: document.getElementById('pos-list-sheet'),
  posListClose: document.getElementById('pos-list-close'),
  posListEnvTag: document.getElementById('pos-list-env-tag'),
  btnRefreshPositions: document.getElementById('btn-refresh-positions'),
  balTotalWallet: document.getElementById('bal-total-wallet'),
  balUnrealizedPnl: document.getElementById('bal-unrealized-pnl'),
  balMarginTotal: document.getElementById('bal-margin-total'),
  balAvailable: document.getElementById('bal-available'),
  posSecCount: document.getElementById('pos-sec-count'),
  openPositionsContainer: document.getElementById('open-positions-container'),
};


// Expose configuration and state globally
window.CONFIG = CONFIG;
window.state = state;
window.dom = dom;
