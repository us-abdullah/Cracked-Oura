import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getApiBase, getHevyInsightsBase } from '@/lib/apiBase';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

const HEVY_SYNC_EVENT = 'hevy-data-synced';

function hevyUrl(path: string) {
    return `${getHevyInsightsBase()}${path.replace(/^\//, '')}`;
}

type HevyInsightsEmbedProps = {
    /** Vue router path, e.g. `/dashboard` or `/workouts-card` */
    routePath?: string;
};

/**
 * Embeds the real Hevy-Insights Vue app (vendored from casudo/Hevy-Insights).
 * Workouts are served from local SQLite after Sync — survives restart like Oura.
 * Browse is allowed whenever local data exists, even if the live Google session expired.
 */
export function HevyInsightsEmbed({ routePath = '/dashboard' }: HevyInsightsEmbedProps) {
    const [ready, setReady] = useState(false);
    const [canBrowse, setCanBrowse] = useState(false);
    const [checking, setChecking] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [iframeKey, setIframeKey] = useState(0);
    const [frameSrc, setFrameSrc] = useState(() => hevyUrl(routePath));
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const pathRef = useRef(routePath);
    pathRef.current = routePath;

    const navigateIframe = (path: string) => {
        iframeRef.current?.contentWindow?.postMessage(
            { type: 'biotracker-navigate', path },
            '*'
        );
    };

    const refreshAuth = async () => {
        const status = await api.hevyStatus();
        const hasLocal = !!(status.has_local_data || (status.workout_count ?? 0) > 0);
        setCanBrowse(!!status.logged_in || hasLocal);
        // Re-hydrate Insights cookies from saved tokens when present
        await fetch(`${getApiBase()}/api/hi/auth/status`, {
            credentials: 'include',
        }).catch(() => null);
        setReady(true);
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                await refreshAuth();
            } catch (e: any) {
                if (!cancelled) setError(e.message || 'Backend not reachable');
            } finally {
                if (!cancelled) setChecking(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const onSynced = () => {
            setFrameSrc(hevyUrl(pathRef.current));
            setIframeKey((k) => k + 1);
            void refreshAuth().catch(() => null);
        };
        window.addEventListener(HEVY_SYNC_EVENT, onSynced);
        return () => window.removeEventListener(HEVY_SYNC_EVENT, onSynced);
    }, []);

    useEffect(() => {
        if (!ready || !canBrowse) return;
        navigateIframe(routePath);
    }, [routePath, ready, canBrowse, iframeKey]);

    if (checking) {
        return (
            <div className="h-full flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading Training…
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-full flex items-center justify-center p-8 text-center text-sm text-muted-foreground">
                {error}
            </div>
        );
    }

    if (!canBrowse) {
        return (
            <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
                <h2 className="text-xl font-semibold">Hevy Training</h2>
                <p className="text-sm text-muted-foreground max-w-md">
                    Sign in with Google once (Training → Settings), then Sync workouts. After that,
                    your data stays local — reopen the app anytime without signing in again (same as
                    Recovery / Oura).
                </p>
                <Button
                    variant="outline"
                    onClick={() => {
                        setChecking(true);
                        refreshAuth()
                            .catch((e) => setError(e.message))
                            .finally(() => setChecking(false));
                    }}
                >
                    Refresh after login
                </Button>
            </div>
        );
    }

    if (!ready) return null;

    return (
        <div className="absolute inset-0 bg-background">
            <iframe
                key={iframeKey}
                ref={iframeRef}
                title="Hevy Insights"
                src={frameSrc}
                className="w-full h-full border-0"
                allow="clipboard-write"
                onLoad={() => navigateIframe(pathRef.current)}
            />
        </div>
    );
}
