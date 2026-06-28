/**
 * AUDIT tool group (v2.15) for NECTARIN Intelligence — Cloudflare Workers.
 *
 *   • marketing_audit — a senior-operator account health audit. Takes the current
 *     per-channel spend & conversions, scores each channel's CPA against RU/CIS
 *     category benchmarks (p25/p50/p75), flags concentration risk and untracked
 *     channels, computes an overall health score + grade, and returns a prioritized
 *     action plan with a projected reallocation impact (extra conversions / saved
 *     budget). Deterministic; data-aware (respects KV / per-tenant overrides).
 *
 * Outputs are decision-support, not legal/financial advice. Benchmarks are mock
 * unless real data is layered into KV.
 */

import { CATEGORIES, PLATFORMS, getCategoryBenchmarks } from "./data.js";
import type { ToolDef, ToolResult } from "./tools.js";

function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function ru(n: number): string {
  try {
    return Number(n).toLocaleString("ru-RU");
  } catch {
    return String(n);
  }
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function toContent(summary: string, payload: unknown): ToolResult {
  return {
    content: [
      { type: "text", text: summary },
      { type: "text", text: "```json\n" + JSON.stringify(payload, null, 2) + "\n```" },
    ],
    structuredContent: isRecord(payload) ? payload : { result: payload },
  };
}

// Map a free-text channel name to a known RU/CIS platform (for benchmark lookup).
const PLATFORM_ALIASES: Array<[RegExp, string]> = [
  [/vk|вконтакте|вк/i, "VK Ads"],
  [/yandex|яндекс|директ|direct/i, "Yandex Direct"],
  [/telegram|телеграм|тг|tg/i, "Telegram Ads"],
  [/olv|видео|youtube|rutube|видеореклам/i, "OLV"],
  [/avito|авито/i, "Avito"],
];
function matchPlatform(name: string): string | null {
  for (const p of PLATFORMS) if (name.trim().toLowerCase() === p.toLowerCase()) return p;
  for (const [re, p] of PLATFORM_ALIASES) if (re.test(name)) return p;
  return null;
}

type Verdict = "below p25" | "p25–p50" | "p50–p75" | "above p75" | "wasteful" | "untracked" | "no benchmark";

function verdictAndScore(cpa: number | null, bm: { p25: number; p50: number; p75: number } | null): {
  verdict: Verdict;
  score: number;
} {
  if (cpa == null) return { verdict: "untracked", score: 30 };
  if (!bm) return { verdict: "no benchmark", score: 60 };
  if (cpa <= bm.p25) return { verdict: "below p25", score: 95 };
  if (cpa <= bm.p50) return { verdict: "p25–p50", score: 80 };
  if (cpa <= bm.p75) return { verdict: "p50–p75", score: 60 };
  if (cpa <= bm.p75 * 1.25) return { verdict: "above p75", score: 40 };
  return { verdict: "wasteful", score: 20 };
}

interface ChannelAudit {
  name: string;
  platformMatched: string | null;
  spend: number;
  sharePct: number;
  conversions: number;
  cpa: number | null;
  benchmarkCpa: { p25: number; p50: number; p75: number } | null;
  verdict: Verdict;
  score: number;
  flags: string[];
}

const marketingAudit: ToolDef = {
  name: "marketing_audit",
  description:
    "Senior-level account health audit. Give the current per-channel spend & conversions for a category and NECTARIN scores each channel's CPA against RU/CIS benchmarks (p25/p50/p75), flags concentration risk (one channel hogging budget) and untracked channels (no conversions), computes an overall health score (0-100) + grade A–D, and returns a PRIORITIZED action plan — including a concrete budget reallocation with projected extra conversions and saved spend. Optional targetCpa compares blended CPA to your business goal. Deterministic; benchmarks are mock unless real data is layered into KV.",
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string", enum: CATEGORIES, description: "Industry category (anchors benchmarks)" },
      channels: {
        type: "array",
        minItems: 1,
        description: "Current spend & conversions per channel (last period). Channel names matched to RU/CIS platforms for benchmarking.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Channel name, e.g. 'VK Ads', 'Yandex Direct', 'Telegram Ads', 'OLV', 'Avito'" },
            spend: { type: "number", minimum: 0, description: "Spend in RUB" },
            conversions: { type: "number", minimum: 0, description: "Conversions (leads/orders) attributed to the channel" },
          },
          required: ["name", "spend", "conversions"],
          additionalProperties: false,
        },
      },
      targetCpa: { type: "number", exclusiveMinimum: 0, description: "Optional business target CPA in RUB to compare blended CPA against" },
    },
    required: ["category", "channels"],
    additionalProperties: false,
  },
  async handler(input) {
    const category = String(input.category);
    const targetCpa = input.targetCpa != null ? Number(input.targetCpa) : null;
    const rawChannels: Array<{ name: string; spend: number; conversions: number }> = Array.isArray(input.channels)
      ? input.channels
      : [];
    if (!rawChannels.length) {
      return { content: [{ type: "text", text: "Ошибка: передай хотя бы один канал в channels." }], isError: true };
    }

    const benchmarks = (await getCategoryBenchmarks(category)) ?? {};
    const totalSpend = rawChannels.reduce((a, c) => a + Math.max(0, Number(c.spend) || 0), 0);
    const totalConv = rawChannels.reduce((a, c) => a + Math.max(0, Number(c.conversions) || 0), 0);

    const channels: ChannelAudit[] = rawChannels.map((c) => {
      const spend = Math.max(0, Number(c.spend) || 0);
      const conversions = Math.max(0, Number(c.conversions) || 0);
      const cpa = conversions > 0 ? round(spend / conversions) : null;
      const platform = matchPlatform(String(c.name ?? ""));
      const bm = platform ? benchmarks[platform]?.CPA ?? null : null;
      const { verdict, score } = verdictAndScore(cpa, bm);
      const flags: string[] = [];
      if (cpa == null) flags.push("Нет конверсий — проверь трекинг или поставь на паузу");
      if (verdict === "wasteful") flags.push("CPA значительно выше p75 — кандидат на срез/переработку");
      if (!platform) flags.push("Канал не сопоставлен с площадкой — бенчмарк недоступен");
      const sharePct = totalSpend > 0 ? round((spend / totalSpend) * 100, 1) : 0;
      if (sharePct > 60) flags.push("Концентрация: >60% бюджета в одном канале");
      return {
        name: String(c.name ?? ""),
        platformMatched: platform,
        spend: round(spend),
        sharePct,
        conversions: round(conversions),
        cpa,
        benchmarkCpa: bm ? { p25: bm.p25, p50: bm.p50, p75: bm.p75 } : null,
        verdict,
        score,
        flags,
      };
    });

    const blendedCpa = totalConv > 0 ? round(totalSpend / totalConv) : null;

    // Spend-weighted health, then penalties.
    let health =
      totalSpend > 0
        ? channels.reduce((a, c) => a + c.score * (c.spend / totalSpend), 0)
        : channels.reduce((a, c) => a + c.score, 0) / channels.length;
    const top = channels.reduce((m, c) => (c.sharePct > m.sharePct ? c : m), channels[0]);
    const concentrationRisk = top.sharePct > 60;
    if (concentrationRisk) health -= 10;
    const wastefulHeavy = channels.some((c) => c.verdict === "wasteful" && c.sharePct >= 20);
    if (wastefulHeavy) health -= 10;
    if (channels.some((c) => c.verdict === "untracked" && c.sharePct >= 15)) health -= 5;
    health = clamp(round(health), 0, 100);
    const grade = health >= 85 ? "A" : health >= 70 ? "B" : health >= 50 ? "C" : "D";

    // ── Findings ──
    const findings: string[] = [];
    if (blendedCpa != null) findings.push(`Сводный blended CPA: ${ru(blendedCpa)} ₽ при общем спенде ${ru(round(totalSpend))} ₽.`);
    if (concentrationRisk) findings.push(`Риск концентрации: «${top.name}» = ${top.sharePct}% бюджета.`);
    const below = channels.filter((c) => c.verdict === "below p25");
    if (below.length) findings.push(`Эффективные каналы (CPA < p25): ${below.map((c) => c.name).join(", ")} — кандидаты на доинвестирование.`);
    const bad = channels.filter((c) => c.verdict === "wasteful" || c.verdict === "above p75");
    if (bad.length) findings.push(`Слабые по CPA: ${bad.map((c) => c.name).join(", ")}.`);
    if (targetCpa != null && blendedCpa != null) {
      findings.push(
        blendedCpa <= targetCpa
          ? `Цель по CPA выполнена: ${ru(blendedCpa)} ≤ ${ru(targetCpa)} ₽.`
          : `Цель по CPA НЕ выполнена: ${ru(blendedCpa)} > ${ru(targetCpa)} ₽ (превышение ${round(((blendedCpa - targetCpa) / targetCpa) * 100, 1)}%).`
      );
    }

    // ── Prioritized recommendations ──
    const recommendations: Array<{ priority: number; action: string; rationale: string; projectedImpact: string }> = [];

    // 1) Reallocation from worst to best (both must have a measurable CPA).
    const measured = channels.filter((c) => c.cpa != null);
    const best = measured
      .filter((c) => c.benchmarkCpa)
      .reduce<ChannelAudit | null>((m, c) => (m == null || (c.cpa as number) < (m.cpa as number) ? c : m), null);
    const worst = measured
      .filter((c) => c.benchmarkCpa && (c.verdict === "wasteful" || c.verdict === "above p75") && c.spend > 0)
      .reduce<ChannelAudit | null>((m, c) => (m == null || (c.cpa as number) > (m.cpa as number) ? c : m), null);
    if (best && worst && best.name !== worst.name) {
      const moveAmt = round(0.2 * worst.spend);
      const addConv = (1 / (best.cpa as number) - 1 / (worst.cpa as number)) * moveAmt;
      if (addConv > 0) {
        recommendations.push({
          priority: 1,
          action: `Перелей ~${ru(moveAmt)} ₽ из «${worst.name}» в «${best.name}».`,
          rationale: `CPA «${worst.name}» = ${ru(worst.cpa as number)} ₽ (выше p75), «${best.name}» = ${ru(best.cpa as number)} ₽ (ниже p25).`,
          projectedImpact: `+~${ru(round(addConv))} конверсий при том же бюджете (≈ ${ru(round(addConv * (best.cpa as number)))} ₽ эквивалентной экономии).`,
        });
      }
    }
    // 2) Concentration.
    if (concentrationRisk) {
      recommendations.push({
        priority: recommendations.length + 1,
        action: `Снизь долю «${top.name}» с ${top.sharePct}% до ≤45–50% и протестируй 1–2 новых канала.`,
        rationale: "Высокая концентрация = хрупкость к изменениям аукциона/политики площадки и упёртый потолок объёма.",
        projectedImpact: "Снижение риска и доступ к дополнительному объёму конверсий вне потолка канала.",
      });
    }
    // 3) Untracked.
    const untracked = channels.filter((c) => c.verdict === "untracked" && c.spend > 0);
    if (untracked.length) {
      recommendations.push({
        priority: recommendations.length + 1,
        action: `Почини атрибуцию или поставь на паузу: ${untracked.map((c) => c.name).join(", ")}.`,
        rationale: `Тратят бюджет (${ru(round(untracked.reduce((a, c) => a + c.spend, 0)))} ₽), но конверсии не фиксируются.`,
        projectedImpact: "Возврат «слепого» бюджета в измеримые каналы или корректная оценка эффективности.",
      });
    }
    if (!recommendations.length) {
      recommendations.push({
        priority: 1,
        action: "Держи курс: структура расходов здоровая — масштабируй лучшие каналы с шагом 10–15%/нед.",
        rationale: "Нет выраженных перекосов по CPA, концентрации или трекингу.",
        projectedImpact: "Плавный рост объёма без роста blended CPA.",
      });
    }

    const payload = {
      category,
      currency: "RUB",
      totalSpend: round(totalSpend),
      totalConversions: round(totalConv),
      blendedCpa,
      targetCpa,
      healthScore: health,
      grade,
      concentration: { topChannel: top.name, sharePct: top.sharePct, risk: concentrationRisk },
      channels,
      findings,
      recommendations,
      disclaimer: "Аудит на mock-бенчмарках RU/CIS (если в KV не загружены реальные данные). Не является юридической/финансовой гарантией.",
    };

    const summary =
      `Аудит маркетинга «${category}»: health ${health}/100 (${grade}). ` +
      (blendedCpa != null ? `Blended CPA ${ru(blendedCpa)} ₽, спенд ${ru(round(totalSpend))} ₽. ` : `Спенд ${ru(round(totalSpend))} ₽. `) +
      `${recommendations.length} приоритетных рекомендаций` +
      (concentrationRisk ? `; ⚠ концентрация в «${top.name}» (${top.sharePct}%).` : ".");

    return toContent(summary, payload);
  },
};

export const AUDIT_TOOLS: ToolDef[] = [marketingAudit];
