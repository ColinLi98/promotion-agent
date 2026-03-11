import http from "node:http";
import crypto from "node:crypto";

import { CompositeAlertSink, NoopAlertSink, SlackWebhookAlertSink, WebhookAlertSink } from "../src/alerts.js";
import { createConfiguredStore } from "../src/factory.js";
import { WorkerMetricsRegistry } from "../src/metrics.js";

const intervalMs = Number(process.env.SETTLEMENT_WORKER_INTERVAL_MS ?? 5000);
const batchSize = Number(process.env.SETTLEMENT_WORKER_BATCH_SIZE ?? 20);
const metricsPort = Number(process.env.SETTLEMENT_WORKER_METRICS_PORT ?? 9464);
const leaderLeaseMs = Number(process.env.SETTLEMENT_WORKER_LEADER_LEASE_MS ?? 15000);
const alertSuppressionSeconds = Number(process.env.ALERT_SUPPRESSION_SECONDS ?? 300);
const leaderKey = "leader:settlement-worker";

const main = async () => {
  const { store, persistence, hotStatePersistence, settlementGatewayMode, hotState } = await createConfiguredStore();
  const metrics = new WorkerMetricsRegistry();
  const alertSinks = [];
  if (process.env.ALERT_WEBHOOK_URL) {
    alertSinks.push(new WebhookAlertSink(process.env.ALERT_WEBHOOK_URL, process.env.ALERT_WEBHOOK_API_KEY));
  }
  if (process.env.SLACK_WEBHOOK_URL) {
    alertSinks.push(new SlackWebhookAlertSink(process.env.SLACK_WEBHOOK_URL));
  }
  const alertSink = alertSinks.length > 0 ? new CompositeAlertSink(alertSinks) : new NoopAlertSink();
  let leadershipToken: string | null = null;

  const metricsServer = http.createServer(async (request, response) => {
    if (request.url === "/metrics") {
      response.writeHead(200, {
        "content-type": "text/plain; version=0.0.4",
      });
      response.end(metrics.renderPrometheus());
      return;
    }

    if (request.url === "/healthz") {
      response.writeHead(200, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.writeHead(404).end("Not found");
  });

  await new Promise<void>((resolve) => {
    metricsServer.listen(metricsPort, "127.0.0.1", () => resolve());
  });

  const tryAcquireLeadership = async () => {
    if (leadershipToken) {
      const renewed = await hotState.renewLock(leaderKey, leadershipToken, leaderLeaseMs);
      if (renewed) {
        metrics.setGauge("promotion_agent_worker_is_leader", 1);
        return true;
      }
      leadershipToken = null;
    }

    const token = await hotState.acquireLock(leaderKey, leaderLeaseMs);
    if (!token) {
      metrics.setGauge("promotion_agent_worker_is_leader", 0);
      return false;
    }

    leadershipToken = token;
    metrics.increment("promotion_agent_worker_leadership_acquired_total");
    metrics.setGauge("promotion_agent_worker_is_leader", 1);
    return true;
  };

  const shouldSuppressAlert = async (title: string, details: Record<string, unknown>) => {
    const fingerprint = crypto
      .createHash("sha256")
      .update(JSON.stringify({ title, details }))
      .digest("hex");
    const key = `alerts:settlement-worker:${fingerprint}`;
    const existing = await hotState.getJson<{ occurredAt: string }>(key);
    if (existing) {
      metrics.increment("promotion_agent_worker_alerts_suppressed_total");
      return true;
    }

    await hotState.setJson(
      key,
      {
        occurredAt: new Date().toISOString(),
      },
      alertSuppressionSeconds,
    );
    return false;
  };

  const tick = async () => {
    const isLeader = await tryAcquireLeadership();
    if (!isLeader) {
      metrics.increment("promotion_agent_worker_leadership_skipped_total");
      return;
    }

    const startedAt = Date.now();
    const summary = await store.processSettlementRetryQueue(batchSize);
    const retryJobs = await store.listSettlementRetryJobs({ limit: 500 });
    const dlqPage = await store.listSettlementDeadLetters({ status: "open", page: 1, pageSize: 1 });

    metrics.increment("promotion_agent_worker_runs_total");
    metrics.increment("promotion_agent_worker_jobs_processed_total", summary.processedCount);
    metrics.increment("promotion_agent_worker_jobs_settled_total", summary.settledCount);
    metrics.increment("promotion_agent_worker_jobs_retried_total", summary.rescheduledCount);
    metrics.increment("promotion_agent_worker_jobs_failed_total", summary.failedCount);
    metrics.increment("promotion_agent_worker_jobs_skipped_total", summary.skippedCount);
    metrics.setGauge("promotion_agent_worker_last_run_timestamp_seconds", Math.floor(Date.now() / 1000));
    metrics.setGauge("promotion_agent_worker_last_run_duration_seconds", (Date.now() - startedAt) / 1000);
    metrics.setGauge(
      "promotion_agent_worker_retry_jobs_open",
      retryJobs.filter((job) => job.status === "queued" || job.status === "retry_scheduled").length,
    );
    metrics.setGauge("promotion_agent_worker_dlq_open_total", dlqPage.total);

    if (summary.processedCount > 0 || summary.skippedCount > 0) {
      console.log(JSON.stringify(summary));
    }

    if (summary.failedCount > 0) {
      const details = { summary };
      const suppressed = await shouldSuppressAlert("Settlement worker failure", details);
      if (!suppressed) {
        metrics.increment("promotion_agent_worker_alerts_sent_total");
        await alertSink.send({
          severity: "critical",
          title: "Settlement worker failure",
          message: `Failed settlements: ${summary.failedCount}`,
          details,
          occurredAt: new Date().toISOString(),
        });
      }
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  const shutdown = async () => {
    clearInterval(timer);
    if (leadershipToken) {
      await hotState.releaseLock(leaderKey, leadershipToken);
    }
    await new Promise<void>((resolve, reject) => {
      metricsServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await store.close();
  };

  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  await tick();
  console.log(
    `settlement-worker running every ${intervalMs}ms using ${persistence} persistence, ${hotStatePersistence} hot-state, ${settlementGatewayMode} billing adapter`,
  );
  console.log(`settlement-worker metrics available at http://127.0.0.1:${metricsPort}/metrics`);
  await new Promise(() => {});
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
