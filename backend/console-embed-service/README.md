# console-embed-service

A small, standalone FastAPI service with one job: generate QuickSight embed
URLs via `GenerateEmbedUrlForRegisteredUser` — both the existing read-only
Dashboard experience this app already uses, and a new Console (author-mode)
experience for the "Save as" / editing toolbar requested separately.

This does **not** replace this app's real backend (columns, cascading
filter values, smart search, bookmarks — none of that lives here). It's
additive: point the frontend at whichever of these two embed-url endpoints
fits the page it's on, keep everything else on the existing backend.

Read [`docs/quicksight-console-embedding`](../../docs/quicksight-console-embedding)
first — the AWS/QuickSight-side permission changes there are what actually
make `/console-embed-url` do anything useful; this service alone can't grant
authoring access.

## Endpoints

| Route | Returns | Requires |
|---|---|---|
| `GET /health` | `{"status": "ok"}` | — |
| `GET /` | `{"embedUrl": "..."}` for the read-only Dashboard experience | `QUICKSIGHT_USER_ARN` can be a Reader |
| `GET /console-embed-url` | `{"embedUrl": "..."}` for the full authoring Console | `QUICKSIGHT_USER_ARN` must be an Author or Admin |

## Setup

```bash
cd backend/console-embed-service
python -m venv .venv
source .venv/bin/activate   # .venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env        # then fill in the real values
```

AWS credentials are picked up the normal boto3 way (env vars, `~/.aws/credentials`,
an instance/task role, etc.) — nothing AWS-credential-specific is in `.env`;
that file only holds QuickSight/app config (see `.env.example` for what each
value means).

## Run

```bash
uvicorn app.main:app --reload --port 8001
```

## Frontend wiring (not done yet)

This app's [`DashboardEmbed.jsx`](../../src/components/DashboardEmbed.jsx)
calls `embedDashboard()` against the existing backend's `/` endpoint —
that's unchanged. Pointing part of the UI at the Console experience instead
means:

1. Fetching `{ embedUrl }` from this service's `/console-embed-url`.
2. Calling the Embedding SDK's `embeddingContext.embedConsole(frameOptions, contentOptions)`
   (a different method from `embedDashboard`) with that URL, likely in its
   own container/route rather than swapping it into the existing dashboard
   view.

Left out for now since who should even see an "open the editor" entry
point is a product decision, not just a wiring one — happy to build it once
that's settled.
