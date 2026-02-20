import { supabase } from "../../vxid/supabaseClient";
import { showNotification } from "../zakaz_naraudy/inhi/vspluvauhe_povidomlenna";
import { resetPercentCache } from "../zakaz_naraudy/inhi/kastomna_tabluca";
import {
  invalidateGlobalDataCache,
  globalCache,
  saveGeneralSettingsToLocalStorage,
  applyWallpapers,
} from "../zakaz_naraudy/globalCache";
import { resetAISettingsCache } from "../ai/aiService";

const SETTINGS = {
  1: { id: "toggle-shop", label: "ПІБ _ Магазин", class: "_shop" },
  2: { id: "toggle-receiver", label: "Каталог", class: "_receiver" },
  3: { id: "toggle-zarplata", label: "Зарплата", class: "_zarplata" },
  4: {
    id: "percentage-value",
    label: "Націнка на запчастина",
    class: "_percentage",
  },
  5: { id: "toggle-sms", label: "SMS", class: "_sms" },
  6: { id: "toggle-print", label: "Шапка акту в кольорі", class: "_print" },
  7: { id: "toggle-ai", label: "🤖 ШІ підказки", class: "_ai" },
  8: { id: "toggle-phone-admin", label: "📞 Телефон", class: "_phone" },
};

const ROLES = [
  "Адміністратор",
  "Приймальник",
  "Слюсар",
  "Запчастист",
  "Складовщик",
  "Загальні",
];

const ROLE_COLORS = {
  Адміністратор: {
    button: "linear-gradient(135deg, #4caf50 0%, #45a049 100%)",
    buttonHover: "linear-gradient(135deg, #45a049 0%, #3d8b40 100%)",
    border: "#4caf50",
    "modal-window": "#4caf50",
  },
  Приймальник: {
    button: "linear-gradient(135deg, #2196F3 0%, #1976D2 100%)",
    buttonHover: "linear-gradient(135deg, #1976D2 0%, #1565C0 100%)",
    border: "#2196F3",
    "modal-window": "#2196F3",
  },
  Слюсар: {
    button: "linear-gradient(135deg, #FF9800 0%, #F57C00 100%)",
    buttonHover: "linear-gradient(135deg, #F57C00 0%, #E65100 100%)",
    border: "#FF9800",
    "modal-window": "#FF9800",
  },
  Запчастист: {
    button: "linear-gradient(135deg, #9C27B0 0%, #7B1FA2 100%)",
    buttonHover: "linear-gradient(135deg, #7B1FA2 0%, #6A1B9A 100%)",
    border: "#9C27B0",
    "modal-window": "#9C27B0",
  },
  Складовщик: {
    button: "linear-gradient(135deg, #F44336 0%, #D32F2F 100%)",
    buttonHover: "linear-gradient(135deg, #D32F2F 0%, #C62828 100%)",
    border: "#F44336",
    "modal-window": "#F44336",
  },
  Загальні: {
    button: "linear-gradient(135deg, #607D8B 0%, #455A64 100%)",
    buttonHover: "linear-gradient(135deg, #455A64 0%, #37474F 100%)",
    border: "#607D8B",
    "modal-window": "#607D8B",
  },
};

const ROLE_SETTINGS = {
  Приймальник: [
    { id: 1, label: "Налаштування" },
    { divider: true },
    { id: 2, label: "Додати" },
    { id: 3, label: "Додати Співробітники" },
    { divider: true },
    { id: 4, label: "Бухгалтерія" },
    { id: 5, label: "Бухгалтерія 🏪 Склад" },
    { id: 6, label: "Бухгалтерія 🏪 Склад розраховувати💲" },
    { id: 7, label: "Бухгалтерія 🏪 Склад відміна розраховувати 💰" },
    { id: 8, label: "Бухгалтерія 🏪 Склад ↩️ повертати в магазин ⬅️🚚" },
    {
      id: 9,
      label: "Бухгалтерія 🏪 Склад ↩️ відміна повернення в магазин 🚚➡️",
    },
    //{ id: 10, label: "Бухгалтерія 👨‍🔧 Зарплата" },
    //{ id: 11, label: "Бухгалтерія 👨‍🔧 Зарплата розраховувати💲" },
    //{ id: 12, label: "Бухгалтерія 👨‍🔧 Зарплата відміна розраховувати 💰" },
    { id: 13, label: "Бухгалтерія ⚙️ Деталі" },
    { divider: true },
    { id: 14, label: "📋 Акт Зарплата 💲" },
    { id: 15, label: "📋 Акт Ціна та Сума" },
    { id: 16, label: "📋 Акт Закриття акту із зауваженнями ⚠️" },
    { id: 17, label: "📋 Акт Відкриття акту 🔒" },
    { id: 18, label: "📋 Акт Створити Рахунок і Акт виконаних робіт 🗂️" },
    { id: 19, label: "📋 Акт Створити PDF Акту 🖨️" },
    { id: 20, label: "📋 Акт SMS ✉️" },
    { divider: true },
    { id: 21, label: "Планування" },
    { divider: true },
    { id: 22, label: "Акти Телефон 📞" },
  ],
  Слюсар: [
    { id: 1, label: "📋 Акт Зарплата 💲" },
    { id: 2, label: "📋 Акт Ціна та Сума" },
    { id: 3, label: "📋 Акт Завершення робіт 🗝️" },
    { divider: true },
    { id: 6, label: "Планування" },
    { divider: true },
    { id: 7, label: "Акти Телефон 📞" },
  ],
  Запчастист: [
    { id: 1, label: "Додати" },
    { divider: true },
    { id: 2, label: "Бухгалтерія" },
    //{ id: 3, label: "Бухгалтерія 👨‍🔧 Зарплата" },
    //{ id: 4, label: "Бухгалтерія 👨‍🔧 Зарплата розраховувати💲" },
    //{ id: 5, label: "Бухгалтерія 👨‍🔧 Зарплата відміна розраховувати 💰" },
    { id: 6, label: "Бухгалтерія 🏪 Склад" },
    { id: 7, label: "Бухгалтерія 🏪 Склад розраховувати💲" },
    { id: 8, label: "Бухгалтерія 🏪 Склад відміна розраховувати 💰" },
    { id: 9, label: "Бухгалтерія 🏪 Склад ↩️ повертати в магазин ⬅️🚚" },
    {
      id: 10,
      label: "Бухгалтерія 🏪 Склад відміна ↩️ повернення в магазин 🚚➡️",
    },
    { id: 11, label: "Бухгалтерія ⚙️ Деталі" },
    { divider: true },
    { id: 12, label: "Відображати всі Акти 📋" },
    { id: 13, label: "Відображати Акт 📋" },
    { divider: true },
    { id: 14, label: "📋 Акт Зарплата" },
    { id: 15, label: "📋 Акт Ціна та Сума" },
    { id: 16, label: "📋 Акт Зариття акту 🗝️" },
    { id: 17, label: "📋 Акт Закриття акту із зауваженнями ⚠️" },
    { id: 18, label: "📋 Акт Відкриття акту 🔒" },
    { id: 19, label: "📋 Акт Створити Рахунок і Акт виконаних робіт 🗂️" },
    { id: 20, label: "📋 Акт Створити PDF Акту 🖨️" },
    { id: 21, label: "📋 Акт SMS ✉️" },
    { id: 22, label: "📋 Акт ➕ Додати рядок 💾 Зберегти зміни 🗑️ Видалити" },
    { divider: true },
    { id: 23, label: "Планування" },
    { divider: true },
    { id: 24, label: "Акти Телефон 📞" },
  ],
  Складовщик: [
    { id: 1, label: "Додати" },
    { id: 2, label: "Додати Співробітники" },
    { divider: true },
    //{ id: 3, label: "Бухгалтерія 🏪 Склад" },
    { id: 4, label: "Бухгалтерія 🏪 Склад розраховувати💲" },
    { id: 5, label: "Бухгалтерія 🏪 Склад відміна розраховувати 💰" },
    { id: 6, label: "Бухгалтерія 🏪 Склад ↩️ повертати в магазин ⬅️🚚" },
    {
      id: 7,
      label: "Бухгалтерія 🏪 Склад ↩️ відміна повернення в магазин 🚚➡️",
    },
    { id: 8, label: "Бухгалтерія ⚙️ Деталі" },
    { divider: true },
    { id: 9, label: "Відображати всі Акти" },
    { id: 10, label: "Відображати Акт" },
    { divider: true },
    { id: 11, label: "📋 Акт Зарплата 💲" },
    { id: 12, label: "📋 Акт Ціна та Сума" },
    { id: 13, label: "📋 Акт Закриття акту 🗝️" },
    { id: 14, label: "📋 Акт Закриття акту із зауваженнями ⚠️" },
    { id: 15, label: "📋 Акт Відкриття акту 🔒" },
    { id: 16, label: "📋 Акт Створити Рахунок і Акт виконаних робіт 🗂️" },
    { id: 17, label: "📋 Акт Створити PDF Акту 🖨️" },
    { id: 18, label: "📋 Акт SMS ✉️" },
    { id: 19, label: "📋 Акт ➕ Додати рядок 💾 Зберегти зміни 🗑️ Видалити" },
    { divider: true },
    { id: 20, label: "Планування" },
    { divider: true },
    { id: 21, label: "Акти Телефон 📞" },
  ],
};

