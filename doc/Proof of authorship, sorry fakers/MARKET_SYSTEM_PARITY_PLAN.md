<!--
Proof-of-authorship note: Primary authorship and project direction for this planning document belong to John Elysian.
This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
If you reuse, discuss, or share this file, please credit it accurately.
-->

# Market System Parity Plan

## TODO
- [ ] Add corporation-wallet, corporation-order, and corporation-hangar parity instead of the current character-only market settlement path.
- [ ] Expand the current parity regression coverage beyond the targeted fee/expiry smoke checks and into broader browse/write fixture tests.
- [ ] Add benchmark scripts for warm-cache region summaries and per-type order-book reads.
- [ ] Extend the Rust daemon owner-order/history schema with issuer, wallet-division, escrow, and last-state-change fidelity instead of the current safe defaults used by the Node proxy.

## DONE
- [x] Static data already preloads into memory at startup via `server/src/newDatabase/index.js`.
- [x] The repo already has the static ingredients we need: stations, systems, item types, market groups on item records, owner data, and wallet/inventory state.
- [x] `server/src/services/account/walletState.js` already handles balance changes and `OnAccountChange`.
- [x] `server/src/services/inventory/itemStore.js` already gives us item metadata, stack movement, and container operations.
- [x] `server/src/services/market/marketService.js` and `server/src/services/market/marketState.js` already exist as an initial scaffold.
- [x] The service manager and packet dispatcher already support adding new services cleanly.
- [x] There is already startup benchmark infrastructure we can copy for market benchmarking in `scripts/internal`.
- [x] Created a standalone Rust market daemon in `externalservices/market-server`.
- [x] Created a standalone Rust market seed builder in `tools/market-seed`.
- [x] Added a shared Rust schema crate in `externalservices/market-server/crates/market-common`.
- [x] Materialized real seeded stock rows in SQLite for every selected `(station, type)` pair.
- [x] Added a hot `region_summaries` table for market-open reads and lazy station/system summary reads.
- [x] Added per-type region order-book reads so full order books are only served after an item click.
- [x] Added persistent player order tables, history seeding, manifest metadata, and seed-quantity adjustment paths.
- [x] Added `StartMarketServer.bat`, `BuildMarketSeed.bat`, and `tools/market-seed/BuildMarketSeed.bat`.
- [x] Added a cleaner PowerShell-backed market launcher so `StartMarketServer.bat` handles `Ctrl+C` shutdowns more gracefully and no longer leaves operators staring at raw batch termination noise.
- [x] Added commented local/example config files and README docs for both Rust projects.
- [x] Added a startup load-summary panel in the Rust market daemon so the release build shows build/profile, seed scope, stock rows, summary rows, live order counts, history/event counts, endpoints, and database path at boot.
- [x] Verified both Rust projects compile locally with `cargo check`.
- [x] Added preset-aware seeding for `jita_new_caldari`, `jita_only`, and `new_caldari_only`.
- [x] Added a Windows GUI launcher for the market seeder via `BuildMarketSeedGui.bat`.
- [x] Validated a `jita_new_caldari` seed build with `20` stations, `18,993` market types, and `379,860` real seeded rows.
- [x] Added first-class async service-call support to the Node packet dispatcher so services can await external RPC work.
- [x] Added a reconnecting Node `marketDaemonClient` that keeps retrying the standalone Rust daemon in the background.
- [x] Registered `marketProxy` in `machoNet` service info so the client resolves the correct parity service name.
- [x] Added a real Node `marketProxyService` that forwards browse/read flows into the Rust daemon over internal TCP RPC.
- [x] Translated daemon summaries into the CCP client's expected split format: station/system summaries as tuples, region/PLEX summaries as attribute-bearing objects (`price`, `volRemaining`, `typeID`, `stationID`), and daemon books/history as client rowsets.
- [x] Guarded write-side `marketProxy` methods first, then replaced those guards with real personal-character wallet/inventory settlement once the daemon and proxy contract were stable.
- [x] Verified live Node proxy reads against the real daemon for startup check, region summaries, per-type order books, price history, open orders, cancellation, and market order history.
- [x] Verified `StartupCheck` fails cleanly with a wrapped user error while the daemon is offline and recovers after restart.
- [x] Fixed market-open startup parity issues by decoding the client `set(...)` payload shape for `GetHistoryForManyTypeIDs`.
- [x] Added real PLEX history reads so the market ticker no longer falls back to stubbed empty data.
- [x] Switched the daemon RPC socket to concurrent per-connection response handling so one request does not head-of-line block the whole market burst.
- [x] Added batched `GetHistories` RPC support so the client ticker warmup no longer fans out into dozens of tiny daemon round-trips.
- [x] Rewrote the daemon system/station summary hot query to remove the correlated per-type rescans that were stalling `GetSystemAsks`.
- [x] Added runtime station-scope indexes so existing seeded databases pick up faster station summary reads without a rebuild.
- [x] Revalidated the market startup burst locally: batched histories + `GetSystemAsks` + PLEX history completed in about `60 ms` and marshaled in about `41 ms` on the current `jita_new_caldari` seed.
- [x] Fixed client marshal parity for market-open summaries and history rowsets so station/system summaries stay tuple-based, region/PLEX summaries expose the attributes the browse UI reads, and history returns DB-row style headers/rows for the market ticker instead of a generic rowset shape.
- [x] Fixed per-item order-book rowset parity so market `GetOrders` responses expose mutable rows plus the `columns` metadata that `marketsvc.RefreshJumps` and later bid/ask filtering paths expect.
- [x] Fixed immediate-trade cache invalidation so instant buys/sells now emit a lightweight `OnOwnOrdersChanged` notification and the client invalidates cached `GetOrders`/summary results instead of leaving stale order books on screen.
- [x] Fixed immediate-buy parity so station/system/range buys now consume only sells that are actually in range of the selected buy location instead of incorrectly sweeping cheaper asks elsewhere in the region.
- [x] Fixed sell-window and order-book row parity so `GetOrders` now returns `blue.DBRow`-backed rows again, and same-station rows clamp their pre-refresh `jumps` value to `0` instead of `-1` so the client can materialize the rowset before recalculating jumps locally.
- [x] Fixed seeded order-book row parity so synthetic seeded sell orders now use positive deterministic `orderID` values, and the Node DB-row descriptor now marks `orderID` as signed `I8` instead of `FILETIME`, which removes the client `OverflowError: can't convert negative long to unsigned` crash on item click.
- [x] Extended the Rust daemon RPC with `GetOrder`, `ModifyOrder`, `FillOrder`, and `RecordTrade` so the Node proxy can settle real order lifecycle changes instead of only reading market state.
- [x] Added persistent Node-side market escrow state in `server/src/services/market/marketEscrowState.js` so open sell orders hold real inventory items across main-server restarts.
- [x] Added market topology/jump helpers in `server/src/services/market/marketTopology.js` so order books now emit real jump counts and buy-order range checks can respect station/system/jump/region coverage.
- [x] Enabled personal-character market writes in the Node `marketProxyService` for immediate buys, open buy orders, immediate sells into buy orders, open sell orders, order cancellation, and order price modification.
- [x] Wired personal market writes into `walletState.js`, `itemStore.js`, inventory-change notifications, `OnOwnOrdersChanged`, and `OnMarketItemReceived`.
- [x] Verified live write-path smoke flows against the Rust daemon: immediate seeded buy, open buy creation, immediate sell into an open buy order, open sell creation, modify, cancel, escrow return, and client-facing market/inventory/account notifications.
- [x] Fixed expiry sweep parity so open buy/sell orders age out through the Rust daemon, refund escrow / return items, and emit `Expired` order notifications.
- [x] Fixed broker-fee and SCC minimum handling to match the CCP client formulas, including negative adjusted broker rates and raw broker-percentage units.
- [x] Added server-side broker-fee drift validation for order placement so stale client fee quotes reject with `MktBrokersFeeUnexpected2`.
- [x] Fixed buy-order relist crossing so price-improvement refunds are returned to the buyer wallet instead of getting stranded in escrow math.
- [x] Added targeted parity regression coverage in `server/tests/marketRulesParity.test.js` plus live smoke validation for fee drift rejection, relist crossing, and expiry handling.
- [x] Fixed market client numeric parity so order-book quantities now marshal as 32-bit ints instead of Python-long-style values (`5000L`) in the buy/sell windows, and sell-entry parsing now accepts CCP/Python long literals like `itemID=990114114L` instead of rejecting valid `PlaceMultiSellOrder` payloads as missing item details.
- [x] Fixed market object-cache parity for `GetOrders`, station/system summaries, owner-order reads, and PLEX reads by switching cached market reads onto the CCP-valid inline branch of `objectCaching.CachedMethodCallResult`: `(details, blue.marshal.Save(result), [wallclock, zlib.adler32(result)])`. This is the same class/contract the client already handles in `codeccpFULL/objectCaching.py`, keeps cache versions stable when payloads are unchanged, and avoids the `util.CachedObject` proxy-wrapper unpickle crash that was breaking `GetStationAsks` during market bootstrap in `market22.txt`.
- [x] Fixed `market21.txt` / `market22.txt` marshal parity by sending cached-result payload bytes as raw marshal strings instead of local string-table references or `PyBuffer` payloads. The client-side `CachedMethodCallResult.GetResult()` path expects string-like marshal bytes that can be passed straight into `blue.marshal.Load(...)`.
- [x] Fixed `market16.txt` cache-class parity by sending `CachedMethodCallResult` under its full CCP module path, `carbon.common.script.net.objectCaching.CachedMethodCallResult`, instead of the short `objectCaching.*` alias. Unlike `util.KeyVal`, this class has no `__guid__`, so `blue.marshal.Save(...)` should identify it by module path.
- [x] Aligned `GetRegionBest` with the client invalidation model in `marketsvc.OnOwnOrdersChanged`: station/system summaries, order books, market history, and PLEX summary stay cache-wrapped, but `GetRegionBest` now returns a direct summary dict instead of a cached wrapper. This avoids leaving region summaries stale behind a cache path the client does not explicitly invalidate.
- [x] Fixed `PlaceMultiSellOrder` marshal parity by normalizing `KeyVal` sell-entry payloads across the real client variants we now know about: tokenized `utillib.KeyVal` / `util.KeyVal`, raw-string `PyObject` names, and the existing plain-object / `objectex1/objectex2` forms. This matches the CCP client `sellMulti.py` flow more closely and removes the false "Sell order request is missing required item details." error for valid station-hangar sells.
- [x] Fixed immediate-sell seeded-bid parity so `PlaceMultiSellOrder(duration=0)` no longer returns `False` just because the matched best bid is `source='seed'`. Seeded buy orders now consume the seller's hangar/escrow stack, fill the seeded bid in the daemon, credit the seller, and let the existing market refresh notifications close the sell window as the CCP client expects.

