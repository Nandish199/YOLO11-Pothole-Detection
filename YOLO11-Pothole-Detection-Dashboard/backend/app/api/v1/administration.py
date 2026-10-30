from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.security import require_admin
from app.database import get_db
from app.models import AuditLog, Image, Notification, ProcessingJob, User
from app.schemas.administration import RoleUpdate, StatusUpdate

router = APIRouter(prefix="/administration", tags=["administration"])


@router.get("/users")
def users(
    limit: int = Query(default=100, ge=1, le=200),
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    records = db.scalars(select(User).order_by(User.created_at.desc(), User.id.desc()).limit(limit)).all()
    return [{"id": user.id, "email": user.email, "display_name": user.display_name,
             "role": user.role, "is_active": user.is_active, "created_at": user.created_at}
            for user in records]


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_user(
    user_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot remove your own account")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "admin" and (db.scalar(select(func.count(User.id)).where(User.role == "admin")) or 0) <= 1:
        raise HTTPException(status_code=400, detail="At least one administrator account must remain")

    # Keep jobs, images, notifications, and audit history while removing the account owner.
    db.execute(update(Image).where(Image.owner_id == user_id).values(owner_id=None))
    db.execute(update(ProcessingJob).where(ProcessingJob.submitted_by == user_id).values(submitted_by=None))
    db.execute(update(Notification).where(Notification.user_id == user_id).values(user_id=None))
    db.execute(update(AuditLog).where(AuditLog.user_id == user_id).values(user_id=None))
    db.delete(user)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/users/{user_id}/role")
def update_user_role(
    user_id: int,
    payload: RoleUpdate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot change your own role")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    old_role = user.role
    if old_role == "admin" and payload.role == "client" and (db.scalar(select(func.count(User.id)).where(User.role == "admin")) or 0) <= 1:
        raise HTTPException(status_code=400, detail="At least one administrator account must remain")
    user.role = payload.role
    db.add(AuditLog(user_id=current_user.id, action="user.role.updated", entity_type="user",
                    entity_id=str(user.id), details={"old_role": old_role, "new_role": payload.role}))
    db.commit()
    return {"id": user.id, "email": user.email, "display_name": user.display_name,
            "role": user.role, "is_active": user.is_active, "created_at": user.created_at}


@router.put("/users/{user_id}/status")
def update_user_status(
    user_id: int,
    payload: StatusUpdate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if user_id == current_user.id and not payload.is_active:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    old_status = user.is_active
    user.is_active = payload.is_active
    db.add(AuditLog(user_id=current_user.id, action="user.status.updated", entity_type="user",
                    entity_id=str(user.id), details={"old_is_active": old_status, "new_is_active": payload.is_active}))
    db.commit()
    return {"id": user.id, "email": user.email, "display_name": user.display_name,
            "role": user.role, "is_active": user.is_active, "created_at": user.created_at}


@router.get("/notifications")
def notifications(
    limit: int = Query(default=100, ge=1, le=200),
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    visible = (Notification.user_id == current_user.id) | Notification.user_id.is_(None)
    records = db.scalars(select(Notification).where(visible)
                         .order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit)).all()
    return [{"id": item.id, "kind": item.kind, "title": item.title, "message": item.message,
             "is_read": item.is_read, "created_at": item.created_at}
            for item in records]


@router.get("/audit-logs")
def audit_logs(
    limit: int = Query(default=100, ge=1, le=200),
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    records = db.scalars(select(AuditLog).where(AuditLog.user_id == current_user.id)
                         .order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit)).all()
    return [{"id": item.id, "action": item.action, "entity_type": item.entity_type,
             "entity_id": item.entity_id, "details": item.details, "created_at": item.created_at}
            for item in records]