// 📞 Конфігурація setting_id для налаштування "Телефон" по ролям
const PHONE_SETTINGS_MAP: Record<
  string,
  { settingId: number; toggleId: number }
> = {
  Адміністратор: { settingId: 8, toggleId: 8 },
  Приймальник: { settingId: 22, toggleId: 22 },
  Слюсар: { settingId: 7, toggleId: 7 },
  Запчастист: { settingId: 24, toggleId: 24 },
  Складовщик: { settingId: 21, toggleId: 21 },
};

const ROLE_TO_COLUMN = {
  Адміністратор: "data",
  Приймальник: "Приймальник",
  Слюсар: "Слюсар",
  Запчастист: "Запчастист",
  Складовщик: "Складовщик",
  Загальні: "Загальні",
};

// 🔹 Зберігає початковий стан налаштувань при відкритті модалки
let initialSettingsState: Map<number | string, boolean | number | string> =
  new Map();

// 🔹 Масив ID складів, які потрібно видалити (procent → null) при збереженні
let pendingDeletedWarehouseIds: Set<number> = new Set();

// 🔹 Масив ID складів, які потрібно заморозити (procent → -1) при збереженні
let pendingFrozenWarehouseIds: Set<number> = new Set();

// 🔹 Масив ID складів, які потрібно активувати (procent → значення з input) при збереженні
let pendingUnfrozenWarehouseIds: Set<number> = new Set();

// Константа за замовчуванням для кольорів
const DEFAULT_COLOR = "#164D25";

/**
 * 📞 Завантажує та застосовує налаштування відображення індикатора дзвінків
 * Викликати при завантаженні сторінки після авторизації
 */
export async function loadAndApplyPhoneIndicatorSetting(): Promise<void> {
  try {
    // Отримуємо роль користувача з localStorage
    const USER_DATA_KEY = "userAuthData";
    const storedData = localStorage.getItem(USER_DATA_KEY);
    if (!storedData) return;

    const userData = JSON.parse(storedData);
    const role = userData?.["Доступ"] as string;

    if (!role || !PHONE_SETTINGS_MAP[role]) {
      // Якщо роль невідома, показуємо індикатори за замовчуванням
      applyPhoneIndicatorVisibility(true);
      return;
    }

    const { settingId } = PHONE_SETTINGS_MAP[role];
    const column = ROLE_TO_COLUMN[role as keyof typeof ROLE_TO_COLUMN];

    if (!column) {
      applyPhoneIndicatorVisibility(true);
      return;
    }

    // Завантажуємо налаштування з БД
    const { data, error } = await supabase
      .from("settings")
      .select(`"${column}"`)
      .eq("setting_id", settingId)
      .single();

    if (error && error.code !== "PGRST116") {
      console.warn("Помилка завантаження налаштування телефону:", error);
      applyPhoneIndicatorVisibility(true);
      return;
    }

    // Якщо запису немає або значення true - показуємо індикатори
    const showIndicators = data ? !!data[column] : true;
    applyPhoneIndicatorVisibility(showIndicators);
  } catch (err) {
    console.error("Помилка застосування налаштування телефону:", err);
    applyPhoneIndicatorVisibility(true);
  }
}

/**
 * Застосовує видимість індикаторів дзвінків через CSS клас на body
 */
function applyPhoneIndicatorVisibility(show: boolean): void {
  if (show) {
    document.body.classList.remove("hide-call-indicators");
  } else {
    document.body.classList.add("hide-call-indicators");
  }
}

// ============================================================
// 🔄 REALTIME СИНХРОНІЗАЦІЯ НАЛАШТУВАНЬ
// ============================================================

let settingsRealtimeChannel: ReturnType<typeof supabase.channel> | null = null;

/**
 * Підписка на Realtime зміни в таблиці settings
 * Викликати один раз при ініціалізації системи
 */
export function subscribeToSettingsRealtime(): void {
  // Якщо вже підписані — не підписуємося повторно
  if (settingsRealtimeChannel) return;

  settingsRealtimeChannel = supabase
    .channel("settings-realtime-sync")
    .on(
      "postgres_changes",
      {
        event: "*", // INSERT, UPDATE, DELETE
        schema: "public",
        table: "settings",
      },
      (payload) => {
        handleSettingsRealtimeChange(payload);
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("📡 Realtime: підписка на settings активна");
      }
    });
}

/**
 * Відписка від Realtime каналу settings
 * Викликати при logout
 */
export function unsubscribeFromSettingsRealtime(): void {
  if (settingsRealtimeChannel) {
    supabase.removeChannel(settingsRealtimeChannel);
    settingsRealtimeChannel = null;
    console.log("📡 Realtime: відписка від settings");
  }
}

/**
 * Обробник Realtime змін в таблиці settings
 */
function handleSettingsRealtimeChange(payload: any): void {
  const { eventType, new: newRecord, old: _oldRecord } = payload;
  void _oldRecord; // Suppress unused variable warning

  if (eventType === "DELETE") return; // Видалення ігноруємо

  // Отримуємо роль поточного користувача
  const USER_DATA_KEY = "userAuthData";
  const storedData = localStorage.getItem(USER_DATA_KEY);
  if (!storedData) return;

  const userData = JSON.parse(storedData);
  const currentRole = userData?.["Доступ"] as string;
  if (!currentRole) return;

  const settingId = newRecord?.setting_id;
  if (!settingId) return;

  // Визначаємо колонку для поточної ролі
  const column = ROLE_TO_COLUMN[currentRole as keyof typeof ROLE_TO_COLUMN];
  if (!column) return;

  console.log(
    `📡 Realtime settings: ${eventType} setting_id=${settingId}`,
    newRecord,
  );

  // === ОБРОБКА НАЛАШТУВАНЬ АДМІНІСТРАТОРА (колонка "data") ===
  if (currentRole === "Адміністратор") {
    handleAdminSettingsChange(settingId, newRecord);
  }

  // === ОБРОБКА НАЛАШТУВАНЬ ІНШИХ РОЛЕЙ ===
  handleRoleSettingsChange(currentRole, column, settingId, newRecord);

  // === ОБРОБКА ЗАГАЛЬНИХ НАЛАШТУВАНЬ (колонка "Загальні") ===
  handleGeneralSettingsChange(settingId, newRecord);
}

/**
 * Обробка змін налаштувань для Адміністратора
 */
function handleAdminSettingsChange(settingId: number, newRecord: any): void {
  const value = newRecord?.data;

  switch (settingId) {
    case 6: // toggle-print
      globalCache.generalSettings.printColorMode = !!value;
      saveGeneralSettingsToLocalStorage();
      break;
    case 7: // toggle-ai
      globalCache.generalSettings.aiEnabled = !!value;
      saveGeneralSettingsToLocalStorage();
      resetAISettingsCache();
      break;
    case 8: // toggle-phone-admin
      applyPhoneIndicatorVisibility(!!value);
      break;
  }

  // Обробка зміни процентів націнки
  if (newRecord?.procent !== undefined) {
    resetPercentCache();
  }
}

/**
 * Обробка змін налаштувань для конкретної ролі
 */
function handleRoleSettingsChange(
  currentRole: string,
  column: string,
  settingId: number,
  newRecord: any,
): void {
  // Перевіряємо чи ця зміна стосується налаштування "Телефон" для поточної ролі
  const phoneConfig = PHONE_SETTINGS_MAP[currentRole];
  if (phoneConfig && settingId === phoneConfig.settingId) {
    const value = newRecord?.[column];
    if (value !== undefined) {
      applyPhoneIndicatorVisibility(!!value);
      console.log(
        `📞 Realtime: оновлено відображення телефону для ${currentRole}: ${!!value}`,
      );
    }
  }

  // Тут можна додати обробку інших налаштувань ролі при потребі
  // Наприклад, оновлення кешу прав доступу
}

/**
 * Обробка змін загальних налаштувань (Загальні)
 */
