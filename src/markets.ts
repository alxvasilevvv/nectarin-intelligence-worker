/**
 * MARKET & REVENUE SCIENCE tool group (v2.59) for NECTARIN Intelligence — Workers.
 * Three methodology-grounded, deterministic tools that deepen the analytics /
 * product-marketing layer of the catalogue and fill real gaps.
 *
 *   • marketing_roi_waterfall — period-over-period REVENUE / ROAS bridge. Decomposes
 *     ΔRevenue into three exact, reconciling drivers via sequential factor substitution
 *     (FP&A "bridge"): Revenue = Spend × Efficiency(conv/₽) × AOV(₽/conv). Returns a
 *     waterfall (start → spend → efficiency → AOV → end), each driver's signed contribution,
 *     the ROAS change and its decomposition. Distinct from unit_economics (single-period LTV/CAC)
 *     and scenario_planner (forward what-ifs) — this explains what already happened.
 *   • conjoint_analysis — choice-based / part-worth CONJOINT (lite). From attribute level
 *     part-worth utilities it computes attribute IMPORTANCE (utility range share), the
 *     SHARE OF PREFERENCE across supplied profiles via a logit (BTL) model, the optimal
 *     (max-utility) feature bundle, and — if a numeric price attribute is given — the
 *     willingness-to-pay (₽) for each attribute. Distinct from pricing_psm (Van Westendorp
 *     price-only sensitivity); this trades off features × price.
 *   • tam_sam_som — market SIZING funnel. Top-down (TAM × SAM share × SOM share) or
 *     bottom-up (population × penetration × obtainable share × ARPU) → TAM/SAM/SOM in
 *     customers and revenue, the SOM-as-%-of-TAM reality check, and an optional multi-year
 *     SOM projection at a CAGR. Light utility, open tier.
 *
 * Deterministic math on YOUR inputs — planning estimates, not guarantees.
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
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// ── 1. Marketing ROI waterfall (period-over-period revenue bridge) ───────────

const marketingRoiWaterfall: ToolDef = {
  name: "marketing_roi_waterfall",
  description:
    "Period-over-period REVENUE / ROAS waterfall (bridge) for a CMO or marketing analyst. Pass two periods (`before` and `after`), each with spend + conversions + revenue, and it decomposes the change in revenue into THREE exact, reconciling drivers via sequential factor substitution: Revenue = Spend × Efficiency (conversions per ₽) × AOV (revenue per conversion). Returns a waterfall (start → +spend effect → +efficiency effect → +AOV effect → end) with each driver's signed ₽ contribution and share of the total change, plus the ROAS before/after and its delta. Use it to explain WHY revenue or ROI moved (more budget? cheaper conversions? bigger basket?). Distinct from unit_economics (single-period) and scenario_planner (forward what-ifs). Deterministic exact decomposition on your numbers.",
  inputSchema: {
    type: "object",
    properties: {
      before: {
        type: "object",
        description: "Baseline period",
        properties: {
          spend: { type: "number", exclusiveMinimum: 0, description: "Marketing spend, ₽" },
          conversions: { type: "number", exclusiveMinimum: 0, description: "Conversions / orders" },
          revenue: { type: "number", exclusiveMinimum: 0, description: "Revenue attributed, ₽" },
        },
        required: ["spend", "conversions", "revenue"],
        additionalProperties: false,
      },
      after: {
        type: "object",
        description: "Comparison period",
        properties: {
          spend: { type: "number", exclusiveMinimum: 0, description: "Marketing spend, ₽" },
          conversions: { type: "number", exclusiveMinimum: 0, description: "Conversions / orders" },
          revenue: { type: "number", exclusiveMinimum: 0, description: "Revenue attributed, ₽" },
        },
        required: ["spend", "conversions", "revenue"],
        additionalProperties: false,
      },
      labelBefore: { type: "string", description: "Optional label for the baseline period, e.g. 'Q1'" },
      labelAfter: { type: "string", description: "Optional label for the comparison period, e.g. 'Q2'" },
    },
    required: ["before", "after"],
    additionalProperties: false,
  },
  async handler(input) {
    const b = isRecord(input?.before) ? input.before : null;
    const a = isRecord(input?.after) ? input.after : null;
    if (!b || !a) return errResult("Нужны оба периода: before и after (каждый: spend, conversions, revenue > 0).");

    const s0 = num(b.spend), c0 = num(b.conversions), r0 = num(b.revenue);
    const s1 = num(a.spend), c1 = num(a.conversions), r1 = num(a.revenue);
    for (const [v, nm] of [[s0, "before.spend"], [c0, "before.conversions"], [r0, "before.revenue"], [s1, "after.spend"], [c1, "after.conversions"], [r1, "after.revenue"]] as const) {
      if (v === null || v <= 0) return errResult(`Поле ${nm} должно быть положительным числом.`);
    }
    const labelBefore = typeof input?.labelBefore === "string" && input.labelBefore.trim() ? input.labelBefore.trim() : "период 1";
    const labelAfter = typeof input?.labelAfter === "string" && input.labelAfter.trim() ? input.labelAfter.trim() : "период 2";

    // Factor structure: Revenue = Spend × Efficiency × AOV.
    const e0 = (c0 as number) / (s0 as number); // conversions per ₽
    const e1 = (c1 as number) / (s1 as number);
    const a0 = (r0 as number) / (c0 as number); // ₽ per conversion (AOV)
    const a1 = (r1 as number) / (c1 as number);

    // Sequential factor substitution (order: spend → efficiency → AOV). Sums exactly to ΔRevenue.
    const spendEffect = (s1! - s0!) * e0 * a0;
    const efficiencyEffect = s1! * (e1 - e0) * a0;
    const aovEffect = s1! * e1 * (a1 - a0);

    const deltaRevenue = r1! - r0!;
    const reconErr = deltaRevenue - (spendEffect + efficiencyEffect + aovEffect);
    // Fold any tiny floating residual into the last step so the bridge reconciles exactly.
    const aovEffectAdj = aovEffect + reconErr;

    const drivers = [
      { driver: "spend", label: "Бюджет (объём)", contribution: round(spendEffect, 2) },
      { driver: "efficiency", label: "Эффективность (конв./₽, ↑=дешевле конверсия)", contribution: round(efficiencyEffect, 2) },
      { driver: "aov", label: "Средний чек (AOV / микс)", contribution: round(aovEffectAdj, 2) },
    ];
    const absTotal = drivers.reduce((acc, d) => acc + Math.abs(d.contribution), 0) || 1;
    const driversWithShare = drivers.map((d) => ({
      ...d,
      sharePct: round((Math.abs(d.contribution) / absTotal) * 100, 1),
      direction: d.contribution > 0 ? "рост" : d.contribution < 0 ? "спад" : "нейтрально",
    }));

    // Waterfall steps with running cumulative.
    let running = r0!;
    const waterfall: Array<{ step: string; delta: number; cumulative: number }> = [
      { step: `Старт (${labelBefore})`, delta: 0, cumulative: round(running, 2) },
    ];
    for (const d of driversWithShare) {
      running += d.contribution;
      waterfall.push({ step: d.label, delta: d.contribution, cumulative: round(running, 2) });
    }
    waterfall.push({ step: `Итог (${labelAfter})`, delta: 0, cumulative: round(r1!, 2) });

    const roas0 = (r0 as number) / (s0 as number);
    const roas1 = (r1 as number) / (s1 as number);
    const cpa0 = (s0 as number) / (c0 as number);
    const cpa1 = (s1 as number) / (c1 as number);

    const topDriver = driversWithShare.reduce((x, y) => (Math.abs(y.contribution) > Math.abs(x.contribution) ? y : x));
    const deltaPct = round((deltaRevenue / r0!) * 100, 1);
    const summary =
      `ROI-водопад выручки (${labelBefore}→${labelAfter}): ${ru(r0!)} → ${ru(r1!)} ₽ (${deltaPct > 0 ? "+" : ""}${deltaPct}%). ` +
      `Главный драйвер: ${topDriver.label} (${topDriver.contribution > 0 ? "+" : ""}${ru(topDriver.contribution)} ₽, ${topDriver.sharePct}%). ` +
      `ROAS ${round(roas0, 2)}→${round(roas1, 2)} (${roas1 >= roas0 ? "+" : ""}${round(roas1 - roas0, 2)}).`;

    return toContent(summary, {
      tool: "marketing_roi_waterfall",
      periods: { before: labelBefore, after: labelAfter },
      before: { spend: round(s0!, 2), conversions: c0, revenue: round(r0!, 2), cpa: round(cpa0, 2), aov: round(a0, 2), roas: round(roas0, 4) },
      after: { spend: round(s1!, 2), conversions: c1, revenue: round(r1!, 2), cpa: round(cpa1, 2), aov: round(a1, 2), roas: round(roas1, 4) },
      deltaRevenue: round(deltaRevenue, 2),
      deltaRevenuePct: deltaPct,
      drivers: driversWithShare,
      waterfall,
      roas: { before: round(roas0, 4), after: round(roas1, 4), delta: round(roas1 - roas0, 4) },
      topDriver: { driver: topDriver.driver, label: topDriver.label, contribution: topDriver.contribution },
      note: "Декомпозиция: Выручка = Бюджет × Эффективность(конв./₽) × AOV(₽/конв.). Метод — последовательное замещение факторов (FP&A-мост), порядок: бюджет → эффективность → AOV; сумма вкладов ТОЧНО равна ΔВыручки (остаток округления свёрнут в последний шаг). Эффективность = конверсии/₽ = 1/CPA (рост = конверсия дешевле). Вклад зависит от порядка факторов (свойство bridge-разложения). Это объяснение прошлого периода на ваших данных, не прогноз.",
    });
  },
};

// ── 2. Conjoint analysis (part-worth utilities → importance, share, WTP) ─────

const conjointAnalysis: ToolDef = {
  name: "conjoint_analysis",
  description:
    "Choice-based / part-worth CONJOINT analysis (lite) for a product or pricing marketer. Give `attributes` (each with `levels`, each level carrying a part-worth `utility` from a prior conjoint study or expert estimate) and it computes: attribute IMPORTANCE (each attribute's utility range as a share of the total), the OPTIMAL feature bundle (max-utility level per attribute), and — if you pass `profiles` (named bundles, each choosing one level per attribute) — the SHARE OF PREFERENCE across them via a logit (Bradley-Terry-Luce) model. If one attribute is numeric price (`priceAttribute` with numeric level labels), it also estimates the marginal utility of money and the WILLINGNESS-TO-PAY (₽) for each attribute. Distinct from pricing_psm (Van Westendorp, price only) — this trades off features × price. Deterministic utility math on your inputs.",
  inputSchema: {
    type: "object",
    properties: {
      attributes: {
        type: "array",
        minItems: 1,
        description: "Product attributes, each with its levels and part-worth utilities.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Attribute name, e.g. 'Цена', 'Бренд', 'Доставка'" },
            levels: {
              type: "array",
              minItems: 1,
              description: "Levels of this attribute",
              items: {
                type: "object",
                properties: {
                  label: { type: "string", description: "Level label, e.g. 'Премиум', '999'" },
                  utility: { type: "number", description: "Part-worth utility (relative; higher = preferred)" },
                },
                required: ["label", "utility"],
                additionalProperties: false,
              },
            },
          },
          required: ["name", "levels"],
          additionalProperties: false,
        },
      },
      profiles: {
        type: "array",
        description: "Optional named bundles to compute share-of-preference. Each: name + choices {attributeName: levelLabel}.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Profile / product name" },
            choices: { type: "object", description: "Map of attribute name → chosen level label", additionalProperties: { type: "string" } },
          },
          required: ["name", "choices"],
          additionalProperties: false,
        },
      },
      priceAttribute: { type: "string", description: "Optional name of the price attribute (its level labels must be numeric ₽) — enables willingness-to-pay." },
      scale: { type: "number", exclusiveMinimum: 0, description: "Logit scale for share-of-preference (default 1; higher = sharper)." },
    },
    required: ["attributes"],
    additionalProperties: false,
  },
  async handler(input) {
    const rawAttrs = Array.isArray(input?.attributes) ? input.attributes : [];
    const attrs: Array<{ name: string; levels: Array<{ label: string; utility: number }> }> = [];
    for (const at of rawAttrs) {
      if (!isRecord(at)) continue;
      const name = typeof at.name === "string" ? at.name.trim() : "";
      if (!name || !Array.isArray(at.levels)) continue;
      const levels: Array<{ label: string; utility: number }> = [];
      for (const lv of at.levels) {
        if (!isRecord(lv)) continue;
        const label = typeof lv.label === "string" ? lv.label.trim() : "";
        const utility = num(lv.utility);
        if (!label || utility === null) continue;
        levels.push({ label, utility });
      }
      if (levels.length > 0) attrs.push({ name, levels });
    }
    if (attrs.length === 0) {
      return errResult("Нужен ≥1 атрибут с ≥1 уровнем (каждый уровень: label + числовой utility).");
    }
    const scale = num(input?.scale) && (num(input?.scale) as number) > 0 ? (num(input?.scale) as number) : 1;

    // Attribute importance = utility range share.
    const ranges = attrs.map((at) => {
      const us = at.levels.map((l) => l.utility);
      const range = Math.max(...us) - Math.min(...us);
      return { name: at.name, range };
    });
    const totalRange = ranges.reduce((acc, r) => acc + r.range, 0) || 1;
    const importance = ranges
      .map((r) => ({ attribute: r.name, range: round(r.range, 4), importancePct: round((r.range / totalRange) * 100, 1) }))
      .sort((x, y) => y.importancePct - x.importancePct);

    // Optimal bundle = max-utility level per attribute.
    const optimalBundle = attrs.map((at) => {
      const best = at.levels.reduce((x, y) => (y.utility > x.utility ? y : x));
      return { attribute: at.name, level: best.label, utility: round(best.utility, 4) };
    });
    const optimalUtility = round(optimalBundle.reduce((acc, x) => acc + x.utility, 0), 4);

    // Willingness-to-pay (optional, needs a numeric price attribute).
    let wtp: { priceAttribute: string; utilityPerRub: number; attributes: Array<{ attribute: string; rangeUtility: number; wtpRub: number }> } | null = null;
    let wtpNote: string | null = null;
    const priceAttrName = typeof input?.priceAttribute === "string" ? input.priceAttribute.trim() : "";
    if (priceAttrName) {
      const pa = attrs.find((at) => at.name.toLowerCase() === priceAttrName.toLowerCase());
      if (!pa) {
        wtpNote = `priceAttribute «${priceAttrName}» не найден среди атрибутов — WTP пропущен.`;
      } else {
        const points = pa.levels.map((l) => ({ price: Number(l.label), utility: l.utility })).filter((p) => Number.isFinite(p.price));
        if (points.length < 2) {
          wtpNote = `Атрибут цены «${pa.name}» требует ≥2 уровней с числовыми label (₽) — WTP пропущен.`;
        } else {
          const lo = points.reduce((x, y) => (y.price < x.price ? y : x));
          const hi = points.reduce((x, y) => (y.price > x.price ? y : x));
          const dPrice = hi.price - lo.price;
          const utilPerRub = dPrice !== 0 ? (lo.utility - hi.utility) / dPrice : 0; // utility lost per extra ₽
          if (utilPerRub <= 0) {
            wtpNote = "Полезность не убывает с ростом цены — WTP не рассчитан (проверьте знаки утилит).";
          } else {
            wtp = {
              priceAttribute: pa.name,
              utilityPerRub: round(utilPerRub, 6),
              attributes: ranges
                .filter((r) => r.name.toLowerCase() !== pa.name.toLowerCase())
                .map((r) => ({ attribute: r.name, rangeUtility: round(r.range, 4), wtpRub: round(r.range / utilPerRub, 2) }))
                .sort((x, y) => y.wtpRub - x.wtpRub),
            };
          }
        }
      }
    }

    // Share of preference across supplied profiles (logit / BTL).
    let shareOfPreference: Array<{ name: string; totalUtility: number; sharePct: number; valid: boolean }> | null = null;
    let profileNote: string | null = null;
    const rawProfiles = Array.isArray(input?.profiles) ? input.profiles : null;
    if (rawProfiles && rawProfiles.length > 0) {
      const evaluated: Array<{ name: string; totalUtility: number; valid: boolean }> = [];
      for (const pr of rawProfiles) {
        if (!isRecord(pr)) continue;
        const name = typeof pr.name === "string" ? pr.name.trim() : "";
        const choices = isRecord(pr.choices) ? pr.choices : null;
        if (!name || !choices) continue;
        let total = 0;
        let valid = true;
        for (const at of attrs) {
          const chosen = choices[at.name];
          const lv = at.levels.find((l) => l.label === chosen);
          if (lv) total += lv.utility;
          else valid = false; // missing/unknown level for this attribute
        }
        evaluated.push({ name, totalUtility: round(total, 4), valid });
      }
      const valids = evaluated.filter((e) => e.valid);
      if (valids.length === 0) {
        profileNote = "Ни один профиль не задал валидный уровень для каждого атрибута — share-of-preference пропущен.";
      } else {
        // Logit on valid profiles; subtract max for numerical stability.
        const maxU = Math.max(...valids.map((v) => v.totalUtility));
        const exps = valids.map((v) => Math.exp((v.totalUtility - maxU) / scale));
        const denom = exps.reduce((acc, e) => acc + e, 0) || 1;
        const shareByName = new Map<string, number>();
        valids.forEach((v, i) => shareByName.set(v.name, (exps[i] / denom) * 100));
        shareOfPreference = evaluated
          .map((e) => ({ name: e.name, totalUtility: e.totalUtility, sharePct: e.valid ? round(shareByName.get(e.name) as number, 1) : 0, valid: e.valid }))
          .sort((x, y) => y.sharePct - x.sharePct);
        if (valids.length < evaluated.length) profileNote = "Профили с неполным набором уровней исключены из доли предпочтения (valid=false).";
      }
    }

    const topAttr = importance[0];
    const winner = shareOfPreference ? shareOfPreference.find((s) => s.valid) ?? null : null;
    const summary =
      `Конджойнт: ${attrs.length} атрибут(ов), ${attrs.reduce((acc, at) => acc + at.levels.length, 0)} уровней. ` +
      `Важнейший атрибут: «${topAttr.attribute}» (${topAttr.importancePct}%). ` +
      (winner ? `Лидер по доле предпочтения: «${winner.name}» (${winner.sharePct}%). ` : "") +
      (wtp ? `WTP за лучший атрибут: ${ru(wtp.attributes[0]?.wtpRub ?? 0)} ₽.` : "");

    return toContent(summary, {
      tool: "conjoint_analysis",
      attributeCount: attrs.length,
      levelCount: attrs.reduce((acc, at) => acc + at.levels.length, 0),
      importance,
      optimalBundle,
      optimalUtility,
      shareOfPreference,
      shareScale: scale,
      willingnessToPay: wtp,
      notes: [wtpNote, profileNote].filter(Boolean),
      note: "Важность атрибута = размах его утилит / сумма размахов всех атрибутов × 100% (стандартная conjoint importance). Оптимальный набор — уровень с макс. утилитой по каждому атрибуту (аддитивная модель полезности). Доля предпочтения — логит/BTL: share_i = exp(U_i/scale) / Σ exp(U_j/scale) по профилям с полным набором уровней. WTP = размах утилит атрибута / (предельная полезность ₽), где предельная полезность ₽ = (U_дёшево − U_дорого)/Δцена по ценовому атрибуту. Утилиты — ВАШИ входные оценки (part-worths), не измерены этим инструментом; это калькулятор conjoint, а не сбор данных.",
    });
  },
};

// ── 3. TAM / SAM / SOM market sizing funnel ──────────────────────────────────

const tamSamSom: ToolDef = {
  name: "tam_sam_som",
  description:
    "Market SIZING funnel (TAM → SAM → SOM) for a strategist, founder or new-market lead. Two methods: TOP-DOWN — pass `tam` (total market, ₽ or customers) plus `samSharePct` (serviceable share) and `somSharePct` (obtainable share of SAM); or BOTTOM-UP — pass `population` (total potential customers), `penetrationPct` (→ serviceable customers = SAM), `obtainableSharePct` (your realistic share → SOM) and `arpu` (annual revenue per customer) to build sizes in customers AND revenue. Returns TAM/SAM/SOM, the SOM-as-%-of-TAM reality check, and an optional multi-year SOM projection at `cagrPct` over `years`. Light, deterministic market-sizing math — assumptions in, sizes out.",
  inputSchema: {
    type: "object",
    properties: {
      tam: { type: "number", exclusiveMinimum: 0, description: "TOP-DOWN: total addressable market (₽ or customers)" },
      samSharePct: { type: "number", minimum: 0, maximum: 100, description: "TOP-DOWN: SAM as % of TAM" },
      somSharePct: { type: "number", minimum: 0, maximum: 100, description: "TOP-DOWN: SOM as % of SAM" },
      population: { type: "number", exclusiveMinimum: 0, description: "BOTTOM-UP: total potential customers (universe)" },
      penetrationPct: { type: "number", minimum: 0, maximum: 100, description: "BOTTOM-UP: % of population that is serviceable (→ SAM)" },
      obtainableSharePct: { type: "number", minimum: 0, maximum: 100, description: "BOTTOM-UP: realistic % of SAM you can capture (→ SOM)" },
      arpu: { type: "number", exclusiveMinimum: 0, description: "Annual revenue per customer, ₽ (converts customer counts to revenue)" },
      cagrPct: { type: "number", description: "Optional market CAGR % for the SOM projection" },
      years: { type: "number", minimum: 1, maximum: 15, description: "Optional projection horizon in years (needs cagrPct)" },
      unit: { type: "string", description: "Optional unit label for top-down sizes (default '₽')" },
    },
    additionalProperties: false,
  },
  async handler(input) {
    const arpu = num(input?.arpu);
    const cagrPct = num(input?.cagrPct);
    const years = num(input?.years) ? Math.round(clamp(num(input?.years) as number, 1, 15)) : null;

    const population = num(input?.population);
    const tamIn = num(input?.tam);

    let method: "bottom_up" | "top_down";
    let tamCustomers: number | null = null;
    let samCustomers: number | null = null;
    let somCustomers: number | null = null;
    let tamValue: number;
    let samValue: number;
    let somValue: number;
    let unit: string;

    if (population !== null) {
      method = "bottom_up";
      const penetrationPct = clamp(num(input?.penetrationPct) ?? 100, 0, 100);
      const obtainableSharePct = clamp(num(input?.obtainableSharePct) ?? 100, 0, 100);
      tamCustomers = population;
      samCustomers = population * (penetrationPct / 100);
      somCustomers = (samCustomers as number) * (obtainableSharePct / 100);
      if (arpu === null) {
        return errResult("Для bottom-up нужен arpu (₽ на клиента в год), чтобы перевести клиентов в выручку. Укажите arpu или используйте top-down с tam.");
      }
      tamValue = tamCustomers * arpu;
      samValue = (samCustomers as number) * arpu;
      somValue = (somCustomers as number) * arpu;
      unit = "₽";
    } else if (tamIn !== null) {
      method = "top_down";
      const samSharePct = clamp(num(input?.samSharePct) ?? 100, 0, 100);
      const somSharePct = clamp(num(input?.somSharePct) ?? 100, 0, 100);
      unit = typeof input?.unit === "string" && input.unit.trim() ? input.unit.trim() : "₽";
      tamValue = tamIn;
      samValue = tamIn * (samSharePct / 100);
      somValue = samValue * (somSharePct / 100);
      if (arpu !== null && arpu > 0) {
        tamCustomers = tamValue / arpu;
        samCustomers = samValue / arpu;
        somCustomers = somValue / arpu;
      }
    } else {
      return errResult("Укажите либо tam (top-down), либо population (bottom-up).");
    }

    const somOfTamPct = tamValue !== 0 ? round((somValue / tamValue) * 100, 2) : null;
    const samOfTamPct = tamValue !== 0 ? round((samValue / tamValue) * 100, 2) : null;

    // Optional SOM projection at CAGR.
    let projection: Array<{ year: number; som: number }> | null = null;
    if (cagrPct !== null && years !== null) {
      projection = [];
      for (let y = 1; y <= years; y++) {
        projection.push({ year: y, som: round(somValue * Math.pow(1 + cagrPct / 100, y), 2) });
      }
    }

    // Reality-check flag: a SOM that is an implausibly large share of TAM.
    const realityCheck =
      somOfTamPct === null
        ? null
        : somOfTamPct > 30
        ? "⚠ SOM > 30% TAM — агрессивно для входа на рынок, перепроверьте obtainable share."
        : somOfTamPct < 0.1
        ? "SOM < 0.1% TAM — консервативно; есть запас для роста."
        : "SOM в правдоподобном диапазоне для захвата доли рынка.";

    const fmt = (v: number) => `${ru(v)}${unit === "₽" ? " ₽" : ` ${unit}`}`;
    const summary =
      `Размер рынка (${method === "bottom_up" ? "снизу-вверх" : "сверху-вниз"}): ` +
      `TAM ${fmt(tamValue)} → SAM ${fmt(samValue)} (${samOfTamPct}%) → SOM ${fmt(somValue)} (${somOfTamPct}% TAM)` +
      (somCustomers !== null ? `, ~${ru(somCustomers)} клиентов` : "") +
      (projection ? `. Через ${years} лет SOM ~${fmt(projection[projection.length - 1].som)} (CAGR ${cagrPct}%).` : ".");

    return toContent(summary, {
      tool: "tam_sam_som",
      method,
      unit,
      tam: { value: round(tamValue, 2), customers: tamCustomers !== null ? round(tamCustomers, 2) : null },
      sam: { value: round(samValue, 2), customers: samCustomers !== null ? round(samCustomers, 2) : null, ofTamPct: samOfTamPct },
      som: { value: round(somValue, 2), customers: somCustomers !== null ? round(somCustomers, 2) : null, ofTamPct: somOfTamPct },
      arpu: arpu ?? null,
      projection,
      realityCheck,
      note: "TAM (Total Addressable) → SAM (Serviceable Available) → SOM (Serviceable Obtainable). Top-down: SAM = TAM×доля, SOM = SAM×доля. Bottom-up: SAM = население×проникновение, SOM = SAM×достижимая доля, выручка = клиенты×ARPU. Проекция SOM = SOM×(1+CAGR)^год. Это арифметика рыночного сайзинга на ВАШИХ допущениях — качество оценки = качество допущений, не рыночное измерение.",
    });
  },
};

export const MARKETS_TOOLS: ToolDef[] = [marketingRoiWaterfall, conjointAnalysis, tamSamSom];
