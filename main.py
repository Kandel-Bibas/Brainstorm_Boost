from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from config import EXPORTS_DIR
from database import init_db
from routes import upload, analyze, meetings, query

app = FastAPI(title="Brainstorm Boost", version="0.2.0")

app.mount("/exports", StaticFiles(directory=str(EXPORTS_DIR)), name="exports")

# Register routers
app.include_router(upload.router)
app.include_router(analyze.router)
app.include_router(meetings.router)
app.include_router(query.router)


@app.on_event("startup")
def startup():
    init_db()


# Serve React frontend build
react_dist = Path(__file__).parent / "frontend" / "dist"
if react_dist.exists():
    app.mount("/assets", StaticFiles(directory=str(react_dist / "assets")), name="react-assets")


@app.get("/", response_class=HTMLResponse)
def serve_index():
    react_index = Path(__file__).parent / "frontend" / "dist" / "index.html"
    if react_index.exists():
        return HTMLResponse(content=react_index.read_text())
    legacy_index = Path(__file__).parent / "static" / "index.html"
    return HTMLResponse(content=legacy_index.read_text())


# SPA catch-all: serve index.html for any non-API path
@app.get("/{path:path}")
def serve_spa(path: str):
    react_index = Path(__file__).parent / "frontend" / "dist" / "index.html"
    if react_index.exists():
        return HTMLResponse(content=react_index.read_text())
    return HTMLResponse(content="<h1>Not Found</h1>", status_code=404)
