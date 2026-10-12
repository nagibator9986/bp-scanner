"""Запуск анализа, результаты, экспорт отчётов, BPMN и n8n, дашборд."""
import asyncio
import io
import json
import re
import zipfile

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from ..analytics import build_dashboard
from ..db import db
from ..n8n import export_filename, to_n8n_workflow
from ..pipeline import analysis_status, start_analysis
from ..reports import build_pdf_report, build_word_report, content_disposition, report_filename
from ..security import ACCESS_WRITE, get_current_user, get_division_for

router = APIRouter(tags=["analysis"])


@router.post("/divisions/{division_id}/analyze")
async def run_analysis(division_id: str, user=Depends(get_current_user)):
    await get_division_for(user, division_id, ACCESS_WRITE)
    run_id = await start_analysis(division_id, user["user_id"])
    return {"status": "started", "run_id": run_id}


@router.get("/divisions/{division_id}/analysis-status")
async def get_analysis_status(division_id: str, user=Depends(get_current_user)):
    division = await get_division_for(user, division_id)
    return await analysis_status(division)


async def _results(collection: str, division_id: str, extra: dict | None = None, projection: dict | None = None) -> list:
    query = {"division_id": division_id, **(extra or {})}
    return await db[collection].find(query, {"_id": 0, **(projection or {})}).sort("order", 1).to_list(1000)


@router.get("/divisions/{division_id}/processes")
async def get_processes(division_id: str, user=Depends(get_current_user)):
    await get_division_for(user, division_id)
    return await _results("processes", division_id)


@router.get("/divisions/{division_id}/bpmn")
async def get_bpmn_models(division_id: str, type: str | None = None, user=Depends(get_current_user)):
    await get_division_for(user, division_id)
    return await _results("bpmn_models", division_id, {"type": type} if type else None)


@router.get("/divisions/{division_id}/bpmn/{model_id}/download")
async def download_bpmn(division_id: str, model_id: str, user=Depends(get_current_user)):
    await get_division_for(user, division_id)
    model = await db.bpmn_models.find_one({"id": model_id, "division_id": division_id}, {"_id": 0})
    if not model:
        raise HTTPException(status_code=404, detail="Схема не найдена")
    name = re.sub(r"[^\w\-]+", "_", model.get("process_name") or "process").strip("_")[:80] or "process"
    suffix = "TO-BE" if model.get("type") == "to_be" else "AS-IS"
    return Response(
        content=model.get("xml", ""),
        media_type="application/xml",
        headers={"Content-Disposition": content_disposition(f"{name}_{suffix}.bpmn", f"process_{suffix}.bpmn")},
    )


@router.get("/divisions/{division_id}/scoring")
async def get_scoring(division_id: str, user=Depends(get_current_user)):
    await get_division_for(user, division_id)
    return await _results("scoring", division_id)


@router.get("/divisions/{division_id}/recommendations")
async def get_recommendations(division_id: str, user=Depends(get_current_user)):
    await get_division_for(user, division_id)
    return await _results("recommendations", division_id)


@router.get("/divisions/{division_id}/tobe")
async def get_tobe_models(division_id: str, user=Depends(get_current_user)):
    await get_division_for(user, division_id)
    return await _results("tobe_models", division_id)


@router.get("/divisions/{division_id}/n8n")
async def get_n8n_workflows(division_id: str, user=Depends(get_current_user)):
    await get_division_for(user, division_id)
    return await _results("n8n_workflows", division_id)


@router.get("/divisions/{division_id}/n8n/export")
async def export_all_n8n(division_id: str, user=Depends(get_current_user)):
    """ZIP со всеми workflows в формате импорта n8n."""
    await get_division_for(user, division_id)
    workflows = await _results("n8n_workflows", division_id)
    if not workflows:
        raise HTTPException(status_code=404, detail="Workflows ещё не сгенерированы")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for index, workflow in enumerate(workflows, 1):
            archive.writestr(
                export_filename(workflow, index),
                json.dumps(to_n8n_workflow(workflow), ensure_ascii=False, indent=2),
            )
    return Response(
        content=buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": content_disposition("n8n_workflows.zip", "n8n_workflows.zip")},
    )


@router.get("/divisions/{division_id}/n8n/{workflow_id}/export")
async def export_n8n(division_id: str, workflow_id: str, user=Depends(get_current_user)):
    """Один workflow в формате импорта n8n (Workflows → Import from File)."""
    await get_division_for(user, division_id)
    workflow = await db.n8n_workflows.find_one({"id": workflow_id, "division_id": division_id}, {"_id": 0})
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow не найден")
    return Response(
        content=json.dumps(to_n8n_workflow(workflow), ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": content_disposition(export_filename(workflow), "workflow.json")},
    )


async def _report_data(division: dict) -> dict:
    division_id = division["id"]
    return {
        "division": division,
        "questionnaire": await db.questionnaires.find_one({"division_id": division_id}, {"_id": 0}),
        "processes": await _results("processes", division_id),
        "scoring": await _results("scoring", division_id),
        "recommendations": await _results("recommendations", division_id),
        "tobe": await _results("tobe_models", division_id),
        "n8n_workflows": await _results("n8n_workflows", division_id),
    }


@router.get("/divisions/{division_id}/export/word")
async def export_word_report(division_id: str, user=Depends(get_current_user)):
    division = await get_division_for(user, division_id)
    content = await asyncio.to_thread(build_word_report, await _report_data(division))
    filename, fallback = report_filename(division, "docx")
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": content_disposition(filename, fallback)},
    )


@router.get("/divisions/{division_id}/export/pdf")
async def export_pdf_report(division_id: str, user=Depends(get_current_user)):
    division = await get_division_for(user, division_id)
    try:
        content = await asyncio.to_thread(build_pdf_report, await _report_data(division))
    except OSError as exc:  # нет системных библиотек WeasyPrint (Pango)
        raise HTTPException(status_code=500, detail=f"PDF-движок недоступен на сервере: {exc}") from exc
    filename, fallback = report_filename(division, "pdf")
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": content_disposition(filename, fallback)},
    )


@router.get("/dashboard")
async def get_dashboard(user=Depends(get_current_user)):
    return await build_dashboard(user)