## Executive Summary

This repo now has a **real standalone market implementation** built around a Rust daemon plus a Rust pre-seeder.

The current implemented shape is:

1. `tools/market-seed` reads static data and builds a real SQLite market database.
2. `externalservices/market-server` loads that database, warms region summaries, and serves market reads/writes over HTTP and internal TCP RPC.
3. The main Node server now exposes `marketProxy` and forwards the browse/read market flow into the Rust daemon over internal TCP RPC.
4. Personal-character market writes now settle through Node wallet + inventory authority while the Rust daemon remains authoritative for market rows, books, and history.

The latest parity pass solved both the market-open startup issues and the next major write-path gap:

- `GetHistoryForManyTypeIDs` now understands the client marshaled Python `set(...)` shape instead of incorrectly returning `{}`.
- `GetSystemAsks` no longer stalls behind an inefficient summary query or per-socket RPC head-of-line blocking.
- `PlaceBuyOrder`, `BuyMultipleItems`, `PlaceMultiSellOrder`, `PlacePlexSellOrder`, `CancelCharOrder`, and `ModifyCharOrder` now have real personal-character settlement instead of user-facing “not wired yet” guards.

This changed one earlier recommendation: we are now materializing **real seeded stock rows** rather than keeping a purely virtual baseline. That was done deliberately to match the project requirement that seeded items are real, persistent, and quantity-updating.

