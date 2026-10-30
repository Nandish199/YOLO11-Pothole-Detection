import io
import logging
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from PIL import Image as PILImage, UnidentifiedImageError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.security import get_current_user
from app.database import get_db
from app.models import AuditLog, Detection, Image, Location, ProcessingJob, User
from app.schemas.jobs import DetectionItemResponse, DetectionResponse, JobStatus, JobSubmission
from app.services.processing_service import process_job

logger = logging.getLogger(__name__)
router = APIRouter(tags=["processing"])
ALLOWED_FORMATS = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}


def _safe_filename(filename: str | None) -> str:
    return Path(filename or "upload").name[:255]


def _require_image_access(image: Image | None, user: User) -> Image:
    if image is None or (image.owner_id is not None and image.owner_id != user.id):
        raise HTTPException(status_code=404, detail="Image not found")
    return image


def _safe_managed_path(value: str, managed_directory: Path) -> Path:
    path = Path(value).resolve()
    root = managed_directory.resolve()
    if path == root or not path.is_relative_to(root):
        raise HTTPException(status_code=500, detail="Stored file path is outside managed storage")
    return path


@router.post("/images/process", response_model=list[JobSubmission], status_code=status.HTTP_202_ACCEPTED)
async def submit_images(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    latitude: float | None = Form(default=None),
    longitude: float | None = Form(default=None),
    altitude_m: float | None = Form(default=None),
    accuracy_m: float | None = Form(default=None),
    captured_at: datetime | None = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not files:
        raise HTTPException(status_code=400, detail="At least one image is required")
    if len(files) > settings.max_upload_files:
        raise HTTPException(status_code=413, detail=f"A maximum of {settings.max_upload_files} images can be submitted at once")

    if (latitude is None) != (longitude is None):
        raise HTTPException(status_code=422, detail="Latitude and longitude must be supplied together")
    location = None
    if latitude is not None and longitude is not None:
        if not math.isfinite(latitude) or not -90 <= latitude <= 90:
            raise HTTPException(status_code=422, detail="Latitude must be between -90 and 90")
        if not math.isfinite(longitude) or not -180 <= longitude <= 180:
            raise HTTPException(status_code=422, detail="Longitude must be between -180 and 180")
        if altitude_m is not None and not math.isfinite(altitude_m):
            raise HTTPException(status_code=422, detail="Altitude must be a finite number")
        if accuracy_m is not None and (not math.isfinite(accuracy_m) or accuracy_m < 0):
            raise HTTPException(status_code=422, detail="Accuracy must be a non-negative finite number")
        captured_at = captured_at or datetime.now(timezone.utc)
        if captured_at.tzinfo is None:
            captured_at = captured_at.replace(tzinfo=timezone.utc)
        location = (latitude, longitude, altitude_m, accuracy_m, captured_at)
    elif altitude_m is not None or accuracy_m is not None or captured_at is not None:
        raise HTTPException(status_code=422, detail="Location metadata requires latitude and longitude")

    validated: list[tuple[UploadFile, bytes, str]] = []
    for upload in files:
        content = await upload.read(settings.max_upload_bytes + 1)
        if len(content) > settings.max_upload_bytes:
            raise HTTPException(status_code=413, detail=f"{_safe_filename(upload.filename)} exceeds the 10 MB limit")
        try:
            with PILImage.open(io.BytesIO(content)) as image:
                image.verify()
                image_format = image.format
        except (UnidentifiedImageError, OSError, PILImage.DecompressionBombError):
            raise HTTPException(status_code=415, detail=f"{_safe_filename(upload.filename)} is not a valid image")
        if image_format not in ALLOWED_FORMATS:
            raise HTTPException(status_code=415, detail="Only PNG, JPEG, and WEBP images are accepted")
        validated.append((upload, content, image_format))

    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    created: list[tuple[Image, ProcessingJob, str]] = []
    written_paths: list[Path] = []
    try:
        for upload, content, image_format in validated:
            filename = _safe_filename(upload.filename)
            stored_path = (settings.upload_dir / f"{uuid.uuid4().hex}{ALLOWED_FORMATS[image_format]}").resolve()
            stored_path.write_bytes(content)
            written_paths.append(stored_path)
            image = Image(owner_id=current_user.id, filename=filename, storage_path=str(stored_path), content_type=upload.content_type,
                          file_size=len(content), source="desktop")
            db.add(image)
            db.flush()
            if location is not None:
                lat, lon, altitude, accuracy, location_time = location
                db.add(Location(image_id=image.id, latitude=lat, longitude=lon, altitude_m=altitude,
                                accuracy_m=accuracy, source="browser_gps_at_upload", captured_at=location_time))
            job = ProcessingJob(image_id=image.id, submitted_by=current_user.id, status="queued", mode="server")
            db.add(job)
            db.flush()
            created.append((image, job, filename))
        db.commit()
    except Exception:
        db.rollback()
        for path in written_paths:
            path.unlink(missing_ok=True)
        logger.exception("Could not persist image submission")
        raise HTTPException(status_code=500, detail="Could not save submitted images")

    for _, job, _ in created:
        background_tasks.add_task(process_job, job.id)
    return [JobSubmission(job_id=job.id, image_id=image.id, filename=filename,
                          status="queued", status_url=f"/api/v1/jobs/{job.id}")
            for image, job, filename in created]


@router.get("/jobs/{job_id}", response_model=JobStatus)
def get_job(job_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(ProcessingJob, job_id)
    if job is None or (job.submitted_by is not None and job.submitted_by != current_user.id):
        raise HTTPException(status_code=404, detail="Processing job not found")
    _require_image_access(db.get(Image, job.image_id), current_user)
    detection = db.scalar(select(Detection).where(Detection.image_id == job.image_id).order_by(Detection.id.desc()))
    return JobStatus(id=job.id, image_id=job.image_id, status=job.status, mode=job.mode,
                     error_message=job.error_message, created_at=job.created_at, started_at=job.started_at,
                     completed_at=job.completed_at, detection_id=detection.id if detection else None)


@router.get("/detections/{detection_id}", response_model=DetectionResponse)
def get_detection(detection_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    detection = db.get(Detection, detection_id)
    if detection is None:
        raise HTTPException(status_code=404, detail="Detection not found")
    image = db.get(Image, detection.image_id)
    _require_image_access(image, current_user)
    return DetectionResponse(id=detection.id, image_id=detection.image_id, filename=image.filename if image else "",
                             source_image_url=f"/api/v1/images/{detection.image_id}/original",
                             model_name=detection.model_name,
                             model_version=detection.model_version, status=detection.status,
                             pothole_count=detection.pothole_count, severity=detection.severity,
                             inference_ms=detection.inference_ms,
                             annotated_image_url=f"/api/v1/detections/{detection.id}/annotated" if detection.result_path else None,
                             items=[DetectionItemResponse(id=item.id, class_id=item.class_id, class_name=item.class_name,
                                                          confidence=item.confidence, x_min=item.x_min, y_min=item.y_min,
                                                          x_max=item.x_max, y_max=item.y_max)
                                    for item in detection.items])


@router.get("/images/{image_id}/original")
def get_original_image(image_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    image = db.get(Image, image_id)
    if image is None or (image.owner_id is not None and image.owner_id != current_user.id) or not Path(image.storage_path).is_file():
        raise HTTPException(status_code=404, detail="Source image not found")
    return FileResponse(image.storage_path, media_type=image.content_type or "application/octet-stream")


@router.delete("/images/{image_id}")
def delete_image(image_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    image = db.get(Image, image_id)
    if image is None or (image.owner_id is not None and image.owner_id != current_user.id):
        raise HTTPException(status_code=404, detail="Image not found")

    active_job = db.scalar(select(ProcessingJob.id).where(
        ProcessingJob.image_id == image_id,
        ProcessingJob.status.in_(("queued", "processing")),
    ).limit(1))
    if active_job is not None:
        raise HTTPException(status_code=409, detail="Image cannot be deleted while processing is active")

    detections = db.scalars(select(Detection).where(Detection.image_id == image_id)).all()
    paths_to_remove = [_safe_managed_path(image.storage_path, settings.upload_dir)]
    paths_to_remove.extend(
        _safe_managed_path(detection.result_path, settings.results_dir)
        for detection in detections if detection.result_path
    )
    filename = image.filename

    try:
        for detection in detections:
            db.delete(detection)
        db.execute(delete(ProcessingJob).where(ProcessingJob.image_id == image_id))
        db.execute(delete(Location).where(Location.image_id == image_id))
        db.add(AuditLog(user_id=current_user.id, action="image.deleted", entity_type="image",
                        entity_id=str(image_id), details={"filename": filename}))
        db.delete(image)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Could not delete image %s", image_id)
        raise HTTPException(status_code=500, detail="Could not delete image")

    for path in paths_to_remove:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.exception("Could not remove managed file after deleting image %s", image_id)

    return {"deleted": True, "image_id": image_id, "filename": filename}


@router.get("/detections/{detection_id}/annotated")
def get_annotated_image(detection_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    detection = db.get(Detection, detection_id)
    if detection is None or not detection.result_path or not Path(detection.result_path).is_file():
        raise HTTPException(status_code=404, detail="Annotated image not found")
    image = db.get(Image, detection.image_id)
    if image is None or (image.owner_id is not None and image.owner_id != current_user.id):
        raise HTTPException(status_code=404, detail="Annotated image not found")
    return FileResponse(detection.result_path, media_type="image/jpeg", filename=f"detection-{detection_id}.jpg")
