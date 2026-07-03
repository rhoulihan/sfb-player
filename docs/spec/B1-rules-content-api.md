# B1 — Rules Content Pipeline & Rules API

## Purpose & Scope

This subsystem turns the Captain's Edition Master Rulebook (and its Annexes) from a flat PDF into a structured, addressable **rule tree** — a graph of nodes keyed by canonical rule number (the `A0.0 … Z` lettered hierarchy) with parent/child containment and typed cross-links — and exposes that tree through a **gated Rules API** for verified rulebook owners. It also builds the hybrid **search index** (MongoDB full-text plus optional semantic vector embeddings), resolves any in-game term or ship system to its governing rule (**contextual lookup**), produces the canonical **Citation** object that the referee, GM-override flow, and event log attach to every ruling, and enforces the IP boundary: full rule text is served only to entitled accounts and never appears in public responses or in this spec. This is a *content/reference* subsystem — it never adjudicates play; it supplies the citations that the mechanics docs (Section C) and the GM-override flow reference.

PHASE: [v1 AM-tournament] PDF→tree ingestion for the rules needed by Advanced Missions tournament play, MongoDB text search, deep-linking, the Citation object, glossary/contextual lookup, and owner-gated access. [v2] vector/semantic embeddings + hybrid ranking, full cross-link graph, per-game GM rule annotations. [v3] full Master Rulebook coverage (all empires in the R-section, all modules, all Annexes) plus errata/edition versioning.

## Rulebook References

