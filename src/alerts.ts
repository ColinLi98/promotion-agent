export type AlertSeverity = "info" | "warning" | "critical";

export type WorkerAlert = {
  severity: AlertSeverity;
  title: string;
  message: string;
  details?: Record<string, unknown>;
  occurredAt: string;
};

export interface AlertSink {
  send(alert: WorkerAlert): Promise<void>;
}

export class NoopAlertSink implements AlertSink {
  async send() {}
}

export class WebhookAlertSink implements AlertSink {
  constructor(
    private readonly url: string,
    private readonly apiKey?: string,
  ) {}

  async send(alert: WorkerAlert) {
    await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(alert),
    });
  }
}

export class SlackWebhookAlertSink implements AlertSink {
  constructor(private readonly url: string) {}

  async send(alert: WorkerAlert) {
    const color =
      alert.severity === "critical"
        ? "#B94334"
        : alert.severity === "warning"
          ? "#B47017"
          : "#1F8F62";

    await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text: `[${alert.severity.toUpperCase()}] ${alert.title}`,
        attachments: [
          {
            color,
            title: alert.title,
            text: alert.message,
            fields: Object.entries(alert.details ?? {}).map(([title, value]) => ({
              title,
              value: typeof value === "string" ? value : JSON.stringify(value),
              short: false,
            })),
            footer: "promotion-agent settlement worker",
            ts: Math.floor(new Date(alert.occurredAt).getTime() / 1000),
          },
        ],
      }),
    });
  }
}

export class CompositeAlertSink implements AlertSink {
  constructor(private readonly sinks: AlertSink[]) {}

  async send(alert: WorkerAlert) {
    await Promise.all(this.sinks.map((sink) => sink.send(alert)));
  }
}
