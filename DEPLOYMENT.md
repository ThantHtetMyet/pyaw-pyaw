# Deployment Guide

## Web on GitHub Pages

1. Open repository settings on GitHub.
2. Go to **Pages** and set **Source** to **Deploy from a branch**.
3. Select branch **gh-pages** and folder **/(root)**, then save.
4. In local project run:
   - `cd pyaw-pyaw-web`
   - `npm run build`
   - `npm run deploy`
5. Open `https://thanthtetmyet.github.io/pyaw-pyaw`.

## API Hosting Options

This API can run on any Node.js host that supports WebSocket upgrades.

### Option A: Render

1. Create a new **Web Service** on Render from this repository.
2. Render will detect `render.yaml` from repository root.
3. Confirm service uses:
   - Root directory: `pyaw-pyaw-api`
   - Build command: `npm install`
   - Start command: `npm start`
4. Add environment variables in Render dashboard:
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
   - `ROOM_TTL_SECONDS` (optional, default 300)
5. Deploy and verify:
   - `https://<your-render-service>.onrender.com/health`
   - `https://<your-render-service>.onrender.com/api/rooms/active`
   - `https://<your-render-service>.onrender.com/api/mqtt/config`

### Option B: Railway

1. Create a new project from GitHub repo.
2. Set root directory to `pyaw-pyaw-api`.
3. Set start command to `npm start`.
4. Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
   - `ROOM_TTL_SECONDS` (optional)
5. Deploy and test `/health`.

### Option C: Fly.io or VPS

1. Build and run the `pyaw-pyaw-api` service with Node 20+.
2. Expose one HTTP port from `PORT` env.
3. Keep WebSocket path `/mqtt` enabled.
4. Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
   - `ROOM_TTL_SECONDS` (optional)
5. Test `/health` and `/api/mqtt/config`.

## Frontend API Integration

Set your web app API base URL to the deployed API URL so room search and joins use the global backend.
