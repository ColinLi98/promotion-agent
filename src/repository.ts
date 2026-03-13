import type {
  AgentLead,
  AppealCase,
  AuditEvent,
  AuditEventFilter,
  AuditEventPage,
  BuyerAgentScorecard,
  Campaign,
  CreditLedgerEntry,
  DiscoveryRun,
  DiscoverySource,
  DiscoverySourceInput,
  EvidenceAsset,
  EventReceipt,
  MeasurementFunnel,
  MeasurementFunnelQuery,
  PartnerAgent,
  PolicyCheckResult,
  PromotionRun,
  PromotionPlan,
  PromotionRunTarget,
  RecruitmentPipeline,
  OutreachTarget,
  OnboardingTask,
  PartnerReadiness,
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
  WorkspaceSubscription,
  WorkspaceWallet,
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
  updateLeadStatus(leadId: string, nextStatus: AgentLead["verificationStatus"], actorId: string, comment: string, checklist: VerificationChecklist, evidenceRef?: string | null): Promise<AgentLead | null>;
  listVerificationRecords(leadId: string): Promise<VerificationRecord[]>;
  insertVerificationRecord(record: VerificationRecord): Promise<void>;
  listPartners(): Promise<PartnerAgent[]>;
  upsertPartner(partner: PartnerAgent): Promise<void>;
  listCampaigns(): Promise<Campaign[]>;
  getCampaign(campaignId: string): Promise<Campaign | null>;
  upsertCampaign(campaign: Campaign): Promise<void>;
  listEvidenceAssets(): Promise<EvidenceAsset[]>;
  insertEvidenceAsset(asset: EvidenceAsset): Promise<void>;
  listRiskCases(filter?: Partial<{ status: string; severity: string; entityType: string; ownerId: string; dateFrom: string; dateTo: string; provenance: string; }>): Promise<RiskCase[]>;
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
  listBuyerAgentScorecards(): Promise<BuyerAgentScorecard[]>;
  replaceBuyerAgentScorecards(scorecards: BuyerAgentScorecard[]): Promise<void>;
  getWorkspaceWallet(workspaceId: string): Promise<WorkspaceWallet | null>;
  upsertWorkspaceWallet(wallet: WorkspaceWallet): Promise<void>;
  listCreditLedgerEntries(workspaceId: string): Promise<CreditLedgerEntry[]>;
  insertCreditLedgerEntry(entry: CreditLedgerEntry): Promise<void>;
  getWorkspaceSubscription(workspaceId: string): Promise<WorkspaceSubscription | null>;
  upsertWorkspaceSubscription(subscription: WorkspaceSubscription): Promise<void>;
  listPromotionPlans(): Promise<PromotionPlan[]>;
  listPromotionRuns(workspaceId?: string): Promise<PromotionRun[]>;
  getPromotionRun(promotionRunId: string): Promise<PromotionRun | null>;
  upsertPromotionRun(run: PromotionRun): Promise<void>;
  listPromotionRunTargets(promotionRunId: string): Promise<PromotionRunTarget[]>;
  upsertPromotionRunTarget(target: PromotionRunTarget): Promise<void>;
  listRecruitmentPipelines(): Promise<RecruitmentPipeline[]>;
  getRecruitmentPipeline(pipelineId: string): Promise<RecruitmentPipeline | null>;
  upsertRecruitmentPipeline(pipeline: RecruitmentPipeline): Promise<void>;
  listOutreachTargets(pipelineId: string): Promise<OutreachTarget[]>;
  getOutreachTarget(targetId: string): Promise<OutreachTarget | null>;
  upsertOutreachTarget(target: OutreachTarget): Promise<void>;
  listOnboardingTasks(pipelineId: string): Promise<OnboardingTask[]>;
  getOnboardingTask(taskId: string): Promise<OnboardingTask | null>;
  upsertOnboardingTask(task: OnboardingTask): Promise<void>;
  getPartnerReadiness(pipelineId: string): Promise<PartnerReadiness | null>;
  upsertPartnerReadiness(readiness: PartnerReadiness): Promise<void>;
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
