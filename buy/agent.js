#!/usr/bin/env node
// Knitter Marketplace agent. Claude Code calls idealo (MCP); this script does everything else.
//
//   node buy/agent.js inspect <ravelry-url>          raw Ravelry JSON (check field names first)
//   node buy/agent.js prepare <ravelry-url> <size>   pattern + stash + budget -> run/plan.json (+ idealo queries)
//   (Claude Code: run idealo searches, save offers to run/offers.json)
//   node buy/agent.js finish                         calc + substitutes -> run/result.json
//   node buy/agent.js budget-subs                    if everything is over budget: popular Ravelry yarns -> plan (+ idealo queries), then finish again
//   node buy/agent.js held-together                  held-double / two-yarn combinations (stash first) -> plan (+ idealo queries for missing strands), then finish again
//   (Claude Code: decide with buy/decision_prompt.md, save run/decision.json)
//   node buy/agent.js confirm                        update stash + budget history after "yes, buy it"
//   node buy/agent.js stash                          list stash
//   node buy/agent.js stash-add '<json>'             add a yarn to the stash

const fs = require('fs');
const path = require('path');
require('../lib/env').loadEnv();
const ravelry = require('../lib/ravelry');
const stash = require('../lib/stash');
const { run: calc, longTermBudget, needleKey } = require('../lib/calc');
const subs = require('../lib/subs');

const RUN = path.join(__dirname, '..', 'run', 'buy');
fs.mkdirSync(RUN, { recursive: true });
const read = (f) => JSON.parse(fs.readFileSync(path.join(RUN, f), 'utf8'));
const write = (f, d) => { fs.writeFileSync(path.join(RUN, f), JSON.stringify(d, null, 2)); return path.join('run', 'buy', f); };
const yarnKey = (y) => `${y.brand} ${y.name}`;

async function prepare(url, size) {
  const { pattern } = await ravelry.fetchPattern(url, size);
  const s = stash.load();
  const realStash = await ravelry.fetchStash().catch(() => null); // optional, shape unconfirmed
  const main = pattern.yarns[0];
  const candidates = subs.rank(main, pattern.ravelry_alternatives);
  const plan = {
    pattern, stash_source: s.file.endsWith('local.json') ? 'stash.local.json' : 'demo',
    ravelry_stash_raw: realStash, stash: s.stash, needles_owned: s.needles_owned, budget: s.budget,
    long_term_budget: longTermBudget(s.budget.history),
    substitute_candidates: candidates,
    idealo_queries: [
      ...[main, ...candidates].map((y) => ({ kind: 'yarn', key: yarnKey(y), query: yarnKey(y) })),
      ...[...new Set((pattern.needles || []).map((n) => n.mm))].map((mm) => ({ kind: 'needle', key: needleKey(mm), query: needleKey(mm) })),
    ].map((q) => ({ ...q, country: process.env.IDEALO_COUNTRY || 'DE' })),
  };
  console.log(`Plan: ${write('plan.json', plan)}`);
  console.log(`Pattern yarn: ${yarnKey(main)} (${main.weight_class}, ${main.total_metres} m)`);
  console.log(`Substitute candidates: ${candidates.map((c) => `${yarnKey(c)} [${c.match_score}]`).join(', ') || 'none'}`);
  console.log('Next: run idealo search_products + get_product_offers for each idealo_queries[].query,');
  console.log('save { "<key>": [offers...] } to run/buy/offers.json (yarn and KnitPro Zing needle keys), then: node buy/agent.js finish');
}

const price = (s) => (s.line.offer && s.line.offer.best_in_stock ? s.line.offer.best_in_stock.total_eur : Infinity);

// Buyable and within budget: in-stock (or indicative) offer, no per-skein flag, total under the project cap.
function withinBudget(line, basketTotal, budget) {
  const st = (budget && budget.short_term) || {};
  return !!(line && line.skeins_to_buy > 0 ? line.offer && line.offer.best_in_stock : true) &&
    !(line.flags || []).some((f) => /Over budget/.test(f)) &&
    (st.max_total_eur == null || basketTotal <= st.max_total_eur);
}
function needsBudgetFallback(result, budget) {
  const main = result.lines[0];
  if (!main || main.skeins_to_buy === 0) return false;
  if (withinBudget(main, result.basket_total_eur, budget)) return false;
  return !result.substitutes.some((s) => withinBudget(s.line, s.basket_total_eur, budget));
}

