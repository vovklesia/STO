// src/ts/roboha/bukhhalteriya/analityka.ts
// 📊 Аналітика — Dashboard для бухгалтерії (Priority #3)

import ApexCharts from "apexcharts";
import { supabase } from "../../vxid/supabaseClient";
import { showNotification } from "../zakaz_naraudy/inhi/vspluvauhe_povidomlenna";

// ===================== ІНТЕРФЕЙСИ =====================

interface ActRow {
  act_id: number;
  date_on: string | null;
  date_off: string | null;
  rosraxovano: string | null;
  data: ActData | null;
  avans: number | string | null;
  tupOplatu: string | null;
  client_id: number | null;
  cars_id: number | null;
}

interface ActData {
  "Прибуток за деталі"?: number;
  "Прибуток за роботу"?: number;
  "За деталі"?: number;
  "За роботу"?: number;
  Знижка?: number;
  Роботи?: Array<{
    Робота?: string;
    Кількість?: number;
    Ціна?: number;
    Зарплата?: number;
    Прибуток?: number;
  }>;
  Деталі?: Array<{
    Деталь?: string;
    Кількість?: number;
    Ціна?: number;
    sclad_id?: number;
  }>;
}

interface SlyusarRow {
  slyusar_id: number;
  data: {
    Name: string;
    Доступ?: string;
    ПроцентРоботи?: number;
    Історія?: Record<
      string,
      Array<{
        Акт: string;
        СуммаРоботи: number;
        ДатаЗакриття: string | null;
        Записи?: Array<{
          Ціна: number;
          Робота: string;
          Кількість: number;
          Зарплата?: number;
          Розраховано?: string;
        }>;
      }>
    >;
  };
}

interface VutratuRow {
  vutratu_id: number;
  dataOnn: string | null;
  kategoria: string | null;
  suma: number;
  act: number | null;
  opys_vytraty: string | null;
}

interface ClientRow {
  client_id: number;
  data: { ПІБ?: string; Телефон?: string } | null;
}

interface CarRow {
  cars_id: number;
  data: { Авто?: string; "Номер авто"?: string } | null;
}

interface MonthlyRevenue {
  month: string;
  label: string;
  revenue: number;
  expenses: number;
  profit: number;
  actsCount: number;
}

interface TopWork {
  name: string;
  totalRevenue: number;
  count: number;
}

interface MechanicStats {
  name: string;
  actsCount: number;
  totalEarned: number;
  totalSalary: number;
  avgPerAct: number;
}

interface Anomaly {
  type: "warning" | "danger" | "info";
  icon: string;
  message: string;
}

interface TopClient {
  clientId: number;
  pib: string;
  totalSum: number;
  actsCount: number;
}

interface TopCar {
  carsId: number;
  carName: string;
  plate: string;
  totalSum: number;
  actsCount: number;
}

// ===================== СТАН МОДУЛЯ =====================

let revenueChart: ApexCharts | null = null;
let topWorksChart: ApexCharts | null = null;
let mechanicsChart: ApexCharts | null = null;
let isLoading = false;

// Кешовані дані
let cachedActs: ActRow[] = [];
let cachedSlyusars: SlyusarRow[] = [];
let cachedVutratu: VutratuRow[] = [];
let cachedClients: ClientRow[] = [];
let cachedCars: CarRow[] = [];

// Фільтр дат
let filterDateFrom: Date | null = null;
let filterDateTo: Date | null = null;

/** Повертає акти, відфільтровані по обраному діапазону дат */
function getFilteredActs(): ActRow[] {
  if (!filterDateFrom && !filterDateTo) return cachedActs;
  return cachedActs.filter((a) => {
    const dateStr = a.date_off || a.date_on;
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (filterDateFrom && d < filterDateFrom) return false;
    if (filterDateTo && d > filterDateTo) return false;
    return true;
  });
}

function getFilteredVutratu(): VutratuRow[] {
  if (!filterDateFrom && !filterDateTo) return cachedVutratu;
  return cachedVutratu.filter((v) => {
    if (!v.dataOnn) return false;
    const d = new Date(v.dataOnn);
    if (filterDateFrom && d < filterDateFrom) return false;
    if (filterDateTo && d > filterDateTo) return false;
    return true;
  });
}

// ===================== ЗАВАНТАЖЕННЯ ДАНИХ =====================

async function loadAnalyticsData(): Promise<boolean> {
  try {
    // Паралельне завантаження всіх даних
    const [actsRes, slyusarsRes, vutratuRes, clientsRes, carsRes] =
      await Promise.all([
        supabase
          .from("acts")
          .select(
            "act_id, date_on, date_off, rosraxovano, data, avans, tupOplatu, client_id, cars_id",
          )
          .order("date_on", { ascending: false }),
        supabase.from("slyusars").select("slyusar_id, data"),
        supabase
          .from("vutratu")
          .select("vutratu_id, dataOnn, kategoria, suma, act, opys_vytraty")
          .order("dataOnn", { ascending: false }),
        supabase.from("clients").select("client_id, data"),
        supabase
          .from("cars")
          .select("cars_id, data")
          .not("is_deleted", "is", true),
      ]);

    if (actsRes.error) throw actsRes.error;
    if (slyusarsRes.error) throw slyusarsRes.error;
    if (vutratuRes.error) throw vutratuRes.error;
    if (clientsRes.error) throw clientsRes.error;
    if (carsRes.error) throw carsRes.error;

    cachedActs = (actsRes.data || []) as ActRow[];
    cachedSlyusars = (slyusarsRes.data || []) as SlyusarRow[];
    cachedVutratu = (vutratuRes.data || []) as VutratuRow[];
    cachedClients = (clientsRes.data || []) as ClientRow[];
    cachedCars = (carsRes.data || []) as CarRow[];

    return true;
  } catch (err) {
    // console.error("❌ Помилка завантаження аналітики:", err);
    showNotification("Помилка завантаження даних аналітики", "error");
    return false;
  }
}

// ===================== ОБЧИСЛЕННЯ =====================

