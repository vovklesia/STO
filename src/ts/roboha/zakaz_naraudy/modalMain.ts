// src\ts\roboha\zakaz_naraudy\modalMain.ts
import { cacheHiddenColumnsData } from "./inhi/zberechennya_zmin_y_danux_aktu";
import { supabase } from "../../vxid/supabaseClient";
import { showNotification } from "./inhi/vspluvauhe_povidomlenna";
import { subscribeToActPresence, lockActInterface } from "./actPresence";
import {
  refreshPhotoData,
  safeParseJSON,
} from "./inhi/ctvorennia_papku_googleDrive.";
import { initPhoneClickHandler } from "./inhi/telefonna_pidskazka";
import {
  setupAutocompleteForEditableCells,
  refreshQtyWarningsIn,
  initializeActWarnings,
} from "./inhi/kastomna_tabluca";
import {
  createViknoPidtverdchennayZakruttiaAkty,
  viknoPidtverdchennayZakruttiaAktyId,
} from "./inhi/vikno_pidtverdchennay_zakruttia_akty";
import {
  createViknoVvodyParolu,
  viknoVvodyParoluId,
} from "./inhi/vikno_vvody_parolu";
import { printModalToPdf } from "./inhi/ctvorenyaPDF";
import {
  globalCache,
  loadGlobalData,
  ZAKAZ_NARAYD_MODAL_ID,
  ZAKAZ_NARAYD_BODY_ID,
  EDITABLE_PROBIG_ID,
  EDITABLE_REASON_ID,
  ACT_ITEMS_TABLE_CONTAINER_ID,
  formatNumberWithSpaces,
  EDITABLE_RECOMMENDATIONS_ID,
  EDITABLE_NOTES_ID,
} from "./globalCache";
import {
  createModal,
  calculateRowSum,
  addNewRow,
  generateTableHTML,
  createTableRow,
  updateCalculatedSumsInFooter,
  updateAllSlyusarSumsFromHistory,
  getSlyusarWorkPercent,
  calculateSlyusarSum,
  getRecordIdFromHistory, // ✅ Додано для завантаження recordId з історії
  forceRecalculateSlyusarSalary, // ✅ Додано для примусового перерахунку при зміні слюсаря
  getSkeletonLoaderHTML, // ⚡ Skeleton loader для швидкого відкриття
} from "./modalUI";
import { showModalAllOtherBases } from "../dodatu_inchi_bazu/dodatu_inchi_bazu_danux";
import { formatDate, formatDateTime } from "./inhi/formatuvannya_datu";
import { addSaveHandler } from "./inhi/zberechennya_zmin_y_danux_aktu";
import {
  userAccessLevel,
  userName as currentUserName,
  canUserOpenActs,
  canUserSeeZarplataColumn,
  canUserSeePriceColumns,
} from "../tablucya/users";

import {
  createModalActRaxunok,
  initModalActRaxunokHandlers,
  initCreateActRaxunokButton,
  MODAL_ACT_RAXUNOK_ID,
} from "./inhi/faktura"; // <--- НОВИЙ ФАЙЛ

import { checkAndHighlightChanges } from "./inhi/act_changes_highlighter";
import { removeNotificationsForAct } from "../tablucya/povidomlennya_tablucya";
import { initVoiceInput } from "../ai/voiceInput";
import { handleSmsButtonClick } from "../sms/sendActSMS";
import {
  refreshActsTable,
  getActEditorFromPresence,
} from "../tablucya/tablucya";

function initDeleteRowHandler(): void {
  const body = document.getElementById(ZAKAZ_NARAYD_BODY_ID);
  if (!body) return;

  body.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    if (
      target.classList.contains("delete-row-btn") ||
      target.textContent === "🗑️"
    ) {
      e.preventDefault();
      e.stopPropagation();

      if (globalCache.isActClosed) {
        showNotification(
          "Неможливо видалити рядок у закритому акті",
          "warning",
          1000,
        );
        return;
      }

      const row = target.closest("tr");
      if (row) {
        row.remove();

        const tableBody = document.querySelector(
          `#${ACT_ITEMS_TABLE_CONTAINER_ID} tbody`,
        );
        if (tableBody) {
          const rows = Array.from(tableBody.querySelectorAll("tr"));
          rows.forEach((r, idx) => {
            const indexCell = r.querySelector(".row-index");
            if (indexCell) {
              const nameCell = r.querySelector(
                '[data-name="name"]',
              ) as HTMLElement;
              const type = nameCell?.getAttribute("data-type");
              let icon = "";
              if (type === "works") icon = "🛠️";
              else if (type === "details") icon = "⚙️";

              indexCell.textContent = `${icon} ${idx + 1}`.trim();
            }
          });
        }

        updateCalculatedSumsInFooter();
        showNotification("Рядок видалено", "success", 1000);
      }
    }
  });
}

const handleIndexIconClick = async (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  const indexCell = target.closest(".row-index") as HTMLElement;

  if (indexCell) {
    const row = indexCell.closest("tr") as HTMLTableRowElement;
    if (!row) return;

    const nameCell = row.querySelector('[data-name="name"]');
    const catalogCell = row.querySelector(".catalog-cell");

    if (!nameCell || !catalogCell) return;

    const workName = nameCell.textContent?.trim() || "";
    const catalogValue = catalogCell.textContent?.trim() || "";
    const type = nameCell.getAttribute("data-type");

    // Логіка працює тільки якщо каталог пустий (немає в базі)
    if (catalogValue !== "") return;

    // Функція запуску логіки "Запчастина" (відкриття модалки складу)
    const runPartLogic = () => {
      // Змінюємо тип рядка на деталі, якщо він ще не такий
      if (type !== "details") {
        nameCell.setAttribute("data-type", "details");
        // Оновлюємо іконку
        if (indexCell.firstChild) {
          indexCell.innerHTML = indexCell.innerHTML.replace("🛠️", "⚙️");
        }
      }

      showModalAllOtherBases();

      // Чекаємо поки відкриється модалка і заповнюємо дані
      setTimeout(() => {
        // 1. Натискаємо кнопку "Склад"
        const buttons = document.querySelectorAll(
          ".toggle-button-all_other_bases",
        );
        buttons.forEach((btn) => {
          if (btn.textContent?.includes("Склад")) {
            (btn as HTMLElement).click();
          }
        });

        // 2. Заповнюємо інпути
        const scladDetailInput = document.getElementById(
          "sclad_detail",
        ) as HTMLInputElement;
        const scladDateInput = document.getElementById(
          "sclad_date",
        ) as HTMLInputElement;

        if (scladDetailInput) {
          scladDetailInput.value = workName;
          scladDetailInput.dispatchEvent(new Event("input"));
        }
        if (scladDateInput) {
          const today = new Date().toISOString().split("T")[0];
          scladDateInput.value = today;
          scladDateInput.dispatchEvent(new Event("input"));
        }
      }, 300);

      // Слухаємо подію оновлення бази (коли юзер збереже деталь)
      const onDataUpdated = async () => {
        try {
          const { data: details } = await supabase
            .from("details")
            .select("detail_id, data")
            .order("detail_id", { ascending: false })
            .limit(5);

          if (details) {
            const match = details.find((d) => d.data === workName);
            if (match) {
              if (catalogCell) {
                catalogCell.textContent = String(match.detail_id);
                catalogCell.dispatchEvent(
                  new Event("input", { bubbles: true }),
                );
                showNotification("Catalog оновлено автоматично!", "success");
              }
            }
          }
        } catch (err) {
          // console.error("Error auto-updating catalog:", err);
        }
        document.removeEventListener("other-base-data-updated", onDataUpdated);
      };
      document.addEventListener("other-base-data-updated", onDataUpdated);
    };

    // Функція запуску логіки "Робота" (збереження в works)
    const runWorkLogic = async () => {
      try {
        // Змінюємо тип рядка на works, якщо він ще не такий
        if (type !== "works") {
          nameCell.setAttribute("data-type", "works");
          if (indexCell.firstChild) {
            indexCell.innerHTML = indexCell.innerHTML.replace("⚙️", "🛠️");
          }
        }

        // ✅ ВИПРАВЛЕНО: Перевіряємо чи така робота вже існує в БД
        const { data: existingWork, error: searchError } = await supabase
          .from("works")
          .select("work_id")
          .eq("data", workName)
          .limit(1)
          .maybeSingle();

        if (searchError) {
          // console.error("Помилка пошуку роботи:", searchError);
        }

        // Якщо робота вже існує - використовуємо її work_id
        if (existingWork && existingWork.work_id) {
          catalogCell.textContent = String(existingWork.work_id);
          catalogCell.dispatchEvent(new Event("input", { bubbles: true }));
          if (indexCell) indexCell.style.cursor = "";
          showNotification(
            `Робота вже існує в базі (ID: ${existingWork.work_id})`,
            "info",
          );
          return;
        }

        // Отримуємо наступний ID
        const { data: maxIdData, error: idError } = await supabase
          .from("works")
          .select("work_id")
          .order("work_id", { ascending: false })
          .limit(1)
          .single();

        let nextId = 1;
        if (!idError && maxIdData) {
          nextId = Number(maxIdData.work_id) + 1;
        }

        const { data, error } = await supabase
          .from("works")
          .insert({ work_id: nextId, data: workName })
          .select("work_id")
          .single();

        if (error) throw error;

        if (data && data.work_id) {
          catalogCell.textContent = String(data.work_id);
          catalogCell.dispatchEvent(new Event("input", { bubbles: true }));
          if (indexCell) indexCell.style.cursor = "";
        }

        showNotification("Роботу успішно збережено в базу даних!", "success");
      } catch (err: any) {
        // console.error("Error saving work:", err);
        showNotification(
          "Помилка при збереженні роботи: " + err.message,
          "error",
        );
      }
    };
    if (indexCell.textContent?.includes("🛠️")) {
      e.preventDefault();
      e.stopPropagation();

      const role = userAccessLevel;

      if (role === "Слюсар") {
        // Слюсарю завжди дозволено тільки Роботу, без модалки
        runWorkLogic();
        return;
      }

      let allowed = false;

      if (role === "Адміністратор") {
        allowed = true;
      } else if (role === "Приймальник") {
        // setting_id = 2, col = "Приймальник"
        allowed = await getRoleSettingBool(2, "Приймальник");
      } else if (role === "Запчастист") {
        // setting_id = 1, col = "Запчастист"
        allowed = await getRoleSettingBool(1, "Запчастист");
      } else if (role === "Складовщик") {
        // setting_id = 1, col = "Складовщик"
        allowed = await getRoleSettingBool(1, "Складовщик");
      } else {
        // Інші ролі за замовчуванням
        allowed = false;
      }

      if (allowed) {
        createChoiceModal(
          () => runWorkLogic(), // On Work
          () => runPartLogic(), // On Part
          () => { }, // On Cancel
        );
      } else {
        // showNotification("Функція недоступна", "warning"); // Опціонально можна розкоментувати
      }
    }
    // ⚙️ ДЛЯ ДЕТАЛЕЙ при кліку на ⚙️ -> Пряма дія
    else if (indexCell.textContent?.includes("⚙️")) {
      e.preventDefault();
      e.stopPropagation();
      runPartLogic();
    }
  }
};

