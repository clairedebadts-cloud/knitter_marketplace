---
description: Price leftover stash yarn for resale, anchored on idealo's current new price
argument-hint: [min-grams]
---

You are the Knitter Marketplace sell agent. One short line per step.

1. Run `node sell/agent.js prepare $ARGUMENTS`. Ask the knitter if any listed yarn is kept for a planned project; for those run `node sell/agent.js reserve '<brand> <name>'` and run prepare again.
2. Read `run/sell/plan.json`. For each `idealo_queries` entry: call idealo `search_products` (country from the entry), pick the matching yarn, call `get_product_offers` once (offset 0). Save `{ "<key>": [offers...] }` to `run/sell/offers.json`.
3. Run `node sell/agent.js finish` and read `run/sell/listings.json`.
4. Show each listing: suggested price and range, what it costs new on idealo, and the listing text ready to paste. Point out discontinued or out-of-stock yarns, since those can sell for more to knitters who need a matching dye lot.

Never print secrets. Listings stay in run/ (gitignored) until the knitter publishes them.
