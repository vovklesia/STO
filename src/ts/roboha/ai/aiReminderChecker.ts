// 🔔 aiReminderChecker.ts — Перевірка нагадувань (основний обробник)
// Смарт-Менеджер: авто вмик./вимик. polling + realtime
// Polling 60с + precision timer → toast + Telegram
// Realtime: event-based моніторинг БД (без SQL!)
// Сервер (pg_cron) теж відправляє Telegram — дедуплікація через логи
// ═══════════════════════════════════════════════════════

import { supabase } from "../../vxid/supabaseClient";

// ── Конфігурація ──

const CHECK_INTERVAL_ACTIVE_MS = 60_000; // 60с — polling коли вкладка активна
const CHECK_INTERVAL_HIDDEN_MS = 300_000; // 5хв — polling коли вкладка прихована (сервер відправить Telegram)
const TOAST_DISPLAY_MS = 12_000; // Час показу toast (12 сек)
const TOAST_STACK_GAP = 12; // Відстань між toast-ами в стеку
const MAX_TOASTS_VISIBLE = 5; // Макс. кількість одночасних toast
const SOUND_ENABLED = true; // Звуковий сигнал

// ── Стан ──

let intervalId: ReturnType<typeof setInterval> | null = null;
let precisionTimerId: ReturnType<typeof setTimeout> | null = null;
let isChecking = false;
let toastContainer: HTMLElement | null = null;
let activeToasts: HTMLElement[] = [];
let currentSlyusarId: number | null = null;
let notificationPermissionAsked = false;
let onRemindersTriggered: (() => void) | null = null;

let hasActiveReminders = false;
let isTabVisible = true; // Visibility API: чи вкладка активна
let cachedNextTriggerAt: number | null = null; // Кеш найближчого спрацювання (ms)

let remindersStateChannel: ReturnType<typeof supabase.channel> | null = null;
let stateSyncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastSyncTime = 0; // Час останньої синхронізації (тротлінг 10с)

function isRetryableSupabaseError(error: any): boolean {
  const status = Number(error?.status || error?.code || 0);
  if (status === 503 || status === 502 || status === 504 || status === 429) {
    return true;
  }
  const msg = String(error?.message || "").toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("service unavailable") ||
    msg.includes("gateway timeout") ||
    msg.includes("too many requests")
  );
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function selectSlyusarsWithRetry(
  columns: string,
  apply?: (q: any) => any,
): Promise<{ data: any[] | null; error: any }> {
  const maxAttempts = 3;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let query = supabase.from("slyusars").select(columns);
    if (apply) query = apply(query);

    const { data, error } = await query;
    if (!error) {
      return { data: (data || []) as any[], error: null };
    }

    lastError = error;
    if (!isRetryableSupabaseError(error) || attempt === maxAttempts) {
      break;
    }

    await sleepMs(250 * attempt);
  }

  return { data: null, error: lastError };
}

// Дедуплікація: Map<reminder_id, timestamp> — коли нагадування було оброблено клієнтом
const recentlyProcessed = new Map<number, number>();
const DEDUP_WINDOW_MS = 30_000; // 30 сек — не обробляти одне нагадування частіше

async function syncReminderCapabilities() {
  if (!currentSlyusarId) return;

  // Тротлінг: не частіше ніж раз на 10 секунд
  const now = Date.now();
  if (now - lastSyncTime < 10_000) return;
  lastSyncTime = now;

  try {
    const { data, error } = await supabase
      .from("atlas_reminders")
      .select("status, reminder_type, schedule, created_by, recipients")
      .eq("status", "active");

    if (error) {
      return;
    }

    // Фільтруємо ті активні нагадування, що стосуються поточного користувача
    const myReminders = (data || []).filter((r: any) =>
      isReminderForUser(r, currentSlyusarId!),
    );

    const activeCount = myReminders.length;
    const newHasActiveReminders = activeCount > 0;
    const newHasRealtimeReminders = myReminders.some((r: any) => {
      try {
        if (r.reminder_type !== "conditional") return false;
        const sched =
          typeof r.schedule === "string" ? JSON.parse(r.schedule) : r.schedule;
        return sched?.type === "realtime";
      } catch {
        return false;
      }
    });

    // Управління Polling (інтервалом опитування)
    if (newHasActiveReminders && !intervalId) {
      checkDueReminders();
      startPollingWithVisibility();
    } else if (!newHasActiveReminders && intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      if (precisionTimerId) {
        clearTimeout(precisionTimerId);
        precisionTimerId = null;
      }
    }
    hasActiveReminders = newHasActiveReminders;

    // Управління Realtime
    if (newHasRealtimeReminders && !realtimeChannel) {
      initRealtimeMonitoring();
    } else if (!newHasRealtimeReminders && realtimeChannel) {
      for (const ch of realtimeChannels) supabase.removeChannel(ch);
      realtimeChannels = [];
      realtimeChannel = null;
    }
  } catch (err) {}
}

function initRemindersStateListener() {
  if (remindersStateChannel) return;
  syncReminderCapabilities();

  remindersStateChannel = supabase
    .channel("atlas_reminders_status")
    .on(
      "postgres_changes" as any,
      { event: "*", schema: "public", table: "atlas_reminders" },
      () => {
        if (stateSyncDebounceTimer) clearTimeout(stateSyncDebounceTimer);
        stateSyncDebounceTimer = setTimeout(syncReminderCapabilities, 1500);
      },
    )
    .subscribe();
}

// ── Ініціалізація ──

export function initReminderChecker(): void {
  // Визначити поточного користувача
  currentSlyusarId = getSlyusarId();
  if (!currentSlyusarId) {
    return;
  }

  // Створити контейнер для toast-ів
  ensureToastContainer();

  // Замість ручного запуску всіх процесів, активуємо Смарт-Менеджер,
  // який сам проаналізує БД і увімкне необхідні системи ТІЛЬКИ якщо є АКТИВНІ нагадування
  initRemindersStateListener();
  initVisibilityListener();
}

// ── Visibility API: управління polling при приховуванні/показі вкладки ──

