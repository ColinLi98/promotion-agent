import type {
  AgentLead,
  AuditEvent,
  AuditEventFilter,
  AuditEventPage,
  Campaign,
  EventReceipt,
  PartnerAgent,
  PolicyCheckResult,
  SettlementReceipt,
  SettlementDeadLetterEntry,
  SettlementDeadLetterFilter,
  SettlementDeadLetterPage,
  SettlementRetryJob,
  SettlementRetryJobFilter,
} from "./domain.js";

export interface PromotionAgentRepository {
  listLeads(): Promise<AgentLead[]>;
  listPartners(): Promise<PartnerAgent[]>;
  listCampaigns(): Promise<Campaign[]>;
  getCampaign(campaignId: string): Promise<Campaign | null>;
  upsertCampaign(campaign: Campaign): Promise<void>;
  listPolicyChecks(campaignId?: string): Promise<PolicyCheckResult[]>;
  getLatestPolicyCheck(campaignId: string): Promise<PolicyCheckResult | null>;
  insertPolicyCheck(policyCheck: PolicyCheckResult): Promise<void>;
  listEventReceipts(): Promise<EventReceipt[]>;
  getEventReceipt(receiptId: string): Promise<EventReceipt | null>;
  insertEventReceipt(receipt: EventReceipt): Promise<void>;
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
