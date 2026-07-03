# E3 — Notifications

## Purpose & Scope

This subsystem summons **absent** players back to the table and keeps every member aware of game-state changes that happen while they are away, without ever leaking hidden information or perturbing determinism. It owns three delivery channels — **Firebase Cloud Messaging push**, **nodemailer email**, and a persisted **in-app feed** — reusing the exact Firebase project and SMTP transport already wired into the sibling `wavemax-affiliate-program`. Its central job is **turn-ready** alerting for the asynchronous / pause-resume play path (`A4-realtime-sync-layer.md`): when the engine opens a sealed-submission window and a required side has no live, attentive controller, E3 tells that controller it is their move. It is strictly a **read-side subscriber**: it consumes the already-fog-redacted public event fan-out, maps events to per-recipient notification intents, gates them on live presence and per-user preferences, then dispatches. It writes **nothing** to `gameEvents` and feeds **nothing** back into the rules engine, so attaching or detaching E3 cannot change a game's outcome or its replay (`E2-game-log-replay.md`). Player-tactical content is never decided here; E3 only routes facts the recipient is already entitled to see.

**PHASE:** Turn-ready + game-lifecycle notifications across all three channels, presence gating, per-user preferences (channel toggles, per-game mute, quiet hours), push-token registration, and cluster-safe single-send are **[v1 AM-tournament]**. Email digests, async hard-deadline reminders, and chat mentions are **[v2]**. Locale/i18n templates, spectator-follow alerts, and large fan-out batching are **[v3 full Master]**.

## Rulebook References

E3 implements no game rule directly (like `A1-deployment-infrastructure.md`); it is bound by contract to the rule structures that define *when a player owes a decision*:

- **(B2.1)** Turn / 32-impulse structure — every turn-ready alert is keyed to a decision point on this clock.
- **(B2.3 step 1)** Energy Allocation — the canonical per-turn sealed window; an absent side here is the prototypical turn-ready trigger.
- **(B2.3 6D)** Direct-Fire Weapons window — the per-impulse sealed decision point for async play.
- **(B2.4)** Secret & simultaneous announcements / written-orders analog — notifications must summon an absent player **without** revealing any opponent's sealed intent; this rule is the secrecy boundary E3 respects.
- **(S0.0)** / **(T0.0)** Scenario & Tournament framework — defines sides, seating, and victory, which scope *who* is notified at game start/end.

Exact rule numbers for each decision point are owned by `C1-sequence-of-play-engine.md` and the `C*` mechanics docs; E3 only reacts to the decision points they open.

## Domain Model

None of these collections are game state — they live in the `sfb` DB beside identity, **not** in the event log.

```ts
type Channel = 'push' | 'email' | 'inApp';

type NotificationType =
  | 'turn-ready'          // a sealed window needs your side and you are absent (B2.3)
  | 'game-started'        // scenario launched (S0.0)
  | 'game-paused' | 'game-resumed'
  | 'game-over'           // victory/forfeit decided (S0.0/T0.0)
  | 'gm-ruling'           // a GmOverrideApplied touched your side
  | 'opponent-status'     // opponent resigned / long-disconnected
  | 'deadline-reminder'   // async hard deadline approaching [v2]
  | 'invitation'          // seat invite (content owned by A2)
  | 'mention';            // chat @mention [v2]

interface NotificationPreferences {
  accountId: string;
  channels: Record<Channel, boolean>;                 // master on/off per channel
  byType: Partial<Record<NotificationType, Partial<Record<Channel, boolean>>>>; // per-type overrides
  quietHours?: { tz: string; startMin: number; endMin: number }; // suppress/defer push in-window
  emailDigest: 'immediate' | 'hourly' | 'daily';      // batching for email [hourly/daily = v2]
  perGameMute: Record<string, { muted: boolean; mutedUntil?: Date }>; // gameId -> mute
}

interface PushToken {
  accountId: string;
  token: string;                                       // FCM registration token
  platform: 'web' | 'ios' | 'android';
  userAgent?: string;
  lastSeenAt: Date;
  disabled: boolean;                                   // set true when FCM reports unregistered
}

interface DeliveryState {
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'suppressed';
  attempts: number; lastError?: string; at: Date;
  suppressReason?: 'present' | 'muted' | 'quiet-hours' | 'pref-off' | 'unverified-email';
}

interface Notification {           // the in-app feed row + delivery audit + dedupe anchor
  _id: string;
  accountId: string;               // recipient
  gameId?: string;
  type: NotificationType;
  priority: 'low' | 'normal' | 'high';
  title: string; body: string;     // fog-safe text only (see Enforcement)
  data: Record<string, string>;    // deep-link: { gameId, decisionPointId?, route }
  dedupeKey: string;               // stable per (recipient, intent) — unique index
  channels: Partial<Record<Channel, DeliveryState>>;
  readAt?: Date; createdAt: Date;
}
```

