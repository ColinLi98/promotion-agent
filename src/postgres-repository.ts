import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import {
  AgentLeadSchema,
  AuditEventSchema,
  AuditEventPageSchema,
  CampaignSchema,
  EventReceiptSchema,
  PartnerAgentSchema,
  PolicyCheckResultSchema,
  SettlementDeadLetterEntrySchema,
  SettlementDeadLetterPageSchema,
  SettlementReceiptSchema,
  SettlementRetryJobSchema,
  type AgentLead,
  type AuditEvent,
  type AuditEventFilter,
  type AuditEventPage,
  type Campaign,
  type EventReceipt,
  type PartnerAgent,
  type PolicyCheckResult,
  type SettlementDeadLetterEntry,
  type SettlementDeadLetterFilter,
  type SettlementDeadLetterPage,
  type SettlementReceipt,
  type SettlementRetryJob,
  type SettlementRetryJobFilter,
} from "./domain.js";
import { runPolicyCheck } from "./policy.js";
import type { PromotionAgentRepository } from "./repository.js";
import type { SeedData } from "./seed.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.resolve(__dirname, "./db/schema.sql");

const toJson = (value: unknown) => JSON.stringify(value);

export class PostgresPromotionAgentRepository implements PromotionAgentRepository {
  private constructor(private readonly pool: Pool) {}

  static async connect(connectionString: string, seedData: SeedData) {
    const pool = new Pool({
      connectionString,
    });
    const repository = new PostgresPromotionAgentRepository(pool);
    await repository.migrate();
    await repository.seed(seedData);
    await repository.backfillRetryJobs();
    return repository;
  }

  async listLeads() {
    const result = await this.pool.query(`
      SELECT agent_id, source, provider_org, card_url, verticals, skills, geo, auth_modes, accepts_sponsored,
             supports_disclosure, trust_seed, lead_score
      FROM agent_leads
      ORDER BY provider_org ASC
    `);

    return result.rows.map((row) =>
      AgentLeadSchema.parse({
        agentId: row.agent_id,
        source: row.source,
        providerOrg: row.provider_org,
        cardUrl: row.card_url,
        verticals: row.verticals,
        skills: row.skills,
        geo: row.geo,
        authModes: row.auth_modes,
        acceptsSponsored: row.accepts_sponsored,
        supportsDisclosure: row.supports_disclosure,
        trustSeed: row.trust_seed,
        leadScore: row.lead_score,
      }),
    );
  }

  async listPartners() {
    const result = await this.pool.query(`
      SELECT partner_id, agent_lead_id, provider_org, endpoint, status, supported_categories, accepts_sponsored,
             supports_disclosure, trust_score, auth_modes, sla_tier
      FROM partner_agents
      ORDER BY provider_org ASC
    `);

    return result.rows.map((row) =>
      PartnerAgentSchema.parse({
        partnerId: row.partner_id,
        agentLeadId: row.agent_lead_id,
        providerOrg: row.provider_org,
        endpoint: row.endpoint,
        status: row.status,
        supportedCategories: row.supported_categories,
        acceptsSponsored: row.accepts_sponsored,
        supportsDisclosure: row.supports_disclosure,
        trustScore: row.trust_score,
        authModes: row.auth_modes,
        slaTier: row.sla_tier,
      }),
    );
  }

  async listCampaigns() {
    const result = await this.pool.query(`
      SELECT campaign_id, advertiser, category, regions, targeting_partner_ids, billing_model, payout_amount, currency,
             budget, status, disclosure_text, policy_pass, min_trust, offer, proof_bundle
      FROM campaigns
      ORDER BY advertiser ASC
    `);

    return result.rows.map((row) => this.mapCampaign(row));
  }

  async getCampaign(campaignId: string) {
    const result = await this.pool.query(
      `
        SELECT campaign_id, advertiser, category, regions, targeting_partner_ids, billing_model, payout_amount, currency,
               budget, status, disclosure_text, policy_pass, min_trust, offer, proof_bundle
        FROM campaigns
        WHERE campaign_id = $1
      `,
      [campaignId],
    );

    return result.rows[0] ? this.mapCampaign(result.rows[0]) : null;
  }

