CREATE TABLE IF NOT EXISTS agent_leads (
  agent_id TEXT PRIMARY KEY,
  data_origin TEXT NOT NULL DEFAULT 'seed',
  data_provenance TEXT NOT NULL DEFAULT 'demo_seed',
  source TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'public_registry',
  source_ref TEXT NOT NULL DEFAULT '',
  provider_org TEXT NOT NULL,
  card_url TEXT NOT NULL,
  verticals JSONB NOT NULL DEFAULT '[]'::jsonb,
  skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  geo JSONB NOT NULL DEFAULT '[]'::jsonb,
  auth_modes JSONB NOT NULL DEFAULT '[]'::jsonb,
  accepts_sponsored BOOLEAN NOT NULL,
  supports_disclosure BOOLEAN NOT NULL,
  supports_delivery_receipt BOOLEAN NOT NULL DEFAULT false,
  supports_presentation_receipt BOOLEAN NOT NULL DEFAULT false,
  trust_seed DOUBLE PRECISION NOT NULL,
  lead_score DOUBLE PRECISION NOT NULL,
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  endpoint_url TEXT,
  contact_ref TEXT,
  missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  reach_proxy DOUBLE PRECISION NOT NULL DEFAULT 0,
  monetization_readiness DOUBLE PRECISION NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'new',
  last_verified_at TEXT,
  verification_owner TEXT,
  evidence_ref TEXT,
  assigned_owner TEXT,
  notes TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT NOT NULL DEFAULT '',
  score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL
);

ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'public_registry';
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS data_origin TEXT NOT NULL DEFAULT 'seed';
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS data_provenance TEXT NOT NULL DEFAULT 'demo_seed';
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS source_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS endpoint_url TEXT;
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS contact_ref TEXT;
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS reach_proxy DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS monetization_readiness DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS last_verified_at TEXT;
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS verification_owner TEXT;
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS evidence_ref TEXT;
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS assigned_owner TEXT;
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS dedupe_key TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS supports_delivery_receipt BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS supports_presentation_receipt BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS discovery_sources (
  source_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  seed_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL,
  crawl_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  vertical_hints JSONB NOT NULL DEFAULT '[]'::jsonb,
  geo_hints JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discovery_runs (
  run_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES discovery_sources(source_id),
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  discovered_count INTEGER NOT NULL,
  created_lead_count INTEGER NOT NULL,
  deduped_count INTEGER NOT NULL,
  error_count INTEGER NOT NULL,
  trace_id TEXT NOT NULL,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS recruitment_pipelines (
  pipeline_id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES agent_leads(agent_id),
  data_provenance TEXT NOT NULL DEFAULT 'ops_manual',
  provider_org TEXT NOT NULL,
  stage TEXT NOT NULL,
  priority TEXT NOT NULL,
  owner_id TEXT,
  target_persona TEXT,
  next_step TEXT,
  last_contact_at TEXT,
  last_activity_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (lead_id)
);

CREATE TABLE IF NOT EXISTS outreach_targets (
  target_id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL REFERENCES recruitment_pipelines(pipeline_id),
  lead_id TEXT NOT NULL REFERENCES agent_leads(agent_id),
  provider_org TEXT NOT NULL,
  recommended_campaign_id TEXT,
  channel TEXT NOT NULL,
  contact_point TEXT NOT NULL,
  subject_line TEXT NOT NULL DEFAULT '',
  message_template TEXT NOT NULL,
  recommendation_reason TEXT,
  proof_highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  auto_generated BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL,
  owner_id TEXT,
  send_attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_retry_at TEXT,
  provider_request_id TEXT,
  response_code TEXT,
  open_count INTEGER NOT NULL DEFAULT 0,
  first_opened_at TEXT,
  last_opened_at TEXT,
  open_signal TEXT NOT NULL DEFAULT 'none',
  last_open_source TEXT,
  last_error TEXT,
  last_sent_at TEXT,
  response_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS recommended_campaign_id TEXT;
ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS subject_line TEXT NOT NULL DEFAULT '';
ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS recommendation_reason TEXT;
ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS proof_highlights JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS send_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS last_attempt_at TEXT;
ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS next_retry_at TEXT;
ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS provider_request_id TEXT;
ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS response_code TEXT;
ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS open_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS first_opened_at TEXT;
ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS last_opened_at TEXT;
ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS open_signal TEXT NOT NULL DEFAULT 'none';
ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS last_open_source TEXT;
ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE TABLE IF NOT EXISTS onboarding_tasks (
  task_id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL REFERENCES recruitment_pipelines(pipeline_id),
  lead_id TEXT NOT NULL REFERENCES agent_leads(agent_id),
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  owner_id TEXT,
  due_at TEXT,
  related_target_id TEXT,
  auto_generated BOOLEAN NOT NULL DEFAULT false,
  evidence_ref TEXT,
  notes TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE onboarding_tasks ADD COLUMN IF NOT EXISTS related_target_id TEXT;
ALTER TABLE onboarding_tasks ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS partner_readiness (
  readiness_id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL REFERENCES recruitment_pipelines(pipeline_id),
  lead_id TEXT NOT NULL REFERENCES agent_leads(agent_id),
  overall_status TEXT NOT NULL,
  readiness_score DOUBLE PRECISION NOT NULL,
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_evaluated_at TEXT NOT NULL,
  UNIQUE (pipeline_id)
);

CREATE TABLE IF NOT EXISTS verification_records (
  record_id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES agent_leads(agent_id),
  previous_status TEXT NOT NULL,
  next_status TEXT NOT NULL,
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id TEXT NOT NULL,
  comment TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS partner_agents (
  partner_id TEXT PRIMARY KEY,
  agent_lead_id TEXT NOT NULL REFERENCES agent_leads(agent_id),
  data_provenance TEXT NOT NULL DEFAULT 'ops_manual',
  provider_org TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status TEXT NOT NULL,
  supported_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  accepts_sponsored BOOLEAN NOT NULL,
  supports_disclosure BOOLEAN NOT NULL,
  supports_delivery_receipt BOOLEAN NOT NULL DEFAULT false,
  supports_presentation_receipt BOOLEAN NOT NULL DEFAULT false,
  last_verified_at TEXT,
  verification_owner TEXT,
  evidence_ref TEXT,
  trust_score DOUBLE PRECISION NOT NULL,
  auth_modes JSONB NOT NULL DEFAULT '[]'::jsonb,
  sla_tier TEXT NOT NULL,
  buyer_intent_coverage JSONB NOT NULL DEFAULT '[]'::jsonb,
  icp_overlap_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  intent_access_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  delivery_readiness_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  historical_quality_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  commercial_readiness_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  buyer_agent_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  buyer_agent_tier TEXT NOT NULL DEFAULT 'unqualified',
  is_qualified_buyer_agent BOOLEAN NOT NULL DEFAULT false,
  is_commercially_eligible BOOLEAN NOT NULL DEFAULT false,
  created_at TEXT NOT NULL
);

ALTER TABLE partner_agents ADD COLUMN IF NOT EXISTS data_provenance TEXT NOT NULL DEFAULT 'ops_manual';
ALTER TABLE partner_agents ADD COLUMN IF NOT EXISTS buyer_intent_coverage JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE partner_agents ADD COLUMN IF NOT EXISTS icp_overlap_score DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE partner_agents ADD COLUMN IF NOT EXISTS intent_access_score DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE partner_agents ADD COLUMN IF NOT EXISTS delivery_readiness_score DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE partner_agents ADD COLUMN IF NOT EXISTS historical_quality_score DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE partner_agents ADD COLUMN IF NOT EXISTS commercial_readiness_score DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE partner_agents ADD COLUMN IF NOT EXISTS buyer_agent_score DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE partner_agents ADD COLUMN IF NOT EXISTS buyer_agent_tier TEXT NOT NULL DEFAULT 'unqualified';
ALTER TABLE partner_agents ADD COLUMN IF NOT EXISTS is_qualified_buyer_agent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE partner_agents ADD COLUMN IF NOT EXISTS is_commercially_eligible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE partner_agents ADD COLUMN IF NOT EXISTS supports_delivery_receipt BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE partner_agents ADD COLUMN IF NOT EXISTS supports_presentation_receipt BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE partner_agents ADD COLUMN IF NOT EXISTS last_verified_at TEXT;
ALTER TABLE partner_agents ADD COLUMN IF NOT EXISTS verification_owner TEXT;
ALTER TABLE partner_agents ADD COLUMN IF NOT EXISTS evidence_ref TEXT;

CREATE TABLE IF NOT EXISTS campaigns (
  campaign_id TEXT PRIMARY KEY,
  data_provenance TEXT NOT NULL DEFAULT 'ops_manual',
  workspace_id TEXT NOT NULL DEFAULT 'workspace_default',
  promotion_plan_id TEXT NOT NULL DEFAULT 'trial',
  advertiser TEXT NOT NULL,
  external_ref TEXT,
  source_document_url TEXT,
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
  link_bundle JSONB NOT NULL DEFAULT '{}'::jsonb,
  offer JSONB NOT NULL,
  proof_bundle JSONB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS data_provenance TEXT NOT NULL DEFAULT 'ops_manual';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'workspace_default';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS promotion_plan_id TEXT NOT NULL DEFAULT 'trial';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS external_ref TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS source_document_url TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS link_bundle JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS evidence_assets (
  asset_id TEXT PRIMARY KEY,
  data_provenance TEXT NOT NULL DEFAULT 'ops_manual',
  campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id),
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  verified_by TEXT,
  verification_note TEXT
);

ALTER TABLE evidence_assets ADD COLUMN IF NOT EXISTS data_provenance TEXT NOT NULL DEFAULT 'ops_manual';

CREATE TABLE IF NOT EXISTS risk_cases (
  case_id TEXT PRIMARY KEY,
  data_provenance TEXT NOT NULL DEFAULT 'ops_manual',
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_provenance TEXT,
  reason_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  resolved_at TEXT,
  owner_id TEXT,
  note TEXT
);

ALTER TABLE risk_cases ADD COLUMN IF NOT EXISTS data_provenance TEXT NOT NULL DEFAULT 'ops_manual';
ALTER TABLE risk_cases ADD COLUMN IF NOT EXISTS entity_provenance TEXT;

CREATE TABLE IF NOT EXISTS reputation_records (
  record_id TEXT PRIMARY KEY,
  data_provenance TEXT NOT NULL DEFAULT 'ops_manual',
  partner_id TEXT NOT NULL REFERENCES partner_agents(partner_id),
  delta DOUBLE PRECISION NOT NULL,
  reason_type TEXT NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  dispute_status TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

ALTER TABLE reputation_records ADD COLUMN IF NOT EXISTS data_provenance TEXT NOT NULL DEFAULT 'ops_manual';

CREATE TABLE IF NOT EXISTS appeal_cases (
  appeal_id TEXT PRIMARY KEY,
  data_provenance TEXT NOT NULL DEFAULT 'ops_manual',
  partner_id TEXT NOT NULL REFERENCES partner_agents(partner_id),
  target_record_id TEXT NOT NULL REFERENCES reputation_records(record_id),
  target_record_provenance TEXT,
  status TEXT NOT NULL,
  statement TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  decided_at TEXT,
  decision_note TEXT
);

ALTER TABLE appeal_cases ADD COLUMN IF NOT EXISTS data_provenance TEXT NOT NULL DEFAULT 'ops_manual';
ALTER TABLE appeal_cases ADD COLUMN IF NOT EXISTS target_record_provenance TEXT;

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
  data_provenance TEXT NOT NULL DEFAULT 'ops_manual',
  promotion_run_id TEXT,
  intent_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id),
  partner_id TEXT NOT NULL REFERENCES partner_agents(partner_id),
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  signature TEXT NOT NULL
);

ALTER TABLE event_receipts ADD COLUMN IF NOT EXISTS data_provenance TEXT NOT NULL DEFAULT 'ops_manual';
ALTER TABLE event_receipts ADD COLUMN IF NOT EXISTS promotion_run_id TEXT;

CREATE TABLE IF NOT EXISTS settlements (
  settlement_id TEXT PRIMARY KEY,
  data_provenance TEXT NOT NULL DEFAULT 'sandbox_settlement',
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
  ADD COLUMN IF NOT EXISTS data_provenance TEXT NOT NULL DEFAULT 'sandbox_settlement';
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
  data_provenance TEXT NOT NULL DEFAULT 'ops_manual',
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

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS data_provenance TEXT NOT NULL DEFAULT 'ops_manual';

CREATE TABLE IF NOT EXISTS buyer_agent_scorecards (
  scorecard_id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES agent_leads(agent_id),
  partner_id TEXT,
  provider_org TEXT NOT NULL,
  data_provenance TEXT NOT NULL,
  buyer_intent_coverage JSONB NOT NULL DEFAULT '[]'::jsonb,
  icp_overlap_score DOUBLE PRECISION NOT NULL,
  intent_access_score DOUBLE PRECISION NOT NULL,
  delivery_readiness_score DOUBLE PRECISION NOT NULL,
  historical_quality_score DOUBLE PRECISION NOT NULL,
  commercial_readiness_score DOUBLE PRECISION NOT NULL,
  buyer_agent_score DOUBLE PRECISION NOT NULL,
  buyer_agent_tier TEXT NOT NULL,
  is_qualified_buyer_agent BOOLEAN NOT NULL,
  is_commercially_eligible BOOLEAN NOT NULL,
  verification_status TEXT NOT NULL,
  supports_disclosure BOOLEAN NOT NULL,
  accepts_sponsored BOOLEAN NOT NULL,
  supports_delivery_receipt BOOLEAN NOT NULL DEFAULT false,
  supports_presentation_receipt BOOLEAN NOT NULL DEFAULT false,
  last_verified_at TEXT,
  verification_owner TEXT,
  evidence_ref TEXT,
  endpoint_url TEXT,
  updated_at TEXT NOT NULL
);

ALTER TABLE buyer_agent_scorecards ADD COLUMN IF NOT EXISTS supports_delivery_receipt BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE buyer_agent_scorecards ADD COLUMN IF NOT EXISTS supports_presentation_receipt BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE buyer_agent_scorecards ADD COLUMN IF NOT EXISTS last_verified_at TEXT;
ALTER TABLE buyer_agent_scorecards ADD COLUMN IF NOT EXISTS verification_owner TEXT;
ALTER TABLE buyer_agent_scorecards ADD COLUMN IF NOT EXISTS evidence_ref TEXT;

CREATE TABLE IF NOT EXISTS workspace_wallets (
  workspace_id TEXT PRIMARY KEY,
  available_credits DOUBLE PRECISION NOT NULL,
  reserved_credits DOUBLE PRECISION NOT NULL,
  consumed_credits DOUBLE PRECISION NOT NULL,
  expired_credits DOUBLE PRECISION NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_ledger_entries (
  entry_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  balance_after DOUBLE PRECISION NOT NULL,
  source TEXT NOT NULL,
  campaign_id TEXT,
  promotion_run_id TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_subscriptions (
  workspace_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  included_credits_per_cycle INTEGER NOT NULL,
  cycle_start_at TEXT NOT NULL,
  cycle_end_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promotion_runs (
  promotion_run_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id),
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_category TEXT NOT NULL,
  task_type TEXT NOT NULL,
  constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  qualified_buyer_agents_count INTEGER NOT NULL,
  coverage_credits_charged INTEGER NOT NULL,
  accepted_buyer_agents_count INTEGER NOT NULL DEFAULT 0,
  failed_buyer_agents_count INTEGER NOT NULL DEFAULT 0,
  shortlisted_count INTEGER NOT NULL,
  handoff_count INTEGER NOT NULL,
  conversion_count INTEGER NOT NULL,
  selected_partner_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE promotion_runs
  ADD COLUMN IF NOT EXISTS accepted_buyer_agents_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE promotion_runs
  ADD COLUMN IF NOT EXISTS failed_buyer_agents_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS promotion_run_targets (
  target_id TEXT PRIMARY KEY,
  promotion_run_id TEXT NOT NULL REFERENCES promotion_runs(promotion_run_id),
  workspace_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id),
  partner_id TEXT NOT NULL REFERENCES partner_agents(partner_id),
  provider_org TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  buyer_agent_tier TEXT NOT NULL,
  buyer_agent_score DOUBLE PRECISION NOT NULL,
  delivery_readiness_score DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  supported_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_attempt_at TEXT,
  dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT,
  next_retry_at TEXT,
  protocol TEXT,
  remote_request_id TEXT,
  response_code TEXT,
  last_error TEXT,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE promotion_run_targets
  ADD COLUMN IF NOT EXISTS cooldown_until TEXT;
ALTER TABLE promotion_run_targets
  ADD COLUMN IF NOT EXISTS next_retry_at TEXT;
ALTER TABLE promotion_run_targets
  ADD COLUMN IF NOT EXISTS protocol TEXT;
ALTER TABLE promotion_run_targets
  ADD COLUMN IF NOT EXISTS remote_request_id TEXT;
ALTER TABLE promotion_run_targets
  ADD COLUMN IF NOT EXISTS response_code TEXT;

CREATE INDEX IF NOT EXISTS idx_buyer_agent_scorecards_tier_score
  ON buyer_agent_scorecards (buyer_agent_tier, buyer_agent_score DESC);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_entries_workspace_occurred_at
  ON credit_ledger_entries (workspace_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_promotion_runs_workspace_created_at
  ON promotion_runs (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recruitment_pipelines_stage_updated_at
  ON recruitment_pipelines (stage, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_targets_pipeline_status
  ON outreach_targets (pipeline_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_pipeline_status
  ON onboarding_tasks (pipeline_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_promotion_run_targets_run_status
  ON promotion_run_targets (promotion_run_id, status, updated_at DESC);

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
