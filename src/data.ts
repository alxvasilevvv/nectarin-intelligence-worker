/**
 * Data access layer for NECTARIN Intelligence — Cloudflare Workers edition.
 *
 * MOCK / SYNTHETIC DATA, bundled inline as plain TS objects so the Worker has
 * NO filesystem / DB dependency in v1 (Workers has no `node:fs`). The values are
 * ported verbatim from the reference Node/TS server's src/data/*.json.
 *
 * To go to REAL data later, install a different `DataSource` implementation
 * (see the `DataSource` interface and the `KvDataSource`/`HttpDataSource` stubs
 * near the bottom of this file) via `setDataSource(...)`. The module-level
 * accessor functions (`getMetric`, `getCategoryBenchmarks`, `getPlaybook`,
 * `getSuppliers`) delegate to the active data source, so nothing upstream changes
 * — swapping mock → real is a one-line wiring change in `src/index.ts`.
 *
 * See DATA_SCHEMA.md for the EXACT tables/collections, columns, types, example
 * rows, and which tool consumes each — that is the contract NECTARIN must satisfy
 * to go live.
 */

// ── Types ────────────────────────────────────────────────────────────────

export type Kpi = "CPM" | "CTR" | "CPA" | "VTR";
export type Platform = "VK Ads" | "Yandex Direct" | "Telegram Ads" | "OLV" | "Avito";
export type Category = "realty" | "pharma" | "fmcg" | "retail" | "auto" | "finance" | "ecom" | "edtech";

export interface MetricRange {
  p25: number;
  p50: number;
  p75: number;
}

export type PlatformMetrics = Record<Kpi, MetricRange>;

export interface Supplier {
  id: string;
  name: string;
  platform: Platform;
  format: string;
  qualityScore: number;
  fraudRisk: "low" | "medium" | "high";
  viewability: number;
  humanTraffic: number;
  categoriesStrong: string[];
}

export interface Playbook {
  industry: string;
  regulated?: boolean;
  territories: string[];
  dos: string[];
  donts: string[];
  seasonalHooks: string[];
  complianceNotes: string[];
}

// ── Convenience constants ──────────────────────────────────────────────────

export const PLATFORMS: Platform[] = ["VK Ads", "Yandex Direct", "Telegram Ads", "OLV", "Avito"];
export const CATEGORIES: Category[] = ["realty", "pharma", "fmcg", "retail", "auto", "finance", "ecom", "edtech"];
export const KPIS: Kpi[] = ["CPM", "CTR", "CPA", "VTR"];

export const DATA_META = {
  note:
    "MOCK / SYNTHETIC DATA. Plausible RU/CIS ranges in RUB. Replace with NECTARIN's real aggregated benchmarks via a KV/D1 adapter. Do not treat as real proprietary figures.",
  currency: "RUB",
  region: "RU/CIS",
  lastUpdated: "2026-Q2",
  /**
   * Provenance block surfaced to clients so every number is auditable. Honest by
   * design: the bundled values are synthetic. When a real DataSource is wired
   * (KV/D1/HTTP), it should overwrite `source`, `asOf`, `sampleSize` and set
   * `synthetic: false`.
   */
  provenance: {
    source: "NECTARIN synthetic baseline (bundled)",
    methodology:
      "Plausible RU/CIS ranges expressed as p25/p50/p75 per category × platform × KPI. " +
      "Confidence band ≈ [p25, p75] (interquartile). Point estimate = p50 (median).",
    sampleSize: null as number | null,
    asOf: "2026-Q2",
    synthetic: true,
    confidenceNote:
      "Treat p50 as the planning point and [p25, p75] as the realistic spread. " +
      "Replace with NECTARIN's aggregated data for production-grade confidence.",
  },
};

// ── Seasonality (monthly demand index, mean ≈ 1.0) ─────────────────────────
// Index >1 = above-average demand/competition that month; <1 = softer. Used by
// `seasonality_forecast` to time spend. Months are Jan..Dec (index 0..11).

