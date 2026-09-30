export type HttpMetric = {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
};

function statusClass(statusCode: number): string {
  return `${Math.max(1, Math.min(5, Math.floor(statusCode / 100)))}xx`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function normalizeMetricRoute(path: string): string {
  return path
    .split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .slice(0, 160) || '/';
}

export function createHttpMetrics() {
  const requests = new Map<string, number>();
  const durations = new Map<string, number>();

  return {
    record(metric: HttpMetric) {
      const method = metric.method.toUpperCase().slice(0, 12);
      const route = normalizeMetricRoute(metric.route);
      const requestKey = `${method}\u0000${route}\u0000${statusClass(metric.statusCode)}`;
      const durationKey = `${method}\u0000${route}`;
      requests.set(requestKey, (requests.get(requestKey) ?? 0) + 1);
      durations.set(durationKey, (durations.get(durationKey) ?? 0) + Math.max(0, metric.durationMs));
    },
    render(): string {
      const lines = [
        '# HELP bowin_http_requests_total Total HTTP responses by method, normalized route, and status class.',
        '# TYPE bowin_http_requests_total counter',
      ];
      for (const [key, value] of [...requests.entries()].sort()) {
        const [method, route, status] = key.split('\u0000');
        lines.push(`bowin_http_requests_total{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${status}"} ${value}`);
      }
      lines.push(
        '# HELP bowin_http_request_duration_milliseconds_sum Cumulative HTTP response duration in milliseconds.',
        '# TYPE bowin_http_request_duration_milliseconds_sum counter',
      );
      for (const [key, value] of [...durations.entries()].sort()) {
        const [method, route] = key.split('\u0000');
        lines.push(`bowin_http_request_duration_milliseconds_sum{method="${escapeLabel(method)}",route="${escapeLabel(route)}"} ${value}`);
      }
      return `${lines.join('\n')}\n`;
    },
  };
}

export function metricsTokenFromEnv(
  env: Record<string, string | undefined>,
  production: boolean,
): string | null {
  const token = env.METRICS_TOKEN?.trim() || null;
  if (production && !token) throw new Error('METRICS_TOKEN is required in production');
  if (token && token.length < 32) throw new Error('METRICS_TOKEN must be at least 32 characters');
  return token;
}

/**
 * Application-level counters for monitoring (#165), rendered alongside the
 * HTTP metrics on the token-protected /api/internal/metrics endpoint.
 * Process-local: each container reports its own values.
 */
export type WebhookOutcome = 'success' | 'rejected' | 'failure';

export function createAppMetrics(now: () => number = Date.now) {
  let emailSends = 0;
  let emailFailures = 0;
  const webhookOutcomes: Record<WebhookOutcome, number> = { success: 0, rejected: 0, failure: 0 };
  let webhookLastSuccessSeconds = 0;

  return {
    recordEmail(success: boolean) {
      if (success) emailSends += 1;
      else emailFailures += 1;
    },
    recordStripeWebhook(statusCode: number) {
      const outcome: WebhookOutcome = statusCode >= 500 ? 'failure' : statusCode >= 400 ? 'rejected' : 'success';
      webhookOutcomes[outcome] += 1;
      if (outcome === 'success') webhookLastSuccessSeconds = Math.floor(now() / 1000);
    },
    render(): string {
      const lines = [
        '# HELP bowin_email_sends_total Emails accepted by the mail provider.',
        '# TYPE bowin_email_sends_total counter',
        `bowin_email_sends_total ${emailSends}`,
        '# HELP bowin_email_send_failures_total Email sends that failed (provider error or network).',
        '# TYPE bowin_email_send_failures_total counter',
        `bowin_email_send_failures_total ${emailFailures}`,
        '# HELP bowin_stripe_webhook_events_total Stripe webhook deliveries by outcome (success=2xx, rejected=4xx, failure=5xx).',
        '# TYPE bowin_stripe_webhook_events_total counter',
        ...(Object.keys(webhookOutcomes) as WebhookOutcome[]).map(
          (outcome) => `bowin_stripe_webhook_events_total{outcome="${outcome}"} ${webhookOutcomes[outcome]}`,
        ),
        '# HELP bowin_stripe_webhook_last_success_timestamp_seconds Unix time of the last successfully handled Stripe webhook (0 = none since start).',
        '# TYPE bowin_stripe_webhook_last_success_timestamp_seconds gauge',
        `bowin_stripe_webhook_last_success_timestamp_seconds ${webhookLastSuccessSeconds}`,
      ];
      return `${lines.join('\n')}\n`;
    },
  };
}

export const appMetrics = createAppMetrics();

/** Deployed revision for /api/health (set via the BUILD_SHA build arg). */
export function buildRevisionFromEnv(env: Record<string, string | undefined>): string {
  const sha = env.BUILD_SHA?.trim();
  return sha && /^[0-9a-f]{7,40}$/i.test(sha) ? sha : 'unknown';
}
