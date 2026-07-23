import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { backMenu, tradeActionKeyboard } from "../lib/ui.js";
import { adjustTradeLevels, closeTradeManual } from "../lib/trading.js";

const composer = new Composer<Ctx>();

function uid(ctx: Ctx): string {
  return String(ctx.from?.id ?? ctx.chat?.id ?? "0");
}

composer.callbackQuery(/^trade:close:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const tradeId = ctx.match[1]!;
  const result = await closeTradeManual(uid(ctx), tradeId);
  await ctx.reply(result.message, { reply_markup: backMenu() });
});

composer.callbackQuery(/^trade:widen:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const tradeId = ctx.match[1]!;
  const result = await adjustTradeLevels(uid(ctx), tradeId, "widen");
  if (result.ok) {
    await ctx.reply(result.message, {
      reply_markup: tradeActionKeyboard(tradeId),
    });
  } else {
    await ctx.reply(result.message, { reply_markup: backMenu() });
  }
});

composer.callbackQuery(/^trade:tighten:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const tradeId = ctx.match[1]!;
  const result = await adjustTradeLevels(uid(ctx), tradeId, "tighten");
  if (result.ok) {
    await ctx.reply(result.message, {
      reply_markup: tradeActionKeyboard(tradeId),
    });
  } else {
    await ctx.reply(result.message, { reply_markup: backMenu() });
  }
});

export default composer;
