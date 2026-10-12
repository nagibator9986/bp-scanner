"""Настройки подключения к LLM (глобальные, меняет администратор)."""
from fastapi import APIRouter, Depends

from ..db import db, now_iso
from ..llm import LLMConfig, LLMError, load_llm_config, normalize_provider, test_llm_connection
from ..schemas import LLMSettingsUpdate
from ..security import get_admin_user, get_current_user

router = APIRouter(tags=["settings"])


@router.get("/settings")
async def get_settings(user=Depends(get_current_user)):
    config = (await load_llm_config()).public()
    if not user["is_admin"]:
        # Обычным пользователям — только факт настройки и название модели
        return {k: config[k] for k in ("provider", "model_name", "configured")}
    return config


async def _merged_config(data: LLMSettingsUpdate) -> LLMConfig:
    current = await load_llm_config()
    if data.clear_api_key:
        api_key = ""
    else:
        api_key = data.api_key.strip() or current.api_key
    return LLMConfig(
        provider=normalize_provider(data.provider),
        model=data.model_name.strip(),
        api_key=api_key,
        base_url=data.endpoint_url.strip(),
        max_tokens=data.max_tokens or None,
        temperature=data.temperature,
        disable_thinking=data.disable_thinking,
        json_mode=data.json_mode,
        source="db",
    )


@router.post("/settings")
async def save_settings(data: LLMSettingsUpdate, admin=Depends(get_admin_user)):
    config = await _merged_config(data)
    await db.settings.update_one(
        {"scope": "global"},
        {"$set": {
            "scope": "global",
            "provider": config.provider,
            "model_name": config.model,
            "endpoint_url": config.base_url,
            "api_key": config.api_key,
            "max_tokens": config.max_tokens,
            "temperature": config.temperature,
            "disable_thinking": config.disable_thinking,
            "json_mode": config.json_mode,
            "updated_at": now_iso(),
            "updated_by": admin["user_id"],
        }},
        upsert=True,
    )
    return {"status": "saved", **config.public()}


@router.post("/settings/test")
async def test_settings(data: LLMSettingsUpdate, admin=Depends(get_admin_user)):
    """Проверка соединения с моделью с ещё не сохранёнными настройками."""
    try:
        return await test_llm_connection(await _merged_config(data))
    except LLMError as exc:
        return {"success": False, "error": exc.message, "detail": exc.detail}
