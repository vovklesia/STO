// src\ts\roboha\dodatu_inchi_bazu\inhi\contragent.ts
import { supabase } from "../../../vxid/supabaseClient";
import { updateAllBd, all_bd, CRUD } from "../dodatu_inchi_bazu_danux";
import { setupEnterNavigationForFields } from "../../redahyvatu_klient_machuna/enter_navigation";
import { setupDropdownKeyboard } from "./sharedAutocomplete";

export interface ContragentRecord {
  faktura_id: number;
  name: string;
  oderjyvach: string;
  prumitka: string;
  data: string | null;
  namber: number | null;
}

export let contragentData: ContragentRecord[] = [];

const MAX_TEXTAREA_HEIGHT = 150;
const MONTH_NAMES = [
  "Січень",
  "Лютий",
  "Березень",
  "Квітень",
  "Травень",
  "Червень",
  "Липень",
  "Серпень",
  "Вересень",
  "Жовтень",
  "Листопад",
  "Грудень",
];

// ====== UTILITIES ======================================

function isoToDots(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!isNaN(d.getTime())) {
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  }
  const parts = iso.split("T")[0]?.split("-");
  if (parts?.length === 3) {
    return `${parts[2].padStart(2, "0")}.${parts[1].padStart(2, "0")}.${parts[0]}`;
  }
  return iso;
}

function dotsToISO(dots: string | null): string | null {
  if (!dots) return null;
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dots.trim());
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function autoResizeTextarea(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  if (element.scrollHeight > MAX_TEXTAREA_HEIGHT) {
    element.style.height = `${MAX_TEXTAREA_HEIGHT}px`;
    element.style.overflowY = "auto";
  } else {
    element.style.height = `${element.scrollHeight}px`;
    element.style.overflowY = "hidden";
  }
}

function toast(msg: string, color: string) {
  const note = document.createElement("div");
  note.textContent = msg;
  Object.assign(note.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    backgroundColor: color,
    color: "white",
    padding: "12px 24px",
    borderRadius: "8px",
    zIndex: "10001",
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
    fontSize: "14px",
    fontWeight: "500",
  });
  document.body.appendChild(note);
  setTimeout(() => note.remove(), 1800);
}

function getDraftFakturaId(): number | null {
  try {
    const parsed = all_bd ? JSON.parse(all_bd) : null;
    const id = parsed?.faktura_id ?? null;
    if (typeof id === "number") return id;
    if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
    return null;
  } catch {
    return null;
  }
}

// ====== DATA LOADING ===================================

export async function loadContragentData(): Promise<ContragentRecord[]> {
  try {
    const { data, error } = await supabase
      .from("faktura")
      .select("faktura_id, name, oderjyvach, prumitka, data, namber")
      .order("faktura_id", { ascending: true });

    if (error) {
      // console.error("Помилка завантаження контрагентів:", error);
      return [];
    }
    return (data as ContragentRecord[]) || [];
  } catch (err) {
    // console.error("Критична помилка завантаження:", err);
    return [];
  }
}

// ====== DATE PICKER ====================================