function initIndexIconHandler(): void {
  const body = document.getElementById(ZAKAZ_NARAYD_BODY_ID);
  if (!body) return;

  // Видаляємо попередній слухач, щоб уникнути дублювання
  body.removeEventListener("click", handleIndexIconClick);
  // Додаємо новий
  body.addEventListener("click", handleIndexIconClick);
}

function createChoiceModal(
  onWork: () => void,
  onPart: () => void,
  onCancel: () => void,
): void {
  const styleId = "choice-modal-styles";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .custom-choice-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100000;
        font-family: 'Roboto', sans-serif;
      }
      .custom-choice-modal {
        background: #fff;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        text-align: center;
        max-width: 400px;
        width: 90%;
        color: #333;
      }
      .custom-choice-title {
        font-size: 18px;
        margin-bottom: 20px;
        font-weight: 500;
        color: #333;
      }
      .custom-choice-buttons {
        display: flex;
        gap: 15px;
        justify-content: center;
      }
      .custom-btn {
        border: none;
        padding: 10px 20px;
        border-radius: 4px;
        font-size: 14px;
        cursor: pointer;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: background 0.2s;
      }
      .btn-part {
        background: #2196F3;
        color: white;
      }
      .btn-part:hover {
        background: #1976D2;
      }
      .btn-work {
        background: #FF9800;
        color: white;
      }
      .btn-work:hover {
        background: #F57C00;
      }
      .btn-cancel-x {
        position: absolute;
        top: 10px;
        right: 15px;
        background: transparent;
        border: none;
        font-size: 20px;
        color: #999;
        cursor: pointer;
      }
      .btn-cancel-x:hover {
        color: #333;
      }
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement("div");
  overlay.className = "custom-choice-overlay";

  const modal = document.createElement("div");
  modal.className = "custom-choice-modal";
  modal.style.position = "relative";

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn-cancel-x";
  closeBtn.innerHTML = "&times;";
  closeBtn.onclick = () => {
    document.body.removeChild(overlay);
    onCancel();
  };
  modal.appendChild(closeBtn);

  const title = document.createElement("h3");
  title.textContent = "Записати дані в базу даних?";
  title.className = "custom-choice-title";
  modal.appendChild(title);

  const buttonsDiv = document.createElement("div");
  buttonsDiv.className = "custom-choice-buttons";

  const btnPart = document.createElement("button");
  btnPart.className = "custom-btn btn-part";
  btnPart.innerHTML = "⚙️ Запчастини";
  btnPart.onclick = () => {
    document.body.removeChild(overlay);
    onPart();
  };

  const btnWork = document.createElement("button");
  btnWork.className = "custom-btn btn-work";
  btnWork.innerHTML = "🛠️ Робота";
  btnWork.onclick = () => {
    document.body.removeChild(overlay);
    onWork();
  };

  buttonsDiv.appendChild(btnPart);
  buttonsDiv.appendChild(btnWork);
  modal.appendChild(buttonsDiv);
  overlay.appendChild(modal);

  // Close on outside click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      document.body.removeChild(overlay);
      onCancel();
    }
  });

  document.body.appendChild(overlay);
}

/**
 * Допоміжна функція: читає boolean-настройку з таблиці settings
 * для конкретного рядка (setting_id) та колонки (назви ролі).
 * Якщо щось пішло не так — ПОВЕРТАЄ true (нічого не ховаємо).
 */
async function getRoleSettingBool(
  settingId: number,
  columnName: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("settings")
      .select(columnName)
      .eq("setting_id", settingId)
      .maybeSingle();

    if (error) {
      // console.error(
      // `Помилка читання settings (setting_id=${settingId}, col=${columnName}):`,
      // error,
      // );
      return true;
    }

    if (!data) {
      // console.warn(
      // `settings: не знайдено рядок setting_id=${settingId} для колонки ${columnName}`,
      // );
      return true;
    }

    const safeData: Record<string, unknown> = (data ?? {}) as unknown as Record<
      string,
      unknown
    >;
    const value = safeData[columnName];

    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;
    if (typeof value === "string") {
      const v = value.trim().toLowerCase();
      if (["true", "1", "yes", "y"].includes(v)) return true;
      if (["false", "0", "no", "n"].includes(v)) return false;
    }

    return true;
  } catch (e) {
    // console.error(
    // `Виняток при читанні settings (setting_id=${settingId}, col=${columnName}):`,
    // e,
    // );
    return true;
  }
}

/**
 * ⚡ ОПТИМІЗАЦІЯ: Завантажує всі permission-налаштування для модалки ОДНИМ запитом
 * Замість 5+ окремих запитів до таблиці settings
 */
interface ModalPermissions {
  canShowLockButton: boolean;
  canShowCreateActBtn: boolean;
  canShowPrintActBtn: boolean;
  canShowAddRowBtn: boolean;
  canShowSmsBtn: boolean;
}

async function loadAllModalPermissions(): Promise<ModalPermissions> {
  const role = userAccessLevel;

  // Якщо роль невизначена або Адміністратор - все дозволено
  if (!role || role === "Адміністратор") {
    return {
      canShowLockButton: true,
      canShowCreateActBtn: true,
      canShowPrintActBtn: true,
      canShowAddRowBtn: true,
      canShowSmsBtn: true,
    };
  }

  // Слюсар має особливі правила - SMS завжди приховано
  if (role === "Слюсар") {
    // Завантажуємо тільки потрібні settings для Слюсаря
    const { data, error } = await supabase
      .from("settings")
      .select('setting_id, data, "Слюсар"')
      .in("setting_id", [3, 4]);

    if (error || !data) {
      return {
        canShowLockButton: true,
        canShowCreateActBtn: true,
        canShowPrintActBtn: true,
        canShowAddRowBtn: true,
        canShowSmsBtn: false, // Слюсар завжди не бачить SMS
      };
    }

    const setting3 = data.find((s) => s.setting_id === 3);
    const setting4 = data.find((s) => s.setting_id === 4);

    return {
      canShowLockButton: parseBoolValue(setting3?.["Слюсар"]),
      canShowCreateActBtn: true,
      canShowPrintActBtn: true,
      canShowAddRowBtn: parseBoolValue(setting4?.["Слюсар"]),
      canShowSmsBtn: false, // Слюсар завжди не бачить SMS
    };
  }

  // Визначаємо потрібні setting_id для ролі
  const settingIds = getSettingIdsForRole(role);
  const columnName = role;

  try {
    // Один запит для всіх потрібних settings
    const { data, error } = await supabase
      .from("settings")
      .select(`setting_id, data, "${columnName}"`)
      .in("setting_id", settingIds);

    if (error || !data) {
      // console.error("Помилка завантаження permissions:", error);
      return getDefaultPermissions();
    }

    // Створюємо мапу setting_id -> значення
    const settingsMap = new Map<number, unknown>();
    for (const row of data) {
      const value =
        (row as Record<string, unknown>)[columnName] ??
        (row as Record<string, unknown>).data;
      settingsMap.set(row.setting_id, value);
    }

    return buildPermissionsForRole(role, settingsMap);
  } catch (e) {
    // console.error("Виняток при завантаженні permissions:", e);
    return getDefaultPermissions();
  }
}

function getSettingIdsForRole(role: string): number[] {
  switch (role) {
    case "Приймальник":
      return [4, 18, 19, 20]; // addRow, createAct, printAct, sms
    case "Запчастист":
      return [4, 16, 19, 20, 21]; // addRow, lock, createAct, printAct, sms
    case "Складовщик":
      return [4, 13, 16, 17, 18]; // addRow, lock, createAct, printAct, sms
    default:
      return [];
  }
}

function buildPermissionsForRole(
  role: string,
  settingsMap: Map<number, unknown>,
): ModalPermissions {
  switch (role) {
    case "Приймальник":
      return {
        canShowLockButton: true, // Приймальник завжди бачить замок
        canShowCreateActBtn: parseBoolValue(settingsMap.get(18)),
        canShowPrintActBtn: parseBoolValue(settingsMap.get(19)),
        canShowAddRowBtn: parseBoolValue(settingsMap.get(4)),
        canShowSmsBtn: parseBoolValue(settingsMap.get(20)),
      };
    case "Запчастист":
      return {
        canShowLockButton: parseBoolValue(settingsMap.get(16)),
        canShowCreateActBtn: parseBoolValue(settingsMap.get(19)),
        canShowPrintActBtn: parseBoolValue(settingsMap.get(20)),
        canShowAddRowBtn: parseBoolValue(settingsMap.get(4)),
        canShowSmsBtn: parseBoolValue(settingsMap.get(21)),
      };
    case "Складовщик":
      return {
        canShowLockButton: parseBoolValue(settingsMap.get(13)),
        canShowCreateActBtn: parseBoolValue(settingsMap.get(16)),
        canShowPrintActBtn: parseBoolValue(settingsMap.get(17)),
        canShowAddRowBtn: parseBoolValue(settingsMap.get(4)),
        canShowSmsBtn: parseBoolValue(settingsMap.get(18)),
      };
    default:
      return getDefaultPermissions();
  }
}

function parseBoolValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(v)) return true;
    if (["false", "0", "no", "n"].includes(v)) return false;
  }
  return true;
}

function getDefaultPermissions(): ModalPermissions {
  return {
    canShowLockButton: true,
    canShowCreateActBtn: true,
    canShowPrintActBtn: true,
    canShowAddRowBtn: true,
    canShowSmsBtn: true,
  };
}

export async function showModal(
  actId: number,
  clickSource: "client" | "other" = "other",
  skipPresence: boolean = false,
): Promise<void> {
  const canOpen = await canUserOpenActs();

  if (!canOpen) {
    // console.warn(`⚠️ Користувач не має доступу до відкриття акту ${actId}`);
    showNoAccessNotification();
    return;
  }

  createModal();
  const modal = document.getElementById(ZAKAZ_NARAYD_MODAL_ID);
  const body = document.getElementById(ZAKAZ_NARAYD_BODY_ID);
  if (!modal || !body) {
    // console.error("❌ Модальне вікно або його тіло не знайдені.");
    return;
  }

  // ⚡ ОПТИМІЗАЦІЯ: Показуємо skeleton loader ОДРАЗУ для швидкого візуального відгуку
  modal.setAttribute("data-act-id", actId.toString());
  modal.classList.remove("hidden");
  body.innerHTML = getSkeletonLoaderHTML();

  try {
    // ⚡ ОПТИМІЗАЦІЯ: Запускаємо незалежні операції паралельно
    // loadGlobalData, createRequiredModals та запит act не залежать одна від одної
    const [, , actResult] = await Promise.all([
      loadGlobalData(),
      createRequiredModals(),
      supabase.from("acts").select("*").eq("act_id", actId).single(),
    ]);

    const { data: act, error: actError } = actResult;

    if (actError || !act) {
      handleLoadError(actError);
      return;
    }

    // 🔽 Доступ до колонки "Зар-та" по ролі (по settings) - тепер globalCache вже завантажено
    if (userAccessLevel && userAccessLevel !== "Адміністратор") {
      const canSeeZarplata = await canUserSeeZarplataColumn();
      globalCache.settings.showZarplata = canSeeZarplata;
    }
    // Для Адміністратора залишаємо як прийшло з loadGlobalData()

    // 🔽 НОВА ЛОГІКА: Контроль видимості "Зар-та" та "ПІБ _ Магазин" залежно від clickSource
    // Зберігаємо оригінальні значення для відновлення після рендерингу
    const originalShowPibMagazin = globalCache.settings.showPibMagazin;
    const originalShowZarplata = globalCache.settings.showZarplata;

    // Тимчасово змінюємо видимість залежно від джерела кліку
    if (clickSource === "other") {
      // Клік по № акту, Дата, Автомобіль, Сума - ховаємо стовпці
      globalCache.settings.showPibMagazin = false;
      globalCache.settings.showZarplata = false;
    }
    // Якщо clickSource === 'client' - залишаємо оригінальні значення

    globalCache.currentActId = actId;
    globalCache.isActClosed = !!act.date_off;
    globalCache.currentActDateOn = act.date_on || null;

    // ✅ Зберігаємо приймальника в localStorage для використання при логуванні змін
    if (act.pruimalnyk) {
      localStorage.setItem("current_act_pruimalnyk", act.pruimalnyk);
    } else {
      localStorage.removeItem("current_act_pruimalnyk");
    }

    // ⚡ ОПТИМІЗАЦІЯ: Завантажуємо client, car та permissions паралельно
    const [clientData, carData, permissions] = await Promise.all([
      fetchClientData(act.client_id),
      fetchCarData(act.cars_id),
      loadAllModalPermissions(),
    ]);

    const {
      canShowLockButton,
      canShowCreateActBtn,
      canShowPrintActBtn,
      canShowAddRowBtn,
      canShowSmsBtn,
    } = permissions;

    const actDetails = safeParseJSON(act.info || act.data || act.details) || {};

    cacheHiddenColumnsData(actDetails);
    globalCache.oldNumbers = new Map<number, number>();
    for (const d of actDetails?.["Деталі"] || []) {
      const id = Number(d?.sclad_id);
      const qty = Number(d?.["Кількість"] ?? 0);
      if (id) globalCache.oldNumbers.set(id, qty);
    }

    renderModalContent(
      act,
      actDetails,
      clientData,
      carData,
      canShowLockButton,
      canShowCreateActBtn,
      canShowPrintActBtn,
      canShowAddRowBtn,
      canShowSmsBtn,
    );

    // ✅ ВІДНОВЛЮЄМО оригінальні значення після рендерингу
    globalCache.settings.showPibMagazin = originalShowPibMagazin;
    globalCache.settings.showZarplata = originalShowZarplata;

    // 🔽 ТУТ ВЖЕ Є ТАБЛИЦЯ В DOM — МОЖНА ХОВАТИ/ПОКАЗУВАТИ ЦІНА/СУМА
    const canSeePriceCols = await canUserSeePriceColumns();
    togglePriceColumnsVisibility(canSeePriceCols);

    // ⚡ ОПТИМІЗАЦІЯ: Запускаємо handlers одразу, щоб модалька була інтерактивною
    // Handlers не залежать від slyusar sums
    addModalHandlers(actId, actDetails, clientData?.phone).catch(() => {
      /* silent */
    });

    // ⚡ ОПТИМІЗАЦІЯ: Виносимо важкі операції в фоновий режим
    // Вони виконуються ПІСЛЯ показу модалки, не блокуючи відкриття
    Promise.resolve().then(async () => {
      try {
        // Встановлення зарплат з історії (важка операція)
        await updateAllSlyusarSumsFromHistory();

        // Паралельні фонові операції
        await Promise.all([
          fillMissingSlyusarSums(),
          refreshQtyWarningsIn(ACT_ITEMS_TABLE_CONTAINER_ID),
          refreshPhotoData(actId),
        ]);

        checkSlyusarSumWarningsOnLoad();
      } catch (err) {
        // console.error("Помилка у фонових операціях:", err);
      }
    });

    applyAccessRestrictions();

    // 🔽 Підсвічування змін для Адміністратора та Приймальника (в фоні, не блокуємо)
    if (
      userAccessLevel === "Адміністратор" ||
      userAccessLevel === "Приймальник"
    ) {
      // Запускаємо без await щоб не блокувати відкриття акту
      checkAndHighlightChanges(actId).then(() => {
        removeNotificationsForAct(actId);
      });
      // .catch((err) => console.error("Помилка підсвічування:", err));
    }

    // 🔽 Перевірка прав на кнопку "Додати рядок" - тепер це робиться при рендері
    // await toggleAddRowButtonVisibility();

    // 📢 ПІДПИСКА НА ЗМІНИ slusarsOn В РЕАЛЬНОМУ ЧАСІ (ОНОВЛЕННЯ ЗАГОЛОВКА)
    setupSlusarsOnRealtimeSubscription(actId);

    // 🔐 ПІДПИСКА НА PRESENCE API ДЛЯ ВІДСТЕЖЕННЯ ПРИСУТНОСТІ КОРИСТУВАЧІВ
    if (!skipPresence) {
      // 🔐 ПОПЕРЕДНЯ ПЕРЕВІРКА: чи акт вже відкритий іншим користувачем (за глобальною мапою присутності)
      // Це спрацьовує коли комп'ютер іншого користувача "заснув" і не зробив untrack
      const existingEditor = getActEditorFromPresence(actId);
      if (existingEditor) {
        // Акт вже відкритий іншим користувачем - блокуємо одразу
        lockActInterface(existingEditor);
      }

      // Перевіряємо чи акт вже відкритий іншим користувачем
      // Передаємо колбек для оновлення даних при розблокуванні
      await subscribeToActPresence(actId, async () => {
        // Викликаємо showModal з skipPresence=true, щоб оновити дані і не підписуватися знову
        await showModal(actId, clickSource, true);
      });
    }

    showNotification("Дані успішно завантажено", "success", 1500);
  } catch (error) {
    // console.error("💥 Критична помилка при завантаженні акту:", error);
    showNotification(`Критична помилка завантаження акту`, "error");
    if (body) {
      body.innerHTML = `<p class="error-message">❌ Критична помилка завантаження акту. Перегляньте консоль.</p>`;
    }
  }
}

async function fillMissingSlyusarSums(): Promise<void> {
  if (!globalCache.settings.showZarplata || userAccessLevel === "Слюсар")
    return;
  if (!globalCache.settings.showPibMagazin) return;
  const container = document.getElementById(ACT_ITEMS_TABLE_CONTAINER_ID);
  if (!container) return;

  const rows = Array.from(
    container.querySelectorAll<HTMLTableRowElement>("tbody tr"),
  );

  for (const row of rows) {
    const nameCell = row.querySelector('[data-name="name"]') as HTMLElement;
    const typeFromCell = nameCell?.getAttribute("data-type");

    if (typeFromCell !== "works") continue;

    const slyusarSumCell = row.querySelector(
      '[data-name="slyusar_sum"]',
    ) as HTMLElement;

    if (slyusarSumCell.textContent?.trim()) continue;

    const pibCell = row.querySelector(
      '[data-name="pib_magazin"]',
    ) as HTMLElement;
    const slyusarName = pibCell?.textContent?.trim() || "";

    if (!slyusarName) continue;

    const percent = await getSlyusarWorkPercent(slyusarName);

    const sumCell = row.querySelector('[data-name="sum"]') as HTMLElement;
    const sum =
      parseFloat(sumCell?.textContent?.replace(/\s/g, "") || "0") || 0;

    if (sum <= 0) continue;

    const slyusarSum = calculateSlyusarSum(sum, percent);
    slyusarSumCell.textContent = formatNumberWithSpaces(slyusarSum);
  }
}