function initVisibilityListener(): void {
  document.addEventListener("visibilitychange", () => {
    isTabVisible = !document.hidden;
    if (isTabVisible) {
      // При поверненні — одразу перевірити і переключити на активний інтервал
      if (hasActiveReminders) {
        checkDueReminders();
        restartPollingInterval(CHECK_INTERVAL_ACTIVE_MS);
      }
    } else {
      if (hasActiveReminders && intervalId) {
        restartPollingInterval(CHECK_INTERVAL_HIDDEN_MS);
      }
    }
  });
}

function startPollingWithVisibility(): void {
  const interval = isTabVisible
    ? CHECK_INTERVAL_ACTIVE_MS
    : CHECK_INTERVAL_HIDDEN_MS;
  intervalId = setInterval(checkDueReminders, interval);
  schedulePrecisionCheck();
}

function restartPollingInterval(newIntervalMs: number): void {
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(checkDueReminders, newIntervalMs);
}

/** Колбек для оновлення UI планувальника після спрацювання */
export function setOnRemindersTriggered(cb: () => void): void {
  onRemindersTriggered = cb;
}

export function stopReminderChecker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (precisionTimerId) {
    clearTimeout(precisionTimerId);
    precisionTimerId = null;
  }
}

// ── Отримати slyusar_id ──

function getSlyusarId(): number | null {
  try {
    const stored = localStorage.getItem("userAuthData");
    if (stored) {
      const data = JSON.parse(stored);
      return data?.slyusar_id ?? null;
    }
  } catch {
    /* */
  }
  return null;
}

// ── Головна перевірка ──

// ── Відправка Telegram з клієнта (з дедуплікацією) ──

async function sendTelegramForReminder(reminder: DueReminder): Promise<void> {
  try {
    // Коли вкладка прихована — не відправляємо Telegram з клієнта.
    // Серверна функція check-reminders (pg_cron) відправить сама.
    if (!isTabVisible) {
      return;
    }

    // Дедуплікація: перевірити чи вже відправлено за останні 90 сек
    const { data: recentLogs } = await supabase
      .from("atlas_reminder_logs")
      .select("reminder_id")
      .eq("reminder_id", reminder.reminder_id)
      .eq("channel", "telegram")
      .eq("delivery_status", "delivered")
      .gte("created_at", new Date(Date.now() - 90_000).toISOString())
      .limit(1);

    if (recentLogs && recentLogs.length > 0) {
      return;
    }

    const recipientIds = await resolveRecipientIds(reminder);
    if (recipientIds.length === 0) {
      return;
    }

    const { data: tgUsers, error } = await supabase
      .from("atlas_telegram_users")
      .select("slyusar_id, telegram_chat_id")
      .in("slyusar_id", recipientIds)
      .eq("is_active", true);

    if (error || !tgUsers?.length) {
      return;
    }

    const icon = getPriorityIcon(reminder.priority);
    const typeLabel = getTypeLabel(reminder.reminder_type);
    const priorityLabel = getPriorityLabel(reminder.priority);

    const messageText = [
      `${icon} <b>${escHtml(reminder.title)}</b>`,
      reminder.description ? `\n${escHtml(reminder.description)}` : "",
      reminder.meta?.condition_result_text
        ? `\n<b>📊 Результат перевірки:</b>\n${escHtml(reminder.meta.condition_result_text)}`
        : "",
      `\n${typeLabel} | Пріоритет: ${priorityLabel}`,
      `👤 Створив: ${escHtml(reminder.creator_name)}`,
    ]
      .filter(Boolean)
      .join("\n");

    const reply_markup = {
      inline_keyboard: [
        [
          {
            text: "✅ Виконано",
            callback_data: `rem_done_${reminder.reminder_id}`,
          },
          {
            text: "📅 Заплановано",
            callback_data: `rem_snooze_${reminder.reminder_id}`,
          },
          {
            text: "❌ Не планую",
            callback_data: `rem_skip_${reminder.reminder_id}`,
          },
        ],
      ],
    };

    for (const tgUser of tgUsers) {
      try {
        await supabase.functions.invoke("send-telegram", {
          body: {
            chat_id: tgUser.telegram_chat_id,
            text: messageText,
            parse_mode: "HTML",
            reply_markup,
          },
        });
        await supabase.from("atlas_reminder_logs").insert({
          reminder_id: reminder.reminder_id,
          recipient_id: tgUser.slyusar_id,
          channel: "telegram",
          message_text: messageText,
          delivery_status: "delivered",
        });
      } catch (err) {}
    }
  } catch (err) {}
}

async function resolveRecipientIds(reminder: DueReminder): Promise<number[]> {
  const recipients = reminder.recipients;

  if (recipients === "self" || recipients === '"self"') {
    return reminder.created_by ? [reminder.created_by] : [];
  }

  if (recipients === "all" || recipients === '"all"') {
    const { data } = await selectSlyusarsWithRetry("slyusar_id");
    return data?.map((s: { slyusar_id: number }) => s.slyusar_id) || [];
  }

  if (recipients === "mechanics" || recipients === '"mechanics"') {
    const { data } = await selectSlyusarsWithRetry("slyusar_id, data", (q) =>
      q.filter("data->>Посада", "eq", "Слюсар"),
    );
    return data?.map((s: { slyusar_id: number }) => s.slyusar_id) || [];
  }

  if (Array.isArray(recipients)) return recipients;

  if (typeof recipients === "string") {
    try {
      const raw = recipients.trim();
      // Парсимо лише JSON-масив, щоб не ловити помилки на plain-значеннях типу "self"
      if (raw.startsWith("[") && raw.endsWith("]")) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      /* */
    }
  }

  return reminder.created_by ? [reminder.created_by] : [];
}

