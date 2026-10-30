from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database import get_db
from app.models import Image, Location, User
from app.schemas.locations import LocationResponse

router = APIRouter(prefix="/locations", tags=["locations"])


@router.get("", response_model=list[LocationResponse])
def list_locations(limit: int = Query(default=100, ge=1, le=500),
                   current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(Location, Image)
        .join(Image, Image.id == Location.image_id)
        .where(or_(Image.owner_id == current_user.id, Image.owner_id.is_(None)))
        .order_by(Location.captured_at.desc().nullslast(), Location.id.desc())
        .limit(limit)
    ).all()
    return [
        LocationResponse(
            id=location.id,
            image_id=image.id,
            image_filename=image.filename,
            latitude=location.latitude,
            longitude=location.longitude,
            altitude_m=location.altitude_m,
            accuracy_m=location.accuracy_m,
            source=location.source,
            captured_at=location.captured_at,
        )
        for location, image in rows
    ]
