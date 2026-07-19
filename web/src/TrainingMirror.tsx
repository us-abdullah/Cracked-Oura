/**
 * Web stand-in for the Hevy Insights iframe — uses exported snapshot stats.
 */
import { useEffect, useState } from 'react';
import { LayoutDashboard, Dumbbell, List, BookOpen, Scale, Settings } from 'lucide-react';
import { api } from '@/lib/api';

const TITLES: Record<string, { title: string; blurb: string; Icon: typeof LayoutDashboard }> = {
  '/dashboard': {
    title: 'Dashboard',
    blurb: 'Training overview from your last desktop export.',
    Icon: LayoutDashboard,
  },
  '/workouts-card': {
    title: 'Workouts (Card)',
    blurb: 'Card view summary from snapshot.',
    Icon: Dumbbell,
  },
  '/workouts-list': {
    title: 'Workouts (List)',
    blurb: 'Workout history counts from snapshot.',
    Icon: List,
  },
  '/exercises': {
    title: 'Exercises',
    blurb: 'Exercise library lives on desktop Hevy Insights.',
    Icon: BookOpen,
  },
  '/body-measurements': {
    title: 'Body Measurements',
    blurb: 'Body trends from Health compartment when synced.',
    Icon: Scale,
  },
  '/settings': {
    title: 'Settings',
    blurb: 'Configure Hevy sync in the desktop app.',
    Icon: Settings,
  },
};

type Props = { routePath?: string };

function fmtVolume(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M kg`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k kg`;
  return `${Math.round(n)} kg`;
}

export function HevyInsightsEmbed({ routePath = '/dashboard' }: Props) {
  const meta = TITLES[routePath] || TITLES['/dashboard'];
  const Icon = meta.Icon;
  const [status, setStatus] = useState<any>(null);
  const [heatmap, setHeatmap] = useState<any[]>([]);
  const [weekly, setWeekly] = useState<any[]>([]);

  useEffect(() => {
    api.hevyStatus().then(setStatus).catch(() => setStatus(null));
    api.hevyHeatmap().then(setHeatmap).catch(() => setHeatmap([]));
    api.hevyWeeklyVolume().then(setWeekly).catch(() => setWeekly([]));
  }, []);

  const workouts = status?.workout_count ?? 0;
  const volumeTotal = Array.isArray(weekly)
    ? weekly.reduce((s, w) => s + (Number(w.volume ?? w.total_volume ?? 0) || 0), 0)
    : 0;
  const heatVals = (heatmap || [])
    .map((d) => Number(d.count ?? d.value ?? d.workouts ?? 0) || 0)
    .filter((n) => n > 0);
  const recentBars =
    weekly?.length > 0
      ? weekly.slice(-12).map((w) => Number(w.volume ?? w.total_volume ?? 0) || 0)
      : heatVals.slice(-12);
  const maxBar = Math.max(1, ...recentBars);

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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Total Workouts</p>
          <p className="text-xl font-semibold tabular-nums">{workouts || '—'}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Account</p>
          <p className="text-xl font-semibold truncate">
            {status?.username || status?.email || '—'}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Local data</p>
          <p className="text-xl font-semibold">
            {status?.has_local_data ? 'Yes' : 'No'}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Volume (snapshot)</p>
          <p className="text-xl font-semibold tabular-nums">
            {volumeTotal > 0 ? fmtVolume(volumeTotal) : '—'}
          </p>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6 min-h-[220px]">
        <p className="text-sm font-medium mb-2">Recent training</p>
        <div className="h-40 rounded-lg bg-muted/40 flex items-end gap-1 px-2 pb-2">
          {(recentBars.length
            ? recentBars
            : Array.from({ length: 12 }, () => 0)
          ).map((v, i) => (
            <div
              key={i}
              className="flex-1 rounded-t bg-violet-500/70 min-h-[4px]"
              style={{ height: `${Math.max(4, (v / maxBar) * 100)}%` }}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Phone mirror uses your last desktop export. Full Hevy Insights charts stay on desktop.
        </p>
      </div>
    </div>
  );
}
