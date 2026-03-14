import { globalCache, ensureSkladLoaded } from "../globalCache";
import { loadPercentByWarehouse } from "./kastomna_tabluca";
import { supabase } from "../../../vxid/supabaseClient";
import { updateCalculatedSumsInFooter } from "../modalUI";
import { userAccessLevel } from "../../tablucya/users";

// Cache for current act data
let currentActDataCache: any = null;
let autoRefreshInterval: any = null;

// Cache for name cell lengths and clearing state
const nameLengthCache = new WeakMap<HTMLElement, number>();
const nameClearedOnce = new WeakMap<HTMLElement, boolean>();

/* ===================== UI STYLES ===================== */
function ensureWarningStyles() {
  if (document.getElementById("warn-badge-styles")) return;
  const css = `
    .qty-cell, .price-cell, .slyusar-sum-cell { position: relative; }
    
    .qty-cell[data-warn="1"]::before,
    .price-cell[data-warnprice="1"]::before,
    .slyusar-sum-cell[data-warnzp="1"]::before {
      content: "!";
      position: absolute;
      top: 50%;
      left: 4px;
      transform: translateY(-50%);
      width: 16px; height: 16px; line-height: 16px; text-align: center;
      font-size: 10px; font-weight: 800;
      color: #fff; background: #ff9800;
      clip-path: polygon(50% 0%, 0% 100%, 100% 100%);
      border-radius: 2px; pointer-events: none; user-select: none;
      z-index: 10;
    }
    
    .qty-cell[data-warn="1"],
    .price-cell[data-warnprice="1"],
    .slyusar-sum-cell[data-warnzp="1"] {
      background-color: #fff3e0 !important;
      border: 1px solid #ff9800 !important;
      padding-left: 24px !important;
    }
  `;
  const tag = document.createElement("style");
  tag.id = "warn-badge-styles";
  tag.textContent = css;
  document.head.appendChild(tag);
}

function ensureCellClass(
  cell: HTMLElement,
  cls: "qty-cell" | "price-cell" | "slyusar-sum-cell",
) {
  if (!cell.classList.contains(cls)) cell.classList.add(cls);
}

/* ===================== WARNING FLAG SETTERS ===================== */
export function setWarningFlag(cell: HTMLElement | null, on: boolean) {
  if (!cell) return;
  ensureWarningStyles();
  ensureCellClass(cell, "qty-cell");
  if (on) cell.setAttribute("data-warn", "1");
  else cell.removeAttribute("data-warn");
}

export function setPriceWarningFlag(cell: HTMLElement | null, on: boolean) {
  if (!cell) return;
  ensureWarningStyles();
  ensureCellClass(cell, "price-cell");
  if (on) cell.setAttribute("data-warnprice", "1");
  else cell.removeAttribute("data-warnprice");
}

export function setSlyusarSumWarningFlag(
  cell: HTMLElement | null,
  on: boolean,
) {
  if (!cell) return;
  ensureWarningStyles();
  ensureCellClass(cell, "slyusar-sum-cell");
  if (on) cell.setAttribute("data-warnzp", "1");
  else cell.removeAttribute("data-warnzp");
}

/* ===================== UTILITY FUNCTIONS ===================== */
function formatUA(n: number): string {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 3 }).format(n);
}

