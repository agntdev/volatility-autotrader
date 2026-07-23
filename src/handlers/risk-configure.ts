import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { backMenu, COPY } from "../lib/ui.js";
import { getOrCreateUser, getRisk, saveRisk } from "../lib/domain.js";
import type { RiskProfile } from "../lib/types.js";

registerMainMenuItem({
  label: "Risk settings",
  data: "risk:configure",
  order: 50,
});

const composer = new Composer<Ctx>();

function uid(ctx: Ctx): string {
  return String(ctx.from?.id ?? ctx.chat?.id ?? "0");
}

function riskSummary(r: RiskProfile): string {
  return (
    `Risk profile\n\n` +
    `Max risk / trade: ${r.max_risk_percent}%\n` +
    `Max concurrent trades: ${r.max_concurrent_trades}\n` +
    `Take-profit: ${r.tp_multiplier}× stop-loss\n` +
    `Stop-loss fraction of stake: ${Math.round(r.sl_fraction * 100)}%\n\n` +
    `Tap a field to change it.`
  );
}

function riskKeyboard(): ReturnType<typeof inlineKeyboard> {
  return inlineKeyboard([
    [inlineButton("Max risk %", "risk:set:percent")],
    [inlineButton("Max concurrent", "risk:set:concurrent")],
    [inlineButton("TP multiplier", "risk:set:tp")],
    [inlineButton("Back to menu", "menu:main")],
  ]);
}

composer.callbackQuery("risk:configure", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(uid(ctx));
  if (!user.accepted_terms) {
    await ctx.editMessageText(COPY.needTerms, { reply_markup: backMenu() });
    return;
  }
  ctx.session.step = "idle";
  const risk = await getRisk(uid(ctx));
  await ctx.editMessageText(riskSummary(risk), { reply_markup: riskKeyboard() });
});

composer.callbackQuery("risk:set:percent", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "awaiting_risk_percent";
  await ctx.editMessageText(
    "Send max risk per trade as a percent (0.1–5). Example: 1\n\nTap Cancel to stop.",
    {
      reply_markup: inlineKeyboard([[inlineButton("Cancel", "risk:cancel")]]),
    },
  );
});

composer.callbackQuery("risk:set:concurrent", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "awaiting_max_concurrent";
  await ctx.editMessageText(
    "Send max concurrent open trades (1–5). Example: 1\n\nTap Cancel to stop.",
    {
      reply_markup: inlineKeyboard([[inlineButton("Cancel", "risk:cancel")]]),
    },
  );
});

composer.callbackQuery("risk:set:tp", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "awaiting_tp_multiplier";
  await ctx.editMessageText(
    "Send take-profit as a multiple of stop-loss (1–5). Example: 2\n\nTap Cancel to stop.",
    {
      reply_markup: inlineKeyboard([[inlineButton("Cancel", "risk:cancel")]]),
    },
  );
});

composer.callbackQuery("risk:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  const risk = await getRisk(uid(ctx));
  await ctx.editMessageText(riskSummary(risk), { reply_markup: riskKeyboard() });
});

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return next();
  const step = ctx.session.step ?? "idle";
  if (
    step !== "awaiting_risk_percent" &&
    step !== "awaiting_max_concurrent" &&
    step !== "awaiting_tp_multiplier"
  ) {
    return next();
  }

  if (/^cancel$/i.test(text)) {
    ctx.session.step = "idle";
    const risk = await getRisk(uid(ctx));
    await ctx.reply(riskSummary(risk), { reply_markup: riskKeyboard() });
    return;
  }

  const risk = await getRisk(uid(ctx));

  if (step === "awaiting_risk_percent") {
    const n = Number(text.replace("%", ""));
    if (!Number.isFinite(n) || n < 0.1 || n > 5) {
      await ctx.reply("Enter a number from 0.1 to 5.");
      return;
    }
    risk.max_risk_percent = Math.round(n * 100) / 100;
    await saveRisk(uid(ctx), risk);
    ctx.session.step = "idle";
    await ctx.reply(
      `Updated. Max risk is ${risk.max_risk_percent}% per trade.`,
      { reply_markup: riskKeyboard() },
    );
    return;
  }

  if (step === "awaiting_max_concurrent") {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      await ctx.reply("Enter a whole number from 1 to 5.");
      return;
    }
    risk.max_concurrent_trades = n;
    await saveRisk(uid(ctx), risk);
    ctx.session.step = "idle";
    await ctx.reply(
      `Updated. Max concurrent trades: ${risk.max_concurrent_trades}.`,
      { reply_markup: riskKeyboard() },
    );
    return;
  }

  if (step === "awaiting_tp_multiplier") {
    const n = Number(text);
    if (!Number.isFinite(n) || n < 1 || n > 5) {
      await ctx.reply("Enter a number from 1 to 5.");
      return;
    }
    risk.tp_multiplier = Math.round(n * 100) / 100;
    await saveRisk(uid(ctx), risk);
    ctx.session.step = "idle";
    await ctx.reply(
      `Updated. Take-profit is ${risk.tp_multiplier}× stop-loss.`,
      { reply_markup: riskKeyboard() },
    );
  }
});

export default composer;
