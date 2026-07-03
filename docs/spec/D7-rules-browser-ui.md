# D7 — Rules Reference Browser UI

## Purpose & Scope

This document specifies the **client experience for reading the rules** — the screen through which a verified owner navigates, searches, and deep-links the Captain's Edition Master Rulebook while playing. D7 is a *pure consumer* of the gated Rules API in `B1-rules-content-api.md`: B1 owns the rule tree, the search index, the `Citation` object, and the IP access gate; D7 renders them. The browser offers four entry paths — (1) **search** (full-text in v1, semantic/hybrid in v2) with title+number autocomplete; (2) **tree navigation** down the `A0.0 … Z` lettered hierarchy plus Annexes; (3) **deep-link by rule number** via the stable `#rule/<ruleNumber>` anchor so any citation in the app opens the exact rule; and (4) **contextual open-from-game** — clicking an SSD system, a HUD term, a legality-rejection chip, or a GM-override citation jumps straight to its governing rule without disturbing live game state. It also owns the small amount of *user-scoped state* the reading experience needs — **bookmarks, reading history, and saved searches** — which are the only things D7 persists; everything substantive is read from B1. D7 never adjudicates and never relaxes the IP boundary: it faithfully reflects the server's `excerptAllowed` flag and shows a verify-ownership prompt when text is withheld.

PHASE: [v1 AM-tournament] tree nav, full-text search, deep-linking, the rule-body reader with the gated-text placeholder, contextual open-from-game for v1 `systemKey`s, citation chips fed from legality/override/event-log, bookmarks + history, and display of per-game GM rule annotations. [v2] semantic/hybrid search UI with ranking controls, saved searches, cross-link graph view, PWA metadata caching. [v3] full Master Rulebook browsing, the errata/edition switcher with supersession badges, and a GM annotation-authoring surface.

## Rulebook References

D7 implements no game rule; it must **render and resolve** these correctly:

- The top-level `A0.0 … Z` lettered organization plus **Annexes #1–#N** — the shape of the tree navigator.
- **(R0.1)** — the anomalous R-section numbering: the tree must render `R2.13` (the 13th Federation ship) as a **sibling ship entry**, never as a child of `R2.1`. The navigator special-cases the `R` section exactly as B1's `parseRuleNumber` does.
- **(R0.0)–(R0.8)** with sub-items **(R0.8.1)…(R0.8.19)** — the canonical deep, multi-level node used as the tree-render and breadcrumb fixture.
- **(R0.2)** — the "Commander's SSD" philosophy (everything needed at the table, no rulebook flipping) is the design north star for contextual lookup: the rule you need is one click from the thing you clicked.
- The cross-reference catalog the contextual lookup and cross-link chips must resolve: **(D4.0)** Damage Allocation Chart, **(C6.5)** breakdown, **(D3.3)** shield cost, **(B3.3)** life support, **(G13.2)** cloak cost, **(R0.6)** size class, **(G9.4)** minimum crew, **(C2.0)/(C3.0)** movement & turn mode, **(D2.0)** firing arcs, **(D7.8)** hit-and-run, **(F3.211)** seeking-weapon control, **(FP6.0)** pseudo-plasma.

## Domain Model

D7 reuses B1's read types (`RuleNode` metadata projection, `Citation`, `GlossaryTerm`) and adds **client view-models** plus its own **user-scoped persisted collections**.

