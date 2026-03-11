CREATE TABLE IF NOT EXISTS agent_leads (
  agent_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  provider_org TEXT NOT NULL,
  card_url TEXT NOT NULL,
  verticals JSONB NOT NULL DEFAULT '[]'::jsonb,
  skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  geo JSONB NOT NULL DEFAULT '[]'::jsonb,
  auth_modes JSONB NOT NULL DEFAULT '[]'::jsonb,
  accepts_sponsored BOOLEAN NOT NULL,
  supports_disclosure BOOLEAN NOT NULL,
  trust_seed DOUBLE PRECISION NOT NULL,
  lead_score DOUBLE PRECISION NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS partner_agents (
  partner_id TEXT PRIMARY KEY,
  agent_lead_id TEXT NOT NULL REFERENCES agent_leads(agent_id),
  provider_org TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status TEXT NOT NULL,
  supported_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  accepts_sponsored BOOLEAN NOT NULL,
  supports_disclosure BOOLEAN NOT NULL,
  trust_score DOUBLE PRECISION NOT NULL,
  auth_modes JSONB NOT NULL DEFAULT '[]'::jsonb,
  sla_tier TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  campaign_id TEXT PRIMARY KEY,
  advertiser TEXT NOT NULL,
  category TEXT NOT NULL,
  regions JSONB NOT NULL DEFAULT '[]'::jsonb,
  targeting_partner_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  billing_model TEXT NOT NULL,
  payout_amount DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL,
  budget DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  disclosure_text TEXT NOT NULL,
  policy_pass BOOLEAN NOT NULL,
  min_trust DOUBLE PRECISION NOT NULL,
  offer JSONB NOT NULL,
  proof_bundle JSONB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_checks (
  policy_check_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id),
  decision TEXT NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_receipts (
  receipt_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id),
  partner_id TEXT NOT NULL REFERENCES partner_agents(partner_id),
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  signature TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settlements (
  settlement_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id),
  offer_id TEXT NOT NULL,
  partner_id TEXT NOT NULL REFERENCES partner_agents(partner_id),
  intent_id TEXT NOT NULL,
  billing_model TEXT NOT NULL,
  event_type TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL,
  attribution_window TEXT NOT NULL,
  status TEXT NOT NULL,
  dispute_flag BOOLEAN NOT NULL,
  provider_settlement_id TEXT,
  provider_reference TEXT,
  provider_state TEXT,
  provider_response_code TEXT,
  last_error TEXT,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (intent_id, offer_id, event_type)
);

ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS updated_at TEXT;
ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS provider_settlement_id TEXT;
ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS provider_reference TEXT;
ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS provider_state TEXT;
ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS provider_response_code TEXT;
ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS last_error TEXT;

UPDATE settlements
SET updated_at = generated_at
WHERE updated_at IS NULL;

CREATE TABLE IF NOT EXISTS settlement_retry_jobs (
  retry_job_id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL REFERENCES settlements(settlement_id),
  trace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  max_attempts INTEGER NOT NULL,
  next_run_at TEXT NOT NULL,
  last_error TEXT,
  last_attempt_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (settlement_id)
);

CREATE TABLE IF NOT EXISTS settlement_dead_letters (
  dlq_entry_id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL REFERENCES settlements(settlement_id),
  retry_job_id TEXT,
  trace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  last_error TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  audit_event_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_policy_checks_campaign_checked_at
  ON policy_checks (campaign_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_receipts_intent_offer_event
  ON event_receipts (intent_id, offer_id, event_type);

CREATE INDEX IF NOT EXISTS idx_settlements_intent_offer_event
  ON settlements (intent_id, offer_id, event_type);

CREATE INDEX IF NOT EXISTS idx_settlement_retry_jobs_status_next_run_at
  ON settlement_retry_jobs (status, next_run_at ASC);

CREATE INDEX IF NOT EXISTS idx_settlement_dead_letters_status_created_at
  ON settlement_dead_letters (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_trace_occurred_at
  ON audit_events (trace_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_entity_occurred_at
  ON audit_events (entity_type, entity_id, occurred_at DESC);