```js
// Mongoose sketches (DB 'sfb'; NOT gameEvents)
const notificationPreferencesSchema = new Schema({
  accountId: { type: Schema.Types.ObjectId, ref: 'Account', unique: true, index: true },
  channels:  { push: { type: Boolean, default: true }, email: { type: Boolean, default: true },
               inApp: { type: Boolean, default: true } },
  byType:    { type: Schema.Types.Mixed, default: {} },
  quietHours:{ tz: String, startMin: Number, endMin: Number },
  emailDigest:{ type: String, enum: ['immediate','hourly','daily'], default: 'immediate' },
  perGameMute:{ type: Map, of: new Schema({ muted: Boolean, mutedUntil: Date }, { _id: false }) }
}, { timestamps: true });

const pushTokenSchema = new Schema({
  accountId: { type: Schema.Types.ObjectId, ref: 'Account', index: true },
  token:     { type: String, required: true },
  platform:  { type: String, enum: ['web','ios','android'], required: true },
  userAgent: String, lastSeenAt: Date, disabled: { type: Boolean, default: false }
}, { timestamps: true });
pushTokenSchema.index({ accountId: 1, token: 1 }, { unique: true });

const notificationSchema = new Schema({
  accountId: { type: Schema.Types.ObjectId, ref: 'Account', index: true, required: true },
  gameId:    { type: Schema.Types.ObjectId, ref: 'Game', index: true },
  type:      { type: String, required: true },
  priority:  { type: String, enum: ['low','normal','high'], default: 'normal' },
  title: String, body: String, data: { type: Map, of: String },
  dedupeKey: { type: String, required: true },
  channels:  { type: Schema.Types.Mixed, default: {} },
  readAt:    Date
}, { timestamps: true });
notificationSchema.index({ dedupeKey: 1 }, { unique: true });          // cluster-safe single send
notificationSchema.index({ accountId: 1, readAt: 1, createdAt: -1 });  // feed + unread badge
```

## Events & Commands

E3 **consumes** the redacted public domain events that `A1-deployment-infrastructure.md` publishes to `sfb:game:{gameId}:events` (the same fog-stripped envelope `A4-realtime-sync-layer.md` fans out) plus A4 lifecycle signals. It **emits no game events**. Its own commands and records are out-of-band and never enter the deterministic log.

**Game events that trigger notifications** (mapping table; trigger → type → recipients):

| Source event (owner) | Type | Recipients | Default channels (when absent) |
|---|---|---|---|
| `submissionWindowOpened` w/ absent required side (A4) | `turn-ready` | controllers of that side | push + email + inApp |
| `TurnStarted` / scenario launch (C1) | `game-started` | all members | push + inApp |
| `GamePaused` / `GameResumed` (C1) | `game-paused`/`game-resumed` | absent members | push + inApp |
| `GameEnded` / victory (S0.0) | `game-over` | all members | push + email + inApp |
| `GmOverrideApplied` touching a side (A4/C1) | `gm-ruling` | affected side | push + inApp |
| `SeatRevoked` / opponent disconnect grace (A2/A4) | `opponent-status` | other members | push + inApp |
| `InvitationSent` (A2) | `invitation` | invitee | email (A2 owns body) |

**Commands consumed** (client → server; PascalCase):

```ts
interface UpdateNotificationPreferences { patch: Partial<NotificationPreferences>; }
interface RegisterPushToken   { token: string; platform: 'web'|'ios'|'android'; userAgent?: string; }
interface RevokePushToken     { token: string; }
interface MarkNotificationRead{ notificationId: string; }            // or { all: true }
interface MuteGameNotifications { gameId: string; mutedUntil?: string; }
interface SendAdminBroadcast  { audience: 'all'|'game'; gameId?: string; title: string; body: string; } // admin only
```

**Out-of-band records written** (to `notifications`, never `gameEvents`): `NotificationDispatched`, `NotificationDelivered`, `NotificationFailed`, `NotificationSuppressed`, `NotificationRead`. These are audit/feed rows, explicitly excluded from replay.

## Engine / API

Pure mapping/decision functions are isolated from the side-effecting senders so they unit-test without providers.

