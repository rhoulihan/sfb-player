# A2 — Identity, Roles & Portal Gating

## Purpose & Scope

This subsystem owns *who a request is* and *what that identity is allowed to do*. It provides account
registration and login, mints and rotates the credentials carried by every REST call and Socket.IO
connection, and gates entry to the SFB Player portal. It then layers three orthogonal authorization
domains on top of identity: (1) **global account roles** (`admin`, plus ordinary `member`); (2)
**per-game roles** (`gm`/host, `commander`, `player`, `spectator`) granted through game memberships and
invitations; and (3) **content entitlements** — the verified-owner gate that unlocks full-text rules
search. It also resolves the finest-grained question in the system: *may this identity issue this command
against this specific ship right now?* Authentication patterns deliberately mirror the sibling
`wavemax-affiliate-program` stack (JWT HS256 with issuer/audience pinning, refresh-token rotation, a
token blacklist for logout, `express-session` + `connect-mongo` for the browser portal, `csrf-csrf`,
`helmet`, and Mongo-backed `express-rate-limit`) so the two apps can share infrastructure and operational
runbooks. **PHASE: [v1 AM-tournament]** for the full account/role/invitation/entitlement model and
per-game ship authorization; OAuth/SSO, organizations, and ratings are **[v2]**/**[v3]**.

## Rulebook References

The rulebook does not legislate software accounts, but it does define the *human roles the role model
mirrors*, and those role boundaries are the contract this subsystem enforces:

- **(A0.0)** — Organization of the rules and the v1 scope boundary (Advanced Missions); the entitlement
  gate keys page/section visibility to ownership tiers derived from this hierarchy.
- **(S0.0)** — Scenario framework: defines **sides**, force assignment, and victory conditions; a
  `commander` controls a side and a `player` controls a subset of that side's ships.
- **(SG0.0)** — Scenario generation; seat/force assignment feeds the lobby (see `D8-lobby-scenario-ui.md`).
- **(T0.0), (T7.0)** — Tournament rules (the v1 target); fixed forces and the duel structure define the
  default two-side, one-commander-per-side seating the invitation flow provisions.
- The **referee** concept in scenario/tournament play maps to the `gm` role: the human empowered to
  adjudicate disputes and apply house rulings, realized here as the `ApplyGmOverride` authorization point.

## Domain Model

Identity entities are **not** event-sourced game state; they live in their own collections and are
referenced by `accountId` from the game event log defined in `A3-data-architecture-event-store.md`.
Per-game role grants, by contrast, *are* game events (see below) so that seating is replayable.

```ts
type AccountRole = 'admin' | 'member';
type GameRole = 'gm' | 'commander' | 'player' | 'spectator';
type EntitlementTier = 'none' | 'basic-set' | 'advanced-missions' | 'master'; // owned rules content

interface Account {
  _id: string;                       // ObjectId hex
  email: string;                     // unique, lowercased
  displayName: string;               // shown at the table
  passwordHash: string;              // PBKDF2/scrypt "hash:salt" (see wavemax encryption util)
  accountRole: AccountRole;          // platform-wide; 'member' for almost everyone
  emailVerified: boolean;
  entitlements: Entitlement[];       // owned content -> rules-API gate
  status: 'active' | 'locked' | 'disabled';
  failedLogins: number;              // lockout counter (mirrors wavemax authController)
  lockUntil?: Date;
  createdAt: Date;
  lastLoginAt?: Date;
}

interface Entitlement {
  tier: EntitlementTier;
  source: 'purchase-code' | 'admin-grant' | 'publisher-roster'; // how ownership was proven
  proofRef?: string;                 // redeemed code id / order ref (never the raw code)
  grantedAt: Date;
  revokedAt?: Date;
}

// JWT access-token claims (short-lived). Per-game roles are NOT baked in — they are resolved
// live from GameMembership so a mid-game seat change takes effect without re-login.
interface AccessTokenClaims {
  sub: string;                       // accountId
  role: AccountRole;
  ent: EntitlementTier[];            // owned tiers, for cheap rules-gate checks
  iss: 'sfb-api'; aud: 'sfb-client';
  iat: number; exp: number;          // 1h default
}

// One row per (game, account) seat. The authoritative per-game authorization record.
interface GameMembership {
  _id: string;
  gameId: string;
  accountId: string;
  gameRole: GameRole;
  sideId?: string;                   // 'A' | 'B' | ... ; required for commander/player
  shipIds: string[];                 // ships this seat may command; commander = all side ships
  invitedBy: string;                 // accountId of granter (gm/host)
  acceptedAt?: Date;                 // null while pending
  revokedAt?: Date;
}

interface Invitation {
  _id: string;
  gameId: string;
  code: string;                      // unambiguous short code (wavemax roleCodes alphabet)
  tokenHash: string;                 // HMAC of the emailed magic-link token; raw never stored
  gameRole: GameRole;
  sideId?: string;
  shipIds?: string[];                // pre-assigned seat, optional
  email?: string;                    // bound invite, or null for open join-link
  expiresAt: Date;
  maxUses: number; uses: number;
  createdBy: string;
}
```

```js
// Mongoose sketches (collections owned by this subsystem)
const accountSchema = new Schema({
  email:       { type: String, required: true, unique: true, lowercase: true, index: true },
  displayName: { type: String, required: true },
  passwordHash:{ type: String, required: true },
  accountRole: { type: String, enum: ['admin','member'], default: 'member', index: true },
  emailVerified:{ type: Boolean, default: false },
  entitlements:[{ tier: String, source: String, proofRef: String, grantedAt: Date, revokedAt: Date }],
  status:      { type: String, enum: ['active','locked','disabled'], default: 'active' },
  failedLogins:{ type: Number, default: 0 }, lockUntil: Date, lastLoginAt: Date
}, { timestamps: true });

const gameMembershipSchema = new Schema({
  gameId:   { type: Schema.Types.ObjectId, ref: 'Game', required: true, index: true },
  accountId:{ type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
  gameRole: { type: String, enum: ['gm','commander','player','spectator'], required: true },
  sideId:   String, shipIds: [String],
  invitedBy:{ type: Schema.Types.ObjectId, ref: 'Account' }, acceptedAt: Date, revokedAt: Date
}, { timestamps: true });
gameMembershipSchema.index({ gameId: 1, accountId: 1 }, { unique: true });

const invitationSchema = new Schema({
  gameId: { type: Schema.Types.ObjectId, ref: 'Game', index: true },
  code:   { type: String, index: true }, tokenHash: { type: String, index: true },
  gameRole: String, sideId: String, shipIds: [String], email: String,
  expiresAt: { type: Date, index: { expireAfterSeconds: 0 } }, // TTL auto-expiry
  maxUses: { type: Number, default: 1 }, uses: { type: Number, default: 0 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'Account' }
}, { timestamps: true });
```

`RefreshToken` and `TokenBlacklist` collections are reused verbatim from the wavemax pattern (rotating
opaque refresh tokens with a `replacedByToken` pointer; blacklist on logout/disable).

## Events & Commands

Account lifecycle (register, login, verify, entitlement grant) is **not** part of any game's event log;
it is recorded to a separate `identityAudit` collection (see `E4-security-integrity.md`). Per-game seat
changes **are** game events appended to `gameEvents`, so a replay reconstructs exactly who controlled
what. Commands are validated by this subsystem before the event is emitted.

```ts
// Commands (PascalCase imperative)
interface SendInvitation   { gameId: string; gameRole: GameRole; sideId?: string;
                             shipIds?: string[]; email?: string; expiresInHours?: number; }
interface AcceptInvitation { token: string; }                       // actor = authenticated account
interface AssignSeat       { gameId: string; accountId: string; gameRole: GameRole;
                             sideId?: string; shipIds?: string[]; }  // host re-seats / reassigns ships
interface RevokeSeat       { gameId: string; accountId: string; reason?: string; }
interface GrantEntitlement { accountId: string; tier: EntitlementTier; source: string; proofRef?: string; }
interface RedeemOwnerCode  { code: string; }                        // self-service ownership proof

// Events (past-tense, appended to gameEvents unless noted)
interface InvitationSent     { invitationId: string; gameId: string; gameRole: GameRole; by: string; }
interface InvitationAccepted { gameId: string; accountId: string; membershipId: string; gameRole: GameRole; }
interface SeatAssigned       { gameId: string; accountId: string; gameRole: GameRole;
                               sideId?: string; shipIds: string[]; by: string; }
interface SeatRevoked        { gameId: string; accountId: string; by: string; reason?: string; }
interface EntitlementGranted { accountId: string; tier: EntitlementTier; source: string; } // identityAudit
```

A `gm` re-seating or revoking always passes through `AssignSeat`/`RevokeSeat`; an exceptional override of
any *validation* (e.g. forcing a seat the rules engine would reject) is recorded as the canonical
`GmOverrideApplied` event from the contract, carrying `{ target, value, reason }`.

## Engine / API

Pure resolvers where possible; side-effecting issuers isolated.

```ts
// Authentication (mirrors wavemax authTokenService + middleware/auth.js)
function issueTokens(account: Account, ip: string): { accessToken: string; refreshToken: string };
function verifyAccessToken(token: string): AccessTokenClaims;        // jwt.verify, algorithms:['HS256']
async function authenticate(req): Promise<void>;                     // Bearer/x-auth-token -> req.user; blacklist check
async function rotateRefresh(refreshToken: string, ip: string): Promise<TokenPair>;
async function logout(accessToken: string): Promise<void>;          // -> TokenBlacklist

// Authorization resolvers (pure; no I/O when given the loaded membership)
function canControlShip(m: GameMembership | null, shipId: string): boolean;
function canSubmitOrdersFor(m: GameMembership | null, sideId: string): boolean;
function isGm(m: GameMembership | null): boolean;
function hasEntitlement(claims: AccessTokenClaims, need: EntitlementTier): boolean;
function gateRulesAccess(claims: AccessTokenClaims, ruleNumber: string): 'full' | 'metadata-only';

// The single chokepoint every game command passes through
async function assertCommandAuthz(
  gameId: string, actor: AccessTokenClaims, command: GameCommand
): Promise<void>;   // throws AuthzError(403, code) on failure; consulted by C1 engine + A4 socket layer

// Invitations
async function createInvitation(actor: AccessTokenClaims, cmd: SendInvitation): Promise<Invitation>;
async function acceptInvitation(actor: AccessTokenClaims, token: string): Promise<GameMembership>;
async function redeemOwnerCode(actor: AccessTokenClaims, code: string): Promise<Entitlement>;
```

REST surface (all under the gated portal, `helmet` + CSRF + `authLimiter`): `POST /auth/register`,
`POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/verify-email`,
`POST /games/:id/invitations`, `POST /invitations/:token/accept`, `POST /account/owner-code`,
`GET /account/me`. The Socket.IO handshake (`A4-realtime-sync-layer.md`) authenticates via the same
`verifyAccessToken`, then attaches the resolved `GameMembership` to the socket so every inbound game
command is checked by `assertCommandAuthz`.

## Validation & Enforcement Rules

The server is the authoritative referee for identity exactly as it is for rules:

- **Authentication:** JWT algorithm pinned to HS256; issuer `sfb-api` / audience `sfb-client` verified;
  blacklisted or expired tokens rejected with 401. Login lockout after N failed attempts (`lockUntil`),
  `authLimiter` and `registrationLimiter` rate-limit the endpoints.
- **Portal gate:** unauthenticated requests to any `/app/*` route redirect to login; the SPA bundle is
  public but every data call requires a valid token.
- **Per-game command authz** (`assertCommandAuthz`): the actor must hold a non-revoked, accepted
  `GameMembership` in `gameId`; `gm` may issue any command; a `commander` may act for its whole `sideId`;
  a `player` only for `shipIds` in its seat; a `spectator` may issue **no** mutating command. Crucially,
  authorization is checked **before** fog-of-war: a player may not even *target* or *query* a ship it does
  not control or cannot legally see, so hidden state never leaks through an authz bypass.
- **Verified-owner rules gate:** `gateRulesAccess` returns `full` only when the actor's entitlement tier
  covers the requested rule's section; otherwise `metadata-only` (rule number + title, never prose). This
  is the access-control half of `B1-rules-content-api.md`.
- **Invitations:** token compared by HMAC against `tokenHash` (raw token never stored); expiry via TTL
  index; `uses < maxUses`; a bound (`email`) invite must match the accepting account's verified email.
- **Self-grant prevention:** `GrantEntitlement` and `AssignSeat`-to-`gm` require `admin` or the game's
  existing `gm`; an account can never elevate its own role.
- **GM-override points:** seating a player the scenario validator rejects, granting spectator fog reveal,
  or restoring a revoked seat are all recordable via `GmOverrideApplied` `{target, value, reason}`.

## UI Contract

The client needs: a login/register/verify-email flow; a portal landing that lists the account's games and
pending invitations; an **accept-invitation** screen reached by magic link or short code; an account
settings page exposing entitlement status and an owner-code redemption field that toggles the rules
browser from metadata-only to full text (`D7-rules-browser-ui.md`). Seat assignment UI (commander/player/
ship pickers, invite-link generation, the "waiting for 1 player" status row) lives in the lobby —
`D8-lobby-scenario-ui.md`, wireframe `wireframes/D8-lobby-scenario.svg`. GM re-seating, fog reveal, and
override controls live in `D9-gm-spectator-console.md`, wireframe `wireframes/D9-gm-console.svg`. The
client must treat all role/entitlement state as advisory for rendering only; the server re-checks every
action. The SPA reads `GET /account/me` for `displayName`, `accountRole`, and owned tiers to drive nav
visibility.

## Dependencies

- `A1-deployment-infrastructure.md` — the gated portal host (chrsent.com), TLS, secrets for `JWT_SECRET`.
- `A3-data-architecture-event-store.md` — `gameEvents`/`gameSnapshots`; seat events fold into game state.
- `A4-realtime-sync-layer.md` — socket handshake auth and per-connection membership attachment.
- `B1-rules-content-api.md` — consumes `gateRulesAccess`/entitlements for the rules full-text gate.
- `D8-lobby-scenario-ui.md`, `D9-gm-spectator-console.md` — seat assignment and GM authorization UIs.
- `E3-notifications.md` — invitation emails / push (Firebase, as in wavemax).
- `E4-security-integrity.md` — `identityAudit`, token blacklist, CSRF/helmet posture.
- `E6-roadmap-phasing.md` — sequencing of v2/v3 identity features.

## Edge Cases & Open Questions

- **Account deletion mid-game:** a disabled account's seat is revoked but its historical events remain
  (immutable log); replays render the original `displayName` from an event-time snapshot.
- **Re-seating after a turn starts:** does an in-flight sealed order from a revoked player stand or void?
  Proposed: void unrevealed sealed orders on `SeatRevoked` and notify the `gm`.
- **Open join-links vs tournament integrity:** open-link spectators are fine, but tournament games should
  default `maxUses: 1` bound invites — confirm with `T0.0` tournament policy.
- **Entitlement proof source of truth:** purchase-code redemption vs a publisher roster import; the
  authoritative ownership ledger format is an open question for `B1`.
- **Multiple seats per account in one game** (e.g. one human running both sides for testing): allowed for
  `admin`/`gm` only; the unique `(gameId, accountId)` index would need relaxation or a per-side proxy
  account — deferred.

## Testing

- Unit-test pure resolvers (`canControlShip`, `canSubmitOrdersFor`, `gateRulesAccess`) against a truth
  table covering every role × ship-ownership combination.
- Integration-test `assertCommandAuthz` by replaying a recorded tournament game and asserting that a
  `player` command against an unowned ship throws `AuthzError(403)` while the `gm`'s same command succeeds.
- Verify the fog/authz ordering: a forged command referencing a ship the actor cannot see must 403 *before*
  any state read, asserting no hidden field appears in the error path.
- Token tests mirror wavemax: HS256-pinned verify, rejected `alg:none`, blacklist-on-logout, refresh
  rotation invalidating a replayed refresh token.
- Invitation tests: TTL expiry, `maxUses` exhaustion, email-bound mismatch, HMAC token tamper rejection.

## Phasing

- **[v1 AM-tournament]:** full account model, password auth with lockout, JWT + refresh + blacklist, the
  five-role model and permissions matrix, per-game `GameMembership` with ship-level authorization, magic-
  link + short-code invitations, the verified-owner entitlement gate feeding `B1`, and the
  `assertCommandAuthz` chokepoint consumed by `C1`/`A4`. This is the minimum to run a refereed two-side
  tournament duel with a host, commanders, and gated rules access.
- **[v2]:** OAuth/SSO providers, organizations/teams and roster import for league play, granular per-ship
  reassignment UI, reputation/rating, and spectator fog-reveal presets.
- **[v3]:** federation across CRHS Enterprises properties (shared identity with wavemax-class apps),
  fine-grained content entitlements per expansion module, and delegated GM co-hosting.

### Permissions Matrix (per-game, after authentication)

| Capability | admin | gm/host | commander | player | spectator |
|---|---|---|---|---|---|
| View public game state | ✓ | ✓ | ✓ | ✓ | ✓ (fog-gated) |
| View own side's hidden state | ✓ | ✓ (all) | ✓ (own side) | ✓ (own ships) | per GM reveal |
| Plot movement / allocate energy / fire | ✓* | ✓* | own side ships | own ships only | — |
| Submit sealed orders for a side | ✓* | ✓* | ✓ (own side) | ✓ (own ships) | — |
| Invite / assign seats / reassign ships | ✓ | ✓ | — | — | — |
| Apply `GmOverrideApplied` | ✓ | ✓ | — | — | — |
| Full-text rules access | tier-gated | tier-gated | tier-gated | tier-gated | tier-gated |
| Platform admin (users, content) | ✓ | — | — | — | — |

`*` admin/gm act on behalf of a side only via an explicit, audited proxy action, not by default.
