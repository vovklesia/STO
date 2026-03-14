// src\ts\roboha\dodatu_inchi_bazu\vikno_pidtverdchennay_inchi_bazu.ts
import { supabase } from "../../vxid/supabaseClient";
import { showNotification } from "../zakaz_naraudy/inhi/vspluvauhe_povidomlenna";
import { all_bd, CRUD } from "./dodatu_inchi_bazu_danux";
import { resetShopState, resetDetailState } from "./inhi/scladMagasunDetal";
import { tryHandleShopsCrud } from "./db_shops_details";
import { tryHandleDetailsCrud } from "./db_shops_details";
import { handleScladCrud } from "./db_sclad";
import {
  getSlusarAdditionalData,
  checkEmployeeExists,
  saveSlusarData,
} from "./inhi/slusar";

export const savePromptModalId = "save-prompt-modal";

export function createSavePromptModal(): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.id = savePromptModalId;
  overlay.className = "modal-overlay-save";
  overlay.style.display = "none";

  const modal = document.createElement("div");
  modal.className = "modal-content-save";

  modal.innerHTML = `<p>Підтвердіть!!!</p>
    <div class="save-buttons">
      <button id="save-confirm" class="btn-save-confirm">Так</button>
      <input type="password" id="save-password-input" class="save-password-input" placeholder="Пароль" />
      <button id="save-cancel" class="btn-save-cancel">Ні</button>
    </div>`;

  overlay.appendChild(modal);
  return overlay;
}

export let currentTableName: string = "";

const clearInputAndReloadData = async () => {
  const searchInput = document.getElementById(
    "search-input-all_other_bases",
  ) as HTMLInputElement;
  if (searchInput) searchInput.value = "";

  const passwordInput = document.getElementById(
    "slusar-password",
  ) as HTMLInputElement;
  if (passwordInput) passwordInput.value = "";

  const dropdown = document.getElementById(
    "custom-dropdown-all_other_bases",
  ) as HTMLDivElement;
  if (dropdown) {
    dropdown.innerHTML = "";
    dropdown.classList.add("hidden-all_other_bases");
  }

  if (currentTableName) await loadDatabaseData(currentTableName);
};

export const loadDatabaseData = async (buttonText: string) => {
  currentTableName = buttonText;
};

function getInputValue(): string {
  const inputElement = document.getElementById(
    "search-input-all_other_bases",
  ) as HTMLInputElement;
  return inputElement ? inputElement.value.trim() : "";
}

async function getNextId(
  tableName: string,
  idField: string,
): Promise<number | null> {
  const { data: rows, error } = await supabase
    .from(tableName)
    .select(idField)
    .order(idField, { ascending: false })
    .limit(1);
  if (error) {
    // console.error("Помилка при отриманні максимального ID:", error);
    return null;
  }
  const first = rows?.[0] as Record<string, any>;
  return (first?.[idField] ?? 0) + 1;
}

function normalizeName(s: string) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Перевірка дублів для різних таблиць
async function checkDuplicateExists(
  tableName: string,
  value: string,
  idField?: string,
  currentId?: any,
): Promise<boolean> {
  try {
    const { data: rows, error } = await supabase.from(tableName).select("*");
    if (error) {
      // console.error(`Помилка перевірки дублів у ${tableName}:`, error);
      return false;
    }

    const needle = normalizeName(value);

    for (const row of rows ?? []) {
      // Якщо це редагування, пропускаємо поточний запис
      if (idField && currentId && row[idField] === currentId) {
        continue;
      }

      // Різна логіка для різних таблиць
      try {
        let nameToCheck = "";

        if (tableName === "shops" || tableName === "faktura") {
          const data =
            typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          nameToCheck = normalizeName(data?.Name ?? "");
        } else if (tableName === "details") {
          nameToCheck = normalizeName(row?.data ?? "");
        } else if (tableName === "slyusars") {
          const data =
            typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          nameToCheck = normalizeName(data?.Name ?? "");
        } else if (tableName === "robota" || tableName === "dherelo") {
          nameToCheck = normalizeName(row?.data ?? "");
        }

        if (nameToCheck && nameToCheck === needle) {
          return true;
        }
      } catch {}
    }
    return false;
  } catch (error) {
    // console.error(`Помилка при перевірці дублів у ${tableName}:`, error);
    return false;
  }
}

