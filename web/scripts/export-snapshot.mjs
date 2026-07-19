/**
 * Export a real-data snapshot from the running desktop backend for Vercel/phone.
 *
 * Usage (desktop backend must be on :8000):
 *   npm run export:snapshot
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

/**
 * Keep overnight chart series (hr_data / hrv_data / sleep_phase_5_min).
 * Drop only the huge unused series (movement, 30s phases, MET grid).
 */
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
        sleep_phase_30_sec,
        // keep: hr_data, hrv_data, sleep_phase_5_min
        ...rest
      } = s;
      return rest;
    });
  }
  return out;
}

/** Keep sets for Hevy Insights Vue; drop media + locale title bloat. */
function exportWorkout(w) {
  if (!w || typeof w !== 'object') return w;
  const exercises = Array.isArray(w.exercises)
    ? w.exercises.map((ex) => {
        const sets = Array.isArray(ex.sets)
          ? ex.sets.map((s) => ({
              id: s.id,
              index: s.index,
              weight_kg: s.weight_kg,
              reps: s.reps,
              rpe: s.rpe,
              indicator: s.indicator || s.set_type,
              set_type: s.set_type || s.indicator,
              prs: s.prs || [],
              completed_at: s.completed_at,
              distance_meters: s.distance_meters,
              duration_seconds: s.duration_seconds,
              custom_metric: s.custom_metric,
            }))
          : [];
        return {
          id: ex.id,
          title: ex.title,
          muscle_group: ex.muscle_group,
          exercise_type: ex.exercise_type,
          equipment_category: ex.equipment_category,
          exercise_template_id: ex.exercise_template_id,
          notes: ex.notes || '',
          index: ex.index,
          rest_seconds: ex.rest_seconds,
          other_muscles: ex.other_muscles,
          sets,
        };
      })
    : [];

  return {
    id: w.id || w.short_id,
    short_id: w.short_id,
    name: w.name || w.title || 'Workout',
    title: w.name || w.title || 'Workout',
    start_time: w.start_time,
    end_time: w.end_time,
    estimated_volume_kg: w.estimated_volume_kg ?? null,
    username: w.username || null,
    nth_workout: w.nth_workout ?? null,
    description: w.description || '',
    exercises,
  };
}

async function fetchAllHiWorkouts() {
  const all = [];
  const seen = new Set();
  const pageSize = 5; // running backend pages with offset=, limit 5
  for (let offset = 0; offset < 2000; offset += pageSize) {
    const data = await tryJson(
      `${BASE}/api/hi/workouts?offset=${offset}`,
      null
    );
    const batch = data?.workouts || [];
    if (!batch.length) break;
    let added = 0;
    for (const w of batch) {
      const row = exportWorkout(w);
      const id = row.id || `${row.start_time}-${row.name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      all.push(row);
      added += 1;
    }
    if (batch.length < pageSize || added === 0) break;
  }
  return all;
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
    hevy_weekly_volume: [],
    hevy_durations: [],
    hevy_prs: [],
    hevy_workouts: [],
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
    if (days[iso] && Object.keys(days[iso]).length) {
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

  if (!snap.hevy_heatmap?.length) {
    snap.hevy_heatmap = await tryJson(
      `${BASE}/api/hevy/analytics/heatmap?weeks=26`,
      []
    );
  }

  console.log('Fetching Hevy workouts pages…');
  snap.hevy_workouts = await fetchAllHiWorkouts();

  // Enrich status from workouts if username missing
  if (snap.hevy_status && !snap.hevy_status.username && snap.hevy_workouts[0]?.username) {
    snap.hevy_status = {
      ...snap.hevy_status,
      username: snap.hevy_workouts[0].username,
    };
  }
  if (snap.hevy_status && !snap.hevy_status.workout_count) {
    snap.hevy_status.workout_count = snap.hevy_workouts.length;
  }

  // Derive weekly volume bars from workout volumes when analytics route missing
  if (!snap.hevy_weekly_volume?.length && snap.hevy_workouts.length) {
    const byWeek = new Map();
    for (const w of snap.hevy_workouts) {
      if (typeof w.start_time !== 'number') continue;
      const d = new Date(w.start_time * 1000);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
      const key = weekStart.toISOString().slice(0, 10);
      byWeek.set(key, (byWeek.get(key) || 0) + (Number(w.estimated_volume_kg) || 0));
    }
    snap.hevy_weekly_volume = [...byWeek.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, volume]) => ({ date, volume }));
  }

  if (!snap.hevy_durations?.length && snap.hevy_workouts.length) {
    snap.hevy_durations = snap.hevy_workouts
      .map((w) => {
        let minutes = null;
        if (
          typeof w.start_time === 'number' &&
          typeof w.end_time === 'number' &&
          w.end_time > w.start_time
        ) {
          minutes = Math.round((w.end_time - w.start_time) / 60);
        }
        return {
          date:
            typeof w.start_time === 'number'
              ? new Date(w.start_time * 1000).toISOString().slice(0, 10)
              : null,
          minutes,
          name: w.name,
        };
      })
      .filter((d) => d.date && d.minutes != null);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snap));
  const mb = (fs.statSync(OUT).size / (1024 * 1024)).toFixed(2);
  console.log(
    `Wrote ${OUT} (${mb} MB)\n  recovery days: ${ok}\n  health calendar: ${(snap.health_calendar || []).length}\n  workouts: ${snap.hevy_workouts?.length ?? 0}\n  heatmap days: ${snap.hevy_heatmap?.length ?? 0}\n  exported_at: ${snap.exported_at}`
  );
}

main().catch((e) => {
  console.error(e);
  console.error('\nIs Usman Biotracker / backend running on :8000?');
  process.exit(1);
});
