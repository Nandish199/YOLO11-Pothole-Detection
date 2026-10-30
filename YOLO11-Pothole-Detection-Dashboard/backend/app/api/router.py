from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.health import router as health_router
from app.api.v1.processing import router as processing_router
from app.api.v1.dashboard import router as dashboard_router
from app.api.v1.locations import router as locations_router
from app.api.v1.settings import router as settings_router
from app.api.v1.administration import router as administration_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(health_router)
api_router.include_router(processing_router)
api_router.include_router(dashboard_router)
api_router.include_router(locations_router)
api_router.include_router(settings_router)
api_router.include_router(administration_router)
