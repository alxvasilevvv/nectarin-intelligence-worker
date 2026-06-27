/**
 * Orchestrator (orchestrator–worker pattern) for NECTARIN Intelligence —
 * Cloudflare Workers edition.
 *
 * Ported verbatim (logic + math) from the reference Node/TS server, with the
 * only change being the data import path (inline TS module instead of JSON+fs).
 * There are NO Node-only APIs here, so it runs unchanged on the Workers runtime.
 *
 *     Planner → workers[ dataRetriever, analyst, strategist, copywriter, compliance ]
 *             → synthesizer
 *
 * No real LLM calls happen. `callLLM()` is a clearly-marked stub showing exactly
 * where an Anthropic / OpenAI (model-agnostic) call would plug in.
 */

import {
  getCategoryBenchmarks,
  getMetric,
  getPlaybook,
  getSuppliers,
  type Kpi,
  type MetricRange,
  type Platform,
  type Supplier,
} from "./data.js";

// ── LLM stub (model-agnostic) ──────────────────────────────────────────────

export interface LlmRequest {
  system: string;
  prompt: string;
  context?: unknown;
}

/**
 * STUB — does NOT call any model. Returns a deterministic templated string so
 * the Worker runs offline.
 *
 * To make this real on Workers, call the Anthropic / OpenAI HTTP API directly
 * with `fetch()` (both are reachable from a Worker), reading the key from a
 * `wrangler secret` (e.g. env.LLM_API_KEY), e.g.:
 *
 *   const r = await fetch("https://api.anthropic.com/v1/messages", {
 *     method: "POST",
 *     headers: {
 *       "x-api-key": env.LLM_API_KEY,
 *       "anthropic-version": "2023-06-01",
 *       "content-type": "application/json",
 *     },
 *     body: JSON.stringify({
 *       model: env.LLM_MODEL ?? "claude-3-7-sonnet",
 *       max_tokens: 1024,
 *       system: req.system,
 *       messages: [{ role: "user", content: req.prompt }],
 *     }),
 *   });
 *   const j = await r.json();
 *   return j.content.map((c: any) => (c.type === "text" ? c.text : "")).join("");
 */
export async function callLLM(req: LlmRequest): Promise<string> {
  const ctx = req.context ? ` [grounded on ${summarizeContext(req.context)}]` : "";
  return `«${req.prompt.trim()}»${ctx} — (LLM-stub: replace callLLM() with an Anthropic/OpenAI fetch() for production narrative.)`;
}

