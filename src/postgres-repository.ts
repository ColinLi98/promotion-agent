import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import {
  AgentLeadSchema,
  AppealCaseSchema,
  AuditEventSchema,
  AuditEventPageSchema,
  CampaignSchema,
  DiscoveryRunSchema,
  DiscoverySourceInputSchema,
  DiscoverySourceSchema,
  EvidenceAssetSchema,
  EventReceiptSchema,
  MeasurementFunnelQuerySchema,
  MeasurementFunnelSchema,
  PartnerAgentSchema,
  PolicyCheckResultSchema,
  ReputationRecordSchema,
  RiskCaseSchema,
  SettlementDeadLetterEntrySchema,
  SettlementDeadLetterPageSchema,
  SettlementReceiptSchema,
  SettlementRetryJobSchema,
  type AgentLead,
  type AppealCase,
  type AuditEvent,
  type AuditEventFilter,
  type AuditEventPage,
  type Campaign,
  type DiscoveryRun,
  type DiscoverySource,
  type DiscoverySourceInput,
  type EvidenceAsset,
  type EventReceipt,
  type MeasurementFunnel,
  type MeasurementFunnelQuery,
  type PartnerAgent,
  type PolicyCheckResult,
  type ReputationRecord,
  type RiskCase,
  type SettlementDeadLetterEntry,
  type SettlementDeadLetterFilter,
  type SettlementDeadLetterPage,
  type SettlementReceipt,
  type SettlementRetryJob,
  type SettlementRetryJobFilter,
  type VerificationChecklist,
  type VerificationRecord,
  VerificationRecordSchema,
  type AttributionRow,
  type BillingDraft,
} from "./domain.js";
import { buildAttributionRows, buildBillingDrafts, buildMeasurementFunnel } from "./measurement.js";
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

  async listDiscoverySources() {
    const result = await this.pool.query(`
      SELECT source_id, source_type, name, base_url, seed_urls, active, crawl_policy, vertical_hints, geo_hints, created_at, updated_at
      FROM discovery_sources
      ORDER BY created_at DESC
    `);

    return result.rows.map((row) =>
      DiscoverySourceSchema.parse({
        sourceId: row.source_id,
        sourceType: row.source_type,
        name: row.name,
        baseUrl: row.base_url,
        seedUrls: row.seed_urls,
        active: row.active,
        crawlPolicy: row.crawl_policy,
        verticalHints: row.vertical_hints,
        geoHints: row.geo_hints,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    );
  }

  async createDiscoverySource(input: DiscoverySourceInput) {
    const parsed = DiscoverySourceInputSchema.parse(input);
    const source = DiscoverySourceSchema.parse({
      sourceId: `src_${Math.random().toString(36).slice(2, 10)}`,
      ...parsed,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await this.pool.query(
      `
        INSERT INTO discovery_sources (
          source_id, source_type, name, base_url, seed_urls, active, crawl_policy, vertical_hints, geo_hints, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11
        )
      `,
      [
        source.sourceId,
        source.sourceType,
        source.name,
        source.baseUrl,
        toJson(source.seedUrls),
        source.active,
        toJson(source.crawlPolicy),
        toJson(source.verticalHints),
        toJson(source.geoHints),
        source.createdAt,
        source.updatedAt,
      ],
    );
    return source;
  }

  async listDiscoveryRuns() {
    const result = await this.pool.query(`
      SELECT run_id, source_id, status, started_at, finished_at, discovered_count, created_lead_count, deduped_count, error_count, trace_id, errors
      FROM discovery_runs
      ORDER BY started_at DESC
    `);

    return result.rows.map((row) =>
      DiscoveryRunSchema.parse({
        runId: row.run_id,
        sourceId: row.source_id,
        status: row.status,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        discoveredCount: row.discovered_count,
        createdLeadCount: row.created_lead_count,
        dedupedCount: row.deduped_count,
        errorCount: row.error_count,
        traceId: row.trace_id,
        errors: row.errors,
      }),
    );
  }

  async insertDiscoveryRun(run: DiscoveryRun) {
    const parsed = DiscoveryRunSchema.parse(run);
    await this.pool.query(
      `
        INSERT INTO discovery_runs (
          run_id, source_id, status, started_at, finished_at, discovered_count, created_lead_count, deduped_count, error_count, trace_id, errors
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb
        )
      `,
      [
        parsed.runId,
        parsed.sourceId,
        parsed.status,
        parsed.startedAt,
        parsed.finishedAt,
        parsed.discoveredCount,
        parsed.createdLeadCount,
        parsed.dedupedCount,
        parsed.errorCount,
        parsed.traceId,
        toJson(parsed.errors),
      ],
    );
  }

  async updateDiscoveryRun(run: DiscoveryRun) {
    const parsed = DiscoveryRunSchema.parse(run);
    await this.pool.query(
      `
        UPDATE discovery_runs
        SET status = $2,
            finished_at = $3,
            discovered_count = $4,
            created_lead_count = $5,
            deduped_count = $6,
            error_count = $7,
            errors = $8::jsonb
        WHERE run_id = $1
      `,
      [
        parsed.runId,
        parsed.status,
        parsed.finishedAt,
        parsed.discoveredCount,
        parsed.createdLeadCount,
        parsed.dedupedCount,
        parsed.errorCount,
        toJson(parsed.errors),
      ],
    );
  }

  async listLeads() {
    const result = await this.pool.query(`
      SELECT agent_id, data_origin, source, source_type, source_ref, provider_org, card_url, verticals, skills, geo, auth_modes, accepts_sponsored,
             supports_disclosure, trust_seed, lead_score, discovered_at, last_seen_at, endpoint_url, contact_ref,
             missing_fields, reach_proxy, monetization_readiness, verification_status, assigned_owner, notes, dedupe_key, score_breakdown
      FROM agent_leads
      ORDER BY provider_org ASC
    `);

    return result.rows.map((row) =>
      AgentLeadSchema.parse({
        agentId: row.agent_id,
        dataOrigin: row.data_origin,
        source: row.source,
        sourceType: row.source_type,
        sourceRef: row.source_ref,
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
        discoveredAt: row.discovered_at,
        lastSeenAt: row.last_seen_at,
        endpointUrl: row.endpoint_url,
        contactRef: row.contact_ref,
        missingFields: row.missing_fields,
        reachProxy: row.reach_proxy,
        monetizationReadiness: row.monetization_readiness,
        verificationStatus: row.verification_status,
        assignedOwner: row.assigned_owner,
        notes: row.notes,
        dedupeKey: row.dedupe_key,
        scoreBreakdown: row.score_breakdown,
      }),
    );
  }

  async getLead(leadId: string) {
    const result = await this.pool.query(
      `
        SELECT agent_id, data_origin, source, source_type, source_ref, provider_org, card_url, verticals, skills, geo, auth_modes, accepts_sponsored,
               supports_disclosure, trust_seed, lead_score, discovered_at, last_seen_at, endpoint_url, contact_ref,
               missing_fields, reach_proxy, monetization_readiness, verification_status, assigned_owner, notes, dedupe_key, score_breakdown
        FROM agent_leads
        WHERE agent_id = $1
      `,
      [leadId],
    );

    return result.rows[0]
      ? AgentLeadSchema.parse({
          agentId: result.rows[0].agent_id,
          dataOrigin: result.rows[0].data_origin,
          source: result.rows[0].source,
          sourceType: result.rows[0].source_type,
          sourceRef: result.rows[0].source_ref,
          providerOrg: result.rows[0].provider_org,
          cardUrl: result.rows[0].card_url,
          verticals: result.rows[0].verticals,
          skills: result.rows[0].skills,
          geo: result.rows[0].geo,
          authModes: result.rows[0].auth_modes,
          acceptsSponsored: result.rows[0].accepts_sponsored,
          supportsDisclosure: result.rows[0].supports_disclosure,
          trustSeed: result.rows[0].trust_seed,
          leadScore: result.rows[0].lead_score,
          discoveredAt: result.rows[0].discovered_at,
          lastSeenAt: result.rows[0].last_seen_at,
          endpointUrl: result.rows[0].endpoint_url,
          contactRef: result.rows[0].contact_ref,
          missingFields: result.rows[0].missing_fields,
          reachProxy: result.rows[0].reach_proxy,
          monetizationReadiness: result.rows[0].monetization_readiness,
          verificationStatus: result.rows[0].verification_status,
          assignedOwner: result.rows[0].assigned_owner,
          notes: result.rows[0].notes,
          dedupeKey: result.rows[0].dedupe_key,
          scoreBreakdown: result.rows[0].score_breakdown,
        })
      : null;
  }

  async upsertLead(lead: AgentLead) {
    const parsed = AgentLeadSchema.parse(lead);
    await this.pool.query(
      `
        INSERT INTO agent_leads (
          agent_id, data_origin, source, source_type, source_ref, provider_org, card_url, verticals, skills, geo, auth_modes, accepts_sponsored,
          supports_disclosure, trust_seed, lead_score, discovered_at, last_seen_at, endpoint_url, contact_ref, missing_fields,
          reach_proxy, monetization_readiness, verification_status, assigned_owner, notes, dedupe_key, score_breakdown, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16, $17, $18, $19,
          $20::jsonb, $21, $22, $23, $24, $25, $26, $27::jsonb, $28
        )
        ON CONFLICT (agent_id) DO UPDATE SET
          data_origin = EXCLUDED.data_origin,
          source = EXCLUDED.source,
          source_type = EXCLUDED.source_type,
          source_ref = EXCLUDED.source_ref,
          provider_org = EXCLUDED.provider_org,
          card_url = EXCLUDED.card_url,
          verticals = EXCLUDED.verticals,
          skills = EXCLUDED.skills,
          geo = EXCLUDED.geo,
          auth_modes = EXCLUDED.auth_modes,
          accepts_sponsored = EXCLUDED.accepts_sponsored,
          supports_disclosure = EXCLUDED.supports_disclosure,
          trust_seed = EXCLUDED.trust_seed,
          lead_score = EXCLUDED.lead_score,
          discovered_at = EXCLUDED.discovered_at,
          last_seen_at = EXCLUDED.last_seen_at,
          endpoint_url = EXCLUDED.endpoint_url,
          contact_ref = EXCLUDED.contact_ref,
          missing_fields = EXCLUDED.missing_fields,
          reach_proxy = EXCLUDED.reach_proxy,
          monetization_readiness = EXCLUDED.monetization_readiness,
          verification_status = EXCLUDED.verification_status,
          assigned_owner = EXCLUDED.assigned_owner,
          notes = EXCLUDED.notes,
          dedupe_key = EXCLUDED.dedupe_key,
          score_breakdown = EXCLUDED.score_breakdown
      `,
      [
        parsed.agentId,
        parsed.dataOrigin,
        parsed.source,
        parsed.sourceType,
        parsed.sourceRef,
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
        parsed.discoveredAt,
        parsed.lastSeenAt,
        parsed.endpointUrl,
        parsed.contactRef,
        toJson(parsed.missingFields),
        parsed.reachProxy,
        parsed.monetizationReadiness,
        parsed.verificationStatus,
        parsed.assignedOwner,
        parsed.notes,
        parsed.dedupeKey,
        toJson(parsed.scoreBreakdown),
        parsed.discoveredAt,
      ],
    );
  }

  async assignLead(leadId: string, ownerId: string) {
    await this.pool.query(
      `
        UPDATE agent_leads
        SET assigned_owner = $2,
            last_seen_at = $3
        WHERE agent_id = $1
      `,
      [leadId, ownerId, new Date().toISOString()],
    );
    return this.getLead(leadId);
  }

  async updateLeadStatus(leadId: string, nextStatus: AgentLead["verificationStatus"], actorId: string, comment: string, checklist: VerificationChecklist) {
    const lead = await this.getLead(leadId);
    if (!lead) return null;
    const previousStatus = lead.verificationStatus;
    await this.pool.query(
      `
        UPDATE agent_leads
        SET verification_status = $2,
            last_seen_at = $3
        WHERE agent_id = $1
      `,
      [leadId, nextStatus, new Date().toISOString()],
    );
    await this.insertVerificationRecord(
      VerificationRecordSchema.parse({
        recordId: `verif_${Math.random().toString(36).slice(2, 10)}`,
        leadId,
        previousStatus,
        nextStatus,
        checklist,
        actorId,
        comment,
        occurredAt: new Date().toISOString(),
      }),
    );
    return this.getLead(leadId);
  }

  async listVerificationRecords(leadId: string) {
    const result = await this.pool.query(
      `
        SELECT record_id, lead_id, previous_status, next_status, checklist, actor_id, comment, occurred_at
        FROM verification_records
        WHERE lead_id = $1
        ORDER BY occurred_at DESC
      `,
      [leadId],
    );

    return result.rows.map((row) =>
      VerificationRecordSchema.parse({
        recordId: row.record_id,
        leadId: row.lead_id,
        previousStatus: row.previous_status,
        nextStatus: row.next_status,
        checklist: row.checklist,
        actorId: row.actor_id,
        comment: row.comment,
        occurredAt: row.occurred_at,
      }),
    );
  }

  async insertVerificationRecord(record: VerificationRecord) {
    const parsed = VerificationRecordSchema.parse(record);
    await this.pool.query(
      `
        INSERT INTO verification_records (
          record_id, lead_id, previous_status, next_status, checklist, actor_id, comment, occurred_at
        ) VALUES (
          $1, $2, $3, $4, $5::jsonb, $6, $7, $8
        )
        ON CONFLICT (record_id) DO UPDATE SET
          previous_status = EXCLUDED.previous_status,
          next_status = EXCLUDED.next_status,
          checklist = EXCLUDED.checklist,
          actor_id = EXCLUDED.actor_id,
          comment = EXCLUDED.comment,
          occurred_at = EXCLUDED.occurred_at
      `,
      [
        parsed.recordId,
        parsed.leadId,
        parsed.previousStatus,
        parsed.nextStatus,
        toJson(parsed.checklist),
        parsed.actorId,
        parsed.comment,
        parsed.occurredAt,
      ],
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

  async listEvidenceAssets() {
    const result = await this.pool.query(`
      SELECT asset_id, campaign_id, type, label, url, updated_at, verified_by, verification_note
      FROM evidence_assets
      ORDER BY updated_at DESC
    `);

    return result.rows.map((row) =>
      EvidenceAssetSchema.parse({
        assetId: row.asset_id,
        campaignId: row.campaign_id,
        type: row.type,
        label: row.label,
        url: row.url,
        updatedAt: row.updated_at,
        verifiedBy: row.verified_by,
        verificationNote: row.verification_note,
      }),
    );
  }

  async insertEvidenceAsset(asset: EvidenceAsset) {
    const parsed = EvidenceAssetSchema.parse(asset);
    await this.pool.query(
      `
        INSERT INTO evidence_assets (
          asset_id, campaign_id, type, label, url, updated_at, verified_by, verification_note
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        )
        ON CONFLICT (asset_id) DO UPDATE SET
          campaign_id = EXCLUDED.campaign_id,
          type = EXCLUDED.type,
          label = EXCLUDED.label,
          url = EXCLUDED.url,
          updated_at = EXCLUDED.updated_at,
          verified_by = EXCLUDED.verified_by,
          verification_note = EXCLUDED.verification_note
      `,
      [
        parsed.assetId,
        parsed.campaignId,
        parsed.type,
        parsed.label,
        parsed.url,
        parsed.updatedAt,
        parsed.verifiedBy,
        parsed.verificationNote,
      ],
    );
  }

  async listRiskCases(filter: Partial<{ status: string; severity: string; entityType: string; ownerId: string; dateFrom: string; dateTo: string; }> = {}) {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter.status) {
      values.push(filter.status);
      conditions.push(`status = $${values.length}`);
    }
    if (filter.severity) {
      values.push(filter.severity);
      conditions.push(`severity = $${values.length}`);
    }
    if (filter.entityType) {
      values.push(filter.entityType);
      conditions.push(`entity_type = $${values.length}`);
    }
    if (filter.ownerId) {
      values.push(filter.ownerId);
      conditions.push(`owner_id = $${values.length}`);
    }
    if (filter.dateFrom) {
      values.push(filter.dateFrom);
      conditions.push(`opened_at >= $${values.length}`);
    }
    if (filter.dateTo) {
      values.push(filter.dateTo);
      conditions.push(`opened_at <= $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.pool.query(`
      SELECT case_id, entity_type, entity_id, reason_type, severity, status, opened_at, resolved_at, owner_id, note
      FROM risk_cases
      ${whereClause}
      ORDER BY opened_at DESC
    `, values);

    return result.rows.map((row) =>
      RiskCaseSchema.parse({
        caseId: row.case_id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        reasonType: row.reason_type,
        severity: row.severity,
        status: row.status,
        openedAt: row.opened_at,
        resolvedAt: row.resolved_at,
        ownerId: row.owner_id,
        note: row.note,
      }),
    );
  }

  async getRiskCase(caseId: string) {
    const result = await this.pool.query(
      `
        SELECT case_id, entity_type, entity_id, reason_type, severity, status, opened_at, resolved_at, owner_id, note
        FROM risk_cases
        WHERE case_id = $1
      `,
      [caseId],
    );

    return result.rows[0]
      ? RiskCaseSchema.parse({
          caseId: result.rows[0].case_id,
          entityType: result.rows[0].entity_type,
          entityId: result.rows[0].entity_id,
          reasonType: result.rows[0].reason_type,
          severity: result.rows[0].severity,
          status: result.rows[0].status,
          openedAt: result.rows[0].opened_at,
          resolvedAt: result.rows[0].resolved_at,
          ownerId: result.rows[0].owner_id,
          note: result.rows[0].note,
        })
      : null;
  }

  async insertRiskCase(riskCase: RiskCase) {
    const parsed = RiskCaseSchema.parse(riskCase);
    await this.pool.query(
      `
        INSERT INTO risk_cases (
          case_id, entity_type, entity_id, reason_type, severity, status, opened_at, resolved_at, owner_id, note
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
        ON CONFLICT (case_id) DO UPDATE SET
          status = EXCLUDED.status,
          resolved_at = EXCLUDED.resolved_at,
          owner_id = EXCLUDED.owner_id,
          note = EXCLUDED.note
      `,
      [
        parsed.caseId,
        parsed.entityType,
        parsed.entityId,
        parsed.reasonType,
        parsed.severity,
        parsed.status,
        parsed.openedAt,
        parsed.resolvedAt,
        parsed.ownerId,
        parsed.note,
      ],
    );
  }

  async updateRiskCase(riskCase: RiskCase) {
    const parsed = RiskCaseSchema.parse(riskCase);
    await this.pool.query(
      `
        UPDATE risk_cases
        SET status = $2,
            resolved_at = $3,
            owner_id = $4,
            note = $5
        WHERE case_id = $1
      `,
      [
        parsed.caseId,
        parsed.status,
        parsed.resolvedAt,
        parsed.ownerId,
        parsed.note,
      ],
    );
  }

  async listReputationRecords() {
    const result = await this.pool.query(`
      SELECT record_id, partner_id, delta, reason_type, evidence_refs, dispute_status, occurred_at
      FROM reputation_records
      ORDER BY occurred_at DESC
    `);

    return result.rows.map((row) =>
      ReputationRecordSchema.parse({
        recordId: row.record_id,
        partnerId: row.partner_id,
        delta: row.delta,
        reasonType: row.reason_type,
        evidenceRefs: row.evidence_refs,
        disputeStatus: row.dispute_status,
        occurredAt: row.occurred_at,
      }),
    );
  }

  async getReputationRecord(recordId: string) {
    const result = await this.pool.query(
      `
        SELECT record_id, partner_id, delta, reason_type, evidence_refs, dispute_status, occurred_at
        FROM reputation_records
        WHERE record_id = $1
      `,
      [recordId],
    );

    return result.rows[0]
      ? ReputationRecordSchema.parse({
          recordId: result.rows[0].record_id,
          partnerId: result.rows[0].partner_id,
          delta: result.rows[0].delta,
          reasonType: result.rows[0].reason_type,
          evidenceRefs: result.rows[0].evidence_refs,
          disputeStatus: result.rows[0].dispute_status,
          occurredAt: result.rows[0].occurred_at,
        })
      : null;
  }

  async insertReputationRecord(record: ReputationRecord) {
    const parsed = ReputationRecordSchema.parse(record);
    await this.pool.query(
      `
        INSERT INTO reputation_records (
          record_id, partner_id, delta, reason_type, evidence_refs, dispute_status, occurred_at
        ) VALUES (
          $1, $2, $3, $4, $5::jsonb, $6, $7
        )
        ON CONFLICT (record_id) DO UPDATE SET
          delta = EXCLUDED.delta,
          reason_type = EXCLUDED.reason_type,
          evidence_refs = EXCLUDED.evidence_refs,
          dispute_status = EXCLUDED.dispute_status,
          occurred_at = EXCLUDED.occurred_at
      `,
      [
        parsed.recordId,
        parsed.partnerId,
        parsed.delta,
        parsed.reasonType,
        toJson(parsed.evidenceRefs),
        parsed.disputeStatus,
        parsed.occurredAt,
      ],
    );
  }

  async updateReputationRecord(record: ReputationRecord) {
    const parsed = ReputationRecordSchema.parse(record);
    await this.pool.query(
      `
        UPDATE reputation_records
        SET dispute_status = $2,
            evidence_refs = $3::jsonb
        WHERE record_id = $1
      `,
      [
        parsed.recordId,
        parsed.disputeStatus,
        toJson(parsed.evidenceRefs),
      ],
    );
  }

  async listAppeals() {
    const result = await this.pool.query(`
      SELECT appeal_id, partner_id, target_record_id, status, statement, opened_at, decided_at, decision_note
      FROM appeal_cases
      ORDER BY opened_at DESC
    `);

    return result.rows.map((row) =>
      AppealCaseSchema.parse({
        appealId: row.appeal_id,
        partnerId: row.partner_id,
        targetRecordId: row.target_record_id,
        status: row.status,
        statement: row.statement,
        openedAt: row.opened_at,
        decidedAt: row.decided_at,
        decisionNote: row.decision_note,
      }),
    );
  }

  async getAppeal(appealId: string) {
    const result = await this.pool.query(
      `
        SELECT appeal_id, partner_id, target_record_id, status, statement, opened_at, decided_at, decision_note
        FROM appeal_cases
        WHERE appeal_id = $1
      `,
      [appealId],
    );

    return result.rows[0]
      ? AppealCaseSchema.parse({
          appealId: result.rows[0].appeal_id,
          partnerId: result.rows[0].partner_id,
          targetRecordId: result.rows[0].target_record_id,
          status: result.rows[0].status,
          statement: result.rows[0].statement,
          openedAt: result.rows[0].opened_at,
          decidedAt: result.rows[0].decided_at,
          decisionNote: result.rows[0].decision_note,
        })
      : null;
  }

  async insertAppeal(appeal: AppealCase) {
    const parsed = AppealCaseSchema.parse(appeal);
    await this.pool.query(
      `
        INSERT INTO appeal_cases (
          appeal_id, partner_id, target_record_id, status, statement, opened_at, decided_at, decision_note
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        )
        ON CONFLICT (appeal_id) DO UPDATE SET
          status = EXCLUDED.status,
          decided_at = EXCLUDED.decided_at,
          decision_note = EXCLUDED.decision_note
      `,
      [
        parsed.appealId,
        parsed.partnerId,
        parsed.targetRecordId,
        parsed.status,
        parsed.statement,
        parsed.openedAt,
        parsed.decidedAt,
        parsed.decisionNote,
      ],
    );
  }

  async updateAppeal(appeal: AppealCase) {
    const parsed = AppealCaseSchema.parse(appeal);
    await this.pool.query(
      `
        UPDATE appeal_cases
        SET status = $2,
            decided_at = $3,
            decision_note = $4
        WHERE appeal_id = $1
      `,
      [
        parsed.appealId,
        parsed.status,
        parsed.decidedAt,
        parsed.decisionNote,
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

  async getMeasurementFunnel(query: MeasurementFunnelQuery) {
    const [receipts, campaigns, partners] = await Promise.all([
      this.listEventReceipts(),
      this.listCampaigns(),
      this.listPartners(),
    ]);
    return MeasurementFunnelSchema.parse(
      buildMeasurementFunnel(receipts, campaigns, partners, MeasurementFunnelQuerySchema.parse(query)),
    );
  }

  async getAttributionRows(query: MeasurementFunnelQuery) {
    const [receipts, settlements, campaigns] = await Promise.all([
      this.listEventReceipts(),
      this.listSettlements(),
      this.listCampaigns(),
    ]);
    return buildAttributionRows(receipts, settlements, campaigns, MeasurementFunnelQuerySchema.parse(query));
  }

  async getBillingDrafts() {
    const [settlements, campaigns] = await Promise.all([
      this.listSettlements(),
      this.listCampaigns(),
    ]);
    return buildBillingDrafts(settlements, campaigns);
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
    for (const source of seedData.discoverySources) {
      await this.pool.query(
        `
          INSERT INTO discovery_sources (
            source_id, source_type, name, base_url, seed_urls, active, crawl_policy, vertical_hints, geo_hints, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11
          )
          ON CONFLICT (source_id) DO UPDATE SET
            source_type = EXCLUDED.source_type,
            name = EXCLUDED.name,
            base_url = EXCLUDED.base_url,
            seed_urls = EXCLUDED.seed_urls,
            active = EXCLUDED.active,
            crawl_policy = EXCLUDED.crawl_policy,
            vertical_hints = EXCLUDED.vertical_hints,
            geo_hints = EXCLUDED.geo_hints,
            updated_at = EXCLUDED.updated_at
        `,
        [
          source.sourceId,
          source.sourceType,
          source.name,
          source.baseUrl,
          toJson(source.seedUrls),
          source.active,
          toJson(source.crawlPolicy),
          toJson(source.verticalHints),
          toJson(source.geoHints),
          source.createdAt,
          source.updatedAt,
        ],
      );
    }

    for (const lead of seedData.leads) {
      await this.upsertLead(lead);
    }

    for (const partner of seedData.partners) {
      await this.upsertPartner(partner);
    }

    for (const campaign of seedData.campaigns) {
      await this.upsertCampaign(campaign);
    }

    for (const record of seedData.verificationRecords) {
      await this.insertVerificationRecord(record);
    }

    for (const asset of seedData.evidenceAssets) {
      await this.insertEvidenceAsset(asset);
    }

    for (const riskCase of seedData.riskCases) {
      await this.insertRiskCase(riskCase);
    }

    for (const reputationRecord of seedData.reputationRecords) {
      await this.insertReputationRecord(reputationRecord);
    }

    for (const appeal of seedData.appeals) {
      await this.insertAppeal(appeal);
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
