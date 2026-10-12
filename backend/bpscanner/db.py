"""Подключение к MongoDB.

`db` — ленивый прокси: клиент создаётся при первом обращении, а в тестах
базу можно подменить через `set_database()`.
"""
import logging
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

from .config import settings

logger = logging.getLogger("bpscanner.db")

_client = None
_database = None

# Коллекции с результатами анализа — удаляются/перезаписываются вместе
RESULT_COLLECTIONS = ["processes", "bpmn_models", "scoring", "recommendations", "tobe_models", "n8n_workflows"]


def get_database():
    global _client, _database
    if _database is None:
        _client = AsyncIOMotorClient(settings.mongo_url, serverSelectionTimeoutMS=5000, tz_aware=False)
        _database = _client[settings.db_name]
    return _database


def set_database(database) -> None:
    global _database
    _database = database


class _DatabaseProxy:
    def __getattr__(self, name):
        return getattr(get_database(), name)

    def __getitem__(self, name):
        return get_database()[name]


db = _DatabaseProxy()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_iso(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


async def ensure_indexes() -> None:
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.divisions.create_index("id", unique=True)
    await db.divisions.create_index("created_by")
    await db.divisions.create_index("shared_with")
    for name in RESULT_COLLECTIONS + ["documents", "questionnaires", "division_knowledge"]:
        await db[name].create_index("division_id")
    await db.error_logs.create_index("created_at")
    await db.error_logs.create_index("step")
    await db.prompts.create_index("step_name", unique=True)
    await db.prompt_history.create_index("step_name")
    await db.knowledge_base.create_index("category")
    await db.analysis_runs.create_index("division_id")
    await db.document_digests.create_index("key", unique=True)