```ts
// Subscriber entry — invoked by the A1 pub/sub consumer on every redacted envelope.
async function onDomainEvent(env: PublicEventEnvelope): Promise<void>;

// PURE: event -> zero or more notification intents.
function deriveIntents(env: PublicEventEnvelope): NotificationIntent[];
function resolveRecipients(intent: NotificationIntent, game: GameSummary): string[]; // accountIds

// PURE: per-recipient channel decision given prefs + presence + clock.
function decideChannels(
  intent: NotificationIntent, prefs: NotificationPreferences,
  presence: PresenceFacts, now: Date
): { channel: Channel; send: boolean; suppressReason?: string }[];

function dedupeKey(intent: NotificationIntent, accountId: string): string; // stable, idempotent

// Dispatch pipeline (side-effecting).
async function dispatch(intent: NotificationIntent): Promise<void>;        // resolve→decide→enqueue
async function claimAndSend(notificationId: string, channel: Channel): Promise<DeliveryState>;
async function sendPush(accountId: string, p: PushPayload): Promise<DeliveryState>;   // FCM multicast
async function sendEmail(accountId: string, p: EmailPayload): Promise<DeliveryState>; // nodemailer
async function writeInApp(accountId: string, n: Notification): Promise<void>;         // feed + socket badge

// Presence — delegated to A4, never recomputed here.
async function presenceFor(gameId: string, accountIds: string[]): Promise<Map<string, PresenceFacts>>;

// Preferences / tokens / feed (REST handlers).
async function updatePreferences(actor: AccessTokenClaims, cmd: UpdateNotificationPreferences): Promise<NotificationPreferences>;
async function registerPushToken(actor: AccessTokenClaims, cmd: RegisterPushToken): Promise<void>;
async function markRead(actor: AccessTokenClaims, cmd: MarkNotificationRead): Promise<void>;
async function listFeed(actor: AccessTokenClaims, page: { before?: string; limit: number }): Promise<Notification[]>;
```

