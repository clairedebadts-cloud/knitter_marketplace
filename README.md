# Knitter Marketplace

From Ravelry pattern to idealo basket: an agent that buys only the yarn your stash is missing, within budget, and prices your leftovers for resale.

Built at the AI Agents Berlin Agentic Hackathon (27 Nov 2026) for the idealo challenge "Build Something We Didn't Expect".

## The problem
Knitters find the pattern first and the yarn second. The pattern names one yarn, often expensive or out of stock, and most knitters already own yarn that would work. Shopping tools only answer "where is this cheapest?", not "do I need to buy it at all?".

## What the agent does

**Buy** (`/basket <ravelry-url> <size>`)
1. Reads the pattern from the Ravelry API: yarn weight, metres, needles, gauge, suggested yarns.
2. Checks the stash first and only buys what is missing. One dye lot only counts toward the main body.
3. Checks the budget: max price per skein and max project total (demo defaults: €10 per skein, €150 per project, needles included), plus a long-term range once past projects show a consistent pattern.
4. Searches idealo for the pattern yarn and ranks offers from cheapest to most expensive, shipping included.
5. When the yarn is over budget or not buyable, looks for substitutes:
   - yarns Ravelry knitters used for this pattern,
   - cheaper yarns of the same weight and metres per 50 g, any fibre,
   - two strands held together (e.g. a mohair held double), stash first.
6. Prices KnitPro Zing needles for any size you don't own.
7. Decides per yarn (use stash, buy, substitute or ask), explains every trade-off in plain words, and asks before anything is marked as bought.

**Sell** (`/sell`)
Lists leftover stash yarn and suggests a resale price anchored on idealo's current new price (full skeins and partial skeins priced differently), with listing text ready to paste. Yarn kept for a planned project can be reserved.

Buy and sell share one stash: what a project leaves over becomes a listing.

## How idealo is used
- `search_products` and `get_product_offers` for yarn and needles, cheapest first.
- New prices as the anchor for second-hand prices on the sell side.
- When the trial API returns a listing price but no shop offers, the agent shows the price as indicative with the idealo link, and says so.

## Stack
- Claude Code as the agent, with the idealo MCP server (`https://mcp.idealo.com/mcp`).
- Node.js scripts for Ravelry, stash, budget and maths (`buy/`, `sell/`, `lib/`).
- Ravelry API (read-only basic auth).

## Run it
```
cp .env.example .env        # add your Ravelry credentials
claude mcp add --transport http idealo https://mcp.idealo.com/mcp --callback-port 6274
claude                      # then /mcp to sign in to idealo
/basket https://www.ravelry.com/patterns/library/sophie-scarf-2 small
/sell
```
Node.js 18 or later. Your real stash goes in `stash.local.json` (gitignored); without it the demo stash in `lib/demo_stash.json` is used.

## Limits
- idealo trial tier: 500 calls a day, max 10 offers per product; Amazon, eBay and Otto offers are filtered out, so some cheaper listings have no shop offer.
- Ravelry gives one metres range for all sizes; the agent plans for the top of the range.
- Resale shares (70% full skeins, 50% partial) are starting assumptions, not market data.

## Guardrails
- **Never spends money**: the agent builds a basket with links; nothing is bought or checked out automatically.
- **Human in the loop**: the stash and budget history only change after the knitter confirms ("Shall I mark this as bought?").
- **Hard budget limits**: max price per skein and per project; anything over is flagged, never bought.
- **Asks instead of guessing**: conflicting evidence ends in ASK_USER with the options laid out.
- **Honest data**: missing idealo offers are shown as indicative prices with a warning, never invented.
- **Quota limits**: one offers call per product, max 5 substitute searches per run (idealo trial: 500 calls/day).
- **Least privilege** (`.claude/settings.json`): Claude Code may only run the buy/sell scripts and the read-only idealo tools; it cannot read `.env` or the personal stash, delete files, call other URLs or push to git. Ravelry access is read-only.
- **No secrets or personal data in the repo**: `.env`, `stash.local.json` and `run/` are gitignored.
