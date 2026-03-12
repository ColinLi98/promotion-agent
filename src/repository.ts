import type {
  AgentLead,
  AppealCase,
  AuditEvent,
  AuditEventFilter,
  AuditEventPage,
  Campaign,
  DiscoveryRun,
  DiscoverySource,
  DiscoverySourceInput,
  EvidenceAsset,
  EventReceipt,
  MeasurementFunnel,
  MeasurementFunnelQuery,
  PartnerAgent,
  PolicyCheckResult,
  ReputationRecord,
  RiskCase,
  SettlementReceipt,
  SettlementDeadLetterEntry,
  SettlementDeadLetterFilter,
  SettlementDeadLetterPage,
  SettlementRetryJob,
  SettlementRetryJobFilter,
  VerificationChecklist,
  VerificationRecord,
  AttributionRow,
  BillingDraft,
} from "./domain.js";

export interface PromotionAgentRepository {
  listDiscoverySources(): Promise<DiscoverySource[]>;
  createDiscoverySource(input: DiscoverySourceInput): Promise<DiscoverySource>;
  listDiscoveryRuns(): Promise<DiscoveryRun[]>;
  insertDiscoveryRun(run: DiscoveryRun): Promise<void>;
  updateDiscoveryRun(run: DiscoveryRun): Promise<void>;
  listLeads(): Promise<AgentLead[]>;
  getLead(leadId: string): Promise<AgentLead | null>;
  upsertLead(lead: AgentLead): Promise<void>;
  assignLead(leadId: string, ownerId: string): Promise<AgentLead | null>;
  updateLeadStatus(leadId: string, nextStatus: AgentLead["verificationStatus"], actorId: string, comment: string, checklist: VerificationChecklist): Promise<AgentLead | null>;
  listVerificationRecords(leadId: string): Promise<VerificationRecord[]>;
  insertVerificationRecord(record: VerificationRecord): Promise<void>;
  listPartners(): Promise<PartnerAgent[]>;
  listCampaigns(): Promise<Campaign[]>;
  getCampaign(campaignId: string): Promise<Campaign | null>;
  upsertCampaign(campaign: Campaign): Promise<void>;
  listEvidenceAssets(): Promise<EvidenceAsset[]>;
  insertEvidenceAsset(asset: EvidenceAsset): Promise<void>;
  listRiskCases(filter?: Partial<{ status: string; severity: string; entityType: string; ownerId: string; dateFrom: string; dateTo: string; }>): Promise<RiskCase[]>;
  getRiskCase(caseId: string): Promise<RiskCase | null>;
  insertRiskCase(riskCase: RiskCase): Promise<void>;
  updateRiskCase(riskCase: RiskCase): Promise<void>;
  listReputationRecords(): Promise<ReputationRecord[]>;
  getReputationRecord(recordId: string): Promise<ReputationRecord | null>;
  insertReputationRecord(record: ReputationRecord): Promise<void>;
  updateReputationRecord(record: ReputationRecord): Promise<void>;
  listAppeals(): Promise<AppealCase[]>;
  getAppeal(appealId: string): Promise<AppealCase | null>;
  insertAppeal(appeal: AppealCase): Promise<void>;
  updateAppeal(appeal: AppealCase): Promise<void>;
  listPolicyChecks(campaignId?: string): Promise<PolicyCheckResult[]>;
  getLatestPolicyCheck(campaignId: string): Promise<PolicyCheckResult | null>;
  insertPolicyCheck(policyCheck: PolicyCheckResult): Promise<void>;
  listEventReceipts(): Promise<EventReceipt[]>;
  getEventReceipt(receiptId: string): Promise<EventReceipt | null>;
  insertEventReceipt(receipt: EventReceipt): Promise<void>;
  getMeasurementFunnel(query: MeasurementFunnelQuery): Promise<MeasurementFunnel>;
  getAttributionRows(query: MeasurementFunnelQuery): Promise<AttributionRow[]>;
  getBillingDrafts(): Promise<BillingDraft[]>;
  listSettlements(): Promise<SettlementReceipt[]>;
  getSettlement(settlementId: string): Promise<SettlementReceipt | null>;
  findSettlement(intentId: string, offerId: string, eventType: EventReceipt["eventType"]): Promise<SettlementReceipt | null>;
  insertSettlement(settlement: SettlementReceipt): Promise<void>;
  updateSettlement(settlement: SettlementReceipt): Promise<void>;
  listSettlementRetryJobs(filter?: SettlementRetryJobFilter): Promise<SettlementRetryJob[]>;
  getSettlementRetryJobBySettlementId(settlementId: string): Promise<SettlementRetryJob | null>;
  upsertSettlementRetryJob(job: SettlementRetryJob): Promise<void>;
  listSettlementDeadLetters(filter?: SettlementDeadLetterFilter): Promise<SettlementDeadLetterPage>;
  getSettlementDeadLetter(dlqEntryId: string): Promise<SettlementDeadLetterEntry | null>;
  getSettlementDeadLetterBySettlementId(settlementId: string): Promise<SettlementDeadLetterEntry | null>;
  upsertSettlementDeadLetter(entry: SettlementDeadLetterEntry): Promise<void>;
  listAuditEvents(filter?: AuditEventFilter): Promise<AuditEventPage>;
  insertAuditEvent(event: AuditEvent): Promise<void>;
  close(): Promise<void>;
}