function handleGeneralSettingsChange(settingId: number, newRecord: any): void {
  const value = newRecord?.["Загальні"];
  if (value === undefined) return;

  switch (settingId) {
    case 1: // Назва СТО
      globalCache.generalSettings.stoName = value || "";
      break;
    case 2: // Адреса
      globalCache.generalSettings.address = value || "";
      break;
    case 3: // Телефон
      globalCache.generalSettings.phone = value || "";
      break;
    case 4: // Колір шапки акту
      globalCache.generalSettings.headerColor = value || DEFAULT_COLOR;
      break;
    case 5: // Колір таблиці актів
      globalCache.generalSettings.tableColor = value || DEFAULT_COLOR;
      break;
    case 7: // Шпалери основні
      globalCache.generalSettings.wallpaperMain = value || "";
      applyWallpapers();
      break;
    case 8: // SMS текст перед сумою
      globalCache.generalSettings.smsTextBefore =
        value || "Ваше замовлення виконане. Сума:";
      break;
    case 9: // SMS текст після суми
      globalCache.generalSettings.smsTextAfter =
        value || "грн. Дякуємо за довіру!";
      break;
  }

  // Зберігаємо оновлені налаштування в localStorage
  if ([1, 2, 3, 4, 5, 7, 8, 9].includes(settingId)) {
    saveGeneralSettingsToLocalStorage();
  }
}

// Генерує HTML для секції "Загальні"
function createGeneralSettingsHTML(): string {
  return `
    <div class="general-settings-container">
      <div class="general-input-group">
        <label class="general-label" for="general-sto-name">
          <span class="general-label-text">🏢 Назва СТО</span>
          <input type="text" id="general-sto-name" class="general-input" placeholder="Введіть назву СТО" />
        </label>
      </div>
      
      <div class="general-input-group">
        <label class="general-label" for="general-address">
          <span class="general-label-text">📍 Адреса</span>
          <input type="text" id="general-address" class="general-input" placeholder="Введіть адресу" />
        </label>
      </div>
      
      <div class="general-input-group">
        <label class="general-label" for="general-phone">
          <span class="general-label-text">📞 Телефон</span>
          <input type="text" id="general-phone" class="general-input" placeholder="Введіть телефон" />
        </label>
      </div>
      
      <div class="settings-divider"></div>
      
      <div class="general-color-group">
        <label class="general-label color-label" for="general-header-color">
          <span class="general-label-text">🎨 Колір шапки акту</span>
          <div class="color-picker-wrapper">
            <input type="color" id="general-header-color" class="color-picker" value="${DEFAULT_COLOR}" />
            <span class="color-value" id="header-color-value">${DEFAULT_COLOR}</span>
          </div>
        </label>
      </div>
      
      <div class="general-color-group">
        <label class="general-label color-label" for="general-table-color">
          <span class="general-label-text">🎨 Колір таблиці актів</span>
          <div class="color-picker-wrapper">
            <input type="color" id="general-table-color" class="color-picker" value="${DEFAULT_COLOR}" />
            <span class="color-value" id="table-color-value">${DEFAULT_COLOR}</span>
          </div>
        </label>
      </div>
      
      <div class="settings-divider"></div>
      
      <div class="general-input-group">
        <label class="general-label" for="general-wallpaper-main">
          <span class="general-label-text">🖼️ Шпалери основні (URL)</span>
          <input type="text" id="general-wallpaper-main" class="general-input" placeholder="Введіть URL зображення для основної сторінки" />
        </label>
      </div>
      
      <div class="reset-colors-wrapper">
        <button type="button" id="reset-colors-btn" class="reset-colors-btn">
          🔄 Скинути кольори за замовчуванням
        </button>
      </div>

      
      <div class="settings-divider"></div>
      
      <div class="general-input-group sms-text-group">
        <label class="general-label sms-group-label">
          <span class="general-label-text">📱 Текст SMS повідомлення</span>
          <span class="sms-char-counter" id="sms-char-counter">0 симв.</span>
        </label>
        <div class="sms-preview">
          <span class="sms-text-before-preview" contenteditable="true"></span>
          <span class="sms-sum-example">11 500</span>
          <span class="sms-text-after-preview" contenteditable="true"></span>
        </div>
      </div>

    </div>
  `;
}

// Завантажує дані для секції "Загальні"
async function loadGeneralSettings(modal: HTMLElement): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("settings")
      .select("setting_id, Загальні, data")
      .in("setting_id", [1, 2, 3, 4, 5, 6, 7, 8, 9])
      .order("setting_id");

    if (error) throw error;

    // Очищуємо попередній стан
    initialSettingsState.clear();

    data?.forEach((row: any) => {
      const value = row["Загальні"] || "";
      initialSettingsState.set(`general_${row.setting_id}`, value);

      switch (row.setting_id) {
        case 1: // Назва СТО
          const nameInput = modal.querySelector(
            "#general-sto-name",
          ) as HTMLInputElement;
          if (nameInput) nameInput.value = value;
          break;
        case 2: // Адреса
          const addressInput = modal.querySelector(
            "#general-address",
          ) as HTMLInputElement;
          if (addressInput) addressInput.value = value;
          break;
        case 3: // Телефон
          const phoneInput = modal.querySelector(
            "#general-phone",
          ) as HTMLInputElement;
          if (phoneInput) phoneInput.value = value;
          break;
        case 4: // Колір шапки акту
          const headerColor = modal.querySelector(
            "#general-header-color",
          ) as HTMLInputElement;
          const headerColorValue = modal.querySelector(
            "#header-color-value",
          ) as HTMLElement;
          const colorValue4 = value || DEFAULT_COLOR;
          if (headerColor) headerColor.value = colorValue4;
          if (headerColorValue) headerColorValue.textContent = colorValue4;
          break;
        case 5: // Колір таблиці актів
          const tableColor = modal.querySelector(
            "#general-table-color",
          ) as HTMLInputElement;
          const tableColorValue = modal.querySelector(
            "#table-color-value",
          ) as HTMLElement;
          const colorValue5 = value || DEFAULT_COLOR;
          if (tableColor) tableColor.value = colorValue5;
          if (tableColorValue) tableColorValue.textContent = colorValue5;
          break;
        case 7: // Шпалери основні
          const wallpaperMainInput = modal.querySelector(
            "#general-wallpaper-main",
          ) as HTMLInputElement;
          if (wallpaperMainInput) wallpaperMainInput.value = value;
          break;
        case 8: // SMS текст перед сумою
          const smsBeforePreview = modal.querySelector(
            ".sms-text-before-preview",
          ) as HTMLElement;
          const smsBeforeValue = value || "Ваше замовлення виконане. Сума:";
          if (smsBeforePreview) smsBeforePreview.textContent = smsBeforeValue;
          break;
        case 9: // SMS текст після суми
          const smsAfterPreview = modal.querySelector(
            ".sms-text-after-preview",
          ) as HTMLElement;
          const smsAfterValue = value || "грн. Дякуємо за довіру!";
          if (smsAfterPreview) smsAfterPreview.textContent = smsAfterValue;
          break;
      }
    });

    // Оновлюємо лічильник символів SMS після завантаження даних
    updateSmsCharCounter(modal);
  } catch (err) {
    console.error(err);
    showNotification(
      "Помилка завантаження загальних налаштувань",
      "error",
      2000,
    );
  }
}

