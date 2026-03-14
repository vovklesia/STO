// src\ts\roboha\dodatu_inchi_bazu\inhi\batchImportSclad.ts
// Updated: 2026-01-15 19:18
// === Guards for single init / single upload ===
let batchInitDone = false; // щоб не ініціалізувати слухачі повторно
let isUploading = false; // щоб не запустити upload кілька разів

import { CRUD, updateCRUD } from "../dodatu_inchi_bazu_danux";
import {
  shopEditState,
  detailEditState,
  resetShopState,
  resetDetailState,
} from "./scladMagasunDetal";
import { tryHandleShopsCrud, tryHandleDetailsCrud } from "../db_shops_details";
import { handleScladCrud } from "../db_sclad";
import { showNotification } from "../../zakaz_naraudy/inhi/vspluvauhe_povidomlenna";
import { supabase } from "../../../vxid/supabaseClient";
import { userName as currentUserName } from "../../tablucya/users";
import { initCustomDatePicker } from "./customDatePicker";
import { initVoiceInputExcel } from "./voiceInputExcel";
const batchModalId = "batch-import-modal-Excel";
const confirmModalId = "batch-confirm-modal-Excel";
let parsedDataGlobal: any[] = [];
let shopsListCache: string[] = [];
let detailsListCache: string[] = [];
let actsListCache: string[] = [];
let actsDateOffMap: Map<number, string | null> = new Map();
let scladIdsMap: Map<string, string> = new Map();
let warehouseListCache: string[] = []; // Кеш активних складів (номери)
let warehouseProcentMap: Map<string, number> = new Map(); // Кеш відсотків складів: warehouse_id -> procent
let usersListCache: string[] = []; // Кеш користувачів (не Слюсарів)

// ===== Снапшот оригінальних даних для відстеження змін =====
// Ключ — _scladId, значення — оригінальні поля рядка при завантаженні
let originalSnapshotMap: Map<string | number, Record<string, any>> = new Map();

// Кеш даних актів, щоб не перезавантажувати один і той самий акт
let actsDataCache: Map<number, any> = new Map();

/** Зберегти снапшот оригінальних значень рядка */
function saveRowSnapshot(row: any): void {
  if (!row._scladId) return;
  originalSnapshotMap.set(row._scladId, {
    date: row.date,
    shop: row.shop,
    catno: row.catno,
    detail: row.detail,
    qty: row.qty,
    price: row.price,
    clientPrice: row.clientPrice,
    warehouse: row.warehouse,
    invoice: row.invoice,
    actNo: row.actNo,
    unit: row.unit,
    orderStatus: row.orderStatus,
    createdBy: row.createdBy,
    notes: row.notes,
    action: row.action,
  });
}

/** Отримати тільки змінені поля для sclad update (порівняння з снапшотом) */
function getChangedScladFields(
  row: any,
  dbDate: string,
  slyusarIdForRow: number | null,
): Record<string, any> | null {
  const snapshot = originalSnapshotMap.get(row._scladId);
  if (!snapshot) return null; // Немає снапшоту — оновити все

  // Маппінг: поле рядка → поле БД + перетворення
  const fieldMap: Array<{
    rowKey: string;
    dbKey: string;
    transform: (v: any) => any;
    snapshotKey?: string;
  }> = [
    { rowKey: "date", dbKey: "time_on", transform: () => dbDate || null },
    { rowKey: "shop", dbKey: "shops", transform: (v: any) => v || null },
    { rowKey: "catno", dbKey: "part_number", transform: (v: any) => v || null },
    { rowKey: "detail", dbKey: "name", transform: (v: any) => v || null },
    {
      rowKey: "qty",
      dbKey: "kilkist_on",
      transform: (v: any) => parseFloat(v) || 0,
    },
    {
      rowKey: "price",
      dbKey: "price",
      transform: (v: any) => parseFloat(v) || 0,
    },
    { rowKey: "invoice", dbKey: "rahunok", transform: (v: any) => v || null },
    {
      rowKey: "unit",
      dbKey: "unit_measurement",
      transform: (v: any) => v || null,
    },
    { rowKey: "actNo", dbKey: "akt", transform: (v: any) => v || null },
    {
      rowKey: "warehouse",
      dbKey: "scladNomer",
      transform: (v: any) => (v ? parseFloat(v) : null),
    },
    {
      rowKey: "orderStatus",
      dbKey: "statys",
      transform: (v: any) => (v === "Прибула" ? null : v || null),
    },
    { rowKey: "notes", dbKey: "prumitka", transform: (v: any) => v || null },
    {
      rowKey: "createdBy",
      dbKey: "xto_zamovuv",
      transform: () => slyusarIdForRow || null,
    },
  ];

  const changed: Record<string, any> = {};
  let hasChanges = false;

  for (const { rowKey, dbKey, transform } of fieldMap) {
    const oldVal = String(snapshot[rowKey] ?? "");
    const newVal = String(row[rowKey] ?? "");
    if (oldVal !== newVal) {
      changed[dbKey] = transform(row[rowKey]);
      hasChanges = true;
    }
  }

  return hasChanges ? changed : null;
}

// ===== Стан сортування таблиці =====
let sortColumn: string | null = null; // Поточна колонка сортування
let sortDirection: "asc" | "desc" = "desc"; // Напрямок сортування

// Тип колонки: date, number, text
function getColumnSortType(col: string): "date" | "number" | "text" {
  if (col === "date") return "date";
  if (
    ["qty", "price", "clientPrice", "warehouse", "invoice", "actNo"].includes(
      col,
    )
  )
    return "number";
  return "text";
}

// Парсинг дати dd.mm.yy або yyyy-mm-dd → timestamp для порівняння
function parseDateForSort(dateStr: string): number {
  if (!dateStr) return 0;
  // Формат ISO: yyyy-mm-dd
  if (dateStr.includes("-")) {
    const t = new Date(dateStr).getTime();
    return isNaN(t) ? 0 : t;
  }
  // Формат: dd.mm.yy
  const parts = dateStr.split(".");
  if (parts.length !== 3) return 0;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  let year = parseInt(parts[2], 10);
  if (year < 100) year += 2000;
  return new Date(year, month, day).getTime();
}

// Сортування parsedDataGlobal та повторний рендер
function sortTableByColumn(col: string) {
  if (sortColumn === col) {
    // Той самий стовпець — міняємо напрямок
    sortDirection = sortDirection === "desc" ? "asc" : "desc";
  } else {
    // Новий стовпець
    sortColumn = col;
    // Для дати: перший клік = desc (від нової до старої)
    // Для чисел: перший клік = desc (від більшого до меншого)
    // Для тексту: перший клік = asc (А→Я)
    const type = getColumnSortType(col);
    sortDirection = type === "text" ? "asc" : "desc";
  }

  const type = getColumnSortType(col);

  parsedDataGlobal.sort((a: any, b: any) => {
    let valA = a[col];
    let valB = b[col];

    let cmp = 0;
    if (type === "date") {
      const tA = parseDateForSort(String(valA || ""));
      const tB = parseDateForSort(String(valB || ""));
      cmp = tA - tB;
    } else if (type === "number") {
      const nA = parseFloat(valA) || 0;
      const nB = parseFloat(valB) || 0;
      cmp = nA - nB;
    } else {
      // text — алфавітний порядок
      const sA = String(valA || "").toLowerCase();
      const sB = String(valB || "").toLowerCase();
      cmp = sA.localeCompare(sB, "uk");
    }

    return sortDirection === "asc" ? cmp : -cmp;
  });

  renderBatchTable(parsedDataGlobal);
}

// Оригінальні назви заголовків колонок (щоб не накопичувались індикатори)
const columnHeaderNames: Record<string, string> = {
  rowNum: "№",
  date: "Дата",
  shop: "Магазин",
  catno: "Каталог номер",
  detail: "Деталь",
  qty: "К-ть",
  price: "Ціна",
  clientPrice: "Клієнта",
  warehouse: "Склад",
  invoice: "Рах. №",
  actNo: "Акт №",
  unit: "О-ця",
  orderStatus: "Статус",
  createdBy: "Замовив",
  notes: "Примітка",
  action: "Дія",
  status: "Г-ть",
};

// Оновлення індикаторів сортування в шапці
function updateSortIndicators() {
  const thead = document.querySelector("#batch-table-Excel thead tr");
  if (!thead) return;
  thead.querySelectorAll("th").forEach((th) => {
    const col = (th as HTMLElement).dataset.col;
    if (!col) return;
    const baseText = columnHeaderNames[col] || col;
    if (col === sortColumn) {
      const arrow = sortDirection === "desc" ? "&#9660;" : "&#9650;";
      th.innerHTML = `${baseText} <span style="color:#2196f3;font-size:8px;vertical-align:middle;">${arrow}</span>`;
    } else {
      th.textContent = baseText;
    }
  });
}
let activeFilter: string = "Замовити+Замовлено"; // Поточний активний фільтр статусу
let partNumbersCache: string[] = []; // Кеш каталог номерів з бази sclad
let partNumberNameMap: Map<string, string> = new Map(); // Кеш каталог номер → назва деталі
let usersIdMap: Map<string, number> = new Map(); // Кеш ПІБ → slyusar_id
let usersIdReverseMap: Map<number, string> = new Map(); // Кеш slyusar_id → ПІБ (зворотній)
const UNIT_OPTIONS = [
  { value: "штук", label: "штук" },
  { value: "літр", label: "літр" },
  { value: "комплект", label: "комплект" },
  { value: "метр", label: "метр" },
];
const VALID_UNITS = UNIT_OPTIONS.map((o) => o.value);

// Опції для статусу деталі (Прибула/Замовлено/Замовити)
const ORDER_STATUS_OPTIONS = [
  { value: "Замовити", label: "Замовити", color: "#f87171" },
  { value: "Замовлено", label: "Замовлено", color: "#3b82f6" },
  { value: "Прибула", label: "Прибула", color: "#2D7244" },
];

// Опції для дії (Записати/Видалити)
const ACTION_OPTIONS = [
  { value: "Записати", label: "Записати", color: "#2D7244" },
  { value: "Видалити", label: "Видалити", color: "#ef4444" },
];
// ===== Допоміжні функції =====
type TableName = "shops" | "details";

// Нормалізація назви для порівняння (без врахування регістру і зайвих пробілів)
function normalizeNameForCompare(s: string): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Нормалізовані кеші для швидкого порівняння
let detailsListCacheNormalized: string[] = [];
let shopsListCacheNormalized: string[] = [];

// Перевірка чи назва існує в кеші (нормалізоване порівняння)
function detailExistsInCache(name: string): boolean {
  const normalized = normalizeNameForCompare(name);
  return detailsListCacheNormalized.includes(normalized);
}
function shopExistsInCache(name: string): boolean {
  const normalized = normalizeNameForCompare(name);
  return shopsListCacheNormalized.includes(normalized);
}

function looksLikeJson(s: string): boolean {
  const t = s.trim();
  return (
    (t.startsWith("{") && t.endsWith("}")) ||
    (t.startsWith("[") && t.endsWith("]"))
  );
}
function readName(obj: any): string | null {
  if (!obj || typeof obj !== "object") return null;
  const prioritizedKeys = ["Name", "name", "Назва", "Текст", "text", "ПІБ"];
  for (const key of prioritizedKeys) {
    const candidate = obj[key];
    if (candidate) {
      const s = String(candidate).trim();
      if (s && s !== "[object Object]" && s !== "[object Array]") return s;
    }
  }
  return null;
}
function uniqAndSort(list: string[]): string[] {
  const uniq = Array.from(new Set(list));
  const collator = new Intl.Collator(["uk", "ru", "en"], {
    sensitivity: "base",
  });
  return uniq.sort((a, b) => collator.compare(a, b));
}
function toIsoDate(dateStr: string): string {
  if (!dateStr?.trim()) return "";
  let cleanDate = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return cleanDate;

  // Підтримка dd.mm.yyyy
  const match4 = cleanDate.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (match4) {
    const [, dd, mm, yyyy] = match4;
    const d = parseInt(dd, 10);
    const m = parseInt(mm, 10);
    const y = parseInt(yyyy, 10);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 && y <= 2100) {
      return `${y}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
    }
  }

  // Підтримка dd.mm.yy
  const match2 = cleanDate.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/);
  if (match2) {
    const [, dd, mm, yy] = match2;
    const d = parseInt(dd, 10);
    const m = parseInt(mm, 10);
    const y2 = parseInt(yy, 10);
    const yyyy = y2 >= 50 ? 1900 + y2 : 2000 + y2;
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      return `${yyyy}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
    }
  }

  return "";
}
async function fetchNames(table: TableName): Promise<string[]> {
  // Завантажуємо ВСІ дані з пагінацією (Supabase обмежує 1000 рядків за запит)
  const names: string[] = [];
  let offset = 0;
  const batchSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: rows2, error: error2 } = await supabase
      .from(table)
      .select("data")
      .not("data", "is", null)
      .range(offset, offset + batchSize - 1);

    if (error2 || !Array.isArray(rows2)) {
      // console.error(`[${table}] load error:`, error2);
      break;
    }

    if (rows2.length === 0) {
      hasMore = false;
      break;
    }

    for (const r of rows2) {
      const d = (r as any)?.data;
      if (typeof d === "string") {
        const s = d.trim();
        if (!s) continue;
        if (looksLikeJson(s)) {
          try {
            const j = JSON.parse(s);
            const nm = readName(j);
            if (nm) names.push(nm);
            else names.push(s);
          } catch {
            names.push(s);
          }
        } else {
          names.push(s);
        }
        continue;
      }
      if (d && typeof d === "object") {
        const nm = readName(d);
        if (nm) names.push(nm);
      }
    }

    offset += batchSize;
    hasMore = rows2.length === batchSize;
  }

  return uniqAndSort(names);
}
async function loadShopsList(): Promise<string[]> {
  return fetchNames("shops");
}
async function loadDetailsList(): Promise<string[]> {
  return fetchNames("details");
}
async function loadActsList(): Promise<{
  list: string[];
  map: Map<number, string | null>;
}> {
  const { data, error } = await supabase
    .from("acts")
    .select("act_id, date_off, data")
    .is("date_off", null) // <-- тільки відкриті (date_off = null)
    .order("act_id", { ascending: false });

  if (error || !Array.isArray(data)) {
    // console.error("Error loading acts:", error);
    return { list: [], map: new Map() };
  }

  const map = new Map(data.map((r: any) => [r.act_id, r.date_off]));
  const list = data.map((r: any) => String(r.act_id)); // список id у вигляді рядків для автодоповнення

  // Кешуємо data кожного акта, щоб при збереженні не робити додаткових запитів
  actsDataCache.clear();
  for (const r of data) {
    if (r.data != null) {
      let parsed: any;
      if (typeof r.data === "string") {
        try {
          parsed = JSON.parse(r.data);
        } catch {
          parsed = {};
        }
      } else {
        parsed = r.data;
      }
      actsDataCache.set(r.act_id, parsed);
    }
  }

  return { list, map };
}

