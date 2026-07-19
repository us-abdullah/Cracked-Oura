/**
 * Web-only API shim — same method surface as frontend/src/lib/api.ts.
 * Desktop scraping/sync actions are no-ops so the UI stays intact without a backend.
 */
import {
  buildBloodwork,
  buildBodySeries,
  buildHealthCalendar,
  buildHealthNotes,
  buildHealthRates,
  dailyDataFor,
  healthLayout,
  recoveryLayout,
  trainingLayout,
} from './fixtures';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  thoughts?: any[];
}

const LS_RECOVERY = 'web-mirror-recovery-layout';
const LS_HEALTH = 'web-mirror-health-layout';
const LS_TRAINING = 'web-mirror-training-layout';

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

function saveJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

const ok = async <T>(data: T, ms = 40): Promise<T> => {
  await new Promise((r) => setTimeout(r, ms));
  return data;
};

const webOnly = async (action: string) =>
  ok({
    message: `Web mirror — “${action}” is desktop-only. UI is identical; scraping runs in the Electron app.`,
    status: 'ok',
  });

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
  getSettings: async () =>
    ok({
      email: 'you@example.com',
      daily_sync_time: '11:00',
      schedule_time: '11:00',
      llm_model: 'llama3.2:3b',
      llm_host: 'http://localhost:11434',
      llm_reasoning: false,
      llm_num_ctx: 4096,
      status: 'Idle',
    }),

  saveSettings: async (settings: Record<string, unknown>) => {
    saveJson('web-mirror-settings', settings);
    return ok({ message: 'Saved locally (web mirror)' });
  },

  clearSession: () => webOnly('Clear session'),
  startLogin: () => webOnly('Oura login'),
  submitOtp: () => webOnly('Submit OTP'),
  requestExport: () => webOnly('Request export'),
  checkStatus: async (): Promise<AutomationStatusResponse> =>
    ok({ status: 'logged_in', message: 'Web mirror demo' }),
  downloadExport: () => webOnly('Download export'),
  uploadZip: () => webOnly('Upload ZIP'),

  getDailyData: async (date: string) => ok(dailyDataFor(date)),

  getQuery: async (path: string, startDate?: string, endDate?: string) => {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 14 * 86400000);
    const end = endDate ? new Date(endDate) : new Date();
    const points: { date: string; value: number }[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const seed = iso.length + path.length;
      points.push({ date: iso, value: 60 + (seed % 35) });
    }
    return ok(points);
  },

  getSchema: async () =>
    ok({
      sleep: ['score', 'contributors'],
      readiness: ['score', 'contributors'],
      activity: ['score', 'steps', 'contributors'],
      sleep_session: ['total_sleep_duration', 'average_hrv', 'lowest_heart_rate'],
    }),

  getTrends: async (metric: string, startDate: string, endDate: string) =>
    api.getQuery(metric, startDate, endDate),

  getLayout: async () => ok(loadJson(LS_RECOVERY, recoveryLayout)),
  saveLayout: async (layout: unknown) => {
    saveJson(LS_RECOVERY, layout);
    return ok({ message: 'ok' });
  },

  getCompartmentLayout: async (compartment: 'training' | 'health') => {
    if (compartment === 'health') return ok(loadJson(LS_HEALTH, healthLayout));
    return ok(loadJson(LS_TRAINING, trainingLayout));
  },

  saveCompartmentLayout: async (compartment: 'training' | 'health', layout: unknown) => {
    saveJson(compartment === 'health' ? LS_HEALTH : LS_TRAINING, layout);
    return ok({ message: 'ok' });
  },

  hevyStatus: async () =>
    ok({
      status: 'Idle',
      email: 'you@example.com',
      username: 'demo',
      logged_in: false,
      has_local_data: true,
      workout_count: 42,
      last_run: new Date().toISOString(),
      schedule_time: '11:30',
    }),
  hevyLogin: () => webOnly('Hevy login'),
  hevyLoginBrowser: () => webOnly('Hevy Google login'),
  hevySync: () => webOnly('Hevy sync'),
  hevyLogout: () => webOnly('Hevy logout'),
  hevyHeatmap: async () => ok([]),
  hevyVolumeByMuscle: async () => ok([]),
  hevyOverload: async () => ok({ exercise: null, points: [] }),
  hevyPRs: async () => ok([]),
  hevyDurations: async () => ok([]),
  hevyWeeklyVolume: async () => ok([]),
  hevyExercises: async () => ok([]),

  healthCalendar: async () => ok(buildHealthCalendar()),
  healthRates: async () => ok(buildHealthRates()),
  healthNotes: async () => ok(buildHealthNotes()),
  healthBodyStatus: async () => ok({ rows: buildBodySeries().length }),
  healthBody: async () => ok(buildBodySeries()),
  healthBloodworkStatus: async () => ok({ rows: buildBloodwork().length }),
  healthBloodwork: async () => ok(buildBloodwork()),
  healthImport: () => webOnly('Health CSV import'),
  healthSeed: () => webOnly('Health seed'),
  healthSheetsConfig: async () =>
    ok({
      supplements_url: 'https://docs.google.com/spreadsheets/... (desktop)',
      body_url: '',
      bloodwork_url: '',
      sync_minutes: 5,
      last_sync: 'web-mirror',
      last_status: 'demo',
      last_counts: { supplements: 30, body: 10, bloodwork: 1 },
    }),
  healthSheetsSave: () => webOnly('Save sheets config'),
  healthSheetsSync: () => webOnly('Sheets sync'),

  sendChatMessage: async (message: string, _history: ChatMessage[]) =>
    ok({
      role: 'assistant',
      content: `Web mirror demo reply to: “${message}”. Connect the desktop app for real local LLM answers.`,
      thoughts: [],
    }),
};
