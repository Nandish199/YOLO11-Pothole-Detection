from datetime import datetime

from pydantic import BaseModel


class JobSubmission(BaseModel):
    job_id: int
    image_id: int
    filename: str
    status: str
    status_url: str


class JobStatus(BaseModel):
    id: int
    image_id: int
    status: str
    mode: str
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    detection_id: int | None = None


class DetectionItemResponse(BaseModel):
    id: int
    class_id: int
    class_name: str
    confidence: float
    x_min: float
    y_min: float
    x_max: float
    y_max: float


class DetectionResponse(BaseModel):
    id: int
    image_id: int
    filename: str
    source_image_url: str
    model_name: str | None
    model_version: str | None
    status: str
    pothole_count: int
    severity: str | None
    inference_ms: float | None
    annotated_image_url: str | None
    items: list[DetectionItemResponse]
