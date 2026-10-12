"""Подразделения: карточки, совместный доступ, анкета, документы, выбор базы знаний."""
import asyncio
import os
import shutil
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..analytics import accessible_divisions_query, enrich_divisions
from ..config import settings
from ..context import evenly_spaced, plan_documents
from ..db import RESULT_COLLECTIONS, db, now_iso
from ..documents import ALLOWED_EXTENSIONS, STORED_TEXT_LIMIT, extract_text_from_file
from ..llm import LLMClient, LLMError, load_llm_config
from ..pipeline import analysis_status
from ..questionnaire import QUESTIONNAIRE_SCHEMA, questionnaire_completion, sanitize_answers
from ..reports import content_disposition
from ..schemas import DivisionCreate, DivisionShareRequest, DivisionUpdate, KnowledgeSelection, QuestionnaireData
from ..security import ACCESS_OWNER, ACCESS_WRITE, get_current_user, get_division_for

router = APIRouter(tags=["divisions"])

DOCUMENT_PUBLIC_FIELDS = {"_id": 0, "extracted_text": 0, "file_path": 0}


# ============== Подразделения ==============

@router.post("/divisions")
async def create_division(data: DivisionCreate, user=Depends(get_current_user)):
    division = {
        "id": str(uuid.uuid4()),
        "name": data.name.strip(),
        "description": data.description.strip(),
        "head_name": data.head_name.strip(),
        "employees_count": data.employees_count,
        "created_by": user["user_id"],
        "created_at": now_iso(),
        "analysis_status": "not_started",
        "analysis_progress": 0,
        "processes_count": 0,
        "recommendations_count": 0,
        "n8n_workflows_count": 0,
        "shared_with": [],
    }
    await db.divisions.insert_one(dict(division))
    return (await enrich_divisions([division], user))[0]


@router.get("/divisions")
async def list_divisions(user=Depends(get_current_user)):
    divisions = await db.divisions.find(accessible_divisions_query(user), {"_id": 0}).sort("created_at", -1).to_list(1000)
    return await enrich_divisions(divisions, user)


@router.get("/divisions/{division_id}")
async def get_division(division_id: str, user=Depends(get_current_user)):
    division = await get_division_for(user, division_id)
    enriched = (await enrich_divisions([division], user))[0]
    status = await analysis_status(division)
    enriched["analysis_status"] = status["status"]
    enriched["analysis_error"] = status["error"]
    enriched["analysis_warnings"] = status["warnings"]
    if division.get("shared_with"):
        shared = await db.users.find(
            {"id": {"$in": division["shared_with"]}}, {"_id": 0, "id": 1, "name": 1, "email": 1}
        ).to_list(500)
        enriched["shared_users"] = shared
    else:
        enriched["shared_users"] = []
    return enriched


@router.put("/divisions/{division_id}")
async def update_division(division_id: str, data: DivisionUpdate, user=Depends(get_current_user)):
    await get_division_for(user, division_id, ACCESS_OWNER)
    update = {k: (v.strip() if isinstance(v, str) else v) for k, v in data.model_dump().items() if v is not None}
    if update:
        update["updated_at"] = now_iso()
        await db.divisions.update_one({"id": division_id}, {"$set": update})
    division = await db.divisions.find_one({"id": division_id}, {"_id": 0})
    return (await enrich_divisions([division], user))[0]


@router.delete("/divisions/{division_id}")
async def delete_division(division_id: str, user=Depends(get_current_user)):
    await get_division_for(user, division_id, ACCESS_OWNER)
    await db.divisions.delete_one({"id": division_id})
    for collection in RESULT_COLLECTIONS + ["questionnaires", "documents", "division_knowledge", "error_logs"]:
        await db[collection].delete_many({"division_id": division_id})
    upload_dir = settings.upload_dir / division_id
    if upload_dir.is_dir():
        await asyncio.to_thread(shutil.rmtree, upload_dir, True)
    return {"status": "deleted"}