function createDatePicker(input: HTMLInputElement) {
  const calendar = document.createElement("div");
  calendar.className = "contragent-calendar";
  calendar.style.cssText = `
    position: absolute; background: white; border: 1px solid #ccc;
    border-radius: 6px; padding: 8px 8px 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000; display: none; width: 200px;
  `;

  const today = new Date();
  let currentYear = today.getFullYear();
  let currentMonth = today.getMonth();

  const header = document.createElement("div");
  header.style.cssText = `
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 4px; font-weight: bold; font-size: 12px;
  `;
  header.innerHTML = `
    <button type="button" class="cal-prev" style="border:none;background:none;cursor:pointer;font-size:11px;padding:1px 2px;">◀</button>
    <span class="cal-title" style="font-size:10px;">${MONTH_NAMES[currentMonth]} ${currentYear}</span>
    <button type="button" class="cal-next" style="border:none;background:none;cursor:pointer;font-size:11px;padding:1px 2px;">▶</button>
  `;

  const daysHeader = document.createElement("div");
  daysHeader.style.cssText = `
    display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;
    text-align: center; font-weight: bold; margin-bottom: 6px; font-size: 10px;
  `;
  daysHeader.innerHTML = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"]
    .map((d) => `<div style="padding:1px;">${d}</div>`)
    .join("");

  calendar.appendChild(header);
  calendar.appendChild(daysHeader);

  const renderDays = (year: number, month: number) => {
    const existingGrid = calendar.querySelector(".days-grid");
    if (existingGrid) existingGrid.remove();

    const grid = document.createElement("div");
    grid.className = "days-grid";
    grid.style.cssText = `display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; text-align: center;`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const offset = firstDay === 0 ? 6 : firstDay - 1;

    for (let i = 0; i < offset; i++) {
      grid.appendChild(document.createElement("div"));
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dayBtn = document.createElement("button");
      dayBtn.type = "button";
      dayBtn.textContent = String(day);
      dayBtn.style.cssText = `
        min-height: 22px; padding: 4px 0; border: 1px solid #ddd;
        border-radius: 4px; background: white; cursor: pointer;
        transition: all 0.2s; font-size: 12px; line-height: 1.1;
      `;

      const isToday =
        year === today.getFullYear() &&
        month === today.getMonth() &&
        day === today.getDate();
      if (isToday) {
        dayBtn.style.background = "#e6f0ff";
        dayBtn.style.borderColor = "#3b82f6";
        dayBtn.style.color = "#0b5cff";
      }

      dayBtn.addEventListener("mouseenter", () => {
        if (!isToday) dayBtn.style.background = "#e3f2fd";
      });
      dayBtn.addEventListener("mouseleave", () => {
        dayBtn.style.background = isToday ? "#e6f0ff" : "white";
      });

      dayBtn.addEventListener("click", () => {
        input.value = `${String(day).padStart(2, "0")}.${String(month + 1).padStart(2, "0")}.${year}`;
        calendar.style.display = "none";
      });

      grid.appendChild(dayBtn);
    }

    calendar.appendChild(grid);
  };

  renderDays(currentYear, currentMonth);

  const titleSpan = header.querySelector(".cal-title") as HTMLSpanElement;
  const prevBtn = header.querySelector(".cal-prev");
  const nextBtn = header.querySelector(".cal-next");

  prevBtn?.addEventListener("click", () => {
    currentMonth--;
    if (currentMonth < 0) {
      currentMonth = 11;
      currentYear--;
    }
    titleSpan.textContent = `${MONTH_NAMES[currentMonth]} ${currentYear}`;
    renderDays(currentYear, currentMonth);
  });

  nextBtn?.addEventListener("click", () => {
    currentMonth++;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear++;
    }
    titleSpan.textContent = `${MONTH_NAMES[currentMonth]} ${currentYear}`;
    renderDays(currentYear, currentMonth);
  });

  return calendar;
}

// ====== FORM MANAGEMENT ================================

export function clearFormFields() {
  const nameInput = document.getElementById(
    "contragent-name",
  ) as HTMLTextAreaElement;
  const receiverInput = document.getElementById(
    "contragent-receiver",
  ) as HTMLTextAreaElement;
  const noteInput = document.getElementById(
    "contragent-note",
  ) as HTMLTextAreaElement;
  const dateInput = document.getElementById(
    "contragent-date",
  ) as HTMLInputElement;

  if (nameInput) {
    nameInput.value = "";
    autoResizeTextarea(nameInput);
  }
  if (receiverInput) {
    receiverInput.value = "";
    autoResizeTextarea(receiverInput);
  }
  if (noteInput) {
    noteInput.value = "";
    autoResizeTextarea(noteInput);
  }
  if (dateInput) dateInput.value = "";
  updateAllBd(null);
}

