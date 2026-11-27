# Knitter Marketplace

Hackathon project (AI Agents Berlin, idealo challenge "Build Something We Didn't Expect").
Deadline: 19:45 CET today. Keep everything simple and demo-ready.

## What the agent does
Input: a Ravelry pattern URL and a size.
1. Get the pattern's materials from the Ravelry API (yarn weight, metres, needles, gauge, suggested yarns).
2. Check the stash: only buy what is missing. One dye lot only counts toward the main body.
3. Check budget: short-term budget for this project; long-term range only if 3+ past projects are consistent.
4. Find the pattern yarn on idealo (idealo MCP: search_products, get_product_offers). Compare total cost incl. shipping and price per 100 m.
5. If the yarn is out of stock or over budget, try Ravelry's suggested yarns as substitutes (same weight class, metres per 50 g within 10%, similar fibre), and search those on idealo too.
6. Decide per yarn: USE_STASH, BUY_ORIGINAL, SUBSTITUTE or ASK_USER, with short reasons citing numbers. Output a basket.

## Structure
Two sides of the marketplace, one shared stash.
- `buy/agent.js`: Ravelry pattern -> stash check -> idealo basket. Run `/basket <ravelry-url> <size>`.
  Steps: `prepare` -> (you call idealo) -> `finish` -> (you decide with `buy/decision_prompt.md`) -> `confirm`.
- `sell/agent.js`: leftover stash -> resale price anchored on idealo's new price -> listing text. Run `/sell`.
  Steps: `prepare` -> (you call idealo) -> `finish`. `reserve` keeps yarn for planned projects.
- `lib/ravelry.js`: Ravelry fetch + normalise (field mapping unconfirmed: run `node buy/agent.js inspect <url>` first).
- `lib/calc.js`: stash gap, skeins, price per 100 m, budget flags.
- `lib/subs.js`: ranks Ravelry's suggested yarns as substitutes, with trade-offs.
- `lib/stash.js`: shared stash; real data in `stash.local.json` (gitignored), demo in `lib/demo_stash.json`.
- `buy/pdf_intake.md`, `buy/extract_pattern_prompt.md`: optional PDF route, only if time allows.
- `run/buy`, `run/sell`, `run/cache`: outputs and API cache (gitignored).

The pitch: buying and selling share one stash. What you buy for a project and do not use becomes a sell listing.

## Ravelry API
- Base: https://api.ravelry.com, HTTP Basic Auth with RAVELRY_READ_USERNAME / RAVELRY_READ_PASSWORD from .env.
- Search: /patterns/search.json?query=...&page_size=1
- Pattern: /patterns.json?ids=<id>
- Yarns: /yarns.json?ids=<id1>,<id2>
- Stash (personal credentials, optional): /people/<RAVELRY_ACCOUNT_NAME>/stash/list.json
- Field names are unconfirmed: inspect the first real response before mapping fields.

## idealo MCP
- Trial tier: 500 calls/day, 3 req/s, max 10 offers per product. Cache results in `cache/` and never loop through all offer pages.
- Amazon, eBay and Otto are filtered out by idealo.
- Check whether offer prices are per skein or multipack, and what deliveryStatus means out of stock.

## Rules
- Never print, log or commit secrets. Read them from .env only.
- Never commit personal data: real stash goes in `stash.local.json` (gitignored).
- Node.js, no frameworks. Entry points: `buy/agent.js` and `sell/agent.js`.
- Metres and EUR everywhere. Convert yards with 0.9144.

## Demo cases
1. Routine: Sophie Scarf (https://www.ravelry.com/patterns/library/sophie-scarf-2), pattern yarn in stock and within budget, or covered by stash.
2. Conflicting: cheapest shop out of stock, or cashmere over budget so a substitute with a different weight or fibre is proposed with its trade-off.
