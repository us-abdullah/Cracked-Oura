# Usman Biotracker — Phone companion (Vercel)

## Laptop closed (recommended)

1. Deploy **cloud API** — see [`../cloud/README.md`](../cloud/README.md) (Render/Railway).
2. On desktop: Settings → **Cloud** → paste URL + token → **Push to cloud now**.
3. Deploy this `companion-web` folder to Vercel (Root Directory = `companion-web`).
4. On phone: open the Vercel site → paste the **same cloud API URL** → Connect → Add to Home Screen.

No tunnel. No open laptop. Re-push from desktop whenever you sync new Oura/Hevy/Sheets data.

## Laptop open only (tunnel)

```bash
npx cloudflared tunnel --url http://127.0.0.1:8000
```

Paste the trycloudflare URL into the companion Connect screen (PC must stay awake).

## Local preview

```bash
cd companion-web
npm install
npm run dev
```