async function shopExistsByName(name: string): Promise<boolean> {
  return checkDuplicateExists("shops", name);
}

async function detailExistsByName(name: string): Promise<boolean> {
  return checkDuplicateExists("details", name);
}

async function performCrudOperation(): Promise<boolean> {
  if (!CRUD) {
    // console.error("Відсутня змінна CRUD");
    return false;
  }
  if (!all_bd) {
    // console.error("Відсутні дані all_bd");
    return false;
  }

  const inputValue = getInputValue();
  if ((CRUD === "Редагувати" || CRUD === "Додати") && !inputValue) {
    // console.error("Відсутнє значення в інпуті для операції:", CRUD);
    return false;
  }

  try {
    const data = JSON.parse(all_bd);
    const tableName = data.table;
    if (!tableName) {
      // console.error("Відсутня назва таблиці в all_bd");
      return false;
    }

    if (CRUD === "Редагувати" || CRUD === "Видалити") {
      data.record = { ...data };
    }

    switch (CRUD) {
      case "Редагувати":
        return await handleEdit(tableName, data, inputValue);
      case "Видалити":
        return await handleDelete(tableName, data);
      case "Додати":
        return await handleAdd(tableName, inputValue);
      default:
        // console.error("Невідомий CRUD режим:", CRUD);
        return false;
    }
  } catch (error) {
    // console.error("Помилка при обробці CRUD операції:", error);
    return false;
  }
}

