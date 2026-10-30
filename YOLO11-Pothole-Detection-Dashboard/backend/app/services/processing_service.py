import logging
from datetime import datetime, timezone
from pathlib import Path

import cv2

from app.config import settings
from app.database import SessionLocal
from app.models import ApplicationSetting, Detection, DetectionItem, Image, ProcessingJob
from app.services.model_service import model_service

logger = logging.getLogger(__name__)


def process_job(job_id: int) -> None:
    db = SessionLocal()
    try:
        job = db.get(ProcessingJob, job_id)
        if job is None:
            return
        job.status = "processing"
        job.started_at = datetime.now(timezone.utc)
        db.commit()

        image = db.get(Image, job.image_id)
        if image is None:
            raise RuntimeError("Source image record no longer exists")
        confidence_setting = db.get(ApplicationSetting, "detection_confidence")
        confidence = float(confidence_setting.value) if confidence_setting else settings.detection_confidence
        boxes, annotated, inference_ms = model_service.predict(Path(image.storage_path), confidence)
        settings.results_dir.mkdir(parents=True, exist_ok=True)
        result_path = (settings.results_dir / f"detection-{job.id}.jpg").resolve()
        if not cv2.imwrite(str(result_path), annotated):
            raise RuntimeError("Could not save the annotated result image")

        detection = Detection(image_id=image.id, model_name="Ultralytics YOLO", model_version=None,
                              status="completed", pothole_count=len(boxes), inference_ms=inference_ms,
                              result_path=str(result_path), items=[DetectionItem(**box) for box in boxes])
        db.add(detection)
        job.status = "completed"
        job.completed_at = datetime.now(timezone.utc)
        db.commit()
        logger.info("Completed processing job %s with %s detections", job_id, len(boxes))
    except Exception as exc:
        db.rollback()
        job = db.get(ProcessingJob, job_id)
        if job is not None:
            job.status = "failed"
            job.error_message = str(exc)[:2000]
            job.completed_at = datetime.now(timezone.utc)
            db.commit()
        logger.warning("Processing job %s failed: %s", job_id, exc)
    finally:
        db.close()
