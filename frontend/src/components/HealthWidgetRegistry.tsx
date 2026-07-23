import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { WidgetInstance } from '@/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    format,
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    addMonths,
    subMonths,
    isSameMonth,
    isSameDay,
    parseISO,
} from 'date-fns';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TrendChartCanvas } from '@/components/widgets/TrendChartCanvas';
import { useIsMobileWeb } from '@/lib/webMirror';

/** Shared month for adherence calendar ↔ per-supplement rates. */
const healthMonthListeners = new Set<() => void>();
let healthCalendarMonth = startOfMonth(new Date());

function getHealthCalendarMonth() {
    return healthCalendarMonth;
}

function setHealthCalendarMonth(d: Date) {
    const next = startOfMonth(d);
    if (next.getTime() === healthCalendarMonth.getTime()) return;
    healthCalendarMonth = next;
    healthMonthListeners.forEach((l) => l());
}

function subscribeHealthCalendarMonth(cb: () => void) {
    healthMonthListeners.add(cb);
    return () => {
        healthMonthListeners.delete(cb);
    };
}

function useHealthCalendarMonth() {
    return useSyncExternalStore(
        subscribeHealthCalendarMonth,
        getHealthCalendarMonth,
        getHealthCalendarMonth
    );
}

interface Props {
    widget: WidgetInstance;
}

const HEALTH_SYNC_EVENT = 'health-data-synced';

/** Refetch when Sync Now fires, or when background sheet sync updates last_sync. */
function useHealthLiveReload(load: () => void | Promise<void>) {
    useEffect(() => {
        let cancelled = false;
        let lastSync: string | null = null;

        const run = async () => {
            if (cancelled) return;
            try {
                await load();
            } catch (e) {
                console.error(e);
            }
        };

        const onSync = () => {
            void run();
        };

        void (async () => {
            await run();
            try {
                const cfg = await api.healthSheetsConfig();
                lastSync = cfg.last_sync || null;
            } catch {
                /* ignore */
            }
        })();

        window.addEventListener(HEALTH_SYNC_EVENT, onSync);
        const timer = window.setInterval(async () => {
            try {
                const cfg = await api.healthSheetsConfig();
                const next = cfg.last_sync || null;
                if (next && next !== lastSync) {
                    lastSync = next;
                    await run();
                }
            } catch {
                /* ignore */
            }
        }, 10_000);

        return () => {
            cancelled = true;
            window.removeEventListener(HEALTH_SYNC_EVENT, onSync);
            window.clearInterval(timer);
        };
    }, [load]);
}


type DayRow = {
    date: string;
    day?: string;
    pct: number;
    color: 'green' | 'yellow' | 'red';
    taken: Record<string, number | null>;
    notes?: string;
};

function ratesForMonth(days: DayRow[], month: Date) {
    // Compare YYYY-MM strings to avoid UTC parseISO timezone shifting day-of-month
    const prefix = format(month, 'yyyy-MM');
    const inMonth = days.filter((d) => typeof d.date === 'string' && d.date.startsWith(prefix));
    const names = new Set<string>();
    for (const d of inMonth) {
        for (const k of Object.keys(d.taken || {})) names.add(k);
    }
    const rates: { name: string; pct: number | null; taken: number; total: number }[] = [];
    for (const name of names) {
        let taken = 0;
        let total = 0;
        for (const d of inMonth) {
            const v = d.taken?.[name];
            if (v === null || v === undefined) continue;
            total += 1;
            if (v === 1) taken += 1;
        }
        rates.push({
            name,
            pct: total ? Math.round((taken / total) * 1000) / 10 : null,
            taken,
            total,
        });
    }
    rates.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
    return rates;
}

