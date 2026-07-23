import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem } from "../toolkit/index.js";
import { COPY, backMenu } from "../lib/ui.js";
import { getOrCreateUser, setAutotradeEnabled } from "../lib/domain.js";

registerMainMenuItem({
  label: "Pause AutoTrading",
  data: "autotrade:disable",
  order: 20,
});

const composer = new Composer<Ctx>();

function uid(ctx: Ctx): string {
  return String(ctx.from?.id ?? ctx.chat?.id ?? "0");
}

composer.callbackQuery("autotrade:disable", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(uid(ctx));

  if (!user.autotrade_enabled) {
    await ctx.editMessageText(COPY.autotradeAlreadyOff, {
      reply_markup: backMenu(),
    });
    return;
  }

  await setAutotradeEnabled(uid(ctx), false);
  await ctx.editMessageText(COPY.autotradeOff, { reply_markup: backMenu() });
});

export default composer;
