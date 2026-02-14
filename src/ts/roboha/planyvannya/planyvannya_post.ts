
//src\ts\roboha\planyvannya\planyvannya_post.ts
import '../../../scss/robocha/planyvannya/_planyvannya_post.scss';
import { supabase } from '../../vxid/supabaseClient';
import { showNotification } from '../zakaz_naraudy/inhi/vspluvauhe_povidomlenna';

export interface PostData {
  cehTitle: string;
  title: string;
  subtitle: string;
}

export type PostSubmitCallback = (data: PostData) => void;

interface CategoryData {
  category_id: number;
  category: string;
}

interface PostNameData {
  post_id: number;
  name: string;
  category: number; // category_id в post_name
}

interface AutocompleteData {
  categories: CategoryData[];
  postNames: PostNameData[];
  slyusarNames: string[];
}

export class PostModal {
  private modalOverlay: HTMLElement | null = null;
  private onSubmitCallback: PostSubmitCallback | null = null;
  private autocompleteData: AutocompleteData = {
    categories: [],
    postNames: [],
    slyusarNames: []
  };
  private activeDropdowns: HTMLElement[] = [];
  private selectedCategoryId: number | null = null;
  private selectedPostId: number | null = null;
  private lastValidCategoryId: number | null = null; // Запам'ятовуємо останній валідний ID
  private isLocked: boolean = true;
  private currentActionState: 'add' | 'edit' | 'delete' = 'add';

  constructor() {
    this.createModalHTML();
    this.bindEvents();
    this.loadAutocompleteData();
  }

  /**
   * Завантажує дані для автодоповнення з бази даних
   */
  private async loadAutocompleteData(): Promise<void> {
    try {
      // Завантажуємо категорії з post_category (з id)
      const { data: categoriesData, error: categoriesError } = await supabase
        .from("post_category")
        .select("category_id, category");

      if (categoriesError) throw categoriesError;
      this.autocompleteData.categories = categoriesData || [];

      // Завантажуємо назви постів з post_name (з category)
      const { data: postNamesData, error: postNamesError } = await supabase
        .from("post_name")
        .select("post_id, name, category");

      if (postNamesError) throw postNamesError;
      this.autocompleteData.postNames = postNamesData || [];

      // Завантажуємо імена слюсарів з slyusars
      const { data: slyusarsData, error: slyusarsError } = await supabase
        .from("slyusars")
        .select("data");

      if (slyusarsError) throw slyusarsError;
      this.autocompleteData.slyusarNames = slyusarsData
        ?.filter((item: any) => item.data?.Name)
        .map((item: any) => item.data.Name) || [];

      // Видаляємо дублікати для слюсарів
      this.autocompleteData.slyusarNames = [...new Set(this.autocompleteData.slyusarNames)];


    } catch (error) {

    }
  }

  /**
   * Повертає назви категорій
   */
  private getCategoryNames(): string[] {
    return this.autocompleteData.categories.map(c => c.category);
  }

  /**
   * Повертає пости, відфільтровані за обраною категорією
   * Коли замок відкритий - показує всі пости з БД
   */
  private getFilteredPostNames(): string[] {
    // Якщо замок відкритий - показуємо всі пости незалежно від категорії
    if (!this.isLocked) {
      return this.autocompleteData.postNames.map(p => p.name);
    }

    // Якщо замок закритий - фільтруємо по категорії
    if (this.selectedCategoryId === null) {
      // Якщо категорія не обрана - повертаємо всі пости
      return this.autocompleteData.postNames.map(p => p.name);
    }

    // Фільтруємо пости за category_id
    return this.autocompleteData.postNames
      .filter(p => p.category === this.selectedCategoryId)
      .map(p => p.name);
  }

  /**
   * Знаходить category_id за назвою категорії
   */
  private findCategoryIdByName(categoryName: string): number | null {
    const category = this.autocompleteData.categories
      .find(c => c.category.toLowerCase() === categoryName.toLowerCase());
    return category ? category.category_id : null;
  }

  /**
   * Знаходить post_id за назвою поста
   */
  private findPostIdByName(postName: string): number | null {
    const post = this.autocompleteData.postNames
      .find(p => p.name.toLowerCase() === postName.toLowerCase());
    return post ? post.post_id : null;
  }

