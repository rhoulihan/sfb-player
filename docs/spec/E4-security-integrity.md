# E4 — Security & Integrity

## Purpose & Scope

This subsystem is the cross-cutting trust boundary of SFB Online: it guarantees that the *only* way to learn a hidden fact or change a committed decision is to play the game legally. It owns four interlocking guarantees. (1) **Sealed-order integrity** — every secret commitment (B2.4) is hash-committed and encrypted server-side the instant it arrives, so no side can peek at another's plaintext and no side (including the submitter) can alter a sealed decision after the lock barrier closes. (2) **Server-enforced fog of war** — a single default-deny serialization boundary through which *all* outbound game state passes, so a client is physically incapable of receiving a field its observer has not earned. (3) **Action authorization & anti-cheat** — every command is gated by the `A2-identity-roles-gating.md` chokepoint, and a defense-in-depth layer records integrity anomalies that the architecture already makes impossible-by-construction. (4) **Platform hardening** — the HTTP/socket security posture (Helmet, CSRF, input sanitization, rate limiting) and the immutable audit trail, all aligned to the sibling `wavemax-affiliate-program` stack so the two apps share operational runbooks. E4 implements *no game rules*; it protects the rules the other docs implement. It automates all cryptography, masking, and rate enforcement; it never makes a tactical choice and never decides legality (that is `B2-rules-engine-core.md`).

**PHASE:** Sealed-order HMAC commitment + at-rest encryption, the fog default-deny serialization boundary, the authorization chokepoint integration, Helmet/CSRF/sanitization, REST + socket rate limiting, and the audit/integrity collections are **[v1 AM-tournament]**. Behavioral anti-cheat heuristics, spectator-reveal key management, and federated audit export are **[v2]**; per-tenant KMS, anomaly ML scoring, and signed client attestation are **[v3 full Master]**.

## Rulebook References

The rulebook legislates *what must stay secret* and *what may not change once committed*; E4 is the software that makes those guarantees unbreakable rather than gentlemanly:

- **(B2.4)** Secret & simultaneous announcements — the canonical rule E4 enforces cryptographically: decisions are committed in secret, frozen, then revealed together, with no information leaking from the order of announcement.
- **(B2.3 step 1, 6B, 6D)** Energy Allocation, sealed Impulse Activity, and Direct-Fire/EW windows — the concrete sealed steps whose payloads E4 commits and encrypts (window choreography in `A4-realtime-sync-layer.md`).
- **(D6.32, D17.194)** EW levels are *public* state — the allowlist marks ECM/ECCM totals and source breakdown as broadcastable, distinguishing them from genuinely hidden facts.
- **(D17.0, D17.3–D17.5)** Tactical Intelligence ladder — the per-`(observer,target)` info level that determines which fields the fog boundary may serialize (computed by `C8-ew-sensors-cloak.md`).
- **(D20.0–D20.3)** Hidden deployment — `secretHex` is `serverOnly` and never serialized to an opponent.
- **(G13.0–G13.6)** Cloaking — a cloaked unit's exact hex is downgraded to an approximate-location field; the fog boundary enforces the masking.
- **(S0.0, T0.0)** Scenario/tournament integrity — the human "referee" maps to the `gm` role whose overrides E4 records; tournament fairness is the property the whole subsystem protects.

## Domain Model

E4 does **not** own the sealed-order *row* (that is `sealedOrders`, owned by `A3-data-architecture-event-store.md` and written via `A4-realtime-sync-layer.md`); it owns the *cryptographic envelope* layered onto that row, the per-game key registry, and the audit/integrity collections referenced as "owned by E4" in A2 and A3.

