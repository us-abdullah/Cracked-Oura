import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useIsWebMirror, useIsMobileWeb } from '@/lib/webMirror';
import {
    LayoutDashboard,
    Settings,
    ChevronLeft,
    ChevronRight,
    Plus,
    MoreVertical,
    Trash2,
    Edit2,
    Sparkles,
    Moon,
    Dumbbell,
    Pill,
    Menu,
    X,
} from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import type { Dashboard, CompartmentId } from '@/types';

interface AppSidebarProps {
    className?: string;
    dashboards: Dashboard[];
    activeDashboardId: string;
    onDashboardSelect: (id: string) => void;
    onDashboardAdd: () => void;
    onDashboardDelete: (id: string) => void;
    onDashboardRename: (id: string, newName: string) => void;
    onSettingsClick?: () => void;
    onChatPageSelect?: () => void;
    activeView?: 'dashboard' | 'chat-page';
    activeCompartment: CompartmentId;
    onCompartmentChange: (c: CompartmentId) => void;
    /** Fixed list (e.g. Training Hevy pages) — no rename/delete/add */
    staticDashboards?: boolean;
}

const COMPARTMENTS: { id: CompartmentId; label: string; icon: typeof Moon }[] = [
    { id: 'recovery', label: 'Recovery', icon: Moon },
    { id: 'training', label: 'Training', icon: Dumbbell },
    { id: 'health', label: 'Health', icon: Pill },
];

