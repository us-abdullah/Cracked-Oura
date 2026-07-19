/** API origin. Desktop Electron uses localhost:8000; web can override via VITE_API_BASE. */
const BASE_URL =
    (typeof import.meta !== 'undefined' &&
        (import.meta as any).env?.VITE_API_BASE) ||
    'http://localhost:8000';

export interface AutomationStatusResponse {
    status: 'idle' | 'login_needed' | 'otp_needed' | 'logged_in' | 'exporting' | 'ready_to_download' | 'downloading' | 'completed' | 'error';
    message?: string;
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    thoughts?: any[];
}

export const api = {
    // --- Settings & Automation ---
    getSettings: async () => {
        const res = await fetch(`${BASE_URL}/api/settings`);
        if (!res.ok) throw new Error('Failed to fetch settings');
        return res.json();
    },

    saveSettings: async (settings: {
        daily_sync_time: string;
        email?: string;
        llm_model?: string;
        llm_host?: string;
        llm_reasoning?: boolean;
        llm_num_ctx?: number;
    }) => {
        const res = await fetch(`${BASE_URL}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        if (!res.ok) throw new Error('Failed to save settings');
        return res.json();
    },

    clearSession: async () => {
        const res = await fetch(`${BASE_URL}/api/automation/clear-session`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to clear session');
        return res.json();
    },

    startLogin: async (email: string) => {
        const res = await fetch(`${BASE_URL}/api/automation/start-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Login failed');
        return data;
    },

    submitOtp: async (otp: string) => {
        const res = await fetch(`${BASE_URL}/api/automation/submit-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ otp })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'OTP failed');
        return data;
    },

    requestExport: async () => {
        const res = await fetch(`${BASE_URL}/api/automation/request-export`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Export request failed');
        return data;
    },

    checkStatus: async (): Promise<AutomationStatusResponse> => {
        const res = await fetch(`${BASE_URL}/api/automation/check-status`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to check status');
        return res.json();
    },

    downloadExport: async () => {
        const res = await fetch(`${BASE_URL}/api/automation/download`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Download failed');
        return data;
    },

    uploadZip: async (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${BASE_URL}/api/ingest/zip`, {
            method: 'POST',
            body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Upload failed');
        return data;
    },

    // --- Dashboard Data ---
    getDailyData: async (date: string) => {
        const res = await fetch(`${BASE_URL}/api/days/${date}`);
        if (!res.ok) throw new Error('Failed to fetch daily data');
        return res.json();
    },

    getQuery: async (path: string, startDate?: string, endDate?: string) => {
        const params = new URLSearchParams({ path });
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);

        const res = await fetch(`${BASE_URL}/api/query?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch query data');
        return res.json();
    },

    getSchema: async () => {
        const res = await fetch(`${BASE_URL}/api/schema`);
        if (!res.ok) throw new Error('Failed to fetch schema');
        return res.json();
    },

    getTrends: async (metric: string, startDate: string, endDate: string) => {
        return api.getQuery(metric, startDate, endDate);
    },

    // --- Layout ---
    getLayout: async () => {
        const res = await fetch(`${BASE_URL}/api/dashboard`);
        if (!res.ok) throw new Error('Failed to fetch layout');
        return res.json();
    },

    saveLayout: async (layout: any) => {
        const res = await fetch(`${BASE_URL}/api/dashboard`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(layout)
        });
        if (!res.ok) throw new Error('Failed to save layout');
        return res.json();
    },

    getCompartmentLayout: async (compartment: 'training' | 'health') => {
        const path = compartment === 'training' ? '/api/hevy/dashboard' : '/api/health/dashboard';
        const res = await fetch(`${BASE_URL}${path}`);
        if (!res.ok) throw new Error('Failed to fetch compartment layout');
        return res.json();
    },

    saveCompartmentLayout: async (compartment: 'training' | 'health', layout: any) => {
        const path = compartment === 'training' ? '/api/hevy/dashboard' : '/api/health/dashboard';
        const res = await fetch(`${BASE_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(layout)
        });
        if (!res.ok) throw new Error('Failed to save compartment layout');
        return res.json();
    },

    // --- Hevy / Training ---
    hevyStatus: async () => {
        const res = await fetch(`${BASE_URL}/api/hevy/status`);
        if (!res.ok) throw new Error('Failed to fetch Hevy status');
        return res.json();
    },
    hevyLogin: async (email: string, password: string) => {
        const res = await fetch(`${BASE_URL}/api/hevy/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, headless: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'Hevy login failed');
        return data;
    },
    hevyLoginBrowser: async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 360_000); // 6 min
        try {
            const res = await fetch(`${BASE_URL}/api/hevy/login-browser`, {
                method: 'POST',
                signal: controller.signal,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || 'Browser login failed');
            return data;
        } catch (err: any) {
            if (err?.name === 'AbortError') {
                throw new Error('Browser login timed out. Finish Google sign-in in the popup and try again.');
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    },
    hevySync: async () => {
        const res = await fetch(`${BASE_URL}/api/hevy/sync`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'Hevy sync failed');
        return data;
    },
    hevyLogout: async () => {
        const res = await fetch(`${BASE_URL}/api/hevy/logout`, { method: 'POST' });
        if (!res.ok) throw new Error('Hevy logout failed');
        return res.json();
    },
    hevyHeatmap: async (weeks = 26) => {
        const res = await fetch(`${BASE_URL}/api/hevy/analytics/heatmap?weeks=${weeks}`);
        if (!res.ok) throw new Error('Failed heatmap');
        return res.json();
    },
    hevyVolumeByMuscle: async (days = 90) => {
        const res = await fetch(`${BASE_URL}/api/hevy/analytics/volume-by-muscle?days=${days}`);
        if (!res.ok) throw new Error('Failed volume');
        return res.json();
    },
    hevyOverload: async (exercise?: string, sessions = 20) => {
        const q = new URLSearchParams({ sessions: String(sessions) });
        if (exercise) q.set('exercise', exercise);
        const res = await fetch(`${BASE_URL}/api/hevy/analytics/overload?${q}`);
        if (!res.ok) throw new Error('Failed overload');
        return res.json();
    },
    hevyPRs: async () => {
        const res = await fetch(`${BASE_URL}/api/hevy/analytics/prs`);
        if (!res.ok) throw new Error('Failed PRs');
        return res.json();
    },
    hevyDurations: async (days = 90) => {
        const res = await fetch(`${BASE_URL}/api/hevy/analytics/durations?days=${days}`);
        if (!res.ok) throw new Error('Failed durations');
        return res.json();
    },
    hevyWeeklyVolume: async (weeks = 12) => {
        const res = await fetch(`${BASE_URL}/api/hevy/analytics/weekly-volume?weeks=${weeks}`);
        if (!res.ok) throw new Error('Failed weekly volume');
        return res.json();
    },
    hevyExercises: async () => {
        const res = await fetch(`${BASE_URL}/api/hevy/exercises`);
        if (!res.ok) throw new Error('Failed exercises');
        return res.json();
    },

    // --- Health ---
    healthCalendar: async () => {
        const res = await fetch(
            `${BASE_URL}/api/health/supplements/calendar?_=${Date.now()}`
        );
        if (!res.ok) throw new Error('Failed calendar');
        return res.json();
    },
    healthRates: async () => {
        const res = await fetch(
            `${BASE_URL}/api/health/supplements/rates?_=${Date.now()}`
        );
        if (!res.ok) throw new Error('Failed rates');
        return res.json();
    },
    healthNotes: async () => {
        const res = await fetch(
            `${BASE_URL}/api/health/supplements/notes?_=${Date.now()}`
        );
        if (!res.ok) throw new Error('Failed notes');
        return res.json();
    },
    healthBodyStatus: async () => {
        const res = await fetch(`${BASE_URL}/api/health/body/status`);
        if (!res.ok) throw new Error('Failed body status');
        return res.json();
    },
    healthBody: async () => {
        const res = await fetch(`${BASE_URL}/api/health/body`);
        if (!res.ok) throw new Error('Failed body series');
        return res.json();
    },
    healthBloodworkStatus: async () => {
        const res = await fetch(`${BASE_URL}/api/health/bloodwork/status`);
        if (!res.ok) throw new Error('Failed bloodwork status');
        return res.json();
    },
    healthBloodwork: async () => {
        const res = await fetch(`${BASE_URL}/api/health/bloodwork`);
        if (!res.ok) throw new Error('Failed bloodwork series');
        return res.json();
    },
    healthImport: async (payload: any) => {
        const res = await fetch(`${BASE_URL}/api/health/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'Import failed');
        return data;
    },
    healthSeed: async () => {
        const res = await fetch(`${BASE_URL}/api/health/seed`, { method: 'POST' });
        if (!res.ok) throw new Error('Seed failed');
        return res.json();
    },
    healthSheetsConfig: async () => {
        const res = await fetch(`${BASE_URL}/api/health/sheets`);
        if (!res.ok) throw new Error('Failed to load sheets config');
        return res.json();
    },
    healthSheetsSave: async (payload: {
        supplements_url?: string;
        body_url?: string;
        bloodwork_url?: string;
        sync_minutes?: number;
    }) => {
        const res = await fetch(`${BASE_URL}/api/health/sheets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'Failed to save sheets config');
        return data;
    },
    healthSheetsSync: async () => {
        const res = await fetch(`${BASE_URL}/api/health/sheets/sync`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'Sheets sync failed');
        return data;
    },

    /** Export desktop data + git push so Vercel phone site updates. */
    publishPhoneSite: async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 360_000); // 6 min
        try {
            const res = await fetch(`${BASE_URL}/api/mirror/publish`, {
                method: 'POST',
                signal: controller.signal,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const detail =
                    typeof data.detail === 'string'
                        ? data.detail
                        : Array.isArray(data.detail)
                          ? data.detail.map((d: any) => d.msg || d).join('; ')
                          : data.detail || 'Phone publish failed';
                throw new Error(detail);
            }
            return data as {
                status: string;
                pushed: boolean;
                message: string;
                logs?: string[];
            };
        } catch (err: any) {
            if (err?.name === 'AbortError') {
                throw new Error('Phone publish timed out. Try scripts\\Update-Phone-Site.bat instead.');
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    },

    // --- Chat ---
    sendChatMessage: async (message: string, history: ChatMessage[], context?: any) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180_000); // 3 min for local LLM
        try {
            const res = await fetch(`${BASE_URL}/api/advisor/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, history, context }),
                signal: controller.signal,
            });
            if (!res.ok) {
                const detail = await res.text().catch(() => '');
                throw new Error(detail || 'Chat request failed');
            }
            return res.json();
        } catch (err: any) {
            if (err?.name === 'AbortError') {
                throw new Error('Chat timed out after 3 minutes. Try a shorter question, or free RAM and retry.');
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }
};