function parseNumFromNode(node: HTMLElement | null): number {
  if (!node) return 0;
  const raw = (node as HTMLInputElement).value ?? node.textContent ?? "";
  const val = parseFloat(raw.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(val) ? val : 0;
}

function getNodeTextLen(el: HTMLElement): number {
  return (el.textContent ?? "").replace(/\u00A0/g, " ").replace(/\u200B/g, "")
    .length;
}

/* ===================== ACT DATA CACHE ===================== */
async function loadCurrentActData(): Promise<any> {
  if (!globalCache.currentActId) {
    currentActDataCache = null;
    return null;
  }
  try {
    const { data, error } = await supabase
      .from("acts")
      .select("data")
      .eq("act_id", globalCache.currentActId)
      .single();

    if (error) {
      // console.error("Помилка завантаження даних акту:", error);
      currentActDataCache = null;
      return null;
    }
    currentActDataCache = data?.data || null;
    return currentActDataCache;
  } catch (err) {
    // console.error("Помилка завантаження даних акту:", err);
    currentActDataCache = null;
    return null;
  }
}

export function resetActDataCache(): void {
  currentActDataCache = null;
}

export async function refreshActDataCache(): Promise<void> {
  currentActDataCache = null;
  await loadCurrentActData();
}

async function getCurrentActDetailQty(sclad_id: number): Promise<number> {
  await loadCurrentActData();
  if (!currentActDataCache || !currentActDataCache.Деталі) return 0;

  const detail = currentActDataCache.Деталі.find(
    (d: any) => Number(d.sclad_id) === Number(sclad_id),
  );

  const qtyRaw = detail ? detail.Кількість : 0;
  return typeof qtyRaw === "number"
    ? qtyRaw
    : parseFloat(String(qtyRaw).replace(/\s/g, "").replace(",", ".")) || 0;
}

/* ===================== CORE CHECKS ===================== */
export async function updateCatalogWarningForRow(row: HTMLElement) {
  if (globalCache.isActClosed) {
    const qtyCell = row.querySelector(
      '[data-name="id_count"]',
    ) as HTMLElement | null;
    if (qtyCell) {
      setWarningFlag(qtyCell, false);
      qtyCell.removeAttribute("title");
    }
    return;
  }

  await ensureSkladLoaded();
  const qtyCell = row.querySelector(
    '[data-name="id_count"]',
  ) as HTMLElement | null;
  if (!qtyCell) return;

  const catalogCell = row.querySelector(
    '[data-name="catalog"]',
  ) as HTMLElement | null;
  const sclad_id = catalogCell?.getAttribute("data-sclad-id")
    ? Number(catalogCell.getAttribute("data-sclad-id"))
    : null;

  if (!sclad_id) {
    setWarningFlag(qtyCell, false);
    qtyCell.removeAttribute("title");
    return;
  }

  const picked = globalCache.skladParts.find(
    (p) => Number(p.sclad_id) === sclad_id,
  );
  if (!picked) {
    setWarningFlag(qtyCell, false);
    qtyCell.removeAttribute("title");
    return;
  }

  const inputNumber = parseNumFromNode(qtyCell);
  const actsOsnova = await getCurrentActDetailQty(sclad_id);
  const delta_1 = inputNumber - actsOsnova;
  const scladOsnova = Number(picked.kilkist_off ?? 0);
  const delta_2 = scladOsnova + delta_1;
  const scladOn = Number(picked.kilkist_on ?? 0);
  const alarmOsnova = scladOn - delta_2;
  const warn = alarmOsnova < 0;

  setWarningFlag(qtyCell, warn);
  if (warn) {
    const needMore = Math.abs(alarmOsnova);
    qtyCell.title =
      `Не вистачає ${formatUA(needMore)} ${picked.unit ?? ""}`.trim();
  } else {
    qtyCell.removeAttribute("title");
  }
}

export async function updatePriceWarningForRow(row: HTMLElement) {
  if (globalCache.isActClosed) {
    const priceCell = row.querySelector(
      '[data-name="price"]',
    ) as HTMLElement | null;
    if (priceCell) {
      setPriceWarningFlag(priceCell, false);
      priceCell.removeAttribute("title");
      priceCell.style.backgroundColor = "";
    }
    return;
  }

  const priceCell = row.querySelector(
    '[data-name="price"]',
  ) as HTMLElement | null;
  const catalogCell = row.querySelector(
    '[data-name="catalog"]',
  ) as HTMLElement | null;
  if (!priceCell) return;

  const sclad_id = catalogCell?.getAttribute("data-sclad-id")
    ? Number(catalogCell.getAttribute("data-sclad-id"))
    : null;
  if (!sclad_id) {
    setPriceWarningFlag(priceCell, false);
    priceCell.removeAttribute("title");
    priceCell.style.backgroundColor = "";
    return;
  }

  const picked = globalCache.skladParts.find(
    (p) => Number(p.sclad_id) === sclad_id,
  );
  if (!picked) {
    setPriceWarningFlag(priceCell, false);
    priceCell.removeAttribute("title");
    priceCell.style.backgroundColor = "";
    return;
  }

  // ✅ ВИПРАВЛЕНО: Спочатку беремо scladNomer з атрибуту DOM, потім з кешу, потім з бази
  const scladNomerAttr = catalogCell?.getAttribute("data-sclad-nomer");
  let scladNomer: number | null | undefined = scladNomerAttr
    ? Number(scladNomerAttr)
    : picked.scladNomer;

  // ✅ Fallback: якщо scladNomer відсутній - отримуємо напряму з бази по sclad_id
  if (scladNomer === null || scladNomer === undefined || scladNomer === 0) {
    try {
      const { data: scladData } = await supabase
        .from("sclad")
        .select('"scladNomer"')
        .eq("sclad_id", sclad_id)
        .single();
      if (scladData && scladData.scladNomer) {
        scladNomer = Number(scladData.scladNomer);
        // Зберігаємо в атрибут для наступних перевірок
        if (catalogCell && scladNomer > 0) {
          catalogCell.setAttribute("data-sclad-nomer", String(scladNomer));
        }
      }
    } catch (e) {
      // Ігноруємо помилку запиту
    }
  }

  const percentInfo = await loadPercentByWarehouse(scladNomer);
  const enteredPrice = parseNumFromNode(priceCell);
  const basePrice = Math.round(Number(picked.price) || 0);
  const minPrice = Math.ceil(basePrice * (1 + percentInfo.percent / 100));

  // ✅ СТИЛІЗАЦІЯ ПО СТАТУСУ СКЛАДУ
  if (percentInfo.status === "blocked") {
    // Склад заблокований — червоний фон
    setPriceWarningFlag(priceCell, false);
    priceCell.style.backgroundColor = "#ffcdd2";
    priceCell.title = `⛔ Склад ${scladNomer || 1} заблокований! Вхідна ціна: ${formatUA(basePrice)} грн`;
  } else if (percentInfo.status === "missing") {
    // Склад відсутній — синій фон
    setPriceWarningFlag(priceCell, false);
    priceCell.style.backgroundColor = "#bbdefb";
    priceCell.title = `⚠️ Склад ${scladNomer || "?"} відсутній, націнка 0%. Вхідна ціна: ${formatUA(basePrice)} грн`;
  } else {
    // Нормальний склад — перевіряємо ціну
    priceCell.style.backgroundColor = "";
    const warn = enteredPrice > 0 && enteredPrice < minPrice;
    setPriceWarningFlag(priceCell, warn);
    if (warn)
      priceCell.title = `Мін. ціна: ${formatUA(minPrice)} грн (вхідна ${formatUA(basePrice)} + ${percentInfo.percent}%)`;
    else priceCell.removeAttribute("title");
  }
}

export async function updateSlyusarSumWarningForRow(row: HTMLElement) {
  // ✅ Слюсар не бачить колонку "Сума", тому не показуємо йому попередження про зарплату
  if (userAccessLevel === "Слюсар") {
    const slyusarSumCell = row.querySelector(
      '[data-name="slyusar_sum"]',
    ) as HTMLElement | null;
    if (slyusarSumCell) {
      setSlyusarSumWarningFlag(slyusarSumCell, false);
      slyusarSumCell.removeAttribute("title");
    }
    return;
  }

  if (globalCache.isActClosed) {
    const sumCell = row.querySelector(
      '[data-name="slyusar_sum"]',
    ) as HTMLElement | null;
    if (sumCell) {
      setSlyusarSumWarningFlag(sumCell, false);
      sumCell.removeAttribute("title");
    }
    return;
  }

  const nameCell = row.querySelector(
    '[data-name="name"]',
  ) as HTMLElement | null;
  const sumCell = row.querySelector('[data-name="sum"]') as HTMLElement | null;
  const slyusarSumCell = row.querySelector(
    '[data-name="slyusar_sum"]',
  ) as HTMLElement | null;

  if (!slyusarSumCell || !sumCell) return;

  const typeFromCell = nameCell?.getAttribute("data-type");
  if (typeFromCell !== "works") {
    setSlyusarSumWarningFlag(slyusarSumCell, false);
    slyusarSumCell.removeAttribute("title");
    return;
  }

  const sum = parseNumFromNode(sumCell);
  const slyusarSum = parseNumFromNode(slyusarSumCell);
  const warn = slyusarSum > sum;

  setSlyusarSumWarningFlag(slyusarSumCell, warn);
  if (warn) {
    slyusarSumCell.title = `Зарплата (${formatUA(slyusarSum)}) не може бути більша за суму (${formatUA(sum)})`;
  } else {
    slyusarSumCell.removeAttribute("title");
  }
}

/* ===================== CLEAR CELLS ON NAME CHANGE ===================== */
async function clearCellsOnNameChange(
  row: HTMLElement,
  prevNameLength: number,
  currentNameLength: number,
) {
  if (currentNameLength >= prevNameLength) return;

  // Визначаємо тип рядка (works = робота, інше = запчастина)
  const nameCell = row.querySelector(
    '[data-name="name"]',
  ) as HTMLElement | null;
  const rowType = nameCell?.getAttribute("data-type") || "";
  const nameText = nameCell?.textContent?.trim() || "";

  // Перевіряємо чи це робота: або за data-type, або за наявністю в списку робіт
  const isWork = rowType === "works" || globalCache.works.includes(nameText);

  // Для робіт очищаємо тільки каталог, для запчастин - все як раніше
  const cellsToClear = isWork
    ? ['[data-name="catalog"]']
    : [
        '[data-name="catalog"]',
        '[data-name="id_count"]',
        '[data-name="price"]',
        '[data-name="sum"]',
        '[data-name="slyusar_sum"]',
        '[data-name="pib_magazin"]',
      ];

  for (const selector of cellsToClear) {
    const cell = row.querySelector(selector) as HTMLElement | null;
    if (!cell) continue;
    cell.textContent = "";
    cell.removeAttribute("data-sclad-id");
    cell.removeAttribute("data-type");
    cell.removeAttribute("title");
    if (selector === '[data-name="id_count"]') setWarningFlag(cell, false);
    if (selector === '[data-name="price"]') setPriceWarningFlag(cell, false);
    if (selector === '[data-name="slyusar_sum"]')
      setSlyusarSumWarningFlag(cell, false);
  }

  updateCalculatedSumsInFooter();
  await updateCatalogWarningForRow(row);
  await updatePriceWarningForRow(row);
  await updateSlyusarSumWarningForRow(row);
}

/* ===================== MASS REFRESH ===================== */
export async function refreshQtyWarningsIn(containerId: string) {
  ensureWarningStyles();
  if (globalCache.isActClosed) return;

  await ensureSkladLoaded();
  await refreshActDataCache();

  const container = document.getElementById(containerId);
  if (!container) return;

  const rows = Array.from(
    container.querySelectorAll<HTMLTableRowElement>("tbody tr"),
  );
  for (const tr of rows) {
    const row = tr as HTMLElement;
    await Promise.all([
      updateCatalogWarningForRow(row),
      updatePriceWarningForRow(row),
      updateSlyusarSumWarningForRow(row),
    ]);
  }
  updateCalculatedSumsInFooter();
}

/* ===================== LISTENERS ===================== */
export function setupQtyWarningListeners(containerId: string) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Initialize cache for name cells
  container
    .querySelectorAll<HTMLElement>('tbody tr [data-name="name"]')
    .forEach((cell) => {
      nameLengthCache.set(cell, getNodeTextLen(cell));
      nameClearedOnce.set(cell, false);
    });

  const onKeyDownName = (e: KeyboardEvent) => {
    const cell = (e.target as HTMLElement)?.closest(
      '[data-name="name"]',
    ) as HTMLElement | null;
    if (!cell || (e.key !== "Backspace" && e.key !== "Delete")) return;

    const prev = nameLengthCache.get(cell) ?? 0;
    setTimeout(async () => {
      const cur = getNodeTextLen(cell);
      if (cur < prev && !nameClearedOnce.get(cell)) {
        const row = cell.closest("tr") as HTMLElement | null;
        if (row) {
          await clearCellsOnNameChange(row, prev, cur);
          nameClearedOnce.set(cell, true);
        }
      }
      nameLengthCache.set(cell, cur);
      if (cur > prev) nameClearedOnce.set(cell, false);
    }, 0);
  };

  const onInputName = async (e: Event) => {
    const cell = (e.target as HTMLElement)?.closest(
      '[data-name="name"]',
    ) as HTMLElement | null;
    if (!cell) return;
    const row = cell.closest("tr") as HTMLElement | null;
    if (!row) return;

    const prev = nameLengthCache.get(cell) ?? 0;
    const cur = getNodeTextLen(cell);
    if (cur < prev && !nameClearedOnce.get(cell)) {
      await clearCellsOnNameChange(row, prev, cur);
      nameClearedOnce.set(cell, true);
    }
    if (cur > prev) nameClearedOnce.set(cell, false);
    nameLengthCache.set(cell, cur);
  };

  const onInput = async (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const row = target.closest("tr") as HTMLElement | null;
    if (!row) return;

    const cell = target.closest('[data-name="id_count"]') as HTMLElement | null;
    if (cell) await updateCatalogWarningForRow(row);

    const priceCell = target.closest(
      '[data-name="price"]',
    ) as HTMLElement | null;
    if (priceCell) await updatePriceWarningForRow(row);

    const slyusarSumCell = target.closest(
      '[data-name="slyusar_sum"]',
    ) as HTMLElement | null;
    if (slyusarSumCell) await updateSlyusarSumWarningForRow(row);

    if (cell || priceCell || slyusarSumCell) updateCalculatedSumsInFooter();
  };

  const onBlur = async (e: Event) => {
    const cell = (e.target as HTMLElement)?.closest(
      '[data-name="id_count"]',
    ) as HTMLElement | null;
    if (!cell) return;
    const row = cell.closest("tr") as HTMLElement | null;
    if (row) await updateCatalogWarningForRow(row);
  };

  const onPointerDownPreCommit = async (e: Event) => {
    const active = (document.activeElement as HTMLElement | null)?.closest(
      '[data-name="id_count"]',
    ) as HTMLElement | null;
    if (!active) return;
    const clickTarget = e.target as Node;
    if (!active.contains(clickTarget)) {
      const row = active.closest("tr") as HTMLElement | null;
      if (row) await updateCatalogWarningForRow(row);
    }
  };

  const onKeyDownPreCommit = async (e: KeyboardEvent) => {
    if (!["Enter", "Tab", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    const active = (document.activeElement as HTMLElement | null)?.closest(
      '[data-name="id_count"]',
    ) as HTMLElement | null;
    if (active) {
      const row = active.closest("tr") as HTMLElement | null;
      if (row) await updateCatalogWarningForRow(row);
    }
  };

  container.addEventListener("keydown", onKeyDownName, { capture: true });
  container.addEventListener("input", onInputName, { capture: true });
  container.addEventListener("input", onInput, { capture: true });
  container.addEventListener("blur", onBlur, true);
  container.addEventListener("pointerdown", onPointerDownPreCommit, {
    capture: true,
  });
  container.addEventListener("keydown", onKeyDownPreCommit, { capture: true });
}

/* ===================== INIT / SAVE HOOK / AUTO REFRESH ===================== */
export function initializeActWarnings(
  containerId: string,
  actId: number,
  enableAutoRefresh = false,
) {
  globalCache.currentActId = actId;
  resetActDataCache();
  setupQtyWarningListeners(containerId);
  if (enableAutoRefresh) startAutoRefresh(containerId);
}

export async function onActSaved(containerId: string) {
  resetActDataCache();
  await loadCurrentActData();
  await refreshQtyWarningsIn(containerId);
}

export function startAutoRefresh(containerId: string) {
  stopAutoRefresh();
  autoRefreshInterval = setInterval(async () => {
    await refreshQtyWarningsIn(containerId);
  }, 2000);
}

export function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}
