"""Контекстное окно модели: оценка токенов, подгонка промптов, конспект документов, ошибки переполнения."""
import asyncio

import pytest

from bpscanner.context import evenly_spaced, fair_shares
from bpscanner.llm import ContextOverflowError, LLMClient, LLMConfig, estimate_tokens, parse_context_overflow
from bpscanner.pipeline import processes_for_prompt
from tests.conftest import auth, wait_for_analysis

WINDOW = 8192


def _document(index: int, chars: int) -> bytes:
    lines, n = [], 0
    while sum(len(line) + 1 for line in lines) < chars:
        n += 1
        lines.append(
            f"Раздел {index}.{n}. Специалист отдела проверяет заявку клиента №{index * 1000 + n}, вносит данные в АБИС "
            f"и передаёт пакет документов на согласование руководителю; срок обработки — {n % 5 + 1} рабочих дня."
        )
    return "\n".join(lines).encode()


def _division_with_documents(client, token, count: int, chars: int) -> str:
    division_id = client.post("/api/divisions", json={"name": "Отдел кредитования МСБ"}, headers=auth(token)).json()["id"]
    client.post(f"/api/divisions/{division_id}/questionnaire",
                json={"answers": {"dept_function": "Кредитование МСБ", "top_processes": "Приём заявок"}}, headers=auth(token))
    for index in range(count):
        files = {"file": (f"регламент_{index}.txt", _document(index, chars), "text/plain")}
        assert client.post(f"/api/divisions/{division_id}/documents", files=files, headers=auth(token)).status_code == 200
    return division_id


# ---------- Юнит-тесты ----------

@pytest.mark.parametrize("message, expected", [
    ("This model's maximum context length is 32768 tokens. However, you requested 40000 tokens "
     "(36000 in the messages, 4000 in the completion). Please reduce the length of the messages or completion.", (32768, 36000)),
    ("'max_tokens' or 'max_completion_tokens' is too large: 8192. This model's maximum context length is 32768 tokens "
     "and your request has 30000 input tokens (8192 > 32768 - 30000).", (32768, 30000)),
    ("This model's maximum context length is 128000 tokens. However, your messages resulted in 130512 tokens.", (128000, 130512)),
    ("The input (9000 tokens) is longer than the model's context length (8192 tokens).", (8192, 9000)),
    ("Input validation error: `inputs` tokens + `max_new_tokens` must be <= 4096. Given: 3900 `inputs` tokens "
     "and 1024 `max_new_tokens`", (4096, 3900)),
    ("litellm.ContextWindowExceededError: prompt is too long", (None, None)),
])
def test_parse_context_overflow(message, expected):
    assert parse_context_overflow(message) == expected


def test_parse_context_overflow_ignores_other_errors():
    assert parse_context_overflow("Unsupported parameter: 'temperature'") is None
    assert parse_context_overflow("response_format is not supported by this model") is None


def test_estimate_tokens_is_conservative_for_cyrillic():
    russian, english = "Заявка регистрируется в АБИС " * 100, "Request is registered in CRM " * 100
    assert estimate_tokens(russian) > estimate_tokens(english)
    assert estimate_tokens(russian) >= len(russian) / 3  # не меньше, чем реально тратит токенизатор Qwen
    assert estimate_tokens("") == 0


def test_fair_shares_and_even_sampling():
    assert fair_shares([100, 5000, 10000], 3000) == [100, 1450, 1450]
    assert sum(fair_shares([10, 20], 1000)) == 30
    assert evenly_spaced(10, 4) == [0, 3, 6, 9]
    assert evenly_spaced(3, 10) == [0, 1, 2]
    assert evenly_spaced(5, 1) == [0]


def test_processes_for_prompt_detail_levels():
    process = {
        "name": "Приём заявок", "description": "Описание " * 100, "frequency": "Ежедневно", "pain_points": ["a", "b", "c", "d"],
        "roles": ["Менеджер"], "systems": ["АБИС"],
        "steps_detail": [{"name": f"Шаг {i}", "role": "Менеджер", "system": "АБИС", "type": "task", "manual": True, "duration_min": 5} for i in range(12)],
    }
    full, compact, brief = (processes_for_prompt([process] * 10, detail) for detail in ("full", "compact", "brief"))
    assert len(brief) < len(compact) < len(full)
    assert '"steps_count": 12' in brief


def test_max_tokens_is_reduced_when_only_completion_does_not_fit(fake_llm, client):
    fake_llm.context_limit, fake_llm.report_context = WINDOW, False
    config = LLMConfig(provider="custom", model="qwen-test", base_url=fake_llm.url, max_tokens=6000)

    async def run():
        llm = LLMClient(config)
        return await llm.complete("Система", "а" * 9000), await llm.context_window()

    reply, (window, source) = asyncio.run(run())
    assert reply == "[]"
    assert len(fake_llm.rejected) == 1
    prompt_tokens = fake_llm.count_tokens("Система") + fake_llm.count_tokens("а" * 9000)
    assert fake_llm.requests[-1]["max_tokens"] == WINDOW - prompt_tokens - 64
    assert (window, source) == (WINDOW, "ошибка сервера")


def test_prompt_larger_than_window_raises_clear_error(fake_llm, client):
    fake_llm.context_limit, fake_llm.report_context = WINDOW, False

    async def run():
        await LLMClient(LLMConfig(provider="custom", model="qwen-test", base_url=fake_llm.url)).complete("", "а" * 40000)

    with pytest.raises(ContextOverflowError) as info:
        asyncio.run(run())
    assert info.value.context_tokens == WINDOW and "не поместился в контекст" in info.value.message


