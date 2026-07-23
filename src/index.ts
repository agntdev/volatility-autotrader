import { buildBot } from "./bot.js";
import { setDefaultCommands } from "./toolkit/index.js";
import {
  listAutotradeUserIds,
  getOrCreateUser,
  getOwnerSettings,
  saveUser,
} from "./lib/domain.js";
import { scanAndMaybeTrade, safeSend, tradeOpenedText } from "./lib/trading.js";
import { tradeActionKeyboard } from "./lib/ui.js";

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error("BOT_TOKEN is required");
    process.exit(1);
  }
  const bot = await buildBot(token);
  // Publish the "/" command list (balance/history are power-user shortcuts).
  await setDefaultCommands(bot, [
    { command: "balance", description: "Account balance and risk" },
    { command: "history", description: "Recent trades" },
  ]);

  // Background scan loop (Node long-poll only). Workers rely on manual Scan.
  let scanning = false;
  const tick = async () => {
    if (scanning) return;
    scanning = true;
    try {
      const owner = await getOwnerSettings();
      const ids = await listAutotradeUserIds();
      for (const id of ids) {
        try {
          const user = await getOrCreateUser(id);
          if (!user.autotrade_enabled || !user.encrypted_api_token) continue;
          const result = await scanAndMaybeTrade(id, { execute: true });
          for (const trade of result.trades) {
            await safeSend(
              (chatId, text, extra) => bot.api.sendMessage(chatId, text, extra as never),
              id,
              tradeOpenedText(trade),
              { reply_markup: tradeActionKeyboard(trade.id) },
            );
          }
          for (const err of result.errors) {
            await safeSend(
              (chatId, text) => bot.api.sendMessage(chatId, text),
              id,
              err,
            );
          }
          if (
            user.last_balance != null &&
            user.last_balance < owner.min_balance_alert &&
            !user.balance_alert_sent
          ) {
            user.balance_alert_sent = true;
            await saveUser(user);
            await safeSend(
              (chatId, text) => bot.api.sendMessage(chatId, text),
              id,
              `Balance alert: ${user.last_balance} ${user.last_currency ?? ""} is below ${owner.min_balance_alert}. AutoTrading will skip new entries until you top up.`,
            );
          }
        } catch (err) {
          console.error("[scan]", id, err);
        }
      }
    } finally {
      scanning = false;
    }
  };

  const ownerSettings = await getOwnerSettings();
  const interval = setInterval(() => {
    void tick();
  }, ownerSettings.scan_interval_ms);

  bot.start({
    onStart: () => {
      console.log("Deriv SynthIndex AutoTrader is running");
    },
  });

  process.once("SIGINT", () => clearInterval(interval));
  process.once("SIGTERM", () => clearInterval(interval));
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
