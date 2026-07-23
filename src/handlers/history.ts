import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem } from "../toolkit/index.js";
import { backMenu } from "../lib/ui.js";
import { listTrades } from "../lib/domain.js";
import { historyTable } from "../lib/trading.js";

registerMainMenuItem({ label: "History", data: "history:show", order: 40 });

const composer = new Composer<Ctx>();

function uid(ctx: Ctx): string {
  return String(ctx.from?.id ?? ctx.chat?.id ?? "0");
}

async function showHistory(ctx: Ctx, mode: "reply" | "edit"): Promise<void> {
  const trades = await listTrades(uid(ctx), 10);
  const text = historyTable(trades);
  if (mode === "edit") await ctx.editMessageText(text, { reply_markup: backMenu() });
  else await ctx.reply(text, { reply_markup: backMenu() });
}

composer.command("history", async (ctx) => {
  await showHistory(ctx, "reply");
});

composer.callbackQuery("history:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showHistory(ctx, "edit");
});

export default composer;