/** Дохід по місяцях (останні 12 місяців) */
function calcMonthlyRevenue(): MonthlyRevenue[] {
  const monthMap = new Map<string, MonthlyRevenue>();
  const monthNames = [
    "Січ",
    "Лют",
    "Бер",
    "Кві",
    "Тра",
    "Чер",
    "Лип",
    "Сер",
    "Вер",
    "Жов",
    "Лис",
    "Гру",
  ];

  const acts = getFilteredActs();

  // Дохід з актів (по date_off — закриті)
  for (const act of acts) {
    const dateStr = act.date_off || act.date_on;
    if (!dateStr) continue;

    const d = new Date(dateStr);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;

    if (!monthMap.has(key)) {
      monthMap.set(key, {
        month: key,
        label,
        revenue: 0,
        expenses: 0,
        profit: 0,
        actsCount: 0,
      });
    }
    const m = monthMap.get(key)!;

    const data = act.data;
    if (data) {
      const workRev = data["За роботу"] || 0;
      const detailRev = data["За деталі"] || 0;
      m.revenue += workRev + detailRev;
    }
    m.actsCount++;
  }

  // Витрати (тільки від'ємні суми без актів)
  for (const v of getFilteredVutratu()) {
    if (!v.dataOnn || v.act) continue;
    const d = new Date(v.dataOnn);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;

    if (!monthMap.has(key)) {
      monthMap.set(key, {
        month: key,
        label,
        revenue: 0,
        expenses: 0,
        profit: 0,
        actsCount: 0,
      });
    }
    const m = monthMap.get(key)!;
    if (v.suma < 0) {
      m.expenses += Math.abs(v.suma);
    }
  }

  // Підраховуємо прибуток
  for (const m of monthMap.values()) {
    m.profit = m.revenue - m.expenses;
  }

  // Сортуємо по місяцю та беремо останні 12
  const sorted = Array.from(monthMap.values()).sort((a, b) =>
    a.month.localeCompare(b.month),
  );

  return sorted.slice(-12);
}

/** Топ-10 найприбутковіших робіт */
function calcTopWorks(): TopWork[] {
  const workMap = new Map<string, TopWork>();

  for (const act of getFilteredActs()) {
    const works = act.data?.Роботи;
    if (!works) continue;

    for (const w of works) {
      const name = w.Робота?.trim();
      if (!name) continue;
      const price = (w.Ціна || 0) * (w.Кількість || 1);

      if (!workMap.has(name)) {
        workMap.set(name, { name, totalRevenue: 0, count: 0 });
      }
      const tw = workMap.get(name)!;
      tw.totalRevenue += price;
      tw.count++;
    }
  }

  return Array.from(workMap.values())
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 10);
}

/** Ефективність механіків (з урахуванням фільтра дат) */
function calcMechanicStats(): MechanicStats[] {
  const stats: MechanicStats[] = [];

  for (const s of cachedSlyusars) {
    const data = s.data;
    if (!data?.Name || !data?.Історія) continue;

    // Пропускаємо приймальників для цієї статистики
    if (data.Доступ === "Приймальник") continue;

    let actsCount = 0;
    let totalEarned = 0;
    let totalSalary = 0;

    const history = data.Історія;
    for (const dateKey of Object.keys(history)) {
      // Фільтруємо по даті
      if (filterDateFrom || filterDateTo) {
        const d = new Date(dateKey);
        if (isNaN(d.getTime())) continue;
        if (filterDateFrom && d < filterDateFrom) continue;
        if (filterDateTo && d > filterDateTo) continue;
      }

      const entries = history[dateKey];
      if (!Array.isArray(entries)) continue;

      for (const entry of entries) {
        actsCount++;
        totalEarned += entry.СуммаРоботи || 0;

        if (entry.Записи) {
          for (const rec of entry.Записи) {
            totalSalary += rec.Зарплата || 0;
          }
        }
      }
    }

    if (actsCount === 0) continue;

    stats.push({
      name: data.Name,
      actsCount,
      totalEarned,
      totalSalary,
      avgPerAct: Math.round(totalEarned / actsCount),
    });
  }

  return stats.sort((a, b) => b.totalEarned - a.totalEarned);
}

/** Аномалії */
function detectAnomalies(): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const acts = getFilteredActs();

  // 1. Акти без зарплати (закриті, але зарплата = 0)
  for (const act of acts) {
    if (!act.date_off) continue;
    const data = act.data;
    if (!data) continue;
    const workRev = data["За роботу"] || 0;
    if (workRev > 0) {
      const hasWorks = data.Роботи && data.Роботи.length > 0;
      const totalSalary = (data.Роботи || []).reduce(
        (sum, w) => sum + (w.Зарплата || 0),
        0,
      );
      if (hasWorks && totalSalary === 0) {
        anomalies.push({
          type: "warning",
          icon: "⚠️",
          message: `Акт #${act.act_id}: сума роботи ${formatMoney(workRev)} грн, але зарплата = 0`,
        });
      }
    }
  }

  // 2. Акти з нульовою сумою (закриті)
  for (const act of acts) {
    if (!act.date_off) continue;
    const data = act.data;
    if (!data) continue;
    const total = (data["За роботу"] || 0) + (data["За деталі"] || 0);
    if (total === 0) {
      anomalies.push({
        type: "danger",
        icon: "🔴",
        message: `Акт #${act.act_id}: закритий з нульовою сумою`,
      });
    }
  }

  // 3. Відкриті акти старше 30 днів
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  for (const act of acts) {
    if (act.date_off) continue;
    if (!act.date_on) continue;
    const openDate = new Date(act.date_on);
    if (openDate < thirtyDaysAgo) {
      const days = Math.floor(
        (Date.now() - openDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      anomalies.push({
        type: "info",
        icon: "📋",
        message: `Акт #${act.act_id}: відкритий вже ${days} днів`,
      });
    }
  }

  // Обмежуємо до 20 аномалій
  return anomalies.slice(0, 20);
}

/** Прогноз (лінійна регресія на основі місячних даних) */
function calcForecast(monthlyData: MonthlyRevenue[]): {
  nextMonthLabel: string;
  forecastRevenue: number;
  forecastProfit: number;
  trend: "up" | "down" | "stable";
} {
  const monthNames = [
    "Січ",
    "Лют",
    "Бер",
    "Кві",
    "Тра",
    "Чер",
    "Лип",
    "Сер",
    "Вер",
    "Жов",
    "Лис",
    "Гру",
  ];

  // Наступний місяць
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthLabel = `${monthNames[nextMonth.getMonth()]} ${nextMonth.getFullYear()}`;

  if (monthlyData.length < 3) {
    return {
      nextMonthLabel,
      forecastRevenue: 0,
      forecastProfit: 0,
      trend: "stable",
    };
  }

  // Лінійна регресія
  const n = monthlyData.length;
  const revenues = monthlyData.map((m) => m.revenue);
  const profits = monthlyData.map((m) => m.profit);

  const xMean = (n - 1) / 2;
  const yMeanRev = revenues.reduce((s, v) => s + v, 0) / n;
  const yMeanProf = profits.reduce((s, v) => s + v, 0) / n;

  let numRev = 0,
    numProf = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    numRev += dx * (revenues[i] - yMeanRev);
    numProf += dx * (profits[i] - yMeanProf);
    den += dx * dx;
  }

  const slopeRev = den !== 0 ? numRev / den : 0;
  const slopeProf = den !== 0 ? numProf / den : 0;
  const forecastRevenue = Math.max(
    0,
    Math.round(yMeanRev + slopeRev * (n - xMean)),
  );
  const forecastProfit = Math.round(yMeanProf + slopeProf * (n - xMean));

  // Визначаємо тренд за останні 3 місяці
  const last3 = revenues.slice(-3);
  const trend: "up" | "down" | "stable" =
    last3[2] > last3[0] * 1.05
      ? "up"
      : last3[2] < last3[0] * 0.95
        ? "down"
        : "stable";

  return { nextMonthLabel, forecastRevenue, forecastProfit, trend };
}

