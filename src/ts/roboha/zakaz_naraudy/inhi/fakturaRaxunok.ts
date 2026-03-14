// src/ts/roboha/zakaz_naraudy/inhi/fakturaRaxunok.ts

import { supabase } from "../../../vxid/supabaseClient";
import { formatNumberWithSpaces } from "../globalCache";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { showNotification } from "./vspluvauhe_povidomlenna";
import {
  attachPageFormatControls,
  hideFormatControlsForPdf,
  showFormatControlsAfterPdf,
} from "./pageFormatControls";

export const INVOICE_PREVIEW_MODAL_ID = "invoice-preview-modal";

/* --- Допоміжні функції --- */

function getCurrentDateDDMMYYYY(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${day}.${month}.${year}`;
}

function getCurrentDateISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonthNameGenitive(month: number): string {
  const months = [
    "Січня",
    "Лютого",
    "Березня",
    "Квітня",
    "Травня",
    "Червня",
    "Липня",
    "Серпня",
    "Вересня",
    "Жовтня",
    "Листопада",
    "Грудня",
  ];
  return months[month];
}

function formatNumberWithZeros(num: number): string {
  return num.toString().padStart(7, "0");
}

function amountToWordsUA(amount: number): string {
  const UAH = Math.floor(amount);
  const kopecks = Math.round((amount - UAH) * 100);

  const ones = [
    "",
    "один",
    "два",
    "три",
    "чотири",
    "п'ять",
    "шість",
    "сім",
    "вісім",
    "дев'ять",
  ];
  const onesFeminine = [
    "",
    "одна",
    "дві",
    "три",
    "чотири",
    "п'ять",
    "шість",
    "сім",
    "вісім",
    "дев'ять",
  ];
  const teens = [
    "десять",
    "одинадцять",
    "дванадцять",
    "тринадцять",
    "чотирнадцять",
    "п'ятнадцять",
    "шістнадцять",
    "сімнадцять",
    "вісімнадцять",
    "дев'ятнадцять",
  ];
  const tens = [
    "",
    "",
    "двадцять",
    "тридцять",
    "сорок",
    "п'ятдесят",
    "шістдесят",
    "сімдесят",
    "вісімдесят",
    "дев'яносто",
  ];
  const hundreds = [
    "",
    "сто",
    "двісті",
    "триста",
    "чотириста",
    "п'ятсот",
    "шістсот",
    "сімсот",
    "вісімсот",
    "дев'ятсот",
  ];

  function convertGroup(n: number, isFeminine: boolean = false): string {
    if (n === 0) return "";
    let result = "";
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const o = n % 10;

    if (h > 0) result += hundreds[h] + " ";
    if (t === 1) {
      result += teens[o] + " ";
    } else {
      if (t > 1) result += tens[t] + " ";
      const oneWord = isFeminine ? onesFeminine[o] : ones[o];
      if (o > 0) result += oneWord + " ";
    }
    return result.trim();
  }

  function getForm(n: number, one: string, few: string, many: string): string {
    const lastDigit = n % 10;
    const lastTwo = n % 100;
    if (lastTwo >= 11 && lastTwo <= 19) return many;
    if (lastDigit === 1) return one;
    if (lastDigit >= 2 && lastDigit <= 4) return few;
    return many;
  }

  let words = "";
  if (UAH === 0) {
    words = "нуль гривень";
  } else {
    const thousands = Math.floor(UAH / 1000);
    const remainder = UAH % 1000;

    if (thousands > 0) {
      words += convertGroup(thousands, true) + " ";
      words += getForm(thousands, "тисяча", "тисячі", "тисяч") + " ";
    }
    if (remainder > 0) {
      words += convertGroup(remainder) + " ";
    }

    words += getForm(UAH, "гривня", "гривні", "гривень");
  }

  let kopecksWords = "";
  if (kopecks === 0) {
    kopecksWords = "00 копійок";
  } else {
    const kopStr = kopecks.toString().padStart(2, "0");
    if (kopecks < 10) {
      kopecksWords = `0${kopecks} ${getForm(
        kopecks,
        "копійка",
        "копійки",
        "копійок",
      )}`;
    } else if (kopecks <= 19) {
      kopecksWords =
        teens[kopecks - 10] +
        " " +
        getForm(kopecks, "копійка", "копійки", "копійок");
    } else {
      const t = Math.floor(kopecks / 10);
      const o = kopecks % 10;
      kopecksWords = tens[t];
      if (o > 0) kopecksWords += " " + ones[o];
      kopecksWords =
        kopecksWords.trim() +
        " " +
        getForm(kopecks, "копійка", "копійки", "копійок");
    }
    kopecksWords = kopStr + " " + kopecksWords.trim();
  }

  // ЗМІНА 1: Прибрано крапку в кінці
  return words.charAt(0).toUpperCase() + words.slice(1) + " " + kopecksWords;
}

/**
 * Отримує номер рахунку для поточного акту.
 * Джерело лічильника — таблиця faktura, стовпець namber
 * (обраний контрагент або запис де name містить "Брацлавець").
 */
async function getInvoiceNumber(
  currentActId: number,
  supplierFakturaId?: number | null,
): Promise<{ number: string; isNew: boolean }> {
  try {
    // Спочатку перевіряємо збережений номер в акті — якщо є, повертаємо його
    const { data: currentAct, error: currentError } = await supabase
      .from("acts")
      .select("contrAgent_raxunok")
      .eq("act_id", currentActId)
      .single();

    if (currentError) {
      // console.error("Помилка отримання поточного акту:", currentError);
    }

    if (currentAct?.contrAgent_raxunok) {
      return {
        number: formatNumberWithZeros(parseInt(currentAct.contrAgent_raxunok)),
        isNew: false,
      };
    }

    // Якщо номера ще немає і обрано контрагента — генеруємо новий namber + 1
    if (supplierFakturaId) {
      const { data: fakturaRow, error: fakturaError } = await supabase
        .from("faktura")
        .select("namber")
        .eq("faktura_id", supplierFakturaId)
        .single();

      if (fakturaError || !fakturaRow) {
        return { number: "0000001", isNew: true };
      }

      const currentNumber = parseInt(fakturaRow?.namber || "0");
      const nextNumber = currentNumber + 1;

      return {
        number: formatNumberWithZeros(nextNumber),
        isNew: true,
      };
    }

    return { number: "0000001", isNew: true };
  } catch (error) {
    // console.error("Помилка отримання номера рахунку:", error);
    return { number: "0000001", isNew: true };
  }
}

/**
 * Зберігає номер рахунку та faktura_id в базу даних.
 * Лічильник оновлюється в таблиці faktura (стовпець namber).
 */
async function saveInvoiceNumber(
  currentActId: number,
  invoiceNumber: string,
  isoDateString: string,
  fakturaId: number | null,
  supplierFakturaId?: number | null,
): Promise<boolean> {
  try {
    // 1) Оновлюємо лічильник у faktura.namber обраного контрагента
    if (supplierFakturaId) {
      const { data: fakturaRow, error: readError } = await supabase
        .from("faktura")
        .select("faktura_id, namber")
        .eq("faktura_id", supplierFakturaId)
        .single();

      if (!readError && fakturaRow) {
        const currentNamber = parseInt(fakturaRow.namber || "0");
        const newNum = parseInt(invoiceNumber);

        if (newNum > currentNamber) {
          await supabase
            .from("faktura")
            .update({ namber: newNum })
            .eq("faktura_id", fakturaRow.faktura_id);
        }
      }
    }

    // 2) Зберігаємо номер у поточному акті
    const { error: currentError } = await supabase
      .from("acts")
      .update({
        contrAgent_raxunok: parseInt(invoiceNumber),
        contrAgent_raxunok_data: isoDateString,
        faktura_id: fakturaId,
      })
      .eq("act_id", currentActId);

    if (currentError) {
      // console.error("❌ Помилка оновлення поточного акту:", currentError);
      return false;
    }

    return true;
  } catch (error) {
    // console.error("❌ Критична помилка збереження:", error);
    return false;
  }
}

export function getCurrentActDataFromDOM(): any {
  const modal = document.getElementById("zakaz_narayd-custom-modal");
  const actIdStr = modal?.getAttribute("data-act-id");
  if (!actIdStr) return null;

  const actId = Number(actIdStr);
  const clientCell = document.querySelector(
    ".zakaz_narayd-table.left tr:nth-child(2) td:nth-child(2)",
  );
  const client = clientCell?.textContent?.trim() || "Клієнт не вказаний";
  const tableBody = document.querySelector("#act-items-table-container tbody");
  const rows = tableBody ? Array.from(tableBody.querySelectorAll("tr")) : [];
  const items: any[] = [];

  // Зчитуємо відсоток знижки з поля #editable-discount
  const discountInput = document.getElementById(
    "editable-discount",
  ) as HTMLInputElement | null;
  const discountPercent =
    parseFloat(discountInput?.value?.replace(",", ".") || "0") || 0;
  const discountMultiplier =
    discountPercent > 0 ? 1 - discountPercent / 100 : 1;

  rows.forEach((row) => {
    const nameCell = row.querySelector('[data-name="name"]') as HTMLElement;
    const qtyCell = row.querySelector('[data-name="id_count"]') as HTMLElement;
    const priceCell = row.querySelector('[data-name="price"]') as HTMLElement;
    const sumCell = row.querySelector('[data-name="sum"]') as HTMLElement;

    const name = nameCell?.textContent?.trim() || "";
    const quantity =
      parseFloat(
        qtyCell?.textContent?.replace(/\s/g, "").replace(",", ".") || "0",
      ) || 0;
    const rawPrice =
      parseFloat(
        priceCell?.textContent?.replace(/\s/g, "").replace(",", ".") || "0",
      ) || 0;
    const rawSuma =
      parseFloat(
        sumCell?.textContent?.replace(/\s/g, "").replace(",", ".") || "0",
      ) || 0;

    // Застосовуємо знижку до ціни та суми
    const price = Math.round(rawPrice * discountMultiplier * 100) / 100;
    const suma = Math.round(rawSuma * discountMultiplier * 100) / 100;

    const itemType =
      (row as HTMLElement).getAttribute("data-item-type") || "work";

    if (name) {
      items.push({ name, quantity, price, suma, type: itemType });
    }
  });

  return { act_id: actId, client, items, discountPercent };
}

function getInvoiceRowBoundsPx(
  container: HTMLElement,
): Array<{ top: number; bottom: number }> {
  const tbody = container.querySelector(
    ".invoice-table tbody",
  ) as HTMLElement | null;
  if (!tbody) return [];

  const containerRect = container.getBoundingClientRect();

  return Array.from(tbody.querySelectorAll("tr")).map((tr) => {
    const r = (tr as HTMLElement).getBoundingClientRect();
    return {
      top: r.top - containerRect.top,
      bottom: r.bottom - containerRect.top,
    };
  });
}

/**
 * Отримує межі певного елемента відносно контейнера
 */
function getInvoiceElementBoundsPx(container: HTMLElement, selector: string) {
  const el = container.querySelector(selector) as HTMLElement | null;
  if (!el) return null;
  const containerRect = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const top = r.top - containerRect.top;
  const bottom = r.bottom - containerRect.top;
  return { top, bottom, height: bottom - top };
}

async function generateInvoicePdf(invoiceNumber: string): Promise<void> {
  const modalBody = document.querySelector(
    ".invoice-a4-container",
  ) as HTMLElement;
  if (!modalBody) {
    alert("Помилка: контейнер рахунку не знайдено.");
    return;
  }

  const controls = document.querySelector(".invoice-controls") as HTMLElement;
  const btnPrint = document.getElementById(
    "btn-print-invoice",
  ) as HTMLButtonElement;

  if (controls) controls.style.display = "none";
  hideFormatControlsForPdf(modalBody);

  // Ховаємо плаваючу кнопку голосового введення
  const voiceBtn = document.getElementById("voice-input-button") as HTMLElement;
  if (voiceBtn) voiceBtn.style.display = "none";

  // Зберігаємо оригінальні стилі
  const originalStyle = modalBody.style.cssText;

  // Налаштування для якісного скріншота
  modalBody.style.height = "auto";
  modalBody.style.minHeight = "auto";
  modalBody.style.overflow = "visible";
  modalBody.style.boxShadow = "none";

  try {
    const canvas = await html2canvas(modalBody, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
    });

    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    const pdf = new jsPDF("p", "mm", "a4");

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // Поля сторінки
    const marginTop = 10;
    const marginLeft = 0;
    const marginRight = 0;
    const marginBottom = 15;

    const contentWidthMm = pageWidth - marginLeft - marginRight;
    const contentHeightMm = pageHeight - marginTop - marginBottom;

    // Висота зображення у мм при масштабуванні по ширині
    const imgHeightMm = (canvas.height * contentWidthMm) / canvas.width;

    // Співвідношення одиниць виміру
    const domHeightPx = modalBody.scrollHeight;
    const canvasPxPerDomPx = canvas.height / domHeightPx;
    const mmPerCanvasPx = imgHeightMm / canvas.height;
    const mmPerDomPx = imgHeightMm / domHeightPx;

    // Отримуємо межі рядків таблиці
    const rowBounds = getInvoiceRowBoundsPx(modalBody);

    // Отримуємо межі секції "Всього на суму"
    const sumBounds = getInvoiceElementBoundsPx(modalBody, ".sum-in-words");

    // Отримуємо межі секції "Без ПДВ"
    const vatBounds = getInvoiceElementBoundsPx(modalBody, ".vat-note");

    // Отримуємо межі секції з підписом
    const signatureBounds = getInvoiceElementBoundsPx(
      modalBody,
      ".signature-section",
    );

    // Якщо все влазить на одну сторінку
    if (imgHeightMm <= contentHeightMm) {
      pdf.addImage(
        imgData,
        "JPEG",
        marginLeft,
        marginTop,
        contentWidthMm,
        imgHeightMm,
      );
    } else {
      // Багатосторінкова логіка
      let currentDomY = 0;
      let pageIndex = 0;

      while (currentDomY < domHeightPx - 1) {
        if (pageIndex > 0) {
          pdf.addPage();
        }

        // Максимальна висота, що влазить на сторінку (в DOM px)
        const pageMaxDomY = currentDomY + contentHeightMm / mmPerDomPx;

        // 1) Шукаємо останній повний рядок таблиці, що влазить
        let safeCutDomY = currentDomY;
        let foundRowBreak = false;

        for (let i = 0; i < rowBounds.length; i++) {
          if (rowBounds[i].bottom <= pageMaxDomY) {
            safeCutDomY = rowBounds[i].bottom;
            foundRowBreak = true;
          } else {
            break;
          }
        }

        // Якщо не знайшли підходящий розрив (рядок занадто високий)
        if (!foundRowBreak || safeCutDomY <= currentDomY) {
          safeCutDomY = Math.min(pageMaxDomY, domHeightPx);
        }

        // 2) Перевіряємо, чи може секція "Всього на суму" повністю влізти
        if (sumBounds) {
          const sumStartsOnThisPage =
            sumBounds.top >= currentDomY && sumBounds.top <= pageMaxDomY;
          if (sumStartsOnThisPage) {
            const remainingSpace = pageMaxDomY - safeCutDomY;
            if (sumBounds.height <= remainingSpace) {
              safeCutDomY = sumBounds.bottom;
            }
          }
        }

        // 3) Перевіряємо секцію "Без ПДВ"
        if (vatBounds) {
          const vatStartsOnThisPage =
            vatBounds.top >= currentDomY && vatBounds.top <= pageMaxDomY;
          if (vatStartsOnThisPage) {
            const remainingSpace = pageMaxDomY - safeCutDomY;
            if (vatBounds.height <= remainingSpace) {
              safeCutDomY = vatBounds.bottom;
            }
          }
        }

        // 4) Перевіряємо секцію з підписом
        if (signatureBounds) {
          const signatureStartsOnThisPage =
            signatureBounds.top >= currentDomY &&
            signatureBounds.top <= pageMaxDomY;
          if (signatureStartsOnThisPage) {
            const remainingSpace = pageMaxDomY - safeCutDomY;
            if (signatureBounds.height <= remainingSpace) {
              safeCutDomY = signatureBounds.bottom;
            }
          }
        }

        // 5) Ріжемо canvas
        const sourceYCanvas = Math.round(currentDomY * canvasPxPerDomPx);
        const sourceHCanvas = Math.round(
          (safeCutDomY - currentDomY) * canvasPxPerDomPx,
        );

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = canvas.width;
        tempCanvas.height = Math.max(1, sourceHCanvas);

        const tctx = tempCanvas.getContext("2d")!;
        tctx.drawImage(
          canvas,
          0,
          sourceYCanvas,
          canvas.width,
          sourceHCanvas,
          0,
          0,
          canvas.width,
          sourceHCanvas,
        );

        const sliceImg = tempCanvas.toDataURL("image/jpeg", 0.95);
        const sliceHeightMm = sourceHCanvas * mmPerCanvasPx;

        pdf.addImage(
          sliceImg,
          "JPEG",
          marginLeft,
          marginTop,
          contentWidthMm,
          sliceHeightMm,
        );

        currentDomY = safeCutDomY;
        pageIndex++;
      }
    }

    pdf.save(`Рахунок_СФ-${invoiceNumber}.pdf`);
  } catch (error) {
    // console.error("Помилка PDF:", error);
    alert("Не вдалося створити PDF.");
  } finally {
    // Повертаємо оригінальні стилі
    if (controls) controls.style.display = "flex";
    showFormatControlsAfterPdf(modalBody);
    if (voiceBtn) voiceBtn.style.display = "";
    modalBody.style.cssText = originalStyle;
    if (btnPrint) {
      btnPrint.classList.remove("loading");
      btnPrint.textContent = "📥 Завантажити";
    }
  }
}

/* --- РЕНДЕР МОДАЛКИ --- */

export async function renderInvoicePreviewModal(actData: any): Promise<void> {
  const oldModal = document.getElementById(INVOICE_PREVIEW_MODAL_ID);
  if (oldModal) oldModal.remove();

  let supplierName = "";
  let foundFakturaId: number | null = null;

  // Завантажуємо постачальника: обраний контрагент або faktura_id=1
  const supplierFakturaId = actData.overrideSupplierFakturaId || 1;
  try {
    const { data: fakturaData, error } = await supabase
      .from("faktura")
      .select("oderjyvach")
      .eq("faktura_id", supplierFakturaId)
      .single();

    if (error) {
      // console.error("Помилка завантаження даних постачальника:", error);
    } else if (fakturaData) {
      supplierName = fakturaData.oderjyvach || "";
    }
  } catch (err) {
    // console.error("Критична помилка:", err);
  }

  if (actData.client) {
    try {
      const { data: clientFaktura, error: clientError } = await supabase
        .from("faktura")
        .select("faktura_id")
        .ilike("oderjyvach", `%${actData.client.trim()}%`)
        .limit(1)
        .maybeSingle();

      if (clientError) {
        // console.error("Помилка пошуку фактури клієнта:", clientError);
      } else if (clientFaktura) {
        foundFakturaId = clientFaktura.faktura_id;
      } else {
      }
    } catch (err) {
      // console.error("Помилка при пошуку клієнта:", err);
    }
  }

  const recipientName = actData.client || "Одержувач не вказаний";

  const { number: invoiceNumber } = await getInvoiceNumber(
    actData.act_id,
    actData.overrideSupplierFakturaId,
  );

  const now = new Date();
  const dateString = `${now.getDate()} ${getMonthNameGenitive(
    now.getMonth(),
  )} ${now.getFullYear()} р.`;

  const dateForDisplay = getCurrentDateDDMMYYYY();

  const totalSum = actData.items.reduce(
    (sum: number, item: any) => sum + item.suma,
    0,
  );
  const totalSumWords = amountToWordsUA(totalSum);

  let rowsHtml = actData.items
    .map(
      (item: any, index: number) => `
      <tr data-item-type="${item.type || "work"}">
          <td class="col-num">${index + 1}</td>
          <td class="col-name">${item.name}</td>
          <td class="col-unit" contenteditable="true" title="Натисніть, щоб змінити">шт</td>
          <td class="col-qty">${item.quantity}</td>
          <td class="col-price">${formatNumberWithSpaces(item.price)}</td>
          <td class="col-sum">${formatNumberWithSpaces(item.suma)}</td>
      </tr>
  `,
    )
    .join("");

  rowsHtml += `
      <tr class="total-row">
          <td colspan="4" class="empty-cell"></td>
          <td class="total-label">Всього:</td>
          <td class="total-value">${formatNumberWithSpaces(totalSum)}</td>
      </tr>
  `;

  const modalHtml = `
  <div id="${INVOICE_PREVIEW_MODAL_ID}" class="invoice-preview-overlay" style="z-index: 2000;">
      <div class="invoice-a4-container">
          <div class="invoice-body">
              
              <table class="header-table">
                  <tr>
                      <td class="label-cell no-underline">Постачальник</td>
                      <td class="value-cell" contenteditable="true" title="Натисніть, щоб змінити">${supplierName}</td> 
                  </tr>
                  <tr>
                      <td class="label-cell">Одержувач</td>
                      <td class="value-cell" contenteditable="true" title="Натисніть, щоб змінити">${recipientName}</td>
                  </tr>
                  <tr>
                      <td class="label-cell">Платник</td>
                      <td class="value-cell">той самий</td>
                  </tr>
                  <tr>
                      <td class="label-cell">Замовлення</td>
                      <td class="value-cell">Без замовлення</td>
                  </tr>
              </table>

              <div class="invoice-title">
                  Рахунок-фактура № СФ-<span contenteditable="true" id="editable-invoice-number" title="Натисніть, щоб змінити номер">${invoiceNumber}</span><br>
                  від <span contenteditable="true" title="Натисніть, щоб змінити дату">${dateString}</span>
              </div>

              <table class="invoice-table">
                  <thead>
                      <tr>
                          <th>№</th>
                          <th>Назва</th>
                          <th>Од.</th>
                          <th>Кількість</th>
                          <th>Ціна без ПДВ</th>
                          <th>Сума без ПДВ</th>
                      </tr>
                  </thead>
                  <tbody>
                      ${rowsHtml}
                  </tbody>
              </table>
            <div class="sum-in-words">
               Всього на суму:<br>
               <span contenteditable="true" title="Натисніть, щоб змінити">${totalSumWords}</span>
            </div>
              <div class="vat-note">
                  Без ПДВ
              </div>

              <div class="signature-section">
                  <div class="sign-block" contenteditable="true" title="Натисніть, щоб змінити">
                      <span>Виписав(ла):</span>
                      <span class="line"></span>
                  </div>
              </div>
              <div class="invoice-controls">
                  <div class="invoice-controls__row invoice-controls__row--top">
                      <div class="doc-filter-group">
                          <button class="doc-filter-btn doc-filter-btn--all active" data-filter="all">✅ Все</button>
                          <button class="doc-filter-btn doc-filter-btn--detail" data-filter="detail">🔩 Деталі</button>
                          <button class="doc-filter-btn doc-filter-btn--work" data-filter="work">🔧 Послуги</button>
                      </div>
                      <select id="invoice-client-select" class="doc-client-select">
                          <option value="">— Оберіть платника —</option>
                      </select>
                  </div>
                  <div class="invoice-controls__row invoice-controls__row--bottom">
                      <button id="btn-add-invoice" class="btn-save">💾 Зберегти</button>
                      <button id="btn-print-invoice" class="btn-print">📥 Завантажити</button>
                  </div>
              </div>
          </div>
      </div>
  </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHtml);

  const overlay = document.getElementById(INVOICE_PREVIEW_MODAL_ID);
  if (overlay) {
    const a4Container = overlay.querySelector(
      ".invoice-a4-container",
    ) as HTMLElement;
    if (a4Container) {
      attachPageFormatControls(overlay, a4Container, {
        defaultAllTextSize: 10,
        defaultTableTextSize: 10,
        defaultCellPadding: 4,
        tableSelector: ".invoice-table",
      });
    }

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        overlay.remove();
      }
    });
  }

  const btnPrint = document.getElementById("btn-print-invoice");
  btnPrint?.addEventListener("click", () => {
    if (btnPrint) {
      btnPrint.textContent = "⏳ Генерація...";
      btnPrint.classList.add("loading");
    }

    setTimeout(() => {
      const editedNumber =
        document
          .getElementById("editable-invoice-number")
          ?.textContent?.trim() || invoiceNumber;
      generateInvoicePdf(editedNumber);
    }, 50);
  });

  const btnAdd = document.getElementById(
    "btn-add-invoice",
  ) as HTMLButtonElement;

  btnAdd?.addEventListener("click", async () => {
    btnAdd.disabled = true;
    btnAdd.textContent = "⏳ Збереження...";

    const dateForDB = getCurrentDateISO();
    const editedInvoiceNumber =
      document.getElementById("editable-invoice-number")?.textContent?.trim() ||
      invoiceNumber;

    const success = await saveInvoiceNumber(
      actData.act_id,
      editedInvoiceNumber,
      dateForDB,
      foundFakturaId,
      actData.overrideSupplierFakturaId,
    );

    if (success) {
      btnAdd.textContent = "✅ Збережено";
      btnAdd.style.backgroundColor = "#4caf50";

      showNotification(
        `Рахунок № СФ-${editedInvoiceNumber} від ${dateForDisplay} збережено`,
        "success",
        4000,
      );

      setTimeout(() => {
        btnAdd.textContent = "💾 Зберегти";
        btnAdd.disabled = false;
        btnAdd.style.backgroundColor = "";
        btnAdd.style.cursor = "pointer";
        btnAdd.style.opacity = "1";
      }, 2000);
    } else {
      showNotification("Помилка збереження (див. консоль)", "error");
      btnAdd.disabled = false;
      btnAdd.textContent = "💾 Зберегти";
    }
  });

  // --- Dropdown: вибір контрагента-одержувача з таблиці faktura ---
  const invoiceClientSelect = document.getElementById(
    "invoice-client-select",
  ) as HTMLSelectElement | null;
  if (invoiceClientSelect) {
    (async () => {
      try {
        const { data: fakturaList } = await supabase
          .from("faktura")
          .select("faktura_id, oderjyvach, prumitka")
          .not("prumitka", "is", null)
          .order("faktura_id", { ascending: true });
        if (fakturaList) {
          (
            fakturaList as Array<{
              faktura_id: number;
              oderjyvach: string | null;
              prumitka: string | null;
            }>
          ).forEach((row) => {
            if (!row.prumitka) return;
            const opt = document.createElement("option");
            opt.value = String(row.faktura_id);
            opt.textContent =
              row.prumitka.split("\n")[0].trim() || `ID ${row.faktura_id}`;
            opt.dataset.oderjyvach = row.oderjyvach || "";
            invoiceClientSelect.appendChild(opt);
          });
        }
      } catch {
        /* silent */
      }
    })();

    invoiceClientSelect.addEventListener("change", () => {
      const sel =
        invoiceClientSelect.options[invoiceClientSelect.selectedIndex];
      if (!sel?.value) return;
      const recipientCell = overlay?.querySelector(
        ".header-table tr:nth-child(2) .value-cell",
      ) as HTMLElement | null;
      if (recipientCell) {
        recipientCell.textContent =
          sel.dataset.oderjyvach || sel.textContent || "";
      }
    });
  }

  // --- Кнопки фільтру: Деталі / Послуги / Все ---
  function applyInvoiceFilter(filter: string): void {
    const tbody = overlay?.querySelector(".invoice-table tbody");
    if (!tbody) return;
    let visibleSum = 0;
    let visIdx = 1;
    Array.from(tbody.querySelectorAll("tr")).forEach((tr) => {
      if (tr.classList.contains("total-row")) return;
      const type = (tr as HTMLElement).dataset.itemType || "work";
      const show = filter === "all" || type === filter;
      (tr as HTMLElement).style.display = show ? "" : "none";
      if (show) {
        const sumCell = tr.querySelector(".col-sum");
        const val =
          parseFloat(
            sumCell?.textContent?.replace(/\s/g, "").replace(",", ".") || "0",
          ) || 0;
        visibleSum += val;
        const numCell = tr.querySelector(".col-num");
        if (numCell) numCell.textContent = String(visIdx++);
      }
    });
    const totalCell = tbody.querySelector(".total-value") as HTMLElement | null;
    if (totalCell) totalCell.textContent = formatNumberWithSpaces(visibleSum);
    const sumSpan = overlay?.querySelector(
      ".sum-in-words span[contenteditable]",
    ) as HTMLElement | null;
    if (sumSpan) sumSpan.textContent = amountToWordsUA(visibleSum);
  }

  const filterBtns = overlay?.querySelectorAll(".doc-filter-btn");
  filterBtns?.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      applyInvoiceFilter((btn as HTMLElement).dataset.filter || "all");
    });
  });
}
