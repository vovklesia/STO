// ===== ФАЙЛ: src/ts/roboha/zakaz_naraudy/inhi/zberechennya_zmin_y_danux_aktu_NEW.ts =====

import { supabase } from "../../../vxid/supabaseClient";
import { showNotification } from "./vspluvauhe_povidomlenna";
import {
  globalCache,
  ZAKAZ_NARAYD_SAVE_BTN_ID,
  EDITABLE_PROBIG_ID,
  EDITABLE_REASON_ID,
  EDITABLE_RECOMMENDATIONS_ID,
  EDITABLE_NOTES_ID,
  ACT_ITEMS_TABLE_CONTAINER_ID,
  loadGlobalData,
  invalidateGlobalDataCache,
} from "../globalCache";
import type { ActItem } from "../globalCache";
import {
  updateCalculatedSumsInFooter,
  getSlyusarSalaryFromHistory,
} from "../modalUI";
import { refreshActsTable } from "../../tablucya/tablucya";
import { refreshQtyWarningsIn } from "./kastomna_tabluca";
import { syncShopsOnActSave } from "./save_shops";
import { syncSlyusarsOnActSave } from "./save_work";
import {
  userAccessLevel,
  userName,
  getSavedUserDataFromLocalStorage,
} from "../../tablucya/users";

/* =============================== ТИПИ І ІНТЕРФЕЙСИ =============================== */

interface DetailRow {
  shopName: string;
  sclad_id: number | null;
  Найменування: string;
  Каталог: string | null;
  Кількість: number;
  Ціна: number;
  recordId?: string; // ✅ Унікальний ID для точного пошуку
}

interface WorkRow {
  slyusarName: string;
  Найменування: string;
  Кількість: number;
  Ціна: number;
  Зарплата: number;
  recordId?: string; // ✅ Унікальний ID для точного пошуку
}

export interface ParsedItem {
  type: "detail" | "work";
  name: string;
  quantity: number;
  price: number;
  sum: number;
  pibMagazin: string;
  catalog: string;
  sclad_id: number | null;
  slyusar_id: number | null;
  slyusarSum?: number;
  recordId?: string; // ✅ Унікальний ID запису роботи для історії слюсаря
}

interface ActChangeRecord {
  act_id: number;
  item_name: string;
  cina: number;
  kilkist: number;
  zarplata: number;
  dodav_vudaluv: boolean;
  changed_by_surname: string;
  delit: boolean; // ✅ Додано для позначення видалених повідомлень
  data: string;
  pib?: string; // ✅ ПІБ клієнта з поточного акту
  auto?: string; // ✅ Дані автомобіля з поточного акту
  pruimalnyk?: string; // ✅ ПІБ приймальника з таблиці acts
}

// КЕШ: Зберігаємо ПОВНІ ДАНІ РЯДКІВ (для всіх ролей з прихованими колонками)
// Ключ: "type:name" (наприклад, "detail:Масляний фільтр")
const fullRowDataCache = new Map<string, ParsedItem>();

// КЕШ: Закупівельні ціни зі складу для обчислення маржі
const purchasePricesCache = new Map<number, number>();

// 🔒 Захист від подвійного збереження
let isSaving = false;

/* =============================== УТИЛІТИ =============================== */

/**
 * ✅ ВИПРАВЛЕНО: Отримує ПІБ клієнта та Авто з БАЗИ ДАНИХ за actId
 * Це гарантує коректні дані навіть якщо DOM застарів
 */
async function fetchActClientAndCarDataFromDB(actId: number): Promise<{
  pib: string;
  auto: string;
}> {
  try {
    const { data: act, error: actError } = await supabase
      .from("acts")
      .select("client_id, cars_id")
      .eq("act_id", actId)
      .single();

    if (actError || !act) {
      // console.warn("⚠️ Не вдалося отримати дані акту з БД:", actError?.message);
      // Fallback до DOM якщо БД недоступна
      return getClientAndCarInfo();
    }

    let pib = "";
    if (act.client_id) {
      const { data: client } = await supabase
        .from("clients")
        .select("data")
        .eq("client_id", act.client_id)
        .single();

      if (client?.data) {
        const clientData =
          typeof client.data === "string"
            ? JSON.parse(client.data)
            : client.data;
        pib = clientData?.["ПІБ"] || clientData?.fio || "";
      }
    }

    let auto = "";
    if (act.cars_id) {
      const { data: car } = await supabase
        .from("cars")
        .select("data")
        .eq("cars_id", act.cars_id)
        .single();

      if (car?.data) {
        const carData =
          typeof car.data === "string" ? JSON.parse(car.data) : car.data;
        const autoName = carData?.["Авто"] || "";
        const year = carData?.["Рік"] || "";
        const nomer = carData?.["Номер авто"] || "";
        auto = `${autoName} ${year} ${nomer}`.trim();
      }
    }

    return { pib, auto };
  } catch (error) {
    // console.warn("⚠️ Помилка при отриманні даних клієнта з БД:", error);
    // Fallback до DOM
    return getClientAndCarInfo();
  }
}

/**
 * Завантажує закупівельні ціни зі складу для обчислення маржі
 */
async function loadPurchasePrices(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("sclad")
      .select("sclad_id, price");

    if (error) {
      // console.error("⚠️ Помилка завантаження цін зі складу:", error);
      return;
    }

    purchasePricesCache.clear();
    data?.forEach((item) => {
      const scladId = Number(item.sclad_id);
      const price = Number(item.price) || 0;
      if (!isNaN(scladId)) {
        purchasePricesCache.set(scladId, price);
      }
    });
  } catch (err) {
    // console.error("⚠️ Помилка при завантаженні цін:", err);
  }
}

/**
 * Отримує закупівельну ціну за sclad_id
 */
function getPurchasePrice(scladId: number | null): number | undefined {
  if (!scladId) return undefined;
  return purchasePricesCache.get(scladId);
}

const cleanText = (s?: string | null): string =>
  (s ?? "").replace(/\u00A0/g, " ").trim();

const parseNum = (s?: string | null): number => {
  const v = cleanText(s).replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
};

const getCellText = (el?: HTMLElement | null): string =>
  cleanText(el?.textContent);

/**
 * Отримує назву з комірки, перевіряючи спочатку атрибут data-full-name.
 * Якщо назва скорочена (є атрибут), повертає повну назву.
 */
const getNameCellText = (el?: HTMLElement | null): string => {
  if (!el) return "";
  // Перевіряємо чи є повна назва в атрибуті
  const fullName = el.getAttribute("data-full-name");
  if (fullName) return cleanText(fullName);
  // Інакше повертаємо текст з комірки
  return cleanText(el?.textContent);
};

const validateActId = (actId: number): void => {
  if (!Number.isInteger(actId) || actId <= 0) {
    throw new Error("Невірний формат номера акту");
  }
};

/**
 * Зберігає ПОВНІ дані рядків у тимчасовий кеш.
 * Це потрібно для ВСІХ ролей з прихованими колонками (Слюсар, Приймальник, Складовщик, Запчастист).
 *
 * ✅ 10/10 FIX: Використовуємо recordId як ключ кешу для коректної обробки дублікатів.
 * Fallback на ${type}:${name} якщо recordId відсутній (для сумісності зі старими даними).
 */
export function cacheHiddenColumnsData(actDetails: any): void {
  fullRowDataCache.clear();

  const details = Array.isArray(actDetails?.["Деталі"])
    ? actDetails["Деталі"]
    : [];
  const works = Array.isArray(actDetails?.["Роботи"])
    ? actDetails["Роботи"]
    : [];

  // Кешуємо деталі
  details.forEach((d: any) => {
    const name = d["Деталь"]?.trim();
    if (!name) return;

    const recordId = d["recordId"];
    // ✅ Пріоритет: recordId, fallback на type:name
    const cacheKey = recordId || `detail:${name}`;
    fullRowDataCache.set(cacheKey, {
      type: "detail",
      name,
      price: Number(d["Ціна"]) || 0,
      sum: Number(d["Сума"]) || 0,
      catalog: d["Каталог"] || "",
      quantity: Number(d["Кількість"]) || 0,
      slyusarSum: 0,
      pibMagazin: d["Магазин"] || "",
      sclad_id: d["sclad_id"] || null,
      slyusar_id: null,
      recordId: recordId || undefined,
    });
  });

  // Кешуємо роботи
  works.forEach((w: any) => {
    const name = w["Робота"]?.trim();
    if (!name) return;

    const recordId = w["recordId"];
    // ✅ Пріоритет: recordId, fallback на type:name
    const cacheKey = recordId || `work:${name}`;
    fullRowDataCache.set(cacheKey, {
      type: "work",
      name,
      price: Number(w["Ціна"]) || 0,
      sum: Number(w["Сума"]) || 0,
      catalog: w["Каталог"] || "",
      quantity: Number(w["Кількість"]) || 0,
      slyusarSum: Number(w["Зарплата"]) || 0,
      pibMagazin: w["Слюсар"] || "",
      sclad_id: null,
      slyusar_id: w["slyusar_id"] || null,
      recordId: recordId || undefined,
    });
  });
}

/* =============================== РОБОТА З ТАБЛИЦЕЮ =============================== */

