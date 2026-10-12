"""Журнал ошибок для панели администратора."""
import json
import logging
import traceback
import uuid

from .db import db, now_iso

logger = logging.getLogger("bpscanner.errors")


async def log_error(
    division_id: str | None,
    step: str,
    error_message: str,
    error_detail: str | None = None,
    input_data: dict | None = None,
    exc: BaseException | None = None,
) -> str | None:
    stack = None
    if exc is not None:
        stack = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))[-4000:]
    entry = {
        "id": str(uuid.uuid4()),
        "division_id": division_id,
        "step": step,
        "error_message": error_message[:1000],
        "error_detail": (error_detail or "")[:4000] or None,
        "stack_trace": stack,
        "input_data_summary": json.dumps(input_data, ensure_ascii=False, default=str)[:2000] if input_data else None,
        "created_at": now_iso(),
        "resolved": False,
    }
    try:
        await db.error_logs.insert_one(entry)
    except Exception as db_exc:  # журнал ошибок не должен ронять основной поток
        logger.error("Could not write error log: %s", db_exc)
        return None
    logger.error("[%s/%s] %s", division_id or "-", step, error_message)
    return entry["id"]