// Зберігає дані для секції "Загальні"
async function saveGeneralSettings(modal: HTMLElement): Promise<number> {
  let changesCount = 0;

  const nameInput = modal.querySelector(
    "#general-sto-name",
  ) as HTMLInputElement;
  const addressInput = modal.querySelector(
    "#general-address",
  ) as HTMLInputElement;
  const phoneInput = modal.querySelector("#general-phone") as HTMLInputElement;
  const headerColor = modal.querySelector(
    "#general-header-color",
  ) as HTMLInputElement;
  const tableColor = modal.querySelector(
    "#general-table-color",
  ) as HTMLInputElement;
  const wallpaperMainInput = modal.querySelector(
    "#general-wallpaper-main",
  ) as HTMLInputElement;
  const smsBeforePreview = modal.querySelector(
    ".sms-text-before-preview",
  ) as HTMLElement;
  const smsAfterPreview = modal.querySelector(
    ".sms-text-after-preview",
  ) as HTMLElement;

  const newValues = [
    { id: 1, value: nameInput?.value || "" },
    { id: 2, value: addressInput?.value || "" },
    { id: 3, value: phoneInput?.value || "" },
    { id: 4, value: headerColor?.value || DEFAULT_COLOR },
    { id: 5, value: tableColor?.value || DEFAULT_COLOR },
    { id: 7, value: wallpaperMainInput?.value || "" },
    {
      id: 8,
      value:
        smsBeforePreview?.textContent?.trim() ||
        "Ваше замовлення виконане. Сума:",
    },
    {
      id: 9,
      value: smsAfterPreview?.textContent?.trim() || "грн. Дякуємо за довіру!",
    },
  ];

  for (const { id, value } of newValues) {
    const oldValue = initialSettingsState.get(`general_${id}`);
    if (oldValue !== value) {
      // Безпечно: якщо запис існує — оновлюємо лише "Загальні"; якщо ні — створюємо з data:false
      const { data: existingRow, error: selectError } = await supabase
        .from("settings")
        .select("setting_id")
        .eq("setting_id", id)
        .single();
      if (selectError && selectError.code !== "PGRST116") {
        // ігноруємо not found
        console.error(
          `Помилка перевірки існування setting_id ${id}:`,
          selectError,
        );
        throw selectError;
      }

      if (existingRow) {
        const { error: updateError } = await supabase
          .from("settings")
          .update({ Загальні: value })
          .eq("setting_id", id);
        if (updateError) {
          console.error(`Помилка оновлення setting_id ${id}:`, updateError);
          throw updateError;
        }
      } else {
        const { error: insertError } = await supabase
          .from("settings")
          .insert({ setting_id: id, Загальні: value, data: false });
        if (insertError) {
          console.error(`Помилка створення setting_id ${id}:`, insertError);
          throw insertError;
        }
      }
      changesCount++;
    }
  }

  // Оновлюємо globalCache та localStorage, якщо були зміни
  if (changesCount > 0) {
    // Оновлюємо globalCache
    globalCache.generalSettings.stoName = nameInput?.value || "";
    globalCache.generalSettings.address = addressInput?.value || "";
    globalCache.generalSettings.phone = phoneInput?.value || "";
    globalCache.generalSettings.headerColor =
      headerColor?.value || DEFAULT_COLOR;
    globalCache.generalSettings.tableColor = tableColor?.value || DEFAULT_COLOR;
    globalCache.generalSettings.wallpaperMain = wallpaperMainInput?.value || "";
    globalCache.generalSettings.smsTextBefore =
      smsBeforePreview?.textContent?.trim() ||
      "Ваше замовлення виконане. Сума:";
    globalCache.generalSettings.smsTextAfter =
      smsAfterPreview?.textContent?.trim() || "грн. Дякуємо за довіру!";

    // Зберігаємо в localStorage
    saveGeneralSettingsToLocalStorage();

    // Застосовуємо шпалери одразу після збереження
    applyWallpapers();

    // Інвалідуємо кеш глобальних даних
    invalidateGlobalDataCache();
  }

  return changesCount;
}

// Функція для підрахунку та оновлення лічильника символів SMS
function updateSmsCharCounter(modal: HTMLElement): void {
  const smsBeforePreview = modal.querySelector(
    ".sms-text-before-preview",
  ) as HTMLElement;
  const smsAfterPreview = modal.querySelector(
    ".sms-text-after-preview",
  ) as HTMLElement;
  const sumExample = modal.querySelector(".sms-sum-example") as HTMLElement;
  const charCounter = modal.querySelector("#sms-char-counter") as HTMLElement;

  if (!charCounter) return;

  const beforeText = smsBeforePreview?.textContent || "";
  const sumText = sumExample?.textContent || "";
  const afterText = smsAfterPreview?.textContent || "";

  const totalChars = beforeText.length + sumText.length + afterText.length;
  charCounter.textContent = `${totalChars} симв.`;

  // Змінюємо колір в залежності від кількості символів
  if (totalChars > 160) {
    charCounter.classList.add("warning");
    charCounter.classList.remove("ok");
  } else {
    charCounter.classList.add("ok");
    charCounter.classList.remove("warning");
  }
}

// Ініціалізує обробники для секції "Загальні"
function initGeneralSettingsHandlers(modal: HTMLElement): void {
  // Color pickers
  const headerColor = modal.querySelector(
    "#general-header-color",
  ) as HTMLInputElement;
  const tableColor = modal.querySelector(
    "#general-table-color",
  ) as HTMLInputElement;
  const headerColorValue = modal.querySelector(
    "#header-color-value",
  ) as HTMLElement;
  const tableColorValue = modal.querySelector(
    "#table-color-value",
  ) as HTMLElement;

  if (headerColor && headerColorValue) {
    headerColor.addEventListener("input", () => {
      headerColorValue.textContent = headerColor.value;
    });
  }

  if (tableColor && tableColorValue) {
    tableColor.addEventListener("input", () => {
      tableColorValue.textContent = tableColor.value;
    });
  }

  // Кнопка скидання кольорів та шпалер
  const resetBtn = modal.querySelector(
    "#reset-colors-btn",
  ) as HTMLButtonElement;
  const wallpaperMainInput = modal.querySelector(
    "#general-wallpaper-main",
  ) as HTMLInputElement;
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (headerColor) {
        headerColor.value = DEFAULT_COLOR;
        if (headerColorValue) headerColorValue.textContent = DEFAULT_COLOR;
      }
      if (tableColor) {
        tableColor.value = DEFAULT_COLOR;
        if (tableColorValue) tableColorValue.textContent = DEFAULT_COLOR;
      }
      // Очищаємо поле шпалер
      if (wallpaperMainInput) {
        wallpaperMainInput.value = "";
      }
      showNotification(
        "Кольори та шпалери скинуто до значень за замовчуванням",
        "info",
        1500,
      );
    });
  }

  // Обробники для підрахунку символів SMS
  const smsBeforePreview = modal.querySelector(
    ".sms-text-before-preview",
  ) as HTMLElement;
  const smsAfterPreview = modal.querySelector(
    ".sms-text-after-preview",
  ) as HTMLElement;

  // Початковий підрахунок
  updateSmsCharCounter(modal);

  // Оновлюємо лічильник при зміні тексту
  if (smsBeforePreview) {
    smsBeforePreview.addEventListener("input", () =>
      updateSmsCharCounter(modal),
    );
  }
  if (smsAfterPreview) {
    smsAfterPreview.addEventListener("input", () =>
      updateSmsCharCounter(modal),
    );
  }
}

function createToggle(id: string, label: string, cls: string): string {
  return `
    <label class="toggle-switch ${cls}">
      <input type="checkbox" id="${id}" />
      <span class="slider"></span>
      <span class="label-text">${label}</span>
    </label>
  `;
}

function createRoleToggles(role: string): string {
  const settings = ROLE_SETTINGS[role as keyof typeof ROLE_SETTINGS];
  if (!settings) return "";
  return settings
    .map((s: any) => {
      if (s.divider) {
        return `<div class="settings-divider"></div>`;
      }
      return createToggle(`role-toggle-${s.id}`, s.label, `_role_${s.id}`);
    })
    .join("");
}