const SEASONALITY: Record<string, number[]> = {
  realty:  [1.10, 1.05, 1.15, 1.00, 1.05, 0.95, 0.80, 0.85, 1.05, 1.00, 1.05, 0.95],
  pharma:  [1.20, 1.15, 1.00, 1.10, 1.10, 0.90, 0.85, 0.85, 0.95, 1.10, 1.15, 1.20],
  fmcg:    [0.90, 1.05, 1.10, 0.95, 1.05, 1.05, 1.05, 1.00, 1.05, 0.95, 1.00, 1.25],
  retail:  [1.00, 0.90, 0.95, 0.90, 0.95, 0.95, 0.95, 1.10, 1.05, 1.00, 1.30, 1.25],
  auto:    [0.90, 0.95, 1.10, 1.10, 1.10, 1.00, 0.90, 0.90, 1.05, 1.05, 1.05, 1.10],
  finance: [1.15, 1.00, 1.10, 1.10, 0.95, 0.90, 0.90, 0.95, 1.05, 1.00, 1.00, 1.20],
  ecom:    [0.95, 0.95, 1.00, 0.90, 0.95, 0.90, 0.90, 1.00, 1.05, 1.05, 1.40, 1.25],
  edtech:  [1.20, 1.00, 0.95, 0.95, 1.05, 1.00, 0.85, 0.90, 1.30, 1.00, 1.05, 0.95],
};

export const MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

/** Monthly demand index (length 12, Jan..Dec) for a category, or undefined. */
export function getSeasonalityIndex(category: string): number[] | undefined {
  return SEASONALITY[category];
}

// ── Benchmarks (category × platform × KPI → p25/p50/p75) ───────────────────

