/**
 * Phone/Vercel Training stand-in — real heatmap + recent workouts from snapshot.
 * (Full Hevy Insights Vue SPA still requires the desktop backend.)
 */
import { useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  Dumbbell,
  List,
  BookOpen,
  Scale,
  Settings,
} from 'lucide-react';
import { api } from '@/lib/api';

const TITLES: Record<
  string,
  { title: string; blurb: string; Icon: typeof LayoutDashboard }
> = {
  '/dashboard': {
    title: 'Dashboard',
    blurb: 'Training overview from your last desktop export.',
    Icon: LayoutDashboard,
  },
  '/workouts-card': {
    title: 'Workouts',
    blurb: 'Recent sessions from your last desktop export.',
    Icon: Dumbbell,
  },
  '/workouts-list': {
    title: 'Workouts (List)',
    blurb: 'Recent sessions from your last desktop export.',
    Icon: List,
  },
  '/exercises': {
    title: 'Exercises',
    blurb: 'Muscle groups from recent exported workouts.',
    Icon: BookOpen,
  },
  '/body-measurements': {
    title: 'Body Measurements',
    blurb: 'Use the Health compartment for body metrics on phone.',
    Icon: Scale,
  },
  '/settings': {
    title: 'Settings',
    blurb: 'Configure Hevy sync in the desktop app, then re-export.',
    Icon: Settings,
  },
};

type Props = { routePath?: string };

type Workout = {
  id?: string;
  name?: string;
  start_time?: number;
  minutes?: number | null;
  estimated_volume_kg?: number | null;
  username?: string | null;
  exercises?: { title: string; muscle_group?: string | null }[];
};

function fmtVolume(n: number) {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M kg`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k kg`;
  return `${Math.round(n)} kg`;
}

