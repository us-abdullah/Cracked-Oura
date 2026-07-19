/**
 * Export a real-data snapshot from the running desktop backend for Vercel/phone.
 *
 * Usage (desktop backend must be on :8000):
 *   npm run export:snapshot
 *
 * Writes web/public/mirror-snapshot.json — commit + redeploy for the phone site to update.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../public/mirror-snapshot.json');
const BASE = process.env.BIO_API || 'http://127.0.0.1:8000';

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function tryJson(url, fallback = null) {
  try {
    return await getJson(url);
  } catch {
    return fallback;
  }
}

/** Drop heavy intraday series so the phone JSON stays small. */
function slimDay(day) {
  if (!day || typeof day !== 'object') return day;
  const out = { ...day };
  if (out.activity && typeof out.activity === 'object') {
    const { met, class_5_min, ...rest } = out.activity;
    out.activity = rest;
  }
  if (Array.isArray(out.sleep_sessions)) {
    out.sleep_sessions = out.sleep_sessions.map((s) => {
      if (!s || typeof s !== 'object') return s;
      const {
        movement_30_sec,
        sleep_phase_5_min,
        sleep_phase_30_sec,
        hr_data,
        hrv_data,
        ...rest
      } = s;
      return rest;
    });
  }
  return out;
}

async function assembleFromApis() {
  const [
    settings,
    recovery_layout,
    health_layout,
    training_layout,
    hevy_status,
    health_calendar,
    health_rates,
    health_notes,
    health_body,
    health_bloodwork,
    sheets,
    hevy_heatmap,
    hevy_weekly_volume,
    hevy_durations,
    hevy_prs,
  ] = await Promise.all([
    getJson(`${BASE}/api/settings`),
    getJson(`${BASE}/api/dashboard`),
    tryJson(`${BASE}/api/health/dashboard`, { dashboards: [], activeDashboardId: null }),
    tryJson(`${BASE}/api/hevy/dashboard`, { dashboards: [], activeDashboardId: null }),
    tryJson(`${BASE}/api/hevy/status`, {}),
    tryJson(`${BASE}/api/health/supplements/calendar`, []),
    tryJson(`${BASE}/api/health/supplements/rates`, []),
    tryJson(`${BASE}/api/health/supplements/notes`, []),
    tryJson(`${BASE}/api/health/body`, []),
    tryJson(`${BASE}/api/health/bloodwork`, []),
    tryJson(`${BASE}/api/health/sheets`, {}),
    tryJson(`${BASE}/api/hevy/analytics/heatmap?weeks=26`, []),
    tryJson(`${BASE}/api/hevy/analytics/weekly-volume?weeks=12`, []),
    tryJson(`${BASE}/api/hevy/analytics/durations?days=90`, []),
    tryJson(`${BASE}/api/hevy/analytics/prs`, []),
  ]);

  return {
    version: 1,
    exported_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    recovery_layout,
    health_layout,
    training_layout,
    hevy_status,
    health_calendar,
    health_rates,
    health_notes,
    health_body,
    health_bloodwork,
    settings,
    sheets,
    hevy_heatmap,
    hevy_weekly_volume,
    hevy_durations,
    hevy_prs,
    days: {},
  };
}

async function main() {
  console.log(`Exporting phone snapshot from ${BASE} …`);

  let snap = await tryJson(`${BASE}/api/mirror/snapshot`, null);
  if (snap) {
    console.log('Using /api/mirror/snapshot');
  } else {
    console.log('Mirror endpoint missing — assembling from live APIs');
    snap = await assembleFromApis();
  }

  const dates = new Set();
  const today = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.add(d.toISOString().slice(0, 10));
  }
  for (const row of snap.health_calendar || []) {
    if (row?.date) dates.add(row.date);
  }

  const days = { ...(snap.days || {}) };
  let ok = 0;
  for (const iso of [...dates].sort()) {
    if (days[iso]) {
      days[iso] = slimDay(days[iso]);
      ok += 1;
      continue;
    }
    try {
      const day = slimDay(await getJson(`${BASE}/api/days/${iso}`));
      const score =
        day?.sleep?.score ?? day?.readiness?.score ?? day?.activity?.score;
      if (score != null) {
        days[iso] = day;
        ok += 1;
      }
    } catch {
      /* no row */
    }
  }
  snap.days = days;

  if (!snap.hevy_heatmap) {
    snap.hevy_heatmap = await tryJson(
      `${BASE}/api/hevy/analytics/heatmap?weeks=26`,
      []
    );
  }
  if (!snap.hevy_weekly_volume) {
    snap.hevy_weekly_volume = await tryJson(
      `${BASE}/api/hevy/analytics/weekly-volume?weeks=12`,
      []
    );
  }
  if (!snap.hevy_durations) {
    snap.hevy_durations = await tryJson(
      `${BASE}/api/hevy/analytics/durations?days=90`,
      []
    );
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snap));
  const mb = (fs.statSync(OUT).size / (1024 * 1024)).toFixed(2);
  console.log(
    `Wrote ${OUT} (${mb} MB)\n  recovery days: ${ok}\n  health calendar: ${(snap.health_calendar || []).length}\n  workouts: ${snap.hevy_status?.workout_count ?? 0}\n  exported_at: ${snap.exported_at}`
  );
}

main().catch((e) => {
  console.error(e);
  console.error('\nIs Usman Biotracker / backend running on :8000?');
  process.exit(1);
});