  /**
   * Створює HTML модалки для поста
   */
  private createModalHTML(): void {
    // Перевіряємо чи модалка вже існує
    if (document.getElementById('postPostModalOverlay')) {
      this.modalOverlay = document.getElementById('postPostModalOverlay');
      return;
    }

    const modalHTML = `
      <div class="post-modal-overlay" id="postPostModalOverlay" style="display: none;">
        <div class="post-modal" id="postPostModal">
          <div class="post-modal-header">
            <h2 class="post-modal-title" id="postPostModalTitle">Новий пост</h2>
            
            <button class="post-edit-mode-btn" id="postModalLockBtn" title="Режим редагування">
              <span class="icon-view">🔒</span>
              <span class="icon-edit">🔓</span>
            </button>

            <div class="post-modal-controls" id="postModalControls">
              <button id="postModalAddBtn" class="post-mode-toggle-btn post-mode--edit" type="button">Додати</button>
            </div>

            <button class="post-modal-close" id="postPostModalClose">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="post-modal-body">
            <div class="post-form-group post-autocomplete-wrapper">
              <label class="post-form-label" id="postCehFormLabelTitle">Назва цеху</label>
              <input type="text" class="post-form-input" id="postCehFormInputTitle" placeholder="Наприклад: ЦЕХ зварювання" autocomplete="off">
              <div class="post-autocomplete-dropdown" id="postCehDropdown"></div>
            </div>
            <div class="post-form-group post-autocomplete-wrapper">
              <label class="post-form-label" id="postPostFormLabelTitle">Назва поста</label>
              <input type="text" class="post-form-input" id="postPostFormInputTitle" placeholder="Наприклад: Пост розвал-сходження" autocomplete="off">
              <div class="post-autocomplete-dropdown" id="postPostNameDropdown"></div>
            </div>
            <div class="post-form-group post-autocomplete-wrapper" id="postPostFormGroupSubtitle" style="display: flex;">
              <label class="post-form-label">Опис</label>
              <input type="text" class="post-form-input" id="postPostFormInputSubtitle" placeholder="Наприклад: Вовк Л." autocomplete="off">
              <div class="post-autocomplete-dropdown" id="postSlyusarDropdown"></div>
            </div>
          </div>
          <div class="post-modal-footer">
            <button class="post-btn post-btn-secondary" id="postPostModalCancel">Скасувати</button>
            <button class="post-btn post-btn-primary" id="postPostModalSubmit">Створити</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modalOverlay = document.getElementById('postPostModalOverlay');
  }

  /**
   * Прив'язує події до елементів модалки
   */
  private bindEvents(): void {
    const closeBtn = document.getElementById('postPostModalClose');
    const cancelBtn = document.getElementById('postPostModalCancel');
    const submitBtn = document.getElementById('postPostModalSubmit');
    const lockBtn = document.getElementById('postModalLockBtn');

    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.close());
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', () => this.handleSubmit());
    }

    if (lockBtn) {
      lockBtn.addEventListener('click', () => this.toggleLockMode());
    }

    const modeBtn = document.getElementById('postModalAddBtn');
    if (modeBtn) {
      modeBtn.addEventListener('click', () => this.cycleActionState());
    }

    if (this.modalOverlay) {
      this.modalOverlay.addEventListener('click', (e) => {
        if (e.target === this.modalOverlay) {
          this.close();
        }
      });
    }

    // Прив'язуємо автодоповнення до категорій
    this.setupCategoryAutocomplete();

    // Прив'язуємо автодоповнення до постів
    this.setupPostNameAutocomplete();

    // Прив'язуємо автодоповнення до слюсарів
    this.setupAutocomplete(
      'postPostFormInputSubtitle',
      'postSlyusarDropdown',
      () => this.autocompleteData.slyusarNames
    );

    // Закриття dropdown при кліку поза ним
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.post-autocomplete-wrapper')) {
        this.closeAllDropdowns();
      }
    });
  }

  /**
   * Налаштовує автодоповнення для категорій
   */
  private setupCategoryAutocomplete(): void {
    const input = document.getElementById('postCehFormInputTitle') as HTMLInputElement;
    const dropdown = document.getElementById('postCehDropdown');
    const postInput = document.getElementById('postPostFormInputTitle') as HTMLInputElement;

    if (!input || !dropdown) return;

    // При введенні тексту
    input.addEventListener('input', () => {
      const value = input.value.toLowerCase().trim();
      const data = this.getCategoryNames();

      // Оновлюємо selectedCategoryId
      this.selectedCategoryId = this.findCategoryIdByName(input.value.trim());

      // Очищуємо поле поста якщо змінилась категорія
      if (postInput) postInput.value = '';

      if (value.length === 0) {
        this.showDropdown(dropdown, data, input);
      } else {
        const filtered = data.filter(item =>
          item.toLowerCase().includes(value)
        );
        this.showDropdown(dropdown, filtered, input);
      }
    });

    // При фокусі показуємо dropdown
    // При кліку показуємо dropdown
    input.addEventListener('click', () => {
      const data = this.getCategoryNames();
      const value = input.value.toLowerCase().trim();

      if (value.length === 0) {
        this.showDropdown(dropdown, data, input);
      } else {
        const filtered = data.filter(item =>
          item.toLowerCase().includes(value)
        );
        this.showDropdown(dropdown, filtered, input);
      }
    });

    // При фокусі показуємо dropdown тільки якщо є текст
    input.addEventListener('focus', () => {
      const value = input.value.toLowerCase().trim();
      if (value.length > 0) {
        const data = this.getCategoryNames();
        const filtered = data.filter(item =>
          item.toLowerCase().includes(value)
        );
        this.showDropdown(dropdown, filtered, input);
      }
    });

    // При виборі категорії
    input.addEventListener('change', () => {
      this.selectedCategoryId = this.findCategoryIdByName(input.value.trim());
    });

    // Навігація клавіатурою
    input.addEventListener('keydown', (e) => {
      this.handleKeyboardNavigation(e, dropdown, input, () => {
        // При виборі через клавіатуру оновлюємо selectedCategoryId
        this.selectedCategoryId = this.findCategoryIdByName(input.value.trim());
        if (postInput) postInput.value = '';
      });
    });
  }

  /**
   * Налаштовує автодоповнення для назв постів
   */
  private setupPostNameAutocomplete(): void {
    const input = document.getElementById('postPostFormInputTitle') as HTMLInputElement;
    const dropdown = document.getElementById('postPostNameDropdown');
    const categoryInput = document.getElementById('postCehFormInputTitle') as HTMLInputElement;

    if (!input || !dropdown) return;

    // При введенні тексту
    input.addEventListener('input', () => {
      // Оновлюємо selectedCategoryId на основі поточного значення категорії
      if (categoryInput) {
        this.selectedCategoryId = this.findCategoryIdByName(categoryInput.value.trim());
      }

      const value = input.value.toLowerCase().trim();
      const data = this.getFilteredPostNames();

      if (value.length === 0) {
        this.showDropdown(dropdown, data, input);
      } else {
        const filtered = data.filter(item =>
          item.toLowerCase().includes(value)
        );
        this.showDropdown(dropdown, filtered, input);
      }
    });

    // При кліку показуємо dropdown
    input.addEventListener('click', () => {
      // Оновлюємо selectedCategoryId на основі поточного значення категорії
      if (categoryInput) {
        this.selectedCategoryId = this.findCategoryIdByName(categoryInput.value.trim());
      }

      const data = this.getFilteredPostNames();
      const value = input.value.toLowerCase().trim();

      if (value.length === 0) {
        this.showDropdown(dropdown, data, input);
      } else {
        const filtered = data.filter(item =>
          item.toLowerCase().includes(value)
        );
        this.showDropdown(dropdown, filtered, input);
      }
    });

    // При фокусі показуємо dropdown якщо є текст
    input.addEventListener('focus', () => {
      const value = input.value.toLowerCase().trim();
      if (value.length > 0) {
        if (categoryInput) {
          this.selectedCategoryId = this.findCategoryIdByName(categoryInput.value.trim());
        }
        const data = this.getFilteredPostNames();
        const filtered = data.filter(item =>
          item.toLowerCase().includes(value)
        );
        this.showDropdown(dropdown, filtered, input);
      }
    });

    // Навігація клавіатурою
    input.addEventListener('keydown', (e) => {
      this.handleKeyboardNavigation(e, dropdown, input);
    });
  }

  /**
   * Налаштовує автодоповнення для конкретного інпуту
   */
  private setupAutocomplete(
    inputId: string,
    dropdownId: string,
    getDataFn: () => string[]
  ): void {
    const input = document.getElementById(inputId) as HTMLInputElement;
    const dropdown = document.getElementById(dropdownId);

    if (!input || !dropdown) return;

    // При введенні тексту
    input.addEventListener('input', () => {
      const value = input.value.toLowerCase().trim();
      const data = getDataFn();

      if (value.length === 0) {
        this.showDropdown(dropdown, data, input);
      } else {
        const filtered = data.filter(item =>
          item.toLowerCase().includes(value)
        );
        this.showDropdown(dropdown, filtered, input);
      }
    });

    // При фокусі показуємо dropdown
    // При кліку показуємо dropdown
    input.addEventListener('click', () => {
      const data = getDataFn();
      const value = input.value.toLowerCase().trim();

      if (value.length === 0) {
        this.showDropdown(dropdown, data, input);
      } else {
        const filtered = data.filter(item =>
          item.toLowerCase().includes(value)
        );
        this.showDropdown(dropdown, filtered, input);
      }
    });

    // При фокусі показуємо dropdown тільки якщо є текст
    input.addEventListener('focus', () => {
      const value = input.value.toLowerCase().trim();
      if (value.length > 0) {
        const data = getDataFn();
        const filtered = data.filter(item =>
          item.toLowerCase().includes(value)
        );
        this.showDropdown(dropdown, filtered, input);
      }
    });

    // Навігація клавіатурою
    input.addEventListener('keydown', (e) => {
      this.handleKeyboardNavigation(e, dropdown, input);
    });
  }

  /**
   * Показує dropdown з варіантами
   */
  private showDropdown(dropdown: HTMLElement, items: string[], input: HTMLInputElement): void {
    this.closeAllDropdowns();

    if (items.length === 0) {
      dropdown.style.display = 'none';
      return;
    }

    dropdown.innerHTML = '';

    items.forEach((item, index) => {
      const option = document.createElement('div');
      option.className = 'post-autocomplete-option';
      option.textContent = item;
      option.dataset.index = index.toString();

      option.addEventListener('click', () => {
        input.value = item;
        dropdown.style.display = 'none';

        // Якщо це категорія - оновлюємо selectedCategoryId
        if (input.id === 'postCehFormInputTitle') {
          this.selectedCategoryId = this.findCategoryIdByName(item);
          if (this.selectedCategoryId) {
            this.lastValidCategoryId = this.selectedCategoryId; // Запам'ятовуємо останній валідний ID
          }
          const postInput = document.getElementById('postPostFormInputTitle') as HTMLInputElement;
          if (postInput) postInput.value = '';
        }

        // Якщо це пост - оновлюємо selectedPostId
        if (input.id === 'postPostFormInputTitle') {
          this.selectedPostId = this.findPostIdByName(item);
        }

        input.focus();
      });

      option.addEventListener('mouseenter', () => {
        this.setActiveOption(dropdown, index);
      });

      dropdown.appendChild(option);
    });

    dropdown.style.display = 'block';
    this.activeDropdowns.push(dropdown);
  }

  /**
   * Обробка навігації клавіатурою
   */
  private handleKeyboardNavigation(
    e: KeyboardEvent,
    dropdown: HTMLElement,
    input: HTMLInputElement,
    onSelect?: () => void
  ): void {
    if (dropdown.style.display !== 'block') return;

    const options = dropdown.querySelectorAll('.post-autocomplete-option');
    const activeOption = dropdown.querySelector('.post-autocomplete-option.active');
    let currentIndex = activeOption ? parseInt(activeOption.getAttribute('data-index') || '-1') : -1;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        currentIndex = Math.min(currentIndex + 1, options.length - 1);
        this.setActiveOption(dropdown, currentIndex);
        break;

      case 'ArrowUp':
        e.preventDefault();
        currentIndex = Math.max(currentIndex - 1, 0);
        this.setActiveOption(dropdown, currentIndex);
        break;

      case 'Enter':
        e.preventDefault();
        if (activeOption) {
          input.value = activeOption.textContent || '';
          dropdown.style.display = 'none';

          // Оновлюємо selectedPostId якщо це інпут поста
          if (input.id === 'postPostFormInputTitle') {
            this.selectedPostId = this.findPostIdByName(input.value);
          }

          if (onSelect) onSelect();
        }
        break;

      case 'Escape':
        dropdown.style.display = 'none';
        break;
    }
  }

  /**
   * Встановлює активну опцію в dropdown
   */
  private setActiveOption(dropdown: HTMLElement, index: number): void {
    const options = dropdown.querySelectorAll('.post-autocomplete-option');
    options.forEach((option, i) => {
      option.classList.toggle('active', i === index);
    });

    // Скролимо до активної опції
    const activeOption = dropdown.querySelector('.post-autocomplete-option.active');
    if (activeOption) {
      activeOption.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * Закриває всі dropdown
   */
  private closeAllDropdowns(): void {
    this.activeDropdowns.forEach(dropdown => {
      dropdown.style.display = 'none';
    });
    this.activeDropdowns = [];
  }

  /**
   * Оновлює дані для автодоповнення
   */
  public async refreshAutocompleteData(): Promise<void> {
    await this.loadAutocompleteData();
  }




  /**
   * Перемикає режим блокування (редагування)
   */
  private async toggleLockMode(): Promise<void> {
    if (!this.isLocked) {
      this.isLocked = true;
    } else {
      // Відкриваємо замок - очищуємо інпути
      this.isLocked = false;

      const inputCehTitle = document.getElementById('postCehFormInputTitle') as HTMLInputElement;
      const inputTitle = document.getElementById('postPostFormInputTitle') as HTMLInputElement;

      if (inputCehTitle) inputCehTitle.value = '';
      if (inputTitle) inputTitle.value = '';
    }

    this.updateModalState();
  }

  /**
   * Оновлює стан модалки залежно від isLocked
   */
  private updateModalState(): void {
    const lockBtn = document.getElementById('postModalLockBtn');
    const controls = document.getElementById('postModalControls');
    const submitBtn = document.getElementById('postPostModalSubmit');
    const postInput = document.getElementById('postPostFormInputTitle') as HTMLInputElement;
    const postDropdown = document.getElementById('postPostNameDropdown');

    // Оновлення кнопки замка
    if (lockBtn) {
      if (this.isLocked) {
        lockBtn.classList.remove('active');
        // Закритий замок (active class removed hides open lock)
        // Reset state when locking
        this.currentActionState = 'add';
        this.updateActionStateUI();
      } else {
        lockBtn.classList.add('active');
        // Відкритий замок
      }
    }

    // Оновлення контролів (кнопка Додати)
    if (controls) {
      if (this.isLocked) {
        controls.classList.remove('visible');
      } else {
        controls.classList.add('visible');
        this.updateActionStateUI();
      }
    }

    // Оновлення кнопки Submit
    if (submitBtn) {
      if (this.isLocked) {
        // Locked state: "Створити", standard primary style
        submitBtn.textContent = 'Створити';
        submitBtn.classList.remove('post-btn-blue');
        submitBtn.classList.add('post-btn-primary');
      } else {
        // Unlocked state: "ОК", blue style
        submitBtn.textContent = 'ОК';
        submitBtn.classList.remove('post-btn-primary'); // Remove green
        submitBtn.classList.add('post-btn-blue'); // Add blue
      }
    }


    // Оновлення dropdown постів при зміні стану замка
    if (postInput && postDropdown) {
      const value = postInput.value.toLowerCase().trim();
      const data = this.getFilteredPostNames();

      if (value.length > 0) {
        const filtered = data.filter(item =>
          item.toLowerCase().includes(value)
        );
        this.showDropdown(postDropdown, filtered, postInput);
      }
      // Якщо інпут порожній - не показуємо dropdown автоматично
      // Він покажеться коли користувач клікне на поле
    }
  }

  /**
   * Cycles through action states: add -> edit -> delete -> add
   */
  private cycleActionState(): void {
    if (this.currentActionState === 'add') {
      this.currentActionState = 'edit';
    } else if (this.currentActionState === 'edit') {
      this.currentActionState = 'delete';
    } else {
      this.currentActionState = 'add';
    }
    this.updateActionStateUI();
  }

  /**
   * Updates the UI of the action button based on current state
   */
  private updateActionStateUI(): void {
    const btn = document.getElementById('postModalAddBtn');
    if (!btn) return;

    // Remove all state classes first
    btn.classList.remove('post-mode--add', 'post-mode--edit', 'post-mode--delete');

    switch (this.currentActionState) {
      case 'add':
        btn.textContent = 'Додати';
        btn.classList.add('post-mode--add');
        break;
      case 'edit':
        btn.textContent = 'Редагувати';
        btn.classList.add('post-mode--edit');
        break;
      case 'delete':
        btn.textContent = 'Видалити';
        btn.classList.add('post-mode--delete');
        break;
    }
  }

  /**
   * Відкриває модалку для створення поста
   * @param onSubmit Колбек при успішному створенні
   * @param prefillCehTitle Попередньо заповнена назва цеху (опціонально)
   */
  public open(onSubmit: PostSubmitCallback, prefillCehTitle?: string): void {
    // Reset lock state on open
    this.isLocked = true;
    this.updateModalState();

    this.onSubmitCallback = onSubmit;

    // Оновлюємо дані автодоповнення при відкритті модалки
    this.loadAutocompleteData();

    const inputCehTitle = document.getElementById('postCehFormInputTitle') as HTMLInputElement;
    const inputTitle = document.getElementById('postPostFormInputTitle') as HTMLInputElement;
    const inputSubtitle = document.getElementById('postPostFormInputSubtitle') as HTMLInputElement;

    if (inputCehTitle) inputCehTitle.value = prefillCehTitle || '';
    if (inputTitle) inputTitle.value = '';
    if (inputSubtitle) inputSubtitle.value = '';

    // Оновлюємо selectedCategoryId якщо є prefillCehTitle
    if (prefillCehTitle) {
      this.selectedCategoryId = this.findCategoryIdByName(prefillCehTitle);
    } else {
      this.selectedCategoryId = null;
    }

    // Закриваємо всі dropdown
    this.closeAllDropdowns();

    if (this.modalOverlay) {
      this.modalOverlay.style.display = 'flex';
      // Фокус на перше пусте поле
      if (prefillCehTitle) {
        setTimeout(() => inputTitle?.focus(), 100);
      } else {
        setTimeout(() => inputCehTitle?.focus(), 100);
      }
    }
  }



  /**
   * Закриває модалку
   */
  public close(): void {
    this.closeAllDropdowns();
    if (this.modalOverlay) {
      this.modalOverlay.style.display = 'none';
    }

    this.onSubmitCallback = null;
    this.selectedCategoryId = null;
  }

  /**
   * Обробляє submit форми
   */
  private async handleSubmit(): Promise<void> {
    const inputCehTitle = document.getElementById('postCehFormInputTitle') as HTMLInputElement;
    const inputTitle = document.getElementById('postPostFormInputTitle') as HTMLInputElement;
    const inputSubtitle = document.getElementById('postPostFormInputSubtitle') as HTMLInputElement;

    const cehTitle = inputCehTitle?.value.trim() || '';
    const title = inputTitle?.value.trim() || '';
    const subtitle = inputSubtitle?.value.trim() || '';

    // Якщо замок відкритий - дозволяємо операції з одним полем
    if (!this.isLocked) {
      // Перевіряємо що хоча б одне поле заповнене
      if (!cehTitle && !title) {
        showNotification('Заповніть хоча б одне поле!', 'error');
        return;
      }

      await this.handleDatabaseOperation(cehTitle, title);
      return;
    }

    // Якщо замок закритий - обов'язкові обидва поля
    if (!cehTitle) {
      showNotification('Введіть назву цеху!', 'error');
      return;
    }

    if (!title) {
      showNotification('Введіть назву поста!', 'error');
      return;
    }

    // Якщо замок закритий - використовуємо callback
    if (this.onSubmitCallback) {
      this.onSubmitCallback({ cehTitle, title, subtitle });
    }

    this.close();
  }

  /**
   * Видаляє емоджі з тексту
   */
  private removeEmojis(text: string): string {
    return text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F018}-\u{1F270}\u{238C}-\u{2454}\u{20D0}-\u{20FF}\u{FE00}-\u{FE0F}]/gu, '').trim();
  }

  /**
   * Виконує операції з БД залежно від action state
   */
  private async handleDatabaseOperation(cehTitle: string, postTitle: string): Promise<void> {
    try {
      switch (this.currentActionState) {
        case 'add':
          await this.handleAddOperation(cehTitle, postTitle);
          break;
        case 'edit':
          await this.handleEditOperation(cehTitle, postTitle);
          break;
        case 'delete':
          await this.handleDeleteOperation(cehTitle, postTitle);
          break;
      }

      // Оновлюємо дані автодоповнення після операції
      await this.refreshAutocompleteData();
      this.close();
    } catch (error) {
      console.error('❌ Помилка операції з БД:', error);
      console.error('❌ Деталі помилки:', JSON.stringify(error, null, 2));

      // Показуємо більш детальну помилку
      const errorMessage = error instanceof Error ? error.message : String(error);
      showNotification(`Помилка: ${errorMessage}`, 'error');
    }
  }

  /**
   * Додає категорію та/або пост до БД
   */
  private async handleAddOperation(cehTitle: string, postTitle: string): Promise<void> {
    let categoryId: number | null = null;
    let categoryMessage = '';
    let postMessage = '';

    // Обробка категорії якщо заповнена
    if (cehTitle) {
      // Перевіряємо чи категорія вже існує
      const { data: existingCategory, error: categoryCheckError } = await supabase
        .from('post_category')
        .select('category_id, category')
        .ilike('category', cehTitle)
        .maybeSingle();

      if (categoryCheckError) throw categoryCheckError;

      if (existingCategory) {
        // Категорія вже існує
        categoryId = existingCategory.category_id;
        categoryMessage = 'існує';
      } else {
        // Спочатку знаходимо максимальний category_id
        const { data: maxIdData, error: maxIdError } = await supabase
          .from('post_category')
          .select('category_id')
          .order('category_id', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (maxIdError) throw maxIdError;

        // Генеруємо новий ID
        const newId = maxIdData ? maxIdData.category_id + 1 : 1;

        // Додаємо нову категорію з явним ID
        const { data: newCategory, error: categoryInsertError } = await supabase
          .from('post_category')
          .insert({
            category_id: newId,
            category: cehTitle
          })
          .select('category_id')
          .single();

        if (categoryInsertError) throw categoryInsertError;
        categoryId = newCategory.category_id;
        categoryMessage = 'додана';
      }
    }

    // Обробка поста якщо заповнений
    if (postTitle) {
      // Перевіряємо чи пост вже існує (нехтуємо емоджі)
      const postTitleNoEmoji = this.removeEmojis(postTitle);

      // Отримуємо всі пости
      const { data: existingPosts, error: postsError } = await supabase
        .from('post_name')
        .select('post_id, name');

      if (postsError) throw postsError;

      // Перевіряємо наявність поста без емоджі
      const postExists = existingPosts?.some(post => {
        const existingNameNoEmoji = this.removeEmojis(post.name);
        return existingNameNoEmoji.toLowerCase() === postTitleNoEmoji.toLowerCase();
      });

      if (postExists) {
        postMessage = 'існує';
      } else {
        // Знаходимо максимальний post_id
        const { data: maxPostIdData, error: maxPostIdError } = await supabase
          .from('post_name')
          .select('post_id')
          .order('post_id', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (maxPostIdError) throw maxPostIdError;

        // Генеруємо новий ID
        const newPostId = maxPostIdData ? maxPostIdData.post_id + 1 : 1;

        // Додаємо новий пост з явним ID
        // Використовуємо categoryId якщо є, інакше null
        const { error: postInsertError } = await supabase
          .from('post_name')
          .insert({
            post_id: newPostId,
            name: postTitle,
            category: categoryId
          });

        if (postInsertError) throw postInsertError;
        postMessage = 'доданий';
      }
    }

    // Формуємо повідомлення
    const messages: string[] = [];
    if (cehTitle) messages.push(`Категорія: ${categoryMessage}`);
    if (postTitle) messages.push(`Пост: ${postMessage}`);

    const allExist = (categoryMessage === 'існує' || !cehTitle) && (postMessage === 'існує' || !postTitle);
    if (allExist && (cehTitle || postTitle)) {
      showNotification('Дані вже існують', 'info');
    } else {
      showNotification('Збережено', 'success');
    }
  }

  /**
   * Редагує категорію та/або пост в БД
   */
  private async handleEditOperation(cehTitle: string, postTitle: string): Promise<void> {
    const messages: string[] = [];

    // Редагування категорії якщо заповнена
    // Редагування категорії якщо заповнена

    if (cehTitle) {
      // Якщо selectedCategoryId не встановлено - шукаємо по назві
      let categoryId = this.selectedCategoryId;
      if (!categoryId) {
        categoryId = this.findCategoryIdByName(cehTitle);
      }

      // Якщо не знайшли - використовуємо останній валідний
      if (!categoryId && this.lastValidCategoryId) {
        categoryId = this.lastValidCategoryId;
      }

      if (categoryId) {
        const { error: categoryUpdateError } = await supabase
          .from('post_category')
          .update({ category: cehTitle })
          .eq('category_id', categoryId);

        if (categoryUpdateError) throw categoryUpdateError;
        messages.push('Категорія оновлена');
        this.lastValidCategoryId = categoryId; // Оновлюємо останній валідний
      }
    }

    // Редагування поста якщо заповнений
    if (postTitle) {
      // Використовуємо selectedPostId якщо є
      if (this.selectedPostId) {
        const { error: postUpdateError } = await supabase
          .from('post_name')
          .update({ name: postTitle })
          .eq('post_id', this.selectedPostId);

        if (postUpdateError) throw postUpdateError;
        messages.push('Пост оновлено');
      } else if (this.selectedCategoryId) {
        // Якщо selectedPostId немає, але є selectedCategoryId - оновлюємо перший пост в категорії
        const { data: existingPosts, error: postsError } = await supabase
          .from('post_name')
          .select('post_id, name')
          .eq('category', this.selectedCategoryId);

        if (postsError) throw postsError;

        if (existingPosts && existingPosts.length > 0) {
          const { error: postUpdateError } = await supabase
            .from('post_name')
            .update({ name: postTitle })
            .eq('post_id', existingPosts[0].post_id);

          if (postUpdateError) throw postUpdateError;
          messages.push('Пост оновлено');
        }
      }
    }

    if (messages.length > 0) {
      showNotification('Відредаговано', 'success');
    } else {
      showNotification('Немає даних для редагування', 'error');
    }
  }

  /**
   * Видаляє категорію та/або пост з БД
   * ПРІОРИТЕТ: Якщо обидва заповнені - видаляємо ТІЛЬКИ ПОСТ
   */
  private async handleDeleteOperation(cehTitle: string, postTitle: string): Promise<void> {
    const messages: string[] = [];

    // ПРІОРИТЕТ 1: Видалення поста (якщо заповнений)
    // Якщо postTitle заповнений - видаляємо ТІЛЬКИ пост, ігноруємо категорію
    if (postTitle) {
      // Використовуємо selectedPostId якщо є
      if (this.selectedPostId) {
        const { error: postDeleteError } = await supabase
          .from('post_name')
          .delete()
          .eq('post_id', this.selectedPostId);

        if (postDeleteError) throw postDeleteError;
        messages.push('Пост видалено');
      } else if (this.selectedCategoryId) {
        // Якщо selectedPostId немає, але є selectedCategoryId - видаляємо перший пост в категорії
        const { data: existingPosts, error: postsError } = await supabase
          .from('post_name')
          .select('post_id, name')
          .eq('category', this.selectedCategoryId);

        if (postsError) throw postsError;

        if (existingPosts && existingPosts.length > 0) {
          const { error: postDeleteError } = await supabase
            .from('post_name')
            .delete()
            .eq('post_id', existingPosts[0].post_id);

          if (postDeleteError) throw postDeleteError;
          messages.push('Пост видалено');
        }
      }

      // ВАЖЛИВО: НЕ видаляємо категорію навіть якщо cehTitle заповнений!
    }
    // ПРІОРИТЕТ 2: Видалення категорії (ТІЛЬКИ якщо postTitle порожній)
    else if (cehTitle && this.selectedCategoryId) {
      const { error: categoryDeleteError } = await supabase
        .from('post_category')
        .delete()
        .eq('category_id', this.selectedCategoryId);

      if (categoryDeleteError) throw categoryDeleteError;
      messages.push('Категорія видалена');
    }

    if (messages.length > 0) {
      showNotification('Видалено', 'success');
    } else {
      showNotification('Немає даних для видалення', 'error');
    }
  }
}
