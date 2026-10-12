import io
import json
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timedelta, timezone

from bpscanner import db as db_module
from tests.conftest import auth, wait_for_analysis

BPMN_NS = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"


def _prepare_division(client, token, name="Операционный отдел"):
    division_id = client.post("/api/divisions", json={"name": name, "head_name": "Иванов"}, headers=auth(token)).json()["id"]
    answers = {"dept_function": "Обслуживание клиентов", "top_processes": "Приём заявок, отчётность", "has_approvals": True}
    client.post(f"/api/divisions/{division_id}/questionnaire", json={"answers": answers}, headers=auth(token))
    files = {"file": ("регламент.txt", "Заявки регистрируются вручную в АБИС".encode(), "text/plain")}
    client.post(f"/api/divisions/{division_id}/documents", files=files, headers=auth(token))
    return division_id


def test_settings_roundtrip_and_connection_test(client, admin_token, user_token, configure_llm, fake_llm):
    saved = configure_llm(api_key="sk-internal-secret-key", max_tokens=8000, disable_thinking=True)
    assert saved["configured"] and saved["api_key_set"]
    assert "sk-internal-secret-key" not in json.dumps(saved)

    settings = client.get("/api/settings", headers=auth(admin_token)).json()
    assert settings["model_name"] == "qwen-test" and settings["max_tokens"] == 8000
    assert "api_key" not in settings
    # Пустой ключ при сохранении сохраняет прежний
    configure_llm(api_key="")
    assert client.get("/api/settings", headers=auth(admin_token)).json()["api_key_set"] is True

    user_view = client.get("/api/settings", headers=auth(user_token)).json()
    assert set(user_view) == {"provider", "model_name", "configured"}

    result = client.post("/api/settings/test", json={"provider": "custom", "endpoint_url": fake_llm.url, "model_name": "qwen-test", "disable_thinking": True}, headers=auth(admin_token)).json()
    assert result["success"] and result["reply"] == "OK"
    request = fake_llm.requests[-1]
    assert request["chat_template_kwargs"] == {"enable_thinking": False}
    assert request["model"] == "qwen-test"

    broken = client.post("/api/settings/test", json={"provider": "custom", "endpoint_url": "http://127.0.0.1:9/v1", "model_name": "x"}, headers=auth(admin_token)).json()
    assert broken["success"] is False and broken["error"]