const BENCHMARKS: Record<string, Record<string, PlatformMetrics>> = {
  realty: {
    "VK Ads": { CPM: { p25: 210, p50: 320, p75: 480 }, CTR: { p25: 0.45, p50: 0.8, p75: 1.3 }, CPA: { p25: 2400, p50: 4100, p75: 6900 }, VTR: { p25: 14, p50: 22, p75: 33 } },
    "Yandex Direct": { CPM: { p25: 260, p50: 410, p75: 620 }, CTR: { p25: 0.6, p50: 1.1, p75: 1.9 }, CPA: { p25: 1900, p50: 3300, p75: 5800 }, VTR: { p25: 16, p50: 24, p75: 36 } },
    "Telegram Ads": { CPM: { p25: 180, p50: 280, p75: 430 }, CTR: { p25: 0.35, p50: 0.65, p75: 1.05 }, CPA: { p25: 2800, p50: 4700, p75: 7600 }, VTR: { p25: 10, p50: 17, p75: 26 } },
    OLV: { CPM: { p25: 290, p50: 430, p75: 640 }, CTR: { p25: 0.1, p50: 0.25, p75: 0.45 }, CPA: { p25: 5200, p50: 8100, p75: 12800 }, VTR: { p25: 45, p50: 62, p75: 78 } },
    Avito: { CPM: { p25: 200, p50: 300, p75: 450 }, CTR: { p25: 0.9, p50: 1.5, p75: 2.4 }, CPA: { p25: 1700, p50: 2900, p75: 5000 }, VTR: { p25: 4, p50: 8, p75: 14 } },
  },
  pharma: {
    "VK Ads": { CPM: { p25: 170, p50: 260, p75: 390 }, CTR: { p25: 0.4, p50: 0.75, p75: 1.2 }, CPA: { p25: 600, p50: 1100, p75: 1900 }, VTR: { p25: 13, p50: 21, p75: 31 } },
    "Yandex Direct": { CPM: { p25: 210, p50: 320, p75: 470 }, CTR: { p25: 0.55, p50: 0.95, p75: 1.6 }, CPA: { p25: 500, p50: 900, p75: 1600 }, VTR: { p25: 15, p50: 23, p75: 34 } },
    "Telegram Ads": { CPM: { p25: 150, p50: 230, p75: 350 }, CTR: { p25: 0.3, p50: 0.55, p75: 0.9 }, CPA: { p25: 750, p50: 1300, p75: 2200 }, VTR: { p25: 9, p50: 16, p75: 24 } },
    OLV: { CPM: { p25: 240, p50: 360, p75: 530 }, CTR: { p25: 0.08, p50: 0.2, p75: 0.38 }, CPA: { p25: 1400, p50: 2300, p75: 3800 }, VTR: { p25: 48, p50: 65, p75: 80 } },
  },
  fmcg: {
    "VK Ads": { CPM: { p25: 130, p50: 200, p75: 300 }, CTR: { p25: 0.5, p50: 0.9, p75: 1.45 }, CPA: { p25: 220, p50: 410, p75: 720 }, VTR: { p25: 16, p50: 25, p75: 37 } },
    "Yandex Direct": { CPM: { p25: 160, p50: 250, p75: 380 }, CTR: { p25: 0.6, p50: 1.05, p75: 1.75 }, CPA: { p25: 190, p50: 350, p75: 620 }, VTR: { p25: 18, p50: 27, p75: 39 } },
    "Telegram Ads": { CPM: { p25: 110, p50: 175, p75: 270 }, CTR: { p25: 0.4, p50: 0.7, p75: 1.15 }, CPA: { p25: 260, p50: 470, p75: 820 }, VTR: { p25: 11, p50: 19, p75: 28 } },
    OLV: { CPM: { p25: 200, p50: 300, p75: 450 }, CTR: { p25: 0.12, p50: 0.28, p75: 0.5 }, CPA: { p25: 520, p50: 880, p75: 1500 }, VTR: { p25: 52, p50: 68, p75: 83 } },
  },
  retail: {
    "VK Ads": { CPM: { p25: 150, p50: 230, p75: 350 }, CTR: { p25: 0.55, p50: 0.95, p75: 1.55 }, CPA: { p25: 320, p50: 560, p75: 980 }, VTR: { p25: 15, p50: 24, p75: 35 } },
    "Yandex Direct": { CPM: { p25: 180, p50: 280, p75: 420 }, CTR: { p25: 0.7, p50: 1.2, p75: 2.0 }, CPA: { p25: 270, p50: 480, p75: 850 }, VTR: { p25: 17, p50: 26, p75: 38 } },
    "Telegram Ads": { CPM: { p25: 120, p50: 190, p75: 290 }, CTR: { p25: 0.45, p50: 0.8, p75: 1.3 }, CPA: { p25: 380, p50: 650, p75: 1100 }, VTR: { p25: 12, p50: 20, p75: 30 } },
    OLV: { CPM: { p25: 220, p50: 330, p75: 490 }, CTR: { p25: 0.11, p50: 0.26, p75: 0.47 }, CPA: { p25: 700, p50: 1200, p75: 2000 }, VTR: { p25: 50, p50: 66, p75: 81 } },
    Avito: { CPM: { p25: 140, p50: 210, p75: 320 }, CTR: { p25: 0.8, p50: 1.4, p75: 2.2 }, CPA: { p25: 300, p50: 520, p75: 900 }, VTR: { p25: 4, p50: 8, p75: 14 } },
  },
  auto: {
    "VK Ads": { CPM: { p25: 230, p50: 350, p75: 520 }, CTR: { p25: 0.4, p50: 0.75, p75: 1.25 }, CPA: { p25: 3200, p50: 5400, p75: 9100 }, VTR: { p25: 15, p50: 23, p75: 34 } },
    "Yandex Direct": { CPM: { p25: 280, p50: 440, p75: 660 }, CTR: { p25: 0.55, p50: 1.0, p75: 1.7 }, CPA: { p25: 2700, p50: 4500, p75: 7700 }, VTR: { p25: 17, p50: 25, p75: 37 } },
    "Telegram Ads": { CPM: { p25: 200, p50: 310, p75: 470 }, CTR: { p25: 0.32, p50: 0.58, p75: 0.95 }, CPA: { p25: 3800, p50: 6200, p75: 10400 }, VTR: { p25: 11, p50: 18, p75: 27 } },
    OLV: { CPM: { p25: 310, p50: 470, p75: 700 }, CTR: { p25: 0.1, p50: 0.24, p75: 0.44 }, CPA: { p25: 6800, p50: 11000, p75: 17500 }, VTR: { p25: 47, p50: 64, p75: 79 } },
    Avito: { CPM: { p25: 220, p50: 330, p75: 500 }, CTR: { p25: 0.8, p50: 1.4, p75: 2.2 }, CPA: { p25: 2400, p50: 4000, p75: 6900 }, VTR: { p25: 4, p50: 8, p75: 14 } },
  },
  finance: {
    "VK Ads": { CPM: { p25: 240, p50: 370, p75: 560 }, CTR: { p25: 0.38, p50: 0.7, p75: 1.15 }, CPA: { p25: 1800, p50: 3100, p75: 5400 }, VTR: { p25: 13, p50: 21, p75: 32 } },
    "Yandex Direct": { CPM: { p25: 300, p50: 460, p75: 690 }, CTR: { p25: 0.5, p50: 0.92, p75: 1.55 }, CPA: { p25: 1500, p50: 2600, p75: 4700 }, VTR: { p25: 15, p50: 23, p75: 35 } },
    "Telegram Ads": { CPM: { p25: 210, p50: 330, p75: 500 }, CTR: { p25: 0.3, p50: 0.55, p75: 0.9 }, CPA: { p25: 2100, p50: 3600, p75: 6200 }, VTR: { p25: 10, p50: 17, p75: 26 } },
    OLV: { CPM: { p25: 330, p50: 500, p75: 750 }, CTR: { p25: 0.09, p50: 0.22, p75: 0.41 }, CPA: { p25: 4200, p50: 7000, p75: 11800 }, VTR: { p25: 46, p50: 63, p75: 78 } },
  },
  ecom: {
    "VK Ads": { CPM: { p25: 140, p50: 215, p75: 330 }, CTR: { p25: 0.6, p50: 1.05, p75: 1.7 }, CPA: { p25: 280, p50: 500, p75: 880 }, VTR: { p25: 16, p50: 25, p75: 37 } },
    "Yandex Direct": { CPM: { p25: 175, p50: 270, p75: 410 }, CTR: { p25: 0.75, p50: 1.3, p75: 2.1 }, CPA: { p25: 230, p50: 420, p75: 740 }, VTR: { p25: 18, p50: 27, p75: 39 } },
    "Telegram Ads": { CPM: { p25: 115, p50: 185, p75: 285 }, CTR: { p25: 0.45, p50: 0.85, p75: 1.4 }, CPA: { p25: 330, p50: 580, p75: 1000 }, VTR: { p25: 12, p50: 20, p75: 30 } },
    OLV: { CPM: { p25: 210, p50: 320, p75: 480 }, CTR: { p25: 0.12, p50: 0.27, p75: 0.49 }, CPA: { p25: 650, p50: 1100, p75: 1900 }, VTR: { p25: 51, p50: 67, p75: 82 } },
    Avito: { CPM: { p25: 130, p50: 200, p75: 310 }, CTR: { p25: 0.85, p50: 1.5, p75: 2.3 }, CPA: { p25: 260, p50: 460, p75: 820 }, VTR: { p25: 4, p50: 8, p75: 14 } },
  },
  edtech: {
    "VK Ads": { CPM: { p25: 160, p50: 245, p75: 370 }, CTR: { p25: 0.5, p50: 0.9, p75: 1.45 }, CPA: { p25: 700, p50: 1250, p75: 2200 }, VTR: { p25: 15, p50: 24, p75: 35 } },
    "Yandex Direct": { CPM: { p25: 200, p50: 305, p75: 460 }, CTR: { p25: 0.62, p50: 1.1, p75: 1.85 }, CPA: { p25: 600, p50: 1050, p75: 1850 }, VTR: { p25: 17, p50: 26, p75: 38 } },
    "Telegram Ads": { CPM: { p25: 140, p50: 220, p75: 340 }, CTR: { p25: 0.4, p50: 0.72, p75: 1.2 }, CPA: { p25: 800, p50: 1400, p75: 2500 }, VTR: { p25: 11, p50: 19, p75: 28 } },
    OLV: { CPM: { p25: 230, p50: 350, p75: 520 }, CTR: { p25: 0.1, p50: 0.24, p75: 0.44 }, CPA: { p25: 1500, p50: 2500, p75: 4300 }, VTR: { p25: 49, p50: 65, p75: 80 } },
  },
};