export function AppSidebar({
    className,
    dashboards,
    activeDashboardId,
    onDashboardSelect,
    onDashboardAdd,
    onDashboardDelete,
    onDashboardRename,
    onSettingsClick,
    onChatPageSelect,
    activeView = 'dashboard',
    activeCompartment,
    onCompartmentChange,
    staticDashboards = false,
}: AppSidebarProps) {
    const isWeb = useIsWebMirror();
    const isMobileWeb = useIsMobileWeb();
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');

    // Web phone: start collapsed to free content width
    useEffect(() => {
        if (isMobileWeb) setCollapsed(true);
    }, [isMobileWeb]);

    const handleStartEdit = (dashboard: Dashboard) => {
        setEditingId(dashboard.id);
        setEditName(dashboard.name);
    };

    const handleSaveEdit = () => {
        if (editingId && editName.trim()) {
            onDashboardRename(editingId, editName.trim());
        }
        setEditingId(null);
    };

    const selectDashboard = (id: string) => {
        onDashboardSelect(id);
        if (isMobileWeb) setMobileOpen(false);
    };

    const selectCompartment = (id: CompartmentId) => {
        onCompartmentChange(id);
        if (isMobileWeb) setMobileOpen(false);
    };

    const footerControls = (
        <div
            className={cn(
                'space-y-1',
                isWeb ? 'px-2 pt-2 mt-1 border-t' : 'p-2 border-t space-y-2'
            )}
        >
            <Button
                variant="ghost"
                size="icon"
                className="w-full"
                onClick={() => setCollapsed(!collapsed)}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
                {collapsed ? (
                    <ChevronRight className="h-4 w-4" />
                ) : (
                    <ChevronLeft className="h-4 w-4" />
                )}
            </Button>
            <Button
                variant="ghost"
                size="icon"
                className="w-full"
                onClick={onSettingsClick}
                title="Settings"
            >
                <Settings className="h-5 w-5" />
            </Button>
        </div>
    );

    const sidebarInner = (
        <>
            <div className="h-16 flex items-center px-4 border-b shrink-0">
                <div
                    className={cn(
                        'flex items-center gap-2 overflow-hidden',
                        collapsed && 'justify-center w-full'
                    )}
                >
                    <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden bg-teal-800">
                        <img src="icon.png" alt="Logo" className="h-full w-full object-cover" />
                    </div>
                    {!collapsed && (
                        <span className="font-bold text-base whitespace-nowrap leading-tight">
                            Usman Biotracker
                        </span>
                    )}
                    {isMobileWeb && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="ml-auto shrink-0"
                            onClick={() => setMobileOpen(false)}
                        >
                            <X className="h-5 w-5" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Web: nav + footer stay together (footer under dashboards). Desktop: scroll + sticky footer. */}
            {isWeb ? (
                <div className="flex-1 overflow-y-auto py-3">
                    {renderNav()}
                    {footerControls}
                </div>
            ) : (
                <>
                    <ScrollArea className="flex-1 py-3">{renderNav()}</ScrollArea>
                    {footerControls}
                </>
            )}
        </>
    );

    function renderNav() {
        return (
            <>
                <div className="px-2 space-y-1 mb-3">
                    {!collapsed && (
                        <p className="px-3 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                            Compartments
                        </p>
                    )}
                    {COMPARTMENTS.map(({ id, label, icon: Icon }) => (
                        <Button
                            key={id}
                            variant={activeCompartment === id ? 'secondary' : 'ghost'}
                            className={cn(
                                'w-full justify-start gap-3',
                                collapsed ? 'px-2 justify-center' : 'px-4',
                                activeCompartment === id && 'bg-secondary/50'
                            )}
                            onClick={() => selectCompartment(id)}
                            title={collapsed ? label : undefined}
                        >
                            <Icon className="h-5 w-5 shrink-0" />
                            {!collapsed && (
                                <span className="truncate flex-1 text-left">{label}</span>
                            )}
                        </Button>
                    ))}
                </div>

                <div className="px-2 pt-2 border-t space-y-1">
                    {!collapsed && (
                        <p className="px-3 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                            Dashboards
                        </p>
                    )}
                    {dashboards.map((dashboard) => (
                        <div key={dashboard.id} className="group relative flex items-center">
                            {editingId === dashboard.id && !collapsed && !staticDashboards ? (
                                <div className="flex items-center w-full px-2">
                                    <Input
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        onBlur={handleSaveEdit}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                                        autoFocus
                                        className="h-8 text-sm"
                                    />
                                </div>
                            ) : (
                                <Button
                                    variant={
                                        activeDashboardId === dashboard.id &&
                                        activeView === 'dashboard'
                                            ? 'secondary'
                                            : 'ghost'
                                    }
                                    className={cn(
                                        'w-full justify-start gap-3',
                                        collapsed ? 'px-2 justify-center' : 'px-4',
                                        activeDashboardId === dashboard.id &&
                                            activeView === 'dashboard' &&
                                            'bg-secondary/50'
                                    )}
                                    onClick={() => selectDashboard(dashboard.id)}
                                    title={collapsed ? dashboard.name : undefined}
                                >
                                    <LayoutDashboard className="h-5 w-5 shrink-0" />
                                    {!collapsed && (
                                        <span className="truncate flex-1 text-left">
                                            {dashboard.name}
                                        </span>
                                    )}
                                </Button>
                            )}

                            {!collapsed && !editingId && !staticDashboards && (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 absolute right-1 text-muted-foreground hover:text-foreground"
                                        >
                                            <MoreVertical className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => handleStartEdit(dashboard)}>
                                            <Edit2 className="h-4 w-4 mr-2" />
                                            Rename
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            className="text-destructive focus:text-destructive"
                                            onClick={() => onDashboardDelete(dashboard.id)}
                                            disabled={dashboards.length <= 1}
                                        >
                                            <Trash2 className="h-4 w-4 mr-2" />
                                            Delete
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            )}
                        </div>
                    ))}

                    {!staticDashboards && !collapsed && (
                        <Button
                            variant="ghost"
                            className="w-full justify-start gap-3 px-4 text-muted-foreground hover:text-foreground"
                            onClick={onDashboardAdd}
                        >
                            <Plus className="h-5 w-5 shrink-0" />
                            <span>Add Dashboard</span>
                        </Button>
                    )}
                    {!staticDashboards && collapsed && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="w-full justify-center"
                            onClick={onDashboardAdd}
                            title="Add Dashboard"
                        >
                            <Plus className="h-5 w-5" />
                        </Button>
                    )}
                </div>

                {activeCompartment === 'recovery' && (
                    <div className="px-2 mt-2 pt-2 border-t">
                        <Button
                            variant={activeView === 'chat-page' ? 'secondary' : 'ghost'}
                            className={cn(
                                'w-full justify-start gap-3',
                                collapsed ? 'px-2 justify-center' : 'px-4',
                                activeView === 'chat-page' && 'bg-secondary/50'
                            )}
                            onClick={() => {
                                onChatPageSelect?.();
                                if (isMobileWeb) setMobileOpen(false);
                            }}
                            title={collapsed ? 'AI Chat' : undefined}
                        >
                            <Sparkles className="h-5 w-5 shrink-0" />
                            {!collapsed && (
                                <span className="truncate flex-1 text-left">AI Chat</span>
                            )}
                        </Button>
                    </div>
                )}
            </>
        );
    }

    // Mobile web: hamburger + drawer overlay (Training iframe stays full-bleed when closed)
    // z-[300+] so widget titles (z-50/60/100) never paint over the menu
    if (isMobileWeb) {
        return (
            <>
                <div className="fixed top-3 left-3 z-[310]">
                    <Button
                        variant="secondary"
                        size="icon"
                        className="h-10 w-10 shadow-md"
                        onClick={() => setMobileOpen(true)}
                        title="Menu"
                    >
                        <Menu className="h-5 w-5" />
                    </Button>
                </div>
                {mobileOpen && (
                    <div className="fixed inset-0 z-[300] flex">
                        <button
                            type="button"
                            className="absolute inset-0 bg-black/60"
                            aria-label="Close menu"
                            onClick={() => setMobileOpen(false)}
                        />
                        <div
                            className={cn(
                                'relative z-[301] flex h-full flex-col border-r bg-card shadow-xl',
                                collapsed ? 'w-16' : 'w-[min(18rem,85vw)]',
                                className
                            )}
                        >
                            {sidebarInner}
                        </div>
                    </div>
                )}
            </>
        );
    }

    return (
        <div
            className={cn(
                'flex flex-col border-r bg-card',
                collapsed ? 'w-16' : 'w-64',
                className
            )}
        >
            {sidebarInner}
        </div>
    );
}
