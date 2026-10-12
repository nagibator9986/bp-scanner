"""Конвейер AI-анализа подразделения.

Этапы: подготовка (конспект длинных документов) → процессы → BPMN AS-IS → скоринг → рекомендации →
(TO-BE ‖ n8n) → экономика и сохранение.

Режимы запуска:
- full — полный анализ;
- scoring — пересчёт скоринга и всего дальнейшего по текущим (в т.ч. отредактированным) процессам;
- recommendations — пересчёт рекомендаций, TO-BE и n8n по текущим процессам и скорингу.

Особенности:
- одновременно для подразделения выполняется не более одного анализа (атомарный захват);
- прогресс и «пульс» пишутся в документ подразделения, зависший анализ распознаётся по пульсу;
- результаты собираются в памяти и заменяют прежние только в конце — неудачный
  перезапуск не уничтожает предыдущий успешный анализ;
- некритичные этапы (скоринг, TO-BE, n8n) при ошибке пропускаются с предупреждением;
- статусы инициатив (рекомендаций) переносятся на новые рекомендации с похожими названиями;
- каждый запуск записывается в историю (analysis_runs).
"""
import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from .bpmn import generate_bpmn_xml
from .budget import NO_DOCUMENTS, fit_first, pack_batches
from .config import settings
from .context import base_variables, prepare_documents
from .db import db, now_iso, parse_iso
from .economics import process_economics, tobe_economics
from .errors import log_error
from .llm import ContextOverflowError, LLMClient, LLMError, complete_json_list, load_llm_config
from .normalize import (
    match_name,
    normalize_processes,
    normalize_recommendations,
    normalize_scoring,
    normalize_tobe,
    normalize_workflows,
)
from .prompts import get_active_prompt, render_prompt

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
PROMPT_TITLES = {"scoring": "Скоринг процессов", "recommendations": "Рекомендации", "tobe": "TO-BE модели", "n8n": "N8N workflows"}
MODES = {
    "full": "Полный анализ",
    "scoring": "Пересчёт скоринга и рекомендаций",
    "recommendations": "Пересчёт рекомендаций, TO-BE и n8n",
}
# Какие коллекции результатов заменяет каждый режим
MODE_COLLECTIONS = {
    "full": ["processes", "bpmn_models", "scoring", "recommendations", "tobe_models", "n8n_workflows"],
    "scoring": ["scoring", "recommendations", "tobe_models", "n8n_workflows"],
    "recommendations": ["recommendations", "tobe_models", "n8n_workflows"],
}
KNOWN_STATUSES = {"not_started", "in_progress", "completed", "error"}
HEARTBEAT_SECONDS = 20
TOBE_BATCH_SIZE = 4
SCORING_BATCH_SIZE = 8
CARRIED_FIELDS = ("status", "owner", "comment", "due_date", "status_updated_at", "status_updated_by")

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


def processes_for_prompt(processes: list[dict], detail: str = "full") -> str:
    """Процессы для промпта. detail: full — шаги с ролями и системами; compact — шаги одной строкой;
    brief — только суть процесса (для больших подразделений и маленького окна модели)."""
    def steps(p: dict):
        detail_steps = p.get("steps_detail") or []
        if detail == "full":
            return [
                {k: v for k, v in s.items() if k in ("name", "role", "system", "type", "manual", "duration_min") and v not in ("", None)}
                for s in detail_steps
            ]
        if detail == "compact":
            return [
                s["name"] + (f" ({', '.join(x for x in (s.get('role'), s.get('system')) if x)})" if s.get("role") or s.get("system") else "")
                for s in detail_steps
            ]
        return len(detail_steps)

    limit = {"full": 400, "compact": 250, "brief": 160}[detail]
    rows = []
    for p in processes:
        row = {
            "name": p["name"],
            "description": (p.get("description") or "")[:limit],
            "frequency": p.get("frequency"),
            "volume_per_month": p.get("volume_per_month"),
            "pain_points": (p.get("pain_points") or [])[: 3 if detail == "brief" else None],
            ("steps_count" if detail == "brief" else "steps"): steps(p),
        }
        if detail == "full":
            row.update(roles=p.get("roles"), systems=p.get("systems"))
        elif detail == "compact":
            row["systems"] = p.get("systems")
        rows.append({k: v for k, v in row.items() if v not in (None, "", [])})
    return _dumps(rows)