// Функція для додавання нового рядка відсотків
function addPercentageRow(
  modal: HTMLElement,
  initialValue: number = 0,
  settingId?: number,
  isFrozen: boolean = false,
): void {
  const wrapper = modal.querySelector(".percentage-rows-wrapper");
  const container = modal.querySelector("#additional-percentage-rows");

  if (!container) return;

  // Визначаємо наступний номер рядка
  const allRows = wrapper?.querySelectorAll(".percentage-row") || [];
  let nextRowNum = settingId;

  if (!nextRowNum) {
    // Знаходимо максимальний номер і додаємо 1
    let maxNum = 1;
    allRows.forEach((row) => {
      const num = parseInt(row.getAttribute("data-setting-id") || "1");
      if (num > maxNum) maxNum = num;
    });
    nextRowNum = maxNum + 1;
  }

  // Максимум 500 рядків (розширений діапазон)
  if (nextRowNum > 500) return;

  // Перевіряємо чи вже існує цей рядок
  if (modal.querySelector(`#percentage-slider-${nextRowNum}`)) {
    // Просто оновлюємо значення
    const slider = modal.querySelector(
      `#percentage-slider-${nextRowNum}`,
    ) as HTMLInputElement;
    const input = modal.querySelector(
      `#percentage-input-${nextRowNum}`,
    ) as HTMLInputElement;
    if (slider) slider.value = String(initialValue);
    if (input) input.value = String(initialValue);
    return;
  }

  // Кнопка плюсика завжди видима (можна додавати багато складів)
  const frozenClass = isFrozen ? " frozen" : "";
  const disabledAttr = isFrozen ? " disabled" : "";

  const rowHtml = `
    <div class="percentage-row${frozenClass}" data-setting-id="${nextRowNum}">
      <span class="percentage-number">${nextRowNum}</span>
      <div class="percentage-input-wrapper">
        <input type="range" id="percentage-slider-${nextRowNum}" class="percentage-slider" min="0" max="100" value="${isFrozen ? 0 : initialValue}" step="1"${disabledAttr} />
        <div class="percentage-value-display">
          <input type="number" id="percentage-input-${nextRowNum}" class="percentage-input" min="0" max="100" value="${isFrozen ? 0 : initialValue}"${disabledAttr} />
          <span class="percent-sign">${isFrozen ? "." : "%"}</span>
        </div>
      </div>
      ${
        isFrozen
          ? `<div class="percentage-buttons-container">
            <button type="button" class="delete-percentage-btn" id="delete-percentage-row-${nextRowNum}" title="Видалити склад повністю">×</button>
            <button type="button" class="unfreeze-percentage-btn" id="unfreeze-percentage-row-${nextRowNum}" title="Активувати склад">↻</button>
          </div>`
          : `<button type="button" class="remove-percentage-btn" id="remove-percentage-row-${nextRowNum}" title="Заморозити склад">−</button>`
      }
    </div>
  `;

  container.insertAdjacentHTML("beforeend", rowHtml);

  // Додаємо обробники для нового рядка
  const slider = modal.querySelector(
    `#percentage-slider-${nextRowNum}`,
  ) as HTMLInputElement;
  const input = modal.querySelector(
    `#percentage-input-${nextRowNum}`,
  ) as HTMLInputElement;
  const removeBtn = modal.querySelector(`#remove-percentage-row-${nextRowNum}`);
  const unfreezeBtn = modal.querySelector(
    `#unfreeze-percentage-row-${nextRowNum}`,
  );
  const deleteBtn = modal.querySelector(`#delete-percentage-row-${nextRowNum}`);

  if (slider && input && !isFrozen) {
    slider.addEventListener("input", () => {
      input.value = slider.value;
    });

    input.addEventListener("input", () => {
      const numValue = parseInt(input.value) || 0;
      if (numValue >= 0 && numValue <= 100) {
        slider.value = String(numValue);
      } else {
        input.value = slider.value;
      }
    });
  }

  // Обробник для повного видалення рядка (тільки UI, збереження при "ОК")
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      // Додаємо ID до списку видалених
      pendingDeletedWarehouseIds.add(nextRowNum!);
      pendingFrozenWarehouseIds.delete(nextRowNum!);
      pendingUnfrozenWarehouseIds.delete(nextRowNum!);

      // Видаляємо рядок з UI
      const row = modal.querySelector(
        `.percentage-row[data-setting-id="${nextRowNum}"]`,
      );
      if (row) {
        row.remove();
      }
    });
  }

  // Обробник для заморожування рядка (тільки UI, збереження при "ОК")
  if (removeBtn) {
    removeBtn.addEventListener("click", () => {
      // Додаємо ID до списку заморожених
      pendingFrozenWarehouseIds.add(nextRowNum!);
      pendingUnfrozenWarehouseIds.delete(nextRowNum!);
      pendingDeletedWarehouseIds.delete(nextRowNum!);

      // Оновлюємо UI
      const row = modal.querySelector(
        `.percentage-row[data-setting-id="${nextRowNum}"]`,
      );
      if (row) {
        row.classList.add("frozen");
        const sliderEl = row.querySelector(
          ".percentage-slider",
        ) as HTMLInputElement;
        const inputEl = row.querySelector(
          ".percentage-input",
        ) as HTMLInputElement;
        const percentSign = row.querySelector(".percent-sign");
        if (sliderEl) sliderEl.disabled = true;
        if (inputEl) inputEl.disabled = true;
        if (percentSign) percentSign.textContent = ".";

        // Замінюємо кнопку на контейнер з двома кнопками
        removeBtn.outerHTML = `<div class="percentage-buttons-container">
          <button type="button" class="delete-percentage-btn" id="delete-percentage-row-${nextRowNum}" title="Видалити склад повністю">×</button>
          <button type="button" class="unfreeze-percentage-btn" id="unfreeze-percentage-row-${nextRowNum}" title="Активувати склад">↻</button>
        </div>`;

        // Додаємо обробники для нових кнопок
        const newUnfreezeBtn = modal.querySelector(
          `#unfreeze-percentage-row-${nextRowNum}`,
        );
        const newDeleteBtn = modal.querySelector(
          `#delete-percentage-row-${nextRowNum}`,
        );

        if (newUnfreezeBtn) {
          newUnfreezeBtn.addEventListener("click", () =>
            unfreezeRow(modal, nextRowNum!),
          );
        }

        if (newDeleteBtn) {
          newDeleteBtn.addEventListener("click", () => {
            // Додаємо ID до списку видалених
            pendingDeletedWarehouseIds.add(nextRowNum!);
            pendingFrozenWarehouseIds.delete(nextRowNum!);
            pendingUnfrozenWarehouseIds.delete(nextRowNum!);
            row.remove();
          });
        }
      }
    });
  }

  // Обробник для розморожування рядка
  if (unfreezeBtn) {
    unfreezeBtn.addEventListener("click", () =>
      unfreezeRow(modal, nextRowNum!),
    );
  }
}

// Функція для розморожування рядка
// Функція для розморожування рядка (тільки UI, збереження при "ОК")
function unfreezeRow(modal: HTMLElement, settingId: number): void {
  // Додаємо ID до списку активованих
  pendingUnfrozenWarehouseIds.add(settingId);
  pendingFrozenWarehouseIds.delete(settingId);
  pendingDeletedWarehouseIds.delete(settingId);

  // Оновлюємо UI
  const row = modal.querySelector(
    `.percentage-row[data-setting-id="${settingId}"]`,
  );
  if (row) {
    row.classList.remove("frozen");
    const sliderEl = row.querySelector(
      ".percentage-slider",
    ) as HTMLInputElement;
    const inputEl = row.querySelector(".percentage-input") as HTMLInputElement;
    const percentSign = row.querySelector(".percent-sign");
    if (sliderEl) {
      sliderEl.disabled = false;
      sliderEl.value = "0";
    }
    if (inputEl) {
      inputEl.disabled = false;
      inputEl.value = "0";
    }
    if (percentSign) percentSign.textContent = "%";

    // Видаляємо контейнер з кнопками і додаємо просту кнопку заморозки
    const buttonsContainer = row.querySelector(".percentage-buttons-container");
    if (buttonsContainer) {
      buttonsContainer.outerHTML = `<button type="button" class="remove-percentage-btn" id="remove-percentage-row-${settingId}" title="Заморозити склад">−</button>`;
    }

    // Додаємо обробник для нової кнопки заморозки (тільки UI)
    const newRemoveBtn = modal.querySelector(
      `#remove-percentage-row-${settingId}`,
    );
    if (newRemoveBtn) {
      newRemoveBtn.addEventListener("click", () => {
        // Додаємо ID до списку заморожених
        pendingFrozenWarehouseIds.add(settingId);
        pendingUnfrozenWarehouseIds.delete(settingId);
        pendingDeletedWarehouseIds.delete(settingId);

        // Заморожуємо рядок
        row.classList.add("frozen");
        if (sliderEl) sliderEl.disabled = true;
        if (inputEl) inputEl.disabled = true;
        if (percentSign) percentSign.textContent = ".";

        // Замінюємо кнопку на контейнер з двома кнопками
        newRemoveBtn.outerHTML = `<div class="percentage-buttons-container">
          <button type="button" class="delete-percentage-btn" id="delete-percentage-row-${settingId}" title="Видалити склад повністю">×</button>
          <button type="button" class="unfreeze-percentage-btn" id="unfreeze-percentage-row-${settingId}" title="Активувати склад">↻</button>
        </div>`;

        const newerUnfreezeBtn = modal.querySelector(
          `#unfreeze-percentage-row-${settingId}`,
        );
        const newerDeleteBtn = modal.querySelector(
          `#delete-percentage-row-${settingId}`,
        );

        if (newerUnfreezeBtn) {
          newerUnfreezeBtn.addEventListener("click", () =>
            unfreezeRow(modal, settingId),
          );
        }

        if (newerDeleteBtn) {
          newerDeleteBtn.addEventListener("click", () => {
            // Додаємо ID до списку видалених
            pendingDeletedWarehouseIds.add(settingId);
            pendingFrozenWarehouseIds.delete(settingId);
            pendingUnfrozenWarehouseIds.delete(settingId);
            row.remove();
          });
        }
      });
    }

    // Додаємо обробники для слайдера і інпута
    if (sliderEl && inputEl) {
      sliderEl.addEventListener("input", () => {
        inputEl.value = sliderEl.value;
      });

      inputEl.addEventListener("input", () => {
        const numValue = parseInt(inputEl.value) || 0;
        if (numValue >= 0 && numValue <= 100) {
          sliderEl.value = String(numValue);
        } else {
          inputEl.value = sliderEl.value;
        }
      });
    }
  }
}

