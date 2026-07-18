import { useState, useEffect, useCallback } from 'react';
import type { Dashboard, CompartmentId } from '../types';
import { api } from '@/lib/api';

const widgetCount = (dashboards: Dashboard[] | null | undefined) =>
    (dashboards || []).reduce((n, d) => n + (d.widgets?.length || 0), 0);

export const useDashboardPersistence = (compartment: CompartmentId = 'recovery') => {
    const [savedDashboards, setSavedDashboards] = useState<Dashboard[] | null>(null);
    const [savedActiveDashboardId, setSavedActiveDashboardId] = useState<string | null>(null);

    useEffect(() => {
        let attempts = 0;
        const maxAttempts = 15;
        let cancelled = false;

        const loadConfig = () => {
            const loader =
                compartment === 'recovery'
                    ? api.getLayout()
                    : api.getCompartmentLayout(compartment);

            loader
                .then((data) => {
                    if (cancelled) return;
                    if (data.dashboards && Array.isArray(data.dashboards)) {
                        setSavedDashboards(data.dashboards);
                        setSavedActiveDashboardId(
                            data.activeDashboardId || data.dashboards[0]?.id
                        );
                    } else if (data.widgets && data.layout) {
                        const defaultDashboard: Dashboard = {
                            id: 'default',
                            name: 'Daily Overview',
                            widgets: data.widgets,
                            layout: data.layout,
                        };
                        setSavedDashboards([defaultDashboard]);
                        setSavedActiveDashboardId('default');
                    }
                })
                .catch(() => {
                    if (cancelled) return;
                    attempts++;
                    if (attempts < maxAttempts) {
                        setTimeout(loadConfig, 1000);
                    } else {
                        console.error(
                            `Gave up loading ${compartment} dashboard config.`
                        );
                    }
                });
        };

        setSavedDashboards(null);
        setSavedActiveDashboardId(null);
        loadConfig();
        return () => {
            cancelled = true;
        };
    }, [compartment]);

    const saveDashboards = useCallback(
        (dashboards: Dashboard[], activeDashboardId: string) => {
            if (widgetCount(dashboards) === 0 && widgetCount(savedDashboards) > 0) {
                console.warn('Skipped saving empty dashboard over existing widgets.');
                return;
            }

            const payload = { dashboards, activeDashboardId };
            const saver =
                compartment === 'recovery'
                    ? api.saveLayout(payload)
                    : api.saveCompartmentLayout(compartment, payload);

            saver.catch((err) =>
                console.error(`Error saving ${compartment} dashboard:`, err)
            );

            setSavedDashboards(dashboards);
            setSavedActiveDashboardId(activeDashboardId);
        },
        [savedDashboards, compartment]
    );

    return { savedDashboards, savedActiveDashboardId, saveDashboards };
};