  async upsertCampaign(campaign: Campaign) {
    const parsed = CampaignSchema.parse(campaign);
    await this.pool.query(
      `
        INSERT INTO campaigns (
          campaign_id, advertiser, category, regions, targeting_partner_ids, billing_model, payout_amount, currency,
          budget, status, disclosure_text, policy_pass, min_trust, offer, proof_bundle, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, $16
        )
        ON CONFLICT (campaign_id) DO UPDATE SET
          advertiser = EXCLUDED.advertiser,
          category = EXCLUDED.category,
          regions = EXCLUDED.regions,
          targeting_partner_ids = EXCLUDED.targeting_partner_ids,
          billing_model = EXCLUDED.billing_model,
          payout_amount = EXCLUDED.payout_amount,
          currency = EXCLUDED.currency,
          budget = EXCLUDED.budget,
          status = EXCLUDED.status,
          disclosure_text = EXCLUDED.disclosure_text,
          policy_pass = EXCLUDED.policy_pass,
          min_trust = EXCLUDED.min_trust,
          offer = EXCLUDED.offer,
          proof_bundle = EXCLUDED.proof_bundle,
          updated_at = EXCLUDED.updated_at
      `,
      [
        parsed.campaignId,
        parsed.advertiser,
        parsed.category,
        toJson(parsed.regions),
        toJson(parsed.targetingPartnerIds),
        parsed.billingModel,
        parsed.payoutAmount,
        parsed.currency,
        parsed.budget,
        parsed.status,
        parsed.disclosureText,
        parsed.policyPass,
        parsed.minTrust,
        toJson(parsed.offer),
        toJson(parsed.proofBundle),
        new Date().toISOString(),
      ],
    );
  }

  async listPolicyChecks(campaignId?: string) {
    const result = await this.pool.query(
      `
        SELECT policy_check_id, campaign_id, decision, reasons, risk_flags, checked_at
        FROM policy_checks
        ${campaignId ? "WHERE campaign_id = $1" : ""}
        ORDER BY checked_at DESC, policy_check_id DESC
      `,
      campaignId ? [campaignId] : [],
    );

    return result.rows.map((row) => this.mapPolicyCheck(row));
  }

  async getLatestPolicyCheck(campaignId: string) {
    const result = await this.pool.query(
      `
        SELECT policy_check_id, campaign_id, decision, reasons, risk_flags, checked_at
        FROM policy_checks
        WHERE campaign_id = $1
        ORDER BY checked_at DESC, policy_check_id DESC
        LIMIT 1
      `,
      [campaignId],
    );

    return result.rows[0] ? this.mapPolicyCheck(result.rows[0]) : null;
  }

  async insertPolicyCheck(policyCheck: PolicyCheckResult) {
    const parsed = PolicyCheckResultSchema.parse(policyCheck);
    await this.pool.query(
      `
        INSERT INTO policy_checks (policy_check_id, campaign_id, decision, reasons, risk_flags, checked_at)
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
        ON CONFLICT (policy_check_id) DO NOTHING
      `,
      [
        parsed.policyCheckId,
        parsed.campaignId,
        parsed.decision,
        toJson(parsed.reasons),
        toJson(parsed.riskFlags),
        parsed.checkedAt,
      ],
    );
  }

  async listEventReceipts() {
    const result = await this.pool.query(`
      SELECT receipt_id, intent_id, offer_id, campaign_id, partner_id, event_type, occurred_at, signature
      FROM event_receipts
      ORDER BY occurred_at DESC, receipt_id DESC
    `);

    return result.rows.map((row) => this.mapReceipt(row));
  }

  async getEventReceipt(receiptId: string) {
    const result = await this.pool.query(
      `
        SELECT receipt_id, intent_id, offer_id, campaign_id, partner_id, event_type, occurred_at, signature
        FROM event_receipts
        WHERE receipt_id = $1
      `,
      [receiptId],
    );

    return result.rows[0] ? this.mapReceipt(result.rows[0]) : null;
  }

