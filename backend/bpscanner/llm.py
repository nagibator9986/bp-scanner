"""Работа с LLM: настройки, вызовы и устойчивый разбор JSON-ответов.

Платформа работает с любой моделью через OpenAI-совместимый API (Chat Completions):
внутренние модели (Qwen и др.) за vLLM / Ollama / TGI / LiteLLM, а также OpenAI.
"""
import asyncio
import json
import logging
import math
import re
from dataclasses import dataclass
from typing import Any

import openai

from .config import settings
from .db import db

logger = logging.getLogger("bpscanner.llm")

PROVIDERS = ("custom", "openai")
DEFAULT_MODELS = {"custom": "", "openai": "gpt-4o-mini"}


class LLMError(Exception):
    def __init__(self, message: str, detail: str | None = None):
        super().__init__(message)
        self.message = message
        self.detail = detail


class ContextOverflowError(LLMError):
    """Запрос не поместился в контекстное окно модели."""

    def __init__(self, message: str, detail: str | None = None,
                 context_tokens: int | None = None, prompt_tokens: int | None = None):
        super().__init__(message, detail)
        self.context_tokens = context_tokens
        self.prompt_tokens = prompt_tokens


# ============== Размер промпта в токенах ==============

_CYRILLIC_RE = re.compile(r"[\u0400-\u04FF]")
# Консервативная оценка для токенизаторов Qwen/Llama/GPT: кириллица дороже латиницы и JSON
CYRILLIC_CHARS_PER_TOKEN = 2.6
OTHER_CHARS_PER_TOKEN = 3.4


def estimate_tokens(text: str | None, ratio: float = 1.0) -> int:
    """Оценка числа токенов текста; ratio — поправка, выученная по ответам сервера."""
    if not text:
        return 0
    cyrillic = len(_CYRILLIC_RE.findall(text))
    other = len(text) - cyrillic
    return math.ceil((cyrillic / CYRILLIC_CHARS_PER_TOKEN + other / OTHER_CHARS_PER_TOKEN) * ratio)


_OVERFLOW_MARKERS = (
    "maximum context length", "context length", "context_length", "context window", "max_model_len",
    "contextwindowexceeded", "too many tokens", "prompt is too long", "input is too long",
    "reduce the length", "must be <=",
)
_CONTEXT_PATTERNS = (
    re.compile(r"maximum context length is (\d+)", re.I),
    re.compile(r"context length \((\d+) tokens?\)", re.I),
    re.compile(r"context (?:length|window) of (\d+)", re.I),
    re.compile(r"max_model_len[^\d]{0,20}(\d+)", re.I),
    re.compile(r"must be <= (\d+)", re.I),
)
_PROMPT_PATTERNS = (
    re.compile(r"\((\d+) in the messages", re.I),
    re.compile(r"request has (\d+) input tokens", re.I),
    re.compile(r"your request has (\d+) input", re.I),
    re.compile(r"messages resulted in (\d+) tokens", re.I),
    re.compile(r"input \((\d+) tokens?\)", re.I),
    re.compile(r"given: (\d+) `?inputs`? tokens", re.I),
    re.compile(r"prompt (?:has|contains|is) (\d+) tokens", re.I),
)


def parse_context_overflow(message: str) -> tuple[int | None, int | None] | None:
    """Распознаёт ошибку переполнения контекста (vLLM, SGLang, TGI, OpenAI, LiteLLM).

    Возвращает (окно модели, токенов во входе) — любое из значений может быть None —
    или None, если ошибка не про контекст.
    """
    lowered = (message or "").lower()
    if not any(marker in lowered for marker in _OVERFLOW_MARKERS):
        return None

    def first(patterns):
        for pattern in patterns:
            match = pattern.search(message)
            if match:
                return int(match.group(1))
        return None

    return first(_CONTEXT_PATTERNS), first(_PROMPT_PATTERNS)


@dataclass
class LLMConfig:
    provider: str
    model: str
    api_key: str = ""
    base_url: str = ""
    max_tokens: int | None = None
    temperature: float = 0.2
    disable_thinking: bool = False
    json_mode: bool = False
    context_tokens: int | None = None
    source: str = "db"

    @property
    def configured(self) -> bool:
        if self.provider == "openai":
            return bool(self.api_key and self.model)
        return bool(self.base_url and self.model)

    def public(self) -> dict:
        """Описание настроек без раскрытия ключа."""
        key = self.api_key or ""
        return {
            "provider": self.provider,
            "model_name": self.model,
            "endpoint_url": self.base_url,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
            "disable_thinking": self.disable_thinking,
            "json_mode": self.json_mode,
            "context_tokens": self.context_tokens,
            "api_key_set": bool(key),
            "api_key_display": f"{key[:4]}…{key[-4:]}" if len(key) > 12 else ("••••" if key else ""),
            "source": self.source,
            "configured": self.configured,
        }


