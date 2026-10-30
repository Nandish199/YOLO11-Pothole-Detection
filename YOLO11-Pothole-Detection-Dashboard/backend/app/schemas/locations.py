from datetime import datetime

from pydantic import BaseModel


class LocationResponse(BaseModel):
    id: int
    image_id: int
    image_filename: str
    latitude: float
    longitude: float
    altitude_m: float | None
    accuracy_m: float | None
    source: str
    captured_at: datetime | None
