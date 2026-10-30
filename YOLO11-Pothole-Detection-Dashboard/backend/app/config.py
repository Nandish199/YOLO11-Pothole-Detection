from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "YOLO11 Pothole Detection API"
    environment: str = "development"
    api_v1_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./storage/pothole_detection.db"
    cors_origins: str = "http://localhost:4173,http://127.0.0.1:4173,http://terminal.local:4173,http://localhost:4176,http://127.0.0.1:4176,http://terminal.local:4176"
    secret_key: str = "development-only-change-me"
    access_token_expire_minutes: int = 60
    allow_self_registration: bool | None = None
    model_path: str | None = None
    upload_dir: Path = Path("./storage/uploads")
    results_dir: Path = Path("./storage/results")
    log_level: str = "INFO"
    max_upload_bytes: int = 10 * 1024 * 1024
    max_upload_files: int = 8
    # Raised from 0.50 after a balanced 800-image project-data evaluation.
    # Tune for the deployment's precision/recall needs via DETECTION_CONFIDENCE.
    detection_confidence: float = 0.8
    pothole_class_id: int = 0

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @model_validator(mode="after")
    def validate_auth_settings(self):
        if self.access_token_expire_minutes < 1:
            raise ValueError("ACCESS_TOKEN_EXPIRE_MINUTES must be positive")
        if self.environment.lower() in {"production", "prod"} and (
            self.secret_key in {"development-only-change-me", "replace-this-with-a-long-random-secret"}
            or len(self.secret_key) < 32
        ):
            raise ValueError("Production requires a SECRET_KEY of at least 32 characters")
        return self

    @property
    def self_registration_enabled(self) -> bool:
        if self.allow_self_registration is not None:
            return self.allow_self_registration
        return self.environment.lower() in {"development", "dev", "local"}

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
