//src\ts\roboha\planyvannya\planyvannya.ts

import { supabase } from "../../vxid/supabaseClient";
import { PostModal, type PostData } from "./planyvannya_post";
import { PostArxiv } from "./planyvannya_arxiv"; // Import new class
import { PlanyvannyaModal, type ReservationData } from "./planyvannya_modal";
import { showNotification } from "../zakaz_naraudy/inhi/vspluvauhe_povidomlenna";
import { checkCurrentPageAccess } from "../zakaz_naraudy/inhi/page_access_guard";
import { redirectToIndex } from "../../utils/gitUtils";
import { initPostArxivRealtimeSubscription } from "./planyvannya_realtime";

interface Post {
  id: number;
  postId: number; // post_id з таблиці post_name
  title: string;
  subtitle: string;
  namber: number;
}

interface Section {
  id: number;
  realCategoryId: string;
  name: string;
  collapsed: boolean;
  posts: Post[];
}

interface Sluysar {
  slyusar_id: number;
  sluysar_name: string;
  namber: number;
  post_name: string;
  post_id: number; // post_id для збереження в post_sluysar
  category: string;
}

// Інтерфейс для відстеження позицій
interface PositionData {
  slyusar_id: number;
  post_id: number; // post_id для збереження в post_sluysar
  original_namber: number;
  current_namber: number;
  slyusar_name?: string; // Для пошуку при створенні нового
  post_title?: string; // Для пошуку post_id
}

interface DayOccupancyStats {
  date: string;
  postOccupancy: Map<number, number>; // post_id -> хвилини завантаження
  totalPosts: number; // Загальна кількість всіх постів
}

class SchedulerApp {
  private sections: Section[] = [];
  private editMode: boolean = false;
  private isWeekView: boolean = true;

  private today: Date;
  private selectedDate: Date;
  private viewYear: number;
  private viewMonth: number;

  private schedulerWrapper: HTMLElement | null;
  private calendarGrid: HTMLElement | null;
  private headerDateDisplay: HTMLElement | null;
  private timeHeader: HTMLElement | null;
  private calendarContainer: HTMLElement | null;
  private editModeBtn: HTMLElement | null;

  // Модалки
  private postModal: PostModal;

  // PostArxiv для управління блоками бронювання
  private postArxiv: PostArxiv | null = null;

  // Drag and Drop
  private draggedElement: HTMLElement | null = null;
  private draggedSectionId: number | null = null;
  private draggedPostId: number | null = null;
  private dragPlaceholder: HTMLElement | null = null;

  // Maps for lookup
  private postTitleToIdMap = new Map<string, number>();
  private slyusarNameToIdMap = new Map<string, number>();

  // Position Tracking - відстеження позицій
  private initialPositions: PositionData[] = [];
  private deletedSlyusarIds: number[] = [];

  // Статистика зайнятості днів
  private monthOccupancyStats: Map<string, DayOccupancyStats> = new Map();

  // Тижневий вид — модалка та drag-створення
  private weekModal: PlanyvannyaModal;
  private weekDragActive: boolean = false;
  private weekDragStartX: number = 0;
  private weekDragCurrentX: number = 0;
  private weekDragCell: HTMLElement | null = null;
  private weekSelectionEl: HTMLElement | null = null;

  // Тижневий вид — drag переміщення блоків
  private weekMovingBlock: HTMLElement | null = null;
  private weekMovingOriginalCell: HTMLElement | null = null;
  private weekMovingOriginalLeft: string = "";
  private weekMovingOriginalWidth: string = "";
  private weekMovingOriginalTimeText: string = "";
  private weekBlockDragStartX: number = 0;
  private weekBlockDragStartY: number = 0;
  private weekBlockDragOffsetX: number = 0;
  private weekIsBlockDragging: boolean = false;

  // Тижневий вид — resize блоків
  private weekIsResizing: boolean = false;
  private weekResizeHandleSide: "left" | "right" | null = null;
  private weekResizingBlock: HTMLElement | null = null;
  private weekResizeOrigStartMins: number = 0;
  private weekResizeOrigEndMins: number = 0;
  private weekResizeStartX: number = 0;

  constructor() {
    this.today = new Date();
    this.today.setHours(0, 0, 0, 0);

    this.selectedDate = new Date(this.today);
    this.viewYear = this.today.getFullYear();
    this.viewMonth = this.today.getMonth();

    this.schedulerWrapper = document.getElementById("postSchedulerWrapper");
    this.calendarGrid = document.getElementById("postCalendarGrid");
    this.headerDateDisplay = document.getElementById("postHeaderDateDisplay");
    this.timeHeader = document.getElementById("postTimeHeader");
    this.calendarContainer = document.getElementById("postCalendarContainer");
    this.editModeBtn = document.getElementById("postEditModeBtn");

    // Ініціалізація модалок
    this.postModal = new PostModal();
    this.weekModal = new PlanyvannyaModal();

    // Initialize PostArxiv
    // We expect the container to exist because this runs on DOMContentLoaded
    try {
      this.postArxiv = new PostArxiv("postCalendarGrid");
    } catch (e) {
      // Fallback or handle error - though strictly TS requires init in constructor if not optional
      // To satisfy TS strict property init, we should probably assign it.
      // If it throws, the app might crash, which is acceptable if critical.
    }

    this.init();
  }

  private async init(): Promise<void> {
    // Завантажити дані з БД
    await this.loadDataFromDatabase();

    // Перевіряємо чи користувач адміністратор і створюємо кнопку редагування
    this.createEditButtonIfAdmin();

    // Навігація днями
    const headerPrev = document.getElementById("headerNavPrev");
    const headerNext = document.getElementById("headerNavNext");
    const todayBtn = document.getElementById("postTodayBtn");
    const weekBtn = document.getElementById("postWeekBtn");
    if (headerPrev)
      headerPrev.addEventListener("click", () => {
        if (this.isWeekView) {
          this.changeDate(-7);
        } else {
          this.changeDate(-1);
        }
      });
    if (headerNext)
      headerNext.addEventListener("click", () => {
        if (this.isWeekView) {
          this.changeDate(7);
        } else {
          this.changeDate(1);
        }
      });
    if (todayBtn) todayBtn.addEventListener("click", () => this.goToToday());
    if (weekBtn) weekBtn.addEventListener("click", () => this.toggleWeekView());

    // Навігація місяцями
    const monthPrev = document.getElementById("postYearPrev");
    const monthNext = document.getElementById("postYearNext");
    if (monthPrev)
      monthPrev.addEventListener("click", () => this.changeMonth(-1));
    if (monthNext)
      monthNext.addEventListener("click", () => this.changeMonth(1));

    // Edit Mode (тільки якщо кнопка була створена)
    if (this.editModeBtn) {
      this.editModeBtn.addEventListener("click", () => this.toggleEditMode());
    }

    // Активуємо кнопку тижневого виду
    if (weekBtn) {
      weekBtn.classList.add("active");
      weekBtn.textContent = "День";
    }

    this.render();
    this.updateTimeMarker();
    setInterval(() => this.updateTimeMarker(), 60000);

    // Завантажуємо дані: тижневий вид по дефолту
    if (this.isWeekView) {
      this.loadWeekArxivData();
    } else if (this.postArxiv) {
      this.postArxiv.loadArxivDataForCurrentDate();
    }

    // 📡 Підключаємо Realtime підписку для автоматичного оновлення
    try {
      initPostArxivRealtimeSubscription();
    } catch (e) {}
  }

  private async loadDataFromDatabase(): Promise<void> {
    try {
      // 🔐 Перевіряємо доступ перед завантаженням даних
      const hasAccess = await checkCurrentPageAccess();

      if (!hasAccess) {
        redirectToIndex();
        return;
      }

      // Запит 1: Отримуємо всіх слюсарів
      const { data: slyusarsData, error: slyusarsError } = await supabase
        .from("slyusars")
        .select("*");

      if (slyusarsError) {
        throw slyusarsError;
      }

      // Запит 2: Отримуємо всі пости
      const { data: postsData, error: postsError } = await supabase
        .from("post_name")
        .select("*");

      if (postsError) {
        throw postsError;
      }

      // Запит 3: Отримуємо категорії
      const { data: categoriesData, error: categoriesError } = await supabase
        .from("post_category")
        .select("*");

      if (categoriesError) {
        throw categoriesError;
      }

      if (!slyusarsData || !postsData || !categoriesData) {
        throw new Error("Помилка завантаження даних");
      }

      // Створюємо Map для швидкого пошуку постів
      const postsMap = new Map<number, any>(
        postsData.map((post: any) => [post.post_id, post]),
      );

      // Заповнюємо карти пошуку для нових створених елементів
      this.postTitleToIdMap.clear();
      postsData.forEach((post: any) => {
        this.postTitleToIdMap.set(post.name, post.post_id);
      });

      this.slyusarNameToIdMap.clear();
      slyusarsData.forEach((slyusar: any) => {
        if (slyusar.data && slyusar.data.Name) {
          // Зберігаємо з нормалізованим ключем (lowercase, trimmed)
          const normalizedName = slyusar.data.Name.toLowerCase().trim();
          this.slyusarNameToIdMap.set(normalizedName, slyusar.slyusar_id);
        }
      });

      // Створюємо Map для перетворення category_id -> category name
      const categoryMap = new Map<string, string>(
        categoriesData.map((cat: any) => [
          String(cat.category_id),
          cat.category,
        ]),
      );

      // Трансформація даних - фільтруємо записи з пустим namber
      const slyusars: Sluysar[] = slyusarsData
        .filter(
          (item: any) => item.namber !== null && item.namber !== undefined,
        )
        .map((item: any) => {
          const post = postsMap.get(parseInt(item.post_sluysar));
          if (!post) return null;

          return {
            slyusar_id: item.slyusar_id,
            sluysar_name: `👨‍🔧 ${item.data.Name}`,
            namber: item.namber,
            post_name: post.name as string,
            post_id: post.post_id as number,
            category: String(post.category),
          };
        })
        .filter((item: Sluysar | null): item is Sluysar => item !== null);

      this.transformDataToSections(slyusars, categoryMap);
    } catch (error) {
      this.showError("Не вдалося завантажити дані. Спробуйте пізніше.");
    }
  }

  private transformDataToSections(
    data: Sluysar[],
    categoryMap: Map<string, string>,
  ): void {
    // Групування за category
    const grouped = data.reduce(
      (acc, item) => {
        if (!acc[item.category]) {
          acc[item.category] = [];
        }
        acc[item.category].push(item);
        return acc;
      },
      {} as Record<string, Sluysar[]>,
    );

    // Створення секцій
    this.sections = Object.entries(grouped).map(
      ([categoryId, items], index) => {
        // Сортування за namber всередині категорії
        items.sort((a, b) => a.namber - b.namber);

        // Отримуємо назву категорії з Map, якщо немає - використовуємо ID
        const categoryName = categoryMap.get(categoryId) || categoryId;

        return {
          id: index + 1,
          realCategoryId: categoryId,
          name: categoryName,
          collapsed: false,
          posts: items.map((item) => ({
            id: item.slyusar_id,
            postId: item.post_id,
            title: item.post_name,
            subtitle: item.sluysar_name,
            namber: item.namber,
          })),
        };
      },
    );

    // Сортування секцій за мінімальним namber у кожній секції
    this.sections.sort((a, b) => {
      const minA = Math.min(...a.posts.map((p) => p.namber));
      const minB = Math.min(...b.posts.map((p) => p.namber));
      return minA - minB;
    });
  }

  private showError(message: string): void {
    showNotification(message, "error", 5000);
  }

  private toggleEditMode(): void {
    if (this.editMode) {
      // Закриваємо режим редагування - перевіряємо чи є зміни
      this.handleEditModeClose();
    } else {
      // Відкриваємо режим редагування - зберігаємо початковий стан
      this.openEditMode();
    }
  }

  private openEditMode(): void {
    this.editMode = true;
    this.deletedSlyusarIds = [];

    // Зберігаємо початкові позиції
    this.saveInitialPositions();

    if (this.editModeBtn) {
      this.editModeBtn.classList.add("active");
    }

    if (this.schedulerWrapper) {
      this.schedulerWrapper.classList.add("edit-mode");
    }
  }

  private saveInitialPositions(): void {
    this.initialPositions = [];

    this.sections.forEach((section, sectionIndex) => {
      section.posts.forEach((post, postIndex) => {
        const namber = sectionIndex + 1 + (postIndex + 1) / 10;
        this.initialPositions.push({
          slyusar_id: post.id,
          post_id: post.postId,
          original_namber: post.namber,
          current_namber: namber,
        });
      });
    });
  }

  private calculateCurrentPositions(): PositionData[] {
    const currentPositions: PositionData[] = [];

    this.sections.forEach((section, sectionIndex) => {
      section.posts.forEach((post, postIndex) => {
        const namber = sectionIndex + 1 + (postIndex + 1) / 10;
        const initial = this.initialPositions.find(
          (p) => p.slyusar_id === post.id,
        );
        currentPositions.push({
          slyusar_id: post.id,
          post_id: post.postId,
          original_namber: initial?.original_namber ?? post.namber,
          current_namber: namber,
          slyusar_name: post.subtitle,
          post_title: post.title,
        });
      });
    });

    return currentPositions;
  }

  private checkForChanges(): boolean {
    // Якщо є видалені елементи - є зміни
    if (this.deletedSlyusarIds.length > 0) {
      return true;
    }

    const currentPositions = this.calculateCurrentPositions();

    for (const current of currentPositions) {
      const initial = this.initialPositions.find(
        (p) => p.slyusar_id === current.slyusar_id,
      );
      if (!initial) return true;
      if (Math.abs(initial.current_namber - current.current_namber) > 0.001) {
        return true;
      }
    }

    return false;
  }

  private handleEditModeClose(): void {
    const hasChanges = this.checkForChanges();

    if (hasChanges) {
      this.showConfirmationDialog();
    } else {
      this.closeEditMode();
    }
  }

