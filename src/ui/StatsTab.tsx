import { useMemo, useState } from 'react';
import { Card } from './components/Card';
import { useVoteHistoryStore, useVoteStore, type VoteEvent } from '../store/store';

type Period = 'prev' | 'cur' | '30';
const DAY_MS = 86_400_000;

interface Counts {
  votes: number;
  chances: number;
}

interface PeriodStats extends Counts {
  /** Votes validés à la main, sans confirmation du site du serveur. */
  manual: number;
  days: Map<number, Counts>;
  hours: number[];
  sites: Map<string, Counts>;
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function monthName(t: number): string {
  return new Date(t).toLocaleDateString('fr-FR', { month: 'long' });
}

function periodRange(period: Period, now: number) {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = d.getMonth();
  const monthStart = new Date(y, m, 1).getTime();
  if (period === 'cur') {
    const prevStart = new Date(y, m - 1, 1).getTime();
    return { from: monthStart, to: now, prevFrom: prevStart, prevTo: prevStart + (now - monthStart) };
  }
  if (period === 'prev') {
    const from = new Date(y, m - 1, 1).getTime();
    return { from, to: monthStart, prevFrom: new Date(y, m - 2, 1).getTime(), prevTo: from };
  }
  const from = startOfDay(now - 29 * DAY_MS);
  return { from, to: now, prevFrom: from - 30 * DAY_MS, prevTo: from };
}

function compute(events: VoteEvent[], serverId: string | null, from: number, to: number): PeriodStats {
  const stats: PeriodStats = { votes: 0, chances: 0, manual: 0, days: new Map(), hours: Array(24).fill(0), sites: new Map() };
  // Le saut de +26 h avant de retomber sur minuit absorbe les jours de 23 h ou 25 h (changement d'heure).
  for (let day = startOfDay(from); day < to; day = startOfDay(day + DAY_MS + 2 * 3_600_000)) {
    stats.days.set(day, { votes: 0, chances: 0 });
  }
  for (const e of events) {
    if (e.t < from || e.t >= to || (serverId && e.serverId !== serverId)) continue;
    const day = stats.days.get(startOfDay(e.t));
    const site = stats.sites.get(e.host) ?? { votes: 0, chances: 0 };
    stats.sites.set(e.host, site);
    if (e.kind === 'v') {
      stats.votes += 1;
      if (e.manual) stats.manual += 1;
      site.votes += 1;
      if (day) day.votes += 1;
      stats.hours[new Date(e.t).getHours()] += 1;
    } else {
      stats.chances += 1;
      site.chances += 1;
      if (day) day.chances += 1;
    }
  }
  return stats;
}

/** Votes faits ÷ nombre de fois où un site est redevenu disponible. */
function successRate(c: Counts): number {
  const total = Math.max(c.chances, c.votes);
  return total ? Math.round((100 * c.votes) / total) : 0;
}

function missed(c: Counts): number {
  return Math.max(0, c.chances - c.votes);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Jours complets du mois qu'il faut avant d'oser un pronostic. */
const FORECAST_MIN_DAYS = 3;

/**
 * Pronostic du total de votes à la fin du mois, si l'on reste aussi régulier : ce qui est déjà
 * voté, plus la médiane des jours complets du mois pour chaque jour restant. La médiane, pas la
 * moyenne : un jour exceptionnel (rien voté, ou tout rattrapé) ne fausse pas l'estimation.
 * `dayVotes` : votes de chaque jour du mois jusqu'à aujourd'hui compris (incomplet, hors médiane).
 */
function monthForecast(dayVotes: number[], total: number, now: number): { total: number; perDay: number; days: number } | null {
  const past = dayVotes.slice(0, -1);
  if (past.length < FORECAST_MIN_DAYS) return null;
  const perDay = median(past);
  const date = new Date(now);
  const daysLeft = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() - date.getDate();
  const today = dayVotes[dayVotes.length - 1] ?? 0;
  return { total: Math.round(total + Math.max(0, perDay - today) + perDay * daysLeft), perDay, days: past.length };
}

function niceMax(n: number): number {
  return [4, 6, 8, 10, 20, 30, 40, 50, 60, 80, 100, 200, 400, 600, 1000].find((x) => x >= n) ?? Math.ceil(n / 1000) * 1000;
}

interface Bar {
  value: number;
  label: string;
  tip: string;
}

function BarChart({ bars, ariaLabel }: { bars: Bar[]; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 180;
  const L = 30;
  const R = 6;
  const T = 26;
  const B = 22;
  const innerW = W - L - R;
  const innerH = H - T - B;
  const max = niceMax(Math.max(1, ...bars.map((b) => b.value)));
  const step = innerW / bars.length;
  const barW = Math.max(2, Math.min(24, step - 2));

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="block h-auto w-full">
        {[0, max / 2, max].map((v) => {
          const y = T + innerH - (v / max) * innerH;
          return (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y} y2={y} className="stroke-border" strokeWidth={1} />
              <text x={L - 6} y={y + 3} textAnchor="end" className="fill-text-muted font-mono text-[10px]">
                {v}
              </text>
            </g>
          );
        })}
        {bars.map((bar, i) => {
          const x = L + i * step + (step - barW) / 2;
          const h = (bar.value / max) * innerH;
          const y = T + innerH - h;
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={i}>
              {h > 0 && (
                <path
                  d={`M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${y + h}Z`}
                  className="fill-accent"
                  opacity={hover === i ? 1 : 0.85}
                />
              )}
              {bar.label && (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="fill-text-muted font-mono text-[10px]">
                  {bar.label}
                </text>
              )}
              <rect x={L + i * step} y={T} width={step} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)}>
                <title>{bar.tip}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs text-text shadow-sm"
          style={{ left: `${Math.min(86, Math.max(14, (100 * (L + (hover + 0.5) * step)) / W))}%` }}
        >
          {bars[hover].tip}
        </div>
      )}
    </div>
  );
}

