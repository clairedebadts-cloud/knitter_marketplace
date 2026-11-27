// Stash: what the knitter already owns. Real data lives in stash.local.json (gitignored);
// falls back to the demo stash in 2_stash_and_memory.json.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOCAL = path.join(ROOT, 'stash.local.json');
const DEMO = path.join(ROOT, 'lib', 'demo_stash.json');

function load() {
  const file = fs.existsSync(LOCAL) ? LOCAL : DEMO;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { file, stash: data.stash || [], needles_owned: data.needles_owned || [], budget: data.budget || {} };
}

function save(data) {
  // Always write to the local (private) file, never to the committed demo file.
  fs.writeFileSync(LOCAL, JSON.stringify({ stash: data.stash, needles_owned: data.needles_owned, budget: data.budget }, null, 2));
  return LOCAL;
}

function add(entry) {
  const d = load();
  d.stash.push(entry);
  return save(d);
}

// After a project: for every yarn actually used (pattern yarn, substitute or held-together strand),
// take the metres from the stash (biggest dye lot first), add what was bought, keep the leftovers.
// uses: [{ brand, name, colour, metres_per_skein, skein_grams, metres_needed, skeins_bought }]
function applyUses(data, uses, needlesBought = []) {
  const key = (x) => `${x.brand} ${x.name}`.toLowerCase();
  for (const u of uses) {
    let toUse = u.metres_needed || 0;
    const lots = data.stash.filter((s) => key(s) === key(u))
      .sort((a, b) => (b.grams / b.skein_grams) * b.metres_per_skein - (a.grams / a.skein_grams) * a.metres_per_skein);
    for (const s of lots) {
      if (toUse <= 0) break;
      const metres = (s.grams / s.skein_grams) * s.metres_per_skein;
      const used = Math.min(metres, toUse);
      s.grams = Math.round(((metres - used) / s.metres_per_skein) * s.skein_grams);
      toUse -= used;
    }
    const bought = (u.skeins_bought || 0) * (u.metres_per_skein || 0);
    const left = Math.max(0, bought - Math.max(0, toUse));
    if (left > 0 && u.skein_grams) {
      data.stash.push({ brand: u.brand, name: u.name, colour: u.colour || null, dye_lot: 'new',
        grams: Math.round((left / u.metres_per_skein) * u.skein_grams),
        metres_per_skein: u.metres_per_skein, skein_grams: u.skein_grams });
    }
  }
  data.stash = data.stash.filter((s) => s.grams > 0);
  for (const n of needlesBought) {
    if (!data.needles_owned.some((o) => o.mm === n.mm && o.type === n.type)) data.needles_owned.push(n);
  }
  return data;
}

module.exports = { load, save, add, applyUses };
