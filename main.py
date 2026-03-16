from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from config import EXPORTS_DIR
from database import init_db
from routes import upload, analyze, meetings, query, prep, live, chat, graph


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Brainstorm Boost", version="0.2.0", lifespan=lifespan)

app.mount("/exports", StaticFiles(directory=str(EXPORTS_DIR)), name="exports")

# Register routers
app.include_router(upload.router)
app.include_router(analyze.router)
app.include_router(meetings.router)
app.include_router(query.router)
app.include_router(prep.router)
app.include_router(live.router)
app.include_router(chat.router)
app.include_router(graph.router)


# Serve React frontend build — read once at import time
react_dist = Path(__file__).parent / "frontend" / "dist"
_react_index_html = None
if react_dist.exists():
    react_index = react_dist / "index.html"
    if react_index.exists():
        _react_index_html = react_index.read_text()
    app.mount("/assets", StaticFiles(directory=str(react_dist / "assets")), name="react-assets")


@app.get("/", response_class=HTMLResponse)
def serve_index():
    if _react_index_html:
        return HTMLResponse(content=_react_index_html)
    legacy_index = Path(__file__).parent / "static" / "index.html"
    return HTMLResponse(content=legacy_index.read_text())


# SPA catch-all: serve index.html for any non-API path
@app.get("/{path:path}")
def serve_spa(path: str):
    if _react_index_html:
        return HTMLResponse(content=_react_index_html)
    return HTMLResponse(content="<h1>Not Found</h1>", status_code=404)
