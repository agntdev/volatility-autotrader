import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  mainMenuKeyboard,
} from "../toolkit/index.js";
import { COPY } from "../lib/ui.js";
import {
  applyDefaultRisk,
  getOrCreateUser,
  getRisk,
  saveUser,
} from "../lib/domain.js";
import { encryptToken } from "../lib/crypto.js";
import { now } from "../lib/clock.js";

const composer = new Composer<Ctx>();

function uid(ctx: Ctx): string {
  return String(ctx.from?.id ?? ctx.chat?.id ?? "0");
}

async function renderHome(ctx: Ctx, mode: "reply" | "edit"): Promise<void> {
  const user = await getOrCreateUser(uid(ctx));
  if (!user.accepted_terms) {
    const markup = inlineKeyboard([
      [inlineButton("Accept terms", "onboard:accept")],
      [inlineButton("Help", "menu:help")],
    ]);
    if (mode === "edit") {
      await ctx.editMessageText(COPY.welcomeNew, { reply_markup: markup });
    } else {
      await ctx.reply(COPY.welcomeNew, { reply_markup: markup });
    }
    return;
  }
  if (!user.encrypted_api_token) {
    const markup = inlineKeyboard([
      [inlineButton("Link token", "onboard:token")],
      [inlineButton("Help", "menu:help")],
    ]);
    const text =
      "You're almost set. Link your Deriv API token to enable balance checks and trading.";
    if (mode === "edit") {
      await ctx.editMessageText(text, { reply_markup: markup });
    } else {
      await ctx.reply(text, { reply_markup: markup });
    }
    return;
  }
  if (mode === "edit") {
    await ctx.editMessageText(COPY.welcomeReady, {
      reply_markup: mainMenuKeyboard(),
    });
  } else {
    await ctx.reply(COPY.welcomeReady, { reply_markup: mainMenuKeyboard() });
  }
}

composer.command("start", async (ctx) => {
  ctx.session.step = "idle";
  await getOrCreateUser(uid(ctx));
  await renderHome(ctx, "reply");
});

composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  await renderHome(ctx, "edit");
});

composer.callbackQuery("onboard:accept", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(uid(ctx));
  if (!user.accepted_terms) {
    user.accepted_terms = true;
    user.accepted_terms_at = now();
    await saveUser(user);
    await applyDefaultRisk(uid(ctx));
  }
  const risk = await getRisk(uid(ctx));
  const text =
    `Terms accepted. Default risk is ${risk.max_risk_percent}% per trade, ${risk.max_concurrent_trades} concurrent position(s).\n\n` +
    "Next: link your Deriv API token so the bot can read balance and place trades.\n\n" +
    "Create a token at app.deriv.com (trade + read scopes), then paste it here.";
  await ctx.editMessageText(text, {
    reply_markup: inlineKeyboard([
      [inlineButton("Link token", "onboard:token")],
      [inlineButton("Back to menu", "menu:main")],
    ]),
  });
});

composer.callbackQuery("onboard:token", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(uid(ctx));
  if (!user.accepted_terms) {
    await ctx.editMessageText(COPY.needTerms, {
      reply_markup: inlineKeyboard([[inlineButton("Accept terms", "onboard:accept")]]),
    });
    return;
  }
  ctx.session.step = "awaiting_token";
  await ctx.editMessageText(COPY.tokenPrompt, {
    reply_markup: inlineKeyboard([[inlineButton("Cancel", "onboard:cancel")]]),
  });
});

composer.callbackQuery("onboard:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  await ctx.editMessageText(COPY.cancelled, {
    reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]),
  });
});

// Free-form token / flow input (must not swallow slash commands).
composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return next();

  const step = ctx.session.step ?? "idle";
  if (step !== "awaiting_token") return next();

  if (/^cancel$/i.test(text)) {
    ctx.session.step = "idle";
    await ctx.reply(COPY.cancelled, { reply_markup: mainMenuKeyboard() });
    return;
  }

  // Deriv tokens are typically alphanumeric; reject spaces/URLs.
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(text)) {
    await ctx.reply(COPY.tokenInvalid, {
      reply_markup: inlineKeyboard([[inlineButton("Cancel", "onboard:cancel")]]),
    });
    return;
  }

  const user = await getOrCreateUser(uid(ctx));
  if (!user.accepted_terms) {
    ctx.session.step = "idle";
    await ctx.reply(COPY.needTerms);
    return;
  }

  user.encrypted_api_token = await encryptToken(text);
  await saveUser(user);
  ctx.session.step = "idle";
  await ctx.reply(COPY.tokenSaved, { reply_markup: mainMenuKeyboard() });
});

export default composer;