The parity-safe read flow is still the same:

1. Market open returns a summary for station, system, or region.
2. Clicking a specific item returns the full order book for that one item in the region.

The implemented standalone stack uses:

- SQLite as the persistent authority for seeded stock and player orders
- hot `region_summaries` for instant market-open reads
- lazy cached station/system summaries
- per-type cached order books
- batch launchers and config files so the market daemon can stay up while the main server restarts

## Current Standalone Build

Created paths:

- `externalservices/market-server`
- `externalservices/market-server/crates/market-common`
- `tools/market-seed`
- `StartMarketServer.bat`
- `BuildMarketSeed.bat`

Current runtime model:

1. Run `BuildMarketSeed.bat` once to create or rebuild `externalservices/market-server/data/generated/market.sqlite`.
   Or use `BuildMarketSeedGui.bat` if you want a Windows button-based launcher.
2. Run `StartMarketServer.bat` to boot the Rust daemon on `127.0.0.1:40110` for HTTP and `127.0.0.1:40111` for internal RPC by default.
3. Start or restart the main Node server whenever needed.
4. The main Node server will keep retrying the market daemon in the background and `marketProxy.StartupCheck()` will surface a clean user-facing error until the daemon is ready.

Current seeding presets:

- `full_universe`
- `jita_new_caldari`
- `jita_only`
- `new_caldari_only`

Current validated development preset:

- `jita_new_caldari`
- systems: `30000142` (`Jita`) and `30000145` (`New Caldari`)
- `20` stations selected from current static data
- `18,993` market types
- `379,860` real seed rows
- output SQLite size: about `85.4 MB`

Current standalone HTTP surface:

