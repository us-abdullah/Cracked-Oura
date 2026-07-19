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

**Do not** set Root Directory to `frontend` — that builds the Electron desktop app and will fail.

### Option A (recommended): Root Directory = `web`

| Setting | Value |
|--------|--------|
| Root Directory | `web` |
| Framework | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

### Option B: Root Directory = repo root (`.`)

Uses the root `vercel.json` which builds `web/` automatically.

Until you have a hosted API, add env var **`VITE_WEB_MOCK=1`** so the phone UI loads with demo data. For live data matching desktop, you’ll need a cloud backend later (or open the LAN URL while the desktop app is running).