async def ask_list(client: LLMClient, step_name: str, variables: dict,
                   alternatives: list[dict] | None = None, notes: list[str] | None = None,
                   refit: bool = True) -> list[dict]:
    """Запрос списка у модели с подгонкой промпта под контекстное окно.

    alternatives — более компактные варианты переменных, если основной не помещается.
    Если сервер всё же сообщил о переполнении, окно и оценка токенов уточняются по его ответу
    и промпт подгоняется заново (один повтор).
    """
    prompt = await get_active_prompt(step_name)
    variants = [variables, *(alternatives or [])]
    for attempt in range(2):
        fitted = await fit_first(client, prompt, variants)
        if fitted.shortened and notes is not None:
            title = PROMPT_TITLES.get(step_name) or STEP_TITLES.get(step_name, step_name)
            verb = "сокращена" if fitted.shortened == ["база знаний"] else "сокращены"
            note = f"{title}: под контекст модели {verb} {' и '.join(fitted.shortened)}"
            if note not in notes:
                notes.append(note)
        try:
            items, _ = await complete_json_list(client, prompt.get("system_prompt", ""), fitted.text)
            return items
        except ContextOverflowError as exc:
            if attempt == 1 or not refit:
                raise
            logger.warning("Context overflow on %s (%s), refitting prompt", step_name, exc.message)
    return []


def _with_ids(items: list[dict], division_id: str) -> list[dict]:
    created = now_iso()
    for order, item in enumerate(items):
        item.setdefault("id", str(uuid.uuid4()))
        item["division_id"] = division_id
        item["order"] = order
        item["created_at"] = created
    return items


def as_is_bpmn(process: dict) -> dict:
    return {
        "process_id": process["id"],
        "process_name": process["name"],
        "type": "as_is",
        "xml": generate_bpmn_xml(process["name"], process["steps_detail"], process["roles"][0] if process.get("roles") else None),
        "generator": "auto",
    }


def _carry_over_statuses(new_recs: list[dict], old_recs: list[dict]) -> None:
    """Статусы и комментарии инициатив сохраняются при перегенерации рекомендаций."""
    tracked = [r for r in old_recs if r.get("status", "new") != "new" or r.get("owner") or r.get("comment")]
    titles = [r.get("title", "") for r in tracked]
    used: set[int] = set()
    for rec in new_recs:
        index = match_name(rec["title"], titles)
        if index is None or index in used:
            continue
        used.add(index)
        for field in CARRIED_FIELDS:
            if tracked[index].get(field) is not None:
                rec[field] = tracked[index][field]


async def _score_batches(client: LLMClient, variables: dict, processes: list[dict], notes: list[str]) -> list[dict]:
    prompt = await get_active_prompt("scoring")
    batches = await pack_batches(client, prompt, variables, processes, processes_for_prompt, SCORING_BATCH_SIZE)
    results = await asyncio.gather(
        *(ask_list(client, "scoring", {**variables, "processes": processes_for_prompt(batch)},
                   [{**variables, "processes": processes_for_prompt(batch, "compact")}], notes)
          for batch in batches),
        return_exceptions=True,
    )
    scoring, errors = [], []
    for batch, result in zip(batches, results):
        if isinstance(result, LLMError):
            errors.append(result)
        elif isinstance(result, BaseException):
            raise result
        else:
            scoring.extend(normalize_scoring(result, batch))
    if errors and not scoring:
        raise errors[0]
    return scoring