export async function handleDhereloContragent() {
  // ✅ ВИПРАВЛЕННЯ: запускаємо завантаження даних паралельно з будуванням форми
  const contragentDataPromise = loadContragentData();

  const rightPanel = document.querySelector(
    ".modal-right-all_other_bases",
  ) as HTMLDivElement;
  if (!rightPanel) {
    // console.error("❌ Не знайдено правої панелі модального вікна");
    return;
  }

  const globalSearch = document.getElementById("global-search-wrap");
  if (globalSearch) {
    globalSearch.classList.add("hidden-all_other_bases");
  }

  const existing = document.getElementById("contragent-form");
  if (existing) existing.remove();

  const formContainer = document.createElement("div");
  formContainer.id = "contragent-form";
  formContainer.style.cssText =
    "display: flex; flex-direction: column; gap: 5px; padding: 0;";

  // Створення елементів форми
  const createTextarea = (id: string, label: string, placeholder: string) => {
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";

    const labelEl = document.createElement("label");
    labelEl.textContent = label;
    labelEl.style.cssText =
      "font-weight: 500; margin-bottom: 5px; display: block;";

    const textarea = document.createElement("textarea");
    textarea.id = id;
    textarea.className = "textarea-all_other_bases";
    textarea.placeholder = placeholder;
    textarea.autocomplete = "off";
    textarea.rows = 1;
    textarea.style.cssText = `
      resize: none; overflow-y: hidden; min-height: 38px;
      padding-top: 8px; line-height: 1.4; width: 100%; box-sizing: border-box;
    `;
    textarea.addEventListener("input", () => autoResizeTextarea(textarea));

    wrapper.appendChild(labelEl);
    wrapper.appendChild(textarea);
    return { wrapper, textarea };
  };

  // Одержувач (з dropdown)
  const receiverWrapper = document.createElement("div");
  receiverWrapper.style.position = "relative";

  const receiverLabel = document.createElement("label");
  receiverLabel.textContent = "Рахунок Одержувач:";
  receiverLabel.style.cssText =
    "font-weight: 500; margin-bottom: 5px; display: block;";

  const receiverInput = document.createElement("textarea");
  receiverInput.id = "contragent-receiver";
  receiverInput.className = "textarea-all_other_bases";
  receiverInput.placeholder = "Введіть одержувача...";
  receiverInput.autocomplete = "off";
  receiverInput.rows = 1;
  receiverInput.style.cssText = `
    resize: none; overflow-y: hidden; min-height: 38px;
    padding-top: 8px; line-height: 1.4; width: 100%; box-sizing: border-box;
  `;

  const receiverDropdown = document.createElement("div");
  receiverDropdown.className = "contragent-dropdown hidden-all_other_bases";
  receiverDropdown.style.cssText = `
    position: absolute; top: 100%; left: 0; right: 0; background: white;
    border: 1px solid #ccc; border-radius: 4px; max-height: 200px;
    overflow-y: auto; z-index: 999; box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  `;

  receiverWrapper.appendChild(receiverLabel);
  receiverWrapper.appendChild(receiverInput);
  receiverWrapper.appendChild(receiverDropdown);

  // Setup keyboard navigation
  setupDropdownKeyboard(receiverInput, receiverDropdown);

  // ЗАТВЕРДЖУЮ
  const { wrapper: nameWrapper, textarea: nameInput } = createTextarea(
    "contragent-name",
    "Акт ЗАТВЕРДЖУЮ:",
    "Введіть назву контрагента...",
  );

  // Від Замовника
  const { wrapper: noteWrapper, textarea: noteInput } = createTextarea(
    "contragent-note",
    "Акт Від Замовника:",
    "Введіть примітку...",
  );

  // Дата і кнопка
  const dateAndButtonWrapper = document.createElement("div");
  dateAndButtonWrapper.className = "contragent-date-act-wrapper";

  const dateWrapper = document.createElement("div");
  dateWrapper.className = "contragent-date-wrapper";

  const dateLabel = document.createElement("label");
  dateLabel.textContent = "Дата:";
  dateLabel.className = "contragent-date-label";

  const dateInput = document.createElement("input");
  dateInput.type = "text";
  dateInput.id = "contragent-date";
  dateInput.className = "input-all_other_bases contragent-date-input";
  dateInput.placeholder = "Оберіть дату...";
  dateInput.readOnly = true;

  const calendar = createDatePicker(dateInput);
  dateWrapper.appendChild(dateLabel);
  dateWrapper.appendChild(dateInput);
  dateWrapper.appendChild(calendar);

  // Перемикач-повзунок Отримувач / Платник
  const toggleWrapper = document.createElement("div");
  toggleWrapper.className = "recipient-toggle-wrapper";

  const labelLeft = document.createElement("span");
  labelLeft.className =
    "recipient-toggle-label recipient-toggle-label--left active";
  labelLeft.textContent = "Платник";

  const switchOuter = document.createElement("div");
  switchOuter.className = "recipient-switch";
  switchOuter.id = "contragent-recipient-toggle";
  switchOuter.dataset.active = "false";

  const switchKnob = document.createElement("div");
  switchKnob.className = "recipient-switch__knob";
  switchOuter.appendChild(switchKnob);

  const labelRight = document.createElement("span");
  labelRight.className = "recipient-toggle-label recipient-toggle-label--right";
  labelRight.textContent = "Отримувач";

  // Інпут для номера (namber)
  const namberInput = document.createElement("input");
  namberInput.type = "number";
  namberInput.id = "contragent-namber";
  namberInput.className = "input-all_other_bases contragent-namber-input";
  namberInput.placeholder = "№ акту...";
  namberInput.style.display = "none";

  switchOuter.addEventListener("click", () => {
    const isActive = switchOuter.dataset.active === "true";
    switchOuter.dataset.active = isActive ? "false" : "true";
    switchOuter.classList.toggle("active", !isActive);
    labelLeft.classList.toggle("active", isActive);
    labelRight.classList.toggle("active", !isActive);
    // Показати інпут namber при Отримувач, приховати при Платник
    namberInput.style.display = !isActive ? "" : "none";
  });

  toggleWrapper.appendChild(labelLeft);
  toggleWrapper.appendChild(switchOuter);
  toggleWrapper.appendChild(labelRight);
  toggleWrapper.appendChild(namberInput);

  dateAndButtonWrapper.appendChild(dateWrapper);
  dateAndButtonWrapper.appendChild(toggleWrapper);

  // Функція заповнення форми
  const fillFormWithContragent = (item: ContragentRecord) => {
    receiverInput.value = item.oderjyvach || "";
    autoResizeTextarea(receiverInput);

    nameInput.value = item.name;
    autoResizeTextarea(nameInput);

    noteInput.value = item.prumitka || "";
    autoResizeTextarea(noteInput);

    dateInput.value = isoToDots(item.data);

    namberInput.value = item.namber != null ? String(item.namber) : "";

    receiverDropdown.classList.add("hidden-all_other_bases");

    updateAllBd(
      JSON.stringify({
        table: "faktura",
        faktura_id: item.faktura_id,
        name: item.name,
        oderjyvach: item.oderjyvach,
        prumitka: item.prumitka,
        data: item.data,
      }),
    );
  };

  // Оновлення dropdown
  const updateReceiverDropdown = (query: string) => {
    receiverDropdown.innerHTML = "";
    const filtered = contragentData
      .filter((item) => item.oderjyvach?.toLowerCase().includes(query))
      .slice(0, 50);

    if (!filtered.length) {
      receiverDropdown.classList.add("hidden-all_other_bases");
      return;
    }

    filtered.forEach((item) => {
      const option = document.createElement("div");
      option.className = "contragent-dropdown-item custom-dropdown-item";
      option.style.cssText = `
        padding: 10px; cursor: pointer; border-bottom: 1px solid #eee; transition: background 0.2s;
      `;
      option.textContent = item.oderjyvach;

      option.addEventListener("mouseenter", () => {
        option.classList.add("selected");
        option.style.background = "#e3f2fd";
        Array.from(receiverDropdown.children).forEach((child) => {
          if (child !== option) {
            child.classList.remove("selected");
            (child as HTMLElement).style.background = "white";
          }
        });
      });

      const onSelect = (e?: Event) => {
        if (e && e.type === "mousedown") e.preventDefault();
        fillFormWithContragent(item);
      };
      option.addEventListener("mousedown", onSelect);
      option.addEventListener("click", onSelect);
      receiverDropdown.appendChild(option);
    });
    receiverDropdown.classList.remove("hidden-all_other_bases");
  };

  // Обробники подій
  receiverInput.addEventListener("input", () => {
    const query = receiverInput.value.toLowerCase().trim();
    autoResizeTextarea(receiverInput);
    updateReceiverDropdown(query);
    if (!query) {
      nameInput.value = "";
      autoResizeTextarea(nameInput);
      noteInput.value = "";
      autoResizeTextarea(noteInput);
      dateInput.value = "";
      updateAllBd(null);
    }
  });

  receiverInput.addEventListener("click", (e) => {
    e.stopPropagation();
    updateReceiverDropdown(receiverInput.value.toLowerCase().trim());
  });

  document.addEventListener("click", (e) => {
    if (!receiverWrapper.contains(e.target as Node)) {
      receiverDropdown.classList.add("hidden-all_other_bases");
    }
  });

  dateInput.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".contragent-calendar").forEach((cal) => {
      if (cal !== calendar) (cal as HTMLElement).style.display = "none";
    });
    receiverDropdown.classList.add("hidden-all_other_bases");

    const isVisible = calendar.style.display === "block";
    if (isVisible) {
      calendar.style.display = "none";
      return;
    }

    calendar.style.display = "block";
    calendar.style.left = "0";
    calendar.style.top = "auto";
    calendar.style.bottom = `${dateInput.offsetHeight + 5}px`;

    const calRect = calendar.getBoundingClientRect();
    if (calRect.top < 0) {
      calendar.style.bottom = "auto";
      calendar.style.top = `${dateInput.offsetHeight + 5}px`;
    }
  });

  document.addEventListener("click", (e) => {
    if (!dateWrapper.contains(e.target as Node)) {
      calendar.style.display = "none";
    }
  });

  // Додаємо елементи до форми
  formContainer.appendChild(receiverWrapper);
  formContainer.appendChild(nameWrapper);
  formContainer.appendChild(noteWrapper);
  formContainer.appendChild(dateAndButtonWrapper);

  // Додаємо кнопку до контейнера кнопок
  const buttonsDiv = rightPanel.querySelector(
    ".yes-no-buttons-all_other_bases",
  );
  if (buttonsDiv) {
    (buttonsDiv as HTMLElement).style.display = "flex";
    (buttonsDiv as HTMLElement).style.justifyContent = "flex-end";
    (buttonsDiv as HTMLElement).style.width = "100%";

    rightPanel.insertBefore(formContainer, buttonsDiv);
  } else {
    rightPanel.appendChild(formContainer);
  }

  // Налаштування навігації Enter між полями
  setupEnterNavigationForFields([
    "contragent-receiver",
    "contragent-name",
    "contragent-note",
    "contragent-date",
  ]);

  // ✅ Отримуємо дані контрагентів (паралельно з побудовою форми)
  contragentData = await contragentDataPromise;
}

