// src/ts/roboha/zakaz_naraudy/actPresence.ts
// 🔐 Серверний lock на акт через БД (acquire_act_lock / release_act_lock)
// + Realtime підписка на таблицю act_locks для миттєвого реагування
import { supabase } from "../../vxid/supabaseClient";
import { userName as currentUserName } from "../tablucya/users";
import { showNotification } from "./inhi/vspluvauhe_povidomlenna";

// ═══════════════════════════════════════════════════════
// Стан модуля
// ═══════════════════════════════════════════════════════
let currentActId: number | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let realtimeChannel: any = null;
let broadcastChannel: any = null;

// ✏️ Глобальний канал для відображення хто редагує акти в таблиці
let globalPresenceChannel: any = null;

// TTL серверного lock-а (секунди). Heartbeat оновлює кожні 30 с.
const LOCK_TTL_SECONDS = 90;
// Heartbeat: кожні 30 секунд відправляємо acquire (оновлює heartbeat_at)
const HEARTBEAT_MS = 30_000;
// Інтервал polling-перевірки для заблокованого юзера (кожні 5 с)
const POLL_MS = 5_000;
let pollTimer: ReturnType<typeof setInterval> | null = null;
// Колбек при розблокуванні
let onUnlockCallback: (() => Promise<void> | void) | null = null;

function waitForChannelSubscribed(channel: any): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;

    channel.subscribe((status: string) => {
      if (!resolved && status === "SUBSCRIBED") {
        resolved = true;
        resolve();
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }, 1500);
  });
}

// ═══════════════════════════════════════════════════════
// RPC виклики до Supabase
// ═══════════════════════════════════════════════════════
async function rpcAcquire(
  actId: number,
  userName: string,
): Promise<{ acquired: boolean; locked_by: string; opened_at: string }> {
  const { data, error } = await supabase.rpc("acquire_act_lock", {
    p_act_id: actId,
    p_user_name: userName,
    p_ttl_seconds: LOCK_TTL_SECONDS,
  });
  if (error) throw error;
  return data as { acquired: boolean; locked_by: string; opened_at: string };
}

async function rpcRelease(actId: number, userName: string): Promise<void> {
  await supabase.rpc("release_act_lock", {
    p_act_id: actId,
    p_user_name: userName,
  });
}

// ═══════════════════════════════════════════════════════
// Heartbeat (власник lock-а оновлює heartbeat_at кожні 30 с)
// ═══════════════════════════════════════════════════════
function startOwnerHeartbeat(actId: number): void {
  stopOwnerHeartbeat();
  heartbeatTimer = setInterval(async () => {
    try {
      await rpcAcquire(actId, currentUserName || "Unknown");
    } catch {
      /* silent */
    }
  }, HEARTBEAT_MS);
}

function stopOwnerHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ═══════════════════════════════════════════════════════
// Polling для заблокованого юзера (перевірка чи lock звільнився)
// ═══════════════════════════════════════════════════════
function startLockPolling(actId: number): void {
  stopLockPolling();
  pollTimer = setInterval(async () => {
    try {
      const res = await rpcAcquire(actId, currentUserName || "Unknown");
      if (res.acquired) {
        // Lock звільнився і ми його отримали!
        stopLockPolling();
        unlockActInterface();
        startOwnerHeartbeat(actId);
        trackGlobalActPresence(actId);
        if (onUnlockCallback) onUnlockCallback();
      }
    } catch {
      /* silent */
    }
  }, POLL_MS);
}

function stopLockPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ═══════════════════════════════════════════════════════
// Realtime підписка на таблицю act_locks (DELETE → миттєва реакція)
// ═══════════════════════════════════════════════════════
function subscribeToActLocksRealtime(actId: number): void {
  unsubscribeFromActLocksRealtime();

  realtimeChannel = supabase
    .channel(`act_locks_watch_${actId}`)
    .on(
      "postgres_changes" as any,
      {
        event: "DELETE",
        schema: "public",
        table: "act_locks",
        filter: `act_id=eq.${actId}`,
      },
      async () => {
        // Lock видалено — пробуємо захопити
        try {
          const res = await rpcAcquire(actId, currentUserName || "Unknown");
          if (res.acquired) {
            stopLockPolling();
            unlockActInterface();
            startOwnerHeartbeat(actId);
            trackGlobalActPresence(actId);
            if (onUnlockCallback) onUnlockCallback();
          }
        } catch {
          /* silent */
        }
      },
    )
    .on(
      "postgres_changes" as any,
      {
        event: "UPDATE",
        schema: "public",
        table: "act_locks",
        filter: `act_id=eq.${actId}`,
      },
      () => {
        /* heartbeat update – ігноруємо */
      },
    )
    .subscribe();
}

