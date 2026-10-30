from fastapi import APIRouter
from sqlalchemy import text

from app.config import settings
from app.database import engine
from app.services.model_service import model_service

router = APIRouter()


@router.get("/health", tags=["health"])
def health():
    return {"status": "ok", "service": settings.app_name, "version": "1.0.0"}


@router.get("/health/database", tags=["health"])
def database_health():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected"}
    except Exception as exc:
        return {"status": "error", "database": "disconnected", "detail": str(exc)}


@router.get("/health/model", tags=["health"])
def model_health():
    current = model_service.status()
    if current["status"] in {"available", "load_error"} and current.get("status") != "load_error":
        try:
            model_service.load()
        except RuntimeError:
            pass
    return model_service.status()


@router.get("/health/storage", tags=["health"])
def storage_health():
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    settings.results_dir.mkdir(parents=True, exist_ok=True)
    return {"status": "ok", "uploads": str(settings.upload_dir), "results": str(settings.results_dir)}
