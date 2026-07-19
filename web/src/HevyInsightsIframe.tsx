/**
 * Vercel/phone embed of the real Hevy Insights Vue SPA (same UI as desktop).
 * Loads /hevy-insights/ same-origin; routes via postMessage; /api/hi/* via snapshot shim.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2 } from 'lucide-react';

const FRAME_SRC = '/hevy-insights/';

type Props = { routePath?: string };

export function HevyInsightsEmbed({ routePath = '/dashboard' }: Props) {
  const [checking, setChecking] = useState(true);
  const [canBrowse, setCanBrowse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pathRef = useRef(routePath);
  pathRef.current = routePath;

  const navigateIframe = (path: string) => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'biotracker-navigate', path },
      '*'
    );
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await api.hevyStatus();
        const hasLocal = !!(
          status.has_local_data ||
          (status.workout_count ?? 0) > 0
        );
        let workoutsLen = 0;
        try {
          const w = await (api as any).hevyWorkouts?.();
          workoutsLen = Array.isArray(w) ? w.length : 0;
        } catch {
          /* ignore */
        }
        if (!cancelled) setCanBrowse(hasLocal || workoutsLen > 0);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Snapshot unavailable');
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!canBrowse) return;
    navigateIframe(routePath);
  }, [routePath, canBrowse]);

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
      <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
        <p>No Training workouts in the phone snapshot.</p>
        <p>
          On desktop: Sync Hevy, then run{' '}
          <code className="text-xs">npm run export:snapshot</code> and push.
        </p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-background">
      <iframe
        ref={iframeRef}
        title="Hevy Insights"
        src={FRAME_SRC}
        className="w-full h-full border-0"
        allow="clipboard-write"
        onLoad={() => navigateIframe(pathRef.current)}
      />
    </div>
  );
}