function unsubscribeFromActLocksRealtime(): void {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

// ═══════════════════════════════════════════════════════
// Broadcast канал для "тихого" оновлення (act_saved)
// ═══════════════════════════════════════════════════════
function subscribeToBroadcast(actId: number): void {
  unsubscribeFromBroadcast();
  broadcastChannel = supabase.channel(`act_broadcast_${actId}`);
  broadcastChannel
    .on("broadcast", { event: "act_saved" }, async (payload: any) => {
      const header = document.querySelector(
        ".zakaz_narayd-header",
      ) as HTMLElement;
      const isLocked = header && header.hasAttribute("data-locked");
      if (isLocked) {
        try {
          const { refreshActTableSilently } = await import("./modalMain");
          const receivedActId =
            payload?.payload?.actId || payload?.actId || actId;
          await refreshActTableSilently(receivedActId);
        } catch {
          /* silent */
        }
      }
    })
    .subscribe();
}

function unsubscribeFromBroadcast(): void {
  if (broadcastChannel) {
    supabase.removeChannel(broadcastChannel);
    broadcastChannel = null;
  }
}

// ═══════════════════════════════════════════════════════
// Глобальний Presence канал (для відображення ✏️ в таблиці)
// ═══════════════════════════════════════════════════════
async function trackGlobalActPresence(actId: number): Promise<void> {
  if (!globalPresenceChannel) {
    globalPresenceChannel = supabase.channel("global_acts_presence", {
      config: { presence: { key: currentUserName || "Unknown" } },
    });
    await waitForChannelSubscribed(globalPresenceChannel);
  }

  await globalPresenceChannel.track({
    actId,
    userName: currentUserName || "Unknown",
    openedAt: new Date().toISOString(),
  });
}

async function untrackGlobalActPresence(): Promise<void> {
  if (globalPresenceChannel) {
    try {
      await globalPresenceChannel.untrack();
    } catch {
      /* silent */
    }
  }
}

function resetLockUiState(): void {
  const header = document.querySelector(".zakaz_narayd-header") as HTMLElement;
  if (header) {
    header.style.backgroundColor = "";
    header.removeAttribute("data-locked");
    header.removeAttribute("data-locked-by");
  }

  removeLockOverlay();
}

// ═══════════════════════════════════════════════════════
// Обробники закриття сторінки / visibility
// ═══════════════════════════════════════════════════════
function handlePageUnload(): void {
  stopOwnerHeartbeat();
  stopLockPolling();
  if (currentActId) {
    // Fire-and-forget release. Якщо не встигне — TTL (90с) очистить lock.
    rpcRelease(currentActId, currentUserName || "Unknown").catch(() => {});
  }
  unsubscribeFromActLocksRealtime();
  unsubscribeFromBroadcast();
  if (globalPresenceChannel) {
    try {
      globalPresenceChannel.untrack();
      supabase.removeChannel(globalPresenceChannel);
      globalPresenceChannel = null;
    } catch {
      /* silent */
    }
  }
}

window.addEventListener("beforeunload", handlePageUnload);
window.addEventListener("pagehide", handlePageUnload);

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && currentActId) {
    // Комп прокинувся — відразу acquire
    try {
      const res = await rpcAcquire(currentActId, currentUserName || "Unknown");
      if (res.acquired) {
        unlockActInterface();
        startOwnerHeartbeat(currentActId);
      } else {
        lockActInterface(res.locked_by);
        startLockPolling(currentActId);
      }
    } catch {
      /* silent */
    }
  }
});