function checkSlyusarSumWarningsOnLoad(): void {
  // ✅ Слюсар не бачить колонку "Сума", тому не показуємо йому попередження про зарплату
  if (userAccessLevel === "Слюсар") return;

  if (!globalCache.settings.showZarplata) return;
  const container = document.getElementById(ACT_ITEMS_TABLE_CONTAINER_ID);
  if (!container) return;

  const rows = Array.from(
    container.querySelectorAll<HTMLTableRowElement>("tbody tr"),
  );
  let hasWarnings = false;

  for (const row of rows) {
    const nameCell = row.querySelector('[data-name="name"]') as HTMLElement;
    const typeFromCell = nameCell?.getAttribute("data-type");

    if (typeFromCell !== "works") continue;

    const sumCell = row.querySelector('[data-name="sum"]') as HTMLElement;
    const slyusarSumCell = row.querySelector(
      '[data-name="slyusar_sum"]',
    ) as HTMLElement;

    if (!sumCell || !slyusarSumCell) continue;

    const sum = parseFloat(sumCell.textContent?.replace(/\s/g, "") || "0") || 0;
    const slyusarSum =
      parseFloat(slyusarSumCell.textContent?.replace(/\s/g, "") || "0") || 0;

    if (slyusarSum > sum) {
      hasWarnings = true;
      slyusarSumCell.setAttribute("data-warnzp", "1");
      slyusarSumCell.classList.add("slyusar-sum-cell");
    }
  }

  if (hasWarnings) {
    showNotification(
      "⚠️ Увага: Знайдено помилки. Зарплата більша ніж сума роботи у деяких рядках",
      "warning",
      3000,
    );
  }
}

