"""Панель администратора: ошибки, промпты, база знаний, пользователи, данные подразделений."""
import asyncio
import os
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..analytics import enrich_divisions
from ..db import db, now_iso
from ..documents import ALLOWED_EXTENSIONS, extract_text_from_file
from ..llm import LLMClient, LLMError, load_llm_config
from ..prompts import DEFAULT_PROMPTS, STEP_META
from ..schemas import KnowledgeCreate, KnowledgeUpdate, PasswordReset, PromptCreate, PromptTestRequest, PromptUpdate
from ..security import get_admin_user, hash_password, is_admin_user, public_user
from .divisions import _public_document, _save_upload

router = APIRouter(prefix="/admin", tags=["admin"])


# ============== Ошибки ==============

@router.get("/errors")
async def get_error_logs(
    page: int = 1,
    limit: int = 50,
    step: str | None = None,
    resolved: bool | None = None,
    division_id: str | None = None,
    admin=Depends(get_admin_user),
):
    page, limit = max(page, 1), min(max(limit, 1), 200)
    query = {}
    if step:
        query["step"] = step
    if resolved is not None:
        query["resolved"] = resolved
    if division_id:
        query["division_id"] = division_id
    total = await db.error_logs.count_documents(query)
    errors = await db.error_logs.find(query, {"_id": 0}).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    division_ids = list({e.get("division_id") for e in errors if e.get("division_id")})
    names = {
        d["id"]: d.get("name", "")
        for d in await db.divisions.find({"id": {"$in": division_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(None)
    }
    for error in errors:
        error["division_name"] = names.get(error.get("division_id"), "")
    return {"errors": errors, "total": total, "page": page, "pages": (total + limit - 1) // limit}


@router.get("/errors/stats")
async def get_error_stats(admin=Depends(get_admin_user)):
    stats = await db.error_logs.aggregate([
        {"$group": {
            "_id": "$step",
            "count": {"$sum": 1},
            "unresolved": {"$sum": {"$cond": [{"$eq": ["$resolved", False]}, 1, 0]}},
        }},
        {"$sort": {"count": -1}},
    ]).to_list(50)
    return {
        "by_step": stats,
        "total": await db.error_logs.count_documents({}),
        "unresolved": await db.error_logs.count_documents({"resolved": False}),
    }


@router.post("/errors/resolve-all")
async def resolve_all_errors(admin=Depends(get_admin_user)):
    result = await db.error_logs.update_many(
        {"resolved": False},
        {"$set": {"resolved": True, "resolved_at": now_iso(), "resolved_by": admin["user_id"]}},
    )
    return {"status": "updated", "count": result.modified_count}


@router.get("/errors/{error_id}")
async def get_error_detail(error_id: str, admin=Depends(get_admin_user)):
    error = await db.error_logs.find_one({"id": error_id}, {"_id": 0})
    if not error:
        raise HTTPException(status_code=404, detail="Ошибка не найдена")
    return error


@router.patch("/errors/{error_id}")
async def update_error(error_id: str, resolved: bool | None = None, notes: str | None = None, admin=Depends(get_admin_user)):
    update = {}
    if resolved is not None:
        update["resolved"] = resolved
        update["resolved_at"] = now_iso() if resolved else None
        update["resolved_by"] = admin["user_id"] if resolved else None
    if notes:
        update["admin_notes"] = notes[:2000]
    if update:
        await db.error_logs.update_one({"id": error_id}, {"$set": update})
    return {"status": "updated"}


@router.delete("/errors/{error_id}")
async def delete_error(error_id: str, admin=Depends(get_admin_user)):
    await db.error_logs.delete_one({"id": error_id})
    return {"status": "deleted"}


# ============== Промпты ==============

def _check_step(step_name: str) -> None:
    if step_name not in STEP_META:
        raise HTTPException(status_code=404, detail="Неизвестный этап анализа")


def _prompt_view(step_name: str, stored: dict | None) -> dict:
    default = DEFAULT_PROMPTS[step_name]
    base = stored or {**default, "step_name": step_name, "is_default": True, "is_active": True, "version": 1}
    return {
        **base,
        "step_title": STEP_META[step_name]["title"],
        "placeholders": STEP_META[step_name]["placeholders"],
        "description": base.get("description") or default["description"],
    }


async def _save_history(prompt: dict) -> None:
    await db.prompt_history.insert_one({
        "id": str(uuid.uuid4()),
        "prompt_id": prompt.get("id"),
        "step_name": prompt["step_name"],
        "system_prompt": prompt.get("system_prompt", ""),
        "user_prompt_template": prompt.get("user_prompt_template", ""),
        "version": prompt.get("version", 1),
        "created_at": now_iso(),
    })


@router.get("/prompts")
async def get_prompts(admin=Depends(get_admin_user)):
    stored = {p["step_name"]: p for p in await db.prompts.find({}, {"_id": 0}).to_list(100)}
    return [_prompt_view(step, stored.get(step)) for step in STEP_META]


@router.get("/prompts/{step_name}")
async def get_prompt(step_name: str, admin=Depends(get_admin_user)):
    _check_step(step_name)
    return _prompt_view(step_name, await db.prompts.find_one({"step_name": step_name}, {"_id": 0}))


@router.post("/prompts")
async def create_or_update_prompt(data: PromptCreate, admin=Depends(get_admin_user)):
    _check_step(data.step_name)
    existing = await db.prompts.find_one({"step_name": data.step_name}, {"_id": 0})
    if existing:
        await _save_history(existing)
        version = existing.get("version", 1) + 1
        await db.prompts.update_one({"step_name": data.step_name}, {"$set": {
            "system_prompt": data.system_prompt,
            "user_prompt_template": data.user_prompt_template,
            "description": data.description or existing.get("description", ""),
            "version": version,
            "is_default": False,
            "is_active": True,
            "updated_at": now_iso(),
            "updated_by": admin["user_id"],
        }})
        return {"status": "updated", "version": version}
    prompt = {
        "id": str(uuid.uuid4()),
        "step_name": data.step_name,
        "system_prompt": data.system_prompt,
        "user_prompt_template": data.user_prompt_template,
        "description": data.description or DEFAULT_PROMPTS[data.step_name]["description"],
        "version": 1,
        "is_active": True,
        "is_default": False,
        "created_at": now_iso(),
        "created_by": admin["user_id"],
    }
    await db.prompts.insert_one(dict(prompt))
    return {"status": "created", "id": prompt["id"], "version": 1}


@router.patch("/prompts/{step_name}")
async def patch_prompt(step_name: str, data: PromptUpdate, admin=Depends(get_admin_user)):
    _check_step(step_name)
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if update:
        if "system_prompt" in update or "user_prompt_template" in update:
            update["is_default"] = False
        update.update({"updated_at": now_iso(), "updated_by": admin["user_id"]})
        await db.prompts.update_one({"step_name": step_name}, {"$set": update})
    return {"status": "updated"}


@router.get("/prompts/{step_name}/history")
async def get_prompt_history(step_name: str, admin=Depends(get_admin_user)):
    return await db.prompt_history.find({"step_name": step_name}, {"_id": 0}).sort("created_at", -1).to_list(50)


@router.post("/prompts/{step_name}/restore/{version}")
async def restore_prompt_version(step_name: str, version: int, admin=Depends(get_admin_user)):
    _check_step(step_name)
    item = await db.prompt_history.find_one({"step_name": step_name, "version": version}, {"_id": 0}, sort=[("created_at", -1)])
    if not item:
        raise HTTPException(status_code=404, detail="Версия не найдена")
    current = await db.prompts.find_one({"step_name": step_name}, {"_id": 0})
    if current:
        await _save_history(current)
    new_version = (current.get("version", 1) if current else 0) + 1
    await db.prompts.update_one({"step_name": step_name}, {"$set": {
        "system_prompt": item["system_prompt"],
        "user_prompt_template": item["user_prompt_template"],
        "version": new_version,
        "is_default": False,
        "is_active": True,
        "updated_at": now_iso(),
        "updated_by": admin["user_id"],
        "restored_from_version": version,
    }}, upsert=True)
    return {"status": "restored", "new_version": new_version}


@router.post("/prompts/test")
async def test_prompt(data: PromptTestRequest, admin=Depends(get_admin_user)):
    user_prompt = data.user_prompt + (f"\n\nТестовые данные:\n{data.test_input}" if data.test_input else "")
    try:
        client = LLMClient(await load_llm_config())
        response = await client.complete(data.system_prompt, user_prompt)
        return {"success": True, "response": response}
    except LLMError as exc:
        return {"success": False, "error": exc.message, "detail": exc.detail}


@router.post("/prompts/{step_name}/reset")
async def reset_prompt_to_default(step_name: str, admin=Depends(get_admin_user)):
    _check_step(step_name)
    current = await db.prompts.find_one({"step_name": step_name}, {"_id": 0})
    if current and not current.get("is_default"):
        await _save_history(current)
    default = DEFAULT_PROMPTS[step_name]
    await db.prompts.update_one({"step_name": step_name}, {"$set": {
        **default,
        "is_default": True,
        "is_active": True,
        "version": (current.get("version", 1) + 1) if current else 1,
        "updated_at": now_iso(),
        "updated_by": admin["user_id"],
    }, "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now_iso()}}, upsert=True)
    return {"status": "reset_to_default"}


# ============== База знаний ==============

@router.get("/knowledge")
async def get_knowledge_items(category: str | None = None, is_global: bool | None = None, admin=Depends(get_admin_user)):
    query = {}
    if category:
        query["category"] = category
    if is_global is not None:
        query["is_global"] = is_global
    return await db.knowledge_base.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.post("/knowledge")
async def create_knowledge(data: KnowledgeCreate, admin=Depends(get_admin_user)):
    item = {
        "id": str(uuid.uuid4()),
        "title": data.title.strip(),
        "content": data.content,
        "category": data.category,
        "is_global": data.is_global,
        "division_id": data.division_id,
        "is_active": True,
        "created_at": now_iso(),
        "created_by": admin["user_id"],
    }
    await db.knowledge_base.insert_one(dict(item))
    return item


@router.post("/knowledge/upload")
async def upload_knowledge_file(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    category: str = Form(default="general"),
    is_global: bool = Form(default=True),
    admin=Depends(get_admin_user),
):
    extension = Path(file.filename or "").suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Неподдерживаемый формат файла")
    handle, temp_name = tempfile.mkstemp(suffix=extension)
    os.close(handle)
    temp_path = Path(temp_name)
    try:
        await _save_upload(file, temp_path)
        text = await asyncio.to_thread(extract_text_from_file, temp_path)
    finally:
        temp_path.unlink(missing_ok=True)
    if not text.strip():
        raise HTTPException(status_code=400, detail="Не удалось извлечь текст из файла")
    item = {
        "id": str(uuid.uuid4()),
        "title": (title or file.filename or "Документ")[:300],
        "content": text[:200000],
        "category": category[:50],
        "is_global": is_global,
        "is_active": True,
        "source_filename": file.filename,
        "created_at": now_iso(),
        "created_by": admin["user_id"],
    }
    await db.knowledge_base.insert_one(dict(item))
    return item


@router.get("/knowledge/categories/list")
async def get_knowledge_categories(admin=Depends(get_admin_user)):
    categories = await db.knowledge_base.aggregate([
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]).to_list(50)
    return [{"category": c["_id"], "count": c["count"]} for c in categories]


@router.get("/knowledge/{item_id}")
async def get_knowledge_item(item_id: str, admin=Depends(get_admin_user)):
    item = await db.knowledge_base.find_one({"id": item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Материал не найден")
    return item


@router.patch("/knowledge/{item_id}")
async def update_knowledge(item_id: str, data: KnowledgeUpdate, admin=Depends(get_admin_user)):
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if update:
        update.update({"updated_at": now_iso(), "updated_by": admin["user_id"]})
        await db.knowledge_base.update_one({"id": item_id}, {"$set": update})
    return {"status": "updated"}


@router.delete("/knowledge/{item_id}")
async def delete_knowledge(item_id: str, admin=Depends(get_admin_user)):
    await db.knowledge_base.delete_one({"id": item_id})
    return {"status": "deleted"}


# ============== Пользователи ==============

@router.get("/users")
async def get_users(admin=Depends(get_admin_user)):
    users = await db.users.find({}, {"_id": 0, "password": 0}).sort("created_at", 1).to_list(2000)
    counts = {
        row["_id"]: row["count"]
        for row in await db.divisions.aggregate([{"$group": {"_id": "$created_by", "count": {"$sum": 1}}}]).to_list(None)
    }
    return [
        {**public_user(u), "disabled": bool(u.get("disabled")), "last_login_at": u.get("last_login_at"),
         "divisions_count": counts.get(u["id"], 0)}
        for u in users
    ]


async def _ensure_other_admin_exists(user_id: str) -> None:
    admins = await db.users.find({"$or": [{"is_admin": True}, {"role": "admin"}], "disabled": {"$ne": True}}, {"_id": 0, "id": 1}).to_list(100)
    if not [a for a in admins if a["id"] != user_id]:
        raise HTTPException(status_code=400, detail="Нельзя лишить прав последнего администратора")


@router.patch("/users/{user_id}/role")
async def set_user_role(user_id: str, role: str, admin=Depends(get_admin_user)):
    if role not in ("user", "admin", "analyst"):
        raise HTTPException(status_code=400, detail="Недопустимая роль")
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if is_admin_user(target) and role != "admin":
        await _ensure_other_admin_exists(user_id)
    await db.users.update_one({"id": user_id}, {"$set": {"role": role, "is_admin": role == "admin"}})
    return {"status": "updated"}


@router.patch("/users/{user_id}/status")
async def set_user_status(user_id: str, disabled: bool, admin=Depends(get_admin_user)):
    if user_id == admin["user_id"]:
        raise HTTPException(status_code=400, detail="Нельзя отключить собственную учётную запись")
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if disabled and is_admin_user(target):
        await _ensure_other_admin_exists(user_id)
    await db.users.update_one({"id": user_id}, {"$set": {"disabled": disabled}})
    return {"status": "updated"}


@router.post("/users/{user_id}/password")
async def reset_user_password(user_id: str, data: PasswordReset, admin=Depends(get_admin_user)):
    result = await db.users.update_one({"id": user_id}, {"$set": {"password": hash_password(data.password)}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return {"status": "updated"}


# ============== Статистика и данные подразделений ==============

@router.get("/stats")
async def get_admin_stats(admin=Depends(get_admin_user)):
    llm = (await load_llm_config()).public()
    return {
        "users": await db.users.count_documents({}),
        "divisions": await db.divisions.count_documents({}),
        "completed_analyses": await db.divisions.count_documents({"analysis_status": "completed"}),
        "unresolved_errors": await db.error_logs.count_documents({"resolved": False}),
        "knowledge_items": await db.knowledge_base.count_documents({"is_active": {"$ne": False}}),
        "documents": await db.documents.count_documents({}),
        "llm_configured": llm["configured"],
        "llm_model": llm["model_name"],
    }


@router.get("/divisions")
async def get_all_divisions(admin=Depends(get_admin_user)):
    divisions = await db.divisions.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return await enrich_divisions(divisions, admin)


@router.get("/divisions/{division_id}/questionnaire")
async def get_division_questionnaire_admin(division_id: str, admin=Depends(get_admin_user)):
    return await db.questionnaires.find_one({"division_id": division_id}, {"_id": 0}) or {"answers": {}}


@router.get("/divisions/{division_id}/documents")
async def get_division_documents_admin(division_id: str, admin=Depends(get_admin_user)):
    documents = await db.documents.find({"division_id": division_id}, {"_id": 0}).to_list(500)
    result = []
    for document in documents:
        text = document.get("extracted_text")
        if text is None and document.get("file_path"):
            text = await asyncio.to_thread(extract_text_from_file, document["file_path"])
        item = _public_document(document, text or "")
        item["extracted_text_preview"] = item.get("text_preview", "")
        result.append(item)
    return result