function escHtml(text: string | null | undefined): string {
  if (!text) return "—";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getPriorityLabel(priority: string): string {
  switch (priority) {
    case "urgent":
      return "Терміновий";
    case "high":
      return "Високий";
    case "normal":
      return "Звичайний";
    case "low":
      return "Низький";
    default:
      return priority;
  }
}

async function checkDueReminders(): Promise<void> {
  if (isChecking || !hasActiveReminders) return;
  isChecking = true;

  // Очистити застарілі записи дедуплікації
  const now = Date.now();
  for (const [rid, ts] of recentlyProcessed) {
    if (now - ts > DEDUP_WINDOW_MS) recentlyProcessed.delete(rid);
  }

  try {
    // Перевірити, що користувач все ще авторизований
    if (!currentSlyusarId) {
      currentSlyusarId = getSlyusarId();
      if (!currentSlyusarId) return;
    }

    // Викликати RPC: отримати нагадування, які мають спрацювати
    const { data: dueReminders, error } =
      await supabase.rpc("get_due_reminders");

    if (error) {
      return;
    }

    if (!dueReminders || dueReminders.length === 0) {
      // Немає due — precision timer підхопить при активній вкладці
      if (isTabVisible) schedulePrecisionCheck();
      return;
    }

    let anyTriggered = false;

    // Фільтрувати: показати тільки ті, що стосуються поточного користувача
    for (const reminder of dueReminders) {
      const isForMe = isReminderForUser(reminder, currentSlyusarId);
      if (!isForMe) continue;

      // Дедуплікація: пропустити якщо вже оброблено нещодавно
      const lastProcessed = recentlyProcessed.get(reminder.reminder_id);
      if (lastProcessed && Date.now() - lastProcessed < DEDUP_WINDOW_MS) {
        continue;
      }

      // Для conditional-нагадувань — перевірити умову
      if (
        reminder.reminder_type === "conditional" &&
        reminder.condition_query
      ) {
        const condResult = await checkCondition(reminder.condition_query);
        if (!condResult) {
          // Умова не виконана → просто оновити next_trigger_at
          await markTriggered(reminder.reminder_id, false, "Умова не виконана");
          // Для interval — перерахувати next_trigger_at
          try {
            const sched =
              typeof reminder.schedule === "string"
                ? JSON.parse(reminder.schedule)
                : reminder.schedule;
            if (sched?.type === "interval") {
              const hours = sched.hours || 0;
              const minutes = sched.minutes || 0;
              const totalMs =
                (hours * 60 + minutes) * 60 * 1000 || 60 * 60 * 1000;
              await supabase
                .from("atlas_reminders")
                .update({
                  next_trigger_at: new Date(Date.now() + totalMs).toISOString(),
                })
                .eq("reminder_id", reminder.reminder_id);
            }
          } catch {
            /* */
          }
          recentlyProcessed.set(reminder.reminder_id, Date.now());
          continue;
        }

        // Форматуємо результат для Telegram
        const fieldLabels: Record<string, string> = {
          act_id: "Акт №",
          date_on: "Відкритий",
          date_off: "Закритий",
          total_amount: "Сума",
          status: "Статус",
          client_name: "Клієнт",
          client_phone: "Телефон",
          slusar: "Слюсар",
          car: "Авто",
          vin: "VIN",
          description: "Опис",
          count: "Кількість",
        };
        const formatFieldName = (key: string): string =>
          fieldLabels[key] || key;
        const formatValue = (v: any): string => {
          if (v === null || v === undefined) return "—";
          if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
            return new Date(v).toLocaleString("uk-UA", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
          }
          return String(v);
        };

        let resultText = "";
        if (Array.isArray(condResult)) {
          resultText = condResult
            .map((row: any, i: number) => {
              if (typeof row === "object" && row !== null) {
                return (
                  `${i + 1}. ` +
                  Object.entries(row)
                    .map(([k, v]) => `${formatFieldName(k)}: ${formatValue(v)}`)
                    .join(" | ")
                );
              }
              return `${i + 1}. ${String(row)}`;
            })
            .join("\n");
        } else if (typeof condResult === "object" && condResult !== null) {
          resultText = Object.entries(condResult)
            .map(([k, v]) => `• ${formatFieldName(k)}: ${formatValue(v)}`)
            .join("\n");
        } else {
          resultText = String(condResult);
        }

        if (!reminder.meta) reminder.meta = {};
        reminder.meta.condition_result_text = resultText;
      }

      // Показати toast (для app і both каналів)
      if (reminder.channel === "app" || reminder.channel === "both") {
        showReminderToast(reminder);
      }

      // Відправити Telegram (для telegram і both каналів)
      // Дедуплікація: перевірити чи сервер вже не відправив
      if (reminder.channel === "telegram" || reminder.channel === "both") {
        await sendTelegramForReminder(reminder);
      }

      // Записати лог + оновити trigger
      await markTriggered(reminder.reminder_id, true);

      // Для interval — явно перерахувати next_trigger_at (RPC може не знати про minutes)
      try {
        const sched =
          typeof reminder.schedule === "string"
            ? JSON.parse(reminder.schedule)
            : reminder.schedule;
        if (sched?.type === "interval") {
          const hours = sched.hours || 0;
          const minutes = sched.minutes || 0;
          const totalMs = (hours * 60 + minutes) * 60 * 1000 || 60 * 60 * 1000;
          const nextTrigger = new Date(Date.now() + totalMs).toISOString();
          await supabase
            .from("atlas_reminders")
            .update({ next_trigger_at: nextTrigger })
            .eq("reminder_id", reminder.reminder_id);
        }
      } catch {
        /* */
      }

      // Зафіксувати обробку для дедуплікації
      recentlyProcessed.set(reminder.reminder_id, Date.now());

      anyTriggered = true;
    }

    // Оновити UI планувальника, якщо хоч одне спрацювало
    if (anyTriggered && onRemindersTriggered) {
      onRemindersTriggered();
    }

    // Перепланувати precision timer (тільки для активної вкладки)
    if (isTabVisible) {
      cachedNextTriggerAt = null; // Скинути кеш — нагадування оброблене
      schedulePrecisionCheck();
    }
  } catch (err) {
  } finally {
    isChecking = false;
  }
}

// ── Precision timer: точний запуск в момент next_trigger_at ──
// Оптимізація: використовуємо кеш next_trigger_at з відповіді get_due_reminders,
// і звертаємося до БД ТІЛЬКИ якщо кеш пустий

async function schedulePrecisionCheck(): Promise<void> {
  if (precisionTimerId) {
    clearTimeout(precisionTimerId);
    precisionTimerId = null;
  }

  // Якщо вкладка прихована — не встановлювати precision timer (сервер +  повільний polling)
  if (!isTabVisible) return;

  try {
    let nextMs: number | null = cachedNextTriggerAt;

    // Звертаємося до БД тільки якщо кеш пустий або вже минув
    if (!nextMs || nextMs <= Date.now()) {
      const { data } = await supabase
        .from("atlas_reminders")
        .select("next_trigger_at")
        .eq("status", "active")
        .not("next_trigger_at", "is", null)
        .order("next_trigger_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!data?.next_trigger_at) {
        cachedNextTriggerAt = null;
        return;
      }
      nextMs = new Date(data.next_trigger_at).getTime();
      cachedNextTriggerAt = nextMs;
    }

    const nowMs = Date.now();
    // Запустити через дельту (мінімум 1 сек, максимум 5 хв)
    const delayMs = Math.max(1_000, Math.min(nextMs - nowMs + 500, 300_000));

    precisionTimerId = setTimeout(() => {
      precisionTimerId = null;
      cachedNextTriggerAt = null; // Скинути кеш після спрацювання
      checkDueReminders();
    }, delayMs);
  } catch {
    // Ігноруємо — базовий polling підстрахує
  }
}

// ── Перевірка: чи нагадування для цього користувача ──

function isReminderForUser(reminder: DueReminder, slyusarId: number): boolean {
  const recipients = reminder.recipients;

  // "all" — для всіх
  if (recipients === "all" || recipients === '"all"') return true;

  // "self" — тільки для автора
  if (recipients === "self" || recipients === '"self"') {
    return reminder.created_by === slyusarId;
  }

  // "mechanics" — для слюсарів (перевірити роль)
  if (recipients === "mechanics" || recipients === '"mechanics"') {
    return isCurrentUserMechanic();
  }

  // Масив ID
  if (Array.isArray(recipients)) {
    return recipients.includes(slyusarId);
  }

  // JSON-рядок масиву
  if (typeof recipients === "string") {
    try {
      const raw = recipients.trim();
      // Парсимо лише JSON-масив, щоб не логувати зайві parse errors на plain-строках
      if (raw.startsWith("[") && raw.endsWith("]")) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.includes(slyusarId);
      }
    } catch {
      /* */
    }
  }

  // Автор завжди бачить
  return reminder.created_by === slyusarId;
}

