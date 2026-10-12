"""Конвейер AI-анализа подразделения.

Этапы: подготовка → процессы → BPMN AS-IS → скоринг → рекомендации → (TO-BE ‖ n8n) → сохранение.

Особенности:
- одновременно для подразделения выполняется не более одного анализа (атомарный захват);
- прогресс и «пульс» пишутся в документ подразделения, зависший анализ распознаётся по пульсу;
- результаты собираются в памяти и заменяют прежние только в конце — неудачный
  перезапуск не уничтожает предыдущий успешный анализ;
- некритичные этапы (скоринг, TO-BE, n8n) при ошибке пропускаются с предупреждением.
"""
import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from .bpmn import generate_bpmn_xml
from .config import settings
from .db import RESULT_COLLECTIONS, db, now_iso, parse_iso
from .documents import build_documents_context, extract_text_from_file, STORED_TEXT_LIMIT
from .errors import log_error
from .knowledge import get_knowledge_context
from .llm import LLMClient, LLMError, complete_json_list, load_llm_config
from .normalize import (
    normalize_processes,
    normalize_recommendations,
    normalize_scoring,
    normalize_tobe,
    normalize_workflows,
)
from .prompts import get_active_prompt, render_prompt
from .questionnaire import format_answers_for_prompt

logger = logging.getLogger("bpscanner.pipeline")

STEPS = [
    ("prepare", "Подготовка данных"),
    ("extracting_processes", "Извлечение процессов"),
    ("generating_bpmn", "BPMN-схемы AS-IS"),
    ("scoring", "Скоринг процессов"),
    ("generating_recommendations", "Рекомендации"),
    ("generating_tobe", "TO-BE модели"),
    ("generating_n8n", "N8N workflows"),
    ("saving", "Сохранение результатов"),
]
STEP_TITLES = dict(STEPS)
KNOWN_STATUSES = {"not_started", "in_progress", "completed", "error"}
HEARTBEAT_SECONDS = 20

_running_tasks: set[asyncio.Task] = set()


class _Superseded(Exception):
    """Анализ перезапущен или подразделение удалено — текущий запуск молча завершается."""


class _Tracker:
    def __init__(self, division_id: str, run_id: str):
        self.division_id = division_id
        self.run_id = run_id
        self.steps = {key: "pending" for key, _ in STEPS}
        self.current = "prepare"
        self.warnings: list[str] = []

    async def _write(self, fields: dict) -> None:
        result = await db.divisions.update_one(
            {"id": self.division_id, "analysis_run_id": self.run_id},
            {"$set": {**fields, "analysis_updated_at": now_iso()}},
        )
        if result.matched_count == 0:
            raise _Superseded()

    async def start(self, key: str, progress: int, message: str | None = None) -> None:
        for step_key, state in self.steps.items():
            if state == "running":
                self.steps[step_key] = "done"
        self.steps[key] = "running"
        self.current = key
        await self._write({
            "analysis_step": key,
            "analysis_progress": progress,
            "analysis_current_step": message or STEP_TITLES[key],
            "analysis_steps": self.steps,
        })

    async def progress(self, progress: int, message: str) -> None:
        await self._write({"analysis_progress": progress, "analysis_current_step": message, "analysis_steps": self.steps})

    def mark(self, key: str, state: str) -> None:
        self.steps[key] = state

    async def warn(self, key: str, message: str) -> None:
        self.mark(key, "skipped")
        self.warnings.append(f"{STEP_TITLES[key]}: {message}")
        await self._write({"analysis_steps": self.steps, "analysis_warnings": self.warnings})

    async def heartbeat(self) -> None:
        try:
            while True:
                await asyncio.sleep(HEARTBEAT_SECONDS)
                await db.divisions.update_one(
                    {"id": self.division_id, "analysis_run_id": self.run_id, "analysis_status": "in_progress"},
                    {"$set": {"analysis_updated_at": now_iso()}},
                )
        except asyncio.CancelledError:
            pass


def _dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def _processes_for_prompt(processes: list[dict]) -> str:
    return _dumps([
        {
            "name": p["name"],
            "description": p["description"][:400],
            "frequency": p["frequency"],
            "volume": p["volume"],
            "roles": p["roles"],
            "systems": p["systems"],
            "pain_points": p["pain_points"],
            "steps": [
                {k: v for k, v in s.items() if k in ("name", "role", "system", "type", "manual") and v not in ("", None)}
                for s in p["steps_detail"]
            ],
        }
        for p in processes
    ])