  private showConfirmationDialog(): void {
    // Створюємо модальне вікно підтвердження
    const overlay = document.createElement("div");
    overlay.className = "post-confirm-overlay";
    overlay.innerHTML = `
      <div class="post-confirm-modal">
        <div class="post-confirm-title">Змінити дані налаштування?</div>
        <div class="post-confirm-buttons">
          <button class="post-confirm-btn post-confirm-yes">Так</button>
          <button class="post-confirm-btn post-confirm-no">Ні</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const yesBtn = overlay.querySelector(".post-confirm-yes");
    const noBtn = overlay.querySelector(".post-confirm-no");

    yesBtn?.addEventListener("click", async () => {
      overlay.remove();
      await this.savePositionsToDatabase();
      this.closeEditMode();
    });

    noBtn?.addEventListener("click", () => {
      overlay.remove();
      // Відновлюємо початковий стан - перезавантажуємо дані з БД
      showNotification("Зміни скасовано", "warning");
      this.restoreInitialState();
    });
  }

  private async savePositionsToDatabase(): Promise<void> {
    const currentPositions = this.calculateCurrentPositions();
    // console.log("📊 Всі розраховані позиції:", currentPositions);

    try {
      let successCount = 0;

      for (const pos of currentPositions) {
        let realSlyusarId = pos.slyusar_id;
        let realPostId = pos.post_id;
        let isNewSlyusar = false;

        // 1. Спробуємо знайти реальний post_id за назвою, якщо його немає
        if ((!realPostId || realPostId <= 0) && pos.post_title) {
          const foundPostId = this.postTitleToIdMap.get(pos.post_title);
          if (foundPostId) {
            realPostId = foundPostId;
            // console.log(`🔎 Знайдено post_id ${realPostId} для "${pos.post_title}"`);
          }
        }

        // 2. Якщо ID слюсаря тимчасовий (велике число), спробуємо знайти за ім'ям
        if (realSlyusarId > 100000) {
          // Очищаємо ім'я від емодзі якщо є
          const cleanName = pos.slyusar_name?.replace("👨‍🔧 ", "").trim();

          if (cleanName) {
            // Нормалізуємо для пошуку (lowercase)
            const normalizedName = cleanName.toLowerCase().trim();
            // console.log(`🔍 Шукаємо слюсаря: "${cleanName}" -> normalized: "${normalizedName}"`);
            // console.log(`📚 Доступні ключі в Map:`, Array.from(this.slyusarNameToIdMap.keys()));

            const foundSlyusarId = this.slyusarNameToIdMap.get(normalizedName);
            if (foundSlyusarId) {
              realSlyusarId = foundSlyusarId;
              // console.log(`✅ Знайдено існуючого слюсаря ID ${realSlyusarId} для "${cleanName}"`);
            } else {
              isNewSlyusar = true;
              // console.log(`🆕 Слюсаря "${cleanName}" не знайдено, буде створено нового`);
            }
          }
        }

        // 3. Підготовка даних для запису
        const updateData: any = {
          namber: pos.current_namber,
        };

        if (realPostId && realPostId > 0) {
          updateData.post_sluysar = String(realPostId);
        }

        // 4. Виконуємо запит (UPDATE або INSERT)
        if (isNewSlyusar) {
          // INSERT
          const cleanName = pos.slyusar_name?.replace("👨‍🔧 ", "").trim();
          if (cleanName) {
            const { data, error } = await supabase
              .from("slyusars")
              .insert({
                data: { Name: cleanName, Опис: {}, Доступ: "Слюсар" },
                namber: pos.current_namber,
                post_sluysar: realPostId > 0 ? String(realPostId) : null,
              })
              .select();

            if (error) {
              throw error;
            }
            // console.log("✨ Створено нового слюсаря:", data);

            if (data && data.length > 0) {
              this.slyusarNameToIdMap.set(cleanName, data[0].slyusar_id);
              successCount++;
            }
          }
        } else if (realSlyusarId < 100000) {
          // UPDATE (тільки для реальних ID)
          // console.log(`💾 Оновлюю slyusar_id ${realSlyusarId}:`, updateData);
          const { data, error } = await supabase
            .from("slyusars")
            .update(updateData)
            .eq("slyusar_id", realSlyusarId)
            .select();

          if (error) {
            throw error;
          }
          if (data && data.length > 0) successCount++;
        } else {
          // console.warn(`⚠️ Пропущено запис з ID ${realSlyusarId} (не знайдено відповідності)`);
        }
      }

      // 5. Оновлюємо категорії для постів, якщо вони були переміщені в іншу секцію
      for (const section of this.sections) {
        if (!section.realCategoryId) continue;

        for (const post of section.posts) {
          if (post.postId > 0) {
            // Оновлюємо категорію поста
            await supabase
              .from("post_name")
              .update({ category: section.realCategoryId })
              .eq("post_id", post.postId);
          }
        }
      }

      // Очищаємо namber для видалених елементів (теж фільтруємо реальні ID)
      const validDeletedIds = this.deletedSlyusarIds.filter(
        (id) => id < 100000,
      );
      for (const deletedId of validDeletedIds) {
        const { error } = await supabase
          .from("slyusars")
          .update({ namber: null, post_sluysar: null })
          .eq("slyusar_id", deletedId)
          .select();

        // console.log(`📋 Результат видалення slyusar_id ${deletedId}:`, { data, error });

        if (error) {
          throw error;
        }
      }

      // console.log(`✅ Успішно опрацьовано ${successCount} записів`);

      if (successCount > 0 || validDeletedIds.length > 0) {
        showNotification("Налаштування успішно збережено!", "success");
        // Важливо: перезавантажуємо дані щоб отримати нові ID
        await this.restoreInitialState();
      } else {
        // Якщо нічого не змінилось в БД, але ми тут - можливо це були лише тимчасові зміни які скасувались
        // console.warn("⚠️ Змін в базі даних не зафіксовано.");
      }
    } catch (error) {
      this.showError("Не вдалося зберегти налаштування. Спробуйте пізніше.");
    }
  }

  private async restoreInitialState(): Promise<void> {
    // Перезавантажуємо дані з БД для відновлення початкового стану
    await this.loadDataFromDatabase();
    this.renderCurrentView();
    this.closeEditMode();
  }

  /**
   * Перемальовує поточний вид (денний або тижневий)
   */
  private renderCurrentView(): void {
    if (this.isWeekView) {
      this.renderWeekView();
      this.loadWeekArxivData();
    } else {
      this.renderSections();
    }
  }

  private closeEditMode(): void {
    this.editMode = false;
    this.initialPositions = [];
    this.deletedSlyusarIds = [];

    if (this.editModeBtn) {
      this.editModeBtn.classList.remove("active");
    }

    if (this.schedulerWrapper) {
      this.schedulerWrapper.classList.remove("edit-mode");
    }
  }

  private getUserAccessLevel(): { Name: string; Доступ: string } | null {
    try {
      const storedData = localStorage.getItem("userAuthData");
      if (!storedData) return null;
      return JSON.parse(storedData);
    } catch (error) {
      return null;
    }
  }

  private createEditButtonIfAdmin(): void {
    const userData = this.getUserAccessLevel();

    // Тільки для адміністратора створюємо кнопку
    if (userData && userData.Доступ === "Адміністратор") {
      const aside = document.getElementById("postMiniCalendar");
      if (!aside) return;

      const editButton = document.createElement("button");
      editButton.className = "post-edit-mode-btn";
      editButton.id = "postEditModeBtn";
      editButton.title = "Режим редагування";

      editButton.innerHTML = `
        <span class="icon-view">🔒</span>
        <span class="icon-edit">🔓</span>
      `;

      aside.appendChild(editButton);

      // Зберігаємо посилання на кнопку
      this.editModeBtn = editButton;
    }
  }

  private updateTimeMarker(): void {
    const now = new Date();

    // Оновлюємо today на випадок якщо сторінка відкрита після півночі
    const newToday = new Date();
    newToday.setHours(0, 0, 0, 0);
    this.today = newToday;

    const startOfToday = new Date(this.today);
    const selected = new Date(this.selectedDate);
    selected.setHours(0, 0, 0, 0);

    let decimal = 0;

    if (selected < startOfToday) {
      decimal = 1;
    } else if (selected.getTime() === startOfToday.getTime()) {
      const startHour = 8;
      const endHour = 20;
      const totalMinutes = (endHour - startHour) * 60;
      const currentHour = now.getHours();
      const currentMin = now.getMinutes();
      let minutesPassed = (currentHour - startHour) * 60 + currentMin;
      if (minutesPassed < 0) minutesPassed = 0;
      if (minutesPassed > totalMinutes) minutesPassed = totalMinutes;
      decimal = minutesPassed / totalMinutes;
    } else {
      decimal = 0;
    }

    if (this.timeHeader) {
      (this.timeHeader as HTMLElement).style.setProperty(
        "--past-percentage",
        decimal.toString(),
      );
    }
    if (this.schedulerWrapper) {
      (this.schedulerWrapper as HTMLElement).style.setProperty(
        "--past-percentage",
        decimal.toString(),
      );
    }

    // === Оновлюємо тижневий вид в реальному часі ===
    if (this.isWeekView && this.calendarGrid) {
      this.updateWeekTimeElements(now);
    }
  }

  /**
   * Оновлює всі часові елементи тижневого виду:
   * червону лінію, минулий/майбутній overlay, годинні клітинки, overlay блоків
   */
  private updateWeekTimeElements(now: Date): void {
    if (!this.calendarGrid) return;

    const currentHour = now.getHours();
    const currentMins = (currentHour - 8) * 60 + now.getMinutes();
    const totalMins = 12 * 60;
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // 1. Оновлюємо годинні клітинки заголовка
    const dayColHeaders = this.calendarGrid.querySelectorAll(
      ".post-week-day-col-header",
    );
    dayColHeaders.forEach((col) => {
      const colEl = col as HTMLElement;
      const colDate = colEl.dataset.date;
      const isToday = colDate === todayStr;

      const hourCells = colEl.querySelectorAll(".post-week-hour-cell");
      hourCells.forEach((cell) => {
        const cellEl = cell as HTMLElement;
        const h = parseInt(cellEl.textContent || "0", 10);
        cellEl.classList.remove("hour-past", "hour-current", "hour-future");
        if (isToday) {
          if (h < currentHour) {
            cellEl.classList.add("hour-past");
          } else if (h === currentHour) {
            cellEl.classList.add("hour-current");
          } else {
            cellEl.classList.add("hour-future");
          }
        } else if (colDate && colDate < todayStr) {
          cellEl.classList.add("hour-past");
        }
      });
    });

    // 2. Оновлюємо доріжки днів: червону лінію, overlay минулого/майбутнього
    const dayTracks = this.calendarGrid.querySelectorAll(
      ".post-week-day-track",
    );
    dayTracks.forEach((track) => {
      const trackEl = track as HTMLElement;
      const trackDate = trackEl.dataset.date;
      const isToday = trackDate === todayStr;
      const isPast = trackDate ? trackDate < todayStr : false;

      // Видаляємо старі часові елементи (тільки track-рівень)
      trackEl
        .querySelectorAll(
          ".post-week-time-line, .post-week-past-overlay, .post-week-future-overlay",
        )
        .forEach((el) => {
          if (el.parentElement === trackEl) el.remove();
        });

      if (isToday && currentMins > 0) {
        const pastPercent = Math.min(currentMins / totalMins, 1) * 100;

        const pastOverlay = document.createElement("div");
        pastOverlay.className = "post-week-past-overlay";
        pastOverlay.style.width = `${pastPercent}%`;
        trackEl.appendChild(pastOverlay);

        const timeLine = document.createElement("div");
        timeLine.className = "post-week-time-line";
        timeLine.style.left = `${pastPercent}%`;
        trackEl.appendChild(timeLine);

        const futureOverlay = document.createElement("div");
        futureOverlay.className = "post-week-future-overlay";
        futureOverlay.style.left = `${pastPercent}%`;
        futureOverlay.style.right = "0";
        trackEl.appendChild(futureOverlay);
      } else if (isPast) {
        const pastOverlay = document.createElement("div");
        pastOverlay.className = "post-week-past-overlay";
        pastOverlay.style.width = "100%";
        trackEl.appendChild(pastOverlay);
      }
    });

    // 3. Оновлюємо overlay блоків бронювань
    const blocks = this.calendarGrid.querySelectorAll(".post-week-block");
    blocks.forEach((block) => {
      const blockEl = block as HTMLElement;
      const blockDate = blockEl.dataset.date;
      const startMins = parseInt(blockEl.dataset.start || "0", 10);
      const endMins = parseInt(blockEl.dataset.end || "0", 10);

      // Видаляємо старий overlay
      blockEl
        .querySelectorAll(".week-block-past-overlay")
        .forEach((el) => el.remove());
      blockEl.classList.remove("week-block-past");

      const isBlockPast = blockDate ? blockDate < todayStr : false;
      const isBlockToday = blockDate === todayStr;

      if (isBlockPast || (isBlockToday && endMins <= currentMins)) {
        // Повністю минулий блок
        blockEl.classList.add("week-block-past");
        const pastOverlay = document.createElement("div");
        pastOverlay.className = "week-block-past-overlay";
        pastOverlay.style.width = "100%";
        pastOverlay.style.borderRadius = "4px";
        blockEl.appendChild(pastOverlay);
      } else if (
        isBlockToday &&
        startMins < currentMins &&
        endMins > currentMins
      ) {
        // Частково минулий блок
        const pastFraction = Math.min(
          Math.max(
            ((currentMins - startMins) / (endMins - startMins)) * 100,
            0,
          ),
          100,
        );
        if (pastFraction > 0) {
          const pastOverlay = document.createElement("div");
          pastOverlay.className = "week-block-past-overlay";
          pastOverlay.style.width = `${pastFraction}%`;
          pastOverlay.style.borderRadius = "4px 0 0 4px";
          blockEl.appendChild(pastOverlay);
        }
      }
    });
  }

  private goToToday(): void {
    this.selectedDate = new Date(this.today);
    this.viewMonth = this.today.getMonth();
    this.viewYear = this.today.getFullYear();

    // Якщо тижневий вид — перемикаємось на денний вид сьогодні
    if (this.isWeekView) {
      this.isWeekView = false;
      const weekBtn = document.getElementById("postWeekBtn");
      if (weekBtn) {
        weekBtn.classList.remove("active");
        weekBtn.textContent = "Тиждень";
      }
      this.render();
      this.reloadArxivData();
      return;
    }

    // Якщо поточний місяць відображається - просто оновлюємо підсвічування
    if (this.isMonthVisible(this.viewMonth, this.viewYear)) {
      this.updateDateSelection();
      this.reloadArxivData();
    } else {
      // Якщо потрібно показати інший місяць - рендеримо повністю
      this.render();
      this.reloadArxivData();
    }
  }

  // ============== ТИЖНЕВИЙ ВИД ==============
  private toggleWeekView(): void {
    // Якщо є активний режим редагування — закриваємо його перед перемиканням виду
    if (this.editMode) {
      this.handleEditModeClose();
      return;
    }

    this.isWeekView = !this.isWeekView;
    const weekBtn = document.getElementById("postWeekBtn");
    if (weekBtn) {
      weekBtn.classList.toggle("active", this.isWeekView);
      weekBtn.textContent = this.isWeekView ? "День" : "Тиждень";
    }
    this.render();
    if (this.isWeekView) {
      this.loadWeekArxivData();
    } else {
      this.reloadArxivData();
    }
  }

  /**
   * Повертає початок тижня (понеділок) для заданої дати
   */
  private getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Понеділок = 1
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Повертає масив з 7 дат тижня (Пн-Нд)
   */
  private getWeekDays(date: Date): Date[] {
    const start = this.getWeekStart(date);
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  }

  /**
   * Форматує дату для тижневого заголовка
   */
  private formatWeekRange(date: Date): string {
    const weekDays = this.getWeekDays(date);
    const first = weekDays[0];
    const last = weekDays[6];
    const months = [
      "січня",
      "лютого",
      "березня",
      "квітня",
      "травня",
      "червня",
      "липня",
      "серпня",
      "вересня",
      "жовтня",
      "листопада",
      "грудня",
    ];
    if (first.getMonth() === last.getMonth()) {
      return `${first.getDate()} – ${last.getDate()} ${months[first.getMonth()]} ${first.getFullYear()}`;
    } else {
      return `${first.getDate()} ${months[first.getMonth()]} – ${last.getDate()} ${months[last.getMonth()]} ${last.getFullYear()}`;
    }
  }

  /**
   * Рендерить тижневий вид планувальника (горизонтальний — дні зверху, години всередині кожного дня)
   */
  private renderWeekView(): void {
    const calendarGrid = this.calendarGrid;
    if (!calendarGrid) return;
    calendarGrid.innerHTML = "";

    const weekDays = this.getWeekDays(this.selectedDate);
    const shortDayNames = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "НД"];

    // Оновлюємо заголовок
    if (this.headerDateDisplay) {
      this.headerDateDisplay.textContent = this.formatWeekRange(
        this.selectedDate,
      );
    }

    // Ховаємо sticky-header денного виду
    const stickyHeader = document.querySelector(
      ".post-sticky-header",
    ) as HTMLElement;
    if (stickyHeader) stickyHeader.style.display = "none";

    // Додаємо клас тижневого виду
    if (this.schedulerWrapper) {
      this.schedulerWrapper.classList.add("week-view-mode");
    }

    const weekContainer = document.createElement("div");
    weekContainer.className = "post-week-container";

    // === Заголовок: кут + 7 колонок днів (кожна з годинами) ===
    const header = document.createElement("div");
    header.className = "post-week-header";

    const corner = document.createElement("div");
    corner.className = "post-week-corner";
    header.appendChild(corner);

    const daysHeader = document.createElement("div");
    daysHeader.className = "post-week-days-header";

    weekDays.forEach((day, idx) => {
      const isToday = day.toDateString() === this.today.toDateString();
      const isWeekend = day.getDay() === 0 || day.getDay() === 6;
      const isPastDay = day < this.today && !isToday;

      const dayCol = document.createElement("div");
      dayCol.className = "post-week-day-col-header";
      const dayDateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      dayCol.dataset.date = dayDateStr;
      if (isToday) dayCol.classList.add("post-week-today");
      if (isWeekend) dayCol.classList.add("post-week-weekend");

      // Назва дня + дата (клікабельна — перехід у денний вид)
      const dayTitle = document.createElement("div");
      dayTitle.className = "post-week-day-title";
      dayTitle.textContent = `${shortDayNames[idx]} ${day.getDate()}`;
      dayTitle.addEventListener("click", () => {
        this.selectedDate = new Date(day);
        this.viewMonth = day.getMonth();
        this.viewYear = day.getFullYear();
        this.isWeekView = false;
        const weekBtn = document.getElementById("postWeekBtn");
        if (weekBtn) {
          weekBtn.classList.remove("active");
          weekBtn.textContent = "Тиждень";
        }
        this.render();
        this.reloadArxivData();
      });
      dayCol.appendChild(dayTitle);

      // Годинна шкала всередині дня (8–19, кожна година)
      const hoursRow = document.createElement("div");
      hoursRow.className = "post-week-hours-row";
      const nowForHeader = new Date();
      const currentHour = nowForHeader.getHours();
      for (let h = 8; h <= 19; h++) {
        const hourCell = document.createElement("div");
        hourCell.className = "post-week-hour-cell";
        if (h === 13) {
          hourCell.classList.add("hour-lunch"); // Обідня перерва
        }
        if (isToday) {
          if (h < currentHour) {
            hourCell.classList.add("hour-past");
          } else if (h === currentHour) {
            hourCell.classList.add("hour-current");
          } else {
            hourCell.classList.add("hour-future");
          }
        }
        if (isPastDay) {
          hourCell.classList.add("hour-past");
        }
        hourCell.textContent = h.toString();
        hoursRow.appendChild(hourCell);
      }
      dayCol.appendChild(hoursRow);
      daysHeader.appendChild(dayCol);
    });

    header.appendChild(daysHeader);
    weekContainer.appendChild(header);

    // === Тіло ===
    const weekBody = document.createElement("div");
    weekBody.className = "post-week-body";

    this.sections.forEach((section, sectionIndex) => {
      // Wrapper для секції (аналог post-section-group в денному виді)
      const sectionGroup = document.createElement("div");
      sectionGroup.className = "post-week-section-group";
      sectionGroup.dataset.sectionId = section.id.toString();
      sectionGroup.dataset.sectionIndex = sectionIndex.toString();

      // Хедер секції
      const sectionRow = document.createElement("div");
      sectionRow.className = "post-week-section-header";

      const headerLeft = document.createElement("div");
      headerLeft.className = "post-week-section-header-left";
      const nameSpan = document.createElement("span");
      nameSpan.textContent = section.name;
      headerLeft.appendChild(nameSpan);
      sectionRow.appendChild(headerLeft);

      const headerRight = document.createElement("div");
      headerRight.className = "post-week-section-header-right";

      // Кнопка видалення секції (видима тільки в edit mode через CSS)
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "post-delete-btn";
      deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>`;
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        this.deleteSection(section.id);
      };
      headerRight.appendChild(deleteBtn);