def test_full_analysis_pipeline(client, admin_token, user_token, configure_llm, fake_llm):
    configure_llm()
    division_id = _prepare_division(client, user_token)

    response = client.post(f"/api/divisions/{division_id}/analyze", headers=auth(user_token))
    assert response.status_code == 200
    status = wait_for_analysis(client, user_token, division_id)
    assert status["status"] == "completed", status
    assert status["progress"] == 100 and status["warnings"] == []
    assert {s["key"]: s["state"] for s in status["steps"]}["generating_n8n"] == "done"

    prompts = fake_llm.user_prompts()
    assert any("Заявки регистрируются вручную" in p for p in prompts), "документы должны попасть в промпт"
    assert any("Обслуживание клиентов" in p for p in prompts), "анкета должна попасть в промпт"

    processes = client.get(f"/api/divisions/{division_id}/processes", headers=auth(user_token)).json()
    assert [p["name"] for p in processes] == ["Приём и регистрация заявок", "Подготовка отчётности"]
    assert processes[0]["metrics"]["decisions_count"] == 1
    assert processes[1]["steps"] == ["Выгрузить данные", "Свести в Excel", "Отправить руководителю"]

    bpmn = client.get(f"/api/divisions/{division_id}/bpmn", headers=auth(user_token)).json()
    as_is = [m for m in bpmn if m["type"] == "as_is"]
    to_be = [m for m in bpmn if m["type"] == "to_be"]
    assert len(as_is) == 2 and len(to_be) == 1
    root = ET.fromstring(as_is[0]["xml"].encode())
    lanes = root.findall(f".//{BPMN_NS}lane")
    assert [lane.get("name") for lane in lanes] == ["Операционист", "Контролёр"]
    assert root.find(f".//{BPMN_NS}exclusiveGateway") is not None
    assert root.find(f".//{BPMN_NS}serviceTask") is None
    tobe_root = ET.fromstring(to_be[0]["xml"].encode())
    assert tobe_root.find(f".//{BPMN_NS}serviceTask").get("name") == "Перенести данные в АБИС"

    download = client.get(f"/api/divisions/{division_id}/bpmn/{as_is[0]['id']}/download", headers=auth(user_token))
    assert download.status_code == 200 and download.text.startswith("<?xml")

    scoring = client.get(f"/api/divisions/{division_id}/scoring", headers=auth(user_token)).json()
    assert len(scoring) == 2
    report = next(s for s in scoring if s["process_name"] == "Подготовка отчётности")
    assert report["manual_effort"] == 10 and report["bottlenecks"] == ["Ручное сведение", "Ошибки"]
    assert all(0 <= s["automation_potential"] <= 100 and s["process_id"] for s in scoring)

    recommendations = client.get(f"/api/divisions/{division_id}/recommendations", headers=auth(user_token)).json()
    assert [r["category"] for r in recommendations] == ["simple_automation", "classic_digitization", "ai_reengineering"]
    assert recommendations[0]["estimated_fte_savings"] == 1.5
    assert recommendations[1]["complexity"] == "medium"

    tobe = client.get(f"/api/divisions/{division_id}/tobe", headers=auth(user_token)).json()
    assert tobe[0]["metrics"] == {"steps_before": 4, "steps_after": 3, "automated_count": 1}

    workflows = client.get(f"/api/divisions/{division_id}/n8n", headers=auth(user_token)).json()
    assert len(workflows) == 2

    exported = client.get(f"/api/divisions/{division_id}/n8n/{workflows[0]['id']}/export", headers=auth(user_token)).json()
    names = {n["name"] for n in exported["nodes"]}
    assert exported["connections"]["Есть новые?"]["main"][0][0]["node"] == "Записать в АБИС"
    assert exported["connections"]["Есть новые?"]["main"][1][0]["node"] == "Уведомить об ошибке"
    for source, outputs in exported["connections"].items():
        assert source in names
        assert all(target["node"] in names for branch in outputs["main"] for target in branch)
    types = {n["name"]: n["type"] for n in exported["nodes"]}
    assert types["Каждые 15 минут"] == "n8n-nodes-base.scheduleTrigger"
    assert types["Описание workflow"] == "n8n-nodes-base.stickyNote"

    archive = client.get(f"/api/divisions/{division_id}/n8n/export", headers=auth(user_token))
    assert len(zipfile.ZipFile(io.BytesIO(archive.content)).namelist()) == 2

    division = client.get(f"/api/divisions/{division_id}", headers=auth(user_token)).json()
    assert division["processes_count"] == 2 and division["recommendations_count"] == 3
    assert division["fte_savings_total"] == 2.8

    dashboard = client.get("/api/dashboard", headers=auth(user_token)).json()
    assert dashboard["analyzed_divisions"] == 1 and dashboard["total_fte_savings"] == 2.8
    assert {c["category"]: c["count"] for c in dashboard["recommendations_by_category"]} == {
        "simple_automation": 1, "classic_digitization": 1, "ai_reengineering": 1}
    assert dashboard["top_processes"][0]["division_name"] == "Операционный отдел"
    assert len(dashboard["avg_scores"]) == 6

    word = client.get(f"/api/divisions/{division_id}/export/word", headers=auth(user_token))
    assert word.status_code == 200 and word.content[:2] == b"PK"
    pdf = client.get(f"/api/divisions/{division_id}/export/pdf", headers=auth(user_token))
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"


def test_concurrent_analysis_is_rejected(client, user_token, configure_llm, fake_llm):
    configure_llm()
    fake_llm.delay = 0.3
    division_id = _prepare_division(client, user_token)
    assert client.post(f"/api/divisions/{division_id}/analyze", headers=auth(user_token)).status_code == 200
    assert client.post(f"/api/divisions/{division_id}/analyze", headers=auth(user_token)).status_code == 409
    assert wait_for_analysis(client, user_token, division_id)["status"] == "completed"