  async insertEventReceipt(receipt: EventReceipt) {
    const parsed = EventReceiptSchema.parse(receipt);
    await this.pool.query(
      `
        INSERT INTO event_receipts (receipt_id, intent_id, offer_id, campaign_id, partner_id, event_type, occurred_at, signature)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (receipt_id) DO NOTHING
      `,
      [
        parsed.receiptId,
        parsed.intentId,
        parsed.offerId,
        parsed.campaignId,
        parsed.partnerId,
        parsed.eventType,
        parsed.occurredAt,
        parsed.signature,
      ],
    );
  }

  async listSettlements() {
    const result = await this.pool.query(`
      SELECT settlement_id, campaign_id, offer_id, partner_id, intent_id, billing_model, event_type, amount,
             currency, attribution_window, status, dispute_flag, provider_settlement_id, provider_reference,
             provider_state, provider_response_code, last_error, generated_at, updated_at
      FROM settlements
      ORDER BY generated_at DESC, settlement_id DESC
    `);

    return result.rows.map((row) => this.mapSettlement(row));
  }

  async getSettlement(settlementId: string) {
    const result = await this.pool.query(
      `
        SELECT settlement_id, campaign_id, offer_id, partner_id, intent_id, billing_model, event_type, amount,
               currency, attribution_window, status, dispute_flag, provider_settlement_id, provider_reference,
               provider_state, provider_response_code, last_error, generated_at, updated_at
        FROM settlements
        WHERE settlement_id = $1
      `,
      [settlementId],
    );

    return result.rows[0] ? this.mapSettlement(result.rows[0]) : null;
  }

  async findSettlement(intentId: string, offerId: string, eventType: EventReceipt["eventType"]) {
    const result = await this.pool.query(
      `
        SELECT settlement_id, campaign_id, offer_id, partner_id, intent_id, billing_model, event_type, amount,
               currency, attribution_window, status, dispute_flag, provider_settlement_id, provider_reference,
               provider_state, provider_response_code, last_error, generated_at, updated_at
        FROM settlements
        WHERE intent_id = $1 AND offer_id = $2 AND event_type = $3
        LIMIT 1
      `,
      [intentId, offerId, eventType],
    );

    return result.rows[0] ? this.mapSettlement(result.rows[0]) : null;
  }

  async insertSettlement(settlement: SettlementReceipt) {
    const parsed = SettlementReceiptSchema.parse(settlement);
    await this.pool.query(
      `
        INSERT INTO settlements (
          settlement_id, campaign_id, offer_id, partner_id, intent_id, billing_model, event_type, amount, currency,
          attribution_window, status, dispute_flag, provider_settlement_id, provider_reference, provider_state,
          provider_response_code, last_error, generated_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
        ON CONFLICT (settlement_id) DO NOTHING
      `,
      [
        parsed.settlementId,
        parsed.campaignId,
        parsed.offerId,
        parsed.partnerId,
        parsed.intentId,
        parsed.billingModel,
        parsed.eventType,
        parsed.amount,
        parsed.currency,
        parsed.attributionWindow,
        parsed.status,
        parsed.disputeFlag,
        parsed.providerSettlementId,
        parsed.providerReference,
        parsed.providerState,
        parsed.providerResponseCode,
        parsed.lastError,
        parsed.generatedAt,
        parsed.updatedAt,
      ],
    );
  }

  async updateSettlement(settlement: SettlementReceipt) {
    const parsed = SettlementReceiptSchema.parse(settlement);
    await this.pool.query(
      `
        UPDATE settlements
        SET status = $2,
            dispute_flag = $3,
            provider_settlement_id = $4,
            provider_reference = $5,
            provider_state = $6,
            provider_response_code = $7,
            last_error = $8,
            updated_at = $9
        WHERE settlement_id = $1
      `,
      [
        parsed.settlementId,
        parsed.status,
        parsed.disputeFlag,
        parsed.providerSettlementId,
        parsed.providerReference,
        parsed.providerState,
        parsed.providerResponseCode,
        parsed.lastError,
        parsed.updatedAt,
      ],
    );
  }

