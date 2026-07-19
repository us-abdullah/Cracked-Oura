/**
 * Web API backed by /mirror-snapshot.json (exported from desktop).
 * Used on Vercel so the phone UI shows your real data without a live PC API.
 */
import type { ChatMessage } from './mockApi';

type Snapshot = {
  exported_at?: string;
  recovery_layout?: any;
  health_layout?: any;
  training_layout?: any;
  hevy_status?: any;
  health_calendar?: any[];
  health_rates?: any[];
  health_notes?: any[];
  health_body?: any[];
  health_bloodwork?: any[];
  days?: Record<string, any>;
  settings?: any;
  sheets?: any;
  hevy_heatmap?: any[];
  hevy_weekly_volume?: any[];
  hevy_workouts?: any[];
  hevy_durations?: any[];
  hevy_prs?: any[];
};

let cache: Snapshot | null = null;
let loadPromise: Promise<Snapshot> | null = null;

async function snap(): Promise<Snapshot> {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = (async () => {
      const res = await fetch(`/mirror-snapshot.json?_=${Date.now()}`);
      if (!res.ok) {
        throw new Error(
          'No phone snapshot found. On your PC run: npm run export:snapshot (with desktop app open), commit, and redeploy.'
        );
      }
      cache = (await res.json()) as Snapshot;
      return cache;
    })();
  }
  return loadPromise;
}

const ok = async <T>(data: T, ms = 20): Promise<T> => {
  await new Promise((r) => setTimeout(r, ms));
  return data;
};

const desktopOnly = async (action: string) =>
  ok({
    message: `“${action}” runs on the desktop app. Refresh the phone snapshot after Sync there.`,
    status: 'ok',
  });

/** Match desktop useOuraData: widgets use singular sleep_session = longest session. */
function longestSleepSession(day: any) {
  const sessions = day?.sleep_sessions;
  if (!Array.isArray(sessions) || sessions.length === 0) return null;
  return sessions.reduce((longest: any, current: any) => {
    if (!longest) return current;
    return (current.total_sleep_duration || 0) > (longest.total_sleep_duration || 0)
      ? current
      : longest;
  }, null);
}

function resolveDayPath(day: any, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) return undefined;

  let root: any = day;
  if (parts[0] === 'sleep_session') {
    root = longestSleepSession(day);
    parts.shift();
    if (parts.length === 0) return root;
  }

  let v: any = root;
  for (const p of parts) {
    if (v == null) return undefined;
    v = v[p];
  }
  return v;
}

export type { ChatMessage };

export interface AutomationStatusResponse {
  status:
    | 'idle'
    | 'login_needed'
    | 'otp_needed'
    | 'logged_in'
    | 'exporting'
    | 'ready_to_download'
    | 'downloading'
    | 'completed'
    | 'error';
  message?: string;
}

export const api = {
  getSettings: async () => ok((await snap()).settings || {}),
  saveSettings: (_s: Record<string, unknown>) => desktopOnly('Save settings'),
  clearSession: () => desktopOnly('Clear session'),
  startLogin: () => desktopOnly('Oura login'),
  submitOtp: () => desktopOnly('Submit OTP'),
  requestExport: () => desktopOnly('Request export'),
  checkStatus: async (): Promise<AutomationStatusResponse> =>
    ok({ status: 'logged_in', message: 'Snapshot mode' }),
  downloadExport: () => desktopOnly('Download export'),
  uploadZip: () => desktopOnly('Upload ZIP'),

  getDailyData: async (date: string) => {
    const s = await snap();
    // Exact date only — do NOT fall back to a previous day (breaks snap-to-latest + charts).
    const day = s.days?.[date];
    return ok(day || {});
  },

  getQuery: async (path: string, startDate?: string, endDate?: string) => {
    const s = await snap();
    const start = startDate || '2000-01-01';
    const end = endDate || '2100-01-01';
    const points: { date: string; value: unknown }[] = [];
    for (const [iso, day] of Object.entries(s.days || {})) {
      if (iso < start || iso > end) continue;
      const v = resolveDayPath(day, path);
      // Keep numbers, strings, arrays, objects — overnight HR/HRV/phases are series.
      if (v === undefined || v === null) continue;
      points.push({ date: iso, value: v });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    return ok(points);
  },

  getSchema: async () =>
    ok({
      sleep: ['score', 'contributors'],
      readiness: ['score', 'contributors'],
      activity: ['score', 'steps', 'contributors'],
      sleep_session: [
        'total_sleep_duration',
        'average_hrv',
        'lowest_heart_rate',
        'hr_data',
        'hrv_data',
        'sleep_phase_5_min',
      ],
    }),

  getTrends: async (metric: string, startDate: string, endDate: string) =>
    api.getQuery(metric, startDate, endDate),

  getLayout: async () => {
    const s = await snap();
    return ok(
      s.recovery_layout || { dashboards: [], activeDashboardId: null }
    );
  },
  saveLayout: () => desktopOnly('Save layout'),

  getCompartmentLayout: async (compartment: 'training' | 'health') => {
    const s = await snap();
    if (compartment === 'health') {
      return ok(s.health_layout || { dashboards: [], activeDashboardId: null });
    }
    return ok(s.training_layout || { dashboards: [], activeDashboardId: null });
  },
  saveCompartmentLayout: () => desktopOnly('Save layout'),

  hevyStatus: async () => ok((await snap()).hevy_status || { has_local_data: false }),
  hevyLogin: () => desktopOnly('Hevy login'),
  hevyLoginBrowser: () => desktopOnly('Hevy Google login'),
  hevySync: () => desktopOnly('Hevy sync'),
  hevyLogout: () => desktopOnly('Hevy logout'),
  hevyHeatmap: async () => ok((await snap()).hevy_heatmap || []),
  hevyVolumeByMuscle: async () => ok([]),
  hevyOverload: async () => ok({ exercise: null, points: [] }),
  hevyPRs: async () => ok((await snap()).hevy_prs || []),
  hevyDurations: async () => ok((await snap()).hevy_durations || []),
  hevyWeeklyVolume: async () => ok((await snap()).hevy_weekly_volume || []),
  hevyExercises: async () => ok([]),
  hevyWorkouts: async () => ok((await snap()).hevy_workouts || []),

  healthCalendar: async () => ok((await snap()).health_calendar || []),
  healthRates: async () => ok((await snap()).health_rates || []),
  healthNotes: async () => ok((await snap()).health_notes || []),
  healthBodyStatus: async () =>
    ok({ rows: ((await snap()).health_body || []).length }),
  healthBody: async () => ok((await snap()).health_body || []),
  healthBloodworkStatus: async () =>
    ok({ rows: ((await snap()).health_bloodwork || []).length }),
  healthBloodwork: async () => ok((await snap()).health_bloodwork || []),
  healthImport: () => desktopOnly('Health import'),
  healthSeed: () => desktopOnly('Health seed'),
  healthSheetsConfig: async () => ok((await snap()).sheets || {}),
  healthSheetsSave: () => desktopOnly('Save sheets config'),
  healthSheetsSync: () => desktopOnly('Sheets sync'),

  sendChatMessage: async (message: string, _history?: ChatMessage[]) =>
    ok({
      role: 'assistant',
      content: `Phone snapshot mode — AI chat runs on desktop. (You said: “${message}”)`,
      thoughts: [],
    }),
};