async function loadSettings(modal: HTMLElement): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("settings")
      .select("setting_id, data, procent")
      .order("setting_id");

    if (error) throw error;

    // 🔹 Очищуємо попередній стан
    initialSettingsState.clear();

    // 🔹 Очищуємо списки відкладених змін складів
    pendingDeletedWarehouseIds.clear();
    pendingFrozenWarehouseIds.clear();
    pendingUnfrozenWarehouseIds.clear();

    // Очищаємо додаткові рядки відсотків
    const additionalRows = modal.querySelector("#additional-percentage-rows");
    if (additionalRows) additionalRows.innerHTML = "";

    // Показуємо кнопку плюсика
    const addBtn = modal.querySelector(
      "#add-percentage-row",
    ) as HTMLButtonElement;
    if (addBtn) addBtn.style.display = "";

    Object.values(SETTINGS).forEach((s) => {
      const el = modal.querySelector(`#${s.id}`) as HTMLInputElement;
      if (el?.type === "checkbox") el.checked = false;
    });

    // Збираємо дані про відсотки (всі setting_id)
    const procentMap = new Map<number, number | null>();

    data?.forEach((row: any) => {
      const setting = SETTINGS[row.setting_id as keyof typeof SETTINGS];

      // Зберігаємо всі procent значення (setting_id >= 1)
      if (row.setting_id >= 1) {
        procentMap.set(row.setting_id, row.procent);
      }

      // Обробка чекбоксів
      if (setting && setting.id !== "percentage-value") {
        const checkbox = modal.querySelector(
          `#${setting.id}`,
        ) as HTMLInputElement;
        if (checkbox) checkbox.checked = !!row.data;
        initialSettingsState.set(`checkbox_${row.setting_id}`, !!row.data);
      }
    });

    // Для відсутніх записів по ключових адмін-перемикачах — виставляємо дефолт false у початковому стані
    [1, 2, 3, 5, 6, 7, 8].forEach((id) => {
      if (!initialSettingsState.has(`checkbox_${id}`)) {
        const setting = SETTINGS[id as keyof typeof SETTINGS];
        if (setting) {
          const el = modal.querySelector(`#${setting.id}`) as HTMLInputElement;
          const def = !!el?.checked; // як правило false
          initialSettingsState.set(`checkbox_${id}`, def);
        }
      }
    });

    // Рендеримо лише заповнені рядки (включаючи заморожені -1), без заповнення прогалин
    const filledIds = Array.from(procentMap.entries())
      .filter(([_, val]) => val !== null && val !== undefined)
      .map(([id, _]) => id)
      .sort((a, b) => a - b);

    if (filledIds.length) {
      for (const id of filledIds) {
        const value = procentMap.get(id);
        const isFrozen = value === -1; // -1 означає заморожений склад
        const displayValue = isFrozen ? 0 : (value ?? 0);

        if (id === 1) {
          // Перший рядок вже існує в HTML
          const slider1 = modal.querySelector(
            "#percentage-slider-1",
          ) as HTMLInputElement;
          const input1 = modal.querySelector(
            "#percentage-input-1",
          ) as HTMLInputElement;
          const row1 = modal.querySelector(
            ".percentage-row[data-setting-id='1']",
          );
          const percentSign1 = row1?.querySelector(".percent-sign");

          // Скидаємо стан перед застосуванням
          if (row1) row1.classList.remove("frozen");
          if (percentSign1) percentSign1.textContent = "%";
          if (slider1) slider1.disabled = false;
          if (input1) input1.disabled = false;

          if (isFrozen) {
            if (slider1) {
              slider1.value = "0";
              slider1.disabled = true;
            }
            if (input1) {
              input1.value = "0";
              input1.disabled = true;
            }
            if (row1) row1.classList.add("frozen");
            if (percentSign1) percentSign1.textContent = ".";
          } else {
            if (slider1) slider1.value = String(displayValue);
            if (input1) input1.value = String(displayValue);
          }
          initialSettingsState.set(`procent_${id}`, value ?? 0);
        } else {
          // Додаткові рядки створюємо динамічно тільки для існуючих ID
          addPercentageRow(modal, displayValue, id, isFrozen);
          initialSettingsState.set(`procent_${id}`, value ?? 0);
        }
      }
    } else {
      // Якщо немає жодного заповненого відсотка, встановлюємо 0 для першого
      const slider1 = modal.querySelector(
        "#percentage-slider-1",
      ) as HTMLInputElement;
      const input1 = modal.querySelector(
        "#percentage-input-1",
      ) as HTMLInputElement;
      if (slider1) slider1.value = "0";
      if (input1) input1.value = "0";
      initialSettingsState.set(`procent_1`, 0);
    }

    modal
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .forEach((cb) => {
        cb.closest(".toggle-switch")?.classList.toggle("active", cb.checked);
      });
  } catch (err) {
    console.error(err);
    showNotification("Помилка завантаження налаштувань", "error", 2000);
  }
}

async function loadRoleSettings(
  modal: HTMLElement,
  role: string,
): Promise<void> {
  const column = ROLE_TO_COLUMN[role as keyof typeof ROLE_TO_COLUMN];

  if (!column) return;

  try {
    // 🔹 Очищуємо попередній стан
    initialSettingsState.clear();

    // Охоплюємо повний діапазон id 1..24
    const settingIds = Array.from({ length: 24 }, (_, i) => i + 1);

    const { data, error } = await supabase
      .from("settings")
      .select(`setting_id, "${column}"`)
      .in("setting_id", settingIds)
      .order("setting_id");

    if (error) throw error;

    // Скидаємо чекбокси поточної розмітки (тільки ті, що відображені)
    modal
      .querySelectorAll<HTMLInputElement>('[id^="role-toggle-"]')
      .forEach((el) => {
        if (el.type === "checkbox") el.checked = false;
      });

    const presentIds = new Set<number>();
    data?.forEach((row: any) => {
      const checkbox = modal.querySelector(
        `#role-toggle-${row.setting_id}`,
      ) as HTMLInputElement;
      const value = !!row[column];
      if (checkbox) checkbox.checked = value;
      // 🔹 Зберігаємо початкове значення з префіксом role_
      initialSettingsState.set(`role_${row.setting_id}`, value);
      presentIds.add(row.setting_id);
    });

    // Для всіх id 1..24, де немає записів у БД — фіксуємо дефолт (стан чекбокса або false)
    settingIds.forEach((id: number) => {
      if (!presentIds.has(id)) {
        const checkbox = modal.querySelector(
          `#role-toggle-${id}`,
        ) as HTMLInputElement;
        const value = !!checkbox?.checked; // за замовчуванням false
        initialSettingsState.set(`role_${id}`, value);
      }
    });

    modal
      .querySelectorAll<HTMLInputElement>('[id^="role-toggle-"]')
      .forEach((cb) => {
        cb.closest(".toggle-switch")?.classList.toggle("active", cb.checked);
      });
  } catch (err) {
    console.error(err);
    showNotification(
      `Помилка завантаження налаштувань для ролі ${role}`,
      "error",
      2000,
    );
  }
}