async def _score(client: LLMClient, variables: dict, processes: list[dict], notes: list[str] | None = None) -> list[dict]:
    """Скоринг пакетами (под окно модели) с дозапросом процессов, которые модель пропустила."""
    notes = notes if notes is not None else []
    scoring = await _score_batches(client, variables, processes, notes)
    scored = {s["process_id"] for s in scoring}
    missing = [p for p in processes if p["id"] not in scored]
    if missing and scoring:
        logger.info("Scoring missed %d processes, asking again", len(missing))
        try:
            scoring += await _score_batches(client, variables, missing, notes)
        except LLMError as exc:
            logger.warning("Re-scoring missing processes failed: %s", exc.message)
    return sorted(scoring, key=lambda s: s["automation_potential"], reverse=True)


async def _tobe(client: LLMClient, variables: dict, processes: list[dict], recommendations_json: str,
                notes: list[str] | None = None) -> tuple[list[dict], list[str]]:
    """TO-BE модели пакетами по несколько процессов: длинный ответ не обрезается лимитом токенов,
    а промпт каждого пакета помещается в окно модели."""
    prompt = await get_active_prompt("tobe")
    base = {**variables, "recommendations": recommendations_json}
    batches = await pack_batches(client, prompt, base, processes, processes_for_prompt, TOBE_BATCH_SIZE)
    results = await asyncio.gather(
        *(ask_list(client, "tobe", {**base, "processes": processes_for_prompt(batch)},
                   [{**base, "processes": processes_for_prompt(batch, "compact")}], notes)
          for batch in batches),
        return_exceptions=True,
    )
    models, errors = [], []
    for batch, result in zip(batches, results):
        if isinstance(result, LLMError):
            errors.append(result.message)
        elif isinstance(result, BaseException):
            raise result
        else:
            models.extend(normalize_tobe(result, batch))
    if errors and not models:
        raise LLMError(errors[0])
    return dedupe_tobe(models, processes), errors


def dedupe_tobe(models: list[dict], processes: list[dict]) -> list[dict]:
    """Одна TO-BE модель на процесс.

    В ответ на пакет модель иногда описывает и процессы из соседних пакетов: такие описания
    не сопоставляются внутри своего пакета. Если у процесса уже есть модель — лишнее отбрасываем,
    иначе привязываем описание к процессу.
    """
    names = [p["name"] for p in processes]
    taken = {m["process_id"] for m in models if m.get("process_id")}
    result, seen = [], set()
    for model in models:
        if not model.get("process_id"):
            index = match_name(model["process_name"], names)
            if index is not None:
                process = processes[index]
                if process["id"] in taken:
                    continue
                model.update(process_id=process["id"], process_name=process["name"])
                model["metrics"]["steps_before"] = len(process.get("steps_detail") or [])
                taken.add(process["id"])
        elif model["process_id"] in seen:
            continue
        if model.get("process_id"):
            seen.add(model["process_id"])
        result.append(model)
    return result