function finish() {
  const plan = read('plan.json');
  const offers = fs.existsSync(path.join(RUN, 'offers.json')) ? read('offers.json') : {};
  const base = { stash: plan.stash, needles_owned: plan.needles_owned, budget: plan.budget, offers };
  const original = calc({ ...base, pattern: plan.pattern });

  // Price every substitute as if it were the pattern yarn (its own metres per skein).
  const priceCandidate = (c) => {
    const p = { ...plan.pattern, yarns: [{ ...c, role: 'main', colour: null, total_metres: plan.pattern.yarns[0].total_metres }] };
    const r = calc({ ...base, pattern: p });
    return { candidate: c, line: r.lines[0], basket_total_eur: r.basket_total_eur };
  };
  const substitutes = plan.substitute_candidates.map(priceCandidate)
    .sort((a, b) => price(a) - price(b)); // lowest price first, unpriced last

  // Budget substitutes (from budget-subs), cheapest first; recommend the cheapest within budget.
  const budgetSubs = (plan.budget_substitute_candidates || []).map((c) => ({ ...priceCandidate(c), budget_substitute: true }))
    .sort((a, b) => price(a) - price(b));
  const recommended = budgetSubs.find((s) => withinBudget(s.line, s.basket_total_eur, plan.budget)) || null;

  // Held-together combinations: each strand needs the full pattern metres; stash first, idealo for the rest.
  const held = (plan.held_together_candidates || []).map((c) => {
    const r = calc({ ...base, pattern: heldPattern(plan.pattern, c) });
    const stashCovered = r.lines.every((l) => l.skeins_to_buy === 0);
    const buyable = r.lines.every((l) => l.skeins_to_buy === 0 || (l.offer && l.offer.best_in_stock));
    return { ...c, held_together: true, lines: r.lines, stash_covered: stashCovered,
      basket_total_eur: buyable ? r.yarn_total_eur : null,
      within_budget: buyable && r.lines.every((l) => withinBudget(l, r.basket_total_eur, plan.budget)) };
  }).sort((a, b) => (b.stash_covered - a.stash_covered) || ((a.basket_total_eur ?? Infinity) - (b.basket_total_eur ?? Infinity)));

  const result = { ...original, substitutes, long_term_budget: plan.long_term_budget, held_together: held,
    budget_fallback_needed: needsBudgetFallback({ ...original, substitutes }, plan.budget),
    budget_substitutes: budgetSubs,
    recommended_budget_substitute: recommended ? recommended.line.yarn : null };
  console.log(`Result: ${write('result.json', result)}`);
  for (const l of original.lines) console.log(`${l.yarn}: need ${l.needed_metres} m, stash ${l.stash.usable_one_lot_metres} m, buy ${l.skeins_to_buy} skeins. ${l.flags.join(' ')}`);
  for (const n of original.needles) {
    const b = n.zing.best_in_stock;
    console.log(`Needle ${n.mm} mm: ${n.owned ? 'owned' : 'missing'}, KnitPro Zing ${b ? `from ${b.total_eur} € incl. shipping` : 'no offer'}`);
  }
  const st = original.budget.short_term;
  console.log(`Basket ${original.basket_total_eur} € (yarn ${original.yarn_total_eur} + needles ${original.needle_total_eur}) vs max ${st.max_total_eur ?? '-'} €; max ${st.max_per_skein_eur ?? '-'} €/skein`);
  for (const b of budgetSubs) {
    const o = b.line.offer && b.line.offer.best_in_stock;
    console.log(`Budget substitute: ${b.line.yarn}: ${o ? `${b.line.skeins_to_buy} skeins, ${o.total_eur} €${o.indicative ? ' (indicative)' : ''}` : 'no offer'}. ${b.line.flags.join(' ')}`);
  }
  for (const h of held) {
    const status = h.stash_covered ? 'covered by stash' : h.basket_total_eur != null ? `${h.basket_total_eur} € to buy` : 'not buyable';
    console.log(`Held together: ${h.label} (${h.effective_metres_per_50g} m/50 g): ${status}. ${h.lines.map((l) => `${l.yarn}: need ${l.needed_metres} m, stash ${l.stash.usable_one_lot_metres} m, buy ${l.skeins_to_buy}`).join('; ')}`);
  }
  if (budgetSubs.length) console.log(`Recommended budget substitute: ${result.recommended_budget_substitute || 'none within budget'}`);
  if (result.budget_fallback_needed && !plan.budget_substitute_candidates) {
    console.log('Pattern yarn and all Ravelry substitutes are over budget or not buyable. Next: node buy/agent.js budget-subs');
  } else {
    console.log('Next: decide with buy/decision_prompt.md using run/result.json, save run/decision.json');
  }
}