function readTableNewNumbers(): Map<number, number> {
  const tableRows = document.querySelectorAll(
    `#${ACT_ITEMS_TABLE_CONTAINER_ID} tbody tr`,
  );
  const numberMap = new Map<number, number>();

  tableRows.forEach((row) => {
    const nameCell = row.querySelector(
      '[data-name="name"]',
    ) as HTMLElement | null;
    if (!nameCell?.textContent?.trim()) return;

    const catalogCell = row.querySelector(
      '[data-name="catalog"]',
    ) as HTMLElement | null;
    const qtyCell = row.querySelector(
      '[data-name="id_count"]',
    ) as HTMLElement | null;
    const scladIdAttr = catalogCell?.getAttribute("data-sclad-id");

    if (!scladIdAttr) return;

    const sclad_id = Number(scladIdAttr);
    const qty = parseNum(qtyCell?.textContent);

    if (!isNaN(sclad_id)) {
      numberMap.set(sclad_id, (numberMap.get(sclad_id) || 0) + qty);
    }
  });

  return numberMap;
}

export function parseTableRows(): ParsedItem[] {
  const tableRows = document.querySelectorAll(
    `#${ACT_ITEMS_TABLE_CONTAINER_ID} tbody tr`,
  );
  const items: ParsedItem[] = [];

  tableRows.forEach((row: Element) => {
    const nameCell = row.querySelector('[data-name="name"]') as HTMLElement;
    // Використовуємо getNameCellText для отримання повної назви
    const name = getNameCellText(nameCell);
    if (!name) return;

    // ✅ НАДІЙНЕ ВИЗНАЧЕННЯ ТИПУ (3 рівні пріоритету):
    // 1. data-item-type на <tr> — встановлюється при рендері/виборі (100% надійно)
    // 2. data-type на комірці name — встановлюється при виборі з автодоповнення
    // 3. globalCache.works — fallback для старих даних
    const rowItemType = (row as HTMLElement).getAttribute("data-item-type");
    const typeFromCell = nameCell.getAttribute("data-type");
    let type: "work" | "detail";
    if (rowItemType === "work") {
      type = "work";
    } else if (rowItemType === "detail") {
      type = "detail";
    } else if (typeFromCell === "works") {
      type = "work";
    } else if (typeFromCell === "details") {
      type = "detail";
    } else {
      // Fallback для старих рядків без атрибутів
      type = globalCache.works.includes(name) ? "work" : "detail";
    }

    // ✅ 10/10 FIX: Зчитуємо recordId СПОЧАТКУ (для коректного отримання з кешу)
    const recordId =
      (row as HTMLElement).getAttribute("data-record-id") || undefined;

    // ✅ 10/10 FIX: Створюємо ключ для кешу з пріоритетом recordId
    // Це вирішує проблему дублікатів (дві однакові роботи з різними параметрами)
    const cacheKey = recordId || `${type}:${name}`;
    let cachedData = fullRowDataCache.get(cacheKey);

    // ✅ Fallback: якщо не знайдено по recordId, шукаємо по type:name
    if (!cachedData && recordId) {
      cachedData = fullRowDataCache.get(`${type}:${name}`);
    }

    // Отримуємо посилання на всі комірки
    const quantityCell = row.querySelector(
      '[data-name="id_count"]',
    ) as HTMLElement;
    const priceCell = row.querySelector('[data-name="price"]') as HTMLElement;
    const sumCell = row.querySelector('[data-name="sum"]') as HTMLElement;
    const pibMagazinCell = row.querySelector(
      '[data-name="pib_magazin"]',
    ) as HTMLElement;
    const catalogCell = row.querySelector(
      '[data-name="catalog"]',
    ) as HTMLElement;
    const slyusarSumCell = row.querySelector(
      '[data-name="slyusar_sum"]',
    ) as HTMLElement;

    // 1. Кількість завжди беремо з DOM (користувач міг її змінити)
    const quantity = parseNum(quantityCell?.textContent);

    // 2. Перевіряємо видимість колонок та беремо дані
    let price = 0;
    let sum = 0;
    let pibMagazin = "";
    let catalog = "";
    let slyusarSum = 0;

    // ✅ ВИПРАВЛЕНО: Ціна завжди береться з DOM (незалежно від видимості колонки)
    // Причина: При додаванні нової роботи вона ще не в кеші, а ціна вже є в DOM
    if (priceCell) {
      price = parseNum(priceCell.textContent);
    } else if (cachedData) {
      price = cachedData.price;
    }

    // ✅ ВИПРАВЛЕНО: Сума завжди береться з DOM (незалежно від видимості колонки)
    // Причина: При додаванні нової роботи вона ще не в кеші, а сума вже є в DOM
    if (sumCell) {
      sum = parseNum(sumCell.textContent);
    } else if (cachedData) {
      sum = cachedData.sum;
    }

    // ✅ ВИПРАВЛЕНО: ПІБ_Магазин завжди береться з DOM (незалежно від видимості)
    // Причина: При зміні слюсаря/магазину дані мають оновлюватися
    if (pibMagazinCell) {
      pibMagazin = getCellText(pibMagazinCell);
    } else if (cachedData) {
      pibMagazin = cachedData.pibMagazin;
    }

    // ✅ ВИПРАВЛЕНО: Каталог завжди береться з DOM (незалежно від видимості)
    // Причина: При зміні каталогу дані мають оновлюватися
    if (catalogCell) {
      catalog = getCellText(catalogCell);
    } else if (cachedData) {
      catalog = cachedData.catalog;
    }

    // ✅ ВИПРАВЛЕНО v4.0: Логіка зарплати:
    // 1. Якщо стовпець "Зар-та" ВИДИМИЙ (slyusarSumCell існує) - ЗАВЖДИ беремо з DOM
    //    (користувач міг змінити значення, і воно має зберегтися)
    // 2. Якщо стовпець ПРИХОВАНИЙ - беремо з історії слюсаря (щоб не втратити)
    if (type === "work" && pibMagazin && globalCache.currentActId) {
      if (slyusarSumCell) {
        // ✅ Стовпець ВИДИМИЙ - беремо з DOM (користувач міг змінити)
        const rawSalaryText = slyusarSumCell.textContent;
        slyusarSum = parseNum(rawSalaryText);
      } else {
        // ⚠️ Стовпець ПРИХОВАНИЙ - беремо з історії слюсаря
        const historySalary = getSlyusarSalaryFromHistory(
          pibMagazin, // слюсар = ПІБ_Магазин
          name, // назва роботи
          globalCache.currentActId,
          undefined, // rowIndex - не передаємо бо не маємо індексу тут
          recordId, // recordId для точного пошуку
        );

        if (historySalary !== null && historySalary > 0) {
          slyusarSum = historySalary;
        } else if (cachedData) {
          slyusarSum = cachedData.slyusarSum || 0;
        }
      }
    } else {
      // Для деталей або якщо немає слюсаря - беремо з DOM як раніше
      if (slyusarSumCell) {
        const rawSalaryText = slyusarSumCell.textContent;
        slyusarSum = parseNum(rawSalaryText);
      } else if (cachedData) {
        slyusarSum = cachedData.slyusarSum || 0;
      }
    }

    const scladIdAttr = catalogCell?.getAttribute("data-sclad-id");
    const sclad_id = scladIdAttr ? Number(scladIdAttr) : null;
    const slyusar_id = nameCell.getAttribute("data-slyusar-id")
      ? Number(nameCell.getAttribute("data-slyusar-id"))
      : null;

    const item: ParsedItem = {
      type,
      name,
      quantity,
      price,
      sum,
      pibMagazin,
      catalog,
      sclad_id,
      slyusar_id,
      slyusarSum,
      recordId, // ✅ Додаємо recordId до item
    };

    items.push(item);

    // Оновлюємо кеш актуальними даними
    fullRowDataCache.set(cacheKey, item);
  });

  return items;
}

async function updateScladActNumbers(
  actId: number,
  newScladIds: Set<number>,
): Promise<void> {
  validateActId(actId);

  const initialScladIds = new Set(
    (globalCache.initialActItems || [])
      .filter((item) => item.type === "detail" && item.sclad_id != null)
      .map((item) => item.sclad_id!),
  );

  const scladIdsToSetAct = Array.from(newScladIds);
  const scladIdsToClearAct = Array.from(initialScladIds).filter(
    (id) => !newScladIds.has(id),
  );

  if (scladIdsToSetAct.length > 0) {
    await updateScladAkt(scladIdsToSetAct, actId);
  }

  if (scladIdsToClearAct.length > 0) {
    await updateScladAkt(scladIdsToClearAct, null);
  }
}

async function updateScladAkt(
  scladIds: number[],
  aktValue: number | null,
): Promise<void> {
  if (scladIds.length === 0) return;

  const { data: rows, error: selErr } = await supabase
    .from("sclad")
    .select("sclad_id")
    .in("sclad_id", scladIds);

  if (selErr) {
    // console.error("Помилка при отриманні записів sclad:", selErr);
    throw new Error(`Не вдалося отримати записи складу: ${selErr.message}`);
  }

  const foundIds = new Set(rows?.map((r) => Number(r.sclad_id)) || []);
  const missingIds = scladIds.filter((id) => !foundIds.has(id));

  if (missingIds.length > 0) {
    // console.warn(`Записи sclad_id не знайдено:`, missingIds);
  }

  const existingIds = scladIds.filter((id) => foundIds.has(id));
  if (existingIds.length > 0) {
    const { error: updateErr } = await supabase
      .from("sclad")
      .update({ akt: aktValue })
      .in("sclad_id", existingIds);

    if (updateErr) {
      // console.error("Помилка при оновленні akt:", updateErr);
      throw new Error(`Не вдалося оновити akt: ${updateErr.message}`);
    }
  }
}