// ===================== РЕНДЕРИНГ ГРАФІКІВ =====================

function renderRevenueChart(data: MonthlyRevenue[]): void {
  const el = document.getElementById("analityka-revenue-chart");
  if (!el) return;

  if (revenueChart) {
    revenueChart.destroy();
    revenueChart = null;
  }

  const options: ApexCharts.ApexOptions = {
    chart: {
      type: "area",
      height: 320,
      fontFamily: "Arial, sans-serif",
      toolbar: {
        show: true,
        tools: { download: true, zoom: true, pan: false, reset: true },
      },
      animations: { enabled: true, speed: 600 },
    },
    series: [
      { name: "Дохід", data: data.map((m) => m.revenue) },
      { name: "Витрати", data: data.map((m) => m.expenses) },
      { name: "Прибуток", data: data.map((m) => m.profit) },
    ],
    xaxis: {
      categories: data.map((m) => m.label),
      labels: { style: { fontSize: "11px" } },
    },
    yaxis: {
      labels: {
        formatter: (val: number) => formatMoney(val),
        style: { fontSize: "11px" },
      },
    },
    colors: ["#4caf50", "#f44336", "#2196f3"],
    fill: {
      type: "gradient",
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.4,
        opacityTo: 0.05,
        stops: [0, 100],
      },
    },
    stroke: { curve: "smooth", width: 2 },
    tooltip: {
      y: { formatter: (val: number) => `${formatMoney(val)} грн` },
    },
    legend: { position: "top" },
    dataLabels: { enabled: false },
  };

  revenueChart = new ApexCharts(el, options);
  revenueChart.render();
}

function renderTopWorksChart(data: TopWork[]): void {
  const el = document.getElementById("analityka-top-works-chart");
  if (!el) return;

  if (topWorksChart) {
    topWorksChart.destroy();
    topWorksChart = null;
  }

  const options: ApexCharts.ApexOptions = {
    chart: {
      type: "bar",
      height: 320,
      fontFamily: "Arial, sans-serif",
      toolbar: { show: false },
      animations: { enabled: true, speed: 600 },
    },
    series: [{ name: "Дохід", data: data.map((w) => w.totalRevenue) }],
    xaxis: {
      categories: data.map((w) => truncateText(w.name, 25)),
      labels: {
        style: { fontSize: "10px" },
        rotate: -45,
        rotateAlways: data.length > 5,
      },
    },
    yaxis: {
      labels: {
        formatter: (val: number) => formatMoney(val),
        style: { fontSize: "11px" },
      },
    },
    colors: ["#667eea"],
    plotOptions: {
      bar: {
        borderRadius: 6,
        columnWidth: "60%",
        distributed: true,
      },
    },
    tooltip: {
      y: { formatter: (val: number) => `${formatMoney(val)} грн` },
      x: {
        formatter: (_val: number, opts: { dataPointIndex: number }) => {
          const idx = opts.dataPointIndex;
          return `${data[idx].name} (×${data[idx].count})`;
        },
      },
    },
    legend: { show: false },
    dataLabels: { enabled: false },
  };

  topWorksChart = new ApexCharts(el, options);
  topWorksChart.render();
}

function renderMechanicsChart(data: MechanicStats[]): void {
  const el = document.getElementById("analityka-mechanics-chart");
  if (!el) return;

  if (mechanicsChart) {
    mechanicsChart.destroy();
    mechanicsChart = null;
  }

  const options: ApexCharts.ApexOptions = {
    chart: {
      type: "bar",
      height: 320,
      fontFamily: "Arial, sans-serif",
      toolbar: { show: false },
      stacked: false,
    },
    series: [
      { name: "Заробив для СТО", data: data.map((m) => m.totalEarned) },
      { name: "Зарплата", data: data.map((m) => m.totalSalary) },
    ],
    xaxis: {
      categories: data.map((m) => m.name),
      labels: { style: { fontSize: "11px" } },
    },
    yaxis: {
      labels: {
        formatter: (val: number) => formatMoney(val),
        style: { fontSize: "11px" },
      },
    },
    colors: ["#4caf50", "#ff9800"],
    plotOptions: {
      bar: { borderRadius: 4, columnWidth: "50%" },
    },
    tooltip: {
      shared: true,
      intersect: false,
      y: { formatter: (val: number) => `${formatMoney(val)} грн` },
    },
    legend: { position: "top" },
    dataLabels: { enabled: false },
  };

  mechanicsChart = new ApexCharts(el, options);
  mechanicsChart.render();
}