function isCurrentUserMechanic(): boolean {
  try {
    const stored = localStorage.getItem("userAuthData");
    if (stored) {
      const data = JSON.parse(stored);
      const role = data?.Посада || data?.role || "";
      return role === "Слюсар";
    }
  } catch {
    /* */
  }
  return false;
}

// ── Перевірка умови (conditional) ──

async function checkCondition(conditionQuery: string): Promise<any | false> {
  try {
    // Виконати SQL-запит через rpc (read-only, безпечний SELECT)
    const { data, error } = await supabase.rpc("execute_condition_query", {
      query_text: conditionQuery,
    });

    if (error) {
      return false;
    }

    if (typeof data === "number") return data > 0 ? { count: data } : false;
    if (Array.isArray(data)) return data.length > 0 ? data : false;
    if (typeof data === "boolean") return data ? { result: true } : false;

    return !!data ? data : false;
  } catch {
    return false;
  }
}

// ── Realtime моніторинг змін у БД — ПОДІЄВИЙ (без SQL!) ──

// Структура правила спостереження:
// {
//   "table":  "acts",                          // таблиця для прослуховування
//   "events": ["INSERT","UPDATE","DELETE"],       // події
//   "check":  "date_off IS NOT NULL",            // необов’язковий фільтр на payload.new
//   "show_fields": ["act_id","ПІБ","Марка+Модель","Загальна сума","Приймальник"]
// }
//
// Або звичайний режим (старий SQL SELECT) — в ньому випадку
// condition_query починається з SELECT і виконується як раніше

let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let realtimeChannels: Array<ReturnType<typeof supabase.channel>> = [];

// Парсинг JSON-правила з condition_query
function parseWatchRule(conditionQuery: string | null): {
  table: string;
  events: string[];
  check?: string;
  show_fields?: string[];
} | null {
  if (!conditionQuery) return null;
  const trimmed = conditionQuery.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  return null; // старий SQL-режим
}

// Перевірка умови check на об’єкті payload.new
function evalCheck(
  check: string | undefined,
  newRow: Record<string, any>,
  oldRow: Record<string, any>,
): boolean {
  if (!check) return true; // без фільтру — завжди тригер

  const c = check.trim().toLowerCase();
  const row = newRow;

  // Прості умови: поле IS NOT NULL (з підтримкою вкладених: data.Пароль IS NOT NULL)
  const isNotNull = c.match(/^([\w.]+)\s+is\s+not\s+null$/);
  if (isNotNull) {
    const field = isNotNull[1];
    const [, newVal] = getNestedValues(field, oldRow, row);
    return newVal != null && newVal !== "";
  }

  // Прості умови: поле IS NULL
  const isNull = c.match(/^([\w.]+)\s+is\s+null$/);
  if (isNull) {
    const field = isNull[1];
    const [, newVal] = getNestedValues(field, oldRow, row);
    return newVal == null || newVal === "";
  }

  // Зміна поля: field CHANGED (підтримка вкладених полів: data.Пароль CHANGED)
  const changed = c.match(/^([\w.]+)\s+changed$/);
  if (changed) {
    const field = changed[1];
    const [oldVal, newVal] = getNestedValues(field, oldRow, row);
    // Якщо old рядок не містить поле (REPLICA IDENTITY не FULL — old містить лише PK),
    // ми не можемо підтвердити, що значення НЕ змінилось → тригеримо завжди
    if (oldVal === undefined && newVal !== undefined) return true;
    return String(oldVal ?? "") !== String(newVal ?? "");
  }

  // Зміна з null на NOT NULL: field CLOSED
  const closed = c.match(/^([\w.]+)\s+closed$/);
  if (closed) {
    const field = closed[1];
    const [oldVal, newVal] = getNestedValues(field, oldRow, row);
    // Якщо old не містить поле (REPLICA IDENTITY не FULL) — перевіряємо лише new
    if (oldVal === undefined) return newVal != null && newVal !== "";
    return (oldVal == null || oldVal === "") && newVal != null && newVal !== "";
  }

  // Зміна з NOT NULL на null: field OPENED (очищення комірки)
  const opened = c.match(/^([\w.]+)\s+opened$/);
  if (opened) {
    const field = opened[1];
    const [oldVal, newVal] = getNestedValues(field, oldRow, row);
    // Якщо old не містить поле (REPLICA IDENTITY не FULL) — тригеримо якщо new порожнє
    if (oldVal === undefined) return newVal == null || newVal === "";
    return oldVal != null && oldVal !== "" && (newVal == null || newVal === "");
  }

  // Будь-яка зміна (без фільтру)
  if (c === "any" || c === "*" || c === "true") return true;

  return true; // за замовчуванням — тригер
}