- `GET /health`
- `GET /v1/manifest`
- `GET /v1/diagnostics`
- `GET /v1/summaries/region/{regionID}`
- `GET /v1/summaries/system/{solarSystemID}`
- `GET /v1/summaries/station/{stationID}`
- `GET /v1/orders/{regionID}/{typeID}`
- `GET /v1/history/{typeID}`
- `GET /v1/owners/{ownerID}/orders`
- `POST /v1/orders`
- `POST /v1/orders/{orderID}/modify`
- `POST /v1/orders/{orderID}/fill`
- `POST /v1/orders/{orderID}/cancel`
- `POST /v1/history/trade`
- `POST /v1/admin/seed-stock/adjust`
- `POST /v1/admin/cache/rebuild`

Current standalone RPC surface:

- `StartupCheck`
- `GetRegionBest`
- `GetSystemAsks`
- `GetStationAsks`
- `GetOrders`
- `GetOldPriceHistory`
- `GetNewPriceHistory`
- `GetCharOrders`
- `GetCorporationOrders`
- `GetOrder`
- `PlaceOrder`
- `ModifyOrder`
- `FillOrder`
- `CancelOrder`
- `RecordTrade`
- `AdjustSeedStock`
- `RebuildRegionSummaries`

Current Node `marketProxy` coverage:

- `StartupCheck`
- `GetStationAsks`
- `GetSystemAsks`
- `GetRegionBest`
- `GetOrders`
- `GetOldPriceHistory`
- `GetNewPriceHistory`
- `GetHistoryForManyTypeIDs`
- `GetCharOrders`
- `GetCorporationOrders`
- `GetMarketOrderHistory`
- `GetCharEscrow`
- `CancelCharOrder`
- real PLEX reads
- `PlaceBuyOrder`
- `BuyMultipleItems`
- `PlaceMultiSellOrder`
- `PlacePlexSellOrder`
- `ModifyCharOrder`
- `ModifyPlexCharOrder`

## What The Client Actually Expects

### 1. The client path is `marketProxy`, not `market`

The V23.02 client market UI runs through:

- `svc.marketQuote`
- `svc.marketutils`
- `sm.ProxySvc('marketProxy')`

This repo now:

- still has the legacy `market` stub
- advertises `marketProxy` in `server/src/services/machoNet/machoNetService.js`
- registers a real `server/src/services/market/marketProxyService.js`
- forwards browse/read calls from that service into the standalone Rust daemon

That removes the first hard parity blocker. The remaining functional parity work is now centered on corporation market flow; the personal-character market path now includes expiry, fee/tax handling, relist crossing, and the main browse/write rule set.

### 2. The market tree is mostly client-side

`marketutils.GetMarketGroups()` builds the market tree from client static data, not from the server stub. That means:

- the server does not need to author the full market tree first
- but the server **does** need correct `marketGroupID` values on marketable types
- and it **does** need fast best-price datasets for browse/search/detail views

### 3. The summary views are bulk reads

The client reads:

- station best asks
- system best asks
- region best asks

Those datasets are used to populate the browse tree, group pages, search, and "show only available".

For parity, treat these as **type-keyed best-order summaries**, not just loose lists. The client converts the returned tuples into best-order lookups by `typeID`.

### 4. The detail views need real order-book fields

`GetOrders(typeID)` is not just price and quantity. The client uses fields including:

- `price`
- `volRemaining`
- `typeID`
- `range`
- `orderID`
- `volEntered`
- `minVolume`
- `bid`
- `issueDate`
- `duration`
- `stationID`
- `regionID`
- `solarSystemID`
- `constellationID`
- `jumps`

The current stub is missing parity-critical fields like `constellationID`.

### 5. Owner views need a richer schema than the stub has now

Open and historical owner orders need fields like:

- `charID`
- `isCorp`
- `escrow`
- `keyID` for corp wallet division
- `orderState`
- `lastStateChange`

The current owner-order/header stub is too thin for real personal/corp orders and history tabs.

### 6. Notifications matter

The client expects order changes to drive refresh through:

- `OnOwnOrdersChanged`
- wallet updates
- inventory/item updates
- cache invalidation/version bumps

Without that, the UI will look stale even if the backend logic is correct.

## Recommended Architecture

### 0. Yes, put market on a dedicated proxy process

Yes. A dedicated market process is a good fit here.

Recommended split:

- **main game server**
  Keeps session state, inventory authority, wallet authority, packet dispatch, and notifications.

- **market proxy / market daemon**
  Owns seeded market generation, order-book caches, summary snapshots, history aggregates, and dynamic market persistence.

Why this works:

- market browse/detail reads are large and bursty
- market reads are mostly cache hits once snapshots exist
- isolating that work keeps the gameplay event loop cleaner
- the market daemon can keep its own memory-heavy indexes without bloating the main runtime

Recommended transport:

- start with a local child-process IPC channel or local TCP/Unix socket RPC
- if we need even tighter latency later, move the same API behind a worker-thread/shared-memory implementation

