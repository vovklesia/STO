// src/ts/roboha/ai/aiDatabaseQuery.ts
// 🗄️ Модуль динамічних SELECT-запитів до БД для AI Атлас
// Дозволяє AI виконувати запити до Supabase через function calling

import { supabase } from "../../vxid/supabaseClient";

// ============================================================
// ТИПИ
// ============================================================

/** Дозволені таблиці для запитів AI */
export const AI_ALLOWED_TABLES = [
  "acts",
  "clients",
  "cars",
  "slyusars",
  "sclad",
  "post_category",
  "post_name",
  "post_arxiv",
  "works",
  "details",
  "shops",
  "vutratu",
  "faktura",
  "incomes",
  "settings",
  "act_changes_notifications",
  "slusar_complete_notifications",
  "atlas_reminders",
  "atlas_reminder_logs",
  "atlas_telegram_users",
] as const;

/** Дозволені RPC-функції для виклику через AI */
export const AI_ALLOWED_RPC = [
  "get_db_size",
  "get_due_reminders",
  "get_my_reminders",
  "trigger_reminder",
  "execute_condition_query",
  "get_telegram_link_status",
] as const;

export type AllowedRPC = (typeof AI_ALLOWED_RPC)[number];

export type AllowedTable = (typeof AI_ALLOWED_TABLES)[number];

/** Фільтр для запиту */
export interface QueryFilter {
  column: string;
  operator:
    | "eq"
    | "neq"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "like"
    | "ilike"
    | "is"
    | "in"
    | "not";
  value: string | number | boolean | null | string[] | number[];
}

/** Параметри запиту від AI */
export interface AIQueryParams {
  table: string;
  select?: string; // Колонки (default "*")
  filters?: QueryFilter[];
  order_by?: string;
  order_direction?: "asc" | "desc";
  limit?: number; // Max 500
  offset?: number;
}

/** Результат запиту */
export interface AIQueryResult {
  success: boolean;
  data?: any[];
  count?: number;
  error?: string;
  table?: string;
  query_description?: string;
}

// ============================================================
// ЗАХИЩЕНІ КОЛОНКИ (не повертати паролі та чутливі дані)
// ============================================================

const FORBIDDEN_COLUMNS: Record<string, string[]> = {
  slyusars: ["Пароль", "password", "pass", "pwd"],
  settings: ["Пароль", "password"],
};

/** Видаляє заборонені поля з результатів */
function sanitizeResults(table: string, data: any[]): any[] {
  const forbidden = FORBIDDEN_COLUMNS[table];
  if (!forbidden || forbidden.length === 0) return data;

  return data.map((row) => {
    const clean = { ...row };

    // Перевіряємо вкладені обʼєкти (data, JSONB поля)
    if (clean.data && typeof clean.data === "object") {
      const d = { ...clean.data };
      for (const key of forbidden) {
        delete d[key];
      }
      clean.data = d;
    }

    // Перевіряємо top-level поля
    for (const key of forbidden) {
      delete clean[key];
    }

    return clean;
  });
}

// ============================================================
// ВИКОНАННЯ ЗАПИТУ
// ============================================================

/**
 * Виконує безпечний SELECT-запит до Supabase.
 * Тільки читання — INSERT/UPDATE/DELETE заборонені.
 */