// ===================== РЕНДЕРИНГ КАРТОК =====================

function renderSummaryCards(
  monthly: MonthlyRevenue[],
  forecast: ReturnType<typeof calcForecast>,
): void {
  const container = document.getElementById("analityka-summary-cards");
  if (!container) return;

  const acts = getFilteredActs();

  // Поточний місяць
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentMonth = monthly.find((m) => m.month === currentKey);
  const prevKey = `${now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()}-${String(now.getMonth() === 0 ? 12 : now.getMonth()).padStart(2, "0")}`;
  const prevMonth = monthly.find((m) => m.month === prevKey);

  const totalRevenue = monthly.reduce((s, m) => s + m.revenue, 0);
  const totalActs = acts.length;
  const openActs = acts.filter((a) => !a.date_off).length;
  const closedActs = acts.filter((a) => !!a.date_off);

  // Помірний чек (по закритих актах)
  const avgCheck =
    closedActs.length > 0
      ? Math.round(
          closedActs.reduce((sum, a) => {
            const d = a.data;
            return (
              sum + (d ? (d["За роботу"] || 0) + (d["За деталі"] || 0) : 0)
            );
          }, 0) / closedActs.length,
        )
      : 0;

  // Найдорожчий акт
  let maxAct = { id: 0, total: 0 };
  for (const a of closedActs) {
    const d = a.data;
    const total = d ? (d["За роботу"] || 0) + (d["За деталі"] || 0) : 0;
    if (total > maxAct.total) maxAct = { id: a.act_id, total };
  }

  // Клієнтів обслуговано (унікальні client_id в актах)
  const uniqueClients = new Set(acts.map((a) => a.client_id).filter(Boolean));

  // Помірний час закриття акту (днів)
  let avgDays = 0;
  const closedWithDates = closedActs.filter((a) => a.date_on && a.date_off);
  if (closedWithDates.length > 0) {
    const totalDays = closedWithDates.reduce((sum, a) => {
      const diff =
        new Date(a.date_off!).getTime() - new Date(a.date_on!).getTime();
      return sum + Math.max(0, diff / (1000 * 60 * 60 * 24));
    }, 0);
    avgDays = Math.round((totalDays / closedWithDates.length) * 10) / 10;
  }

  const trendIcon =
    forecast.trend === "up" ? "📈" : forecast.trend === "down" ? "📉" : "➡️";
  const trendColor =
    forecast.trend === "up"
      ? "#4caf50"
      : forecast.trend === "down"
        ? "#f44336"
        : "#ff9800";

  // Порівняння з минулим місяцем (або останні 2 місяці у фільтрі)
  let changePercent = "";
  const hasFilter = filterDateFrom || filterDateTo;
  if (hasFilter && monthly.length >= 2) {
    // При фільтрі: порівнюємо останній місяць у діапазоні з передостаннім
    const last = monthly[monthly.length - 1];
    const prev = monthly[monthly.length - 2];
    if (prev.revenue > 0) {
      const pct = Math.round(
        ((last.revenue - prev.revenue) / prev.revenue) * 100,
      );
      const sign = pct >= 0 ? "+" : "";
      changePercent = `<span class="analityka-card-sub" style="color:${pct >= 0 ? "#4caf50" : "#f44336"}">${sign}${pct}%</span>`;
    }
  } else if (!hasFilter && currentMonth && prevMonth && prevMonth.revenue > 0) {
    const pct = Math.round(
      ((currentMonth.revenue - prevMonth.revenue) / prevMonth.revenue) * 100,
    );
    const sign = pct >= 0 ? "+" : "";
    changePercent = `<span class="analityka-card-sub" style="color:${pct >= 0 ? "#4caf50" : "#f44336"}">${sign}${pct}%</span>`;
  }

  // Визначаємо дохід в залежності від фільтра
  const incomeLabel = hasFilter ? "Дохід за період" : "Дохід місяця";
  const incomeValue = hasFilter ? totalRevenue : currentMonth?.revenue || 0;

  container.innerHTML = `
    <div class="analityka-card">
      <div class="analityka-card-icon">💰</div>
      <div class="analityka-card-body">
        <div class="analityka-card-label">${incomeLabel}</div>
        <div class="analityka-card-value">${formatMoney(incomeValue)}</div>
        ${changePercent}
      </div>
    </div>
    <div class="analityka-card">
      <div class="analityka-card-icon">🧾</div>
      <div class="analityka-card-body">
        <div class="analityka-card-label">Сер. чек</div>
        <div class="analityka-card-value">${formatMoney(avgCheck)}</div>
        <span class="analityka-card-sub">${closedActs.length} закр.</span>
      </div>
    </div>
    <div class="analityka-card">
      <div class="analityka-card-icon">📋</div>
      <div class="analityka-card-body">
        <div class="analityka-card-label">Актів / відкр.</div>
        <div class="analityka-card-value">${totalActs} / <span style="color:#f44336">${openActs}</span></div>
        <span class="analityka-card-sub">⏱ ${avgDays} дн.</span>
      </div>
    </div>
    <div class="analityka-card">
      <div class="analityka-card-icon">👥</div>
      <div class="analityka-card-body">
        <div class="analityka-card-label">Клієнтів</div>
        <div class="analityka-card-value">${uniqueClients.size}</div>
      </div>
    </div>
    <div class="analityka-card">
      <div class="analityka-card-icon">📊</div>
      <div class="analityka-card-body">
        <div class="analityka-card-label">Всього</div>
        <div class="analityka-card-value">${formatMoney(totalRevenue)}</div>
        <span class="analityka-card-sub">${monthly.length} міс.</span>
      </div>
    </div>
    <div class="analityka-card">
      <div class="analityka-card-icon">🏆</div>
      <div class="analityka-card-body">
        <div class="analityka-card-label">Макс. акт</div>
        <div class="analityka-card-value">#${maxAct.id}</div>
        <span class="analityka-card-sub">${formatMoney(maxAct.total)} грн</span>
      </div>
    </div>
    <div class="analityka-card" style="border-left: 3px solid ${trendColor}">
      <div class="analityka-card-icon">${trendIcon}</div>
      <div class="analityka-card-body">
        <div class="analityka-card-label">Прогноз</div>
        <div class="analityka-card-value">${formatMoney(forecast.forecastRevenue)}</div>
        <span class="analityka-card-sub">${forecast.nextMonthLabel}</span>
      </div>
    </div>
  `;
}

