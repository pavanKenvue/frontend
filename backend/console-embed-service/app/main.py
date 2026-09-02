from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .quicksight import get_console_embed_url, get_dashboard_embed_url

app = FastAPI(title="QuickSight Console Embed Service")

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.allowed_domains,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def dashboard_embed_url():
    """Reader-mode embed URL — same contract this app's frontend already
    expects (see src/api/filters.js's getEmbedUrl / DashboardEmbed.jsx)."""
    return {"embedUrl": get_dashboard_embed_url(get_settings())}


@app.get("/console-embed-url")
def console_embed_url():
    """Author-mode embed URL for the full QuickSight console (Undo/Redo,
    Save as, Create, ...). Only useful if QUICKSIGHT_USER_ARN's QuickSight
    role is Author or Admin — see docs/quicksight-console-embedding/README.md.
    A Reader-role user will get back a URL that QuickSight itself restricts,
    not full authoring access, regardless of what this endpoint returns."""
    return {"embedUrl": get_console_embed_url(get_settings())}
