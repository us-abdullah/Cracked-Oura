import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { WidgetInstance, Dashboard, CompartmentId } from '@/types';
import { useOuraData } from '@/hooks/useOuraData';
import { useDashboardPersistence } from '@/hooks/useDashboardPersistence';
import { format } from 'date-fns';

const EMPTY_DASHBOARD: Dashboard = {
    id: 'default',
    name: 'Daily Overview',
    widgets: [],
    layout: [],
};

type PanelType = 'none' | 'chat' | 'editor' | 'settings';
type ViewType = 'dashboard' | 'chat-page';

const COMPARTMENT_KEY = 'biotracker_compartment';

interface DashboardContextType {
    activeCompartment: CompartmentId;
    setActiveCompartment: (c: CompartmentId) => void;

    dashboards: Dashboard[];
    activeDashboardId: string;
    activeDashboard: Dashboard;
    setActiveDashboardId: (id: string) => void;
    addDashboard: () => void;
    deleteDashboard: (id: string) => void;
    renameDashboard: (id: string, name: string) => void;

    widgets: WidgetInstance[];
    layout: any[];
    updateActiveDashboard: (updates: Partial<Dashboard>) => void;

    isEditing: boolean;
    setIsEditing: (isEditing: boolean) => void;
    activePanel: PanelType;
    setActivePanel: (panel: PanelType) => void;
    activeView: ViewType;
    setActiveView: (view: ViewType) => void;

    editingWidget: WidgetInstance | undefined;
    startEditingWidget: (widget?: WidgetInstance) => void;
    saveEditingWidget: () => void;
    cancelEditingWidget: () => void;
    updateEditingWidget: (widget: WidgetInstance) => void;
    deleteWidget: (id: string) => void;

