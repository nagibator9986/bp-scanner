"""Исходные данные подразделения для промптов: анкета, документы (с конспектом длинных), база знаний."""
import asyncio
import hashlib
import logging
import math
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from .budget import DOCUMENTS_KEY, available_tokens, documents_text, split_available, truncate_text
from .config import settings
from .db import db, now_iso
from .documents import STORED_TEXT_LIMIT, extract_text_from_file
from .knowledge import get_knowledge_context
from .llm import CYRILLIC_CHARS_PER_TOKEN, ContextOverflowError, LLMClient, LLMError
from .prompts import get_active_prompt, render_prompt
from .questionnaire import format_answers_for_prompt

logger = logging.getLogger("bpscanner.context")

NO_DATA_RE = re.compile(r"^\W*нет данных\W*$", re.IGNORECASE)
ProgressCallback = Callable[[int, int], Awaitable[None]]


async def document_texts(division_id: str) -> list[tuple[str, str]]:
    documents = await db.documents.find({"division_id": division_id}, {"_id": 0}).sort("uploaded_at", 1).to_list(500)
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


def split_text(text: str, size: int) -> list[str]:
    """Делит текст на части до size символов, стараясь резать по абзацам."""
    if len(text) <= size:
        return [text]
    parts, current = [], []
    length = 0
    for paragraph in text.split("\n"):
        while len(paragraph) > size:  # очень длинный абзац режем жёстко
            if current:
                parts.append("\n".join(current))
                current, length = [], 0
            parts.append(paragraph[:size])
            paragraph = paragraph[size:]
        if length + len(paragraph) + 1 > size and current:
            parts.append("\n".join(current))
            current, length = [], 0
        current.append(paragraph)
        length += len(paragraph) + 1
    if current:
        parts.append("\n".join(current))
    return [part for part in parts if part.strip()]


async def _digest_chunk(client: LLMClient, prompt: dict, variables: dict) -> str:
    """Конспект фрагмента; результат кэшируется по содержимому фрагмента и тексту промпта."""
    key = hashlib.sha256(
        "\x00".join([prompt.get("system_prompt", ""), prompt["user_prompt_template"], variables["chunk"]]).encode()
    ).hexdigest()
    cached = await db.document_digests.find_one({"key": key}, {"_id": 0, "text": 1})
    if cached:
        return cached["text"]
    text = await client.complete(prompt.get("system_prompt", ""), render_prompt(prompt["user_prompt_template"], variables))
    text = text.strip()
    await db.document_digests.update_one(
        {"key": key}, {"$set": {"key": key, "text": text, "created_at": now_iso()}}, upsert=True
    )
    return text


def fair_shares(sizes: list[int], total: int) -> list[int]:
    """Делит total между элементами поровну; маленьким достаётся их размер, остаток — крупным."""
    shares = [0] * len(sizes)
    remaining = max(total, 0)
    pending = sorted(range(len(sizes)), key=lambda i: sizes[i])
    while pending:
        share = remaining // len(pending)
        index = pending.pop(0)
        shares[index] = min(sizes[index], share)
        remaining -= shares[index]
    return shares


def evenly_spaced(count: int, keep: int) -> list[int]:
    """Индексы keep частей из count, равномерно по документу (первая и последняя — всегда)."""
    if keep >= count:
        return list(range(count))
    if keep <= 1:
        return [0]
    return sorted({round(i * (count - 1) / (keep - 1)) for i in range(keep)})