// ═══════════════════════════════════════════════════════
// ГОЛОВНА ФУНКЦІЯ: підписка на lock акту
// ═══════════════════════════════════════════════════════
export async function subscribeToActPresence(
  actId: number,
  onUnlock?: () => Promise<void> | void,
): Promise<{ isLocked: boolean; lockedBy: string | null }> {
  resetLockUiState();

  // 🔐 Зберігаємо старий actId для примусового release (навіть якщо close не встиг)
  const oldActId = currentActId;

  // Зупиняємо все від попереднього акту
  stopOwnerHeartbeat();
  stopLockPolling();
  unsubscribeFromActLocksRealtime();
  unsubscribeFromBroadcast();

  // Примусово release старого lock-а (якщо був)
  if (oldActId && oldActId !== actId) {
    try {
      await rpcRelease(oldActId, currentUserName || "Unknown");
    } catch {
      /* silent */
    }
    await untrackGlobalActPresence();
  }

  currentActId = actId;
  onUnlockCallback = onUnlock || null;

  // 1) Пробуємо захопити серверний lock
  const res = await rpcAcquire(actId, currentUserName || "Unknown");

  // 2) Підписуємося на Realtime та Broadcast
  subscribeToActLocksRealtime(actId);
  subscribeToBroadcast(actId);

  if (res.acquired) {
    // Ми — власник lock-а
    resetLockUiState();
    startOwnerHeartbeat(actId);
    await trackGlobalActPresence(actId);
    return { isLocked: false, lockedBy: null };
  } else {
    // Акт заблоковано іншим користувачем
    lockActInterface(res.locked_by);
    startLockPolling(actId);
    subscribeToActLocksRealtime(actId);
    return { isLocked: true, lockedBy: res.locked_by };
  }
}

// ═══════════════════════════════════════════════════════
// Відписка (при закритті модалки)
// ═══════════════════════════════════════════════════════
export async function unsubscribeFromActPresence(): Promise<void> {
  // 🔐 Захоплюємо actId синхронно, щоб не було race condition
  const actIdToRelease = currentActId;
  currentActId = null;
  onUnlockCallback = null;

  stopOwnerHeartbeat();
  stopLockPolling();
  unsubscribeFromActLocksRealtime();
  unsubscribeFromBroadcast();

  if (actIdToRelease) {
    try {
      await rpcRelease(actIdToRelease, currentUserName || "Unknown");
    } catch {
      /* silent */
    }
  }

  await untrackGlobalActPresence();
}

// ═══════════════════════════════════════════════════════
// Broadcast: сповіщення, що акт збережено
// ═══════════════════════════════════════════════════════
export async function notifyActSaved(actId: number): Promise<void> {
  if (broadcastChannel) {
    await broadcastChannel.send({
      type: "broadcast",
      event: "act_saved",
      payload: { actId },
    });
  }
}

// ═══════════════════════════════════════════════════════
// LOCK UI: блокування всієї модалки
// ═══════════════════════════════════════════════════════
const LOCK_OVERLAY_ID = "act-lock-overlay";

export function lockActInterface(lockedByUser: string): void {
  const header = document.querySelector(".zakaz_narayd-header") as HTMLElement;
  if (header && header.getAttribute("data-locked-by") === lockedByUser) return;

  // Показуємо повідомлення
  showNotification(
    `⚠️ Акт редагується: ${lockedByUser}. Режим перегляду.`,
    "warning",
    5000,
  );

  // Червоний header
  if (header) {
    header.style.backgroundColor = "#dc3545";
    header.setAttribute("data-locked", "true");
    header.setAttribute("data-locked-by", lockedByUser);
  }

  // Створюємо overlay поверх всього контенту модалки
  createLockOverlay(lockedByUser);
}

function unlockActInterface(): void {
  const header = document.querySelector(".zakaz_narayd-header") as HTMLElement;
  if (header && !header.hasAttribute("data-locked")) return;

  showNotification("✅ Акт тепер доступний для редагування", "success", 3000);

  if (header) {
    header.style.backgroundColor = "";
    header.removeAttribute("data-locked");
    header.removeAttribute("data-locked-by");
  }

  removeLockOverlay();
}

// ═══════════════════════════════════════════════════════
// 🔒 Overlay: повністю блокує модалку
// ═══════════════════════════════════════════════════════
function createLockOverlay(lockedByUser: string): void {
  removeLockOverlay();

  const modalContent = document.querySelector(
    ".zakaz_narayd-modal-content",
  ) as HTMLElement;
  if (!modalContent) return;

  const overlay = document.createElement("div");
  overlay.id = LOCK_OVERLAY_ID;
  overlay.innerHTML = `<div class="act-lock-overlay-text">🔒 Акт редагується: <strong>${lockedByUser}</strong></div>`;

  // Блокуємо всі кліки, скрол, та інші дії
  overlay.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  overlay.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  overlay.addEventListener("touchstart", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  overlay.addEventListener("keydown", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  overlay.addEventListener(
    "wheel",
    (e) => {
      e.stopPropagation();
      e.preventDefault();
    },
    { passive: false },
  );
  overlay.addEventListener("contextmenu", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });

  modalContent.appendChild(overlay);
}

function removeLockOverlay(): void {
  const overlay = document.getElementById(LOCK_OVERLAY_ID);
  if (overlay) overlay.remove();
}
