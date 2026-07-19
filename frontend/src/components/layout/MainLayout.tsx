import { AppSidebar } from './AppSidebar';
import { Button } from '@/components/ui/button';
import { Sparkles, Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { Dashboard, CompartmentId } from '@/types';
import { ModeToggle } from '@/components/mode-toggle';
import { UpdatePhoneButton } from '@/components/UpdatePhoneButton';
import { useIsMobileWeb, useIsWebMirror } from '@/lib/webMirror';

interface MainLayoutProps {
    children: React.ReactNode;
    rightPanel?: React.ReactNode;
    onChatToggle?: () => void;
    isChatOpen?: boolean;
    selectedDate?: Date;
    onDateChange?: (date: Date | undefined) => void;
    onSettingsClick?: () => void;
    headerActions?: React.ReactNode;

    dashboards: Dashboard[];
    activeDashboardId: string;
    onDashboardSelect: (id: string) => void;
    onDashboardAdd: () => void;
    onDashboardDelete: (id: string) => void;
    onDashboardRename: (id: string, newName: string) => void;

    activeView?: 'dashboard' | 'chat-page';
    onChatPageSelect?: () => void;

    activeCompartment: CompartmentId;
    onCompartmentChange: (c: CompartmentId) => void;
    /** Fixed list (e.g. Training Hevy pages) — no rename/delete/add */
    staticDashboards?: boolean;
    headerTitle?: string;
}

export function MainLayout({
    children,
    rightPanel,
    onChatToggle,
    isChatOpen,
    selectedDate = new Date(),
    onDateChange,
    onSettingsClick,
    headerActions,
    dashboards,
    activeDashboardId,
    onDashboardSelect,
    onDashboardAdd,
    onDashboardDelete,
    onDashboardRename,
    activeView,
    onChatPageSelect,
    activeCompartment,
    onCompartmentChange,
    staticDashboards = false,
    headerTitle,
}: MainLayoutProps) {
    const isWeb = useIsWebMirror();
    const isMobileWeb = useIsMobileWeb();
    const activeDashboardName =
        headerTitle ||
        dashboards.find((d) => d.id === activeDashboardId)?.name ||
        'Dashboard';
    const showRecoveryChrome = activeCompartment === 'recovery';
    // Training already has its own mobile UI; keep header minimal there on phones
    const showHeader = !(isMobileWeb && activeCompartment === 'training');

    return (
        <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
            <AppSidebar
                onSettingsClick={onSettingsClick}
                dashboards={dashboards}
                activeDashboardId={activeDashboardId}
                onDashboardSelect={onDashboardSelect}
                onDashboardAdd={onDashboardAdd}
                onDashboardDelete={onDashboardDelete}
                onDashboardRename={onDashboardRename}
                activeView={activeView}
                onChatPageSelect={onChatPageSelect}
                activeCompartment={activeCompartment}
                onCompartmentChange={onCompartmentChange}
                staticDashboards={staticDashboards}
            />

            <div className="flex-1 flex flex-col min-w-0">
                {showHeader && (
                    <header
                        className={cn(
                            'border-b flex items-center justify-between bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50',
                            isWeb ? 'web-app-header' : 'h-16 px-6',
                            isMobileWeb && 'pl-14' // room for hamburger
                        )}
                    >
                        <div
                            className={cn(
                                'flex items-center gap-4 min-w-0',
                                isMobileWeb && 'flex-wrap gap-2'
                            )}
                        >
                            <h1
                                className={cn(
                                    'font-semibold truncate',
                                    isMobileWeb ? 'text-base' : 'text-xl'
                                )}
                            >
                                {activeDashboardName}
                            </h1>
                            {showRecoveryChrome && (
                                <>
                                    {!isMobileWeb && <div className="h-6 w-px bg-border" />}
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-9 w-9 shrink-0"
                                            onClick={() => {
                                                if (onDateChange && selectedDate) {
                                                    const prevDay = new Date(selectedDate);
                                                    prevDay.setDate(prevDay.getDate() - 1);
                                                    onDateChange(prevDay);
                                                }
                                            }}
                                        >
                                            <ChevronLeft className="h-4 w-4" />
                                        </Button>

                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant={'outline'}
                                                    className={cn(
                                                        'h-9 justify-start text-left font-normal',
                                                        isMobileWeb ? 'w-[9.5rem] px-2 text-xs' : 'w-[240px]',
                                                        !selectedDate && 'text-muted-foreground'
                                                    )}
                                                >
                                                    <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                                                    {selectedDate ? (
                                                        format(
                                                            selectedDate,
                                                            isMobileWeb ? 'MMM d' : 'PPP'
                                                        )
                                                    ) : (
                                                        <span>Pick a date</span>
                                                    )}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0" align="start">
                                                <Calendar
                                                    mode="single"
                                                    selected={selectedDate}
                                                    onSelect={onDateChange}
                                                    initialFocus
                                                />
                                            </PopoverContent>
                                        </Popover>

                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-9 w-9 shrink-0"
                                            onClick={() => {
                                                if (onDateChange && selectedDate) {
                                                    const nextDay = new Date(selectedDate);
                                                    nextDay.setDate(nextDay.getDate() + 1);
                                                    onDateChange(nextDay);
                                                }
                                            }}
                                        >
                                            <ChevronRight className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            {!isMobileWeb && headerActions}
                            <span className={cn(isMobileWeb && 'web-hide-on-mobile')}>
                                <UpdatePhoneButton />
                            </span>
                            <ModeToggle />
                            {showRecoveryChrome && !isMobileWeb && (
                                <Button
                                    variant={isChatOpen ? 'secondary' : 'outline'}
                                    size="sm"
                                    onClick={onChatToggle}
                                >
                                    <Sparkles className="h-4 w-4 mr-2" />
                                    Ask AI
                                </Button>
                            )}
                        </div>
                    </header>
                )}

                <div className="flex-1 flex overflow-hidden">
                    <main
                        className={cn(
                            'flex-1 overflow-auto relative',
                            isWeb ? 'web-main-pad' : 'p-6',
                            isMobileWeb && activeCompartment === 'training' && 'p-0'
                        )}
                    >
                        {children}
                    </main>
                    {rightPanel ? (
                        <div className={cn(isWeb && 'web-right-panel')}>{rightPanel}</div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
