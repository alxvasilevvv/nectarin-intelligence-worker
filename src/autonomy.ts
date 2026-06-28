/**
 * OPS & AUTONOMY tool group (v2.56) for NECTARIN Intelligence — Workers.
 *
 *   • kpi_alert_engine — the first "autonomy" brick: a cross-KPI, rule-based alert engine.
 *     Each KPI (value vs target/benchmark + direction) is graded ok/warning/critical and,
 *     on breach, mapped to a recommended action AND the NECTARIN tool to run next. Turns a
 *     dashboard into a prioritized to-do list (anomaly → action), deterministically.
 *   • marketing_budget_allocator — CMO annual-budget split ACROSS FUNCTIONS (brand, demand,
 *     retention/CRM, content/SEO, martech, team/ops) — not media channels (that's
 *     budget_optimizer). Adjusts benchmark splits by goal/business type and adds guardrails.
 *
 * Deterministic rules on YOUR inputs — planning support, not a guarantee.
 */

import type { ToolDef, ToolResult } from "./tools.js";

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
function errResult(message: string, extra?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: message, ...(extra ?? {}) },
    isError: true,
  };
}
function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
function ru(n: number): string {
  try {
    return Math.round(n).toLocaleString("ru-RU");
  } catch {
    return String(Math.round(n));
  }
}

// ── 1. KPI alert engine (autonomy brick) ─────────────────────────────────────

const LOWER_BETTER = /cpa|cac|cpl|cpc|cpm|cost|spend|drr|др[р]|расход|стоимост|churn|отток|bounce|отказ|frequency|частот/i;
const ACTION_MAP: Array<{ kw: RegExp; action: string; tool: string }> = [
  { kw: /cpa|cac|cpl|cpc|cpm|cost|spend|drr|расход|стоимост/i, action: "Перераспределить бюджет в эффективные каналы и пересчитать ставки под целевой CPA.", tool: "budget_optimizer" },
  { kw: /ctr|кликаб/i, action: "Обновить креативы и протестировать новые вариации (усталость/релевантность).", tool: "creative_testing_matrix" },
  { kw: /churn|отток|retention|удержан/i, action: "Запустить программу удержания и сегментацию клиентов по риску оттока.", tool: "churn_predictor" },
  { kw: /conversion|конверс|cvr|\bcr\b/i, action: "Найти главную течь в воронке и провести CRO-аудит лендинга.", tool: "funnel_model" },
  { kw: /roas|romi|\broi\b|ddr/i, action: "Оптимизировать сплит бюджета на максимум отдачи.", tool: "budget_optimizer" },
  { kw: /nps|csat|satisf|лояльн/i, action: "Разобрать драйверы детракторов и закрыть болевые точки клиентского опыта.", tool: "nps_analysis" },
  { kw: /ltv|aov|чек|выручк|revenue/i, action: "Поработать с юнит-экономикой, кросс- и ап-селлом.", tool: "unit_economics" },
  { kw: /frequency|частот/i, action: "Настроить частотные капы, чтобы снять переэкспозицию аудитории.", tool: "frequency_cap_optimizer" },
];
function actionFor(name: string): { action: string; tool: string } {
  for (const m of ACTION_MAP) if (m.kw.test(name)) return { action: m.action, tool: m.tool };
  return { action: "Проанализировать причину отклонения и назначить ответственного.", tool: "report_explain" };
}

const SEV_RANK: Record<string, number> = { critical: 3, warning: 2, watch: 1, ok: 0 };

