import os
import subprocess
import sys
import io

from sqlalchemy import inspect, text
from PIL import Image as PILImage

from app.database import engine
from app.config import settings
from app.core.security import create_access_token, decode_access_token, hash_password, verify_password


def test_startup_and_health(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_database_health_and_tables(client):
    assert client.get("/api/v1/health/database").json()["database"] == "connected"
    expected = {"users", "images", "detections", "detection_items", "locations", "processing_jobs",
                "notifications", "audit_logs", "application_settings"}
    assert expected.issubset(set(inspect(engine).get_table_names()))
    with engine.connect() as connection:
        assert connection.execute(text("SELECT 1")).scalar_one() == 1


def test_model_reports_unconfigured(client):
    response = client.get("/api/v1/health/model")
    assert response.status_code == 200
    assert response.json()["status"] == "not_configured"
    assert response.json()["loaded"] is False


def test_storage_directories(client):
    response = client.get("/api/v1/health/storage")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert settings.upload_dir.is_dir()
    assert settings.results_dir.is_dir()


def test_swagger_and_openapi(client):
    assert client.get("/docs").status_code == 200
    schema = client.get("/api/v1/openapi.json")
    assert schema.status_code == 200
    assert "/api/v1/health" in schema.json()["paths"]


def test_alembic_migration(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'migration.db'}"
    env = {**os.environ, "DATABASE_URL": database_url}
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True, env=env,
                   capture_output=True, text=True)
    from sqlalchemy import create_engine
    migrated_engine = create_engine(database_url)
    try:
        tables = set(inspect(migrated_engine).get_table_names())
        assert "alembic_version" in tables
        assert {"users", "images", "detections", "processing_jobs"}.issubset(tables)
    finally:
        migrated_engine.dispose()


def test_jwt_and_password_helpers():
    password_hash = hash_password("safe-test-password")
    assert verify_password("safe-test-password", password_hash)
    assert not verify_password("incorrect-password", password_hash)
    assert decode_access_token(create_access_token("user-1"))["sub"] == "user-1"


def test_image_upload_creates_job_and_reports_missing_model(client):
    image_buffer = io.BytesIO()
    PILImage.new("RGB", (32, 32), color="gray").save(image_buffer, format="PNG")
    response = client.post("/api/v1/images/process", files={"files": ("road.png", image_buffer.getvalue(), "image/png")})
    assert response.status_code == 202
    submission = response.json()[0]
    assert submission["filename"] == "road.png"

    job_response = client.get(submission["status_url"])
    assert job_response.status_code == 200
    job = job_response.json()
    assert job["status"] == "failed"
    assert "not configured" in job["error_message"]


def test_image_upload_rejects_non_image(client):
    response = client.post("/api/v1/images/process", files={"files": ("not-image.png", b"plain text", "image/png")})
    assert response.status_code == 415


def test_multi_image_upload_creates_independent_jobs(client):
    uploads = []
    for index in range(3):
        image_buffer = io.BytesIO()
        PILImage.new("RGB", (24 + index, 24), color=(index * 40, 80, 120)).save(image_buffer, format="JPEG")
        uploads.append(("files", (f"road-{index}.jpg", image_buffer.getvalue(), "image/jpeg")))

    response = client.post("/api/v1/images/process", files=uploads)
    assert response.status_code == 202
    submissions = response.json()
    assert len(submissions) == 3
    assert len({submission["job_id"] for submission in submissions}) == 3
    assert len({submission["image_id"] for submission in submissions}) == 3

    job_states = [client.get(submission["status_url"]).json() for submission in submissions]
    assert all(job["status"] == "failed" for job in job_states)
    assert all("not configured" in job["error_message"] for job in job_states)