// Budget fallback: popular Ravelry yarns of the same weight class, metres per 50 g within 10%, not discontinued.
async function budgetSubsStep() {
  const plan = read('plan.json');
  const result = read('result.json');
  if (!result.budget_fallback_needed) { console.log('Budget fallback not needed: pattern yarn or a substitute is within budget.'); return; }
  const main = plan.pattern.yarns[0];
  const skip = new Set([main.ravelry_yarn_id, ...plan.pattern.ravelry_alternatives.map((y) => y.ravelry_yarn_id)]);
  const found = await ravelry.searchYarns(main.weight_class, 20);
  const kept = found.filter((y) => !skip.has(y.id) && !y.discontinued && y.metres_per_50g && main.metres_per_50g &&
    Math.abs(y.metres_per_50g - main.metres_per_50g) / main.metres_per_50g <= 0.1);
  const detailed = await ravelry.fetchYarns(kept.map((y) => y.id));
  const ranked = subs.rankBudget(main, detailed, 5);
  plan.budget_substitute_candidates = ranked;
  plan.idealo_queries = [
    ...plan.idealo_queries.filter((q) => q.kind !== 'budget_substitute'),
    ...ranked.map((y) => ({ kind: 'budget_substitute', key: yarnKey(y), query: yarnKey(y), country: process.env.IDEALO_COUNTRY || 'DE' })),
  ];
  write('plan.json', plan);
  console.log(`Ravelry ${main.weight_class} yarns by popularity: ${found.length}; within 10% of ${main.metres_per_50g} m/50 g and not discontinued: ${kept.length}`);
  for (const y of ranked) console.log(`Budget substitute candidate: ${yarnKey(y)} [${y.match_score}] ${y.metres_per_50g} m/50 g, ${y.fibre}. ${y.trade_offs.join('; ')}`);
  console.log(ranked.length
    ? 'Next: search the kind "budget_substitute" idealo_queries (one get_product_offers each), add them to run/buy/offers.json, then: node buy/agent.js finish'
    : 'No budget substitutes found. Next: decide with buy/decision_prompt.md using run/result.json');
}

// One pattern line per distinct strand; a yarn held double needs twice the pattern metres.
function heldPattern(pattern, combo) {
  const need = pattern.yarns[0].total_metres;
  const byKey = new Map();
  for (const st of combo.strands) {
    const k = yarnKey(st);
    if (byKey.has(k)) byKey.get(k).total_metres += need;
    else byKey.set(k, { brand: st.brand, name: st.name, colour: null, fibre: st.fibre || null, weight_class: st.weight_class || null,
      metres_per_skein: st.metres_per_skein, skein_grams: st.skein_grams, role: 'held_together', total_metres: need });
  }
  return { ...pattern, yarns: [...byKey.values()] };
}

function heldTogetherStep() {
  const plan = read('plan.json');
  const main = plan.pattern.yarns[0];
  const fromStash = plan.stash.map((s) => ({ brand: s.brand, name: s.name, fibre: s.fibre || null, from_stash: true,
    metres_per_skein: s.metres_per_skein, skein_grams: s.skein_grams,
    metres_per_50g: s.metres_per_skein && s.skein_grams ? Math.round((s.metres_per_skein / s.skein_grams) * 50) : null }));
  const pool = [...fromStash, ...plan.pattern.ravelry_alternatives, ...(plan.budget_substitute_candidates || [])];
  const combos = subs.heldTogether(main, pool, 10);
  plan.held_together_candidates = combos;
  // idealo only for strands the stash does not cover and that are not searched yet.
  const searched = new Set(plan.idealo_queries.filter((q) => q.kind !== 'held_together').map((q) => q.key));
  const missing = new Set();
  for (const c of combos) {
    const r = calc({ stash: plan.stash, needles_owned: plan.needles_owned, budget: plan.budget, offers: {}, pattern: heldPattern(plan.pattern, c) });
    for (const l of r.lines) if (l.skeins_to_buy > 0 && !searched.has(l.yarn)) missing.add(l.yarn);
  }
  plan.idealo_queries = [
    ...plan.idealo_queries.filter((q) => q.kind !== 'held_together'),
    ...[...missing].map((k) => ({ kind: 'held_together', key: k, query: k, country: process.env.IDEALO_COUNTRY || 'DE' })),
  ];
  write('plan.json', plan);
  console.log(`Held-together combinations within 10% of ${main.metres_per_50g} m/50 g: ${combos.length}`);
  for (const c of combos) console.log(`Held together: ${c.label}: ${c.effective_metres_per_50g} m/50 g (${c.metres_diff_pct}% off), ${c.stash_strands} strand(s) from stash. ${c.trade_offs.join('; ')}`);
  console.log(missing.size
    ? `Next: search the kind "held_together" idealo_queries (${[...missing].join(', ')}), add them to run/buy/offers.json, then: node buy/agent.js finish`
    : 'No idealo searches needed for held-together strands. Next: node buy/agent.js finish');
}