  async listSettlementRetryJobs(filter: SettlementRetryJobFilter = {}) {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter.status) {
      values.push(filter.status);
      conditions.push(`status = $${values.length}`);
    }

    if (filter.settlementId) {
      values.push(filter.settlementId);
      conditions.push(`settlement_id = $${values.length}`);
    }

    if (filter.traceId) {
      values.push(filter.traceId);
      conditions.push(`trace_id = $${values.length}`);
    }

    const limit = filter.limit ?? 50;
    values.push(limit);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.pool.query(
      `
        SELECT retry_job_id, settlement_id, trace_id, status, attempts, max_attempts, next_run_at,
               last_error, last_attempt_at, created_at, updated_at
        FROM settlement_retry_jobs
        ${whereClause}
        ORDER BY next_run_at ASC, retry_job_id ASC
        LIMIT $${values.length}
      `,
      values,
    );

    return result.rows.map((row) => this.mapSettlementRetryJob(row));
  }

  async getSettlementRetryJobBySettlementId(settlementId: string) {
    const result = await this.pool.query(
      `
        SELECT retry_job_id, settlement_id, trace_id, status, attempts, max_attempts, next_run_at,
               last_error, last_attempt_at, created_at, updated_at
        FROM settlement_retry_jobs
        WHERE settlement_id = $1
        LIMIT 1
      `,
      [settlementId],
    );

    return result.rows[0] ? this.mapSettlementRetryJob(result.rows[0]) : null;
  }

  async upsertSettlementRetryJob(job: SettlementRetryJob) {
    const parsed = SettlementRetryJobSchema.parse(job);
    await this.pool.query(
      `
        INSERT INTO settlement_retry_jobs (
          retry_job_id, settlement_id, trace_id, status, attempts, max_attempts, next_run_at, last_error,
          last_attempt_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
        )
        ON CONFLICT (settlement_id) DO UPDATE SET
          retry_job_id = EXCLUDED.retry_job_id,
          trace_id = EXCLUDED.trace_id,
          status = EXCLUDED.status,
          attempts = EXCLUDED.attempts,
          max_attempts = EXCLUDED.max_attempts,
          next_run_at = EXCLUDED.next_run_at,
          last_error = EXCLUDED.last_error,
          last_attempt_at = EXCLUDED.last_attempt_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        parsed.retryJobId,
        parsed.settlementId,
        parsed.traceId,
        parsed.status,
        parsed.attempts,
        parsed.maxAttempts,
        parsed.nextRunAt,
        parsed.lastError,
        parsed.lastAttemptAt,
        parsed.createdAt,
        parsed.updatedAt,
      ],
    );
  }

  async listSettlementDeadLetters(filter: SettlementDeadLetterFilter = {}): Promise<SettlementDeadLetterPage> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter.status) {
      values.push(filter.status);
      conditions.push(`status = $${values.length}`);
    }

    if (filter.traceId) {
      values.push(filter.traceId);
      conditions.push(`trace_id = $${values.length}`);
    }

    if (filter.settlementId) {
      values.push(filter.settlementId);
      conditions.push(`settlement_id = $${values.length}`);
    }

    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await this.pool.query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM settlement_dead_letters
        ${whereClause}
      `,
      values,
    );

    const result = await this.pool.query(
      `
        SELECT dlq_entry_id, settlement_id, retry_job_id, trace_id, status, reason, last_error, payload,
               resolution_note, created_at, updated_at, resolved_at
        FROM settlement_dead_letters
        ${whereClause}
        ORDER BY created_at DESC, dlq_entry_id DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      [...values, pageSize, offset],
    );

    const total = countResult.rows[0]?.count ?? 0;
    return SettlementDeadLetterPageSchema.parse({
      items: result.rows.map((row) => this.mapSettlementDeadLetter(row)),
      total,
      page,
      pageSize,
      hasNextPage: offset + pageSize < total,
      hasPreviousPage: page > 1,
    });
  }

  async getSettlementDeadLetter(dlqEntryId: string) {
    const result = await this.pool.query(
      `
        SELECT dlq_entry_id, settlement_id, retry_job_id, trace_id, status, reason, last_error, payload,
               resolution_note, created_at, updated_at, resolved_at
        FROM settlement_dead_letters
        WHERE dlq_entry_id = $1
      `,
      [dlqEntryId],
    );

    return result.rows[0] ? this.mapSettlementDeadLetter(result.rows[0]) : null;
  }

  async getSettlementDeadLetterBySettlementId(settlementId: string) {
    const result = await this.pool.query(
      `
        SELECT dlq_entry_id, settlement_id, retry_job_id, trace_id, status, reason, last_error, payload,
               resolution_note, created_at, updated_at, resolved_at
        FROM settlement_dead_letters
        WHERE settlement_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [settlementId],
    );

    return result.rows[0] ? this.mapSettlementDeadLetter(result.rows[0]) : null;
  }

  async upsertSettlementDeadLetter(entry: SettlementDeadLetterEntry) {
    const parsed = SettlementDeadLetterEntrySchema.parse(entry);
    await this.pool.query(
      `
        INSERT INTO settlement_dead_letters (
          dlq_entry_id, settlement_id, retry_job_id, trace_id, status, reason, last_error, payload,
          resolution_note, created_at, updated_at, resolved_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12
        )
        ON CONFLICT (dlq_entry_id) DO UPDATE SET
          retry_job_id = EXCLUDED.retry_job_id,
          trace_id = EXCLUDED.trace_id,
          status = EXCLUDED.status,
          reason = EXCLUDED.reason,
          last_error = EXCLUDED.last_error,
          payload = EXCLUDED.payload,
          resolution_note = EXCLUDED.resolution_note,
          updated_at = EXCLUDED.updated_at,
          resolved_at = EXCLUDED.resolved_at
      `,
      [
        parsed.dlqEntryId,
        parsed.settlementId,
        parsed.retryJobId,
        parsed.traceId,
        parsed.status,
        parsed.reason,
        parsed.lastError,
        toJson(parsed.payload),
        parsed.resolutionNote,
        parsed.createdAt,
        parsed.updatedAt,
        parsed.resolvedAt,
      ],
    );
  }

  async listAuditEvents(filter: AuditEventFilter = {}): Promise<AuditEventPage> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter.traceId) {
      values.push(filter.traceId);
      conditions.push(`trace_id = $${values.length}`);
    }

    if (filter.entityId) {
      values.push(filter.entityId);
      conditions.push(`entity_id = $${values.length}`);
    }

    if (filter.entityType) {
      values.push(filter.entityType);
      conditions.push(`entity_type = $${values.length}`);
    }

    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countResult = await this.pool.query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM audit_events
        ${whereClause}
      `,
      values,
    );
    const result = await this.pool.query(
      `
        SELECT audit_event_id, trace_id, entity_type, entity_id, action, status, actor_type, actor_id, details, occurred_at
        FROM audit_events
        ${whereClause}
        ORDER BY occurred_at DESC, audit_event_id DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      [...values, pageSize, offset],
    );

    const total = countResult.rows[0]?.count ?? 0;
    return AuditEventPageSchema.parse({
      items: result.rows.map((row) => this.mapAuditEvent(row)),
      total,
      page,
      pageSize,
      hasNextPage: offset + pageSize < total,
      hasPreviousPage: page > 1,
    });
  }

  async insertAuditEvent(event: AuditEvent) {
    const parsed = AuditEventSchema.parse(event);
    await this.pool.query(
      `
        INSERT INTO audit_events (
          audit_event_id, trace_id, entity_type, entity_id, action, status, actor_type, actor_id, details, occurred_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10
        )
        ON CONFLICT (audit_event_id) DO NOTHING
      `,
      [
        parsed.auditEventId,
        parsed.traceId,
        parsed.entityType,
        parsed.entityId,
        parsed.action,
        parsed.status,
        parsed.actorType,
        parsed.actorId,
        toJson(parsed.details),
        parsed.occurredAt,
      ],
    );
  }

  async close() {
    await this.pool.end();
  }

  private async migrate() {
    const schema = await readFile(schemaPath, "utf8");
    await this.pool.query(schema);
  }

  private async seed(seedData: SeedData) {
    for (const lead of seedData.leads) {
      await this.upsertLead(lead);
    }

    for (const partner of seedData.partners) {
      await this.upsertPartner(partner);
    }

    for (const campaign of seedData.campaigns) {
      await this.upsertCampaign(campaign);
    }

    const policyCheckCountResult = await this.pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM policy_checks`,
    );
    if (policyCheckCountResult.rows[0]?.count === 0) {
      for (const campaign of seedData.campaigns) {
        await this.insertPolicyCheck(runPolicyCheck(campaign));
      }
    }
  }

  private async backfillRetryJobs() {
    const result = await this.pool.query(
      `
        SELECT s.settlement_id, s.intent_id, s.status, s.generated_at, s.updated_at
        FROM settlements s
        LEFT JOIN settlement_retry_jobs r ON r.settlement_id = s.settlement_id
        WHERE r.settlement_id IS NULL
      `,
    );

    for (const row of result.rows) {
      const createdAt = String(row.generated_at ?? new Date().toISOString());
      const updatedAt = String(row.updated_at ?? createdAt);
      const status = String(row.status);
      const mappedStatus =
        status === "settled"
          ? "completed"
          : status === "disputed"
            ? "cancelled"
            : status === "failed"
              ? "failed"
              : status === "retry_scheduled"
                ? "retry_scheduled"
                : "queued";

      await this.upsertSettlementRetryJob({
        retryJobId: `retry_backfill_${String(row.settlement_id).replace(/[^a-zA-Z0-9_]/g, "_")}`,
        settlementId: String(row.settlement_id),
        traceId: String(row.intent_id),
        status: mappedStatus,
        attempts: mappedStatus === "completed" ? 1 : 0,
        maxAttempts: 3,
        nextRunAt: updatedAt,
        lastError: null,
        lastAttemptAt: mappedStatus === "completed" ? updatedAt : null,
        createdAt,
        updatedAt,
      });
    }
  }

  private async upsertLead(lead: AgentLead) {
    const parsed = AgentLeadSchema.parse(lead);
    await this.pool.query(
      `
        INSERT INTO agent_leads (
          agent_id, source, provider_org, card_url, verticals, skills, geo, auth_modes, accepts_sponsored,
          supports_disclosure, trust_seed, lead_score, created_at
        ) VALUES (
          $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13
        )
        ON CONFLICT (agent_id) DO UPDATE SET
          source = EXCLUDED.source,
          provider_org = EXCLUDED.provider_org,
          card_url = EXCLUDED.card_url,
          verticals = EXCLUDED.verticals,
          skills = EXCLUDED.skills,
          geo = EXCLUDED.geo,
          auth_modes = EXCLUDED.auth_modes,
          accepts_sponsored = EXCLUDED.accepts_sponsored,
          supports_disclosure = EXCLUDED.supports_disclosure,
          trust_seed = EXCLUDED.trust_seed,
          lead_score = EXCLUDED.lead_score
      `,
      [
        parsed.agentId,
        parsed.source,
        parsed.providerOrg,
        parsed.cardUrl,
        toJson(parsed.verticals),
        toJson(parsed.skills),
        toJson(parsed.geo),
        toJson(parsed.authModes),
        parsed.acceptsSponsored,
        parsed.supportsDisclosure,
        parsed.trustSeed,
        parsed.leadScore,
        new Date().toISOString(),
      ],
    );
  }

  private async upsertPartner(partner: PartnerAgent) {
    const parsed = PartnerAgentSchema.parse(partner);
    await this.pool.query(
      `
        INSERT INTO partner_agents (
          partner_id, agent_lead_id, provider_org, endpoint, status, supported_categories, accepts_sponsored,
          supports_disclosure, trust_score, auth_modes, sla_tier, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, $11, $12
        )
        ON CONFLICT (partner_id) DO UPDATE SET
          agent_lead_id = EXCLUDED.agent_lead_id,
          provider_org = EXCLUDED.provider_org,
          endpoint = EXCLUDED.endpoint,
          status = EXCLUDED.status,
          supported_categories = EXCLUDED.supported_categories,
          accepts_sponsored = EXCLUDED.accepts_sponsored,
          supports_disclosure = EXCLUDED.supports_disclosure,
          trust_score = EXCLUDED.trust_score,
          auth_modes = EXCLUDED.auth_modes,
          sla_tier = EXCLUDED.sla_tier
      `,
      [
        parsed.partnerId,
        parsed.agentLeadId,
        parsed.providerOrg,
        parsed.endpoint,
        parsed.status,
        toJson(parsed.supportedCategories),
        parsed.acceptsSponsored,
        parsed.supportsDisclosure,
        parsed.trustScore,
        toJson(parsed.authModes),
        parsed.slaTier,
        new Date().toISOString(),
      ],
    );
  }

  private mapCampaign(row: Record<string, unknown>) {
    return CampaignSchema.parse({
      campaignId: row.campaign_id,
      advertiser: row.advertiser,
      category: row.category,
      regions: row.regions,
      targetingPartnerIds: row.targeting_partner_ids,
      billingModel: row.billing_model,
      payoutAmount: row.payout_amount,
      currency: row.currency,
      budget: row.budget,
      status: row.status,
      disclosureText: row.disclosure_text,
      policyPass: row.policy_pass,
      minTrust: row.min_trust,
      offer: row.offer,
      proofBundle: row.proof_bundle,
    });
  }

  private mapPolicyCheck(row: Record<string, unknown>) {
    return PolicyCheckResultSchema.parse({
      policyCheckId: row.policy_check_id,
      campaignId: row.campaign_id,
      decision: row.decision,
      reasons: row.reasons,
      riskFlags: row.risk_flags,
      checkedAt: row.checked_at,
    });
  }

  private mapReceipt(row: Record<string, unknown>) {
    return EventReceiptSchema.parse({
      receiptId: row.receipt_id,
      intentId: row.intent_id,
      offerId: row.offer_id,
      campaignId: row.campaign_id,
      partnerId: row.partner_id,
      eventType: row.event_type,
      occurredAt: row.occurred_at,
      signature: row.signature,
    });
  }

  private mapSettlement(row: Record<string, unknown>) {
    return SettlementReceiptSchema.parse({
      settlementId: row.settlement_id,
      campaignId: row.campaign_id,
      offerId: row.offer_id,
      partnerId: row.partner_id,
      intentId: row.intent_id,
      billingModel: row.billing_model,
      eventType: row.event_type,
      amount: row.amount,
      currency: row.currency,
      attributionWindow: row.attribution_window,
      status: row.status,
      disputeFlag: row.dispute_flag,
      providerSettlementId: row.provider_settlement_id,
      providerReference: row.provider_reference,
      providerState: row.provider_state,
      providerResponseCode: row.provider_response_code,
      lastError: row.last_error,
      generatedAt: row.generated_at,
      updatedAt: row.updated_at,
    });
  }

  private mapSettlementRetryJob(row: Record<string, unknown>) {
    return SettlementRetryJobSchema.parse({
      retryJobId: row.retry_job_id,
      settlementId: row.settlement_id,
      traceId: row.trace_id,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      nextRunAt: row.next_run_at,
      lastError: row.last_error,
      lastAttemptAt: row.last_attempt_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private mapSettlementDeadLetter(row: Record<string, unknown>) {
    return SettlementDeadLetterEntrySchema.parse({
      dlqEntryId: row.dlq_entry_id,
      settlementId: row.settlement_id,
      retryJobId: row.retry_job_id,
      traceId: row.trace_id,
      status: row.status,
      reason: row.reason,
      lastError: row.last_error,
      payload: row.payload,
      resolutionNote: row.resolution_note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at,
    });
  }

  private mapAuditEvent(row: Record<string, unknown>) {
    return AuditEventSchema.parse({
      auditEventId: row.audit_event_id,
      traceId: row.trace_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      status: row.status,
      actorType: row.actor_type,
      actorId: row.actor_id,
      details: row.details,
      occurredAt: row.occurred_at,
    });
  }
}
