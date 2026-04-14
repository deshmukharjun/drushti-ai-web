# DrushtiAI — Web (Anti-Cheat Vision)

Real-time cheating detection for exam surveillance, aligned with the **DrushtiAI Android app** ([FYP App](../FYP%20App)). Both clients share one **Supabase** project: `profiles`, `exams`, and `cheating_snapshots` (see [supabase/schema.sql](supabase/schema.sql)). The Python backend runs CV/ML, stores a local incident mirror, and optionally **uploads snapshots + inserts rows** into `cheating_snapshots` using the **service role** key.

## Features

- **Exams & QR pairing** — Create exams on the web; show a QR code encoding the same JSON contract as [QrLinkContract.kt](../FYP%20App/app/src/main/java/com/example/drushtiai/QrLinkContract.kt) (`v`, `exam_id`, optional `ws_url`, `ingest_url`).
- **Multi-camera support** — Webcam, RTSP, MJPEG streams via FastAPI
- **Real-time detection** — Head pose, gaze, talking, proximity, face absence
- **Live dashboard** — WebSocket camera grid and alerts
- **Incident logging** — In-memory API log + CSV export; **Supabase** is the source of truth for the Android app when sync is enabled
- **Configurable thresholds** — Settings page

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, Tailwind CSS, TypeScript |
| Backend | FastAPI, Python |
| ML/CV | YOLOv11, MediaPipe, OpenCV, DeepSort |
| Database | Supabase (PostgreSQL + Storage) |
| Auth | Supabase Auth (email/password; sign-up sends `user_metadata.full_name` for `profiles`) |

## Project structure

```
├── backend/
│   ├── main.py              # FastAPI, camera/exam_id binding, Supabase sync on detection
│   ├── supabase_sync.py     # Service-role upload + cheating_snapshots insert
│   ├── detector.py
│   ├── camera_manager.py
│   ├── config.py
│   └── requirements.txt
├── frontend/
│   ├── app/                 # Login, dashboard, exams, cameras, incidents, settings
│   ├── components/
│   └── lib/
└── supabase/
    └── schema.sql           # DrushtiAI canonical schema + public cheating-snapshots bucket
```

## Environment variables

### Backend (`backend/.env` from `.env.example`)

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_KEY` | **Server only** — uploads to Storage and inserts `cheating_snapshots` (bypasses RLS) |
| `SUPABASE_BUCKET` | Default `cheating-snapshots` (must match SQL + public bucket for Glide on Android) |

### Frontend (`frontend/.env`)

Copy the template: `cd frontend && cp .env.example .env` (PowerShell: `Copy-Item .env.example .env`). Next.js loads `.env` from the `frontend/` folder.

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Same project as the Android app |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Publishable key (matches Supabase dashboard; legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` still works) |
| `NEXT_PUBLIC_BACKEND_URL` | FastAPI origin for browser (e.g. `http://localhost:8000`) |
| `NEXT_PUBLIC_BACKEND_PUBLIC_URL` | **URL the invigilator phone can reach** (LAN IP, ngrok, etc.) — used inside QR JSON for `ws_url` / `ingest_url` hints |
| `NEXT_PUBLIC_ENABLE_DEV_AUTH_BYPASS` | Set to `true` only in local dev to show **Continue without auth** and skip middleware session checks |

If `NEXT_PUBLIC_SUPABASE_URL` is unset, the app runs in local dev mode (no auth required).

### Sign up returns 500

If `POST .../auth/v1/signup` is **500**, the `on_auth_user_created` trigger on `auth.users` is usually failing (often **RLS** blocking the insert into `public.profiles`). Re-run the `handle_new_user` definition from [supabase/schema.sql](supabase/schema.sql), or run [supabase/fix_signup_500_trigger.sql](supabase/fix_signup_500_trigger.sql) once. Check **Logs → Postgres** in the dashboard for the exact error.

## Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- Supabase project (recommended for full Android parity)

### Database

1. In Supabase → **SQL**, run [supabase/schema.sql](supabase/schema.sql) once.
2. Ensure the **`cheating-snapshots`** bucket exists and is **public** (script configures this).
3. Use the **same** Supabase project in the Android app (`local.properties`) and in the web `frontend/.env`.

### Backend

```bash
cd backend
pip install -r requirements.txt
```

`cd backend && cp .env.example .env` — set at least `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` if you want snapshots on the phone.

From **repository root** (folder that contains `backend/`):

```bash
py -3 -m uvicorn backend.main:app --reload
```

API: `http://localhost:8000`.

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`. Sign in with Supabase, or use dev bypass if enabled (see above).

### Syncing detections to the Android app

1. Create an **exam** under **Exams** (or on the phone — same table).
2. On **Cameras**, choose **Sync detections to exam** and select that exam.
3. **Start** the camera stream. On each saved frame, the backend uploads a JPEG to Storage and inserts **`cheating_snapshots`** with a public **`image_url`**.
4. On the phone, open the exam → **Link camera** → scan the **QR** from **Exams → (exam) → Link camera (QR)**.

For QR payloads to be useful on-device, set **`NEXT_PUBLIC_BACKEND_PUBLIC_URL`** to something reachable from the phone (not `localhost`).

## API reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cameras` | List cameras |
| POST | `/api/cameras` | Register a camera |
| POST | `/api/cameras/{id}/start?exam_id=<uuid>` | Start stream; optional `exam_id` enables Supabase snapshot sync |
| POST | `/api/cameras/{id}/stop` | Stop stream |
| GET | `/api/incidents` | List in-memory incidents (dashboard) |
| GET | `/api/incidents/export/csv` | Export CSV |
| GET/POST | `/api/settings` | Detection thresholds |
| WS | `/ws/feed/{camera_id}` | Live detections |
| WS | `/ws/status` | Status |

## Detection behaviors

| Behavior | Method | Default threshold |
|----------|--------|-------------------|
| Looking sideways | Head yaw (solvePnP) | 15° for 0.5s |
| Gaze deviation | Iris position | 0.3 normalized |
| Talking | Lip distance | 0.02 for 1.5s |
| Proximity | Centroid distance | 150px for 2s |
| Left seat | Face absence | 3s |

## UI alignment

Dashboard styling follows **DrushtiAI** tokens from [FYP App DESIGN.md](../FYP%20App/DESIGN.md) (navy `#000F2E`, light surfaces, 12px/16px radii).

## License

Final year academic submission.
