# Promotion Agent

[![CI](https://github.com/ColinLi98/promotion-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/ColinLi98/promotion-agent/actions/workflows/ci.yml)

Backend-first MVP scaffold for the PRD in [Promotion_Agent_PRD_v0.9.docx](./Promotion_Agent_PRD_v0.9.docx).

## What is implemented

- `AgentLead`, `PartnerAgent`, `Campaign`, `OfferCard`, `ProofBundle`, `OpportunityRequest`, `EventReceipt`, and `SettlementReceipt` domain models.
- `Offer Compiler`, `Policy Engine`, and `Campaign` lifecycle (`draft -> reviewing -> active/rejected`).
- Opportunity Exchange flow with eligibility gates and sponsored reranking.
- Ranking formula aligned to the PRD:

```txt
eligible_i = policy_pass && relevance_i >= relevance_floor && expected_utility_i >= utility_floor && trust_i >= min_trust
priority_score_i = 0.35*relevance + 0.25*utility + 0.15*trust + 0.15*affective_fit + 0.10*bid_norm
```

- Measurement and settlement for two MVP billing models:
  - `CPQR` bills on `shortlisted`
  - `CPA` bills on `conversion`
- Seed data for two buyer agent partners and two CRM campaigns.

## Endpoints

- `GET /health`
- `GET /agents/leads`
- `GET /partners`
- `GET /campaigns`
- `GET /campaigns/:campaignId`
- `GET /campaigns/:campaignId/policy-check`
- `POST /campaigns`
- `POST /campaigns/:campaignId/review`
- `POST /campaigns/:campaignId/activate`
- `POST /opportunities/evaluate`
- `POST /events/receipts`
- `GET /settlements`
- `GET /settlements/retry-jobs`
- `POST /settlements/retry-queue/process`
- `POST /settlements/:settlementId/dispute`
- `GET /dashboard`
- `GET /audit-trail`

## Run

```bash
pnpm install
pnpm start
```

Server starts on `http://localhost:3000`.

## Demo Mode

For a stable stakeholder demo with virtual data and isolated in-memory state:

Hosted demo:

- https://promotion-agent-demo.vercel.app

```bash
pnpm start:demo
```

Demo mode starts on `http://localhost:3001` and:

- uses a richer synthetic product dataset
- bootstraps measurement, settlement, queue, audit, and risk activity automatically
- keeps CRM focused on demo data instead of real discovery output
- ignores PostgreSQL / Redis / billing adapter runtime state so the demo stays deterministic

By default the app uses in-memory persistence and in-memory hot state. If `DATABASE_URL` is set, startup switches to PostgreSQL automatically. If `REDIS_URL` is set, idempotency keys and opportunity cache switch to Redis.

Hot-state keys are namespaced and versioned:

```txt
{HOT_STATE_NAMESPACE}:{HOT_STATE_VERSION}:cache:...
{HOT_STATE_NAMESPACE}:{HOT_STATE_VERSION}:idempotency:...
{HOT_STATE_NAMESPACE}:{HOT_STATE_VERSION}:lock:...
```

## GitHub Guardrails

Recommended branch protection settings for `main`:

- Require a pull request before merging.
- Require at least 1 approving review.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution before merging.
- Require status check `test`.
- After Vercel secrets are configured, optionally also require `deploy-preview`.
- Block force pushes and branch deletion.
- Consider merge queue once more than one contributor is landing changes regularly.

These are recommendations only. They are not auto-enforced by this repo.

## Vercel

This repo includes GitHub Actions workflows for:

- preview deployments on pull requests from this repository
- production deployments on pushes to `main`

Required GitHub repository secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Suggested one-time setup:

1. Link the repo to a Vercel project locally:

```bash
pnpm dlx vercel@latest link
```

2. Read the generated project metadata:

```bash
cat .vercel/project.json
```

3. Add the values to GitHub Actions secrets for this repository.

4. Add runtime environment variables in the Vercel project if you want managed PostgreSQL, Redis, or an external billing adapter.

Deployment notes:

- Vercel deploys the Fastify app entrypoint from `src/index.ts`.
- `public/` assets are bundled into the Vercel function.
- The settlement worker is not deployed by Vercel and should run separately.
- Embedded PostgreSQL and embedded Redis scripts are local-dev tooling only.
- Without `DATABASE_URL` and `REDIS_URL`, Vercel previews run with in-memory state that resets across invocations.

## PostgreSQL

1. Start a local database:

```bash
docker compose up -d postgres
```

Or, if Docker is unavailable on the machine, start the embedded PostgreSQL runtime:

```bash
pnpm db:embedded
```

2. Point the app to PostgreSQL:

```bash
cp .env.example .env
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/promotion_agent
```

For the embedded runtime, use:

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres
```

3. Initialize schema and seed data:

```bash
pnpm db:init
```

4. Start the app:

```bash
pnpm start
```

The startup log will say `using postgres persistence` when PostgreSQL is active.

## Redis Hot State

Redis is used for:

- receipt idempotency keys and lock coordination
- short TTL cache for repeated opportunity evaluation

Start a local Redis instance:

```bash
pnpm redis:embedded
```

Then point the app to it:

```bash
export REDIS_URL=redis://127.0.0.1:6380
export HOT_STATE_NAMESPACE=promotion-agent
export HOT_STATE_VERSION=v1
```

When Redis is active, the startup log will say `using redis hot-state`.

Current TTL policy:

- opportunity cache: `12s`
- receipt idempotency result: `15m`
- receipt lock lease: `8s`
- settlement retry lease: `10s`

## Settlement State Machine

Settlement statuses:

- `pending`
- `processing`
- `retry_scheduled`
- `settled`
- `disputed`
- `failed`

Every billable settlement creates a retry job. Use the queue processor to advance jobs:

```bash
curl -X POST http://127.0.0.1:3000/settlements/retry-queue/process \
  -H 'content-type: application/json' \
  -d '{"limit": 20}'
```

You can inspect retry jobs with:

```bash
curl 'http://127.0.0.1:3000/settlements/retry-jobs?limit=20'
```

You can mark a settlement disputed with:

```bash
curl -X POST http://127.0.0.1:3000/settlements/<settlementId>/dispute
```

## Settlement Worker

Instead of manually calling the queue processor, run the background worker:

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres
export REDIS_URL=redis://127.0.0.1:6380
export BILLING_PROVIDER_PROFILE=generic_v1
pnpm worker:settlement
```

Optional worker tuning:

```bash
export SETTLEMENT_WORKER_INTERVAL_MS=5000
export SETTLEMENT_WORKER_BATCH_SIZE=20
export SETTLEMENT_WORKER_LEADER_LEASE_MS=15000
```

Leader election:

- The worker uses a Redis lease on `leader:settlement-worker`
- Only the elected leader processes retry jobs
- Standby workers keep metrics and health endpoints but skip queue work

## Billing Adapter

The default gateway is simulated. To switch to a real external HTTP adapter:

```bash
export BILLING_ADAPTER_URL=http://127.0.0.1:8787/settlements
export BILLING_PROVIDER_PROFILE=generic_v1
export BILLING_ADAPTER_API_KEY=
export BILLING_ADAPTER_TIMEOUT_MS=5000
export BILLING_ADAPTER_HMAC_SECRET=
export BILLING_ADAPTER_SIGNATURE_HEADER=x-billing-signature
export BILLING_ADAPTER_TIMESTAMP_HEADER=x-billing-timestamp
```

The current provider contract is `billing.settlement.v1`, sent as JSON:

```json
{
  "contract_version": "billing.settlement.v1",
  "settlement": {
    "settlement_id": "set_xxx",
    "trace_id": "int_xxx",
    "billing_model": "CPQR",
    "event_type": "shortlisted",
    "amount": {"value": 160, "currency": "USD"},
    "attribution_window": "session",
    "status": "processing",
    "generated_at": "2026-03-11T18:59:19.010Z"
  },
  "context": {
    "campaign_id": "cmp_xxx",
    "offer_id": "offer_xxx",
    "partner_id": "partner_xxx",
    "intent_id": "int_xxx"
  },
  "delivery": {
    "retry_job_id": "retry_xxx",
    "attempts": 1,
    "sent_at": "2026-03-11T18:59:19.804Z"
  }
}
```

Expected response semantics:

```json
{
  "status": "accepted | settled | retry | failed",
  "provider_settlement_id": "provider_xxx",
  "provider_reference": "optional_ref",
  "code": "PROVIDER_CODE",
  "message": "human readable message"
}
```

When `BILLING_ADAPTER_HMAC_SECRET` is configured, requests are signed as:

- `x-billing-timestamp`
- `x-billing-signature = HMAC_SHA256(timestamp + "." + rawBody)`

Supported provider profiles:

- `generic_v1`
  Uses the nested `billing.settlement.v1` contract and generic status mapping.
- `ledger_api_v2`
  Uses the flat `ledger.settlement.v2` contract and a code table including `PAID`, `RATE_LIMITED`, `INVALID_PAYLOAD`, and `DUPLICATE_SETTLED`.

For local verification, start the mock adapter:

```bash
pnpm billing:mock
```

When configured, both the web app and the settlement worker log `http billing adapter`.

## Worker Metrics And Alerts

The settlement worker exposes Prometheus metrics on:

```txt
http://127.0.0.1:${SETTLEMENT_WORKER_METRICS_PORT:-9464}/metrics
```

Current metrics include:

- `promotion_agent_worker_runs_total`
- `promotion_agent_worker_jobs_processed_total`
- `promotion_agent_worker_jobs_settled_total`
- `promotion_agent_worker_jobs_retried_total`
- `promotion_agent_worker_jobs_failed_total`
- `promotion_agent_worker_jobs_skipped_total`
- `promotion_agent_worker_alerts_sent_total`
- `promotion_agent_worker_retry_jobs_open`
- `promotion_agent_worker_dlq_open_total`
- `promotion_agent_worker_last_run_duration_seconds`
- `promotion_agent_worker_last_run_timestamp_seconds`

Alert sinks:

```bash
export ALERT_WEBHOOK_URL=http://127.0.0.1:8790/webhook
export ALERT_WEBHOOK_API_KEY=
export SLACK_WEBHOOK_URL=http://127.0.0.1:8790/slack
export ALERT_SUPPRESSION_SECONDS=300
```

Alert suppression:

- Alerts are fingerprinted from title + summary details
- Repeated failures inside the suppression window are dropped instead of re-sent
- Suppressed alerts increment `promotion_agent_worker_alerts_suppressed_total`

For local verification, start the alert mock:

```bash
pnpm alerts:mock
```

## DLQ Console

Dead letters are persisted and exposed through:

- `GET /settlements/dlq`
- `POST /settlements/dlq/:dlqEntryId/replay`
- `POST /settlements/dlq/:dlqEntryId/resolve`

The manual operations page is:

```txt
/dlq.html
```

DLQ actions supported from UI and API:

- replay failed settlements back into the retry queue
- mark entries `resolved`
- mark entries `ignored`

## Audit Drill-Down

The main dashboard shows the latest audit events. For paginated trace inspection, open:

```txt
/audit.html?traceId=<traceId>&page=1&pageSize=20
```

## Test

```bash
pnpm test
```

## Notes

- The service now supports two persistence modes:
  - default: in-memory for fast local demos
  - with `DATABASE_URL`: PostgreSQL with schema bootstrap and seed data
- The service now supports two hot-state modes:
  - default: in-memory idempotency and cache
  - with `REDIS_URL`: Redis-backed idempotency keys, distributed locks, and opportunity cache
- `GET /audit-trail` now supports pagination and trace filters.
- Settlement processing now runs through a retry queue and explicit state machine instead of staying forever in `pending`.
- `POST /campaigns` now creates a draft campaign, compiles its `OfferCard`, runs policy precheck, and requires explicit activation before it can join ranking.
- The next production step is to make PostgreSQL and Redis the default environments, then split the current modules into the PRD's P0 services.
