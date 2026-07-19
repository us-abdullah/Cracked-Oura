# Usman Biotracker — Web mirror

Same UI as the desktop app (`frontend/src` is shared — edits auto-appear here).

## Live mode (default) — matches your desktop

Needs the **desktop backend** on port 8000 (start **Usman Biotracker** first, or leave it running).

```bash
cd web
npm install
npm run dev
```

Open **http://localhost:5174/**

- Recovery / Health → your real SQLite data + dashboards  
- Training → real Hevy Insights iframe (same as desktop)  
- Settings scrape buttons still hit the real API when the backend is up  

## Demo / offline mode (no backend)

```bash
# PowerShell
$env:VITE_WEB_MOCK="1"; npm run dev
```

Uses fixtures + a Training placeholder. For Vercel without a cloud API, set `VITE_WEB_MOCK=1` in project env.

## Vercel

1. Root Directory: `web`
2. Build: `npm run build` · Output: `dist`
3. For live phone data later, point `VITE_API_BASE` at a hosted API; until then use mock or keep viewing on LAN via the desktop backend.