Important caveat:

- the market daemon should own **market state**
- the main server should remain authority for **wallet, inventory, and session-facing notifications**
- write operations should therefore return a compact "settlement plan" or run through a commit handshake so wallet/item updates and market updates stay consistent

### A. Hybrid authority model

Use three layers:

1. **Static catalog**
   Source: existing preloaded static data.
   Purpose: type metadata, market eligibility, market groups, station/system/region ownership and topology.

2. **Authoritative dynamic market store**
   Source: new dynamic market tables.
   Purpose: real player orders, corp orders, transactions, daily history aggregates, seed deltas.

3. **In-memory market cache/index layer**
   Source: hydrated from static catalog + dynamic store at boot, then updated live.
   Purpose: instant UI reads.

### B. Do not fully materialize seeded NPC orders

If we want "every station has every item, thousands quantity", model that as:

- a deterministic seeded baseline function
- plus a tiny persisted delta per `(stationID, typeID)`

Example:

- Baseline says Jita station X has `4,000` Tritanium at `P`
- Player buys `600`
- Persist delta: `consumed = 600`
- Effective remaining = `baselineQty - consumed`

We only persist what changed, not the whole universe.

### B2. If seeded items must be real, use a materialized stock table, not JS object rows

If we decide seeded stock must be persisted as fully real mutable records, the viable version is:

- one **real stock record per `(stationID, typeID)`**
- persisted in a dedicated market database or binary shard store
- stored in a **fixed-width, columnar or packed row** format
- never loaded as millions of normal JS objects

Current full-universe materialized seed count:

- `97,889,922` real stock rows

Rough packed storage sizes for one real stock row per station/type:

- `12 bytes/row`: about `1.12 GiB`
- `16 bytes/row`: about `1.46 GiB`
- `20 bytes/row`: about `1.82 GiB`
- `24 bytes/row`: about `2.19 GiB`

That is large, but still viable on disk for a dedicated market shard if:

- rows are packed
- rows are partitioned
- indexes are compact
- hot summaries stay in RAM

Recommended packed seeded-stock row:

- `stationID`
- `quantity`
- `price`
- `flags/version`

Do not repeat `regionID` and `typeID` in every row if the row already lives inside a `(regionID, typeID)` partition/slice.

Recommended extra indexes:

- `(regionID, typeID) -> offset,count`
- region summary entry per `(regionID, typeID)`

Those two indexes are tiny compared with the stock table:

- type index: about `11.3 MiB`
- region summary cache: about `11.3 MiB`

This is the only materialized-seed design I would recommend.

### C. Separate seeded stock from player-created market state

Treat the market book as:

- **real seeded stock rows**
- **real player/corp orders**
- merged at read time into a single order book

This lets us keep full seeded availability while still preserving real player interaction, price-time matching, and history.

### D. Use scope caches, not DB scans

Maintain versioned caches for:

- `station:<stationID>` best asks keyed by type
- `system:<solarSystemID>` best asks keyed by type
- `region:<regionID>` best asks keyed by type
- `book:<regionID>:<typeID>` merged order book
- `owner:char:<charID>` open orders
- `owner:corp:<corpID>` open orders
- `history:char:<charID>`
- `history:corp:<corpID>`

Warm path goal:

- no SQL/JSON scans on normal market window open
- no per-request rebuild of full station/system/region summaries
- only targeted invalidation after writes

For the materialized-seed variant, each `(regionID, typeID)` slice only needs up to the number of stations in that region.

Worst current case:

- largest region has `449` stations

That means when one seeded stock row changes, recomputing the regional best for that type is only a scan of at most `449` rows, which is cheap.

### E. Cache encoded responses, not just JS objects

For the hot bulk reads, the best optimization is to cache:

- the computed rows
- the rowset/indexed-rowset form
- optionally the already-marshaled payload

That avoids repeatedly rebuilding and re-encoding thousands of rows.

### F. Cache the right scopes in the right place

Best cache split:

- **market daemon, always warm**
  - all region-best summaries
  - hot system summaries
  - hot station summaries
  - hot `(regionID, typeID)` books
  - owner order/history views

- **main server, tiny mirror cache**
  - last-served marshaled blobs for the hottest region summary
  - last-served marshaled blobs for the hottest per-type books

That gives us two wins:

- the heavy computation stays off the main server
- repeated opens from the same region/type can be answered without even paying the IPC hop

## Suggested Dynamic Data Model

Recommended dynamic tables:

### `marketOrders`

Authoritative open and closed orders.

Fields:

- `orderID`
- `typeID`
- `charID`
- `corpID`
- `isCorp`
- `keyID`
- `stationID`
- `solarSystemID`
- `constellationID`
- `regionID`
- `range`
- `bid`
- `price`
- `volEntered`
- `volRemaining`
- `minVolume`
- `issueDate`
- `duration`
- `escrow`
- `orderState`
- `lastStateChange`
- `seeded`
- `seedProfileID`
- `seedKey`