def normalize_provider(value: str | None) -> str:
    value = (value or "").strip().lower()
    return "openai" if value in ("openai", "emergent") else "custom"


async def _load_stored_settings() -> dict | None:
    stored = await db.settings.find_one({"scope": "global"}, {"_id": 0})
    if stored:
        return stored
    # Совместимость: раньше настройки хранились у конкретного администратора
    admins = await db.users.find(
        {"$or": [{"is_admin": True}, {"role": "admin"}]}, {"_id": 0, "id": 1}
    ).to_list(50)
    for admin in admins:
        legacy = await db.settings.find_one({"user_id": admin["id"]}, {"_id": 0})
        if legacy:
            return legacy
    return None


def _optional_int(value) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


async def load_llm_config() -> LLMConfig:
    stored = await _load_stored_settings()
    if stored and (stored.get("model_name") or stored.get("endpoint_url") or stored.get("api_key")):
        source = "db"
    else:
        stored, source = {}, "env"

    provider = normalize_provider(stored.get("provider") or settings.llm_provider)
    base_url = (stored.get("endpoint_url") or "").strip() or settings.llm_base_url
    if provider == "openai" and not stored.get("endpoint_url"):
        base_url = ""  # официальный endpoint OpenAI по умолчанию
    temperature = stored.get("temperature")
    return LLMConfig(
        provider=provider,
        model=(stored.get("model_name") or "").strip() or settings.llm_model or DEFAULT_MODELS[provider],
        api_key=(stored.get("api_key") or "").strip() or settings.llm_api_key,
        base_url=base_url,
        max_tokens=_optional_int(stored.get("max_tokens")) or settings.llm_max_tokens,
        temperature=float(temperature) if isinstance(temperature, (int, float)) else settings.llm_temperature,
        disable_thinking=bool(stored.get("disable_thinking", settings.llm_disable_thinking)),
        json_mode=bool(stored.get("json_mode", settings.llm_json_mode)),
        context_tokens=_optional_int(stored.get("context_tokens")),
        source=source,
    )


def _describe_error(exc: Exception) -> LLMError:
    if isinstance(exc, LLMError):
        return exc
    detail = str(exc)[:1500]
    if isinstance(exc, openai.AuthenticationError):
        return LLMError("Модель отклонила API-ключ: проверьте настройки AI", detail)
    if isinstance(exc, openai.NotFoundError):
        return LLMError("Модель или endpoint не найдены: проверьте название модели и URL", detail)
    if isinstance(exc, openai.RateLimitError):
        return LLMError("Сервер модели перегружен или исчерпан лимит запросов", detail)
    if isinstance(exc, openai.APITimeoutError):
        return LLMError(f"Модель не ответила за {settings.ai_step_timeout} сек", detail)
    if isinstance(exc, openai.APIConnectionError):
        return LLMError("Нет соединения с сервером модели: проверьте endpoint URL и сеть", detail)
    if isinstance(exc, openai.BadRequestError):
        return LLMError("Сервер модели отклонил запрос", detail)
    if isinstance(exc, openai.APIStatusError):
        return LLMError(f"Ошибка сервера модели (HTTP {getattr(exc, 'status_code', '?')})", detail)
    return LLMError(f"Ошибка вызова AI: {exc.__class__.__name__}", detail)


_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def strip_reasoning(content: str) -> str:
    """Убирает блоки рассуждений (<think>…</think>), которые отдают Qwen3/DeepSeek-R1."""
    content = _THINK_RE.sub("", content)
    # Сервер мог обрезать открывающий тег (reasoning-parser) — оставляем текст после </think>
    if "</think>" in content:
        content = content.split("</think>")[-1]
    return content.strip()


_semaphores: dict[int, asyncio.Semaphore] = {}