// ── Suppliers (inventory quality index) ────────────────────────────────────

const SUPPLIERS: Supplier[] = [
  { id: "sup-vk-feed", name: "VK Ads — Feed", platform: "VK Ads", format: "in-feed native", qualityScore: 88, fraudRisk: "low", viewability: 0.71, humanTraffic: 0.96, categoriesStrong: ["fmcg", "retail", "realty"] },
  { id: "sup-vk-stories", name: "VK Ads — Clips/Stories", platform: "VK Ads", format: "vertical video", qualityScore: 84, fraudRisk: "low", viewability: 0.79, humanTraffic: 0.95, categoriesStrong: ["fmcg", "retail", "auto"] },
  { id: "sup-yd-search", name: "Yandex Direct — Search", platform: "Yandex Direct", format: "search text", qualityScore: 93, fraudRisk: "low", viewability: 0.99, humanTraffic: 0.98, categoriesStrong: ["finance", "realty", "auto", "pharma"] },
  { id: "sup-yd-rsy", name: "Yandex Direct — RSY/РСЯ", platform: "Yandex Direct", format: "display network", qualityScore: 74, fraudRisk: "medium", viewability: 0.58, humanTraffic: 0.89, categoriesStrong: ["retail", "fmcg"] },
  { id: "sup-yd-olv", name: "Yandex — OLV/VideoNet", platform: "OLV", format: "instream video", qualityScore: 81, fraudRisk: "low", viewability: 0.83, humanTraffic: 0.94, categoriesStrong: ["fmcg", "auto", "finance"] },
  { id: "sup-tg-channels", name: "Telegram Ads — Channels", platform: "Telegram Ads", format: "channel post", qualityScore: 79, fraudRisk: "medium", viewability: 0.64, humanTraffic: 0.91, categoriesStrong: ["finance", "retail", "auto"] },
  { id: "sup-tg-premium", name: "Telegram — Premium Inv.", platform: "Telegram Ads", format: "channel post", qualityScore: 86, fraudRisk: "low", viewability: 0.72, humanTraffic: 0.95, categoriesStrong: ["finance", "realty"] },
  { id: "sup-olv-rutube", name: "RuTube — OLV", platform: "OLV", format: "instream video", qualityScore: 70, fraudRisk: "medium", viewability: 0.69, humanTraffic: 0.88, categoriesStrong: ["fmcg", "retail"] },
  { id: "sup-olv-vkvideo", name: "VK Video — OLV", platform: "OLV", format: "instream video", qualityScore: 82, fraudRisk: "low", viewability: 0.8, humanTraffic: 0.94, categoriesStrong: ["fmcg", "auto", "retail"] },
  { id: "sup-prog-ssp-a", name: "Programmatic SSP-A", platform: "OLV", format: "display/video mix", qualityScore: 61, fraudRisk: "high", viewability: 0.49, humanTraffic: 0.78, categoriesStrong: ["retail"] },
  { id: "sup-prog-ssp-b", name: "Programmatic SSP-B", platform: "VK Ads", format: "display network", qualityScore: 66, fraudRisk: "medium", viewability: 0.55, humanTraffic: 0.84, categoriesStrong: ["fmcg", "retail"] },
  { id: "sup-tg-gray", name: "TG Gray-list Channels", platform: "Telegram Ads", format: "channel post", qualityScore: 42, fraudRisk: "high", viewability: 0.38, humanTraffic: 0.61, categoriesStrong: [] },
  { id: "sup-yd-dzen", name: "Yandex Dzen — Native", platform: "Yandex Direct", format: "in-feed native", qualityScore: 77, fraudRisk: "low", viewability: 0.66, humanTraffic: 0.93, categoriesStrong: ["realty", "auto", "finance"] },
  { id: "sup-vk-myreklama", name: "VK myTarget Legacy", platform: "VK Ads", format: "display network", qualityScore: 68, fraudRisk: "medium", viewability: 0.57, humanTraffic: 0.87, categoriesStrong: ["fmcg", "retail"] },
  { id: "sup-olv-okru", name: "OK.ru — OLV", platform: "OLV", format: "instream video", qualityScore: 75, fraudRisk: "low", viewability: 0.74, humanTraffic: 0.92, categoriesStrong: ["fmcg", "pharma"] },
  { id: "sup-yd-search-brand", name: "Yandex Direct — Brand", platform: "Yandex Direct", format: "search text", qualityScore: 95, fraudRisk: "low", viewability: 0.99, humanTraffic: 0.99, categoriesStrong: ["finance", "auto", "realty", "retail"] },
  { id: "sup-tg-pharma", name: "Telegram — Health Channels", platform: "Telegram Ads", format: "channel post", qualityScore: 80, fraudRisk: "low", viewability: 0.67, humanTraffic: 0.93, categoriesStrong: ["pharma", "fmcg"] },
  { id: "sup-vk-auto", name: "VK Ads — Auto Communities", platform: "VK Ads", format: "in-feed native", qualityScore: 83, fraudRisk: "low", viewability: 0.7, humanTraffic: 0.94, categoriesStrong: ["auto", "finance"] },
  { id: "sup-prog-ssp-c", name: "Programmatic SSP-C", platform: "OLV", format: "display/video mix", qualityScore: 58, fraudRisk: "high", viewability: 0.46, humanTraffic: 0.74, categoriesStrong: [] },
  { id: "sup-avito-promo", name: "Avito — Промо-размещения", platform: "Avito", format: "listing promo", qualityScore: 90, fraudRisk: "low", viewability: 0.92, humanTraffic: 0.97, categoriesStrong: ["realty", "auto", "retail", "ecom"] },
  { id: "sup-avito-display", name: "Avito — Медийная реклама", platform: "Avito", format: "in-feed native", qualityScore: 84, fraudRisk: "low", viewability: 0.75, humanTraffic: 0.95, categoriesStrong: ["realty", "auto", "ecom"] },
];