/** Завантаження списку активних складів з таблиці settings */
async function loadWarehouseList(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("settings")
      .select("setting_id, procent")
      .gte("setting_id", 1)
      .lte("setting_id", 500)
      .not("procent", "is", null)
      .gte("procent", 0)
      .order("setting_id", { ascending: true });

    if (error || !Array.isArray(data)) {
      // console.error("Error loading warehouses:", error);
      return [];
    }

    // Заповнюємо карту відсотків для кожного складу
    warehouseProcentMap.clear();
    data.forEach((row: { setting_id: number; procent: number }) => {
      warehouseProcentMap.set(String(row.setting_id), row.procent);
    });

    // Активні склади - повертаємо номери як рядки
    return data.map((row: { setting_id: number }) => String(row.setting_id));
  } catch (e) {
    // console.error("Error loading warehouse list:", e);
    return [];
  }
}

/** Завантаження списку користувачів (не Слюсарів) з таблиці slyusars */
async function loadUsersList(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("slyusars")
      .select("slyusar_id, data")
      .not("data", "is", null);

    if (error || !Array.isArray(data)) {
      // console.error("Error loading users:", error);
      return [];
    }

    const names: string[] = [];
    usersIdMap.clear(); // Очищуємо кеш перед оновленням
    usersIdReverseMap.clear(); // Очищуємо зворотній кеш
    for (const row of data) {
      const d = (row as any)?.data;
      const slyusarId = (row as any)?.slyusar_id;
      let parsed: any = d;
      if (typeof d === "string") {
        try {
          parsed = JSON.parse(d);
        } catch {
          continue;
        }
      }
      if (!parsed || typeof parsed !== "object") continue;

      // Пропускаємо Слюсарів
      const access = parsed["Доступ"] || parsed["доступ"] || "";
      if (access === "Слюсар") continue;

      // Отримуємо ім'я
      const name = parsed["Name"] || parsed["name"] || parsed["Ім'я"] || "";
      if (name && name.trim()) {
        const trimmedName = name.trim();
        names.push(trimmedName);
        // Зберігаємо відповідність ПІБ → slyusar_id та зворотню
        if (slyusarId) {
          usersIdMap.set(trimmedName, Number(slyusarId));
          usersIdReverseMap.set(Number(slyusarId), trimmedName);
        }
      }
    }

    return uniqAndSort(names);
  } catch (e) {
    // console.error("Error loading users list:", e);
    return [];
  }
}

/** Отримання slyusar_id за ПІБ з кешу */
function getSlyusarIdByName(name: string): number | null {
  const trimmedName = (name || "").trim();
  return usersIdMap.get(trimmedName) ?? null;
}

/* Завантаження унікальних part_number та name з таблиці sclad (з пагінацією) */
async function loadPartNumbers(): Promise<string[]> {
  try {
    const unique = new Set<string>();
    partNumberNameMap.clear();

    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from("sclad")
        .select("part_number, name")
        .order("part_number", { ascending: true })
        .range(offset, offset + batchSize - 1);

      if (error) {
        // console.error("Помилка завантаження каталог номерів:", error);
        break;
      }

      if (!data || data.length === 0) break;

      data.forEach((row: any) => {
        const pn = String(row.part_number || "").trim();
        const name = String(row.name || "").trim();
        if (pn) {
          unique.add(pn);
          // Зберігаємо перше знайдене ім'я для кожного part_number
          if (!partNumberNameMap.has(pn) && name) {
            partNumberNameMap.set(pn, name);
          }
        }
      });

      offset += batchSize;
      hasMore = data.length === batchSize;
    }

    return Array.from(unique).sort();
  } catch (e) {
    // console.error("Помилка завантаження каталог номерів:", e);
    return [];
  }
}

