type MetricValue = number;

export class WorkerMetricsRegistry {
  private readonly counters = new Map<string, MetricValue>();
  private readonly gauges = new Map<string, MetricValue>();

  increment(name: string, by = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  setGauge(name: string, value: number) {
    this.gauges.set(name, value);
  }

  renderPrometheus() {
    const lines: string[] = [];

    for (const [name, value] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name} ${value}`);
    }

    for (const [name, value] of this.gauges) {
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${value}`);
    }

    return `${lines.join("\n")}\n`;
  }
}
