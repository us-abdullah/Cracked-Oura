/** API origin for Biotracker backend. Desktop defaults to localhost. */

const STORAGE_KEY = 'biotracker_api_base';

export function getApiBase(): string {
    try {
        const fromLs = localStorage.getItem(STORAGE_KEY)?.trim();
        if (fromLs) return fromLs.replace(/\/$/, '');
    } catch {
        /* ignore */
    }
    const fromEnv = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
    if (fromEnv) return fromEnv.replace(/\/$/, '');
    return 'http://localhost:8000';
}

export function setApiBase(url: string) {
    const cleaned = url.trim().replace(/\/$/, '');
    localStorage.setItem(STORAGE_KEY, cleaned);
}

export function clearApiBase() {
    localStorage.removeItem(STORAGE_KEY);
}

export function isCompanionMode(): boolean {
    return import.meta.env.VITE_COMPANION === 'true';
}

/** Hevy Insights SPA is served by the same backend. */
export function getHevyInsightsBase(): string {
    return `${getApiBase()}/hevy-insights/`;
}
