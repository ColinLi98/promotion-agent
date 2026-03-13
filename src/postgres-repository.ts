import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { PROMOTION_PLANS } from "./commercialization.js";
import {
  AgentLeadSchema,
  AppealCaseSchema,
  AuditEventSchema,
  AuditEventPageSchema,
  BuyerAgentScorecardSchema,
  CampaignSchema,
  CreditLedgerEntrySchema,
  DiscoveryRunSchema,
  DiscoverySourceInputSchema,
  DiscoverySourceSchema,
  EvidenceAssetSchema,
  EventReceiptSchema,
  MeasurementFunnelQuerySchema,
  MeasurementFunnelSchema,
  OnboardingTaskSchema,
  OutreachTargetSchema,
  PartnerAgentSchema,
  PartnerReadinessSchema,
  PolicyCheckResultSchema,
  PromotionRunSchema,
  PromotionRunTargetSchema,
  RecruitmentPipelineSchema,
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
  type BuyerAgentScorecard,
  type Campaign,
  type CreditLedgerEntry,
  type DiscoveryRun,
  type DiscoverySource,
  type DiscoverySourceInput,
  type EvidenceAsset,
  type EventReceipt,
  type MeasurementFunnel,
  type MeasurementFunnelQuery,
  type OnboardingTask,
  type OutreachTarget,
  type PartnerAgent,
  type PartnerReadiness,
  type PolicyCheckResult,
  type PromotionRun,
  type PromotionRunTarget,
  type RecruitmentPipeline,
  type ReputationRecord,
  type RiskCase,
  type SettlementDeadLetterEntry,
  type SettlementDeadLetterFilter,
  type SettlementDeadLetterPage,
  type SettlementReceipt,
  type SettlementRetryJob,
  type SettlementRetryJobFilter,
  type PromotionPlan,
  type VerificationChecklist,
  type VerificationRecord,
  VerificationRecordSchema,
  type AttributionRow,
  type BillingDraft,
  type WorkspaceSubscription,
  WorkspaceSubscriptionSchema,
  type WorkspaceWallet,
  WorkspaceWalletSchema,
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
      SELECT agent_id, data_origin, data_provenance, source, source_type, source_ref, provider_org, card_url, verticals, skills, geo, auth_modes, accepts_sponsored,
             supports_disclosure, supports_delivery_receipt, supports_presentation_receipt, trust_seed, lead_score, discovered_at, last_seen_at, endpoint_url, contact_ref,
             missing_fields, reach_proxy, monetization_readiness, verification_status, last_verified_at, verification_owner, evidence_ref, assigned_owner, notes, dedupe_key, score_breakdown
      FROM agent_leads
      ORDER BY provider_org ASC
    `);

    return result.rows.map((row) =>
      AgentLeadSchema.parse({
        agentId: row.agent_id,
        dataOrigin: row.data_origin,
        dataProvenance: row.data_provenance,
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
        supportsDeliveryReceipt: row.supports_delivery_receipt ?? false,
        supportsPresentationReceipt: row.supports_presentation_receipt ?? false,
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
        lastVerifiedAt: row.last_verified_at,
        verificationOwner: row.verification_owner,
        evidenceRef: row.evidence_ref,
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
        SELECT agent_id, data_origin, data_provenance, source, source_type, source_ref, provider_org, card_url, verticals, skills, geo, auth_modes, accepts_sponsored,
               supports_disclosure, supports_delivery_receipt, supports_presentation_receipt, trust_seed, lead_score, discovered_at, last_seen_at, endpoint_url, contact_ref,
               missing_fields, reach_proxy, monetization_readiness, verification_status, last_verified_at, verification_owner, evidence_ref, assigned_owner, notes, dedupe_key, score_breakdown
        FROM agent_leads
        WHERE agent_id = $1
      `,
      [leadId],
    );

    return result.rows[0]
      ? AgentLeadSchema.parse({
          agentId: result.rows[0].agent_id,
          dataOrigin: result.rows[0].data_origin,
          dataProvenance: result.rows[0].data_provenance,
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
          supportsDeliveryReceipt: result.rows[0].supports_delivery_receipt ?? false,
          supportsPresentationReceipt: result.rows[0].supports_presentation_receipt ?? false,
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
          lastVerifiedAt: result.rows[0].last_verified_at,
          verificationOwner: result.rows[0].verification_owner,
          evidenceRef: result.rows[0].evidence_ref,
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
          agent_id, data_origin, data_provenance, source, source_type, source_ref, provider_org, card_url, verticals, skills, geo, auth_modes, accepts_sponsored,
          supports_disclosure, supports_delivery_receipt, supports_presentation_receipt, trust_seed, lead_score, discovered_at, last_seen_at, endpoint_url, contact_ref, missing_fields,
          reach_proxy, monetization_readiness, verification_status, last_verified_at, verification_owner, evidence_ref, assigned_owner, notes, dedupe_key, score_breakdown, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
          $23::jsonb, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33::jsonb, $34
        )
        ON CONFLICT (agent_id) DO UPDATE SET
          data_origin = EXCLUDED.data_origin,
          data_provenance = EXCLUDED.data_provenance,
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
          supports_delivery_receipt = EXCLUDED.supports_delivery_receipt,
          supports_presentation_receipt = EXCLUDED.supports_presentation_receipt,
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
          last_verified_at = EXCLUDED.last_verified_at,
          verification_owner = EXCLUDED.verification_owner,
          evidence_ref = EXCLUDED.evidence_ref,
          assigned_owner = EXCLUDED.assigned_owner,
          notes = EXCLUDED.notes,
          dedupe_key = EXCLUDED.dedupe_key,
          score_breakdown = EXCLUDED.score_breakdown
      `,
      [
        parsed.agentId,
        parsed.dataOrigin,
        parsed.dataProvenance,
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
        parsed.supportsDeliveryReceipt,
        parsed.supportsPresentationReceipt,
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
        parsed.lastVerifiedAt,
        parsed.verificationOwner,
        parsed.evidenceRef,
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

  async updateLeadStatus(leadId: string, nextStatus: AgentLead["verificationStatus"], actorId: string, comment: string, checklist: VerificationChecklist, evidenceRef?: string | null) {
    const lead = await this.getLead(leadId);
    if (!lead) return null;
    const previousStatus = lead.verificationStatus;
    const occurredAt = new Date().toISOString();
    const recordId = `verif_${Math.random().toString(36).slice(2, 10)}`;
    await this.pool.query(
      `
        UPDATE agent_leads
        SET verification_status = $2,
            last_seen_at = $3,
            last_verified_at = $3,
            verification_owner = $4,
            evidence_ref = $5
        WHERE agent_id = $1
      `,
      [leadId, nextStatus, occurredAt, actorId, evidenceRef?.trim() ? evidenceRef.trim() : lead.evidenceRef ?? `verification:${recordId}`],
    );
    await this.insertVerificationRecord(
      VerificationRecordSchema.parse({
        recordId,
        leadId,
        previousStatus,
        nextStatus,
        checklist,
        actorId,
        comment,
        occurredAt,
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
      SELECT partner_id, agent_lead_id, data_provenance, provider_org, endpoint, status, supported_categories, accepts_sponsored,
             supports_disclosure, supports_delivery_receipt, supports_presentation_receipt, last_verified_at, verification_owner, evidence_ref, trust_score, auth_modes, sla_tier, buyer_intent_coverage, icp_overlap_score, intent_access_score,
             delivery_readiness_score, historical_quality_score, commercial_readiness_score, buyer_agent_score, buyer_agent_tier,
             is_qualified_buyer_agent, is_commercially_eligible
      FROM partner_agents
      ORDER BY provider_org ASC
    `);

    return result.rows.map((row) =>
      PartnerAgentSchema.parse({
        partnerId: row.partner_id,
        agentLeadId: row.agent_lead_id,
        dataProvenance: row.data_provenance,
        providerOrg: row.provider_org,
        endpoint: row.endpoint,
        status: row.status,
        supportedCategories: row.supported_categories,
        acceptsSponsored: row.accepts_sponsored,
        supportsDisclosure: row.supports_disclosure,
        supportsDeliveryReceipt: row.supports_delivery_receipt ?? false,
        supportsPresentationReceipt: row.supports_presentation_receipt ?? false,
        lastVerifiedAt: row.last_verified_at,
        verificationOwner: row.verification_owner,
        evidenceRef: row.evidence_ref,
        trustScore: row.trust_score,
        authModes: row.auth_modes,
        slaTier: row.sla_tier,
        buyerIntentCoverage: row.buyer_intent_coverage ?? [],
        icpOverlapScore: row.icp_overlap_score ?? 0,
        intentAccessScore: row.intent_access_score ?? 0,
        deliveryReadinessScore: row.delivery_readiness_score ?? 0,
        historicalQualityScore: row.historical_quality_score ?? 0,
        commercialReadinessScore: row.commercial_readiness_score ?? 0,
        buyerAgentScore: row.buyer_agent_score ?? 0,
        buyerAgentTier: row.buyer_agent_tier ?? "unqualified",
        isQualifiedBuyerAgent: row.is_qualified_buyer_agent ?? false,
        isCommerciallyEligible: row.is_commercially_eligible ?? false,
      }),
    );
  }

  async listCampaigns() {
    const result = await this.pool.query(`
      SELECT campaign_id, data_provenance, workspace_id, promotion_plan_id, advertiser, external_ref, source_document_url, category, regions, targeting_partner_ids, billing_model, payout_amount, currency,
             budget, status, disclosure_text, policy_pass, min_trust, link_bundle, offer, proof_bundle
      FROM campaigns
      ORDER BY advertiser ASC
    `);

    return result.rows.map((row) => this.mapCampaign(row));
  }

  async getCampaign(campaignId: string) {
    const result = await this.pool.query(
      `
        SELECT campaign_id, data_provenance, workspace_id, promotion_plan_id, advertiser, external_ref, source_document_url, category, regions, targeting_partner_ids, billing_model, payout_amount, currency,
               budget, status, disclosure_text, policy_pass, min_trust, link_bundle, offer, proof_bundle
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
          campaign_id, data_provenance, workspace_id, promotion_plan_id, advertiser, external_ref, source_document_url, category, regions, targeting_partner_ids, billing_model, payout_amount, currency,
          budget, status, disclosure_text, policy_pass, min_trust, link_bundle, offer, proof_bundle, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20::jsonb, $21::jsonb, $22, $22
        )
        ON CONFLICT (campaign_id) DO UPDATE SET
          data_provenance = EXCLUDED.data_provenance,
          workspace_id = EXCLUDED.workspace_id,
          promotion_plan_id = EXCLUDED.promotion_plan_id,
          advertiser = EXCLUDED.advertiser,
          external_ref = EXCLUDED.external_ref,
          source_document_url = EXCLUDED.source_document_url,
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
          link_bundle = EXCLUDED.link_bundle,
          offer = EXCLUDED.offer,
          proof_bundle = EXCLUDED.proof_bundle,
          updated_at = EXCLUDED.updated_at
      `,
      [
        parsed.campaignId,
        parsed.dataProvenance,
        parsed.workspaceId,
        parsed.promotionPlanId,
        parsed.advertiser,
        parsed.externalRef,
        parsed.sourceDocumentUrl,
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
        toJson(parsed.linkBundle),
        toJson(parsed.offer),
        toJson(parsed.proofBundle),
        new Date().toISOString(),
      ],
    );
  }

  async listEvidenceAssets() {
    const result = await this.pool.query(`
      SELECT asset_id, data_provenance, campaign_id, type, label, url, updated_at, verified_by, verification_note
      FROM evidence_assets
      ORDER BY updated_at DESC
    `);

    return result.rows.map((row) =>
      EvidenceAssetSchema.parse({
        assetId: row.asset_id,
        dataProvenance: row.data_provenance,
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
          asset_id, data_provenance, campaign_id, type, label, url, updated_at, verified_by, verification_note
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9
        )
        ON CONFLICT (asset_id) DO UPDATE SET
          data_provenance = EXCLUDED.data_provenance,
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
        parsed.dataProvenance,
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

  async listRiskCases(filter: Partial<{ status: string; severity: string; entityType: string; ownerId: string; dateFrom: string; dateTo: string; provenance: string; }> = {}) {
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
    if (filter.provenance) {
      values.push(filter.provenance);
      conditions.push(`data_provenance = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.pool.query(`
      SELECT case_id, data_provenance, entity_type, entity_id, entity_provenance, reason_type, severity, status, opened_at, resolved_at, owner_id, note
      FROM risk_cases
      ${whereClause}
      ORDER BY opened_at DESC
    `, values);

    return result.rows.map((row) =>
      RiskCaseSchema.parse({
        caseId: row.case_id,
        dataProvenance: row.data_provenance,
        entityType: row.entity_type,
        entityId: row.entity_id,
        entityProvenance: row.entity_provenance,
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
        SELECT case_id, data_provenance, entity_type, entity_id, entity_provenance, reason_type, severity, status, opened_at, resolved_at, owner_id, note
        FROM risk_cases
        WHERE case_id = $1
      `,
      [caseId],
    );

    return result.rows[0]
      ? RiskCaseSchema.parse({
          caseId: result.rows[0].case_id,
          dataProvenance: result.rows[0].data_provenance,
          entityType: result.rows[0].entity_type,
          entityId: result.rows[0].entity_id,
          entityProvenance: result.rows[0].entity_provenance,
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
          case_id, data_provenance, entity_type, entity_id, entity_provenance, reason_type, severity, status, opened_at, resolved_at, owner_id, note
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        )
        ON CONFLICT (case_id) DO UPDATE SET
          data_provenance = EXCLUDED.data_provenance,
          entity_provenance = EXCLUDED.entity_provenance,
          status = EXCLUDED.status,
          resolved_at = EXCLUDED.resolved_at,
          owner_id = EXCLUDED.owner_id,
          note = EXCLUDED.note
      `,
      [
        parsed.caseId,
        parsed.dataProvenance,
        parsed.entityType,
        parsed.entityId,
        parsed.entityProvenance,
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
        SET data_provenance = $2,
            entity_provenance = $3,
            status = $4,
            resolved_at = $5,
            owner_id = $6,
            note = $7
        WHERE case_id = $1
      `,
      [
        parsed.caseId,
        parsed.dataProvenance,
        parsed.entityProvenance,
        parsed.status,
        parsed.resolvedAt,
        parsed.ownerId,
        parsed.note,
      ],
    );
  }

  async listReputationRecords() {
    const result = await this.pool.query(`
      SELECT record_id, data_provenance, partner_id, delta, reason_type, evidence_refs, dispute_status, occurred_at
      FROM reputation_records
      ORDER BY occurred_at DESC
    `);

    return result.rows.map((row) =>
      ReputationRecordSchema.parse({
        recordId: row.record_id,
        dataProvenance: row.data_provenance,
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
        SELECT record_id, data_provenance, partner_id, delta, reason_type, evidence_refs, dispute_status, occurred_at
        FROM reputation_records
        WHERE record_id = $1
      `,
      [recordId],
    );

    return result.rows[0]
      ? ReputationRecordSchema.parse({
          recordId: result.rows[0].record_id,
          dataProvenance: result.rows[0].data_provenance,
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
          record_id, data_provenance, partner_id, delta, reason_type, evidence_refs, dispute_status, occurred_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6::jsonb, $7, $8
        )
        ON CONFLICT (record_id) DO UPDATE SET
          data_provenance = EXCLUDED.data_provenance,
          delta = EXCLUDED.delta,
          reason_type = EXCLUDED.reason_type,
          evidence_refs = EXCLUDED.evidence_refs,
          dispute_status = EXCLUDED.dispute_status,
          occurred_at = EXCLUDED.occurred_at
      `,
      [
        parsed.recordId,
        parsed.dataProvenance,
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
        SET data_provenance = $2,
            dispute_status = $3,
            evidence_refs = $4::jsonb
        WHERE record_id = $1
      `,
      [
        parsed.recordId,
        parsed.dataProvenance,
        parsed.disputeStatus,
        toJson(parsed.evidenceRefs),
      ],
    );
  }

  async listAppeals() {
    const result = await this.pool.query(`
      SELECT appeal_id, data_provenance, partner_id, target_record_id, target_record_provenance, status, statement, opened_at, decided_at, decision_note
      FROM appeal_cases
      ORDER BY opened_at DESC
    `);

    return result.rows.map((row) =>
      AppealCaseSchema.parse({
        appealId: row.appeal_id,
        dataProvenance: row.data_provenance,
        partnerId: row.partner_id,
        targetRecordId: row.target_record_id,
        targetRecordProvenance: row.target_record_provenance,
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
        SELECT appeal_id, data_provenance, partner_id, target_record_id, target_record_provenance, status, statement, opened_at, decided_at, decision_note
        FROM appeal_cases
        WHERE appeal_id = $1
      `,
      [appealId],
    );

    return result.rows[0]
      ? AppealCaseSchema.parse({
          appealId: result.rows[0].appeal_id,
          dataProvenance: result.rows[0].data_provenance,
          partnerId: result.rows[0].partner_id,
          targetRecordId: result.rows[0].target_record_id,
          targetRecordProvenance: result.rows[0].target_record_provenance,
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
          appeal_id, data_provenance, partner_id, target_record_id, target_record_provenance, status, statement, opened_at, decided_at, decision_note
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
        ON CONFLICT (appeal_id) DO UPDATE SET
          data_provenance = EXCLUDED.data_provenance,
          target_record_provenance = EXCLUDED.target_record_provenance,
          status = EXCLUDED.status,
          decided_at = EXCLUDED.decided_at,
          decision_note = EXCLUDED.decision_note
      `,
      [
        parsed.appealId,
        parsed.dataProvenance,
        parsed.partnerId,
        parsed.targetRecordId,
        parsed.targetRecordProvenance,
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
        SET data_provenance = $2,
            target_record_provenance = $3,
            status = $4,
            decided_at = $5,
            decision_note = $6
        WHERE appeal_id = $1
      `,
      [
        parsed.appealId,
        parsed.dataProvenance,
        parsed.targetRecordProvenance,
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

  async listBuyerAgentScorecards() {
    const result = await this.pool.query(`
      SELECT scorecard_id, lead_id, partner_id, provider_org, data_provenance, buyer_intent_coverage,
             icp_overlap_score, intent_access_score, delivery_readiness_score, historical_quality_score,
             commercial_readiness_score, buyer_agent_score, buyer_agent_tier, is_qualified_buyer_agent,
             is_commercially_eligible, verification_status, supports_disclosure, accepts_sponsored,
             supports_delivery_receipt, supports_presentation_receipt, last_verified_at, verification_owner, evidence_ref, endpoint_url, updated_at
      FROM buyer_agent_scorecards
      ORDER BY buyer_agent_tier ASC, buyer_agent_score DESC
    `);

    return result.rows.map((row) =>
      BuyerAgentScorecardSchema.parse({
        scorecardId: row.scorecard_id,
        leadId: row.lead_id,
        partnerId: row.partner_id,
        providerOrg: row.provider_org,
        dataProvenance: row.data_provenance,
        buyerIntentCoverage: row.buyer_intent_coverage,
        icpOverlapScore: row.icp_overlap_score,
        intentAccessScore: row.intent_access_score,
        deliveryReadinessScore: row.delivery_readiness_score,
        historicalQualityScore: row.historical_quality_score,
        commercialReadinessScore: row.commercial_readiness_score,
        buyerAgentScore: row.buyer_agent_score,
        buyerAgentTier: row.buyer_agent_tier,
        isQualifiedBuyerAgent: row.is_qualified_buyer_agent,
        isCommerciallyEligible: row.is_commercially_eligible,
        verificationStatus: row.verification_status,
        supportsDisclosure: row.supports_disclosure,
        acceptsSponsored: row.accepts_sponsored,
        supportsDeliveryReceipt: row.supports_delivery_receipt ?? false,
        supportsPresentationReceipt: row.supports_presentation_receipt ?? false,
        lastVerifiedAt: row.last_verified_at,
        verificationOwner: row.verification_owner,
        evidenceRef: row.evidence_ref,
        endpointUrl: row.endpoint_url,
        updatedAt: row.updated_at,
      }),
    );
  }

  async replaceBuyerAgentScorecards(scorecards: BuyerAgentScorecard[]) {
    await this.pool.query(`DELETE FROM buyer_agent_scorecards`);
    for (const scorecard of scorecards) {
      const parsed = BuyerAgentScorecardSchema.parse(scorecard);
      await this.pool.query(
        `
          INSERT INTO buyer_agent_scorecards (
            scorecard_id, lead_id, partner_id, provider_org, data_provenance, buyer_intent_coverage,
            icp_overlap_score, intent_access_score, delivery_readiness_score, historical_quality_score,
            commercial_readiness_score, buyer_agent_score, buyer_agent_tier, is_qualified_buyer_agent,
            is_commercially_eligible, verification_status, supports_disclosure, accepts_sponsored,
            supports_delivery_receipt, supports_presentation_receipt, last_verified_at, verification_owner, evidence_ref, endpoint_url, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
          )
        `,
        [
          parsed.scorecardId,
          parsed.leadId,
          parsed.partnerId,
          parsed.providerOrg,
          parsed.dataProvenance,
          toJson(parsed.buyerIntentCoverage),
          parsed.icpOverlapScore,
          parsed.intentAccessScore,
          parsed.deliveryReadinessScore,
          parsed.historicalQualityScore,
          parsed.commercialReadinessScore,
          parsed.buyerAgentScore,
          parsed.buyerAgentTier,
          parsed.isQualifiedBuyerAgent,
          parsed.isCommerciallyEligible,
          parsed.verificationStatus,
          parsed.supportsDisclosure,
          parsed.acceptsSponsored,
          parsed.supportsDeliveryReceipt,
          parsed.supportsPresentationReceipt,
          parsed.lastVerifiedAt,
          parsed.verificationOwner,
          parsed.evidenceRef,
          parsed.endpointUrl,
          parsed.updatedAt,
        ],
      );
    }
  }

  async getWorkspaceWallet(workspaceId: string) {
    const result = await this.pool.query(
      `
        SELECT workspace_id, available_credits, reserved_credits, consumed_credits, expired_credits, updated_at
        FROM workspace_wallets
        WHERE workspace_id = $1
      `,
      [workspaceId],
    );
    return result.rows[0]
      ? WorkspaceWalletSchema.parse({
          workspaceId: result.rows[0].workspace_id,
          availableCredits: result.rows[0].available_credits,
          reservedCredits: result.rows[0].reserved_credits,
          consumedCredits: result.rows[0].consumed_credits,
          expiredCredits: result.rows[0].expired_credits,
          updatedAt: result.rows[0].updated_at,
        })
      : null;
  }

  async upsertWorkspaceWallet(wallet: WorkspaceWallet) {
    const parsed = WorkspaceWalletSchema.parse(wallet);
    await this.pool.query(
      `
        INSERT INTO workspace_wallets (
          workspace_id, available_credits, reserved_credits, consumed_credits, expired_credits, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (workspace_id) DO UPDATE SET
          available_credits = EXCLUDED.available_credits,
          reserved_credits = EXCLUDED.reserved_credits,
          consumed_credits = EXCLUDED.consumed_credits,
          expired_credits = EXCLUDED.expired_credits,
          updated_at = EXCLUDED.updated_at
      `,
      [
        parsed.workspaceId,
        parsed.availableCredits,
        parsed.reservedCredits,
        parsed.consumedCredits,
        parsed.expiredCredits,
        parsed.updatedAt,
      ],
    );
  }

  async listCreditLedgerEntries(workspaceId: string) {
    const result = await this.pool.query(
      `
        SELECT entry_id, workspace_id, entry_type, amount, balance_after, source, campaign_id, promotion_run_id, occurred_at
        FROM credit_ledger_entries
        WHERE workspace_id = $1
        ORDER BY occurred_at DESC, entry_id DESC
      `,
      [workspaceId],
    );
    return result.rows.map((row) =>
      CreditLedgerEntrySchema.parse({
        entryId: row.entry_id,
        workspaceId: row.workspace_id,
        entryType: row.entry_type,
        amount: row.amount,
        balanceAfter: row.balance_after,
        source: row.source,
        campaignId: row.campaign_id,
        promotionRunId: row.promotion_run_id,
        occurredAt: row.occurred_at,
      }),
    );
  }

  async insertCreditLedgerEntry(entry: CreditLedgerEntry) {
    const parsed = CreditLedgerEntrySchema.parse(entry);
    await this.pool.query(
      `
        INSERT INTO credit_ledger_entries (
          entry_id, workspace_id, entry_type, amount, balance_after, source, campaign_id, promotion_run_id, occurred_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        parsed.entryId,
        parsed.workspaceId,
        parsed.entryType,
        parsed.amount,
        parsed.balanceAfter,
        parsed.source,
        parsed.campaignId,
        parsed.promotionRunId,
        parsed.occurredAt,
      ],
    );
  }

  async getWorkspaceSubscription(workspaceId: string) {
    const result = await this.pool.query(
      `
        SELECT workspace_id, plan_id, status, included_credits_per_cycle, cycle_start_at, cycle_end_at
        FROM workspace_subscriptions
        WHERE workspace_id = $1
      `,
      [workspaceId],
    );
    return result.rows[0]
      ? WorkspaceSubscriptionSchema.parse({
          workspaceId: result.rows[0].workspace_id,
          planId: result.rows[0].plan_id,
          status: result.rows[0].status,
          includedCreditsPerCycle: result.rows[0].included_credits_per_cycle,
          cycleStartAt: result.rows[0].cycle_start_at,
          cycleEndAt: result.rows[0].cycle_end_at,
        })
      : null;
  }

  async upsertWorkspaceSubscription(subscription: WorkspaceSubscription) {
    const parsed = WorkspaceSubscriptionSchema.parse(subscription);
    await this.pool.query(
      `
        INSERT INTO workspace_subscriptions (
          workspace_id, plan_id, status, included_credits_per_cycle, cycle_start_at, cycle_end_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (workspace_id) DO UPDATE SET
          plan_id = EXCLUDED.plan_id,
          status = EXCLUDED.status,
          included_credits_per_cycle = EXCLUDED.included_credits_per_cycle,
          cycle_start_at = EXCLUDED.cycle_start_at,
          cycle_end_at = EXCLUDED.cycle_end_at
      `,
      [
        parsed.workspaceId,
        parsed.planId,
        parsed.status,
        parsed.includedCreditsPerCycle,
        parsed.cycleStartAt,
        parsed.cycleEndAt,
      ],
    );
  }

  async listPromotionPlans(): Promise<PromotionPlan[]> {
    return [...PROMOTION_PLANS];
  }

  async listPromotionRuns(workspaceId?: string) {
    const result = await this.pool.query(
      `
        SELECT promotion_run_id, workspace_id, campaign_id, plan_id, status, requested_category, task_type,
               constraints, qualified_buyer_agents_count, coverage_credits_charged,
               accepted_buyer_agents_count, failed_buyer_agents_count, shortlisted_count,
               handoff_count, conversion_count, selected_partner_ids, created_at, updated_at
        FROM promotion_runs
        ${workspaceId ? "WHERE workspace_id = $1" : ""}
        ORDER BY created_at DESC, promotion_run_id DESC
      `,
      workspaceId ? [workspaceId] : [],
    );
    return result.rows.map((row) => this.mapPromotionRun(row));
  }

  async getPromotionRun(promotionRunId: string) {
    const result = await this.pool.query(
      `
        SELECT promotion_run_id, workspace_id, campaign_id, plan_id, status, requested_category, task_type,
               constraints, qualified_buyer_agents_count, coverage_credits_charged,
               accepted_buyer_agents_count, failed_buyer_agents_count, shortlisted_count,
               handoff_count, conversion_count, selected_partner_ids, created_at, updated_at
        FROM promotion_runs
        WHERE promotion_run_id = $1
      `,
      [promotionRunId],
    );
    return result.rows[0] ? this.mapPromotionRun(result.rows[0]) : null;
  }

  async upsertPromotionRun(run: PromotionRun) {
    const parsed = PromotionRunSchema.parse(run);
    await this.pool.query(
      `
        INSERT INTO promotion_runs (
          promotion_run_id, workspace_id, campaign_id, plan_id, status, requested_category, task_type,
          constraints, qualified_buyer_agents_count, coverage_credits_charged,
          accepted_buyer_agents_count, failed_buyer_agents_count, shortlisted_count,
          handoff_count, conversion_count, selected_partner_ids, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18
        )
        ON CONFLICT (promotion_run_id) DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          campaign_id = EXCLUDED.campaign_id,
          plan_id = EXCLUDED.plan_id,
          status = EXCLUDED.status,
          requested_category = EXCLUDED.requested_category,
          task_type = EXCLUDED.task_type,
          constraints = EXCLUDED.constraints,
          qualified_buyer_agents_count = EXCLUDED.qualified_buyer_agents_count,
          coverage_credits_charged = EXCLUDED.coverage_credits_charged,
          accepted_buyer_agents_count = EXCLUDED.accepted_buyer_agents_count,
          failed_buyer_agents_count = EXCLUDED.failed_buyer_agents_count,
          shortlisted_count = EXCLUDED.shortlisted_count,
          handoff_count = EXCLUDED.handoff_count,
          conversion_count = EXCLUDED.conversion_count,
          selected_partner_ids = EXCLUDED.selected_partner_ids,
          updated_at = EXCLUDED.updated_at
      `,
      [
        parsed.promotionRunId,
        parsed.workspaceId,
        parsed.campaignId,
        parsed.planId,
        parsed.status,
        parsed.requestedCategory,
        parsed.taskType,
        toJson(parsed.constraints),
        parsed.qualifiedBuyerAgentsCount,
        parsed.coverageCreditsCharged,
        parsed.acceptedBuyerAgentsCount,
        parsed.failedBuyerAgentsCount,
        parsed.shortlistedCount,
        parsed.handoffCount,
        parsed.conversionCount,
        toJson(parsed.selectedPartnerIds),
        parsed.createdAt,
        parsed.updatedAt,
      ],
    );
  }

  async listPromotionRunTargets(promotionRunId: string) {
    const result = await this.pool.query(
      `
        SELECT target_id, promotion_run_id, workspace_id, campaign_id, partner_id, provider_org, endpoint_url,
               buyer_agent_tier, buyer_agent_score, delivery_readiness_score, status, supported_categories,
               last_attempt_at, dispatch_attempts, cooldown_until, next_retry_at, protocol, remote_request_id,
               response_code, last_error, accepted_at, created_at, updated_at
        FROM promotion_run_targets
        WHERE promotion_run_id = $1
        ORDER BY created_at ASC, target_id ASC
      `,
      [promotionRunId],
    );
    return result.rows.map((row) => this.mapPromotionRunTarget(row));
  }

  async upsertPromotionRunTarget(target: PromotionRunTarget) {
    const parsed = PromotionRunTargetSchema.parse(target);
    await this.pool.query(
      `
        INSERT INTO promotion_run_targets (
          target_id, promotion_run_id, workspace_id, campaign_id, partner_id, provider_org, endpoint_url,
          buyer_agent_tier, buyer_agent_score, delivery_readiness_score, status, supported_categories,
          last_attempt_at, dispatch_attempts, cooldown_until, next_retry_at, protocol, remote_request_id,
          response_code, last_error, accepted_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12::jsonb,
          $13, $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23
        )
        ON CONFLICT (target_id) DO UPDATE SET
          promotion_run_id = EXCLUDED.promotion_run_id,
          workspace_id = EXCLUDED.workspace_id,
          campaign_id = EXCLUDED.campaign_id,
          partner_id = EXCLUDED.partner_id,
          provider_org = EXCLUDED.provider_org,
          endpoint_url = EXCLUDED.endpoint_url,
          buyer_agent_tier = EXCLUDED.buyer_agent_tier,
          buyer_agent_score = EXCLUDED.buyer_agent_score,
          delivery_readiness_score = EXCLUDED.delivery_readiness_score,
          status = EXCLUDED.status,
          supported_categories = EXCLUDED.supported_categories,
          last_attempt_at = EXCLUDED.last_attempt_at,
          dispatch_attempts = EXCLUDED.dispatch_attempts,
          cooldown_until = EXCLUDED.cooldown_until,
          next_retry_at = EXCLUDED.next_retry_at,
          protocol = EXCLUDED.protocol,
          remote_request_id = EXCLUDED.remote_request_id,
          response_code = EXCLUDED.response_code,
          last_error = EXCLUDED.last_error,
          accepted_at = EXCLUDED.accepted_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        parsed.targetId,
        parsed.promotionRunId,
        parsed.workspaceId,
        parsed.campaignId,
        parsed.partnerId,
        parsed.providerOrg,
        parsed.endpointUrl,
        parsed.buyerAgentTier,
        parsed.buyerAgentScore,
        parsed.deliveryReadinessScore,
        parsed.status,
        toJson(parsed.supportedCategories),
        parsed.lastAttemptAt,
        parsed.dispatchAttempts,
        parsed.cooldownUntil,
        parsed.nextRetryAt,
        parsed.protocol,
        parsed.remoteRequestId,
        parsed.responseCode,
        parsed.lastError,
        parsed.acceptedAt,
        parsed.createdAt,
        parsed.updatedAt,
      ],
    );
  }

  async listRecruitmentPipelines() {
    const result = await this.pool.query(`
      SELECT pipeline_id, lead_id, data_provenance, provider_org, stage, priority, owner_id, target_persona,
             next_step, last_contact_at, last_activity_at, created_at, updated_at
      FROM recruitment_pipelines
      ORDER BY updated_at DESC, pipeline_id DESC
    `);
    return result.rows.map((row) =>
      RecruitmentPipelineSchema.parse({
        pipelineId: row.pipeline_id,
        leadId: row.lead_id,
        dataProvenance: row.data_provenance,
        providerOrg: row.provider_org,
        stage: row.stage,
        priority: row.priority,
        ownerId: row.owner_id,
        targetPersona: row.target_persona,
        nextStep: row.next_step,
        lastContactAt: row.last_contact_at,
        lastActivityAt: row.last_activity_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    );
  }

  async getRecruitmentPipeline(pipelineId: string) {
    const result = await this.pool.query(
      `
        SELECT pipeline_id, lead_id, data_provenance, provider_org, stage, priority, owner_id, target_persona,
               next_step, last_contact_at, last_activity_at, created_at, updated_at
        FROM recruitment_pipelines
        WHERE pipeline_id = $1
      `,
      [pipelineId],
    );
    return result.rows[0]
      ? RecruitmentPipelineSchema.parse({
          pipelineId: result.rows[0].pipeline_id,
          leadId: result.rows[0].lead_id,
          dataProvenance: result.rows[0].data_provenance,
          providerOrg: result.rows[0].provider_org,
          stage: result.rows[0].stage,
          priority: result.rows[0].priority,
          ownerId: result.rows[0].owner_id,
          targetPersona: result.rows[0].target_persona,
          nextStep: result.rows[0].next_step,
          lastContactAt: result.rows[0].last_contact_at,
          lastActivityAt: result.rows[0].last_activity_at,
          createdAt: result.rows[0].created_at,
          updatedAt: result.rows[0].updated_at,
        })
      : null;
  }

  async upsertRecruitmentPipeline(pipeline: RecruitmentPipeline) {
    const parsed = RecruitmentPipelineSchema.parse(pipeline);
    await this.pool.query(
      `
        INSERT INTO recruitment_pipelines (
          pipeline_id, lead_id, data_provenance, provider_org, stage, priority, owner_id, target_persona,
          next_step, last_contact_at, last_activity_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )
        ON CONFLICT (lead_id) DO UPDATE SET
          pipeline_id = EXCLUDED.pipeline_id,
          data_provenance = EXCLUDED.data_provenance,
          provider_org = EXCLUDED.provider_org,
          stage = EXCLUDED.stage,
          priority = EXCLUDED.priority,
          owner_id = EXCLUDED.owner_id,
          target_persona = EXCLUDED.target_persona,
          next_step = EXCLUDED.next_step,
          last_contact_at = EXCLUDED.last_contact_at,
          last_activity_at = EXCLUDED.last_activity_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        parsed.pipelineId,
        parsed.leadId,
        parsed.dataProvenance,
        parsed.providerOrg,
        parsed.stage,
        parsed.priority,
        parsed.ownerId,
        parsed.targetPersona,
        parsed.nextStep,
        parsed.lastContactAt,
        parsed.lastActivityAt,
        parsed.createdAt,
        parsed.updatedAt,
      ],
    );
  }

  async listOutreachTargets(pipelineId: string) {
    const result = await this.pool.query(
      `
        SELECT target_id, pipeline_id, lead_id, provider_org, recommended_campaign_id, channel, contact_point, subject_line, message_template,
               recommendation_reason, proof_highlights, auto_generated, status, owner_id, send_attempts, last_attempt_at, next_retry_at,
               provider_request_id, response_code, open_count, first_opened_at, last_opened_at, open_signal, last_open_source, last_error,
               last_sent_at, response_at, notes, created_at, updated_at
        FROM outreach_targets
        WHERE pipeline_id = $1
        ORDER BY updated_at DESC, target_id DESC
      `,
      [pipelineId],
    );
    return result.rows.map((row) =>
      OutreachTargetSchema.parse({
        targetId: row.target_id,
        pipelineId: row.pipeline_id,
        leadId: row.lead_id,
        providerOrg: row.provider_org,
        recommendedCampaignId: row.recommended_campaign_id,
        channel: row.channel,
        contactPoint: row.contact_point,
        subjectLine: row.subject_line,
        messageTemplate: row.message_template,
        recommendationReason: row.recommendation_reason,
        proofHighlights: row.proof_highlights ?? [],
        autoGenerated: row.auto_generated ?? false,
        status: row.status,
        ownerId: row.owner_id,
        sendAttempts: row.send_attempts ?? 0,
        lastAttemptAt: row.last_attempt_at,
        nextRetryAt: row.next_retry_at,
        providerRequestId: row.provider_request_id,
        responseCode: row.response_code,
        openCount: row.open_count ?? 0,
        firstOpenedAt: row.first_opened_at,
        lastOpenedAt: row.last_opened_at,
        openSignal: row.open_signal ?? "none",
        lastOpenSource: row.last_open_source,
        lastError: row.last_error,
        lastSentAt: row.last_sent_at,
        responseAt: row.response_at,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    );
  }

  async getOutreachTarget(targetId: string) {
    const result = await this.pool.query(
      `
        SELECT target_id, pipeline_id, lead_id, provider_org, recommended_campaign_id, channel, contact_point, subject_line, message_template,
               recommendation_reason, proof_highlights, auto_generated, status, owner_id, send_attempts, last_attempt_at, next_retry_at,
               provider_request_id, response_code, open_count, first_opened_at, last_opened_at, open_signal, last_open_source, last_error,
               last_sent_at, response_at, notes, created_at, updated_at
        FROM outreach_targets
        WHERE target_id = $1
      `,
      [targetId],
    );
    return result.rows[0]
      ? OutreachTargetSchema.parse({
          targetId: result.rows[0].target_id,
          pipelineId: result.rows[0].pipeline_id,
          leadId: result.rows[0].lead_id,
          providerOrg: result.rows[0].provider_org,
          recommendedCampaignId: result.rows[0].recommended_campaign_id,
          channel: result.rows[0].channel,
          contactPoint: result.rows[0].contact_point,
          subjectLine: result.rows[0].subject_line,
          messageTemplate: result.rows[0].message_template,
          recommendationReason: result.rows[0].recommendation_reason,
          proofHighlights: result.rows[0].proof_highlights ?? [],
          autoGenerated: result.rows[0].auto_generated ?? false,
          status: result.rows[0].status,
          ownerId: result.rows[0].owner_id,
          sendAttempts: result.rows[0].send_attempts ?? 0,
          lastAttemptAt: result.rows[0].last_attempt_at,
          nextRetryAt: result.rows[0].next_retry_at,
          providerRequestId: result.rows[0].provider_request_id,
          responseCode: result.rows[0].response_code,
          openCount: result.rows[0].open_count ?? 0,
          firstOpenedAt: result.rows[0].first_opened_at,
          lastOpenedAt: result.rows[0].last_opened_at,
          openSignal: result.rows[0].open_signal ?? "none",
          lastOpenSource: result.rows[0].last_open_source,
          lastError: result.rows[0].last_error,
          lastSentAt: result.rows[0].last_sent_at,
          responseAt: result.rows[0].response_at,
          notes: result.rows[0].notes,
          createdAt: result.rows[0].created_at,
          updatedAt: result.rows[0].updated_at,
        })
      : null;
  }

  async upsertOutreachTarget(target: OutreachTarget) {
    const parsed = OutreachTargetSchema.parse(target);
    await this.pool.query(
      `
        INSERT INTO outreach_targets (
          target_id, pipeline_id, lead_id, provider_org, recommended_campaign_id, channel, contact_point, subject_line, message_template,
          recommendation_reason, proof_highlights, auto_generated, status, owner_id, send_attempts, last_attempt_at, next_retry_at,
          provider_request_id, response_code, open_count, first_opened_at, last_opened_at, open_signal, last_open_source, last_error,
          last_sent_at, response_at, notes, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27, $28, $29, $30
        )
        ON CONFLICT (target_id) DO UPDATE SET
          pipeline_id = EXCLUDED.pipeline_id,
          lead_id = EXCLUDED.lead_id,
          provider_org = EXCLUDED.provider_org,
          recommended_campaign_id = EXCLUDED.recommended_campaign_id,
          channel = EXCLUDED.channel,
          contact_point = EXCLUDED.contact_point,
          subject_line = EXCLUDED.subject_line,
          message_template = EXCLUDED.message_template,
          recommendation_reason = EXCLUDED.recommendation_reason,
          proof_highlights = EXCLUDED.proof_highlights,
          auto_generated = EXCLUDED.auto_generated,
          status = EXCLUDED.status,
          owner_id = EXCLUDED.owner_id,
          send_attempts = EXCLUDED.send_attempts,
          last_attempt_at = EXCLUDED.last_attempt_at,
          next_retry_at = EXCLUDED.next_retry_at,
          provider_request_id = EXCLUDED.provider_request_id,
          response_code = EXCLUDED.response_code,
          open_count = EXCLUDED.open_count,
          first_opened_at = EXCLUDED.first_opened_at,
          last_opened_at = EXCLUDED.last_opened_at,
          open_signal = EXCLUDED.open_signal,
          last_open_source = EXCLUDED.last_open_source,
          last_error = EXCLUDED.last_error,
          last_sent_at = EXCLUDED.last_sent_at,
          response_at = EXCLUDED.response_at,
          notes = EXCLUDED.notes,
          updated_at = EXCLUDED.updated_at
      `,
      [
        parsed.targetId,
        parsed.pipelineId,
        parsed.leadId,
        parsed.providerOrg,
        parsed.recommendedCampaignId,
        parsed.channel,
        parsed.contactPoint,
        parsed.subjectLine,
        parsed.messageTemplate,
        parsed.recommendationReason,
        toJson(parsed.proofHighlights),
        parsed.autoGenerated,
        parsed.status,
        parsed.ownerId,
        parsed.sendAttempts,
        parsed.lastAttemptAt,
        parsed.nextRetryAt,
        parsed.providerRequestId,
        parsed.responseCode,
        parsed.openCount,
        parsed.firstOpenedAt,
        parsed.lastOpenedAt,
        parsed.openSignal,
        parsed.lastOpenSource,
        parsed.lastError,
        parsed.lastSentAt,
        parsed.responseAt,
        parsed.notes,
        parsed.createdAt,
        parsed.updatedAt,
      ],
    );
  }

  async listOnboardingTasks(pipelineId: string) {
    const result = await this.pool.query(
      `
        SELECT task_id, pipeline_id, lead_id, task_type, status, owner_id, due_at, related_target_id, auto_generated, evidence_ref, notes,
               completed_at, created_at, updated_at
        FROM onboarding_tasks
        WHERE pipeline_id = $1
        ORDER BY created_at ASC, task_id ASC
      `,
      [pipelineId],
    );
    return result.rows.map((row) =>
      OnboardingTaskSchema.parse({
        taskId: row.task_id,
        pipelineId: row.pipeline_id,
        leadId: row.lead_id,
        taskType: row.task_type,
        status: row.status,
        ownerId: row.owner_id,
        dueAt: row.due_at,
        relatedTargetId: row.related_target_id,
        autoGenerated: row.auto_generated ?? false,
        evidenceRef: row.evidence_ref,
        notes: row.notes,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    );
  }

  async getOnboardingTask(taskId: string) {
    const result = await this.pool.query(
      `
        SELECT task_id, pipeline_id, lead_id, task_type, status, owner_id, due_at, related_target_id, auto_generated, evidence_ref, notes,
               completed_at, created_at, updated_at
        FROM onboarding_tasks
        WHERE task_id = $1
      `,
      [taskId],
    );
    return result.rows[0]
      ? OnboardingTaskSchema.parse({
          taskId: result.rows[0].task_id,
          pipelineId: result.rows[0].pipeline_id,
          leadId: result.rows[0].lead_id,
          taskType: result.rows[0].task_type,
          status: result.rows[0].status,
          ownerId: result.rows[0].owner_id,
          dueAt: result.rows[0].due_at,
          relatedTargetId: result.rows[0].related_target_id,
          autoGenerated: result.rows[0].auto_generated ?? false,
          evidenceRef: result.rows[0].evidence_ref,
          notes: result.rows[0].notes,
          completedAt: result.rows[0].completed_at,
          createdAt: result.rows[0].created_at,
          updatedAt: result.rows[0].updated_at,
        })
      : null;
  }

  async upsertOnboardingTask(task: OnboardingTask) {
    const parsed = OnboardingTaskSchema.parse(task);
    await this.pool.query(
      `
        INSERT INTO onboarding_tasks (
          task_id, pipeline_id, lead_id, task_type, status, owner_id, due_at, related_target_id, auto_generated, evidence_ref, notes,
          completed_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
        )
        ON CONFLICT (task_id) DO UPDATE SET
          pipeline_id = EXCLUDED.pipeline_id,
          lead_id = EXCLUDED.lead_id,
          task_type = EXCLUDED.task_type,
          status = EXCLUDED.status,
          owner_id = EXCLUDED.owner_id,
          due_at = EXCLUDED.due_at,
          related_target_id = EXCLUDED.related_target_id,
          auto_generated = EXCLUDED.auto_generated,
          evidence_ref = EXCLUDED.evidence_ref,
          notes = EXCLUDED.notes,
          completed_at = EXCLUDED.completed_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        parsed.taskId,
        parsed.pipelineId,
        parsed.leadId,
        parsed.taskType,
        parsed.status,
        parsed.ownerId,
        parsed.dueAt,
        parsed.relatedTargetId,
        parsed.autoGenerated,
        parsed.evidenceRef,
        parsed.notes,
        parsed.completedAt,
        parsed.createdAt,
        parsed.updatedAt,
      ],
    );
  }

  async getPartnerReadiness(pipelineId: string) {
    const result = await this.pool.query(
      `
        SELECT readiness_id, pipeline_id, lead_id, overall_status, readiness_score, checklist, blockers, last_evaluated_at
        FROM partner_readiness
        WHERE pipeline_id = $1
      `,
      [pipelineId],
    );
    return result.rows[0]
      ? PartnerReadinessSchema.parse({
          readinessId: result.rows[0].readiness_id,
          pipelineId: result.rows[0].pipeline_id,
          leadId: result.rows[0].lead_id,
          overallStatus: result.rows[0].overall_status,
          readinessScore: result.rows[0].readiness_score,
          checklist: result.rows[0].checklist,
          blockers: result.rows[0].blockers,
          lastEvaluatedAt: result.rows[0].last_evaluated_at,
        })
      : null;
  }

  async upsertPartnerReadiness(readiness: PartnerReadiness) {
    const parsed = PartnerReadinessSchema.parse(readiness);
    await this.pool.query(
      `
        INSERT INTO partner_readiness (
          readiness_id, pipeline_id, lead_id, overall_status, readiness_score, checklist, blockers, last_evaluated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8
        )
        ON CONFLICT (readiness_id) DO UPDATE SET
          pipeline_id = EXCLUDED.pipeline_id,
          lead_id = EXCLUDED.lead_id,
          overall_status = EXCLUDED.overall_status,
          readiness_score = EXCLUDED.readiness_score,
          checklist = EXCLUDED.checklist,
          blockers = EXCLUDED.blockers,
          last_evaluated_at = EXCLUDED.last_evaluated_at
      `,
      [
        parsed.readinessId,
        parsed.pipelineId,
        parsed.leadId,
        parsed.overallStatus,
        parsed.readinessScore,
        toJson(parsed.checklist),
        toJson(parsed.blockers),
        parsed.lastEvaluatedAt,
      ],
    );
  }

  async listEventReceipts() {
    const result = await this.pool.query(`
      SELECT receipt_id, data_provenance, promotion_run_id, intent_id, offer_id, campaign_id, partner_id, event_type, occurred_at, signature
      FROM event_receipts
      ORDER BY occurred_at DESC, receipt_id DESC
    `);

    return result.rows.map((row) => this.mapReceipt(row));
  }

  async getEventReceipt(receiptId: string) {
    const result = await this.pool.query(
      `
        SELECT receipt_id, data_provenance, promotion_run_id, intent_id, offer_id, campaign_id, partner_id, event_type, occurred_at, signature
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
        INSERT INTO event_receipts (receipt_id, data_provenance, promotion_run_id, intent_id, offer_id, campaign_id, partner_id, event_type, occurred_at, signature)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (receipt_id) DO NOTHING
      `,
      [
        parsed.receiptId,
        parsed.dataProvenance,
        parsed.promotionRunId ?? null,
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
      SELECT settlement_id, data_provenance, campaign_id, offer_id, partner_id, intent_id, billing_model, event_type, amount,
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
        SELECT settlement_id, data_provenance, campaign_id, offer_id, partner_id, intent_id, billing_model, event_type, amount,
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
        SELECT settlement_id, data_provenance, campaign_id, offer_id, partner_id, intent_id, billing_model, event_type, amount,
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
          settlement_id, data_provenance, campaign_id, offer_id, partner_id, intent_id, billing_model, event_type, amount, currency,
          attribution_window, status, dispute_flag, provider_settlement_id, provider_reference, provider_state,
          provider_response_code, last_error, generated_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        )
        ON CONFLICT (settlement_id) DO NOTHING
      `,
      [
        parsed.settlementId,
        parsed.dataProvenance,
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
        SET data_provenance = $2,
            status = $3,
            dispute_flag = $4,
            provider_settlement_id = $5,
            provider_reference = $6,
            provider_state = $7,
            provider_response_code = $8,
            last_error = $9,
            updated_at = $10
        WHERE settlement_id = $1
      `,
      [
        parsed.settlementId,
        parsed.dataProvenance,
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
    if (filter.provenance) {
      values.push(filter.provenance);
      conditions.push(`data_provenance = $${values.length}`);
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
        SELECT audit_event_id, data_provenance, trace_id, entity_type, entity_id, action, status, actor_type, actor_id, details, occurred_at
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
          audit_event_id, data_provenance, trace_id, entity_type, entity_id, action, status, actor_type, actor_id, details, occurred_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11
        )
        ON CONFLICT (audit_event_id) DO NOTHING
      `,
      [
        parsed.auditEventId,
        parsed.dataProvenance,
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

  async upsertPartner(partner: PartnerAgent) {
    const parsed = PartnerAgentSchema.parse(partner);
    await this.pool.query(
      `
        INSERT INTO partner_agents (
          partner_id, agent_lead_id, data_provenance, provider_org, endpoint, status, supported_categories, accepts_sponsored,
          supports_disclosure, supports_delivery_receipt, supports_presentation_receipt, last_verified_at, verification_owner, evidence_ref, trust_score, auth_modes, sla_tier, buyer_intent_coverage, icp_overlap_score, intent_access_score,
          delivery_readiness_score, historical_quality_score, commercial_readiness_score, buyer_agent_score, buyer_agent_tier,
          is_qualified_buyer_agent, is_commercially_eligible, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18::jsonb, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28
        )
        ON CONFLICT (partner_id) DO UPDATE SET
          agent_lead_id = EXCLUDED.agent_lead_id,
          data_provenance = EXCLUDED.data_provenance,
          provider_org = EXCLUDED.provider_org,
          endpoint = EXCLUDED.endpoint,
          status = EXCLUDED.status,
          supported_categories = EXCLUDED.supported_categories,
          accepts_sponsored = EXCLUDED.accepts_sponsored,
          supports_disclosure = EXCLUDED.supports_disclosure,
          supports_delivery_receipt = EXCLUDED.supports_delivery_receipt,
          supports_presentation_receipt = EXCLUDED.supports_presentation_receipt,
          last_verified_at = EXCLUDED.last_verified_at,
          verification_owner = EXCLUDED.verification_owner,
          evidence_ref = EXCLUDED.evidence_ref,
          trust_score = EXCLUDED.trust_score,
          auth_modes = EXCLUDED.auth_modes,
          sla_tier = EXCLUDED.sla_tier,
          buyer_intent_coverage = EXCLUDED.buyer_intent_coverage,
          icp_overlap_score = EXCLUDED.icp_overlap_score,
          intent_access_score = EXCLUDED.intent_access_score,
          delivery_readiness_score = EXCLUDED.delivery_readiness_score,
          historical_quality_score = EXCLUDED.historical_quality_score,
          commercial_readiness_score = EXCLUDED.commercial_readiness_score,
          buyer_agent_score = EXCLUDED.buyer_agent_score,
          buyer_agent_tier = EXCLUDED.buyer_agent_tier,
          is_qualified_buyer_agent = EXCLUDED.is_qualified_buyer_agent,
          is_commercially_eligible = EXCLUDED.is_commercially_eligible
      `,
      [
        parsed.partnerId,
        parsed.agentLeadId,
        parsed.dataProvenance,
        parsed.providerOrg,
        parsed.endpoint,
        parsed.status,
        toJson(parsed.supportedCategories),
        parsed.acceptsSponsored,
        parsed.supportsDisclosure,
        parsed.supportsDeliveryReceipt,
        parsed.supportsPresentationReceipt,
        parsed.lastVerifiedAt,
        parsed.verificationOwner,
        parsed.evidenceRef,
        parsed.trustScore,
        toJson(parsed.authModes),
        parsed.slaTier,
        toJson(parsed.buyerIntentCoverage),
        parsed.icpOverlapScore,
        parsed.intentAccessScore,
        parsed.deliveryReadinessScore,
        parsed.historicalQualityScore,
        parsed.commercialReadinessScore,
        parsed.buyerAgentScore,
        parsed.buyerAgentTier,
        parsed.isQualifiedBuyerAgent,
        parsed.isCommerciallyEligible,
        new Date().toISOString(),
      ],
    );
  }

  private mapCampaign(row: Record<string, unknown>) {
    const offer = row.offer as Record<string, unknown>;
    const proofBundle = row.proof_bundle as { references?: Array<{ url?: string }> };
    const fallbackUrl =
      typeof row.source_document_url === "string"
        ? row.source_document_url
        : Array.isArray(offer?.actionEndpoints) && typeof offer.actionEndpoints[0] === "string"
          ? offer.actionEndpoints[0]
          : proofBundle?.references?.[0]?.url ?? "https://example.com";
    const fallbackProof =
      proofBundle?.references?.[0]?.url ??
      (Array.isArray(offer?.actionEndpoints) && typeof offer.actionEndpoints[0] === "string" ? offer.actionEndpoints[0] : fallbackUrl);
    const linkBundle =
      (row.link_bundle as Record<string, unknown> | null) && Object.keys((row.link_bundle as Record<string, unknown>) ?? {}).length > 0
        ? row.link_bundle
        : {
            homepageUrl: fallbackUrl,
            productDetailUrl: fallbackUrl,
            proofUrl: fallbackProof,
            conversionUrl: Array.isArray(offer?.actionEndpoints) && typeof offer.actionEndpoints[0] === "string" ? offer.actionEndpoints[0] : fallbackUrl,
            contactUrl: null,
          };
    return CampaignSchema.parse({
      campaignId: row.campaign_id,
      dataProvenance: row.data_provenance,
      workspaceId: row.workspace_id,
      promotionPlanId: row.promotion_plan_id,
      advertiser: row.advertiser,
      externalRef: row.external_ref,
      sourceDocumentUrl: row.source_document_url,
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
      linkBundle,
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
      dataProvenance: row.data_provenance,
      promotionRunId: row.promotion_run_id,
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
      dataProvenance: row.data_provenance,
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
      dataProvenance: row.data_provenance,
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

  private mapPromotionRun(row: Record<string, unknown>) {
    return PromotionRunSchema.parse({
      promotionRunId: row.promotion_run_id,
      workspaceId: row.workspace_id,
      campaignId: row.campaign_id,
      planId: row.plan_id,
      status: row.status,
      requestedCategory: row.requested_category,
      taskType: row.task_type,
      constraints: row.constraints,
      qualifiedBuyerAgentsCount: row.qualified_buyer_agents_count,
      coverageCreditsCharged: row.coverage_credits_charged,
      acceptedBuyerAgentsCount: row.accepted_buyer_agents_count,
      failedBuyerAgentsCount: row.failed_buyer_agents_count,
      shortlistedCount: row.shortlisted_count,
      handoffCount: row.handoff_count,
      conversionCount: row.conversion_count,
      selectedPartnerIds: row.selected_partner_ids,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private mapPromotionRunTarget(row: Record<string, unknown>) {
    return PromotionRunTargetSchema.parse({
      targetId: row.target_id,
      promotionRunId: row.promotion_run_id,
      workspaceId: row.workspace_id,
      campaignId: row.campaign_id,
      partnerId: row.partner_id,
      providerOrg: row.provider_org,
      endpointUrl: row.endpoint_url,
      buyerAgentTier: row.buyer_agent_tier,
      buyerAgentScore: row.buyer_agent_score,
      deliveryReadinessScore: row.delivery_readiness_score,
      status: row.status,
      supportedCategories: row.supported_categories,
      lastAttemptAt: row.last_attempt_at,
      dispatchAttempts: row.dispatch_attempts,
      cooldownUntil: row.cooldown_until,
      nextRetryAt: row.next_retry_at,
      protocol: row.protocol,
      remoteRequestId: row.remote_request_id,
      responseCode: row.response_code,
      lastError: row.last_error,
      acceptedAt: row.accepted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}
