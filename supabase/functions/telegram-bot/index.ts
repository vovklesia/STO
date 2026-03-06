// supabase/functions/telegram-bot/index.ts
// ═══════════════════════════════════════════════════════
// 🤖 Telegram Bot Webhook — Атлас
// Обробляє вхідні повідомлення від Telegram Bot API:
//   /start         — інструкція прив'язки (Name + Пароль)
//   Name\nПароль   — прив'язка Telegram до акаунту слюсаря
//   /stop          — відв'язка
//   /status        — перевірка прив'язки
// ═══════════════════════════════════════════════════════

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
} as const;

// @ts-ignore: Deno глобальний у середовищі Edge Functions
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!BOT_TOKEN || !SUPABASE_URL || !SERVICE_ROLE) {
      console.error(
        "Missing env vars: TELEGRAM_BOT_TOKEN, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY",
      );
      return new Response("OK", { status: 200 });
    }

    // ────────────────────────────────
    // Встановлення webhook (одноразово)
    // GET ?setup_webhook=1
    // ────────────────────────────────
    const url = new URL(req.url);
    if (url.searchParams.get("setup_webhook") === "1") {
      const webhookUrl = `${SUPABASE_URL}/functions/v1/telegram-bot`;
      const tgResp = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: webhookUrl,
            allowed_updates: ["message", "callback_query"],
          }),
        },
      );
      const tgResult = await tgResp.text();
      console.log("setWebhook result:", tgResult);
      return new Response(tgResult, {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ────────────────────────────────
    // Інформація про webhook
    // GET ?webhook_info=1
    // ────────────────────────────────
    if (url.searchParams.get("webhook_info") === "1") {
      const tgResp = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`,
      );
      const tgResult = await tgResp.text();
      return new Response(tgResult, {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const update = await req.json();

    // ────────────────────────────────
    // Callback Query (кнопки під повідомленням)
    // ────────────────────────────────
    const callbackQuery = update?.callback_query;
    if (callbackQuery) {
      const cbData = callbackQuery.data || "";
      const cbChatId = callbackQuery.message?.chat?.id;
      const cbMessageId = callbackQuery.message?.message_id;
      const cbUsername =
        callbackQuery.from?.first_name ||
        callbackQuery.from?.username ||
        "Користувач";

      // Формат: rem_done_123, rem_snooze_123, rem_skip_123
      const match = cbData.match(/^rem_(done|snooze|skip)_(\d+)$/);
      if (match && cbChatId) {
        const action = match[1];
        const reminderId = parseInt(match[2], 10);

        const actionLabels: Record<string, string> = {
          done: "✅ Виконано",
          snooze: "📅 Заплановано",
          skip: "❌ Не планую",
        };

        // Оновити статус нагадування в БД
        if (action === "done") {
          await supabase
            .from("atlas_reminders")
            .update({
              status: "completed",
              updated_at: new Date().toISOString(),
            })
            .eq("reminder_id", reminderId);
        } else if (action === "skip") {
          await supabase
            .from("atlas_reminders")
            .update({
              status: "cancelled",
              updated_at: new Date().toISOString(),
            })
            .eq("reminder_id", reminderId);
        }
        // snooze — нічого не міняємо, залишаємо active

        // Записати лог
        await supabase.from("atlas_reminder_logs").insert({
          reminder_id: reminderId,
          channel: "telegram",
          message_text: `Відповідь: ${actionLabels[action]} (від ${cbUsername})`,
          delivery_status: "callback",
        });

        // Відповісти на callback (попап)
        await fetch(
          `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              callback_query_id: callbackQuery.id,
              text: actionLabels[action],
            }),
          },
        );

        // Оновити повідомлення — прибрати кнопки, додати відмітку
        const originalText = callbackQuery.message?.text || "";
        const updatedText = `${originalText}\n\n─────────────\n${actionLabels[action]} — ${cbUsername}`;

        await fetch(
          `https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: cbChatId,
              message_id: cbMessageId,
              text: updatedText,
            }),
          },
        );
      }

      return new Response("OK", { status: 200 });
    }

    // Telegram надсилає об'єкт Update
    const message = update?.message;
    if (!message || !message.text) {
      return new Response("OK", { status: 200 });
    }

    const chatId = message.chat.id;
    const text = message.text.trim();
    const username = message.from?.username || null;

    // ────────────────────────────────
    // /start — прив'язка через Name + Пароль
    // ────────────────────────────────
    if (text.startsWith("/start")) {
      const parts = text.split(" ");
      const linkCode = parts[1]?.trim();

      // Якщо є старий формат /start <id> — ігноруємо, просимо Name+Пароль
      if (linkCode) {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          "⚠️ Формат змінився.\n\n" +
          "Для прив'язки надішліть ваше *ім'я* та *пароль* — кожне на окремому рядку.\n\n" +
          "Наприклад:\n" +
          "`Шевченко Т.Г.`\n" +
          "`11111`",
        );
        return new Response("OK", { status: 200 });
      }

      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        "👋 Привіт! Я — *Атлас*, бот СТО WolfDrive.\n\n" +
        "Для прив'язки Telegram надішліть *ім'я* та *пароль* — кожне на окремому рядку.\n\n" +
        "Наприклад:\n" +
        "`Шевченко Т.Г.`\n" +
        "`11111`",
      );
      return new Response("OK", { status: 200 });
    }

    // ────────────────────────────────
    // /stop — відв'язка
    // ────────────────────────────────
    if (text === "/stop") {
      const { error } = await supabase
        .from("atlas_telegram_users")
        .update({ is_active: false })
        .eq("telegram_chat_id", chatId);

      if (error) {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          "❌ Помилка. Спробуйте пізніше.",
        );
      } else {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          "🔕 Сповіщення вимкнено.\nЩоб увімкнути знову — зайдіть у Повідомлення та прив'яжіть Telegram повторно.",
        );
      }
      return new Response("OK", { status: 200 });
    }

    // ────────────────────────────────
    // /status — перевірка
    // ────────────────────────────────
    if (text === "/status") {
      const { data: link } = await supabase
        .from("atlas_telegram_users")
        .select("slyusar_id, is_active, linked_at")
        .eq("telegram_chat_id", chatId)
        .single();

      if (!link) {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          "❌ Ваш Telegram не прив'язаний до жодного акаунту СТО.",
        );
      } else {
        const status = link.is_active ? "✅ Активний" : "🔕 Вимкнений";
        const linkedDate = new Date(link.linked_at).toLocaleDateString("uk-UA");
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          `📊 *Статус:* ${status}\n🆔 ID працівника: ${link.slyusar_id}\n📅 Прив'язано: ${linkedDate}`,
        );
      }
      return new Response("OK", { status: 200 });
    }

    // ────────────────────────────────
    // Будь-яке інше повідомлення → спроба прив'язки через Name + Пароль
    // ────────────────────────────────

    // Перевіряємо чи це 2 рядки (Name + Пароль)
    const lines = text
      .split("\n")
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0);

    if (lines.length === 2) {
      const inputName = lines[0];
      const inputPass = lines[1];

      // Завантажити всіх слюсарів і знайти по Name + Пароль
      const { data: slyusars, error: slyusarErr } = await supabase
        .from("slyusars")
        .select("slyusar_id, data");

      if (slyusarErr || !slyusars) {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          "❌ Помилка з'єднання. Спробуйте пізніше.",
        );
        return new Response("OK", { status: 200 });
      }

      const foundUser = slyusars.find((s: any) => {
        const d = typeof s.data === "string" ? JSON.parse(s.data) : s.data;
        if (!d) return false;
        const nameMatch =
          (d["Name"] || "").trim().toLowerCase() === inputName.toLowerCase();
        const passMatch = String(d["Пароль"]) === inputPass;
        return nameMatch && passMatch;
      });

      if (!foundUser) {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          "❌ *Невірне ім'я або пароль.*\n\n" +
          "Перевірте дані та спробуйте ще раз.\n" +
          "Формат — кожне на окремому рядку:\n" +
          "`Ім'я`\n" +
          "`Пароль`",
        );
        return new Response("OK", { status: 200 });
      }

      const userData =
        typeof foundUser.data === "string"
          ? JSON.parse(foundUser.data)
          : foundUser.data;
      const slyusarName = userData?.Name || `ID ${foundUser.slyusar_id}`;

      // Upsert прив'язки
      const { error: upsertErr } = await supabase
        .from("atlas_telegram_users")
        .upsert(
          {
            slyusar_id: foundUser.slyusar_id,
            telegram_chat_id: chatId,
            telegram_username: username,
            linked_at: new Date().toISOString(),
            is_active: true,
          },
          { onConflict: "slyusar_id" },
        );

      if (upsertErr) {
        console.error("Upsert error:", upsertErr);
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          "❌ Помилка прив'язки. Спробуйте пізніше.",
        );
        return new Response("OK", { status: 200 });
      }

      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        `✅ *Прив'язано!*\n\n` +
        `👤 Працівник: *${slyusarName}*\n\n` +
        `Тепер ви будете отримувати нагадування від Атласа тут.\n` +
        `Для відключення — /stop`,
      );
      return new Response("OK", { status: 200 });
    }

    // Якщо не 2 рядки — показуємо допомогу
    // Перевіримо, чи вже прив'язаний
    const { data: existingLink } = await supabase
      .from("atlas_telegram_users")
      .select("slyusar_id, is_active")
      .eq("telegram_chat_id", chatId)
      .single();

    if (existingLink && existingLink.is_active) {
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        "🤖 Я — *Атлас*, бот нагадувань WolfDrive.\n\n" +
        "✅ Ваш Telegram прив'язано.\n\n" +
        "Доступні команди:\n" +
        "/status — перевірити прив'язку\n" +
        "/stop — вимкнути сповіщення",
      );
    } else {
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        "🤖 Я — *Атлас*, бот нагадувань WolfDrive.\n\n" +
        "Для прив'язки надішліть *ім'я* та *пароль* — кожне на окремому рядку.\n\n" +
        "Наприклад:\n" +
        "`Шевченко Т.Г.`\n" +
        "`11111`\n\n" +
        "Доступні команди:\n" +
        "/status — перевірити прив'язку\n" +
        "/stop — вимкнути сповіщення",
      );
    }

    return new Response("OK", { status: 200 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("telegram-bot error:", msg);
    // Завжди повертаємо 200, щоб Telegram не повторював запит
    return new Response("OK", { status: 200 });
  }
});

// ── Відправити повідомлення через Telegram Bot API ──

async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string,
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });
  } catch (err) {
    console.error("sendTelegramMessage error:", err);
  }
}