`PresenceFacts = { online: boolean; status: 'online'|'idle'|'away'; inThisGame: boolean }`. REST surface (gated portal, helmet + CSRF + rate-limit): `GET/PUT /account/notification-preferences`, `POST /account/push-tokens`, `DELETE /account/push-tokens/:token`, `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `POST /admin/broadcast`. A `notification {…}` socket signal (via A4) refreshes the in-app badge for present clients.

## Validation & Enforcement Rules

- **Determinism firewall (the cardinal rule).** E3 never appends to `gameEvents` and never calls a rules resolver. A replay (`E2-game-log-replay.md`) runs identically with the dispatcher absent — enforced by a test asserting zero `gameEvents` writes originate in this module.
- **Presence gating ("only notify absent players").** Push and email are sent **only** when `presenceFor` reports the recipient is *not* online-and-attentive in that game (offline, or `away`/`idle`, or present in a *different* game). An actively-present player gets only the in-app badge; A4's real-time stream already informed them. Recipients present-and-active are recorded with `suppressReason: 'present'`.
- **Reconnect grace window.** A turn-ready push/email is enqueued with a short delay (default 45s, configurable). If the recipient becomes present within the window, the job is cancelled and marked `suppressed/present`, preventing a buzz the instant they were already opening the game.
- **Fog-of-war (B2.4).** E3 consumes only the **already-redacted** public envelope (fog-stripped by A1/`C8-ew-sensors-cloak.md`/`E4-security-integrity.md`). Notification bodies state only public facts or the recipient's own events — never an opponent's pre-reveal sealed payload. A negative test asserts no notification body or `data` field contains another side's hidden order, mirroring the A4 secrecy invariant.
- **Preferences & compliance.** A channel sends only if both the master toggle and any per-type override allow it, the game is not muted, and (for email) the account's `emailVerified` is true (`A2-identity-roles-gating.md`). Every email carries an unsubscribe / preferences deep-link; quiet hours defer push (re-evaluated after the window) rather than dropping it.
- **Cluster-safe single send.** Under the PM2 cluster any worker may consume the bus event, so each (recipient, intent) is claimed by an atomic upsert on the unique `dedupeKey` (Mongo) backed by a Redis `SET NX` lease before any provider call; duplicates collapse to one send.
- **Authorization.** A user reads/edits only their own preferences, tokens, and feed; `SendAdminBroadcast` requires `accountRole === 'admin'`. Stale FCM tokens (provider reports `registration-token-not-registered`) are auto-`disabled`/pruned.
- **GM-override surface.** E3 owns no gameplay ruling, so it emits no `GmOverrideApplied`. A GM may, however, trigger a manual resend (e.g. re-ping a stalled async side) via an admin/GM action, recorded in the notification audit (not the game log).

## UI Contract

The client needs four things. (1) A **notification center** — a bell icon with an unread badge fed by `GET /notifications` and live `notification` socket signals; each row deep-links via `data.route` (e.g. straight into the armed Energy panel `D3-energy-allocation-ui.md` or the targeting panel `D5-targeting-combat-ui.md` at `decisionPointId`). (2) A **preferences panel** in account settings (the settings page introduced in `A2-identity-roles-gating.md`): per-channel master toggles, a per-type matrix, quiet-hours picker with timezone, and email-digest cadence. (3) A **push-permission prompt** that, on grant, calls `RegisterPushToken` with the FCM web token (the same service-worker registration wavemax already ships). (4) A **per-game mute** control surfaced on the game tile in the lobby (`D8-lobby-scenario-ui.md`) and the in-game menu. The notification center is a small overlay component reused across the `D*` HUD; an optional wireframe lives at `wireframes/D8-lobby-scenario.svg` (not required for an E-series doc). All preference state is advisory for rendering; the server re-checks every send.

## Dependencies

- `A1-deployment-infrastructure.md` — Firebase config, SMTP/nodemailer transport, Redis (job lease + grace timers), and the `sfb:game:{gameId}:events` bus E3 subscribes to.
- `A2-identity-roles-gating.md` — `Account` (email, `emailVerified`, `displayName`), authz for preferences/feed, and invitation-email content (E3 supplies transport).
- `A3-data-architecture-event-store.md` — source of truth E3 only **reads** (via the redacted bus); E3 must never write `gameEvents`.
- `A4-realtime-sync-layer.md` — presence (`absentParticipants`, presence Redis), `submissionWindowOpened` lifecycle, and the `notification` socket signal channel.
- `C1-sequence-of-play-engine.md` — decision points / `TurnStarted` / `GamePaused`/`GameResumed`/`TurnCompleted` that drive triggers.
- `C8-ew-sensors-cloak.md` / `E4-security-integrity.md` — the fog visibility guarantee on the envelope, plus PII/unsubscribe/audit compliance.
- `E2-game-log-replay.md` — the determinism contract E3 must not violate. `E5-testing-strategy.md` — golden games used to prove it. `E6-roadmap-phasing.md` — v2/v3 sequencing.

## Edge Cases & Open Questions

- **One human, both sides (testing/solo).** Suppress turn-ready to a controller who also seats the opposing side for the same window — do not buzz a user about a decision they themselves are filling.
- **Multi-device fan-out.** Send push to every non-disabled token but write **one** `Notification` row per recipient; read-state syncs across devices via the feed.
- **Present-elsewhere.** Online in game X but absent from game Y still counts as absent *for Y*; `inThisGame` is the deciding flag.
- **Async hard-deadline reminders** depend on A4's `[v2]` deadline policy (forfeit-to-no-op vs auto-repeat); reminder cadence is an open product decision deferred with it.
- **Digest semantics.** Hourly/daily email digests must coalesce many turn-ready events into one message and drop entries already acted upon at send time — `[v2]`.
- **Quiet-hours vs. urgent.** Should `game-over`/`gm-ruling` override quiet hours? Proposed: `high` priority bypasses quiet hours for push; confirm with product.
- **Open:** SMS/WhatsApp as a `[v3]` channel; whether spectators may opt into follow-notifications (fog-limited) `[v3]`.

## Testing

- **Determinism (cardinal):** replay a golden game (`E5-testing-strategy.md`) with the dispatcher attached and detached; assert byte-identical final snapshots and **zero** `gameEvents` writes from E3.
- **Mapping unit tests:** `deriveIntents` over a fixture of every source event → expected `(type, recipients)`; `decideChannels` truth table across channel toggles, per-type overrides, mute, quiet hours, and `emailVerified`.
- **Presence gating:** simulate present-active, idle, and offline recipients; assert present-active yields only in-app (`suppressReason: 'present'`) while offline yields push+email.
- **Grace window:** enqueue turn-ready, mark recipient present within 45s; assert the push is cancelled and recorded `suppressed`.
- **Fog negative test:** feed an envelope containing an opponent's revealed and pre-reveal data; assert no notification body/`data` ever carries pre-reveal sealed content (mirrors A4).
- **Cluster dedupe:** dispatch the same intent on two workers concurrently; assert exactly one provider call via the `dedupeKey` lease.
- **Provider behavior (mocks):** FCM `registration-token-not-registered` prunes the token; nodemailer failure retries with backoff then marks `failed`; verify the unsubscribe link round-trips to a preference change.

## Phasing

**[v1 AM-tournament]** Turn-ready alerting tied to A4 submission windows for absent required sides; game lifecycle notifications (started, paused, resumed, over, gm-ruling, opponent-status); all three channels (FCM push, nodemailer email with unsubscribe, persisted in-app feed); presence gating with the reconnect grace window; per-user preferences (channel master toggles, per-game mute, quiet hours, immediate email); push-token registration reusing the wavemax Firebase service worker; cluster-safe single-send via `dedupeKey` + Redis lease; the determinism firewall. This is exactly what pause-resume and basic async tournament play require. **[v2]** Email digests (hourly/daily coalescing), async hard-deadline reminders (gated on A4 deadlines), chat `@mention` notifications, a full per-type × per-channel preference matrix, and priority-based quiet-hours bypass. **[v3 full Master]** Locale/i18n templates, spectator-follow opt-in (fog-limited), SMS/extra channels, and batched fan-out for many-sided large-fleet games where a single window may summon many absent controllers at once.