function summarizeContext(ctx: unknown): string {
  try {
    const s = JSON.stringify(ctx);
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  } catch {
    return "context";
  }
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Linear interpolation of a value to an approximate percentile within p25..p75. */
export function percentileFor(range: MetricRange, value: number): number {
  if (value <= range.p25) {
    const frac = range.p25 === 0 ? 0 : Math.max(0, value / range.p25);
    return Math.round(Math.max(1, 25 * frac));
  }
  if (value <= range.p50) {
    const frac = (value - range.p25) / Math.max(1e-9, range.p50 - range.p25);
    return Math.round(25 + 25 * frac);
  }
  if (value <= range.p75) {
    const frac = (value - range.p50) / Math.max(1e-9, range.p75 - range.p50);
    return Math.round(50 + 25 * frac);
  }
  const frac = (value - range.p75) / Math.max(1e-9, range.p75);
  return Math.round(Math.min(99, 75 + 25 * frac));
}

function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// ── Worker: dataRetriever ────────────────────────────────────────────────────

interface RetrievedData {
  category?: string;
  platformMetrics?: Record<string, Record<Kpi, MetricRange>>;
  suppliers?: Supplier[];
  playbookIndustry?: string;
}

const dataRetriever = {
  async benchmarks(category: string): Promise<RetrievedData> {
    return { category, platformMetrics: await getCategoryBenchmarks(category) };
  },
};

// ── Worker: analyst ──────────────────────────────────────────────────────────

const analyst = {
  scoreSuppliers(suppliers: Supplier[], category?: string) {
    return suppliers
      .map((s) => {
        const strong = category ? s.categoriesStrong.includes(category) : false;
        const adjusted = Math.min(100, s.qualityScore + (strong ? 4 : 0));
        return {
          id: s.id,
          name: s.name,
          platform: s.platform,
          format: s.format,
          qualityScore: adjusted,
          fraudRisk: s.fraudRisk,
          viewability: s.viewability,
          humanTraffic: s.humanTraffic,
          categoryFit: strong ? "strong" : "neutral",
        };
      })
      .sort((a, b) => b.qualityScore - a.qualityScore);
  },

  /**
   * Real forecast math:
   * impressions = spend / CPM * 1000 ; clicks = impressions * CTR ;
   * conversions = spend / CPA.
   */
  async forecastChannels(
    category: string,
    split: Array<{ platform: Platform; share: number }>,
    totalBudget: number
  ) {
    const bm = await getCategoryBenchmarks(category);
    const channels = await Promise.all(
      split.map(async ({ platform, share }) => {
        const spend = round(totalBudget * share);
        const cpm = (await getMetric(category, platform, "CPM"))?.p50 ?? 300;
        const ctr = (await getMetric(category, platform, "CTR"))?.p50 ?? 0.8; // percent
        const cpa = (await getMetric(category, platform, "CPA"))?.p50 ?? 1500;
        const impressions = round((spend / cpm) * 1000);
        const clicks = round(impressions * (ctr / 100));
        const conversions = round(spend / cpa);
        return { platform, share: round(share * 100), spend, cpm, ctr, cpa, impressions, clicks, conversions };
      })
    );

    const totalImpr = channels.reduce((a, c) => a + c.impressions, 0);
    const totalClicks = channels.reduce((a, c) => a + c.clicks, 0);
    const totalConv = channels.reduce((a, c) => a + c.conversions, 0);
    const estReach = round(totalImpr * 0.62 * 0.45);
    const blendedCpa = totalConv ? round(totalBudget / totalConv) : null;

    return {
      hasBenchmarks: Boolean(bm),
      channels,
      totals: {
        impressions: totalImpr,
        clicks: totalClicks,
        conversions: totalConv,
        estReach,
        blendedCpa,
      },
    };
  },
};

// ── Worker: strategist ───────────────────────────────────────────────────────

type Goal = "awareness" | "consideration" | "performance" | "retention";

const strategist = {
  channelSplit(goal: Goal): Array<{ platform: Platform; share: number }> {
    const presets: Record<Goal, Array<{ platform: Platform; share: number }>> = {
      awareness: [
        { platform: "OLV", share: 0.45 },
        { platform: "VK Ads", share: 0.3 },
        { platform: "Telegram Ads", share: 0.15 },
        { platform: "Yandex Direct", share: 0.1 },
      ],
      consideration: [
        { platform: "VK Ads", share: 0.35 },
        { platform: "Yandex Direct", share: 0.3 },
        { platform: "OLV", share: 0.2 },
        { platform: "Telegram Ads", share: 0.15 },
      ],
      performance: [
        { platform: "Yandex Direct", share: 0.5 },
        { platform: "VK Ads", share: 0.3 },
        { platform: "Telegram Ads", share: 0.2 },
      ],
      retention: [
        { platform: "VK Ads", share: 0.4 },
        { platform: "Telegram Ads", share: 0.35 },
        { platform: "Yandex Direct", share: 0.25 },
      ],
    };
    return presets[goal] ?? presets.performance;
  },

  async territories(industry: string): Promise<string[]> {
    return (await getPlaybook(industry))?.territories ?? [
      "Функциональная выгода",
      "Эмоциональная связь",
      "Доверие к бренду",
    ];
  },
};

// ── Worker: copywriter ───────────────────────────────────────────────────────

const copywriter = {
  async rationale(topic: string, context: unknown): Promise<string> {
    return callLLM({
      system:
        "You are NECTARIN Intelligence, a senior RU/CIS media strategist. Be concise, concrete, in Russian.",
      prompt: `Сформулируй обоснование: ${topic}`,
      context,
    });
  },
  async conceptTerritories(product: string, audience: string, channel: string): Promise<string[]> {
    const seeds = ["Контраст «было/стало»", "Инсайт аудитории + продукт-решение", "Демонстрация в нативном контексте канала"];
    return Promise.all(
      seeds.map((s, i) =>
        callLLM({
          system: "Креативный директор NECTARIN. Кратко, на русском.",
          prompt: `Концепт ${i + 1} для «${product}» / аудитория «${audience}» / канал «${channel}»: ${s}`,
        })
      )
    );
  },
};

// ── Worker: compliance ───────────────────────────────────────────────────────

const REGULATED = new Set(["pharma", "finance"]);

const compliance = {
  async review(industry: string): Promise<{ regulated: boolean; notes: string[]; gate: string | null }> {
    const pb = await getPlaybook(industry);
    const notes = pb?.complianceNotes ?? ["Маркировка рекламы ОРД/ЕРИР обязательна."];
    const regulated = REGULATED.has(industry) || Boolean(pb?.regulated);
    const gate = regulated
      ? "STOP-GATE: регулируемая категория — обязательное юридическое согласование креативов и условий ДО запуска."
      : null;
    return { regulated, notes, gate };
  },
};

// ── Planner + Synthesizer ────────────────────────────────────────────────────

export const PLAN: Record<string, string[]> = {
  ru_benchmarks: ["dataRetriever", "analyst"],
  supplier_quality: ["dataRetriever", "analyst", "strategist"],
  media_plan: ["dataRetriever", "strategist", "analyst", "copywriter", "compliance"],
  category_playbook: ["dataRetriever", "strategist", "compliance"],
  audience_insights: ["dataRetriever", "strategist"],
  competitor_scan: ["dataRetriever", "analyst", "strategist"],
  geo_aeo_audit: ["analyst", "strategist", "copywriter"],
  creative_brief: ["strategist", "copywriter", "compliance"],
  report_explain: ["analyst", "copywriter"],
};

export interface PlanResult<T = unknown> {
  tool: string;
  workers: string[];
  data: T;
  disclaimer: string;
}

const DISCLAIMER =
  "MOCK/synthetic data. NECTARIN Intelligence (Cloudflare Workers) — replace data accessors with real aggregated benchmarks (KV/D1). Not legal advice.";

export async function runPlan(toolName: string, input: any): Promise<PlanResult> {
  const workers = PLAN[toolName] ?? [];

  switch (toolName) {
    case "ru_benchmarks": {
      const { category, kpi, platform } = input as { category: string; kpi: Kpi; platform?: Platform };
      const retrieved = await dataRetriever.benchmarks(category);
      const platforms = platform ? [platform] : Object.keys(retrieved.platformMetrics ?? {});
      const rows = (
        await Promise.all(
          platforms.map(async (p) => {
            const range = await getMetric(category, p, kpi);
            if (!range) return null;
            return {
              platform: p,
              kpi,
              range,
              medianPercentile: percentileFor(range, range.p50),
            };
          })
        )
      ).filter(Boolean);
      return synth(toolName, workers, {
        category,
        kpi,
        region: "RU/CIS",
        currency: kpi === "CTR" || kpi === "VTR" ? "%" : "RUB",
        results: rows,
      });
    }

    case "supplier_quality": {
      const { format, platform, category } = input as {
        format?: string;
        platform?: Platform;
        category?: string;
      };
      let suppliers = await getSuppliers();
      if (platform) suppliers = suppliers.filter((s) => s.platform === platform);
      if (format) suppliers = suppliers.filter((s) => s.format.toLowerCase().includes(format.toLowerCase()));
      const scored = analyst.scoreSuppliers(suppliers, category);
      const recommendedFormats = Array.from(
        new Set(scored.filter((s) => s.qualityScore >= 80 && s.fraudRisk === "low").map((s) => s.format))
      );
      return synth(toolName, workers, {
        filter: { format: format ?? null, platform: platform ?? null, category: category ?? null },
        suppliers: scored,
        recommendedFormats,
        avoid: scored.filter((s) => s.fraudRisk === "high").map((s) => s.name),
      });
    }

    case "media_plan": {
      const { budget, goal, geo, audience, period, category } = input as {
        budget: number;
        goal: Goal;
        geo: string;
        audience: string;
        period: string;
        category: string;
      };
      const split = strategist.channelSplit(goal);
      const forecast = await analyst.forecastChannels(category, split, budget);
      const comp = await compliance.review(category);
      const rationale = await copywriter.rationale(
        `сплит под цель «${goal}» в категории «${category}», бюджет ${budget} RUB, гео ${geo}`,
        { goal, category, split, totals: forecast.totals }
      );
      return synth(toolName, workers, {
        input: { budget, goal, geo, audience, period, category, currency: "RUB" },
        channelSplit: forecast.channels.map((c) => ({ platform: c.platform, sharePct: c.share, spend: c.spend })),
        flight: buildFlight(period, forecast.channels.map((c) => c.platform)),
        forecast: forecast.totals,
        perChannel: forecast.channels,
        rationale,
        compliance: comp,
      });
    }

    case "category_playbook": {
      const { industry } = input as { industry: string };
      const pb = await getPlaybook(industry);
      const comp = await compliance.review(industry);
      return synth(toolName, workers, {
        industry,
        found: Boolean(pb),
        territories: pb?.territories ?? [],
        dos: pb?.dos ?? [],
        donts: pb?.donts ?? [],
        seasonalHooks: pb?.seasonalHooks ?? [],
        compliance: comp,
      });
    }

    case "audience_insights": {
      const { category, geo } = input as { category: string; geo?: string };
      return synth(toolName, workers, buildAudienceInsights(category, geo));
    }

    case "competitor_scan": {
      const { brand, category } = input as { brand?: string; category?: string };
      return synth(toolName, workers, await buildCompetitorScan(brand, category));
    }

    case "geo_aeo_audit": {
      const { brand, market } = input as { brand: string; market?: string };
      const audit = buildGeoAeoAudit(brand, market ?? "RU");
      const summary = await copywriter.rationale(`AEO/GEO видимость бренда «${brand}»`, audit.scores);
      return synth(toolName, workers, { ...audit, summary });
    }

    case "creative_brief": {
      const { product, audience, channel } = input as { product: string; audience: string; channel: string };
      const concepts = await copywriter.conceptTerritories(product, audience, channel);
      return synth(toolName, workers, {
        product,
        audience,
        channel,
        brief: {
          objective: `Стимулировать целевое действие в канале «${channel}» среди аудитории «${audience}».`,
          singleMindedProposition: `«${product}» — основной аргумент в одном предложении (заполнить под бренд).`,
          tone: "Уверенный, конкретный, без переобещаний (RU-комплаенс).",
          mandatories: ["Маркировка рекламы (ОРД/ЕРИР)", "Логотип/лого-знак бренда", "Чёткий CTA"],
          channelNotes: channelCraftNotes(channel),
        },
        conceptTerritories: concepts.map((c, i) => ({ id: i + 1, idea: c })),
      });
    }

    case "report_explain": {
      const { metricsJson } = input as { metricsJson: string };
      let parsed: any;
      try {
        parsed = typeof metricsJson === "string" ? JSON.parse(metricsJson) : metricsJson;
      } catch {
        return synth(toolName, workers, {
          error: "metricsJson is not valid JSON.",
          received: String(metricsJson).slice(0, 200),
        });
      }
      const findings = explainMetrics(parsed);
      const summary = await copywriter.rationale("краткое резюме отчёта простыми словами", parsed);
      return synth(toolName, workers, { ...findings, summary });
    }

    default:
      return synth(toolName, workers, {
        error: `Unknown tool '${toolName}'. No plan registered.`,
      });
  }
}

function synth(tool: string, workers: string[], data: unknown): PlanResult {
  return { tool, workers, data, disclaimer: DISCLAIMER };
}

// ── Deterministic builders ──────────────────────────────────────────────────

function buildFlight(period: string, platforms: Platform[]) {
  return platforms.map((p, i) => ({
    platform: p,
    pattern: p === "OLV" ? "burst" : "always-on",
    period,
    weightHint: round(1 / platforms.length + (i === 0 ? 0.05 : -0.02), 2),
  }));
}

function buildAudienceInsights(category: string, geo?: string) {
  const base: Record<string, { segments: any[]; jtbd: string[]; affinities: string[] }> = {
    realty: {
      segments: [
        { name: "Молодые семьи 28-38", size: "крупный", note: "ипотека, первая квартира" },
        { name: "Инвесторы 35-50", size: "средний", note: "доходность, локация" },
        { name: "Апгрейд жилья 40-55", size: "средний", note: "больше площадь, школы" },
      ],
      jtbd: ["Найти безопасную ипотечную сделку", "Вложить накопления надёжно", "Улучшить условия для семьи"],
      affinities: ["Yandex Direct (search-intent)", "Dzen native", "Telegram районные/новостройки"],
    },
    fmcg: {
      segments: [
        { name: "Активные родители 25-44", size: "крупный", note: "семейные закупки" },
        { name: "Молодёжь 18-27", size: "крупный", note: "импульс, тренды" },
        { name: "Экономные домохозяйства", size: "крупный", note: "промо-чувствительность" },
      ],
      jtbd: ["Быстро купить привычное", "Найти выгодное промо", "Попробовать новинку"],
      affinities: ["VK Clips/Stories", "OLV (VK Video, OK.ru)", "ритейл-медиа маркетплейсов"],
    },
    finance: {
      segments: [
        { name: "Накопители 30-50", size: "крупный", note: "вклады, надёжность" },
        { name: "Активные инвесторы 25-45", size: "средний", note: "ИИС, брокеридж" },
        { name: "Заёмщики 25-40", size: "средний", note: "карты, кредиты" },
      ],
      jtbd: ["Сохранить и приумножить деньги", "Получить удобный продукт быстро", "Доверять надёжному банку"],
      affinities: ["Yandex Direct (high-intent)", "Telegram финансовые каналы", "OLV (доверие к бренду)"],
    },
  };
  const insight =
    base[category] ?? {
      segments: [
        { name: "Ядро аудитории", size: "крупный", note: "основной спрос" },
        { name: "Растущий сегмент", size: "средний", note: "потенциал" },
      ],
      jtbd: ["Решить основную задачу", "Сделать выбор уверенно", "Сэкономить время/деньги"],
      affinities: ["VK Ads", "Yandex Direct", "Telegram Ads"],
    };
  return { category, geo: geo ?? "RU", ...insight };
}

async function buildCompetitorScan(brand?: string, category?: string) {
  const pools: Record<string, string[]> = {
    realty: ["ПИК", "Самолёт", "ЛСР", "Эталон", "А101"],
    fmcg: ["Магнит-бренды", "X5 СТМ", "ВкусВилл", "Простоквашино", "Добрый"],
    finance: ["Сбер", "Т-Банк", "Альфа-Банк", "ВТБ", "Газпромбанк"],
    auto: ["LADA", "Haval", "Chery", "Geely", "Москвич"],
    retail: ["Wildberries", "Ozon", "Яндекс Маркет", "DNS", "М.Видео"],
    pharma: ["Apteka.ru", "Эвалар", "Отисифарм", "Доктор Мом", "Нурофен"],
  };
  const key = category ?? "retail";
  const territories = await strategist.territories(key);
  const competitors = (pools[key] ?? pools.retail).map((name, i) => ({
    name,
    estimatedActivity: ["high", "high", "medium", "medium", "low"][i] ?? "medium",
    primaryChannels: i % 2 === 0 ? ["Yandex Direct", "VK Ads", "OLV"] : ["VK Ads", "Telegram Ads"],
    territory: territories[i % Math.max(1, territories.length)],
  }));
  return {
    subject: brand ?? `category:${key}`,
    category: key,
    competitors,
    shareOfVoiceHint: "Synthetic estimate — wire to real SOV/мониторинг (Mediascope, Brand Analytics) in production.",
  };
}

function buildGeoAeoAudit(brand: string, market: string) {
  const seed = [...brand].reduce((a, c) => a + c.charCodeAt(0), 0);
  const s = (offset: number) => 35 + ((seed + offset) % 55); // 35..89
  const scores = {
    "Yandex (search + neuro)": s(7),
    "GigaChat (Sber)": s(13),
    "YandexGPT / Alice": s(19),
    ChatGPT: s(29),
  };
  const overall = round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length);
  const recommendations = [
    "Опубликовать структурированные FAQ/Schema.org, чтобы попадать в нейро-ответы Яндекса.",
    "Зарегистрировать и выверить факты о бренде в открытых источниках (RU-википедия, отраслевые каталоги) — это влияет на ответы LLM.",
    "Сформировать корпус «канонических» формулировок о продукте и распространить через PR/контент для цитируемости моделями.",
    "Мониторить, как GigaChat/Alice/ChatGPT отвечают на брендовые запросы, и закрывать фактические пробелы.",
  ];
  return { brand, market, scores, overall, recommendations };
}