export async function executeAIQuery(
  params: AIQueryParams,
): Promise<AIQueryResult> {
  // 1. Валідація таблиці
  const table = params.table?.toLowerCase().trim();
  if (!table || !AI_ALLOWED_TABLES.includes(table as AllowedTable)) {
    return {
      success: false,
      error: `🚫 Таблиця "${params.table}" не дозволена. Доступні: ${AI_ALLOWED_TABLES.join(", ")}`,
    };
  }

  // 2. Валідація ліміту
  const limit = Math.min(Math.max(params.limit || 100, 1), 500);
  const offset = Math.max(params.offset || 0, 0);

  // 3. Валідація select (захист від SQL injection через select)
  const selectColumns = params.select?.trim() || "*";
  // Базова перевірка: тільки букви, цифри, крапки, коми, зірочки, пробіли, підкреслення, дефіси, лапки
  if (!/^[\w\s,.*"'()[\]>:-]+$/i.test(selectColumns)) {
    return {
      success: false,
      error: `🚫 Некоректний формат select: "${selectColumns}"`,
    };
  }

  try {
    // 4. Будуємо запит
    let query = supabase.from(table).select(selectColumns, { count: "exact" });

    // 5. Додаємо фільтри
    if (params.filters && Array.isArray(params.filters)) {
      for (const filter of params.filters) {
        if (!filter.column || !filter.operator) continue;

        // Валідація оператора
        const op = filter.operator;
        const col = filter.column;
        const val = filter.value;

        switch (op) {
          case "eq":
            query = query.eq(col, val);
            break;
          case "neq":
            query = query.neq(col, val);
            break;
          case "gt":
            query = query.gt(col, val as string | number);
            break;
          case "gte":
            query = query.gte(col, val as string | number);
            break;
          case "lt":
            query = query.lt(col, val as string | number);
            break;
          case "lte":
            query = query.lte(col, val as string | number);
            break;
          case "like":
            query = query.like(col, val as string);
            break;
          case "ilike":
            query = query.ilike(col, val as string);
            break;
          case "is":
            query = query.is(col, val as null | boolean);
            break;
          case "in":
            if (Array.isArray(val)) {
              query = query.in(col, val);
            }
            break;
          case "not":
            query = query.not(col, "is", val as null);
            break;
          default:
            // Непідтриманий оператор — ігноруємо
            break;
        }
      }
    }

    // 6. Сортування
    if (params.order_by) {
      query = query.order(params.order_by, {
        ascending: params.order_direction !== "desc",
      });
    }

    // 7. Пагінація
    query = query.range(offset, offset + limit - 1);

    // 8. Виконуємо
    const { data, error, count } = await query;

    if (error) {
      return {
        success: false,
        error: `❌ Помилка запиту до "${table}": ${error.message}`,
        table,
      };
    }

    // 9. Санітизація (видаляємо паролі)
    const sanitized = sanitizeResults(table, data || []);

    return {
      success: true,
      data: sanitized,
      count: count ?? sanitized.length,
      table,
      query_description: `SELECT ${selectColumns} FROM ${table}${params.filters?.length ? ` WHERE (${params.filters.length} filters)` : ""} LIMIT ${limit}`,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `❌ Помилка: ${err.message || "Невідома помилка"}`,
      table,
    };
  }
}

/**
 * Виконує кілька запитів паралельно (для оптимізації).
 * Максимум 5 запитів одночасно.
 */
export async function executeMultipleAIQueries(
  queries: AIQueryParams[],
): Promise<AIQueryResult[]> {
  const limited = queries.slice(0, 5);
  return Promise.all(limited.map(executeAIQuery));
}

// ============================================================
// RPC ВИКЛИКИ (серверні функції PostgreSQL)
// ============================================================

/** Параметри виклику RPC */
export interface AIRpcParams {
  function_name: string;
  args?: Record<string, any>;
}

/**
 * Викликає PostgreSQL RPC-функцію через Supabase.
 * Тільки дозволені функції (білий список).
 */
export async function executeAIRpc(
  params: AIRpcParams,
): Promise<AIQueryResult> {
  const fnName = params.function_name?.toLowerCase().trim();

  if (!fnName || !AI_ALLOWED_RPC.includes(fnName as AllowedRPC)) {
    return {
      success: false,
      error: `🚫 RPC-функція "${params.function_name}" не дозволена. Доступні: ${AI_ALLOWED_RPC.join(", ")}`,
    };
  }

  try {
    const { data, error } = await supabase.rpc(fnName, params.args || {});

    if (error) {
      return {
        success: false,
        error: `❌ Помилка RPC "${fnName}": ${error.message}`,
        table: fnName,
      };
    }

    const resultData = Array.isArray(data) ? data : [data];

    return {
      success: true,
      data: resultData,
      count: resultData.length,
      table: fnName,
      query_description: `RPC ${fnName}(${JSON.stringify(params.args || {})})`,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `❌ Помилка RPC: ${err.message || "Невідома помилка"}`,
      table: fnName,
    };
  }
}

// ============================================================
// GEMINI FUNCTION DECLARATION ДЛЯ query_database
// ============================================================

/**
 * Повертає Gemini function declaration для інструменту query_database
 */
export function getQueryDatabaseToolDeclaration(): any {
  return {
    name: "query_database",
    description: `SELECT-запит до БД СТО. Таблиці: acts,clients,cars,slyusars,sclad,post_arxiv,vutratu,faktura,shops,works,details,settings,post_category,post_name,incomes. JSONB: data->>'ПІБ'. Тільки SELECT.`,
    parameters: {
      type: "object",
      properties: {
        table: {
          type: "string",
          description: "Назва таблиці",
          enum: [...AI_ALLOWED_TABLES],
        },
        select: {
          type: "string",
          description: `Колонки. "*" за замовч.`,
        },
        filters: {
          type: "array",
          description: "Масив фільтрів WHERE",
          items: {
            type: "object",
            properties: {
              column: {
                type: "string",
                description:
                  "Назва колонки. Для JSONB: data->>'ПІБ', data->>'Телефон'",
              },
              operator: {
                type: "string",
                description: "eq/neq/gt/gte/lt/lte/like/ilike/is/in/not",
                enum: [
                  "eq",
                  "neq",
                  "gt",
                  "gte",
                  "lt",
                  "lte",
                  "like",
                  "ilike",
                  "is",
                  "in",
                  "not",
                ],
              },
              value: {
                type: "string",
                description:
                  'Значення (рядок). ilike:%шаблон%. is:"null". in:"v1,v2"',
              },
            },
            required: ["column", "operator", "value"],
          },
        },
        order_by: {
          type: "string",
          description: "Сортувати за колонкою",
        },
        order_direction: {
          type: "string",
          description: "Напрямок",
          enum: ["asc", "desc"],
        },
        limit: {
          type: "integer",
          description: "Макс рядків (1-500). Замовч 100",
        },
      },
      required: ["table"],
    },
  };
}

/**
 * Повертає Gemini function declaration для multi_query (кілька запитів одразу)
 */
export function getMultiQueryToolDeclaration(): any {
  return {
    name: "multi_query_database",
    description: "Кілька SELECT паралельно (до 5). Для зв'язування таблиць.",
    parameters: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          description: "Масив запитів (макс 5)",
          items: {
            type: "object",
            properties: {
              table: { type: "string", enum: [...AI_ALLOWED_TABLES] },
              select: { type: "string" },
              filters: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    column: { type: "string" },
                    operator: {
                      type: "string",
                      enum: [
                        "eq",
                        "neq",
                        "gt",
                        "gte",
                        "lt",
                        "lte",
                        "like",
                        "ilike",
                        "is",
                        "in",
                        "not",
                      ],
                    },
                    value: {
                      type: "string",
                      description: "Значення для порівняння (рядок)",
                    },
                  },
                  required: ["column", "operator", "value"],
                },
              },
              order_by: { type: "string" },
              order_direction: { type: "string", enum: ["asc", "desc"] },
              limit: { type: "integer" },
            },
            required: ["table"],
          },
        },
      },
      required: ["queries"],
    },
  };
}

/**
 * Повертає Gemini function declaration для виклику RPC-функцій
 */
export function getRpcToolDeclaration(): any {
  return {
    name: "call_rpc",
    description: `RPC-функція PostgreSQL. get_db_size()→розмір БД`,
    parameters: {
      type: "object",
      properties: {
        function_name: {
          type: "string",
          description: "Назва RPC-функції",
          enum: [...AI_ALLOWED_RPC],
        },
        args: {
          type: "object",
          description: `Аргументи функції (JSON). Для get_db_size: {} (без аргументів)`,
          properties: {},
        },
      },
      required: ["function_name"],
    },
  };
}
