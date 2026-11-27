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

module.exports = { rank, score, family };