- The top-level lettered organization `A0.0 … Z` (rules sections A–Z; Annexes #1–#N) — the structural backbone the tree mirrors.
- (R0.1) — the **anomalous R-section numbering**: the digit after the dot is a consecutive ship index within an empire prefix, *not* a hierarchical sub-rule (e.g. R2.13 = the 13th Federation ship). The parser must special-case this; treating it like every other section produces a wrong tree.
- (R0.0)–(R0.8), with sub-items (R0.8.1) … (R0.8.19) — a canonical example of a deep, multi-level numbered rule used as a parsing/tree-shape fixture.
- Cross-link target examples drawn from the R0.0 catalog: (D4.0) Damage Allocation Chart, (S2.1) BPV, (C6.5) breakdown, (D3.3) shield cost, (B3.3) life support, (G13.2) cloak cost, (R0.6) size class, (G9.4) minimum crew, (C2.0)/(C3.0) movement & turn mode, (D2.0) firing arcs, (D7.8) hit-and-run, (F3.211) seeking-weapon control, (FP6.0) pseudo-plasma, (K3.0)/(J17.0) module rules.
- Reference-code keys (R{empire}.{index}, R#.R{n}, R#.F{n}, R#.PF{n} per R0.1) and **Annex #3** (Master Ship Chart) / **Annex #4** (fighter data) — non-prose tabular nodes the tree must model.

## Domain Model

```typescript
type RuleId = string;        // stable internal id, e.g. "rule_D4_0"
type RuleNumber = string;    // canonical printed number, e.g. "D4.0", "R2.13", "R0.8.9"
type SectionLetter = string; // "A".."Z"

interface RuleNode {
  ruleId: RuleId;
  ruleNumber: RuleNumber;       // canonical, normalized (no parentheses)
  section: SectionLetter;       // 'D' for D4.0
  title: string;                // short label, e.g. "Damage Allocation Chart"
  depth: number;                // 0 = section root, increasing per level
  parentId: RuleId | null;      // containment edge
  childIds: RuleId[];           // ordered children
  bodyText: string;             // GATED — entitled requests only
  bodyTokens?: number;          // length hint for chunking/UI
  crossLinks: RuleCrossLink[];  // outbound typed references
  termRefs: string[];           // glossary terms this node defines/uses
  source: SourceSpan;           // locator back into the PDF
  nodeKind: 'section' | 'rule' | 'subrule' | 'chart' | 'annex' | 'shipEntry';
  phase: 'v1' | 'v2' | 'v3';    // ingestion coverage tag
  edition: string;              // e.g. "CE-Master"
  errataVersion?: string;       // supersession marker
}

interface RuleCrossLink {
  targetNumber: RuleNumber;     // as printed in the source, normalized
  targetId: RuleId | null;      // resolved; null = dangling (not yet ingested)
  kind: 'see' | 'governed-by' | 'cost' | 'chart' | 'exception' | 'annex';
}

interface SourceSpan {            // provenance, never exposed to non-admins
  pdf: string;                    // 'ADB5412.pdf'
  pageStart: number; pageEnd: number;
  charStart: number; charEnd: number;
}

interface Citation {              // the canonical reference object (see §UI/Engine)
  ruleNumber: RuleNumber;
  ruleId: RuleId;
  title: string;
  anchor: string;                 // deep-link fragment, e.g. "#rule/D4.0"
  edition: string;
  errataVersion?: string;
  excerptAllowed: boolean;        // true only when the recipient is entitled
  excerpt?: string;               // populated only when excerptAllowed
}

interface GlossaryTerm {
  term: string;                   // canonical form, e.g. "high energy turn"
  aliases: string[];              // "HET", "high-energy turn"
  primaryRuleId: RuleId;          // defining rule (C6.52)
  relatedRuleIds: RuleId[];
  systemKeys: string[];           // SSD system keys bound here (e.g. "weapon.PH-1")
}

interface RuleEmbedding {         // [v2] semantic chunk
  ruleId: RuleId;
  chunkIndex: number;
  vector: number[];               // model output (e.g. 1024-d)
  model: string;                  // embedding model id, for re-embed invalidation
}

interface RulesEntitlement {      // who may read full text
  userId: string;
  verifiedOwner: boolean;
  proofKind: 'serial' | 'purchase' | 'gm-grant' | 'admin';
  grantedAt: Date; expiresAt?: Date;
}
```

Mongoose collections (sketch):

```typescript
const RuleSchema = new Schema({
  ruleId: { type: String, unique: true, index: true },
  ruleNumber: { type: String, index: true },
  section: { type: String, index: true },
  title: String,
  depth: Number,
  parentId: { type: String, index: true },
  childIds: [String],
  bodyText: String,                         // projection-excluded by default
  crossLinks: [{ targetNumber: String, targetId: String, kind: String }],
  termRefs: [String],
  source: { pdf: String, pageStart: Number, pageEnd: Number, charStart: Number, charEnd: Number },
  nodeKind: String, phase: String, edition: String, errataVersion: String,
}, { timestamps: true });
RuleSchema.index({ title: 'text', bodyText: 'text' }, { weights: { title: 8, bodyText: 1 } });

const GlossaryTermSchema = new Schema({
  term: { type: String, unique: true }, aliases: [String],
  primaryRuleId: String, relatedRuleIds: [String], systemKeys: [String],
});
const RulesEntitlementSchema = new Schema({
  userId: { type: String, index: true }, verifiedOwner: Boolean,
  proofKind: String, grantedAt: Date, expiresAt: Date,
});
// [v2] RuleEmbedding lives in Atlas Vector Search (preferred) or a Redis vector index
// aligned to the existing Redis infra; never returned to non-entitled callers.
```

## Events & Commands

The pipeline is an admin/content workflow plus a thin read path, so it emits **content-lifecycle events** (recorded in `gameEvents`-style admin logs, see `A3-data-architecture-event-store.md`) and contributes the Citation that game-domain events carry.

Commands (PascalCase, admin/host scoped):
- `IngestRulebook { pdf, edition, sectionFilter?, phase }`
- `PublishRuleTree { edition, treeVersion }`
- `RebuildSearchIndex { scope: 'text' | 'vector' | 'both', model? }`
- `GrantRulesAccess { userId, proofKind, expiresAt? }` / `RevokeRulesAccess { userId }`
- `LookupRule { ruleNumber | term, gameId?, requesterId }` (read; never mutates)
- `AnnotateRuleForGame { gameId, ruleNumber, note }` (GM house-ruling overlay; per game, never mutates canon)

Events (past-tense):
- `RulebookIngested { edition, nodeCount, danglingLinks[] }`
- `RuleTreePublished { edition, treeVersion, publishedAt }`
- `SearchIndexRebuilt { scope, model, vectorCount }`
- `RulesAccessGranted { userId, proofKind, expiresAt? }` / `RulesAccessRevoked { userId }`
- `RuleCited { gameId, citation, context }` — emitted when the referee or a player cites a rule; the canonical Citation is also embedded in `GmOverrideApplied` (see `D9-gm-spectator-console.md`) and in validation-rejection payloads from Section C engines, so every ruling is traceable to a rule number.
- `RuleAnnotatedForGame { gameId, ruleNumber, note, by }`

## Engine / API

Pure (side-effect-free) core, with thin DB/HTTP wrappers around it:

```typescript
// --- Ingestion (admin, offline) ---
function parseRulebookPdf(pdf: string): RawSegment[];            // multi-column→linear, de-hyphenate
function segmentToNodes(seg: RawSegment[]): RuleNode[];          // detect numbers, titles, charts
function buildRuleTree(nodes: RuleNode[]): RuleNode[];           // assign parentId/childIds, depth
function extractCrossLinks(node: RuleNode): RuleCrossLink[];     // scan body for "(X#.#)" patterns
function resolveCrossLinks(tree: RuleNode[]): { resolved: number; dangling: RuleCrossLink[] };

// --- Number resolution (handles the R0.1 anomaly) ---
function parseRuleNumber(ref: string): { section: SectionLetter; isShipEntry: boolean; parts: number[] };
function resolveRuleNumber(ref: string): RuleId | null;

// --- Read path ---
function getRule(ruleNumber: RuleNumber, ent: RulesEntitlement): RuleNode;   // strips bodyText if !entitled
function getChildren(ruleId: RuleId, ent: RulesEntitlement): RuleNode[];
function searchRules(q: string, opts: SearchOpts, ent: RulesEntitlement): RuleSearchResult[];
function lookupTerm(term: string, ctx?: { gameId?: string; systemKey?: string }): RuleNode[];
function formatCitation(node: RuleNode, ent: RulesEntitlement): Citation;     // sets excerptAllowed
```

REST surface (all under owner-gated middleware; see §Validation):

| Method & path | Purpose |
|---|---|
| `GET /api/rules/:ruleNumber` | One node; body only if entitled |
| `GET /api/rules/:ruleNumber/children` | Ordered child nodes |
| `GET /api/rules/tree?section=` | Tree skeleton (numbers + titles, no body) |
| `GET /api/rules/search?q=&mode=text|semantic|hybrid` | Ranked results |
| `GET /api/rules/lookup?term=` / `?systemKey=` | Contextual lookup |
| `GET /api/rules/glossary/:term` | Glossary entry + citations |
| `POST /api/admin/rules/ingest` | `IngestRulebook` (admin) |
| `POST /api/admin/rules/publish` | `PublishRuleTree` (admin) |
| `POST /api/admin/rules/reindex` | `RebuildSearchIndex` (admin) |
| `POST /api/admin/rules/access` | `GrantRulesAccess` / `RevokeRulesAccess` |

Deep-linking: every node yields a stable anchor `#rule/<ruleNumber>`; the SPA route `/rules/:ruleNumber` resolves it, and Citation objects in the event log render as clickable chips pointing at the same anchor.

## Validation & Enforcement Rules

- **Access gate (referee for IP):** an Express middleware loads the caller's `RulesEntitlement`. Non-entitled callers receive only *metadata* — `ruleNumber`, `title`, `anchor`, tree position — and `bodyText`/`excerpt` are stripped by `getRule`/`formatCitation` (`excerptAllowed=false`). Search for non-entitled callers returns title/number matches only, never snippets of rule prose. This is enforced server-side in the projection, not the client.
- **Number-resolution rule:** `resolveRuleNumber` first reads the section letter; for `R` it applies the R0.1 rule (ship-entry indexing) and refuses to descend the dot as a sub-rule; for all other sections it parses dot-separated parts as a containment path. Ambiguous or malformed refs resolve to `null` and surface as dangling links, never as a silent wrong match.
- **Dangling cross-links:** links whose target is not yet ingested (v1 referencing v2/v3 content) are stored with `targetId=null` and reported in `RulebookIngested.danglingLinks`; the API marks them non-clickable rather than 404-ing.
- **Annex/chart nodes:** Annex #3/#4 and on-page charts (DAC, Movement Cost) are `nodeKind:'chart'|'annex'` with structured payloads, not free prose; the single source of truth for ship scalars is `B3-game-catalog-ssd-model.md`, which *links* to these nodes rather than duplicating them.
- **Rate limiting:** search and lookup endpoints sit behind `express-rate-limit` to deter scraping of gated text.
- **GM-override point:** a GM may attach a per-game annotation (`AnnotateRuleForGame`) — a house-ruling overlay scoped to one `gameId`. It never mutates canonical nodes; the API merges it only into that game's lookups. Any in-game ruling overridden via `GmOverrideApplied` (see `D9-gm-spectator-console.md`) carries the canonical Citation so the override is auditable against the rule it set aside.

## UI Contract

The client needs: (1) a **Rules Reference panel** with section tree, breadcrumb, and body pane (body present only when entitled); (2) a **search box** with text/semantic/hybrid toggle and title+number autocomplete; (3) **contextual tooltips** — hovering any SSD system, weapon, or HUD term calls `lookup?systemKey=` and shows the citation with a "open rule" deep-link; (4) **citation chips** rendered inline in the event log, the GM-override dialog, and validation-rejection toasts, each linking to `#rule/<number>`; (5) a clear "rules text hidden — verify ownership" state for non-entitled users. Screen layout, panel docking, and the wireframe live in `D7-rules-browser-ui.md` (wireframe: `docs/spec/wireframes/D7-rules-browser.svg`). All rule-body rendering must respect `excerptAllowed`; the client never caches gated text to local storage.

## Dependencies

- `A3-data-architecture-event-store.md` — admin content-lifecycle events and the in-game `RuleCited` event/log fold.
- `A2-identity-roles-gating.md` — verified-owner entitlements, roles, session/JWT context the access gate reads.
- `D9-gm-spectator-console.md` — `GmOverrideApplied` carries the Citation; per-game rule annotations.
- `B3-game-catalog-ssd-model.md` — consumes reference codes (R{empire}.{index}) and binds SSD `systemKey`s to glossary terms for contextual lookup.
- Section C mechanics docs (e.g. `C2-energy-allocation-power.md`, `C4-direct-fire-combat.md`, `C1-sequence-of-play-engine.md`) — emit validation rejections and rulings that resolve rule numbers through this subsystem (e.g. D4.0, C6.5, D3.3).
- `A1-deployment-infrastructure.md` — hosting for the embedding model / Atlas Vector Search (or Redis vector index) and the offline ingestion job.

## Edge Cases & Open Questions

- **R-section anomaly (R0.1):** must be unit-tested so `R2.13` never parses as `R2 → .1 → 3`. Refits/fighters/PFs (R#.R/F/PF) add letter-keyed indices that also break dot-path assumptions.
- **Multi-column / hyphenated PDF:** `ADB5412.pdf` is two-column with mid-word line breaks and chart graphics; OCR/segmentation needs a de-hyphenation and column-merge pass, with a manual review queue for charts.
- **Errata & module updates** (e.g. Module G3A carrier-chart updates): need an `errataVersion`/edition supersession model so a newer node can mark an older one superseded without losing provenance.
- **Multi-target citations:** a single ruling may cite several rules (e.g. firing = D2.0 arc + D4.0 damage); Citation is single-rule, so rulings carry `Citation[]`.
- **Embedding drift:** changing the embedding `model` invalidates all `RuleEmbedding` vectors; re-index must be atomic against live search.
- **Open:** exact tournament-relevant section subset for v1 ingestion (which R-section ships, which P/tournament rules) — to be pinned with the scenario/fleet-build doc.
- **Open:** semantic-search ranking blend (text vs vector weights) and whether snippets to entitled users should be sentence- or rule-scoped.

## Testing

- **Golden-tree fixtures:** ingest the R0.8 block and assert the tree shape — root R0.8 with ordered children R0.8.1 … R0.8.19 at the correct depth; assert the SSD geometry sub-rule (R0.8.9) parses as a leaf rule, not a section.
- **Number-resolution suite:** `resolveRuleNumber('R2.13')` → a `shipEntry` node (13th Federation ship), distinct from any `R2 > .1` path; `resolveRuleNumber('D4.0')`, `('R0.8.9')`, `('F3.211')` resolve to the expected containment.
- **Cross-link resolution:** feed the R0.0 catalog's cross-ref list (D4.0, S2.1, C6.5, D3.3, B3.3, G13.2, R0.6, G9.4, C2.0, C3.0, D2.0, D7.8, F3.211, FP6.0, K3.0, J17.0) and assert each resolves or is reported dangling — none silently mis-resolve.
- **Access-control:** an entitled request returns `bodyText`; an identical non-entitled request returns the same node with body/excerpt stripped and `excerptAllowed=false`; search by a non-entitled user yields zero prose snippets.
- **Citation round-trip:** `formatCitation` → anchor `#rule/D4.0` → SPA route → same node; chips in a simulated `GmOverrideApplied` event resolve back to the cited rule.
- **Annex modeling:** Annex #3/#4 ingest as structured chart nodes; `B2` lookups resolve through them without duplicating scalars.

## Phasing

- **[v1 AM-tournament]:** ingest the rules sections and tournament ships needed for Advanced Missions play; build the parent/child tree with R0.1-aware number resolution; MongoDB text index; deep-linking; the Citation object and `RuleCited` wiring into the event log and GM-override flow; glossary + contextual `systemKey` lookup for v1 terms; owner-gated access with metadata-only fallback. Rationale: tournament play is the first playable milestone, so only the citations its mechanics raise must resolve.
- **[v2]:** vector/semantic embeddings (Atlas Vector Search or Redis vector index) with hybrid ranking; complete cross-link graph including forward refs; per-game GM rule annotations. Rationale: semantic search and house-rules overlays add reach but are not required to referee a tournament game.
- **[v3]:** full Master Rulebook ingestion — all empires across the R-section, all modules, all Annexes — plus errata/edition versioning and multi-edition supersession. Rationale: complete coverage scales the same pipeline once the v1/v2 contracts are proven.