async def digest_chunk_chars(client: LLMClient, prompt: dict) -> int:
    """Размер фрагмента для конспектирования: сколько текста помещается в окно модели вместе с промптом."""
    fixed = client.estimate(
        prompt.get("system_prompt", ""),
        render_prompt(prompt["user_prompt_template"], {"division_name": "x" * 80, "document_name": "x" * 120, "chunk_label": "часть 10 из 10", "chunk": ""}),
    )
    tokens = await client.input_budget() - fixed
    # Поправку к оценке токенов огрубляем и не даём ей уменьшать фрагмент: от размера фрагмента
    # зависят границы частей, а значит и кэш конспектов — он не должен сбрасываться от запуска к запуску
    ratio = max(1.0, math.ceil(client.token_ratio * 4) / 4)
    by_context = int(tokens * CYRILLIC_CHARS_PER_TOKEN / ratio * 0.95)
    return max(1000, min(settings.digest_chunk_chars, by_context // 500 * 500))


@dataclass
class DocumentPlan:
    """Как документы подразделения помещаются в окно модели."""
    documents: list[tuple[str, str]]
    sizes: list[int] = field(default_factory=list)  # токенов в каждом документе
    target: int = 0  # токенов доступно под документы
    context: int = 0  # окно модели
    context_source: str = ""
    to_digest: list[int] = field(default_factory=list)  # какие документы придётся конспектировать
    chunk_chars: int = 0
    chunks: dict[int, list[str]] = field(default_factory=dict)
    quotas: dict[int, int] = field(default_factory=dict)

    @property
    def fits(self) -> bool:
        return sum(self.sizes) <= self.target


async def plan_documents(
    division: dict, client: LLMClient, step: str = "extracting_processes", extra_variables: dict | None = None
) -> DocumentPlan:
    documents = [(name, text) for name, text in await document_texts(division["id"]) if text and text.strip()]
    plan = DocumentPlan(documents)
    plan.context, plan.context_source = await client.context_window()
    if not documents:
        return plan
    prompt = await get_active_prompt(step)
    variables = {**await base_variables(division, documents), **(extra_variables or {})}
    available = await available_tokens(client, prompt, variables)
    knowledge = variables.get("knowledge_context") or ""
    _, target = split_available(available, client.estimate(knowledge) if knowledge else 0, True)
    target -= client.estimate("=== Документ:  ===\n\n" * len(documents))
    plan.sizes = [client.estimate(text) for _, text in documents]
    total_chars = sum(len(text) for _, text in documents)
    if total_chars > settings.max_document_chars:
        target = min(target, int(sum(plan.sizes) * settings.max_document_chars / total_chars))
    plan.target = max(target, 0)
    if plan.fits:
        return plan
    shares = fair_shares(plan.sizes, plan.target)
    plan.to_digest = [i for i, size in enumerate(plan.sizes) if size > shares[i]]
    plan.chunk_chars = await digest_chunk_chars(client, await get_active_prompt("document_digest"))
    plan.chunks = {i: split_text(documents[i][1], plan.chunk_chars) for i in plan.to_digest}
    plan.quotas = dict(zip(plan.to_digest, fair_shares([len(plan.chunks[i]) for i in plan.to_digest], settings.max_digest_chunks)))
    return plan


async def prepare_documents(
    division: dict,
    client: LLMClient | None,
    on_progress: ProgressCallback | None = None,
    step: str = "extracting_processes",
    extra_variables: dict | None = None,
) -> tuple[list[tuple[str, str]], list[str], dict]:
    """Документы подразделения, умещённые в контекстное окно модели.

    Бюджет считается от окна модели минус остальная часть промпта этапа (анкета, база знаний,
    инструкции) и места под ответ. Документы, которые не помещаются, конспектируются по частям
    (map), а слишком длинные конспекты сжимаются повторно (reduce). Возвращает документы
    (исходные или конспекты), предупреждения и статистику для истории запусков.
    """
    if client is None:
        documents = [(name, text) for name, text in await document_texts(division["id"]) if text and text.strip()]
        return documents, [], {"documents": len(documents), "digested": 0, "chunks": 0}
    plan = await plan_documents(division, client, step, extra_variables)
    documents, target = plan.documents, plan.target
    stats = {"documents": len(documents), "digested": 0, "chunks": 0, "tokens": sum(plan.sizes), "budget": target, "context": plan.context}
    if plan.fits:
        return documents, [], stats

    # ---------- map: конспект документов, которые больше своей доли бюджета ----------
    to_digest, chunk_chars, doc_chunks, quotas = plan.to_digest, plan.chunk_chars, plan.chunks, plan.quotas
    digest_prompt = await get_active_prompt("document_digest")

    warnings: list[str] = []
    jobs: list[tuple[int, str, str]] = []
    for i in to_digest:
        chunks = doc_chunks[i]
        keep = evenly_spaced(len(chunks), max(quotas[i], 1))
        if len(keep) < len(chunks):
            warnings.append(
                f"Документ «{documents[i][0]}» очень большой: законспектировано {len(keep)} из {len(chunks)} частей, "
                "выбранных равномерно по тексту (лимит MAX_DIGEST_CHUNKS)"
            )
        jobs.extend((i, f"часть {k + 1} из {len(chunks)}", chunks[k]) for k in keep)

    done = 0
    total_jobs = len(jobs)

    async def summarize(name: str, label: str, chunk: str, depth: int = 0) -> str:
        try:
            return await _digest_chunk(client, digest_prompt, {
                "division_name": division.get("name", ""), "document_name": name, "chunk_label": label, "chunk": chunk,
            })
        except ContextOverflowError:
            # Оценка размера оказалась заниженной: окно уже уточнено по ответу сервера, делим фрагмент пополам
            if depth >= 2 or len(chunk) < 2000:
                raise
            halves = split_text(chunk, len(chunk) // 2 + 1)
            parts = [await summarize(name, f"{label}, фрагмент {k + 1} из {len(halves)}", half, depth + 1) for k, half in enumerate(halves)]
            return "\n".join(parts)

    async def digest(i: int, label: str, chunk: str) -> str:
        nonlocal done
        name = documents[i][0]
        try:
            result = await summarize(name, label, chunk)
        except LLMError as exc:
            logger.warning("Digest failed for %s (%s): %s", name, label, exc.message)
            result = truncate_text(chunk, 1500)  # без конспекта — начало фрагмента
        done += 1
        if on_progress:
            await on_progress(done, total_jobs)
        return "" if NO_DATA_RE.match(result) else result

    results = await asyncio.gather(*(digest(*job) for job in jobs))
    digests: dict[int, list[str]] = {i: [] for i in to_digest}
    for (i, _, _), result in zip(jobs, results):
        if result:
            digests[i].append(result)
    texts = {i: "\n".join(parts) or "Сведений о процессах в документе не найдено" for i, parts in digests.items()}

    # ---------- reduce: повторно сжимаем конспекты, которые всё ещё не помещаются ----------
    for round_number in range(3):
        current = [client.estimate(texts.get(i, documents[i][1])) for i in range(len(documents))]
        if sum(current) <= target:
            break
        shares = fair_shares(current, target)
        oversized = [i for i in to_digest if current[i] > shares[i]]
        if not oversized:
            break
        progress = False
        for i in oversized:
            parts = split_text(texts[i], chunk_chars)
            total_jobs += len(parts)
            reduced = await asyncio.gather(*(
                digest(i, f"сводный конспект, часть {k + 1} из {len(parts)}", part) for k, part in enumerate(parts)
            ))
            new_text = "\n".join(r for r in reduced if r)
            if new_text and client.estimate(new_text) < current[i] * 0.9:
                texts[i] = new_text
                progress = True
        logger.info("Digest reduce round %d: %s", round_number + 1, "compressed" if progress else "no progress")
        if not progress:
            break

    result = [(name, texts.get(i, text)) for i, (name, text) in enumerate(documents)]
    final_tokens = sum(client.estimate(text) for _, text in result)
    stats.update(digested=len(to_digest), chunks=total_jobs, tokens_after=final_tokens)
    if final_tokens > target:
        warnings.append("Конспект документов больше доступного контекста модели — в промпт попадёт его сокращённая версия")
    logger.info("Documents digested: %s", stats)
    return result, warnings, stats


def describe_division(division: dict) -> str:
    parts = [division.get("description") or ""]
    if division.get("head_name"):
        parts.append(f"Руководитель: {division['head_name']}")
    if division.get("employees_count"):
        parts.append(f"Сотрудников: {division['employees_count']}")
    return ". ".join(p for p in parts if p) or "не указано"


async def base_variables(division: dict, documents: list[tuple[str, str]] | None = None) -> dict:
    """Общие переменные промптов. Документы передаются списком: при подстановке в промпт
    они сокращаются под контекст модели (см. budget.fit_prompt)."""
    questionnaire = await db.questionnaires.find_one({"division_id": division["id"]}, {"_id": 0}) or {}
    return {
        "division_name": division.get("name", ""),
        "division_description": describe_division(division),
        "questionnaire": format_answers_for_prompt(questionnaire.get("answers")),
        "documents": documents_text(documents),
        DOCUMENTS_KEY: documents or [],
        "knowledge_context": await get_knowledge_context(division["id"]),
    }
