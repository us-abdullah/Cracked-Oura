/**
 * Web stand-in for the Hevy Insights iframe.
 * Sidebar Training pages still navigate; content is a visual placeholder.
 */
import { LayoutDashboard, Dumbbell, List, BookOpen, Scale, Settings } from 'lucide-react';

const TITLES: Record<string, { title: string; blurb: string; Icon: typeof LayoutDashboard }> = {
  '/dashboard': {
    title: 'Dashboard',
    blurb: 'Training overview — volume, hours, streaks (live data on desktop).',
    Icon: LayoutDashboard,
  },
  '/workouts-card': {
    title: 'Workouts (Card)',
    blurb: 'Card view of recent sessions.',
    Icon: Dumbbell,
  },
  '/workouts-list': {
    title: 'Workouts (List)',
    blurb: 'List view of workout history.',
    Icon: List,
  },
  '/exercises': {
    title: 'Exercises',
    blurb: 'Exercise library, PRs, and progressions.',
    Icon: BookOpen,
  },
  '/body-measurements': {
    title: 'Body Measurements',
    blurb: 'Weight and measurement trends from Hevy.',
    Icon: Scale,
  },
  '/settings': {
    title: 'Settings',
    blurb: 'Hevy Insights preferences (weight units, date formats).',
    Icon: Settings,
  },
};

type Props = { routePath?: string };

export function HevyInsightsEmbed({ routePath = '/dashboard' }: Props) {
  const meta = TITLES[routePath] || TITLES['/dashboard'];
  const Icon = meta.Icon;

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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {['Total Workouts', 'Total Volume', 'Hours Trained', 'Avg Workout', 'Streak'].map(
          (label, i) => (
            <div key={label} className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <p className="text-xl font-semibold tabular-nums">
                {i === 0 ? '42' : i === 1 ? '128.4k kg' : i === 2 ? '36.2' : i === 3 ? '52m' : '3'}
              </p>
            </div>
          )
        )}
      </div>

      <div className="rounded-xl border bg-card p-6 min-h-[220px]">
        <p className="text-sm font-medium mb-2">Training Analysis</p>
        <div className="h-40 rounded-lg bg-muted/40 flex items-end gap-1 px-2 pb-2">
          {[40, 55, 35, 70, 60, 80, 45, 65, 75, 50, 85, 60].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t bg-violet-500/70"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Web mirror — full Hevy Insights data runs in the desktop app after Sync.
        </p>
      </div>
    </div>
  );
}
