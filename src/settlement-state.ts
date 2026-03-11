import { type SettlementReceipt, type SettlementRetryJob } from "./domain.js";

type SettlementAction =
  | "queue"
  | "begin_processing"
  | "mark_settled"
  | "schedule_retry"
  | "mark_failed"
  | "mark_disputed";

const allowedTransitions: Record<SettlementReceipt["status"], SettlementAction[]> = {
  pending: ["queue", "begin_processing", "mark_disputed"],
  processing: ["mark_settled", "schedule_retry", "mark_failed", "mark_disputed"],
  retry_scheduled: ["begin_processing", "mark_failed", "mark_disputed"],
  settled: [],
  disputed: [],
  failed: [],
};

export const transitionSettlementStatus = (
  settlement: SettlementReceipt,
  action: SettlementAction,
): SettlementReceipt["status"] => {
  if (!allowedTransitions[settlement.status].includes(action)) {
    throw new Error(`Invalid settlement transition: ${settlement.status} -> ${action}`);
  }

  switch (action) {
    case "queue":
      return "pending";
    case "begin_processing":
      return "processing";
    case "mark_settled":
      return "settled";
    case "schedule_retry":
      return "retry_scheduled";
    case "mark_failed":
      return "failed";
    case "mark_disputed":
      return "disputed";
  }
};

export const backoffDelaySeconds = (attempts: number) => Math.min(300, 15 * 2 ** Math.max(0, attempts - 1));

export const isRetryJobDue = (job: SettlementRetryJob) =>
  (job.status === "queued" || job.status === "retry_scheduled") &&
  new Date(job.nextRunAt).getTime() <= Date.now();
