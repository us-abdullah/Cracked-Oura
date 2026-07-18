import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CloudUpload } from 'lucide-react';

/**
 * Push local AppData DB + dashboards to a hosted cloud API
 * so the phone companion works with the laptop closed.
 */
export function CloudSyncSection() {
    const [url, setUrl] = useState('');
    const [token, setToken] = useState('');
    const [lastPush, setLastPush] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api.getSettings()
            .then((s: any) => {
                if (s.cloud_remote_url) setUrl(s.cloud_remote_url);
                if (s.cloud_sync_token) setToken(s.cloud_sync_token);
                if (s.cloud_last_push) setLastPush(s.cloud_last_push);
            })
            .catch(() => null);
    }, []);

    const save = async () => {
        setLoading(true);
        setError(null);
        setMessage(null);
        try {
            await api.saveCloudClientSettings(url.trim(), token.trim());
            setMessage('Cloud settings saved on this PC.');
        } catch (e: any) {
            setError(e.message || 'Save failed');
        } finally {
            setLoading(false);
        }
    };

    const push = async () => {
        setLoading(true);
        setError(null);
        setMessage(null);
        try {
            await api.saveCloudClientSettings(url.trim(), token.trim());
            const res = await api.pushToCloud(url.trim(), token.trim());
            setLastPush(res.response?.at || new Date().toISOString());
            setMessage(
                `Pushed OK (${Math.round((res.response?.database_bytes || 0) / 1024)} KB DB). Phone can use the cloud URL now.`
            );
        } catch (e: any) {
            setError(e.message || 'Push failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-medium flex items-center gap-2">
                <CloudUpload className="h-4 w-4" />
                Cloud (phone, laptop closed)
            </h3>
            <p className="text-xs text-muted-foreground">
                Deploy the API from <code className="text-[10px]">cloud/</code> (Railway/Render), then push
                your local data. Sync Oura/Hevy/Sheets on this PC first, then push.
            </p>
            <div className="space-y-2">
                <Label>Cloud API URL</Label>
                <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://your-app.onrender.com"
                    autoCapitalize="off"
                />
            </div>
            <div className="space-y-2">
                <Label>Sync token</Label>
                <Input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="BIOTRACKER_CLOUD_TOKEN"
                    autoCapitalize="off"
                />
            </div>
            {lastPush && (
                <p className="text-[10px] text-muted-foreground">Last push: {lastPush}</p>
            )}
            {message && <p className="text-xs text-teal-500">{message}</p>}
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={save} disabled={loading || !url || !token}>
                    Save
                </Button>
                <Button size="sm" onClick={push} disabled={loading || !url || !token}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Push to cloud now
                </Button>
            </div>
        </div>
    );
}
