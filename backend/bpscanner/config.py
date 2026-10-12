"""Конфигурация приложения из переменных окружения (.env поддерживается)."""
import logging
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

logger = logging.getLogger("bpscanner.config")


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


@dataclass
class Settings:
    env: str = field(default_factory=lambda: os.environ.get("ENV", "prod"))
    mongo_url: str = field(default_factory=lambda: os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    db_name: str = field(default_factory=lambda: os.environ.get("DB_NAME", "bp_scanner"))

    jwt_secret: str = field(default_factory=lambda: os.environ.get("JWT_SECRET", ""))
    jwt_ttl_hours: int = field(default_factory=lambda: _int("JWT_TTL_HOURS", 24 * 7))

    admin_email: str = field(default_factory=lambda: os.environ.get("ADMIN_EMAIL", "admin@bpscanner.ru"))
    admin_password: str = field(default_factory=lambda: os.environ.get("ADMIN_PASSWORD", ""))
    reset_admin_password: bool = field(default_factory=lambda: _bool("RESET_ADMIN_PASSWORD", False))
    allow_registration: bool = field(default_factory=lambda: _bool("ALLOW_REGISTRATION", True))

    cors_origins: list[str] = field(
        default_factory=lambda: [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
    )

    upload_dir: Path = field(
        default_factory=lambda: Path(os.environ.get("UPLOAD_DIR", str(BACKEND_DIR / "app" / "uploads")))
    )
    max_upload_mb: int = field(default_factory=lambda: _int("MAX_UPLOAD_MB", 25))
    # Верхний предел объёма документов в промпте (символов). Фактический бюджет считается
    # от контекстного окна модели и обычно меньше; предел нужен для моделей с огромным окном.
    max_document_chars: int = field(default_factory=lambda: _int("MAX_DOCUMENT_CHARS", 60000))
    # Документы, не помещающиеся в бюджет, конспектируются частями не больше такого размера
    digest_chunk_chars: int = field(default_factory=lambda: _int("DIGEST_CHUNK_CHARS", 12000))
    # Предел числа фрагментов на конспектирование за один анализ (делится между документами)
    max_digest_chunks: int = field(default_factory=lambda: _int("MAX_DIGEST_CHUNKS", 60))

    # Настройки LLM по умолчанию (OpenAI-совместимый API, например внутренний Qwen за vLLM).
    # Используются, пока администратор не сохранил свои настройки в интерфейсе.
    llm_provider: str = field(default_factory=lambda: os.environ.get("LLM_PROVIDER", "custom"))
    llm_base_url: str = field(default_factory=lambda: os.environ.get("LLM_BASE_URL", os.environ.get("OPENAI_BASE_URL", "")))
    llm_model: str = field(default_factory=lambda: os.environ.get("LLM_MODEL", os.environ.get("OPENAI_MODEL", "")))
    llm_api_key: str = field(default_factory=lambda: os.environ.get("LLM_API_KEY", os.environ.get("OPENAI_API_KEY", "")))
    llm_max_tokens: int | None = field(default_factory=lambda: _int("LLM_MAX_TOKENS", 0) or None)
    llm_temperature: float = field(default_factory=lambda: float(os.environ.get("LLM_TEMPERATURE", "0.2") or 0.2))
    llm_disable_thinking: bool = field(default_factory=lambda: _bool("LLM_DISABLE_THINKING", False))
    llm_json_mode: bool = field(default_factory=lambda: _bool("LLM_JSON_MODE", False))
    llm_max_concurrency: int = field(default_factory=lambda: _int("LLM_MAX_CONCURRENCY", 2))
    # Контекстное окно модели (токены: промпт + ответ), если его не удалось узнать у сервера.
    # vLLM сообщает окно сам (max_model_len в /v1/models); настройка администратора может его уменьшить.
    llm_context_tokens: int = field(default_factory=lambda: _int("LLM_CONTEXT_TOKENS", 32768))
    # Сколько токенов окна оставлять под ответ, если LLM_MAX_TOKENS не задан
    llm_output_reserve: int = field(default_factory=lambda: _int("LLM_OUTPUT_RESERVE", 4096))

    ai_step_timeout: int = field(default_factory=lambda: _int("AI_STEP_TIMEOUT", 600))
    ai_max_attempts: int = field(default_factory=lambda: _int("AI_MAX_ATTEMPTS", 3))
    analysis_stale_seconds: int = field(default_factory=lambda: _int("ANALYSIS_STALE_SECONDS", 180))

    frontend_dir: Path = field(
        default_factory=lambda: Path(os.environ.get("FRONTEND_DIR", str(BACKEND_DIR.parent / "frontend" / "build")))
    )

    def __post_init__(self) -> None:
        if not self.jwt_secret:
            self.jwt_secret = secrets.token_urlsafe(48)
            logger.warning(
                "JWT_SECRET не задан — сгенерирован временный ключ. Токены станут недействительны "
                "после перезапуска; при нескольких репликах задайте JWT_SECRET явно."
            )

    @property
    def cors_allow_all(self) -> bool:
        return "*" in self.cors_origins


settings = Settings()