```typescript
import type { RuleNumber, RuleId, Citation } from './B1';

// ---- View-models (client-only) ----
interface RuleTreeNode {            // skeleton row from GET /api/rules/tree
  ruleId: RuleId;
  ruleNumber: RuleNumber;
  title: string;
  depth: number;
  nodeKind: 'section' | 'rule' | 'subrule' | 'chart' | 'annex' | 'shipEntry';
  hasChildren: boolean;
  isShipEntry: boolean;             // R0.1 flag → render as sibling, not nested dot-path
}

interface RuleBodyView {            // GET /api/rules/:ruleNumber
  node: RuleTreeNode;
  breadcrumb: RuleTreeNode[];       // root → … → this node
  bodyHtml: string | null;         // null when excerptAllowed === false
  excerptAllowed: boolean;         // mirrors B1; client NEVER overrides
  crossLinks: { citation: Citation; kind: string; clickable: boolean }[];
  termChips: { term: string; anchor: string }[];
  gmAnnotation?: { gameId: string; note: string; by: string };  // per-game overlay (B1)
}

interface SearchResultView {
  citation: Citation;
  matchSnippet: string | null;     // null for non-entitled callers (B1 strips prose)
  score: number;
  mode: 'text' | 'semantic' | 'hybrid';
}

interface ContextSource {          // who opened the browser, for "back to game" breadcrumb
  kind: 'tree' | 'search' | 'deeplink' | 'ssd' | 'hud' | 'legality' | 'override' | 'eventlog';
  gameId?: string;
  systemKey?: string;              // e.g. 'weapon.PH-1' (B3 SSD key)
  unitId?: string;
  originLabel?: string;            // "Federation CA · PH-1 mount"
}

// ---- Persisted, user-scoped (NOT game events) ----
interface Bookmark {
  userId: string;
  ruleId: RuleId;                  // primary key — survives renumber/errata
  ruleNumber: RuleNumber;         // display + fallback resolve
  title: string;                  // metadata only — never the body
  folder?: string;
  createdAt: Date;
}
interface ReadingHistoryEntry {
  userId: string;
  ruleId: RuleId;
  ruleNumber: RuleNumber;
  title: string;
  source: ContextSource['kind'];
  gameId?: string;
  viewedAt: Date;
}
interface SavedSearch {            // [v2]
  userId: string;
  query: string;
  mode: 'text' | 'semantic' | 'hybrid';
  label: string;
  createdAt: Date;
}
interface BrowserPrefs {
  userId: string;
  treeWidthPx: number;
  defaultSearchMode: 'text' | 'semantic' | 'hybrid';
  openFromGameAs: 'drawer' | 'overlay';
  expandedSections: string[];            // remembered tree open-state (section letters)
}
```

Mongoose collections (D7-owned; ordinary CRUD, outside the per-game `gameEvents` log):

```typescript
const BookmarkSchema = new Schema({
  userId: { type: String, index: true },
  ruleId: { type: String, index: true },
  ruleNumber: String, title: String, folder: String,
}, { timestamps: true });
BookmarkSchema.index({ userId: 1, ruleId: 1 }, { unique: true });

const ReadingHistorySchema = new Schema({
  userId: { type: String, index: true },
  ruleId: String, ruleNumber: String, title: String,
  source: String, gameId: { type: String, index: true },
  viewedAt: { type: Date, index: true },
});
ReadingHistorySchema.index({ userId: 1, viewedAt: -1 });   // recent-first feed

const SavedSearchSchema = new Schema({                       // [v2]
  userId: { type: String, index: true }, query: String, mode: String, label: String,
}, { timestamps: true });

const BrowserPrefsSchema = new Schema({
  userId: { type: String, unique: true },
  treeWidthPx: { type: Number, default: 280 },
  defaultSearchMode: { type: String, default: 'text' },
  openFromGameAs: { type: String, default: 'drawer' },
  expandedSections: [String],
});
// No body/excerpt text is ever stored here — bookmarks/history hold metadata only.
```

## Events & Commands

D7's mutations are **user-state**, not game state, so its events persist to user collections rather than the append-only game log. The one game-log interaction is *reading*: when a GM cites a rule into a live game during adjudication, the browser triggers B1's `RuleCited`, which is appended to `gameEvents` via `A3-data-architecture-event-store.md` (B1 owns that event; D7 only invokes it).

Commands (PascalCase):
- `AddBookmark { ruleId, ruleNumber, title, folder? }` / `RemoveBookmark { ruleId }`
- `RecordRuleView { ruleId, ruleNumber, title, source, gameId? }`
- `SaveSearch { query, mode, label }` / `DeleteSavedSearch { savedSearchId }` *(v2)*
- `SetBrowserPref { key, value }`
- `CiteRuleIntoGame { gameId, ruleNumber }` — GM/host only; forwards to B1, which emits `RuleCited`.

Events (past-tense, user-scoped): `BookmarkAdded`, `BookmarkRemoved`, `RuleViewed`, `SearchSaved`, `SearchDeleted`, `BrowserPrefSet`.

Consumed (from other subsystems): `RuleCited` and the embedded `Citation` inside `GmOverrideApplied` (B2/A5 flow) and inside Section-C validation-rejection payloads — each renders as a clickable chip that opens D7 at `#rule/<number>`.

## Engine / API

The "engine" of a UI doc is the **client controller/store** plus the **thin BFF endpoints** for D7's own persistence; the heavy reads are proxied to B1.

