import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';
import { MetricTile } from './MetricTile';
import { FlippableTile } from './FlippableTile';
import { ErrorHistoryModal } from './ErrorHistoryModal';
import styles from './AdminDashboard.module.css';
import flipStyles from './FlippableTile.module.css';

// ============================================================
// Types — mirrors backend MetricsSnapshot
// ============================================================

interface LatencyStats {
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  count: number;
}

interface MetricsSnapshot {
  uptime: number;
  timestamp: string;

  http: {
    requests: Record<string, number>;
    latency: Record<string, LatencyStats>;
  };

  websocket: {
    connections: { current: number; total: number; peak: number };
    eventsIn: Record<string, number>;
    eventsOut: Record<string, number>;
  };

  database: {
    queries: Record<string, number>;
    latency: Record<string, LatencyStats>;
  };

  redis: {
    operations: Record<string, number>;
    latency: Record<string, LatencyStats>;
  };

  ai: {
    commands: Record<string, number>;
    latency: Record<string, LatencyStats>;
    costCents: number;
    totalTokens: number;
    budget: {
      spentCents: number;
      budgetCents: number;
      callCount: number;
      inputTokens: number;
      outputTokens: number;
    };
    /** Per-model breakdown (keyed by short model name, e.g. "haiku" | "sonnet") */
    byModel?: Record<string, {
      total: number;
      success: number;
      failure: number;
      costCents: number;
      inputTokens: number;
      outputTokens: number;
      latency: LatencyStats;
    }>;
  };

  editLocks?: {
    active: number;
    locks: Array<{ objectId: string; userId: string; boardId: string }>;
  };
}

// ============================================================
// AI Error type — mirrors backend audit response
// ============================================================

export interface AIError {
  id: string;
  userId: string;
  boardId: string;
  command: string;
  errorCode: string;
  errorMessage: string;
  operationCount: number;
  turnsUsed: number;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  model: string;
  traceId: string | null;
  timestamp: string;
}

// ============================================================
// Constants
// ============================================================

const POLL_INTERVAL = 30; // seconds
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const AUTH_PARAMS = {
  authorizationParams: {
    audience: import.meta.env.VITE_AUTH0_AUDIENCE || 'https://collabboard-api',
  },
};

// ============================================================
// Helpers
// ============================================================

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  // Relative for recent, absolute for older
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

// ============================================================
// Admin Dashboard Component
// ============================================================

