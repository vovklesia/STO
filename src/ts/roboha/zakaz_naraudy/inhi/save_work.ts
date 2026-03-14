//src\ts\roboha\zakaz_naraudy\inhi\save_work.ts
import { supabase } from "../../../vxid/supabaseClient";
import { showNotification } from "./vspluvauhe_povidomlenna";
import { globalCache, ACT_ITEMS_TABLE_CONTAINER_ID } from "../globalCache";
import { safeParseJSON } from "./ctvorennia_papku_googleDrive.";

/* ===================== ХЕЛПЕРИ ДЛЯ SLYUSARS ===================== */

type SlyusarRow = { slyusar_id?: number; data: any };

function toISODateOnly(dt: string | Date | null | undefined): string | null {
  if (!dt) return null;
  const d = typeof dt === "string" ? new Date(dt) : dt;
  if (!d || isNaN(+d)) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

async function fetchActDates(
  actId: number,
): Promise<{ date_on: string | null; date_off: string | null }> {
  const { data, error } = await supabase
    .from("acts")
    .select("date_on, date_off")
    .eq("act_id", actId)
    .single();
  if (error) {
    // console.warn("Не вдалося прочитати дати акту:", error.message);
    return { date_on: null, date_off: null };
  }
  return { date_on: data?.date_on ?? null, date_off: data?.date_off ?? null };
}

async function fetchActClientAndCarData(actId: number): Promise<{
  clientInfo: string;
  carInfo: string;
}> {
  try {
    const { data: act, error: actError } = await supabase
      .from("acts")
      .select("client_id, cars_id")
      .eq("act_id", actId)
      .single();

    if (actError || !act) {
      // console.warn("Не вдалося отримати дані акту:", actError?.message);
      return { clientInfo: "—", carInfo: "—" };
    }

    let clientInfo = "—";
    if (act.client_id) {
      const { data: client } = await supabase
        .from("clients")
        .select("data")
        .eq("client_id", act.client_id)
        .single();

      if (client?.data) {
        const clientData = safeParseJSON(client.data);
        clientInfo = clientData?.["ПІБ"] || clientData?.fio || "—";
      }
    }

    let carInfo = "—";
    if (act.cars_id) {
      const { data: car } = await supabase
        .from("cars")
        .select("data")
        .eq("cars_id", act.cars_id)
        .single();

      if (car?.data) {
        const carData = safeParseJSON(car.data);
        const auto = carData?.["Авто"] || "";
        const year = carData?.["Рік"] || "";
        const nomer = carData?.["Номер авто"] || "";
        carInfo = `${auto} ${year} ${nomer}`.trim() || "—";
      }
    }

    return { clientInfo, carInfo };
  } catch (error) {
    // console.warn("Помилка при отриманні даних клієнта та авто:", error);
    return { clientInfo: "—", carInfo: "—" };
  }
}

async function fetchSlyusarByName(name: string): Promise<SlyusarRow | null> {
  const { data, error } = await supabase
    .from("slyusars")
    .select("slyusar_id, data")
    .eq("data->>Name", name)
    .maybeSingle();

  if (error) {
    // console.warn(`fetchSlyusarByName(${name}):`, error.message);
    return null;
  }
  if (!data) return null;
  return { slyusar_id: data.slyusar_id, data: data.data };
}

async function updateSlyusarJson(row: SlyusarRow): Promise<void> {
  if (!row.slyusar_id) return;
  const { error } = await supabase
    .from("slyusars")
    .update({ data: row.data })
    .eq("slyusar_id", row.slyusar_id);
  if (error)
    throw new Error(
      `Не вдалося оновити slyusars#${row.slyusar_id}: ${error.message}`,
    );
}

function ensureSlyusarHistoryRoot(row: SlyusarRow): any {
  if (!row.data || typeof row.data !== "object") row.data = {};
  if (!row.data["Історія"] || typeof row.data["Історія"] !== "object")
    row.data["Історія"] = {};
  return row.data["Історія"];
}

const cleanText = (s?: string | null) =>
  (s ?? "").replace(/\u00A0/g, " ").trim();
const parseNum = (s?: string | null) => {
  const v = cleanText(s).replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
};

/**
 * ✅ НОВА ФУНКЦІЯ: Отримує попередні роботи акту НАПРЯМУЮ з бази slyusars
 * Це гарантує що при видаленні робіт, вони також видаляються з slyusars.Історія
 */
async function fetchPrevWorksFromSlyusars(actId: number): Promise<
  Array<{
    slyusarName: string;
    Найменування: string;
    recordId?: string;
  }>
> {
  const out: Array<{
    slyusarName: string;
    Найменування: string;
    recordId?: string;
  }> = [];

  try {
    // Отримуємо всіх слюсарів (тільки з роллю Слюсар)
    const { data: slyusars, error } = await supabase
      .from("slyusars")
      .select("data");

    if (error || !slyusars) {
      // console.warn(
      // "fetchPrevWorksFromSlyusars: помилка отримання слюсарів:",
      // error,
      // );
      return out;
    }

    for (const slyusar of slyusars) {
      const slyusarData =
        typeof slyusar.data === "string"
          ? JSON.parse(slyusar.data)
          : slyusar.data;
      if (!slyusarData || !slyusarData.Name) continue;

      // Перевіряємо чи це Слюсар (бо інші ролі не мають робіт в історії)
      if (slyusarData.Доступ !== "Слюсар") continue;

      const slyusarName = slyusarData.Name;
      const history = slyusarData.Історія || {};

      // Перебираємо всі дати в історії
      for (const dateKey of Object.keys(history)) {
        const dayBucket = history[dateKey];
        if (!Array.isArray(dayBucket)) continue;

        // Шукаємо запис з цим актом
        const actEntry = dayBucket.find(
          (e: any) => String(e?.["Акт"]) === String(actId),
        );
        if (!actEntry) continue;

        // Знайшли запис акту - додаємо всі роботи
        const zapisи = actEntry["Записи"] || [];
        for (const zap of zapisи) {
          out.push({
            slyusarName,
            Найменування: zap.Робота || "",
            recordId: zap.recordId,
          });
        }
      }
    }
  } catch (err) {
    // console.error("fetchPrevWorksFromSlyusars: помилка:", err);
  }

  return out;
}

function collectCurrentWorkSlyusarsFromTable(): string[] {
  const names = new Set<string>();
  const rows = document.querySelectorAll(
    `#${ACT_ITEMS_TABLE_CONTAINER_ID} tbody tr`,
  );
  rows.forEach((row) => {
    const nameCell = row.querySelector('[data-name="name"]') as HTMLElement;
    if (!nameCell) return;
    const typeFromCell = nameCell.getAttribute("data-type");
    if (typeFromCell !== "works") return;
    const pibCell = row.querySelector(
      '[data-name="pib_magazin"]',
    ) as HTMLElement;
    const slyusarName = cleanText(pibCell?.textContent);
    if (slyusarName) names.add(slyusarName);
  });
  return Array.from(names);
}

/* ============================= ОСНОВНА СИНХРОНІЗАЦІЯ ============================= */

export interface WorkRow {
  slyusarName: string;
  Найменування: string;
  Кількість: number;
  Ціна: number;
  Зарплата: number;
  recordId?: string; // ✅ Унікальний ID для точного пошуку
}

async function syncSlyusarsHistoryForAct(params: {
  actId: number;
  dateKey: string;
  dateClose: string | null;
  clientInfo: string;
  carInfo: string;
  currentRows: Array<{
    slyusarName: string;
    Найменування: string;
    Кількість: number;
    Ціна: number;
    Зарплата: number;
    recordId?: string; // ✅ Додано recordId
  }>;
  prevRows: Array<{
    slyusarName: string;
    Найменування: string; // ✅ Додано для порівняння
    recordId?: string; // ✅ Додано recordId
  }>;
}): Promise<void> {
  const group = (rows: any[]) => {
    const m = new Map<string, any[]>();
    for (const r of rows) {
      const k = String(r.slyusarName || "").trim();
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  };

  const curBySlyusar = group(params.currentRows);
  const prevBySlyusar = group(params.prevRows);

  /**
   * Розгортає скорочену назву для збереження
   */
  function expandNameForSave(shortenedName: string): string {
    if (!shortenedName || !shortenedName.includes("....."))
      return shortenedName;

    const allNames = [...globalCache.works, ...globalCache.details];
    const [firstPart, lastPart] = shortenedName.split(".....");

    const fullName = allNames.find((name) => {
      const sentences = name
        .split(/(?<=\.)\s*/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (sentences.length < 2) return false;
      const lastSentence = sentences[sentences.length - 1];
      return (
        name.startsWith(firstPart) &&
        (name.endsWith(lastPart) || lastSentence === lastPart)
      );
    });

    return fullName || shortenedName;
  }

  // ОНОВИТИ / СТВОРИТИ
  // Допоміжна функція для порівняння масивів робіт

  for (const [slyusarName, rows] of curBySlyusar.entries()) {
    const slyRow = await fetchSlyusarByName(slyusarName);
    if (!slyRow) {
      showNotification(
        `Слюсар "${slyusarName}" не знайдений у slyusars — пропущено`,
        "warning",
        1800,
      );
      continue;
    }

    // Пошук попередніх робіт цього слюсаря
    // Якщо кількість або склад робіт змінились — оновлюємо
    // Отримуємо попередні записи робіт з історії
    const history = ensureSlyusarHistoryRoot(slyRow);
    if (!history[params.dateKey]) history[params.dateKey] = [];
    const dayBucket = history[params.dateKey] as any[];
    let actEntry = dayBucket.find(
      (e: any) => String(e?.["Акт"]) === String(params.actId),
    );
    if (!actEntry) {
      actEntry = {
        Акт: String(params.actId),
        Записи: [],
        СуммаРоботи: 0,
        ДатаЗакриття: null,
        Клієнт: "",
        Автомобіль: "",
      };
      dayBucket.push(actEntry);
    }

    // ✅ ОПТИМІЗОВАНО: Зливаємо нові дані в старі записи замість повної перезапису.
    // Це гарантує збереження "Записано", "Розраховано" та БУДЬ-ЯКИХ інших полів.
    const prevWorks = Array.isArray(actEntry["Записи"])
      ? actEntry["Записи"]
      : [];

    // Будуємо Map за recordId для швидкого пошуку старого запису
    const prevWorksById = new Map<string, any>();
    for (const pw of prevWorks) {
      if (pw.recordId) {
        prevWorksById.set(pw.recordId, pw);
      }
    }

    const zapis: any[] = [];
    let summaRob = 0;

    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const qty = Number(r.Кількість) || 0;
      const price = Number(r.Ціна) || 0;
      const zp = Number(r.Зарплата) || 0;
      const workName = r.Найменування || "";
      const fullWorkName = workName.includes(".....")
        ? expandNameForSave(workName)
        : workName;

      const currentRecordId = r.recordId || "";

      // Шукаємо попередній запис ТІЛЬКИ за recordId
      const prevRecord: any =
        currentRecordId && prevWorksById.has(currentRecordId)
          ? prevWorksById.get(currentRecordId)
          : null;

      // Визначаємо recordId
      let recordId = "";
      if (currentRecordId) {
        recordId = currentRecordId;
      } else if (prevRecord?.recordId) {
        recordId = prevRecord.recordId;
      } else {
        recordId = `${params.actId}_${slyusarName}_${idx}_${Date.now()}`;
      }

      // ✅ MERGE: починаємо зі старого запису → зберігаємо ВСІ існуючі поля
      // (Записано, Розраховано, та будь-які майбутні поля залишаються недоторканими)
      const newRecord: any = prevRecord ? { ...prevRecord } : {};

      // Перезаписуємо ЛИШЕ ті поля, що йдуть з поточного збереження
      newRecord.recordId = recordId;
      newRecord.Ціна = price;
      newRecord.Кількість = qty;
      newRecord.Робота = fullWorkName;
      newRecord.Зарплата = zp;

      // "Записано" встановлюємо ТІЛЬКИ якщо його ще немає (новий запис)
      if (!newRecord.Записано) {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, "0");
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const year = now.getFullYear();
        newRecord.Записано = `${day}.${month}.${year}`;
      }
      // "Розраховано" — НІКОЛИ не чіпаємо (зберігається через spread)

      zapis.push(newRecord);
      summaRob += price * qty;
    }

    // ✅ ОПТИМІЗАЦІЯ: оновлюємо БД тільки якщо дані реально змінились
    const newSumma = Math.max(
      0,
      Math.round((summaRob + Number.EPSILON) * 100) / 100,
    );

    const zapisChanged =
      JSON.stringify(prevWorks) !== JSON.stringify(zapis) ||
      actEntry["СуммаРоботи"] !== newSumma ||
      actEntry["ДатаЗакриття"] !== params.dateClose ||
      actEntry["Клієнт"] !== params.clientInfo ||
      actEntry["Автомобіль"] !== params.carInfo;

    if (zapisChanged) {
      actEntry["Записи"] = zapis;
      actEntry["СуммаРоботи"] = newSumma;
      actEntry["ДатаЗакриття"] = params.dateClose;
      actEntry["Клієнт"] = params.clientInfo;
      actEntry["Автомобіль"] = params.carInfo;

      await updateSlyusarJson(slyRow);
    }
  }

  // ✅ ВИПРАВЛЕНО: Очищення записів ПРИ ЗМІНІ СЛЮСАРЯ для конкретних робіт
  // Створюємо Map поточних recordId для швидкого пошуку: recordId -> slyusarName
  const currentRecordIdToSlyusar = new Map<string, string>();
  for (const row of params.currentRows) {
    if (row.recordId) {
      currentRecordIdToSlyusar.set(row.recordId, row.slyusarName);
    }
  }

  // Перевіряємо кожен попередній запис
  for (const prevRow of params.prevRows) {
    const prevSlyusarName = prevRow.slyusarName;
    const prevRecordId = prevRow.recordId;

    // Якщо є recordId - перевіряємо чи змінився слюсар
    if (prevRecordId && currentRecordIdToSlyusar.has(prevRecordId)) {
      const currentSlyusar = currentRecordIdToSlyusar.get(prevRecordId);
      if (currentSlyusar !== prevSlyusarName) {
        // Слюсар змінився! Видаляємо цей запис у попереднього слюсаря

        const slyRow = await fetchSlyusarByName(prevSlyusarName);
        if (slyRow) {
          const history = ensureSlyusarHistoryRoot(slyRow);
          const dayBucket = history[params.dateKey] as any[] | undefined;

          if (dayBucket) {
            const actEntry = dayBucket.find(
              (e: any) => String(e?.["Акт"]) === String(params.actId),
            );

            if (actEntry?.["Записи"] && Array.isArray(actEntry["Записи"])) {
              // Видаляємо конкретний запис за recordId
              const initialLength = actEntry["Записи"].length;
              actEntry["Записи"] = actEntry["Записи"].filter(
                (zap: any) => zap.recordId !== prevRecordId,
              );

              if (actEntry["Записи"].length < initialLength) {
                // Перераховуємо суму
                let newSum = 0;
                actEntry["Записи"].forEach((zap: any) => {
                  newSum +=
                    (Number(zap.Ціна) || 0) * (Number(zap.Кількість) || 0);
                });
                actEntry["СуммаРоботи"] = Math.max(
                  0,
                  Math.round((newSum + Number.EPSILON) * 100) / 100,
                );

                // Якщо записів не залишилось - видаляємо весь актовий запис
                if (actEntry["Записи"].length === 0) {
                  const actIdx = dayBucket.indexOf(actEntry);
                  if (actIdx !== -1) {
                    dayBucket.splice(actIdx, 1);
                  }
                }

                await updateSlyusarJson(slyRow);
              }
            }
          }
        }
      }
    }
  }

  // Видаляємо слюсарів, яких ПОВНІСТЮ немає в поточних даних акту
  for (const [oldName] of prevBySlyusar.entries()) {
    if (curBySlyusar.has(oldName)) continue;

    const slyRow = await fetchSlyusarByName(oldName);
    if (!slyRow) continue;

    const history = ensureSlyusarHistoryRoot(slyRow);
    const dayBucket = history[params.dateKey] as any[] | undefined;
    if (!dayBucket) continue;

    const idx = dayBucket.findIndex(
      (e: any) => String(e?.["Акт"]) === String(params.actId),
    );
    if (idx === -1) continue;

    const actEntry = dayBucket[idx];
    if (actEntry?.["Записи"] && Array.isArray(actEntry["Записи"])) {
      actEntry["Записи"].forEach((zap: any) => {
        zap["Зарплата"] = 0;
      });
    }

    dayBucket.splice(idx, 1);
    await updateSlyusarJson(slyRow);
  }
}

export async function syncSlyusarsOnActSave(
  actId: number,
  workRowsForSlyusars: Array<{
    slyusarName: string;
    Найменування: string;
    Кількість: number;
    Ціна: number;
    Зарплата: number;
    recordId?: string; // ✅ Додано recordId
  }>,
): Promise<void> {
  try {
    const { date_on, date_off } = await fetchActDates(actId);
    const dateKey = toISODateOnly(date_on);
    const dateClose = toISODateOnly(date_off);

    if (!dateKey) {
      showNotification(
        "Не вдалось визначити дату відкриття акту — Історія в slyusars не оновлена",
        "warning",
        2000,
      );
      return;
    }

    const { clientInfo, carInfo } = await fetchActClientAndCarData(actId);

    // ✅ ВИПРАВЛЕНО: Отримуємо попередні роботи НАПРЯМУЮ з бази slyusars, а не з кешу
    // Це гарантує синхронізацію навіть якщо кеш порожній
    const prevWorkRows = await fetchPrevWorksFromSlyusars(actId);

    await syncSlyusarsHistoryForAct({
      actId,
      dateKey,
      dateClose,
      clientInfo,
      carInfo,
      currentRows: workRowsForSlyusars,
      prevRows: prevWorkRows,
    });
  } catch (error: any) {
    // console.error("Помилка синхронізації з slyusars:", error);
    showNotification(
      "Помилка синхронізації з ПІБ (слюсарями): " + (error?.message || error),
      "error",
      3000,
    );
  }
}

/* ========================== ЗАКРИТТЯ / ВІДКРИТТЯ АКТУ ========================== */

export async function closeActAndMarkSlyusars(actId: number): Promise<void> {
  try {
    const now = new Date();
    const nowISO = now.toISOString();
    const nowDateOnly = toISODateOnly(now)!;

    const { error: upErr } = await supabase
      .from("acts")
      .update({ date_off: nowISO })
      .eq("act_id", actId);
    if (upErr)
      throw new Error(
        "Не вдалося оновити дату закриття акту: " + upErr.message,
      );

    const { date_on } = await fetchActDates(actId);
    const dateKey = toISODateOnly(date_on);
    if (!dateKey) return;

    const { clientInfo, carInfo } = await fetchActClientAndCarData(actId);

    const slyusarNames = collectCurrentWorkSlyusarsFromTable();
    for (const name of slyusarNames) {
      const row = await fetchSlyusarByName(name);
      if (!row) continue;
      const history = ensureSlyusarHistoryRoot(row);
      const dayBucket = (history[dateKey] as any[]) || [];
      const actEntry = dayBucket.find(
        (e: any) => String(e?.["Акт"]) === String(actId),
      );
      if (actEntry) {
        actEntry["ДатаЗакриття"] = nowDateOnly;
        actEntry["Клієнт"] = clientInfo;
        actEntry["Автомобіль"] = carInfo;

        if (actEntry["Записи"] && Array.isArray(actEntry["Записи"])) {
          actEntry["Записи"].forEach((zap: any) => {
            if (!("Зарплата" in zap)) {
              zap["Зарплата"] = 0;
            }
          });
        }

        await updateSlyusarJson(row);
      }
    }

    // --- Оновлення ДатаЗакриття для Приймальника ---
    const { data: actDataForClose } = await supabase
      .from("acts")
      .select("pruimalnyk")
      .eq("act_id", actId)
      .single();

    if (actDataForClose?.pruimalnyk) {
      const pruimRow = await fetchSlyusarByName(actDataForClose.pruimalnyk);
      if (pruimRow) {
        const pruimHistory = ensureSlyusarHistoryRoot(pruimRow);
        for (const dk of Object.keys(pruimHistory)) {
          const bucket = pruimHistory[dk];
          if (!Array.isArray(bucket)) continue;
          const entry = bucket.find(
            (e: any) => String(e?.["Акт"]) === String(actId),
          );
          if (entry) {
            entry["ДатаЗакриття"] = nowDateOnly;
            await updateSlyusarJson(pruimRow);
            break;
          }
        }
      }
    }

    // --- Оновлення ДатаЗакриття для Запчастистів ---
    const { data: allZapchForClose } = await supabase
      .from("slyusars")
      .select("slyusar_id, data");

    if (allZapchForClose) {
      for (const zRow of allZapchForClose) {
        const zd =
          typeof zRow.data === "string" ? JSON.parse(zRow.data) : zRow.data;
        if (!zd || zd["Доступ"] !== "Запчастист") continue;
        const zHist = zd["Історія"] || {};
        let zModified = false;
        for (const dk of Object.keys(zHist)) {
          const bucket = zHist[dk];
          if (!Array.isArray(bucket)) continue;
          const entry = bucket.find(
            (e: any) => String(e?.["Акт"]) === String(actId),
          );
          if (entry) {
            entry["ДатаЗакриття"] = nowDateOnly;
            zModified = true;
            break;
          }
        }
        if (zModified) {
          zd["Історія"] = zHist;
          await supabase
            .from("slyusars")
            .update({ data: zd })
            .eq("slyusar_id", zRow.slyusar_id);
        }
      }
    }

    showNotification(
      "Акт закрито. Дату закриття та дані клієнта оновлено у ПІБ.",
      "success",
      1800,
    );
  } catch (e: any) {
    // console.error(e);
    showNotification(
      "Помилка при закритті акту: " + (e?.message || e),
      "error",
      2500,
    );
  }
}

export async function reopenActAndClearSlyusars(actId: number): Promise<void> {
  try {
    const { error: upErr } = await supabase
      .from("acts")
      .update({ date_off: null })
      .eq("act_id", actId);
    if (upErr)
      throw new Error("Не вдалося зняти дату закриття акту: " + upErr.message);

    const { date_on } = await fetchActDates(actId);
    const dateKey = toISODateOnly(date_on);
    if (!dateKey) return;

    const { clientInfo, carInfo } = await fetchActClientAndCarData(actId);

    const slyusarNames = collectCurrentWorkSlyusarsFromTable();
    for (const name of slyusarNames) {
      const row = await fetchSlyusarByName(name);
      if (!row) continue;
      const history = ensureSlyusarHistoryRoot(row);
      const dayBucket = (history[dateKey] as any[]) || [];
      const actEntry = dayBucket.find(
        (e: any) => String(e?.["Акт"]) === String(actId),
      );
      if (actEntry) {
        actEntry["ДатаЗакриття"] = null;
        actEntry["Клієнт"] = clientInfo;
        actEntry["Автомобіль"] = carInfo;

        if (actEntry["Записи"] && Array.isArray(actEntry["Записи"])) {
          actEntry["Записи"].forEach((zap: any) => {
            if (!("Зарплата" in zap)) {
              zap["Зарплата"] = 0;
            }
          });
        }

        await updateSlyusarJson(row);
      }
    }

    // --- Очищення ДатаЗакриття для Приймальника ---
    const { data: actDataForReopen } = await supabase
      .from("acts")
      .select("pruimalnyk")
      .eq("act_id", actId)
      .single();

    if (actDataForReopen?.pruimalnyk) {
      const pruimRow = await fetchSlyusarByName(actDataForReopen.pruimalnyk);
      if (pruimRow) {
        const pruimHistory = ensureSlyusarHistoryRoot(pruimRow);
        for (const dk of Object.keys(pruimHistory)) {
          const bucket = pruimHistory[dk];
          if (!Array.isArray(bucket)) continue;
          const entry = bucket.find(
            (e: any) => String(e?.["Акт"]) === String(actId),
          );
          if (entry) {
            entry["ДатаЗакриття"] = null;
            await updateSlyusarJson(pruimRow);
            break;
          }
        }
      }
    }

    // --- Очищення ДатаЗакриття для Запчастистів ---
    const { data: allZapchForReopen } = await supabase
      .from("slyusars")
      .select("slyusar_id, data");

    if (allZapchForReopen) {
      for (const zRow of allZapchForReopen) {
        const zd =
          typeof zRow.data === "string" ? JSON.parse(zRow.data) : zRow.data;
        if (!zd || zd["Доступ"] !== "Запчастист") continue;
        const zHist = zd["Історія"] || {};
        let zModified = false;
        for (const dk of Object.keys(zHist)) {
          const bucket = zHist[dk];
          if (!Array.isArray(bucket)) continue;
          const entry = bucket.find(
            (e: any) => String(e?.["Акт"]) === String(actId),
          );
          if (entry) {
            entry["ДатаЗакриття"] = null;
            zModified = true;
            break;
          }
        }
        if (zModified) {
          zd["Історія"] = zHist;
          await supabase
            .from("slyusars")
            .update({ data: zd })
            .eq("slyusar_id", zRow.slyusar_id);
        }
      }
    }

    showNotification(
      "Акт відкрито. Дату закриття очищено, дані клієнта оновлено у ПІБ.",
      "success",
      1800,
    );
  } catch (e: any) {
    // console.error(e);
    showNotification(
      "Помилка при відкритті акту: " + (e?.message || e),
      "error",
      2500,
    );
  }
}

/* =========================== ДОДАТКОВО: ЗБІР З DOM =========================== */

export function buildWorkRowsForSlyusarsFromDOM(): Array<{
  slyusarName: string;
  Найменування: string;
  Кількість: number;
  Ціна: number;
  Зарплата: number;
  recordId?: string; // ✅ Додано recordId для точного пошуку
}> {
  const out: Array<{
    slyusarName: string;
    Найменування: string;
    Кількість: number;
    Ціна: number;
    Зарплата: number;
    recordId?: string; // ✅ Додано recordId для точного пошуку
  }> = [];
  const rows = document.querySelectorAll(
    `#${ACT_ITEMS_TABLE_CONTAINER_ID} tbody tr`,
  );

  rows.forEach((row) => {
    const nameCell = row.querySelector('[data-name="name"]') as HTMLElement;
    if (!nameCell) return;
    const typeFromCell = nameCell.getAttribute("data-type");
    if (typeFromCell !== "works") return;

    const workName = cleanText(nameCell?.textContent);
    if (!workName) return;

    const qtyCell = row.querySelector('[data-name="id_count"]') as HTMLElement;
    const priceCell = row.querySelector('[data-name="price"]') as HTMLElement;
    const pibCell = row.querySelector(
      '[data-name="pib_magazin"]',
    ) as HTMLElement;
    const slyusarSumCell = row.querySelector(
      '[data-name="slyusar_sum"]',
    ) as HTMLElement;

    const qty = parseNum(qtyCell?.textContent);
    const price = parseNum(priceCell?.textContent);
    const slyusarName = cleanText(pibCell?.textContent);
    const zp = parseNum(slyusarSumCell?.textContent);

    // ✅ Зчитуємо recordId з атрибута рядка
    const recordId =
      (row as HTMLElement).getAttribute("data-record-id") || undefined;

    if (!slyusarName) return;
    out.push({
      slyusarName,
      Найменування: workName,
      Кількість: qty,
      Ціна: price,
      Зарплата: zp,
      recordId, // ✅ Передаємо recordId
    });
  });

  return out;
}