```typescript
// ---- Deep-link routing (pure) ----
function parseAnchor(anchor: string): { ruleNumber: RuleNumber } | null;   // '#rule/D4.0'
function buildAnchor(c: Citation): string;                                  // '#rule/D4.0'

// ---- Browser controller (client store actions) ----
function openRule(ruleNumber: RuleNumber, src: ContextSource): Promise<RuleBodyView>;
function navigateTree(ruleId: RuleId, expand: boolean): Promise<RuleTreeNode[]>;
function search(q: string, mode: SearchMode): Promise<SearchResultView[]>;
function autocomplete(prefix: string): Promise<RuleTreeNode[]>;            // title+number
function openFromGame(ctx: ContextSource): Promise<RuleBodyView>;          // systemKey | ruleRef
function followCrossLink(c: Citation): Promise<RuleBodyView>;              // pushes nav stack
function back(): RuleBodyView | null;  function forward(): RuleBodyView | null;

// ---- User state (BFF) ----
function toggleBookmark(ruleId: RuleId): Promise<Bookmark | null>;
function pushHistory(e: Omit<ReadingHistoryEntry,'userId'|'viewedAt'>): Promise<void>;
function restoreSession(): Promise<{ prefs: BrowserPrefs; bookmarks: Bookmark[]; recent: ReadingHistoryEntry[] }>;
```