// Повертає id магазину або null, якщо не знайдено
async function getShopIdByName(name: string): Promise<number | null> {
  const n = (name ?? "").trim();
  if (!n) return null;
  const { data, error } = await supabase
    .from("shops")
    .select("shop_id")
    // УВАГА: БЕЗ лапок навколо Назва
    .or(`data->>Name.eq.${n},data->>name.eq.${n},data->>Назва.eq.${n}`)
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0].shop_id as number;
}
// Повертає id деталі або null, якщо не знайдено
// Підтримує як JSON формат (data->>Name), так і plain text формат (data)
async function getDetailIdByName(name: string): Promise<number | null> {
  const n = (name ?? "").trim();
  if (!n) return null;

  // Спочатку пробуємо знайти по JSON полях
  const { data: jsonData, error: jsonError } = await supabase
    .from("details")
    .select("detail_id")
    .or(`data->>Name.eq.${n},data->>name.eq.${n},data->>Назва.eq.${n}`)
    .limit(1);

  if (!jsonError && jsonData && jsonData.length > 0) {
    return jsonData[0].detail_id as number;
  }

  // Якщо не знайдено по JSON - пробуємо plain text (data = 'назва')
  const { data: textData, error: textError } = await supabase
    .from("details")
    .select("detail_id")
    .eq("data", n)
    .limit(1);

  if (!textError && textData && textData.length > 0) {
    return textData[0].detail_id as number;
  }

  // Якщо все ще не знайдено - пробуємо нормалізоване порівняння (без регістру)
  const { data: allData, error: allError } = await supabase
    .from("details")
    .select("detail_id, data");

  if (allError || !allData) return null;

  const normalizedSearch = normalizeNameForCompare(n);
  for (const row of allData) {
    const d = (row as any)?.data;
    if (!d) continue;

    // Якщо data - рядок
    if (typeof d === "string") {
      if (normalizeNameForCompare(d) === normalizedSearch) {
        return (row as any).detail_id as number;
      }
      // Якщо виглядає як JSON - парсимо
      if (looksLikeJson(d)) {
        try {
          const j = JSON.parse(d);
          const nm = readName(j);
          if (nm && normalizeNameForCompare(nm) === normalizedSearch) {
            return (row as any).detail_id as number;
          }
        } catch {
          /* ігноруємо */
        }
      }
    }
    // Якщо data - об'єкт
    if (typeof d === "object") {
      const nm = readName(d);
      if (nm && normalizeNameForCompare(nm) === normalizedSearch) {
        return (row as any).detail_id as number;
      }
    }
  }

  return null;
}
// Функція для отримання sclad_id з бази даних
async function getScladId(
  date: string,
  catno: string,
  detail: string,
): Promise<string | null> {
  const isoDate = toIsoDate(date);
  if (!isoDate) return null;
  const { data, error } = await supabase
    .from("sclad")
    .select("sclad_id, time_on, name, part_number")
    .eq("time_on", isoDate)
    .eq("name", detail)
    .eq("part_number", catno)
    .limit(1);
  if (error || !data || data.length === 0) {
    return null;
  }
  return data[0].sclad_id;
}
/** Батч-оновлення акта: завантажує акт 1 раз, додає/оновлює всі деталі, зберігає 1 раз */
async function batchUpdateActWithDetails(
  actNo: string,
  detailsArray: any[],
): Promise<boolean> {
  try {
    const actId = parseInt(actNo, 10);

    // Використовуємо кеш — якщо акт вже завантажений, беремо з кешу
    let actJsonData: any;
    if (actsDataCache.has(actId)) {
      actJsonData = actsDataCache.get(actId);
    } else {
      const { data: actData, error: fetchError } = await supabase
        .from("acts")
        .select("act_id, data")
        .eq("act_id", actId)
        .single();
      if (fetchError || !actData) {
        console.warn(`Акт №${actNo} не знайдено`, fetchError);
        return false;
      }
      if (typeof actData.data === "string") {
        try {
          actJsonData = JSON.parse(actData.data);
        } catch {
          actJsonData = {};
        }
      } else {
        actJsonData = actData.data || {};
      }
    }

    if (!actJsonData["Деталі"]) {
      actJsonData["Деталі"] = [];
    }
    if (!actJsonData["За деталі"]) {
      actJsonData["За деталі"] = 0;
    }

    // Обробляємо всі деталі з масиву
    for (const detailData of detailsArray) {
      let existingIndex = -1;

      if (detailData.sclad_id) {
        existingIndex = actJsonData["Деталі"].findIndex(
          (d: any) => d.sclad_id && d.sclad_id === detailData.sclad_id,
        );
      }

      if (existingIndex === -1 && detailData["Каталог"]) {
        const newCatNo = String(detailData["Каталог"]).trim().toLowerCase();
        const newDetailName = String(detailData["Деталь"] || "")
          .trim()
          .toLowerCase();
        if (newCatNo && newCatNo !== "?") {
          existingIndex = actJsonData["Деталі"].findIndex((d: any) => {
            const existingCatNo = String(d["Каталог"] || "")
              .trim()
              .toLowerCase();
            const existingDetailName = String(d["Деталь"] || "")
              .trim()
              .toLowerCase();
            return (
              existingCatNo === newCatNo && existingDetailName === newDetailName
            );
          });
        }
      }

      const detailSum = detailData["Сума"] || 0;

      if (existingIndex !== -1) {
        const oldDetail = actJsonData["Деталі"][existingIndex];
        actJsonData["Деталі"][existingIndex] = {
          ...oldDetail,
          Деталь: detailData["Деталь"] || oldDetail["Деталь"],
          Каталог: detailData["Каталог"] || oldDetail["Каталог"],
          Магазин: detailData["Магазин"] || oldDetail["Магазин"],
          sclad_id: detailData.sclad_id || oldDetail.sclad_id,
        };
      } else {
        actJsonData["Деталі"].push(detailData);
        actJsonData["За деталі"] = (actJsonData["За деталі"] || 0) + detailSum;
        if (actJsonData["Загальна сума"] !== undefined) {
          actJsonData["Загальна сума"] =
            (actJsonData["Загальна сума"] || 0) + detailSum;
        }
      }
    }

    // Один запит на оновлення акта (замість N запитів на кожну деталь)
    const { error: updateError } = await supabase
      .from("acts")
      .update({ data: actJsonData })
      .eq("act_id", actId);
    if (updateError) {
      console.error(`Помилка оновлення акта №${actNo}:`, updateError);
      return false;
    }

    // Оновлюємо кеш
    actsDataCache.set(actId, actJsonData);
    return true;
  } catch (err) {
    console.error(`Помилка при роботі з актом №${actNo}:`, err);
    return false;
  }
}
// ===== Модалки =====
function createConfirmModal() {
  const modal = document.createElement("div");
  modal.id = confirmModalId;
  modal.className = "modal-overlay-all_other_bases hidden-all_other_bases";
  modal.innerHTML = `
    <div class="modal-all_other_bases confirm-modal-Excel">
      <div class="confirm-content-Excel">
        <div class="confirm-icon-Excel">💾</div>
        <h3 class="confirm-title-Excel">Підтвердження завантаження</h3>
        <p class="confirm-message-Excel"></p>
        <div class="confirm-buttons-Excel">
          <button id="confirm-yes-Excel" class="confirm-btn-Excel yes-Excel">✅ Так, завантажити</button>
          <button id="confirm-no-Excel" class="confirm-btn-Excel no-Excel">❌ Скасувати</button>
        </div>
      </div>
    </div>
  `;
  return modal;
}
function showConfirmModal(count: number, totalCount: number): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = document.getElementById(confirmModalId);
    if (!modal) return resolve(false);
    const message = modal.querySelector(".confirm-message-Excel");
    if (message) {
      const isFull = count === totalCount;
      const colorStyle = isFull ? "color: #10b981;" : "color: #ef4444;"; // green-500 : red-500
      message.innerHTML = `Завантажити <strong style="${colorStyle}">${count}</strong> із <strong style="${colorStyle}">${totalCount}</strong> записів в базу даних?`;
    }
    modal.classList.remove("hidden-all_other_bases");
    const yesBtn = document.getElementById("confirm-yes-Excel");
    const noBtn = document.getElementById("confirm-no-Excel");
    const cleanup = () => {
      modal.classList.add("hidden-all_other_bases");
      yesBtn?.removeEventListener("click", onYes);
      noBtn?.removeEventListener("click", onNo);
    };
    const onYes = () => {
      cleanup();
      resolve(true);
    };
    const onNo = () => {
      cleanup();
      showNotification("Завантаження скасовано", "warning");
      resolve(false);
    };
    yesBtn?.addEventListener("click", onYes);
    noBtn?.addEventListener("click", onNo);
  });
}
function createBatchImportModal() {
  const modal = document.createElement("div");
  modal.id = batchModalId;
  modal.className = "modal-overlay-all_other_bases hidden-all_other_bases";
  modal.innerHTML = `
    <style>
      .batch-table-container-Excel {
        overflow-y: auto;
        position: relative;
      }
      .batch-table-Excel {
        border-collapse: separate; 
        border-spacing: 0;
        width: 100%;
      }
      .batch-table-Excel thead th {
        position: sticky !important;
        top: 0 !important;
        z-index: 100;
      }
      .excel-dropdown-list {
        z-index: 99999 !important;
      }
    </style>
    <div class="modal-all_other_bases batch-modal-Excel">
      <button class="modal-close-all_other_bases">×</button>
      <div class="modal-content-Excel">
        <div class="batch-filter-bar-Excel">
          <h3 class="batch-title-Excel">Записати деталі</h3>
          <div class="batch-filter-buttons-Excel">
            <button id="filter-zamovyty-btn" class="batch-filter-btn-Excel filter-red-Excel" data-filter="Замовити" title="Показати записи зі статусом Замовити">Замовити</button>
            <button id="filter-zamovleno-btn" class="batch-filter-btn-Excel filter-blue-Excel" data-filter="Замовлено" title="Показати записи зі статусом Замовлено">Замовлено</button>
            <button id="filter-prybuly-btn" class="batch-filter-btn-Excel filter-white-Excel" data-filter="Прибула" title="Показати записи зі статусом Прибула">Прибула</button>
            <button id="filter-zamovyty-zamovleno-btn" class="batch-filter-btn-Excel filter-gradient-Excel active-filter-Excel" data-filter="Замовити+Замовлено" title="Показати Замовити та Замовлено">Замовити + Замовлено</button>
          </div>
          <div class="batch-filter-dates-Excel">
            <label class="batch-filter-date-label-Excel">Від <input type="date" id="filter-date-from-Excel" class="batch-filter-date-input-Excel cell-input-Excel"></label>
            <label class="batch-filter-date-label-Excel">До <input type="date" id="filter-date-to-Excel" class="batch-filter-date-input-Excel cell-input-Excel"></label>
          </div>
        </div>
        <div id="batch-skeleton-loader" class="batch-skeleton-loader-Excel" style="display:none;">
          <div class="batch-skeleton-row-Excel">
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:7%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:8%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:10%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:15%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:6%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:6%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:7%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:8%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:8%;"></div>
          </div>
          <div class="batch-skeleton-row-Excel">
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:7%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:8%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:10%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:15%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:6%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:6%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:7%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:8%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:8%;"></div>
          </div>
          <div class="batch-skeleton-row-Excel">
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:7%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:8%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:10%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:15%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:6%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:6%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:7%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:8%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:8%;"></div>
          </div>
          <div class="batch-skeleton-row-Excel">
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:7%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:8%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:10%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:15%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:6%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:6%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:7%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:8%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:8%;"></div>
          </div>
          <div class="batch-skeleton-row-Excel">
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:7%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:8%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:10%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:15%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:6%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:5%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:6%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:7%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:8%;"></div>
            <div class="batch-skeleton-cell-Excel skeleton-pulse" style="width:8%;"></div>
          </div>
        </div>
        <p class="batch-instructions-Excel">
          Вставте дані з Excel (Ctrl+V) у форматі:<br>
          <strong>Дата прихід ┃ Магазин ┃ Каталог номер ┃ Деталь ┃ Кількість надходження ┃ Ціна ┃ Ціна клієнта ┃ Склад ┃ Рахунок № ┃ Акт № ┃ Одиниця виміру</strong><br>
        </p>
        <textarea id="batch-textarea-Excel" class="batch-textarea-Excel" placeholder="Вставте дані з Excel сюди (з табуляцією між колонками)..." autocomplete="off"></textarea>
        <div id="batch-table-container-Excel" class="batch-table-container-Excel hidden-all_other_bases">
          <table id="batch-table-Excel" class="batch-table-Excel">
            <thead>
              <tr>
                <th data-col="rowNum" style="width:2%;text-align:center;">№</th>
                <th data-col="date">Дата</th>
                <th data-col="shop">Магазин</th>
                <th data-col="catno">Каталог номер</th>
                <th data-col="detail">Деталь</th>
                <th data-col="qty">К-ть</th>
                <th data-col="price">Ціна</th>
                <th data-col="clientPrice">Клієнта</th>
                <th data-col="warehouse">Склад</th>
                <th data-col="invoice">Рах. №</th>
                <th data-col="actNo">Акт №</th>
                <th data-col="unit">О-ця</th>
                <th data-col="orderStatus">Статус</th>
                <th data-col="createdBy">Замовив</th>
                <th data-col="notes">Примітка</th>
                <th data-col="action">Дія</th>
                <th data-col="status">Г-ть</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="batch-buttons-Excel">
          <button id="batch-parse-btn-Excel" class="batch-btn-Excel parse-Excel">📋 Розпарсити</button>
          <button id="batch-add-row-btn-Excel" class="batch-btn-Excel add-row-Excel">➕ Додати рядок</button>
          <button id="voice-input-btn-Excel" class="ai-chat-voice-btn voice-btn-Excel" type="button" title="Голосове введення">🎙️</button>
          <button id="batch-upload-btn-Excel" class="batch-btn-Excel upload-Excel hidden-all_other_bases">✅ Записати</button>
        </div>
      </div>
    </div>
  `;
  return modal;
}
// ===== Парсинг =====
function parseBatchData(text: string) {
  const lines = text
    .trim()
    .split("\n")
    .filter((line) => line.trim());
  const data: any[] = [];
  lines.forEach((line, index) => {
    if (index === 0 && (line.includes("Дата") || line.includes("Магазин")))
      return;

    // Спробуємо розділити по табуляції (найбільш надійний метод з Excel)
    let parts = line.split("\t");

    // Якщо табуляція не працює (менше 6 полів), спробуємо розділити по пробілам
    if (parts.length < 6) {
      // Розділяємо по пробілам - це крайній випадок
      const tokens = line.split(/\s+/);

      if (tokens.length >= 8) {
        // Стратегія: беремо перші 3 токена як дату, магазин, каталог
        // Потім шукаємо останні числові поля
        // Все що посередині - це деталь

        // Останні 7 полів мають бути: Кількість, Ціна, Ціна клієнта, Склад, Рахунок, Акт, Одиниця
        const detailEndIdx = tokens.length - 7;
        parts = [
          tokens[0], // Дата
          tokens[1], // Магазин
          tokens[2], // Каталог номер
          tokens.slice(3, detailEndIdx).join(" "), // Деталь
          tokens[tokens.length - 7], // Кількість
          tokens[tokens.length - 6], // Ціна
          tokens[tokens.length - 5], // Ціна клієнта
          tokens[tokens.length - 4], // Склад
          tokens[tokens.length - 3], // Рахунок №
          tokens[tokens.length - 2], // Акт №
          tokens[tokens.length - 1], // Одиниця
        ];
      } else {
        parts = tokens;
      }
    }

    // Розірвемо пусті поля в кінці і доповнимо до 11 полів
    // Спочатку видалимо пусті поля з кінця
    while (parts.length > 0 && parts[parts.length - 1].trim() === "") {
      parts.pop();
    }

    // Потім доповнимо до 11 полів пустими строками
    while (parts.length < 11) {
      parts.push("");
    }

    // Trim each part, but keep empty strings
    parts = parts.map((part) => part.trim());
    // Take only first 11 parts
    parts = parts.slice(0, 11);

    // No longer filter out empties - we want all 11 fields, even empty
    if (parts.length < 11) {
      // console.warn("⚠️ Пропущено рядок (недостатньо даних):", line);
      return;
    }
    const row = {
      date: parts[0],
      shop: parts[1],
      catno: parts[2],
      detail: parts[3],
      qty: parseFloat(parts[4].replace(",", ".")) || 0,
      price: parseFloat(parts[5].replace(",", ".")) || 0,
      clientPrice: parseFloat(parts[6].replace(",", ".")) || 0,
      warehouse: parts[7], // Нове поле Склад
      invoice: parts[8],
      actNo: parts[9],
      unit: parts[10],
      status: "Готовий",
      unitValid: true,
      shopValid: true,
      detailValid: true,
      actValid: true,
      actClosed: false,
      warehouseValid: true, // Нова валідація для складу
      qtyValid: true, // Нова валідація для Кількості
      priceValid: true, // Нова валідація для Ціни
    };
    try {
      if (row.date.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
        // dd.mm.yyyy -> dd.mm.yy
        const parts4 = row.date.split(".");
        row.date = `${parts4[0]}.${parts4[1]}.${parts4[2].slice(-2)}`;
      } else if (row.date.match(/^\d{2}\.\d{2}\.\d{2}$/)) {
        // dd.mm.yy - OK
      } else if (row.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const [yyyy, mm, dd] = row.date.split("-");
        row.date = `${dd}.${mm}.${yyyy.slice(-2)}`;
      } else {
        throw new Error("Невірний формат дати");
      }
    } catch {
      row.status = "Помилка формату дати";
    }
    // Перевірка одиниці виміру
    if (!VALID_UNITS.includes(row.unit)) {
      row.unitValid = false;
    }

    // Магазин: якщо порожній - невалідний, якщо заповнений - завжди валідний (створимо якщо немає)
    if (!row.shop || !row.shop.trim()) {
      row.shopValid = false;
    } else {
      // Перевіряємо чи є в списку (для підсвічування), але завжди валідний
      const existsInCache = shopExistsInCache(row.shop);
      row.shopValid = true; // завжди валідний, якщо заповнений
      // Зберігаємо інфо чи існує (для кольору)
      (row as any).shopExists = existsInCache;
    }

    // Деталь: якщо порожня - невалідна, якщо заповнена - завжди валідна (створимо якщо немає)
    if (!row.detail || !row.detail.trim()) {
      row.detailValid = false;
    } else {
      // Перевіряємо чи є в списку (для підсвічування), але завжди валідна
      const existsInCache = detailExistsInCache(row.detail);
      row.detailValid = true; // завжди валідна, якщо заповнена
      // Зберігаємо інфо чи існує (для кольору)
      (row as any).detailExists = existsInCache;
    }

    // Акт: порожній - валідний (необов'язкове поле), заповнений - перевіряємо
    if (row.actNo && row.actNo.trim()) {
      const trimmedActNo = row.actNo.trim();
      row.actValid = actsListCache.includes(trimmedActNo);
      if (row.actValid) {
        const actIdNum = parseInt(trimmedActNo, 10);
        if (actsDateOffMap.has(actIdNum)) {
          row.actClosed = actsDateOffMap.get(actIdNum) !== null;
        }
      }
    }

    // Кількість: обов'язкове поле, повинна бути > 0
    if (isNaN(row.qty) || row.qty <= 0) {
      row.qtyValid = false;
    } else {
      row.qtyValid = true;
    }

    // Ціна: обов'язкове поле, повинна бути > 0
    if (isNaN(row.price) || row.price <= 0) {
      row.priceValid = false;
    } else {
      row.priceValid = true;
    }

    // Склад: обов'язкове поле, перевіряємо чи є в списку активних складів
    if (!row.warehouse || !row.warehouse.trim()) {
      row.warehouseValid = false;
    } else {
      // Перевіряємо чи номер складу є в списку активних
      row.warehouseValid = warehouseListCache.includes(row.warehouse.trim());
    }

    // Фінальна перевірка: тільки обов'язкові поля та їх валідність
    // Обов'язкові: Дата, Магазин, Каталог номер, Деталь, Кількість, Ціна, Одиниця, Склад
    // Необов'язкові: Рахунок №, Ціна клієнта, Акт №
    if (
      !row.qtyValid ||
      !row.priceValid ||
      !row.date ||
      !row.catno ||
      !row.detail ||
      !row.unit ||
      !row.shop ||
      !row.unitValid ||
      !row.warehouseValid
    ) {
      row.status = "Помилка";
    }
    data.push(row);
  });
  return data;
}
// ===== ДИНАМІЧНИЙ РОЗРАХУНОК ШИРИНИ КОЛОНОК =====
function calculateDynamicWidths(data: any[]): Map<string, number> {
  const columns = [
    "date",
    "shop",
    "catno",
    "detail",
    "qty",
    "price",
    "clientPrice",
    "warehouse",
    "invoice",
    "actNo",
    "unit",
    "orderStatus",
    "createdBy",
    "notes",
    "action",
    "status",
  ];
  const headers = [
    "Дата",
    "Магазин",
    "Каталог номер",
    "Деталь",
    "К-ть",
    "Ціна",
    "Клієнта",
    "Склад",
    "Рах. №",
    "Акт №",
    "О-ця",
    "Статус",
    "Замовив",
    "Примітка",
    "Дія",
    "Г-ть",
  ];
  const widths = new Map<string, number>();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return widths;
  ctx.font = "11px Arial";

  // Мінімальні ширини для колонок (у відсотках від загальної ширини)
  const minWidths: Record<string, number> = {
    date: 5,
    shop: 6,
    catno: 6,
    detail: 12,
    qty: 4,
    price: 4,
    clientPrice: 5,
    warehouse: 3,
    invoice: 5,
    actNo: 4,
    unit: 4,
    orderStatus: 6,
    createdBy: 6,
    notes: 8,
    action: 8,
    status: 2,
  };

  // Розрахунок ідеальної ширини на основі контенту
  const contentWidths = new Map<string, number>();
  let totalContentWidth = 0;

  columns.forEach((col, i) => {
    let maxWidth = ctx.measureText(headers[i]).width + 20;
    data.forEach((row) => {
      const value = String(row[col] ?? "");
      const textWidth = ctx.measureText(value).width + 20;
      if (textWidth > maxWidth) maxWidth = textWidth;
    });
    contentWidths.set(col, maxWidth);
    totalContentWidth += maxWidth;
  });

  // Перетворюємо в відсотки (пропорційно контенту)
  columns.forEach((col) => {
    const contentW = contentWidths.get(col) || 50;
    let percent = (contentW / totalContentWidth) * 100;

    // Застосовуємо мінімальну ширину
    const minW = minWidths[col] || 3;
    percent = Math.max(percent, minW);

    widths.set(col, percent);
  });

  // Нормалізуємо до 100%
  let total = 0;
  widths.forEach((v) => (total += v));
  if (total !== 100) {
    const scale = 100 / total;
    columns.forEach((col) => {
      widths.set(col, Math.round((widths.get(col) || 0) * scale * 100) / 100);
    });
  }

  return widths;
}
function applyColumnWidths(widths: Map<string, number>) {
  const thead = document.querySelector("#batch-table-Excel thead tr");
  if (!thead) return;
  thead.querySelectorAll("th").forEach((th) => {
    const col = (th as HTMLElement).dataset.col;
    if (col && widths.has(col)) {
      const percent = widths.get(col)!;
      (th as HTMLElement).style.width = `${percent}%`;
    }
  });
}
// ===== Dropdown =====
let currentDropdownInput: HTMLElement | null = null;
let currentDropdownList: HTMLElement | null = null;
function closeDropdownList() {
  currentDropdownList?.remove();
  currentDropdownList = null;
  currentDropdownInput?.classList.remove("dropdown-open");
  currentDropdownInput = null;
}
function positionDropdown(input: HTMLElement, list: HTMLElement) {
  const rect = input.getBoundingClientRect();
  const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
  const scrollY = window.pageYOffset || document.documentElement.scrollTop;

  // Оптимізація: розраховуємо ширину ТІЛЬКИ якщо вона ще не задана
  if (!list.style.width) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    let maxContentWidth = rect.width;
    if (ctx) {
      ctx.font = "14px Arial";
      list.querySelectorAll("li").forEach((li) => {
        const text = (li as HTMLElement).textContent || "";
        const textWidth = ctx.measureText(text).width + 50;
        if (textWidth > maxContentWidth) maxContentWidth = textWidth;
      });
    }
    const finalWidth = Math.min(
      Math.max(maxContentWidth, rect.width, 200),
      500,
    );
    list.style.width = `${finalWidth}px`;
  }

  const firstItem = list.querySelector("li") as HTMLElement | null;
  const itemHeight = firstItem?.offsetHeight || 30;
  const totalItems = list.children.length;
  const gap = 4;
  const padding = 16;
  const availableAbove = rect.top + scrollY - gap;
  const availableBelow = window.innerHeight - rect.bottom - gap;
  const useAbove = availableAbove >= availableBelow;
  const availableSpace = useAbove ? availableAbove : availableBelow;
  const maxItemsFromSpace = Math.floor((availableSpace - padding) / itemHeight);
  const effectiveMaxVisible = Math.min(8, Math.max(3, maxItemsFromSpace));
  const visibleItems = Math.min(effectiveMaxVisible, totalItems);
  const listHeight = visibleItems * itemHeight + padding;

  list.style.maxHeight = `${listHeight}px`;

  list.style.top = `${
    useAbove
      ? scrollY + rect.top - listHeight - gap
      : scrollY + rect.bottom + gap
  }px`;
  list.style.left = `${scrollX + rect.left}px`;
}
function showDropdownList(input: HTMLElement, options: string[]) {
  closeDropdownList();
  if (!options?.length) return;
  const list = document.createElement("ul");
  list.className = "excel-dropdown-list";
  // показуємо всі варіанти, без обрізання
  options.forEach((option) => {
    const li = document.createElement("li");
    li.className = "excel-dropdown-item";
    li.textContent = option;
    li.tabIndex = 0;
    li.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const index = parseInt(input.getAttribute("data-index") || "0");
      const field = input.getAttribute("data-field") || "";
      (input as HTMLInputElement).value = option;
      parsedDataGlobal[index][field] = option;
      const td = input.closest("td");
      if (td) {
        td.classList.remove(
          "invalid-shop",
          "invalid-detail",
          "invalid-unit",
          "invalid-act",
          "invalid-warehouse",
          "closed-act",
        );
      }
      if (field === "unit") {
        parsedDataGlobal[index].unitValid = true;
      } else if (field === "shop") {
        parsedDataGlobal[index].shopValid = true;
        (parsedDataGlobal[index] as any).shopExists = true; // вибрано зі списку = існує
      } else if (field === "detail") {
        parsedDataGlobal[index].detailValid = true;
        (parsedDataGlobal[index] as any).detailExists = true; // вибрано зі списку = існує
      } else if (field === "actNo") {
        parsedDataGlobal[index].actValid = true;
        const actIdNum = parseInt(option, 10);
        parsedDataGlobal[index].actClosed =
          actsDateOffMap.has(actIdNum) && actsDateOffMap.get(actIdNum) !== null;
        if (parsedDataGlobal[index].actClosed) {
          if (td) td.classList.add("closed-act");
        }
      } else if (field === "warehouse") {
        parsedDataGlobal[index].warehouseValid = true;
      } else if (field === "catno") {
        // Автозаповнення назви деталі з бази sclad при виборі каталог номера
        const detailName = partNumberNameMap.get(option);
        if (detailName) {
          parsedDataGlobal[index]["detail"] = detailName;
          parsedDataGlobal[index].detailValid = true;
          (parsedDataGlobal[index] as any).detailExists =
            detailExistsInCache(detailName);
          // Оновлюємо input Деталь в DOM
          const detailInput = document.querySelector(
            `#batch-table-Excel tbody tr:nth-child(${index + 1}) [data-field="detail"]`,
          ) as HTMLInputElement | HTMLTextAreaElement | null;
          if (detailInput) {
            detailInput.value = detailName;
            // Оновлюємо клас td деталі
            const detailTd = detailInput.closest("td");
            if (detailTd) {
              if (detailExistsInCache(detailName)) {
                detailTd.classList.remove("invalid-detail");
              } else {
                detailTd.classList.add("invalid-detail");
              }
            }
          }
        }
      }

      recalculateAndApplyWidths();
      revalidateRow(index);

      // Додатково: якщо всі поля валідні, явно встановлюємо статус (дублюємо логіку з updateDropdownList)
      const row = parsedDataGlobal[index];
      if (row.status === "Помилка" || row.status === "Помилка") {
        // Перевіряємо чи всі обов'язкові поля заповнені
        const allFilled =
          row.date &&
          row.shop &&
          row.catno &&
          row.detail &&
          row.unit &&
          row.warehouse;
        const numbersValid = !isNaN(row.qty) && !isNaN(row.price);
        // Примітка: unitValid і warehouseValid перевіряються вище
        if (allFilled && numbersValid && row.unitValid && row.warehouseValid) {
          // Ще раз викликаємо revalidateRow, щоб вона точно схопила нові дані
          // (іноді дані можуть не встигнути оновитися перед першим викликом)
          revalidateRow(index);
        }
      }

      closeDropdownList();
    });
    list.appendChild(li);
  });
  document.body.appendChild(list);
  currentDropdownList = list;
  currentDropdownInput = input;
  input.classList.add("dropdown-open");
  positionDropdown(input, list);
}
// ===== ФУНКЦІЯ ПЕРЕРАХУНКУ ШИРИНИ =====
function recalculateAndApplyWidths() {
  const widths = calculateDynamicWidths(parsedDataGlobal);
  applyColumnWidths(widths);
  // З table-layout: fixed ширина автоматично застосовується з th до td
}
// ===== Рендеринг таблиці =====
// Отримати світлий фоновий колір для комірки td статусу
function getOrderStatusCellBackground(status: string): string {
  switch (status) {
    case "Прибула":
      return "#dcfce7"; // світло-зелений
    case "Замовлено":
      return "#dbeafe"; // світло-синій
    case "Замовити":
    default:
      return "#fee2e2"; // світло-червоний
  }
}