async def run_analysis(division_id: str, run_id: str, mode: str = "full") -> None:
    tracker = _Tracker(division_id, run_id)
    heartbeat = asyncio.create_task(tracker.heartbeat())
    started = time.monotonic()
    replaced = MODE_COLLECTIONS[mode]
    try:
        # ---------- Подготовка ----------
        await tracker.start("prepare", 4)
        division = await db.divisions.find_one({"id": division_id}, {"_id": 0})
        if not division:
            raise _Superseded()
        config = await load_llm_config()
        client = LLMClient(config)

        window, window_source = await client.context_window()
        await db.analysis_runs.update_one({"id": run_id}, {"$set": {"model": config.model, "context_tokens": window, "context_source": window_source}})

        async def digest_progress(done: int, total: int) -> None:
            await tracker.progress(4 + int(5 * done / max(total, 1)), f"Конспект документов: {done} из {total} фрагментов")

        notes: list[str] = []  # что пришлось сократить под контекст модели
        documents: list[tuple[str, str]] = []
        if mode == "full":  # документы нужны только для извлечения процессов
            documents, doc_warnings, doc_stats = await prepare_documents(division, client, digest_progress)
            tracker.warnings.extend(doc_warnings)
            await db.analysis_runs.update_one({"id": run_id}, {"$set": {"documents_stats": doc_stats}})
        variables = await base_variables(division, documents)

        bpmn_models: list[dict] = []
        if mode == "full":
            if variables["questionnaire"] == "Анкета не заполнена" and variables["documents"] == NO_DOCUMENTS:
                raise LLMError("Нет исходных данных: заполните анкету или загрузите документы")

            # ---------- Процессы ----------
            await tracker.start("extracting_processes", 10, "Модель выявляет бизнес-процессы")
            try:
                raw_processes = await ask_list(client, "extracting_processes", variables, notes=notes, refit=False)
            except ContextOverflowError:
                # Окно модели оказалось меньше ожидаемого (уточнено по ответу сервера):
                # заново готовим документы — длинные будут законспектированы, а не обрезаны
                logger.warning("[%s] context overflow on process extraction, preparing documents again", division_id)
                documents, doc_warnings, doc_stats = await prepare_documents(division, client, digest_progress)
                tracker.warnings.extend(w for w in doc_warnings if w not in tracker.warnings)
                window, window_source = await client.context_window()
                await db.analysis_runs.update_one({"id": run_id}, {"$set": {
                    "documents_stats": doc_stats, "context_tokens": window, "context_source": window_source,
                }})
                variables = await base_variables(division, documents)
                await tracker.progress(12, "Модель выявляет бизнес-процессы")
                raw_processes = await ask_list(client, "extracting_processes", variables, notes=notes)
            processes = normalize_processes(raw_processes)
            if not processes:
                raise LLMError("Модель не выявила ни одного процесса — уточните анкету или документы")
            _with_ids(processes, division_id)
            await tracker.progress(30, f"Выявлено процессов: {len(processes)}")

            # ---------- BPMN AS-IS ----------
            await tracker.start("generating_bpmn", 35, "Построение BPMN-схем")
            bpmn_models = [as_is_bpmn(p) for p in processes]
        else:
            processes = await db.processes.find({"division_id": division_id}, {"_id": 0}).sort("order", 1).to_list(500)
            if not processes:
                raise LLMError("Нет процессов для пересчёта — выполните полный анализ")
            for key in ("extracting_processes", "generating_bpmn"):
                tracker.mark(key, "reused")
        for process in processes:
            process["economics"] = process_economics(process)

        # ---------- Скоринг (некритичный) ----------
        if mode == "recommendations":
            scoring = await db.scoring.find({"division_id": division_id}, {"_id": 0}).to_list(500)
            tracker.mark("scoring", "reused")
        else:
            await tracker.start("scoring", 45, "Оценка процессов по 6 измерениям")
            scoring = []
            try:
                scoring = _with_ids(await _score(client, variables, processes, notes), division_id)
                if not scoring:
                    await tracker.warn("scoring", "модель не вернула оценки")
            except LLMError as exc:
                await log_error(division_id, "scoring", exc.message, exc.detail)
                await tracker.warn("scoring", exc.message)

        # ---------- Рекомендации ----------
        await tracker.start("generating_recommendations", 60, "Формирование рекомендаций")
        processes_json = processes_for_prompt(processes)
        scoring_json = _dumps([
            {k: s.get(k) for k in ("process_name", "complexity", "manual_effort", "system_fragmentation",
                                   "approval_burden", "ai_suitability", "automation_readiness",
                                   "automation_potential", "bottlenecks")}
            for s in scoring
        ]) if scoring else "Скоринг недоступен"
        recommendations: list[dict] = []
        try:
            recommendations = normalize_recommendations(
                await ask_list(
                    client, "recommendations", {**variables, "processes": processes_json, "scoring": scoring_json},
                    [{**variables, "processes": processes_for_prompt(processes, detail), "scoring": scoring_json} for detail in ("compact", "brief")],
                    notes,
                ),
                processes,
            )
            _with_ids(recommendations, division_id)
            old = await db.recommendations.find({"division_id": division_id}, {"_id": 0}).to_list(500)
            _carry_over_statuses(recommendations, old)
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
                _tobe(client, variables, processes, recs_json, notes),
                ask_list(
                    client, "n8n", {**variables, "processes": processes_json, "recommendations": automation_json},
                    [{**variables, "processes": processes_for_prompt(processes, detail), "recommendations": automation_json} for detail in ("compact", "brief")],
                    notes,
                ),
                return_exceptions=True,
            )
            for key, result in (("generating_tobe", tobe_result), ("generating_n8n", n8n_result)):
                if isinstance(result, BaseException):
                    if not isinstance(result, LLMError):
                        raise result
                    await log_error(division_id, key, result.message, result.detail)
                    await tracker.warn(key, result.message)
            if not isinstance(tobe_result, BaseException):
                tobe, batch_errors = tobe_result
                _with_ids(tobe, division_id)
                tracker.mark("generating_tobe", "done")
                if batch_errors:
                    tracker.warnings.append(f"{STEP_TITLES['generating_tobe']}: часть процессов без TO-BE ({batch_errors[0]})")
            if not isinstance(n8n_result, BaseException):
                workflows = _with_ids(normalize_workflows(n8n_result), division_id)
                tracker.mark("generating_n8n", "done" if workflows else "skipped")
        else:
            tracker.mark("generating_tobe", "skipped")
            tracker.mark("generating_n8n", "skipped")

        # ---------- Экономика и BPMN TO-BE ----------
        by_id = {p["id"]: p for p in processes}
        for model in tobe:
            model["economics"] = tobe_economics(model, by_id.get(model.get("process_id")))
            if model["new_process"]["steps_detail"]:
                bpmn_models.append({
                    "process_id": model.get("process_id"),
                    "tobe_id": model["id"],
                    "process_name": model["process_name"],
                    "type": "to_be",
                    "xml": generate_bpmn_xml(model["new_process"]["name"], model["new_process"]["steps_detail"]),
                    "generator": "auto",
                })
        _with_ids(bpmn_models, division_id)

        # ---------- Сохранение ----------
        tracker.warnings.extend(note for note in notes if note not in tracker.warnings)
        await tracker.start("saving", 95, "Сохранение результатов")
        batches = {
            "processes": processes,
            "scoring": scoring,
            "recommendations": recommendations,
            "tobe_models": tobe,
            "n8n_workflows": workflows,
        }
        # Перед заменой ещё раз убеждаемся, что этот запуск всё ещё актуален
        await tracker.progress(97, "Сохранение результатов")
        for collection in replaced:
            if collection == "bpmn_models":
                continue
            await db[collection].delete_many({"division_id": division_id})
            if batches[collection]:
                await db[collection].insert_many([dict(item) for item in batches[collection]])
        if mode != "full":
            # Экономика процессов могла измениться после редактирования
            for process in processes:
                await db.processes.update_one({"id": process["id"]}, {"$set": {"economics": process["economics"]}})
        bpmn_filter = {"division_id": division_id} if mode == "full" else {"division_id": division_id, "type": "to_be"}
        await db.bpmn_models.delete_many(bpmn_filter)
        if bpmn_models:
            await db.bpmn_models.insert_many([dict(item) for item in bpmn_models])

        tracker.mark("saving", "done")
        potentials = [s["automation_potential"] for s in scoring if isinstance(s.get("automation_potential"), (int, float))]
        saved_hours = [t["economics"]["saved_hours_month"] for t in tobe if t["economics"].get("saved_hours_month") is not None]
        summary = {
            "processes_count": len(processes),
            "recommendations_count": len(recommendations),
            "tobe_count": len(tobe),
            "n8n_workflows_count": len(workflows),
            "fte_savings_total": round(sum(r["estimated_fte_savings"] for r in recommendations), 2),
            "avg_automation_potential": round(sum(potentials) / len(potentials)) if potentials else None,
            "saved_hours_month": round(sum(saved_hours), 1) if saved_hours else None,
        }
        duration = round(time.monotonic() - started)
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
            "analysis_duration_sec": duration,
            "analysis_mode": mode,
            "results_outdated": False,
            **summary,
        })
        await _finish_run(run_id, "completed", duration, warnings=tracker.warnings, summary=summary)
        logger.info("[%s] analysis (%s) completed in %ss", division_id, mode, duration)

    except _Superseded:
        logger.info("[%s] analysis run %s superseded", division_id, run_id)
        await _finish_run(run_id, "superseded", round(time.monotonic() - started))
    except LLMError as exc:
        await _fail(tracker, exc.message, exc.detail)
        await _finish_run(run_id, "error", round(time.monotonic() - started), error=exc.message, warnings=tracker.warnings)
    except Exception as exc:  # непредвиденная ошибка — сохраняем трассировку для админ-панели
        logger.exception("[%s] analysis crashed", division_id)
        message = f"Внутренняя ошибка: {exc.__class__.__name__}: {str(exc)[:300]}"
        await _fail(tracker, message, exc=exc)
        await _finish_run(run_id, "error", round(time.monotonic() - started), error=message)
    finally:
        heartbeat.cancel()