async function handleEdit(
  tableName: string,
  data: any,
  newValue: string,
): Promise<boolean> {
  try {
    if (!data.record) {
      // console.error("Немає знайденого запису для редагування");
      return false;
    }

    const idField = Object.keys(data.record).find(
      (key) => key.includes("_id") || key === "id",
    );
    if (!idField) {
      // console.error("Не знайдено ID поле для редагування");
      return false;
    }

    const idValue = data.record[idField];

    // ✅ ЗАХИСТ: Заборона редагування Name та Доступ для slyusar_id = 1
    if (tableName === "slyusars" && idValue === 1) {
      const additionalData = getSlusarAdditionalData();

      // Отримуємо поточні дані з бази
      const { data: currentRecord, error: fetchError } = await supabase
        .from(tableName)
        .select("*")
        .eq(idField, idValue)
        .single();

      if (fetchError || !currentRecord) {
        // console.error("Помилка при отриманні запису:", fetchError);
        return false;
      }

      let currentData: any;
      try {
        currentData =
          typeof currentRecord.data === "string"
            ? JSON.parse(currentRecord.data)
            : currentRecord.data;
      } catch {
        currentData = {};
      }

      // Для slyusar_id = 1 зберігаємо оригінальні Name та Доступ
      const updateData: any = {
        data: {
          Name: currentData?.Name || "Тест", // Зберігаємо оригінальне ім'я
          Опис:
            currentData?.Опис && typeof currentData.Опис === "object"
              ? currentData.Опис
              : {},
          Історія:
            currentData?.Історія && typeof currentData.Історія === "object"
              ? currentData.Історія
              : {},
          ПроцентЗапчастин: additionalData.percentParts,
          Склад: additionalData.warehouse,
          Пароль: additionalData.password,
          Доступ: currentData?.Доступ || "Адміністратор", // Зберігаємо оригінальний доступ
        },
      };

      // Для Запчастиста встановлюємо ПроцентРоботи = 0
      // Для інших ролей зберігаємо ПроцентРоботи з форми
      const currentAccess = currentData?.Доступ;
      if (currentAccess !== "Запчастист") {
        updateData.data.ПроцентРоботи = additionalData.percent;
      } else {
        updateData.data.ПроцентРоботи = 0;
      }

      const { error } = await supabase
        .from(tableName)
        .update(updateData)
        .eq(idField, idValue);
      if (error) {
        // console.error("Помилка при редагуванні:", error);
        return false;
      }

      showNotification(
        "Дані оновлено. Name та Доступ адміністратора захищені від змін",
        "info",
      );
      return true;
    }

    const { data: currentRecord, error: fetchError } = await supabase
      .from(tableName)
      .select("*")
      .eq(idField, idValue)
      .single();

    if (fetchError || !currentRecord) {
      // console.error("Помилка при отриманні запису:", fetchError);
      return false;
    }

    let updateData: any = {};

    if (tableName === "slyusars") {
      const additionalData = getSlusarAdditionalData();

      let currentData: any;
      try {
        currentData =
          typeof currentRecord.data === "string"
            ? JSON.parse(currentRecord.data)
            : currentRecord.data;
      } catch {
        currentData = {};
      }

      updateData.data = {
        Name: (newValue || "").trim(),
        Опис:
          currentData?.Опис && typeof currentData.Опис === "object"
            ? currentData.Опис
            : {},
        Історія:
          currentData?.Історія && typeof currentData.Історія === "object"
            ? currentData.Історія
            : {},
        ПроцентЗапчастин: additionalData.percentParts,
        Склад: additionalData.warehouse,
        Пароль: additionalData.password,
        Доступ: additionalData.access,
      };

      // Для Запчастиста встановлюємо ПроцентРоботи = 0 (інпута немає)
      // Для інших ролей зберігаємо ПроцентРоботи з форми
      if (additionalData.access !== "Запчастист") {
        updateData.data.ПроцентРоботи = additionalData.percent;
      } else {
        updateData.data.ПроцентРоботи = 0;
      }
    } else if (
      tableName === "incomes" ||
      tableName === "receivers" ||
      tableName === "shops"
    ) {
      updateData.data = { Name: newValue };
    } else if (["works", "details"].includes(tableName)) {
      updateData.data = newValue;
    } else {
      // console.error("Невідома таблиця для редагування:", tableName);
      return false;
    }

    const { error } = await supabase
      .from(tableName)
      .update(updateData)
      .eq(idField, idValue);
    if (error) {
      // console.error("Помилка при редагуванні:", error);
      return false;
    }

    return true;
  } catch (error) {
    // console.error("Помилка при редагуванні:", error);
    return false;
  }
}

async function handleDelete(tableName: string, data: any): Promise<boolean> {
  try {
    if (!data.record) {
      // console.error("Немає знайденого запису для видалення");
      return false;
    }

    const idField = Object.keys(data.record).find(
      (key) => key.includes("_id") || key === "id",
    );
    if (!idField) {
      // console.error("Не знайдено ID поле для видалення");
      return false;
    }

    const idValue = data.record[idField];

    // ✅ ЗАХИСТ: Заборона видалення slyusar_id = 1
    if (tableName === "slyusars" && idValue === 1) {
      // console.error("Видалення адміністраторського акаунту заборонено!");
      showNotification(
        "Видалення адміністраторського акаунту заборонено!",
        "error",
      );
      return false;
    }

    const { error } = await supabase
      .from(tableName)
      .delete()
      .eq(idField, idValue);
    if (error) {
      // console.error("Помилка при видаленні:", error);
      return false;
    }

    return true;
  } catch (error) {
    // console.error("Помилка при видаленні:", error);
    return false;
  }
}

