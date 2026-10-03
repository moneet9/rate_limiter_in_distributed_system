class Metrics {
  constructor() { this.reset(); }
  reset() { this.requests = []; this.startedAt = Date.now(); }
  record(item) { this.requests.unshift(item); this.requests = this.requests.slice(0, 500); }
  snapshot() {
    const values = this.requests;
    const latencies = values.map((item) => item.latency).sort((a, b) => a - b);
    const accepted = values.filter((item) => item.allowed).length;
    const elapsed = Math.max(1, Date.now() - this.startedAt) / 1000;
    const byAlgorithm = {};
    for (const algorithm of ['fixed-window', 'sliding-window', 'token-bucket']) {
      const entries = values.filter((item) => item.algorithm === algorithm);
      const algorithmLatencies = entries.map((item) => item.latency).sort((a, b) => a - b);
      const algorithmAccepted = entries.filter((item) => item.allowed).length;
      byAlgorithm[algorithm] = {
        total: entries.length,
        accepted: algorithmAccepted,
        rejected: entries.length - algorithmAccepted,
        acceptanceRate: entries.length ? Number(((algorithmAccepted / entries.length) * 100).toFixed(1)) : 0,
        averageLatency: entries.length ? Number((algorithmLatencies.reduce((a, b) => a + b, 0) / entries.length).toFixed(2)) : 0,
        p95Latency: algorithmLatencies.length ? algorithmLatencies[Math.min(algorithmLatencies.length - 1, Math.floor(algorithmLatencies.length * 0.95))] : 0,
      };
    }
    return {
      total: values.length, accepted, rejected: values.length - accepted,
      rps: Number((values.length / elapsed).toFixed(2)),
      averageLatency: latencies.length ? Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)) : 0,
      p95Latency: latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : 0,
      byAlgorithm,
    };
  }
}
module.exports = { Metrics };
