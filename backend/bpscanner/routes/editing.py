"""Ручная доработка результатов: процессы (с перестроением BPMN), инициативы, подсказки для анкеты."""
import uuid

from fastapi import APIRouter, Depends, HTTPException

from ..budget import fit_prompt
from ..context import base_variables, prepare_documents
from ..db import db, now_iso
from ..economics import process_economics
from ..llm import LLMClient, LLMError, complete_json_object, load_llm_config
from ..normalize import INITIATIVE_STATUSES, normalize_process, to_bool
from ..pipeline import as_is_bpmn
from ..prompts import get_active_prompt
from ..questionnaire import QUESTIONNAIRE_SCHEMA, MAX_ANSWER_CHARS
from ..schemas import InitiativeUpdate, ProcessInput
from ..security import ACCESS_WRITE, get_current_user, get_division_for

router = APIRouter(tags=["editing"])


def _build_process(data: ProcessInput) -> dict:
    process = normalize_process(data.model_dump())
    if process is None:
        raise HTTPException(status_code=400, detail="Укажите название процесса")
    process["economics"] = process_economics(process)
    return process


async def _refresh_division(division_id: str) -> None:
    """После ручных правок отмечаем, что скоринг и рекомендации стоит пересчитать."""
    count = await db.processes.count_documents({"division_id": division_id})
    await db.divisions.update_one(
        {"id": division_id}, {"$set": {"processes_count": count, "results_outdated": True, "updated_at": now_iso()}}
    )


async def _replace_bpmn(process: dict) -> None:
    await db.bpmn_models.delete_many({"division_id": process["division_id"], "process_id": process["id"], "type": "as_is"})
    model = as_is_bpmn(process)
    model.update({"id": str(uuid.uuid4()), "division_id": process["division_id"], "order": process.get("order", 0), "created_at": now_iso()})
    await db.bpmn_models.insert_one(model)


@router.post("/divisions/{division_id}/processes")
async def create_process(division_id: str, data: ProcessInput, user=Depends(get_current_user)):
    await get_division_for(user, division_id, ACCESS_WRITE)
    process = _build_process(data)
    last = await db.processes.find({"division_id": division_id}, {"_id": 0, "order": 1}).sort("order", -1).to_list(1)
    process.update({
        "id": str(uuid.uuid4()),
        "division_id": division_id,
        "order": (last[0].get("order", 0) + 1) if last else 0,
        "created_at": now_iso(),
        "edited": True,
        "updated_by": user["user_id"],
    })
    await db.processes.insert_one(dict(process))
    await _replace_bpmn(process)
    await _refresh_division(division_id)
    return process


@router.put("/divisions/{division_id}/processes/{process_id}")
async def update_process(division_id: str, process_id: str, data: ProcessInput, user=Depends(get_current_user)):
    await get_division_for(user, division_id, ACCESS_WRITE)
    existing = await db.processes.find_one({"id": process_id, "division_id": division_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Процесс не найден")
    process = _build_process(data)
    process.update({
        key: existing.get(key) for key in ("id", "division_id", "order", "created_at")
    })
    process.update({"edited": True, "updated_at": now_iso(), "updated_by": user["user_id"]})
    await db.processes.replace_one({"id": process_id}, dict(process))
    if existing.get("name") != process["name"]:
        for collection in ("scoring", "tobe_models"):
            await db[collection].update_many({"process_id": process_id}, {"$set": {"process_name": process["name"]}})
        await db.bpmn_models.update_many({"process_id": process_id, "type": "as_is"}, {"$set": {"process_name": process["name"]}})
    await _replace_bpmn(process)
    await _refresh_division(division_id)
    return process


@router.delete("/divisions/{division_id}/processes/{process_id}")
async def delete_process(division_id: str, process_id: str, user=Depends(get_current_user)):
    await get_division_for(user, division_id, ACCESS_WRITE)
    result = await db.processes.delete_one({"id": process_id, "division_id": division_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Процесс не найден")
    for collection in ("bpmn_models", "scoring", "tobe_models"):
        await db[collection].delete_many({"division_id": division_id, "process_id": process_id})
    await _refresh_division(division_id)
    return {"status": "deleted"}


@router.patch("/divisions/{division_id}/recommendations/{rec_id}")
async def update_initiative(division_id: str, rec_id: str, data: InitiativeUpdate, user=Depends(get_current_user)):
    await get_division_for(user, division_id, ACCESS_WRITE)
    existing = await db.recommendations.find_one({"id": rec_id, "division_id": division_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Рекомендация не найдена")
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if "status" in update and update["status"] != existing.get("status", "new"):
        update.update({"status_updated_at": now_iso(), "status_updated_by": user["user_id"]})
    if update:
        await db.recommendations.update_one({"id": rec_id}, {"$set": update})
    return {**existing, **update}


@router.get("/initiatives/statuses")
async def initiative_statuses():
    return [{"key": key, "label": label} for key, label in INITIATIVE_STATUSES.items()]


def _questions_for_prompt() -> str:
    lines = []
    for section in QUESTIONNAIRE_SCHEMA:
        for question in section["questions"]:
            suffix = f" (варианты: {', '.join(question['options'])})" if question.get("options") else ""
            kind = {"boolean": "boolean", "select": "select"}.get(question["type"], "текст")
            lines.append(f"- {question['id']} [{kind}]: {question['text']}{suffix}")
    return "\n".join(lines)


def _clean_suggestions(raw: dict) -> dict:
    questions = {q["id"]: q for section in QUESTIONNAIRE_SCHEMA for q in section["questions"]}
    result = {}
    for key, value in raw.items():
        question = questions.get(key)
        if not question or value in (None, "", [], {}):
            continue
        if question["type"] == "boolean":
            result[key] = to_bool(value)
        elif question["type"] == "select":
            options = {o.lower(): o for o in question.get("options", [])}
            match = options.get(str(value).strip().lower())
            if match:
                result[key] = match
        else:
            text = "\n".join(map(str, value)) if isinstance(value, list) else str(value)
            if text.strip():
                result[key] = text.strip()[:MAX_ANSWER_CHARS]
    return result


@router.post("/divisions/{division_id}/questionnaire/suggest")
async def suggest_answers(division_id: str, user=Depends(get_current_user)):
    """Модель предлагает ответы анкеты по документам подразделения (без сохранения)."""
    division = await get_division_for(user, division_id, ACCESS_WRITE)
    if not await db.documents.count_documents({"division_id": division_id}):
        raise HTTPException(status_code=400, detail="Сначала загрузите документы подразделения")
    try:
        client = LLMClient(await load_llm_config())
        questions = {"questions": _questions_for_prompt()}
        documents, _, _ = await prepare_documents(division, client, step="questionnaire_prefill", extra_variables=questions)
        variables = {**await base_variables(division, documents), **questions}
        prompt = await get_active_prompt("questionnaire_prefill")
        fitted = await fit_prompt(client, prompt, variables)
        raw = await complete_json_object(client, prompt.get("system_prompt", ""), fitted.text)
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=exc.message) from exc
    suggestions = _clean_suggestions(raw)
    return {"suggestions": suggestions, "count": len(suggestions)}
