import { useEffect, useState, type ReactNode } from 'react';
import { getApiBase, setApiBase, clearApiBase, isCompanionMode } from '@/lib/apiBase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

async function pingApi(base: string): Promise<boolean> {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 8000);
    try {
        const res = await fetch(`${base.replace(/\/$/, '')}/api/hevy/status`, {
            signal: ctrl.signal,
        });
        return res.ok;
    } catch {
        return false;
    } finally {
        window.clearTimeout(timer);
    }
}

/**
 * Companion (phone/Vercel) only: require a reachable backend URL (tunnel).
 * Desktop Electron skips this — always localhost via default getApiBase().
 */
export function CompanionApiGate({ children }: { children: ReactNode }) {
    if (!isCompanionMode()) return <>{children}</>;

    const [ready, setReady] = useState(false);
    const [checking, setChecking] = useState(true);
    const [url, setUrl] = useState(() => getApiBase());
    const [error, setError] = useState<string | null>(null);

    const tryConnect = async (base: string) => {
        setChecking(true);
        setError(null);
        const ok = await pingApi(base);
        if (ok) {
            setApiBase(base);
            setReady(true);
        } else {
            setReady(false);
            setError(
                'Cannot reach that API. Open Usman Biotracker on your PC, start a Cloudflare tunnel to port 8000, and paste the https://….trycloudflare.com URL here.'
            );
        }
        setChecking(false);
    };

    useEffect(() => {
        void tryConnect(getApiBase());
    }, []);

    if (ready) {
        return (
            <div className="min-h-screen flex flex-col">
                <div className="bg-amber-950/80 text-amber-100 text-xs px-3 py-1.5 flex items-center justify-between gap-2 border-b border-amber-900/50">
                    <span className="truncate">Phone view → {getApiBase()}</span>
                    <button
                        type="button"
                        className="underline shrink-0"
                        onClick={() => {
                            clearApiBase();
                            setReady(false);
                            setUrl('');
                        }}
                    >
                        Change API
                    </button>
                </div>
                <div className="flex-1 min-h-0">{children}</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
            <div className="w-full max-w-md space-y-4">
                <h1 className="text-xl font-semibold">Usman Biotracker (Phone)</h1>
                <p className="text-sm text-muted-foreground">
                    This site only shows your desktop data. Keep <strong>Usman Biotracker</strong> open
                    on your PC, run a tunnel to port <strong>8000</strong>, then paste the URL below.
                </p>
                <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://xxxx.trycloudflare.com"
                    autoCapitalize="off"
                    autoCorrect="off"
                />
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button
                    className="w-full"
                    disabled={checking || !url.trim()}
                    onClick={() => void tryConnect(url.trim())}
                >
                    {checking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Connect
                </Button>
            </div>
        </div>
    );
}
