"""Application settings, loaded from environment variables (and a local .env file)."""

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Dev-only fallback so `uvicorn app.main:app` works out of the box. Refused when ENV=production.
DEV_JWT_SECRET = "dev-only-insecure-secret-change-me"  # noqa: S105
MIN_PRODUCTION_SECRET_LENGTH = 32


class Settings(BaseSettings):
    """All configuration comes from environment variables. See .env.example for the full list."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Hostel Food Rating API"
    env: Literal["development", "test", "staging", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    docs_enabled: bool = True
    cors_origins: Annotated[list[str], NoDecode] = []
    max_request_body_bytes: int = Field(default=64 * 1024, ge=1024)

    database_url: str = "sqlite:///./hostel_food.db"
    db_pool_size: int = Field(default=5, ge=1)
    db_max_overflow: int = Field(default=10, ge=0)
    db_pool_timeout: int = Field(default=30, ge=1)
    db_pool_recycle: int = Field(default=1800, ge=-1)

    jwt_secret: str = DEV_JWT_SECRET
    jwt_algorithm: Literal["HS256", "HS384", "HS512"] = "HS256"
    access_token_expire_minutes: int = Field(default=60, ge=1, le=24 * 60)

    rate_limit_enabled: bool = True
    rate_limit_auth: str = "10/minute"
    rate_limit_ratings: str = "30/minute"
    rate_limit_storage_uri: str = "memory://"

    # A meal is flagged once it has at least `flag_min_ratings` ratings averaging below this.
    flag_threshold: float = Field(default=2.0, gt=1, le=5)
    flag_min_ratings: int = Field(default=3, ge=1)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("database_url")
    @classmethod
    def _use_psycopg3(cls, value: str) -> str:
        # Accept the bare postgres:// URLs most hosting providers hand out.
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value.removeprefix(prefix)
        return value

    @model_validator(mode="after")
    def _require_strong_secret_in_production(self) -> "Settings":
        if self.env == "production" and (
            self.jwt_secret == DEV_JWT_SECRET or len(self.jwt_secret) < MIN_PRODUCTION_SECRET_LENGTH
        ):
            raise ValueError(
                "JWT_SECRET must be set to a random string of at least "
                f"{MIN_PRODUCTION_SECRET_LENGTH} characters when ENV=production"
            )
        return self

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def docs_available(self) -> bool:
        """Docs stay on for demos; they are only hidden when production explicitly opts out."""
        return not (self.is_production and not self.docs_enabled)


@lru_cache
def get_settings() -> Settings:
    return Settings()