// Отримати колір тексту для статусу
function getOrderStatusTextColor(status: string): string {
  switch (status) {
    case "Прибула":
      return "#2D7244"; // зелений
    case "Замовлено":
      return "#2563eb"; // синій
    case "Замовити":
    default:
      return "#dc2626"; // червоний
  }
}

// Перерахунок ціни клієнта на основі ціни та відсотка складу
function recalculateClientPrice(index: number): void {
  const row = parsedDataGlobal[index];
  if (!row) return;

  const price = parseFloat(row.price) || 0;
  const warehouseId = String(row.warehouse || "").trim();
  const procent = warehouseProcentMap.get(warehouseId) ?? 0;

  // Формула: clientPrice = price + (price * procent / 100)
  const clientPrice = price + (price * procent) / 100;
  row.clientPrice = Math.round(clientPrice * 100) / 100; // Округлення до 2 знаків

  // Оновити input в DOM — якщо 0, показуємо порожнє (placeholder покаже 0)
  const clientPriceInput = document.querySelector(
    `#batch-table-Excel tbody tr:nth-child(${index + 1}) [data-field="clientPrice"]`,
  ) as HTMLInputElement | null;
  if (clientPriceInput) {
    clientPriceInput.value =
      row.clientPrice === 0 ? "" : String(row.clientPrice);
  }
}