const kpiAlertEngine: ToolDef = {
  name: "kpi_alert_engine",
  description:
    "Cross-KPI rule-based ALERT ENGINE — the autonomy layer that turns a dashboard into a prioritized to-do list. For each metric give value and a target (or benchmark), plus direction ('higher_better' or 'lower_better'; inferred from the name when omitted — CPA/CAC/churn ⇒ lower-better). It grades each KPI ok/watch/warning/critical by adverse deviation (default warn 10%, crit 25%), and on every breach maps it to a recommended ACTION and the NECTARIN tool to run next (e.g. CPA↑ ⇒ budget_optimizer, CTR↓ ⇒ creative_testing_matrix, churn↑ ⇒ churn_predictor). Returns alerts sorted by severity. Deterministic anomaly→action routing.",
  inputSchema: {
    type: "object",
    properties: {
      metrics: {
        type: "array",
        minItems: 1,
        description: "KPIs to evaluate against targets",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Metric name, e.g. 'CPA', 'CTR', 'Churn', 'ROAS'" },
            value: { type: "number", description: "Current value" },
            target: { type: "number", description: "Target (or use benchmark)" },
            benchmark: { type: "number", description: "Benchmark to compare against if no target" },
            direction: { type: "string", enum: ["higher_better", "lower_better"], description: "Optional; inferred from name if omitted" },
            warnPct: { type: "number", minimum: 0, description: "Adverse deviation for a warning, % (default 10)" },
            critPct: { type: "number", minimum: 0, description: "Adverse deviation for critical, % (default 25)" },
          },
          required: ["name", "value"],
          additionalProperties: false,
        },
      },
    },
    required: ["metrics"],
    additionalProperties: false,
  },
  async handler(input) {
    const raw = Array.isArray(input?.metrics) ? input.metrics : [];
    const alerts: Array<Record<string, unknown>> = [];
    for (const m of raw) {
      if (!isRecord(m)) continue;
      const name = typeof m.name === "string" ? m.name : "";
      const value = num(m.value);
      if (!name || value === null) continue;
      const ref = num(m.target) ?? num(m.benchmark);
      const dir = m.direction === "higher_better" || m.direction === "lower_better"
        ? m.direction
        : LOWER_BETTER.test(name) ? "lower_better" : "higher_better";
      const warn = num(m.warnPct) ?? 10;
      const crit = num(m.critPct) ?? 25;

      if (ref === null || ref === 0) {
        alerts.push({ name, value, reference: ref, direction: dir, severity: "watch", deviationPct: null, message: "Нет цели/бенчмарка — отслеживать вручную.", recommendedAction: actionFor(name).action, suggestedTool: actionFor(name).tool });
        continue;
      }
      // adverse deviation as positive percent when WORSE than reference
      const adverse = dir === "lower_better" ? (value - ref) / Math.abs(ref) : (ref - value) / Math.abs(ref);
      const adversePct = round(adverse * 100, 1);
      let severity: string;
      if (adversePct >= crit) severity = "critical";
      else if (adversePct >= warn) severity = "warning";
      else if (adversePct > 0) severity = "watch";
      else severity = "ok";

      const act = actionFor(name);
      const entry: Record<string, unknown> = {
        name,
        value,
        reference: ref,
        direction: dir,
        deviationPct: adversePct,
        severity,
      };
      if (severity === "ok") {
        entry.message = `В норме или лучше цели (${adversePct <= 0 ? `опережение ${Math.abs(adversePct)}%` : "в пределах допуска"}).`;
      } else {
        entry.message = `${severity === "critical" ? "КРИТИЧНО" : severity === "warning" ? "Предупреждение" : "Под наблюдением"}: отклонение ${adversePct}% в худшую сторону.`;
        entry.recommendedAction = act.action;
        entry.suggestedTool = act.tool;
      }
      alerts.push(entry);
    }
    if (alerts.length === 0) {
      return errResult("Не удалось разобрать метрики. Нужны поля name и value (плюс target или benchmark).");
    }
    alerts.sort((a, b) => (SEV_RANK[String(b.severity)] - SEV_RANK[String(a.severity)]) || (Number(b.deviationPct ?? 0) - Number(a.deviationPct ?? 0)));

    const counts = { critical: 0, warning: 0, watch: 0, ok: 0 } as Record<string, number>;
    for (const a of alerts) counts[String(a.severity)] = (counts[String(a.severity)] ?? 0) + 1;
    const worst = alerts[0];
    const summary =
      `Алёрты: ${counts.critical} критич. / ${counts.warning} предупр. / ${counts.watch} наблюдение / ${counts.ok} в норме. ` +
      (counts.critical + counts.warning > 0
        ? `Приоритет №1: «${worst.name}» (${worst.deviationPct}% отклонение) → ${worst.suggestedTool}.`
        : `Всё в пределах допуска.`);

    return toContent(summary, {
      tool: "kpi_alert_engine",
      counts,
      alerts,
      note: "Severity по adverse-отклонению (warn 10% / crit 25% по умолчанию). Направление инферится из имени (CPA/CAC/churn ⇒ меньше=лучше). Каждый алёрт маршрутизируется в действие и инструмент NECTARIN.",
    });
  },
};

// ── 2. Marketing budget allocator (CMO, by function) ─────────────────────────

