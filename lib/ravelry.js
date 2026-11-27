// Ravelry API: pattern + suggested yarns, normalised into the shape lib/calc.js expects.
// FIELD NAMES ARE BEST GUESSES: run `node agent.js inspect <url>` first and fix the mapping below.
const fs = require('fs');
const path = require('path');

const BASE = 'https://api.ravelry.com';
const YD = 0.9144;
const CACHE = path.join(__dirname, '..', 'run', 'cache');

const WEIGHTS = {
  thread: 'lace', cobweb: 'lace', lace: 'lace', 'light fingering': 'fingering', fingering: 'fingering',
  sport: 'sport', dk: 'dk', worsted: 'worsted', aran: 'aran', bulky: 'bulky', 'super bulky': 'super_bulky', jumbo: 'super_bulky',
};
const weightClass = (name) => (name ? WEIGHTS[name.toLowerCase().replace(/\s*\(.*\)/, '').trim()] || null : null);

function auth(kind = 'READ') {
  const u = process.env[`RAVELRY_${kind}_USERNAME`];
  const p = process.env[`RAVELRY_${kind}_PASSWORD`];
  if (!u || !p) throw new Error(`Missing RAVELRY_${kind}_USERNAME / PASSWORD in .env`);
  return 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
}

async function get(urlPath, kind = 'READ') {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, urlPath.replace(/[^a-z0-9]+/gi, '_') + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch(BASE + urlPath, { headers: { Authorization: auth(kind) } });
  if (!res.ok) throw new Error(`Ravelry ${res.status} on ${urlPath}`);
  const json = await res.json();
  fs.writeFileSync(file, JSON.stringify(json, null, 2));
  return json;
}

const permalinkOf = (url) => url.replace(/\/$/, '').split('/').pop();

async function findPatternId(url) {
  const permalink = permalinkOf(url);
  const q = encodeURIComponent(permalink.replace(/-\d+$/, '').replace(/-/g, ' '));
  const res = await get(`/patterns/search.json?query=${q}&page_size=20`);
  const hit = (res.patterns || []).find((p) => p.permalink === permalink) || (res.patterns || [])[0];
  if (!hit) throw new Error(`No Ravelry pattern found for ${permalink}`);
  return hit.id;
}

function normaliseYarn(y, extra = {}) {
  const fibres = (y.yarn_fibers || []).map((f) => `${f.percentage}% ${f.fiber_type ? f.fiber_type.name : ''}`.trim());
  const grams = y.grams || null;
  const metres = y.yardage ? Math.round(y.yardage * YD) : null;
  return {
    ravelry_yarn_id: y.id,
    brand: y.yarn_company_name || (y.yarn_company && y.yarn_company.name) || null,
    name: y.name,
    fibre: fibres.join(', ') || null,
    weight_class: weightClass(y.yarn_weight && y.yarn_weight.name),
    skein_grams: grams,
    metres_per_skein: metres,
    metres_per_50g: grams && metres ? Math.round((metres / grams) * 50) : null,
    discontinued: !!y.discontinued,
    ...extra,
  };
}

// Turns Ravelry JSON into { pattern_name, yarns:[main], ravelry_alternatives:[...], needles, gauge, metres_range }
function normalisePattern(p, yarnsById, size) {
  const yMin = p.yardage ? Math.round(p.yardage * YD) : null;
  const yMax = p.yardage_max ? Math.round(p.yardage_max * YD) : yMin;
  const patternWeight = weightClass(p.yarn_weight && p.yarn_weight.name);

  const suggested = (p.packs || [])
    .filter((pk) => pk.yarn_id && yarnsById[pk.yarn_id])
    .map((pk) => normaliseYarn(yarnsById[pk.yarn_id], {
      held_doubled: /double|held together|2 strands/i.test(pk.quantity_description || pk.notes || ''),
      pack_total_metres: pk.total_yards ? Math.round(pk.total_yards * YD) : null,
    }));

  const mainIdx = Math.max(0, suggested.findIndex((y) => y.weight_class === patternWeight));
  const main = suggested[mainIdx] || { brand: null, name: 'Unknown yarn', weight_class: patternWeight };

  return {
    source: 'ravelry',
    ravelry_pattern_id: p.id,
    pattern_name: p.name,
    designer: p.pattern_author ? p.pattern_author.name : null,
    selected_size: size || null,
    sizes_available: p.sizes_available || null,
    weight_class: patternWeight,
    metres_range: [yMin, yMax],
    gauge: { stitches: p.gauge || null, rows: p.row_gauge || null, per_cm: 10, pattern: p.gauge_pattern || null },
    needles: (p.pattern_needle_sizes || []).map((n) => ({ type: 'any', mm: n.metric, us: n.us || null })),
    yarns: [{
      ...main, role: 'main', colour: null,
      // Ravelry gives a total for the pattern; use the top of the range to be safe.
      total_metres: main.pack_total_metres || yMax,
    }],
    ravelry_alternatives: suggested.filter((_, i) => i !== mainIdx),
  };
}

async function fetchPattern(url, size) {
  const id = await findPatternId(url);
  const pRes = await get(`/patterns.json?ids=${id}`);
  const p = pRes.patterns ? pRes.patterns[id] || Object.values(pRes.patterns)[0] : pRes.pattern;
  const yarnIds = [...new Set((p.packs || []).map((pk) => pk.yarn_id).filter(Boolean))];
  let yarnsById = {};
  if (yarnIds.length) {
    const yRes = await get(`/yarns.json?ids=${yarnIds.join('+')}`);
    yarnsById = yRes.yarns || {};
  }
  return { raw: p, pattern: normalisePattern(p, yarnsById, size) };
}

// Optional: the user's real Ravelry stash (personal credentials). Shape unconfirmed.
async function fetchStash() {
  const user = process.env.RAVELRY_ACCOUNT_NAME;
  if (!user || !process.env.RAVELRY_PERSONAL_USERNAME) return null;
  const list = await get(`/people/${user}/stash/list.json`, 'PERSONAL');
  return list.stash || [];
}

module.exports = { fetchPattern, fetchStash, normalisePattern, normaliseYarn, weightClass, get };