```ts
type GameId = string; type AccountId = string; type SideId = string;
type GameRole = 'gm' | 'commander' | 'player' | 'spectator';
type InfoLevel = 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'|'L'|'M'; // from C8

// --- Sealed-order commitment envelope (B2.4). Augments the A3 sealedOrders row. ---
interface SealedCommitment {
  gameId: GameId;
  decisionPointId: string;          // `${turn}:${phase}:${impulse}:${segment}:${kind}` (A4)
  sideId: SideId;
  committedBy: AccountId;
  commitHash: string;               // HMAC-SHA256(gameCommitKey, canon ‖ dpId ‖ sideId)
  cipher: EncryptedBlob;            // AES-256-GCM(canonicalJson(payload)) — opponent plaintext never at rest in clear
  locked: boolean;                  // true once LockOrders or barrier close (B2.4 immutability)
  resubmitCount: number;            // unlock→edit→resubmit churn (timing-probe guard)
  verifyResult: 'pending' | 'verified' | 'mismatch';
  committedAt: number; revealedAt?: number;
}
interface EncryptedBlob { iv: string; tag: string; ct: string; keyId: string; } // base64

// --- Per-game secret material (never leaves the server; not in any event/snapshot) ---
interface GameSecrets {
  gameId: GameId;
  commitKeyEnc: string;             // HMAC key for commitments, wrapped by the master KEK
  dataKeyEnc: string;              // AES data key for sealed plaintext, wrapped by the master KEK
  keyId: string;                    // rotation label referenced by EncryptedBlob.keyId
  createdAt: number; rotatedAt?: number;
}

// --- Fog serialization policy: default-deny field allowlist ---
type SecretClass = 'public' | 'ownSideOnly' | 'tacIntelGated' | 'serverOnly';
interface WireFieldPolicy { path: string; cls: SecretClass; minInfoLevel?: InfoLevel; }
interface RecipientContext {
  accountId: AccountId; gameRole: GameRole; sideId?: SideId;
  controlledShipIds: string[];      // from the resolved GameMembership (A2)
  spectatorReveal?: 'none' | 'public' | 'full'; // GM-granted (A4 emitToSpectators)
}

// --- Anti-cheat / integrity signal (NOT a game event; -> securityEvents) ---
interface AntiCheatSignal {
  kind: 'commitMismatch' | 'lateEdit' | 'fogProbe' | 'unownedTarget'
      | 'commandFlood' | 'nonceReuse' | 'originMismatch' | 'tokenAnomaly' | 'leakPrevented';
  gameId?: GameId; accountId: AccountId; sideId?: SideId;
  severity: 'info' | 'warn' | 'critical';
  detail: Record<string, unknown>;  // never contains opponent plaintext
  at: number;
}
```

**Mongoose sketches** (collections E4 owns; all append-only — no app-level update/delete routes):

```ts
const GameSecretsSchema = new Schema({
  gameId: { type: String, unique: true, required: true },
  commitKeyEnc: String, dataKeyEnc: String, keyId: String, rotatedAt: Date,
}, { timestamps: true, collection: 'gameSecrets' });

const SecurityEventSchema = new Schema({           // integrity + anti-cheat trail
  gameId: { type: String, index: true }, accountId: { type: String, index: true },
  sideId: String, kind: { type: String, index: true },
  severity: { type: String, enum: ['info','warn','critical'], index: true },
  detail: Schema.Types.Mixed, resolvedBy: String, resolvedAt: Date,
}, { timestamps: true, collection: 'securityEvents' });

const AuditLogSchema = new Schema({                // platform/admin actions (A3 references this)
  actorId: { type: String, index: true }, actorRole: String,
  action: { type: String, index: true },           // 'user.disable','entitlement.grant','content.edit','config.change'
  target: Schema.Types.Mixed, before: Schema.Types.Mixed, after: Schema.Types.Mixed,
  ip: String, ua: String,
}, { timestamps: true, collection: 'auditLog' });

const IdentityAuditSchema = new Schema({           // auth lifecycle (A2 references this)
  accountId: { type: String, index: true },
  event: { type: String, index: true },            // 'login','logout','login.fail','token.refresh','lockout','verify.email'
  ip: String, ua: String, success: Boolean, reason: String,
}, { timestamps: true, collection: 'identityAudit' });
```

`gameEvents` itself (A3) is the **in-game** tamper-evident audit; `auditLog`/`identityAudit`/`securityEvents` capture the *out-of-band* trail that is deliberately **not** part of any game's replayable log.

## Events & Commands

E4 is primarily a *consumer and guard*; it participates in the sealed-order lifecycle and emits security records to its own sinks, not to `gameEvents` (with the one in-game exception below).

**Commands consumed** (validated/decorated, then forwarded):
```ts
// From A4 — E4 hooks these to apply commitment + encryption + churn limits
interface SubmitSealedOrders { gameId: GameId; decisionPointId: string; sideId: SideId;
  payload: unknown; clientCommitNonce: string; }
interface LockOrders        { gameId: GameId; decisionPointId: string; sideId: SideId; }
// GM/admin integrity actions
interface ResolveIntegrityFlag { gameId?: GameId; securityEventId: string; disposition: 'dismiss'|'confirm'; note?: string; }
interface QuarantineSession    { gameId?: GameId; accountId: AccountId; reason: string; }
interface ApplyGmOverride      { gameId: GameId; target: OverrideTarget; value: unknown; reason: string; } // canonical — see 00-overview Appendix A
```