function fmtWhen(unix?: number) {
  if (!unix) return '—';
  try {
    return new Date(unix * 1000).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function heatColor(count: number, max: number) {
  if (!count) return 'bg-muted/40';
  const t = count / Math.max(1, max);
  if (t > 0.75) return 'bg-violet-500';
  if (t > 0.5) return 'bg-violet-500/75';
  if (t > 0.25) return 'bg-violet-500/50';
  return 'bg-violet-500/30';
}

function WorkoutList({ workouts }: { workouts: Workout[] }) {
  if (!workouts.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No workouts in snapshot. Sync Hevy on desktop, then re-export.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {workouts.map((w) => (
        <div key={w.id || `${w.start_time}-${w.name}`} className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium">{w.name || 'Workout'}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{fmtWhen(w.start_time)}</p>
            </div>
            <div className="text-right text-sm tabular-nums">
              <p>{fmtVolume(Number(w.estimated_volume_kg) || 0)}</p>
              <p className="text-xs text-muted-foreground">
                {w.minutes != null ? `${w.minutes} min` : '—'}
              </p>
            </div>
          </div>
          {!!w.exercises?.length && (
            <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
              {w.exercises.map((e) => e.title).slice(0, 6).join(' · ')}
              {w.exercises.length > 6 ? '…' : ''}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export function HevyInsightsEmbed({ routePath = '/dashboard' }: Props) {
  const meta = TITLES[routePath] || TITLES['/dashboard'];
  const Icon = meta.Icon;
  const [status, setStatus] = useState<any>(null);
  const [heatmap, setHeatmap] = useState<{ date: string; count: number }[]>([]);
  const [weekly, setWeekly] = useState<{ date: string; volume?: number }[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);

  useEffect(() => {
    api.hevyStatus().then(setStatus).catch(() => setStatus(null));
    api.hevyHeatmap().then((h) => setHeatmap(Array.isArray(h) ? h : [])).catch(() => setHeatmap([]));
    api.hevyWeeklyVolume().then((w) => setWeekly(Array.isArray(w) ? w : [])).catch(() => setWeekly([]));
    const loadWorkouts = (api as any).hevyWorkouts;
    if (typeof loadWorkouts === 'function') {
      loadWorkouts().then((w: Workout[]) => setWorkouts(Array.isArray(w) ? w : [])).catch(() => setWorkouts([]));
    }
  }, []);

  const maxHeat = useMemo(
    () => Math.max(1, ...heatmap.map((d) => Number(d.count) || 0)),
    [heatmap]
  );

  const heatCells = useMemo(() => {
    // Last ~26 weeks ending today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - 26 * 7 + 1);
    // Align to Monday
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const byDate = new Map(heatmap.map((d) => [d.date, Number(d.count) || 0]));
    const cells: { date: string; count: number }[] = [];
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      cells.push({ date: iso, count: byDate.get(iso) || 0 });
    }
    return cells;
  }, [heatmap]);

  const volumeTotal = useMemo(() => {
    if (weekly.length) {
      return weekly.reduce((s, w) => s + (Number(w.volume) || 0), 0);
    }
    return workouts.reduce((s, w) => s + (Number(w.estimated_volume_kg) || 0), 0);
  }, [weekly, workouts]);

  const recentBars = useMemo(() => {
    if (weekly.length) {
      return weekly.slice(-12).map((w) => Number(w.volume) || 0);
    }
    // fallback: weekly buckets from heatmap counts
    const last = heatmap.slice(-84);
    const buckets: number[] = [];
    for (let i = 0; i < last.length; i += 7) {
      buckets.push(last.slice(i, i + 7).reduce((s, d) => s + (Number(d.count) || 0), 0));
    }
    return buckets.slice(-12);
  }, [weekly, heatmap]);

  const maxBar = Math.max(1, ...recentBars);

  const muscleCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of workouts) {
      for (const ex of w.exercises || []) {
        const g = ex.muscle_group || 'other';
        m.set(g, (m.get(g) || 0) + 1);
      }
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [workouts]);

  const workoutsSorted = useMemo(
    () =>
      [...workouts].sort((a, b) => (b.start_time || 0) - (a.start_time || 0)),
    [workouts]
  );

  const showList =
    routePath === '/workouts-card' || routePath === '/workouts-list';
  const showExercises = routePath === '/exercises';

  return (
    <div className="absolute inset-0 bg-background overflow-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-lg bg-violet-600/20 text-violet-400 flex items-center justify-center">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-violet-400">{meta.title}</h2>
          <p className="text-sm text-muted-foreground">{meta.blurb}</p>
        </div>
      </div>

      {!showList && !showExercises && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Total Workouts</p>
              <p className="text-xl font-semibold tabular-nums">
                {status?.workout_count ?? workouts.length ?? '—'}
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Account</p>
              <p className="text-xl font-semibold truncate">
                {status?.username ||
                  status?.email ||
                  workouts[0]?.username ||
                  '—'}
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Exported sessions</p>
              <p className="text-xl font-semibold tabular-nums">{workouts.length}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Volume (snapshot)</p>
              <p className="text-xl font-semibold tabular-nums">{fmtVolume(volumeTotal)}</p>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-6 mb-6">
            <p className="text-sm font-medium mb-3">Workout frequency</p>
            <div
              className="grid gap-[3px]"
              style={{ gridTemplateColumns: 'repeat(27, minmax(0, 1fr))', gridAutoFlow: 'column', gridTemplateRows: 'repeat(7, 10px)' }}
            >
              {heatCells.map((c) => (
                <div
                  key={c.date}
                  title={`${c.date}: ${c.count} workout${c.count === 1 ? '' : 's'}`}
                  className={`rounded-[2px] ${heatColor(c.count, maxHeat)}`}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">Last 26 weeks · from desktop export</p>
          </div>

          <div className="rounded-xl border bg-card p-6 mb-6">
            <p className="text-sm font-medium mb-2">Weekly volume</p>
            <div className="h-40 rounded-lg bg-muted/40 flex items-end gap-1 px-2 pb-2">
              {(recentBars.length ? recentBars : Array.from({ length: 12 }, () => 0)).map(
                (v, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t bg-violet-500/70 min-h-[4px]"
                    style={{ height: `${Math.max(4, (v / maxBar) * 100)}%` }}
                    title={String(Math.round(v))}
                  />
                )
              )}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-3">Recent workouts</p>
            <WorkoutList workouts={workoutsSorted.slice(0, 8)} />
          </div>
        </>
      )}

      {showList && <WorkoutList workouts={workoutsSorted.slice(0, 40)} />}

      {showExercises && (
        <div className="space-y-2">
          {muscleCounts.length === 0 && (
            <p className="text-sm text-muted-foreground">No exercise data in snapshot.</p>
          )}
          {muscleCounts.map(([muscle, count]) => (
            <div
              key={muscle}
              className="flex items-center justify-between rounded-xl border bg-card px-4 py-3"
            >
              <span className="capitalize">{muscle.replace(/_/g, ' ')}</span>
              <span className="tabular-nums text-muted-foreground">{count}</span>
            </div>
          ))}
        </div>
      )}

      {routePath === '/settings' && (
        <p className="text-sm text-muted-foreground mt-4">
          Sync and login run on desktop. After syncing, run{' '}
          <code className="text-xs">npm run export:snapshot</code> in <code className="text-xs">web/</code> and redeploy.
        </p>
      )}
    </div>
  );
}