async function applyScladDeltas(deltas: Map<number, number>): Promise<void> {
  if (deltas.size === 0) return;

  // ✅ ВИПРАВЛЕНО: Атомарне оновлення kilkist_off через RPC (apply_sclad_delta)
  // Це запобігає гонці запитів (race condition) при одночасних збереженнях
  for (const [scladId, delta] of deltas) {
    if (delta === 0) continue;

    const { error: rpcErr } = await supabase.rpc("apply_sclad_delta", {
      sid: scladId,
      delta_val: delta,
    });

    if (rpcErr) {
      throw new Error(
        `Помилка оновлення складу №${scladId}: ${rpcErr.message}`,
      );
    }
  }
}

function calculateDeltas(): Map<number, number> {
  const newNumbers = readTableNewNumbers();
  const oldNumbers = globalCache.oldNumbers || new Map<number, number>();
  const allIds = new Set<number>([
    ...Array.from(newNumbers.keys()),
    ...Array.from(oldNumbers.keys()),
  ]);

  const deltas = new Map<number, number>();
  for (const id of allIds) {
    // ✅ ПРАВИЛЬНА ЛОГІКА:
    // - Додали в акт (new > old) → delta > 0 → kilkist_off збільшується (списується зі складу)
    // - Видалили з акту (new < old) → delta < 0 → kilkist_off зменшується (повертається на склад)
    const delta = (newNumbers.get(id) || 0) - (oldNumbers.get(id) || 0);
    if (delta !== 0) {
      deltas.set(id, delta);
    }
  }

  return deltas;
}