async function slusarExistsByName(name: string): Promise<boolean> {
  const { data: rows, error } = await supabase.from("slyusars").select("data");
  if (error) {
    // console.error("Помилка перевірки існування слюсаря:", error);
    return false;
  }
  const needle = normalizeName(name);
  for (const r of rows ?? []) {
    try {
      const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
      const nm = normalizeName(d?.Name ?? "");
      if (nm && nm === needle) return true;
    } catch {}
  }
  return false;
}

async function handleAdd(
  tableName: string,
  newValue: string,
): Promise<boolean> {
  try {
    const idFieldMap = {
      incomes: "income_id",
      receivers: "receiver_id",
      shops: "shop_id",
      slyusars: "slyusar_id",
      works: "work_id",
      details: "detail_id",
    } as const;

    type TableName = keyof typeof idFieldMap;
    const idField = idFieldMap[tableName as TableName];
    if (!idField) {
      // console.error("Невідома таблиця для отримання ID:", tableName);
      return false;
    }

    if (tableName === "shops" && (await shopExistsByName(newValue))) {
      return true;
    }
    if (tableName === "details" && (await detailExistsByName(newValue))) {
      return true;
    }
    if (tableName === "slyusars" && (await slusarExistsByName(newValue))) {
      return true;
    }

    const next = await getNextId(tableName, idField);
    if (next == null) return false;

    let insertData: any = { [idField]: next };

    if (tableName === "slyusars") {
      const additionalData = getSlusarAdditionalData();
      insertData.data = {
        Name: (newValue || "").trim(),
        Опис: {},
        Історія: {},
        ПроцентЗапчастин: additionalData.percentParts,
        Склад: additionalData.warehouse,
        Пароль: additionalData.password,
        Доступ: additionalData.access,
      };

      // Для Запчастиста НЕ додаємо ПроцентРоботи (встановлюємо 0)
      // Для інших ролей додаємо ПроцентРоботи
      if (additionalData.access !== "Запчастист") {
        insertData.data.ПроцентРоботи = additionalData.percent;
      } else {
        insertData.data.ПроцентРоботи = 0;
      }
    } else if (["incomes", "receivers", "shops"].includes(tableName)) {
      insertData.data = { Name: newValue };
    } else if (["works", "details"].includes(tableName)) {
      insertData.data = newValue;
    } else {
      // console.error("Невідома таблиця для додавання:", tableName);
      return false;
    }

    const { error } = await supabase
      .from(tableName)
      .insert(insertData)
      .select();
    if (error) {
      // console.error("Помилка при додаванні:", error);
      return false;
    }

    return true;
  } catch (error) {
    // console.error("❌ Помилка при додаванні:", error);
    return false;
  }
}

