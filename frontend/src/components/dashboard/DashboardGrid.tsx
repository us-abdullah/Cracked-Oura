import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import RGL, { WidthProvider } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { WidgetCard } from './WidgetCard';
import { WidgetRegistry } from '../WidgetRegistry';
import { HealthWidgetRegistry } from '../HealthWidgetRegistry';
import type { WidgetInstance, CompartmentId } from '@/types';
import { cn, isIntradayKey } from '@/lib/utils';
import { useIsMobileWeb } from '@/lib/webMirror';

import { DateRangeSelector } from './DateRangeSelector';

import { ErrorBoundary } from '../ErrorBoundary';

const GridLayout = WidthProvider(RGL);


interface DashboardGridProps {
    widgets: WidgetInstance[];
    layout: any[];
    isEditing: boolean;
    onLayoutChange: (layout: any[]) => void;
    onEditWidget?: (widget: WidgetInstance) => void;
    onWidgetChange?: (widget: WidgetInstance) => void;
    onDeleteWidget?: (widgetId: string) => void;

    data?: any;
    selectedDate: Date;
    compartment?: CompartmentId;
}

function renderWidget(
    widget: WidgetInstance,
    compartment: CompartmentId,
    data: any,
    selectedDate: Date,
    onWidgetChange?: (widget: WidgetInstance) => void
) {
    if (compartment === 'health') {
        return <HealthWidgetRegistry widget={widget} />;
    }
    return (
        <WidgetRegistry
            widget={widget}
            data={data}
            date={format(selectedDate, 'yyyy-MM-dd')}
            onUpdate={(updates) => onWidgetChange?.({ ...widget, ...updates })}
        />
    );
}

export function DashboardGrid({
    widgets,
    layout,
    isEditing,
    onLayoutChange,
    onEditWidget,
    onWidgetChange,
    onDeleteWidget,
    data,
    selectedDate,
    compartment = 'recovery',
}: DashboardGridProps) {
    // Fix for RGL mounting issue
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    // Web phone only — stack Recovery/Health so 12-col desktop layouts aren't squished
    const mobileWebStack = useIsMobileWeb() && compartment !== 'training';

    if (!mounted) return null;

    const renderCard = (widget: WidgetInstance, layoutItem: any, stacked: boolean) => {
        const supportsDateRange = widget.type === 'trend' || widget.type === 'bar';
        const showDateSelector =
            compartment === 'recovery' &&
            (!!widget.config.dateRange || supportsDateRange) &&
            widget.type !== 'table';

        const minH = stacked
            ? Math.max(200, Math.min(420, (layoutItem.h || 4) * 52))
            : undefined;

        return (
            <div
                key={widget.id}
                className="relative group"
                style={
                    stacked
                        ? { minHeight: minH, height: minH }
                        : {
                              gridColumn: `${(layoutItem.x || 0) + 1} / span ${layoutItem.w || 1}`,
                              gridRow: `${(layoutItem.y || 0) + 1} / span ${layoutItem.h || 1}`,
                          }
                }
            >
                <WidgetCard
                    title={widget.title}
                    subtitle={undefined}
                    isEditing={isEditing}
                    onEdit={() => onEditWidget?.(widget)}
                    onDelete={() => onDeleteWidget?.(widget.id)}
                    className="h-full"
                    headerContent={
                        showDateSelector && (
                            <DateRangeSelector
                                widget={widget}
                                onUpdate={(updates) =>
                                    onWidgetChange?.({ ...widget, ...updates })
                                }
                                selectedDate={selectedDate}
                                isLocked={isIntradayKey(
                                    widget.config.dataKey ||
                                        widget.config.dataKeys?.[0] ||
                                        ''
                                )}
                            />
                        )
                    }
                >
                    <div className="h-full pt-2 min-h-0 overflow-hidden">
                        <ErrorBoundary>
                            {renderWidget(
                                widget,
                                compartment,
                                data,
                                selectedDate,
                                onWidgetChange
                            )}
                        </ErrorBoundary>
                    </div>
                </WidgetCard>
            </div>
        );
    };

    // Phone web: single-column stack (desktop Electron unchanged)
    if (!isEditing && mobileWebStack) {
        const ordered = [...widgets]
            .map((w) => ({ widget: w, layoutItem: layout.find((l) => l.i === w.id) }))
            .filter((x) => x.layoutItem)
            .sort((a, b) => {
                const ay = a.layoutItem!.y || 0;
                const by = b.layoutItem!.y || 0;
                if (ay !== by) return ay - by;
                return (a.layoutItem!.x || 0) - (b.layoutItem!.x || 0);
            });

        return (
            <div className="web-mobile-stack w-full">
                {ordered.map(({ widget, layoutItem }) =>
                    renderCard(widget, layoutItem, true)
                )}
            </div>
        );
    }

    return (
        <div className={cn("w-full", isEditing && "bg-secondary/10 rounded-xl border border-dashed border-secondary/50")}>
            {isEditing ? (
                <GridLayout
                    className="layout"
                    layout={layout}
                    cols={12}
                    rowHeight={60}
                    isDraggable={isEditing}
                    isResizable={isEditing}
                    onLayoutChange={onLayoutChange as any}
                    margin={[16, 16]}
                    containerPadding={[16, 16]}
                    draggableHandle=".drag-handle"
                >
                    {widgets.map((widget) => {
                        const layoutItem = layout.find(l => l.i === widget.id);
                        if (!layoutItem) return null;
                        const supportsDateRange = widget.type === 'trend' || widget.type === 'bar';
                        const showDateSelector =
                            compartment === 'recovery' &&
                            (!!widget.config.dateRange || supportsDateRange) &&
                            widget.type !== 'table';

                        return (
                            <div key={widget.id} className="relative group">
                                <WidgetCard
                                    title={widget.title}
                                    subtitle={undefined}
                                    isEditing={isEditing}
                                    onEdit={() => onEditWidget?.(widget)}
                                    onDelete={() => onDeleteWidget?.(widget.id)}
                                    className="h-full"
                                    headerContent={showDateSelector && (
                                        <DateRangeSelector
                                            widget={widget}
                                            onUpdate={(updates) => onWidgetChange?.({ ...widget, ...updates })}
                                            selectedDate={selectedDate}
                                            isLocked={isIntradayKey(widget.config.dataKey || widget.config.dataKeys?.[0] || '')}
                                        />
                                    )}
                                >
                                    <div className="h-full pt-2">
                                        <ErrorBoundary>
                                            {renderWidget(widget, compartment, data, selectedDate, onWidgetChange)}
                                        </ErrorBoundary>
                                    </div>
                                </WidgetCard>
                            </div>
                        );
                    })}
                </GridLayout >
            ) : (
                <div
                    className="grid grid-cols-12 gap-4 p-4"
                    style={{
                        gridAutoRows: '60px'
                    }}
                >
                    {widgets.map((widget) => {
                        const layoutItem = layout.find(l => l.i === widget.id);
                        if (!layoutItem) return null;
                        return renderCard(widget, layoutItem, false);
                    })}
                </div >
            )
            }
        </div >
    );
}
