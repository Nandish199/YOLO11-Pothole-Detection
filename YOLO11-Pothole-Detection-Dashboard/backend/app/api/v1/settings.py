from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import settings as app_settings
from app.core.security import get_current_user
from app.database import get_db
from app.models import ApplicationSetting, AuditLog, User
from app.schemas.settings import DetectionConfidenceResponse, DetectionConfidenceUpdate

router = APIRouter(prefix="/settings", tags=["settings"])
DETECTION_CONFIDENCE_KEY = "detection_confidence"


def _current_confidence(db: Session) -> float:
    saved = db.get(ApplicationSetting, DETECTION_CONFIDENCE_KEY)
    return float(saved.value) if saved is not None else app_settings.detection_confidence


@router.get("/detection-confidence", response_model=DetectionConfidenceResponse)
def get_detection_confidence(
    _: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return DetectionConfidenceResponse(confidence=_current_confidence(db))


@router.put("/detection-confidence", response_model=DetectionConfidenceResponse)
def update_detection_confidence(
    payload: DetectionConfidenceUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    setting = db.get(ApplicationSetting, DETECTION_CONFIDENCE_KEY)
    old_value = _current_confidence(db)
    value = f"{payload.confidence:.2f}"
    if setting is None:
        setting = ApplicationSetting(
            key=DETECTION_CONFIDENCE_KEY,
            value=value,
            description="Minimum YOLO pothole confidence used for new processing jobs.",
        )
        db.add(setting)
    else:
        setting.value = value
        setting.updated_at = datetime.now(timezone.utc)
    db.add(AuditLog(
        user_id=current_user.id,
        action="settings.detection_confidence.updated",
        entity_type="application_setting",
        entity_id=DETECTION_CONFIDENCE_KEY,
        details={"old_value": old_value, "new_value": float(value)},
    ))
    db.commit()
    return DetectionConfidenceResponse(confidence=float(value))
