import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { COPY } from "../lib/ui.js";

const composer = new Composer<Ctx>();

const backToMenu = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);

composer.command("help", async (ctx) => {
  await ctx.reply(COPY.help);
});

composer.callbackQuery("menu:help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(COPY.help, { reply_markup: backToMenu });
});

export default composer;