function createInput(
  type: string,
  value: string,
  field: string,
  index: number,
  className: string = "",
): string {
  // Для числових полів qty/price/clientPrice: якщо значення = 0, показуємо порожнє + placeholder
  const isZeroPlaceholder =
    field === "qty" || field === "price" || field === "clientPrice";
  // Для invoice: якщо порожнє - показуємо placeholder "0"
  const isInvoicePlaceholder = field === "invoice";
  const numVal = parseFloat(value as any);
  const displayValue =
    isZeroPlaceholder && (numVal === 0 || value === "" || value === "0")
      ? ""
      : isInvoicePlaceholder && (!value || value.trim() === "")
        ? ""
        : value;
  const placeholderAttr =
    isZeroPlaceholder || isInvoicePlaceholder ? 'placeholder="0"' : "";
  return `<input
    type="${type}"
    class="cell-input-Excel ${className}"
    value="${displayValue}"
    data-field="${field}"
    data-index="${index}"
    ${type === "number" ? 'step="0.01"' : ""}
    ${field === "unit" ? "readonly" : ""}
    ${placeholderAttr}
    autocomplete="off"
  >`;
}
function renderBatchTable(data: any[]) {
  const tbody = document.querySelector(
    "#batch-table-Excel tbody",
  ) as HTMLTableSectionElement;
  if (!tbody) return;
  const widths = calculateDynamicWidths(data);
  applyColumnWidths(widths);
  tbody.innerHTML = "";
  data.forEach((row, index) => {
    const tr = document.createElement("tr");
    // Магазин: жовтий якщо не існує в базі (буде створено)
    const shopTdClass =
      row.shop && !(row as any).shopExists ? "invalid-shop" : "";
    // Деталь: жовтий якщо не існує в базі (буде створено)
    const detailTdClass =
      row.detail && !(row as any).detailExists ? "invalid-detail" : "";
    const unitTdClass = !row.unitValid ? "invalid-unit" : "";
    const actTdClass =
      row.actNo && !row.actValid
        ? "invalid-act"
        : row.actClosed
          ? "closed-act"
          : "";
    // Склад: червоний якщо невалідний
    const warehouseTdClass = !row.warehouseValid ? "invalid-warehouse" : "";
    // Кількість: червоний якщо невалідна
    const qtyTdClass = !row.qtyValid ? "invalid-qty" : "";
    // Ціна: червоний якщо невалідна
    const priceTdClass = !row.priceValid ? "invalid-price" : "";
    // Рах. №: червоний якщо порожній
    const invoiceTdClass =
      !row.invoice || String(row.invoice).trim() === ""
        ? "invalid-invoice"
        : "";
    // Конвертуємо дату в ISO формат для input type="date"
    const isoDateForInput = toIsoDate(row.date) || row.date;
    tr.innerHTML = `
      <td class="row-num-cell-Excel" style="text-align:center;font-weight:bold;color:#888;user-select:none;">
        <span class="row-num-Excel">${index + 1}</span>
      </td>
      <td>
        ${createInput("date", isoDateForInput, "date", index)}
      </td>
      <td class="${shopTdClass}">
        <input
          type="text"
          class="cell-input-Excel cell-input-combo-Excel shop-input-Excel"
          value="${row.shop}"
          data-field="shop"
          data-index="${index}"
          autocomplete="off"
        >
      </td>
      <td>
        <input
          type="text"
          class="cell-input-Excel cell-input-combo-Excel catno-input-Excel"
          value="${row.catno}"
          data-field="catno"
          data-index="${index}"
          autocomplete="off"
        >
      </td>
      <td class="${detailTdClass}">
        <textarea
          class="cell-input-Excel cell-input-combo-Excel detail-input-Excel"
          data-field="detail"
          data-index="${index}"
          autocomplete="off"
          rows="1"
          style="overflow:hidden; resize:none; min-height:30px; width:100%; box-sizing:border-box; white-space: pre-wrap; line-height: 1.3; padding-top: 6px;"
        >${row.detail}</textarea>
      </td>
      <td class="${qtyTdClass}">
        ${createInput("number", row.qty, "qty", index)}
      </td>
      <td class="${priceTdClass}">
        ${createInput("number", row.price, "price", index)}
      </td>
      <td>
        ${createInput("number", row.clientPrice, "clientPrice", index)}
      </td>
      <td class="${warehouseTdClass}">
        <input
          type="text"
          class="cell-input-Excel cell-input-combo-Excel warehouse-input-Excel"
          value="${row.warehouse || ""}"
          data-field="warehouse"
          data-index="${index}"
          autocomplete="off"
          style="text-align: center;"
        >
      </td>
      <td class="${invoiceTdClass}">
        ${createInput("text", row.invoice, "invoice", index, "invoice-input-Excel")}
      </td>
      <td class="${actTdClass}">
        <input
          type="text"
          class="cell-input-Excel cell-input-combo-Excel act-input-Excel"
          value="${row.actNo}"
          data-field="actNo"
          data-index="${index}"
          autocomplete="off"
        >
      </td>
      <td class="${unitTdClass}">
        <input
          type="text"
          class="cell-input-Excel cell-input-combo-Excel unit-input-Excel"
          value="${row.unit}"
          data-field="unit"
          data-index="${index}"
          readonly
          autocomplete="off"
        >
      </td>
      <td class="orderStatus-cell-Excel" style="background-color: ${getOrderStatusCellBackground(row.orderStatus || "Замовити")}">
        <input
          type="text"
          class="cell-input-Excel cell-input-combo-Excel orderStatus-input-Excel"
          value="${row.orderStatus || "Замовити"}"
          data-field="orderStatus"
          data-index="${index}"
          readonly
          autocomplete="off"
          style="background: transparent; color: ${getOrderStatusTextColor(row.orderStatus || "Замовити")}; font-weight: bold; cursor: pointer;"
        >
      </td>
      <td>
        <input
          type="text"
          class="cell-input-Excel cell-input-combo-Excel createdBy-input-Excel"
          value="${row.createdBy || ""}"
          data-field="createdBy"
          data-index="${index}"
          autocomplete="off"
        >
      </td>
      <td>
        <input
          type="text"
          class="cell-input-Excel"
          value="${row.notes || ""}"
          data-field="notes"
          data-index="${index}"
          autocomplete="off"
          placeholder="Примітка..."
        >
      </td>
      <td class="action-cell-Excel">
        <input
          type="text"
          class="cell-input-Excel cell-input-combo-Excel action-input-Excel"
          value="${row.action || "Записати"}"
          data-field="action"
          data-index="${index}"
          readonly
          autocomplete="off"
          style="color: ${row.action === "Видалити" ? "#ef4444" : "#2D7244"}; font-weight: bold; cursor: pointer; background: transparent;"
        >
      </td>
      <td class="status-cell-Excel ${
        row.status === "Готовий"
          ? "ready-Excel"
          : row.status?.includes("Помилка")
            ? "error-Excel"
            : row.status?.includes("Успішно")
              ? "success-Excel"
              : "error-Excel"
      }">
        <span class="status-text-Excel" style="display:none;">${row.status || "Помилка"}</span>
        <button class="delete-row-btn-Excel" data-index="${index}" title="${row.status || "Помилка"}">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  attachInputHandlers(tbody);
  // Ініціалізуємо кастомний DatePicker для всіх полів дати
  initCustomDatePicker(tbody);
  // Навішуємо обробники сортування на шапку
  attachSortHandlers();
}

// ===== Навішування обробників сортування на th =====
function attachSortHandlers() {
  const thead = document.querySelector("#batch-table-Excel thead tr");
  if (!thead) return;
  thead.querySelectorAll("th").forEach((th) => {
    const col = (th as HTMLElement).dataset.col;
    if (!col || col === "status" || col === "rowNum") return; // Г-ть і № не сортуємо
    // Видаляємо попередні обробники (якщо є)
    const newTh = th.cloneNode(true) as HTMLElement;
    th.parentNode?.replaceChild(newTh, th);
    newTh.style.cursor = "pointer";
    newTh.style.userSelect = "none";
    newTh.addEventListener("click", () => {
      sortTableByColumn(col);
    });
  });
  // Оновити індикатори після навішування
  updateSortIndicators();
}
// ===== Валідація рядка при редагуванні =====
function revalidateRow(index: number) {
  const row = parsedDataGlobal[index];
  if (!row) return;

  // Якщо статус був "Успішно" або "Збережено", не чіпаємо
  if (
    row.status === "✅ Успішно" ||
    row.status === "⚠️ Збережено (акт не оновлено)"
  ) {
    return;
  }

  // Перевірка на заповненість обов'язкових полів
  // Обов'язкові: Дата, Магазин, Каталог номер, Деталь, Кількість, Ціна, Одиниця, Склад, Рах. №
  // Необов'язкові: Ціна клієнта, Акт №

  const isFilled =
    row.date &&
    String(row.date).trim() &&
    row.shop &&
    String(row.shop).trim() &&
    row.catno &&
    String(row.catno).trim() &&
    row.detail &&
    String(row.detail).trim() &&
    row.unit &&
    String(row.unit).trim() &&
    row.warehouse &&
    String(row.warehouse).trim() &&
    row.invoice &&
    String(row.invoice).trim();

  // Перевірка чисел (ціна клієнта необов'язкова)
  const areNumbersValid = !isNaN(row.qty) && !isNaN(row.price);

  // Перевірка валідності
  // shopValid і detailValid тепер завжди true якщо заповнені
  // Перевіряємо unitValid і warehouseValid
  // Акт взагалі не перевіряємо - він необов'язковий

  const isValid =
    isFilled &&
    areNumbersValid &&
    row.unitValid &&
    row.warehouseValid &&
    row.qtyValid &&
    row.priceValid;

  const statusCell = document.querySelector(
    `#batch-table-Excel tbody tr:nth-child(${index + 1}) .status-cell-Excel`,
  );
  if (!statusCell) return;
  const statusTextEl = statusCell.querySelector(".status-text-Excel");

  if (isValid) {
    row.status = "Готовий";
    statusCell.className = "status-cell-Excel ready-Excel";
    if (statusTextEl) statusTextEl.textContent = "Готовий";
  } else {
    // Якщо не валідно - ставимо помилку
    row.status = "Помилка";
    statusCell.className = "status-cell-Excel error-Excel";
    if (statusTextEl) statusTextEl.textContent = "Помилка";
  }
}

function attachInputHandlers(tbody: HTMLTableSectionElement) {
  tbody.querySelectorAll('input[data-field="date"]').forEach((input) => {
    input.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      parsedDataGlobal[index]["date"] = target.value;
      recalculateAndApplyWidths();
      revalidateRow(index);
    });
    input.addEventListener("change", (e) => {
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      parsedDataGlobal[index]["date"] = target.value;
      recalculateAndApplyWidths();
      revalidateRow(index);
    });
  });
  tbody
    .querySelectorAll(
      ".cell-input-Excel:not(.cell-input-combo-Excel):not([data-field='date'])",
    )
    .forEach((input) => {
      input.addEventListener("input", (e) => {
        const target = e.target as HTMLInputElement;
        const index = parseInt(target.dataset.index || "0");
        const field = target.dataset.field || "";
        if (field === "qty" || field === "price" || field === "clientPrice") {
          parsedDataGlobal[index][field] = parseFloat(target.value) || 0;
        } else {
          parsedDataGlobal[index][field] = target.value;
        }

        // Видалити клас invalid при редагуванні для qty та price та invoice
        const td = target.closest("td");
        if (td) {
          if (field === "qty") {
            td.classList.remove("invalid-qty");
          } else if (field === "price") {
            td.classList.remove("invalid-price");
          } else if (field === "invoice") {
            td.classList.remove("invalid-invoice");
          }
        }

        // Авторозрахунок ціни клієнта при зміні ціни
        if (field === "price") {
          recalculateClientPrice(index);
        }

        recalculateAndApplyWidths();
        revalidateRow(index);
      });

      // === Плейсхолдер для нулів: при фокусі очищаємо "0", при blur повертаємо ===
      const fieldName = (input as HTMLInputElement).dataset.field || "";
      if (
        fieldName === "qty" ||
        fieldName === "price" ||
        fieldName === "clientPrice"
      ) {
        input.addEventListener("focus", (e) => {
          const target = e.target as HTMLInputElement;
          // Якщо значення 0 або порожнє — очистити для зручності вводу
          if (target.value === "0" || target.value === "") {
            target.value = "";
          }
        });
        input.addEventListener("blur", (e) => {
          const target = e.target as HTMLInputElement;
          const index = parseInt(target.dataset.index || "0");
          const field = target.dataset.field || "";
          const val = parseFloat(target.value);
          if (isNaN(val) || val === 0) {
            // Зберігаємо 0 в дані, але показуємо порожнє (placeholder покаже 0)
            parsedDataGlobal[index][field] = 0;
            target.value = "";
          }
        });
      }
    });

  // Рах. № (invoice) — обов'язкове поле
  tbody.querySelectorAll(".invoice-input-Excel").forEach((input) => {
    input.addEventListener("blur", (e) => {
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      const value = target.value.trim();
      const td = target.closest("td");

      if (!value) {
        if (td) td.classList.add("invalid-invoice");
      } else {
        if (td) td.classList.remove("invalid-invoice");
      }
      revalidateRow(index);
    });
  });

  // Акт № з live-фільтром
  // показуємо список відкритих актів при кліку
  tbody.querySelectorAll(".act-input-Excel").forEach((input) => {
    input.addEventListener("click", (e) => {
      e.stopPropagation();
      showDropdownList(e.target as HTMLElement, actsListCache); // <-- тут наш кеш
    });

    // live-фільтр по відкритих актах
    input.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      const value = target.value;
      parsedDataGlobal[index]["actNo"] = value;

      const td = target.closest("td");
      if (td) td.classList.remove("invalid-act", "closed-act");

      const filter = value.toLowerCase();
      const filteredOptions = filter
        ? actsListCache.filter((opt) => opt.toLowerCase().includes(filter))
        : actsListCache;

      if (currentDropdownInput === target && currentDropdownList) {
        updateDropdownList(filteredOptions, target, index, "actNo");
        if (filteredOptions.length)
          positionDropdown(target, currentDropdownList);
        else closeDropdownList();
      }

      recalculateAndApplyWidths();
      revalidateRow(index);
    });

    // валідація: або порожньо, або існує серед ВІДКРИТИХ
    input.addEventListener("blur", (e) => {
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      const value = target.value.trim();
      const td = target.closest("td");

      parsedDataGlobal[index].actValid =
        !value || actsListCache.includes(value);
      parsedDataGlobal[index].actClosed = false; // бо в кеші тільки відкриті

      if (!parsedDataGlobal[index].actValid && value) {
        td?.classList.add("invalid-act");
      } else {
        td?.classList.remove("invalid-act", "closed-act");
      }
      revalidateRow(index);
    });
  });

  // Одиниці
  tbody.querySelectorAll(".unit-input-Excel").forEach((input) => {
    input.addEventListener("click", (e) => {
      e.stopPropagation();
      showDropdownList(e.target as HTMLElement, VALID_UNITS);
    });
    input.addEventListener("blur", (e) => {
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      const value = target.value;
      const td = target.closest("td");
      if (!VALID_UNITS.includes(value)) {
        if (td) {
          td.classList.add("invalid-unit");
        }
        parsedDataGlobal[index].unitValid = false;
      } else {
        if (td) {
          td.classList.remove("invalid-unit");
        }
        parsedDataGlobal[index].unitValid = true;
      }
      revalidateRow(index);
    });
  });
  // Магазин з live-фільтром
  tbody.querySelectorAll(".shop-input-Excel").forEach((input) => {
    input.addEventListener("click", (e) => {
      e.stopPropagation();
      showDropdownList(e.target as HTMLElement, shopsListCache);
    });
    input.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      const value = target.value;
      parsedDataGlobal[index]["shop"] = value;
      const td = target.closest("td");
      if (td) {
        td.classList.remove("invalid-shop");
      }
      const filter = value.toLowerCase();
      const filteredOptions = filter
        ? shopsListCache.filter((opt) => opt.toLowerCase().includes(filter))
        : shopsListCache;
      if (currentDropdownInput === target && currentDropdownList) {
        updateDropdownList(filteredOptions, target, index, "shop");
        if (filteredOptions.length)
          positionDropdown(target, currentDropdownList);
        else closeDropdownList();
      }
      recalculateAndApplyWidths();
      revalidateRow(index);
    });
    input.addEventListener("blur", (e) => {
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      const value = target.value.trim();
      const td = target.closest("td");

      if (!value) {
        // Порожній - невалідний
        parsedDataGlobal[index].shopValid = false;
        (parsedDataGlobal[index] as any).shopExists = false;
      } else {
        // Заповнений - завжди валідний, але перевіряємо чи існує
        const existsInCache = shopExistsInCache(value);
        parsedDataGlobal[index].shopValid = true;
        (parsedDataGlobal[index] as any).shopExists = existsInCache;

        // Колір: жовтий якщо не існує
        if (!existsInCache) {
          if (td) td.classList.add("invalid-shop");
        } else {
          if (td) td.classList.remove("invalid-shop");
        }
      }
      revalidateRow(index);
    });
  });
  // Деталь з live-фільтром
  tbody.querySelectorAll(".detail-input-Excel").forEach((el) => {
    const input = el as HTMLInputElement | HTMLTextAreaElement;

    // Авто-розширення висоти
    const autoResize = () => {
      input.style.height = "auto";
      input.style.height = input.scrollHeight + "px";
    };
    // Ініціалізація висоти
    setTimeout(autoResize, 0);

    input.addEventListener("click", (e) => {
      e.stopPropagation();
      showDropdownList(e.target as HTMLElement, detailsListCache);
    });
    input.addEventListener("input", (e) => {
      autoResize(); // Авто-ресайз при введенні
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      const value = target.value;
      parsedDataGlobal[index]["detail"] = value;
      const td = target.closest("td");
      if (td) {
        td.classList.remove("invalid-detail");
      }
      const filter = value.toLowerCase();
      const filteredOptions = filter
        ? detailsListCache.filter((opt) => opt.toLowerCase().includes(filter))
        : detailsListCache;

      // Якщо dropdown ще не відкритий - відкриваємо з фільтрованими опціями
      if (!currentDropdownList || currentDropdownInput !== target) {
        if (filteredOptions.length > 0) {
          showDropdownList(target, filteredOptions);
        }
      } else {
        // Якщо вже відкритий - оновлюємо
        updateDropdownList(filteredOptions, target, index, "detail");
        if (filteredOptions.length)
          positionDropdown(target, currentDropdownList);
        else closeDropdownList();
      }
      recalculateAndApplyWidths();
      revalidateRow(index);
    });
    input.addEventListener("blur", (e) => {
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      const value = target.value.trim();
      const td = target.closest("td");

      if (!value) {
        // Порожня - невалідна
        parsedDataGlobal[index].detailValid = false;
        (parsedDataGlobal[index] as any).detailExists = false;
      } else {
        // Заповнена - завжди валідна, але перевіряємо чи існує
        const existsInCache = detailExistsInCache(value);
        parsedDataGlobal[index].detailValid = true;
        (parsedDataGlobal[index] as any).detailExists = existsInCache;

        // Колір: жовтий якщо не існує
        if (!existsInCache) {
          if (td) td.classList.add("invalid-detail");
        } else {
          if (td) td.classList.remove("invalid-detail");
        }
      }
      revalidateRow(index);
    });
  });

  // === Каталог номер (catno) з live-фільтром по part_number з бази sclad ===
  tbody.querySelectorAll(".catno-input-Excel").forEach((input) => {
    input.addEventListener("click", (e) => {
      e.stopPropagation();
      if (partNumbersCache.length > 0) {
        showDropdownList(e.target as HTMLElement, partNumbersCache);
      }
    });
    input.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      const value = target.value;
      parsedDataGlobal[index]["catno"] = value;

      const filter = value.toLowerCase();
      const filteredOptions = filter
        ? partNumbersCache.filter((opt) => opt.toLowerCase().includes(filter))
        : partNumbersCache;

      // Якщо dropdown ще не відкритий — відкриваємо з фільтрованими опціями
      if (!currentDropdownList || currentDropdownInput !== target) {
        if (filteredOptions.length > 0) {
          showDropdownList(target, filteredOptions);
        }
      } else {
        // Якщо вже відкритий — оновлюємо
        updateDropdownList(filteredOptions, target, index, "catno");
        if (filteredOptions.length)
          positionDropdown(target, currentDropdownList);
        else closeDropdownList();
      }
      recalculateAndApplyWidths();
      revalidateRow(index);
    });
  });

  // Склад з live-фільтром
  tbody.querySelectorAll(".warehouse-input-Excel").forEach((input) => {
    input.addEventListener("click", (e) => {
      e.stopPropagation();
      showDropdownList(e.target as HTMLElement, warehouseListCache);
    });
    input.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      const value = target.value;
      parsedDataGlobal[index]["warehouse"] = value;
      const td = target.closest("td");
      if (td) {
        td.classList.remove("invalid-warehouse");
      }
      const filter = value.toLowerCase();
      const filteredOptions = filter
        ? warehouseListCache.filter((opt) => opt.toLowerCase().includes(filter))
        : warehouseListCache;
      if (currentDropdownInput === target && currentDropdownList) {
        updateDropdownList(filteredOptions, target, index, "warehouse");
        if (filteredOptions.length)
          positionDropdown(target, currentDropdownList);
        else closeDropdownList();
      }
      recalculateAndApplyWidths();
      revalidateRow(index);
    });
    input.addEventListener("blur", (e) => {
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      const value = target.value.trim();
      const td = target.closest("td");

      if (!value) {
        // Порожній - невалідний
        parsedDataGlobal[index].warehouseValid = false;
        if (td) td.classList.add("invalid-warehouse");
      } else {
        // Перевіряємо чи є в списку активних складів
        const existsInCache = warehouseListCache.includes(value);
        parsedDataGlobal[index].warehouseValid = existsInCache;

        // Колір: червоний якщо не існує
        if (!existsInCache) {
          if (td) td.classList.add("invalid-warehouse");
        } else {
          if (td) td.classList.remove("invalid-warehouse");
        }
      }

      // Перерахунок ціни клієнта при зміні складу
      recalculateClientPrice(index);

      revalidateRow(index);
    });
  });

  // Кількість (qty) з валідацією > 0
  tbody.querySelectorAll('[data-field="qty"]').forEach((input) => {
    input.addEventListener("blur", (e) => {
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      const value = parseFloat(target.value) || 0;
      const td = target.closest("td");

      parsedDataGlobal[index].qtyValid = value > 0;

      if (value <= 0) {
        if (td) td.classList.add("invalid-qty");
      } else {
        if (td) td.classList.remove("invalid-qty");
      }
      revalidateRow(index);
    });
  });

  // Ціна (price) з валідацією > 0
  tbody.querySelectorAll('[data-field="price"]').forEach((input) => {
    input.addEventListener("blur", (e) => {
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      const value = parseFloat(target.value) || 0;
      const td = target.closest("td");

      parsedDataGlobal[index].priceValid = value > 0;

      if (value <= 0) {
        if (td) td.classList.add("invalid-price");
      } else {
        if (td) td.classList.remove("invalid-price");
      }
      revalidateRow(index);
    });
  });

  // Статус замовлення (orderStatus) з випадаючим списком
  tbody.querySelectorAll(".orderStatus-input-Excel").forEach((input) => {
    input.addEventListener("click", (e) => {
      e.stopPropagation();
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      showOrderStatusDropdown(target, index);
    });
  });

  // Хто створив (createdBy) з випадаючим списком користувачів
  tbody.querySelectorAll(".createdBy-input-Excel").forEach((input) => {
    input.addEventListener("click", (e) => {
      e.stopPropagation();
      showDropdownList(e.target as HTMLElement, usersListCache);
    });
    input.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      const value = target.value;
      parsedDataGlobal[index]["createdBy"] = value;

      const filter = value.toLowerCase();
      const filteredOptions = filter
        ? usersListCache.filter((opt) => opt.toLowerCase().includes(filter))
        : usersListCache;
      if (currentDropdownInput === target && currentDropdownList) {
        updateDropdownList(filteredOptions, target, index, "createdBy");
        if (filteredOptions.length)
          positionDropdown(target, currentDropdownList);
        else closeDropdownList();
      }
      recalculateAndApplyWidths();
    });
  });

  // Дія (action) з випадаючим списком
  tbody.querySelectorAll(".action-input-Excel").forEach((input) => {
    input.addEventListener("click", (e) => {
      e.stopPropagation();
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      showActionDropdown(target, index);
    });
  });

  // Примітка (notes)
  tbody.querySelectorAll('[data-field="notes"]').forEach((input) => {
    input.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      const index = parseInt(target.dataset.index || "0");
      parsedDataGlobal[index]["notes"] = target.value;
      recalculateAndApplyWidths();
    });
  });

  // Видалення рядка
  tbody.querySelectorAll(".delete-row-btn-Excel").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const index = parseInt(
        (e.target as HTMLButtonElement).dataset.index || "0",
      );
      parsedDataGlobal.splice(index, 1);
      renderBatchTable(parsedDataGlobal);
      showNotification(`Рядок ${index + 1} видалено`, "success", 2000);
      if (parsedDataGlobal.length === 0) {
        resetModalState();
      }
    });
  });
}
function updateDropdownList(
  options: string[],
  target: HTMLInputElement,
  index: number,
  field: string,
) {
  if (!currentDropdownList) return;
  currentDropdownList.innerHTML = "";
  // теж без обрізання
  options.forEach((option) => {
    const li = document.createElement("li");
    li.className = "excel-dropdown-item";
    li.textContent = option;
    li.tabIndex = 0;
    li.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      target.value = option;
      parsedDataGlobal[index][field] = option;
      const td = target.closest("td");
      if (td) {
        td.classList.remove(
          "invalid-shop",
          "invalid-detail",
          "invalid-unit",
          "invalid-act",
          "invalid-warehouse",
          "closed-act",
        );
      }
      if (field === "unit") {
        parsedDataGlobal[index].unitValid = true;
      } else if (field === "shop") {
        parsedDataGlobal[index].shop = option; // явно оновлюємо
        parsedDataGlobal[index].shopValid = true;
        (parsedDataGlobal[index] as any).shopExists = true; // вибрано зі списку = існує
      } else if (field === "detail") {
        parsedDataGlobal[index].detail = option; // явно оновлюємо
        parsedDataGlobal[index].detailValid = true;
        (parsedDataGlobal[index] as any).detailExists = true; // вибрано зі списку = існує
      } else if (field === "actNo") {
        parsedDataGlobal[index].actNo = option; // явно оновлюємо
        parsedDataGlobal[index].actValid = true;
        const actIdNum = parseInt(option, 10);
        parsedDataGlobal[index].actClosed =
          actsDateOffMap.has(actIdNum) && actsDateOffMap.get(actIdNum) !== null;
        if (parsedDataGlobal[index].actClosed) {
          if (td) td.classList.add("closed-act");
        }
      } else if (field === "warehouse") {
        parsedDataGlobal[index].warehouse = option; // явно оновлюємо
        parsedDataGlobal[index].warehouseValid = true;
        // Перерахунок ціни клієнта при виборі складу
        recalculateClientPrice(index);
      }

      // Примусово оновлюємо статус
      recalculateAndApplyWidths();
      revalidateRow(index);

      // Додатково: якщо всі поля валідні, явно встановлюємо статус
      const row = parsedDataGlobal[index];
      if (row.status === "Помилка" || row.status === "Помилка") {
        // Перевіряємо чи всі обов'язкові поля заповнені
        const allFilled =
          row.date &&
          row.shop &&
          row.catno &&
          row.detail &&
          row.unit &&
          row.warehouse;
        const numbersValid = !isNaN(row.qty) && !isNaN(row.price);
        if (allFilled && numbersValid && row.unitValid && row.warehouseValid) {
          row.status = "Готовий";
          const statusCell = document.querySelector(
            `#batch-table-Excel tbody tr:nth-child(${index + 1}) .status-cell-Excel`,
          );
          if (statusCell) {
            statusCell.className = "status-cell-Excel ready-Excel";
            const statusText = statusCell.querySelector(".status-text-Excel");
            if (statusText) statusText.textContent = "Готовий";
          }
        }
      }

      closeDropdownList();
    });
    currentDropdownList!.appendChild(li);
  });
}
// Показати випадаючий список для статусу замовлення
function showOrderStatusDropdown(input: HTMLInputElement, index: number) {
  closeDropdownList();
  const list = document.createElement("ul");
  list.className = "excel-dropdown-list";

  ORDER_STATUS_OPTIONS.forEach((opt) => {
    const li = document.createElement("li");
    li.className = "excel-dropdown-item";
    li.textContent = opt.label;
    li.style.color = opt.color;
    li.style.fontWeight = "bold";
    li.tabIndex = 0;
    li.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      input.value = opt.value;
      parsedDataGlobal[index]["orderStatus"] = opt.value;

      // Оновлюємо фоновий колір комірки td
      const td = input.closest("td");
      if (td) {
        td.style.backgroundColor = getOrderStatusCellBackground(opt.value);
      }

      // Оновлюємо колір тексту
      input.style.color = getOrderStatusTextColor(opt.value);

      closeDropdownList();
    });
    list.appendChild(li);
  });

  currentDropdownInput = input;
  currentDropdownList = list;
  input.classList.add("dropdown-open");
  document.body.appendChild(list);
  positionDropdown(input, list);
}