@router.post("/divisions/{division_id}/share")
async def share_division(division_id: str, data: DivisionShareRequest, user=Depends(get_current_user)):
    division = await get_division_for(user, division_id, ACCESS_OWNER)
    requested = [u for u in dict.fromkeys(data.user_ids) if u != division.get("created_by")]
    existing = await db.users.find({"id": {"$in": requested}}, {"_id": 0, "id": 1}).to_list(len(requested) or 1)
    valid = [u["id"] for u in existing]
    await db.divisions.update_one({"id": division_id}, {"$set": {"shared_with": valid}})
    return {"status": "shared", "shared_with": valid}


@router.delete("/divisions/{division_id}/share/{target_user_id}")
async def unshare_division(division_id: str, target_user_id: str, user=Depends(get_current_user)):
    await get_division_for(user, division_id, ACCESS_OWNER)
    await db.divisions.update_one({"id": division_id}, {"$pull": {"shared_with": target_user_id}})
    return {"status": "removed"}


# ============== Анкета ==============

@router.get("/questionnaire/schema")
async def get_questionnaire_schema():
    return QUESTIONNAIRE_SCHEMA


@router.get("/divisions/{division_id}/questionnaire")
async def get_questionnaire(division_id: str, user=Depends(get_current_user)):
    await get_division_for(user, division_id)
    questionnaire = await db.questionnaires.find_one({"division_id": division_id}, {"_id": 0}) or {"answers": {}}
    questionnaire["completion"] = questionnaire_completion(questionnaire.get("answers"))
    return questionnaire


@router.post("/divisions/{division_id}/questionnaire")
async def save_questionnaire(division_id: str, data: QuestionnaireData, user=Depends(get_current_user)):
    await get_division_for(user, division_id, ACCESS_WRITE)
    answers = sanitize_answers(data.answers)
    now = now_iso()
    await db.questionnaires.update_one(
        {"division_id": division_id},
        {
            "$set": {"answers": answers, "updated_at": now, "updated_by": user["user_id"]},
            "$setOnInsert": {"id": str(uuid.uuid4()), "division_id": division_id, "created_at": now},
        },
        upsert=True,
    )
    completion = questionnaire_completion(answers)
    await db.divisions.update_one(
        {"id": division_id},
        {"$set": {"questionnaire_completion": completion, "questionnaire_updated_at": now}},
    )
    return {"status": "saved", "updated_at": now, "completion": completion}


# ============== Документы ==============

async def _save_upload(file: UploadFile, destination: Path) -> int:
    """Потоково сохраняет файл с проверкой размера. Возвращает размер в байтах."""
    limit = settings.max_upload_mb * 1024 * 1024
    size = 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(destination, "wb") as target:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(status_code=413, detail=f"Файл больше {settings.max_upload_mb} МБ")
                target.write(chunk)
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    if size == 0:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Файл пустой")
    return size


def _check_extension(filename: str | None) -> str:
    extension = Path(filename or "").suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(e.lstrip(".").upper() for e in ALLOWED_EXTENSIONS))
        raise HTTPException(status_code=400, detail=f"Неподдерживаемый формат файла. Допустимо: {allowed}")
    return extension


def _public_document(document: dict, text: str | None = None) -> dict:
    result = {k: v for k, v in document.items() if k not in ("_id", "extracted_text", "file_path")}
    text = document.get("extracted_text") if text is None else text
    if text is not None:
        result["text_preview"] = text[:400]
        result["text_length"] = document.get("text_length", len(text))
    return result


@router.post("/divisions/{division_id}/documents")
async def upload_document(division_id: str, file: UploadFile = File(...), user=Depends(get_current_user)):
    await get_division_for(user, division_id, ACCESS_WRITE)
    extension = _check_extension(file.filename)
    file_id = str(uuid.uuid4())
    path = settings.upload_dir / division_id / f"{file_id}{extension}"
    size = await _save_upload(file, path)
    text = await asyncio.to_thread(extract_text_from_file, path)
    document = {
        "id": file_id,
        "division_id": division_id,
        "filename": Path(file.filename).name[:255],
        "file_path": str(path),
        "file_size": size,
        "file_type": extension,
        "extracted_text": text[:STORED_TEXT_LIMIT],
        "text_length": len(text),
        "uploaded_by": user["user_id"],
        "uploaded_at": now_iso(),
    }
    await db.documents.insert_one(dict(document))
    return _public_document(document)