      const toggleBtn = document.createElement("button");
      toggleBtn.className = "post-toggle-btn";
      if (section.collapsed) toggleBtn.classList.add("collapsed");
      toggleBtn.textContent = "▼";
      headerRight.appendChild(toggleBtn);

      sectionRow.appendChild(headerRight);

      // Drag and drop для хедера секції - тільки в режимі редагування
      sectionRow.addEventListener("mousedown", (e) => {
        if (!this.editMode) return;
        const target = e.target as HTMLElement;
        if (
          target.closest(".post-delete-btn") ||
          target.closest(".post-toggle-btn")
        )
          return;
        e.preventDefault();
        this.startSectionDrag(e, sectionGroup, section.id);
      });

      // Click для toggle
      sectionRow.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        if (target.closest(".post-delete-btn")) return;
        if (this.editMode && !target.closest(".post-toggle-btn")) return;
        this.toggleSection(section.id);
        this.renderWeekView();
        this.loadWeekArxivData();
      });

      sectionGroup.appendChild(sectionRow);

      // Контент секції
      const sectionContent = document.createElement("div");
      sectionContent.className = "post-week-section-content";
      sectionContent.dataset.sectionId = section.id.toString();
      if (section.collapsed) sectionContent.classList.add("hidden");

      if (!section.collapsed) {
        section.posts.forEach((post) => {
          const row = document.createElement("div");
          row.className = "post-week-row";
          row.dataset.postId = post.id.toString();
          row.dataset.sectionId = section.id.toString();

          // Лейбл слюсаря (зліва)
          const label = document.createElement("div");
          label.className = "post-week-row-label";

          const deleteContainer = document.createElement("div");
          deleteContainer.className = "post-week-label-content";

          const labelContent = document.createElement("div");
          labelContent.className = "post-week-label-text";
          labelContent.innerHTML = `
            <div class="post-post-title">${post.title}</div>
            <div class="post-post-subtitle">${post.subtitle}</div>
          `;

          const postDeleteBtn = document.createElement("button");
          postDeleteBtn.className = "post-post-delete-btn";
          postDeleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>`;
          postDeleteBtn.onclick = (e) => {
            e.stopPropagation();
            this.deletePost(section.id, post.id);
          };

          deleteContainer.appendChild(labelContent);
          deleteContainer.appendChild(postDeleteBtn);
          label.appendChild(deleteContainer);

          // Drag and drop для лейбла - тільки в режимі редагування
          label.addEventListener("mousedown", (e) => {
            if (!this.editMode) return;
            const target = e.target as HTMLElement;
            if (target.closest(".post-post-delete-btn")) return;
            e.preventDefault();
            this.startPostDrag(e, row, section.id, post.id);
          });

          row.appendChild(label);

          // 7 треків днів поруч
          const tracksContainer = document.createElement("div");
          tracksContainer.className = "post-week-row-tracks";

          weekDays.forEach((day, idx) => {
            const isToday = day.toDateString() === this.today.toDateString();
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            const isPast = day < this.today && !isToday;

            const dayTrack = document.createElement("div");
            dayTrack.className = "post-week-day-track";
            const dateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
            dayTrack.dataset.date = dateStr;
            dayTrack.dataset.slyusarId = post.id.toString();
            dayTrack.dataset.postId = post.postId.toString();

            if (isToday) dayTrack.classList.add("post-week-today");
            if (isWeekend) dayTrack.classList.add("post-week-weekend");
            if (idx < 6) dayTrack.classList.add("post-week-day-border");

            // Вертикальні лінії годин
            for (let h = 8; h <= 20; h++) {
              const timeMark = document.createElement("div");
              timeMark.className = "post-week-time-mark";
              timeMark.style.left = `${((h - 8) / 12) * 100}%`;
              dayTrack.appendChild(timeMark);
            }
            for (let h = 8; h < 20; h++) {
              const halfMark = document.createElement("div");
              halfMark.className = "post-week-time-mark half";
              halfMark.style.left = `${((h - 8 + 0.5) / 12) * 100}%`;
              dayTrack.appendChild(halfMark);
            }

            // Минулий час + червона лінія
            if (isToday) {
              const now = new Date();
              const currentMins = (now.getHours() - 8) * 60 + now.getMinutes();
              const totalMins = 12 * 60;
              if (currentMins > 0) {
                const pastPercent = Math.min(currentMins / totalMins, 1) * 100;
                const pastOverlay = document.createElement("div");
                pastOverlay.className = "post-week-past-overlay";
                pastOverlay.style.width = `${pastPercent}%`;
                dayTrack.appendChild(pastOverlay);

                const timeLine = document.createElement("div");
                timeLine.className = "post-week-time-line";
                timeLine.style.left = `${pastPercent}%`;
                dayTrack.appendChild(timeLine);
              }
              // Фон майбутнього часу
              const futureOverlay = document.createElement("div");
              futureOverlay.className = "post-week-future-overlay";
              const futureLeft = Math.min(
                (now.getHours() - 8) * 60 + now.getMinutes(),
                12 * 60,
              );
              futureOverlay.style.left = `${Math.max(0, (futureLeft / (12 * 60)) * 100)}%`;
              futureOverlay.style.right = "0";
              dayTrack.appendChild(futureOverlay);
            } else if (isPast) {
              const pastOverlay = document.createElement("div");
              pastOverlay.className = "post-week-past-overlay";
              pastOverlay.style.width = "100%";
              dayTrack.appendChild(pastOverlay);
            }

            // Обідня смуга 13:00–14:00 (аналог суботи)
            const lunchOverlay = document.createElement("div");
            lunchOverlay.className = "post-week-lunch-overlay";
            // 13:00 = 5 год від 8:00 = 5/12 * 100%, шириною 1/12 * 100%
            lunchOverlay.style.left = `${(5 / 12) * 100}%`;
            lunchOverlay.style.width = `${(1 / 12) * 100}%`;
            dayTrack.appendChild(lunchOverlay);

            // Drag-to-create
            this.attachWeekCellDragHandlers(dayTrack);

            tracksContainer.appendChild(dayTrack);
          });

          row.appendChild(tracksContainer);
          sectionContent.appendChild(row);
        });

        // Кнопка "Додати пост" (видима тільки в edit mode через CSS)
        const addPostBtn = document.createElement("button");
        addPostBtn.className = "post-add-post-btn";
        addPostBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Додати пост
        `;
        addPostBtn.onclick = () => this.openAddPostModal(section.name);
        sectionContent.appendChild(addPostBtn);
      }

      sectionGroup.appendChild(sectionContent);
      weekBody.appendChild(sectionGroup);
    });

    weekContainer.appendChild(weekBody);
    calendarGrid.appendChild(weekContainer);
  }

  /**
   * Завантажує дані бронювань за весь тиждень
   */
  private async loadWeekArxivData(): Promise<void> {
    const weekDays = this.getWeekDays(this.selectedDate);
    const startDate = `${weekDays[0].getFullYear()}-${String(weekDays[0].getMonth() + 1).padStart(2, "0")}-${String(weekDays[0].getDate()).padStart(2, "0")}`;
    const lastDay = weekDays[6];
    const endDate = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;

    try {
      const { data: arxivRecords, error } = await supabase
        .from("post_arxiv")
        .select(
          `
          post_arxiv_id,
          slyusar_id,
          name_post,
          client_id,
          cars_id,
          status,
          data_on,
          data_off,
          komentar,
          act_id,
          xto_zapusav
        `,
        )
        .gte("data_on", `${startDate}T00:00:00`)
        .lte("data_on", `${endDate}T23:59:59`);

      if (error || !arxivRecords || arxivRecords.length === 0) return;

      // Збираємо ID клієнтів та машин
      const clientIds = [
        ...new Set(
          arxivRecords
            .map((r) => r.client_id)
            .filter(
              (id) =>
                id != null && !isNaN(Number(id)) && !String(id).includes("|||"),
            ),
        ),
      ];
      const carIds = [
        ...new Set(
          arxivRecords
            .map((r) => r.cars_id)
            .filter(
              (id) =>
                id != null && !isNaN(Number(id)) && !String(id).includes("|||"),
            ),
        ),
      ];

      let clientsMap = new Map<number, any>();
      if (clientIds.length > 0) {
        const { data: clientsData } = await supabase
          .from("clients")
          .select("client_id, data")
          .in("client_id", clientIds);
        if (clientsData)
          clientsData.forEach((c) => clientsMap.set(c.client_id, c.data));
      }

      let carsMap = new Map<number, any>();
      if (carIds.length > 0) {
        const { data: carsData } = await supabase
          .from("cars")
          .select("cars_id, data")
          .in("cars_id", carIds)
          .not("is_deleted", "is", true);
        if (carsData) carsData.forEach((c) => carsMap.set(c.cars_id, c.data));
      }

      // Рендеримо блоки
      for (const record of arxivRecords) {
        this.renderWeekArxivRecord(record, clientsMap, carsMap);
      }
    } catch (err) {
      // ignore
    }
  }

  /**
   * Рендерить один запис бронювання у тижневому виді (горизонтально)
   */
  private renderWeekArxivRecord(
    record: any,
    clientsMap: Map<number, any>,
    carsMap: Map<number, any>,
  ): void {
    const dataOn = new Date(record.data_on);
    const dateStr = `${dataOn.getUTCFullYear()}-${String(dataOn.getUTCMonth() + 1).padStart(2, "0")}-${String(dataOn.getUTCDate()).padStart(2, "0")}`;

    // Шукаємо трек за датою та slyusar_id
    const dayTrack = this.calendarGrid?.querySelector(
      `.post-week-day-track[data-date="${dateStr}"][data-slyusar-id="${record.slyusar_id}"]`,
    ) as HTMLElement;

    if (!dayTrack) return;

    const dataOff = new Date(record.data_off);
    const startMins = (dataOn.getUTCHours() - 8) * 60 + dataOn.getUTCMinutes();
    const endMins = (dataOff.getUTCHours() - 8) * 60 + dataOff.getUTCMinutes();
    const totalMinutes = 12 * 60;

    if (startMins < 0 || endMins > totalMinutes) return;

    // Парсимо клієнта/авто
    let clientName = "";
    let clientPhone = "";
    let carModel = "";
    let carNumber = "";
    const clientIdStr = String(record.client_id || "");
    if (clientIdStr.includes("|||")) {
      const parts = clientIdStr.split("|||");
      clientName = parts[0] || "";
      clientPhone = parts[1] || "";
    } else if (!isNaN(Number(clientIdStr))) {
      const cd = clientsMap.get(Number(clientIdStr));
      if (cd) clientName = cd["ПІБ"] || "";
    }
    const carsIdStr = String(record.cars_id || "");
    if (carsIdStr.includes("|||")) {
      const parts = carsIdStr.split("|||");
      carModel = parts[0] || "";
      carNumber = parts[1] || "";
    } else if (!isNaN(Number(carsIdStr))) {
      const cd = carsMap.get(Number(carsIdStr));
      if (cd) {
        carModel = cd["Авто"] || "";
        carNumber = cd["Номер авто"] || "";
      }
    }

    // Кольори статусів
    const statusColors: Record<string, string> = {
      Запланований: "#e6a700",
      "В роботі": "#2e7d32",
      Відремонтований: "#757575",
      "Не приїхав": "#e53935",
    };

    // Горизонтальне позиціонування (left / width)
    const leftPercent = (startMins / totalMinutes) * 100;
    const widthPercent = ((endMins - startMins) / totalMinutes) * 100;
    const status = record.status || "Запланований";

    const block = document.createElement("div");
    block.className = "post-week-block";
    block.style.left = `${leftPercent}%`;
    block.style.width = `${widthPercent}%`;
    block.style.backgroundColor =
      statusColors[status] || statusColors["Запланований"];

    // Обробляємо «минулий час» — клас для повністю минулих
    // Overlay додаємо ПІСЛЯ block.innerHTML (щоб не стерлося)
    const now = new Date();
    const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const nowLocalMinsCheck = (now.getHours() - 8) * 60 + now.getMinutes();

    if (
      dateStr < nowStr ||
      (dateStr === nowStr && endMins <= nowLocalMinsCheck)
    ) {
      block.classList.add("week-block-past");
    }

    // Data-атрибути
    block.dataset.postArxivId = record.post_arxiv_id?.toString() || "";
    block.dataset.slyusarId = record.slyusar_id?.toString() || "";
    block.dataset.status = status;
    block.dataset.clientName = clientName;
    block.dataset.clientPhone = clientPhone;
    block.dataset.carModel = carModel;
    block.dataset.carNumber = carNumber;
    block.dataset.start = startMins.toString();
    block.dataset.end = endMins.toString();
    block.dataset.date = dateStr;
    block.dataset.xtoZapusav = record.xto_zapusav || "";
    block.dataset.comment = record.komentar || "";
    block.dataset.actId = record.act_id?.toString() || "";
    block.dataset.namePost = record.name_post?.toString() || "";

    // Час
    const startH = String(dataOn.getUTCHours()).padStart(2, "0");
    const startM = String(dataOn.getUTCMinutes()).padStart(2, "0");
    const endH = String(dataOff.getUTCHours()).padStart(2, "0");
    const endM = String(dataOff.getUTCMinutes()).padStart(2, "0");

    // Текст блоку — вертикально з емодзі
    const commentText = record.komentar || "";
    let blockHTML = `<div class="post-week-block-line">🕐 ${startH}:${startM}-${endH}:${endM}</div>`;
    if (clientName) {
      blockHTML += `<div class="post-week-block-line">👤 ${clientName}</div>`;
    }
    if (carModel || carNumber) {
      blockHTML += `<div class="post-week-block-line">🚗 ${carModel}${carNumber ? " " + carNumber : ""}</div>`;
    }
    if (commentText) {
      blockHTML += `<div class="post-week-block-line">💬 ${commentText}</div>`;
    }
    block.innerHTML = blockHTML;

    // ✅ Overlay додається ПІСЛЯ innerHTML (щоб не було стерто)
    // Використовуємо вже обчислені nowStr / nowLocalMinsCheck
    if (
      dateStr < nowStr ||
      (dateStr === nowStr && endMins <= nowLocalMinsCheck)
    ) {
      // ПОВНІСТЮ минулий — лавандовий overlay на 100%
      block.classList.add("week-block-past");
      const pastOverlay = document.createElement("div");
      pastOverlay.className = "week-block-past-overlay";
      pastOverlay.style.width = "100%";
      pastOverlay.style.borderRadius = "4px";
      block.appendChild(pastOverlay);
    } else if (
      dateStr === nowStr &&
      startMins < nowLocalMinsCheck &&
      endMins > nowLocalMinsCheck
    ) {
      // ЧАСТКОВО минулий — overlay до поточної хвилини (локальний час)
      const pastFraction = Math.min(
        Math.max(
          ((nowLocalMinsCheck - startMins) / (endMins - startMins)) * 100,
          0,
        ),
        100,
      );
      if (pastFraction > 0) {
        const pastOverlay = document.createElement("div");
        pastOverlay.className = "week-block-past-overlay";
        pastOverlay.style.width = `${pastFraction}%`;
        pastOverlay.style.borderRadius = "4px 0 0 4px";
        block.appendChild(pastOverlay);
      }
    }

    // Resize handles (лівий і правий)
    const leftHandle = document.createElement("div");
    leftHandle.className = "week-resize-handle left";
    block.appendChild(leftHandle);

    const rightHandle = document.createElement("div");
    rightHandle.className = "week-resize-handle right";
    block.appendChild(rightHandle);

    leftHandle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleWeekResizeMouseDown(e, block, "left");
    });
    rightHandle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleWeekResizeMouseDown(e, block, "right");
    });

    // Drag-move при mousedown на блоці
    block.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest(".week-resize-handle")) return;
      e.preventDefault();
      e.stopPropagation();
      this.handleWeekBlockMouseDown(e, block);
    });

    // Тултіп
    const comment = record.komentar || "";
    const actId = record.act_id || "";
    const xtoZapusav = record.xto_zapusav || "";
    const statusEmoji: Record<string, string> = {
      Запланований: "📋",
      "В роботі": "🔧",
      Відремонтований: "✅",
      "Не приїхав": "❌",
    };
    const emoji = statusEmoji[status] || "📋";

    const tooltip = document.createElement("div");
    tooltip.className = "post-week-tooltip";
    // Порядок: ПІБ → Авто → Телефон → час/тривалість → статус → решта
    let tooltipHTML = `<div class="post-week-tooltip-row"><span class="pw-tip-emoji">👤</span> <strong class="pw-tip-client">${clientName || "—"}</strong></div>`;
    tooltipHTML += `<div class="post-week-tooltip-row"><span class="pw-tip-emoji">🚗</span> <span class="pw-tip-car">${carModel || "—"} <span class="pw-tip-number">${carNumber || ""}</span></span></div>`;
    if (clientPhone) {
      tooltipHTML += `<div class="post-week-tooltip-row"><span class="pw-tip-emoji">📞</span> <span class="pw-tip-phone">${clientPhone}</span></div>`;
    }
    // Тривалість
    const durationMins = endMins - startMins;
    const durH = Math.floor(durationMins / 60);
    const durM = durationMins % 60;
    const durStr =
      durM > 0 ? `${durH}:${String(durM).padStart(2, "0")}` : `${durH}:00`;
    tooltipHTML += `<div class="post-week-tooltip-row pw-tip-duration"><span class="pw-tip-emoji">🕐</span> <span class="pw-tip-time-range">${startH}:${startM} — ${endH}:${endM} / ${durStr}</span></div>`;
    tooltipHTML += `<div class="post-week-tooltip-row pw-tip-status-row" data-status="${status}"><span class="pw-tip-emoji">${emoji}</span> <span class="pw-tip-status">${status}</span></div>`;
    if (comment) {
      tooltipHTML += `<div class="post-week-tooltip-row"><span class="pw-tip-emoji">💬</span> <span class="pw-tip-comment">${comment}</span></div>`;
    }
    if (actId) {
      tooltipHTML += `<div class="post-week-tooltip-row"><span class="pw-tip-emoji">📄</span> <span class="pw-tip-act">Акт №${actId}</span></div>`;
    }
    if (xtoZapusav) {
      tooltipHTML += `<div class="post-week-tooltip-row"><span class="pw-tip-emoji">✍️</span> <span class="pw-tip-author">${xtoZapusav}</span></div>`;
    }
    tooltip.innerHTML = tooltipHTML;
    block.appendChild(tooltip);

    // Позиціонування тултіпа: вниз, якщо не вміщується вверх
    block.addEventListener("mouseenter", () => {
      const blockRect = block.getBoundingClientRect();
      // Тултіп прихований (display:none), тому offsetHeight=0 — беремо запас 240px
      // (це більше за будь-який реальний тултіп з усіма рядками)
      const spaceAbove = blockRect.top;
      const neededSpace = 240;

      if (spaceAbove < neededSpace) {
        tooltip.classList.add("tooltip-below");
      } else {
        tooltip.classList.remove("tooltip-below");
      }
    });

    // Кружечок з номером акту
    if (actId) {
      const actBadge = document.createElement("div");
      actBadge.className = "post-week-act-badge";
      actBadge.textContent = String(actId);
      actBadge.dataset.actLabel = `Акт №${actId}`;
      actBadge.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof (window as any).openActModal === "function") {
          (window as any).openActModal(actId);
        }
      });
      actBadge.addEventListener("mousedown", (e) => {
        e.stopPropagation();
      });
      block.appendChild(actBadge);
    }

    // Подвійний клік — редагування
    block.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const currentUser = this.getCurrentUserName();
      const currentAccess = this.getCurrentUserAccess();
      const creator = block.dataset.xtoZapusav || "";
      if (
        currentAccess !== "Адміністратор" &&
        creator &&
        creator !== currentUser
      ) {
        showNotification(
          `Ви не можете редагувати цей запис. Створив: ${creator}`,
          "error",
        );
        return;
      }

      const blockStartMins = parseInt(block.dataset.start || "0");
      const blockEndMins = parseInt(block.dataset.end || "0");
      const startTimeStr = this.weekMinsToTime(blockStartMins);
      const endTimeStr = this.weekMinsToTime(blockEndMins);

      const detailData: Partial<ReservationData> = {
        clientName: block.dataset.clientName || "",
        clientPhone: block.dataset.clientPhone || "",
        carModel: block.dataset.carModel || "",
        carNumber: block.dataset.carNumber || "",
        status: block.dataset.status || "Запланований",
        comment: block.dataset.comment || "",
        postArxivId: parseInt(block.dataset.postArxivId || "0") || null,
        slyusarId: parseInt(block.dataset.slyusarId || "0") || null,
        namePost: parseInt(block.dataset.namePost || "0") || null,
        actId: parseInt(block.dataset.actId || "0") || null,
      };

      const slyusarIdNum = detailData.slyusarId || null;
      const excludeId = detailData.postArxivId || undefined;

      this.weekModal.open(
        block.dataset.date || dateStr,
        startTimeStr,
        endTimeStr,
        detailData.comment || "",
        detailData,
        (resultData: ReservationData) => this.handleWeekModalSubmit(resultData),
        async (date, start, end, _exId) => {
          return this.checkWeekAvailability(
            date,
            start,
            end,
            slyusarIdNum,
            excludeId,
          );
        },
        [],
      );
    });

    dayTrack.appendChild(block);
  }

  // ============== ТИЖНЕВИЙ ВИД — СТВОРЕННЯ ЗАПИСУ ЧЕРЕЗ DRAG ==============

  /** Отримує ім'я поточного користувача з localStorage */
  private getCurrentUserName(): string {
    try {
      const stored = localStorage.getItem("userAuthData");
      if (stored) {
        const userData = JSON.parse(stored);
        return userData.Name || "";
      }
    } catch {}
    return "";
  }

  /** Отримує рівень доступу поточного користувача */
  private getCurrentUserAccess(): string {
    try {
      const stored = localStorage.getItem("userAuthData");
      if (stored) {
        const userData = JSON.parse(stored);
        return userData.access || "";
      }
    } catch {}
    return "";
  }

  /**
   * Конвертує хвилини від початку робочого дня в рядок "HH:MM"
   */
  private weekMinsToTime(mins: number): string {
    const h = 8 + Math.floor(mins / 60);
    const m = mins % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  }

  /**
   * Прив'язує обробники drag-to-create до трека дня тижневого виду
   */
  private attachWeekCellDragHandlers(dayTrack: HTMLElement): void {
    dayTrack.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".post-week-block")) return;
      if (e.button !== 0) return;
      e.preventDefault();

      this.weekDragActive = true;
      this.weekDragCell = dayTrack;
      const rect = dayTrack.getBoundingClientRect();
      this.weekDragStartX = e.clientX - rect.left;
      this.weekDragCurrentX = this.weekDragStartX;

      if (!this.weekSelectionEl) {
        this.weekSelectionEl = document.createElement("div");
        this.weekSelectionEl.className = "post-week-selection";
      }
      this.weekSelectionEl.style.left = `${this.weekDragStartX}px`;
      this.weekSelectionEl.style.width = "0px";
      this.weekSelectionEl.style.display = "block";
      dayTrack.appendChild(this.weekSelectionEl);

      document.addEventListener("mousemove", this.onWeekDragMove);
      document.addEventListener("mouseup", this.onWeekDragUp);
    });
  }

  private onWeekDragMove = (e: MouseEvent): void => {
    if (!this.weekDragActive || !this.weekDragCell || !this.weekSelectionEl)
      return;

    const rect = this.weekDragCell.getBoundingClientRect();
    let x = e.clientX - rect.left;
    if (x < 0) x = 0;
    if (x > rect.width) x = rect.width;
    this.weekDragCurrentX = x;

    const left = Math.min(this.weekDragStartX, this.weekDragCurrentX);
    const width = Math.abs(this.weekDragCurrentX - this.weekDragStartX);
    this.weekSelectionEl.style.left = `${left}px`;
    this.weekSelectionEl.style.width = `${width}px`;

    // ── Підсвічуємо комірки-години в заголовку ────────────────
    this.clearDragHourHighlight();
    if (width < 5) return;

    // Діапазон clientX перетягування
    const dragClientLeft = rect.left + left;
    const dragClientRight = dragClientLeft + width;

    // Знаходимо заголовок дня за датою треку
    const dateStr = this.weekDragCell.dataset.date || "";
    if (!dateStr || !this.calendarGrid) return;

    const weekDays = this.getWeekDays(this.selectedDate);
    const dayIndex = weekDays.findIndex((d) => {
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return ds === dateStr;
    });
    if (dayIndex < 0) return;

    const dayColHeaders = this.calendarGrid.querySelectorAll(
      ".post-week-day-col-header",
    );
    const dayColHeader = dayColHeaders[dayIndex] as HTMLElement;
    if (!dayColHeader) return;

    const hourCells = Array.from(
      dayColHeader.querySelectorAll(".post-week-hour-cell"),
    ) as HTMLElement[];

    // Знаходимо cellIdx початку і кінця через порівняння BoundingRect
    let firstActive = -1;
    let lastActive = -1;

    hourCells.forEach((cell, i) => {
      const cr = cell.getBoundingClientRect();
      // Комірка активна якщо перетинається з drag-діапазоном (хоча б частково)
      if (cr.right > dragClientLeft && cr.left < dragClientRight) {
        if (firstActive < 0) firstActive = i;
        lastActive = i;
        cell.classList.add("hour-drag-active");
      }
    });

    // Час початку і кінця (кроки по 30 хв)
    const totalMinutes = 12 * 60;
    const cellWidth = rect.width;
    const p1 = Math.min(this.weekDragStartX, this.weekDragCurrentX);
    const p2 = Math.max(this.weekDragStartX, this.weekDragCurrentX);
    const startMins = Math.round(((p1 / cellWidth) * totalMinutes) / 30) * 30;
    const endMins = Math.round(((p2 / cellWidth) * totalMinutes) / 30) * 30;

    if (firstActive >= 0 && lastActive >= 0) {
      // Перша комірка — час початку
      const sH = 8 + Math.floor(startMins / 60);
      const sM = startMins % 60;
      hourCells[firstActive].textContent =
        sM > 0 ? `${sH}:${String(sM).padStart(2, "0")}` : `${sH}`;

      // Остання комірка — час кінця
      if (lastActive !== firstActive) {
        const eH = 8 + Math.floor(endMins / 60);
        const eM = endMins % 60;
        hourCells[lastActive].textContent =
          eM > 0 ? `${eH}:${String(eM).padStart(2, "0")}` : `${eH}`;
      }
    }
  };

  private onWeekDragUp = (_e: MouseEvent): void => {
    document.removeEventListener("mousemove", this.onWeekDragMove);
    document.removeEventListener("mouseup", this.onWeekDragUp);

    if (!this.weekDragActive || !this.weekDragCell) {
      this.resetWeekSelection();
      return;
    }

    this.weekDragActive = false;
    const cell = this.weekDragCell;
    const rect = cell.getBoundingClientRect();
    const cellWidth = rect.width;
    const totalMinutes = 12 * 60;

    if (Math.abs(this.weekDragCurrentX - this.weekDragStartX) < 5) {
      this.resetWeekSelection();
      return;
    }

    const p1 = Math.min(this.weekDragStartX, this.weekDragCurrentX);
    const p2 = Math.max(this.weekDragStartX, this.weekDragCurrentX);

    let startMins = Math.round(((p1 / cellWidth) * totalMinutes) / 30) * 30;
    let endMins = Math.round(((p2 / cellWidth) * totalMinutes) / 30) * 30;
    if (startMins < 0) startMins = 0;
    if (endMins > totalMinutes) endMins = totalMinutes;
    if (endMins <= startMins) endMins = startMins + 30;

    const startTime = this.weekMinsToTime(startMins);
    const endTime = this.weekMinsToTime(endMins);
    const dateStr = cell.dataset.date || "";
    const slyusarId = parseInt(cell.dataset.slyusarId || "0") || null;
    const namePost = parseInt(cell.dataset.postId || "0") || null;

    this.openWeekModal(dateStr, startTime, endTime, slyusarId, namePost);
    this.resetWeekSelection();
  };

  /** Знімає підсвічування drag-годин і відновлює числа у заголовку */
  private clearDragHourHighlight(): void {
    if (!this.calendarGrid) return;
    const cells = this.calendarGrid.querySelectorAll(
      ".post-week-hour-cell.hour-drag-active",
    ) as NodeListOf<HTMLElement>;
    cells.forEach((cell) => {
      cell.classList.remove("hour-drag-active");
      // Відновлюємо оригінальне число години
      const absH = 8 + Array.from(cell.parentElement!.children).indexOf(cell);
      cell.textContent = String(absH);
    });
  }

  private resetWeekSelection(): void {
    this.weekDragActive = false;
    this.weekDragCell = null;
    this.clearDragHourHighlight();
    if (this.weekSelectionEl) {
      this.weekSelectionEl.style.display = "none";
      this.weekSelectionEl.remove();
    }
  }

  // ============== ТИЖНЕВИЙ ВИД — ПЕРЕМІЩЕННЯ БЛОКІВ (DRAG) ==============

  private handleWeekBlockMouseDown(e: MouseEvent, block: HTMLElement): void {
    // Перевірка прав
    const currentUser = this.getCurrentUserName();
    const currentAccess = this.getCurrentUserAccess();
    const creator = block.dataset.xtoZapusav || "";
    if (
      currentAccess !== "Адміністратор" &&
      creator &&
      creator !== currentUser
    ) {
      showNotification(
        `Ви не можете переміщати цей запис. Створив: ${creator}`,
        "error",
      );
      return;
    }

    this.weekMovingBlock = block;
    this.weekBlockDragStartX = e.clientX;
    this.weekBlockDragStartY = e.clientY;
    this.weekIsBlockDragging = false;

    document.addEventListener("mousemove", this.onWeekBlockMouseMove);
    document.addEventListener("mouseup", this.onWeekBlockMouseUp);
  }

  private startWeekBlockDrag(e: MouseEvent): void {
    if (!this.weekMovingBlock) return;

    const cell = this.weekMovingBlock.closest(
      ".post-week-day-track",
    ) as HTMLElement;
    this.weekMovingOriginalCell = cell;
    this.weekMovingOriginalLeft = this.weekMovingBlock.style.left;
    this.weekMovingOriginalWidth = this.weekMovingBlock.style.width;
    // Зберігаємо оригінальний текст часу
    const origTimeEl = this.weekMovingBlock.querySelector(
      ".post-week-block-line",
    );
    this.weekMovingOriginalTimeText = origTimeEl
      ? origTimeEl.textContent || ""
      : "";

    const rect = this.weekMovingBlock.getBoundingClientRect();
    this.weekBlockDragOffsetX = e.clientX - rect.left;

    // Фіксуємо розміри і переносимо в body
    this.weekMovingBlock.style.width = `${rect.width}px`;
    this.weekMovingBlock.style.height = `${rect.height}px`;
    this.weekMovingBlock.style.left = `${rect.left}px`;
    this.weekMovingBlock.style.top = `${rect.top}px`;
    this.weekMovingBlock.classList.add("week-dragging-active");
    document.body.appendChild(this.weekMovingBlock);
  }

  private onWeekBlockMouseMove = (e: MouseEvent): void => {
    if (!this.weekMovingBlock) return;

    if (!this.weekIsBlockDragging) {
      const dx = Math.abs(e.clientX - this.weekBlockDragStartX);
      const dy = Math.abs(e.clientY - this.weekBlockDragStartY);
      if (dx < 5 && dy < 5) return;
      this.weekIsBlockDragging = true;
      this.startWeekBlockDrag(e);
    }

    // Рухаємо блок за курсором
    this.weekMovingBlock.style.left = `${e.clientX - this.weekBlockDragOffsetX}px`;
    this.weekMovingBlock.style.top = `${e.clientY - this.weekMovingBlock.offsetHeight / 2}px`;

    // Визначаємо target track
    this.weekMovingBlock.style.pointerEvents = "none";
    const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
    this.weekMovingBlock.style.pointerEvents = "";

    this.calendarGrid
      ?.querySelectorAll(".week-drop-target")
      .forEach((el) => el.classList.remove("week-drop-target"));

    const targetTrack = elemBelow?.closest(
      ".post-week-day-track",
    ) as HTMLElement;
    this.weekMovingBlock.classList.remove(
      "week-drag-valid",
      "week-drag-invalid",
    );

    if (targetTrack) {
      targetTrack.classList.add("week-drop-target");
      const trackRect = targetTrack.getBoundingClientRect();
      const relativeX = e.clientX - this.weekBlockDragOffsetX - trackRect.left;
      const totalMinutes = 12 * 60;
      let startMins =
        Math.round(((relativeX / trackRect.width) * totalMinutes) / 30) * 30;
      const duration =
        parseInt(this.weekMovingBlock.dataset.end || "0") -
        parseInt(this.weekMovingBlock.dataset.start || "0");
      const endMins = startMins + duration;

      if (startMins >= 0 && endMins <= totalMinutes) {
        const hasOverlap = this.checkWeekBlockOverlap(
          startMins,
          endMins,
          targetTrack,
          this.weekMovingBlock,
        );
        this.weekMovingBlock.classList.add(
          hasOverlap ? "week-drag-invalid" : "week-drag-valid",
        );

        // ── Оновлюємо час у блоці ───────────────────────────────
        const sH = String(8 + Math.floor(startMins / 60)).padStart(2, "0");
        const sM = String(startMins % 60).padStart(2, "0");
        const eH = String(8 + Math.floor(endMins / 60)).padStart(2, "0");
        const eM = String(endMins % 60).padStart(2, "0");
        const timeLine = this.weekMovingBlock.querySelector(
          ".post-week-block-line",
        );
        if (timeLine) {
          timeLine.textContent = `🕐 ${sH}:${sM}-${eH}:${eM}`;
        }

        // ── Підсвічуємо комірки заголовку для цього дня ─────────
        this.clearDragHourHighlight();
        const dateStr = targetTrack.dataset.date || "";
        if (dateStr && this.calendarGrid) {
          const weekDays = this.getWeekDays(this.selectedDate);
          const dayIndex = weekDays.findIndex((d) => {
            const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            return ds === dateStr;
          });
          if (dayIndex >= 0) {
            const dayColHeader = this.calendarGrid.querySelectorAll(
              ".post-week-day-col-header",
            )[dayIndex] as HTMLElement;
            if (dayColHeader) {
              // Межі блоку в clientX координатах
              const blockLeft = trackRect.left + Math.max(0, relativeX);
              const blockRight =
                blockLeft +
                ((endMins - startMins) / totalMinutes) * trackRect.width;
              (
                Array.from(
                  dayColHeader.querySelectorAll(".post-week-hour-cell"),
                ) as HTMLElement[]
              ).forEach((cell) => {
                const cr = cell.getBoundingClientRect();
                if (cr.right > blockLeft && cr.left < blockRight) {
                  cell.classList.add("hour-drag-active");
                }
              });
              // Час в першій та останній активній комірці
              const activeCells = Array.from(
                dayColHeader.querySelectorAll(
                  ".post-week-hour-cell.hour-drag-active",
                ),
              ) as HTMLElement[];
              if (activeCells.length > 0) {
                activeCells[0].textContent = `${sH}:${sM}`;
                if (activeCells.length > 1) {
                  activeCells[activeCells.length - 1].textContent =
                    `${eH}:${eM}`;
                }
              }
            }
          }
        }
      } else {
        this.weekMovingBlock.classList.add("week-drag-invalid");
        this.clearDragHourHighlight();
      }
    } else {
      this.weekMovingBlock.classList.add("week-drag-invalid");
      this.clearDragHourHighlight();
    }
  };

  private onWeekBlockMouseUp = async (e: MouseEvent): Promise<void> => {
    if (!this.weekMovingBlock) return;

    document.removeEventListener("mousemove", this.onWeekBlockMouseMove);
    document.removeEventListener("mouseup", this.onWeekBlockMouseUp);

    // Прибираємо підсвічування
    this.calendarGrid
      ?.querySelectorAll(".week-drop-target")
      .forEach((el) => el.classList.remove("week-drop-target"));
    this.clearDragHourHighlight();

    if (!this.weekIsBlockDragging) {
      // Не було drag, просто клік — нічого не робимо
      this.weekMovingBlock = null;
      this.weekIsBlockDragging = false;
      return;
    }

    const isValid = this.weekMovingBlock.classList.contains("week-drag-valid");

    this.weekMovingBlock.style.pointerEvents = "none";
    const targetTrack = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest(".post-week-day-track") as HTMLElement;
    this.weekMovingBlock.style.pointerEvents = "";

    // Скидаємо drag-стилі
    this.weekMovingBlock.classList.remove(
      "week-dragging-active",
      "week-drag-valid",
      "week-drag-invalid",
    );
    this.weekMovingBlock.style.position = "absolute";
    this.weekMovingBlock.style.height = "";
    this.weekMovingBlock.style.top = "1px";
    this.weekMovingBlock.style.bottom = "1px";

    if (isValid && targetTrack) {
      // Commit — обчислюємо нову позицію
      const trackRect = targetTrack.getBoundingClientRect();
      const relativeX = e.clientX - this.weekBlockDragOffsetX - trackRect.left;
      const totalMinutes = 12 * 60;
      let startMins =
        Math.round(((relativeX / trackRect.width) * totalMinutes) / 30) * 30;
      const duration =
        parseInt(this.weekMovingBlock.dataset.end || "0") -
        parseInt(this.weekMovingBlock.dataset.start || "0");
      const endMins = startMins + duration;

      if (startMins < 0) startMins = 0;
      const leftPercent = (startMins / totalMinutes) * 100;
      const widthPercent = (duration / totalMinutes) * 100;

      this.weekMovingBlock.dataset.start = startMins.toString();
      this.weekMovingBlock.dataset.end = endMins.toString();
      this.weekMovingBlock.style.left = `${leftPercent}%`;
      this.weekMovingBlock.style.width = `${widthPercent}%`;

      // Оновлюємо дату та slyusar_id з нового треку
      const newDate = targetTrack.dataset.date || "";
      const newSlyusarId = targetTrack.dataset.slyusarId || "";
      this.weekMovingBlock.dataset.date = newDate;
      this.weekMovingBlock.dataset.slyusarId = newSlyusarId;

      // Оновлюємо текст часу
      const sH = this.weekMinsToTime(startMins);
      const eH = this.weekMinsToTime(endMins);
      const timeEl = this.weekMovingBlock.querySelector(
        ".post-week-block-line",
      );
      if (timeEl) timeEl.textContent = `🕐 ${sH}-${eH}`;

      targetTrack.appendChild(this.weekMovingBlock);

      // === ЗБЕРІГАЄМО В БД ===
      const postArxivId = this.weekMovingBlock.dataset.postArxivId;
      if (postArxivId) {
        try {
          const dataOn = `${newDate}T${sH}:00`;
          const dataOff = `${newDate}T${eH}:00`;

          const { error } = await supabase
            .from("post_arxiv")
            .update({
              slyusar_id: parseInt(newSlyusarId),
              data_on: dataOn,
              data_off: dataOff,
            })
            .eq("post_arxiv_id", parseInt(postArxivId));

          if (error) {
            showNotification("Помилка оновлення в БД", "error");
            this.revertWeekBlockDrag();
          } else {
            showNotification("Запис переміщено!", "success");
          }
        } catch {
          showNotification("Помилка при переміщенні", "error");
          this.revertWeekBlockDrag();
        }
      }
    } else {
      this.revertWeekBlockDrag();
    }

    this.weekMovingBlock = null;
    this.weekMovingOriginalCell = null;
    this.weekIsBlockDragging = false;
  };

  private revertWeekBlockDrag(): void {
    if (!this.weekMovingBlock || !this.weekMovingOriginalCell) return;
    this.weekMovingBlock.style.left = this.weekMovingOriginalLeft;
    this.weekMovingBlock.style.width = this.weekMovingOriginalWidth;
    this.weekMovingBlock.style.height = "";
    this.weekMovingBlock.style.top = "1px";
    this.weekMovingBlock.style.bottom = "1px";
    this.weekMovingBlock.style.position = "absolute";
    // Відновлюємо оригінальний текст часу
    if (this.weekMovingOriginalTimeText) {
      const timeEl = this.weekMovingBlock.querySelector(
        ".post-week-block-line",
      );
      if (timeEl) timeEl.textContent = this.weekMovingOriginalTimeText;
    }
    this.weekMovingOriginalCell.appendChild(this.weekMovingBlock);
  }

  /** Перевірка перетинів блоків в тижневій комірці */
  private checkWeekBlockOverlap(
    startMins: number,
    endMins: number,
    cell: HTMLElement,
    excludeBlock: HTMLElement,
  ): boolean {
    const blocks = Array.from(
      cell.querySelectorAll(".post-week-block"),
    ) as HTMLElement[];
    for (const block of blocks) {
      if (block === excludeBlock) continue;
      const bStart = parseInt(block.dataset.start || "0");
      const bEnd = parseInt(block.dataset.end || "0");
      if (startMins < bEnd && endMins > bStart) return true;
    }
    return false;
  }

  // ============== ТИЖНЕВИЙ ВИД — RESIZE БЛОКІВ ==============

  private handleWeekResizeMouseDown(
    e: MouseEvent,
    block: HTMLElement,
    side: "left" | "right",
  ): void {
    const currentUser = this.getCurrentUserName();
    const currentAccess = this.getCurrentUserAccess();
    const creator = block.dataset.xtoZapusav || "";
    if (
      currentAccess !== "Адміністратор" &&
      creator &&
      creator !== currentUser
    ) {
      showNotification(
        `Ви не можете змінювати розмір запису. Створив: ${creator}`,
        "error",
      );
      return;
    }

    this.weekIsResizing = true;
    this.weekResizingBlock = block;
    this.weekResizeHandleSide = side;
    this.weekResizeStartX = e.clientX;
    this.weekResizeOrigStartMins = parseInt(block.dataset.start || "0");
    this.weekResizeOrigEndMins = parseInt(block.dataset.end || "0");
    block.style.transition = "none";

    document.addEventListener("mousemove", this.onWeekResizeMouseMove);
    document.addEventListener("mouseup", this.onWeekResizeMouseUp);
  }

  private onWeekResizeMouseMove = (e: MouseEvent): void => {
    if (
      !this.weekIsResizing ||
      !this.weekResizingBlock ||
      !this.weekResizeHandleSide
    )
      return;

    const track = this.weekResizingBlock.closest(
      ".post-week-day-track",
    ) as HTMLElement;
    if (!track) return;

    const trackWidth = track.getBoundingClientRect().width;
    const deltaX = e.clientX - this.weekResizeStartX;
    const totalMinutes = 12 * 60;
    const deltaMins = (deltaX / trackWidth) * totalMinutes;

    let newStart = this.weekResizeOrigStartMins;
    let newEnd = this.weekResizeOrigEndMins;

    if (this.weekResizeHandleSide === "left") {
      newStart =
        Math.round((this.weekResizeOrigStartMins + deltaMins) / 30) * 30;
      if (newStart < 0) newStart = 0;
      if (newStart >= newEnd - 30) newStart = newEnd - 30;
    } else {
      newEnd = Math.round((this.weekResizeOrigEndMins + deltaMins) / 30) * 30;
      if (newEnd > totalMinutes) newEnd = totalMinutes;
      if (newEnd <= newStart + 30) newEnd = newStart + 30;
    }

    const leftPercent = (newStart / totalMinutes) * 100;
    const widthPercent = ((newEnd - newStart) / totalMinutes) * 100;
    this.weekResizingBlock.style.left = `${leftPercent}%`;
    this.weekResizingBlock.style.width = `${widthPercent}%`;

    this.weekResizingBlock.dataset.tempStart = newStart.toString();
    this.weekResizingBlock.dataset.tempEnd = newEnd.toString();

    // Оновлюємо текст часу
    const sH = this.weekMinsToTime(newStart);
    const eH = this.weekMinsToTime(newEnd);
    const timeEl = this.weekResizingBlock.querySelector(
      ".post-week-block-line",
    );
    if (timeEl) timeEl.textContent = `🕐 ${sH}-${eH}`;

    // Перевірка перетину
    const hasOverlap = this.checkWeekBlockOverlap(
      newStart,
      newEnd,
      track,
      this.weekResizingBlock,
    );
    if (hasOverlap) {
      this.weekResizingBlock.classList.add("week-drag-invalid");
    } else {
      this.weekResizingBlock.classList.remove("week-drag-invalid");
    }
  };

  private onWeekResizeMouseUp = async (_e: MouseEvent): Promise<void> => {
    if (!this.weekIsResizing || !this.weekResizingBlock) return;

    document.removeEventListener("mousemove", this.onWeekResizeMouseMove);
    document.removeEventListener("mouseup", this.onWeekResizeMouseUp);

    this.weekResizingBlock.style.transition = "";
    this.weekResizingBlock.classList.remove("week-drag-invalid");

    const newStart = parseInt(
      this.weekResizingBlock.dataset.tempStart ||
        this.weekResizeOrigStartMins.toString(),
    );
    const newEnd = parseInt(
      this.weekResizingBlock.dataset.tempEnd ||
        this.weekResizeOrigEndMins.toString(),
    );
    delete this.weekResizingBlock.dataset.tempStart;
    delete this.weekResizingBlock.dataset.tempEnd;

    if (
      newStart === this.weekResizeOrigStartMins &&
      newEnd === this.weekResizeOrigEndMins
    ) {
      this.resetWeekResizeState();
      return;
    }

    // Перевірка overlap
    const track = this.weekResizingBlock.closest(
      ".post-week-day-track",
    ) as HTMLElement;
    const hasOverlap = track
      ? this.checkWeekBlockOverlap(
          newStart,
          newEnd,
          track,
          this.weekResizingBlock,
        )
      : false;

    if (hasOverlap) {
      // Revert
      const totalMinutes = 12 * 60;
      const origLeft = (this.weekResizeOrigStartMins / totalMinutes) * 100;
      const origWidth =
        ((this.weekResizeOrigEndMins - this.weekResizeOrigStartMins) /
          totalMinutes) *
        100;
      this.weekResizingBlock.style.left = `${origLeft}%`;
      this.weekResizingBlock.style.width = `${origWidth}%`;

      const sH = this.weekMinsToTime(this.weekResizeOrigStartMins);
      const eH = this.weekMinsToTime(this.weekResizeOrigEndMins);
      const timeEl = this.weekResizingBlock.querySelector(
        ".post-week-block-line",
      );
      if (timeEl) timeEl.textContent = `🕐 ${sH}-${eH}`;

      showNotification(
        "Неможливо змінити час: перетин з іншим записом",
        "error",
      );
    } else {
      // Commit — зберігаємо
      this.weekResizingBlock.dataset.start = newStart.toString();
      this.weekResizingBlock.dataset.end = newEnd.toString();

      const postArxivId = this.weekResizingBlock.dataset.postArxivId;
      const dateStr = this.weekResizingBlock.dataset.date || "";

      if (postArxivId) {
        const sH = this.weekMinsToTime(newStart);
        const eH = this.weekMinsToTime(newEnd);
        const dataOn = `${dateStr}T${sH}:00`;
        const dataOff = `${dateStr}T${eH}:00`;

        const { error } = await supabase
          .from("post_arxiv")
          .update({ data_on: dataOn, data_off: dataOff })
          .eq("post_arxiv_id", parseInt(postArxivId));

        if (error) {
          showNotification("Помилка оновлення часу", "error");
        } else {
          showNotification("Час оновлено!", "success");
        }
      }
    }

    this.resetWeekResizeState();
  };

  private resetWeekResizeState(): void {
    this.weekIsResizing = false;
    this.weekResizingBlock = null;
    this.weekResizeHandleSide = null;
  }

  /**
   * Відкриває модалку для створення запису у тижневому виді
   */
  private openWeekModal(
    dateStr: string,
    startTime: string,
    endTime: string,
    slyusarId: number | null,
    namePost: number | null,
  ): void {
    const data: Partial<ReservationData> = {
      slyusarId,
      namePost,
    };

    this.weekModal.open(
      dateStr,
      startTime,
      endTime,
      "",
      data,
      (resultData: ReservationData) => this.handleWeekModalSubmit(resultData),
      async (date, start, end, _excludeId) => {
        // Перевірка доступності через БД
        return this.checkWeekAvailability(date, start, end, slyusarId);
      },
      [], // busyIntervals — не обчислюємо тут, модалка сама перевірить
    );
  }

  /**
   * Перевірка доступності часу в БД для тижневого виду
   */
  private async checkWeekAvailability(
    date: string,
    startTime: string,
    endTime: string,
    slyusarId: number | null,
    excludeId?: number,
  ): Promise<{ valid: boolean; message?: string }> {
    if (!slyusarId)
      return { valid: false, message: "Не обрано пост (слюсаря)" };

    const startIso = `${date}T${startTime}:00`;
    const endIso = `${date}T${endTime}:00`;

    let query = supabase
      .from("post_arxiv")
      .select("post_arxiv_id")
      .eq("slyusar_id", slyusarId)
      .lt("data_on", endIso)
      .gt("data_off", startIso);

    if (excludeId) {
      query = query.neq("post_arxiv_id", excludeId);
    }

    const { data, error } = await query;

    if (error) return { valid: false, message: "Помилка перевірки" };
    if (data && data.length > 0)
      return { valid: false, message: "Цей час вже зайнятий" };
    return { valid: true };
  }

  /**
   * Обробка submit модалки тижневого виду — зберігаємо в БД та оновлюємо вид
   */
  private async handleWeekModalSubmit(data: ReservationData): Promise<void> {
    try {
      const startParts = data.startTime.split(":").map(Number);
      const endParts = data.endTime.split(":").map(Number);
      const startHour = startParts[0];
      const startMin = startParts[1];
      const endHour = endParts[0];
      const endMin = endParts[1];

      const dataOn = `${data.date}T${startHour.toString().padStart(2, "0")}:${startMin.toString().padStart(2, "0")}:00`;
      const dataOff = `${data.date}T${endHour.toString().padStart(2, "0")}:${endMin.toString().padStart(2, "0")}:00`;

      // Текстовий формат клієнта/авто
      const clientText = `${data.clientName || ""}|||${data.clientPhone || ""}`;
      const carText = `${data.carModel || ""}|||${data.carNumber || ""}`;

      // Отримуємо поточного користувача
      let xtoZapusav = "";
      try {
        const stored = localStorage.getItem("userAuthData");
        if (stored) {
          const userData = JSON.parse(stored);
          xtoZapusav = userData.Name || "";
        }
      } catch {}

      const payload: any = {
        status: data.status || "Запланований",
        client_id: clientText,
        cars_id: carText,
        komentar: data.comment || "",
        data_on: dataOn,
        data_off: dataOff,
        slyusar_id: data.slyusarId,
        name_post: data.namePost,
        act_id: data.actId || null,
        xto_zapusav: xtoZapusav,
      };

      // Якщо є postArxivId — оновлюємо, інакше створюємо
      if (data.postArxivId) {
        const { error } = await supabase
          .from("post_arxiv")
          .update(payload)
          .eq("post_arxiv_id", data.postArxivId);
        if (error) {
          showNotification("Помилка оновлення в БД", "error");
          return;
        }
        showNotification("Запис оновлено!", "success");
      } else {
        const { error } = await supabase.from("post_arxiv").insert(payload);
        if (error) {
          showNotification("Помилка збереження в БД", "error");
          return;
        }
        showNotification("Запис створено!", "success");
      }
      this.weekModal.close();

      // Перезавантажуємо тижневий вид
      this.renderWeekView();
      await this.loadWeekArxivData();

      // Оновлюємо індикатори
      const dateFromPayload = data.date;
      if (
        typeof (window as any).refreshOccupancyIndicatorsForDates === "function"
      ) {
        setTimeout(
          () =>
            (window as any).refreshOccupancyIndicatorsForDates([
              dateFromPayload,
            ]),
          100,
        );
      }
    } catch (err) {
      showNotification("Помилка при створенні запису", "error");
    }
  }

  private changeDate(delta: number): void {
    const oldMonth = this.selectedDate.getMonth();
    const oldYear = this.selectedDate.getFullYear();

    this.selectedDate.setDate(this.selectedDate.getDate() + delta);
    this.viewMonth = this.selectedDate.getMonth();
    this.viewYear = this.selectedDate.getFullYear();

    if (this.isWeekView) {
      this.render();
      this.loadWeekArxivData();
      return;
    }

    // Якщо місяць змінився - потрібен повний рендеринг
    if (
      oldMonth !== this.selectedDate.getMonth() ||
      oldYear !== this.selectedDate.getFullYear()
    ) {
      this.render();
    } else {
      // Той самий місяць - просто оновлюємо підсвічування
      this.updateDateSelection();
    }

    this.reloadArxivData();
  }

  private changeMonth(delta: number): void {
    this.viewMonth += delta;
    if (this.viewMonth < 0) {
      this.viewMonth = 11;
      this.viewYear--;
    } else if (this.viewMonth > 11) {
      this.viewMonth = 0;
      this.viewYear++;
    }
    this.render();
    this.reloadArxivData();
  }

  /**
   * Перевіряє чи відображається вказаний місяць у міні-календарі
   */
  private isMonthVisible(month: number, year: number): boolean {
    const currentMonth = this.viewMonth;
    const currentYear = this.viewYear;

    // Поточний місяць
    if (month === currentMonth && year === currentYear) return true;

    // Наступний місяць
    const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
    const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;
    if (month === nextMonth && year === nextYear) return true;

    return false;
  }

  /**
   * Оновлює підсвічування вибраної дати без повного рендерингу
   */
  private updateDateSelection(): void {
    // Оновлюємо текст дати в header
    if (this.headerDateDisplay) {
      this.headerDateDisplay.textContent = this.formatFullDate(
        this.selectedDate,
      );
    }

    // Оновлюємо візуалізацію минулого/майбутнього часу
    this.updateTimeMarker();

    // Видаляємо клас з усіх дат
    const allDates = document.querySelectorAll(".day-container span");
    allDates.forEach((span) => {
      span.classList.remove("post-selected-date");
      // Відновлюємо клас сьогоднішньої дати якщо потрібно
      const dayContainer = span.parentElement;
      if (dayContainer instanceof HTMLElement) {
        const monthElement = dayContainer.closest(".post-month-calendar");
        if (monthElement) {
          const h3 = monthElement.querySelector("h3");
          if (h3 && h3.textContent) {
            const monthName = h3.textContent;
            const monthIndex = this.getMonthIndexByName(monthName);
            if (monthIndex !== -1) {
              const dayNumber = parseInt(span.textContent || "0");
              if (!isNaN(dayNumber)) {
                const date = new Date(this.viewYear, monthIndex, dayNumber);
                if (date.toDateString() === this.today.toDateString()) {
                  span.classList.add("post-today");
                }
              }
            }
          }
        }
      }
    });

    // Додаємо клас до вибраної дати
    const selectedDay = this.selectedDate.getDate();
    const selectedMonth = this.selectedDate.getMonth();
    const selectedYear = this.selectedDate.getFullYear();

    allDates.forEach((span) => {
      if (!span.textContent) return;
      const dayNumber = parseInt(span.textContent);
      if (isNaN(dayNumber)) return;

      // Визначаємо до якого місяця належить цей день
      const dayContainer = span.parentElement;
      if (dayContainer instanceof HTMLElement) {
        const monthElement = dayContainer.closest(".post-month-calendar");
        if (monthElement) {
          const h3 = monthElement.querySelector("h3");
          if (h3 && h3.textContent) {
            const monthName = h3.textContent;
            const monthIndex = this.getMonthIndexByName(monthName);
            if (monthIndex !== -1) {
              // Визначаємо рік (поточний або наступний)
              let year = this.viewYear;
              if (this.viewMonth === 11 && monthIndex === 0) {
                year = this.viewYear + 1;
              }

              if (
                dayNumber === selectedDay &&
                monthIndex === selectedMonth &&
                year === selectedYear
              ) {
                span.classList.add("post-selected-date");
                span.classList.remove("post-today");
              }
            }
          }
        }
      }
    });
  }

  /**
   * Отримує індекс місяця за назвою
   */
  private getMonthIndexByName(monthName: string): number {
    const months = [
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
    return months.indexOf(monthName);
  }

  /**
   * Перезавантажує дані бронювань з БД для нової дати
   */
  private reloadArxivData(): void {
    if (this.postArxiv) {
      this.postArxiv.clearAllBlocks();
      this.postArxiv.loadArxivDataForCurrentDate();
    }
  }

  private toggleSection(sectionId: number): void {
    const section = this.sections.find((s) => s.id === sectionId);
    if (section) {
      section.collapsed = !section.collapsed;

      // Знаходимо елемент контенту секції в DOM
      const sectionContent = document.querySelector(
        `.post-section-content[data-section-id="${sectionId}"]`,
      ) as HTMLElement;

      if (sectionContent) {
        // Перемикаємо клас hidden
        sectionContent.classList.toggle("hidden", section.collapsed);

        // Оновлюємо іконку кнопки toggle
        const sectionGroup = sectionContent.closest(".post-section-group");
        const toggleBtn = sectionGroup?.querySelector(".post-toggle-btn");
        if (toggleBtn) {
          toggleBtn.textContent = section.collapsed ? "▶" : "▼";
        }

        // Якщо секція розгортається - завантажуємо блоки для постів цієї секції
        if (!section.collapsed && this.postArxiv) {
          const slyusarIds = section.posts.map((post) => post.id);
          this.postArxiv.loadArxivDataForSlyusars(slyusarIds);
        }
      }
    }
  }

  private deleteSection(sectionId: number): void {
    // Знаходимо секцію для отримання назви та всіх slyusar_id постів
    const section = this.sections.find((s) => s.id === sectionId);
    if (section) {
      const sectionName = section.name;

      // Додаємо всі slyusar_id постів до списку видалених
      section.posts.forEach((post) => {
        if (!this.deletedSlyusarIds.includes(post.id)) {
          this.deletedSlyusarIds.push(post.id);
        }
      });

      this.sections = this.sections.filter((s) => s.id !== sectionId);
      this.renderCurrentView();

      // Показуємо повідомлення
      showNotification(`Видалено цех: ${sectionName}`, "warning");
    }
  }

  private deletePost(sectionId: number, postId: number): void {
    const section = this.sections.find((s) => s.id === sectionId);
    if (section) {
      // Знаходимо пост для отримання назви
      const post = section.posts.find((p) => p.id === postId);
      if (post) {
        const postTitle = post.title;
        const postSubtitle = post.subtitle;

        // Додаємо slyusar_id до списку видалених
        if (!this.deletedSlyusarIds.includes(postId)) {
          this.deletedSlyusarIds.push(postId);
        }

        section.posts = section.posts.filter((p) => p.id !== postId);
        this.renderCurrentView();

        // Показуємо повідомлення
        showNotification(
          `Видалено пост: ${postTitle} - ${postSubtitle}`,
          "warning",
        );
      }
    }
  }

  /**
   * Відкриває модалку для додавання поста
   * @param sectionName Опціональна назва секції для попереднього заповнення
   */
  private openAddPostModal(sectionName?: string): void {
    this.postModal.open((data: PostData) => {
      // Шукаємо існуючу секцію за назвою цеху
      let section = this.sections.find((s) => s.name === data.cehTitle);

      // Якщо секції немає - створюємо нову
      if (!section) {
        section = {
          id: Date.now(),
          realCategoryId: "", // TODO: Потрібно якось дізнатись ID нової категорії або створити її
          name: data.cehTitle,
          collapsed: false,
          posts: [],
        };
        this.sections.push(section);
      }

      // Додаємо пост до секції
      section.posts.push({
        id: Date.now() + 1,
        postId: 0, // Буде заповнено пізніше
        title: data.title,
        subtitle: data.subtitle,
        namber: 0,
      });

      this.renderCurrentView();
    }, sectionName);
  }

  private renderSections(): void {
    const calendarGrid = this.calendarGrid;
    if (!calendarGrid) return;

    calendarGrid.innerHTML = "";

    // Створюємо фонову сітку для ідеального вирівнювання з хедером
    const bgGrid = document.createElement("div");
    bgGrid.className = "post-grid-background";
    for (let i = 0; i < 24; i++) {
      const cell = document.createElement("div");
      bgGrid.appendChild(cell);
    }
    calendarGrid.appendChild(bgGrid);

    this.sections.forEach((section, sectionIndex) => {
      const sectionGroup = document.createElement("div");
      sectionGroup.className = "post-section-group";
      sectionGroup.dataset.sectionId = section.id.toString();
      sectionGroup.dataset.sectionIndex = sectionIndex.toString();

      const sectionHeader = document.createElement("div");
      sectionHeader.className = "post-section-header";

      const headerLeft = document.createElement("div");
      headerLeft.className = "post-section-header-left";
      const nameSpan = document.createElement("span");
      nameSpan.textContent = section.name;
      headerLeft.appendChild(nameSpan);

      const headerRight = document.createElement("div");
      headerRight.className = "post-section-header-right";

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "post-delete-btn";
      deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>`;
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        this.deleteSection(section.id);
      };

      const toggleBtn = document.createElement("button");
      toggleBtn.className = "post-toggle-btn";
      if (section.collapsed) toggleBtn.classList.add("collapsed");
      toggleBtn.textContent = "▼";

      headerRight.appendChild(deleteBtn);
      headerRight.appendChild(toggleBtn);

      sectionHeader.appendChild(headerLeft);
      sectionHeader.appendChild(headerRight);

      // Drag and drop для всього хедера секції - тільки в режимі редагування
      sectionHeader.addEventListener("mousedown", (e) => {
        if (!this.editMode) return;

        // Не починати drag якщо клікнуто на кнопках
        const target = e.target as HTMLElement;
        if (
          target.closest(".post-delete-btn") ||
          target.closest(".post-toggle-btn")
        )
          return;

        e.preventDefault();
        this.startSectionDrag(e, sectionGroup, section.id);
      });

      // Click для toggle - тільки якщо НЕ в режимі редагування
      sectionHeader.addEventListener("click", (e) => {
        if (this.editMode) return;
        const target = e.target as HTMLElement;
        if (target.closest(".post-delete-btn")) return;
        this.toggleSection(section.id);
      });

      const sectionContent = document.createElement("div");
      sectionContent.className = "post-section-content";
      sectionContent.dataset.sectionId = section.id.toString();
      if (section.collapsed) sectionContent.classList.add("hidden");

      section.posts.forEach((post, postIndex) => {
        const row = document.createElement("div");
        row.className = "post-unified-row";
        row.dataset.postId = post.id.toString();
        row.dataset.postIndex = postIndex.toString();
        row.dataset.sectionId = section.id.toString();

        const rowLabel = document.createElement("div");
        rowLabel.className = "post-row-label";

        const deleteContainer = document.createElement("div");
        deleteContainer.className = "post-post-delete-container";

        const labelContent = document.createElement("div");
        labelContent.className = "post-row-label-content";
        labelContent.innerHTML = `
                    <div class="post-post-title">${post.title}</div>
                    <div class="post-post-subtitle">${post.subtitle}</div>
                `;

        const postDeleteBtn = document.createElement("button");
        postDeleteBtn.className = "post-post-delete-btn";
        postDeleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>`;
        postDeleteBtn.onclick = (e) => {
          e.stopPropagation();
          this.deletePost(section.id, post.id);
        };

        deleteContainer.appendChild(labelContent);
        deleteContainer.appendChild(postDeleteBtn);
        rowLabel.appendChild(deleteContainer);

        // Drag and drop для всього rowLabel - тільки в режимі редагування
        rowLabel.addEventListener("mousedown", (e) => {
          if (!this.editMode) return;

          // Не починати drag якщо клікнуто на кнопці видалення
          const target = e.target as HTMLElement;
          if (target.closest(".post-post-delete-btn")) return;

          e.preventDefault();
          this.startPostDrag(e, row, section.id, post.id);
        });

        const rowTrack = document.createElement("div");
        rowTrack.className = "post-row-track";
        rowTrack.dataset.slyusarId = post.id.toString();
        rowTrack.dataset.postId = post.postId.toString();

        row.appendChild(rowLabel);
        row.appendChild(rowTrack);
        sectionContent.appendChild(row);
      });

      const addPostBtn = document.createElement("button");
      addPostBtn.className = "post-add-post-btn";
      addPostBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Додати пост
            `;
      addPostBtn.onclick = () => this.openAddPostModal(section.name);
      sectionContent.appendChild(addPostBtn);

      sectionGroup.appendChild(sectionHeader);
      sectionGroup.appendChild(sectionContent);

      calendarGrid.appendChild(sectionGroup);
    });

    // Кнопка "Додати цех" видалена - тепер цех створюється через модалку "Додати пост"
  }

  // ============== DRAG AND DROP ДЛЯ СЕКЦІЙ ==============
  private startSectionDrag(
    _e: MouseEvent,
    element: HTMLElement,
    sectionId: number,
  ): void {
    this.draggedElement = element;
    this.draggedSectionId = sectionId;

    // Створюємо плейсхолдер
    this.dragPlaceholder = document.createElement("div");
    this.dragPlaceholder.className =
      "post-drag-placeholder post-section-placeholder";
    this.dragPlaceholder.style.height = `${element.offsetHeight}px`;

    // Додаємо клас для перетягування
    element.classList.add("dragging");

    // Фіксуємо позицію елемента
    const rect = element.getBoundingClientRect();
    element.style.position = "fixed";
    element.style.width = `${rect.width}px`;
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.zIndex = "1000";
    element.style.pointerEvents = "none";

    // Вставляємо плейсхолдер
    element.parentNode?.insertBefore(this.dragPlaceholder, element);

    const onMouseMove = (e: MouseEvent) => {
      if (!this.draggedElement) return;

      const newTop = e.clientY - rect.height / 2;
      this.draggedElement.style.top = `${newTop}px`;

      // Знаходимо елемент під курсором для визначення нової позиції
      this.updateSectionPlaceholder(e.clientY);
    };

    const onMouseUp = () => {
      this.finishSectionDrag();
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  private updateSectionPlaceholder(mouseY: number): void {
    if (!this.dragPlaceholder || !this.calendarGrid) return;

    const sectionSelector = this.isWeekView
      ? ".post-week-section-group:not(.dragging)"
      : ".post-section-group:not(.dragging)";

    const sectionGroups = Array.from(
      this.calendarGrid.querySelectorAll(sectionSelector),
    );

    for (const group of sectionGroups) {
      const rect = group.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;

      if (mouseY < midpoint) {
        group.parentNode?.insertBefore(this.dragPlaceholder, group);
        return;
      }
    }

    // Якщо курсор нижче всіх секцій - ставимо в кінець
    if (this.isWeekView) {
      const weekBody = this.calendarGrid.querySelector(".post-week-body");
      if (weekBody) {
        weekBody.appendChild(this.dragPlaceholder);
      } else {
        this.calendarGrid.appendChild(this.dragPlaceholder);
      }
    } else {
      const addBtn = this.calendarGrid.querySelector(".post-add-section-btn");
      if (addBtn) {
        addBtn.parentNode?.insertBefore(this.dragPlaceholder, addBtn);
      } else {
        this.calendarGrid.appendChild(this.dragPlaceholder);
      }
    }
  }

  private finishSectionDrag(): void {
    if (!this.draggedElement || !this.dragPlaceholder || !this.calendarGrid)
      return;

    const sectionSelector = this.isWeekView
      ? ".post-week-section-group:not(.dragging), .post-drag-placeholder"
      : ".post-section-group:not(.dragging), .post-drag-placeholder";

    // Визначаємо нову позицію
    const sectionGroups = Array.from(
      this.calendarGrid.querySelectorAll(sectionSelector),
    );

    // Знаходимо реальний індекс
    let newIndex = 0;
    for (let i = 0; i < sectionGroups.length; i++) {
      if (sectionGroups[i] === this.dragPlaceholder) break;
      if (
        !sectionGroups[i].classList.contains("dragging") &&
        !sectionGroups[i].classList.contains("post-drag-placeholder")
      ) {
        newIndex++;
      }
    }

    // Переміщуємо секцію в масиві
    const oldIndex = this.sections.findIndex(
      (s) => s.id === this.draggedSectionId,
    );
    if (oldIndex !== -1 && newIndex !== oldIndex) {
      const [movedSection] = this.sections.splice(oldIndex, 1);
      // Коригуємо індекс, якщо переміщуємо вниз
      const adjustedIndex = newIndex > oldIndex ? newIndex : newIndex;
      this.sections.splice(adjustedIndex, 0, movedSection);
    }

    // Очищуємо
    this.draggedElement.classList.remove("dragging");
    this.draggedElement.style.position = "";
    this.draggedElement.style.width = "";
    this.draggedElement.style.left = "";
    this.draggedElement.style.top = "";
    this.draggedElement.style.zIndex = "";
    this.draggedElement.style.pointerEvents = "";

    this.dragPlaceholder.remove();
    this.dragPlaceholder = null;
    this.draggedElement = null;
    this.draggedSectionId = null;

    // Перемальовуємо
    this.renderCurrentView();
  }

  // ============== DRAG AND DROP ДЛЯ ПОСТІВ ==============
  private startPostDrag(
    _e: MouseEvent,
    element: HTMLElement,
    sectionId: number,
    postId: number,
  ): void {
    this.draggedElement = element;
    this.draggedSectionId = sectionId;
    this.draggedPostId = postId;

    // Створюємо плейсхолдер
    this.dragPlaceholder = document.createElement("div");
    this.dragPlaceholder.className =
      "post-drag-placeholder post-post-placeholder";
    this.dragPlaceholder.style.height = `${element.offsetHeight}px`;

    // Додаємо клас для перетягування
    element.classList.add("dragging");

    // Фіксуємо позицію елемента
    const rect = element.getBoundingClientRect();
    element.style.position = "fixed";
    element.style.width = `${rect.width}px`;
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.zIndex = "1000";
    element.style.pointerEvents = "none";

    // Вставляємо плейсхолдер
    element.parentNode?.insertBefore(this.dragPlaceholder, element);

    const onMouseMove = (e: MouseEvent) => {
      if (!this.draggedElement) return;

      const newTop = e.clientY - rect.height / 2;
      this.draggedElement.style.top = `${newTop}px`;

      // Знаходимо елемент під курсором для визначення нової позиції
      this.updatePostPlaceholder(e.clientY);
    };

    const onMouseUp = () => {
      this.finishPostDrag();
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  private updatePostPlaceholder(mouseY: number): void {
    if (!this.dragPlaceholder || !this.calendarGrid) return;

    const groupSelector = this.isWeekView
      ? ".post-week-section-group"
      : ".post-section-group";
    const contentSelector = this.isWeekView
      ? ".post-week-section-content"
      : ".post-section-content";
    const rowSelector = this.isWeekView
      ? ".post-week-row:not(.dragging)"
      : ".post-unified-row:not(.dragging)";

    // Знаходимо секцію над якою курсор
    const sectionGroups = Array.from(
      this.calendarGrid.querySelectorAll(groupSelector),
    );
    let targetSectionContent: Element | null = null;
    let fallbackAddBtn: Element | null = null;

    for (const group of sectionGroups) {
      const rect = group.getBoundingClientRect();
      // Розширюємо зону пошуку трохи вверх і вниз, щоб легше було потрапити
      if (mouseY >= rect.top - 20 && mouseY <= rect.bottom + 20) {
        // Якщо знайшли групу, дивимось чи вона не згорнута
        if (!group.querySelector(".post-toggle-btn.collapsed")) {
          targetSectionContent = group.querySelector(contentSelector);
          fallbackAddBtn = group.querySelector(".post-add-post-btn");
          break;
        }
      }
    }

    if (!targetSectionContent) return;

    const postRows = Array.from(
      targetSectionContent.querySelectorAll(rowSelector),
    );

    for (const row of postRows) {
      const rect = row.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;

      if (mouseY < midpoint) {
        row.parentNode?.insertBefore(this.dragPlaceholder, row);
        return;
      }
    }

    // Якщо курсор нижче всіх постів у цій секції
    if (fallbackAddBtn) {
      fallbackAddBtn.parentNode?.insertBefore(
        this.dragPlaceholder,
        fallbackAddBtn,
      );
    } else {
      targetSectionContent.appendChild(this.dragPlaceholder);
    }
  }

  private finishPostDrag(): void {
    if (
      !this.draggedElement ||
      !this.dragPlaceholder ||
      !this.calendarGrid ||
      !this.draggedSectionId
    )
      return;

    // Знаходимо стару секцію
    const oldSectionIndex = this.sections.findIndex(
      (s) => s.id === this.draggedSectionId,
    );
    if (oldSectionIndex === -1) return;
    const oldSection = this.sections[oldSectionIndex];

    // Знаходимо нову секцію по плейсхолдеру
    const contentSelector = this.isWeekView
      ? ".post-week-section-content"
      : ".post-section-content";
    const rowSelector = this.isWeekView
      ? ".post-week-row, .post-drag-placeholder"
      : ".post-unified-row, .post-drag-placeholder";

    const newSectionContent = this.dragPlaceholder.closest(
      contentSelector,
    ) as HTMLElement;
    if (!newSectionContent) return;

    const newSectionId = parseInt(newSectionContent.dataset.sectionId || "0");
    const newSectionIndex = this.sections.findIndex(
      (s) => s.id === newSectionId,
    );
    if (newSectionIndex === -1) return;
    const newSection = this.sections[newSectionIndex];

    // Визначаємо нову позицію всередині нової секції
    const allElements = Array.from(
      newSectionContent.querySelectorAll(rowSelector),
    );

    let newIndex = 0;
    for (let i = 0; i < allElements.length; i++) {
      if (allElements[i] === this.dragPlaceholder) break;
      if (
        !allElements[i].classList.contains("dragging") &&
        !allElements[i].classList.contains("post-drag-placeholder")
      ) {
        newIndex++;
      }
    }

    // Видаляємо зі старої секції
    const oldPostIndex = oldSection.posts.findIndex(
      (p) => p.id === this.draggedPostId,
    );
    if (oldPostIndex !== -1) {
      const [movedPost] = oldSection.posts.splice(oldPostIndex, 1);

      // Додаємо в нову секцію
      newSection.posts.splice(newIndex, 0, movedPost);
    }

    // Очищуємо
    this.draggedElement.classList.remove("dragging");
    this.draggedElement.style.position = "";
    this.draggedElement.style.width = "";
    this.draggedElement.style.left = "";
    this.draggedElement.style.top = "";
    this.draggedElement.style.zIndex = "";
    this.draggedElement.style.pointerEvents = "";

    this.dragPlaceholder.remove();
    this.dragPlaceholder = null;
    this.draggedElement = null;
    this.draggedSectionId = null;
    this.draggedPostId = null;

    // Перемальовуємо
    this.renderCurrentView();
  }

  private formatFullDate(date: Date): string {
    const days = [
      "Неділя",
      "Понеділок",
      "Вівторок",
      "Середа",
      "Четвер",
      "Пʼятниця",
      "Субота",
    ];
    const months = [
      "січня",
      "лютого",
      "березня",
      "квітня",
      "травня",
      "червня",
      "липня",
      "серпня",
      "вересня",
      "жовтня",
      "листопада",
      "грудня",
    ];
    return `${days[date.getDay()]}, ${date.getDate()} ${
      months[date.getMonth()]
    } ${date.getFullYear()}`;
  }

  private getMonthName(monthIndex: number): string {
    const months = [
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
    return months[monthIndex];
  }

  private async loadMonthOccupancyStats(
    year: number,
    month: number,
  ): Promise<void> {
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0);

    const startStr = startDate.toISOString().split("T")[0];
    const endStr = endDate.toISOString().split("T")[0];

    try {
      const { data, error } = await supabase
        .from("post_arxiv")
        .select("data_on, data_off, name_post")
        .gte("data_on", startStr)
        .lte("data_on", endStr + "T23:59:59");

      if (error) {
        // console.error("Помилка завантаження статистики:", error);
        return;
      }

      if (data && data.length > 0) {
      }

      // Рахуємо загальну кількість постів з усіх цехів
      let totalPosts = 0;
      for (const section of this.sections) {
        totalPosts += section.posts.length;
      }

      // Групуємо по датах і постах
      const statsMap = new Map<string, Map<number, number>>();

      for (const record of data || []) {
        const dateOn = new Date(record.data_on);
        const dateOff = new Date(record.data_off);
        // Використовуємо локальну дату замість ISO для уникнення зміщення часового поясу
        const year = dateOn.getFullYear();
        const month = String(dateOn.getMonth() + 1).padStart(2, "0");
        const day = String(dateOn.getDate()).padStart(2, "0");
        const dateKey = `${year}-${month}-${day}`;
        const postId = (record as any).name_post;

        if (!postId) continue;

        const durationMinutes = Math.round(
          (dateOff.getTime() - dateOn.getTime()) / 60000,
        );

        if (!statsMap.has(dateKey)) {
          statsMap.set(dateKey, new Map());
        }

        const dayStats = statsMap.get(dateKey)!;
        const currentMinutes = dayStats.get(postId) || 0;
        dayStats.set(postId, currentMinutes + durationMinutes);
      }

      // Видаляємо тільки ключі для поточного місяця, а не всю статистику
      // Формуємо префікс для ключів цього місяця
      const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
      for (const key of this.monthOccupancyStats.keys()) {
        if (key.startsWith(monthPrefix)) {
          this.monthOccupancyStats.delete(key);
        }
      }

      for (const [dateKey, postOccupancy] of statsMap) {
        this.monthOccupancyStats.set(dateKey, {
          date: dateKey,
          postOccupancy,
          totalPosts,
        });
      }
    } catch (err) {
      // console.error("Помилка при завантаженні статистики зайнятості:", err);
    }
  }

  // Метод для оновлення індикаторів конкретних дат
  public async refreshOccupancyIndicatorsForDates(
    dates: string[],
  ): Promise<void> {
    // Збираємо унікальні місяці які треба перезавантажити
    const monthsToLoad = new Set<string>();
    dates.forEach((dateStr) => {
      const date = new Date(dateStr);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      monthsToLoad.add(key);
    });

    // Завантажуємо статистику для всіх потрібних місяців
    for (const monthKey of monthsToLoad) {
      const [year, month] = monthKey.split("-").map(Number);
      await this.loadMonthOccupancyStats(year, month);
    }

    // Оновлюємо індикатори тільки для вказаних дат
    dates.forEach((dateStr) => {
      const targetDate = new Date(dateStr);
      const targetDay = targetDate.getDate();
      const targetMonth = targetDate.getMonth();
      const targetYear = targetDate.getFullYear();

      // Шукаємо контейнер цього дня
      const allDayContainers = document.querySelectorAll(".day-container");
      allDayContainers.forEach((container) => {
        const span = container.querySelector("span");
        if (!span || !span.textContent) return;

        const dayNumber = parseInt(span.textContent);
        if (isNaN(dayNumber) || dayNumber !== targetDay) return;

        // Перевіряємо чи це той самий місяць
        const monthElement = container.closest(".post-month-calendar");
        if (!monthElement) return;

        const h3 = monthElement.querySelector("h3");
        if (!h3 || !h3.textContent) return;

        const monthName = h3.textContent;
        const monthIndex = this.getMonthIndexByName(monthName);
        if (monthIndex !== targetMonth) return;

        // Видаляємо старий індикатор
        const oldIndicator = container.querySelector(
          ".day-occupancy-indicator",
        );
        if (oldIndicator) {
          oldIndicator.remove();
        }

        // Формуємо ключ дати
        const yearStr = targetYear;
        const monthStr = String(targetMonth + 1).padStart(2, "0");
        const dayStr = String(targetDay).padStart(2, "0");
        const dateKey = `${yearStr}-${monthStr}-${dayStr}`;

        const stats = this.monthOccupancyStats.get(dateKey);

        if (stats && stats.totalPosts > 0) {
          const workDayMinutes = 720;
          let totalMinutes = 0;
          let fullyOccupiedPosts = 0;

          for (const [, minutes] of stats.postOccupancy) {
            totalMinutes += minutes;
            if (minutes >= workDayMinutes) {
              fullyOccupiedPosts++;
            }
          }

          const maxMinutes = stats.totalPosts * workDayMinutes;
          const occupancyPercent = (totalMinutes / maxMinutes) * 100;
          const isFullyOccupied = fullyOccupiedPosts === stats.totalPosts;

          if (occupancyPercent > 0) {
            const indicator = this.createOccupancyIndicator(
              occupancyPercent,
              isFullyOccupied,
            );
            container.insertBefore(indicator, span);
          }
        }
      });
    });
  }

  // Метод для оновлення індикаторів без повного рендерингу
  public async refreshOccupancyIndicators(): Promise<void> {
    // Перезавантажуємо статистику для поточного і наступного місяця
    const currentYear = this.selectedDate.getFullYear();
    const currentMonth = this.selectedDate.getMonth();

    await this.loadMonthOccupancyStats(currentYear, currentMonth);

    // Якщо є наступний місяць в календарі
    const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
    const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;
    await this.loadMonthOccupancyStats(nextYear, nextMonth);

    // Оновлюємо індикатори на всіх днях
    const allDayContainers = document.querySelectorAll(".day-container");
    allDayContainers.forEach((container) => {
      // Видаляємо старий індикатор
      const oldIndicator = container.querySelector(".day-occupancy-indicator");
      if (oldIndicator) {
        oldIndicator.remove();
      }

      // Отримуємо дату дня
      const span = container.querySelector("span");
      if (!span || !span.textContent) return;

      const dayNumber = parseInt(span.textContent);
      if (isNaN(dayNumber)) return;

      // Визначаємо дату контейнера
      const monthElement = container.closest(".post-month-calendar");
      if (!monthElement) return;

      const h3 = monthElement.querySelector("h3");
      if (!h3 || !h3.textContent) return;

      const monthName = h3.textContent;
      const monthIndex = this.getMonthIndexByName(monthName);
      if (monthIndex === -1) return;

      // Визначаємо рік правильно: якщо наступний місяць (січень) а поточний грудень - рік+1
      let year = this.selectedDate.getFullYear();
      const currentMonth = this.selectedDate.getMonth();
      if (
        monthIndex < currentMonth &&
        currentMonth === 11 &&
        monthIndex === 0
      ) {
        year = year + 1;
      }
      const month = monthIndex;
      const current = new Date(year, month, dayNumber);

      // Формуємо ключ дати
      const yearStr = current.getFullYear();
      const monthStr = String(current.getMonth() + 1).padStart(2, "0");
      const dayStr = String(current.getDate()).padStart(2, "0");
      const dateKey = `${yearStr}-${monthStr}-${dayStr}`;

      const stats = this.monthOccupancyStats.get(dateKey);

      if (stats && stats.totalPosts > 0) {
        const workDayMinutes = 720;
        let totalMinutes = 0;
        let fullyOccupiedPosts = 0;

        for (const [, minutes] of stats.postOccupancy) {
          totalMinutes += minutes;
          if (minutes >= workDayMinutes) {
            fullyOccupiedPosts++;
          }
        }

        const maxMinutes = stats.totalPosts * workDayMinutes;
        const occupancyPercent = (totalMinutes / maxMinutes) * 100;
        const isFullyOccupied = fullyOccupiedPosts === stats.totalPosts;

        if (occupancyPercent > 0) {
          const indicator = this.createOccupancyIndicator(
            occupancyPercent,
            isFullyOccupied,
          );
          container.insertBefore(indicator, span);
        }
      }
    });
  }

  private createOccupancyIndicator(
    occupancyPercent: number,
    isFullyOccupied: boolean,
  ): SVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "day-occupancy-indicator");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("viewBox", "0 0 24 24");

    const centerX = 12;
    const centerY = 12;
    const radius = 10;

    // Фоновий круг
    const bgCircle = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    bgCircle.setAttribute("cx", centerX.toString());
    bgCircle.setAttribute("cy", centerY.toString());
    bgCircle.setAttribute("r", radius.toString());
    bgCircle.setAttribute("fill", "#e0e0e0");
    bgCircle.setAttribute("opacity", "0.2");
    svg.appendChild(bgCircle);

    if (occupancyPercent > 0) {
      // Кольорова схема
      let fillColor = "#4caf50"; // Зелений
      if (isFullyOccupied || occupancyPercent >= 99.9) {
        fillColor = "#f44336"; // Червоний - всі пости завантажені
      } else if (occupancyPercent > 66) {
        fillColor = "#ff9800"; // Помаранчевий
      }

      // Якщо 100% (або майже), малюємо повне коло замість шляху, бо path зникає при 360 градусах
      if (occupancyPercent >= 99.9) {
        const fullCircle = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle",
        );
        fullCircle.setAttribute("cx", centerX.toString());
        fullCircle.setAttribute("cy", centerY.toString());
        fullCircle.setAttribute("r", radius.toString());
        fullCircle.setAttribute("fill", fillColor);
        fullCircle.setAttribute("opacity", "0.8");
        svg.appendChild(fullCircle);
      } else {
        // Розраховуємо кут для заливки (0% = 0°, 100% = 360°)
        // Мінімальний кут 20° (5.5%) щоб індикатор був видимий при низькій завантаженості
        const rawAngle = (occupancyPercent / 100) * 360;
        const angle = Math.max(rawAngle, 20);
        const angleRad = (angle * Math.PI) / 180;

        // Координати кінцевої точки дуги (починаємо зверху, тобто -90°)
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + angleRad;

        const x1 = centerX + radius * Math.cos(startAngle);
        const y1 = centerY + radius * Math.sin(startAngle);
        const x2 = centerX + radius * Math.cos(endAngle);
        const y2 = centerY + radius * Math.sin(endAngle);

        // Визначаємо чи дуга більша за 180°
        const largeArcFlag = angle > 180 ? 1 : 0;

        // Створюємо path для плавної заливки
        const path = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        const pathData = [
          `M ${centerX} ${centerY}`,
          `L ${x1} ${y1}`,
          `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
          "Z",
        ].join(" ");

        path.setAttribute("d", pathData);
        path.setAttribute("fill", fillColor);
        path.setAttribute("opacity", "0.8");

        svg.appendChild(path);
      }
    }

    return svg;
  }

  private async renderMonth(year: number, month: number): Promise<HTMLElement> {
    // Завантажуємо статистику для місяця
    await this.loadMonthOccupancyStats(year, month);

    const monthDiv = document.createElement("div");
    monthDiv.className = "post-month-calendar";

    const h3 = document.createElement("h3");
    h3.textContent = this.getMonthName(month);
    monthDiv.appendChild(h3);

    const weekdaysDiv = document.createElement("div");
    weekdaysDiv.className = "post-weekdays";
    ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"].forEach((d) => {
      const span = document.createElement("span");
      span.textContent = d;
      weekdaysDiv.appendChild(span);
    });
    monthDiv.appendChild(weekdaysDiv);

    const daysDiv = document.createElement("div");
    daysDiv.className = "post-days";

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    let startDay = firstDay.getDay();
    if (startDay === 0) startDay = 7;

    for (let i = 1; i < startDay; i++) {
      daysDiv.appendChild(document.createElement("span"));
    }

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const dayContainer = document.createElement("div");
      dayContainer.className = "day-container";

      const span = document.createElement("span");
      span.textContent = day.toString();
      const current = new Date(year, month, day);
      const dayOfWeek = current.getDay();

      if (current.toDateString() === this.selectedDate.toDateString()) {
        span.className = "post-selected-date";
      } else if (current.toDateString() === this.today.toDateString()) {
        span.className = "post-today";
      }

      // Додаємо клас для вихідних днів (субота = 6, неділя = 0)
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        dayContainer.classList.add("post-weekend");
      }

      dayContainer.addEventListener("click", () => {
        this.selectedDate = new Date(year, month, day);
        this.viewMonth = this.selectedDate.getMonth();
        this.viewYear = this.selectedDate.getFullYear();
        this.updateDateSelection();
        this.reloadArxivData();
      });

      // Додаємо індикатор зайнятості
      // Використовуємо локальну дату замість ISO для уникнення зміщення часового поясу
      const yearStr = current.getFullYear();
      const monthStr = String(current.getMonth() + 1).padStart(2, "0");
      const dayStr = String(current.getDate()).padStart(2, "0");
      const dateKey = `${yearStr}-${monthStr}-${dayStr}`;
      const stats = this.monthOccupancyStats.get(dateKey);

      if (stats && stats.totalPosts > 0) {
        // Рахуємо загальну зайнятість (робочий день = 12 годин = 720 хв)
        const workDayMinutes = 720;
        let totalMinutes = 0;
        let fullyOccupiedPosts = 0;

        for (const [, minutes] of stats.postOccupancy) {
          totalMinutes += minutes;
          if (minutes >= workDayMinutes) {
            fullyOccupiedPosts++;
          }
        }

        // Загальна зайнятість = сума хвилин всіх постів / (кількість постів * робочий день) * 100
        const maxMinutes = stats.totalPosts * workDayMinutes;
        const occupancyPercent = (totalMinutes / maxMinutes) * 100;
        const isFullyOccupied = fullyOccupiedPosts === stats.totalPosts;

        if (occupancyPercent > 0) {
          const indicator = this.createOccupancyIndicator(
            occupancyPercent,
            isFullyOccupied,
          );
          dayContainer.appendChild(indicator);
        }
      }

      dayContainer.appendChild(span);
      daysDiv.appendChild(dayContainer);
    }

    monthDiv.appendChild(daysDiv);
    return monthDiv;
  }

  private async render(): Promise<void> {
    const yearDisplay = document.getElementById("postYearDisplay");
    if (yearDisplay) {
      yearDisplay.textContent = this.viewYear.toString();
    }

    if (this.isWeekView) {
      // Тижневий вид
      this.renderWeekView();
      // Оновлюємо міні-календар
      if (this.calendarContainer) {
        this.calendarContainer.innerHTML = "";
        const currentMonth = await this.renderMonth(
          this.viewYear,
          this.viewMonth,
        );
        this.calendarContainer.appendChild(currentMonth);
        let nextMonth = this.viewMonth + 1;
        let nextYear = this.viewYear;
        if (nextMonth > 11) {
          nextMonth = 0;
          nextYear++;
        }
        const nextMonthElement = await this.renderMonth(nextYear, nextMonth);
        this.calendarContainer.appendChild(nextMonthElement);
      }
      return;
    }

    // Денний вид
    // Показуємо sticky-header
    const stickyHeader = document.querySelector(
      ".post-sticky-header",
    ) as HTMLElement;
    if (stickyHeader) {
      stickyHeader.style.display = "";
    }
    // Прибираємо клас тижневого виду
    if (this.schedulerWrapper) {
      this.schedulerWrapper.classList.remove("week-view-mode");
    }

    if (this.headerDateDisplay) {
      this.headerDateDisplay.textContent = this.formatFullDate(
        this.selectedDate,
      );
    }

    this.updateTimeMarker();
    this.renderSections();

    if (this.calendarContainer) {
      this.calendarContainer.innerHTML = "";
      const currentMonth = await this.renderMonth(
        this.viewYear,
        this.viewMonth,
      );
      this.calendarContainer.appendChild(currentMonth);

      let nextMonth = this.viewMonth + 1;
      let nextYear = this.viewYear;
      if (nextMonth > 11) {
        nextMonth = 0;
        nextYear++;
      }
      const nextMonthElement = await this.renderMonth(nextYear, nextMonth);
      this.calendarContainer.appendChild(nextMonthElement);
    }
  }
}