async def _document_texts(division_id: str) -> list[tuple[str, str]]:
    documents = await db.documents.find({"division_id": division_id}, {"_id": 0}).sort("uploaded_at", 1).to_list(200)
    texts = []
    for document in documents:
        text = document.get("extracted_text")
        if text is None and document.get("file_path"):
            text = await asyncio.to_thread(extract_text_from_file, document["file_path"])
            await db.documents.update_one(
                {"id": document["id"]},
                {"$set": {"extracted_text": text[:STORED_TEXT_LIMIT], "text_length": len(text)}},
            )
        texts.append((document.get("filename", "Документ"), text or ""))
    return texts


async def _ask(client: LLMClient, step_name: str, variables: dict) -> list[dict]:
    prompt = await get_active_prompt(step_name)
    user_prompt = render_prompt(prompt["user_prompt_template"], variables)
    items, _ = await complete_json_list(client, prompt.get("system_prompt", ""), user_prompt)
    return items


def _with_ids(items: list[dict], division_id: str) -> list[dict]:
    created = now_iso()
    for order, item in enumerate(items):
        item.setdefault("id", str(uuid.uuid4()))
        item["division_id"] = division_id
        item["order"] = order
        item["created_at"] = created
    return items


async def run_analysis(division_id: str, run_id: str) -> None:
    tracker = _Tracker(division_id, run_id)
    heartbeat = asyncio.create_task(tracker.heartbeat())
    started = time.monotonic()
    try:
        # ---------- Подготовка ----------
        await tracker.start("prepare", 5)
        division = await db.divisions.find_one({"id": division_id}, {"_id": 0})
        if not division:
            raise _Superseded()
        client = LLMClient(await load_llm_config())

        questionnaire = await db.questionnaires.find_one({"division_id": division_id}, {"_id": 0}) or {}
        documents = await _document_texts(division_id)
        description_parts = [division.get("description") or ""]
        if division.get("head_name"):
            description_parts.append(f"Руководитель: {division['head_name']}")
        if division.get("employees_count"):
            description_parts.append(f"Сотрудников: {division['employees_count']}")
        base_vars = {
            "division_name": division.get("name", ""),
            "division_description": ". ".join(p for p in description_parts if p) or "не указано",
            "questionnaire": format_answers_for_prompt(questionnaire.get("answers")),
            "documents": build_documents_context(documents, settings.max_document_chars),
            "knowledge_context": await get_knowledge_context(division_id),
        }
        if base_vars["questionnaire"] == "Анкета не заполнена" and base_vars["documents"] == "Документы не загружены":
            raise LLMError("Нет исходных данных: заполните анкету или загрузите документы")

        # ---------- Процессы ----------
        await tracker.start("extracting_processes", 10, "Модель выявляет бизнес-процессы")
        processes = normalize_processes(await _ask(client, "extracting_processes", base_vars))
        if not processes:
            raise LLMError("Модель не выявила ни одного процесса — уточните анкету или документы")
        _with_ids(processes, division_id)
        await tracker.progress(30, f"Выявлено процессов: {len(processes)}")

        # ---------- BPMN AS-IS ----------
        await tracker.start("generating_bpmn", 35, "Построение BPMN-схем")
        bpmn_models = [
            {
                "process_id": p["id"],
                "process_name": p["name"],
                "type": "as_is",
                "xml": generate_bpmn_xml(p["name"], p["steps_detail"], p["roles"][0] if p["roles"] else None),
                "generator": "auto",
            }
            for p in processes
        ]

        processes_json = _processes_for_prompt(processes)

        # ---------- Скоринг (некритичный) ----------
        await tracker.start("scoring", 45, "Оценка процессов по 6 измерениям")
        scoring: list[dict] = []
        try:
            scoring = normalize_scoring(
                await _ask(client, "scoring", {**base_vars, "processes": processes_json}), processes
            )
            _with_ids(scoring, division_id)
            if not scoring:
                await tracker.warn("scoring", "модель не вернула оценки")
        except LLMError as exc:
            await log_error(division_id, "scoring", exc.message, exc.detail)
            await tracker.warn("scoring", exc.message)

        # ---------- Рекомендации ----------
        await tracker.start("generating_recommendations", 60, "Формирование рекомендаций")
        scoring_json = _dumps([
            {k: s[k] for k in ("process_name", "complexity", "manual_effort", "system_fragmentation",
                               "approval_burden", "ai_suitability", "automation_readiness",
                               "automation_potential", "bottlenecks")}
            for s in scoring
        ]) if scoring else "Скоринг недоступен"
        recommendations: list[dict] = []
        try:
            recommendations = normalize_recommendations(
                await _ask(client, "recommendations", {**base_vars, "processes": processes_json, "scoring": scoring_json}),
                processes,
            )
            _with_ids(recommendations, division_id)
            if not recommendations:
                await tracker.warn("generating_recommendations", "модель не вернула рекомендации")
        except LLMError as exc:
            await log_error(division_id, "generating_recommendations", exc.message, exc.detail)
            await tracker.warn("generating_recommendations", exc.message)

        # ---------- TO-BE и n8n параллельно (некритичные) ----------
        tobe: list[dict] = []
        workflows: list[dict] = []
        if recommendations:
            await tracker.start("generating_tobe", 72, "Проектирование TO-BE и n8n workflows")
            tracker.mark("generating_n8n", "running")
            recs_json = _dumps([
                {k: r[k] for k in ("title", "category", "description", "related_processes", "effect")}
                for r in recommendations
            ])
            automation = [r for r in recommendations if r["category"] != "ai_reengineering"] or recommendations
            automation_json = _dumps([
                {k: r[k] for k in ("title", "category", "description", "related_processes", "implementation_stack")}
                for r in automation
            ])
            tobe_result, n8n_result = await asyncio.gather(
                _ask(client, "tobe", {**base_vars, "processes": processes_json, "recommendations": recs_json}),
                _ask(client, "n8n", {**base_vars, "processes": processes_json, "recommendations": automation_json}),
                return_exceptions=True,
            )
            for key, result in (("generating_tobe", tobe_result), ("generating_n8n", n8n_result)):
                if isinstance(result, BaseException):
                    if not isinstance(result, LLMError):
                        raise result
                    await log_error(division_id, key, result.message, result.detail)
                    await tracker.warn(key, result.message)
            if not isinstance(tobe_result, BaseException):
                tobe = _with_ids(normalize_tobe(tobe_result, processes), division_id)
                tracker.mark("generating_tobe", "done")
            if not isinstance(n8n_result, BaseException):
                workflows = _with_ids(normalize_workflows(n8n_result), division_id)
                tracker.mark("generating_n8n", "done" if workflows else "skipped")
            for model in tobe:
                if model["new_process"]["steps_detail"]:
                    bpmn_models.append({
                        "process_id": model.get("process_id"),
                        "tobe_id": model["id"],
                        "process_name": model["process_name"],
                        "type": "to_be",
                        "xml": generate_bpmn_xml(model["new_process"]["name"], model["new_process"]["steps_detail"]),
                        "generator": "auto",
                    })
        else:
            tracker.mark("generating_tobe", "skipped")
            tracker.mark("generating_n8n", "skipped")

        # ---------- Сохранение ----------
        await tracker.start("saving", 95, "Сохранение результатов")
        _with_ids(bpmn_models, division_id)
        batches = {
            "processes": processes,
            "bpmn_models": bpmn_models,
            "scoring": scoring,
            "recommendations": recommendations,
            "tobe_models": tobe,
            "n8n_workflows": workflows,
        }
        # Перед заменой ещё раз убеждаемся, что этот запуск всё ещё актуален
        await tracker.progress(97, "Сохранение результатов")
        for collection in RESULT_COLLECTIONS:
            await db[collection].delete_many({"division_id": division_id})
            if batches[collection]:
                await db[collection].insert_many([dict(item) for item in batches[collection]])

        tracker.mark("saving", "done")
        potentials = [s["automation_potential"] for s in scoring]
        await tracker._write({
            "analysis_status": "completed",
            "analysis_progress": 100,
            "analysis_step": "done",
            "analysis_current_step": "Анализ завершён" + (" с предупреждениями" if tracker.warnings else ""),
            "analysis_steps": tracker.steps,
            "analysis_warnings": tracker.warnings,
            "analysis_error": None,
            "analysis_failed_step": None,
            "analysis_completed_at": now_iso(),
            "analysis_duration_sec": round(time.monotonic() - started),
            "processes_count": len(processes),
            "recommendations_count": len(recommendations),
            "tobe_count": len(tobe),
            "n8n_workflows_count": len(workflows),
            "fte_savings_total": round(sum(r["estimated_fte_savings"] for r in recommendations), 2),
            "avg_automation_potential": round(sum(potentials) / len(potentials)) if potentials else None,
        })
        logger.info("[%s] analysis completed in %ss", division_id, round(time.monotonic() - started))

    except _Superseded:
        logger.info("[%s] analysis run %s superseded", division_id, run_id)
    except LLMError as exc:
        await _fail(tracker, exc.message, exc.detail)
    except Exception as exc:  # непредвиденная ошибка — сохраняем трассировку для админ-панели
        logger.exception("[%s] analysis crashed", division_id)
        await _fail(tracker, f"Внутренняя ошибка: {exc.__class__.__name__}: {str(exc)[:300]}", exc=exc)
    finally:
        heartbeat.cancel()