// Which yarns a decision actually uses, with metres needed and skeins bought, taken from result.json.
// decision.substitute names the chosen option: a held-together label, or a substitute / budget substitute yarn key.
function usesFor(result, plan, dec) {
  const line = result.lines.find((l) => l.yarn === dec.yarn) || (result.lines.length === 1 && !dec.yarn ? result.lines[0] : null);
  if (!line) throw new Error(`Decision yarn ${JSON.stringify(dec.yarn)} is not a line in result.json (${result.lines.map((l) => l.yarn).join(', ')})`);
  const fromLine = (l, spec) => ({ brand: spec.brand, name: spec.name, colour: spec.colour || null,
    metres_per_skein: spec.metres_per_skein, skein_grams: spec.skein_grams,
    metres_needed: l.needed_metres, skeins_bought: l.skeins_to_buy });
  if (dec.action === 'SUBSTITUTE') {
    const held = (result.held_together || []).find((h) => h.label === dec.substitute);
    if (held) {
      return held.lines.map((l) => fromLine(l, held.strands.find((st) => yarnKey(st) === l.yarn)));
    }
    const sub = [...(result.substitutes || []), ...(result.budget_substitutes || [])].find((x) => x.line.yarn === dec.substitute);
    if (sub) return [fromLine(sub.line, sub.candidate)];
    throw new Error(`SUBSTITUTE needs "substitute" set to a held_together label or substitute yarn in result.json (got ${JSON.stringify(dec.substitute)})`);
  }
  if (dec.action === 'USE_STASH' || dec.action === 'BUY_ORIGINAL' || dec.action === 'ASK_USER') {
    const main = plan.pattern.yarns.find((y) => yarnKey(y) === line.yarn) || plan.pattern.yarns[0];
    return [fromLine(line, { ...(dec.yarn_spec || {}), ...main })];
  }
  return [];
}

function confirm() {
  const result = read('result.json');
  const plan = read('plan.json');
  const decision = read('decision.json');
  // The knitter said yes: an open ASK_USER is treated as buying the pattern yarn.
  for (const d of decision.decisions) if (d.action === 'ASK_USER') console.log(`${d.yarn}: ASK_USER approved, treated as BUY_ORIGINAL.`);
  const uses = decision.decisions.flatMap((d) => usesFor(result, plan, d));
  const needlesBought = (result.needles || []).filter((n) => !n.owned && n.zing && n.zing.best_in_stock)
    .map((n) => ({ type: n.type, mm: n.mm, brand: 'KnitPro Zing' }));
  const total = decision.basket_total_eur || 0;
  const metres = uses.reduce((a, u) => a + (u.metres_needed || 0), 0);
  const s = stash.load();
  s.budget.history = [...(s.budget.history || []), {
    project: result.pattern, total_eur: total, per_100m_eur: metres ? Math.round((total / metres) * 100 * 100) / 100 : 0,
  }];
  stash.applyUses(s, uses, needlesBought);
  const file = stash.save(s);
  for (const u of uses) console.log(`Used ${u.brand} ${u.name}: ${u.metres_needed} m${u.skeins_bought ? `, bought ${u.skeins_bought} skeins` : ' from stash'}`);
  for (const n of needlesBought) console.log(`Added needle: KnitPro Zing ${n.mm} mm`);
  console.log(`Stash and budget history updated in ${path.basename(file)} (private, gitignored).`);
}

(async () => {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === 'inspect') { const { pattern } = await ravelry.fetchPattern(a); console.log(JSON.stringify(pattern, null, 2)); }
    else if (cmd === 'prepare') await prepare(a, b);
    else if (cmd === 'finish') finish();
    else if (cmd === 'budget-subs') await budgetSubsStep();
    else if (cmd === 'held-together') heldTogetherStep();
    else if (cmd === 'confirm') confirm();
    else if (cmd === 'stash') console.log(JSON.stringify(stash.load().stash, null, 2));
    else if (cmd === 'stash-add') console.log(`Saved to ${stash.add(JSON.parse(a))}`);
    else console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 15).join('\n'));
  } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
})();
