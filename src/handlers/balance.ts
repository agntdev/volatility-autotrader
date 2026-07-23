import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { COPY, backMenu } from "../lib/ui.js";
import { getOrCreateUser, getOwnerSettings, getRisk, saveUser } from "../lib/domain.js";
import { decryptToken } from "../lib/crypto.js";
import { derivErrorMessage, fetchBalance } from "../lib/deriv.js";
import { fmt } from "../lib/trading.js";

registerMainMenuItem({ label: "Balance", data: "balance:show", order: 30 });

const composer = new Composer<Ctx>();

function uid(ctx: Ctx): string {
  return String(ctx.from?.id ?? ctx.chat?.id ?? "0");
}

async function showBalance(ctx: Ctx, mode: "reply" | "edit"): Promise<void> {
  const user = await getOrCreateUser(uid(ctx));
  if (!user.accepted_terms) {
    const text = COPY.needTerms;
    if (mode === "edit") await ctx.editMessageText(text, { reply_markup: backMenu() });
    else await ctx.reply(text);
    return;
  }
  if (!user.encrypted_api_token) {
    const markup = inlineKeyboard([
      [inlineButton("Link token", "onboard:token")],
      [inlineButton("Back to menu", "menu:main")],
    ]);
    if (mode === "edit") await ctx.editMessageText(COPY.needToken, { reply_markup: markup });
    else await ctx.reply(COPY.needToken, { reply_markup: markup });
    return;
  }

  const risk = await getRisk(uid(ctx));
  const owner = await getOwnerSettings();

  let token: string;
  try {
    token = await decryptToken(user.encrypted_api_token);
  } catch {
    const text =
      "Couldn't decrypt your stored token. Link a new Deriv API token from the menu.";
    if (mode === "edit") await ctx.editMessageText(text, { reply_markup: backMenu() });
    else await ctx.reply(text);
    return;
  }

  try {
    const bal = await fetchBalance(token);
    user.last_balance = bal.balance;
    user.last_currency = bal.currency;
    if (bal.balance >= owner.min_balance_alert) user.balance_alert_sent = false;
    await saveUser(user);

    const maxRiskCash =
      Math.round(bal.balance * (risk.max_risk_percent / 100) * 100) / 100;
    let text =
      `Balance: ${fmt(bal.balance)} ${bal.currency}\n` +
      `Max risk / trade: ${risk.max_risk_percent}% (~${fmt(maxRiskCash)} ${bal.currency})\n` +
      `Max concurrent: ${risk.max_concurrent_trades}\n` +
      `TP multiplier: ${risk.tp_multiplier}× SL`;

    if (bal.balance < owner.min_balance_alert) {
      text +=
        `\n\nBalance is below the alert floor (${owner.min_balance_alert} ${bal.currency}). Top up before autotrading.`;
    }

    if (mode === "edit") await ctx.editMessageText(text, { reply_markup: backMenu() });
    else await ctx.reply(text, { reply_markup: backMenu() });
  } catch (err) {
    const text = derivErrorMessage(err);
    if (mode === "edit") await ctx.editMessageText(text, { reply_markup: backMenu() });
    else await ctx.reply(text, { reply_markup: backMenu() });
  }
}

composer.command("balance", async (ctx) => {
  await showBalance(ctx, "reply");
});

composer.callbackQuery("balance:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showBalance(ctx, "edit");
});

export default composer;