async def _finish_run(run_id: str, status: str, duration: int, error: str | None = None,
                      warnings: list[str] | None = None, summary: dict | None = None) -> None:
    await db.analysis_runs.update_one({"id": run_id}, {"$set": {
        "status": status,
        "finished_at": now_iso(),
        "duration_sec": duration,
        "error": error,
        "warnings": warnings or [],
        "summary": summary or {},
    }})


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


async def start_analysis(division_id: str, user: dict, mode: str = "full") -> str:
    """Атомарно переводит подразделение в состояние анализа и запускает фоновую задачу."""
    if mode not in MODES:
        raise HTTPException(status_code=400, detail="Неизвестный режим анализа")
    if mode != "full" and not await db.processes.count_documents({"division_id": division_id}):
        raise HTTPException(status_code=400, detail="Нет процессов для пересчёта — выполните полный анализ")
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
            "analysis_current_step": f"{MODES[mode]}: в очереди",
            "analysis_steps": {key: "pending" for key, _ in STEPS},
            "analysis_warnings": [],
            "analysis_error": None,
            "analysis_error_detail": None,
            "analysis_failed_step": None,
            "analysis_started_at": now,
            "analysis_started_by": user["user_id"],
            "analysis_updated_at": now,
            "analysis_mode": mode,
        }},
    )
    if claimed is None:
        raise HTTPException(status_code=409, detail="Анализ уже выполняется")
    await db.analysis_runs.insert_one({
        "id": run_id,
        "division_id": division_id,
        "mode": mode,
        "mode_title": MODES[mode],
        "status": "in_progress",
        "started_at": now,
        "started_by": user["user_id"],
        "started_by_name": user.get("name") or user.get("email"),
    })
    task = asyncio.create_task(run_analysis(division_id, run_id, mode))
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
            if division.get("analysis_run_id"):
                await db.analysis_runs.update_one(
                    {"id": division["analysis_run_id"], "status": "in_progress"},
                    {"$set": {"status": "error", "error": message, "finished_at": now_iso()}},
                )
            status = "error"
            division = {**division, "analysis_error": message}

    steps_state = division.get("analysis_steps") or {}
    return {
        "status": status,
        "mode": division.get("analysis_mode") or "full",
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
        "results_outdated": bool(division.get("results_outdated")),
    }
