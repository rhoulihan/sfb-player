# A1 — Deployment & Infrastructure

## Purpose & Scope

This document specifies how **SFB Player** is built, packaged, deployed, and operated on Oracle Cloud Infrastructure (OCI), reusing — not reinventing — the infrastructure that already runs the sibling `wavemax-affiliate-program` application. It covers the Docker image, the PM2 cluster (`ecosystem.config.js`), the nginx reverse proxy + TLS termination, the gated entry from the `crhsent.com` (CRHS Enterprises) portal, the MongoDB and Redis tiers, environment/secrets management, logging/metrics, backups and disaster recovery, and CI/CD. It is the foundation every other subsystem stands on: the engine docs (`C*`) assume the deterministic, single-writer execution substrate defined here, and the real-time and persistence docs (`A4-realtime-sync-layer.md`, `A3-data-architecture-event-store.md`) assume the Redis and MongoDB topology defined here.

**PHASE:** Core single-node + PM2 cluster + Redis + Mongo is **[v1 AM-tournament]**. Multi-node horizontal scale-out, blue/green releases, and cross-region DR replication are **[v2]**/**[v3 full Master]**.

## Rulebook References

This subsystem implements **no game rule directly** — it is rules-agnostic plumbing. It exists to *guarantee* the determinism and simultaneity that the rules require, so it is bound to these rule areas by contract:

- Sequence of Play / Impulse Procedure (the 32-impulse turn structure) — every worker must fold the event log to byte-identical state, so impulse resolution (handled in `C1-sequence-of-play-engine.md`) is reproducible after a crash or failover.
- Energy Allocation (the simultaneous, sealed allocation step) — Redis backs the sealed-order store described in `E4-security-integrity.md`; this doc provisions it.
- Seeking-weapon and die-roll resolution — all randomness flows through the seeded Dice/RNG service (`E1-dice-rng-service.md`); this doc guarantees that service is the *only* entropy source in the deployed image.
- Tournament framework (the AM-tournament rule set targeted by v1) — drives the capacity sizing in §Phasing.

Exact rule numbers for each are owned by the cited engine docs; A1 only promises the environment in which they are evaluated identically every time.

## Domain Model

Infrastructure is configuration and operational record-keeping, not gameplay. The persisted entities are an ops-audit log and a backup ledger; the rest are in-memory typed config.

```ts
// Typed, validated process environment (loaded once at boot, frozen).
export interface InfraConfig {
  nodeEnv: 'development' | 'staging' | 'production';
  port: number;                         // 3001 for SFB (wavemax owns 3000)
  appName: 'sfb-online';
  baseUrl: string;                      // https://play.chrsent.com
  mongoUri: string;                     // Oracle ADB Mongo-API connection string
  redisUrl: string;                     // rediss://… (TLS) on OCI
  redisKeyPrefix: string;               // 'sfb:' — namespaced beside wavemax
  sessionSecret: string;                // secret
  jwtSecret: string;                    // secret
  csrfSecret: string;                   // secret (falls back to session/jwt)
  encryptionKey: string;                // 32-byte hex, AES-256-GCM at rest
  firebase: FirebaseConfig;             // push (shared project w/ wavemax)
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  logDir: string;                       // '/var/www/sfb/logs'
  trustProxyHops: number;               // 1 (behind nginx)
  rngMasterSeedSalt: string;            // secret; combined w/ per-game seed
}

export interface RedisChannelTopology {
  pubsubPattern: string;                // 'sfb:game:{gameId}:events'
  presenceKey: (gameId: string) => string;       // 'sfb:presence:{gameId}'
  sealedOrderKey: (gameId: string, impulse: number, side: string) => string;
  lockKey: (gameId: string) => string;            // single-writer turn lock
}
```

```ts
// Mongoose sketch — operational collections (DB: 'sfb', distinct from 'wavemax')
import { Schema, model } from 'mongoose';

const DeploymentRecordSchema = new Schema({
  releaseId:   { type: String, required: true, index: true }, // git short-sha
  gitSha:      { type: String, required: true },
  imageDigest: { type: String, required: true },              // sha256:…
  deployedAt:  { type: Date, default: Date.now, index: true },
  deployedBy:  { type: String, required: true },              // admin id / 'ci'
  pm2Instances:{ type: Number, required: true },
  healthy:     { type: Boolean, default: false },
  rollbackOf:  { type: String, default: null },               // prior releaseId
}, { collection: 'deployments' });

const BackupRecordSchema = new Schema({
  kind:       { type: String, enum: ['mongo-dump', 'redis-rdb', 'snapshot'], required: true },
  scope:      { type: String, enum: ['full', 'game'], required: true },
  gameId:     { type: String, default: null },
  objectUri:  { type: String, required: true },   // OCI Object Storage URI
  sizeBytes:  { type: Number, required: true },
  sha256:     { type: String, required: true },
  startedAt:  { type: Date, required: true },
  finishedAt: { type: Date, required: true },
  retention:  { type: String, enum: ['daily', 'weekly', 'monthly'], required: true },
  verified:   { type: Boolean, default: false },  // restore-test passed
}, { collection: 'backups' });

export const DeploymentRecord = model('DeploymentRecord', DeploymentRecordSchema);
export const BackupRecord     = model('BackupRecord', BackupRecordSchema);
```

## Events & Commands

A1 is the *transport and host* for the canonical game commands/events (`PlotMovement`, `EnergyAllocated`, `ImpulseAdvanced`, `GmOverrideApplied`, …) defined across the engine docs — it does not author them. It additionally emits its own **operational** commands/events, recorded to `deployments`/`backups` and the ops-audit stream, mirroring the event-sourced philosophy at the infra layer.

```ts
// Operational commands (admin-only; surfaced in the platform admin console)
type DeployRelease   = { type: 'DeployRelease'; gitSha: string; imageDigest: string; instances: number; actor: string };
type RotateSecret    = { type: 'RotateSecret'; key: keyof InfraConfig; actor: string; reason: string };
type ScaleWorkers    = { type: 'ScaleWorkers'; target: number | 'max'; actor: string };
type TriggerBackup   = { type: 'TriggerBackup'; scope: 'full' | 'game'; gameId?: string; actor: string };
type RestoreSnapshot = { type: 'RestoreSnapshot'; backupId: string; targetGameId?: string; actor: string };
type DrainWorker     = { type: 'DrainWorker'; pm2Id: number; actor: string }; // graceful shutdown

// Operational events (appended to 'deployments'/'backups' + ops-audit)
type ReleaseDeployed   = { type: 'ReleaseDeployed'; releaseId: string; gitSha: string; at: string };
type SecretRotated     = { type: 'SecretRotated'; key: string; at: string; rolledBy: string };
type WorkersScaled     = { type: 'WorkersScaled'; from: number; to: number; at: string };
type BackupCompleted   = { type: 'BackupCompleted'; backupId: string; kind: string; sizeBytes: number; at: string };
type SnapshotRestored  = { type: 'SnapshotRestored'; backupId: string; targetGameId: string; at: string };
type WorkerDrained     = { type: 'WorkerDrained'; pm2Id: number; reconnectedSockets: number; at: string };
type HealthCheckFailed = { type: 'HealthCheckFailed'; pm2Id: number; check: string; at: string };
```

The **fan-out contract** for game events is provided here and consumed by `A4-realtime-sync-layer.md`: when a worker appends a domain event to `gameEvents`, it `PUBLISH`es the event envelope to `sfb:game:{gameId}:events`; the Redis Socket.IO adapter relays it to every worker holding a socket subscribed to that game's room. Hidden fields are stripped *before* publish (server-side fog-of-war), so the pub/sub bus never carries information a client may not see.

## Engine / API

Pure-where-possible boot and ops functions, co-located in `server/infra/`:

```ts
function loadInfraConfig(env: NodeJS.ProcessEnv): InfraConfig; // joi/zod-validated, frozen
function validateRequiredSecrets(cfg: InfraConfig): string[];  // [] == ok; nonempty => process.exit(1) in prod
function buildRedisClients(cfg: InfraConfig): { pub: Redis; sub: Redis; data: Redis }; // 3 clients (pub/sub must be dedicated)
function buildSocketAdapter(io: Server, clients: RedisClients): void;                   // @socket.io/redis-adapter
function publishGameEvent(gameId: string, envelope: PublicEventEnvelope): Promise<void>;
function acquireTurnLock(gameId: string, ttlMs: number): Promise<LockHandle | null>;    // single-writer per game
function healthCheck(): Promise<HealthReport>; // mongo ping + redis ping + event-fold smoke
function gracefulShutdown(signal: NodeJS.Signals): Promise<void>; // drain sockets, flush logs, close pools
function runBackup(cmd: TriggerBackup): Promise<BackupRecord>;
function restoreFromBackup(cmd: RestoreSnapshot): Promise<SnapshotRestored>;
```

`server.js` boot order matches wavemax exactly: `loadInfraConfig` → `validateRequiredSecrets` (fatal in prod) → install the Oracle ADB Mongo-API cursor-retry shim (`installCursorRetry`) → `mongoose.connect` → `buildRedisClients` → Express (`trust proxy = trustProxyHops`, Helmet, csrf-csrf, express-rate-limit, compression, Winston/morgan) → Socket.IO + `buildSocketAdapter` → `app.listen(port)`. `SIGTERM`/`SIGINT` route to `gracefulShutdown` so PM2 reloads never drop an in-flight impulse resolution.

## Validation & Enforcement Rules

- **Secret fail-fast (referee for the environment).** In `production`, `validateRequiredSecrets` returning a nonempty list calls `process.exit(1)` *before* binding the port — never fall back to a dev-default HMAC for session/JWT/CSRF, exactly as wavemax does.
- **Single-writer per game.** Although PM2 runs in `cluster` mode, all writes for a given `gameId` are serialized through `acquireTurnLock` (Redis `SET NX PX`). This is the infra-level guarantee behind the engine's determinism; concurrent commands for the same game on different workers are rejected/retried, never interleaved.
- **Fog-of-war at the bus.** `publishGameEvent` must receive an already-redacted `PublicEventEnvelope`. Publishing raw hidden state is a hard validation failure caught in tests (see §Testing).
- **Port/DB/namespace isolation.** SFB binds port **3001**, DB **`sfb`**, and Redis prefix **`sfb:`** so it cannot collide with the co-resident wavemax app (3000 / `wavemax` / `wavemax:`).
- **GM-override surface.** A1 owns no gameplay ruling, so it has no `GmOverrideApplied` emit point of its own. The only override-equivalent is the **admin** ops console (DeployRelease/RotateSecret/RestoreSnapshot), which is IP-gated and audited, mirroring wavemax's `adminIpGate`. Per-game GM overrides live in the engine docs.

## UI Contract

A1 surfaces only an **admin/ops console** (role `admin`, IP-gated): a deploy/release panel (current `releaseId`, git sha, image digest, instance count, rollback button), a health dashboard (Mongo/Redis ping, per-worker presence, socket counts, event-lag), a secrets-rotation panel, and a backup/restore panel reading the `backups` collection. There is no player-facing UI here; gameplay screens are specified in the `D*` docs. Entry to the application is via the `crhsent.com` gated portal: an authenticated tile/link routes verified owners to `https://play.chrsent.com`, where nginx reverse-proxies to the SFB PM2 upstream. No SFB-specific wireframe file is required; the ops console reuses the wavemax admin shell.

## Dependencies

- `A4-realtime-sync-layer.md` — consumes the Redis pub/sub topology and Socket.IO adapter provisioned here.
- `A3-data-architecture-event-store.md` — defines `gameEvents`/`gameSnapshots`; A1 provisions the MongoDB tier and backup/restore for them.
- `A2-identity-roles-gating.md` — express-session + connect-mongo + JWT; A1 supplies the session store and secret management.
- `E4-security-integrity.md` — uses the Redis sealed-order store keys defined here.
- `E1-dice-rng-service.md` — the sole entropy source whose isolation A1 enforces in the image.
- `B1-rules-content-api.md` — the gated full-text rules search shares this nginx/TLS and auth tier.
- External: OCI compute + Object Storage, Oracle ADB (Mongo-API), Cloudflare (DNS/CDN in front of nginx), Firebase (push), the sibling `wavemax-affiliate-program` deploy box.

## Edge Cases & Open Questions

- **Oracle ADB Mongo-API quirks.** The shared box already patches an intermittent *"BSON element cursor is missing"* error via `installCursorRetry`; SFB must install the same shim. Open: confirm ADB transaction support is sufficient for the multi-document append+snapshot, or whether the single-writer lock makes transactions unnecessary.
- **Redis durability for sealed orders.** Sealed orders are hash-committed; if Redis is purely in-memory, a node restart mid-allocation could lose unrevealed orders. Decision: enable Redis AOF (`appendonly yes`) and also mirror commit hashes into `gameEvents` so a replay can detect/repair. Open question deferred to `A5`.
- **Domain spelling.** The portal domain appears as both `chrsent.com` and `crhsent.com`; **`crhsent.com` is canonical** (matches the existing CRHS Enterprises static site). Confirm the `play.` subdomain and certificate SAN.
- **Cluster socket affinity.** With `instances: 'max'`, sticky sessions are not required because the Redis adapter fans out, but presence reconciliation after a `WorkerDrained` event needs a sweep; covered in `A2`.

## Testing

- **Boot/secret test:** unit-test `validateRequiredSecrets` returns nonempty for each missing secret and that `NODE_ENV=production` boot exits 1 (no port bind).
- **Determinism smoke:** in CI, fold a fixture `gameEvents` log on two freshly built containers and assert byte-identical snapshot hashes — the infra-level proof that the cited Sequence-of-Play/Energy-Allocation resolution is reproducible across workers.
- **Fan-out + fog test:** publish a redacted envelope, assert subscribers on a second worker receive it and that no hidden field traverses the bus (negative test fails the build if raw state is published).
- **Failover test:** `DrainWorker` mid-impulse; assert sockets reconnect, the turn lock releases, and resolution completes once on the surviving worker.
- **Backup/restore test:** `runBackup({scope:'game'})` then `restoreFromBackup` into a scratch `gameId`; assert the restored fold equals the source fold and mark `BackupRecord.verified=true`. CI uses `mongodb-memory-server` + a Redis test container, matching the wavemax Jest/Playwright setup.

## Phasing

- **[v1 AM-tournament]** Single OCI VM co-resident with wavemax: one Docker image (`node:20-alpine`, port 3001), PM2 cluster (`instances:'max'`, `max_memory_restart:'1G'`), one Redis (pub/sub + sealed-order store + presence), Oracle ADB Mongo-API (`sfb` DB), nginx `play.chrsent.com` server block with Cloudflare TLS, SSH + `git pull --ff-only` deploy, nightly Mongo dump + Redis RDB to OCI Object Storage, Winston file logs. This fully serves AM **tournament** play (small ship counts, bounded concurrent games), so it is the milestone target.
- **[v2]** Dedicated VM, blue/green releases driven by `DeployRecord`/`rollbackOf`, Redis Sentinel/managed Redis for HA, automated restore-verification, Prometheus/Grafana metrics exporter alongside Winston.
- **[v3 full Master]** Horizontal multi-node scale-out (the Redis adapter already permits it), cross-region Object Storage DR replication, and per-region socket presence — needed only when full Master-Rulebook scenarios (large fleets, many simultaneous games) exceed a single node's capacity.
