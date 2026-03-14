export const savePromptModalId = "save-prompt-modal";
import { supabase } from "../../vxid/supabaseClient";
import {
  getModalFormValues,
  userConfirmation,
  formSnapshot,
} from "./vikno_klient_machuna";
import { showNotification } from "../zakaz_naraudy/inhi/vspluvauhe_povidomlenna";

// Створює модальне вікно підтвердження збереження
export function createSavePromptModal(): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.id = savePromptModalId;
  overlay.className = "modal-overlay-save";
  overlay.style.display = "none";

  const modal = document.createElement("div");
  modal.className = "modal-content-save";
  modal.innerHTML = `
    <p>Зберегти зміни?</p>
    <div class="save-buttons">
      <button id="save-confirm" class="btn-save-confirm">Так</button>
      <button id="save-cancel" class="btn-save-cancel">Ні</button>
    </div>
  `;
  overlay.appendChild(modal);
  return overlay;
}

// Показує модальне підтвердження з обіцянкою
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

    const onConfirm = () => {
      cleanup();
      showNotification("Дані успішно збережено", "success");
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      showNotification("Скасовано користувачем", "warning");
      resolve(false);
    };

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
  });
}

// Видаляє авто з бази (якщо є акти — soft delete, якщо ні — hard delete)
async function deleteCarFromDatabase(carsId: string): Promise<void> {
  // Перевіряємо чи є акти у цього авто
  const { count } = await supabase
    .from("acts")
    .select("act_id", { count: "exact", head: true })
    .eq("cars_id", carsId);

  if (count && count > 0) {
    // Є акти — м'яке видалення
    await supabase
      .from("cars")
      .update({ is_deleted: true })
      .eq("cars_id", carsId);
  } else {
    // Немає актів — фізичне видалення
    await supabase.from("cars").delete().eq("cars_id", carsId);
  }
}

// Додає авто до клієнта
async function addCarToDatabase(
  clientId: string,
  carData: any,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("cars")
    .insert({
      client_id: clientId,
      data: {
        Авто: carData.carModel,
        "Номер авто": carData.carNumber,
        Обʼєм: carData.engine,
        Пальне: carData.fuel,
        Vincode: carData.vin,
        Рік: carData.year,
        КодДВЗ: carData.carCode,
      },
    })
    .select("cars_id")
    .single();

  if (error) {
    // console.error("❌ Помилка додавання автомобіля:", error.message);
    return null;
  } else {
    return data?.cars_id || null;
  }
}

// Головна функція збереження (працює відповідно до ❌ ➕ 🔁)
export async function saveClientAndCarToDatabase(): Promise<{
  client_id: string | null;
  cars_id: string | null;
}> {
  const values = getModalFormValues();
  if (!values.fullName || !values.phone) {
    // console.error("❌ Обов'язкові поля (ПІБ, Телефон) не заповнені");
    return { client_id: null, cars_id: null };
  }

  // ❌ Видалення автомобіля
  if (userConfirmation === "no" && values.cars_id) {
    await deleteCarFromDatabase(values.cars_id);
    return { client_id: values.client_id || null, cars_id: null };
  }

  // ➕ Створення нового автомобіля або зв'язування з існуючим клієнтом
  if (userConfirmation === "yes") {
    let finalClientId: string | null = null;
    let finalCarId: string | null = null;

    // Перевіряємо по selectedClientId (client_id), а не по ПІБ
    if (values.client_id) {
      const { data: existingClient, error: fetchError } = await supabase
        .from("clients")
        .select("client_id")
        .eq("client_id", values.client_id)
        .single();

      if (!fetchError && existingClient) {
        // Клієнт існує — додаємо лише авто
        finalClientId = existingClient.client_id;
        finalCarId = await addCarToDatabase(finalClientId!, values);
        return { client_id: finalClientId, cars_id: finalCarId };
      }
    }

    // Клієнта немає або client_id не вказаний — створюємо нового
    const { data: insertedClient, error: insertClientError } = await supabase
      .from("clients")
      .insert({
        data: {
          ПІБ: values.fullName,
          Телефон: values.phone,
          Джерело: values.income,
          Додаткові: values.extra,
        },
      })
      .select("client_id")
      .single();

    if (insertClientError || !insertedClient?.client_id) {
      return { client_id: null, cars_id: null };
    }

    finalClientId = insertedClient.client_id;
    finalCarId = await addCarToDatabase(finalClientId!, values);
    return { client_id: finalClientId, cars_id: finalCarId };
  }

  // 🔁 Оновлення клієнта і автомобіля (тільки змінені поля)
  if (userConfirmation === null && values.client_id) {
    if (!values.client_id || !values.cars_id) {
      return { client_id: null, cars_id: null };
    }

    // Порівнюємо зі снепшотом, визначаємо що змінилось
    const snap = formSnapshot;
    const clientChanged =
      !snap ||
      values.fullName !== snap.fullName ||
      values.phone !== snap.phone ||
      values.income !== snap.income ||
      values.extra !== snap.extra;

    const carChanged =
      !snap ||
      values.carModel !== snap.carModel ||
      values.carNumber !== snap.carNumber ||
      values.engine !== snap.engine ||
      values.fuel !== snap.fuel ||
      values.vin !== snap.vin ||
      values.year !== snap.year ||
      values.carCode !== snap.carCode;

    if (!clientChanged && !carChanged) {
      showNotification("Немає змін для збереження", "warning");
      return { client_id: values.client_id, cars_id: values.cars_id };
    }

    if (clientChanged) {
      const { error: clientError } = await supabase
        .from("clients")
        .update({
          data: {
            ПІБ: values.fullName,
            Телефон: values.phone,
            Джерело: values.income,
            Додаткові: values.extra,
          },
        })
        .eq("client_id", values.client_id);

      if (clientError) {
        // console.error("❌ Помилка оновлення клієнта:", clientError.message);
      }
    }

    if (carChanged && values.cars_id) {
      const { error: carError } = await supabase
        .from("cars")
        .update({
          data: {
            Авто: values.carModel,
            "Номер авто": values.carNumber,
            Обʼєм: values.engine,
            Пальне: values.fuel,
            Vincode: values.vin,
            Рік: values.year,
            КодДВЗ: values.carCode,
          },
        })
        .eq("cars_id", values.cars_id);

      if (carError) {
        // console.error("❌ Помилка оновлення авто:", carError.message);
      }
    }

    return { client_id: values.client_id, cars_id: values.cars_id || null };
  }

  // console.warn("⚠️ Незрозумілий стан або не вистачає ID. Дані не збережено.");
  return { client_id: null, cars_id: null };
}
