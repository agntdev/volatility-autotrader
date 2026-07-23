import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { COPY, backMenu } from "../lib/ui.js";
import { getOwnerSettings, saveOwnerSettings } from "../lib/domain.js";
import { instrumentLabel, type OwnerSettings } from "../lib/types.js";

registerMainMenuItem({
  label: "Owner settings",
  data: "owner:menu",
  order: 90,
});

const composer = new Composer<Ctx>();

function ownerId(): string | undefined {
  const env = typeof process !== "undefined" ? process.env : {};
  return env.BOT_OWNER_ID || env.OWNER_TELEGRAM_ID || undefined;
}

function isOwner(ctx: Ctx): boolean {
  const configured = ownerId();
  // If no owner is configured, allow the first user to manage settings
  // (single-tenant deploy). When BOT_OWNER_ID is set, enforce it.
  if (!configured) return true;
  return String(ctx.from?.id) === String(configured);
}

function summary(s: OwnerSettings): string {
  const instruments = s.instruments.map(instrumentLabel).join(", ");
  return (
    `Owner controls\n\n` +
    `Instruments: ${instruments}\n` +
    `Confidence threshold: ${Math.round(s.confidence_threshold * 100)}%\n` +
    `Default risk: ${s.default_risk_percent}%\n` +
    `Default max concurrent: ${s.default_max_concurrent}\n` +
    `Default TP multiplier: ${s.default_tp_multiplier}×\n` +
    `Default SL fraction: ${Math.round(s.default_sl_fraction * 100)}% of stake\n` +
    `Manual overrides: ${s.manual_override_enabled ? "on" : "off"}\n` +
    `Min balance alert: ${s.min_balance_alert}`
  );
}

function menuKeyboard(s: OwnerSettings): ReturnType<typeof inlineKeyboard> {
  return inlineKeyboard([
    [inlineButton("Toggle V50", "owner:toggle:R_50"), inlineButton("Toggle V75", "owner:toggle:R_75")],
    [inlineButton("Confidence", "owner:set:confidence")],
    [inlineButton("Min balance alert", "owner:set:minbal")],
    [
      inlineButton(
        s.manual_override_enabled ? "Disable overrides" : "Enable overrides",
        "owner:toggle:override",
      ),
    ],
    [inlineButton("Back to menu", "menu:main")],
  ]);
}

composer.callbackQuery("owner:menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isOwner(ctx)) {
    await ctx.editMessageText(COPY.ownerDenied, { reply_markup: backMenu() });
    return;
  }
  const s = await getOwnerSettings();
  await ctx.editMessageText(summary(s), { reply_markup: menuKeyboard(s) });
});

composer.callbackQuery(/^owner:toggle:(R_50|R_75)$/, async (ctx) => {
  if (!isOwner(ctx)) {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(COPY.ownerDenied, { reply_markup: backMenu() });
    return;
  }
  const sym = ctx.match[1]!;
  const s = await getOwnerSettings();
  if (s.instruments.includes(sym)) {
    if (s.instruments.length === 1) {
      await ctx.answerCallbackQuery({ text: "Keep at least one instrument" });
      return;
    }
    s.instruments = s.instruments.filter((x) => x !== sym);
  } else {
    s.instruments = [...s.instruments, sym];
  }
  await ctx.answerCallbackQuery();
  await saveOwnerSettings(s);
  await ctx.editMessageText(summary(s), { reply_markup: menuKeyboard(s) });
});

composer.callbackQuery("owner:toggle:override", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isOwner(ctx)) {
    await ctx.editMessageText(COPY.ownerDenied, { reply_markup: backMenu() });
    return;
  }
  const s = await getOwnerSettings();
  s.manual_override_enabled = !s.manual_override_enabled;
  await saveOwnerSettings(s);
  await ctx.editMessageText(summary(s), { reply_markup: menuKeyboard(s) });
});

composer.callbackQuery("owner:set:confidence", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isOwner(ctx)) {
    await ctx.editMessageText(COPY.ownerDenied, { reply_markup: backMenu() });
    return;
  }
  ctx.session.step = "awaiting_owner_confidence";
  await ctx.editMessageText(
    "Send confidence threshold as a percent (50–95). Example: 70\n\nTap Cancel to stop.",
    {
      reply_markup: inlineKeyboard([[inlineButton("Cancel", "owner:cancel")]]),
    },
  );
});

composer.callbackQuery("owner:set:minbal", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isOwner(ctx)) {
    await ctx.editMessageText(COPY.ownerDenied, { reply_markup: backMenu() });
    return;
  }
  ctx.session.step = "awaiting_owner_min_balance";
  await ctx.editMessageText(
    "Send minimum balance alert threshold (number). Example: 5\n\nTap Cancel to stop.",
    {
      reply_markup: inlineKeyboard([[inlineButton("Cancel", "owner:cancel")]]),
    },
  );
});

composer.callbackQuery("owner:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isOwner(ctx)) {
    await ctx.editMessageText(COPY.ownerDenied, { reply_markup: backMenu() });
    return;
  }
  ctx.session.step = "idle";
  const s = await getOwnerSettings();
  await ctx.editMessageText(summary(s), { reply_markup: menuKeyboard(s) });
});

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return next();
  const step = ctx.session.step ?? "idle";
  if (step !== "awaiting_owner_confidence" && step !== "awaiting_owner_min_balance") {
    return next();
  }
  if (!isOwner(ctx)) {
    ctx.session.step = "idle";
    return next();
  }
  if (/^cancel$/i.test(text)) {
    ctx.session.step = "idle";
    const s = await getOwnerSettings();
    await ctx.reply(summary(s), { reply_markup: menuKeyboard(s) });
    return;
  }
  const s = await getOwnerSettings();
  if (step === "awaiting_owner_confidence") {
    const n = Number(text.replace("%", ""));
    if (!Number.isFinite(n) || n < 50 || n > 95) {
      await ctx.reply("Enter a number from 50 to 95.");
      return;
    }
    s.confidence_threshold = Math.round(n) / 100;
    await saveOwnerSettings(s);
    ctx.session.step = "idle";
    await ctx.reply(
      `Confidence threshold set to ${Math.round(s.confidence_threshold * 100)}%.`,
      { reply_markup: menuKeyboard(s) },
    );
    return;
  }
  if (step === "awaiting_owner_min_balance") {
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
      await ctx.reply("Enter a non-negative number.");
      return;
    }
    s.min_balance_alert = Math.round(n * 100) / 100;
    await saveOwnerSettings(s);
    ctx.session.step = "idle";
    await ctx.reply(`Min balance alert set to ${s.min_balance_alert}.`, {
      reply_markup: menuKeyboard(s),
    });
  }
});

export default composer;