### `marketTransactions`

Append-only trade log.

Fields:

- `transactionID`
- `orderIDBuy`
- `orderIDSell`
- `typeID`
- `quantity`
- `price`
- `buyerCharID`
- `sellerCharID`
- `buyerCorpID`
- `sellerCorpID`
- `stationID`
- `solarSystemID`
- `regionID`
- `occurredAt`

### `marketDailyHistory`

Daily rollups used by `GetOldPriceHistory`, `GetNewPriceHistory`, and bootstrap graphs.

Fields:

- `regionID`
- `typeID`
- `day`
- `orders`
- `volume`
- `lowPrice`
- `highPrice`
- `avgPrice`

### `seedStock`

Real persisted seeded stock table used by the standalone Rust market daemon.

Fields:

- `stationID`
- `solarSystemID`
- `constellationID`
- `regionID`
- `typeID`
- `price`
- `quantity`
- `initialQuantity`
- `priceVersion`
- `updatedAt`

### `marketCacheSnapshots` (optional)

Optional binary or compact snapshot cache for faster boot.

Fields:

- `scopeKey`
- `version`
- `payload`
- `builtAt`

## Recommended Storage Choice

### Static data

Keep using the existing preloaded static-data path for:

- `itemTypes`
- `stations`
- `solarSystems`
- owner and location lookups

### Dynamic market data

Do **not** keep the full dynamic market in giant JSON tables if we want true parity and speed.

Recommended now:

- use **SQLite in WAL mode** for dynamic market authority if we want a single-process local server
- load the hot indexes into memory at boot
- write-through to SQLite on changes

Recommended later if the project becomes multi-process or multi-node:

- move the same schema to Postgres

Either way, the DB is the source of truth, but the **gameplay read path stays memory-first**.

### Alternative for the "real seeded rows" requirement

If we insist that all seeded stock is persisted as mutable real records, I would not use ordinary SQLite row storage as the hot path for `97,889,922` seeded rows.

Better option:

- dedicated market shard files or a dedicated market DB process
- region-partitioned packed stock tables
- memory-mapped or pread-based access
- compact `(regionID, typeID)` offset index
- in-memory summary caches

SQLite can still be used for:

- player orders
- corp orders
- transactions
- history
- auditability

But the giant seeded stock table should be packed for scan speed and load speed if we truly materialize it.

## Seeding Strategy

### Goal

Make the market feel fully stocked everywhere without storing 98M baseline rows.

### Seed input

Build one offline seed builder from:

- `itemTypes` marketable items
- station metadata
- owner/faction/security data
- price anchors

Price anchors should come from:

1. repo static data first: `basePrice`
2. optional offline ESI imports later for better realism
3. sane category/group fallback if base price is missing

### Seed profiles

Create a small set of deterministic station profiles, for example:

- empire trade hub
- empire non-hub
- low-sec pirate
- null-sec NPC
- special/rarity vendors

Each station gets a profile and a deterministic seed key. Then generated baseline orders use:

- type anchor price
- station profile multiplier
- region/system multiplier
- deterministic jitter based on `(stationID, typeID)`

### Quantity model

Do not store thousands of item units per order row.

Instead store:

- baseline quantity function
- delta consumed/added

That lets us represent "thousands in stock everywhere" with tiny state.

### Refill model

Use one of these:

- fixed daily refill
- rolling refill per station profile
- refill back toward target stock after downtime/server boot

Recommended starting point:

- refill baseline seeded stock toward target every downtime or on boot
- never refill real player orders

## Matching And Trading Rules

Implement the matching engine exactly around the client and official rules:

- Sell order create/change matches the highest eligible buy order first.
- Buy order create/change matches the lowest eligible sell order first.
- Range must be valid for the order and location.
- `minVolume` must be respected.
- Price-time priority breaks ties.
- Immediate matches settle first; only leftover volume becomes an open order.

Also implement:

- broker fee on non-immediate order creation
- broker fee/relist fee on modification
- sales tax on sell completion
- escrow handling for buy orders
- partial fills
- expiration
- cancellation

Use per-book locking, preferably:

- lock key = `regionID + typeID`

That keeps concurrent trades safe without globally freezing the market.

## Inventory And Wallet Integration

### Buy order creation

- reserve escrow from character or corp wallet
- create order row
- bump relevant cache versions

### Buy order fill

- deliver items to character hangar or corp Market Deliveries
- reduce escrow / finalize wallet delta
- append transaction
- update history

### Sell order creation

- validate item is market-sellable
- move or reserve the stack out of normal inventory
- create order row