function processItems(items: ParsedItem[]) {
  const details: any[] = [];
  const works: any[] = [];
  const detailRowsForShops: DetailRow[] = [];
  const workRowsForSlyusars: WorkRow[] = [];
  const newScladIds = new Set<number>();

  let totalDetailsSum = 0;
  let totalWorksSum = 0;
  let totalWorksProfit = 0;
  let totalDetailsMargin = 0;

  items.forEach((item) => {
    const {
      type,
      name,
      quantity,
      price,
      sum,
      pibMagazin,
      catalog,
      sclad_id,
      slyusar_id,
      slyusarSum,
      recordId, // ✅ Додаємо recordId
    } = item;

    const itemBase = { Кількість: quantity, Ціна: price, Сума: sum };

    if (type === "work") {
      const salary = Number(slyusarSum || 0);
      const profit = Math.max(0, Number((sum - salary).toFixed(2)));

      // ✅ КРИТИЧНО: Якщо recordId немає - генеруємо новий
      // Це потрібно для нових рядків, які ще не мають recordId
      const workRecordId =
        recordId ||
        `new_${name.substring(0, 20)}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // ✅ Шукаємо work_id в глобальному кеші за ім'ям роботи
      const workObj = globalCache.worksWithId.find((w) => w.name === name);
      const work_id = catalog || (workObj ? workObj.work_id : null);

      works.push({
        ...itemBase,
        Робота: name,
        Слюсар: pibMagazin,
        Каталог: catalog,
        slyusar_id,
        Зарплата: salary,
        Прибуток: profit,
        recordId: workRecordId, // ✅ Завжди є recordId
        work_id, // ✅ Зберігаємо work_id в акт
      });

      totalWorksSum += sum;
      totalWorksProfit += profit;

      if (pibMagazin) {
        const workRow: WorkRow = {
          slyusarName: pibMagazin,
          Найменування: name,
          Кількість: quantity,
          Ціна: price,
          Зарплата: salary,
          recordId: workRecordId, // ✅ Передаємо recordId для точного пошуку
        };

        workRowsForSlyusars.push(workRow);
      }
    } else {
      // Обчислюємо маржу для деталі
      const purchasePrice = getPurchasePrice(sclad_id) || 0; // ✅ Якщо немає вхідної ціни, беремо 0
      const margin = (price - purchasePrice) * quantity; // ✅ Рахуємо маржу навіть якщо purchasePrice = 0

      totalDetailsMargin += margin;

      // ✅ Шукаємо detail_id в глобальному кеші для деталей не зі складу
      let detail_id = null;
      if (!sclad_id) {
        const detailObj = globalCache.detailsWithId.find(
          (d) => d.name === name,
        );
        if (detailObj) detail_id = detailObj.detail_id;
      }

      details.push({
        ...itemBase,
        Деталь: name,
        Магазин: pibMagazin,
        Каталог: catalog,
        sclad_id,
        detail_id, // ✅ Зберігаємо detail_id в акт
        recordId, // ✅ Додаємо recordId для acts
      });
      totalDetailsSum += sum;

      if (pibMagazin) {
        detailRowsForShops.push({
          shopName: pibMagazin,
          sclad_id,
          Найменування: name,
          Каталог: catalog || null,
          Кількість: quantity,
          Ціна: price,
          recordId, // ✅ Передаємо recordId для історії магазину
        });
      }
      if (sclad_id) newScladIds.add(sclad_id);
    }
  });

  return {
    details,
    works,
    detailRowsForShops,
    workRowsForSlyusars,
    newScladIds,
    totalDetailsSum,
    totalWorksSum,
    grandTotalSum: totalDetailsSum + totalWorksSum,
    totalWorksProfit,
    totalDetailsMargin,
  };
}

async function cleanupEmptyRows(): Promise<void> {
  document
    .querySelectorAll(`#${ACT_ITEMS_TABLE_CONTAINER_ID} tbody tr`)
    .forEach((row) => {
      const nameCell = row.querySelector('[data-name="name"]') as HTMLElement;
      if (!nameCell?.textContent?.trim()) {
        row.remove();
      }
    });
}

function updateInitialActItems(details: any[], works: any[]): void {
  globalCache.initialActItems = [
    ...details.map((d) => ({
      type: "detail" as const,
      name: d.Деталь,
      catalog: d.Каталог || "",
      quantity: d.Кількість,
      price: d.Ціна,
      sum: d.Сума,
      person_or_store: d.Магазин || "",
      sclad_id: d.sclad_id ?? null,
      slyusar_id: null,
      recordId: d.recordId, // ✅ Додано recordId
    })),
    ...works.map((w) => ({
      type: "work" as const,
      name: w.Робота,
      catalog: w.Каталог || "",
      quantity: w.Кількість,
      price: w.Ціна,
      sum: w.Сума,
      person_or_store: w.Слюсар || "",
      sclad_id: null,
      slyusar_id: w.slyusar_id ?? null,
      slyusarSum: w.Зарплата || 0,
      recordId: w.recordId, // ✅ Додано recordId
    })),
  ];
}

/* =============================== ЛОГУВАННЯ ЗМІН (НОВИЙ КОД) =============================== */

/**
 * Конвертує ActItem[] (з globalCache) в ParsedItem[] для порівняння
 */
function convertActItemsToParsedItems(items: ActItem[]): ParsedItem[] {
  return items.map((item) => ({
    type: item.type,
    name: item.name,
    quantity: item.quantity,
    price: item.price,
    sum: item.sum,
    pibMagazin: item.person_or_store || "",
    catalog: item.catalog || "",
    sclad_id: item.sclad_id ?? null,
    slyusar_id: item.slyusar_id ?? null,
    slyusarSum: item.slyusarSum || 0, // ✅ Використовуємо slyusarSum з ActItem
  }));
}

/**
 * Порівнює початкові та поточні елементи акту і повертає додані та видалені позиції
 */
function compareActChanges(
  initialItems: ActItem[],
  currentItems: ParsedItem[],
): { added: ParsedItem[]; deleted: ParsedItem[] } {
  // Конвертуємо ActItem[] в ParsedItem[] для порівняння
  const initialParsed = convertActItemsToParsedItems(initialItems);

  // Створюємо унікальний ключ для кожної позиції (тип + назва)
  const createKey = (item: ParsedItem) => `${item.type}:${item.name}`;

  // Створюємо мапи для швидкого пошуку
  const initialMap = new Map<string, ParsedItem>();
  const currentMap = new Map<string, ParsedItem>();

  initialParsed.forEach((item) => {
    initialMap.set(createKey(item), item);
  });

  currentItems.forEach((item) => {
    currentMap.set(createKey(item), item);
  });

  // Знаходимо додані позиції (є в current, немає в initial)
  const added: ParsedItem[] = [];
  currentItems.forEach((item) => {
    const key = createKey(item);
    if (!initialMap.has(key)) {
      added.push(item);
    }
  });

  // Знаходимо видалені позиції (є в initial, немає в current)
  const deleted: ParsedItem[] = [];
  initialParsed.forEach((item) => {
    const key = createKey(item);
    if (!currentMap.has(key)) {
      deleted.push(item);
    }
  });

  return { added, deleted };
}

/**
 * Записує зміни в таблицю act_changes_notifications
 * ЛОГІКА:
 * - Записуємо ТІЛЬКИ якщо це Слюсар, Запчастист, Складовщик
 * - НЕ записуємо якщо це Приймальник або Адміністратор
 * - Зберігаємо pruimalnyk з таблиці acts для фільтрації повідомлень
 */
async function logActChanges(
  actId: number,
  added: ParsedItem[],
  deleted: ParsedItem[],
): Promise<void> {
  // ✅ Записуємо зміни ТІЛЬКИ для Слюсаря, Запчастиста, Складовщика
  const allowedRoles = ["Слюсар", "Запчастист", "Складовщик"];
  if (!userAccessLevel || !allowedRoles.includes(userAccessLevel)) {
    return;
  }

  // ✅ ОТРИМУЄМО ПРИЙМАЛЬНИКА З БД (acts.pruimalnyk)
  let pruimalnykFromDb: string | undefined;
  try {
    const { data: actData, error: actError } = await supabase
      .from("acts")
      .select("pruimalnyk")
      .eq("act_id", actId)
      .single();

    if (actError) {
      // console.error("❌ Помилка отримання pruimalnyk з acts:", actError);
    } else if (actData?.pruimalnyk) {
      pruimalnykFromDb = actData.pruimalnyk;
    }
  } catch (err) {
    // console.error("❌ Виняток при отриманні pruimalnyk:", err);
  }

  // ✅ ФУНКЦІЯ ВИЗНАЧЕННЯ АВТОРА ЗМІН
  const getChangeAuthor = (item: ParsedItem): string => {
    const currentUser = userName || "Невідомо";

    // 1. Якщо це ДЕТАЛЬ -> повертаємо того, хто зайшов (userName)
    if (item.type === "detail") {
      return currentUser;
    }

    // 2. Якщо це РОБОТА -> перевіряємо ПІБ_Магазин (це буде слюсар)
    if (item.type === "work") {
      const workerName = item.pibMagazin ? item.pibMagazin.trim() : "";
      // Якщо є ім'я слюсаря - беремо його, інакше - того, хто зайшов
      return workerName || currentUser;
    }

    // Fallback (на всяк випадок)
    return currentUser;
  };

  // ✅ ВИПРАВЛЕНО: Отримуємо ПІБ клієнта та авто з БАЗИ ДАНИХ
  const { pib, auto } = await fetchActClientAndCarDataFromDB(actId);

  // ✅ ВИКОРИСТОВУЄМО ПРИЙМАЛЬНИКА З БД (отриманого вище)
  const pruimalnyk = pruimalnykFromDb;

  const records: ActChangeRecord[] = [];

  // Додані позиції
  // Додані позиції (рядок 598-608)
  added.forEach((item) => {
    records.push({
      act_id: actId,
      item_name: item.name,
      cina: item.price,
      kilkist: item.quantity,
      zarplata: item.slyusarSum || 0,
      dodav_vudaluv: true,
      changed_by_surname: getChangeAuthor(item),
      delit: false, // ✅ За замовчуванням FALSE = показувати
      data: new Date().toISOString(),
      pib: pib || undefined, // ✅ ПІБ клієнта
      auto: auto || undefined, // ✅ Дані автомобіля
      pruimalnyk: pruimalnyk, // ✅ ПІБ приймальника з acts.pruimalnyk
    });
  });

  // Видалені позиції (рядок 611-621)
  deleted.forEach((item) => {
    records.push({
      act_id: actId,
      item_name: item.name,
      cina: item.price,
      kilkist: item.quantity,
      zarplata: item.slyusarSum || 0,
      dodav_vudaluv: false,
      changed_by_surname: getChangeAuthor(item),
      delit: false, // ✅ За замовчуванням FALSE = показувати
      data: new Date().toISOString(),
      pib: pib || undefined, // ✅ ПІБ клієнта
      auto: auto || undefined, // ✅ Дані автомобіля
      pruimalnyk: pruimalnyk, // ✅ ПІБ приймальника з acts
    });
  });

  if (records.length === 0) {
    return;
  }

  // Запис в БД
  const { error } = await supabase
    .from("act_changes_notifications")
    .insert(records);

  if (error) {
    // console.error("❌ ПОМИЛКА ЗАПИСУ ЗМІН:", error);
    throw error;
  }
}

/**
 * Отримує ПІБ клієнта та Авто з DOM
 */
function getClientAndCarInfo(): { pib: string; auto: string } {
  let pib = "";
  let auto = "";

  const leftTable = document.querySelector("table.zakaz_narayd-table.left");
  if (leftTable) {
    const rows = leftTable.querySelectorAll("tr");
    rows.forEach((row) => {
      const label = row.querySelector("td:first-child")?.textContent?.trim();
      const value = row.querySelector("td:last-child")?.textContent?.trim();
      if (label === "Клієнт" && value) pib = value;
    });
  }

  const rightTable = document.querySelector("table.zakaz_narayd-table.right");
  if (rightTable) {
    const rows = rightTable.querySelectorAll("tr");
    rows.forEach((row) => {
      const label = row.querySelector("td:first-child")?.textContent?.trim();
      const value = row.querySelector("td:last-child")?.textContent?.trim();
      if (label === "Автомобіль" && value) auto = value;
    });
  }
  return { pib, auto };
}

/**
 * ✅ НОВА ФУНКЦІЯ: Повна синхронізація історії ВСІХ Запчастистів для акту
 *
 * Логіка:
 * 1. Отримуємо ВСІХ користувачів з роллю "Запчастист"
 * 2. Для кожного перевіряємо: чи є в акті деталі де xto_zamovuv = його slyusar_id
 * 3. Якщо є: оновлюємо/створюємо запис акту в історії
 * 4. Якщо немає: ВИДАЛЯЄМО запис акту з історії (якщо був)
 *
 * Це гарантує коректну синхронізацію при:
 * - Видаленні деталей з акту
 * - Зміні xto_zamovuv в базі sclad
 * - Переміщенні деталей між актами
 *
 * ⚠️ БЕЗПЕКА: Функція працює ТІЛЬКИ з роллю "Запчастист", не чіпає інші ролі
 */
async function syncAllZapchastystyHistoryForAct(
  actId: number,
  partsList: Array<{
    scladId: number | null;
    qty: number;
    sale: number;
    buyPrice: number;
    xtoZamovuv: number | null;
  }>,
  scladToScladNomeMap: Map<number, number>,
  discountMultiplier: number,
  actDateOn: string | null,
  pib: string,
  auto: string,
): Promise<number> {
  // Групуємо деталі по xto_zamovuv (хто оприходував)
  const partsGroupedByOwner = new Map<number, Array<(typeof partsList)[0]>>();

  for (const part of partsList) {
    if (part.xtoZamovuv && part.xtoZamovuv > 0) {
      const existing = partsGroupedByOwner.get(part.xtoZamovuv) || [];
      existing.push(part);
      partsGroupedByOwner.set(part.xtoZamovuv, existing);
    }
  }

  // Отримуємо ВСІХ Запчастистів з бази
  const { data: allZapchastysty, error: zapchastystyError } = await supabase
    .from("slyusars")
    .select("slyusar_id, data");

  if (zapchastystyError) {
    // console.error(
    // "❌ Помилка отримання списку Запчастистів:",
    // zapchastystyError,
    // );
    return 0;
  }

  if (!allZapchastysty || allZapchastysty.length === 0) {
    return 0;
  }

  const actDate = actDateOn
    ? actDateOn.split("T")[0]
    : new Date().toISOString().split("T")[0];

  let totalZapchastystySalary = 0;

  // Обробляємо КОЖНОГО користувача
  for (const zapchastyst of allZapchastysty) {
    const zData =
      typeof zapchastyst.data === "string"
        ? JSON.parse(zapchastyst.data)
        : zapchastyst.data;

    // ✅ БЕЗПЕКА: Працюємо ТІЛЬКИ з Запчастистами
    if (zData.Доступ !== "Запчастист") {
      continue;
    }

    const zSlyusarId = zapchastyst.slyusar_id;
    const zSklad = Number(zData.Склад) || 0;
    const zPercent = Number(zData.ПроцентЗапчастин) || 0;

    // Перевіряємо: чи є деталі в акті де xto_zamovuv = цей Запчастист
    const hisParts = partsGroupedByOwner.get(zSlyusarId) || [];
    const hasPartsInAct = hisParts.length > 0;

    // Рахуємо маржу для цього Запчастиста (БЕЗ деталей з його складу)
    let marginForSalary = 0;
    for (const part of hisParts) {
      // Перевіряємо чи склад деталі ≠ склад Запчастиста
      const detailSklad = part.scladId
        ? scladToScladNomeMap.get(part.scladId)
        : undefined;
      const shouldCount = detailSklad === undefined || detailSklad !== zSklad;

      if (shouldCount) {
        const partMargin =
          part.sale * discountMultiplier - part.buyPrice * part.qty;
        marginForSalary += partMargin;
      }
    }

    // Розраховуємо зарплату
    const zSalary =
      marginForSalary > 0 ? Math.round(marginForSalary * (zPercent / 100)) : 0;

    // Отримуємо поточну історію
    let zHistory = zData.Історія || {};
    let zActFound = false;
    let zFoundDateKey = "";
    let zFoundIndex = -1;

    // Шукаємо існуючий запис акту в історії
    for (const dateKey of Object.keys(zHistory)) {
      const dailyActs = zHistory[dateKey];
      if (Array.isArray(dailyActs)) {
        const idx = dailyActs.findIndex(
          (item: any) => String(item.Акт) === String(actId),
        );
        if (idx !== -1) {
          zActFound = true;
          zFoundDateKey = dateKey;
          zFoundIndex = idx;
          break;
        }
      }
    }

    let needsUpdate = false;

    if (hasPartsInAct) {
      // ✅ Є деталі в акті → оновлюємо/створюємо запис
      totalZapchastystySalary += zSalary;

      const zActRecord = {
        Акт: String(actId),
        Клієнт: pib,
        Автомобіль: auto,
        СуммаЗапчастин: Math.round(marginForSalary * 100) / 100,
        ЗарплатаЗапчастин: zSalary,
        ДатаЗакриття: null,
      };

      if (zActFound) {
        // Оновлюємо існуючий запис
        const oldRecord = zHistory[zFoundDateKey][zFoundIndex];
        zHistory[zFoundDateKey][zFoundIndex] = { ...oldRecord, ...zActRecord };
        needsUpdate = true;
        // console.log(
        // `📝 Оновлено історію Запчастиста "${zData.Name}" для акту ${actId}: маржа=${marginForSalary.toFixed(2)}, ЗП=${zSalary}`,
        // );
      } else {
        // Створюємо новий запис
        if (!zHistory[actDate]) {
          zHistory[actDate] = [];
        }
        zHistory[actDate].push(zActRecord);
        needsUpdate = true;
        // console.log(
        // `➕ Додано запис в історію Запчастиста "${zData.Name}" для акту ${actId}: маржа=${marginForSalary.toFixed(2)}, ЗП=${zSalary}`,
        // );
      }
    } else {
      // ❌ Немає деталей в акті → видаляємо запис (якщо був)
      if (zActFound) {
        zHistory[zFoundDateKey].splice(zFoundIndex, 1);

        // Якщо масив порожній, видаляємо дату
        if (zHistory[zFoundDateKey].length === 0) {
          delete zHistory[zFoundDateKey];
        }

        needsUpdate = true;
        // console.log(
        // `🗑️ Видалено акт ${actId} з історії Запчастиста "${zData.Name}" (деталей більше немає)`,
        // );
      }
    }

    // Зберігаємо оновлену історію в БД
    if (needsUpdate) {
      zData.Історія = zHistory;

      const { error: zUpdateError } = await supabase
        .from("slyusars")
        .update({ data: zData })
        .eq("slyusar_id", zSlyusarId);

      if (zUpdateError) {
        // console.error(
        // `❌ Помилка оновлення історії Запчастиста "${zData.Name}":`,
        // zUpdateError,
        // );
      }
    }
  }

  return totalZapchastystySalary;
}

/**
 * Синхронізує історію акту для Приймальника та Запчастистів
 * ✅ ОНОВЛЕНА ЛОГІКА: Працює однаково для ВСІХ ролей (Адміністратор, Приймальник, Слюсар, Запчастист, Складовщик)
 * - Завжди шукає приймальника з acts.pruimalnyk
 * - Оновлює історію приймальника
 * - Оновлює історію всіх Запчастистів
 */
async function syncPruimalnikHistory(
  actId: number,
  _totalWorksSumIgnored: number,
  _totalDetailsSumIgnored: number,
  actDateOn: string | null = null,
  discountPercent: number = 0,
): Promise<void> {
  // ✅ Визначаємо ПІБ приймальника - ЗАВЖДИ з acts.pruimalnyk для всіх ролей
  let pruimalnykName: string;

  // Шукаємо приймальника з acts.pruimalnyk
  const { data: actData, error: actError } = await supabase
    .from("acts")
    .select("pruimalnyk")
    .eq("act_id", actId)
    .single();

  if (actError || !actData || !actData.pruimalnyk) {
    // console.warn(
    // `⚠️ syncPruimalnikHistory: Не вдалося отримати pruimalnyk для акту №${actId}. Історія приймальника НЕ оновлюється, але історія Запчастистів буде оновлена.`,
    // );
    // ✅ НЕ виходимо! Продовжуємо для оновлення історії Запчастистів
    pruimalnykName = "";
  } else {
    pruimalnykName = actData.pruimalnyk;
  }

  // Змінні для приймальника (можуть бути undefined якщо немає приймальника)
  let userData: any = null;
  let slyusarData: any = null;
  let pruimalnykSklad = 0;
  let percentWork = 0;
  let percentParts = 0;

  // --- ОТРИМАННЯ ДАНИХ ПРИЙМАЛЬНИКА З БД (якщо є приймальник) ---
  if (pruimalnykName) {
    const { data: userDataArray, error: pruimalnykError } = await supabase
      .from("slyusars")
      .select("*")
      .eq("data->>Name", pruimalnykName);

    if (pruimalnykError || !userDataArray || userDataArray.length === 0) {
      // console.warn(
      // `⚠️ syncPruimalnikHistory: Приймальник "${pruimalnykName}" не знайдений в БД. Історія Запчастистів все одно буде оновлена.`,
      // );
      pruimalnykName = ""; // Скидаємо, щоб не оновлювати історію приймальника
    } else {
      userData = userDataArray[0];
      slyusarData =
        typeof userData.data === "string"
          ? JSON.parse(userData.data)
          : userData.data;

      // Додаткова перевірка ролі в базі - дозволяємо Приймальник та Адміністратор
      if (
        slyusarData.Доступ !== "Приймальник" &&
        slyusarData.Доступ !== "Адміністратор"
      ) {
        // console.warn(
        // "⚠️ syncPruimalnikHistory: Користувач не є Приймальником/Адміністратором в базі. Історія Запчастистів все одно буде оновлена.",
        // );
        pruimalnykName = ""; // Скидаємо, щоб не оновлювати історію приймальника
      } else {
        // Склад приймальника для порівняння
        pruimalnykSklad = Number(slyusarData.Склад) || 0;
        percentWork = Number(slyusarData.ПроцентРоботи) || 0;
        percentParts = Number(slyusarData.ПроцентЗапчастин) || 0;
      }
    }
  }

  // --- ЗБІР ДАНИХ З DOM ---
  const tableBody = document.querySelector<HTMLTableSectionElement>(
    "#act-items-table-container tbody",
  );

  if (!tableBody) {
    // console.error("❌ syncPruimalnikHistory: Таблиця не знайдена");
    return;
  }

  let worksTotalSale = 0;
  let worksTotalSlusarSalary = 0;

  let partsTotalSale = 0;
  // Масив для деталей: { scladId, qty, sale, buyPrice, xtoZamovuv }
  const partsList: {
    scladId: number | null;
    qty: number;
    sale: number;
    buyPrice: number;
    xtoZamovuv: number | null;
  }[] = [];

  const rows = Array.from(tableBody.querySelectorAll("tr"));

  // Хелпер
  const parseNum = (str: string | null | undefined) => {
    if (!str) return 0;
    return parseFloat(str.replace(/[^\d.-]/g, "")) || 0;
  };

  rows.forEach((row) => {
    const nameCell = row.querySelector('[data-name="name"]');
    const dataType = nameCell?.getAttribute("data-type");

    const sumCell = row.querySelector('[data-name="sum"]');
    const sumValue = parseNum(sumCell?.textContent);

    // РОБОТА
    if (dataType === "works") {
      const slusarSumCell = row.querySelector('[data-name="slyusar_sum"]');
      const slusarSalary = parseNum(slusarSumCell?.textContent);

      worksTotalSale += sumValue;
      worksTotalSlusarSalary += slusarSalary;
    }
    // ДЕТАЛІ
    else if (dataType === "details") {
      const catalogCell = row.querySelector('[data-name="catalog"]');
      const scladIdStr = catalogCell?.getAttribute("data-sclad-id");
      const scladId = scladIdStr ? parseInt(scladIdStr) : null;

      const qtyCell = row.querySelector('[data-name="id_count"]');
      const qty = parseNum(qtyCell?.textContent);

      partsTotalSale += sumValue;
      partsList.push({
        scladId,
        qty,
        sale: sumValue,
        buyPrice: 0,
        xtoZamovuv: null,
      });
    }
  });

  // --- ОТРИМАННЯ ВХІДНИХ ЦІН ТА НОМЕРА СКЛАДУ ---
  let partsTotalBuy = 0;
  // Суми для розрахунку (без деталей, де номер складу деталі = складу приймальника)
  let partsSaleForPruimalnyk = 0;
  let partsBuyForPruimalnyk = 0;

  const scladIdsToFetch = partsList
    .map((p) => p.scladId)
    .filter((id): id is number => id !== null && !isNaN(id));

  // Мапа: sclad_id -> номер складу деталі (scladNome)
  const scladToScladNomeMap = new Map<number, number>();

  if (scladIdsToFetch.length > 0) {
    // Отримуємо дані з sclad разом з scladNomer (номер фізичного складу) та xto_zamovuv (хто оприходував)
    const { data: scladItems, error: scladError } = await supabase
      .from("sclad")
      .select('sclad_id, price, "scladNomer", xto_zamovuv')
      .in("sclad_id", scladIdsToFetch);

    if (scladError) {
      // console.error(
      // "❌ syncPruimalnikHistory: Помилка отримання цін sclad:",
      // scladError,
      // );
    } else if (scladItems) {
      // Створюємо мапи: sclad_id -> ціна, номер складу, xto_zamovuv
      const priceMap = new Map<number, number>();
      const xtoZamovuvMap = new Map<number, number>(); // sclad_id -> xto_zamovuv (slyusar_id)
      scladItems.forEach((item: any) => {
        // Парсимо ціну (якщо рядок "938,00" або число 938)
        let val = 0;
        if (typeof item.price === "number") {
          val = item.price;
        } else {
          // Якщо рядок або щось інше
          val =
            parseFloat(
              String(item.price)
                .replace(",", ".")
                .replace(/[^\d.-]/g, ""),
            ) || 0;
        }
        priceMap.set(item.sclad_id, val);

        // Зберігаємо номер складу для цієї деталі (scladNomer)
        const scladNomer = Number(item.scladNomer) || 0;
        if (scladNomer > 0) {
          scladToScladNomeMap.set(item.sclad_id, scladNomer);
        }

        // Зберігаємо xto_zamovuv (хто оприходував деталь)
        const xtoZamovuv = Number(item.xto_zamovuv) || 0;
        if (xtoZamovuv > 0) {
          xtoZamovuvMap.set(item.sclad_id, xtoZamovuv);
        }
      });

      // Рахуємо суму закупки (загальну та для приймальника) + оновлюємо partsList
      partsList.forEach((part) => {
        if (part.scladId && priceMap.has(part.scladId)) {
          const buyPrice = priceMap.get(part.scladId) || 0;
          const buyCost = buyPrice * part.qty;
          partsTotalBuy += buyCost;

          // ✅ Оновлюємо деталь buyPrice та xtoZamovuv
          part.buyPrice = buyPrice;
          part.xtoZamovuv = xtoZamovuvMap.get(part.scladId) || null;

          // Перевіряємо, чи номер складу деталі НЕ співпадає зі складом приймальника
          const detailSklad = scladToScladNomeMap.get(part.scladId);
          const shouldCount =
            detailSklad === undefined || detailSklad !== pruimalnykSklad;

          // console.log(
          // `🔍 Деталь sclad_id=${part.scladId}: scladNomer=${detailSklad}, pruimalnykSklad=${pruimalnykSklad}, xtoZamovuv=${part.xtoZamovuv}, shouldCount=${shouldCount}, sale=${part.sale}, buyPrice=${buyPrice}`,
          // );

          if (shouldCount) {
            // Деталь враховується в зарплаті приймальника
            partsSaleForPruimalnyk += part.sale;
            partsBuyForPruimalnyk += buyCost;
          }
        } else {
          // Деталь без scladId або без ціни в sclad - враховуємо повністю в зарплаті приймальника
          // (невідомий запчастист = враховується)
          // console.log(
          // `🔍 Деталь без scladId або ціни: scladId=${part.scladId}, sale=${part.sale}`,
          // );
          partsSaleForPruimalnyk += part.sale;
          // partsBuyForPruimalnyk не додаємо, бо невідома ціна закупки
        }
      });
    }
  } else {
    // Якщо немає scladIdsToFetch - всі деталі без scladId, враховуємо всю суму продажу
    partsList.forEach((part) => {
      partsSaleForPruimalnyk += part.sale;
    });
  }

  // --- РОЗРАХУНОК БАЗ ТА ЗАРПЛАТ ---
  // Враховуємо дисконт (знижку)
  const discountMultiplier =
    discountPercent > 0 ? 1 - discountPercent / 100 : 1;

  // 1. Робота: (Сума Продажу * множник дисконту - Зарплата Слюсаря)
  // Дисконт застосовується до суми продажу, а потім віднімаємо зарплату слюсаря
  const workSaleAfterDiscount = worksTotalSale * discountMultiplier;
  const baseWorkProfit = workSaleAfterDiscount - worksTotalSlusarSalary;

  // 2. Запчастини: (Сума Продажу * множник дисконту - Сума Закупки)
  // Загальні суми (для відображення)
  const partsSaleAfterDiscount = partsTotalSale * discountMultiplier;
  const basePartsProfit = partsSaleAfterDiscount - partsTotalBuy;

  // 3. Запчастини для приймальника (виключаємо деталі, де scladNome = Склад приймальника)
  const partsSaleForPruimalnykAfterDiscount =
    partsSaleForPruimalnyk * discountMultiplier;
  const basePartsProfitForPruimalnyk =
    partsSaleForPruimalnykAfterDiscount - partsBuyForPruimalnyk;

  // ✅ ВИПРАВЛЕНО: Якщо сума від'ємна - зарплата = 0
  // Зарплата приймальника розраховується ТІЛЬКИ з деталей, де номер складу деталі (scladNome) ≠ складу приймальника
  const salaryWork =
    baseWorkProfit > 0 ? Math.round(baseWorkProfit * (percentWork / 100)) : 0;
  const salaryParts =
    basePartsProfitForPruimalnyk > 0
      ? Math.round(basePartsProfitForPruimalnyk * (percentParts / 100))
      : 0;

  // --- ВИДАЛЕННЯ АКТУ З ПОПЕРЕДНЬОГО ПРИЙМАЛЬНИКА (якщо змінився) ---
  // ✅ ВИПРАВЛЕНО: Шукаємо тільки попереднього приймальника, а не всіх
  const previousPruimalnyk = localStorage.getItem("current_act_pruimalnyk");

  // Якщо приймальник змінився - видаляємо акт з історії попереднього
  if (previousPruimalnyk && previousPruimalnyk !== pruimalnykName) {
    // Шукаємо попереднього приймальника в БД
    const { data: prevReceiverData, error: prevError } = await supabase
      .from("slyusars")
      .select("slyusar_id, data")
      .eq("data->>Name", previousPruimalnyk)
      .maybeSingle();

    if (prevError) {
      // console.error(
      // `❌ Помилка пошуку попереднього приймальника "${previousPruimalnyk}":`,
      // prevError,
      // );
    } else if (prevReceiverData) {
      const receiverData =
        typeof prevReceiverData.data === "string"
          ? JSON.parse(prevReceiverData.data)
          : prevReceiverData.data;

      // Перевіряємо, чи це Приймальник АБО Адміністратор (ті хто можуть "тримати" акти)
      if (
        receiverData.Доступ === "Приймальник" ||
        receiverData.Доступ === "Адміністратор"
      ) {
        let receiverHistory = receiverData.Історія || {};
        let wasModified = false;

        // Шукаємо і видаляємо акт з історії
        for (const dateKey of Object.keys(receiverHistory)) {
          const dailyActs = receiverHistory[dateKey];
          if (Array.isArray(dailyActs)) {
            const idx = dailyActs.findIndex(
              (item: any) => String(item.Акт) === String(actId),
            );
            if (idx !== -1) {
              dailyActs.splice(idx, 1);

              // Якщо масив порожній, видаляємо дату
              if (dailyActs.length === 0) {
                delete receiverHistory[dateKey];
              }

              wasModified = true;
              break;
            }
          }
        }

        // Оновлюємо в БД, якщо були зміни
        if (wasModified) {
          receiverData.Історія = receiverHistory;
          const { error: updateError } = await supabase
            .from("slyusars")
            .update({ data: receiverData })
            .eq("slyusar_id", prevReceiverData.slyusar_id);

          if (updateError) {
            // console.error(
            // `❌ Помилка оновлення історії для "${receiverData.Name}":`,
            // updateError,
            // );
          }
        }
      }
    }
  }

  // ✅ ВИПРАВЛЕНО: Отримуємо дані клієнта та авто з БАЗИ ДАНИХ, а не з DOM
  const { pib, auto } = await fetchActClientAndCarDataFromDB(actId);

  // --- РОЗРАХУНОК ТА ЗАПИС ЗАРПЛАТ ЗАПЧАСТИСТІВ ---
  // ✅ Використовуємо нову функцію для повної синхронізації історії ВСІХ Запчастистів
  // ✅ ВАЖЛИВО: Це виконується ЗАВЖДИ, незалежно від наявності приймальника
  const totalZapchastystySalary = await syncAllZapchastystyHistoryForAct(
    actId,
    partsList,
    scladToScladNomeMap,
    discountMultiplier,
    actDateOn,
    pib,
    auto,
  );

  // --- ОНОВЛЕННЯ ІСТОРІЇ ПРИЙМАЛЬНИКА (тільки якщо є приймальник) ---
  if (pruimalnykName && userData && slyusarData) {
    let history = slyusarData.Історія || {};
    let actFound = false;
    let foundDateKey = "";
    let foundIndex = -1;

    // 3. Шукаємо існуючий запис акту в історії
    for (const dateKey of Object.keys(history)) {
      const dailyActs = history[dateKey];
      if (Array.isArray(dailyActs)) {
        const idx = dailyActs.findIndex(
          (item: any) => String(item.Акт) === String(actId),
        );
        if (idx !== -1) {
          actFound = true;
          foundDateKey = dateKey;
          foundIndex = idx;
          break;
        }
      }
    }

    // ✅ ВИПРАВЛЕНО: Перевіряємо чи акт порожній (немає робіт і деталей)
    const isActEmpty =
      rows.length === 0 || (worksTotalSale === 0 && partsTotalSale === 0);

    if (isActEmpty) {
      // ❌ Акт порожній → видаляємо запис з історії (якщо був)
      if (actFound) {
        history[foundDateKey].splice(foundIndex, 1);

        // Якщо масив порожній, видаляємо дату
        if (history[foundDateKey].length === 0) {
          delete history[foundDateKey];
        }

        slyusarData.Історія = history;

        const { error: updateError } = await supabase
          .from("slyusars")
          .update({ data: slyusarData })
          .eq("slyusar_id", userData.slyusar_id);

        if (updateError) {
          // console.error(
          // "❌ syncPruimalnikHistory: Помилка видалення акту з історії:",
          // updateError,
          // );
        } else {
          // console.log(
          // `🗑️ Видалено порожній акт ${actId} з історії Приймальника "${pruimalnykName}"`,
          // );
        }
      } else {
        // console.log(
        // `ℹ️ Акт ${actId} порожній і не був в історії Приймальника - нічого видаляти`,
        // );
      }
    } else {
      // ✅ Акт має дані → оновлюємо/створюємо запис
      const actRecordUpdate = {
        Акт: String(actId),
        Клієнт: pib,
        Автомобіль: auto,
        // Записуємо чистий прибуток (після дисконту, собівартості/зарплати слюсаря і зарплати приймальника)
        // Записуємо Базовий прибуток (ДО відрахування зарплати приймальника), щоб співвідношення ЗП/Сума відповідало відсотку
        // ✅ ВИПРАВЛЕНО: Якщо сума від'ємна - записуємо 0 для зарплати
        СуммаРоботи: baseWorkProfit,
        СуммаЗапчастин: basePartsProfit, // Загальна сума запчастин (включаючи свій склад)
        МаржаДляЗарплати: basePartsProfitForPruimalnyk, // Маржа БЕЗ свого складу (для розрахунку ЗарплатаЗапчастин)
        ЗарплатаРоботи: salaryWork, // Вже = 0 якщо baseWorkProfit <= 0
        ЗарплатаЗапчастин: salaryParts, // = МаржаДляЗарплати × ПроцентЗапчастин / 100
        ЗарплатаЗапчастистів: totalZapchastystySalary, // Сума зарплат всіх Запчастистів по цьому акту
        Знижка: discountPercent, // Зберігаємо відсоток знижки для відображення
        ДатаЗакриття: null, // Буде заповнено при закритті акту
      };

      if (actFound) {
        const oldRecord = history[foundDateKey][foundIndex];
        history[foundDateKey][foundIndex] = {
          ...oldRecord,
          ...actRecordUpdate,
        };
      } else {
        // Використовуємо дату створення акту, а не поточну дату
        const actDate = actDateOn
          ? actDateOn.split("T")[0]
          : new Date().toISOString().split("T")[0];
        if (!history[actDate]) {
          history[actDate] = [];
        }
        history[actDate].push(actRecordUpdate);
      }

      // 4. Зберігаємо оновлену історію в БД
      slyusarData.Історія = history;

      const { error: updateError } = await supabase
        .from("slyusars")
        .update({ data: slyusarData })
        .eq("slyusar_id", userData.slyusar_id);

      if (updateError) {
        // console.error(
        // "❌ syncPruimalnikHistory: Помилка оновлення історії:",
        // updateError,
        // );
      } else {
        // ✅ Оновлюємо localStorage з новим приймальником для наступного збереження
        localStorage.setItem("current_act_pruimalnyk", pruimalnykName);
      }
    }
  } else {
    // console.log(
    // "⚠️ syncPruimalnikHistory: Немає приймальника - історія приймальника НЕ оновлюється (але Запчастисти оновлені)",
    // );
  }
}

/* =============================== ЗБЕРЕЖЕННЯ АКТУ =============================== */

/**
 * Записує інформацію про приймальника в таблицю acts
 * ✅ ВИПРАВЛЕНО: Записуємо ТІЛЬКИ якщо поточний користувач є Приймальник
 * Це забезпечує що acts.pruimalnyk завжди вказує на актуального Приймальника
 * і не перезаписується Адміністратором або іншими ролями
 * @param actId - ID акту
 */
async function savePruimalnykToActs(actId: number): Promise<void> {
  try {
    // ✅ ВИПРАВЛЕНО: Записуємо приймальника якщо поточний користувач є Приймальник АБО Адміністратор
    // Вони можуть "забирати" акт собі (видаляють з попереднього, записують собі)
    // Слюсар / Запчастист / Складовщик → просто оновлюють дані у поточного власника акту
    if (
      userAccessLevel !== "Приймальник" &&
      userAccessLevel !== "Адміністратор"
    ) {
      // console.log(
      // `📝 savePruimalnykToActs: Пропускаємо для ролі ${userAccessLevel} (тільки Приймальник/Адміністратор можуть стати pruimalnyk)`,
      // );
      return;
    }

    const userData = getSavedUserDataFromLocalStorage?.();
    if (!userData || !userData.name) {
      // console.warn("⚠️ Не вдалося отримати дані користувача з localStorage");
      return;
    }

    // Записуємо приймальника тільки якщо користувач є Приймальник
    const updateData = {
      pruimalnyk: userData.name,
    };

    const { error } = await supabase
      .from("acts")
      .update(updateData)
      .eq("act_id", actId);

    if (error) {
      // console.error(
      // `❌ Помилка при записуванні приймальника: ${error.message}`,
      // );
    } else {
      // console.log(`✅ acts.pruimalnyk оновлено на: ${userData.name}`);
    }
  } catch (err: any) {
    // console.error("❌ Помилка savePruimalnykToActs:", err?.message || err);
  }
}

async function saveActData(actId: number, originalActData: any): Promise<void> {
  if (isSaving) {
    throw new Error("Збереження вже виконується, зачекайте...");
  }
  if (globalCache.isActClosed) {
    throw new Error("Неможливо редагувати закритий акт");
  }
  isSaving = true;

  try {
    // Завантажуємо закупівельні ціни перед обробкою
    await loadPurchasePrices();

    const probigText = cleanText(
      document.getElementById(EDITABLE_PROBIG_ID)?.textContent,
    );
    const probigCleaned = probigText.replace(/\s/g, "");
    const newProbig =
      probigCleaned && /^\d+$/.test(probigCleaned)
        ? Number(probigCleaned)
        : probigCleaned || 0;

    const newReason =
      (
        document.getElementById(EDITABLE_REASON_ID) as HTMLElement
      )?.innerText?.trim() || "";
    const newRecommendations =
      (
        document.getElementById(EDITABLE_RECOMMENDATIONS_ID) as HTMLElement
      )?.innerText?.trim() || "";
    const newNotes =
      (
        document.getElementById(EDITABLE_NOTES_ID) as HTMLElement
      )?.innerText?.trim() || "";

    const items = parseTableRows();

    // ⚠️ ПЕРЕВІРКА ДЛЯ СЛЮСАРЯ: він може зберігати зміни тільки в своїх рядках
    if (userAccessLevel === "Слюсар" && userName) {
      const originalItems = originalActData?.actItems || [];

      // Перевіряємо, чи слюсар намагається змінити існуючі рядки
      for (const item of items) {
        // Знаходимо оригінальний рядок
        const originalItem = originalItems.find(
          (orig: any) =>
            orig.Найменування === item.name && orig.Type === item.type,
        );

        // Якщо рядок існував раніше (не новий)
        if (originalItem) {
          const originalPib = originalItem.ПІБ_Магазин || "";

          // Перевіряємо, чи це не його рядок
          if (
            originalPib &&
            originalPib.toLowerCase() !== userName.toLowerCase()
          ) {
            throw new Error(
              `⛔ Ви не можете змінювати рядок "${item.name}", оскільки він призначений іншому слюсарю (${originalPib})`,
            );
          }
        }

        // (Перевірка на призначення чужого ПІБ для слюсаря видалена за вимогою)
      }
    }

    const {
      details,
      works,
      detailRowsForShops,
      workRowsForSlyusars,
      newScladIds,
      totalDetailsSum,
      totalWorksSum,
      grandTotalSum,
      totalWorksProfit,
      totalDetailsMargin,
    } = processItems(items);

    const avansInput = document.getElementById(
      "editable-avans",
    ) as HTMLInputElement;
    const avansValue = avansInput
      ? parseFloat(avansInput.value.replace(/\s/g, "") || "0")
      : 0;

    const discountInput = document.getElementById(
      "editable-discount",
    ) as HTMLInputElement;
    const discountValue = discountInput
      ? parseFloat(discountInput.value.replace(/\s/g, "") || "0")
      : 0;

    // Розраховуємо знижку від ВАЛУ (загальної суми), а НЕ від маржі
    // Знижка застосовується до загальної суми продажу
    const discountMultiplier = discountValue > 0 ? 1 - discountValue / 100 : 1;

    // Сума продажу після знижки
    const detailsSaleAfterDiscount = totalDetailsSum * discountMultiplier;
    const worksSaleAfterDiscount = totalWorksSum * discountMultiplier;

    // Маржа = сума продажу після знижки - собівартість (для деталей вже врахована в totalDetailsMargin)
    // Для деталей: маржа = (продажна ціна - вхідна ціна) * кількість
    // Після знижки: маржа = продажна ціна * (1 - знижка%) - вхідна ціна * кількість
    // Це еквівалентно: (totalDetailsSum * discountMultiplier) - totalPurchasePrice
    // Де totalPurchasePrice = totalDetailsSum - totalDetailsMargin

    const totalPurchasePrice = totalDetailsSum - (totalDetailsMargin || 0);
    const finalDetailsProfit = detailsSaleAfterDiscount - totalPurchasePrice;

    // Для робіт: прибуток = сума продажу після знижки - зарплата слюсаря
    // totalWorksProfit = totalWorksSum - зарплата слюсаря, тому зарплата = totalWorksSum - totalWorksProfit
    const totalSlyusarSalary = totalWorksSum - (totalWorksProfit || 0);
    const finalWorksProfit = worksSaleAfterDiscount - totalSlyusarSalary;

    const updatedActData = {
      ...(originalActData || {}),
      Пробіг: newProbig,
      "Причина звернення": newReason,
      Рекомендації: newRecommendations,
      Примітки: newNotes,
      Деталі: details,
      Роботи: works,
      "За деталі": totalDetailsSum,
      "За роботу": totalWorksSum,
      "Загальна сума": grandTotalSum,
      Аванс: avansValue,
      Знижка: discountValue,
      "Прибуток за деталі": Number(finalDetailsProfit.toFixed(2)),
      "Прибуток за роботу": Number(finalWorksProfit.toFixed(2)),
    };

    const deltas = calculateDeltas();

    showNotification("Збереження змін...", "info");

    // 💾 Збереження даних акту (тільки JSONB, без окремих колонок)
    const { error: updateError } = await supabase
      .from("acts")
      .update({
        data: updatedActData,
        avans: avansValue,
      })
      .eq("act_id", actId);

    if (updateError) {
      throw new Error(`Не вдалося оновити акт: ${updateError.message}`);
    }

    // ✅ Записуємо інформацію про приймальника
    await savePruimalnykToActs(actId);

    await updateScladActNumbers(actId, newScladIds);
    await applyScladDeltas(deltas);
    await syncShopsOnActSave(actId, detailRowsForShops);

    // ✅ Завжди синхронізуємо зарплати та історію (saveMargins видалено)
    await syncSlyusarsOnActSave(actId, workRowsForSlyusars);
    await syncPruimalnikHistory(
      actId,
      totalWorksSum,
      totalDetailsSum,
      globalCache.currentActDateOn,
      discountValue,
    );

    // ===== ЛОГУВАННЯ ЗМІН =====
    try {
      const currentItems = items;
      const { added, deleted } = compareActChanges(
        globalCache.initialActItems || [],
        currentItems,
      );
      await logActChanges(actId, added, deleted);
    } catch (logError) {
      // console.error("⚠️ Помилка логування змін:", logError);
      // Не блокуємо збереження через помилку логування
    }
    // =====================================

    globalCache.oldNumbers = readTableNewNumbers();
    updateInitialActItems(details, works);

    // ✅ ВИПРАВЛЕНО: Інвалідуємо кеш перед завантаженням, щоб отримати свіжі дані з БД
    // Це вирішує проблему, коли після збереження акту і повторного відкриття
    // без перезавантаження сторінки дані зарплати не оновлювалися
    invalidateGlobalDataCache();

    await Promise.all([
      loadGlobalData(),
      refreshQtyWarningsIn(ACT_ITEMS_TABLE_CONTAINER_ID),
      cleanupEmptyRows(),
    ]);

    updateCalculatedSumsInFooter();
    refreshActsTable();
  } finally {
    isSaving = false;
  }
}

export function addSaveHandler(actId: number, originalActData: any): void {
  const saveButton = document.getElementById(
    ZAKAZ_NARAYD_SAVE_BTN_ID,
  ) as HTMLButtonElement | null;
  if (!saveButton) return;

  const newSaveButton = saveButton.cloneNode(true) as HTMLButtonElement;
  saveButton.parentNode?.replaceChild(newSaveButton, saveButton);

  newSaveButton.addEventListener("click", async () => {
    if (isSaving) {
      showNotification("Збереження вже виконується, зачекайте...", "warning");
      return;
    }
    try {
      await saveActData(actId, originalActData);

      // ✅ Сповіщаємо про збереження (динамічний імпорт щоб уникнути циклічної залежності)
      try {
        const { notifyActSaved } = await import("../actPresence");
        await notifyActSaved(actId);
      } catch (notifyErr) {
        // console.warn("Помилка відправки сповіщення:", notifyErr);
      }

      showNotification("Зміни успішно збережено", "success");
    } catch (err: any) {
      // console.error("Помилка збереження:", err);
      showNotification(
        `Помилка збереження даних: ${err?.message || err}`,
        "error",
      );
    }
  });
}

/**
 * ✅ НОВА ФУНКЦІЯ: Видаляє акт з історії Приймальника та всіх Запчастистів
 * Використовується при повному видаленні акту з БД
 * @param actId - ID акту для видалення з історій
 */
export async function removeActFromAllHistories(actId: number): Promise<void> {
  // console.log(
  // `🗑️ removeActFromAllHistories: Видаляємо акт ${actId} з усіх історій...`,
  // );

  try {
    // 1. Отримуємо приймальника для цього акту
    const { data: actData, error: actError } = await supabase
      .from("acts")
      .select("pruimalnyk")
      .eq("act_id", actId)
      .single();

    if (actError && actError.code !== "PGRST116") {
      // console.error("❌ Помилка отримання даних акту:", actError);
    }

    // 2. Видаляємо з історії Приймальника (якщо є)
    if (actData?.pruimalnyk) {
      const { data: pruimalnykData, error: pruimalnykError } = await supabase
        .from("slyusars")
        .select("slyusar_id, data")
        .eq("data->>Name", actData.pruimalnyk)
        .maybeSingle();

      if (pruimalnykError) {
        // console.error("❌ Помилка пошуку Приймальника:", pruimalnykError);
      } else if (pruimalnykData) {
        const pData =
          typeof pruimalnykData.data === "string"
            ? JSON.parse(pruimalnykData.data)
            : pruimalnykData.data;

        if (
          pData.Доступ === "Приймальник" ||
          pData.Доступ === "Адміністратор"
        ) {
          let pHistory = pData.Історія || {};
          let wasModified = false;

          for (const dateKey of Object.keys(pHistory)) {
            const dailyActs = pHistory[dateKey];
            if (Array.isArray(dailyActs)) {
              const idx = dailyActs.findIndex(
                (item: any) => String(item.Акт) === String(actId),
              );
              if (idx !== -1) {
                dailyActs.splice(idx, 1);
                if (dailyActs.length === 0) {
                  delete pHistory[dateKey];
                }
                wasModified = true;
                break;
              }
            }
          }

          if (wasModified) {
            pData.Історія = pHistory;
            const { error: updateError } = await supabase
              .from("slyusars")
              .update({ data: pData })
              .eq("slyusar_id", pruimalnykData.slyusar_id);

            if (updateError) {
              // console.error(
              // `❌ Помилка видалення акту ${actId} з історії Приймальника:`,
              // updateError,
              // );
            } else {
              // console.log(
              // `✅ Акт ${actId} видалено з історії Приймальника "${actData.pruimalnyk}"`,
              // );
            }
          }
        }
      }
    }

    // 3. Видаляємо з історії ВСІХ Запчастистів
    const { data: allZapchastysty, error: zError } = await supabase
      .from("slyusars")
      .select("slyusar_id, data");

    if (zError) {
      // console.error("❌ Помилка отримання списку Запчастистів:", zError);
    } else if (allZapchastysty) {
      for (const z of allZapchastysty) {
        const zData = typeof z.data === "string" ? JSON.parse(z.data) : z.data;

        if (zData.Доступ !== "Запчастист") continue;

        let zHistory = zData.Історія || {};
        let wasModified = false;

        for (const dateKey of Object.keys(zHistory)) {
          const dailyActs = zHistory[dateKey];
          if (Array.isArray(dailyActs)) {
            const idx = dailyActs.findIndex(
              (item: any) => String(item.Акт) === String(actId),
            );
            if (idx !== -1) {
              dailyActs.splice(idx, 1);
              if (dailyActs.length === 0) {
                delete zHistory[dateKey];
              }
              wasModified = true;
              break;
            }
          }
        }

        if (wasModified) {
          zData.Історія = zHistory;
          const { error: zUpdateError } = await supabase
            .from("slyusars")
            .update({ data: zData })
            .eq("slyusar_id", z.slyusar_id);

          if (zUpdateError) {
            // console.error(
            // `❌ Помилка видалення акту ${actId} з історії Запчастиста "${zData.Name}":`,
            // zUpdateError,
            // );
          } else {
            // console.log(
            // `✅ Акт ${actId} видалено з історії Запчастиста "${zData.Name}"`,
            // );
          }
        }
      }
    }

    // console.log(`✅ removeActFromAllHistories: Завершено для акту ${actId}`);
  } catch (err) {
    // console.error(`❌ removeActFromAllHistories: Помилка:`, err);
  }
}