async function saveSettings(modal: HTMLElement): Promise<boolean> {
  try {
    const roleButton = modal.querySelector(
      "#role-toggle-button",
    ) as HTMLButtonElement;

    // ✅ гарантуємо чисту назву ролі
    let role = (roleButton?.textContent || "Адміністратор").trim();

    // ✅ безпечний фолбек, якщо роль невідома/непідтримувана
    if (!(role in ROLE_TO_COLUMN)) {
      console.warn("Невідома роль у кнопці, фолбек до Адміністратор:", role);
      role = "Адміністратор";
    }

    const column = ROLE_TO_COLUMN[role as keyof typeof ROLE_TO_COLUMN];
    let changesCount = 0;

    if (role === "Адміністратор") {
      // Перевіряємо і зберігаємо тільки змінені налаштування
      const checkbox1 = modal.querySelector("#toggle-shop") as HTMLInputElement;
      const newValue1 = checkbox1?.checked ?? false;
      if (initialSettingsState.get("checkbox_1") !== newValue1) {
        // Якщо запис існує — оновлюємо; якщо ні — створюємо з data:newValue1
        const { data: existingRow, error: selectError } = await supabase
          .from("settings")
          .select("setting_id")
          .eq("setting_id", 1)
          .single();
        if (selectError && selectError.code !== "PGRST116") throw selectError;
        if (existingRow) {
          const { error: updateError } = await supabase
            .from("settings")
            .update({ [column]: newValue1 })
            .eq("setting_id", 1);
          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase
            .from("settings")
            .insert({ setting_id: 1, [column]: newValue1, data: newValue1 });
          if (insertError) throw insertError;
        }
        changesCount++;
      }

      const checkbox2 = modal.querySelector(
        "#toggle-receiver",
      ) as HTMLInputElement;
      const newValue2 = checkbox2?.checked ?? false;
      if (initialSettingsState.get("checkbox_2") !== newValue2) {
        const { data: existingRow, error: selectError } = await supabase
          .from("settings")
          .select("setting_id")
          .eq("setting_id", 2)
          .single();
        if (selectError && selectError.code !== "PGRST116") throw selectError;
        if (existingRow) {
          const { error: updateError } = await supabase
            .from("settings")
            .update({ [column]: newValue2 })
            .eq("setting_id", 2);
          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase
            .from("settings")
            .insert({ setting_id: 2, [column]: newValue2, data: newValue2 });
          if (insertError) throw insertError;
        }
        changesCount++;
      }

      const checkbox3 = modal.querySelector(
        "#toggle-zarplata",
      ) as HTMLInputElement;
      const newValue3 = checkbox3?.checked ?? false;
      if (initialSettingsState.get("checkbox_3") !== newValue3) {
        const { data: existingRow, error: selectError } = await supabase
          .from("settings")
          .select("setting_id")
          .eq("setting_id", 3)
          .single();
        if (selectError && selectError.code !== "PGRST116") throw selectError;
        if (existingRow) {
          const { error: updateError } = await supabase
            .from("settings")
            .update({ [column]: newValue3 })
            .eq("setting_id", 3);
          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase
            .from("settings")
            .insert({ setting_id: 3, [column]: newValue3, data: newValue3 });
          if (insertError) throw insertError;
        }
        changesCount++;
      }

      // Відсотки - динамічно зберігаємо всі наявні рядки
      const percentageInputs =
        modal.querySelectorAll<HTMLInputElement>(".percentage-input");
      for (const input of Array.from(percentageInputs)) {
        const idMatch = input.id.match(/percentage-input-(\d+)/);
        if (idMatch) {
          const settingId = parseInt(idMatch[1]);
          const row = modal.querySelector(
            `.percentage-row[data-setting-id="${settingId}"]`,
          );

          // Якщо рядок заморожений — зберігаємо -1
          if (
            row?.classList.contains("frozen") ||
            pendingFrozenWarehouseIds.has(settingId)
          ) {
            // Перевіряємо чи це нова зміна
            const initialValue = initialSettingsState.get(
              `procent_${settingId}`,
            );
            if (initialValue !== -1) {
              const { data: existingRow } = await supabase
                .from("settings")
                .select("setting_id")
                .eq("setting_id", settingId)
                .single();

              if (existingRow) {
                const { error } = await supabase
                  .from("settings")
                  .update({ procent: -1 })
                  .eq("setting_id", settingId);
                if (error) throw error;
              } else {
                const { error } = await supabase
                  .from("settings")
                  .insert({ setting_id: settingId, procent: -1, data: false });
                if (error) throw error;
              }
              changesCount++;
            }
            continue;
          }

          const raw = Number(input.value ?? 0);
          const newValue = Math.min(
            100,
            Math.max(0, Math.floor(isFinite(raw) ? raw : 0)),
          );
          if (initialSettingsState.get(`procent_${settingId}`) !== newValue) {
            // Спочатку перевіряємо чи існує запис
            const { data: existingRow } = await supabase
              .from("settings")
              .select("setting_id")
              .eq("setting_id", settingId)
              .single();

            if (existingRow) {
              // Запис існує - оновлюємо тільки procent
              const { error } = await supabase
                .from("settings")
                .update({ procent: newValue })
                .eq("setting_id", settingId);
              if (error) throw error;
            } else {
              // Запис не існує - створюємо новий з data: false
              const { error } = await supabase.from("settings").insert({
                setting_id: settingId,
                procent: newValue,
                data: false,
              });
              if (error) throw error;
            }
            changesCount++;
          }
        }
      }

      // 🔹 Обробляємо видалені склади (procent → null)
      for (const deletedId of pendingDeletedWarehouseIds) {
        const initialValue = initialSettingsState.get(`procent_${deletedId}`);
        if (initialValue !== null && initialValue !== undefined) {
          const { error } = await supabase
            .from("settings")
            .update({ procent: null })
            .eq("setting_id", deletedId);
          if (error) {
            console.error(`Помилка видалення складу ${deletedId}:`, error);
          } else {
            changesCount++;
          }
        }
      }

      const checkbox5 = modal.querySelector("#toggle-sms") as HTMLInputElement;
      const newValue5 = checkbox5?.checked ?? false;
      if (initialSettingsState.get("checkbox_5") !== newValue5) {
        const { data: existingRow, error: selectError } = await supabase
          .from("settings")
          .select("setting_id")
          .eq("setting_id", 5)
          .single();
        if (selectError && selectError.code !== "PGRST116") throw selectError;
        if (existingRow) {
          const { error: updateError } = await supabase
            .from("settings")
            .update({ [column]: newValue5 })
            .eq("setting_id", 5);
          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase
            .from("settings")
            .insert({ setting_id: 5, [column]: newValue5, data: newValue5 });
          if (insertError) throw insertError;
        }
        changesCount++;
      }

      // 🔹 Збереження toggle-print (setting_id 6)
      const checkbox6 = modal.querySelector(
        "#toggle-print",
      ) as HTMLInputElement;
      const newValue6 = checkbox6?.checked ?? false;
      if (initialSettingsState.get("checkbox_6") !== newValue6) {
        const { data: existingRow, error: selectError } = await supabase
          .from("settings")
          .select("setting_id")
          .eq("setting_id", 6)
          .single();
        if (selectError && selectError.code !== "PGRST116") throw selectError;
        if (existingRow) {
          const { error: updateError } = await supabase
            .from("settings")
            .update({ [column]: newValue6 })
            .eq("setting_id", 6);
          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase
            .from("settings")
            .insert({ setting_id: 6, [column]: newValue6, data: newValue6 });
          if (insertError) throw insertError;
        }
        // Оновлюємо globalCache
        globalCache.generalSettings.printColorMode = newValue6;
        saveGeneralSettingsToLocalStorage();
        changesCount++;
      }

      // 🤖 Збереження toggle-ai (setting_id 7)
      const checkboxAI = modal.querySelector("#toggle-ai") as HTMLInputElement;
      const newValueAI = checkboxAI?.checked ?? false;
      if (initialSettingsState.get("checkbox_7") !== newValueAI) {
        const { data: existing7 } = await supabase
          .from("settings")
          .select("setting_id")
          .eq("setting_id", 7)
          .single();
        if (existing7) {
          const { error: updateError7 } = await supabase
            .from("settings")
            .update({ [column]: newValueAI })
            .eq("setting_id", 7);
          if (updateError7) throw updateError7;
        } else {
          const { error: insertError } = await supabase
            .from("settings")
            .insert({ setting_id: 7, [column]: newValueAI });
          if (insertError) throw insertError;
        }
        globalCache.generalSettings.aiEnabled = newValueAI;
        saveGeneralSettingsToLocalStorage();
        resetAISettingsCache();
        changesCount++;
      }

      // 📞 Збереження toggle-phone-admin (setting_id 8)
      const checkboxPhone = modal.querySelector(
        "#toggle-phone-admin",
      ) as HTMLInputElement;
      const newValuePhone = checkboxPhone?.checked ?? false;
      if (initialSettingsState.get("checkbox_8") !== newValuePhone) {
        const { data: existing8 } = await supabase
          .from("settings")
          .select("setting_id")
          .eq("setting_id", 8)
          .single();
        if (existing8) {
          const { error: updateError8 } = await supabase
            .from("settings")
            .update({ [column]: newValuePhone })
            .eq("setting_id", 8);
          if (updateError8) throw updateError8;
        } else {
          const { error: insertError } = await supabase
            .from("settings")
            .insert({ setting_id: 8, [column]: newValuePhone });
          if (insertError) throw insertError;
        }
        changesCount++;
      }
    } else if (role === "Загальні") {
      // Зберегти налаштування для секції "Загальні"
      changesCount = await saveGeneralSettings(modal);
    } else {
      // Зберегти налаштування для інших ролей — покриваємо id 1..24, працюємо лише з наявними чекбоксами
      for (let id = 1; id <= 24; id++) {
        const checkbox = modal.querySelector(
          `#role-toggle-${id}`,
        ) as HTMLInputElement;
        if (!checkbox) continue; // пропускаємо невідображені у UI

        const newValue = checkbox.checked ?? false;
        const oldValue =
          (initialSettingsState.get(`role_${id}`) as boolean) ?? false;

        if (oldValue !== newValue) {
          // Якщо запис існує — оновлюємо лише колонку ролі; якщо ні — створюємо (data:false)
          const { data: existingRow, error: selectError } = await supabase
            .from("settings")
            .select("setting_id")
            .eq("setting_id", id)
            .single();
          if (selectError && selectError.code !== "PGRST116") {
            console.error(`Помилка перевірки setting_id ${id}:`, selectError);
            throw selectError;
          }

          if (existingRow) {
            const { error: updateError } = await supabase
              .from("settings")
              .update({ [column]: newValue })
              .eq("setting_id", id);
            if (updateError) {
              console.error(`Помилка оновлення setting_id ${id}:`, updateError);
              throw updateError;
            }
          } else {
            const { error: insertError } = await supabase
              .from("settings")
              .insert({ setting_id: id, [column]: newValue, data: false });
            if (insertError) {
              console.error(`Помилка створення setting_id ${id}:`, insertError);
              throw insertError;
            }
          }
          changesCount++;
        }
      }
    }

    if (changesCount === 0) {
      showNotification("Змін не було", "info", 1500);
    } else {
      resetPercentCache();
      showNotification(`Збережено ${changesCount} зміни(н)!`, "success", 1500);
      // Після збереження оновлюємо стан під поточну роль, щоб синхронізувати initialSettingsState
      if (role === "Адміністратор") {
        await loadSettings(modal);
      } else if (role === "Загальні") {
        await loadGeneralSettings(modal);
      } else {
        await loadRoleSettings(modal, role);
      }
    }
    return true;
  } catch (err) {
    console.error("Save error details:", err);
    showNotification("Помилка збереження", "error", 1500);
    return false;
  }
}