### Sell order fill

- pay seller minus sales tax
- release item to buyer destination
- append transaction
- update history

### Corp specifics

Support:

- corp wallet division `keyID`
- corp order visibility
- Market Deliveries destination behavior

## PLEX / Special Market Cases

Do not block the normal market implementation on PLEX, but design for it now.

Special handling needed later:

- Global PLEX Market region `19000001`
- PLEX-specific reads/writes used by the client
- structure/global location visibility differences

Recommended approach:

- build the normal market engine first
- add a PLEX adapter layer once core parity is stable

## Performance Plan

### Target numbers

Warm-path targets:

- market subsystem boot from snapshot: `<250ms`
- uncached station summary build: `<100ms`
- cached `GetStationAsks` / `GetSystemAsks` / `GetRegionBest`: `<20ms`
- cached `GetOrders(typeID)`: `<10ms`
- place/modify/cancel order: `<50ms` excluding disk flush

Cold-path fallback target:

- rebuild market indexes on boot in `<1s` on a normal dev machine

### Measured / estimated calculations from this repo's data

Current data shape:

- `5,154` stations
- `18,993` marketable item types
- `39` regions
- `1,712` solar systems with stations
- largest region: `449` stations

Measured synthetic build costs on this repo's current data shape:

- one region/station/system summary for `18,993` types
  - rows build: about `0.96 ms`
  - rowset wrapper build: about `0.55 ms`
  - JSON stringify of the rowset shape: about `1.94 ms`
  - payload size in rowset-like JSON: about `570,787 bytes` (`0.54 MiB`)
  - payload size in a compact typed-array layout: about `303,888 bytes` (`296.8 KiB`)

- one worst-case per-type order book in the largest region (`449` sell + `449` buy rows)
  - rows build: about `0.12 ms`
  - payload build: about `0.11 ms`
  - JSON stringify: about `0.23 ms`
  - payload size in rowset-like JSON: about `115,184 bytes` (`112.5 KiB`)
  - payload size in a compact typed-array layout: about `61,064 bytes` (`59.6 KiB`)

Measured local child-process IPC round-trip:

- `570,787` byte region summary blob: about `12.1 ms` average round-trip
- `115,184` byte per-type book blob: about `3.0 ms` average round-trip

Implications:

- a dedicated market proxy process is viable
- even without a main-process mirror cache, cached market reads should still be fast enough
- with a tiny main-process mirror cache, repeated opens can be effectively instant

Projected cache footprints:

- cache **all region summaries** at boot
  - typed-array layout: about `11.3 MiB`
  - JSON-ish row payload layout: about `21.2 MiB`
  - projected raw build time from measured numbers: roughly `40-80 ms`

- cache **all system summaries** at boot
  - typed-array layout: about `496.2 MiB`
  - JSON-ish row payload layout: about `931.9 MiB`
  - feasible, but too expensive for default boot

- cache **all station summaries** at boot
  - typed-array layout: about `1.46 GiB`
  - JSON-ish row payload layout: about `2.74 GiB`
  - not recommended

Projected "do not do this" number:

- if we materialize one seeded sell order and one seeded buy order for every station/type in the largest region:
  - `17,055,714` order rows
  - at only `120` bytes per row that is already about `1.91 GiB`
  - in real JS objects it would be much worse

Projected on-demand worst-case generation time if we naively built that whole largest-region order dump:

- row construction alone extrapolates to roughly `0.78 s`
- plus sort, wrap, marshal, allocate, and GC cost
- so this path is completely wrong for "instant open"

### Concrete latency budget that should feel instant

Recommended first-open path:

1. Market window opens.
2. Main server requests prebuilt region-best snapshot from market daemon.
3. Market daemon returns cached blob in about `12 ms` or less over IPC.
4. Main server wraps/sends response.

Recommended detail-open path:

1. Player selects a type.
2. Main server requests `(regionID, typeID)` order book from market daemon.
3. Market daemon returns cached or freshly built blob in about `3 ms` over IPC, plus sub-millisecond build cost if uncached.

Recommended repeat-open path:

1. Main server serves the last hot blob from its tiny mirror cache.
2. Effective server-side response cost becomes near-zero to low-single-digit milliseconds.

### How to hit those numbers

- no full-table scans on request
- lazy-build scope snapshots on first use
- versioned invalidation only for affected scope keys
- cache encoded rowset payloads
- keep real seeded stock in SQLite
- keep player/corp orders in the same authority store

### What to precompute vs what to build lazily

Precompute at boot:

- all `region-best` summaries
- seed price anchors
- station profile metadata
- type lookup tables

Build lazily and cache:

- `system-best` summaries
- `station-best` summaries
- `(regionID, typeID)` order books
- owner history views

Evict with LRU:

- station and system summaries
- type books

