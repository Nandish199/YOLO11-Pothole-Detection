from collections import Counter
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.core.security import get_current_user
from app.models import Detection, Image, ProcessingJob, User

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _job_row(job: ProcessingJob, image: Image, detection: Detection | None) -> dict:
    return {
        "job_id": job.id,
        "image_id": image.id,
        "filename": image.filename,
        "created_at": job.created_at,
        "status": job.status,
        "error_message": job.error_message,
        "detection_id": detection.id if detection else None,
        "pothole_count": detection.pothole_count if detection else None,
    }


@router.get("/summary")
def dashboard_summary(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    visible_image = or_(Image.owner_id == current_user.id, Image.owner_id.is_(None))
    today = datetime.now(timezone.utc).date()
    image_count = db.scalar(select(func.count(Image.id)).where(visible_image)) or 0
    potholes = db.scalar(select(func.coalesce(func.sum(Detection.pothole_count), 0))
                         .join(Image, Image.id == Detection.image_id)
                         .where(Detection.status == "completed", visible_image)) or 0

    status_counts = dict(db.execute(select(ProcessingJob.status, func.count(ProcessingJob.id))
                                    .join(Image, Image.id == ProcessingJob.image_id)
                                    .where(visible_image).group_by(ProcessingJob.status)).all())
    status_counts = {key: int(status_counts.get(key, 0)) for key in ("queued", "processing", "completed", "failed")}

    detections = db.execute(select(Detection.created_at, Detection.pothole_count)
                            .join(Image, Image.id == Detection.image_id)
                            .where(Detection.status == "completed", visible_image)).all()
    daily_counts: Counter[date] = Counter()
    monthly_counts: Counter[str] = Counter()
    for created_at, count in detections:
        detection_date = _utc(created_at).date()
        daily_counts[detection_date] += int(count or 0)
        monthly_counts[detection_date.strftime("%Y-%m")] += int(count or 0)

    daily_activity = [
        {"date": (today - timedelta(days=offset)).isoformat(),
         "label": (today - timedelta(days=offset)).strftime("%d %b"),
         "count": daily_counts[today - timedelta(days=offset)]}
        for offset in reversed(range(30))
    ]
    month_keys = []
    cursor = today.replace(day=1)
    for _ in range(6):
        month_keys.append(cursor.strftime("%Y-%m"))
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    monthly_activity = [
        {"date": key, "label": datetime.strptime(key, "%Y-%m").strftime("%b"), "count": monthly_counts[key]}
        for key in reversed(month_keys)
    ]

    return {
        "total_images": image_count,
        "potholes_detected": int(potholes),
        "completed_jobs": status_counts["completed"],
        "active_jobs": status_counts["queued"] + status_counts["processing"],
        "failed_jobs": status_counts["failed"],
        "job_statuses": status_counts,
        "daily_activity": daily_activity,
        "monthly_activity": monthly_activity,
    }


@router.get("/recent")
def recent_jobs(limit: int = Query(default=20, ge=1, le=100),
                current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    visible_image = or_(Image.owner_id == current_user.id, Image.owner_id.is_(None))
    rows = db.execute(
        select(ProcessingJob, Image)
        .join(Image, Image.id == ProcessingJob.image_id)
        .where(visible_image)
        .order_by(ProcessingJob.created_at.desc(), ProcessingJob.id.desc())
        .limit(limit)
    ).all()
    result = []
    for job, image in rows:
        detection = db.scalar(select(Detection).where(Detection.image_id == image.id).order_by(Detection.id.desc()).limit(1))
        result.append(_job_row(job, image, detection))
    return result


@router.get("/images")
def recent_images(limit: int = Query(default=50, ge=1, le=200),
                  current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    visible_image = or_(Image.owner_id == current_user.id, Image.owner_id.is_(None))
    images = db.scalars(select(Image).where(visible_image)
                        .order_by(Image.created_at.desc(), Image.id.desc()).limit(limit)).all()
    return [{"id": image.id, "filename": image.filename, "content_type": image.content_type,
             "file_size": image.file_size, "source": image.source, "created_at": image.created_at,
             "can_delete": image.owner_id is None or image.owner_id == current_user.id}
            for image in images]
