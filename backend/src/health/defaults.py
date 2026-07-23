"""Default Health dashboard widgets."""

DEFAULT_HEALTH_DASHBOARD = {
    "dashboards": [
        {
            "id": "health-overview",
            "name": "Supplement Tracker",
            "widgets": [
                {
                    "id": "1",
                    "type": "health_adherence_calendar",
                    "title": "Supplement Adherence",
                    "width": "col-span-8",
                    "height": "h-80",
                    "config": {},
                },
                {
                    "id": "2",
                    "type": "health_adherence_rates",
                    "title": "Per-Supplement Adherence",
                    "width": "col-span-4",
                    "height": "h-80",
                    "config": {},
                },
                {
                    "id": "3",
                    "type": "health_notes",
                    "title": "Notes",
                    "width": "col-span-4",
                    "height": "h-48",
                    "config": {},
                },
                {
                    "id": "4",
                    "type": "health_body",
                    "title": "Weight & Body Metrics",
                    "width": "col-span-8",
                    "height": "h-64",
                    "config": {},
                },
                {
                    "id": "5",
                    "type": "health_bloodwork",
                    "title": "Bloodwork",
                    "width": "col-span-12",
                    "height": "h-64",
                    "config": {},
                },
                {
                    "id": "nutrition-cal",
                    "type": "health_nutrition_calendar",
                    "title": "Nutrition Calendar",
                    "width": "col-span-8",
                    "height": "h-80",
                    "config": {},
                },
                {
                    "id": "nutrition-notes",
                    "type": "health_nutrition_notes",
                    "title": "Nutrition Notes",
                    "width": "col-span-4",
                    "height": "h-80",
                    "config": {},
                },
                {
                    "id": "nutrition-chart",
                    "type": "health_nutrition_chart",
                    "title": "Macro Trends",
                    "width": "col-span-12",
                    "height": "h-64",
                    "config": {},
                },
            ],
            "layout": [
                {"i": "1", "x": 0, "y": 0, "w": 8, "h": 14},
                {"i": "2", "x": 8, "y": 0, "w": 4, "h": 14},
                {"i": "3", "x": 0, "y": 14, "w": 4, "h": 8},
                {"i": "4", "x": 4, "y": 14, "w": 8, "h": 8},
                {"i": "5", "x": 0, "y": 22, "w": 12, "h": 10},
                {"i": "nutrition-cal", "x": 0, "y": 32, "w": 8, "h": 14},
                {"i": "nutrition-notes", "x": 8, "y": 32, "w": 4, "h": 14},
                {"i": "nutrition-chart", "x": 0, "y": 46, "w": 12, "h": 10},
            ],
        }
    ],
    "activeDashboardId": "health-overview",
}