Never evict unless rebuilding:

- region-best summaries

## Implementation Phases

### Phase 1: Wire the service correctly

- add `marketProxyService.js`
- advertise `marketProxy` from `machoNet`
- keep `marketService.js` only as legacy alias or remove it
- add smoke test that the client can resolve `marketProxy`

Status:

- done for browse/read parity
- done for personal-character write-side settlement parity
- remaining functional parity gap is corporation market flow

### Phase 2: Read-only browse parity

- full market catalog from `itemTypes`
- station/system/region summaries
- type order book reads
- history reads
- cache versions

### Phase 3: Real order ownership views

- my orders
- corporation orders
- market order history
- escrow totals

### Phase 4: Write path

- place buy
- place sell
- bulk buy/sell
- modify
- cancel
- matching engine
- wallet/inventory side effects

### Phase 5: Corp + special cases

- corp wallets/divisions
- Market Deliveries
- PLEX/global region
- structure-specific taxes/access

### Phase 6: Hardening

- parity tests
- load tests
- benchmark script
- snapshot rebuild path

## Suggested File Layout

Recommended new files:

- `server/src/services/market/marketProxyService.js`
- `server/src/services/market/marketCatalog.js`
- `server/src/services/market/marketSeedEngine.js`
- `server/src/services/market/marketOrderBook.js`
- `server/src/services/market/marketMatching.js`
- `server/src/services/market/marketSnapshots.js`
- `server/src/services/market/marketPersistence.js`
- `server/src/services/market/marketNotifications.js`
- `server/src/services/market/marketBenchmark.js`

Files to extend:

- `server/src/services/machoNet/machoNetService.js`
- `server/src/services/cache/objCacheService.js`
- `server/src/services/account/walletState.js`
- `server/src/services/inventory/itemStore.js`
- `server/src/services/character/characterState.js`

## Tests We Should Add

- `server/tests/marketProxyRegistration.test.js`
- `server/tests/marketSummaryParity.test.js`
- `server/tests/marketOrderBookParity.test.js`
- `server/tests/marketMatchingEngine.test.js`
- `server/tests/marketWalletEscrow.test.js`
- `server/tests/marketInventorySettlement.test.js`
- `server/tests/marketCorporationOrders.test.js`
- `server/tests/marketHistoryAggregation.test.js`
- `server/tests/marketCacheInvalidation.test.js`
- `server/tests/marketPerformanceWarmCache.test.js`

## Local Code References

- `server/src/services/market/marketService.js`
- `server/src/services/market/marketState.js`
- `server/src/services/machoNet/machoNetService.js`
- `server/src/services/cache/objCacheService.js`
- `server/src/services/account/walletState.js`
- `server/src/services/inventory/itemStore.js`
- `server/src/newDatabase/index.js`
- `_local/codeccpFULL/code/eve/client/script/ui/services/marketsvc.py`
- `_local/codeccpFULL/code/eve/client/script/ui/shared/market/quote.py`
- `_local/codeccpFULL/code/eve/client/script/ui/shared/market/marketbase.py`
- `_local/codeccpFULL/code/marketutil/skilllimits.py`
- `_local/codeccpFULL/code/marketutil/brokerFee.py`
- `_local/codeccpFULL/code/marketutil/const.py`

## Research References

Official references used to shape parity rules and seed/import strategy:

- CCP Support: Buy and Sell Orders  
  https://support.eveonline.com/hc/en-us/articles/203218932-Buy-and-Sell-Orders

- CCP Support: Broker Fee and Sales Tax  
  https://support.eveonline.com/hc/en-us/articles/203218962-Broker-Fee-and-Sales-Tax

- CCP Support: Corporation Orders and Market Deliveries  
  https://support.eveonline.com/hc/en-us/articles/203280351-Corporation-Orders-and-Market-Deliveries

- CCP Developers: Global PLEX Market and SDE Update  
  https://developers.eveonline.com/blog/global-plex-market-and-sde-updates

- CCP Developers: X-Pages pagination  
  https://developers.eveonline.com/docs/services/esi/pagination/x-pages/

- CCP Developers: Market orders rate limiting / 5-minute cache reminder  
  https://developers.eveonline.com/blog/market-orders-rate-limit-rolls-out-on-february-24-2026

## Recommended Final Decision

If the goal is "full market parity, every station feels stocked, and opening market windows feels instant", the implementation should be:

- **real seeded stock rows in SQLite**
- **real player/corp orders persisted**
- **memory-first scope caches**
- **SQLite/DB as authority for dynamic state**
- **full region summaries on open, full order book only on item click**

That is now the current integrated implementation: standalone Rust market authority plus a Node `marketProxy` bridge for browse/read plus personal-character write-side settlement, with corporation market flow as the remaining functional parity gap.
