"""Сводная аналитика: карточки подразделений и портфельный дашборд."""
from datetime import datetime, timedelta, timezone

from .config import settings
from .db import db, parse_iso
from .normalize import CATEGORY_LABELS, SCORE_FIELDS

SCORE_LABELS = {
    "complexity": "Сложность",
    "manual_effort": "Ручной труд",
    "system_fragmentation": "Фрагментация систем",
    "approval_burden": "Согласования",
    "ai_suitability": "Пригодность для AI",
    "automation_readiness": "Готовность к автоматизации",
}
COMPLEXITY_LABELS = {"low": "Низкая", "medium": "Средняя", "high": "Высокая"}


def display_status(division: dict) -> str:
    status = division.get("analysis_status") or "not_started"
    if status not in ("not_started", "in_progress", "completed", "error"):
        status = "in_progress"
    if status == "in_progress":
        updated = parse_iso(division.get("analysis_updated_at"))
        stale_before = datetime.now(timezone.utc) - timedelta(seconds=settings.analysis_stale_seconds)
        if updated is None or updated < stale_before:
            return "error"
    return status


def accessible_divisions_query(user: dict) -> dict:
    if user["is_admin"]:
        return {}
    return {"$or": [{"created_by": user["user_id"]}, {"shared_with": user["user_id"]}]}


async def enrich_divisions(divisions: list[dict], user: dict | None = None) -> list[dict]:
    """Добавляет к подразделениям число документов, заполненность анкеты и роль пользователя."""
    ids = [d["id"] for d in divisions]
    if not ids:
        return []
    doc_counts = {
        row["_id"]: row["count"]
        for row in await db.documents.aggregate([
            {"$match": {"division_id": {"$in": ids}}},
            {"$group": {"_id": "$division_id", "count": {"$sum": 1}}},
        ]).to_list(None)
    }
    owner_ids = list({d.get("created_by") for d in divisions if d.get("created_by")})
    owners = {
        u["id"]: u.get("name") or u.get("email")
        for u in await db.users.find({"id": {"$in": owner_ids}}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(None)
    }
    result = []
    for division in divisions:
        item = {k: v for k, v in division.items() if k not in ("analysis_steps", "analysis_error_detail")}
        item["analysis_status"] = display_status(division)
        item["documents_count"] = doc_counts.get(division["id"], 0)
        item["questionnaire_completion"] = division.get("questionnaire_completion") or {"percent": 0, "required_percent": 0}
        item["owner_name"] = owners.get(division.get("created_by"), "")
        if user is not None:
            if division.get("created_by") == user["user_id"]:
                item["access"] = "owner"
            elif user["user_id"] in (division.get("shared_with") or []):
                item["access"] = "shared"
            else:
                item["access"] = "admin"
        result.append(item)
    return result


async def build_dashboard(user: dict) -> dict:
    divisions = await db.divisions.find(accessible_divisions_query(user), {"_id": 0}).sort("created_at", -1).to_list(1000)
    divisions = await enrich_divisions(divisions, user)
    ids = [d["id"] for d in divisions]
    names = {d["id"]: d.get("name", "") for d in divisions}
    match = {"$match": {"division_id": {"$in": ids}}}

    statuses = {"not_started": 0, "in_progress": 0, "completed": 0, "error": 0}
    for division in divisions:
        statuses[division["analysis_status"]] = statuses.get(division["analysis_status"], 0) + 1

    by_category = {
        row["_id"]: row
        for row in await db.recommendations.aggregate([
            match,
            {"$group": {"_id": "$category", "count": {"$sum": 1}, "fte": {"$sum": "$estimated_fte_savings"}}},
        ]).to_list(None)
    }
    by_complexity = {
        row["_id"]: row["count"]
        for row in await db.recommendations.aggregate([
            match, {"$group": {"_id": "$complexity", "count": {"$sum": 1}}},
        ]).to_list(None)
    }

    scoring = await db.scoring.find({"division_id": {"$in": ids}}, {"_id": 0}).to_list(5000)
    avg_scores = []
    for field in SCORE_FIELDS:
        values = [s[field] for s in scoring if isinstance(s.get(field), (int, float))]
        avg_scores.append({
            "key": field,
            "label": SCORE_LABELS[field],
            "value": round(sum(values) / len(values), 1) if values else 0,
        })

    potentials = [s.get("automation_potential") for s in scoring if isinstance(s.get("automation_potential"), (int, float))]
    buckets = [("0–25", 0, 25), ("26–50", 26, 50), ("51–75", 51, 75), ("76–100", 76, 100)]
    potential_distribution = [
        {"range": label, "count": sum(1 for p in potentials if low <= p <= high)} for label, low, high in buckets
    ]

    top_processes = sorted(
        (s for s in scoring if isinstance(s.get("automation_potential"), (int, float))),
        key=lambda s: s["automation_potential"],
        reverse=True,
    )[:10]

    quick_wins = await db.recommendations.find(
        {"division_id": {"$in": ids}, "complexity": "low"}, {"_id": 0}
    ).sort([("priority", 1), ("estimated_fte_savings", -1)]).to_list(5)

    total_fte = sum(row.get("fte", 0) or 0 for row in by_category.values())
    return {
        # поля прежней версии — для совместимости
        "total_divisions": len(divisions),
        "analyzed_divisions": statuses["completed"],
        "in_progress": statuses["in_progress"],
        "total_processes": sum(d.get("processes_count", 0) or 0 for d in divisions),
        "total_recommendations": sum(d.get("recommendations_count", 0) or 0 for d in divisions),
        "divisions": divisions,
        # расширенная аналитика
        "status_counts": statuses,
        "total_workflows": sum(d.get("n8n_workflows_count", 0) or 0 for d in divisions),
        "total_fte_savings": round(total_fte, 1),
        "avg_automation_potential": round(sum(potentials) / len(potentials)) if potentials else None,
        "recommendations_by_category": [
            {
                "category": key,
                "label": label,
                "count": by_category.get(key, {}).get("count", 0),
                "fte": round(by_category.get(key, {}).get("fte", 0) or 0, 1),
            }
            for key, label in CATEGORY_LABELS.items()
        ],
        "recommendations_by_complexity": [
            {"complexity": key, "label": label, "count": by_complexity.get(key, 0)}
            for key, label in COMPLEXITY_LABELS.items()
        ],
        "avg_scores": avg_scores,
        "potential_distribution": potential_distribution,
        "top_processes": [
            {
                "process_name": s.get("process_name"),
                "division_id": s.get("division_id"),
                "division_name": names.get(s.get("division_id"), ""),
                "automation_potential": s.get("automation_potential"),
                "manual_effort": s.get("manual_effort"),
                "automation_readiness": s.get("automation_readiness"),
                "ai_suitability": s.get("ai_suitability"),
            }
            for s in top_processes
        ],
        "quick_wins": [
            {
                "title": r.get("title"),
                "division_id": r.get("division_id"),
                "division_name": names.get(r.get("division_id"), ""),
                "estimated_fte_savings": r.get("estimated_fte_savings", 0),
                "category": r.get("category"),
            }
            for r in quick_wins
        ],
    }
