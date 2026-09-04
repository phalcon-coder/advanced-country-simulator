// ============================================================
// js/state.js — single shared object holding the current
// player's session + country data, so every module script can
// read it without re-fetching. Populated by js/auth.js on load.
// ============================================================

var GameState = {
  userId: null,
  username: null,

  country: {
    id: null,
    name: null,
    flagUrl: null,
    currencyName: null,
    currencySymbol: null,
  },

  // Not real yet — no economy/population system exists server-side
  // yet. Modules should treat these as placeholders until the
  // corresponding backend piece is built (see docs/database.md).
  stats: {
    population: null,
    happinessIndex: null,
    immigrationRate: null,
    balance: null,
    income: null,
    expenditure: null,
  },

  isReady: false,
};

// Simple pub/sub so UI pieces (right sidebar, popups) can react
// once GameState.country/stats get filled in by auth.js.
var GameStateListeners = [];
function onGameStateReady(fn) {
  if (GameState.isReady) { fn(GameState); return; }
  GameStateListeners.push(fn);
}
function markGameStateReady() {
  GameState.isReady = true;
  GameStateListeners.forEach(fn => fn(GameState));
  GameStateListeners = [];
}