// ── Playbooks (category go-to-market) ──────────────────────────────────────

const PLAYBOOKS: Record<string, Playbook> = {
  realty: {
    industry: "realty",
    territories: ["Образ жизни / новый дом", "Инвестиция в будущее", "Локация и инфраструктура", "Семейный сценарий"],
    dos: ["Показывать планировки и видовые характеристики", "Подчёркивать ипотечные программы и господдержку", "Использовать гео-таргетинг по районам и конкурентам"],
    donts: ["Не обещать гарантированную доходность без оговорок", "Не использовать слово «лучший» без подтверждения (ФАС)", "Не скрывать застройщика и проектную декларацию"],
    seasonalHooks: ["Январь-март: ипотечные акции после праздников", "Май: дачный/загородный спрос", "Сентябрь: деловой сезон, B2B-инвесторы", "Ноябрь: предновогодние скидки застройщиков"],
    complianceNotes: ["Указывать проектную декларацию и эскроу-счета (214-ФЗ)", "Маркировка рекламы ОРД/ЕРИР обязательна", "Избегать недостоверных сравнений (ФЗ «О рекламе»)"],
  },
  pharma: {
    industry: "pharma",
    regulated: true,
    territories: ["Забота о себе и близких", "Доверие и доказательность", "Быстрое облегчение", "Профилактика и образ жизни"],
    dos: ["Сопровождать рекламу обязательным предупреждением", "Опираться на инструкцию и показания", "Разделять Rx и OTC сценарии коммуникации"],
    donts: ["Не гарантировать излечение или 100% эффект", "Не обращаться к несовершеннолетним", "Не создавать впечатление ненужности визита к врачу", "Не рекламировать рецептурные препараты для широкой аудитории"],
    seasonalHooks: ["Октябрь-февраль: сезон простуд и иммунитет", "Апрель-май: аллергия", "Июнь-август: солнцезащита, ЖКТ/путешествия"],
    complianceNotes: ["ОБЯЗАТЕЛЬНО предупреждение о противопоказаниях и необходимости консультации специалиста (ст. 24 ФЗ «О рекламе»)", "Реклама рецептурных ЛП — только спец-площадки для медработников", "Маркировка ОРД/ЕРИР", "Согласование креативов с юристом/регуляторным контролем ДО запуска"],
  },
  fmcg: {
    industry: "fmcg",
    territories: ["Ежедневный ритуал", "Вкус и удовольствие", "Семья и забота", "Цена/ценность и промо"],
    dos: ["Высокочастотный охватный сплит (OLV + соцсети)", "Привязка к промо в ритейле и маркетплейсах", "Короткие вертикальные видео под Clips/Stories"],
    donts: ["Не перегружать сообщение характеристиками", "Не игнорировать сезонность спроса", "Не злоупотреблять health-claims на продуктах питания"],
    seasonalHooks: ["Декабрь: новогодние подарочные наборы", "Февраль-март: 23 февраля и 8 марта", "Май-август: сезон напитков/мороженого", "Сентябрь: «снова в школу»"],
    complianceNotes: ["Маркировка рекламы ОРД/ЕРИР", "Корректные нутри-заявления", "Алкоголь/табак — отдельные жёсткие ограничения (не запускать без юр-проверки)"],
  },
  retail: {
    industry: "retail",
    territories: ["Выгода и экономия", "Ассортимент и доступность", "Скорость доставки", "Сезонные распродажи"],
    dos: ["Перформанс + ретаргетинг по корзинам", "Интеграция фида товаров (Yandex Direct)", "Связка с маркетплейсами и геолокацией ПВЗ"],
    donts: ["Не указывать неактуальные цены/остатки", "Не обещать скидки без реальной базы цены (ФАС)", "Не игнорировать мобильный сценарий"],
    seasonalHooks: ["11.11 / 12.12 распродажи", "Чёрная пятница (ноябрь)", "Январь: ликвидация остатков", "Август-сентябрь: школьный сезон"],
    complianceNotes: ["Маркировка ОРД/ЕРИР", "Достоверность цен и условий акций", "Корректные условия рассрочки/кредита (если есть — см. finance)"],
  },
  auto: {
    industry: "auto",
    territories: ["Статус и технологичность", "Безопасность семьи", "Выгодная покупка/трейд-ин", "Сервис и владение"],
    dos: ["Связка охват (OLV) + лидген (Search/Direct)", "Гео по дилерским зонам", "Тест-драйв как ключевой CTA"],
    donts: ["Не публиковать неактуальные комплектации/цены", "Не обещать кредитные условия без раскрытия ПСК", "Не использовать непроверенные сравнения мощности/расхода"],
    seasonalHooks: ["Март-май: весенний спрос", "Сентябрь-ноябрь: смена модельного года, склады", "Декабрь: годовые скидки и трейд-ин"],
    complianceNotes: ["Маркировка ОРД/ЕРИР", "Раскрытие условий кредита/лизинга (см. finance)", "Достоверность ТТХ"],
  },
  finance: {
    industry: "finance",
    regulated: true,
    territories: ["Контроль и безопасность денег", "Рост капитала", "Удобство и скорость", "Доверие к бренду банка"],
    dos: ["Раскрывать полную стоимость кредита (ПСК) и ставки", "Сегментировать по продуктам (вклады, кредиты, карты, инвестиции)", "Делать акцент на лицензии и надёжности"],
    donts: ["Не указывать только минимальную ставку без диапазона/условий", "Не гарантировать доходность инвестиционных продуктов", "Не использовать давление/срочность, вводящие в заблуждение"],
    seasonalHooks: ["Декабрь-январь: вклады под высокую ставку", "Март-апрель: налоговый вычет/ИИС", "Сентябрь: деловой сезон, кредитование бизнеса"],
    complianceNotes: ["ОБЯЗАТЕЛЬНО раскрытие существенных условий и ПСК (ФЗ «О рекламе», ФЗ «О потребкредите»)", "Указание лицензии ЦБ РФ где применимо", "Инвест-продукты — дисклеймер о рисках, без гарантий доходности", "Маркировка ОРД/ЕРИР", "Юр-согласование ДО запуска"],
  },
  ecom: {
    industry: "ecom",
    territories: ["Выгода и скидки", "Скорость доставки", "Широкий ассортимент", "Доверие и отзывы"],
    dos: ["Перформанс + динамический ретаргетинг по товарному фиду", "Интеграция с маркетплейсами (Ozon/WB) и Avito", "Промо-механики (купоны, бандлы) под событийные пики"],
    donts: ["Не показывать неактуальные цены/остатки", "Не обещать скидку без реальной базовой цены (ФАС)", "Не игнорировать мобильный и быстрый чек-аут"],
    seasonalHooks: ["11.11 / 12.12 распродажи", "Чёрная пятница (ноябрь)", "Новогодние подарки (декабрь)", "Гендерные праздники (февраль-март)"],
    complianceNotes: ["Маркировка ОРД/ЕРИР", "Достоверность цен/акций и наличия", "Корректные условия рассрочки/кредита (см. finance)"],
  },
  edtech: {
    industry: "edtech",
    territories: ["Карьерный рост и доход", "Новая профессия с нуля", "Гибкий формат обучения", "Результат и трудоустройство"],
    dos: ["Лидген на вебинары/бесплатные уроки как верх воронки", "Прогрев через контент и email/Telegram", "Социальное доказательство: кейсы выпускников"],
    donts: ["Не гарантировать трудоустройство/доход без оговорок (ФАС)", "Не использовать поддельные отзывы", "Не давить ложной срочностью на скидки"],
    seasonalHooks: ["Сентябрь: «учебный год», старт потоков", "Январь: цели на новый год", "Май-июнь: подготовка к карьерным изменениям", "Ноябрь: распродажи курсов"],
    complianceNotes: ["Маркировка ОРД/ЕРИР", "При наличии лицензии — корректно указывать образовательную лицензию", "Достоверность обещаний о результате/доходе"],
  },
};

