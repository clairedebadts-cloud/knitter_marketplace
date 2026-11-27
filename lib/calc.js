// Knitter Marketplace: stash gap, skeins to buy, price per 100 m, budget check (per skein + project total).
// Works in an n8n Code node ("Run Once for All Items") or plain Node.
// Input: { pattern, stash, needles_owned, budget, offers }
//   offers: { "<brand> <name>": [ idealo offer objects from get_product_offers ],
//             "KnitPro Zing <mm> mm": [ needle offers ] }

function parsePrice(s) {
  if (s == null) return null;
  if (typeof s === 'number') return s;
  if (s.includes('£')) return parseFloat(s.replace(/[^\d.]/g, ''));
  return parseFloat(s.replace(/[^\d,]/g, '').replace(',', '.')); // "1.059,00 €" -> 1059
}

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const keyOf = (y) => `${y.brand} ${y.name}`;
const needleKey = (mm) => `KnitPro Zing ${mm} mm`;

function neededMetres(yarn, size) {
  if (size && yarn.skeins_by_size && yarn.skeins_by_size[size] != null) {
    return yarn.skeins_by_size[size] * yarn.metres_per_skein;
  }
  return yarn.total_metres;
}

// Stash check with the dye-lot rule: only one lot counts toward the main body.
function stashFor(yarn, stash) {
  const matches = stash.filter(
    (s) => norm(s.brand) === norm(yarn.brand) && norm(s.name) === norm(yarn.name) &&
      (!yarn.colour || norm(s.colour) === norm(yarn.colour))
  );
  const lots = matches.map((s) => ({
    dye_lot: s.dye_lot,
    metres: (s.grams / s.skein_grams) * s.metres_per_skein,
  }));
  const total = lots.reduce((a, l) => a + l.metres, 0);
  const biggest = lots.reduce((a, l) => Math.max(a, l.metres), 0);
  return { lots, total_metres: Math.round(total), usable_one_lot_metres: Math.round(biggest) };
}

// Long-term budget only when 3+ past projects sit within 20% of their median.
function longTermBudget(history) {
  if (!history || history.length < 3) return null;
  const v = history.map((h) => h.per_100m_eur).sort((a, b) => a - b);
  const median = v[Math.floor(v.length / 2)];
  const consistent = v.every((x) => Math.abs(x - median) / median <= 0.2);
  if (!consistent) return null;
  return { min_per_100m_eur: v[0], max_per_100m_eur: v[v.length - 1], based_on: v.length };
}

// When get_product_offers returns nothing but search_products listed a price,
// use that search price as an indicative offer (offers._search_prices[key] = { price, url }).
const INDICATIVE_FLAG = 'Indicative price: offers not returned by the idealo trial API, check the link';
function offersFor(offers, key) {
  const list = offers[key] || [];
  const sp = offers._search_prices && offers._search_prices[key];
  if (list.length || !sp || sp.price == null) return list;
  return [{ price: sp.price, minShippingCost: null, shop: { name: 'idealo (from price)' }, delivery: null, relocatorUrl: sp.url, indicative: true }];
}

function bestOffer(offers, skeins, metresPerSkein) {
  const priced = (offers || [])
    .map((o) => {
      const unit = parsePrice(o.price);
      const ship = parsePrice(o.minShippingCost) || 0;
      return {
        shop: o.shop && o.shop.name,
        rating: o.shop && o.shop.rating ? o.shop.rating.avg : null,
        in_stock: o.delivery ? o.delivery.deliveryStatus !== 'NOT_AVAILABLE' : true,
        delivery: o.delivery ? o.delivery.deliveryText : null,
        unit_price_eur: unit,
        total_eur: Math.round((unit * skeins + ship) * 100) / 100,
        per_100m_eur: metresPerSkein ? Math.round((unit / metresPerSkein) * 100 * 100) / 100 : null,
        url: o.relocatorUrl,
        indicative: !!o.indicative,
      };
    })
    .filter((o) => o.unit_price_eur != null)
    .sort((a, b) => a.total_eur - b.total_eur); // lowest total first
  const inStock = priced.filter((o) => o.in_stock);
  return { best_in_stock: inStock[0] || null, cheapest_any: priced[0] || null, offers_seen: priced.length, all: priced };
}

