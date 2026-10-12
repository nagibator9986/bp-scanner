"""Подгонка промптов под контекстное окно модели.

Окно модели ограничено (например, 32k токенов у Qwen в vLLM) и делится между промптом и ответом.
Перед каждым запросом промпт этапа проверяется по оценке токенов; если он не помещается,
документы и материалы базы знаний сокращаются пропорционально, а для этапов со списком
процессов используются более компактные представления или пакеты.
"""
import logging
from dataclasses import dataclass, field

from .documents import build_documents_context
from .llm import ContextOverflowError, LLMClient
from .prompts import render_prompt

logger = logging.getLogger("bpscanner.budget")

DOCUMENTS_KEY = "_documents"  # документы подразделения списком [(название, текст)] для пересборки
NO_DOCUMENTS = "Документы не загружены"
TRUNCATION_NOTE = "\n[...сокращено, чтобы уместиться в контекст модели...]"
KNOWLEDGE_SHARE = 0.25  # доля свободного места под базу знаний, когда есть документы
MIN_FLEX_TOKENS = 200


@dataclass
class FitResult:
    text: str
    shortened: list[str] = field(default_factory=list)


def truncate_text(text: str, max_chars: int) -> str:
    """Обрезает текст по границе абзаца или предложения рядом с лимитом."""
    if len(text) <= max_chars:
        return text
    if max_chars <= 0:
        return ""
    cut = text[:max_chars]
    for separator in ("\n", ". "):
        position = cut.rfind(separator)
        if position > max_chars * 0.7:
            cut = cut[: position + 1]
            break
    return cut.rstrip() + TRUNCATION_NOTE


def chars_for_tokens(client: LLMClient, text: str, tokens: int) -> int:
    """Сколько символов этого текста помещается в заданное число токенов."""
    estimated = client.estimate(text)
    if estimated <= tokens:
        return len(text)
    return max(int(len(text) * tokens / max(estimated, 1)), 0)


def split_available(available: int, knowledge_tokens: int, has_documents: bool) -> tuple[int, int]:
    """Делит свободные токены между базой знаний и документами."""
    knowledge = min(knowledge_tokens, int(available * KNOWLEDGE_SHARE)) if has_documents else min(knowledge_tokens, available)
    return knowledge, available - knowledge


def documents_text(documents: list[tuple[str, str]] | None, client: LLMClient | None = None, tokens: int | None = None) -> str:
    """Текст документов для промпта; при заданном бюджете токенов длинные документы сокращаются поровну."""
    documents = [(name, text) for name, text in documents or [] if text and text.strip()]
    if not documents:
        return NO_DOCUMENTS
    total_chars = sum(len(text) for _, text in documents)
    if client is None or tokens is None:
        return build_documents_context(documents, total_chars)
    overhead = client.estimate("=== Документ:  ===\n\n" * len(documents))
    total_tokens = sum(client.estimate(text) for _, text in documents) or 1
    budget_chars = int(total_chars * max(tokens - overhead, 0) / total_tokens)
    return build_documents_context(documents, min(budget_chars, total_chars))


def _fixed_variables(variables: dict) -> dict:
    return {
        **variables,
        "documents": "" if variables.get(DOCUMENTS_KEY) else variables.get("documents", ""),
        "knowledge_context": "",
    }


async def available_tokens(client: LLMClient, prompt: dict, variables: dict) -> int:
    """Сколько токенов остаётся под документы и базу знаний в промпте этапа."""
    system = prompt.get("system_prompt", "")
    fixed = client.estimate(system, render_prompt(prompt["user_prompt_template"], _fixed_variables(variables)))
    return await client.input_budget() - fixed


async def fit_prompt(client: LLMClient, prompt: dict, variables: dict) -> FitResult:
    """Рендерит промпт этапа так, чтобы он поместился в окно модели.

    Сокращаются только документы и база знаний; если не помещается даже остальная часть
    (анкета, список процессов), выбрасывается ContextOverflowError.
    """
    system = prompt.get("system_prompt", "")
    template = prompt["user_prompt_template"]
    budget = await client.input_budget()
    text = render_prompt(template, variables)
    if client.estimate(system, text) <= budget:
        return FitResult(text)

    documents = variables.get(DOCUMENTS_KEY) or []
    knowledge = variables.get("knowledge_context") or ""
    available = await available_tokens(client, prompt, variables)
    if available < MIN_FLEX_TOKENS:
        raise ContextOverflowError(
            f"Промпт не помещается в контекст модели даже без документов: около {budget - available} токенов "
            f"при доступных {budget}. Увеличьте окно модели (max_model_len) или уменьшите LLM_MAX_TOKENS."
        )

    for _ in range(4):
        knowledge_tokens, document_tokens = split_available(available, client.estimate(knowledge) if knowledge else 0, bool(documents))
        shortened = []
        fitted_knowledge = knowledge
        if knowledge and client.estimate(knowledge) > knowledge_tokens:
            fitted_knowledge = truncate_text(knowledge, chars_for_tokens(client, knowledge, knowledge_tokens))
            shortened.append("база знаний")
        fitted_documents = variables.get("documents", "")
        if documents:
            # Неиспользованное место базы знаний отдаём документам
            document_tokens += knowledge_tokens - client.estimate(fitted_knowledge)
            fitted_documents = documents_text(documents, client, document_tokens)
            if "[...текст сокращён...]" in fitted_documents:
                shortened.append("документы")
        text = render_prompt(template, {**variables, "documents": fitted_documents, "knowledge_context": fitted_knowledge})
        if client.estimate(system, text) <= budget:
            if shortened:
                logger.info("Prompt shortened to fit context: %s", ", ".join(shortened))
            return FitResult(text, shortened)
        available = int(available * 0.85)
    raise ContextOverflowError("Не удалось уместить промпт в контекст модели")


async def fit_first(client: LLMClient, prompt: dict, variants: list[dict]) -> FitResult:
    """Первый вариант переменных, который удаётся уместить в окно (варианты — от подробного к компактному)."""
    for index, variables in enumerate(variants):
        try:
            return await fit_prompt(client, prompt, variables)
        except ContextOverflowError:
            if index == len(variants) - 1:
                raise
            logger.info("Prompt variant %d does not fit the context, trying a more compact one", index)
    raise ContextOverflowError("Нет вариантов промпта")


async def pack_batches(client: LLMClient, prompt: dict, variables: dict, items: list, render_items, max_size: int) -> list[list]:
    """Делит список (например, процессов) на пакеты так, чтобы промпт каждого пакета помещался в окно."""
    if not items:
        return []
    system = prompt.get("system_prompt", "")
    budget = await client.input_budget()
    knowledge = variables.get("knowledge_context") or ""
    fixed = client.estimate(system, render_prompt(prompt["user_prompt_template"], {**variables, "processes": "[]", "knowledge_context": ""}))
    room = budget - fixed - min(client.estimate(knowledge), int(budget * KNOWLEDGE_SHARE))
    batches, current, used = [], [], 0
    for item in items:
        size = client.estimate(render_items([item]))
        if current and (len(current) >= max_size or used + size > room):
            batches.append(current)
            current, used = [], 0
        current.append(item)
        used += size
    if current:
        batches.append(current)
    return batches