export function clearContragentForm() {
  const form = document.getElementById("contragent-form");
  if (form) form.remove();

  document.querySelectorAll(".contragent-calendar").forEach((cal) => {
    (cal as HTMLElement).style.display = "none";
  });

  contragentData = [];
  updateAllBd(null);
}

// ====== CRUD ===========================================

async function getNextFakturaId(): Promise<number | null> {
  const { data, error } = await supabase
    .from("faktura")
    .select("faktura_id")
    .order("faktura_id", { ascending: false })
    .limit(1);

  if (error) {
    // console.error("Помилка отримання наступного faktura_id:", error);
    return null;
  }
  const max = (data?.[0]?.faktura_id ?? 0) as number;
  return max + 1;
}

function readFakturaFormPayload() {
  const nameEl = document.getElementById(
    "contragent-name",
  ) as HTMLTextAreaElement | null;
  const receiverEl = document.getElementById(
    "contragent-receiver",
  ) as HTMLTextAreaElement | null;
  const noteEl = document.getElementById(
    "contragent-note",
  ) as HTMLTextAreaElement | null;
  const dateEl = document.getElementById(
    "contragent-date",
  ) as HTMLInputElement | null;

  const name = (nameEl?.value ?? "").trim();
  const oderjyvach = (receiverEl?.value ?? "").trim();
  const prumitka = (noteEl?.value ?? "").trim();
  const data = dotsToISO((dateEl?.value ?? "").trim());

  return { name, oderjyvach, prumitka, data };
}

