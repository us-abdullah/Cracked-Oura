# Usman Biotracker — Cloud API (laptop can be closed)

Hosts your SQLite + dashboards so the **phone companion** (Vercel) works without your PC.

## What this is

```
Desktop app ──Push to cloud──► Cloud API (Railway/Render) ──► Phone (Vercel PWA)
     ▲                              ▲
  sync Oura/Hevy/Sheets          always on
  when laptop is open
```

Cloud does **not** replace desktop sync. You still sync on the PC, then **Push to cloud** (Settings → Cloud).

## 1. Deploy API

### Option A — Render (easy disk)

1. Push this repo to GitHub.
2. [Render](https://render.com) → New → Blueprint → select repo → `cloud/render.yaml`.
3. Copy the service URL, e.g. `https://usman-biotracker-cloud.onrender.com`.
4. In env vars, copy `BIOTRACKER_CLOUD_TOKEN` (or set your own long secret).

### Option B — Railway

1. New project → deploy from GitHub.
2. Use Dockerfile at `cloud/Dockerfile`.
3. Add volume at `/data`.
4. Set env:
   - `BIOTRACKER_CLOUD=1`
   - `BIOTRACKER_DATA_DIR=/data`
   - `BIOTRACKER_CLOUD_TOKEN=<long-secret>`

### Option C — local Docker smoke test

```bash
docker build -f cloud/Dockerfile -t biotracker-cloud .
docker run --rm -p 8000:8000 -e BIOTRACKER_CLOUD_TOKEN=devsecret -v biotracker_data:/data biotracker-cloud
```

## 2. Desktop: push your data

1. Open Usman Biotracker → Settings (any compartment) → **Cloud**.
2. Paste cloud URL + token → **Save** → **Push to cloud now**.
3. Do this after Oura / Hevy / Sheets syncs (or whenever you want the phone updated).

## 3. Phone companion

1. Deploy `companion-web` to Vercel (root directory `companion-web`).
2. Optional build env: `VITE_API_BASE_URL=https://your-cloud-api.example.com`
3. Or paste the cloud URL on the Connect screen (no tunnel needed).
4. Add to Home Screen.

## Security

- Anyone with the URL + token can overwrite your cloud DB — use a long random token.
- Prefer HTTPS only (Railway/Render give this).
- Don’t commit tokens to git.
