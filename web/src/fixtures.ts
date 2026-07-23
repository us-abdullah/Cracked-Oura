/** Demo fixtures for the web UI mirror — shapes match desktop API responses. */

export const recoveryLayout = {
  dashboards: [
    {
      id: 'default',
      name: 'Daily Overview',
      widgets: [
        {
          id: 'sleep-score',
          type: 'score',
          title: 'Sleep',
          width: 'col-span-4',
          height: 'h-40',
          config: { dataKey: 'sleep.score', color: '#8AB4F8' },
        },
        {
          id: 'readiness-score',
          type: 'score',
          title: 'Readiness',
          width: 'col-span-4',
          height: 'h-40',
          config: { dataKey: 'readiness.score', color: '#4ade80' },
        },
        {
          id: 'activity-score',
          type: 'score',
          title: 'Activity',
          width: 'col-span-4',
          height: 'h-40',
          config: { dataKey: 'activity.score', color: '#f87171' },
        },
        {
          id: 'sleep-radar',
          type: 'radar',
          title: 'Sleep contributors',
          width: 'col-span-4',
          height: 'h-40',
          config: {
            dataKey: 'sleep.contributors',
            color: '#8AB4F8',
            dataKeys: ['sleep.contributors'],
          },
        },
        {
          id: 'readiness-radar',
          type: 'radar',
          title: 'Readiness contributors',
          width: 'col-span-4',
          height: 'h-40',
          config: {
            dataKey: 'readiness.contributors',
            color: '#4ade80',
            dataKeys: ['readiness.contributors'],
          },
        },
        {
          id: 'activity-radar',
          type: 'radar',
          title: 'Activity contributors',
          width: 'col-span-4',
          height: 'h-40',
          config: {
            dataKey: 'activity.contributors',
            color: '#f87171',
            dataKeys: ['activity.contributors'],
          },
        },
        {
          id: 'metric-sleep',
          type: 'metric',
          title: 'Total sleep',
          width: 'col-span-3',
          height: 'h-32',
          config: { dataKey: 'sleep_session.total_sleep_duration', color: '#8AB4F8' },
        },
        {
          id: 'metric-hrv',
          type: 'metric',
          title: 'Avg HRV',
          width: 'col-span-3',
          height: 'h-32',
          config: { dataKey: 'sleep_session.average_hrv', color: '#c084fc', unit: 'ms' },
        },
        {
          id: 'metric-rhr',
          type: 'metric',
          title: 'Resting HR',
          width: 'col-span-3',
          height: 'h-32',
          config: {
            dataKey: 'sleep_session.lowest_heart_rate',
            color: '#f87171',
            unit: 'bpm',
          },
        },
        {
          id: 'metric-steps',
          type: 'metric',
          title: 'Steps',
          width: 'col-span-3',
          height: 'h-32',
          config: { dataKey: 'activity.steps', color: '#fb923c' },
        },
      ],
      layout: [
        { i: 'sleep-score', x: 0, y: 0, w: 4, h: 6 },
        { i: 'readiness-score', x: 4, y: 0, w: 4, h: 6 },
        { i: 'activity-score', x: 8, y: 0, w: 4, h: 6 },
        { i: 'sleep-radar', x: 0, y: 6, w: 4, h: 8 },
        { i: 'readiness-radar', x: 4, y: 6, w: 4, h: 8 },
        { i: 'activity-radar', x: 8, y: 6, w: 4, h: 8 },
        { i: 'metric-sleep', x: 0, y: 14, w: 3, h: 5 },
        { i: 'metric-hrv', x: 3, y: 14, w: 3, h: 5 },
        { i: 'metric-rhr', x: 6, y: 14, w: 3, h: 5 },
        { i: 'metric-steps', x: 9, y: 14, w: 3, h: 5 },
      ],
    },
    {
      id: 'trends',
      name: 'Trends',
      widgets: [],
      layout: [],
    },
  ],
  activeDashboardId: 'default',
};

export const healthLayout = {
  dashboards: [
    {
      id: 'health-overview',
      name: 'Supplement Tracker',
      widgets: [
        {
          id: '1',
          type: 'health_adherence_calendar',
          title: 'Supplement Adherence',
          width: 'col-span-8',
          height: 'h-80',
          config: {},
        },
        {
          id: '2',
          type: 'health_adherence_rates',
          title: 'Per-Supplement Adherence',
          width: 'col-span-4',
          height: 'h-80',
          config: {},
        },
        {
          id: '3',
          type: 'health_notes',
          title: 'Notes',
          width: 'col-span-4',
          height: 'h-48',
          config: {},
        },
        {
          id: '4',
          type: 'health_body',
          title: 'Weight & Body Metrics',
          width: 'col-span-8',
          height: 'h-64',
          config: {},
        },
        {
          id: '5',
          type: 'health_bloodwork',
          title: 'Bloodwork',
          width: 'col-span-12',
          height: 'h-64',
          config: {},
        },
      ],
      layout: [
        { i: '1', x: 0, y: 0, w: 8, h: 14 },
        { i: '2', x: 8, y: 0, w: 4, h: 14 },
        { i: '3', x: 0, y: 14, w: 4, h: 8 },
        { i: '4', x: 4, y: 14, w: 8, h: 8 },
        { i: '5', x: 0, y: 22, w: 12, h: 10 },
      ],
    },
  ],
  activeDashboardId: 'health-overview',
};

export const trainingLayout = {
  dashboards: [
    {
      id: 'hevy-insights',
      name: 'Hevy Insights',
      widgets: [],
      layout: [],
    },
  ],
  activeDashboardId: 'hevy-insights',
};

