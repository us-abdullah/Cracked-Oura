import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Loader2, AlertCircle, Download, Copy, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { api, type AutomationStatusResponse } from '@/lib/api';

interface SettingsPanelProps {
    onClose: () => void;
    compartment?: 'recovery' | 'training' | 'health';
}

type AutomationStatus = AutomationStatusResponse['status'];

export function SettingsPanel({ onClose, compartment = 'recovery' }: SettingsPanelProps) {
    const [status, setStatus] = useState<AutomationStatus>('idle');
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState<'automation' | 'layout' | 'ai'>('automation');

    const [dailySyncTime, setDailySyncTime] = useState("09:00");
    const [llmModel, setLlmModel] = useState("llama3.2:3b");
    const [llmHost, setLlmHost] = useState("http://localhost:11434");

    // Hevy
    const [hevyEmail, setHevyEmail] = useState('');
    const [hevyPassword, setHevyPassword] = useState('');
    const [hevyInfo, setHevyInfo] = useState<any>(null);

    // Health import / sheets
    const [csvText, setCsvText] = useState('');
    const [sheetsInfo, setSheetsInfo] = useState<any>(null);
    const [sheetsSyncing, setSheetsSyncing] = useState(false);

    useEffect(() => {
        api.getSettings()
            .then(data => {
                if (data.daily_sync_time) setDailySyncTime(data.daily_sync_time);
                if (data.email) setEmail(data.email);
                if (data.llm_model) setLlmModel(data.llm_model);
                if (data.llm_host) setLlmHost(data.llm_host);
            })
            .catch(err => console.error("Failed to fetch settings", err));

        if (compartment === 'training') {
            api.hevyStatus().then(setHevyInfo).catch(console.error);
        }
        if (compartment === 'health') {
            api.healthSheetsConfig().then(setSheetsInfo).catch(console.error);
        }
    }, [compartment]);

    const addLog = (msg: string) => setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

    const handleSaveSettings = async () => {
        setLoading(true);
        try {
            await api.saveSettings({ daily_sync_time: dailySyncTime, email, llm_model: llmModel, llm_host: llmHost });
            addLog(`Settings saved: Daily sync at ${dailySyncTime}`);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveAiSettings = async () => {
        setLoading(true);
        setError(null);
        try {
            await api.saveSettings({
                daily_sync_time: dailySyncTime,
                email,
                llm_model: llmModel,
                llm_host: llmHost,
            });
            addLog(`AI model set to ${llmModel}`);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleClearSession = async () => {
        if (!confirm("Are you sure you want to clear the login session? You will need to login again.")) return;

        setLoading(true);
        try {
            await api.clearSession();
            setStatus('idle');
            addLog("Session cleared.");
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleStartLogin = async () => {
        setLoading(true);
        setError(null);
        addLog(`Starting login for ${email}...`);
        try {
            // Auto-save settings to persist email
            await api.saveSettings({ daily_sync_time: dailySyncTime, email });

            const data = await api.startLogin(email);
            addLog(data.message);
            setStatus('otp_needed');
        } catch (err: any) {
            setError(err.message);
            addLog(`Error: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmitOtp = async () => {
        setLoading(true);
        setError(null);
        addLog(`Submitting OTP...`);
        try {
            const data = await api.submitOtp(otp);
            addLog(data.message);
            setStatus('logged_in');
        } catch (err: any) {
            setError(err.message);
            addLog(`Error: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleRequestExport = async () => {
        setLoading(true);
        setError(null);
        addLog(`Requesting data export...`);
        try {
            const data = await api.requestExport();
            addLog(data.message);
            setStatus('exporting');
            // Start polling
            pollStatus();
        } catch (err: any) {
            setError(err.message);
            addLog(`Error: ${err.message}`);
            setLoading(false);
        }
    };

    const pollStatus = async () => {
        const interval = setInterval(async () => {
            try {
                const data = await api.checkStatus();

                if (data.status === 'completed' || data.status === 'ready_to_download') {
                    clearInterval(interval);
                    setStatus('ready_to_download');
                    setLoading(false);
                    addLog("Export ready for download!");
                } else if (data.status === 'error') {
                    clearInterval(interval);
                    setStatus('error');
                    setError("Export failed on server.");
                    setLoading(false);
                } else {
                    // Still processing
                    addLog(`Status: ${data.status}`);
                }
            } catch (err) {
                console.error("Polling error", err);
            }
        }, 5000);
    };

    const handleDownload = async () => {
        setLoading(true);
        setError(null);
        addLog(`Downloading and ingesting data...`);
        try {
            const data = await api.downloadExport();
            addLog(data.message);
            setStatus('completed');
        } catch (err: any) {
            setError(err.message);
            addLog(`Error: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setLoading(true);
        setError(null);
        addLog(`Uploading ${file.name}...`);

        try {
            const data = await api.uploadZip(file);
            addLog(data.message || "Upload complete");
            setStatus('completed');
        } catch (err: any) {
            setError(err.message);
            addLog(`Error: ${err.message}`);
        } finally {
            setLoading(false);
            // Reset input
            event.target.value = '';
        }
    };

    const handleHevyLogin = async () => {
        setLoading(true);
        setError(null);
        try {
            await api.hevyLogin(hevyEmail, hevyPassword);
            setHevyPassword('');
            const info = await api.hevyStatus();
            setHevyInfo(info);
            addLog('Hevy login successful');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleHevyBrowserLogin = async () => {
        setLoading(true);
        setError(null);
        addLog('Opening Hevy login window — sign in with Google there...');
        try {
            const res = await api.hevyLoginBrowser();
            addLog(`Browser login OK${res.username ? ` as ${res.username}` : ''}`);
            setHevyInfo(await api.hevyStatus());
            // Pull workouts into local DB once after login (like first Oura download)
            try {
                const syncRes = await api.hevySync();
                addLog(`Imported ${syncRes.imported} workouts to local cache`);
                window.dispatchEvent(new Event('hevy-data-synced'));
            } catch (syncErr: any) {
                addLog(`Login OK — sync later: ${syncErr.message}`);
            }
        } catch (err: any) {
            setError(typeof err.message === 'string' ? err.message : String(err));
            addLog(`Browser login error: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleHevySync = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.hevySync();
            addLog(`Synced ${res.imported} workouts`);
            setHevyInfo(await api.hevyStatus());
            window.dispatchEvent(new Event('hevy-data-synced'));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleHealthImport = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.healthImport({ csv_text: csvText, sheet: 'supplements' });
            addLog(`Imported supplements: ${res.supplements}`);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (compartment === 'training') {
        return (
            <div className="w-[400px] border-l bg-card flex flex-col h-full">
                <div className="p-6 border-b flex items-center justify-between">
                    <h2 className="text-lg font-semibold">Training Settings</h2>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                <div className="flex-1 p-6 space-y-6 overflow-y-auto">
                    {error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Error</AlertTitle>
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                    <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                            Training uses the full <strong>Hevy Insights</strong> app
                            (casudo/Hevy-Insights). Sign in with Google once; Sync workouts now saves
                            them locally (like Oura Download Latest). Data stays after restart — Sync
                            again only when you want fresh workouts from Hevy.
                        </p>
                        <div className="flex items-center gap-2 p-3 bg-secondary/50 rounded-lg text-sm">
                            <span>
                                {hevyInfo?.logged_in
                                    ? `Logged in as ${hevyInfo.username || hevyInfo.email || 'user'}`
                                    : hevyInfo?.has_local_data
                                      ? `Local data ready (${hevyInfo.workout_count ?? 0} workouts) — sign in only to sync new ones`
                                      : 'Not logged in'}
                            </span>
                        </div>
                        {!hevyInfo?.logged_in && (
                            <>
                                <Button
                                    className="w-full"
                                    onClick={handleHevyBrowserLogin}
                                    disabled={loading}
                                >
                                    {loading ? (
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    ) : null}
                                    Sign in with Google (browser)
                                </Button>
                                <p className="text-xs text-muted-foreground pt-2">
                                    Or if you set a password in Hevy (Settings → Account → Security),
                                    you can use email + password instead:
                                </p>
                                <Label>Hevy Email</Label>
                                <Input
                                    value={hevyEmail}
                                    onChange={(e) => setHevyEmail(e.target.value)}
                                    placeholder="you@email.com"
                                />
                                <Label>Password</Label>
                                <Input
                                    type="password"
                                    value={hevyPassword}
                                    onChange={(e) => setHevyPassword(e.target.value)}
                                />
                                <Button
                                    variant="outline"
                                    onClick={handleHevyLogin}
                                    disabled={loading || !hevyEmail || !hevyPassword}
                                >
                                    Log in with email/password
                                </Button>
                            </>
                        )}
                        {hevyInfo?.logged_in && (
                            <div className="flex flex-col gap-2">
                                <Button onClick={handleHevySync} disabled={loading}>
                                    {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                                    Sync workouts now
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={async () => {
                                        await api.hevyLogout();
                                        setHevyInfo(await api.hevyStatus());
                                    }}
                                >
                                    Log out
                                </Button>
                                {hevyInfo?.last_run && (
                                    <p className="text-xs text-muted-foreground">Last sync: {hevyInfo.last_run}</p>
                                )}
                            </div>
                        )}
                        {!hevyInfo?.logged_in && hevyInfo?.has_local_data && hevyInfo?.last_run && (
                            <p className="text-xs text-muted-foreground">Last sync: {hevyInfo.last_run}</p>
                        )}
                    </div>
                    {logs.length > 0 && (
                        <div className="text-xs font-mono bg-muted p-2 rounded max-h-40 overflow-auto">
                            {logs.map((l, i) => (
                                <div key={i}>{l}</div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (compartment === 'health') {
        return (
            <div className="w-[400px] border-l bg-card flex flex-col h-full">
                <div className="p-6 border-b flex items-center justify-between">
                    <h2 className="text-lg font-semibold">Health Settings</h2>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                <div className="flex-1 p-6 space-y-6 overflow-y-auto">
                    {error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Error</AlertTitle>
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    <div className="space-y-3">
                        <h3 className="text-sm font-medium">Google Sheets (live)</h3>
                        <p className="text-sm text-muted-foreground">
                            Your published sheets sync automatically every{' '}
                            {sheetsInfo?.sync_minutes ?? 5} minutes. After you edit checkboxes or
                            add a day in Google Sheets, wait about a minute for Google&apos;s publish
                            cache, then hit Sync — the calendar % and colors should update.
                        </p>
                        {sheetsInfo?.last_sync && (
                            <p className="text-xs text-muted-foreground">
                                Last sync: {sheetsInfo.last_sync}
                                {sheetsInfo.last_status ? ` · ${sheetsInfo.last_status}` : ''}
                                {sheetsInfo.last_counts
                                    ? ` · supp ${sheetsInfo.last_counts.supplements}, body ${sheetsInfo.last_counts.body}, labs ${sheetsInfo.last_counts.bloodwork}`
                                    : ''}
                            </p>
                        )}
                        <Button
                            onClick={async () => {
                                setSheetsSyncing(true);
                                setError(null);
                                try {
                                    const r = await api.healthSheetsSync();
                                    setSheetsInfo(await api.healthSheetsConfig());
                                    window.dispatchEvent(new Event('health-data-synced'));
                                    if (r.status === 'busy' || r.skipped) {
                                        addLog('Sync already running — wait a moment.');
                                    } else if (r.skipped_stale) {
                                        addLog(
                                            `Kept current data (Google returned a stale snapshot). Try again in ~1 min after editing the sheet.`
                                        );
                                    } else {
                                        const latest = (r.latest_dates || []).join(', ');
                                        addLog(
                                            `Synced: supp ${r.supplements} (−${r.supplements_deleted ?? 0}), body ${r.body} (−${r.body_deleted ?? 0}), labs ${r.bloodwork} (−${r.bloodwork_deleted ?? 0}), notes ${r.notes_imported ?? 0}` +
                                                (latest ? ` · latest days: ${latest}` : '')
                                        );
                                    }
                                    if (r.errors?.length) {
                                        setError(r.errors.join('; '));
                                    }
                                } catch (err: any) {
                                    setError(err.message);
                                } finally {
                                    setSheetsSyncing(false);
                                }
                            }}
                            disabled={sheetsSyncing || loading}
                        >
                            {(sheetsSyncing || loading) && (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            )}
                            Sync from Google Sheets now
                        </Button>
                    </div>

                    <div className="space-y-2 border-t pt-4">
                        <Label>Manual CSV import (optional)</Label>
                        <textarea
                            className="w-full h-28 text-xs font-mono border rounded-md p-2 bg-background"
                            value={csvText}
                            onChange={(e) => setCsvText(e.target.value)}
                            placeholder="Date,Day,Creatine,Omega3,..."
                        />
                        <Button onClick={handleHealthImport} disabled={loading || !csvText.trim()}>
                            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                            Import CSV
                        </Button>
                    </div>
                    {logs.length > 0 && (
                        <div className="text-xs font-mono bg-muted p-2 rounded max-h-40 overflow-auto">
                            {logs.map((l, i) => (
                                <div key={i}>{l}</div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="w-[400px] border-l bg-card flex flex-col h-full">
            {/* Header */}
            <div className="p-6 border-b flex items-center justify-between">
                <h2 className="text-lg font-semibold">Settings</h2>
                <Button variant="ghost" size="icon" onClick={onClose}>
                    <X className="h-4 w-4" />
                </Button>
            </div>

            {/* Tabs */}
            <div className="flex border-b">
                <button
                    className={cn(
                        "flex-1 py-3 text-sm font-medium border-b-2 transition-colors",
                        activeTab === 'automation'
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => setActiveTab('automation')}
                >
                    Automation
                </button>
                <button
                    className={cn(
                        "flex-1 py-3 text-sm font-medium border-b-2 transition-colors",
                        activeTab === 'ai'
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => setActiveTab('ai')}
                >
                    AI
                </button>
                <button
                    className={cn(
                        "flex-1 py-3 text-sm font-medium border-b-2 transition-colors",
                        activeTab === 'layout'
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => setActiveTab('layout')}
                >
                    Layout
                </button>
            </div>

            <div className="flex-1 p-6 space-y-6 overflow-y-auto">
                {activeTab === 'automation' && (
                    <>
                        {/* Automation Config */}
                        <div className="space-y-4">
                            <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Configuration</h3>
                            <div className="space-y-2">
                                <Label>Daily Sync Time</Label>
                                <div className="flex gap-2">
                                    <Input
                                        type="time"
                                        value={dailySyncTime}
                                        onChange={e => setDailySyncTime(e.target.value)}
                                    />
                                    <Button onClick={handleSaveSettings} disabled={loading} variant="outline">
                                        Save
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Manual Actions */}
                        <div className="space-y-4">
                            <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Sync Status</h3>

                            {/* Status Indicator */}
                            <div className="flex items-center gap-2 p-3 bg-secondary/50 rounded-lg">
                                <div className={cn("h-2.5 w-2.5 rounded-full",
                                    status === 'completed' ? "bg-green-500" :
                                        status === 'error' ? "bg-red-500" :
                                            loading ? "bg-yellow-500 animate-pulse" : "bg-gray-500"
                                )} />
                                <span className="text-sm font-medium">
                                    {status === 'idle' && "Ready"}
                                    {status === 'login_needed' && "Login required"}
                                    {status === 'otp_needed' && "Enter OTP"}
                                    {status === 'logged_in' && "Logged in"}
                                    {status === 'exporting' && "Exporting data..."}
                                    {status === 'ready_to_download' && "Export ready"}
                                    {status === 'completed' && "Sync complete"}
                                    {status === 'error' && "Error occurred"}
                                </span>
                            </div>

                            <div className="grid grid-cols-1 gap-3">
                                {/* Login Flow */}
                                {status === 'idle' && (
                                    <div className="space-y-3 p-3 border rounded-lg">
                                        <Label>Login</Label>
                                        <Input
                                            placeholder="email@example.com"
                                            value={email}
                                            onChange={e => setEmail(e.target.value)}
                                        />
                                        <Button className="w-full" onClick={handleStartLogin} disabled={!email || loading}>
                                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Start Login
                                        </Button>
                                    </div>
                                )}

                                {status === 'otp_needed' && (
                                    <div className="space-y-3 p-3 border rounded-lg bg-secondary/10">
                                        <Alert>
                                            <AlertCircle className="h-4 w-4" />
                                            <AlertTitle>OTP Sent</AlertTitle>
                                            <AlertDescription>Check your email.</AlertDescription>
                                        </Alert>
                                        <Input
                                            placeholder="OTP Code"
                                            value={otp}
                                            onChange={e => setOtp(e.target.value)}
                                        />
                                        <Button className="w-full" onClick={handleSubmitOtp} disabled={!otp || loading}>
                                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Submit OTP
                                        </Button>
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="space-y-2">
                                    <Label>Data Sync</Label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <Button
                                            variant="outline"
                                            onClick={handleRequestExport}
                                            disabled={loading || status === 'exporting'}
                                            className="h-auto py-3 flex flex-col gap-1"
                                        >
                                            <span className="font-semibold">Request New</span>
                                            <span className="text-xs font-normal text-muted-foreground">Request & Wait</span>
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={handleDownload}
                                            disabled={loading}
                                            className="h-auto py-3 flex flex-col gap-1"
                                        >
                                            <span className="font-semibold">Download Latest</span>
                                            <span className="text-xs font-normal text-muted-foreground">Ingest Existing</span>
                                        </Button>
                                    </div>
                                </div>

                                {/* Manual Import */}
                                <div className="space-y-2">
                                    <Label>Manual Upload</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            type="file"
                                            accept=".zip"
                                            onChange={handleFileUpload}
                                            disabled={loading}
                                            className="cursor-pointer"
                                        />
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">
                                        Upload an Oura export ZIP file manually.
                                    </p>
                                </div>
                            </div>

                            {status === 'ready_to_download' && (
                                <Alert className="bg-blue-500/10 border-blue-500/20">
                                    <Download className="h-4 w-4 text-blue-500" />
                                    <AlertTitle>Export Ready</AlertTitle>
                                    <AlertDescription>
                                        Data is ready. Click "Download Latest" to ingest.
                                    </AlertDescription>
                                </Alert>
                            )}

                            {error && (
                                <Alert variant="destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertTitle>Error</AlertTitle>
                                    <AlertDescription>{error}</AlertDescription>
                                </Alert>
                            )}
                        </div>

                        {/* Logs Console */}
                        <div className="space-y-2">
                            <Label>Activity Log</Label>
                            <div className="bg-black/50 rounded-md p-3 h-32 overflow-y-auto font-mono text-xs text-muted-foreground space-y-1">
                                {logs.length === 0 && <span className="opacity-50">No activity yet...</span>}
                                {logs.map((log, i) => (
                                    <div key={i}>{log}</div>
                                ))}
                            </div>
                        </div>

                        {/* Session Management (Bottom) */}
                        <div className="pt-4 border-t space-y-4">
                            <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Session</h3>
                            <Button
                                variant="destructive"
                                className="w-full"
                                onClick={handleClearSession}
                                disabled={loading}
                            >
                                Clear Login Session
                            </Button>
                        </div>
                    </>
                )}

                {activeTab === 'ai' && (
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Local LLM</h3>
                            <p className="text-xs text-muted-foreground">
                                Uses Ollama on this PC. Recommended on your machine (CPU inference): <span className="font-medium text-foreground">llama3.2:3b</span> — much faster than larger Qwen models when GPU offload isn’t available. Keep Ollama running while chatting.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label>Model</Label>
                            <Input
                                value={llmModel}
                                onChange={e => setLlmModel(e.target.value)}
                                placeholder="llama3.2:3b"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Must match a model from <code>ollama list</code>. Keep Ollama running while chatting.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label>Ollama Host</Label>
                            <Input
                                value={llmHost}
                                onChange={e => setLlmHost(e.target.value)}
                                placeholder="http://localhost:11434"
                            />
                        </div>
                        <Button className="w-full" onClick={handleSaveAiSettings} disabled={loading || !llmModel}>
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save AI Settings
                        </Button>
                        {error && (
                            <Alert variant="destructive">
                                <AlertCircle className="h-4 w-4" />
                                <AlertTitle>Error</AlertTitle>
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}
                    </div>
                )}

                {activeTab === 'layout' && (
                    <div className="space-y-4">
                        <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Layout Actions</h3>

                        <div className="grid grid-cols-1 gap-3">
                            <Button variant="outline" onClick={() => {
                                api.getLayout()
                                    .then(data => {
                                        const layoutJson = JSON.stringify(data, null, 2);
                                        navigator.clipboard.writeText(layoutJson);
                                        addLog("Layout config copied to clipboard.");
                                    })
                                    .catch(err => {
                                        console.error("Failed to fetch layout", err);
                                    });
                            }}>
                                <Copy className="mr-2 h-4 w-4" />
                                Copy Layout to Clipboard
                            </Button>

                            <div className="space-y-2">
                                <Label>Import Layout</Label>
                                <textarea
                                    placeholder="Paste layout JSON here..."
                                    className="flex min-h-[150px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono text-[10px]"
                                    id="import-layout-area"
                                />
                                <Button
                                    variant="outline"
                                    className="w-full"
                                    onClick={async () => {
                                        const el = document.getElementById('import-layout-area') as HTMLTextAreaElement;
                                        if (!el || !el.value) return;

                                        try {
                                            const rawJson = JSON.parse(el.value);
                                            let payload = rawJson;

                                            // Handle case where export is wrapped in "dashboard" key
                                            if (rawJson.dashboard && rawJson.dashboard.dashboards) {
                                                payload = rawJson.dashboard;
                                            }

                                            // Validation
                                            if (!payload.dashboards && !payload.widgets) {
                                                alert("Invalid JSON: Must contain 'dashboards' or 'widgets' property.");
                                                return;
                                            }

                                            await api.saveLayout(payload);
                                            alert("Layout imported successfully! The page will reload.");
                                            window.location.reload();
                                            el.value = "";
                                        } catch (e: any) {
                                            alert("Import Failed: " + e.message);
                                        }
                                    }}
                                >
                                    <Upload className="mr-2 h-4 w-4" />
                                    Import Layout
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div >
    );
}