export function StatsTab() {
  const events = useVoteHistoryStore((s) => s.events);
  const servers = useVoteStore((s) => s.servers);
  const currentId = useVoteStore((s) => s.currentId);
  const [period, setPeriod] = useState<Period>('cur');
  const [scope, setScope] = useState<string>(currentId ?? 'all');

  const serverId = scope === 'all' ? null : scope;
  const now = Date.now();
  const range = periodRange(period, now);
  const stats = useMemo(() => compute(events, serverId, range.from, range.to), [events, serverId, range.from, range.to]);
  const previous = useMemo(
    () => compute(events, serverId, range.prevFrom, range.prevTo),
    [events, serverId, range.prevFrom, range.prevTo]
  );

  const prevMonthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth() - 1, 1).getTime();
  // `short` : libellé utilisé quand l'écran est étroit (panneau latéral), pour tenir sur une ligne.
  const periods: { id: Period; label: string; short: string }[] = [
    { id: 'cur', label: `Ce mois (${monthName(now)})`, short: monthName(now) },
    { id: 'prev', label: `Mois dernier (${monthName(prevMonthStart)})`, short: monthName(prevMonthStart) },
    { id: '30', label: '30 derniers jours', short: '30 jours' },
  ];

  const days = [...stats.days.entries()];
  const fewDays = days.length <= 10;
  const dayBars: Bar[] = days.map(([day, c]) => {
    const date = new Date(day);
    const n = date.getDate();
    const name = date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    return { value: c.votes, label: fewDays || n === 1 || n % 5 === 0 ? String(n) : '', tip: `${name} : ${c.votes} votés, ${missed(c)} manqués` };
  });
  const hourBars: Bar[] = stats.hours.map((v, h) => ({
    value: v,
    label: h % 3 === 0 ? `${h} h` : '',
    tip: `${h} h – ${h + 1} h : ${v} vote${v > 1 ? 's' : ''}`,
  }));
  const bestHour = stats.hours.indexOf(Math.max(...stats.hours));
  const diff = stats.votes - previous.votes;
  const sites = [...stats.sites.entries()].sort((a, b) => b[1].votes - a[1].votes);
  const topVotes = Math.max(1, ...sites.map(([, c]) => c.votes));
  const rate = successRate(stats);
  const forecast = period === 'cur' ? monthForecast(days.map(([, c]) => c.votes), stats.votes, now) : null;
  const periodName = period === '30' ? 'sur 30 jours' : `en ${monthName(period === 'cur' ? now : prevMonthStart)}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        {periods.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPeriod(p.id)}
            aria-pressed={period === p.id}
            aria-label={p.label}
            className={`min-h-9 rounded-full border px-3 text-xs font-medium transition-colors ${
              period === p.id ? 'border-text bg-text text-bg' : 'border-border bg-surface text-text-muted hover:text-text'
            }`}
          >
            <span className="capitalize sm:hidden">{p.short}</span>
            <span className="hidden sm:inline">{p.label}</span>
          </button>
        ))}
        {servers.length > 1 && (
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            aria-label="Serveur"
            className="ml-auto min-h-9 rounded-lg border border-border bg-surface px-2 text-xs text-text"
          >
            <option value="all">Tous les serveurs</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Le chiffre de la période, en grand, puis ce qui l'explique. */}
        <Card className="flex min-w-0 flex-col gap-4 p-5">
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <p className="font-mono text-6xl font-medium leading-none tabular-nums text-accent">{stats.votes}</p>
            <div className="pb-0.5">
              <p className="text-base font-semibold leading-tight text-text">
                vote{stats.votes > 1 ? 's' : ''} {periodName}
              </p>
              <p className={`text-xs font-medium ${diff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-text-muted'}`}>
                {diff >= 0 ? '+' : '−'}
                {Math.abs(diff)} par rapport à la période d'avant
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-xs text-text">
              <span>
                Réussite <span className="text-text-muted">(votes faits ÷ rappels reçus)</span>
              </span>
              <span className="shrink-0 whitespace-nowrap font-mono font-medium tabular-nums">{rate} %</span>
            </div>
            <div className="h-2 rounded-full bg-surface-alt" role="img" aria-label={`${rate} % de réussite`}>
              <div className="h-2 rounded-full bg-accent" style={{ width: `${rate}%` }} />
            </div>
          </div>
          {period === 'cur' && (
            <div className="rounded-lg bg-accent-soft px-3 py-2.5">
              <p className="text-xs font-semibold text-text">Pronostic à la fin du mois</p>
              {forecast ? (
                <>
                  <p className="font-mono text-2xl font-medium tabular-nums text-text">≈ {forecast.total} votes</p>
                  <p className="text-xs text-text-muted">
                    Si tu restes aussi régulier : médiane de {forecast.perDay.toLocaleString('fr-FR')} vote{forecast.perDay > 1 ? 's' : ''} par
                    jour sur les {forecast.days} jours écoulés.
                  </p>
                </>
              ) : (
                <p className="text-xs text-text-muted">Disponible après {FORECAST_MIN_DAYS} jours complets dans le mois.</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
            <div>
              <p className="font-mono text-xl font-medium tabular-nums text-text">{missed(stats)}</p>
              <p className="text-xs text-text-muted">votes manqués</p>
            </div>
            <div>
              <p className="font-mono text-xl font-medium tabular-nums text-text">{stats.manual}</p>
              <p className="text-xs text-text-muted">validés à la main</p>
            </div>
          </div>
        </Card>

        {stats.votes + stats.chances === 0 ? (
          <Card>
            <p className="text-sm text-text-muted">
              Rien sur cette période. Les statistiques se remplissent au fil de tes votes faits depuis l'extension.
            </p>
          </Card>
        ) : (
          <Card className="min-w-0">
            <h2 className="mb-2 text-sm font-semibold text-text">Votes par jour</h2>
            <BarChart bars={dayBars} ariaLabel="Votes par jour" />
          </Card>
        )}
      </div>

      {stats.votes + stats.chances > 0 && (
        <>
          <Card className="flex min-w-0 flex-col gap-3">
            <h2 className="text-sm font-semibold text-text">Par site de vote</h2>
            {sites.map(([host, c]) => (
              <div key={host} className="flex min-w-0 flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 break-all text-text">{host}</span>
                  <span className="shrink-0 text-xs text-text-muted">
                    {missed(c)} manqué{missed(c) > 1 ? 's' : ''} · {successRate(c)} % ·{' '}
                    <span className="font-mono text-sm tabular-nums text-text">{c.votes}</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-alt">
                  <div className="h-1.5 rounded-full bg-accent" style={{ width: `${(100 * c.votes) / topVotes}%` }} />
                </div>
              </div>
            ))}
          </Card>

          <Card className="min-w-0">
            <h2 className="mb-2 text-sm font-semibold text-text">Heures où je vote le plus</h2>
            <BarChart bars={hourBars} ariaLabel="Votes par heure de la journée" />
            {stats.votes > 0 && (
              <p className="mt-2 text-xs text-text-muted">
                Surtout entre {bestHour} h et {bestHour + 1} h.
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