// ── DataSource interface (the swap seam) ───────────────────────────────────
//
// Every tool reads data ONLY through this interface. The default is
// `MockDataSource` (the synthetic objects above). To go live, implement this
// against KV / D1 / an internal HTTP API and call `setDataSource(...)` once at
// the top of `fetch()` in src/index.ts. The method SHAPES are stable, so no
// upstream tool/orchestrator code changes.
//
// Methods are synchronous-or-async (return T | Promise<T>) so both an inline
// implementation and a network/KV implementation satisfy the contract; callers
// `await` them. See DATA_SCHEMA.md for the exact backing schema each method needs.

export interface DataSource {
  /** Metric range for category × platform × KPI (consumed by ru_benchmarks, media_plan, roi_calculator, value_forecast). */
  getMetric(category: string, platform: string, kpi: Kpi): Maybe<MetricRange | undefined>;
  /** All platform metrics for a category (media_plan, roi_calculator, value_forecast). */
  getCategoryBenchmarks(category: string): Maybe<Record<string, PlatformMetrics> | undefined>;
  /** Category go-to-market playbook (category_playbook, media_plan, creative_brief compliance). */
  getPlaybook(industry: string): Maybe<Playbook | undefined>;
  /** Inventory / supplier quality rows (supplier_quality). */
  getSuppliers(): Maybe<Supplier[]>;
}

