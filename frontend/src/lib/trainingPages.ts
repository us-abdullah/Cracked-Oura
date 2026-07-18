import type { Dashboard } from '@/types';

/** Static Training “dashboards” that map to Hevy Insights SPA routes. */
export const TRAINING_PAGES: (Dashboard & { path: string })[] = [
    { id: 'hi-dashboard', name: 'Dashboard', path: '/dashboard', widgets: [], layout: [] },
    { id: 'hi-workouts-card', name: 'Workouts (Card)', path: '/workouts-card', widgets: [], layout: [] },
    { id: 'hi-workouts-list', name: 'Workouts (List)', path: '/workouts-list', widgets: [], layout: [] },
    { id: 'hi-exercises', name: 'Exercises', path: '/exercises', widgets: [], layout: [] },
    { id: 'hi-body-measurements', name: 'Body Measurements', path: '/body-measurements', widgets: [], layout: [] },
    { id: 'hi-settings', name: 'Settings', path: '/settings', widgets: [], layout: [] },
];

export const DEFAULT_TRAINING_PAGE_ID = TRAINING_PAGES[0].id;

export function trainingPathForId(id: string): string {
    return TRAINING_PAGES.find((p) => p.id === id)?.path ?? '/dashboard';
}