def _get_semaphore() -> asyncio.Semaphore:
    """Ограничение числа одновременных запросов к модели (свой семафор на event loop)."""
    loop_id = id(asyncio.get_running_loop())
    if loop_id not in _semaphores:
        _semaphores.clear()
        _semaphores[loop_id] = asyncio.Semaphore(max(settings.llm_max_concurrency, 1))
    return _semaphores[loop_id]


MIN_OUTPUT_TOKENS = 512
SAFETY_TOKENS = 256


class LLMClient:
    # Параметры, которые сервер отверг для данной модели — больше не отправляем
    _rejected: dict[str, set[str]] = {}
    # Окно модели, сообщённое сервером (/v1/models или текст ошибки), и поправка к оценке токенов
    _detected_context: dict[str, int | None] = {}
    _learned_context: dict[str, int] = {}
    _token_ratio: dict[str, float] = {}

    def __init__(self, config: LLMConfig):
        self.config = config
        if not config.configured:
            raise LLMError(
                "AI-модель не настроена: администратор должен указать endpoint и модель в настройках AI "
                "(или задать переменные окружения LLM_BASE_URL и LLM_MODEL)"
            )
        self._client = openai.AsyncOpenAI(
            api_key=config.api_key or "not-needed",
            base_url=config.base_url or None,
            timeout=settings.ai_step_timeout,
            max_retries=max(settings.ai_max_attempts - 1, 0),
        )

    @property
    def _key(self) -> str:
        return f"{self.config.base_url}|{self.config.model}"

    @classmethod
    def forget(cls) -> None:
        """Сбрасывает сведения об окне модели и поправку к оценке токенов."""
        cls._detected_context.clear()
        cls._learned_context.clear()
        cls._token_ratio.clear()

    # ---------- Контекстное окно ----------

    async def _detect_context(self) -> int | None:
        """Окно модели из /v1/models (vLLM отдаёт max_model_len); результат кэшируется."""
        if self._key in self._detected_context:
            return self._detected_context[self._key]
        value = None
        try:
            page = await self._client.with_options(timeout=10, max_retries=0).models.list()
            for model in page.data:
                extra = getattr(model, "model_extra", None) or {}
                if model.id == self.config.model or len(page.data) == 1:
                    raw = extra.get("max_model_len") or extra.get("context_length") or extra.get("max_context_length")
                    value = int(raw) if raw else None
                    if model.id == self.config.model:
                        break
        except Exception as exc:  # noqa: BLE001 — сервер может не поддерживать /models
            logger.info("Context window detection failed for %s: %s", self.config.model, exc.__class__.__name__)
        self._detected_context[self._key] = value
        return value

    async def context_window(self) -> tuple[int, str]:
        """Окно модели и его источник. Берётся наименьшее из известных значений."""
        candidates = []
        if self.config.context_tokens:
            candidates.append((self.config.context_tokens, "настройки администратора"))
        detected = await self._detect_context()
        if detected:
            candidates.append((detected, "сервер модели"))
        if self._key in self._learned_context:
            candidates.append((self._learned_context[self._key], "ошибка сервера"))
        if not candidates:
            return settings.llm_context_tokens, "значение по умолчанию"
        return min(candidates)

    def output_reserve(self, window: int) -> int:
        reserve = self.config.max_tokens or settings.llm_output_reserve
        return max(MIN_OUTPUT_TOKENS, min(reserve, window // 2))

    async def input_budget(self) -> int:
        """Сколько токенов можно отдать под промпт (system + user) с запасом на ответ."""
        window, _ = await self.context_window()
        return max(window - self.output_reserve(window) - SAFETY_TOKENS, 256)

    @property
    def token_ratio(self) -> float:
        return self._token_ratio.get(self._key, 1.0)

    def estimate(self, *texts: str) -> int:
        return sum(estimate_tokens(text, self.token_ratio) for text in texts) + 8 * len(texts)

    def _calibrate(self, estimated: int, actual: int | None, pessimistic: bool = False) -> None:
        """Уточняет поправку к оценке токенов по фактическому числу токенов, которое сообщил сервер."""
        if not actual or estimated < 500:
            return
        base = estimated / self.token_ratio  # оценка без поправки
        observed = min(max(actual / base, 0.6), 1.8)
        current = self.token_ratio
        self._token_ratio[self._key] = max(current, observed) if pessimistic else round(0.7 * current + 0.3 * observed, 3)

    def _overflow(self, exc: Exception, estimated: int) -> ContextOverflowError | None:
        parsed = parse_context_overflow(str(exc))
        if parsed is None:
            return None
        context, prompt_tokens = parsed
        if context:
            self._learned_context[self._key] = context
        self._calibrate(estimated, prompt_tokens, pessimistic=True)
        if context and prompt_tokens:
            message = f"Запрос не поместился в контекст модели: {prompt_tokens} токенов при окне {context}"
        else:
            message = "Запрос не поместился в контекстное окно модели"
        return ContextOverflowError(message, str(exc)[:1500], context, prompt_tokens)

    def _request_kwargs(self, system: str, user: str, json_mode: bool) -> dict[str, Any]:
        rejected = self._rejected.get(self.config.model, set())
        kwargs: dict[str, Any] = {
            "model": self.config.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }
        if "temperature" not in rejected:
            kwargs["temperature"] = self.config.temperature
        if self.config.max_tokens and "max_tokens" not in rejected:
            kwargs["max_tokens"] = self.config.max_tokens
        if json_mode and "response_format" not in rejected:
            kwargs["response_format"] = {"type": "json_object"}
        if self.config.disable_thinking and "chat_template_kwargs" not in rejected:
            # vLLM / SGLang: отключает режим рассуждений Qwen3 — ответы быстрее и короче
            kwargs["extra_body"] = {"chat_template_kwargs": {"enable_thinking": False}}
        return kwargs

    async def _create(self, kwargs: dict[str, Any]):
        try:
            return await self._client.chat.completions.create(**kwargs)
        except openai.BadRequestError as exc:
            if parse_context_overflow(str(exc)) is not None:
                raise  # переполнение контекста — не повод отключать параметры
            message = str(exc).lower()
            for param in ("temperature", "max_tokens", "response_format", "chat_template_kwargs"):
                key = "extra_body" if param == "chat_template_kwargs" else param
                if param in message and key in kwargs:
                    logger.warning("Model %s rejected parameter %s, retrying without it", self.config.model, param)
                    self._rejected.setdefault(self.config.model, set()).add(param)
                    retry = {k: v for k, v in kwargs.items() if k != key}
                    return await self._create(retry)
            raise

    async def complete(self, system: str, user: str, json_mode: bool = False) -> str:
        kwargs = self._request_kwargs(system, user, json_mode)
        estimated = self.estimate(system, user)
        try:
            async with _get_semaphore():
                try:
                    response = await self._create(kwargs)
                except openai.APIStatusError as exc:
                    overflow = self._overflow(exc, estimated)
                    if overflow is None:
                        raise
                    room = (overflow.context_tokens or 0) - (overflow.prompt_tokens or 0) - 64
                    if not (overflow.context_tokens and overflow.prompt_tokens) or room < MIN_OUTPUT_TOKENS:
                        raise overflow from exc
                    # Вход помещается, не хватает места под ответ — уменьшаем max_tokens
                    logger.warning("Context overflow (%s/%s tokens), retrying with max_tokens=%s",
                                   overflow.prompt_tokens, overflow.context_tokens, room)
                    response = await self._create({**kwargs, "max_tokens": room})
        except LLMError:
            raise
        except Exception as exc:
            overflow = self._overflow(exc, estimated) if isinstance(exc, openai.APIStatusError) else None
            raise (overflow or _describe_error(exc)) from exc
        usage = getattr(response, "usage", None)
        self._calibrate(estimated, getattr(usage, "prompt_tokens", None))
        if not response.choices:
            raise LLMError("Модель вернула пустой ответ")
        choice = response.choices[0]
        content = strip_reasoning(choice.message.content or "")
        if not content:
            raise LLMError("Модель вернула пустой ответ", f"finish_reason={choice.finish_reason}")
        if choice.finish_reason == "length":
            logger.warning("LLM response truncated by max tokens (model=%s)", self.config.model)
        return content


# ============== Разбор JSON из ответа модели ==============

_FENCE_RE = re.compile(r"```(?:json|JSON)?\s*(.*?)```", re.DOTALL)
_TRAILING_COMMA_RE = re.compile(r",\s*([\]}])")
_LIST_KEYS = ("items", "processes", "recommendations", "scoring", "scores", "workflows", "tobe", "models", "data", "results")


def _try_load(candidate: str) -> Any:
    candidate = candidate.strip()
    if not candidate:
        return None
    variants = (candidate, _TRAILING_COMMA_RE.sub(r"\1", candidate))
    for text in variants:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
    # Ответ с текстом до/после JSON — декодируем с первой открывающей скобки
    # (сначала самая ранняя скобка, в исходном и исправленном вариантах)
    openers = sorted((c for c in "[{" if c in candidate), key=candidate.find)
    for opener in openers:
        for text in variants:
            try:
                value, _ = json.JSONDecoder().raw_decode(text[text.find(opener):])
                return value
            except json.JSONDecodeError:
                continue
        if opener == "[":
            # Массив не разобрался — возможно, ответ обрезан по лимиту токенов
            salvaged = _salvage_truncated_array(candidate)
            if salvaged is not None:
                return salvaged
    return None


def _salvage_truncated_array(text: str) -> Any:
    """Восстанавливает массив, обрезанный по лимиту токенов: берёт все целые элементы."""
    start = text.find("[")
    if start == -1:
        return None
    depth = 0
    in_string = escaped = False
    last_complete = -1
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char in "[{":
            depth += 1
        elif char in "]}":
            depth -= 1
            if depth == 1 and char == "}":
                last_complete = index
            if depth == 0:
                return None  # массив закрыт — значит, проблема не в обрезке
    if last_complete == -1:
        return None
    try:
        return json.loads(text[start:last_complete + 1] + "]")
    except json.JSONDecodeError:
        return None


def extract_json(text: str | None) -> Any:
    if not text:
        return None
    text = strip_reasoning(text)
    for block in _FENCE_RE.findall(text):
        value = _try_load(block)
        if value is not None:
            return value
    value = _try_load(text)
    if value is not None:
        return value
    return _salvage_truncated_array(text)


def as_item_list(data: Any) -> list[dict]:
    """Приводит ответ к списку объектов: массив, {"items": [...]} или одиночный объект."""
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        for key in _LIST_KEYS:
            if isinstance(data.get(key), list):
                return as_item_list(data[key])
        lists = [v for v in data.values() if isinstance(v, list) and v and all(isinstance(i, dict) for i in v)]
        if len(lists) == 1:
            return lists[0]
        if data:
            return [data]
    return []


async def complete_json_list(client: LLMClient, system: str, user: str) -> tuple[list[dict], str]:
    """Запрашивает JSON-массив; при невалидном ответе делает один повтор с просьбой исправить формат."""
    json_mode = client.config.json_mode
    if json_mode:
        # json_object требует объект верхнего уровня — просим обернуть массив
        user = f'{user}\n\nВерни объект вида {{"items": [...]}}, где items — требуемый массив.'
    raw = await client.complete(system, user, json_mode=json_mode)
    items = as_item_list(extract_json(raw))
    if items:
        return items, raw
    logger.warning("LLM returned unparsable JSON, retrying with a format reminder")
    retry_prompt = (
        f"{user}\n\nВАЖНО: предыдущий ответ не удалось разобрать. Верни только валидный JSON "
        "в указанном формате — без пояснений, комментариев и markdown."
    )
    raw_retry = await client.complete(system, retry_prompt, json_mode=json_mode)
    items = as_item_list(extract_json(raw_retry))
    if items:
        return items, raw_retry
    raise LLMError("Модель вернула ответ в неверном формате (ожидался JSON-массив)", raw_retry[:1500])


async def complete_json_object(client: LLMClient, system: str, user: str) -> dict:
    """Запрашивает JSON-объект; при невалидном ответе делает один повтор с просьбой исправить формат."""
    for attempt in range(2):
        prompt = user if attempt == 0 else (
            f"{user}\n\nВАЖНО: предыдущий ответ не удалось разобрать. Верни только валидный JSON-объект — без пояснений и markdown."
        )
        raw = await client.complete(system, prompt, json_mode=client.config.json_mode)
        data = extract_json(raw)
        if isinstance(data, list):
            data = next((item for item in data if isinstance(item, dict)), None)
        if isinstance(data, dict) and data:
            return data
    raise LLMError("Модель вернула ответ в неверном формате (ожидался JSON-объект)", (raw or "")[:1500])


async def test_llm_connection(config: LLMConfig) -> dict:
    client = LLMClient(config)
    reply = await client.complete("Ты — тестовый ассистент. Отвечай кратко.", "Ответь одним словом: OK")
    window, source = await client.context_window()
    return {
        "success": True, "reply": reply.strip()[:200], "provider": config.provider, "model": config.model,
        "context_tokens": window, "context_source": source, "input_budget": await client.input_budget(),
    }