**Events emitted.** To `securityEvents` (out-of-band): every `AntiCheatSignal`, plus `SessionQuarantined` and `IntegrityFlagResolved`. To `gameEvents` (the **only** in-game security event, so a replay shows tamper-evidence): `CommitmentMismatchDetected { decisionPointId, sideId, expectedHash, actualHash }`, emitted by the reveal verifier and immediately surfaced as a GM alert. To `auditLog`/`identityAudit`: the platform/auth records above. The canonical `GmOverrideApplied { target, value, reason, appliedBy }` is the recorded escape hatch for every E4 enforcement point (accept a mismatched commitment, grant spectator reveal, lift a quarantine, waive a rate trip).

## Engine / API

Pure where possible; crypto and IO isolated behind named helpers.

```ts
// --- Sealed-order integrity (B2.4) ---
function canonicalJson(value: unknown): string;                         // RFC 8785 JCS: stable keys, normalized numbers
function computeCommitHash(gameId: GameId, dpId: string, sideId: SideId, canon: string): Promise<string>; // HMAC w/ gameCommitKey
function commitSealedOrders(cmd: SubmitSealedOrders, by: AccountId): Promise<SealedCommitment>; // hash + encrypt + persist
function lockCommitment(gameId: GameId, dpId: string, sideId: SideId): Promise<void>;            // sets locked=true
function revealAndVerify(gameId: GameId, dpId: string): Promise<Array<{ sideId: SideId; payload: unknown }>>; // decrypt, re-HMAC, compare

// --- Fog of war: the single outbound serialization boundary ---
function projectEventForRecipient(ev: EventEnvelope, rc: RecipientContext, state: GameState): EventEnvelope | null;
function projectSnapshotForRecipient(snap: GameState, rc: RecipientContext): GameState;          // calls C8 buildTacIntelView/maskUnitState
function assertNoForbiddenFields(wire: unknown, rc: RecipientContext): void;                     // default-deny guard; throws FogLeakError

// --- Authorization (delegates to A2; E4 wraps the call site) ---
async function guardCommand(gameId: GameId, actor: AccessTokenClaims, cmd: GameCommand): Promise<void>; // -> A2.assertCommandAuthz, then integrity signals

// --- Anti-cheat / integrity ---
function evaluateCommandIntegrity(cmd: GameCommand, rc: RecipientContext, state: GameState): AntiCheatSignal[]; // pure
async function recordSecurityEvent(sig: AntiCheatSignal): Promise<void>;
async function quarantineSession(accountId: AccountId, gameId: GameId | undefined, reason: string): Promise<void>;

// --- Platform hardening (Express/Socket.IO middleware, wavemax-aligned) ---
function buildHelmet(): RequestHandler;                                  // CSP for the SPA, HSTS, frameguard, noSniff, referrerPolicy
function buildCsrf(): { protection: RequestHandler; issueToken: (req,res)=>string }; // csrf-csrf double-submit
function sanitizeRequest(): RequestHandler;                             // express-mongo-sanitize + hpp + body size cap
function validatePayload<T>(schema: ZodSchema<T>, body: unknown): T;     // reject unknown keys, coerce/bound numerics
function makeRestLimiter(name: 'auth'|'register'|'api'|'rules', opts?: Partial<LimiterOpts>): RequestHandler; // express-rate-limit + Mongo store
function makeSocketRateLimiter(opts?: BucketOpts): (socket: Socket, event: string) => boolean; // per-connection token bucket

// --- Audit ---
async function recordAudit(entry: Omit<AuditEntry,'_id'|'createdAt'>): Promise<void>;
async function recordIdentityAudit(entry: Omit<IdentityAuditEntry,'_id'|'createdAt'>): Promise<void>;
```

`projectEventForRecipient` and `projectSnapshotForRecipient` are the functions `A4-realtime-sync-layer.md`'s `broadcastFogScoped` calls; they are the *only* sanctioned path from server state to the wire. Both end by calling `assertNoForbiddenFields`, so a serialization that somehow contains a `serverOnly`/over-leveled field is caught before transmission.

## Validation & Enforcement Rules

The server is the authoritative referee for *integrity* as it is for rules:

- **Commit-on-arrival (B2.4).** `commitSealedOrders` HMACs and AES-256-GCM-encrypts the payload before the row is persisted; the cleartext lives only transiently in the authority worker's memory until reveal. Other sides receive only the `OrdersSealed` hash (A4); a property test asserts no message to side X ever contains side Y's plaintext pre-reveal.
- **Immutability after lock (B2.4).** While the window is `open` a side may unlock→edit→resubmit (each bumps `resubmitCount`); on `LockOrders`, or when the barrier reaches `allLocked`, `locked` flips true and any further submit for that `(dpId, sideId)` is rejected with `409 LATE_EDIT` and a `lateEdit` signal.
- **Tamper-evidence at reveal.** `revealAndVerify` decrypts each blob, recomputes the HMAC, and compares to the stored `commitHash`. A mismatch (only possible if at-rest ciphertext or hash was altered out-of-band) aborts the reveal, emits the in-game `CommitmentMismatchDetected` event, and raises a GM-blocking alert — resolution cannot proceed until the GM dismisses or overrides.
- **Fog default-deny.** Serialization starts from *nothing* and adds only fields whose `WireFieldPolicy` permits the recipient: `public` always; `ownSideOnly` when `rc.sideId` owns the unit; `tacIntelGated` when C8's `(observer,target)` level ≥ `minInfoLevel`; `serverOnly` never. A field with no policy entry is dropped, so adding a new state field cannot accidentally leak.
- **Authorization precedes everything.** `guardCommand` calls A2's `assertCommandAuthz` first; an actor may not target, query, or even reference a unit it cannot control or legally see — fog is enforced *after* an authz pass so a forged reference 403s before any hidden read (the ordering A2 mandates).
- **Anti-cheat signals.** `evaluateCommandIntegrity` flags `unownedTarget` (command names a unit outside the seat), `fogProbe` (a query/target implying knowledge the actor's info level forbids), `nonceReuse` (replayed `clientCommitNonce`), `originMismatch` (socket `Origin`/`Host` not on the allowlist), `commandFlood` (token-bucket exhaustion), and `tokenAnomaly` (JWT `alg`/`iss`/`aud` irregularity). `critical` signals can auto-`quarantineSession`.
- **Platform posture (wavemax-aligned).** HS256-pinned JWT verify (`alg:none` rejected); Helmet headers on every response; `csrf-csrf` double-submit on all state-changing REST (Socket.IO uses the Bearer token, not cookies, so the handshake checks `Origin` instead); `express-mongo-sanitize` strips `$`/`.` operator injection; every body is `validatePayload`-checked against a Zod schema that rejects unknown keys and bounds numerics; `makeRestLimiter('auth'|'register'|…)` mirrors wavemax limiter names and the Mongo-backed store.
- **Determinism is a security property.** All randomness comes from the seeded `E1-dice-rng-service.md`; E4 introduces none, so `E2-game-log-replay.md` reconstructs byte-identical state and an auditor can prove no roll was tampered.
- **GM-override points** (each recorded as `GmOverrideApplied`): accept a `CommitmentMismatchDetected` and proceed; reveal a side's sealed order to a spectator; lift a quarantine; waive a rate-limit trip for a slow connection; force-resolve `ResolveIntegrityFlag`.

## UI Contract

E4 is mostly invisible — its correct behavior is the *absence* of leaks — but it surfaces in three places. (1) The **GM/spectator console** (`D9-gm-spectator-console.md`) shows the live `securityEvents` feed, the `CommitmentMismatchDetected` blocking modal with dismiss/override, the quarantine and reveal-grant controls, and the unfiltered (GM-only) state view. (2) The **impulse HUD** (`D6-impulse-hud.md`) shows each side its own lock state and a "sealed — opponent cannot see this" affordance during a window, plus a non-alarming "syncing" state if its outbound stream is rate-limited. (3) Every client is told *nothing it should not know*: the SPA renders only the fog-projected stream from A4 and must treat all role/visibility hints as advisory, never as authority. The login/CSRF token plumbing follows the wavemax pattern (token issued on page load, attached to state-changing calls). No wireframe of its own; E4 manifests through D9 (`wireframes/D9-gm-console.svg`) and D6 (`wireframes/D6-impulse-hud.svg`).

## Dependencies

- `A1-deployment-infrastructure.md` — master KEK / secret storage, TLS, nginx `Origin` allowlist, Redis (rate-limit + quarantine flags), PM2 cluster.
- `A2-identity-roles-gating.md` — `assertCommandAuthz`, token verification, the `identityAudit` events E4 records.
- `A3-data-architecture-event-store.md` — `gameEvents` (the in-game audit), `sealedOrders` row, snapshots; A3 names `auditLog`/`securityEvents` as E4-owned.
- `A4-realtime-sync-layer.md` — the barrier and `broadcastFogScoped`, which call E4's commit/verify and fog-projection functions.
- `B2-rules-engine-core.md` / `C1-sequence-of-play-engine.md` — legality and turn loop; E4 guards, never decides, legality.
- `C8-ew-sensors-cloak.md` — `buildTacIntelView`/`maskUnitState`/`secretHex`: the visibility math E4's fog boundary enforces.
- `E1-dice-rng-service.md` — seeded RNG (determinism). `E2-game-log-replay.md` — auditable replay. `E3-notifications.md` — GM alerting for critical signals. `E5-testing-strategy.md` — leak/property fixtures. `E6-roadmap-phasing.md` — v2/v3 sequencing.
- `B1-rules-content-api.md` — the rate-limited, entitlement-gated rules endpoints share `makeRestLimiter('rules')`.

## Edge Cases & Open Questions

- **DB-admin threat model.** AES-at-rest + HMAC commitment make a raw DB read useless for peeking and tamper-evident for editing — *if* `gameSecrets` keys live outside Mongo (KEK in `A1` secret store). Open: per-tenant KMS vs a single app KEK for v1 (proposed: single KEK, rotate per game) — **[v3]** for KMS.
- **Reconnect re-seal.** On reconnect a player's own sealed plaintext is restored from its encrypted blob (it controls that side), never another side's — the resync projector reuses `projectSnapshotForRecipient`.
- **Spectator reveal vs fairness.** A GM granting `spectatorReveal: 'full'` mid-game is a recorded `GmOverrideApplied`; tournament policy (`T0.0`) should default spectators to `public` only — confirm.
- **Fog-probe false positives.** Distinguishing a legitimate speculative target from a knowledge-leak probe is heuristic; v1 logs and scores, it does not auto-ban (only `critical`, unambiguous signals quarantine).
- **Salt/HMAC vs replay independence.** The commit key is per-game and server-held; a client cannot recompute or brute-force a commitment, but it also cannot self-verify — acceptable, since verification is the server's job. Open: whether to publish a post-game commitment proof so players can audit fairness after the match (**[v2]** transparency feature).
- **Side-channel timing.** Lock latency could in principle hint at opponent activity; A4 batches per-segment and E4 caps `resubmitCount` to blunt timing probes.

## Testing

- **Secrecy invariant (property test).** Across randomized two-side games, assert no socket frame to side X ever contains side Y's sealed plaintext before `OrdersRevealed`, and no `serverOnly`/over-leveled field ever appears in any client frame (`assertNoForbiddenFields` as the oracle).
- **Commitment integrity.** Commit→lock→reveal round-trips; mutate the stored ciphertext and assert `revealAndVerify` raises `CommitmentMismatchDetected` and blocks resolution; assert a re-HMAC with the wrong key fails.
- **Immutability.** A submit after `LockOrders` returns `409 LATE_EDIT` and emits a `lateEdit` signal; unlock→resubmit while open succeeds and bumps `resubmitCount`.
- **Fog flip.** Mask a field at the observer's level, then close range / raise ECCM via C8 and assert the field now serializes — proving the boundary tracks Tac-Intel exactly (mirrors C8's fog test).
- **Authz-before-fog.** A forged command referencing an unseen unit 403s before any hidden read; assert the error path contains no hidden field.
- **Platform posture.** `alg:none` rejected; missing/forged CSRF token rejected; `$`-injection in a body stripped; oversized body rejected; `makeRestLimiter('auth')` throttles after N attempts (parity with wavemax tests).
- **Determinism/audit.** Replay a golden game (Cadet/Sample, via `E5-testing-strategy.md`) and assert the security trail and event stream are reproducible byte-for-byte.

## Phasing

**[v1 AM-tournament]** — HMAC commitment + AES-256-GCM at-rest for sealed orders with reveal-time verification and the in-game `CommitmentMismatchDetected` alert; the default-deny fog serialization boundary wrapping C8 and feeding A4; the A2 authorization chokepoint integration with structural anti-cheat signals (unowned target, late edit, nonce reuse, origin/token anomaly, command flood); Helmet + `csrf-csrf` + `express-mongo-sanitize` + Zod payload validation + REST/socket rate limiting aligned to wavemax; and the `auditLog`/`identityAudit`/`securityEvents`/`gameSecrets` collections. This is the minimum to run a *provably fair* refereed tournament duel: no peeking, no late edits, no leaks, full audit. **[v2]** — behavioral anti-cheat scoring with GM review queues, post-game commitment transparency proofs, spectator-reveal key management, and audit export. **[v3 full Master]** — per-tenant KMS and key rotation tooling, anomaly ML scoring across many-sided games, and signed client attestation — deferred because v1 tournament integrity is fully achievable with server-held keys and structural (impossible-by-construction) guarantees, making heavyweight behavioral defenses premature.