// Отримати значення вкладеного поля (напр. data.Пароль) з old і new рядків
function getNestedValues(
  fieldPath: string,
  oldRow: Record<string, any>,
  newRow: Record<string, any>,
): [any, any] {
  if (!fieldPath.includes(".")) {
    return [oldRow?.[fieldPath], newRow?.[fieldPath]];
  }
  const parts = fieldPath.split(".");
  const resolve = (obj: any): any => {
    let val = obj;
    for (const part of parts) {
      if (val == null) return undefined;
      if (typeof val === "object") {
        // Якщо поле — рядок JSON (JSONB при трансмісії може бути серіалізований)
        if (typeof val[part] === "string" && part === parts[0]) {
          try {
            val = JSON.parse(val[part]);
          } catch {
            val = val[part];
          }
        } else {
          val = val[part];
        }
      } else {
        return undefined;
      }
    }
    return val;
  };
  return [resolve(oldRow), resolve(newRow)];
}

// Людський формат для значення JSONB (масиви, об'єкти, примітиви)
function fmtVal(v: any): string {
  if (v == null) return "—";
  if (Array.isArray(v)) {
    if (v.length === 0) return "(порожньо)";
    return v
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          return (
            item["Найменування"] ||
            item.Робота ||
            item.Деталь ||
            item.Назва ||
            item.Name ||
            JSON.stringify(item)
          );
        }
        return String(item);
      })
      .join(", ");
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Детальний diff масивів об'єктів (Роботи / Деталі)
function diffArrays(key: string, oldArr: any[], newArr: any[]): string {
  const nameOf = (item: any): string => {
    if (typeof item !== "object" || item === null) return String(item);
    return (
      item["Найменування"] ||
      item.Робота ||
      item.Деталь ||
      item.Назва ||
      item.Name ||
      JSON.stringify(item)
    );
  };
  const detailOf = (item: any): string => {
    if (typeof item !== "object" || item === null) return "";
    const parts: string[] = [];
    const qty = item["Кількість"] ?? item["К-ть"];
    const price = item.Ціна;
    const sum = item.Сума;
    const salary = item.Зарплата ?? item["Зар-та"];
    if (qty != null) parts.push(`${qty} шт`);
    if (price != null) parts.push(`${price} грн`);
    if (sum != null && sum !== price) parts.push(`сума ${sum}`);
    if (salary != null) parts.push(`зп ${salary}`);
    return parts.length ? ` (${parts.join(", ")})` : "";
  };

  const oldNames = oldArr.map(nameOf);
  const newNames = newArr.map(nameOf);
  const added = newArr.filter((_, i) => !oldNames.includes(newNames[i]));
  const removed = oldArr.filter((_, i) => !newNames.includes(oldNames[i]));
  const lines: string[] = [];
  for (const a of added) lines.push(`  ➕ ${nameOf(a)}${detailOf(a)}`);
  for (const r of removed) lines.push(`  ➖ ${nameOf(r)}${detailOf(r)}`);
  if (lines.length === 0) {
    return `${key}: ${oldArr.length} → ${newArr.length} записів`;
  }
  return `${key}:\n${lines.join("\n")}`;
}