async def _fail(tracker: _Tracker, message: str, detail: str | None = None, exc: BaseException | None = None) -> None:
    tracker.mark(tracker.current, "error")
    await log_error(tracker.division_id, tracker.current, message, detail, exc=exc)
    await db.divisions.update_one(
        {"id": tracker.division_id, "analysis_run_id": tracker.run_id},
        {"$set": {
            "analysis_status": "error",
            "analysis_error": message,
            "analysis_error_detail": (detail or "")[:2000] or None,
            "analysis_failed_step": tracker.current,
            "analysis_current_step": f"Ошибка на этапе «{STEP_TITLES.get(tracker.current, tracker.current)}»",
            "analysis_steps": tracker.steps,
            "analysis_warnings": tracker.warnings,
            "analysis_updated_at": now_iso(),
        }},
    )


def _stale_cutoff() -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=settings.analysis_stale_seconds)).isoformat()


async def start_analysis(division_id: str, user_id: str) -> str:
    """Атомарно переводит подразделение в состояние анализа и запускает фоновую задачу."""
    run_id = str(uuid.uuid4())
    now = now_iso()
    claimed = await db.divisions.find_one_and_update(
        {
            "id": division_id,
            "$or": [
                {"analysis_status": {"$ne": "in_progress"}},
                {"analysis_updated_at": {"$lt": _stale_cutoff()}},
                {"analysis_updated_at": {"$exists": False}},
            ],
        },
        {"$set": {
            "analysis_status": "in_progress",
            "analysis_run_id": run_id,
            "analysis_progress": 2,
            "analysis_step": "prepare",
            "analysis_current_step": "Анализ поставлен в очередь",
            "analysis_steps": {key: "pending" for key, _ in STEPS},
            "analysis_warnings": [],
            "analysis_error": None,
            "analysis_error_detail": None,
            "analysis_failed_step": None,
            "analysis_started_at": now,
            "analysis_started_by": user_id,
            "analysis_updated_at": now,
        }},
    )
    if claimed is None:
        raise HTTPException(status_code=409, detail="Анализ уже выполняется")
    task = asyncio.create_task(run_analysis(division_id, run_id))
    _running_tasks.add(task)
    task.add_done_callback(_running_tasks.discard)
    return run_id