function updateRoleTogglesVisibility(modal: HTMLElement, role: string): void {
  const container = modal.querySelector("#role-toggles-container");
  const mainToggles = modal.querySelector("#main-toggles-container");
  const percentageControl = modal.querySelector(".percentage-control");
  const modalWindow = modal.querySelector(".modal-window") as HTMLElement;
  const roleButton = modal.querySelector("#role-toggle-button") as HTMLElement;

  if (!container) return;

  const colors = ROLE_COLORS[role as keyof typeof ROLE_COLORS];
  if (colors && modalWindow) {
    modalWindow.style.border = `2px solid ${colors["modal-window"]}`;
  }
  if (colors && roleButton) {
    roleButton.style.background = colors.button;
    roleButton.onmouseenter = () => {
      roleButton.style.background = colors.buttonHover;
    };
    roleButton.onmouseleave = () => {
      roleButton.style.background = colors.button;
    };
  }

  if (role === "Адміністратор") {
    container.innerHTML = "";
    if (mainToggles) (mainToggles as HTMLElement).style.display = "";
    if (percentageControl)
      (percentageControl as HTMLElement).style.display = "";
    loadSettings(modal);
  } else if (role === "Загальні") {
    // Обробка секції "Загальні"
    if (mainToggles) (mainToggles as HTMLElement).style.display = "none";
    if (percentageControl)
      (percentageControl as HTMLElement).style.display = "none";

    container.innerHTML = createGeneralSettingsHTML();
    initGeneralSettingsHandlers(modal);
    loadGeneralSettings(modal);
  } else {
    if (mainToggles) (mainToggles as HTMLElement).style.display = "none";
    if (percentageControl)
      (percentageControl as HTMLElement).style.display = "none";

    const togglesHTML = createRoleToggles(role);
    container.innerHTML = togglesHTML;

    container
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .forEach((cb) => {
        cb.addEventListener("change", () => {
          cb.closest(".toggle-switch")?.classList.toggle("active", cb.checked);
        });
      });

    loadRoleSettings(modal, role);
  }
}

export async function createSettingsModal(): Promise<void> {
  if (document.getElementById("modal-settings")) return;

  const modal = document.createElement("div");
  modal.id = "modal-settings";
  modal.className = "modal-settings hidden";

  const toggles = Object.values(SETTINGS)
    .filter((s) => s.id !== "percentage-value")
    .map((s) => createToggle(s.id, s.label, s.class))
    .join("");

  const initialRole = ROLES[0]; // "Адміністратор"
  const colors = ROLE_COLORS[initialRole as keyof typeof ROLE_COLORS];

  modal.innerHTML = `
    <div class="modal-window" style="background-color: #ffffff; border: 2px solid ${colors["modal-window"]}">
      <button id="role-toggle-button" type="button" class="role-toggle-button" style="background: ${colors.button}">
        ${initialRole}
      </button>

      <div id="role-toggles-container"></div>

      <div id="main-toggles-container">
        ${toggles}
      </div>

      <div class="percentage-control">
        <label class="percentage-label">
          <span class="percentage-title">Націнка на запчастини</span>
          <div class="percentage-rows-wrapper">
            <div class="percentage-row" data-setting-id="1">
              <span class="percentage-number">1</span>
              <div class="percentage-input-wrapper">
                <input type="range" id="percentage-slider-1" class="percentage-slider" min="0" max="100" value="0" step="1" />
                <div class="percentage-value-display">
                  <input type="number" id="percentage-input-1" class="percentage-input" min="0" max="100" value="0" />
                  <span class="percent-sign">%</span>
                </div>
              </div>
              <button type="button" class="add-percentage-btn" id="add-percentage-row" title="Додати ще один склад">+</button>
            </div>
            <div id="additional-percentage-rows"></div>
          </div>
        </label>
      </div>

      <div class="modal-actions">
        <button id="modal-cancel-button" type="button">Вийти</button>
        <button id="modal-ok-button" type="button">ОК</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // ✅ одразу ініціалізуємо стан під поточну роль і підтягуємо значення
  updateRoleTogglesVisibility(modal, initialRole);

  // Обробник для AI toggle
  const aiToggle = modal.querySelector("#toggle-ai") as HTMLInputElement;
  if (aiToggle) {
    aiToggle.addEventListener("change", () => {
      resetAISettingsCache();
    });
  }

  // Обробник для кнопки додавання нового рядка відсотків
  const addPercentageBtn = modal.querySelector("#add-percentage-row");
  if (addPercentageBtn) {
    addPercentageBtn.addEventListener("click", () => {
      addPercentageRow(modal);
    });
  }

  const roleButton = modal.querySelector(
    "#role-toggle-button",
  ) as HTMLButtonElement;
  let currentRoleIndex = 0;

  if (roleButton) {
    roleButton.addEventListener("click", (e: MouseEvent) => {
      const buttonRect = roleButton.getBoundingClientRect();
      const clickX = e.clientX - buttonRect.left;
      const buttonWidth = buttonRect.width;

      // Ліва зона 40% ширини - для перемикання назад
      // Права зона 60% ширини - для перемикання вперед
      const leftZoneWidth = buttonWidth * 0.4;

      if (clickX < leftZoneWidth) {
        // Клік на ліву частину (40%) - назад
        currentRoleIndex = (currentRoleIndex - 1 + ROLES.length) % ROLES.length;
      } else {
        // Клік на праву частину (60%) - вперед
        currentRoleIndex = (currentRoleIndex + 1) % ROLES.length;
      }

      const newRole = ROLES[currentRoleIndex];
      roleButton.textContent = newRole;
      updateRoleTogglesVisibility(modal, newRole);
    });
  }

  const slider = modal.querySelector(
    "#percentage-slider-1",
  ) as HTMLInputElement;
  const input = modal.querySelector("#percentage-input-1") as HTMLInputElement;

  const updateInputFromSlider = () => {
    if (input && slider) {
      input.value = slider.value;
    }
  };

  if (slider) {
    slider.addEventListener("input", updateInputFromSlider);
  }

  if (input) {
    input.addEventListener("input", () => {
      if (slider) {
        const numValue = parseInt(input.value) || 0;
        if (numValue >= 0 && numValue <= 100) {
          slider.value = String(numValue);
          updateInputFromSlider();
        } else {
          input.value = slider.value;
        }
      }
    });
  }

  modal
    .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    .forEach((cb) => {
      cb.addEventListener("change", () => {
        cb.closest(".toggle-switch")?.classList.toggle("active", cb.checked);
      });
    });

  // початкове завантаження вже викликане через updateRoleTogglesVisibility

  modal
    .querySelector("#modal-ok-button")
    ?.addEventListener("click", async () => {
      if (await saveSettings(modal)) {
        // modal.classList.add("hidden");
      }
    });

  modal.querySelector("#modal-cancel-button")?.addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });
}

export async function openSettingsModal(): Promise<void> {
  const modal = document.getElementById("modal-settings");
  if (modal) {
    const roleButton = modal.querySelector(
      "#role-toggle-button",
    ) as HTMLButtonElement;
    const role = roleButton?.textContent?.trim() || ROLES[0];
    updateRoleTogglesVisibility(modal, role);
    modal.classList.remove("hidden");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.querySelector('[data-action="openSettings"]');
  btn?.addEventListener("click", async (e: Event) => {
    e.preventDefault();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      alert("⛔ Доступ заблоковано, Ви не авторизовані");
      return;
    }
    if (!document.getElementById("modal-settings")) {
      await createSettingsModal();
    }
    await openSettingsModal();
  });
});
