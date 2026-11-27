// Ranks substitute candidates against the pattern yarn. The decision step makes the final call.
const ORDER = ['lace', 'fingering', 'sport', 'dk', 'worsted', 'aran', 'bulky', 'super_bulky'];

const FAMILIES = [
  ['animal', /wool|merino|alpaca|cashmere|mohair|yak|camel|silk|angora|llama/i],
  ['plant', /cotton|linen|hemp|bamboo|viscose|lyocell|tencel/i],
  ['synthetic', /acrylic|nylon|polyamide|polyester/i],
];
const family = (f) => (FAMILIES.find(([, re]) => re.test(f || '')) || ['unknown'])[0];

function score(original, cand) {
  const tradeOffs = [];
  let s = 100;
  const wo = ORDER.indexOf(original.weight_class);
  // A yarn held doubled counts as roughly two weight classes heavier.
  const wc = ORDER.indexOf(cand.weight_class) + (cand.held_doubled ? 2 : 0);
  const wDiff = wo >= 0 && wc >= 0 ? Math.abs(wo - wc) : 2;
  if (wDiff === 1) { s -= 25; tradeOffs.push(`${cand.weight_class}${cand.held_doubled ? ' held doubled' : ''} vs ${original.weight_class}: fabric will be ${wc < wo ? 'lighter and thinner' : 'denser and heavier'}, swatch first`); }
  // Ravelry suggestions were knitted by real people, so a bigger weight gap is a warning, not a veto.
  if (wDiff >= 2) { s -= 40; tradeOffs.push(`${cand.weight_class} vs ${original.weight_class}: much lighter or heavier, needs a new swatch and maybe a different needle`); }

  const mo = original.metres_per_50g;
  const mc = cand.metres_per_50g ? cand.metres_per_50g / (cand.held_doubled ? 2 : 1) : null;
  if (mo && mc) {
    const diff = Math.abs(mc - mo) / mo;
    if (diff > 0.1) { s -= Math.min(30, Math.round(diff * 60)); tradeOffs.push(`${Math.round(mc)} m/50 g vs ${mo} m/50 g`); }
  }
  if (family(original.fibre) !== family(cand.fibre)) { s -= 20; tradeOffs.push(`fibre changes: ${cand.fibre || 'unknown'} instead of ${original.fibre || 'unknown'}`); }
  if (cand.discontinued) s -= 50;
  return { ...cand, match_score: Math.max(0, s), trade_offs: tradeOffs };
}

function rank(original, candidates, limit = 3) {
  return candidates.map((c) => score(original, c)).filter((c) => c.match_score >= 30)
    .sort((a, b) => b.match_score - a.match_score).slice(0, limit);
}

// Budget substitutes may change fibre, but the trade-off is always stated in plain words.
const FIBRES = {
  cashmere: { soft: 5, warm: 4, care: 'hand wash only' },
  alpaca: { soft: 4, warm: 5, care: 'hand wash, can felt', extra: 'heavier, drapes and can stretch' },
  merino: { soft: 4, warm: 4, care: 'machine-washable if superwash' },
  silk: { soft: 4, warm: 2, care: 'hand wash', extra: 'drapey with a sheen' },
  mohair: { soft: 3, warm: 4, care: 'hand wash', extra: 'fuzzy halo' },
  wool: { soft: 2, warm: 4, care: 'hand wash, can felt', extra: 'can feel scratchy' },
  cotton: { soft: 3, warm: 1, care: 'machine-washable', extra: 'no stretch, heavier' },
  linen: { soft: 1, warm: 1, care: 'machine-washable', extra: 'stiff at first, softens with washing' },
  bamboo: { soft: 3, warm: 1, care: 'hand wash', extra: 'drapey, can grow' },
  acrylic: { soft: 2, warm: 2, care: 'machine-washable', extra: 'less breathable, may pill' },
  nylon: { soft: 2, warm: 2, care: 'machine-washable', extra: 'hard-wearing' },
};
function mainFibre(fibre) {
  const parts = (fibre || '').split(',').map((p) => ({ pct: parseFloat(p) || 0, text: p.toLowerCase() }))
    .sort((a, b) => b.pct - a.pct);
  for (const { text } of parts) {
    const key = Object.keys(FIBRES).find((k) => text.includes(k) || (k === 'nylon' && /polyamide/.test(text)));
    if (key) return key;
  }
  return null;
}
function fibreNotes(o, c) {
  const fo = FIBRES[o]; const fc = FIBRES[c];
  const notes = [];
  if (fc.soft !== fo.soft) notes.push(fc.soft > fo.soft ? 'softer' : 'less soft');
  if (fc.warm !== fo.warm) notes.push(fc.warm > fo.warm ? 'warmer' : 'less warm');
  notes.push(fc.care);
  if (fc.extra) notes.push(fc.extra);
  return notes;
}
function fibreTradeOff(original, cand) {
  const o = mainFibre(original.fibre);
  const c = mainFibre(cand.fibre);
  if (!o || !c || o === c) return null;
  return `${c} instead of ${o}: ${fibreNotes(o, c).join(', ')}`;
}
function rankBudget(original, candidates, limit = 5) {
  return candidates.map((c) => {
    const s = score(original, c);
    const fibre = fibreTradeOff(original, c);
    const tradeOffs = s.trade_offs.filter((t) => !t.startsWith('fibre changes:'));
    if (fibre) tradeOffs.push(fibre);
    else if (family(original.fibre) !== family(c.fibre)) tradeOffs.push(`fibre changes: ${c.fibre || 'unknown'} instead of ${original.fibre || 'unknown'}`);
    return { ...s, trade_offs: tradeOffs, budget_substitute: true };
  }).sort((a, b) => b.match_score - a.match_score).slice(0, limit);
}

