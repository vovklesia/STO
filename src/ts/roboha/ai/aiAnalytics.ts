// src/ts/roboha/ai/aiAnalytics.ts
// 📊 Модуль аналітики для AI Атлас
// VIP-клієнти, рейтинг слюсарів, фінансова аналітика, інтелектуальне планування

import { supabase } from "../../vxid/supabaseClient";

// ============================================================
// ТИПИ
// ============================================================

export interface AnalyticsResult {
  success: boolean;
  type: string;
  data?: any;
  summary?: string;
  error?: string;
}

export interface ClientAnalytics {
  client_id: number;
  name: string;
  phone: string;
  total_acts: number;
  total_revenue: number;
  avg_check: number;
  first_visit: string;
  last_visit: string;
  vip_level: string;
  days_since_last_visit: number;
}

export interface SlyusarAnalytics {
  slyusar_id: number;
  name: string;
  specialization: string;
  total_acts: number;
  total_revenue: number;
  avg_check: number;
  rating: number;
  current_post: string;
  workload: string;
}

export interface FinancialPeriod {
  revenue: number;
  expenses: number;
  profit: number;
  margin: number;
  acts_count: number;
  avg_check: number;
}

// ============================================================
// VIP КЛІЄНТИ
// ============================================================

/**
 * Визначає VIP-клієнтів за сумою витрат та кількістю візитів.
 * @param periodDays — за який період (default 365 днів)
 * @param topN — кількість топ-клієнтів (default 20)
 */