// ===================== ТОП КЛІЄНТІВ / МАШИН =====================

function getClientPIB(clientId: number | null): string {
  if (!clientId) return "Невідомий";
  const c = cachedClients.find((cl) => cl.client_id === clientId);
  const d = c?.data;
  if (typeof d === "string") {
    try {
      return JSON.parse(d)?.["ПІБ"] || "Невідомий";
    } catch {
      return "Невідомий";
    }
  }
  return d?.["ПІБ"] || "Невідомий";
}

function getCarNamePlate(carsId: number | null): {
  name: string;
  plate: string;
} {
  if (!carsId) return { name: "Невідомо", plate: "" };
  const c = cachedCars.find((cr) => cr.cars_id === carsId);
  let d = c?.data;
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      return { name: "Невідомо", plate: "" };
    }
  }
  return {
    name: (d as any)?.["Авто"] || "Невідомо",
    plate: (d as any)?.["Номер авто"] || "",
  };
}

function getActTotal(act: ActRow): number {
  const d = act.data;
  if (!d) return 0;
  return (d["За роботу"] || 0) + (d["За деталі"] || 0);
}

function calcTopClientsBySum(): TopClient[] {
  const map = new Map<number, TopClient>();
  for (const act of getFilteredActs()) {
    if (!act.client_id) continue;
    if (!map.has(act.client_id)) {
      map.set(act.client_id, {
        clientId: act.client_id,
        pib: getClientPIB(act.client_id),
        totalSum: 0,
        actsCount: 0,
      });
    }
    const c = map.get(act.client_id)!;
    c.totalSum += getActTotal(act);
    c.actsCount++;
  }
  return Array.from(map.values())
    .sort((a, b) => b.totalSum - a.totalSum)
    .slice(0, 10);
}

function calcTopClientsByFrequency(): TopClient[] {
  const map = new Map<number, TopClient>();
  for (const act of getFilteredActs()) {
    if (!act.client_id) continue;
    if (!map.has(act.client_id)) {
      map.set(act.client_id, {
        clientId: act.client_id,
        pib: getClientPIB(act.client_id),
        totalSum: 0,
        actsCount: 0,
      });
    }
    const c = map.get(act.client_id)!;
    c.totalSum += getActTotal(act);
    c.actsCount++;
  }
  return Array.from(map.values())
    .sort((a, b) => b.actsCount - a.actsCount)
    .slice(0, 10);
}

function calcTopCarsBySum(): TopCar[] {
  const map = new Map<number, TopCar>();
  for (const act of getFilteredActs()) {
    if (!act.cars_id) continue;
    if (!map.has(act.cars_id)) {
      const info = getCarNamePlate(act.cars_id);
      map.set(act.cars_id, {
        carsId: act.cars_id,
        carName: info.name,
        plate: info.plate,
        totalSum: 0,
        actsCount: 0,
      });
    }
    const c = map.get(act.cars_id)!;
    c.totalSum += getActTotal(act);
    c.actsCount++;
  }
  return Array.from(map.values())
    .sort((a, b) => b.totalSum - a.totalSum)
    .slice(0, 10);
}

function calcTopCarsByFrequency(): TopCar[] {
  const map = new Map<number, TopCar>();
  for (const act of getFilteredActs()) {
    if (!act.cars_id) continue;
    if (!map.has(act.cars_id)) {
      const info = getCarNamePlate(act.cars_id);
      map.set(act.cars_id, {
        carsId: act.cars_id,
        carName: info.name,
        plate: info.plate,
        totalSum: 0,
        actsCount: 0,
      });
    }
    const c = map.get(act.cars_id)!;
    c.totalSum += getActTotal(act);
    c.actsCount++;
  }
  return Array.from(map.values())
    .sort((a, b) => b.actsCount - a.actsCount)
    .slice(0, 10);
}

// ===================== ТОП ДЕТАЛЕЙ =====================

interface TopPart {
  name: string;
  totalSum: number;
  totalQty: number;
  actsCount: number;
}

