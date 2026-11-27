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

// After a project: remove the metres used from the stash, add bought yarn, keep leftovers.
function applyProject(result, decisions) {
  const d = load();
  for (const line of result.lines) {
    const dec = (decisions || []).find((x) => x.yarn === line.yarn) || {};
    let toUse = line.needed_metres;
    for (const s of d.stash) {
      if (toUse <= 0) break;
      if (`${s.brand} ${s.name}`.toLowerCase() !== line.yarn.toLowerCase()) continue;
      const metres = (s.grams / s.skein_grams) * s.metres_per_skein;
      const used = Math.min(metres, toUse);
      s.grams = Math.round(((metres - used) / s.metres_per_skein) * s.skein_grams);
      toUse -= used;
    }
    if (dec.action === 'BUY_ORIGINAL' || dec.action === 'SUBSTITUTE') {
      const y = dec.yarn_spec || {};
      const bought = (dec.skeins || 0) * (y.metres_per_skein || 0);
      const left = Math.max(0, bought - Math.max(0, toUse));
      if (left > 0 && y.skein_grams) {
        d.stash.push({ brand: y.brand, name: y.name, colour: y.colour || null, dye_lot: 'new',
          grams: Math.round((left / y.metres_per_skein) * y.skein_grams),
          metres_per_skein: y.metres_per_skein, skein_grams: y.skein_grams });
      }
    }
  }
  d.stash = d.stash.filter((s) => s.grams > 0);
  return save(d);
}

module.exports = { load, save, add, applyProject };