let schedulerAppInstance: SchedulerApp | null = null;

document.addEventListener("DOMContentLoaded", () => {
  // Check if we are on the planner page
  if (document.getElementById("postSchedulerWrapper")) {
    schedulerAppInstance = new SchedulerApp();
  }
});

// Глобальна функція для оновлення календаря після створення акту
(window as any).refreshPlannerCalendar = async () => {
  if (schedulerAppInstance) {
    if ((schedulerAppInstance as any).isWeekView) {
      // Тижневий вид — перезавантажуємо дані тижня
      await (schedulerAppInstance as any).render();
      await (schedulerAppInstance as any).loadWeekArxivData();
    } else if (schedulerAppInstance["postArxiv"]) {
      // Денний вид
      schedulerAppInstance["postArxiv"].clearAllBlocks();
      await schedulerAppInstance["postArxiv"].loadArxivDataForCurrentDate();
    }
    // Оновлюємо індикатори зайнятості
    await schedulerAppInstance.refreshOccupancyIndicators();
  }
};

// Глобальна функція для швидкого оновлення тільки індикаторів
(window as any).refreshOccupancyIndicators = async () => {
  if (schedulerAppInstance) {
    await schedulerAppInstance.refreshOccupancyIndicators();
  }
};

// Глобальна функція для оновлення індикаторів конкретних дат
(window as any).refreshOccupancyIndicatorsForDates = async (
  dates: string[],
) => {
  if (schedulerAppInstance) {
    await schedulerAppInstance.refreshOccupancyIndicatorsForDates(dates);
  }
};