/** Топ-10 найдорожчих деталей (за загальною сумою) */
function calcTopPartsBySum(): TopPart[] {
  const map = new Map<string, TopPart>();
  for (const act of getFilteredActs()) {
    const details = act.data?.Деталі;
    if (!details) continue;
    for (const det of details) {
      const name = det.Деталь?.trim();
      if (!name) continue;
      const qty = det.Кількість || 1;
      const price = det.Ціна || 0;
      const sum = qty * price;
      if (!map.has(name)) {
        map.set(name, { name, totalSum: 0, totalQty: 0, actsCount: 0 });
      }
      const p = map.get(name)!;
      p.totalSum += sum;
      p.totalQty += qty;
      p.actsCount++;
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.totalSum - a.totalSum)
    .slice(0, 10);
}

/** Топ-10 деталей, що встановлюються найчастіше */
function calcTopPartsByFrequency(): TopPart[] {
  const map = new Map<string, TopPart>();
  for (const act of getFilteredActs()) {
    const details = act.data?.Деталі;
    if (!details) continue;
    for (const det of details) {
      const name = det.Деталь?.trim();
      if (!name) continue;
      const qty = det.Кількість || 1;
      const price = det.Ціна || 0;
      const sum = qty * price;
      if (!map.has(name)) {
        map.set(name, { name, totalSum: 0, totalQty: 0, actsCount: 0 });
      }
      const p = map.get(name)!;
      p.totalSum += sum;
      p.totalQty += qty;
      p.actsCount++;
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.actsCount - a.actsCount || b.totalQty - a.totalQty)
    .slice(0, 10);
}

function renderTopPartsSection(): void {
  const container = document.getElementById("analityka-top-parts");
  if (!container) return;

  const bySum = calcTopPartsBySum();
  const byFreq = calcTopPartsByFrequency();

  // Перетин
  const sumNames = new Set(bySum.map((p) => p.name));
  const freqNames = new Set(byFreq.map((p) => p.name));
  const overlap = new Set([...sumNames].filter((n) => freqNames.has(n)));

  const rowsSum = bySum
    .map((p, i) => {
      const cls = overlap.has(p.name) ? "analityka-overlap-row" : "";
      const badge = overlap.has(p.name)
        ? ' <span class="analityka-overlap-badge">⭐</span>'
        : "";
      return `<tr class="${cls}">
      <td>${i + 1}</td>
      <td>${truncateText(p.name, 40)}${badge}</td>
      <td>${formatMoney(p.totalSum)} грн</td>
      <td>${p.totalQty}</td>
      <td>${p.actsCount}</td>
    </tr>`;
    })
    .join("");

  const rowsFreq = byFreq
    .map((p, i) => {
      const cls = overlap.has(p.name) ? "analityka-overlap-row" : "";
      const badge = overlap.has(p.name)
        ? ' <span class="analityka-overlap-badge">⭐</span>'
        : "";
      return `<tr class="${cls}">
      <td>${i + 1}</td>
      <td>${truncateText(p.name, 40)}${badge}</td>
      <td>${p.actsCount}</td>
      <td>${p.totalQty}</td>
      <td>${formatMoney(p.totalSum)} грн</td>
    </tr>`;
    })
    .join("");

  container.innerHTML = `
    <div class="analityka-row">
      <div class="analityka-chart-block analityka-half">
        <h3 class="analityka-chart-title">🔩 Топ-10 найдорожчих деталей</h3>
        <table class="analityka-table">
          <thead><tr><th>#</th><th>Деталь</th><th>Сума</th><th>Кіл.</th><th>Актів</th></tr></thead>
          <tbody>${rowsSum || '<tr><td colspan="5" style="text-align:center;color:#999">Немає даних</td></tr>'}</tbody>
        </table>
      </div>
      <div class="analityka-chart-block analityka-half">
        <h3 class="analityka-chart-title">🔄 Топ-10 найчастіших деталей</h3>
        <table class="analityka-table">
          <thead><tr><th>#</th><th>Деталь</th><th>Актів</th><th>Кіл.</th><th>Сума</th></tr></thead>
          <tbody>${rowsFreq || '<tr><td colspan="5" style="text-align:center;color:#999">Немає даних</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    ${overlap.size > 0 ? `<div class="analityka-overlap-legend">⭐ — деталь у обох списках (найдорожча + найчастіша)</div>` : ""}
  `;
}

function renderTopClientsSection(): void {
  const container = document.getElementById("analityka-top-clients");
  if (!container) return;

  const bySum = calcTopClientsBySum();
  const byFreq = calcTopClientsByFrequency();

  // Знаходимо тих, хто в обох списках
  const sumIds = new Set(bySum.map((c) => c.clientId));
  const freqIds = new Set(byFreq.map((c) => c.clientId));
  const overlap = new Set([...sumIds].filter((id) => freqIds.has(id)));

  const rowsSum = bySum
    .map((c, i) => {
      const cls = overlap.has(c.clientId) ? "analityka-overlap-row" : "";
      const badge = overlap.has(c.clientId)
        ? ' <span class="analityka-overlap-badge">⭐</span>'
        : "";
      return `<tr class="${cls}">
      <td>${i + 1}</td>
      <td>${c.pib}${badge}</td>
      <td>${formatMoney(c.totalSum)} грн</td>
      <td>${c.actsCount}</td>
    </tr>`;
    })
    .join("");

  const rowsFreq = byFreq
    .map((c, i) => {
      const cls = overlap.has(c.clientId) ? "analityka-overlap-row" : "";
      const badge = overlap.has(c.clientId)
        ? ' <span class="analityka-overlap-badge">⭐</span>'
        : "";
      return `<tr class="${cls}">
      <td>${i + 1}</td>
      <td>${c.pib}${badge}</td>
      <td>${c.actsCount}</td>
      <td>${formatMoney(c.totalSum)} грн</td>
    </tr>`;
    })
    .join("");

  container.innerHTML = `
    <div class="analityka-row">
      <div class="analityka-chart-block analityka-half">
        <h3 class="analityka-chart-title">💰 Топ-10 клієнтів (найбільший чек)</h3>
        <table class="analityka-table">
          <thead><tr><th>#</th><th>Клієнт</th><th>Сума</th><th>Актів</th></tr></thead>
          <tbody>${rowsSum}</tbody>
        </table>
      </div>
      <div class="analityka-chart-block analityka-half">
        <h3 class="analityka-chart-title">🔄 Топ-10 постійних клієнтів</h3>
        <table class="analityka-table">
          <thead><tr><th>#</th><th>Клієнт</th><th>Актів</th><th>Сума</th></tr></thead>
          <tbody>${rowsFreq}</tbody>
        </table>
      </div>
    </div>
    ${overlap.size > 0 ? `<div class="analityka-overlap-legend">⭐ — клієнт у обох списках (найбільший чек + постійний)</div>` : ""}
  `;
}

function renderTopCarsSection(): void {
  const container = document.getElementById("analityka-top-cars");
  if (!container) return;

  const bySum = calcTopCarsBySum();
  const byFreq = calcTopCarsByFrequency();

  // Знаходимо тих, хто в обох списках
  const sumIds = new Set(bySum.map((c) => c.carsId));
  const freqIds = new Set(byFreq.map((c) => c.carsId));
  const overlap = new Set([...sumIds].filter((id) => freqIds.has(id)));

  const rowsSum = bySum
    .map((c, i) => {
      const cls = overlap.has(c.carsId) ? "analityka-overlap-row" : "";
      const badge = overlap.has(c.carsId)
        ? ' <span class="analityka-overlap-badge">⭐</span>'
        : "";
      return `<tr class="${cls}">
      <td>${i + 1}</td>
      <td>${c.carName}${badge}</td>
      <td>${c.plate}</td>
      <td>${formatMoney(c.totalSum)} грн</td>
      <td>${c.actsCount}</td>
    </tr>`;
    })
    .join("");

  const rowsFreq = byFreq
    .map((c, i) => {
      const cls = overlap.has(c.carsId) ? "analityka-overlap-row" : "";
      const badge = overlap.has(c.carsId)
        ? ' <span class="analityka-overlap-badge">⭐</span>'
        : "";
      return `<tr class="${cls}">
      <td>${i + 1}</td>
      <td>${c.carName}${badge}</td>
      <td>${c.plate}</td>
      <td>${c.actsCount}</td>
      <td>${formatMoney(c.totalSum)} грн</td>
    </tr>`;
    })
    .join("");

  container.innerHTML = `
    <div class="analityka-row">
      <div class="analityka-chart-block analityka-half">
        <h3 class="analityka-chart-title">💰 Топ-10 авто (найбільший чек)</h3>
        <table class="analityka-table">
          <thead><tr><th>#</th><th>Авто</th><th>Номер</th><th>Сума</th><th>Актів</th></tr></thead>
          <tbody>${rowsSum}</tbody>
        </table>
      </div>
      <div class="analityka-chart-block analityka-half">
        <h3 class="analityka-chart-title">🔄 Топ-10 постійних авто</h3>
        <table class="analityka-table">
          <thead><tr><th>#</th><th>Авто</th><th>Номер</th><th>Актів</th><th>Сума</th></tr></thead>
          <tbody>${rowsFreq}</tbody>
        </table>
      </div>
    </div>
    ${overlap.size > 0 ? `<div class="analityka-overlap-legend">⭐ — авто у обох списках (найбільший чек + постійне)</div>` : ""}
  `;
}

function renderAnomalies(anomalies: Anomaly[]): void {
  const container = document.getElementById("analityka-anomalies");
  if (!container) return;

  if (anomalies.length === 0) {
    container.innerHTML = `<div class="analityka-anomaly-empty">✅ Аномалій не виявлено</div>`;
    return;
  }

  container.innerHTML = anomalies
    .map((a) => {
      const cls = `analityka-anomaly-item analityka-anomaly-${a.type}`;
      return `<div class="${cls}">${a.icon} ${a.message}</div>`;
    })
    .join("");
}

function renderMechanicsTable(data: MechanicStats[]): void {
  const container = document.getElementById("analityka-mechanics-table");
  if (!container) return;

  if (data.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:#999; padding:20px;">Немає даних</div>`;
    return;
  }

  const rows = data
    .map(
      (m, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${m.name}</strong></td>
      <td>${m.actsCount}</td>
      <td>${formatMoney(m.totalEarned)} грн</td>
      <td>${formatMoney(m.totalSalary)} грн</td>
      <td>${formatMoney(m.avgPerAct)} грн</td>
    </tr>
  `,
    )
    .join("");

  container.innerHTML = `
    <table class="analityka-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Механік</th>
          <th>Актів</th>
          <th>Заробив для СТО</th>
          <th>Зарплата</th>
          <th>Сер. за акт</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ===================== УТИЛІТИ =====================

function formatMoney(val: number): string {
  return Math.round(val)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function truncateText(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

// ===================== ГОЛОВНА ФУНКЦІЯ =====================

/** Перемальовує все без повторного завантаження з бази */
function redrawDashboard(): void {
  const monthlyData = calcMonthlyRevenue();
  const topWorks = calcTopWorks();
  const mechanicStats = calcMechanicStats();
  const anomalies = detectAnomalies();
  const forecast = calcForecast(monthlyData);

  // Знищуємо старі графіки
  if (revenueChart) {
    revenueChart.destroy();
    revenueChart = null;
  }
  if (topWorksChart) {
    topWorksChart.destroy();
    topWorksChart = null;
  }
  if (mechanicsChart) {
    mechanicsChart.destroy();
    mechanicsChart = null;
  }

  renderSummaryCards(monthlyData, forecast);
  renderRevenueChart(monthlyData);
  renderTopWorksChart(topWorks);
  renderMechanicsChart(mechanicStats);
  renderMechanicsTable(mechanicStats);
  renderTopPartsSection();
  renderTopClientsSection();
  renderTopCarsSection();
  renderAnomalies(anomalies);
}

/** Форматує дату для input[type=date] */
function fmtInputDate(d: Date): string {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Швидкий вибір діапазону */
function applyQuickRange(type: string): void {
  const now = new Date();
  const fromInput = document.getElementById(
    "analityka-date-from",
  ) as HTMLInputElement;
  const toInput = document.getElementById(
    "analityka-date-to",
  ) as HTMLInputElement;

  let from: Date;
  let to: Date = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
  );

  switch (type) {
    case "week":
      from = new Date(now);
      from.setDate(now.getDate() - 7);
      break;
    case "month":
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "quarter": {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      from = new Date(now.getFullYear(), qMonth, 1);
      break;
    }
    case "year":
      from = new Date(now.getFullYear(), 0, 1);
      break;
    case "all":
      filterDateFrom = null;
      filterDateTo = null;
      if (fromInput) fromInput.value = "";
      if (toInput) toInput.value = "";
      highlightQuickBtn(type);
      redrawDashboard();
      return;
    default:
      return;
  }

  filterDateFrom = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate(),
    0,
    0,
    0,
  );
  filterDateTo = to;

  if (fromInput) fromInput.value = fmtInputDate(filterDateFrom);
  if (toInput) toInput.value = fmtInputDate(filterDateTo);

  highlightQuickBtn(type);
  redrawDashboard();
}

function highlightQuickBtn(active: string): void {
  const btns = document.querySelectorAll(".analityka-quick-btn");
  btns.forEach((btn) => {
    btn.classList.toggle(
      "active",
      (btn as HTMLElement).dataset.range === active,
    );
  });
}

function setupDateFilter(): void {
  const fromInput = document.getElementById(
    "analityka-date-from",
  ) as HTMLInputElement;
  const toInput = document.getElementById(
    "analityka-date-to",
  ) as HTMLInputElement;

  if (!fromInput || !toInput) return;

  const onChange = () => {
    if (fromInput.value) {
      const [y, m, d] = fromInput.value.split("-").map(Number);
      filterDateFrom = new Date(y, m - 1, d, 0, 0, 0);
    } else {
      filterDateFrom = null;
    }
    if (toInput.value) {
      const [y, m, d] = toInput.value.split("-").map(Number);
      filterDateTo = new Date(y, m - 1, d, 23, 59, 59);
    } else {
      filterDateTo = null;
    }
    // Знімаємо виділення кнопок
    highlightQuickBtn("");
    redrawDashboard();
  };

  fromInput.addEventListener("change", onChange);
  toInput.addEventListener("change", onChange);

  // Кнопки швидкого вибору
  const quickBtns = document.querySelectorAll(".analityka-quick-btn");
  quickBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const range = (btn as HTMLElement).dataset.range;
      if (range) applyQuickRange(range);
    });
  });
}

/** Ініціалізувати та відобразити аналітику */
export async function initAnalityka(): Promise<void> {
  if (isLoading) return;
  isLoading = true;

  const container = document.getElementById("analityka-dashboard");
  if (!container) {
    isLoading = false;
    return;
  }

  // Показуємо лоадер
  container.innerHTML = `
    <div class="analityka-loader">
      <div class="analityka-spinner"></div>
      <span>Завантаження аналітики...</span>
    </div>
  `;

  const ok = await loadAnalyticsData();
  if (!ok) {
    container.innerHTML = `<div style="text-align:center; color:#f44336; padding:40px;">❌ Помилка завантаження даних</div>`;
    isLoading = false;
    return;
  }

  // Знаходимо найстарішу дату
  let minDate = "";
  for (const a of cachedActs) {
    if (a.date_on && (!minDate || a.date_on < minDate)) minDate = a.date_on;
  }
  const minDateObj = minDate ? new Date(minDate) : new Date(2025, 0, 1);
  const todayStr = fmtInputDate(new Date());
  const minDateStr = fmtInputDate(minDateObj);

  // Рендеримо структуру
  container.innerHTML = `
    <!-- 📅 Фільтр по датах -->
    <div class="analityka-date-filter">
      <div class="analityka-date-inputs">
        <label class="analityka-date-label">
          <span>Від</span>
          <input type="date" id="analityka-date-from" class="analityka-date-input" min="${minDateStr}" max="${todayStr}" />
        </label>
        <span class="analityka-date-separator">—</span>
        <label class="analityka-date-label">
          <span>До</span>
          <input type="date" id="analityka-date-to" class="analityka-date-input" min="${minDateStr}" max="${todayStr}" />
        </label>
      </div>
      <div class="analityka-quick-btns">
        <button class="analityka-quick-btn" data-range="week">Тиждень</button>
        <button class="analityka-quick-btn" data-range="month">Місяць</button>
        <button class="analityka-quick-btn" data-range="quarter">Квартал</button>
        <button class="analityka-quick-btn" data-range="year">Рік</button>
        <button class="analityka-quick-btn active" data-range="all">Все</button>
      </div>
    </div>

    <!-- Картки -->
    <div id="analityka-summary-cards" class="analityka-summary-cards"></div>

    <!-- Графік доходу по місяцях -->
    <div class="analityka-chart-block">
      <h3 class="analityka-chart-title">📈 Дохід / Витрати / Прибуток по місяцях</h3>
      <div id="analityka-revenue-chart"></div>
    </div>

    <!-- Два блока: Топ робіт + Механіки -->
    <div class="analityka-row">
      <div class="analityka-chart-block analityka-half">
        <h3 class="analityka-chart-title">🏆 Топ-10 найприбутковіших робіт</h3>
        <div id="analityka-top-works-chart"></div>
      </div>
      <div class="analityka-chart-block analityka-half">
        <h3 class="analityka-chart-title">👨‍🔧 Ефективність механіків</h3>
        <div id="analityka-mechanics-chart"></div>
      </div>
    </div>

    <!-- Таблиця механіків -->
    <div class="analityka-chart-block">
      <h3 class="analityka-chart-title">📊 Детальна статистика механіків</h3>
      <div id="analityka-mechanics-table"></div>
    </div>

    <!-- � Топ деталей -->
    <div id="analityka-top-parts"></div>

    <!-- �👤 Топ клієнтів -->
    <div id="analityka-top-clients"></div>

    <!-- 🚗 Топ машин -->
    <div id="analityka-top-cars"></div>

    <!-- Аномалії -->
    <div class="analityka-chart-block">
      <h3 class="analityka-chart-title">⚠️ Аномалії та попередження</h3>
      <div id="analityka-anomalies" class="analityka-anomalies"></div>
    </div>
  `;

  // Підключаємо фільтр дат
  setupDateFilter();

  // Рендеримо дані
  redrawDashboard();

  isLoading = false;
}

/** Оновити дані аналітики */
export async function refreshAnalityka(): Promise<void> {
  // Зберігаємо поточний фільтр
  const savedFrom = filterDateFrom;
  const savedTo = filterDateTo;

  // Знищуємо старі графіки
  if (revenueChart) {
    revenueChart.destroy();
    revenueChart = null;
  }
  if (topWorksChart) {
    topWorksChart.destroy();
    topWorksChart = null;
  }
  if (mechanicsChart) {
    mechanicsChart.destroy();
    mechanicsChart = null;
  }

  await initAnalityka();

  // Відновлюємо фільтр
  if (savedFrom || savedTo) {
    filterDateFrom = savedFrom;
    filterDateTo = savedTo;
    const fromInput = document.getElementById(
      "analityka-date-from",
    ) as HTMLInputElement;
    const toInput = document.getElementById(
      "analityka-date-to",
    ) as HTMLInputElement;
    if (fromInput && savedFrom) fromInput.value = fmtInputDate(savedFrom);
    if (toInput && savedTo) toInput.value = fmtInputDate(savedTo);
    redrawDashboard();
  }
}