export async function tryHandleFakturaCrud(): Promise<boolean> {
  const mode = CRUD;
  const payload = readFakturaFormPayload();

  try {
    // ========== ДОДАВАННЯ ==========
    if (mode === "Додати") {
      if (!payload.name) {
        toast("⚠️ Заповніть назву контрагента", "#ff9800");
        return false;
      }

      // Перевірка на дублікат за IBAN у prumitka
      const ibanMatch = payload.prumitka.match(/UA\d{27}/);
      if (ibanMatch) {
        const iban = ibanMatch[0];
        const { data: existing } = await supabase
          .from("faktura")
          .select("faktura_id")
          .like("prumitka", `%${iban}%`)
          .limit(1);

        if (existing && existing.length > 0) {
          toast(`⚠️ Контрагент з IBAN ${iban} вже існує`, "#ff9800");
          return false;
        }
      }

      const nextId = await getNextFakturaId();
      if (nextId == null) {
        toast("❌ Помилка отримання наступного ID", "#f44336");
        return false;
      }

      const recipientToggle = document.getElementById(
        "contragent-recipient-toggle",
      ) as HTMLElement | null;
      const isRecipientActive = recipientToggle?.dataset.active === "true";
      const namberEl = document.getElementById(
        "contragent-namber",
      ) as HTMLInputElement | null;

      const ins: Record<string, any> = { faktura_id: nextId, ...payload };
      if (isRecipientActive) {
        // Отримувач — записуємо число з інпуту
        const nVal = namberEl?.value?.trim();
        if (nVal !== "" && nVal != null) {
          ins.namber = parseInt(nVal, 10);
        } else {
          ins.namber = null;
        }
      }

      const { error } = await supabase.from("faktura").insert(ins).select();

      if (error) {
        // console.error("❌ Помилка додавання в faktura:", error);
        toast(`❌ Помилка додавання: ${error.message}`, "#f44336");
        return false;
      }

      toast("✅ Контрагента успішно додано", "#4caf50");
      contragentData = await loadContragentData();
      return true;
    }

    // ========== РЕДАГУВАННЯ / ВИДАЛЕННЯ ==========
    const faktura_id = getDraftFakturaId();

    if (!faktura_id) {
      // console.error("❌ faktura_id відсутній. all_bd:", all_bd);
      toast("⚠️ Не знайдено faktura_id для операції", "#ff9800");
      return false;
    }

    if (mode === "Редагувати") {
      const recipientToggleEdit = document.getElementById(
        "contragent-recipient-toggle",
      ) as HTMLElement | null;
      const namberElEdit = document.getElementById(
        "contragent-namber",
      ) as HTMLInputElement | null;
      const updatePayload: Record<string, any> = { ...payload };

      if (recipientToggleEdit?.dataset.active === "true") {
        // Отримувач — записуємо число з інпуту
        const nVal = namberElEdit?.value?.trim();
        if (nVal !== "" && nVal != null) {
          updatePayload.namber = parseInt(nVal, 10);
        } else {
          updatePayload.namber = null;
        }
      }

      const { error } = await supabase
        .from("faktura")
        .update(updatePayload)
        .eq("faktura_id", faktura_id)
        .select();

      if (error) {
        // console.error("❌ Помилка редагування faktura:", error);
        toast(`❌ Помилка редагування: ${error.message}`, "#f44336");
        return false;
      }

      toast("✅ Контрагента успішно відредаговано", "#4caf50");
      contragentData = await loadContragentData();
      return true;
    }

    if (mode === "Видалити") {
      const { error } = await supabase
        .from("faktura")
        .delete()
        .eq("faktura_id", faktura_id);

      if (error) {
        // console.error("❌ Помилка видалення faktura:", error);
        toast(`❌ Помилка видалення: ${error.message}`, "#f44336");
        return false;
      }

      toast("✅ Контрагента успішно видалено", "#4caf50");
      contragentData = await loadContragentData();
      return true;
    }

    toast("❌ Невідомий режим CRUD", "#f44336");
    return false;
  } catch (e: any) {
    // console.error("❌ Faktura CRUD error:", e);
    toast(e?.message || "❌ Невідома помилка", "#f44336");
    return false;
  }
}
