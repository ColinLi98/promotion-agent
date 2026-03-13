import crypto from "node:crypto";

import {
  AuditEventSchema,
  type AuditActorType,
  type AuditEntityType,
  type AuditEvent,
  type AuditStatus,
  type DataProvenance,
} from "./domain.js";

type AuditInput = {
  dataProvenance?: DataProvenance;
  traceId: string;
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  status: AuditStatus;
  actorType?: AuditActorType;
  actorId?: string;
  details?: Record<string, unknown>;
};

export const createAuditEvent = ({
  dataProvenance = "ops_manual",
  traceId,
  entityType,
  entityId,
  action,
  status,
  actorType = "system",
  actorId = "promotion-agent",
  details = {},
}: AuditInput): AuditEvent =>
  AuditEventSchema.parse({
    auditEventId: `audit_${crypto.randomUUID().slice(0, 12)}`,
    dataProvenance,
    traceId,
    entityType,
    entityId,
    action,
    status,
    actorType,
    actorId,
    details,
    occurredAt: new Date().toISOString(),
  });