function AdherenceCalendar() {
    const isMobileWeb = useIsMobileWeb();
    const [days, setDays] = useState<DayRow[]>([]);
    const [selected, setSelected] = useState<DayRow | null>(null);
    const cursor = useHealthCalendarMonth();
    const cursorInit = useMemo(() => ({ done: false }), []);

    const load = useMemo(
        () => async () => {
            const rows: DayRow[] = await api.healthCalendar();
            setDays(rows);
            setSelected((prev) => {
                if (!rows.length) return null;
                if (prev) {
                    const match = rows.find((r) => r.date === prev.date);
                    if (match) return match;
                }
                return rows[rows.length - 1];
            });
            if (rows.length && !cursorInit.done) {
                cursorInit.done = true;
                try {
                    setHealthCalendarMonth(parseISO(rows[rows.length - 1].date + 'T12:00:00'));
                } catch {
                    /* ignore */
                }
            }
        },
        [cursorInit]
    );

    useHealthLiveReload(load);

    const byDate = useMemo(() => {
        const m = new Map<string, DayRow>();
        for (const d of days) m.set(d.date, d);
        return m;
    }, [days]);

    const cells = useMemo(() => {
        const monthStart = startOfMonth(cursor);
        const monthEnd = endOfMonth(cursor);
        const gridStart = startOfWeek(monthStart);
        const gridEnd = endOfWeek(monthEnd);
        return eachDayOfInterval({ start: gridStart, end: gridEnd });
    }, [cursor]);

    const monthLabel = format(cursor, 'MMMM yyyy');

    return (
        <div
            className={cn(
                'h-full flex flex-col min-h-0',
                isMobileWeb ? 'gap-4 p-1' : 'gap-3 p-2'
            )}
        >
            <div className="flex items-center justify-between gap-2 shrink-0">
                <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setHealthCalendarMonth(subMonths(cursor, 1))}
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="text-sm font-semibold tracking-tight">{monthLabel}</div>
                <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setHealthCalendarMonth(addMonths(cursor, 1))}
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>

            <div
                className={cn(
                    'grid grid-cols-7 text-muted-foreground text-center shrink-0',
                    isMobileWeb ? 'gap-2 text-[10px]' : 'gap-1 text-[11px]'
                )}
            >
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                    <div key={d} className={cn('font-medium', isMobileWeb ? 'py-1.5' : 'py-1')}>
                        {d}
                    </div>
                ))}
            </div>

            <div
                className={cn(
                    'grid grid-cols-7 flex-1 min-h-0',
                    isMobileWeb ? 'gap-2.5 auto-rows-[minmax(3.75rem,1fr)]' : 'gap-1.5 auto-rows-fr'
                )}
            >
                {cells.map((day) => {
                    const key = format(day, 'yyyy-MM-dd');
                    const row = byDate.get(key);
                    const inMonth = isSameMonth(day, cursor);
                    const isSelected = selected && isSameDay(day, parseISO(selected.date));
                    const today = isSameDay(day, new Date());

                    const tint =
                        !row || !inMonth
                            ? ''
                            : row.color === 'green'
                              ? 'bg-emerald-500/15 border-emerald-500/40'
                              : row.color === 'yellow'
                                ? 'bg-amber-500/15 border-amber-500/40'
                                : 'bg-rose-500/15 border-rose-500/40';

                    const dot =
                        !row || !inMonth
                            ? null
                            : row.color === 'green'
                              ? 'bg-emerald-500'
                              : row.color === 'yellow'
                                ? 'bg-amber-500'
                                : 'bg-rose-500';

                    return (
                        <button
                            key={key}
                            type="button"
                            disabled={!row}
                            onClick={() => row && setSelected(row)}
                            className={cn(
                                'relative rounded-lg border text-left transition-colors flex flex-col justify-between',
                                isMobileWeb ? 'p-2 min-h-[3.75rem]' : 'p-1.5 min-h-[52px]',
                                inMonth
                                    ? 'border-border/60 bg-card/40'
                                    : 'border-transparent bg-transparent opacity-35',
                                tint,
                                row && inMonth && 'hover:border-foreground/30 cursor-pointer',
                                !row && inMonth && 'cursor-default',
                                isSelected && 'ring-2 ring-teal-500 border-teal-500/50',
                                today && inMonth && !isSelected && 'border-teal-600/50'
                            )}
                            title={row ? `${key}: ${row.pct}%` : key}
                        >
                            <span
                                className={cn(
                                    'font-medium',
                                    isMobileWeb ? 'text-[13px]' : 'text-xs',
                                    inMonth ? 'text-foreground' : 'text-muted-foreground'
                                )}
                            >
                                {format(day, 'd')}
                            </span>
                            {row && inMonth && (
                                <div className="flex items-center justify-between gap-1 mt-auto">
                                    <span className="text-[10px] text-muted-foreground tabular-nums">
                                        {Math.round(row.pct)}%
                                    </span>
                                    <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            <div
                className={cn(
                    'flex text-muted-foreground shrink-0 px-0.5',
                    isMobileWeb
                        ? 'flex-col gap-1.5 text-[11px]'
                        : 'items-center gap-3 text-[10px]'
                )}
            >
                <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Core stack complete
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-amber-500" /> Core ≥50%
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-rose-500" /> Core &lt;50%
                </span>
                <span className="opacity-70">% = all supplements</span>
            </div>

            {selected && (
                <div
                    className={cn(
                        'border-t pt-3',
                        isMobileWeb
                            ? 'shrink-0 max-h-none overflow-visible'
                            : 'shrink-0 max-h-[38%] overflow-auto'
                    )}
                >
                    <div className="flex items-baseline justify-between gap-2 mb-2">
                        <p className="text-sm font-medium">
                            {format(parseISO(selected.date), 'EEEE, MMM d')}
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                            {selected.pct}% taken
                        </p>
                    </div>
                    <div
                        className={cn(
                            'flex flex-wrap',
                            isMobileWeb ? 'gap-2' : 'gap-1.5'
                        )}
                    >
                        {Object.entries(selected.taken || {}).map(([name, v]) => (
                            <span
                                key={name}
                                className={cn(
                                    'rounded-md border',
                                    isMobileWeb
                                        ? 'text-xs px-2.5 py-1'
                                        : 'text-[11px] px-2 py-0.5',
                                    v === 1
                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                                        : v === 0
                                          ? 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                                          : 'bg-muted border-transparent text-muted-foreground'
                                )}
                            >
                                {name}
                                <span className="ml-1 opacity-70">{v === 1 ? '✓' : v === 0 ? '✗' : '—'}</span>
                            </span>
                        ))}
                    </div>
                    {selected.notes ? (
                        <p className="text-xs text-muted-foreground mt-2 italic">{selected.notes}</p>
                    ) : (
                        <p className="text-[11px] text-muted-foreground/70 mt-2">No notes for this day.</p>
                    )}
                </div>
            )}

            {days.length === 0 && (
                <p className="text-sm text-muted-foreground p-2">
                    No supplement log yet. Connect your sheet or seed placeholder data in Settings.
                </p>
            )}
        </div>
    );
}

function AdherenceRates() {
    const month = useHealthCalendarMonth();
    const [days, setDays] = useState<DayRow[]>([]);
    const load = useMemo(
        () => async () => {
            setDays(await api.healthCalendar());
        },
        []
    );
    useHealthLiveReload(load);

    const rates = useMemo(() => ratesForMonth(days, month), [days, month]);
    const monthLabel = format(month, 'MMMM yyyy');

    return (
        <div className="h-full overflow-auto text-sm p-1 space-y-2">
            <div className="flex items-center justify-between gap-1 px-0.5 pb-1">
                <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setHealthCalendarMonth(subMonths(month, 1))}
                    aria-label="Previous month"
                >
                    <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <p className="text-[11px] text-muted-foreground text-center">
                    {monthLabel}
                </p>
                <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setHealthCalendarMonth(addMonths(month, 1))}
                    aria-label="Next month"
                >
                    <ChevronRight className="h-3.5 w-3.5" />
                </Button>
            </div>
            {rates.length === 0 && (
                <p className="text-xs text-muted-foreground px-0.5">
                    No tracked supplements in {monthLabel}.
                </p>
            )}
            {rates.map((r) => (
                <div key={r.name}>
                    <div className="flex justify-between text-xs mb-0.5">
                        <span className="truncate pr-2">{r.name}</span>
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                            {r.pct != null ? `${r.pct}%` : '—'}
                            {r.total > 0 ? (
                                <span className="ml-1 opacity-60 text-[10px]">
                                    {r.taken}/{r.total}
                                </span>
                            ) : null}
                        </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                            className="h-full bg-teal-600"
                            style={{ width: `${r.pct || 0}%` }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}

function NotesFeed() {
    const [notes, setNotes] = useState<any[]>([]);
    const load = useMemo(
        () => async () => {
            setNotes(await api.healthNotes());
        },
        []
    );
    useHealthLiveReload(load);
    if (!notes.length) {
        return (
            <p className="text-sm text-muted-foreground p-4">
                No notes yet. Notes from supplements, body, bloodwork, or nutrition sheets appear here.
            </p>
        );
    }
    return (
        <div className="h-full overflow-auto text-sm space-y-2 p-1">
            {notes.map((n, i) => (
                <div key={`${n.source}-${n.date}-${i}`} className="border-b border-border/40 pb-2">
                    <p className="text-xs text-muted-foreground">
                        {n.date}
                        {n.source ? ` · ${n.source}` : ''}
                    </p>
                    <p>{n.notes}</p>
                </div>
            ))}
        </div>
    );
}

function StatChip({
    label,
    value,
    hint,
}: {
    label: string;
    value: string;
    hint?: string;
}) {
    return (
        <div className="rounded-lg border border-border/50 bg-muted/30 px-2.5 py-1.5 min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                {label}
            </p>
            <p className="text-sm font-semibold tabular-nums truncate">{value}</p>
            {hint ? (
                <p className="text-[10px] text-muted-foreground truncate">{hint}</p>
            ) : null}
        </div>
    );
}

function BodyMetricsPanel() {
    const [series, setSeries] = useState<any[]>([]);
    const [summary, setSummary] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const load = useMemo(
        () => async () => {
            const d = await api.healthBody();
            setSeries(d.series || []);
            setSummary(d.summary || null);
            setLoading(false);
        },
        []
    );
    useHealthLiveReload(load);

    if (loading) {
        return (
            <p className="text-sm text-muted-foreground p-4">Loading body metrics…</p>
        );
    }

    if (!series.length) {
        return (
            <p className="text-sm text-muted-foreground p-4 text-center">
                No weight/body rows yet. Add Date + Weight (and optional Body Fat %) in your
                Google Sheet, then sync.
            </p>
        );
    }

    const latest = summary?.latest;
    const delta = summary?.delta_weight;
    const deltaLabel =
        delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta}`;

    const chartData = series.map((r) => ({
        date: r.date,
        weight: r.weight,
        body_fat_pct: r.body_fat_pct,
    }));

    const hasFat = series.some((r) => r.body_fat_pct != null);
    const keys = hasFat ? ['weight', 'body_fat_pct'] : ['weight'];

    return (
        <div className="h-full flex flex-col gap-2 p-2 min-h-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 shrink-0">
                <StatChip
                    label="Latest weight"
                    value={latest?.weight != null ? String(latest.weight) : '—'}
                    hint={latest?.date || undefined}
                />
                <StatChip
                    label="vs prior"
                    value={deltaLabel}
                    hint={delta == null ? 'need 2+ weigh-ins' : 'change'}
                />
                <StatChip
                    label="7-pt avg"
                    value={summary?.avg7_weight != null ? String(summary.avg7_weight) : '—'}
                />
                <StatChip
                    label="Body fat"
                    value={
                        latest?.body_fat_pct != null ? `${latest.body_fat_pct}%` : '—'
                    }
                    hint={
                        summary?.min_weight != null && summary?.max_weight != null
                            ? `range ${summary.min_weight}–${summary.max_weight}`
                            : undefined
                    }
                />
            </div>
            <div className="flex-1 min-h-0">
                <TrendChartCanvas
                    data={chartData}
                    dataKeys={keys}
                    title="Weight trend"
                    color="#8AB4F8"
                    showPoints
                />
            </div>
            {latest?.notes ? (
                <p className="text-[11px] text-muted-foreground italic shrink-0 truncate">
                    {latest.notes}
                </p>
            ) : null}
        </div>
    );
}

const BLOOD_GROUPS: { id: string; label: string; keys: string[]; color: string }[] = [
    {
        id: 'lipids',
        label: 'Lipids',
        keys: ['total_cholesterol', 'hdl', 'ldl', 'triglycerides'],
        color: '#f87171',
    },
    {
        id: 'metabolic',
        label: 'Metabolic',
        keys: ['fasting_glucose', 'hba1c'],
        color: '#fb923c',
    },
    {
        id: 'micros',
        label: 'Micros',
        keys: ['vitamin_d', 'vitamin_b12', 'iron', 'ferritin', 'magnesium', 'zinc'],
        color: '#4ECDC4',
    },
    {
        id: 'hormones',
        label: 'Hormones',
        keys: ['testosterone'],
        color: '#c084fc',
    },
];

const BLOOD_LABELS: Record<string, string> = {
    total_cholesterol: 'Total Chol',
    hdl: 'HDL',
    ldl: 'LDL',
    triglycerides: 'Trig',
    fasting_glucose: 'Glucose',
    hba1c: 'HbA1c',
    vitamin_d: 'Vit D',
    vitamin_b12: 'B12',
    iron: 'Iron',
    ferritin: 'Ferritin',
    magnesium: 'Mg',
    zinc: 'Zinc',
    testosterone: 'Testosterone',
};

function BloodworkPanel() {
    const [series, setSeries] = useState<any[]>([]);
    const [latest, setLatest] = useState<any>(null);
    const [group, setGroup] = useState(BLOOD_GROUPS[0].id);
    const [loading, setLoading] = useState(true);

    const load = useMemo(
        () => async () => {
            const d = await api.healthBloodwork();
            setSeries(d.series || []);
            setLatest(d.latest || null);
            setLoading(false);
        },
        []
    );
    useHealthLiveReload(load);

    if (loading) {
        return (
            <p className="text-sm text-muted-foreground p-4">Loading bloodwork…</p>
        );
    }

    if (!series.length) {
        return (
            <div className="h-full flex flex-col items-center justify-center gap-2 p-4 text-center">
                <p className="text-sm text-muted-foreground">
                    No lab draws yet. Add a row in the Bloodwork sheet (Date + markers), then
                    sync — trends and latest panels will appear here.
                </p>
            </div>
        );
    }

    const active = BLOOD_GROUPS.find((g) => g.id === group) || BLOOD_GROUPS[0];
    const presentKeys = active.keys.filter((k) =>
        series.some((r) => r[k] != null && r[k] !== '')
    );
    const chartKeys = presentKeys.length ? presentKeys : active.keys.slice(0, 1);

    const metricKeys = Object.keys(BLOOD_LABELS).filter(
        (k) => latest && latest[k] != null && latest[k] !== ''
    );

    return (
        <div className="h-full flex flex-col gap-2 p-2 min-h-0">
            <div className="flex items-center justify-between gap-2 shrink-0">
                <p className="text-xs text-muted-foreground">
                    Latest draw{' '}
                    <span className="text-foreground font-medium">{latest?.date}</span>
                    {series.length > 1 ? ` · ${series.length} draws` : ''}
                </p>
                <div className="flex flex-wrap gap-1 justify-end">
                    {BLOOD_GROUPS.map((g) => (
                        <button
                            key={g.id}
                            type="button"
                            onClick={() => setGroup(g.id)}
                            className={cn(
                                'text-[10px] px-2 py-0.5 rounded-md border transition-colors',
                                group === g.id
                                    ? 'bg-teal-600/20 border-teal-500/50 text-foreground'
                                    : 'border-border/50 text-muted-foreground hover:border-foreground/30'
                            )}
                        >
                            {g.label}
                        </button>
                    ))}
                </div>
            </div>

            {metricKeys.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5 shrink-0 max-h-[34%] overflow-auto">
                    {metricKeys.map((k) => (
                        <StatChip
                            key={k}
                            label={BLOOD_LABELS[k] || k}
                            value={String(latest[k])}
                        />
                    ))}
                </div>
            )}

            <div className="flex-1 min-h-0">
                {presentKeys.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-2">
                        No values yet in {active.label}. Fill those columns in the sheet.
                    </p>
                ) : (
                    <TrendChartCanvas
                        data={series}
                        dataKeys={chartKeys}
                        title={active.label}
                        color={active.color}
                        showPoints
                    />
                )}
            </div>

            {latest?.notes ? (
                <p className="text-[11px] text-muted-foreground italic shrink-0 truncate">
                    {latest.notes}
                </p>
            ) : null}
        </div>
    );
}

type NutritionDay = {
    date: string;
    pct: number;
    color: 'green' | 'yellow' | 'red';
    calories?: number | null;
    protein?: number | null;
    carbs?: number | null;
    fat?: number | null;
    fiber?: number | null;
    sugar?: number | null;
    water?: number | null;
    notes?: string;
    targets?: { protein_g: number; protein_ok_g: number; calories: number };
};

const NUTRITION_CHART_GROUPS: {
    id: string;
    label: string;
    keys: string[];
    color: string;
}[] = [
    {
        id: 'macros',
        label: 'Macros',
        keys: ['protein', 'carbs', 'fat', 'fiber', 'sugar'],
        color: '#34D399',
    },
    {
        id: 'calories',
        label: 'Calories',
        keys: ['calories'],
        color: '#FBBF24',
    },
    {
        id: 'water',
        label: 'Water (oz)',
        keys: ['water'],
        color: '#60A5FA',
    },
];

function NutritionCalendar() {
    const isMobileWeb = useIsMobileWeb();
    const [days, setDays] = useState<NutritionDay[]>([]);
    const [selected, setSelected] = useState<NutritionDay | null>(null);
    const [cursor, setCursor] = useState(() => new Date());
    const cursorInit = useMemo(() => ({ done: false }), []);

    const load = useMemo(
        () => async () => {
            const rows: NutritionDay[] = await api.healthNutritionCalendar();
            setDays(rows);
            setSelected((prev) => {
                if (!rows.length) return null;
                if (prev) {
                    const match = rows.find((r) => r.date === prev.date);
                    if (match) return match;
                }
                return rows[rows.length - 1];
            });
            if (rows.length && !cursorInit.done) {
                cursorInit.done = true;
                try {
                    setCursor(parseISO(rows[rows.length - 1].date + 'T12:00:00'));
                } catch {
                    /* ignore */
                }
            }
        },
        [cursorInit]
    );
    useHealthLiveReload(load);

    const byDate = useMemo(() => {
        const m = new Map<string, NutritionDay>();
        for (const d of days) m.set(d.date, d);
        return m;
    }, [days]);

    const cells = useMemo(() => {
        const monthStart = startOfMonth(cursor);
        const monthEnd = endOfMonth(cursor);
        return eachDayOfInterval({
            start: startOfWeek(monthStart),
            end: endOfWeek(monthEnd),
        });
    }, [cursor]);

    const target = days[0]?.targets?.protein_g ?? 140;
    const monthLabel = format(cursor, 'MMMM yyyy');

    return (
        <div
            className={cn(
                'h-full flex flex-col min-h-0',
                isMobileWeb ? 'gap-4 p-1' : 'gap-3 p-2'
            )}
        >
            <div className="flex items-center justify-between gap-2 shrink-0">
                <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCursor((c) => subMonths(c, 1))}
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="text-center">
                    <div className="text-sm font-semibold tracking-tight">{monthLabel}</div>
                    <div className="text-[10px] text-muted-foreground">
                        Green = protein ≥ {target}g (≈1g/lb @ 140 lb)
                    </div>
                </div>
                <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCursor((c) => addMonths(c, 1))}
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>

            <div
                className={cn(
                    'grid grid-cols-7 text-muted-foreground text-center shrink-0',
                    isMobileWeb ? 'gap-2 text-[10px]' : 'gap-1 text-[11px]'
                )}
            >
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                    <div key={d} className={cn('font-medium', isMobileWeb ? 'py-1.5' : 'py-1')}>
                        {d}
                    </div>
                ))}
            </div>

            <div
                className={cn(
                    'grid grid-cols-7 flex-1 min-h-0',
                    isMobileWeb ? 'gap-2.5 auto-rows-[minmax(3.75rem,1fr)]' : 'gap-1.5 auto-rows-fr'
                )}
            >
                {cells.map((day) => {
                    const key = format(day, 'yyyy-MM-dd');
                    const row = byDate.get(key);
                    const inMonth = isSameMonth(day, cursor);
                    const isSelected = selected && isSameDay(day, parseISO(selected.date));
                    const today = isSameDay(day, new Date());
                    const tint =
                        !row || !inMonth
                            ? ''
                            : row.color === 'green'
                              ? 'bg-emerald-500/15 border-emerald-500/40'
                              : row.color === 'yellow'
                                ? 'bg-amber-500/15 border-amber-500/40'
                                : 'bg-rose-500/15 border-rose-500/40';
                    const dot =
                        !row || !inMonth
                            ? null
                            : row.color === 'green'
                              ? 'bg-emerald-500'
                              : row.color === 'yellow'
                                ? 'bg-amber-500'
                                : 'bg-rose-500';

                    return (
                        <button
                            key={key}
                            type="button"
                            disabled={!row}
                            onClick={() => row && setSelected(row)}
                            className={cn(
                                'relative rounded-lg border text-left transition-colors flex flex-col justify-between',
                                isMobileWeb ? 'p-2 min-h-[3.75rem]' : 'p-1.5 min-h-[52px]',
                                inMonth
                                    ? 'border-border/60 bg-card/40'
                                    : 'border-transparent bg-transparent opacity-35',
                                tint,
                                row && inMonth && 'hover:border-foreground/30 cursor-pointer',
                                !row && inMonth && 'cursor-default',
                                isSelected && 'ring-2 ring-teal-500 border-teal-500/50',
                                today && inMonth && !isSelected && 'border-teal-600/50'
                            )}
                            title={
                                row
                                    ? `${key}: P ${row.protein ?? '—'}g · H2O ${row.water ?? '—'}oz · ${row.calories ?? '—'} kcal`
                                    : key
                            }
                        >
                            <span
                                className={cn(
                                    'font-medium',
                                    isMobileWeb ? 'text-[13px]' : 'text-xs',
                                    inMonth ? 'text-foreground' : 'text-muted-foreground'
                                )}
                            >
                                {format(day, 'd')}
                            </span>
                            {row && inMonth && (
                                <div className="flex flex-col gap-0.5 mt-auto min-w-0">
                                    <div className="flex items-center justify-between gap-1">
                                        <span className="text-[10px] text-muted-foreground tabular-nums truncate">
                                            {row.protein != null ? `${Math.round(row.protein)}g` : '—'}
                                        </span>
                                        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dot)} />
                                    </div>
                                    {row.water != null ? (
                                        <span className="text-[9px] text-sky-400/90 tabular-nums truncate">
                                            {Math.round(row.water)}oz
                                        </span>
                                    ) : null}
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            <div
                className={cn(
                    'flex text-muted-foreground shrink-0 px-0.5',
                    isMobileWeb ? 'flex-col gap-1.5 text-[11px]' : 'items-center gap-3 text-[10px]'
                )}
            >
                <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Protein on target
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-amber-500" /> ≥70% target
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-rose-500" /> Below
                </span>
            </div>

            {selected && (
                <div
                    className={cn(
                        'border-t pt-3',
                        isMobileWeb
                            ? 'shrink-0 max-h-none overflow-visible'
                            : 'shrink-0 max-h-[38%] overflow-auto'
                    )}
                >
                    <div className="flex items-baseline justify-between gap-2 mb-2">
                        <p className="text-sm font-medium">
                            {format(parseISO(selected.date), 'EEEE, MMM d')}
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                            {selected.pct}% of protein goal
                        </p>
                    </div>
                    <div className={cn('grid grid-cols-2 sm:grid-cols-4', isMobileWeb ? 'gap-2' : 'gap-1.5')}>
                        {(
                            [
                                ['Calories', selected.calories, ''],
                                ['Protein', selected.protein, 'g'],
                                ['Carbs', selected.carbs, 'g'],
                                ['Fat', selected.fat, 'g'],
                                ['Fiber', selected.fiber, 'g'],
                                ['Sugar', selected.sugar, 'g'],
                                ['Water', selected.water, 'oz'],
                            ] as const
                        ).map(([label, val, unit]) => (
                            <div
                                key={label}
                                className="rounded-md border border-border/50 bg-muted/20 px-2 py-1"
                            >
                                <p className="text-[10px] text-muted-foreground">{label}</p>
                                <p className="text-xs font-semibold tabular-nums">
                                    {val != null ? `${val}${unit}` : '—'}
                                </p>
                            </div>
                        ))}
                    </div>
                    {selected.notes ? (
                        <p className="text-xs text-muted-foreground mt-2 italic">{selected.notes}</p>
                    ) : (
                        <p className="text-[11px] text-muted-foreground/70 mt-2">No notes for this day.</p>
                    )}
                </div>
            )}

            {days.length === 0 && (
                <p className="text-sm text-muted-foreground p-2">
                    No nutrition rows yet. Fill Date + macros in the Daily Macro Tracker sheet, then
                    Sync from Google Sheets.
                </p>
            )}
        </div>
    );
}

function NutritionChart() {
    const [series, setSeries] = useState<any[]>([]);
    const [summary, setSummary] = useState<any>(null);
    const [group, setGroup] = useState(NUTRITION_CHART_GROUPS[0].id);
    const [loading, setLoading] = useState(true);

    const load = useMemo(
        () => async () => {
            const d = await api.healthNutrition();
            setSeries(d.series || []);
            setSummary(d.summary || null);
            setLoading(false);
        },
        []
    );
    useHealthLiveReload(load);

    if (loading) {
        return <p className="text-sm text-muted-foreground p-4">Loading macros…</p>;
    }
    if (!series.length) {
        return (
            <p className="text-sm text-muted-foreground p-4 text-center">
                No macro history yet. Log days in the nutrition sheet and sync.
            </p>
        );
    }

    const latest = summary?.latest;
    const targetP = summary?.targets?.protein_g ?? 140;
    const active = NUTRITION_CHART_GROUPS.find((g) => g.id === group) || NUTRITION_CHART_GROUPS[0];
    const presentKeys = active.keys.filter((k) =>
        series.some((r) => r[k] != null && r[k] !== '')
    );
    const chartKeys = presentKeys.length ? presentKeys : active.keys.slice(0, 1);

    return (
        <div className="h-full flex flex-col gap-2 p-2 min-h-0">
            <div className="flex items-center justify-between gap-2 shrink-0">
                <p className="text-xs text-muted-foreground">
                    Latest{' '}
                    <span className="text-foreground font-medium">{latest?.date || '—'}</span>
                    {series.length > 1 ? ` · ${series.length} days` : ''}
                </p>
                <div className="flex flex-wrap gap-1 justify-end">
                    {NUTRITION_CHART_GROUPS.map((g) => (
                        <button
                            key={g.id}
                            type="button"
                            onClick={() => setGroup(g.id)}
                            className={cn(
                                'text-[10px] px-2 py-0.5 rounded-md border transition-colors',
                                group === g.id
                                    ? 'bg-teal-600/20 border-teal-500/50 text-foreground'
                                    : 'border-border/50 text-muted-foreground hover:border-foreground/30'
                            )}
                        >
                            {g.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 shrink-0">
                <StatChip
                    label="Latest protein"
                    value={latest?.protein != null ? `${latest.protein}g` : '—'}
                    hint={latest?.date || undefined}
                />
                <StatChip
                    label="7-day avg protein"
                    value={summary?.avg7_protein != null ? `${summary.avg7_protein}g` : '—'}
                    hint={`goal ${targetP}g`}
                />
                <StatChip
                    label="Latest water"
                    value={latest?.water != null ? `${latest.water}oz` : '—'}
                />
                <StatChip
                    label="Latest calories"
                    value={latest?.calories != null ? String(latest.calories) : '—'}
                />
            </div>
            <div className="flex-1 min-h-0">
                {presentKeys.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-2">
                        No values yet in {active.label}. Fill those columns in the sheet.
                    </p>
                ) : (
                    <TrendChartCanvas
                        data={series}
                        dataKeys={chartKeys}
                        title={active.label}
                        color={active.color}
                        showPoints
                    />
                )}
            </div>
        </div>
    );
}

function NutritionNotes() {
    const [notes, setNotes] = useState<any[]>([]);
    const load = useMemo(
        () => async () => {
            setNotes(await api.healthNutritionNotes());
        },
        []
    );
    useHealthLiveReload(load);
    if (!notes.length) {
        return (
            <p className="text-sm text-muted-foreground p-4">
                No nutrition notes yet. Add Notes on the macro sheet and sync.
            </p>
        );
    }
    return (
        <div className="h-full overflow-auto text-sm space-y-2 p-1">
            {notes.map((n, i) => (
                <div key={`${n.date}-${i}`} className="border-b border-border/40 pb-2">
                    <p className="text-xs text-muted-foreground">{n.date}</p>
                    <p>{n.notes}</p>
                </div>
            ))}
        </div>
    );
}

export function HealthWidgetRegistry({ widget }: Props) {
    switch (widget.type) {
        case 'health_adherence_calendar':
            return <AdherenceCalendar />;
        case 'health_adherence_rates':
            return <AdherenceRates />;
        case 'health_notes':
            return <NotesFeed />;
        case 'health_body':
        case 'health_body_empty':
            return <BodyMetricsPanel />;
        case 'health_bloodwork':
        case 'health_bloodwork_empty':
            return <BloodworkPanel />;
        case 'health_nutrition_calendar':
            return <NutritionCalendar />;
        case 'health_nutrition_chart':
            return <NutritionChart />;
        case 'health_nutrition_notes':
            return <NutritionNotes />;
        default:
            return (
                <p className="text-sm text-muted-foreground p-4">
                    Unknown health widget: {widget.type}
                </p>
            );
    }
}