// Допоміжна функція для парсингу дати з DOM елементів
(window as any).parseCurrentDate = (): string | null => {
  // Спробуємо з postHeaderDateDisplay
  const headerDate = document.getElementById("postHeaderDateDisplay");
  if (headerDate && headerDate.textContent) {
    const match = headerDate.textContent.match(/(\d{1,2})\s+(\S+)\s+(\d{4})/);
    if (match) {
      const day = match[1].padStart(2, "0");
      const monthName = match[2];
      const year = match[3];

      const months: Record<string, string> = {
        січня: "01",
        лютого: "02",
        березня: "03",
        квітня: "04",
        травня: "05",
        червня: "06",
        липня: "07",
        серпня: "08",
        вересня: "09",
        жовтня: "10",
        листопада: "11",
        грудня: "12",
      };

      const month = months[monthName.toLowerCase()];
      if (month) {
        return `${year}-${month}-${day}`;
      }
    }
  }

  // Спробуємо з модального вікна
  const hDay = document.getElementById("hDay");
  const hMonth = document.getElementById("hMonth");
  const hYear = document.getElementById("hYear");

  if (hDay && hMonth && hYear) {
    const day = hDay.textContent?.trim().padStart(2, "0");
    const monthName = hMonth.textContent?.trim();
    const year = hYear.textContent?.trim();

    const months: Record<string, string> = {
      січня: "01",
      лютого: "02",
      березня: "03",
      квітня: "04",
      травня: "05",
      червня: "06",
      липня: "07",
      серпня: "08",
      вересня: "09",
      жовтня: "10",
      листопада: "11",
      грудня: "12",
    };

    const month = monthName ? months[monthName.toLowerCase()] : null;
    if (day && month && year) {
      return `${year}-${month}-${day}`;
    }
  }

  return null;
};