function showNoAccessNotification(): void {
  const notification = document.createElement("div");
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #ff5722;
    color: white;
    padding: 15px 25px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 10001;
    font-size: 16px;
    animation: slideInOut 3s ease;
  `;
  notification.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px;">
      <span style="font-size: 24px;">🔒</span>
      <span>У вас немає доступу до перегляду актів</span>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    @keyframes slideInOut {
      0% { transform: translateX(100%); opacity: 0; }
      10% { transform: translateX(0); opacity: 1; }
      90% { transform: translateX(0); opacity: 1; }
      100% { transform: translateX(100%); opacity: 0; }
    }
  `;

  if (!document.getElementById("no-access-notification-style")) {
    style.id = "no-access-notification-style";
    document.head.appendChild(style);
  }

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

async function applyAccessRestrictionsToNewRow(): Promise<void> {
  const table = document.querySelector(
    `#${ACT_ITEMS_TABLE_CONTAINER_ID} table`,
  );
  if (!table) return;

  const lastRow = table.querySelector("tbody tr:last-child");
  if (!lastRow) return;

  // Перевіряємо чи користувач може бачити колонки ціни/суми
  const canSeePriceCols = await canUserSeePriceColumns();

  // Застосовуємо видимість до всіх колонок ціни/суми в останньому рядку
  const priceCells = lastRow.querySelectorAll<HTMLElement>(
    '[data-col="price"], [data-col="sum"]',
  );
  priceCells.forEach((cell) => {
    cell.style.display = canSeePriceCols ? "" : "none";
  });

  // Перевіряємо видимість колонки зарплати
  const slyusarSumCell = lastRow.querySelector(
    '[data-name="slyusar_sum"]',
  ) as HTMLElement;
  if (slyusarSumCell && !globalCache.settings.showZarplata) {
    slyusarSumCell.style.display = "none";
  }
}

/**
 * Обмеження доступу:
 *  - Слюсар: ховаємо друк, склад, забороняємо створення папки для фото.
 *  - Замок тепер НЕ ховаємо тут, а керуємось canUserSeeLockButton().
 */
function applyAccessRestrictions(): void {
  if (userAccessLevel === "Слюсар") {
    const printActButton = document.getElementById("print-act-button");
    if (printActButton) printActButton.classList.add("hidden");
  }
}

function initActPhotos(actId: number, isClosed: boolean, isRestricted: boolean): void {
  const slot = document.getElementById("photo-section-slot");
  if (!slot) return;

  const folderPath = `a${actId}`;

  const loadPhotos = async () => {
    try {
      const { data, error } = await supabase.storage.from("ai-photos").list(folderPath, { limit: 50 });
      if (error) throw error;

      const files = data ? data.filter(f => f.name !== '.emptyFolderPlaceholder') : [];

      let html = `<div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 5px;">`;
      for (const file of files) {
        const { data: { publicUrl } } = supabase.storage.from("ai-photos").getPublicUrl(`${folderPath}/${file.name}`);
        html += `<a href="${publicUrl}" target="_blank">
                    <img src="${publicUrl}" style="height: 50px; width: 50px; border-radius: 4px; object-fit: cover; border: 1px solid #ccc;" alt="photo">
                  </a>`;
      }
      html += `</div>`;

      if (!isClosed && !isRestricted) {
        html += `<button id="btn-add-act-photo" class="status-lock-icon" style="font-size:12px; padding:4px 8px; width:auto; border-radius:4px; height:auto; cursor:pointer; background: #e0e0e0; color: #333; border: 1px solid #ccc;" title="Додати фото">📷 Додати (${files.length})</button>
                 <input type="file" id="file-upload-act-photo" multiple accept="image/*" style="display:none;" />`;
      } else if (files.length === 0) {
        html += `<span style="font-size:12px; color:#999;">Фото відсутні</span>`;
      }

      slot.innerHTML = html;

      const btn = document.getElementById("btn-add-act-photo");
      const input = document.getElementById("file-upload-act-photo") as HTMLInputElement;
      if (btn && input) {
        btn.addEventListener("click", (e) => { e.preventDefault(); input.click(); });
        input.addEventListener("change", async (e) => {
          const uploadFiles = (e.target as HTMLInputElement).files;
          if (!uploadFiles || uploadFiles.length === 0) return;

          btn.textContent = "⏳...";
          btn.style.pointerEvents = "none";

          try {
            for (let i = 0; i < uploadFiles.length; i++) {
              const f = uploadFiles[i];
              const ext = f.name.split('.').pop() || "jpg";
              const fileName = `${Date.now()}_${i}.${ext}`;
              await supabase.storage.from("ai-photos").upload(`${folderPath}/${fileName}`, f);
            }
          } catch (err) {
            showNotification("Помилка завантаження", "error");
          }
          loadPhotos();
        });
      }
    } catch (err) {
      slot.innerHTML = `<span style="color:red; font-size:12px;">Помилка завантаження</span>`;
    }
  };

  slot.innerHTML = `<span style="font-size:12px; color:#999;">Завантаження...</span>`;
  loadPhotos();
}

async function createRequiredModals(): Promise<void> {
  let elem = document.getElementById(viknoPidtverdchennayZakruttiaAktyId);
  if (elem) elem.remove();
  document.body.appendChild(createViknoPidtverdchennayZakruttiaAkty());

  elem = document.getElementById(viknoVvodyParoluId);
  if (elem) elem.remove();
  document.body.appendChild(createViknoVvodyParolu());

  elem = document.getElementById(MODAL_ACT_RAXUNOK_ID);
  if (elem) elem.remove();
  const actRaxunokModal = createModalActRaxunok();
  document.body.appendChild(actRaxunokModal);

  initModalActRaxunokHandlers();
}

async function fetchClientData(clientId: number | null): Promise<any> {
  if (!clientId) return null;
  const { data: client } = await supabase
    .from("clients")
    .select("data")
    .eq("client_id", clientId)
    .single();
  return client?.data ? safeParseJSON(client.data) : null;
}

async function fetchCarData(carId: number | null): Promise<any> {
  if (!carId) return null;
  const { data: car } = await supabase
    .from("cars")
    .select("data")
    .eq("cars_id", carId)
    .single();
  return car?.data ? safeParseJSON(car.data) : null;
}

function handleLoadError(error: any): void {
  const body = document.getElementById(ZAKAZ_NARAYD_BODY_ID);
  showNotification(
    `Помилка завантаження акту: ${error?.message || "Перевірте підключення."}`,
    "error",
  );
  if (body) {
    body.innerHTML = `<p class="error-message">❌ Не вдалося завантажити акт. ${error?.message || "Перевірте підключення."
      }</p>`;
  }
}

function renderModalContent(
  act: any,
  actDetails: any,
  clientData: any,
  carData: any,
  canShowLockButton: boolean,
  canShowCreateActBtn: boolean,
  canShowPrintActBtn: boolean,
  canShowAddRowBtn: boolean,
  canShowSmsBtn: boolean,
): void {
  const body = document.getElementById(ZAKAZ_NARAYD_BODY_ID);
  if (!body) return;
  const isClosed = globalCache.isActClosed;
  const isRestricted = userAccessLevel === "Слюсар";

  const showCatalog = globalCache.settings.showCatalog;
  const showPibMagazin = globalCache.settings.showPibMagazin;

  const clientInfo = {
    fio: clientData?.["ПІБ"] || clientData?.fio || "—",
    phone: clientData?.["Телефон"] || clientData?.phone || "—",
    note: clientData?.["Додаткові"] || "—",
  };
  const carInfo = {
    auto: carData?.["Авто"] || "",
    year: carData?.["Рік"] || "",
    nomer: carData?.["Номер авто"] || "",
    vin: carData?.["Vincode"] || "—",
    engine:
      [carData?.["КодДВЗ"], carData?.["Обʼєм"], carData?.["Пальне"]]
        .filter(Boolean)
        .join(" _ ") || "—",
  };
  const editableAttr = `contenteditable="${!isClosed}"`;
  const editableClass = isClosed ? "cursor-not-allowed" : "";
  const photoCellHtml = `<div id="photo-section-slot"></div>`;

  // ✅ Підготовка для підрахунку індексів робіт для кожного слюсаря
  const slyusarWorkIndexMap = new Map<string, number>();
  // ✅ Підготовка для підрахунку індексів деталей для кожного магазину
  const shopDetailIndexMap = new Map<string, number>();

  const allItems = [
    ...(actDetails?.["Деталі"] || []).map((item: any) => {
      const shopName = showPibMagazin ? item["Магазин"] || "" : "";
      const detailName = item["Деталь"] || "";

      // ✅ Визначаємо індекс деталі для цього магазину
      const shopKey = shopName.toLowerCase();
      const detailIndex = shopDetailIndexMap.get(shopKey) ?? 0;
      shopDetailIndexMap.set(shopKey, detailIndex + 1);

      // ✅ Беремо recordId з acts.data.Деталі (якщо є) або undefined
      const recordId = item["recordId"] || undefined;
      const sclad_id = showCatalog ? item["sclad_id"] || null : null;
      const detail_id = item["detail_id"] || null;

      // Якщо є detail_id і немає sclad_id, оновлюємо назву з кешу, раптом вона змінилася
      let finalDetailName = detailName;
      if (!sclad_id && detail_id) {
        const cachedDetail = globalCache.detailsWithId.find(d => d.detail_id === detail_id);
        if (cachedDetail) finalDetailName = cachedDetail.name;
      } else if (sclad_id) {
        // Якщо зі складу, теж можна спробувати оновити назву
        const scladPart = globalCache.skladParts.find(p => p.sclad_id === sclad_id);
        if (scladPart) finalDetailName = scladPart.name;
      }

      return {
        type: "detail",
        name: finalDetailName,
        quantity: item["Кількість"] || 0,
        price: item["Ціна"] || 0,
        sum: item["Сума"] || 0,
        person_or_store: shopName,
        catalog: showCatalog ? item["Каталог"] || "" : "",
        sclad_id,
        detail_id, // ✅ Зберігаємо detail_id
        slyusar_id: null,
        recordId, // ✅ Додаємо recordId для деталей
      };
    }),
    ...(actDetails?.["Роботи"] || []).map((item: any) => {
      const slyusarName = showPibMagazin ? item["Слюсар"] || "" : "";
      const workName = item["Робота"] || "";

      // ✅ Визначаємо індекс роботи для цього слюсаря
      const slyusarKey = slyusarName.toLowerCase();
      const workIndex = slyusarWorkIndexMap.get(slyusarKey) ?? 0;
      slyusarWorkIndexMap.set(slyusarKey, workIndex + 1);

      // ✅ ПРІОРИТЕТ: беремо recordId з acts.data.Роботи (якщо є), інакше шукаємо в історії слюсаря
      const recordId =
        item["recordId"] ||
        (slyusarName
          ? getRecordIdFromHistory(slyusarName, workName, act.act_id, workIndex)
          : undefined);

      const work_id = item["work_id"] || null;

      // Якщо є work_id, оновлюємо назву з кешу, раптом вона змінилася
      let finalWorkName = workName;
      if (work_id) {
        const cachedWork = globalCache.worksWithId.find(w => w.work_id === work_id);
        if (cachedWork) finalWorkName = cachedWork.name;
      }

      return {
        type: "work",
        name: finalWorkName,
        quantity: item["Кількість"] || 0,
        price: item["Ціна"] || 0,
        sum: item["Сума"] || 0,
        person_or_store: slyusarName,
        catalog: showCatalog ? item["Каталог"] || "" : "",
        sclad_id: showCatalog ? null : null,
        slyusar_id: item["slyusar_id"] || null,
        work_id, // ✅ Зберігаємо work_id
        recordId, // ✅ Додаємо recordId для точного пошуку при збереженні
      };
    }),
  ].filter((item) => item.name.trim() !== "");

  if (allItems.length === 0) {
    allItems.push({
      type: undefined,
      name: "",
      quantity: 0,
      price: 0,
      sum: 0,
      person_or_store: "",
      catalog: "",
      sclad_id: null,
      slyusar_id: null,
    });
  }

  globalCache.initialActItems = allItems;

  const showLockButton = canShowLockButton;

  // 💛 ПЕРЕВІРКА slusarsOn ДЛЯ ФАРБУВАННЯ ЗАГОЛОВКА (ТІЛЬКИ ДЛЯ ВІДКРИТИХ АКТІВ)
  const shouldShowSlusarsOn =
    act.slusarsOn === true &&
    !isClosed &&
    (userAccessLevel === "Адміністратор" ||
      userAccessLevel === "Слюсар" ||
      (userAccessLevel === "Приймальник" &&
        act.pruimalnyk === currentUserName));

  const headerClass = shouldShowSlusarsOn
    ? "zakaz_narayd-header zakaz_narayd-header-slusar-on"
    : "zakaz_narayd-header";

  // Генеруємо HTML кнопок для header
  const pruimalnykDisplay = act.pruimalnyk
    ? `<span class="act-pruimalnyk-info">${act.pruimalnyk}</span>`
    : "";

  const headerButtons = `
    <div class="zakaz_narayd-header-buttons">
      ${pruimalnykDisplay}
      ${showLockButton
      ? `<button class="status-lock-icon" id="status-lock-btn" data-act-id="${act.act_id}">
                   ${isClosed ? "🔒" : "🗝️"}
                   </button>`
      : ""
    }
      ${!isRestricted && canShowPrintActBtn
      ? `<button id="print-act-button" title="Друк акту" class="print-button">🖨️</button>`
      : ""
    }
      ${canShowSmsBtn
      ? (() => {
        let tooltip = "Немає SMS";
        const isSent = !!act.sms;
        if (isSent) {
          try {
            const dateString = String(act.sms).replace(" ", "T");
            const d = new Date(dateString);
            if (!isNaN(d.getTime())) {
              const { date, time } = formatDateTime(d);
              tooltip = `${time} / ${date}`;
            } else {
              tooltip = String(act.sms);
            }
          } catch {
            tooltip = String(act.sms);
          }
        }
        return !isSent
          ? `<button class="status-lock-icon" id="sms-btn" data-act-id="${act.act_id}" title="${tooltip}">✉️</button>`
          : `<button class="status-lock-icon" id="sms-btn" data-act-id="${act.act_id}" title="${tooltip}">📨</button>`;
      })()
      : ""
    }
      ${!isRestricted && canShowCreateActBtn
      ? `<button type="button" class="status-lock-icon" id="create-act-btn" title="Акт Рахунок?">🗂️</button>`
      : ""
    }
    </div>
  `;

  // Визначаємо стиль для header (не застосовуємо колір якщо slusarsOn активний - буде золотистий)
  const headerStyle = shouldShowSlusarsOn
    ? ""
    : `background-color: ${globalCache.generalSettings.headerColor};`;

  const logoImage = globalCache.generalSettings.logoUrl
    ? `<img src="${globalCache.generalSettings.logoUrl}" class="zakaz_narayd-header-logo" alt="Логотип">`
    : "";

  body.innerHTML = `
    <div class="${headerClass}" style="${headerStyle}">
      ${logoImage}
      <div class="zakaz_narayd-header-info">
        <h1>${globalCache.generalSettings.stoName}</h1>
        <p>Адрес: ${globalCache.generalSettings.address}</p>
        <p>${globalCache.generalSettings.phone} тел</p>
      </div>
      ${headerButtons}
    </div>
    <div class="zakaz_narayd-table-container">
      <table class="zakaz_narayd-table left">
        ${createTableRow("Акт №", `<span id="act-number">${act.act_id}</span>`)}
        ${createTableRow("Клієнт", clientInfo.fio)}
        ${createTableRow(
    "Телефон",
    `<span style="color: blue;">${clientInfo.phone}</span>`,
  )}
        ${createTableRow("Примітка:", clientInfo.note)}
        ${createTableRow("Фото", photoCellHtml)}
      </table>
      <table class="zakaz_narayd-table right">
        ${createTableRow(
    isClosed ? "Закритий" : "Відкритий",
    `${isClosed
      ? `<span class="red">${formatDate(act.date_off)}</span> | <span class="green">${formatDate(act.date_on)}</span>`
      : `<span class="green">${formatDate(act.date_on) || "-"}</span>`
    }`,
  )}
        ${createTableRow(
    "Автомобіль",
    `${(carInfo.auto || "").trim()} ${(carInfo.year || "").trim()} ${(
      carInfo.nomer || ""
    ).trim()}`.trim() || "—",
  )}
        ${createTableRow("Vincode", carInfo.vin)}
        ${createTableRow("Двигун", carInfo.engine)}
        ${createTableRow(
    "Пробіг",
    `<span id="${EDITABLE_PROBIG_ID}" ${editableAttr} class="editable ${editableClass}">${formatNumberWithSpaces(
      actDetails?.["Пробіг"],
      0,
      0,
    )}</span>`,
  )}
      </table>
    </div>
    <div class="reason-container">
      <div class="zakaz_narayd-reason-line">
        <div class="reason-text">
          <strong>Причина звернення:</strong>
          <span id="${EDITABLE_REASON_ID}" class="highlight editable ${editableClass}" ${editableAttr} style="white-space: pre-wrap;">${actDetails?.["Причина звернення"] || "—"
    }</span>
        </div>
      </div>
      <div class="zakaz_narayd-reason-line">
        <div class="recommendations-text">
          <strong>Рекомендації:</strong>
          <span id="${EDITABLE_RECOMMENDATIONS_ID}" class="highlight editable ${editableClass}" ${editableAttr} style="white-space: pre-wrap;">${actDetails?.["Рекомендації"] || "—"
    }</span>
        </div>
      </div>
      <div class="zakaz_narayd-reason-line" id="notes-line-container">
        <div class="notes-text">
          <strong>Примітки:</strong>
          <span id="${EDITABLE_NOTES_ID}" class="highlight editable ${editableClass}" ${editableAttr} style="white-space: pre-wrap;">${actDetails?.["Примітки"] || "—"
    }</span>
        </div>
      </div>
    </div>
    ${generateTableHTML(
      allItems,
      globalCache.settings.showPibMagazin,
      canShowAddRowBtn,
    )}
    ${isClosed ? createClosedActClaimText() : ""}
  `;

  setTimeout(() => {
    const avansInput = document.getElementById(
      "editable-avans",
    ) as HTMLInputElement | null;
    const discountInput = document.getElementById(
      "editable-discount",
    ) as HTMLInputElement | null;
    const discountAmountInput = document.getElementById(
      "editable-discount-amount",
    ) as HTMLInputElement | null;

    if (avansInput) {
      const avansValue = Number(act?.avans ?? actDetails?.["Аванс"] ?? 0);
      avansInput.value = String(avansValue);
      avansInput.dispatchEvent(new Event("input"));
    }

    if (discountInput) {
      const discountValue = Number(
        act?.discount ?? actDetails?.["Знижка"] ?? 0,
      );
      discountInput.value = String(discountValue);
      discountInput.dispatchEvent(new Event("input"));
    }

    if (discountAmountInput) {
      const discountAmountValue = Number(
        act?.discount_amount ?? actDetails?.["ПроцентЗнижки"] ?? 0,
      );
      discountAmountInput.value = String(discountAmountValue);
      discountAmountInput.dispatchEvent(new Event("input"));
    }
  }, 60);
}

function createClosedActClaimText(): string {
  return `
    <div class="closed-act-info">
      <p><strong>Претензій до вартості замовлення, виконаних робіт, встановлених запчастин та використаних матеріалів не маю.</strong></p>
      <p><strong>Гарантійні зобов'язання</strong></p>
      <p>Виконавець гарантує відповідне відремонтованого ДТЗ (або його складових запчастин) вимогам технічної документації та нормативних документів виробника за умов виконання Замовником правил експлуатації ДТЗ. Гарантійний термін експлуатації на запасні частини встановлюється згідно з Законом України "Про захист прав споживачів". Гарантійні зобов'язання виконавця не розповсюджуються на запасні частини, надані Замовником. Деталі, що не були затребувані Замовником на момент видачі автомобіля, утилізуються та поверненню не підлягають. Цим підписом я надаю однозначну згоду на обробку моїх персональних даних з метою надання сервісних, гарантійних та інших супутніх послуг. Я повідомлений(на) про свої права, передбачені ст. 8 Закону України "Про захист персональних даних".</p>
      <br>
      <table>
        <tr><td><strong>Замовник:</strong> З об'ємом та вартістю робіт згоден</td><td><strong>Виконавець:</strong></td></tr>
        <tr><td><hr class="signature-line"></td><td><hr class="signature-line"></td></tr>
      </table>
    </div>
  `;
}

async function addModalHandlers(
  actId: number,
  actDetails: any,
  clientPhone: string,
): Promise<void> {
  const isClosed = globalCache.isActClosed;
  const isRestricted = userAccessLevel === "Слюсар";
  const body = document.getElementById(ZAKAZ_NARAYD_BODY_ID);
  if (!body) return;

  import("./inhi/knopka_zamok").then(({ initStatusLockDelegation }) => {
    initStatusLockDelegation();
  });

  initPhoneClickHandler(body, clientPhone);
  addSaveHandler(actId, actDetails);
  initDeleteRowHandler();
  initIndexIconHandler();

  // Додаємо відображення та логіку фотографій
  initActPhotos(actId, isClosed, isRestricted);

  const smsBtn = document.getElementById("sms-btn");
  if (smsBtn) {
    smsBtn.addEventListener("click", () => {
      handleSmsButtonClick(actId);
    });
  }

  if (!isRestricted) {
    setTimeout(() => {
      initCreateActRaxunokButton();
    }, 100);

    const printButton = document.getElementById("print-act-button");
    printButton?.addEventListener("click", () => {
      const prev = globalCache.settings.showCatalog;
      globalCache.settings.showCatalog = false;
      try {
        printModalToPdf();
      } finally {
        globalCache.settings.showCatalog = prev;
      }
    });

    const skladButton = document.getElementById("sklad");
    skladButton?.addEventListener("click", () => showModalAllOtherBases());
  }

  if (!isClosed) {
    setupAutocompleteForEditableCells(
      ACT_ITEMS_TABLE_CONTAINER_ID,
      globalCache,
      () => {
        addNewRow(ACT_ITEMS_TABLE_CONTAINER_ID);
        void applyAccessRestrictionsToNewRow();
      },
    );

    initializeActWarnings(ACT_ITEMS_TABLE_CONTAINER_ID, actId);

    const addRowButton = document.getElementById("add-row-button");
    addRowButton?.addEventListener("click", async () => {
      addNewRow(ACT_ITEMS_TABLE_CONTAINER_ID);
      // Застосовуємо обмеження доступу для ВСІХ ролей
      await applyAccessRestrictionsToNewRow();
    });

    // 🎙️ Голосове введення в наряд
    initVoiceInput();
  }

  const avansInput = document.getElementById(
    "editable-avans",
  ) as HTMLInputElement;
  if (avansInput) {
    avansInput.addEventListener("input", () => {
      updateCalculatedSumsInFooter();
    });
  }

  const discountInput = document.getElementById(
    "editable-discount",
  ) as HTMLInputElement;
  if (discountInput) {
    discountInput.addEventListener("input", () => {
      // Коли користувач вручну змінює відсоток, скидаємо флаг суми
      // щоб наступна зміна суми могла знову установити флаг
      (window as any).isDiscountAmountManuallySet = false;
      updateCalculatedSumsInFooter();
    });
  }

  body.addEventListener("input", handleInputChange);
  updateCalculatedSumsInFooter();
}

function expandName(shortenedName: string): string {
  if (!shortenedName || !shortenedName.includes(".....")) return shortenedName;

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

function handleInputChange(event: Event): void {
  const target = event.target as HTMLElement;
  const dataName = target.getAttribute("data-name");
  if (globalCache.isActClosed) {
    showNotification("Неможливо редагувати закритий акт", "warning", 1000);
    return;
  }
  switch (dataName) {
    case "price":
    case "id_count": {
      const cleanedValue = target.textContent?.replace(/[^0-9]/g, "") || "";
      const formattedValue = formatNumberWithSpaces(cleanedValue, 0, 0);
      if (target.textContent !== formattedValue) {
        const selection = window.getSelection();
        const originalCaretPosition = selection?.focusOffset || 0;
        target.textContent = formattedValue;
        if (selection && target.firstChild) {
          const formattedLength = formattedValue.length;
          const originalLength = cleanedValue.length;
          const diff = formattedLength - originalLength;
          const newCaretPosition = Math.min(
            originalCaretPosition + diff,
            formattedLength,
          );
          const range = document.createRange();
          range.setStart(target.firstChild, Math.max(0, newCaretPosition));
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
      const row = target.closest("tr") as HTMLTableRowElement;
      if (row) {
        calculateRowSum(row).catch((_err) => {
          // console.error("Помилка при розрахунку суми:", _err);
        });
      }
      break;
    }
    case "slyusar_sum": {
      const cleanedValue = target.textContent?.replace(/[^0-9]/g, "") || "";
      const formattedValue = formatNumberWithSpaces(cleanedValue, 0, 0);
      if (target.textContent !== formattedValue) {
        const selection = window.getSelection();
        const originalCaretPosition = selection?.focusOffset || 0;
        target.textContent = formattedValue;
        if (selection && target.firstChild) {
          const formattedLength = formattedValue.length;
          const originalLength = cleanedValue.length;
          const diff = formattedLength - originalLength;
          const newCaretPosition = Math.min(
            originalCaretPosition + diff,
            formattedLength,
          );
          const range = document.createRange();
          range.setStart(target.firstChild, Math.max(0, newCaretPosition));
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
      break;
    }
    case "name": {
      if ((target as any)._fromAutocomplete) {
        delete (target as any)._fromAutocomplete;
        updateCalculatedSumsInFooter();
        break;
      }

      const displayedName = target.textContent?.trim() || "";
      const fullName = expandName(displayedName);

      const isInWorks = globalCache.works.includes(fullName);
      const isInDetails = globalCache.details.includes(fullName);

      let type: "details" | "works";
      if (isInDetails && !isInWorks) {
        type = "details";
      } else if (isInWorks && !isInDetails) {
        type = "works";
      } else {
        type = "works";
      }

      target.setAttribute("data-type", type);

      // ⬇️ ВИПРАВЛЕНО: Завжди підтягуємо ім'я для робіт, навіть якщо є значення
      if (displayedName && globalCache.settings.showPibMagazin) {
        const row = target.closest("tr") as HTMLTableRowElement;
        const pibMagCell = row?.querySelector(
          '[data-name="pib_magazin"]',
        ) as HTMLElement | null;

        if (row && pibMagCell) {
          if (type === "works") {
            const userName = getUserNameFromLocalStorage();
            const userLevel = getUserAccessLevelFromLocalStorage();

            if (userName && userLevel === "Слюсар") {
              // ⬇️ КРИТИЧНО: Встановлюємо ім'я ЗАВЖДИ для робіт (тільки якщо Слюсар)
              pibMagCell.textContent = userName;
              pibMagCell.setAttribute("data-type", "slyusars");
              void calculateRowSum(row);
            } else {
              // Якщо не слюсар - не заповнюємо автоматично (або очищаємо, якщо треба)
              // Але тут ми не очищаємо примусово, якщо вже щось є?
              // Логіка: "keep it clean".
              // Якщо це ручне введення, можливо користувач сам щось ввів?
              // Але функція expandName могла змінити текст.
              // Давайте дотримуватись "explicitly cleared/kept empty".
              // Якщо pibMagCell вже мав значення, чи треба його терти?
              // Раніше він не тер if (userName) else ...?
              // Раніше else не було.

              // Якщо користувач (Адмін) вибрав роботу, поле слюсаря має бути пустим?
              // Так.
              if (!pibMagCell.textContent?.trim()) {
                // Тільки якщо порожнє - залишаємо порожнім (і ставимо slyusars щоб був випадаючий список слюсарів)
                pibMagCell.setAttribute("data-type", "slyusars");
              }
            }
          } else {
            // Для деталей очищуємо, якщо порожньо
            if (!pibMagCell.textContent?.trim()) {
              pibMagCell.setAttribute("data-type", "shops");
            }
          }
        }
      }

      updateCalculatedSumsInFooter();
      break;
    }

    case "pib_magazin": {
      const row = target.closest("tr") as HTMLTableRowElement;
      if (row) {
        const newSlyusar = target.textContent?.trim() || "";
        const prevSlyusar = target.getAttribute("data-prev-value") || "";

        // ✅ Зберігаємо нове значення як попереднє для наступного разу
        target.setAttribute("data-prev-value", newSlyusar);

        // ✅ Перевіряємо поточну зарплату в інпуті
        const slyusarSumCell = row.querySelector(
          '[data-name="slyusar_sum"]',
        ) as HTMLElement;
        const currentSalaryText = (slyusarSumCell?.textContent || "")
          .replace(/\s/g, "")
          .trim();
        const currentSalary = parseFloat(currentSalaryText) || 0;

        // ✅ Якщо слюсар змінився І зарплата = 0 або пусто → примусовий перерахунок від відсотка
        if (
          prevSlyusar &&
          prevSlyusar !== newSlyusar &&
          (currentSalary === 0 || currentSalaryText === "")
        ) {
          forceRecalculateSlyusarSalary(row).catch((_err) => {
            // console.error("Помилка при примусовому перерахунку зарплати:", _err);
          });
        } else if (
          prevSlyusar &&
          prevSlyusar !== newSlyusar &&
          currentSalary > 0
        ) {
          // ✅ Встановлюємо флаг, що зарплату не треба перераховувати
          row.setAttribute("data-salary-locked", "true");
          updateCalculatedSumsInFooter();
        } else {
          // Звичайний розрахунок (з історії якщо є)
          calculateRowSum(row).catch((_err) => {
            // console.error("Помилка при розрахунку суми:", _err);
          });
        }
      }
      break;
    }
    default:
      if (target.id === EDITABLE_PROBIG_ID) {
        const cleanedValue = target.textContent?.replace(/[^0-9]/g, "") || "";
        const formattedValue = formatNumberWithSpaces(cleanedValue, 0, 0);
        if (target.textContent !== formattedValue) {
          const selection = window.getSelection();
          const originalCaretPosition = selection?.focusOffset || 0;
          target.textContent = formattedValue;

          if (selection && target.firstChild) {
            const formattedLength = formattedValue.length;
            const originalLength = cleanedValue.length;
            const diff = formattedLength - originalLength;
            const newCaretPosition = Math.min(
              originalCaretPosition + diff,
              formattedLength,
            );
            const range = document.createRange();
            range.setStart(target.firstChild, Math.max(0, newCaretPosition));
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
      }
      break;
  }
}

/** Отримує ім'я користувача з localStorage */
export function getUserNameFromLocalStorage(): string | null {
  try {
    const USER_DATA_KEY = "userAuthData";
    const storedData = localStorage.getItem(USER_DATA_KEY);
    if (!storedData) return null;

    const userData = JSON.parse(storedData);
    return userData?.Name || null;
  } catch (error) {
    // console.warn(
    // "Помилка при отриманні імені користувача з localStorage:",
    // error,
    // );
    return null;
  }
}

/** Отримує рівень доступу користувача з localStorage */
export function getUserAccessLevelFromLocalStorage(): string | null {
  try {
    const USER_DATA_KEY = "userAuthData";
    const storedData = localStorage.getItem(USER_DATA_KEY);
    if (!storedData) return null;

    const userData = JSON.parse(storedData);
    return userData?.["Доступ"] || null;
  } catch (error) {
    // console.warn("Помилка при отриманні рівня доступу з localStorage:", error);
    return null;
  }
}

function togglePriceColumnsVisibility(show: boolean): void {
  const displayValue = show ? "" : "none";

  // Всі клітинки та заголовки з data-col="price" або data-col="sum"
  const priceCells = document.querySelectorAll<HTMLElement>(
    '[data-col="price"], [data-col="sum"]',
  );

  priceCells.forEach((el) => {
    el.style.display = displayValue;
  });

  // ✅ Також приховуємо/показуємо футер з сумами
  const sumsFooter = document.querySelector<HTMLElement>(
    ".zakaz_narayd-sums-footer",
  );
  if (sumsFooter) {
    sumsFooter.style.display = displayValue;
  }

  // ✅ Також оновлюємо стовпець "Сума" в таблиці списку актів
  toggleActsTableSumaColumn(show);
}

/**
 * Приховує/показує стовпець "Сума" в таблиці списку актів (без перезавантаження)
 */
function toggleActsTableSumaColumn(show: boolean): void {
  const actsTable = document.querySelector(
    "#table-container-modal-sakaz_narad table",
  );
  if (!actsTable) return;

  const displayValue = show ? "" : "none";

  // Знаходимо індекс стовпця "Сума" в заголовку
  const headers = actsTable.querySelectorAll("thead th");
  let sumaColumnIndex = -1;

  headers.forEach((th, index) => {
    if (th.textContent?.trim() === "Сума") {
      sumaColumnIndex = index;
      (th as HTMLElement).style.display = displayValue;
    }
  });

  // Якщо стовпець "Сума" не існує і потрібно показати - перемальовуємо таблицю
  if (sumaColumnIndex === -1 && show) {
    refreshActsTable();
    return;
  }

  // Якщо стовпець існує - приховуємо/показуємо комірки в рядках
  if (sumaColumnIndex !== -1) {
    const rows = actsTable.querySelectorAll("tbody tr");
    rows.forEach((row) => {
      const cells = row.querySelectorAll("td");
      if (cells[sumaColumnIndex]) {
        (cells[sumaColumnIndex] as HTMLElement).style.display = displayValue;
      }
    });
  }
}

// ============================================================================
// 📢 REALTIME ПІДПИСКА НА ЗМІНИ slusarsOn (ОНОВЛЕННЯ ЗАГОЛОВКА)
// ============================================================================

let slusarsOnSubscription: ReturnType<typeof supabase.channel> | null = null;

/**
 * Підписується на зміни slusarsOn для конкретного акту
 * Оновлює жовте фарбування заголовка модального вікна в реальному часі
 */
function setupSlusarsOnRealtimeSubscription(actId: number): void {
  // Очищаємо попередню підписку, якщо є
  if (slusarsOnSubscription) {
    slusarsOnSubscription.unsubscribe();
    slusarsOnSubscription = null;
  }

  // Підписка тільки для Адміністратора, Слюсаря та Приймальника
  if (
    userAccessLevel !== "Адміністратор" &&
    userAccessLevel !== "Слюсар" &&
    userAccessLevel !== "Приймальник"
  ) {
    return;
  }

  slusarsOnSubscription = supabase
    .channel(`slusarsOn-act-${actId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "acts",
        filter: `act_id=eq.${actId}`,
      },
      async (payload) => {
        const updatedAct = payload.new;
        if (!updatedAct) return;

        const newSlusarsOn = updatedAct.slusarsOn === true;
        const isClosed = !!updatedAct.date_off;

        // Оновлюємо заголовок
        const header = document.querySelector(".zakaz_narayd-header");
        if (header) {
          // Перевірка видимості (як в коді рендерингу)
          const shouldShowSlusarsOn =
            newSlusarsOn &&
            !isClosed &&
            (userAccessLevel === "Адміністратор" ||
              userAccessLevel === "Слюсар" ||
              (userAccessLevel === "Приймальник" &&
                updatedAct.pruimalnyk === currentUserName));

          if (shouldShowSlusarsOn) {
            header.classList.add("zakaz_narayd-header-slusar-on");
          } else {
            header.classList.remove("zakaz_narayd-header-slusar-on");
          }
        }
      },
    )
    .subscribe();
}

/**
 * Глобальна функція для відкриття акту з HTML (наприклад, з кнопок в таблиці бухгалтерії)
 * Відкриває акт в режимі 'client' (з усіма стовпцями)
 */
(window as any).openActModalWithClient = (actId: number) => {
  showModal(actId, "client");
};

/**
 * Очищає підписку на slusarsOn при закритті модального вікна
 * Викликається в modalUI.ts при закритті модалки
 */
export function cleanupSlusarsOnSubscription(): void {
  if (slusarsOnSubscription) {
    slusarsOnSubscription.unsubscribe();
    slusarsOnSubscription = null;
  }
}

/**
 * "Тихе" оновлення тільки таблиці акту без перезавантаження всього модалу
 * Використовується при отриманні broadcast про збереження акту іншим користувачем
 * @param actId - ID акту для оновлення
 */
export async function refreshActTableSilently(actId: number): Promise<void> {
  try {
    // ✅ 0. ВАЖЛИВО: Перезавантажуємо слюсарів з БД, щоб мати актуальні дані з історії (зарплати!)
    const { reloadSlyusarsOnly } = await import("./globalCache");
    await reloadSlyusarsOnly();

    // 1. Отримуємо свіжі дані акту з БД
    const { data: act, error: actError } = await supabase
      .from("acts")
      .select("*")
      .eq("act_id", actId)
      .single();

    if (actError || !act) {
      // console.error("❌ Помилка отримання даних акту:", actError);
      return;
    }

    // 2. Парсимо деталі акту
    const actDetails = safeParseJSON(act.info || act.data || act.details) || {};

    // 3. Знаходимо контейнер таблиці
    const tableContainer = document.getElementById(
      ACT_ITEMS_TABLE_CONTAINER_ID,
    );
    if (!tableContainer) {
      // console.error("❌ Контейнер таблиці не знайдено");
      return;
    }

    // 4. ✅ ВИПРАВЛЕНО: Визначаємо видимість стовпців на основі ПОТОЧНОЇ таблиці (а не globalCache)
    // Це гарантує, що оновлення покаже ті самі стовпці, що й до оновлення
    const existingHeaderRow = tableContainer.querySelector("thead tr");
    const headers = Array.from(existingHeaderRow?.querySelectorAll("th") || []);

    // Функція перевірки чи заголовок видимий (не display: none)
    const isHeaderVisible = (th: Element): boolean => {
      const style = (th as HTMLElement).style;
      return style.display !== "none";
    };

    // Точна перевірка наявності та ВИДИМОСТІ стовпців за текстом заголовків
    const showCatalog = headers.some(
      (th) => th.textContent?.trim() === "Каталог" && isHeaderVisible(th),
    );
    const showZarplata = headers.some(
      (th) => th.textContent?.trim() === "Зар-та" && isHeaderVisible(th),
    );
    const showPibMagazin = headers.some(
      (th) =>
        th.textContent?.includes("ПІБ") &&
        th.textContent?.includes("Магазин") &&
        isHeaderVisible(th),
    );

    // Перевіряємо видимість стовпців Ціна та Сума (можуть бути приховані через display: none)
    const showPrice = headers.some(
      (th) => th.textContent?.trim() === "Ціна" && isHeaderVisible(th),
    );
    const showSum = headers.some(
      (th) => th.textContent?.trim() === "Сума" && isHeaderVisible(th),
    );

    // Перевіряємо чи є ОКРЕМА колонка delete-cell (td.delete-cell в окремому td)
    // Якщо кнопка delete всередині name-cell - це інший варіант верстки, окремий td не потрібен
    const hasDeleteColumnSeparate = !!tableContainer.querySelector(
      "tbody tr > td.delete-cell",
    );

    // 5. Підготовка індексів для recordId
    const slyusarWorkIndexMap = new Map<string, number>();
    const shopDetailIndexMap = new Map<string, number>();

    // 6. Формуємо нові дані
    const allItems = [
      ...(actDetails?.["Деталі"] || []).map((item: any) => {
        const shopName = showPibMagazin ? item["Магазин"] || "" : "";
        const detailName = item["Деталь"] || "";
        const shopKey = shopName.toLowerCase();
        const detailIndex = shopDetailIndexMap.get(shopKey) ?? 0;
        shopDetailIndexMap.set(shopKey, detailIndex + 1);
        const recordId = item["recordId"] || undefined;

        return {
          type: "detail",
          name: detailName,
          quantity: item["Кількість"] || 0,
          price: item["Ціна"] || 0,
          sum: item["Сума"] || 0,
          person_or_store: shopName,
          catalog: showCatalog ? item["Каталог"] || "" : "",
          sclad_id: showCatalog ? item["sclad_id"] || null : null,
          slyusar_id: null,
          recordId,
        };
      }),
      ...(actDetails?.["Роботи"] || []).map((item: any) => {
        const slyusarName = showPibMagazin ? item["Слюсар"] || "" : "";
        const workName = item["Робота"] || "";
        const slyusarKey = slyusarName.toLowerCase();
        const workIndex = slyusarWorkIndexMap.get(slyusarKey) ?? 0;
        slyusarWorkIndexMap.set(slyusarKey, workIndex + 1);
        const recordId =
          item["recordId"] ||
          (slyusarName
            ? getRecordIdFromHistory(
              slyusarName,
              workName,
              act.act_id,
              workIndex,
            )
            : undefined);

        return {
          type: "work",
          name: workName,
          quantity: item["Кількість"] || 0,
          price: item["Ціна"] || 0,
          sum: item["Сума"] || 0,
          person_or_store: slyusarName,
          catalog: showCatalog ? item["Каталог"] || "" : "",
          sclad_id: null,
          slyusar_id: item["slyusar_id"] || null,
          recordId,
        };
      }),
    ].filter((item) => item.name.trim() !== "");

    // 7. Оновлюємо кеш початкових даних
    globalCache.initialActItems = allItems;

    // 8. Оновлюємо oldNumbers для правильного підрахунку delta
    globalCache.oldNumbers = new Map<number, number>();
    for (const d of actDetails?.["Деталі"] || []) {
      const id = Number(d?.sclad_id);
      const qty = Number(d?.["Кількість"] ?? 0);
      if (id) globalCache.oldNumbers.set(id, qty);
    }

    // 9. Знаходимо tbody таблиці
    const tbody = tableContainer.querySelector("tbody");
    if (!tbody) {
      // console.error("❌ tbody не знайдено");
      return;
    }

    // 10. Очищаємо старі рядки
    tbody.innerHTML = "";

    // 11. Генеруємо нові рядки
    const isClosed = globalCache.isActClosed;

    allItems.forEach((item, index) => {
      const row = document.createElement("tr");
      const isWork = item.type === "work";
      const dataType = isWork ? "works" : "details";
      const icon = isWork ? "🛠️" : "⚙️";

      // ✅ ВИПРАВЛЕНО: Встановлюємо data-record-id на <tr> для коректного зчитування при збереженні
      if (item.recordId) {
        row.setAttribute("data-record-id", item.recordId);
      }

      // Форматування чисел
      const formatNum = (n: number) => new Intl.NumberFormat("uk-UA").format(n);

      // Генеруємо HTML рядка - стовпці показуємо ТІЛЬКИ якщо вони видимі в заголовках
      // ✅ ВИПРАВЛЕНО: Комірка каталогу і зарплати завжди існує для збереження даних
      row.innerHTML = `
        <td class="row-index">${icon} ${index + 1}</td>
        <td class="name-cell">
          <div data-name="name" data-type="${dataType}" class="${!isClosed ? "editable-autocomplete" : ""}" ${!isClosed ? 'contenteditable="true"' : ""}>${item.name}</div>
        </td>
        <td class="catalog-cell" data-name="catalog" ${item.sclad_id ? `data-sclad-id="${item.sclad_id}"` : ""}${!showCatalog ? ' style="display: none;"' : ""}>${showCatalog ? item.catalog || "" : ""}</td>
        <td class="text-right qty-cell" data-name="id_count" ${!isClosed ? 'contenteditable="true"' : ""}>${formatNum(item.quantity)}</td>
        ${showPrice ? `<td class="text-right price-cell" data-name="price" ${!isClosed ? 'contenteditable="true"' : ""}>${formatNum(item.price)}</td>` : ""}
        ${showSum ? `<td class="text-right" data-name="sum">${formatNum(item.sum)}</td>` : ""}
        <td class="text-right slyusar-sum-cell" data-name="slyusar_sum"${!showZarplata ? ' style="display: none;"' : ""}>${isWork ? "" : ""}</td>
        ${showPibMagazin ? `<td class="pib-magazin-cell" data-name="pib_magazin" ${!isClosed ? 'contenteditable="true"' : ""}>${item.person_or_store}</td>` : ""}
        ${hasDeleteColumnSeparate ? `<td class="delete-cell"><button class="delete-row-btn" title="Видалити рядок">🗑️</button></td>` : ""}
      `;

      tbody.appendChild(row);
    });

    // 12. Оновлюємо зарплати з історії (якщо показуємо)
    if (showZarplata) {
      await updateAllSlyusarSumsFromHistory();
    }

    // 13. Оновлюємо підсумки
    updateCalculatedSumsInFooter();

    // 14. Оновлюємо попередження про кількість
    await refreshQtyWarningsIn(ACT_ITEMS_TABLE_CONTAINER_ID);

    // 15. Перевстановлюємо автодоповнення для нових рядків
    if (!isClosed) {
      setupAutocompleteForEditableCells(
        ACT_ITEMS_TABLE_CONTAINER_ID,
        globalCache,
        () => {
          updateCalculatedSumsInFooter();
        },
      );
    }

    // ✅ 16. Оновлюємо інші поля акту (пробіг, причина звернення, рекомендації, аванс, знижка)
    // Пробіг
    const probigEl = document.getElementById(EDITABLE_PROBIG_ID);
    if (probigEl) {
      probigEl.textContent = formatNumberWithSpaces(
        actDetails?.["Пробіг"],
        0,
        0,
      );
    }

    // Причина звернення
    const reasonEl = document.getElementById(EDITABLE_REASON_ID);
    if (reasonEl) {
      reasonEl.textContent = actDetails?.["Причина звернення"] || "—";
    }

    // Рекомендації
    const recommendationsEl = document.getElementById(
      EDITABLE_RECOMMENDATIONS_ID,
    );
    if (recommendationsEl) {
      recommendationsEl.textContent = actDetails?.["Рекомендації"] || "—";
    }

    // Примітки
    const notesEl = document.getElementById(EDITABLE_NOTES_ID);
    if (notesEl) {
      notesEl.textContent = actDetails?.["Примітки"] || "—";
    }

    // Аванс
    const avansInput = document.getElementById(
      "editable-avans",
    ) as HTMLInputElement | null;
    if (avansInput) {
      const avansValue = Number(act?.avans ?? actDetails?.["Аванс"] ?? 0);
      avansInput.value = String(avansValue);
      avansInput.dispatchEvent(new Event("input"));
    }

    // Знижка (відсоток)
    const discountInput = document.getElementById(
      "editable-discount",
    ) as HTMLInputElement | null;
    if (discountInput) {
      const discountValue = Number(
        act?.discount ?? actDetails?.["Знижка"] ?? 0,
      );
      discountInput.value = String(discountValue);
      discountInput.dispatchEvent(new Event("input"));
    }

    // Знижка (сума)
    const discountAmountInput = document.getElementById(
      "editable-discount-amount",
    ) as HTMLInputElement | null;
    if (discountAmountInput) {
      const discountAmountValue = Number(actDetails?.["Знижка сума"] ?? 0);
      discountAmountInput.value = String(discountAmountValue);
      discountAmountInput.dispatchEvent(new Event("input"));
    }
  } catch (error) {
    // console.error("❌ Помилка тихого оновлення таблиці:", error);
  }
}