export function AdminDashboard() {
  const { getAccessTokenSilently } = useAuth0();
  const [data, setData] = useState<MetricsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(POLL_INTERVAL);
  const countdownRef = useRef(POLL_INTERVAL);
  const [recentErrors, setRecentErrors] = useState<AIError[]>([]);
  const [totalErrors, setTotalErrors] = useState(0);
  const [errorModalOpen, setErrorModalOpen] = useState(false);

  const fetchMetrics = useCallback(async () => {
    try {
      const token = await getAccessTokenSilently(AUTH_PARAMS);
      const [metricsRes, errorsRes] = await Promise.all([
        fetch(`${API_URL}/metrics`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }),
        fetch(`${API_URL}/audit/ai-errors?limit=3`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (!metricsRes.ok) throw new Error(`Server returned ${metricsRes.status}`);
      const snapshot: MetricsSnapshot = await metricsRes.json();
      setData(snapshot);
      setError(null);

      if (errorsRes.ok) {
        const errData = await errorsRes.json() as { errors: AIError[]; total: number };
        setRecentErrors(errData.errors);
        setTotalErrors(errData.total);
      }
    } catch (err) {
      console.error('[AdminDashboard] fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
    } finally {
      setLoading(false);
      countdownRef.current = POLL_INTERVAL;
      setCountdown(POLL_INTERVAL);
    }
  }, [getAccessTokenSilently]);

  // Initial fetch + poll interval
  useEffect(() => {
    fetchMetrics();
    const pollTimer = setInterval(fetchMetrics, POLL_INTERVAL * 1000);
    return () => clearInterval(pollTimer);
  }, [fetchMetrics]);

  // Countdown timer (1s tick)
  useEffect(() => {
    const tick = setInterval(() => {
      countdownRef.current = Math.max(0, countdownRef.current - 1);
      setCountdown(countdownRef.current);
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  if (loading && !data) {
    return (
      <div className={styles.container}>
        <Header countdown={countdown} />
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>Loading metrics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <Header countdown={countdown} />
      <main className={styles.main}>
        {error && <p className={styles.error}>{error}</p>}
        {data && (
          <>
            <AIMetricsSection
              data={data}
              recentErrors={recentErrors}
              totalErrors={totalErrors}
              onShowAllErrors={() => setErrorModalOpen(true)}
            />
            <BackendMetricsSection data={data} />
          </>
        )}
      </main>
      {errorModalOpen && (
        <ErrorHistoryModal
          onClose={() => setErrorModalOpen(false)}
        />
      )}
    </div>
  );
}

// ============================================================
// Header
// ============================================================

function Header({ countdown }: { countdown: number }) {
  return (
    <header className={styles.header}>
      <Link to="/" className={styles.backLink}>&larr; Dashboard</Link>
      <h1 className={styles.title}>NoteTime Admin Metrics</h1>
      <span className={styles.countdown}>Next refresh: {countdown}s</span>
    </header>
  );
}

// ============================================================
// Section Divider
// ============================================================

function SectionDivider({ label }: { label: string }) {
  return (
    <div className={styles.sectionHeader}>
      <span>{label}</span>
      <div className={styles.sectionLine} />
    </div>
  );
}

// ============================================================
// AI Metrics Section
// ============================================================

/** Per-model stats shape from the backend */
type ModelStats = {
  total: number;
  success: number;
  failure: number;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  latency: LatencyStats;
};

function AIMetricsSection({
  data,
  recentErrors,
  totalErrors,
  onShowAllErrors,
}: {
  data: MetricsSnapshot;
  recentErrors: AIError[];
  totalErrors: number;
  onShowAllErrors: () => void;
}) {
  const ai = data.ai;
  const cmds = ai.commands;
  const budget = ai.budget;
  const latency = ai.latency?.command;
  const byModel = ai.byModel ?? {};
  const hasModelData = Object.keys(byModel).length > 0;
  const modelNames = Object.keys(byModel).sort(); // e.g. ["haiku", "sonnet"]

  // Command counts
  const total = cmds.total ?? 0;
  const today = cmds.today ?? 0;
  const success = cmds.success ?? 0;
  const failure = cmds.failure ?? 0;
  const successRate = total > 0 ? ((success / total) * 100).toFixed(1) : '—';

  // Budget — thresholds based on % remaining (spec: yellow <25%, red <10%)
  const spentPct = budget.budgetCents > 0
    ? Math.min(100, (budget.spentCents / budget.budgetCents) * 100)
    : 0;
  const remainingPct = 100 - spentPct;
  const progressClass = remainingPct < 10 ? styles.progressFillDanger   // red: <10% left
    : remainingPct < 25 ? styles.progressFillWarning                    // yellow/orange: <25% left
    : '';
  const budgetTextClass = remainingPct < 10 ? styles.budgetTextDanger
    : remainingPct < 25 ? styles.budgetTextWarning
    : '';

  // Cost per command
  const avgCostCents = budget.callCount > 0
    ? (budget.spentCents / budget.callCount).toFixed(1)
    : '—';

  // Burn rate
  const dayOfMonth = new Date().getDate();
  const centsPerDay = dayOfMonth > 0 ? budget.spentCents / dayOfMonth : 0;
  const remainingBudget = Math.max(0, budget.budgetCents - budget.spentCents);
  const projectedDays = centsPerDay > 0 ? Math.floor(remainingBudget / centsPerDay) : 999;

  // Helper: render per-model rows on the back of a flippable tile
  function ModelBackFace({ label, renderRow }: { label: string; renderRow: (m: ModelStats, name: string) => ReactNode }) {
    return (
      <>
        <span className={flipStyles.backLabel}>{label}</span>
        {hasModelData ? modelNames.map((name, i) => (
          <div key={name}>
            {i > 0 && <div className={flipStyles.divider} />}
            <div className={flipStyles.modelSection}>
              <div className={flipStyles.modelName}>{name}</div>
              {renderRow(byModel[name], name)}
            </div>
          </div>
        )) : (
          <span className={flipStyles.noData}>No per-model data yet</span>
        )}
      </>
    );
  }

  function ModelRow({ label, value }: { label: string; value: string }) {
    return (
      <div className={flipStyles.modelRow}>
        <span className={flipStyles.modelRowLabel}>{label}</span>
        <span className={flipStyles.modelRowValue}>{value}</span>
      </div>
    );
  }

  return (
    <>
      <SectionDivider label="AI" />

      {/* Row 1: Core stats */}
      <div className={styles.tileGrid}>
        <MetricTile label="AI Commands Today" value={String(today)} subtitle={`${total} total`} />

        <FlippableTile
          canFlip={hasModelData}
          front={
            <MetricTile
              bare
              label="AI Spend This Month"
              value={formatCents(budget.spentCents)}
              subtitle={`${formatCents(budget.spentCents)} / ${formatCents(budget.budgetCents)}`}
            >
              <div className={styles.progressBar}>
                <div
                  className={`${styles.progressFill} ${progressClass}`}
                  style={{ width: `${spentPct}%` }}
                />
              </div>
              <div className={`${styles.budgetRemaining} ${budgetTextClass}`}>
                {formatCents(remainingBudget)} remaining ({remainingPct.toFixed(0)}%)
              </div>
            </MetricTile>
          }
          back={
            <ModelBackFace label="Spend by Model" renderRow={(m) => (
              <>
                <ModelRow label="Cost" value={formatCents(m.costCents)} />
                <ModelRow label="Commands" value={String(m.total)} />
              </>
            )} />
          }
        />

        <FlippableTile
          canFlip={hasModelData}
          front={
            <MetricTile
              bare
              label="Avg Response Time"
              value={latency ? formatMs(latency.avg) : '—'}
            >
              {latency && latency.count > 0 && (
                <div className={styles.percentileList}>
                  <PercentileRow label="p50" value={latency.p50} />
                  <PercentileRow label="p90" value={latency.p90} />
                  <PercentileRow label="p95" value={latency.p95} />
                  <PercentileRow label="p99" value={latency.p99} />
                </div>
              )}
            </MetricTile>
          }
          back={
            <ModelBackFace label="Latency by Model" renderRow={(m) => (
              <>
                <ModelRow label="Avg" value={formatMs(m.latency.avg)} />
                <ModelRow label="p50" value={formatMs(m.latency.p50)} />
                <ModelRow label="p95" value={formatMs(m.latency.p95)} />
              </>
            )} />
          }
        />

        <FlippableTile
          canFlip={hasModelData}
          front={
            <MetricTile
              bare
              label="Success Rate"
              value={successRate === '—' ? '—' : `${successRate}%`}
              subtitle={total > 0 ? `${success} / ${total}` : undefined}
            />
          }
          back={
            <ModelBackFace label="Success by Model" renderRow={(m) => {
              const rate = m.total > 0 ? ((m.success / m.total) * 100).toFixed(1) : '—';
              return (
                <>
                  <ModelRow label="Rate" value={rate === '—' ? '—' : `${rate}%`} />
                  <ModelRow label="Pass / Fail" value={`${m.success} / ${m.failure}`} />
                </>
              );
            }} />
          }
        />
      </div>

      {/* Row 2: Breakdown stats */}
      <div className={styles.tileGrid}>
        <FlippableTile
          canFlip={hasModelData}
          front={
            <MetricTile bare label="Command Breakdown" value={String(total)}>
              <div className={styles.breakdownList}>
                <BreakdownRow label="Successful" value={success} />
                <BreakdownRow label="Failed" value={failure} />
              </div>
            </MetricTile>
          }
          back={
            <ModelBackFace label="Commands by Model" renderRow={(m) => (
              <>
                <ModelRow label="Total" value={String(m.total)} />
                <ModelRow label="Success" value={String(m.success)} />
                <ModelRow label="Failed" value={String(m.failure)} />
              </>
            )} />
          }
        />

        <FlippableTile
          canFlip={hasModelData}
          front={
            <MetricTile bare label="Token Usage" value={formatNumber(budget.inputTokens + budget.outputTokens)}>
              <div className={styles.breakdownList}>
                <BreakdownRow label="Input" value={formatNumber(budget.inputTokens)} />
                <BreakdownRow label="Output" value={formatNumber(budget.outputTokens)} />
              </div>
            </MetricTile>
          }
          back={
            <ModelBackFace label="Tokens by Model" renderRow={(m) => (
              <>
                <ModelRow label="Input" value={formatNumber(m.inputTokens)} />
                <ModelRow label="Output" value={formatNumber(m.outputTokens)} />
                <ModelRow label="Total" value={formatNumber(m.inputTokens + m.outputTokens)} />
              </>
            )} />
          }
        />

        <FlippableTile
          canFlip={hasModelData}
          front={
            <MetricTile
              bare
              label="Cost per Command"
              value={avgCostCents === '—' ? '—' : `${avgCostCents}\u00A2`}
              subtitle={budget.callCount > 0 ? `${budget.callCount} commands` : undefined}
            />
          }
          back={
            <ModelBackFace label="Cost/Cmd by Model" renderRow={(m) => {
              const avg = m.total > 0 ? (m.costCents / m.total).toFixed(1) : '—';
              return (
                <>
                  <ModelRow label="Avg Cost" value={avg === '—' ? '—' : `${avg}\u00A2`} />
                  <ModelRow label="Total Cost" value={formatCents(m.costCents)} />
                </>
              );
            }} />
          }
        />

        <FlippableTile
          canFlip={hasModelData}
          front={
            <MetricTile
              bare
              label="Budget Burn Rate"
              value={centsPerDay > 0 ? `${centsPerDay.toFixed(1)}\u00A2/day` : '—'}
              subtitle={projectedDays < 999 ? `~${projectedDays} days remaining` : undefined}
            />
          }
          back={
            <ModelBackFace label="Burn by Model" renderRow={(m) => {
              const modelPerDay = dayOfMonth > 0 ? m.costCents / dayOfMonth : 0;
              return (
                <>
                  <ModelRow label="Rate" value={modelPerDay > 0 ? `${modelPerDay.toFixed(1)}\u00A2/day` : '—'} />
                  <ModelRow label="Total Spend" value={formatCents(m.costCents)} />
                </>
              );
            }} />
          }
        />
      </div>

      {/* Row 3: Recent errors from DB */}
      <div className={styles.tableCard}>
        <div className={styles.errorHeader}>
          <h3 className={styles.tableTitle}>
            Recent Errors{totalErrors > 0 && ` (${totalErrors} total)`}
          </h3>
          {totalErrors > 0 && (
            <button className={styles.showAllButton} onClick={onShowAllErrors}>
              Show all captured errors
            </button>
          )}
        </div>
        {recentErrors.length > 0 ? (
          <div className={styles.errorList}>
            {recentErrors.map((e) => (
              <div key={e.id} className={styles.recentErrorItem}>
                <div className={styles.recentErrorTop}>
                  <span className={styles.errorCode}>{e.errorCode}</span>
                  <span className={styles.errorTimestamp}>{formatTimestamp(e.timestamp)}</span>
                </div>
                {e.errorMessage && (
                  <div className={styles.recentErrorMessage}>{e.errorMessage}</div>
                )}
                {e.command && (
                  <div className={styles.recentErrorCommand}>
                    Command: &ldquo;{truncate(e.command, 80)}&rdquo;
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.muted}>No errors recorded</p>
        )}
      </div>
    </>
  );
}

// ============================================================
// Backend Metrics Section
// ============================================================

function BackendMetricsSection({ data }: { data: MetricsSnapshot }) {
  return (
    <>
      <SectionDivider label="Backend" />

      {/* Connection tiles */}
      <div className={styles.tileGrid}>
        <MetricTile label="Uptime" value={formatUptime(data.uptime)} />
        <MetricTile
          label="WS Current"
          value={String(data.websocket.connections.current)}
          tooltip="Number of WebSocket connections open right now"
        />
        <MetricTile
          label="WS Total"
          value={formatNumber(data.websocket.connections.total)}
          tooltip="Total WebSocket connections since the server started"
        />
        <MetricTile
          label="WS Peak"
          value={String(data.websocket.connections.peak)}
          tooltip="Highest concurrent WebSocket connection count since the server started"
        />
      </div>

      {/* HTTP Requests Table */}
      <LatencyTable
        title="HTTP Requests"
        counters={data.http.requests}
        latencies={data.http.latency}
        keyParser={parseHttpKey}
      />

      {/* WebSocket Events — Side by Side */}
      <div className={styles.wsGrid}>
        <CounterTable title="WebSocket Events (In)" counters={data.websocket.eventsIn} />
        <CounterTable title="WebSocket Events (Out)" counters={data.websocket.eventsOut} />
      </div>

      {/* Database Queries Table */}
      <LatencyTable
        title="Database Queries"
        counters={data.database.queries}
        latencies={data.database.latency}
        keyParser={passThrough}
      />

      {/* Redis Operations Table */}
      <LatencyTable
        title="Redis Operations"
        counters={data.redis.operations}
        latencies={data.redis.latency}
        keyParser={passThrough}
      />

      {/* Edit Locks */}
      {data.editLocks && (
        <div className={styles.tableCard}>
          <h3 className={styles.tableTitle}>Active Edit Locks: {data.editLocks.active}</h3>
          {data.editLocks.locks.length > 0 ? (
            <div className={styles.lockList}>
              {data.editLocks.locks.map((lock, i) => (
                <div key={i} className={styles.lockItem}>
                  Object: {lock.objectId.slice(0, 8)}... &mdash; User: {lock.userId.slice(0, 12)}...
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.muted}>No active locks</p>
          )}
        </div>
      )}
    </>
  );
}

// ============================================================
// Latency Table (HTTP, DB, Redis)
// ============================================================

/** Parse HTTP key like "GET:/boards/:id:200" → { label: "GET /boards/:id", statusGroup: "200" } */
function parseHttpKey(key: string): string {
  // Format: METHOD:route:statusCode
  const parts = key.split(':');
  if (parts.length >= 3) {
    const status = parts[parts.length - 1];
    const method = parts[0];
    const route = parts.slice(1, -1).join(':');
    return `${method} ${route} (${status})`;
  }
  return key;
}

function passThrough(key: string): string {
  return key;
}

/**
 * Aggregates request counts by endpoint (merging status codes).
 * Matches counter keys to latency keys for display.
 */
function LatencyTable({
  title,
  counters,
  latencies,
  keyParser,
}: {
  title: string;
  counters: Record<string, number>;
  latencies: Record<string, LatencyStats>;
  keyParser: (key: string) => string;
}) {
  // Merge counts for the same endpoint (different status codes map to same latency key)
  // For HTTP: counter key = "GET:/boards/:id:200", latency key = "GET:/boards/:id"
  type Row = { label: string; count: number; latency?: LatencyStats };

  const rowMap = new Map<string, Row>();

  // First, add all counters
  for (const [key, count] of Object.entries(counters)) {
    const label = keyParser(key);
    const existing = rowMap.get(label);
    if (existing) {
      existing.count += count;
    } else {
      rowMap.set(label, { label, count });
    }
  }

  // Then, match latency stats by key
  for (const [key, stats] of Object.entries(latencies)) {
    // For HTTP latencies, key is "METHOD:route" — try to find matching row
    const label = keyParser(key);
    // Try matching by searching for a row that starts with the latency label
    for (const [rowLabel, row] of rowMap.entries()) {
      if (rowLabel.startsWith(label) || label === rowLabel) {
        row.latency = stats;
        break;
      }
    }
    // If no counter match, add latency-only row
    if (!rowMap.has(label)) {
      const matching = [...rowMap.entries()].find(([k]) => k.startsWith(label));
      if (!matching) {
        rowMap.set(label, { label, count: 0, latency: stats });
      }
    }
  }

  const rows = [...rowMap.values()].sort((a, b) => b.count - a.count);

  if (rows.length === 0) {
    return (
      <div className={styles.tableCard}>
        <h3 className={styles.tableTitle}>{title}</h3>
        <p className={styles.muted}>No data</p>
      </div>
    );
  }

  return (
    <div className={styles.tableCard}>
      <h3 className={styles.tableTitle}>{title}</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th className={styles.numCell}>Count</th>
            <th className={styles.numCell}>Avg</th>
            <th className={styles.numCell}>p50</th>
            <th className={styles.numCell}>p90</th>
            <th className={styles.numCell}>p95</th>
            <th className={styles.numCell}>p99</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td className={styles.numCell}>{formatNumber(row.count)}</td>
              <td className={styles.numCell}>{row.latency ? formatMs(row.latency.avg) : '—'}</td>
              <td className={styles.numCell}>{row.latency ? formatMs(row.latency.p50) : '—'}</td>
              <td className={styles.numCell}>{row.latency ? formatMs(row.latency.p90) : '—'}</td>
              <td className={styles.numCell}>{row.latency ? formatMs(row.latency.p95) : '—'}</td>
              <td className={styles.numCell}>{row.latency ? formatMs(row.latency.p99) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Counter Table (WebSocket Events)
// ============================================================

function CounterTable({
  title,
  counters,
}: {
  title: string;
  counters: Record<string, number>;
}) {
  const rows = Object.entries(counters)
    .sort(([, a], [, b]) => b - a);

  if (rows.length === 0) {
    return (
      <div className={styles.tableCard}>
        <h3 className={styles.tableTitle}>{title}</h3>
        <p className={styles.muted}>No data</p>
      </div>
    );
  }

  return (
    <div className={styles.tableCard}>
      <h3 className={styles.tableTitle}>{title}</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Event</th>
            <th className={styles.numCell}>Count</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([event, count]) => (
            <tr key={event}>
              <td>{event}</td>
              <td className={styles.numCell}>{formatNumber(count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Small helper components
// ============================================================

function PercentileRow({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.percentileRow}>
      <span className={styles.percentileLabel}>{label}</span>
      <span className={styles.percentileValue}>{formatMs(value)}</span>
    </div>
  );
}

function BreakdownRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.breakdownRow}>
      <span className={styles.breakdownLabel}>{label}</span>
      <span className={styles.breakdownValue}>{value}</span>
    </div>
  );
}