    selectedDate: Date;
    setSelectedDate: (date: Date) => void;
    data: any;
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

function loadCompartment(): CompartmentId {
    try {
        const v = localStorage.getItem(COMPARTMENT_KEY);
        if (v === 'training' || v === 'health' || v === 'recovery') return v;
    } catch {
        /* ignore */
    }
    return 'recovery';
}

export function DashboardProvider({ children }: { children: ReactNode }) {
    const [activeCompartment, setActiveCompartmentState] = useState<CompartmentId>(loadCompartment);
    const [isEditing, setIsEditing] = useState(false);
    const [activePanel, setActivePanel] = useState<PanelType>('none');
    const [activeView, setActiveView] = useState<ViewType>('dashboard');
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [hasSnappedToData, setHasSnappedToData] = useState(false);

    const [dashboards, setDashboards] = useState<Dashboard[]>([EMPTY_DASHBOARD]);
    const [activeDashboardId, setActiveDashboardId] = useState<string>('default');

    const [editingWidget, setEditingWidget] = useState<WidgetInstance | undefined>(undefined);
    const [originalWidget, setOriginalWidget] = useState<WidgetInstance | undefined>(undefined);

    const { savedDashboards, savedActiveDashboardId, saveDashboards } =
        useDashboardPersistence(activeCompartment);

    const dateString = format(selectedDate, 'yyyy-MM-dd');
    const data = useOuraData(activeCompartment === 'recovery' ? dateString : '');

    const setActiveCompartment = (c: CompartmentId) => {
        setActiveCompartmentState(c);
        try {
            localStorage.setItem(COMPARTMENT_KEY, c);
        } catch {
            /* ignore */
        }
        setIsEditing(false);
        setActivePanel('none');
        setActiveView('dashboard');
        setHasSnappedToData(false);
    };

    useEffect(() => {
        if (activeCompartment !== 'recovery' || hasSnappedToData) return;
        const sleepHistory = data?.history?.sleep;
        if (!Array.isArray(sleepHistory) || sleepHistory.length === 0) return;

        const hasToday =
            data?.sleep?.score != null ||
            sleepHistory.some((p: any) => (p.date || p.day || '').startsWith(dateString));

        if (hasToday) {
            setHasSnappedToData(true);
            return;
        }

        const dates = sleepHistory
            .map((p: any) => String(p.date || p.day || '').slice(0, 10))
            .filter(Boolean)
            .sort();
        const latest = dates[dates.length - 1];
        if (latest) {
            const [y, m, d] = latest.split('-').map(Number);
            setSelectedDate(new Date(y, m - 1, d));
            setHasSnappedToData(true);
        }
    }, [data, dateString, hasSnappedToData, activeCompartment]);

    useEffect(() => {
        if (savedDashboards && savedDashboards.length > 0) {
            setDashboards(savedDashboards);
            if (savedActiveDashboardId) {
                setActiveDashboardId(savedActiveDashboardId);
            } else {
                setActiveDashboardId(savedDashboards[0].id);
            }
        } else if (savedDashboards && savedDashboards.length === 0) {
            setDashboards([EMPTY_DASHBOARD]);
            setActiveDashboardId('default');
        }
    }, [savedDashboards, savedActiveDashboardId, activeCompartment]);

    useEffect(() => {
        window.dispatchEvent(new Event('resize'));
    }, [activePanel, activeCompartment]);

    const activeDashboard = dashboards.find((d) => d.id === activeDashboardId) || dashboards[0];
    const widgets = activeDashboard?.widgets || [];
    const layout = activeDashboard?.layout || [];

    const persist = (newDashboards: Dashboard[], newActiveId: string) => {
        saveDashboards(newDashboards, newActiveId);
    };

    const addDashboard = () => {
        const newId = `dashboard-${Date.now()}`;
        const newDashboard: Dashboard = {
            id: newId,
            name: 'New Dashboard',
            widgets: [],
            layout: [],
        };
        const newDashboards = [...dashboards, newDashboard];
        setDashboards(newDashboards);
        setActiveDashboardId(newId);
        setActiveView('dashboard');
        persist(newDashboards, newId);
    };

    const deleteDashboard = (id: string) => {
        if (dashboards.length <= 1) return;
        const newDashboards = dashboards.filter((d) => d.id !== id);
        setDashboards(newDashboards);

        let newActiveId = activeDashboardId;
        if (activeDashboardId === id) {
            newActiveId = newDashboards[0].id;
            setActiveDashboardId(newActiveId);
        }
        persist(newDashboards, newActiveId);
    };

    const renameDashboard = (id: string, name: string) => {
        const newDashboards = dashboards.map((d) => (d.id === id ? { ...d, name } : d));
        setDashboards(newDashboards);
        persist(newDashboards, activeDashboardId);
    };

    const handleUpdateActiveDashboard = (updates: Partial<Dashboard>) => {
        const newDashboards = dashboards.map((d) =>
            d.id === activeDashboardId ? { ...d, ...updates } : d
        );
        setDashboards(newDashboards);
        persist(newDashboards, activeDashboardId);
    };

    const startEditingWidget = (widget?: WidgetInstance) => {
        if (widget) {
            setEditingWidget(widget);
            setOriginalWidget(widget);
        } else {
            const maxId =
                widgets.length > 0 ? Math.max(...widgets.map((w) => parseInt(w.id) || 0)) : 0;
            const newId = (maxId + 1).toString();
            const defaultType =
                activeCompartment === 'training'
                    ? 'hevy_heatmap'
                    : activeCompartment === 'health'
                      ? 'health_adherence_calendar'
                      : 'score';

            const newWidget: WidgetInstance = {
                id: newId,
                type: defaultType,
                title: 'New Widget',
                width: 'col-span-4',
                height: 'h-40',
                config: { dataKey: 'sleep.score', color: '#8AB4F8' },
            };

            const newWidgets = [...widgets, newWidget];
            const newLayout = [
                ...layout,
                { i: newId, x: 0, y: Infinity, w: 4, h: 4 },
            ];

            handleUpdateActiveDashboard({ widgets: newWidgets, layout: newLayout });
            setEditingWidget(newWidget);
            setOriginalWidget(undefined);
        }
        setActivePanel('editor');
    };

    const updateEditingWidget = (updatedWidget: WidgetInstance) => {
        setDashboards((prev) =>
            prev.map((d) =>
                d.id === activeDashboardId
                    ? {
                          ...d,
                          widgets: d.widgets.map((w) =>
                              w.id === updatedWidget.id ? updatedWidget : w
                          ),
                      }
                    : d
            )
        );
        setEditingWidget(updatedWidget);
    };

    const saveEditingWidget = () => {
        setEditingWidget(undefined);
        setOriginalWidget(undefined);
        setActivePanel('none');
        persist(dashboards, activeDashboardId);
    };

    const cancelEditingWidget = () => {
        if (originalWidget) {
            const newWidgets = widgets.map((w) =>
                w.id === originalWidget.id ? originalWidget : w
            );
            handleUpdateActiveDashboard({ widgets: newWidgets });
        } else if (editingWidget) {
            const newWidgets = widgets.filter((w) => w.id !== editingWidget.id);
            const newLayout = layout.filter((l) => l.i !== editingWidget.id);
            handleUpdateActiveDashboard({ widgets: newWidgets, layout: newLayout });
        }
        setEditingWidget(undefined);
        setOriginalWidget(undefined);
        setActivePanel('none');
    };

    const deleteWidget = (id: string) => {
        const newWidgets = widgets.filter((w) => w.id !== id);
        const newLayout = layout.filter((l) => l.i !== id);
        const newDashboards = dashboards.map((d) =>
            d.id === activeDashboardId ? { ...d, widgets: newWidgets, layout: newLayout } : d
        );
        setDashboards(newDashboards);
        persist(newDashboards, activeDashboardId);
    };

    return (
        <DashboardContext.Provider
            value={{
                activeCompartment,
                setActiveCompartment,
                dashboards,
                activeDashboardId,
                activeDashboard,
                setActiveDashboardId,
                addDashboard,
                deleteDashboard,
                renameDashboard,
                widgets,
                layout,
                updateActiveDashboard: handleUpdateActiveDashboard,
                isEditing,
                setIsEditing,
                activePanel,
                setActivePanel,
                activeView,
                setActiveView,
                editingWidget,
                startEditingWidget,
                saveEditingWidget,
                cancelEditingWidget,
                updateEditingWidget,
                deleteWidget,
                selectedDate,
                setSelectedDate,
                data,
            }}
        >
            {children}
        </DashboardContext.Provider>
    );
}

export function useDashboard() {
    const context = useContext(DashboardContext);
    if (context === undefined) {
        throw new Error('useDashboard must be used within a DashboardProvider');
    }
    return context;
}