// Форматування повідомлення з payload
function formatPayloadMessage(
  payload: {
    eventType: string;
    table: string;
    new: Record<string, any>;
    old: Record<string, any>;
  },
  _rule: { show_fields?: string[]; check?: string } | null,
): string {
  const row = payload.eventType === "DELETE" ? payload.old : payload.new;
  const data = row?.data || {};
  const jsonData =
    typeof data === "string"
      ? (() => {
          try {
            return JSON.parse(data);
          } catch {
            return {};
          }
        })()
      : data;

  const formatTs = (v: any) => {
    if (!v) return "—";
    try {
      return new Date(v).toLocaleString("uk-UA", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return String(v);
    }
  };

  // Визначаємо розумну назву дії
  const checkStr = (_rule?.check || "").trim().toLowerCase();
  let action = "";

  // Розумне визначення статусу для date_off
  if (payload.eventType === "UPDATE" && checkStr.includes("date_off")) {
    const oldDateOff = payload.old?.date_off;
    const newDateOff = payload.new?.date_off;
    if (
      (oldDateOff == null || oldDateOff === "") &&
      newDateOff != null &&
      newDateOff !== ""
    ) {
      action = "🔴 Акт закрито";
    } else if (
      oldDateOff != null &&
      oldDateOff !== "" &&
      (newDateOff == null || newDateOff === "")
    ) {
      action = "🟢 Акт відкрито (повернено)";
    } else {
      action = "✏️ Дату закриття змінено";
    }
  } else {
    const eventLabels: Record<string, string> = {
      INSERT: "🟢 Додано",
      UPDATE: "✏️ Оновлено",
      DELETE: "🔴 Видалено",
    };
    action =
      (eventLabels[payload.eventType] || payload.eventType) +
      " • " +
      payload.table;
  }

  const lines: string[] = [];

  // Id
  const id =
    row?.act_id ||
    row?.client_id ||
    row?.slyusar_id ||
    row?.sclad_id ||
    row?.id;
  if (id) lines.push(`🔢 № ${id}`);

  // Карта полів для виводу
  const fieldMap: Record<string, string> = {
    ПІБ: "👤 Клієнт",
    Клієнт: "👤 Клієнт",
    Name: "👤 Ім'я",
    Назва: "📌 Назва",
    Телефон: "📞 Тел",
    Авто: "🚗 Авто",
    Марка: "🚗",
    Модель: "",
    "Держ. номер": "📍",
    Приймальник: "👷‍♂️",
    Слюсар: "🔧 Слюсар",
    "Загальна сума": "💰 Сума",
    "За роботу": "🔧 За роботу",
    "За деталі": "📦 За деталі",
    Посада: "💼 Посада",
    Кількість: "📊 Кількість",
    Ціна: "💰 Ціна",
  };

  // Якщо rule має show_fields — показуємо ТІЛЬКИ вказані поля
  // Якщо ні — показуємо всі з fieldMap
  const showFields = _rule?.show_fields;
  const fieldsToShow = showFields || Object.keys(fieldMap);

  for (const field of fieldsToShow) {
    const label = fieldMap[field] || field;
    const val =
      jsonData[field] ?? row?.[field.toLowerCase().replace(/ /g, "_")];
    if (val != null && String(val).trim() !== "") {
      if (Array.isArray(val)) continue; // масиви — тільки в diff
      lines.push(`${label}: ${val}`);
    }
  }

  // Хто виконав дію (Приймальник) — завжди для acts, якщо не в show_fields
  const performer = jsonData["Приймальник"];
  if (
    performer &&
    !fieldsToShow.includes("Приймальник") &&
    payload.table === "acts"
  ) {
    lines.push(`👷‍♂️ Виконав: ${performer}`);
  }

  // Дати — тільки якщо НЕ обмежено show_fields
  if (!showFields) {
    if (row?.date_off && !checkStr.includes("date_off"))
      lines.push(`📅 Закритий: ${formatTs(row.date_off)}`);
    if (row?.date_on) lines.push(`📅 Відкритий: ${formatTs(row.date_on)}`);
    if (row?.created_at && !row?.date_on && !row?.date_off)
      lines.push(`📅 ${formatTs(row.created_at)}`);
  }

  // Зміни (UPDATE)
  if (payload.eventType === "UPDATE" && payload.old) {
    const changedParts: string[] = [];
    for (const key of Object.keys(payload.new)) {
      const oldVal = payload.old[key],
        newVal = payload.new[key];
      if (
        JSON.stringify(oldVal) !== JSON.stringify(newVal) &&
        key !== "updated_at" &&
        key !== "data"
      ) {
        // date_off вже показано як статус
        if (key === "date_off" && checkStr.includes("date_off")) continue;
        const ts = (v: any) =>
          typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)
            ? formatTs(v)
            : String(v ?? "—");
        changedParts.push(`${key}: ${ts(oldVal)} → ${ts(newVal)}`);
      }
    }
    // Зміни в JSONB data
    if (payload.new.data && payload.old.data) {
      const dOld =
        typeof payload.old.data === "string"
          ? JSON.parse(payload.old.data)
          : payload.old.data;
      const dNew =
        typeof payload.new.data === "string"
          ? JSON.parse(payload.new.data)
          : payload.new.data;
      const allKeys = new Set([
        ...Object.keys(dOld || {}),
        ...Object.keys(dNew || {}),
      ]);
      for (const key of allKeys) {
        if (JSON.stringify(dOld?.[key]) !== JSON.stringify(dNew?.[key])) {
          const ov = dOld?.[key];
          const nv = dNew?.[key];
          if (Array.isArray(ov) && Array.isArray(nv)) {
            changedParts.push(diffArrays(key, ov, nv));
          } else if (Array.isArray(nv) && ov == null) {
            changedParts.push(diffArrays(key, [], nv));
          } else if (Array.isArray(ov) && nv == null) {
            changedParts.push(diffArrays(key, ov, []));
          } else {
            changedParts.push(`${key}: «${fmtVal(ov)}» → «${fmtVal(nv)}»`);
          }
        }
      }
    }
    if (changedParts.length > 0)
      lines.push(`\n📝 Зміни:\n${changedParts.join("\n")}`);
  }

  return `${action}\n${lines.join("\n") || "—"}`;
}

// Дедуплікація: пам’ять останніх унікальних ідентифікаторів payload
const sentPayloadIds = new Set<string>();

