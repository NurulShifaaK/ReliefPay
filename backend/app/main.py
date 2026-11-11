"""ReliefPay API entry point:  uvicorn app.main:app --reload"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from .config import settings
from .db import init_db
from .routers import public, staff
from .security import SecurityHeaders
from .seed import run_seed

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    run_seed()
    logging.getLogger("reliefpay").info("ReliefPay ready - AI mode: %s", settings.ai_mode)
    yield


app = FastAPI(
    title="ReliefPay API",
    version="1.0.0",
    lifespan=lifespan,
    # Hide interactive docs in production
    docs_url="/api/docs" if settings.ENV != "production" else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.ENV != "production" else None,
)
app.add_middleware(SecurityHeaders)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    """Turn Pydantic errors into one readable sentence for the UI."""
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "input"
    return JSONResponse(status_code=422, content={"detail": f"Invalid {field}: {first.get('msg', 'bad value')}"})


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    logging.getLogger("reliefpay").exception("Unhandled error")
    return JSONResponse(status_code=500, content={"detail": "Something went wrong. Please try again."})


@app.get("/api/health")
def health():
    return {"ok": True, "aiMode": settings.ai_mode}


app.include_router(public.router)
app.include_router(staff.router)


# ---------- optional: serve the built website from the same service ----------
_static = Path(settings.STATIC_DIR).resolve() if settings.STATIC_DIR else None
if _static and (_static / "index.html").is_file():
    if (_static / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=_static / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def website(path: str):
        if path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        f = (_static / path).resolve()
        if path and f.is_file() and _static in f.parents:  # real file (favicon etc.), no path traversal
            return FileResponse(f)
        return FileResponse(_static / "index.html", headers={"Cache-Control": "no-cache"})  # React Router
