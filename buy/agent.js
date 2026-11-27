#!/usr/bin/env node
// Knitter Marketplace agent. Claude Code calls idealo (MCP); this script does everything else.
//
//   node buy/agent.js inspect <ravelry-url>          raw Ravelry JSON (check field names first)
//   node buy/agent.js prepare <ravelry-url> <size>   pattern + stash + budget -> run/plan.json (+ idealo queries)
//   (Claude Code: run idealo searches, save offers to run/offers.json)
//   node buy/agent.js finish                         calc + substitutes -> run/result.json
//   (Claude Code: decide with buy/decision_prompt.md, save run/decision.json)
//   node buy/agent.js confirm                        update stash + budget history after "yes, buy it"
//   node buy/agent.js stash                          list stash
//   node buy/agent.js stash-add '<json>'             add a yarn to the stash

const fs = require('fs');
const path = require('path');
require('../lib/env').loadEnv();
const ravelry = require('../lib/ravelry');
const stash = require('../lib/stash');
const { run: calc, longTermBudget } = require('../lib/calc');
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
    idealo_queries: [main, ...candidates].map((y) => ({ key: yarnKey(y), query: yarnKey(y), country: process.env.IDEALO_COUNTRY || 'DE' })),
  };
  console.log(`Plan: ${write('plan.json', plan)}`);
  console.log(`Pattern yarn: ${yarnKey(main)} (${main.weight_class}, ${main.total_metres} m)`);
  console.log(`Substitute candidates: ${candidates.map((c) => `${yarnKey(c)} [${c.match_score}]`).join(', ') || 'none'}`);
  console.log('Next: run idealo search_products + get_product_offers for each idealo_queries[].query,');
  console.log('save { "<key>": [offers...] } to run/offers.json, then: node buy/agent.js finish');
}

function finish() {
  const plan = read('plan.json');
  const offers = fs.existsSync(path.join(RUN, 'offers.json')) ? read('offers.json') : {};
  const base = { stash: plan.stash, needles_owned: plan.needles_owned, budget: plan.budget, offers };
  const original = calc({ ...base, pattern: plan.pattern });

  // Price every substitute as if it were the pattern yarn (its own metres per skein).
  const substitutes = plan.substitute_candidates.map((c) => {
    const p = { ...plan.pattern, yarns: [{ ...c, role: 'main', colour: null, total_metres: plan.pattern.yarns[0].total_metres }] };
    const r = calc({ ...base, pattern: p });
    return { candidate: c, line: r.lines[0], basket_total_eur: r.basket_total_eur };
  });

  const result = { ...original, substitutes, long_term_budget: plan.long_term_budget };
  console.log(`Result: ${write('result.json', result)}`);
  for (const l of original.lines) console.log(`${l.yarn}: need ${l.needed_metres} m, stash ${l.stash.usable_one_lot_metres} m, buy ${l.skeins_to_buy} skeins. ${l.flags.join(' ')}`);
  console.log('Next: decide with buy/decision_prompt.md using run/result.json, save run/decision.json');
}

function confirm() {
  const result = read('result.json');
  const decision = read('decision.json');
  const s = stash.load();
  const total = decision.basket_total_eur || 0;
  const metres = result.lines.reduce((a, l) => a + l.needed_metres, 0);
  s.budget.history = [...(s.budget.history || []), {
    project: result.pattern, total_eur: total, per_100m_eur: metres ? Math.round((total / metres) * 100 * 100) / 100 : 0,
  }];
  stash.save(s);
  const file = stash.applyProject(result, decision.decisions);
  console.log(`Stash and budget history updated in ${path.basename(file)} (private, gitignored).`);
}

(async () => {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === 'inspect') { const { pattern } = await ravelry.fetchPattern(a); console.log(JSON.stringify(pattern, null, 2)); }
    else if (cmd === 'prepare') await prepare(a, b);
    else if (cmd === 'finish') finish();
    else if (cmd === 'confirm') confirm();
    else if (cmd === 'stash') console.log(JSON.stringify(stash.load().stash, null, 2));
    else if (cmd === 'stash-add') console.log(`Saved to ${stash.add(JSON.parse(a))}`);
    else console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 13).join('\n'));
  } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
})();