# ---------- Интеграционные ----------

def test_many_large_documents_fit_small_window(client, admin_token, configure_llm, fake_llm):
    """10 больших документов при окне 8k: документы конспектируются, ни один запрос не превышает окно."""
    configure_llm()
    fake_llm.context_limit = WINDOW  # vLLM сообщает max_model_len в /v1/models
    division_id = _division_with_documents(client, admin_token, count=10, chars=15000)

    budget = client.get(f"/api/divisions/{division_id}/documents/budget", headers=auth(admin_token)).json()
    assert budget["context_tokens"] == WINDOW and budget["context_source"] == "сервер модели"
    assert budget["fits"] is False and budget["digest_documents"] == 10 and budget["digest_chunks"] >= 10

    assert client.post(f"/api/divisions/{division_id}/analyze", headers=auth(admin_token)).status_code == 200
    status = wait_for_analysis(client, admin_token, division_id, timeout=60)
    assert status["status"] == "completed", status
    assert fake_llm.rejected == []

    prompts = fake_llm.user_prompts()
    assert sum("Фрагмент документа" in p for p in prompts) >= 10
    extraction = next(p for p in prompts if "Выяви ключевые бизнес-процессы" in p)
    # Все 10 документов попали в промпт (в виде конспектов), ни один не потерян
    assert all(f"=== Документ: регламент_{i}.txt ===" in extraction for i in range(10))
    assert "из конспекта документа" in extraction

    run = client.get(f"/api/divisions/{division_id}/runs", headers=auth(admin_token)).json()[0]
    assert run["context_tokens"] == WINDOW
    assert run["documents_stats"]["digested"] == 10 and run["documents_stats"]["chunks"] >= 10

    # Повторный анализ берёт конспекты из кэша — новых запросов на конспектирование нет
    fake_llm.requests.clear()
    client.post(f"/api/divisions/{division_id}/analyze", headers=auth(admin_token))
    assert wait_for_analysis(client, admin_token, division_id, timeout=60)["status"] == "completed"
    assert not any("Фрагмент документа" in p for p in fake_llm.user_prompts())


def test_long_digests_are_compressed_again(client, admin_token, configure_llm, fake_llm):
    """Конспекты сами не помещаются в окно — они сжимаются повторно (reduce), а не обрезаются."""
    configure_llm()
    fake_llm.context_limit = WINDOW
    fake_llm.digest_reply = lambda user: (
        "- Сводно: заявки МСБ дублируются в АБИС вручную" if "сводный конспект" in user
        else "\n".join(f"- Факт {i}: заявка проверяется вручную и передаётся на согласование" for i in range(60))
    )
    division_id = _division_with_documents(client, admin_token, count=6, chars=15000)
    client.post(f"/api/divisions/{division_id}/analyze", headers=auth(admin_token))
    status = wait_for_analysis(client, admin_token, division_id, timeout=60)
    assert status["status"] == "completed", status
    assert fake_llm.rejected == []
    prompts = fake_llm.user_prompts()
    assert any("сводный конспект" in p for p in prompts)
    extraction = next(p for p in prompts if "Выяви ключевые бизнес-процессы" in p)
    assert "Сводно: заявки МСБ" in extraction and "сокращено" not in extraction
    assert not any("сокращен" in w for w in status.get("warnings", []))


def test_window_learned_from_server_error(client, admin_token, configure_llm, fake_llm):
    """Сервер не сообщает окно: после ошибки переполнения документы готовятся заново под реальное окно."""
    configure_llm()
    fake_llm.context_limit, fake_llm.report_context = WINDOW, False
    division_id = _division_with_documents(client, admin_token, count=3, chars=15000)

    client.post(f"/api/divisions/{division_id}/analyze", headers=auth(admin_token))
    status = wait_for_analysis(client, admin_token, division_id, timeout=60)
    assert status["status"] == "completed", status
    assert len(fake_llm.rejected) == 1  # только первая попытка извлечения процессов
    assert any("Фрагмент документа" in p for p in fake_llm.user_prompts())
    run = client.get(f"/api/divisions/{division_id}/runs", headers=auth(admin_token)).json()[0]
    assert run["context_tokens"] == WINDOW and run["context_source"] == "ошибка сервера"


def test_admin_context_setting_limits_window(client, admin_token, configure_llm, fake_llm):
    configure_llm(context_tokens=6000)
    fake_llm.context_limit = WINDOW
    division_id = _division_with_documents(client, admin_token, count=1, chars=1000)
    budget = client.get(f"/api/divisions/{division_id}/documents/budget", headers=auth(admin_token)).json()
    assert budget["context_tokens"] == 6000 and budget["context_source"] == "настройки администратора"
    assert budget["fits"] is True and budget["digest_chunks"] == 0
    test = client.post("/api/settings/test", json={"provider": "custom", "endpoint_url": fake_llm.url, "model_name": "qwen-test"},
                       headers=auth(admin_token)).json()
    assert test["success"] and test["context_tokens"] == WINDOW  # без ограничения администратора — окно сервера


def test_questionnaire_prefill_with_small_window(client, admin_token, configure_llm, fake_llm):
    configure_llm()
    fake_llm.context_limit = WINDOW
    division_id = _division_with_documents(client, admin_token, count=10, chars=15000)
    response = client.post(f"/api/divisions/{division_id}/questionnaire/suggest", headers=auth(admin_token))
    assert response.status_code == 200, response.text
    assert response.json()["count"] > 0
    assert fake_llm.rejected == []