@router.get("/divisions/{division_id}/documents")
async def list_documents(division_id: str, user=Depends(get_current_user)):
    await get_division_for(user, division_id)
    documents = await db.documents.find({"division_id": division_id}, {"_id": 0, "file_path": 0}).sort("uploaded_at", 1).to_list(500)
    return [_public_document(d) for d in documents]


@router.get("/divisions/{division_id}/documents/budget")
async def documents_budget(division_id: str, user=Depends(get_current_user)):
    """Помещаются ли документы в контекстное окно модели и сколько потребуется конспектирования."""
    division = await get_division_for(user, division_id)
    config = await load_llm_config()
    if not config.configured:
        return {"configured": False}
    try:
        plan = await plan_documents(division, LLMClient(config))
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=exc.message) from exc
    chunks = sum(len(evenly_spaced(len(plan.chunks[i]), max(plan.quotas[i], 1))) for i in plan.to_digest)
    return {
        "configured": True,
        "context_tokens": plan.context,
        "context_source": plan.context_source,
        "documents_tokens": sum(plan.sizes),
        "budget_tokens": plan.target,
        "fits": plan.fits,
        "digest_documents": len(plan.to_digest),
        "digest_chunks": chunks,
        "documents": [
            {"name": name, "tokens": size, "digest": index in plan.to_digest}
            for index, ((name, _), size) in enumerate(zip(plan.documents, plan.sizes))
        ],
    }


@router.get("/divisions/{division_id}/documents/{doc_id}/download")
async def download_document(division_id: str, doc_id: str, user=Depends(get_current_user)):
    await get_division_for(user, division_id)
    document = await db.documents.find_one({"id": doc_id, "division_id": division_id}, {"_id": 0})
    if not document or not document.get("file_path") or not os.path.isfile(document["file_path"]):
        raise HTTPException(status_code=404, detail="Файл не найден")
    filename = document.get("filename") or f"document{document.get('file_type', '')}"
    return FileResponse(
        document["file_path"],
        headers={"Content-Disposition": content_disposition(filename, f"document{document.get('file_type', '')}")},
    )


@router.delete("/divisions/{division_id}/documents/{doc_id}")
async def delete_document(division_id: str, doc_id: str, user=Depends(get_current_user)):
    await get_division_for(user, division_id, ACCESS_WRITE)
    document = await db.documents.find_one({"id": doc_id, "division_id": division_id})
    if not document:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if document.get("file_path"):
        Path(document["file_path"]).unlink(missing_ok=True)
    await db.documents.delete_one({"id": doc_id, "division_id": division_id})
    return {"status": "deleted"}


@router.post("/extract-text")
async def extract_text_from_upload(file: UploadFile = File(...), user=Depends(get_current_user)):
    extension = _check_extension(file.filename)
    handle, temp_name = tempfile.mkstemp(suffix=extension)
    os.close(handle)
    temp_path = Path(temp_name)
    try:
        await _save_upload(file, temp_path)
        text = await asyncio.to_thread(extract_text_from_file, temp_path)
    finally:
        temp_path.unlink(missing_ok=True)
    return {"text": text[:50000], "filename": file.filename}


# ============== База знаний для подразделения ==============

@router.get("/knowledge")
async def get_available_knowledge(user=Depends(get_current_user)):
    return await db.knowledge_base.find(
        {"is_active": {"$ne": False}}, {"_id": 0, "content": 0}
    ).sort("title", 1).to_list(500)


@router.get("/divisions/{division_id}/knowledge-selection")
async def get_knowledge_selection(division_id: str, user=Depends(get_current_user)):
    await get_division_for(user, division_id)
    selection = await db.division_knowledge.find_one({"division_id": division_id}, {"_id": 0})
    return selection or {"division_id": division_id, "selected_ids": [], "use_global": True}


@router.post("/divisions/{division_id}/knowledge-selection")
async def set_knowledge_selection(division_id: str, data: KnowledgeSelection, user=Depends(get_current_user)):
    await get_division_for(user, division_id, ACCESS_WRITE)
    await db.division_knowledge.update_one(
        {"division_id": division_id},
        {"$set": {
            "division_id": division_id,
            "selected_ids": list(dict.fromkeys(data.selected_ids)),
            "use_global": data.use_global,
            "updated_at": now_iso(),
        }},
        upsert=True,
    )
    return {"status": "saved"}
