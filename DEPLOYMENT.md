# Deployment Guide

## Web on GitHub Pages

1. Open repository settings on GitHub.
2. Go to **Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` branch.
4. Wait for workflow **Deploy Web to GitHub Pages** to finish.
5. Open `https://thanthtetmyet.github.io/pyaw-pyaw`.

## API on Render

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

## Frontend API Integration

Set your web app API base URL to your Render URL so room search and joins use the global backend.