type Maybe<T> = T | Promise<T>;

/** Default, dependency-free implementation backed by the inline synthetic data. */
export class MockDataSource implements DataSource {
  getMetric(category: string, platform: string, kpi: Kpi): MetricRange | undefined {
    return BENCHMARKS[category]?.[platform]?.[kpi];
  }
  getCategoryBenchmarks(category: string): Record<string, PlatformMetrics> | undefined {
    return BENCHMARKS[category];
  }
  getPlaybook(industry: string): Playbook | undefined {
    return PLAYBOOKS[industry];
  }
  getSuppliers(): Supplier[] {
    return SUPPLIERS;
  }
}

// Active data source (swap with setDataSource()). Defaults to mock.
let activeDataSource: DataSource = new MockDataSource();

/** Install a different DataSource (KV/HTTP/D1) — the ONE wiring change to go live. */
export function setDataSource(ds: DataSource): void {
  activeDataSource = ds;
}

export function getDataSource(): DataSource {
  return activeDataSource;
}

// ── Module-level accessors (shape-identical to the Node version) ────────────
// These delegate to the active DataSource. They are async now (return Promise)
// so a network/KV-backed source works unchanged; the orchestrator already
// `await`s them.

/** Returns the metric range for a category × platform × KPI, or undefined. */
export async function getMetric(category: string, platform: string, kpi: Kpi): Promise<MetricRange | undefined> {
  return activeDataSource.getMetric(category, platform, kpi);
}