interface BudgetFn {
  key: string;
  label: string;
  base: number; // base share %
  min: number;
  max: number;
}
const BUDGET_FUNCTIONS: BudgetFn[] = [
  { key: "brand", label: "Бренд и охватный маркетинг", base: 25, min: 10, max: 45 },
  { key: "demand", label: "Performance / спрос (платный трафик)", base: 35, min: 15, max: 55 },
  { key: "retention", label: "Удержание / CRM / лояльность", base: 12, min: 5, max: 30 },
  { key: "content", label: "Контент / SEO / соцсети", base: 13, min: 5, max: 30 },
  { key: "martech", label: "MarTech и данные", base: 7, min: 3, max: 15 },
  { key: "team", label: "Команда / агентства / операционка", base: 8, min: 5, max: 20 },
];
const GOAL_TILT: Record<string, Partial<Record<string, number>>> = {
  awareness: { brand: +10, demand: -8, retention: -2 },
  growth: { demand: +10, brand: -4, content: -2, retention: -4 },
  performance: { demand: +12, brand: -8, content: -4 },
  efficiency: { martech: +4, demand: -2, team: -2, brand: -2, content: +2 },
  retention: { retention: +12, content: +4, demand: -10, brand: -6 },
};

const marketingBudgetAllocator: ToolDef = {
  name: "marketing_budget_allocator",
  description:
    "CMO annual marketing-budget allocator ACROSS FUNCTIONS (not media channels — for channel splits use budget_optimizer). Splits a total budget across brand, demand/performance, retention/CRM, content/SEO, martech and team/ops using benchmark shares tilted by your primary goal (awareness | growth | performance | efficiency | retention), clamped to sensible guardrails per function. Returns ₽ + % per function, the tilt applied vs. the benchmark, and guardrail notes. Deterministic; a starting framework to negotiate, not a mandate.",
  inputSchema: {
    type: "object",
    properties: {
      totalBudget: { type: "number", exclusiveMinimum: 0, description: "Total annual marketing budget, RUB" },
      goal: { type: "string", enum: ["awareness", "growth", "performance", "efficiency", "retention"], description: "Primary goal driving the tilt (default growth)" },
      businessType: { type: "string", enum: ["b2c", "b2b", "ecom", "saas"], description: "Optional business type (light adjustment)" },
    },
    required: ["totalBudget"],
    additionalProperties: false,
  },
  async handler(input) {
    const total = num(input?.totalBudget);
    if (total === null || total <= 0) return errResult("Нужен положительный totalBudget (₽/год).");
    const goal = typeof input?.goal === "string" && GOAL_TILT[input.goal] ? input.goal : "growth";
    const bt = typeof input?.businessType === "string" ? input.businessType : "";

    const tilt = { ...(GOAL_TILT[goal] ?? {}) } as Record<string, number>;
    // light business-type nudges
    if (bt === "b2b") {
      tilt.demand = (tilt.demand ?? 0) + 4;
      tilt.content = (tilt.content ?? 0) + 4;
      tilt.brand = (tilt.brand ?? 0) - 4;
    } else if (bt === "ecom") {
      tilt.demand = (tilt.demand ?? 0) + 4;
      tilt.retention = (tilt.retention ?? 0) + 2;
      tilt.brand = (tilt.brand ?? 0) - 4;
    } else if (bt === "saas") {
      tilt.retention = (tilt.retention ?? 0) + 4;
      tilt.content = (tilt.content ?? 0) + 2;
      tilt.brand = (tilt.brand ?? 0) - 4;
    }

    // apply tilt + clamp to guardrails
    const shares = BUDGET_FUNCTIONS.map((f) => {
      const tilted = f.base + (tilt[f.key] ?? 0);
      const clamped = Math.max(f.min, Math.min(f.max, tilted));
      return { ...f, share: clamped };
    });
    // renormalize to 100
    const sum = shares.reduce((a, s) => a + s.share, 0);
    const allocation = shares.map((s) => {
      const pct = round((s.share / sum) * 100, 1);
      return {
        function: s.label,
        key: s.key,
        sharePct: pct,
        amount: round((s.share / sum) * total, 0),
        vsBenchmarkPp: round(pct - s.base, 1),
        guardrail: `${s.min}–${s.max}%`,
      };
    });
    allocation.sort((a, b) => b.sharePct - a.sharePct);

    const top = allocation[0];
    const summary =
      `Распределение годового бюджета ${ru(total)} ₽ под цель «${goal}»${bt ? ` (${bt})` : ""}: ` +
      `крупнейшая статья — ${top.function} ${top.sharePct}% (${ru(top.amount)} ₽).`;

    return toContent(summary, {
      tool: "marketing_budget_allocator",
      totalBudget: round(total, 0),
      goal,
      businessType: bt || null,
      allocation,
      note: "Доли = бенчмарк, скорректированный под цель/тип бизнеса и зажатый в гардрейлы, затем нормированный к 100%. Это функциональный сплит (бренд/спрос/удержание/контент/мартех/команда), не медиаканалы.",
    });
  },
};

export const AUTONOMY_TOOLS: ToolDef[] = [kpiAlertEngine, marketingBudgetAllocator];