function run(input) {
  const { pattern, stash = [], needles_owned = [], budget = {}, offers = {} } = input;
  const size = pattern.selected_size;
  const lt = longTermBudget(budget.history);
  const st = budget.short_term || {};
  const maxPerSkein = st.max_per_skein_eur ?? null;
  // Per-100 m limit only if set explicitly, or as a fallback when no per-skein limit exists.
  const maxPer100 = st.max_per_100m_eur ?? (maxPerSkein == null && lt ? lt.max_per_100m_eur : null);

  const lines = pattern.yarns.map((y) => {
    const need = Math.round(neededMetres(y, size) || 0);
    const s = stashFor(y, stash);
    const flags = [];
    let have = s.usable_one_lot_metres;
    if (s.lots.length > 1 && s.total_metres >= need && s.usable_one_lot_metres < need) {
      flags.push('Stash covers the metres only by mixing dye lots: alternate 2-row stripes or use the second lot for ribbing.');
    }
    const gap = Math.max(0, need - have);
    const skeins = gap > 0 ? Math.ceil(gap / y.metres_per_skein) : 0;
    const offer = skeins > 0 ? bestOffer(offersFor(offers, keyOf(y)), skeins, y.metres_per_skein) : null;

    if (offer && offer.cheapest_any && offer.best_in_stock &&
        offer.cheapest_any.shop !== offer.best_in_stock.shop) {
      flags.push('Cheapest shop is out of stock.');
    }
    if (offer && !offer.best_in_stock) flags.push('Not in stock anywhere: substitute needed.');
    if (offer && offer.best_in_stock && offer.best_in_stock.indicative) flags.push(INDICATIVE_FLAG);
    // Per-100 m budget applies to main/contrast yarns only: mohair held together is pricey per metre by nature.
    if (offer && offer.best_in_stock && maxPer100 && y.role !== 'held_together' &&
        offer.best_in_stock.per_100m_eur > maxPer100) {
      flags.push(`Over budget: ${offer.best_in_stock.per_100m_eur} €/100 m vs max ${maxPer100}.`);
    }
    if (offer && offer.best_in_stock && maxPerSkein != null && offer.best_in_stock.unit_price_eur > maxPerSkein) {
      flags.push(`Over budget: ${offer.best_in_stock.unit_price_eur} €/skein vs max ${maxPerSkein}.`);
    }
    return {
      yarn: keyOf(y), colour: y.colour, weight_class: y.weight_class, fibre: y.fibre,
      needed_metres: need, stash: s, gap_metres: gap, skeins_to_buy: skeins,
      offer, flags, needs_substitute: flags.some((f) => /substitute|Over budget/.test(f)),
    };
  });

  const owns = (n) => needles_owned.some((o) => o.mm === n.mm && (n.type === 'any' || o.type === n.type) &&
    (!n.length_cm || o.length_cm === n.length_cm));
  const missingNeedles = (pattern.needles || []).filter((n) => !owns(n));
  // KnitPro Zing price for every pattern needle; only missing ones count toward the total.
  const needles = (pattern.needles || []).map((n) => ({
    ...n, owned: owns(n), zing: bestOffer(offersFor(offers, needleKey(n.mm)), 1, null),
  }));
  const yarnTotal = lines.reduce((a, l) => a + (l.offer && l.offer.best_in_stock ? l.offer.best_in_stock.total_eur : 0), 0);
  const needleTotal = needles.reduce((a, n) => a + (!n.owned && n.zing.best_in_stock ? n.zing.best_in_stock.total_eur : 0), 0);
  const basketTotal = yarnTotal + needleTotal;

  return {
    pattern: pattern.pattern_name, size, lines, missing_needles: missingNeedles, needles,
    yarn_total_eur: Math.round(yarnTotal * 100) / 100,
    needle_total_eur: Math.round(needleTotal * 100) / 100,
    basket_total_eur: Math.round(basketTotal * 100) / 100,
    budget: { short_term: st, long_term: lt,
      over_total: st.max_total_eur ? basketTotal > st.max_total_eur : false },
  };
}

// n8n: return [{ json: run($input.first().json) }];
if (typeof module !== 'undefined') module.exports = { run, parsePrice, longTermBudget, needleKey };
