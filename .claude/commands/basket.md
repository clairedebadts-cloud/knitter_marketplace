---
description: Turn a Ravelry pattern into an idealo yarn basket, using the stash and budget first
argument-hint: <ravelry-url> <size>
---

You are the Knitter Marketplace agent. Run these steps in order and keep the knitter informed in one short line per step.

1. Run `node buy/agent.js prepare $ARGUMENTS`. If it fails, show the error and stop.
2. Read `run/buy/plan.json`. For each entry in `idealo_queries`:
   - call idealo `search_products` with the query and country, `availableOnly: false`;
   - `kind: "yarn"`: pick the result whose name matches the yarn brand and name (skip needles, kits and multipacks unless nothing else matches; note multipacks);
   - `kind: "needle"`: always check the KnitPro Zing range; pick the Zing product with that exact mm size (prefer the needle type the pattern needs; if "any", the cheapest);
   - call `get_product_offers` once (offset 0 only, to save quota).
   Save `{ "<key>": [offers...] }` to `run/buy/offers.json`. Note any query with no match.
   If `get_product_offers` returns no offers but the picked search result had a price, also save
   `"_search_prices": { "<key>": { "price": "<search price>", "url": "<product idealo url>" } }`; calc then uses it as an indicative offer.
3. Run `node buy/agent.js finish` and read `run/buy/result.json`.
   If `budget_fallback_needed` is true (pattern yarn and all Ravelry substitutes over budget or not buyable):
   run `node buy/agent.js budget-subs`, then for each `kind: "budget_substitute"` query in `run/buy/plan.json`
   do the same idealo search as in step 2 (one `get_product_offers` each, `_search_prices` if no offers),
   add them to `run/buy/offers.json`, and run `node buy/agent.js finish` again.
   Then run `node buy/agent.js held-together`. If it lists `kind: "held_together"` queries (strands the stash
   does not cover), search them the same way, add them to `run/buy/offers.json`, and run `node buy/agent.js finish` again.
4. Decide using the rules in `buy/decision_prompt.md`. Add `yarn_spec` (brand, name, metres_per_skein, skein_grams) to each decision. Save to `run/buy/decision.json`.
5. Show the knitter:
   - what the stash already covers (and any dye-lot warning),
   - the basket: shop, product, skeins, price per skein, total incl. shipping, price per 100 m, link;
     mark indicative offers (shop "idealo (from price)", no shipping) with the flag "Indicative price: offers not returned by the idealo trial API, check the link",
   - all offers and all substitutes listed from the lowest price to the most expensive (`offer.all` is already sorted),
   - budget status: max 10 € per skein and max 150 € per project (yarn + missing needles), plus the long-term range if one exists,
   - any substitute with its trade-off in plain words,
   - held-together combinations (`held_together`: stash-covered first, then cheapest), each labelled "held together", with effective metres per 50 g, what the stash covers per strand, what to buy, and the trade-off,
   - budget substitutes (`budget_substitutes`, cheapest first), each labelled "budget substitute" with its trade-offs, and the recommended one (`recommended_budget_substitute`: the cheapest within budget),
   - needles: KnitPro Zing price for each size (lowest first), marked owned or missing; only missing ones count toward the total.
6. Ask: "Shall I mark this as bought and update your stash?" Only if they say yes, run `node buy/agent.js confirm`.

Never print secrets. Never write personal stash data to committed files.