function initRealtimeMonitoring(): void {
  // Анулюємо всі старі підписки
  for (const ch of realtimeChannels) supabase.removeChannel(ch);
  realtimeChannels = [];
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  // Завантажимо активні Realtime-нагадування
  supabase
    .from("atlas_reminders")
    .select("*")
    .eq("status", "active")
    .eq("reminder_type", "conditional")
    .then(async ({ data: reminders }) => {
      if (!reminders?.length) return;

      // Групуємо нагадування за таблицями
      const tableReminderMap = new Map<string, any[]>();

      // Завантажимо імена створювачів для всіх нагадувань
      const creatorIds = [
        ...new Set(
          reminders
            .map((r: any) => Number(r.created_by))
            .filter((id: number) => id && !isNaN(id)),
        ),
      ];
      const creatorNames: Record<number, string> = {};
      if (creatorIds.length > 0) {
        const { data: creators, error: creatorsErr } = await supabase
          .from("slyusars")
          .select("slyusar_id, data")
          .in("slyusar_id", creatorIds);
        if (creatorsErr) {
        }
        if (creators) {
          for (const c of creators)
            creatorNames[c.slyusar_id] =
              c.data?.Name || c.data?.["Ім'я"] || "Невідомий";
        }
      }

      for (const rem of reminders) {
        try {
          const sched =
            typeof rem.schedule === "string"
              ? JSON.parse(rem.schedule)
              : rem.schedule;
          if (sched?.type !== "realtime") continue;
          // Додаємо creator_name якщо відсутній
          if (!rem.creator_name && rem.created_by) {
            rem.creator_name = creatorNames[rem.created_by] || "Невідомий";
          } else if (!rem.creator_name) {
            rem.creator_name = "Невідомий";
          }
          const rule = parseWatchRule(rem.condition_query);
          const tableName = rule?.table || "acts"; // за замовчуванням слухаємо acts
          if (!tableReminderMap.has(tableName))
            tableReminderMap.set(tableName, []);
          tableReminderMap.get(tableName)!.push({ rem, rule });
        } catch {
          /* */
        }
      }

      // для кожної таблиці — окремий channel
      for (const [tableName, entries] of tableReminderMap) {
        // Кешуємо events у верхньому регістрі одразу (не при кожному payload)
        const cachedEntries = entries.map(({ rem, rule }) => ({
          rem,
          rule,
          eventsUpper:
            rule?.events?.map((e: string) => e.toUpperCase()) || null,
          isForUser: isReminderForUser(rem, currentSlyusarId!),
        }));

        const ch = supabase
          .channel(`rt-${tableName}-${Date.now()}`)
          .on(
            "postgres_changes" as any,
            { event: "*", schema: "public", table: tableName },
            async (payload: any) => {
              // Дедуплікація: БЕЗ Date.now() — щоб одна і та ж подія не оброблялась двічі
              const rowId = `${payload.eventType}:${payload.table}:${payload.new?.act_id || payload.new?.id || payload.old?.act_id || payload.old?.id || "?"}`;
              if (sentPayloadIds.has(rowId)) return;
              sentPayloadIds.add(rowId);
              setTimeout(() => sentPayloadIds.delete(rowId), 10_000);

              for (const {
                rem,
                rule,
                eventsUpper,
                isForUser,
              } of cachedEntries) {
                try {
                  if (!isForUser) continue;

                  // Перевірити подію (кешоване порівняння)
                  if (eventsUpper && !eventsUpper.includes(payload.eventType))
                    continue;

                  // Перевірити умову check (без запитів до БД)
                  if (
                    !evalCheck(
                      rule?.check,
                      payload.new || {},
                      payload.old || {},
                    )
                  )
                    continue;

                  // Формуємо повідомлення (без запитів — тільки з payload)
                  const resultText = formatPayloadMessage(payload, rule);
                  rem.meta = rem.meta || {};
                  rem.meta.condition_result_text = resultText;

                  // Toast (миттєво, без запитів)
                  if (rem.channel === "app" || rem.channel === "both")
                    showReminderToast(rem);

                  // Паралельно: оновити лічильник + записати лог + Telegram
                  const dbPromises: PromiseLike<any>[] = [
                    supabase
                      .from("atlas_reminders")
                      .update({
                        trigger_count: (rem.trigger_count || 0) + 1,
                        last_triggered_at: new Date().toISOString(),
                      })
                      .eq("reminder_id", rem.reminder_id)
                      .then(() => {}),
                    supabase
                      .from("atlas_reminder_logs")
                      .insert({
                        reminder_id: rem.reminder_id,
                        recipient_id: currentSlyusarId,
                        channel:
                          rem.channel === "telegram" ? "telegram" : "app",
                        message_text: `🔴 ${rem.title} | ${resultText.substring(0, 100)}`,
                        delivery_status: "delivered",
                      })
                      .then(() => {}),
                  ];

                  if (rem.channel === "telegram" || rem.channel === "both") {
                    dbPromises.push(sendTelegramForReminder(rem));
                  }

                  await Promise.all(dbPromises);
                } catch (innerErr) {}
              }
            },
          )
          .subscribe(() => {});

        realtimeChannels.push(ch);
      }
      realtimeChannel = realtimeChannels[0] || null;
    });
}

// ── Позначити нагадування як спрацьоване ──

async function markTriggered(
  reminderId: number,
  delivered: boolean,
  note?: string,
  channel: "app" | "telegram" = "app",
): Promise<void> {
  try {
    // 1. Записати лог доставки
    await supabase.from("atlas_reminder_logs").insert({
      reminder_id: reminderId,
      recipient_id: currentSlyusarId,
      channel: channel,
      message_text: note || (delivered ? "Показано в додатку" : "Пропущено"),
      delivery_status: delivered ? "sent" : "failed",
      error_message: delivered ? null : note || null,
    });

    // 2. Оновити trigger (next_trigger_at, count, status)
    if (delivered) {
      await supabase.rpc("trigger_reminder", {
        p_reminder_id: reminderId,
      });
    }
  } catch (err) {}
}

// ═══════════════════════════════════════════════════════
// 🎨 TOAST UI
// ═══════════════════════════════════════════════════════

interface DueReminder {
  reminder_id: number;
  title: string;
  description: string | null;
  reminder_type: string;
  recipients: any;
  channel: string;
  priority: string;
  condition_query: string | null;
  schedule: any;
  trigger_count: number;
  created_by: number | null;
  creator_name: string;
  meta: any;
}

function ensureToastContainer(): void {
  if (toastContainer && document.body.contains(toastContainer)) return;

  toastContainer = document.createElement("div");
  toastContainer.id = "atlas-reminder-toasts";
  toastContainer.className = "atlas-reminder-toasts";
  document.body.appendChild(toastContainer);
}

