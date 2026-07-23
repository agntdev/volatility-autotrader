import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { COPY, backMenu, tradeActionKeyboard } from "../lib/ui.js";
import {
  getOrCreateUser,
  getOwnerSettings,
  setAutotradeEnabled,
} from "../lib/domain.js";
import { instrumentLabel } from "../lib/types.js";
import { scanAndMaybeTrade } from "../lib/trading.js";

registerMainMenuItem({
  label: "Start AutoTrading",
  data: "autotrade:enable",
  order: 10,
});
registerMainMenuItem({
  label: "Scan markets",
  data: "autotrade:scan",
  order: 15,
});

const composer = new Composer<Ctx>();

function uid(ctx: Ctx): string {
  return String(ctx.from?.id ?? ctx.chat?.id ?? "0");
}

composer.callbackQuery("autotrade:enable", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(uid(ctx));

  if (!user.accepted_terms) {
    await ctx.editMessageText(COPY.needTerms, { reply_markup: backMenu() });
    return;
  }
  if (!user.encrypted_api_token) {
    await ctx.editMessageText(COPY.needToken, {
      reply_markup: inlineKeyboard([
        [inlineButton("Link token", "onboard:token")],
        [inlineButton("Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  if (user.autotrade_enabled) {
    await ctx.editMessageText(COPY.autotradeAlreadyOn, {
      reply_markup: inlineKeyboard([
        [inlineButton("Scan markets", "autotrade:scan")],
        [inlineButton("Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  const owner = await getOwnerSettings();
  // Clamp instruments to owner allow-list
  const allowed = new Set(owner.instruments);
  user.instruments = user.instruments.filter((s) => allowed.has(s));
  if (user.instruments.length === 0) user.instruments = [...owner.instruments];

  await setAutotradeEnabled(uid(ctx), true);

  const instruments = user.instruments.map(instrumentLabel).join(", ");
  const text =
    COPY.autotradeOn +
    `\n\nInstruments: ${instruments}\nTimeframes: 1m, 5m\nConfidence ≥ ${Math.round(owner.confidence_threshold * 100)}%`;

  await ctx.editMessageText(text, {
    reply_markup: inlineKeyboard([
      [inlineButton("Scan markets", "autotrade:scan")],
      [inlineButton("Pause AutoTrading", "autotrade:disable")],
      [inlineButton("Back to menu", "menu:main")],
    ]),
  });
});

composer.callbackQuery("autotrade:scan", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Scanning…" });
  const user = await getOrCreateUser(uid(ctx));

  if (!user.accepted_terms) {
    await ctx.reply(COPY.needTerms);
    return;
  }
  if (!user.encrypted_api_token) {
    await ctx.reply(COPY.needToken, {
      reply_markup: inlineKeyboard([[inlineButton("Link token", "onboard:token")]]),
    });
    return;
  }

  await ctx.reply("Scanning markets for patterns…");
  try {
    await ctx.api.sendChatAction(ctx.chat!.id, "typing");
  } catch {
    /* non-fatal */
  }
  const result = await scanAndMaybeTrade(uid(ctx), {
    execute: user.autotrade_enabled,
  });

  if (result.signals.length > 0 && result.trades.length === 0) {
    const lines = result.signals.map(
      (s) =>
        `• ${instrumentLabel(s.instrument)} ${s.direction.toUpperCase()} — ${s.pattern_type.replace(/_/g, " ")} (${Math.round(s.confidence_score * 100)}%)`,
    );
    const note = user.autotrade_enabled
      ? "Signals found; no new trades opened (risk limits or errors)."
      : "Signals found. Enable AutoTrading to open positions automatically.";
    await ctx.reply(`${note}\n\n${lines.join("\n")}`, { reply_markup: backMenu() });
  }

  for (const trade of result.trades) {
    const msg = result.messages.find((m) => m.includes(instrumentLabel(trade.instrument)));
    await ctx.reply(msg ?? `Trade opened on ${instrumentLabel(trade.instrument)}.`, {
      reply_markup: tradeActionKeyboard(trade.id),
    });
  }

  for (const err of result.errors) {
    await ctx.reply(err);
  }

  for (const m of result.messages) {
    // Skip messages already sent as trade confirmations
    if (result.trades.some((t) => m.includes(instrumentLabel(t.instrument)) && m.startsWith("Trade opened"))) {
      continue;
    }
    await ctx.reply(m, { reply_markup: backMenu() });
  }

  if (
    result.signals.length === 0 &&
    result.trades.length === 0 &&
    result.errors.length === 0 &&
    result.messages.length === 0
  ) {
    await ctx.reply("No patterns above your confidence threshold right now.", {
      reply_markup: backMenu(),
    });
  }
});

export default composer;