def test_failed_analysis_keeps_previous_results(client, admin_token, user_token, configure_llm):
    configure_llm()
    division_id = _prepare_division(client, user_token)
    client.post(f"/api/divisions/{division_id}/analyze", headers=auth(user_token))
    assert wait_for_analysis(client, user_token, division_id)["status"] == "completed"

    # Поддельная модель «ломается», когда в промпте есть слово BROKEN
    client.put(f"/api/divisions/{division_id}", json={"name": "BROKEN отдел"}, headers=auth(user_token))
    client.post(f"/api/divisions/{division_id}/analyze", headers=auth(user_token))
    status = wait_for_analysis(client, user_token, division_id)
    assert status["status"] == "error"
    assert status["failed_step"] == "extracting_processes" and "формате" in status["error"]

    # Результаты прошлого успешного анализа на месте
    assert len(client.get(f"/api/divisions/{division_id}/processes", headers=auth(user_token)).json()) == 2

    errors = client.get("/api/admin/errors", headers=auth(admin_token)).json()
    assert errors["total"] >= 1 and errors["errors"][0]["division_name"] == "BROKEN отдел"


def test_analysis_without_llm_settings_fails_clearly(client, user_token):
    division_id = _prepare_division(client, user_token)
    client.post(f"/api/divisions/{division_id}/analyze", headers=auth(user_token))
    status = wait_for_analysis(client, user_token, division_id)
    assert status["status"] == "error" and "не настроена" in status["error"]


def test_stale_analysis_is_detected(client, user_token):
    division_id = _prepare_division(client, user_token)
    old = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    db = db_module.get_database()
    client.portal.call(lambda: db.divisions.update_one(
        {"id": division_id}, {"$set": {"analysis_status": "extracting_processes", "analysis_updated_at": old}}
    ))
    status = client.get(f"/api/divisions/{division_id}/analysis-status", headers=auth(user_token)).json()
    assert status["status"] == "error" and "прерван" in status["error"]


def test_custom_prompt_and_knowledge_are_used(client, admin_token, user_token, configure_llm, fake_llm):
    configure_llm()
    prompt = client.get("/api/admin/prompts/scoring", headers=auth(admin_token)).json()
    assert "processes" in prompt["placeholders"]
    custom = prompt["user_prompt_template"].replace("Оцени процессы", "МАРКЕР-ТЕСТ. Оцени процессы")
    client.post("/api/admin/prompts", json={"step_name": "scoring", "system_prompt": prompt["system_prompt"],
                                            "user_prompt_template": custom}, headers=auth(admin_token))
    client.post("/api/admin/knowledge", json={"title": "Регламент банка", "content": "ЗНАНИЕ-42"}, headers=auth(admin_token))

    division_id = _prepare_division(client, user_token)
    client.post(f"/api/divisions/{division_id}/analyze", headers=auth(user_token))
    assert wait_for_analysis(client, user_token, division_id)["status"] == "completed"
    prompts = fake_llm.user_prompts()
    assert any("МАРКЕР-ТЕСТ" in p for p in prompts)
    assert all("ЗНАНИЕ-42" in p for p in prompts)

    history = client.get("/api/admin/prompts/scoring/history", headers=auth(admin_token)).json()
    assert len(history) == 1
    client.post("/api/admin/prompts/scoring/reset", headers=auth(admin_token))
    assert client.get("/api/admin/prompts/scoring", headers=auth(admin_token)).json()["is_default"] is True

    # Знания можно отключить для подразделения
    client.post(f"/api/divisions/{division_id}/knowledge-selection", json={"use_global": False, "selected_ids": []}, headers=auth(user_token))
    fake_llm.requests.clear()
    client.post(f"/api/divisions/{division_id}/analyze", headers=auth(user_token))
    assert wait_for_analysis(client, user_token, division_id)["status"] == "completed"
    assert not any("ЗНАНИЕ-42" in p for p in fake_llm.user_prompts())