/** All platform metrics for a category (used by media planning). */
export async function getCategoryBenchmarks(category: string): Promise<Record<string, PlatformMetrics> | undefined> {
  return activeDataSource.getCategoryBenchmarks(category);
}

export async function getPlaybook(industry: string): Promise<Playbook | undefined> {
  return activeDataSource.getPlaybook(industry);
}

export async function getSuppliers(): Promise<Supplier[]> {
  return activeDataSource.getSuppliers();
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION DATA SOURCES (stubs) — implement one of these, then in src/index.ts
// `fetch()` call e.g. `setDataSource(new KvDataSource(env.NECTARIN_KV))`. See
// DATA_SCHEMA.md for the exact key/column layout each method expects.
// ─────────────────────────────────────────────────────────────────────────────

/*
// KV-backed source. Keys (see DATA_SCHEMA.md):
//   benchmarks:<category>                → JSON Record<platform, PlatformMetrics>
//   playbook:<industry>                  → JSON Playbook
//   suppliers                            → JSON Supplier[]
export class KvDataSource implements DataSource {
  constructor(private kv: KVNamespace) {}
  async getCategoryBenchmarks(category: string) {
    return (await this.kv.get(`benchmarks:${category}`, "json")) as
      | Record<string, PlatformMetrics>
      | undefined ?? undefined;
  }
  async getMetric(category: string, platform: string, kpi: Kpi) {
    const bm = await this.getCategoryBenchmarks(category);
    return bm?.[platform]?.[kpi];
  }
  async getPlaybook(industry: string) {
    return (await this.kv.get(`playbook:${industry}`, "json")) as Playbook | undefined ?? undefined;
  }
  async getSuppliers() {
    return ((await this.kv.get("suppliers", "json")) as Supplier[] | null) ?? [];
  }
}

// HTTP-backed source. Points at NECTARIN's internal benchmarks API. Add the base
// URL + a `wrangler secret put NECTARIN_DATA_API_KEY` for auth. Endpoints (see
// DATA_SCHEMA.md): GET /benchmarks/:category, /playbooks/:industry, /suppliers.
export class HttpDataSource implements DataSource {
  constructor(private baseUrl: string, private apiKey: string) {}
  private async get<T>(path: string): Promise<T | undefined> {
    const r = await fetch(`${this.baseUrl}${path}`, {
      headers: { authorization: `Bearer ${this.apiKey}` },
    });
    if (!r.ok) return undefined;
    return (await r.json()) as T;
  }
  async getCategoryBenchmarks(category: string) {
    return this.get<Record<string, PlatformMetrics>>(`/benchmarks/${encodeURIComponent(category)}`);
  }
  async getMetric(category: string, platform: string, kpi: Kpi) {
    const bm = await this.getCategoryBenchmarks(category);
    return bm?.[platform]?.[kpi];
  }
  async getPlaybook(industry: string) {
    return this.get<Playbook>(`/playbooks/${encodeURIComponent(industry)}`);
  }
  async getSuppliers() {
    return (await this.get<Supplier[]>(`/suppliers`)) ?? [];
  }
}
*/
