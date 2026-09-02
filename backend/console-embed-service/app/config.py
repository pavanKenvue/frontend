from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Env-driven config — see .env.example for what each of these does."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    aws_account_id: str
    aws_region: str = "us-east-1"
    quicksight_user_arn: str
    dashboard_id: str
    allowed_domain: str
    session_lifetime_minutes: int = 100

    @property
    def allowed_domains(self) -> list[str]:
        # Matches the existing app's own comma-separated-origins convention
        # (see this repo's root .env.example) rather than inventing a new one.
        return [origin.strip() for origin in self.allowed_domain.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