// Показати випадаючий список для дії
function showActionDropdown(input: HTMLInputElement, index: number) {
  closeDropdownList();
  const list = document.createElement("ul");
  list.className = "excel-dropdown-list";

  ACTION_OPTIONS.forEach((opt) => {
    const li = document.createElement("li");
    li.className = "excel-dropdown-item";
    li.textContent = opt.label;
    li.style.color = opt.color;
    li.style.fontWeight = "bold";
    li.tabIndex = 0;
    li.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      input.value = opt.value;
      parsedDataGlobal[index]["action"] = opt.value;

      // Оновлюємо колір тексту
      input.style.color = opt.color;

      closeDropdownList();
    });
    list.appendChild(li);
  });

  currentDropdownInput = input;
  currentDropdownList = list;
  input.classList.add("dropdown-open");
  document.body.appendChild(list);
  positionDropdown(input, list);
}

// Створення порожнього рядка даних з дефолтними значеннями
function createEmptyRow(): any {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`; // ISO формат для input type="date"

  return {
    date: todayStr,
    shop: "",
    catno: "",
    detail: "",
    qty: 0,
    price: 0,
    clientPrice: 0,
    warehouse: warehouseListCache.length > 0 ? warehouseListCache[0] : "",
    invoice: "",
    actNo: "",
    unit: "штук",
    orderStatus: "Замовити",
    createdBy: currentUserName || "",
    notes: "",
    action: "Записати",
    status: "Помилка",
    shopValid: false,
    detailValid: false,
    unitValid: true,
    actValid: true,
    actClosed: false,
    warehouseValid: warehouseListCache.length > 0,
    qtyValid: false,
    priceValid: false,
    shopExists: false,
    detailExists: false,
  };
}

/* Завантаження записів з sclad за фільтром статусу та датами */
async function loadScladFilteredRecords(
  statusFilter?: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<any[]> {
  const filter = statusFilter || activeFilter;
  try {
    let query = supabase.from("sclad").select("*");

    // Фільтр за статусом
    if (filter === "Замовити") {
      query = query.eq("statys", "Замовити");
    } else if (filter === "Замовлено") {
      query = query.eq("statys", "Замовлено");
    } else if (filter === "Прибула") {
      query = query.is("statys", null);
    } else {
      // Замовити+Замовлено (за замовчуванням)
      query = query.in("statys", ["Замовити", "Замовлено"]);
    }

    // Фільтр за датами
    if (dateFrom) {
      query = query.gte("time_on", dateFrom);
    }
    if (dateTo) {
      query = query.lte("time_on", dateTo);
    }

    // Завантажуємо ВСІ записи з пагінацією (Supabase ліміт 1000 за запит)
    const allData: any[] = [];
    const batchSize = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: chunk, error } = await query
        .order("sclad_id", { ascending: false })
        .range(offset, offset + batchSize - 1);

      if (error) {
        // console.error("Помилка завантаження записів sclad:", error);
        break;
      }
      if (!chunk || chunk.length === 0) break;

      allData.push(...chunk);
      offset += batchSize;
      hasMore = chunk.length === batchSize;
    }

    const data = allData;
    if (data.length === 0) return [];

    // Конвертуємо записи sclad у формат рядка таблиці batch
    return data.map((rec: any) => {
      const dateRaw = String(rec.time_on || "").trim();
      // Конвертуємо дату в ISO формат для input type="date"
      const isoDate = toIsoDate(dateRaw) || dateRaw;

      const shop = String(rec.shops || "").trim();
      const catno = String(rec.part_number || "").trim();
      const detail = String(rec.name || "").trim();
      const qty = parseFloat(rec.kilkist_on) || 0;
      const price = parseFloat(rec.price) || 0;
      const warehouse = String(rec.scladNomer ?? "").trim();
      const invoice = String(rec.rahunok || "").trim();
      const actNo = rec.akt ? String(rec.akt).trim() : "";
      const unit = String(rec.unit_measurement || "штук").trim();
      const orderStatus = rec.statys ? String(rec.statys).trim() : "Прибула";
      const notes = String(rec.prumitka || "").trim();

      // Визначаємо ПІБ замовника за slyusar_id
      let createdBy = "";
      if (rec.xto_zamovuv) {
        createdBy = usersIdReverseMap.get(Number(rec.xto_zamovuv)) || "";
      }

      // Перерахунок ціни клієнта на основі відсотка складу
      const procent = warehouseProcentMap.get(warehouse) ?? 0;
      const clientPrice =
        Math.round((price + (price * procent) / 100) * 100) / 100;

      // Валідація полів
      const shopValid = !!shop;
      const shopExists = shop ? shopExistsInCache(shop) : false;
      const detailValid = !!detail;
      const detailExists = detail ? detailExistsInCache(detail) : false;
      const unitValid = VALID_UNITS.includes(unit);
      const warehouseValid = warehouse
        ? warehouseListCache.includes(warehouse)
        : false;
      const qtyValid = qty > 0;
      const priceValid = price > 0;
      const actValid = !actNo || actsListCache.includes(actNo);
      const actClosed = actNo
        ? actsDateOffMap.has(parseInt(actNo)) &&
          actsDateOffMap.get(parseInt(actNo)) !== null
        : false;

      const allValid =
        shopValid &&
        detailValid &&
        unitValid &&
        warehouseValid &&
        qtyValid &&
        priceValid &&
        !!isoDate &&
        !!catno &&
        actValid;

      const rowObj = {
        date: isoDate,
        shop,
        catno,
        detail,
        qty,
        price,
        clientPrice,
        warehouse,
        invoice,
        actNo,
        unit,
        orderStatus,
        createdBy,
        notes,
        action: "Записати",
        status: allValid ? "Готовий" : "Помилка",
        shopValid,
        detailValid,
        unitValid,
        actValid,
        actClosed,
        warehouseValid,
        qtyValid,
        priceValid,
        shopExists,
        detailExists,
        _scladId: rec.sclad_id, // Зберігаємо sclad_id для можливого оновлення
      };
      // Зберігаємо снапшот оригінальних даних для відстеження змін
      saveRowSnapshot(rowObj);
      return rowObj;
    });
  } catch (e) {
    // console.error("Помилка завантаження записів sclad:", e);
    return [];
  }
}

/** Застосувати фільтр кнопок + дат та перезавантажити таблицю */
async function applyFilterAndReload(): Promise<void> {
  const dateFrom =
    (document.getElementById("filter-date-from-Excel") as HTMLInputElement)
      ?.value || "";
  const dateTo =
    (document.getElementById("filter-date-to-Excel") as HTMLInputElement)
      ?.value || "";

  // Skeleton
  const skeleton = document.getElementById("batch-skeleton-loader");
  const tableContainer = document.getElementById("batch-table-container-Excel");
  if (skeleton) skeleton.style.display = "block";
  if (tableContainer) tableContainer.classList.add("hidden-all_other_bases");

  originalSnapshotMap.clear();
  const records = await loadScladFilteredRecords(
    activeFilter,
    dateFrom,
    dateTo,
  );

  if (records.length > 0) {
    parsedDataGlobal = records;
  } else {
    parsedDataGlobal = [createEmptyRow()];
  }
  renderBatchTable(parsedDataGlobal);

  if (skeleton) skeleton.style.display = "none";
  if (tableContainer) tableContainer.classList.remove("hidden-all_other_bases");
  document
    .getElementById("batch-upload-btn-Excel")
    ?.classList.remove("hidden-all_other_bases");

  // Скидаємо стан кнопки "Записати"
  const uploadBtn = document.getElementById(
    "batch-upload-btn-Excel",
  ) as HTMLButtonElement | null;
  if (uploadBtn) {
    uploadBtn.removeAttribute("disabled");
    uploadBtn.style.backgroundColor = "";
    uploadBtn.style.cursor = "";
    uploadBtn.textContent = "✅ Записати";
  }

  updateFilterButtonsActive();
}

/** Оновити візуальний стан активної кнопки фільтра */
function updateFilterButtonsActive(): void {
  const buttons = document.querySelectorAll(".batch-filter-btn-Excel");
  buttons.forEach((btn) => {
    const el = btn as HTMLElement;
    if (el.dataset.filter === activeFilter) {
      el.classList.add("active-filter-Excel");
    } else {
      el.classList.remove("active-filter-Excel");
    }
  });
}

async function resetModalState() {
  // Очищуємо снапшоти та кеш актів при скиданні стану
  originalSnapshotMap.clear();
  actsDataCache.clear();

  const textarea = document.getElementById(
    "batch-textarea-Excel",
  ) as HTMLTextAreaElement;
  const instructions = document.querySelector(
    ".batch-instructions-Excel",
  ) as HTMLElement;
  const parseBtn = document.getElementById(
    "batch-parse-btn-Excel",
  ) as HTMLButtonElement;

  // Ховаємо textarea та instructions
  if (textarea) {
    textarea.style.display = "none";
    textarea.value = "";
  }
  if (instructions) instructions.style.display = "none";

  // Ховаємо кнопку "Розпарсити"
  if (parseBtn) parseBtn.style.display = "none";

  // При відкритті — порожня таблиця, нічого не підтягуємо
  parsedDataGlobal = [createEmptyRow()];
  renderBatchTable(parsedDataGlobal);

  // Показуємо таблицю та кнопку "Завантажити"
  document
    .getElementById("batch-table-container-Excel")
    ?.classList.remove("hidden-all_other_bases");
  document
    .getElementById("batch-upload-btn-Excel")
    ?.classList.remove("hidden-all_other_bases");

  // Скидаємо стан кнопки "Записати" до початкового
  const uploadBtn = document.getElementById(
    "batch-upload-btn-Excel",
  ) as HTMLButtonElement | null;
  if (uploadBtn) {
    uploadBtn.removeAttribute("disabled");
    uploadBtn.style.backgroundColor = "";
    uploadBtn.style.cursor = "";
    uploadBtn.textContent = "✅ Записати";
  }
}
// ===== Завантаження даних у БД =====
async function uploadBatchData(data: any[]) {
  // 🔒 анти-дублювання: якщо вже йде аплоад — ігноруємо повторний виклик
  if (isUploading) return;
  isUploading = true;

  const uploadBtn = document.getElementById("batch-upload-btn-Excel");
  uploadBtn?.classList.add("loading-Excel");
  uploadBtn?.setAttribute("disabled", "true");

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  scladIdsMap.clear();

  // --- локальні хелпери (self-contained) ---
  async function ensureShopDataName(id: number, name: string): Promise<void> {
    const { data: row } = await supabase
      .from("shops")
      .select("data")
      .eq("shop_id", id)
      .single();
    let newData: any = {};
    if (row?.data && typeof row.data === "object") newData = { ...row.data };
    if (!newData.Name && !newData.name && !newData["Назва"]) {
      newData.Name = name;
      await supabase.from("shops").update({ data: newData }).eq("shop_id", id);
    }
  }

  async function ensureDetailDataName(id: number, name: string): Promise<void> {
    const { data: row } = await supabase
      .from("details")
      .select("data")
      .eq("detail_id", id)
      .single();

    // Якщо data вже є рядком (plain text) - нічого не оновлюємо
    // Назва вже записана в потрібному форматі
    if (row?.data && typeof row.data === "string") {
      return;
    }

    let newData: any = {};
    if (row?.data && typeof row.data === "object") newData = { ...row.data };
    if (!newData.Name && !newData.name && !newData["Назва"]) {
      newData.Name = name;
      await supabase
        .from("details")
        .update({ data: newData })
        .eq("detail_id", id);
    }
  }

  try {
    // 1) Унікальні назви
    const uniqueShops = [
      ...new Set(data.map((row) => (row.shop ?? "").trim()).filter(Boolean)),
    ];
    const uniqueDetails = [
      ...new Set(data.map((row) => (row.detail ?? "").trim()).filter(Boolean)),
    ];

    // 2) Кеш існуючих
    const existingShops = new Map<string, number>();
    const existingDetails = new Map<string, number>();

    // 3) Shops - з перевіркою на дублікати
    for (const shopName of uniqueShops) {
      // Спочатку перевіряємо чи вже є в кеші (створений раніше в цьому ж батчі)
      if (existingShops.has(shopName)) {
        continue;
      }

      let shopId = await getShopIdByName(shopName);
      if (!shopId) {
        resetShopState();
        shopEditState.currentName = shopName;
        shopEditState.touched = true;
        await tryHandleShopsCrud();

        // Невелика затримка для синхронізації з БД
        await new Promise((resolve) => setTimeout(resolve, 100));

        shopId = await getShopIdByName(shopName);
        if (shopId) {
        } else {
          // console.warn(`⚠️ Не вдалося отримати ID для магазину "${shopName}"`);
        }
      } else {
      }

      if (shopId) {
        await ensureShopDataName(shopId, shopName);
        existingShops.set(shopName, shopId);
      }
    }

    // 4) Details - з перевіркою на дублікати
    for (const detailName of uniqueDetails) {
      // Спочатку перевіряємо чи вже є в кеші (створена раніше в цьому ж батчі)
      if (existingDetails.has(detailName)) {
        continue;
      }

      let detailId = await getDetailIdByName(detailName);
      if (!detailId) {
        resetDetailState();
        detailEditState.currentName = detailName;
        detailEditState.touched = true;
        await tryHandleDetailsCrud();

        // Невелика затримка для синхронізації з БД
        await new Promise((resolve) => setTimeout(resolve, 100));

        detailId = await getDetailIdByName(detailName);
        if (detailId) {
        } else {
          // console.warn(`⚠️ Не вдалося отримати ID для деталі "${detailName}"`);
        }
      } else {
      }

      if (detailId) {
        await ensureDetailDataName(detailId, detailName);
        existingDetails.set(detailName, detailId);
      }
    }

    // 5) Обробка кожного рядка — зі smart diff (тільки змінені поля)
    // Збираємо дані для батч-оновлення актів
    const actUpdatesMap: Map<
      string,
      Array<{ rowIndex: number; scladIdWeb: string | null; detailForAct: any }>
    > = new Map();

    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      // дата для БД (yyyy-mm-dd)
      let dbDate = row.date;
      if (/^\d{2}\.\d{2}\.\d{4}$/.test(row.date)) {
        const [dd, mm, yyyy] = row.date.split(".");
        dbDate = `${yyyy}-${mm}-${dd}`;
      }

      // Отримуємо slyusar_id за ПІБ з кешу
      const slyusarIdForRow = row.createdBy
        ? getSlyusarIdByName(row.createdBy)
        : null;

      // === Якщо дія = "Видалити" — видаляємо запис з бази ===
      if (row.action === "Видалити") {
        if (row._scladId) {
          try {
            const { error: deleteError } = await supabase
              .from("sclad")
              .delete()
              .eq("sclad_id", row._scladId);

            const delDomIdx = (row.rowNumber || i + 1) - 1;
            if (deleteError) {
              console.error(
                `Помилка видалення sclad_id=${row._scladId}:`,
                deleteError,
              );
              errorCount++;
              updateRowStatus(delDomIdx, false, "❌ Помилка видалення");
              if (parsedDataGlobal[delDomIdx])
                parsedDataGlobal[delDomIdx].status = "❌ Помилка видалення";
            } else {
              successCount++;
              updateRowStatus(delDomIdx, true, "🗑️ Видалено");
              if (parsedDataGlobal[delDomIdx])
                parsedDataGlobal[delDomIdx].status = "🗑️ Видалено";
            }
          } catch (err) {
            const delDomIdx2 = (row.rowNumber || i + 1) - 1;
            console.error(`Помилка видалення sclad_id=${row._scladId}:`, err);
            errorCount++;
            updateRowStatus(delDomIdx2, false, "❌ Помилка видалення");
            if (parsedDataGlobal[delDomIdx2])
              parsedDataGlobal[delDomIdx2].status = "❌ Помилка видалення";
          }
        } else {
          // Новий рядок з дією "Видалити" — просто пропускаємо
          const skipDomIdx = (row.rowNumber || i + 1) - 1;
          successCount++;
          updateRowStatus(skipDomIdx, true, "🗑️ Пропущено");
          if (parsedDataGlobal[skipDomIdx])
            parsedDataGlobal[skipDomIdx].status = "🗑️ Пропущено";
        }
        continue;
      }

      // === Якщо рядок завантажений з бази (має _scladId) — UPDATE, інакше перевіряємо на дублікат ===
      const isExistingRecord = !!row._scladId;

      let scladSuccess = false;
      let rowSkipped = false; // true якщо рядок без змін — пропущений

      if (isExistingRecord) {
        // === SMART DIFF: порівнюємо зі снапшотом, оновлюємо тільки змінені поля ===
        const changedFields = getChangedScladFields(
          row,
          dbDate,
          slyusarIdForRow,
        );

        if (changedFields === null) {
          // Нічого не змінилось — пропускаємо запис у sclad
          scladSuccess = true;
          rowSkipped = true;
          skippedCount++;
        } else {
          // Є зміни — оновлюємо тільки змінені поля
          try {
            const { error: updateError } = await supabase
              .from("sclad")
              .update(changedFields)
              .eq("sclad_id", row._scladId);

            scladSuccess = !updateError;
            if (updateError) {
              console.error(
                `Помилка оновлення sclad_id=${row._scladId}:`,
                updateError,
              );
            }
          } catch (err) {
            scladSuccess = false;
          }
        }
      } else {
        // === Новий рядок (без _scladId) — INSERT через handleScladCrud ===
        // тимчасові приховані інпути для akt та kilkist_off
        const aktInput = document.createElement("input");
        aktInput.id = "sclad_akt";
        aktInput.type = "hidden";
        aktInput.value = row.actNo || "";
        document.body.appendChild(aktInput);

        const offInput = document.createElement("input");
        offInput.id = "sclad_kilkist_off";
        offInput.type = "hidden";
        offInput.value = "0";
        document.body.appendChild(offInput);

        // тимчасові приховані інпути для statys, xto_zamovuv, prumitka
        const statysInput = document.createElement("input");
        statysInput.id = "sclad_statys";
        statysInput.type = "hidden";
        // Якщо статус "Прибула" — очищаємо поле statys
        statysInput.value =
          row.orderStatus === "Прибула" ? "" : row.orderStatus || "Замовити";
        document.body.appendChild(statysInput);

        const xtoZamovuvInput = document.createElement("input");
        xtoZamovuvInput.id = "sclad_xto_zamovuv";
        xtoZamovuvInput.type = "hidden";
        xtoZamovuvInput.value = slyusarIdForRow ? String(slyusarIdForRow) : "";
        document.body.appendChild(xtoZamovuvInput);

        const prumitkaInput = document.createElement("input");
        prumitkaInput.id = "sclad_prumitka";
        prumitkaInput.type = "hidden";
        prumitkaInput.value = row.notes || "";
        document.body.appendChild(prumitkaInput);

        // заповнюємо інпути під handleScladCrud
        const fields: Record<string, string> = {
          sclad_date: dbDate,
          sclad_detail_catno: row.catno,
          sclad_detail: row.detail,
          sclad_qty_in: String(row.qty),
          sclad_price: String(row.price),
          sclad_invoice_no: row.invoice,
          sclad_unit: row.unit,
          sclad_shop: row.shop,
          sclad_procent: String(row.warehouse || ""), // Номер складу
        };
        Object.entries(fields).forEach(([id, val]) => {
          const el = document.getElementById(id) as HTMLInputElement | null;
          if (el) el.value = val;
        });

        // не створюємо тут shops/details — вони вже оброблені вище
        resetShopState();
        resetDetailState();
        shopEditState.currentName = row.shop;
        shopEditState.touched = false;
        detailEditState.currentName = row.detail;
        detailEditState.touched = false;

        // запис у sclad
        const originalCRUD = CRUD;
        updateCRUD("Додати");
        scladSuccess = await handleScladCrud();
        updateCRUD(originalCRUD);

        // прибираємо тимчасові інпути
        aktInput.remove();
        offInput.remove();
        statysInput.remove();
        xtoZamovuvInput.remove();
        prumitkaInput.remove();
      }

      if (!scladSuccess) {
        const errDomIdx = (row.rowNumber || i + 1) - 1;
        errorCount++;
        updateRowStatus(errDomIdx, false, "Помилка збереження в sclad");
        if (parsedDataGlobal[errDomIdx])
          parsedDataGlobal[errDomIdx].status = "❌ Помилка";
        continue;
      }

      // отримати sclad_id запису
      let scladIdWeb: string | null = null;
      if (row._scladId) {
        // Для існуючих записів (або тих, що знайшли дублікат) — вже маємо sclad_id
        scladIdWeb = String(row._scladId);
        const key = `${dbDate}|${row.catno}|${row.detail}`;
        scladIdsMap.set(key, scladIdWeb);
      } else {
        // Для нових записів — отримуємо sclad_id щойно створеного запису
        try {
          scladIdWeb = await getScladId(row.date, row.catno, row.detail);
          if (scladIdWeb) {
            const key = `${dbDate}|${row.catno}|${row.detail}`;
            scladIdsMap.set(key, scladIdWeb);
          }
        } catch (err) {
          // console.error("Помилка отримання sclad_id:", err);
        }
      }

      // Збираємо деталі для батч-оновлення актів
      // Якщо рядок без змін (rowSkipped) — акт вже має ці дані, не чіпаємо
      const domRowIndex = (row.rowNumber || i + 1) - 1;
      if (!rowSkipped && row.actNo && row.actNo.trim()) {
        const actNo = row.actNo.trim();
        const detailSum = (row.clientPrice || 0) * (row.qty || 0);
        const detailForAct = {
          sclad_id: scladIdWeb ? Number(scladIdWeb) : null,
          Сума: detailSum,
          Ціна: row.clientPrice || 0,
          Деталь: row.detail,
          Каталог: row.catno,
          Магазин: row.shop,
          Кількість: row.qty || 0,
        };
        if (!actUpdatesMap.has(actNo)) {
          actUpdatesMap.set(actNo, []);
        }
        actUpdatesMap
          .get(actNo)!
          .push({ rowIndex: domRowIndex, scladIdWeb, detailForAct });
      }

      // Статус рядка
      if (scladSuccess) {
        successCount++;
        if (rowSkipped) {
          updateRowStatus(domRowIndex, true, "⏭️ Без змін");
          if (parsedDataGlobal[domRowIndex])
            parsedDataGlobal[domRowIndex].status = "⏭️ Без змін";
        } else {
          updateRowStatus(domRowIndex, true, "✅ Успішно");
          if (parsedDataGlobal[domRowIndex])
            parsedDataGlobal[domRowIndex].status = "✅ Успішно";
        }
      } else {
        errorCount++;
        updateRowStatus(domRowIndex, false, "❌ Помилка");
        if (parsedDataGlobal[domRowIndex])
          parsedDataGlobal[domRowIndex].status = "❌ Помилка";
      }

      // Пауза кожні 10 рядків
      if (i % 10 === 9) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    // 6) Батч-оновлення актів — кожен акт завантажуємо/зберігаємо лише раз
    for (const [actNo, details] of actUpdatesMap) {
      const actSuccess = await batchUpdateActWithDetails(
        actNo,
        details.map((d) => d.detailForAct),
      );
      if (!actSuccess) {
        for (const { rowIndex } of details) {
          updateRowStatus(rowIndex, true, "⚠️ Збережено (акт не оновлено)");
          if (parsedDataGlobal[rowIndex])
            parsedDataGlobal[rowIndex].status =
              "⚠️ Збережено (акт не оновлено)";
        }
      }
    }
  } finally {
    // знімаємо лоадінг
    uploadBtn?.classList.remove("loading-Excel");
    isUploading = false;
  }

  if (errorCount === 0) {
    // Все успішно - залишаємо кнопку заблокованою
    if (uploadBtn) {
      uploadBtn.setAttribute("disabled", "true");
      uploadBtn.style.backgroundColor = "#9ca3af";
      uploadBtn.style.cursor = "not-allowed";
      uploadBtn.textContent = "✅ Записано";
    }
    const totalMsg =
      skippedCount > 0
        ? `Успішно: ${successCount} (${skippedCount} без змін — пропущено)`
        : `Успішно завантажено ${successCount} ${
            successCount === 1
              ? "запис"
              : successCount < 5
                ? "записи"
                : "записів"
          }`;
    showNotification(totalMsg, "success", 4000);
  } else {
    // Є помилки - розблоковуємо кнопку для повторної спроби
    uploadBtn?.removeAttribute("disabled");
    showNotification(
      `Завантажено: ${successCount}, Помилок: ${errorCount}`,
      "warning",
      5000,
    );
  }
}

// Функція для оновлення статусу рядка
function updateRowStatus(
  rowIndex: number,
  success: boolean,
  statusText: string,
) {
  const row = document.querySelector(
    `#batch-table-Excel tbody tr:nth-child(${rowIndex + 1})`,
  );

  if (!row) return;

  const statusCell = row.querySelector(".status-cell-Excel");

  if (statusCell) {
    const statusTextEl = statusCell.querySelector(".status-text-Excel");
    if (statusTextEl) statusTextEl.textContent = statusText;
    (statusCell as HTMLElement).className = success
      ? "status-cell-Excel success-Excel"
      : "status-cell-Excel error-Excel";
    if (success) {
      const deleteBtn = statusCell.querySelector(".delete-row-btn-Excel");
      deleteBtn?.remove();

      // Додаємо зелену галочку ✅ замість кнопки
      const checkmark = document.createElement("span");
      checkmark.textContent = "✅";
      checkmark.style.fontSize = "18px";
      checkmark.style.display = "flex";
      checkmark.style.justifyContent = "center";
      checkmark.style.alignItems = "center";
      checkmark.title = statusText;
      statusCell.appendChild(checkmark);

      // 🔒 Блокуємо АБСОЛЮТНО ВСІ інпути (включно з dropdown)
      const inputs =
        row.querySelectorAll<HTMLInputElement>(".cell-input-Excel");
      inputs.forEach((input) => {
        input.readOnly = true;
        input.disabled = true; // Для надійності
        input.style.backgroundColor = "#f5f5f5";
        input.style.cursor = "not-allowed";
        input.style.color = "#666";
        input.style.pointerEvents = "none"; // Забороняємо кліки (щоб dropdown не відкривався)
      });
    }
  }
}
// ===== Ініціалізація =====
export function initBatchImport() {
  // 🔒 не ініціалізувати вдруге (щоб слухачі не множилися)
  if (batchInitDone) return;
  batchInitDone = true;

  // Ensure модалки створені один раз
  const existingModal = document.getElementById(batchModalId);
  if (!existingModal) {
    document.body.appendChild(createBatchImportModal());
  }
  const existingConfirmModal = document.getElementById(confirmModalId);
  if (!existingConfirmModal) {
    document.body.appendChild(createConfirmModal());
  }

  // Слухач скролу для "прилипання" дропдауну до інпута
  const tableContainer = document.getElementById("batch-table-container-Excel");
  if (tableContainer) {
    tableContainer.addEventListener("scroll", () => {
      if (currentDropdownInput && currentDropdownList) {
        positionDropdown(currentDropdownInput, currentDropdownList);
      }
    });
  }

  // Глобальний клік для закриття дропдаунів — призначаємо 1 раз
  document.onclick = (e) => {
    const target = e.target as HTMLElement;
    if (
      !target.closest(".excel-dropdown-list") &&
      !target.closest(".cell-input-combo-Excel")
    ) {
      closeDropdownList();
    }
  };

  // === КНОПКИ: призначаємо через onclick, щоб НЕ накопичувалось ===
  const importBtn = document.getElementById(
    "import-excel-btn",
  ) as HTMLButtonElement | null;
  if (importBtn) {
    importBtn.onclick = async () => {
      const modal = document.getElementById(batchModalId);
      if (!modal) return;

      // 1. Одразу відкриваємо модалку
      modal.classList.remove("hidden-all_other_bases");

      // 2. Показуємо skeleton loader, ховаємо контент
      const skeleton = document.getElementById("batch-skeleton-loader");
      const tableContainer = document.getElementById(
        "batch-table-container-Excel",
      );
      const textarea = document.getElementById(
        "batch-textarea-Excel",
      ) as HTMLTextAreaElement;
      const instructions = document.querySelector(
        ".batch-instructions-Excel",
      ) as HTMLElement;
      const parseBtn = document.getElementById(
        "batch-parse-btn-Excel",
      ) as HTMLButtonElement;
      const uploadBtn = document.getElementById(
        "batch-upload-btn-Excel",
      ) as HTMLButtonElement;

      if (skeleton) skeleton.style.display = "block";
      if (tableContainer)
        tableContainer.classList.add("hidden-all_other_bases");
      if (textarea) textarea.style.display = "none";
      if (instructions) instructions.style.display = "none";
      if (parseBtn) parseBtn.style.display = "none";
      if (uploadBtn) uploadBtn.classList.add("hidden-all_other_bases");

      // 3. Завантажуємо дані у фоні (модалка вже видима зі skeleton)
      try {
        const [shops, details, acts, warehouses, users, partNumbers] =
          await Promise.all([
            loadShopsList(),
            loadDetailsList(),
            loadActsList(),
            loadWarehouseList(),
            loadUsersList(),
            loadPartNumbers(),
          ]);
        shopsListCache = shops;
        detailsListCache = details;
        shopsListCacheNormalized = shopsListCache.map(normalizeNameForCompare);
        detailsListCacheNormalized = detailsListCache.map(
          normalizeNameForCompare,
        );
        actsListCache = acts.list;
        actsDateOffMap = acts.map;
        warehouseListCache = warehouses;
        usersListCache = users;
        partNumbersCache = partNumbers as string[];
      } catch (err) {
        // console.error("Помилка оновлення кешу імпорту:", err);
      }

      // 4. Завантажуємо записи з sclad
      await resetModalState();

      // 5. Ховаємо skeleton, показуємо таблицю
      if (skeleton) skeleton.style.display = "none";
    };
  }

  // === Кнопки фільтрації статусу ===
  const filterButtons = document.querySelectorAll(".batch-filter-btn-Excel");
  filterButtons.forEach((btn) => {
    (btn as HTMLButtonElement).onclick = async () => {
      activeFilter =
        (btn as HTMLElement).dataset.filter || "Замовити+Замовлено";
      await applyFilterAndReload();
    };
  });

  // Календарні фільтри (від — до)
  const dateFromInput = document.getElementById(
    "filter-date-from-Excel",
  ) as HTMLInputElement | null;
  const dateToInput = document.getElementById(
    "filter-date-to-Excel",
  ) as HTMLInputElement | null;
  if (dateFromInput) {
    dateFromInput.onchange = () => applyFilterAndReload();
  }
  if (dateToInput) {
    dateToInput.onchange = () => applyFilterAndReload();
  }

  // Позначаємо активну кнопку при ініціалізації
  updateFilterButtonsActive();

  // Ініціалізуємо кастомний DatePicker для фільтрових дат
  const filterBar = document.querySelector(
    ".batch-filter-bar-Excel",
  ) as HTMLElement | null;
  if (filterBar) {
    initCustomDatePicker(filterBar);
  }

  const closeBtn = document.querySelector(
    `#${batchModalId} .modal-close-all_other_bases`,
  ) as HTMLButtonElement | null;
  if (closeBtn) {
    closeBtn.onclick = () => {
      document
        .getElementById(batchModalId)
        ?.classList.add("hidden-all_other_bases");
      closeDropdownList();
      // Скидаємо стан модального вікна для наступного відкриття
      resetModalState();
    };
  }

  const parseBtn = document.getElementById(
    "batch-parse-btn-Excel",
  ) as HTMLButtonElement | null;
  if (parseBtn) {
    parseBtn.onclick = () => {
      const textarea = document.getElementById(
        "batch-textarea-Excel",
      ) as HTMLTextAreaElement;
      const instructions = document.querySelector(
        ".batch-instructions-Excel",
      ) as HTMLElement;

      const data = parseBatchData(textarea.value);
      if (data.length) {
        parsedDataGlobal = data;
        renderBatchTable(data);
        textarea.style.display = "none";
        if (instructions) instructions.style.display = "none";
        document
          .getElementById("batch-table-container-Excel")
          ?.classList.remove("hidden-all_other_bases");
        document
          .getElementById("batch-upload-btn-Excel")
          ?.classList.remove("hidden-all_other_bases");
        showNotification(
          `Розпарсовано ${data.length} ${
            data.length === 1 ? "рядок" : data.length < 5 ? "рядки" : "рядків"
          }`,
          "success",
        );
      } else {
        showNotification(
          "Немає валідних даних для парсингу! Перевірте формат.",
          "error",
          4000,
        );
      }
    };
  }

  // Обробник кнопки "Додати рядок"
  const addRowBtn = document.getElementById(
    "batch-add-row-btn-Excel",
  ) as HTMLButtonElement | null;
  if (addRowBtn) {
    addRowBtn.onclick = () => {
      // Додаємо новий порожній рядок
      const newRow = createEmptyRow();
      parsedDataGlobal.push(newRow);
      renderBatchTable(parsedDataGlobal);

      // Прокручуємо до нового рядка
      const tableContainer = document.getElementById(
        "batch-table-container-Excel",
      );
      if (tableContainer) {
        setTimeout(() => {
          tableContainer.scrollTop = tableContainer.scrollHeight;
        }, 50);
      }
    };
  }

  // === Голосове введення ===
  initVoiceInputExcel({
    addRow: (): number => {
      const newRow = createEmptyRow();
      parsedDataGlobal.push(newRow);
      renderBatchTable(parsedDataGlobal);
      const tc = document.getElementById("batch-table-container-Excel");
      if (tc)
        setTimeout(() => {
          tc.scrollTop = tc.scrollHeight;
        }, 50);
      return parsedDataGlobal.length - 1; // повертаємо індекс нового рядка
    },
    sortColumn: (col: string) => {
      sortTableByColumn(col);
    },
    getParsedData: () => parsedDataGlobal,
    renderTable: (data: any[]) => {
      renderBatchTable(data);
    },
  });

  const uploadBtn = document.getElementById(
    "batch-upload-btn-Excel",
  ) as HTMLButtonElement | null;
  if (uploadBtn) {
    uploadBtn.onclick = async () => {
      const currentData = parsedDataGlobal.map((row, index) => {
        const tr = document.querySelector(
          `#batch-table-Excel tbody tr:nth-child(${index + 1})`,
        );
        if (!tr) return row as any;

        const allInputs = tr.querySelectorAll(
          ".cell-input-Excel, .cell-input-combo-Excel",
        );
        const statusText =
          tr.querySelector(".status-text-Excel")?.textContent || row.status;

        return {
          date: (allInputs[0] as HTMLInputElement).value,
          shop: (allInputs[1] as HTMLInputElement).value,
          catno: (allInputs[2] as HTMLInputElement).value,
          detail: (allInputs[3] as HTMLInputElement).value,
          qty: parseFloat((allInputs[4] as HTMLInputElement).value) || 0,
          price: parseFloat((allInputs[5] as HTMLInputElement).value) || 0,
          clientPrice:
            parseFloat((allInputs[6] as HTMLInputElement).value) || 0,
          warehouse: (allInputs[7] as HTMLInputElement).value, // Номер складу
          invoice: (allInputs[8] as HTMLInputElement).value,
          actNo: (allInputs[9] as HTMLInputElement).value,
          unit: (allInputs[10] as HTMLInputElement).value,
          orderStatus: (allInputs[11] as HTMLInputElement).value, // Статус деталі
          createdBy: (allInputs[12] as HTMLInputElement).value, // Замовив
          notes: (allInputs[13] as HTMLInputElement).value, // Примітка
          action:
            (allInputs[14] as HTMLInputElement)?.value ||
            row.action ||
            "Записати", // Дія з DOM або parsedDataGlobal
          _scladId: row._scladId || null, // sclad_id для UPDATE/DELETE
          status: statusText,
          rowNumber: index + 1,
          warehouseValid: row.warehouseValid,
        };
      });

      const allSuccessful = currentData.every(
        (row) =>
          row.status === "✅ Успішно" ||
          row.status === "⚠️ Збережено (акт не оновлено)",
      );
      if (allSuccessful && currentData.length > 0) {
        showNotification("Дані успішно додані до бази даних", "success", 3000);
        return;
      }

      // базові валідації
      let hasErrors = false;
      const invalidUnits = currentData.filter(
        (row) =>
          !VALID_UNITS.includes(row.unit) && !row.status.includes("Помилка"),
      );
      if (invalidUnits.length > 0) {
        showNotification("❌ Невірно вказана одиниця виміру", "error", 4000);
        hasErrors = true;
        invalidUnits.forEach((row) => {
          const unitTd = document.querySelector(
            `#batch-table-Excel tbody tr:nth-child(${row.rowNumber}) td:has(.unit-input-Excel)`,
          ) as HTMLElement;
          if (unitTd) unitTd.classList.add("invalid-unit");
        });
      }

      // Перевірка складів
      const invalidWarehouses = currentData.filter(
        (row) =>
          (!row.warehouse ||
            !row.warehouse.trim() ||
            !warehouseListCache.includes(row.warehouse.trim())) &&
          !row.status.includes("Помилка") &&
          row.action !== "Видалити",
      );
      if (invalidWarehouses.length > 0) {
        showNotification(
          "❌ Невірно вказаний або порожній склад",
          "error",
          4000,
        );
        hasErrors = true;
        invalidWarehouses.forEach((row) => {
          const warehouseTd = document.querySelector(
            `#batch-table-Excel tbody tr:nth-child(${row.rowNumber}) td:has(.warehouse-input-Excel)`,
          ) as HTMLElement;
          if (warehouseTd) warehouseTd.classList.add("invalid-warehouse");
        });
      }

      // Перевірка Рах. № (invoice) — обов'язкове поле
      const invalidInvoices = currentData.filter(
        (row) =>
          (!row.invoice || !row.invoice.trim()) &&
          !row.status.includes("Помилка") &&
          row.action !== "Видалити",
      );
      if (invalidInvoices.length > 0) {
        showNotification("❌ Рах. № не може бути порожнім", "error", 4000);
        hasErrors = true;
        invalidInvoices.forEach((row) => {
          const invoiceTd = document.querySelector(
            `#batch-table-Excel tbody tr:nth-child(${row.rowNumber}) td:has(.invoice-input-Excel)`,
          ) as HTMLElement;
          if (invoiceTd) invoiceTd.classList.add("invalid-invoice");
        });
      }

      if (hasErrors) return;

      const validData = currentData.filter((row) => {
        // Рядки з дією "Видалити" і наявним _scladId — завжди валідні для видалення
        if (row.action === "Видалити" && row._scladId) {
          return true;
        }
        // Для записів "Записати" — стандартна валідація
        return (
          !row.status.includes("Помилка") &&
          row.shop &&
          row.unit &&
          row.detail &&
          row.warehouse &&
          row.warehouseValid &&
          row.invoice &&
          row.invoice.trim()
        );
      });
      if (validData.length === 0) {
        showNotification(
          "Немає валідних даних для завантаження! Перевірте, чи заповнено магазин, деталь, одиницю виміру та склад.",
          "error",
        );
        return;
      }

      // Перевірка актів (список відкритих у кеші)
      let hasInvalidActs = false;
      let hasClosedActs = false;
      for (const row of validData) {
        if (row.actNo && row.actNo.trim()) {
          const trimmed = row.actNo.trim();
          if (!actsListCache.includes(trimmed)) {
            hasInvalidActs = true;
          } else {
            const id = parseInt(trimmed, 10);
            if (actsDateOffMap.has(id) && actsDateOffMap.get(id) !== null) {
              hasClosedActs = true;
            }
          }
        }
      }
      if (hasInvalidActs) {
        showNotification("Номер акту не створений", "error");
        return;
      }
      if (hasClosedActs) {
        showNotification(
          "Номер акту закритий і ми неможемо вписати деталь в даний акт",
          "error",
        );
        return;
      }

      const confirmed = await showConfirmModal(
        validData.length,
        currentData.length,
      );
      if (confirmed) {
        await uploadBatchData(validData); // ⬅️ тепер захищено isUploading
      }
    };
  }
}