// Held-together combinations: one yarn held double, or two different yarns held together.
// Effective metres per gram = 1 / (1/a + 1/b); keep within 10% of the pattern yarn's metres per 50 g.
// Pool order matters: stash yarns first, then Ravelry suggestions, then budget substitutes.
const keyOf = (y) => `${y.brand} ${y.name}`.toLowerCase();
function heldTradeOff(original, strands, label) {
  const o = mainFibre(original.fibre);
  const notes = [];
  for (const st of strands) {
    // Stash entries often have no fibre; from the name, mohair wins (e.g. "Tynn Silk Mohair").
    const c = !st.fibre && /mohair/i.test(st.name || '') ? 'mohair' : mainFibre(st.fibre || st.name);
    if (c === 'mohair') notes.push('fuzzy halo', `lighter and airier than ${o || 'the pattern yarn'}`);
    else if (o && c && c !== o) notes.push(...fibreNotes(o, c));
  }
  if (strands.length === 2 && keyOf(strands[0]) !== keyOf(strands[1])) notes.push('two strands blend into a marled look');
  return `${label}: ${[...new Set(notes), 'swatch first'].join(', ')}`;
}
function heldTogether(original, pool, limit = 10) {
  const target = original.metres_per_50g;
  if (!target) return [];
  const yarns = [];
  for (const y of pool) {
    if (!y.metres_per_50g || keyOf(y) === keyOf(original) || yarns.some((x) => keyOf(x) === keyOf(y))) continue;
    yarns.push(y);
  }
  const combos = [];
  for (let i = 0; i < yarns.length; i++) {
    for (let j = i; j < yarns.length; j++) {
      const a = yarns[i].metres_per_50g / 50; const b = yarns[j].metres_per_50g / 50;
      const eff = Math.round(50 / (1 / a + 1 / b));
      const diff = Math.abs(eff - target) / target;
      if (diff > 0.1) continue;
      const strands = i === j ? [yarns[i], yarns[i]] : [yarns[i], yarns[j]];
      const label = i === j ? `${yarns[i].brand} ${yarns[i].name} held double` : `${yarns[i].brand} ${yarns[i].name} + ${yarns[j].brand} ${yarns[j].name} held together`;
      combos.push({
        label, held_together: true, strands, effective_metres_per_50g: eff,
        metres_diff_pct: Math.round(diff * 100),
        stash_strands: strands.filter((st) => st.from_stash).length,
        trade_offs: [heldTradeOff(original, strands, label)],
      });
    }
  }
  // Keep the 10 most promising: more stash strands first, then closest to the pattern yarn.
  return combos.sort((x, y) => y.stash_strands - x.stash_strands || x.metres_diff_pct - y.metres_diff_pct).slice(0, limit);
}

module.exports = { rank, score, family, rankBudget, fibreTradeOff, heldTogether };
