/** Shared keyboards and copy helpers (professional, concise voice). */

import {
  inlineButton,
  inlineKeyboard,
  mainMenuKeyboard,
  type InlineKeyboardMarkup,
} from "../toolkit/index.js";

export function backMenu(): InlineKeyboardMarkup {
  return inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);
}

export function mainMenu(): InlineKeyboardMarkup {
  return mainMenuKeyboard(2);
}

export function tradeActionKeyboard(tradeId: string): InlineKeyboardMarkup {
  return inlineKeyboard([
    [
      inlineButton("Close trade", `trade:close:${tradeId}`),
      inlineButton("Widen SL/TP", `trade:widen:${tradeId}`),
    ],
    [
      inlineButton("Tighten SL/TP", `trade:tighten:${tradeId}`),
      inlineButton("Back to menu", "menu:main"),
    ],
  ]);
}

export const COPY = {
  welcomeNew:
    "Deriv SynthIndex AutoTrader\n\n" +
    "Automated pattern trading on Volatility 50/75 with 1% risk sizing.\n\n" +
    "Trading synthetics is high risk — you can lose your stake. Past patterns do not guarantee future results.\n\n" +
    "Tap Accept terms to continue.",

  welcomeReady:
    "Deriv SynthIndex AutoTrader\n\n" +
    "Tap a button below to manage autotrading, risk, or your account.",

  termsAccepted:
    "Terms accepted. Default risk is 1% per trade, 1 concurrent position.\n\n" +
    "Next: link your Deriv API token so the bot can read balance and place trades.\n\n" +
    "Create a token at app.deriv.com (trade + read scopes), then paste it here.",

  tokenPrompt: "Send your Deriv API token as a message.\n\nTap Cancel to stop.",

  tokenSaved:
    "API token encrypted and stored.\n\n" +
    "You're set — use the menu to start autotrading or review risk settings.",

  tokenInvalid:
    "That doesn't look like a Deriv API token. Paste the token string only (letters and numbers), or tap Cancel.",

  needTerms: "Accept the risk terms first — open /start and tap Accept terms.",

  needToken:
    "Link your Deriv API token first.\n\nOpen /start and finish setup, or tap Link token below.",

  help:
    "Deriv SynthIndex AutoTrader — quick reference\n\n" +
    "• Start AutoTrading — monitor Volatility indices and open trades on patterns\n" +
    "• Pause AutoTrading — stop new entries (open trades stay open)\n" +
    "• Balance — account balance and risk caps\n" +
    "• History — last 10 trades and P&L\n" +
    "• Risk settings — max risk % and concurrent trades\n" +
    "• Scan markets — check patterns now\n\n" +
    "Slash commands: /start menu · /help · /balance · /history\n\n" +
    "You always control activation. Manual close/adjust is available on each open trade.",

  autotradeOn:
    "AutoTrading is on.\n\n" +
    "I'll watch your instruments for head-and-shoulders and related patterns, size stakes from your risk profile, and notify you on every fill.\n\n" +
    "Tap Scan markets to run a check now.",

  autotradeAlreadyOn: "AutoTrading is already on. Tap Scan markets to check for signals.",

  autotradeOff:
    "AutoTrading paused. Open positions stay open — use History to manage them.\n\n" +
    "Tap Start AutoTrading when you want new entries again.",

  autotradeAlreadyOff: "AutoTrading is already paused.",

  cancelled: "Cancelled. Tap /start for the menu.",

  ownerDenied: "Owner settings are only available to the bot owner.",
} as const;