Consumed B1 endpoints (all behind B1's owner-gate): `GET /api/rules/:ruleNumber`, `…/children`, `…/tree?section=`, `…/search?q=&mode=`, `…/lookup?term=|systemKey=`, `…/glossary/:term`. D7's own BFF surface:

| Method & path | Purpose |
|---|---|
| `GET /api/me/rules/session` | `restoreSession` (prefs + bookmarks + recent history) |
| `POST /api/me/rules/bookmarks` / `DELETE …/:ruleId` | `AddBookmark` / `RemoveBookmark` |
| `POST /api/me/rules/history` | `RecordRuleView` |
| `GET /api/me/rules/history?gameId=` | history feed (optionally game-scoped) |
| `POST /api/me/rules/saved-searches` / `DELETE …/:id` | saved searches *(v2)* |
| `PATCH /api/me/rules/prefs` | `SetBrowserPref` |
| `POST /api/games/:id/cite` | `CiteRuleIntoGame` → B1 `RuleCited` (GM/host) |

The SPA route `/rules/:ruleNumber` and the in-game drawer both resolve through `openRule`; `#rule/<number>` anchors round-trip identically whether clicked in the event log, an override dialog, or pasted into the address bar.

## Validation & Enforcement Rules

D7 is a faithful mirror of an **authoritative** gate — it adds convenience, never permission:

- **Entitlement is server-enforced, client-reflected.** `RuleBodyView.bodyHtml` is `null` whenever B1 returns `excerptAllowed === false`; the reader then shows the verify-ownership state and a link to the upgrade flow in `A2-identity-roles-gating.md`. The client never reconstructs withheld text and never assumes entitlement from a cached metadata response.
- **No gated text at rest.** Bookmarks, history, and saved searches persist **metadata only** (`ruleId`, `ruleNumber`, `title`). D7 must not write rule prose to `localStorage`, `IndexedDB`, or a service-worker cache; only tree skeletons and citations (already non-prose) may be cached for offline navigation.
- **R0.1 render correctness.** The tree builder trusts `RuleTreeNode.isShipEntry` from B1 and renders ship entries as flat siblings under the empire prefix; it never derives nesting by splitting the dotted number for the `R` section.
- **Contextual lookup degrades gracefully.** A `systemKey` or `ruleRef` that resolves to a dangling/not-yet-ingested node (v1 referencing v2/v3 coverage) opens a "not yet available in this edition" panel — never a 404 or a broken chip.
- **Fog-of-war for spectators.** A `spectator` performing a `systemKey` lookup may only resolve keys for **public** SSD boxes; resolving a hidden-system key is refused server-side (per `A2`/`A4` fog rules) so the browser cannot be used to infer concealed loadouts.
- **Rate limiting.** Search/lookup inherit B1's `express-rate-limit` scraping guard; autocomplete is debounced client-side and capped server-side.
- **GM-override point.** A GM may attach a per-game annotation (B1's `AnnotateRuleForGame`); D7 renders it as an inline callout **scoped to that `gameId`**, clearly distinguished from canonical text, and never lets it overwrite or hide the canonical body.

## UI Contract

**Wireframe:** `docs/spec/wireframes/D7-rules-browser.svg` (callout numbers below map to the figure).

**Layout — three panes under a top bar.** The browser is a responsive three-pane shell that runs both as a full-page route (`/rules/:ruleNumber`) and as an in-game **drawer** docked to the right of the battle map.

- **(1) Top bar.** Left-to-right: back/forward arrows driving the navigation stack; the **search box** with a **mode segmented-control** (Text · Semantic · Hybrid — Semantic/Hybrid disabled with a "v2" tooltip until available); a **share/deep-link** button that copies the `#rule/<number>` anchor; and an **entitlement badge** (green "Full text" when `excerptAllowed`, amber "Verify ownership" otherwise, linking to the A2 upgrade flow).
- **(2) Left pane — Rule-Tree Navigator.** A virtualized, collapsible outline of sections `A … Z` and **Annexes**, expand-on-click, with the active node highlighted and auto-scrolled into view. The `R` section renders empires as groups whose ship entries (e.g. `R2.13`) are **flat siblings** — the visual proof of the R0.1 rule. A type-to-filter field at the top of the pane narrows the tree by number or title. Pane width is draggable and remembered in `BrowserPrefs`.
- **(3) Center pane — Reader / Results.** Two interchangeable views:
  - **Reader:** a **breadcrumb** (root → … → current), the rule number + title heading, then the **body** — rendered HTML when entitled, or a **gated placeholder** card ("Rules text hidden — verify ownership") when not. Below the body sit **cross-link chips** (each a `Citation`; clickable when resolved, greyed when dangling) and **glossary term chips**. A per-game **GM annotation callout** appears above the body when one exists for the active game.
  - **Results:** a ranked list of `SearchResultView` rows — number, title, score, and a **snippet** (only for entitled users; non-entitled users see title/number matches with no prose). Clicking a row loads it in the Reader and pushes history.
- **(4) Right pane — Utility rail.** Tabs for **Bookmarks** (foldered, one-click toggle from any rule via a star in the Reader header), **History** (recent-first, game-scoped filter chip when opened from a game), and **On this page** (a mini-TOC of the current node's children + outbound cross-links). In v2 a **Saved Searches** tab joins them.

**Contextual open-from-game (5).** Every rule-bearing surface deep-links here: clicking an SSD system or weapon mount (`D2` SSD panel, key `weapon.PH-1` etc.), a HUD term (`D6`), a legality-rejection chip (`B2` dry-run reasons carry `ruleRef`), or a `Citation` in the event log / GM-override dialog (`D9`). These open the **drawer** variant so the live game, socket connection, and any open submission window remain intact (`A4`); a **"← back to game"** context breadcrumb names the originating element (`ContextSource.originLabel`) and returns focus exactly where it left. The drawer never steals focus from an active timed sealed-order input.

**Interaction details.** Keyboard: `/` focuses search, `↑/↓/Enter` traverse results and tree, `[`/`]` are back/forward, `b` toggles bookmark, `Esc` closes the drawer. Hovering any cross-link or glossary chip shows a citation tooltip (number + title) before navigation. Autocomplete is debounced 150 ms and shows number+title rows. On narrow/mobile widths the three panes collapse into a single column with a segmented switcher (Tree · Reader · Tools), and the in-game drawer becomes a full-height overlay.

## Dependencies

- `B1-rules-content-api.md` — the backing read API: rule tree, search, `lookup`/glossary, the `Citation` object, the `#rule/<number>` anchor convention, and the server-side IP gate. **D7 renders B1; it owns no rule content.**
- `A2-identity-roles-gating.md` — verified-owner entitlement that drives `excerptAllowed`, the ownership-verification upgrade flow the gated placeholder links to, and the `spectator` fog rules constraining `systemKey` lookups. (A2 explicitly names this doc as the metadata-to-full-text surface.)
- `A3-data-architecture-event-store.md` — appends `RuleCited` to `gameEvents` when a GM cites into a live game; pattern for user-scoped CRUD persistence.
- `A4-realtime-sync-layer.md` — keeps the game/socket session alive while the in-game drawer is open; fog-filtered context so lookups can't leak hidden state.
- `B2-rules-engine-core.md` — dry-run legality reasons carry a deep-linkable `ruleRef` (B2 §UI references `D7` directly); the chips in those reasons open this browser.
- `B3-game-catalog-ssd-model.md` — supplies the SSD `systemKey`s that contextual lookup resolves to governing rules; the SSD panel (`D2`) hosts the click.
- Sibling UI surfaces that deep-link inbound: `D2` (SSD panel), `D5` (targeting/combat), `D6` (impulse HUD), `D9` (GM/spectator console & override dialog).

## Edge Cases & Open Questions

- **Dangling deep-links.** `/rules/<number>` for a node outside the current edition's coverage (v1 vs v3) must render "not yet available," not a 404; the address bar URL stays valid for when the node is later ingested.
- **R0.1 in the tree.** Continuously verify that `R2.13` is a sibling ship entry and `R#.R/F/PF` refit/fighter/PF codes render as their own grouped lists, not dot-path children.
- **Open during a submission window.** Opening the drawer mid-sealed-order must not steal focus from, or pause, the timed input (`A4`); proposed: drawer opens non-modal, input retains focus, a subtle "rule open" badge appears on the HUD.
- **Spectator inference.** Contextual `systemKey` lookups must be restricted to public boxes for spectators so the browser cannot reveal concealed loadouts; confirm the exact public/hidden box partition with `A2`/`A4`.
- **Errata/renumber drift.** Bookmarks key on `ruleId` (stable) with `ruleNumber` as display + fallback, so a renumbered or superseded rule still resolves; the edition switcher (v3) must badge superseded targets.
- **Multi-citation rulings.** `GmOverrideApplied`/legality reasons may carry `Citation[]`; the chip strip renders all and the Reader offers "open all in tabs."
- **Open:** should reading history sync across devices (server-persisted, proposed) or stay device-local for privacy? **Open:** semantic-search ranking controls — expose a text/vector weight slider in v2 or keep the blend server-fixed?

## Testing

- **Deep-link round-trip:** `buildAnchor` → `#rule/D4.0` → `parseAnchor` → `openRule` renders the Damage Allocation Chart node; the same anchor pasted into `/rules/D4.0` resolves identically.
- **Entitlement reflection:** an entitled session renders `bodyHtml`; an identical non-entitled session shows the gated placeholder with **no rule prose in the DOM or network payload**; assert bookmarks/history rows contain only metadata and that `localStorage`/`IndexedDB`/SW caches hold no body text.
- **R0.1 tree render:** assert `R2.13` is a sibling ship entry (not nested under `R2.1`) and that `R#.R1`/`R#.F1`/`R#.PF1` render in their grouped lists.
- **Contextual lookup:** clicking SSD `systemKey='weapon.PH-1'` opens the governing rule via B1 `lookup`; a deliberately dangling key opens the graceful "not yet available" panel.
- **Open-from-game integrity:** the drawer opens over the live HUD without dropping the socket or revealing fog, the "← back to game" breadcrumb restores prior focus, and focus is **not** stolen during an active submission window.
- **Cross-link fixture:** feed the R0.0 catalog cross-refs (D4.0, C6.5, D3.3, B3.3, G13.2, R0.6, G9.4, C2.0, C3.0, D2.0, D7.8, F3.211, FP6.0) and assert each chip either navigates or renders non-clickable-dangling — none mis-navigate.
- **Persistence round-trip:** `toggleBookmark` then `restoreSession` returns it; history is recent-first and game-filterable; a v2 saved search re-runs to the same result set.
- **Navigation stack:** `back`/`forward` after a chain of cross-link follows returns the correct nodes; spectator `systemKey` lookups of hidden boxes are refused.

## Phasing

- **[v1 AM-tournament]:** the three-pane shell, tree navigator (R0.1-correct), full-text search with autocomplete, the rule-body reader with the gated-text placeholder and entitlement badge, deep-linking (`#rule/<number>` + `/rules/:ruleNumber`), contextual open-from-game as a drawer for v1 `systemKey`s, citation chips wired from legality/override/event-log, bookmarks + reading history (server-persisted), and display of per-game GM annotations. Rationale: a referee-grade tournament game must let players resolve any cited rule in one click without leaving the board.
- **[v2]:** semantic/hybrid search modes with optional ranking controls, saved searches, a cross-link graph view, and PWA caching of non-prose metadata for fast offline navigation. Rationale: richer discovery that is not required to referee a game.
- **[v3]:** full Master Rulebook browsing across all empires/modules/Annexes, the errata/edition switcher with supersession badges, and a GM annotation-authoring surface. Rationale: complete coverage and house-rule authoring scale the same shell once the v1/v2 contracts are proven.