async def analysis_status(division: dict) -> dict:
    """Статус анализа; зависший анализ (нет «пульса») помечается ошибкой."""
    status = division.get("analysis_status") or "not_started"
    if status not in KNOWN_STATUSES:
        status = "in_progress"  # статусы старой версии (названия этапов)
    if status == "in_progress":
        updated = parse_iso(division.get("analysis_updated_at"))
        if updated is None or updated < datetime.now(timezone.utc) - timedelta(seconds=settings.analysis_stale_seconds):
            message = "Анализ прерван: сервер был перезапущен или обработка зависла. Запустите анализ снова."
            await db.divisions.update_one(
                {"id": division["id"], "analysis_updated_at": division.get("analysis_updated_at")},
                {"$set": {"analysis_status": "error", "analysis_error": message, "analysis_updated_at": now_iso()}},
            )
            status = "error"
            division = {**division, "analysis_error": message}

    steps_state = division.get("analysis_steps") or {}
    return {
        "status": status,
        "progress": division.get("analysis_progress", 0) if status != "completed" else 100,
        "step": division.get("analysis_step"),
        "current_step": division.get("analysis_current_step", ""),
        "steps": [{"key": key, "title": title, "state": steps_state.get(key, "pending")} for key, title in STEPS],
        "error": division.get("analysis_error"),
        "error_detail": division.get("analysis_error_detail"),
        "failed_step": division.get("analysis_failed_step"),
        "warnings": division.get("analysis_warnings") or [],
        "started_at": division.get("analysis_started_at"),
        "updated_at": division.get("analysis_updated_at"),
        "completed_at": division.get("analysis_completed_at"),
        "duration_sec": division.get("analysis_duration_sec"),
    }
