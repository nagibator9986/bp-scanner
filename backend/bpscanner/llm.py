"""Работа с LLM: настройки, вызовы и устойчивый разбор JSON-ответов.

Платформа работает с любой моделью через OpenAI-совместимый API (Chat Completions):
внутренние модели (Qwen и др.) за vLLM / Ollama / TGI / LiteLLM, а также OpenAI.
"""
import asyncio
import json
import logging
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
        return LLMError("Сервер модели отклонил запрос (возможно, превышен контекст модели)", detail)
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


class LLMClient:
    # Параметры, которые сервер отверг для данной модели — больше не отправляем
    _rejected: dict[str, set[str]] = {}

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
        try:
            async with _get_semaphore():
                response = await self._create(self._request_kwargs(system, user, json_mode))
        except Exception as exc:
            raise _describe_error(exc) from exc
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


async def test_llm_connection(config: LLMConfig) -> dict:
    client = LLMClient(config)
    reply = await client.complete("Ты — тестовый ассистент. Отвечай кратко.", "Ответь одним словом: OK")
    return {"success": True, "reply": reply.strip()[:200], "provider": config.provider, "model": config.model}