export function dailyDataFor(_date: string) {
  return {
    sleep: {
      score: 78,
      contributors: {
        total_sleep: 82,
        efficiency: 90,
        restfulness: 74,
        rem_sleep: 70,
        deep_sleep: 68,
        latency: 85,
        timing: 80,
      },
    },
    readiness: {
      score: 81,
      contributors: {
        previous_night: 78,
        sleep_balance: 84,
        previous_day_activity: 72,
        activity_balance: 80,
        body_temperature: 90,
        resting_heart_rate: 88,
        hrv_balance: 76,
        recovery_index: 82,
        sleep_regularity: 79,
      },
    },
    activity: {
      score: 72,
      steps: 8420,
      contributors: {
        stay_active: 70,
        move_every_hour: 65,
        meet_daily_targets: 80,
        training_frequency: 75,
        training_volume: 68,
        recovery_time: 72,
      },
    },
    sleep_session: {
      total_sleep_duration: 25200,
      average_hrv: 63,
      lowest_heart_rate: 48,
    },
  };
}

const CORE = [
  'Creatine',
  'Omega3',
  'Multivitamin',
  'D3K2',
  'Taurine',
  'Magnesium Glycinate',
  'Glycine',
  'L-Theanine',
  'Apigenin',
] as const;

const EXTRA = [
  'Ashwagandha KSM66',
  'Caffeine',
  'L-Citrulline',
  'NAC',
  'Beta-Alanine',
  "Lion's Mane",
  'Collagen Peptides',
  'Astaxanthin',
] as const;

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** ~30 demo days for the Health calendar */
export function buildHealthCalendar() {
  const out = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const taken: Record<string, number | null> = {};
    let hits = 0;
    let total = 0;
    let coreOk = true;
    for (const name of [...CORE, ...EXTRA]) {
      const miss = (d.getDate() + name.length) % 7 === 0;
      const v = miss ? 0 : 1;
      taken[name] = v;
      total += 1;
      hits += v;
      if ((CORE as readonly string[]).includes(name) && v === 0) coreOk = false;
    }
    const pct = Math.round((hits / total) * 1000) / 10;
    const coreHits = CORE.filter((n) => taken[n] === 1).length;
    const corePct = (coreHits / CORE.length) * 100;
    const color = coreOk ? 'green' : corePct >= 50 ? 'yellow' : 'red';
    out.push({
      date: iso,
      day: d.toLocaleDateString('en-US', { weekday: 'long' }),
      pct,
      color,
      taken,
      notes: i === 0 ? 'Demo note for today' : i === 3 ? 'Felt good' : '',
    });
  }
  return out;
}

export function buildHealthRates() {
  const cal = buildHealthCalendar();
  return [...CORE, ...EXTRA].map((name) => {
    const tracked = cal.map((d) => d.taken[name]).filter((v) => v !== null);
    const taken = tracked.filter((v) => v === 1).length;
    return {
      name,
      pct: tracked.length ? Math.round((taken / tracked.length) * 1000) / 10 : null,
      taken,
      total: tracked.length,
    };
  }).sort((a, b) => (b.pct || 0) - (a.pct || 0));
}

export function buildHealthNotes() {
  return [
    { date: buildHealthCalendar().at(-1)?.date, source: 'supplements', notes: 'Demo note for today' },
    { date: buildHealthCalendar().at(-4)?.date, source: 'supplements', notes: 'Felt good' },
  ];
}

export function buildBodySeries() {
  const cal = buildHealthCalendar();
  return cal.filter((_, i) => i % 3 === 0).map((d, i) => ({
    date: d.date,
    weight: 175 - i * 0.2,
    body_fat_pct: 14.5 - i * 0.05,
    notes: '',
  }));
}

export function buildBloodwork() {
  return [
    {
      date: '2026-06-01',
      total_cholesterol: 168,
      hdl: 52,
      ldl: 98,
      triglycerides: 90,
      fasting_glucose: 88,
      hba1c: 5.1,
      vitamin_d: 42,
      vitamin_b12: 610,
      iron: 95,
      ferritin: 110,
      magnesium: 2.1,
      zinc: 88,
      testosterone: 620,
      notes: '',
    },
  ];
}

export function buildNutritionSeries() {
  const cal = buildHealthCalendar();
  return cal.filter((_, i) => i % 2 === 0).map((d, i) => ({
    date: d.date,
    calories: 2100 + (i % 5) * 40,
    protein: 120 + (i % 4) * 15,
    carbs: 200 + (i % 3) * 20,
    fat: 60 + (i % 3) * 5,
    fiber: 25 + (i % 4),
    sugar: 35 + (i % 5) * 2,
    water: 2.5 + (i % 3) * 0.2,
    notes: i === 0 ? 'Demo macro day' : '',
  }));
}

export function buildNutritionCalendar() {
  return buildNutritionSeries().map((r) => {
    const protein = r.protein;
    const target = 140;
    const ok = 98;
    const color =
      protein >= target ? 'green' : protein >= ok ? 'yellow' : 'red';
    return {
      ...r,
      pct: Math.round(Math.min(100, (protein / target) * 100) * 10) / 10,
      color,
      targets: { protein_g: target, protein_ok_g: ok, calories: 2200 },
    };
  });
}

export function buildNutritionNotes() {
  return buildNutritionSeries()
    .filter((r) => r.notes)
    .map((r) => ({ date: r.date, notes: r.notes, source: 'nutrition' }));
}