function showReminderToast(reminder: DueReminder): void {
  ensureToastContainer();

  // Обмеження кількості видимих toast
  if (activeToasts.length >= MAX_TOASTS_VISIBLE) {
    const oldest = activeToasts.shift();
    oldest?.remove();
  }

  const toast = document.createElement("div");
  toast.className = `atlas-reminder-toast atlas-reminder-toast--${reminder.priority}`;
  toast.setAttribute("data-reminder-id", String(reminder.reminder_id));

  const icon = getPriorityIcon(reminder.priority);
  const typeLabel = getTypeLabel(reminder.reminder_type);
  const timeStr = new Date().toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });

  toast.innerHTML = `
    <div class="atlas-reminder-toast__header">
      <span class="atlas-reminder-toast__icon">${icon}</span>
      <span class="atlas-reminder-toast__title">${escapeHtml(reminder.title)}</span>
      <button class="atlas-reminder-toast__close" title="Закрити">&times;</button>
    </div>
    ${
      reminder.description
        ? `<div class="atlas-reminder-toast__body">${escapeHtml(reminder.description)}</div>`
        : ""
    }
    <div class="atlas-reminder-toast__footer">
      <span class="atlas-reminder-toast__type">${typeLabel}</span>
      <span class="atlas-reminder-toast__time">${timeStr}</span>
      <span class="atlas-reminder-toast__author">від ${escapeHtml(reminder.creator_name)}</span>
    </div>
  `;

  // Кнопка закриття
  const closeBtn = toast.querySelector(".atlas-reminder-toast__close");
  closeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissToast(toast);
  });

  // Пауза анімації при hover
  toast.addEventListener("mouseenter", () => {
    toast.classList.add("atlas-reminder-toast--hovered");
  });
  toast.addEventListener("mouseleave", () => {
    toast.classList.remove("atlas-reminder-toast--hovered");
  });

  // Клік → відкрити планувальник
  toast.addEventListener("click", () => {
    openPlannerTab();
    dismissToast(toast);
  });

  // Додати в контейнер
  toastContainer!.appendChild(toast);
  activeToasts.push(toast);

  // Звуковий сигнал
  if (SOUND_ENABLED) {
    playNotificationSound(reminder.priority);
  }

  // Запитати дозвіл на браузерні сповіщення (один раз)
  requestBrowserNotification(reminder);

  // Анімація появи
  requestAnimationFrame(() => {
    toast.classList.add("atlas-reminder-toast--visible");
  });

  // Перерахувати позиції
  repositionToasts();

  // Авто-зникнення (якщо не hovered)
  const autoHideTimer = setTimeout(() => {
    if (!toast.classList.contains("atlas-reminder-toast--hovered")) {
      dismissToast(toast);
    } else {
      // Якщо hover — чекаємо ще
      const waitForLeave = () => {
        toast.removeEventListener("mouseleave", waitForLeave);
        setTimeout(() => dismissToast(toast), 2000);
      };
      toast.addEventListener("mouseleave", waitForLeave);
    }
  }, TOAST_DISPLAY_MS);

  // Зберегти timer щоб можна було скасувати
  (toast as any)._autoHideTimer = autoHideTimer;
}

function dismissToast(toast: HTMLElement): void {
  toast.classList.remove("atlas-reminder-toast--visible");
  toast.classList.add("atlas-reminder-toast--hiding");

  const timer = (toast as any)._autoHideTimer;
  if (timer) clearTimeout(timer);

  setTimeout(() => {
    const idx = activeToasts.indexOf(toast);
    if (idx !== -1) activeToasts.splice(idx, 1);
    toast.remove();
    repositionToasts();
  }, 400);
}

function repositionToasts(): void {
  let offset = 0;
  for (const toast of activeToasts) {
    toast.style.transform = `translateY(${offset}px)`;
    offset += toast.offsetHeight + TOAST_STACK_GAP;
  }
}

// ── Утиліти ──

function getPriorityIcon(priority: string): string {
  switch (priority) {
    case "urgent":
      return "🚨";
    case "high":
      return "🔴";
    case "normal":
      return "🔔";
    case "low":
      return "💤";
    default:
      return "🔔";
  }
}

function getTypeLabel(type: string): string {
  switch (type) {
    case "once":
      return "⏰ Одноразове";
    case "recurring":
      return "🔄 Повторюване";
    case "conditional":
      return "📊 За умовою";
    default:
      return type;
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ── Звук сповіщення ──

function playNotificationSound(priority: string): void {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Різні звуки для різних пріоритетів
    if (priority === "urgent") {
      // Три швидкі біпи
      oscillator.frequency.value = 880;
      gainNode.gain.value = 0.15;
      oscillator.start(ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      oscillator.stop(ctx.currentTime + 0.15);

      // Другий біп
      setTimeout(() => {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.frequency.value = 1100;
        gain2.gain.value = 0.15;
        osc2.start(ctx.currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc2.stop(ctx.currentTime + 0.15);
      }, 200);

      // Третій біп
      setTimeout(() => {
        const osc3 = ctx.createOscillator();
        const gain3 = ctx.createGain();
        osc3.connect(gain3);
        gain3.connect(ctx.destination);
        osc3.frequency.value = 1320;
        gain3.gain.value = 0.15;
        osc3.start(ctx.currentTime);
        gain3.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc3.stop(ctx.currentTime + 0.15);
      }, 400);
    } else if (priority === "high") {
      // Два біпи
      oscillator.frequency.value = 660;
      gainNode.gain.value = 0.12;
      oscillator.start(ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      oscillator.stop(ctx.currentTime + 0.2);

      setTimeout(() => {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.frequency.value = 880;
        gain2.gain.value = 0.12;
        osc2.start(ctx.currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc2.stop(ctx.currentTime + 0.2);
      }, 250);
    } else {
      // Один м'який біп
      oscillator.frequency.value = 523;
      oscillator.type = "sine";
      gainNode.gain.value = 0.08;
      oscillator.start(ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      oscillator.stop(ctx.currentTime + 0.3);
    }
  } catch {
    // AudioContext може бути заблокований
  }
}

// ── Браузерне сповіщення (як бонус) ──

function requestBrowserNotification(reminder: DueReminder): void {
  if (notificationPermissionAsked) return;
  notificationPermissionAsked = true;

  if (!("Notification" in window)) return;

  if (Notification.permission === "granted") {
    showBrowserNotification(reminder);
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") {
        showBrowserNotification(reminder);
      }
    });
  }
}

function showBrowserNotification(reminder: DueReminder): void {
  try {
    const icon = getPriorityIcon(reminder.priority);
    new Notification(`${icon} ${reminder.title}`, {
      body: reminder.description || "Нагадування від Атласа",
      icon: "/src/ikons/atlas-icon.png",
      tag: `reminder-${reminder.reminder_id}`,
      requireInteraction: reminder.priority === "urgent",
    });
  } catch {
    // Не критично
  }
}

// ── Відкрити планувальник ──

function openPlannerTab(): void {
  // Відкрити AI-чат якщо закритий
  const chatWindow = document.querySelector(
    ".ai-chat-window",
  ) as HTMLElement | null;
  if (chatWindow && chatWindow.classList.contains("hidden")) {
    const chatBtn = document.getElementById(
      "ai-chat-open-btn",
    ) as HTMLElement | null;
    chatBtn?.click();
  }

  // Переключити на вкладку "Планувальник"
  setTimeout(() => {
    const plannerTab = document.querySelector(
      '[data-tab="planner"]',
    ) as HTMLElement | null;
    plannerTab?.click();
  }, 300);
}
