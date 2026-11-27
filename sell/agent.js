#!/usr/bin/env node
// Knitter Marketplace, sell side: turn leftover stash yarn into priced listings,
// using idealo's current new price as the anchor. Claude Code calls idealo (MCP).
//
//   node sell/agent.js prepare [minGrams]   pick sellable stash items -> run/sell/plan.json (+ idealo queries)
//   (Claude Code: idealo search_products + get_product_offers, save run/sell/offers.json)
//   node sell/agent.js finish               resale prices + listing text -> run/sell/listings.json
//   node sell/agent.js reserve '<key>'      mark an item as kept for a planned project (not for sale)

const fs = require('fs');
const path = require('path');
require('../lib/env').loadEnv();
const stash = require('../lib/stash');
const { parsePrice } = require('../lib/calc');

const RUN = path.join(__dirname, '..', 'run', 'sell');
fs.mkdirSync(RUN, { recursive: true });
const read = (f) => JSON.parse(fs.readFileSync(path.join(RUN, f), 'utf8'));
const write = (f, d) => { fs.writeFileSync(path.join(RUN, f), JSON.stringify(d, null, 2)); return path.join('run', 'sell', f); };
const keyOf = (s) => `${s.brand} ${s.name}`;

// Resale share of the cheapest new price. Unopened full skeins keep more value than partial ones.
const CONDITION = { full_skeins: 0.7, partial: 0.5 };
const MIN_PRICE_EUR = 2;

function prepare(minGrams = 20) {
  const { stash: items } = stash.load();
  const sellable = items
    .filter((s) => !s.reserved && s.grams >= minGrams)
    .map((s) => {
      const full = Math.floor(s.grams / s.skein_grams);
      const partialGrams = s.grams - full * s.skein_grams;
      return { ...s, key: keyOf(s), full_skeins: full, partial_grams: partialGrams,
        metres: Math.round((s.grams / s.skein_grams) * s.metres_per_skein) };
    });
  const queries = [...new Set(sellable.map((s) => s.key))].map((k) => ({ key: k, query: k, country: process.env.IDEALO_COUNTRY || 'DE' }));
  console.log(`Plan: ${write('plan.json', { sellable, idealo_queries: queries })}`);
  sellable.forEach((s) => console.log(`- ${s.key} ${s.colour || ''}: ${s.grams} g (${s.full_skeins} full skeins + ${s.partial_grams} g), lot ${s.dye_lot}`));
  console.log('Next: idealo search for each idealo_queries[].query, save { "<key>": [offers] } to run/sell/offers.json, then: node sell/agent.js finish');
}

function price(item, offers) {
  const inStock = (offers || [])
    .map((o) => ({ unit: parsePrice(o.price), shop: o.shop && o.shop.name,
      in_stock: o.delivery ? o.delivery.deliveryStatus !== 'NOT_AVAILABLE' : true }))
    .filter((o) => o.unit != null);
  if (!inStock.length) return { anchor: null, note: 'No idealo price found: price manually or check if the yarn is discontinued (discontinued yarn can sell above this range).' };
  const avail = inStock.filter((o) => o.in_stock);
  const cheapest = (avail.length ? avail : inStock).sort((a, b) => a.unit - b.unit)[0];
  const perGram = cheapest.unit / item.skein_grams;
  const fullValue = item.full_skeins * item.skein_grams * perGram * CONDITION.full_skeins;
  const partialValue = item.partial_grams * perGram * CONDITION.partial;
  const suggested = Math.max(MIN_PRICE_EUR, Math.round((fullValue + partialValue) * 2) / 2);
  return {
    anchor: { new_price_per_skein_eur: cheapest.unit, shop: cheapest.shop, new_value_eur: Math.round(item.grams * perGram * 100) / 100,
      in_stock_new: avail.length > 0 },
    suggested_price_eur: suggested,
    range_eur: [Math.max(MIN_PRICE_EUR, Math.round(suggested * 0.85)), Math.round(suggested * 1.15)],
    note: avail.length ? null : 'Not in stock new anywhere: buyers matching a dye lot may pay more.',
  };
}

function listingText(item, p) {
  const parts = [];
  if (item.full_skeins) parts.push(`${item.full_skeins} full skein${item.full_skeins > 1 ? 's' : ''}`);
  if (item.partial_grams) parts.push(`${item.partial_grams} g partial`);
  return `${item.key}${item.colour ? `, colour ${item.colour}` : ''}. ${parts.join(' + ')} (${item.grams} g, about ${item.metres} m), dye lot ${item.dye_lot}. `
    + (p.anchor ? `New from ${p.anchor.new_price_per_skein_eur.toFixed(2)} € per skein on idealo.` : '');
}

function finish() {
  const plan = read('plan.json');
  const offers = fs.existsSync(path.join(RUN, 'offers.json')) ? read('offers.json') : {};
  const listings = plan.sellable.map((item) => {
    const p = price(item, offers[item.key]);
    return { item: item.key, colour: item.colour, grams: item.grams, dye_lot: item.dye_lot, ...p, listing: listingText(item, p) };
  });
  const total = listings.reduce((a, l) => a + (l.suggested_price_eur || 0), 0);
  console.log(`Listings: ${write('listings.json', { listings, total_suggested_eur: total })}`);
  listings.forEach((l) => console.log(`- ${l.item}: ${l.suggested_price_eur != null ? `${l.suggested_price_eur} € (range ${l.range_eur.join('-')} €)` : 'no price'}${l.note ? ` | ${l.note}` : ''}`));
  console.log(`Total if all sell: ${total} €`);
}

function reserve(key) {
  const d = stash.load();
  let n = 0;
  d.stash.forEach((s) => { if (keyOf(s).toLowerCase() === key.toLowerCase()) { s.reserved = true; n++; } });
  console.log(`Reserved ${n} item(s), saved to ${path.basename(stash.save(d))}`);
}

const [cmd, a] = process.argv.slice(2);
try {
  if (cmd === 'prepare') prepare(a ? Number(a) : undefined);
  else if (cmd === 'finish') finish();
  else if (cmd === 'reserve') reserve(a);
  else console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 9).join('\n'));
} catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