export async function getVipClients(
  periodDays = 365,
  topN = 20,
): Promise<AnalyticsResult> {
  try {
    const since = new Date(
      Date.now() - periodDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Отримуємо акти за період
    const { data: acts, error } = await supabase
      .from("acts")
      .select("act_id, client_id, date_on, date_off, data")
      .gte("date_on", since)
      .order("date_on", { ascending: false })
      .limit(2000);

    if (error) {
      return {
        success: false,
        type: "vip_clients",
        error: `Помилка: ${error.message}`,
      };
    }

    // Групуємо за client_id
    const clientMap = new Map<
      number,
      {
        acts: number;
        revenue: number;
        name: string;
        phone: string;
        lastVisit: string;
      }
    >();

    for (const act of acts || []) {
      if (!act.client_id) continue;
      const existing = clientMap.get(act.client_id) || {
        acts: 0,
        revenue: 0,
        name: act.data?.["ПІБ"] || "—",
        phone: act.data?.["Телефон"] || "",
        lastVisit: act.date_on,
      };

      existing.acts += 1;
      existing.revenue +=
        (parseFloat(act.data?.["СумаРобіт"]) || 0) +
        (parseFloat(act.data?.["СумаДеталей"]) || 0);

      if (act.date_on > existing.lastVisit) {
        existing.lastVisit = act.date_on;
      }

      clientMap.set(act.client_id, existing);
    }

    // Сортуємо за виручкою
    const sorted = [...clientMap.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, topN);

    const result: ClientAnalytics[] = sorted.map(([id, c]) => {
      const daysSince = Math.floor(
        (Date.now() - new Date(c.lastVisit).getTime()) / (24 * 60 * 60 * 1000),
      );

      let vipLevel: string;
      if (c.revenue >= 100000) vipLevel = "💎 VIP";
      else if (c.revenue >= 30000) vipLevel = "⭐ Постійний";
      else if (c.acts >= 3) vipLevel = "🔄 Повторний";
      else vipLevel = "🆕 Новий";

      return {
        client_id: id,
        name: c.name,
        phone: c.phone,
        total_acts: c.acts,
        total_revenue: Math.round(c.revenue),
        avg_check: c.acts > 0 ? Math.round(c.revenue / c.acts) : 0,
        first_visit: "", // Не визначаємо тут
        last_visit: c.lastVisit,
        vip_level: vipLevel,
        days_since_last_visit: daysSince,
      };
    });

    const totalVip = result.filter((c) => c.total_revenue >= 100000).length;
    const totalRegular = result.filter(
      (c) => c.total_revenue >= 30000 && c.total_revenue < 100000,
    ).length;

    return {
      success: true,
      type: "vip_clients",
      data: result,
      summary: `Топ-${topN} клієнтів за ${periodDays} днів: ${totalVip} 💎VIP, ${totalRegular} ⭐Постійних. Загальна виручка: ${Math.round(result.reduce((s, c) => s + c.total_revenue, 0))} грн`,
    };
  } catch (err: any) {
    return {
      success: false,
      type: "vip_clients",
      error: `Помилка: ${err.message}`,
    };
  }
}

// ============================================================
// РЕЙТИНГ СЛЮСАРІВ
// ============================================================

/**
 * Аналітика по слюсарях: виручка, кількість актів, спеціалізація, завантаженість.
 * @param periodDays — за який період (default 30)
 */
export async function getSlyusarRanking(
  periodDays = 30,
): Promise<AnalyticsResult> {
  try {
    const since = new Date(
      Date.now() - periodDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Отримуємо слюсарів
    const { data: slyusars } = await supabase
      .from("slyusars")
      .select("slyusar_id, data, post_sluysar");

    // Отримуємо акти за період
    const { data: acts } = await supabase
      .from("acts")
      .select("act_id, data, date_on, date_off")
      .gte("date_on", since)
      .limit(2000);

    if (!slyusars || !acts) {
      return {
        success: false,
        type: "slyusar_ranking",
        error: "Не вдалося завантажити дані",
      };
    }

    // Рахуємо статистику
    const slyusarMap = new Map<
      number,
      { acts: number; revenue: number; openActs: number }
    >();

    for (const act of acts) {
      // Шукаємо слюсаря за ПІБ в акті
      const slyusarName = act.data?.["Слюсар"] || "";
      if (!slyusarName) continue;

      const matched = slyusars.find(
        (s) =>
          (s.data as any)?.Name?.toLowerCase() === slyusarName.toLowerCase(),
      );
      if (!matched) continue;

      const stats = slyusarMap.get(matched.slyusar_id) || {
        acts: 0,
        revenue: 0,
        openActs: 0,
      };
      stats.acts += 1;
      stats.revenue +=
        (parseFloat(act.data?.["СумаРобіт"]) || 0) +
        (parseFloat(act.data?.["СумаДеталей"]) || 0);
      if (!act.date_off) stats.openActs += 1;

      slyusarMap.set(matched.slyusar_id, stats);
    }

    // Формуємо рейтинг
    const ranking: SlyusarAnalytics[] = slyusars
      .map((s) => {
        const stats = slyusarMap.get(s.slyusar_id) || {
          acts: 0,
          revenue: 0,
          openActs: 0,
        };
        const d = s.data as any;
        const name = d?.Name || "—";
        const specialization = d?.["Спеціалізація"] || "Загальна";
        const rating = parseFloat(d?.["Рейтинг"]) || 0;

        let workload: string;
        if (stats.openActs >= 3) workload = "🔴 Перевантажений";
        else if (stats.openActs >= 2) workload = "🟠 Зайнятий";
        else if (stats.openActs === 1) workload = "🟡 Частково зайнятий";
        else workload = "🟢 Вільний";

        return {
          slyusar_id: s.slyusar_id,
          name,
          specialization,
          total_acts: stats.acts,
          total_revenue: Math.round(stats.revenue),
          avg_check:
            stats.acts > 0 ? Math.round(stats.revenue / stats.acts) : 0,
          rating,
          current_post: s.post_sluysar || "—",
          workload,
        };
      })
      .filter((s) => s.name !== "—")
      .sort((a, b) => b.total_revenue - a.total_revenue);

    return {
      success: true,
      type: "slyusar_ranking",
      data: ranking,
      summary: `Рейтинг ${ranking.length} слюсарів за ${periodDays} днів. Лідер: ${ranking[0]?.name || "—"} (${ranking[0]?.total_revenue || 0} грн)`,
    };
  } catch (err: any) {
    return {
      success: false,
      type: "slyusar_ranking",
      error: `Помилка: ${err.message}`,
    };
  }
}

// ============================================================
// ФІНАНСОВА АНАЛІТИКА
// ============================================================

/**
 * Повний фінансовий звіт за період з порівнянням з попереднім.
 * @param periodDays — поточний період (default 30)
 */
export async function getFinancialReport(
  periodDays = 30,
): Promise<AnalyticsResult> {
  try {
    const now = Date.now();
    const currentStart = new Date(
      now - periodDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const previousStart = new Date(
      now - periodDays * 2 * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Поточний період
    const { data: currentActs } = await supabase
      .from("acts")
      .select("act_id, data, date_on")
      .gte("date_on", currentStart)
      .limit(5000);

    // Попередній період (для порівняння)
    const { data: prevActs } = await supabase
      .from("acts")
      .select("act_id, data, date_on")
      .gte("date_on", previousStart)
      .lt("date_on", currentStart)
      .limit(5000);

    // Витрати
    const { data: currentExpenses } = await supabase
      .from("vutratu")
      .select("suma, data_vutratu")
      .gte("data_vutratu", currentStart);

    const { data: prevExpenses } = await supabase
      .from("vutratu")
      .select("suma, data_vutratu")
      .gte("data_vutratu", previousStart)
      .lt("data_vutratu", currentStart);

    function calcPeriod(acts: any[], expenses: any[]): FinancialPeriod {
      let revenue = 0;
      for (const act of acts) {
        revenue +=
          (parseFloat(act.data?.["СумаРобіт"]) || 0) +
          (parseFloat(act.data?.["СумаДеталей"]) || 0);
      }

      let totalExpenses = 0;
      for (const e of expenses) {
        totalExpenses += parseFloat(e.suma) || 0;
      }

      const profit = revenue - totalExpenses;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

      return {
        revenue: Math.round(revenue),
        expenses: Math.round(totalExpenses),
        profit: Math.round(profit),
        margin: Math.round(margin * 10) / 10,
        acts_count: acts.length,
        avg_check: acts.length > 0 ? Math.round(revenue / acts.length) : 0,
      };
    }

    const current = calcPeriod(currentActs || [], currentExpenses || []);
    const previous = calcPeriod(prevActs || [], prevExpenses || []);

    // Порівняння
    function trend(cur: number, prev: number): string {
      if (prev === 0) return cur > 0 ? "🔼 +100%" : "➡️ 0%";
      const pct = Math.round(((cur - prev) / prev) * 100);
      if (pct > 0) return `🔼 +${pct}%`;
      if (pct < 0) return `🔽 ${pct}%`;
      return "➡️ 0%";
    }

    return {
      success: true,
      type: "financial_report",
      data: {
        current,
        previous,
        trends: {
          revenue: trend(current.revenue, previous.revenue),
          profit: trend(current.profit, previous.profit),
          acts: trend(current.acts_count, previous.acts_count),
          avg_check: trend(current.avg_check, previous.avg_check),
        },
        period_days: periodDays,
      },
      summary: `За ${periodDays} днів: Виручка ${current.revenue} грн ${trend(current.revenue, previous.revenue)}, Прибуток ${current.profit} грн ${trend(current.profit, previous.profit)}, ${current.acts_count} актів, середній чек ${current.avg_check} грн`,
    };
  } catch (err: any) {
    return {
      success: false,
      type: "financial_report",
      error: `Помилка: ${err.message}`,
    };
  }
}

// ============================================================
// ІНТЕЛЕКТУАЛЬНЕ ПЛАНУВАННЯ
// ============================================================

/**
 * Рекомендує слюсаря для типу робіт, враховуючи:
 * - Спеціалізацію (data.Спеціалізація)
 * - Поточну завантаженість (кількість відкритих актів)
 * - Рейтинг (data.Рейтинг)
 */
export async function recommendSlyusar(
  workType: string,
): Promise<AnalyticsResult> {
  try {
    // Отримуємо слюсарів
    const { data: slyusars } = await supabase
      .from("slyusars")
      .select("slyusar_id, data, post_sluysar");

    if (!slyusars || slyusars.length === 0) {
      return {
        success: false,
        type: "recommend_slyusar",
        error: "Слюсарів не знайдено",
      };
    }

    // Поточні відкриті акти (завантаженість)
    const { data: openActs } = await supabase
      .from("acts")
      .select("act_id, data")
      .is("date_off", null);

    // Рахуємо відкриті акти по слюсарях
    const openActsCount = new Map<string, number>();
    for (const act of openActs || []) {
      const slusar = act.data?.["Слюсар"] || "";
      if (slusar) {
        openActsCount.set(slusar, (openActsCount.get(slusar) || 0) + 1);
      }
    }

    // Оцінюємо кожного слюсаря
    const workTypeLower = workType.toLowerCase();
    const candidates = slyusars
      .map((s) => {
        const d = s.data as any;
        const name = d?.Name || "—";
        const spec = (d?.["Спеціалізація"] || "").toLowerCase();
        const rating = parseFloat(d?.["Рейтинг"]) || 5; // default 5
        const currentLoad = openActsCount.get(name) || 0;

        // Оцінка: спеціалізація (40%) + рейтинг (30%) + вільність (30%)
        let specScore = 0;
        if (spec && workTypeLower.includes(spec)) specScore = 10;
        else if (spec && spec.includes(workTypeLower.split(" ")[0]))
          specScore = 7;
        else specScore = 3;

        const loadScore = Math.max(0, 10 - currentLoad * 3); // 0 актів = 10, 3+ = 1
        const ratingScore = rating * 2; // 1-5 → 2-10

        const totalScore =
          specScore * 0.4 + ratingScore * 0.3 + loadScore * 0.3;

        return {
          slyusar_id: s.slyusar_id,
          name,
          specialization: d?.["Спеціалізація"] || "Загальна",
          rating,
          current_load: currentLoad,
          post: s.post_sluysar || "—",
          score: Math.round(totalScore * 10) / 10,
          reason:
            specScore >= 7 ? `✅ Спеціалізація: ${spec}` : "Загальний профіль",
        };
      })
      .filter((c) => c.name !== "—")
      .sort((a, b) => b.score - a.score);

    return {
      success: true,
      type: "recommend_slyusar",
      data: candidates,
      summary: `Для "${workType}" рекомендую: ${candidates[0]?.name || "—"} (оцінка ${candidates[0]?.score || 0}/10, завантаження: ${candidates[0]?.current_load || 0} актів)`,
    };
  } catch (err: any) {
    return {
      success: false,
      type: "recommend_slyusar",
      error: `Помилка: ${err.message}`,
    };
  }
}

// ============================================================
// GEMINI FUNCTION DECLARATION
// ============================================================

/**
 * Повертає Gemini function declaration для get_analytics
 */
export function getAnalyticsToolDeclaration(): any {
  return {
    name: "get_analytics",
    description: `Аналітичні звіти СТО: vip_clients(топ клієнтів), slyusar_ranking(рейтинг), financial_report(фінзвіт), recommend_slyusar(рекомендація слюсаря).`,
    parameters: {
      type: "object",
      properties: {
        analytics_type: {
          type: "string",
          description: "Тип аналітики",
          enum: [
            "vip_clients",
            "slyusar_ranking",
            "financial_report",
            "recommend_slyusar",
          ],
        },
        period_days: {
          type: "integer",
          description: "Період днів (замовч: VIP=365, інші=30)",
        },
        work_type: {
          type: "string",
          description:
            'Тип робіт для recommend_slyusar: "Двигун","Ходова","Електрика"',
        },
        top_n: {
          type: "integer",
          description: "К-сть записів у топі (замовч 20)",
        },
      },
      required: ["analytics_type"],
    },
  };
}

/**
 * Виконує аналітичний запит за типом.
 */
export async function executeAnalytics(
  analyticsType: string,
  periodDays?: number,
  workType?: string,
  topN?: number,
): Promise<AnalyticsResult> {
  switch (analyticsType) {
    case "vip_clients":
      return getVipClients(periodDays || 365, topN || 20);
    case "slyusar_ranking":
      return getSlyusarRanking(periodDays || 30);
    case "financial_report":
      return getFinancialReport(periodDays || 30);
    case "recommend_slyusar":
      return recommendSlyusar(workType || "Загальний ремонт");
    default:
      return {
        success: false,
        type: analyticsType,
        error: `Невідомий тип аналітики: ${analyticsType}. Доступні: vip_clients, slyusar_ranking, financial_report, recommend_slyusar`,
      };
  }
}