export function showSavePromptModal(): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = document.getElementById(savePromptModalId);
    if (!modal) return resolve(false);

    modal.style.display = "flex";

    const confirmBtn = document.getElementById("save-confirm")!;
    const cancelBtn = document.getElementById("save-cancel")!;

    const cleanup = () => {
      modal.style.display = "none";
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
    };

    const closeAllModals = () => {
      document
        .querySelectorAll(".modal-overlay-all_other_bases")
        .forEach((m) => m.classList.add("hidden-all_other_bases"));
    };

    const onConfirm = async () => {
      if (!CRUD) {
        cleanup();
        showNotification("Помилка: відсутня змінна CRUD", "error");
        resolve(false);
        return;
      }

      // ✅ ПЕРЕВІРКА ПАРОЛЯ
      const passwordInput = document.getElementById(
        "save-password-input",
      ) as HTMLInputElement;
      const enteredPassword = passwordInput?.value
        ? Number(passwordInput.value)
        : null;

      // Отримуємо дані поточного користувача з localStorage
      let currentUserName = "";
      let currentUserPassword: number | null = null;

      try {
        const userDataStr = localStorage.getItem("userAuthData");
        if (userDataStr) {
          const userData = JSON.parse(userDataStr);
          currentUserName = userData.Name || "";
          currentUserPassword = userData.Пароль
            ? Number(userData.Пароль)
            : null;
        }
      } catch (error) {
        // console.error("Помилка отримання даних користувача:", error);
      }

      // ✅ ПЕРЕВІРКА ПАРОЛЯ З LOCALSTORAGE
      if (!currentUserName || currentUserPassword === null) {
        showNotification("Помилка: дані користувача не знайдено", "error");
        return;
      }

      if (enteredPassword === null) {
        showNotification("Введіть пароль", "warning");
        return;
      }

      // Перевіряємо пароль з localStorage
      if (currentUserPassword !== enteredPassword) {
        showNotification("Невірний пароль", "error");
        // console.error("❌ Пароль не співпадає:", {
        // entered: enteredPassword,
        // stored: currentUserPassword,
        // });
        return;
      }

      // Якщо дійшли сюди - пароль правильний, продовжуємо

      let success = false;
      let errorMessage = "";

      try {
        // ✅ КРОК 1: Визначаємо таблицю
        let tableFromDraft = "";
        try {
          if (all_bd) {
            const parsed = JSON.parse(all_bd);
            tableFromDraft = parsed?.table ?? "";
          }
        } catch (err) {
          // console.error("Error parsing all_bd:", err);
        }

        // ✅ ПЕРЕВІРКА НА ДУБЛІ СПІВРОБІТНИКІВ при додаванні
        if (CRUD === "Додати" && tableFromDraft === "slyusars") {
          const searchInput = document.getElementById(
            "search-input-all_other_bases",
          ) as HTMLInputElement;
          const name = searchInput?.value?.trim();

          if (name) {
            const exists = await checkEmployeeExists(name);
            if (exists) {
              showNotification(
                `Співробітник "${name}" вже існує в базі даних`,
                "warning",
              );
              // Не закриваємо модальне вікно
              return;
            }
          }
        }

        // ✅ ОБРОБКА СЛЮСАРІВ (Редагування) - викликаємо saveSlusarData
        if (CRUD === "Редагувати" && tableFromDraft === "slyusars") {
          success = await saveSlusarData();

          cleanup();

          if (success) {
            showNotification("Дані успішно оновлено", "success");
            resetShopState();
            resetDetailState();
            await clearInputAndReloadData();
            document.dispatchEvent(new CustomEvent("other-base-data-updated"));

            // Очищуємо інпут пароля
            const passwordInput = document.getElementById(
              "save-password-input",
            ) as HTMLInputElement;
            if (passwordInput) {
              passwordInput.value = "";
            }

            resolve(true);
          } else {
            showNotification("Помилка при оновленні даних", "error");
            resolve(false);
          }
          return;
        }

        // ✅ КРОК 2: Якщо таблиця невідома, намагаємося визначити з форми
        if (!tableFromDraft) {
          const contragentForm = document.getElementById("contragent-form");
          if (contragentForm) {
            tableFromDraft = "faktura";
          }
        }

        const results: boolean[] = [];

        // ==========================================================
        // ✅ ОБРОБКА "FAKTURA" (КОНТРАГЕНТИ) - ПРІОРИТЕТ #1
        // ==========================================================
        if (tableFromDraft === "faktura") {
          const { tryHandleFakturaCrud } = await import("./inhi/contragent");
          const ok = await tryHandleFakturaCrud();
          results.push(ok);

          success = results.every(Boolean);

          if (success) {
            cleanup();
            resetShopState();
            resetDetailState();
            await clearInputAndReloadData();
            document.dispatchEvent(new CustomEvent("other-base-data-updated"));
          }
          // Якщо !success — модалка залишається відкритою, toast вже показано
          resolve(success);
          return;
        }
        // ==========================================================

        const catalogInput = document.getElementById(
          "sclad_detail_catno",
        ) as HTMLInputElement;
        const catalogNumber = catalogInput?.value?.trim() || "";

        if (CRUD === "Редагувати") {
          if (catalogNumber && tableFromDraft === "sclad") {
            const scladOk = await handleScladCrud();
            results.push(scladOk);
          } else if (!catalogNumber) {
            const shopsHandled = await tryHandleShopsCrud();
            const detailsHandled = await tryHandleDetailsCrud();

            if (shopsHandled !== null) results.push(shopsHandled);
            if (detailsHandled !== null) results.push(detailsHandled);
          } else {
            success = await performCrudOperation();
            cleanup();
            if (success) {
              showNotification("Операцію виконано успішно", "success");
              resetShopState();
              resetDetailState();
              await clearInputAndReloadData();
              document.dispatchEvent(
                new CustomEvent("other-base-data-updated"),
              );
            } else {
              closeAllModals();
              showNotification("Помилка при збереженні", "error");
            }
            resolve(success);
            return;
          }
        } else if (CRUD === "Видалити") {
          if (!catalogNumber) {
            const shopsHandled = await tryHandleShopsCrud();
            const detailsHandled = await tryHandleDetailsCrud();

            if (shopsHandled !== null) results.push(shopsHandled);
            if (detailsHandled !== null) results.push(detailsHandled);
          } else if (catalogNumber && tableFromDraft === "sclad") {
            const scladOk = await handleScladCrud();
            results.push(scladOk);
          } else {
            success = await performCrudOperation();
            cleanup();
            if (success) {
              showNotification("Операцію виконано успішно", "success");
              resetShopState();
              resetDetailState();
              await clearInputAndReloadData();
              document.dispatchEvent(
                new CustomEvent("other-base-data-updated"),
              );
            } else {
              closeAllModals();
              showNotification("Помилка при збереженні", "error");
            }
            resolve(success);
            return;
          }
        } else if (CRUD === "Додати") {
          if (!catalogNumber) {
            const shopsHandled = await tryHandleShopsCrud();
            const detailsHandled = await tryHandleDetailsCrud();

            if (shopsHandled !== null) results.push(shopsHandled);
            if (detailsHandled !== null) results.push(detailsHandled);
          } else if (catalogNumber && tableFromDraft === "sclad") {
            const shopsHandled = await tryHandleShopsCrud();
            const detailsHandled = await tryHandleDetailsCrud();

            if (shopsHandled !== null) results.push(shopsHandled);
            if (detailsHandled !== null) results.push(detailsHandled);

            const scladOk = await handleScladCrud();
            results.push(scladOk);
          } else {
            success = await performCrudOperation();
            cleanup();
            if (success) {
              showNotification("Операцію виконано успішно", "success");
              resetShopState();
              resetDetailState();
              await clearInputAndReloadData();
              document.dispatchEvent(
                new CustomEvent("other-base-data-updated"),
              );
            } else {
              closeAllModals();
              showNotification("Помилка при збереженні", "error");
            }
            resolve(success);
            return;
          }
        }

        if (results.length === 0) {
          success = await performCrudOperation();
        } else {
          success = results.every(Boolean);

          if (!success) {
            // silent: some operations failed
          }
        }
      } catch (err: any) {
        // console.error("CRUD operation error:", err);
        errorMessage = err.message || String(err);
        success = false;
      }

      cleanup();

      if (success) {
        showNotification("Операцію виконано успішно", "success");
        resetShopState();
        resetDetailState();
        await clearInputAndReloadData();
        document.dispatchEvent(new CustomEvent("other-base-data-updated"));

        // Очищуємо інпут пароля
        const passwordInput = document.getElementById(
          "save-password-input",
        ) as HTMLInputElement;
        if (passwordInput) {
          passwordInput.value = "";
        }

        resolve(true);
      } else {
        closeAllModals();
        const message = errorMessage
          ? `Помилка: ${errorMessage}`
          : "Помилка при збереженні";
        showNotification(message, "error");
        resolve(false);
      }
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
  });
}

export { clearInputAndReloadData };
