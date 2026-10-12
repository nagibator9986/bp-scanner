"""Контекст из базы знаний для промптов."""
from .db import db

KNOWLEDGE_TOTAL_CHARS = 12000
KNOWLEDGE_ITEM_CHARS = 4000


async def get_knowledge_context(division_id: str | None) -> str:
    """Собирает контекст: глобальные материалы (если не отключены для подразделения),
    явно выбранные для подразделения и привязанные к нему."""
    selection = {}
    if division_id:
        selection = await db.division_knowledge.find_one({"division_id": division_id}, {"_id": 0}) or {}
    use_global = selection.get("use_global", True)
    selected_ids = selection.get("selected_ids") or []

    clauses = []
    if use_global:
        clauses.append({"is_global": True})
    if selected_ids:
        clauses.append({"id": {"$in": selected_ids}})
    if division_id:
        clauses.append({"division_id": division_id})
    if not clauses:
        return ""

    items = await db.knowledge_base.find(
        {"is_active": {"$ne": False}, "$or": clauses}, {"_id": 0}
    ).sort("created_at", 1).to_list(50)
    if not items:
        return ""

    parts = ["## Контекст из базы знаний (учитывай при анализе)"]
    remaining = KNOWLEDGE_TOTAL_CHARS
    for item in items:
        if remaining <= 0:
            break
        content = (item.get("content") or "")[: min(KNOWLEDGE_ITEM_CHARS, remaining)]
        remaining -= len(content)
        parts.append(f"### {item.get('title', 'Материал')} ({item.get('category', 'general')})\n{content}")
    return "\n\n".join(parts)