function explainMetrics(metrics: Record<string, any>) {
  const entries = Object.entries(metrics).filter(([, v]) => typeof v === "number");
  const anomalies: string[] = [];
  const num = (k: string) => (typeof metrics[k] === "number" ? (metrics[k] as number) : undefined);
  const ctr = num("ctr") ?? num("CTR");
  const cpa = num("cpa") ?? num("CPA");
  const cpm = num("cpm") ?? num("CPM");
  const vtr = num("vtr") ?? num("VTR");
  if (ctr !== undefined && ctr < 0.2) anomalies.push(`Низкий CTR (${ctr}%) — слабый креатив или мискаст таргетинга.`);
  if (ctr !== undefined && ctr > 3) anomalies.push(`Подозрительно высокий CTR (${ctr}%) — проверить на фрод/случайные клики.`);
  if (cpa !== undefined && cpa > 0 && cpm !== undefined && cpm > 0 && cpa > cpm * 20)
    anomalies.push(`CPA (${cpa}) значительно выше нормы относительно CPM — узкое место в воронке после клика.`);
  if (vtr !== undefined && vtr < 30) anomalies.push(`Невысокий VTR (${vtr}%) — пересобрать первые 3 сек видео.`);
  if (anomalies.length === 0) anomalies.push("Явных аномалий не обнаружено по базовым эвристикам.");

  const recommendations = [
    "Перераспределить бюджет в каналы/сегменты с лучшим CPA.",
    "A/B-тест двух новых креативных территорий на слабых плейсментах.",
    "Усилить пост-клик опыт (скорость лендинга, релевантность оффера) для снижения CPA.",
  ];

  return {
    parsedMetrics: Object.fromEntries(entries),
    anomalies,
    recommendations,
  };
}

function channelCraftNotes(channel: string): string[] {
  const c = channel.toLowerCase();
  if (c.includes("telegram")) return ["1 сообщение = 1 мысль", "Сильный первый экран до сворачивания", "CTA-кнопка/ссылка явная"];
  if (c.includes("olv") || c.includes("video")) return ["Бренд в первые 3 сек", "Читаемость без звука (субтитры)", "Версии 6/15/30 сек"];
  if (c.includes("vk")) return ["Вертикаль 9:16 для Clips/Stories", "Нативный тон ленты", "Без перегруза текстом"];
  if (c.includes("yandex") || c.includes("direct") || c.includes("search"))
    return ["Релевантность запросу", "УТП и цена в заголовке", "Быстрые ссылки/уточнения"];
  return ["Адаптировать под формат площадки", "Один ключевой посыл", "Явный призыв к действию"];
}
