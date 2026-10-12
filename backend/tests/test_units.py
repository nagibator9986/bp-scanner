import xml.etree.ElementTree as ET

from bpscanner.bpmn import generate_bpmn_xml
from bpscanner.documents import build_documents_context
from bpscanner.llm import as_item_list, extract_json, strip_reasoning
from bpscanner.n8n import to_n8n_workflow
from bpscanner.normalize import (
    automation_potential,
    category,
    normalize_process,
    normalize_recommendations,
    normalize_scoring,
    normalize_workflow,
    str_list,
)
from bpscanner.prompts import DEFAULT_PROMPTS, STEP_META, render_prompt
from bpscanner.questionnaire import format_answers_for_prompt, questionnaire_completion

BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"


# ---------- Разбор ответов модели ----------

def test_extract_json_variants():
    assert extract_json('[{"a": 1}]') == [{"a": 1}]
    assert extract_json('Вот ответ:\n```json\n[{"a": 1}]\n```\nГотово') == [{"a": 1}]
    assert extract_json('<think>думаю {не json}</think>[{"a": 1}]') == [{"a": 1}]
    assert extract_json('[{"a": 1}, {"b": 2},]') == [{"a": 1}, {"b": 2}]
    assert extract_json('Ответ: [{"a": 1}, {"b": 2},] — готово') == [{"a": 1}, {"b": 2}]
    assert extract_json('Результат: {"items": [{"a": 1}]} конец') == {"items": [{"a": 1}]}
    # Ответ обрезан по лимиту токенов — сохраняем целые элементы
    assert extract_json('[{"a": 1}, {"b": 2}, {"c": "обре') == [{"a": 1}, {"b": 2}]
    assert extract_json("просто текст") is None


def test_strip_reasoning_handles_missing_open_tag():
    assert strip_reasoning("рассуждения</think>\n[1]") == "[1]"
    assert strip_reasoning("<THINK>x</THINK> ok") == "ok"


def test_as_item_list():
    assert as_item_list({"processes": [{"a": 1}, "мусор"]}) == [{"a": 1}]
    assert as_item_list({"name": "один"}) == [{"name": "один"}]
    assert as_item_list({"whatever": [{"x": 1}]}) == [{"x": 1}]
    assert as_item_list(None) == []


# ---------- Промпты ----------

def test_render_prompt_new_and_legacy_templates():
    new = render_prompt('Отдел {division_name}: [{"name":"x"}] {unknown}', {"division_name": "Казна"})
    assert new == 'Отдел Казна: [{"name":"x"}] {unknown}'
    legacy = render_prompt('Отдел {division_name}\n[{{"name":"x"}}]', {"division_name": "Казна"})
    assert legacy == 'Отдел Казна\n[{"name":"x"}]'
    with_knowledge = render_prompt("Только {processes}", {"processes": "P", "knowledge_context": "ЗНАНИЯ"})
    assert with_knowledge.endswith("ЗНАНИЯ")


def test_default_prompts_use_only_declared_placeholders():
    import re
    for step, prompt in DEFAULT_PROMPTS.items():
        used = set(re.findall(r"\{([a-z_]+)\}", prompt["user_prompt_template"]))
        assert used <= set(STEP_META[step]["placeholders"]), step
        assert "{{" not in prompt["user_prompt_template"], step


# ---------- Нормализация ----------

def test_normalize_process_from_strings_and_objects():
    process = normalize_process({
        "title": "Онбординг",
        "steps": ["1. Получить анкету", "Анкета заполнена?", {"step": "Открыть счёт", "role": "Операционист", "automated": "true"}],
        "systems": "CRM, АБИС",
    })
    assert process["steps"] == ["Получить анкету", "Анкета заполнена?", "Открыть счёт"]
    assert [s["type"] for s in process["steps_detail"]] == ["task", "decision", "task"]
    assert process["steps_detail"][2]["automated"] is True
    assert process["systems"] == ["CRM", "АБИС"]
    assert process["roles"] == ["Операционист"]
    assert normalize_process({"steps": []}) is None


def test_normalize_scoring_matches_and_clamps():
    processes = [{"id": "1", "name": "Приём заявок"}, {"id": "2", "name": "Отчётность"}]
    scoring = normalize_scoring([
        {"process_name": "приём заявок", "manual_effort": "9/10", "complexity": 0},
        {"process_name": "Отчетность", "manual_effort": 3},
        {"process_name": "Неизвестный процесс"},
    ], processes)
    assert {s["process_id"] for s in scoring} == {"1", "2"}
    first = next(s for s in scoring if s["process_id"] == "1")
    assert first["manual_effort"] == 9 and first["complexity"] == 1
    assert first["total_score"] == sum(first[f] for f in ("complexity", "manual_effort", "system_fragmentation",
                                                           "approval_burden", "ai_suitability", "automation_readiness"))


def test_automation_potential_bounds():
    low = {f: 1 for f in ("manual_effort", "automation_readiness", "system_fragmentation", "approval_burden", "ai_suitability")}
    high = {f: 10 for f in low}
    assert automation_potential(low) == 0 and automation_potential(high) == 100


def test_category_mapping():
    assert category("Простая автоматизация") == "simple_automation"
    assert category("AI-реинжиниринг") == "ai_reengineering"
    assert category("Цифровизация и интеграция") == "classic_digitization"
    assert category("автоматизации документооборота") == "simple_automation"
    assert category(None) == "simple_automation"


def test_normalize_recommendations_dedup_and_sort():
    recs = normalize_recommendations([
        {"title": "Б", "priority": "2", "estimated_fte_savings": "0,5"},
        {"title": "А", "priority": 1, "related_processes": "Процесс 1"},
        {"title": "а", "priority": 5},
        {"description": "без названия"},
    ], [{"id": "p1", "name": "Процесс 1"}])
    assert [r["title"] for r in recs] == ["А", "Б"]
    assert recs[0]["related_process_ids"] == ["p1"]
    assert recs[1]["estimated_fte_savings"] == 0.5


def test_str_list_parsing():
    assert str_list("- Первый\n- Второй; Третий") == ["Первый", "Второй", "Третий"]
    assert str_list(["A", "A", {"name": "B"}]) == ["A", "B"]


# ---------- BPMN ----------

def test_bpmn_has_lanes_gateway_loop_and_valid_di():
    xml = generate_bpmn_xml("Согласование <договора>", [
        {"name": "Подготовить договор", "role": "Юрист", "system": "СЭД", "type": "task", "manual": True},
        {"name": "Договор согласован?", "role": "Руководитель", "type": "decision"},
        {"name": "Подписать", "role": "Руководитель", "type": "task", "automated": True},
    ])
    root = ET.fromstring(xml.encode())
    process = root.find(f"{BPMN}process")
    assert [lane.get("name") for lane in process.iter(f"{BPMN}lane")] == ["Юрист", "Руководитель"]
    flows = {f.get("id"): f for f in process.iter(f"{BPMN}sequenceFlow")}
    gateway = process.find(f"{BPMN}exclusiveGateway")
    outgoing = [flows[ref.text] for ref in gateway.findall(f"{BPMN}outgoing")]
    assert {f.get("name") for f in outgoing} == {"Да", "Нет"}
    back = next(f for f in outgoing if f.get("name") == "Нет")
    assert process.find(f"{BPMN}userTask").get("id") == back.get("targetRef")
    assert process.find(f"{BPMN}serviceTask").get("name") == "Подписать"

    element_ids = {el.get("id") for el in process if el.get("id")}
    shapes = {s.get("bpmnElement") for s in root.iter("{http://www.omg.org/spec/BPMN/20100524/DI}BPMNShape")}
    edges = {e.get("bpmnElement") for e in root.iter("{http://www.omg.org/spec/BPMN/20100524/DI}BPMNEdge")}
    assert element_ids - set(flows) - {"LaneSet_1"} <= shapes
    assert set(flows) == edges
    assert root.find(f"{BPMN}collaboration/{BPMN}participant").get("name") == "Согласование <договора>"


def test_bpmn_handles_empty_steps():
    root = ET.fromstring(generate_bpmn_xml("Пустой", []).encode())
    assert len(list(root.iter(f"{BPMN}task"))) == 1


# ---------- n8n ----------

def test_n8n_export_structure():
    workflow = normalize_workflow({
        "name": "Тест",
        "nodes": [
            {"id": "a", "type": "trigger", "n8n_node": "webhook", "name": "Вебхук"},
            {"id": "b", "type": "condition", "n8n_node": "if", "name": "Проверка"},
            {"id": "c", "type": "action", "n8n_node": "unknownThing", "name": "Действие"},
            {"id": "d", "type": "action", "n8n_node": "emailSend", "name": "Действие"},
        ],
        "connections": [{"from": "a", "to": "b"}, {"from": "b", "to": "c"}, {"from": "b", "to": "d"}, {"from": "x", "to": "a"}],
    })
    exported = to_n8n_workflow(workflow)
    nodes = {n["name"]: n for n in exported["nodes"]}
    assert nodes["Вебхук"]["type"] == "n8n-nodes-base.webhook" and nodes["Вебхук"]["webhookId"]
    assert nodes["Действие"]["type"] == "n8n-nodes-base.noOp"
    assert nodes["Действие 2"]["type"] == "n8n-nodes-base.emailSend"
    assert exported["connections"]["Проверка"]["main"] == [
        [{"node": "Действие", "type": "main", "index": 0}],
        [{"node": "Действие 2", "type": "main", "index": 0}],
    ]
    assert nodes["Проверка"]["position"][0] > nodes["Вебхук"]["position"][0]


def test_n8n_layout_survives_cycles():
    workflow = normalize_workflow({"name": "Цикл", "nodes": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
                                   "connections": [{"from": "a", "to": "b"}, {"from": "b", "to": "a"}]})
    assert len(to_n8n_workflow(workflow)["nodes"]) == 3


# ---------- Анкета и документы ----------

def test_questionnaire_completion_respects_conditions():
    assert questionnaire_completion({})["required_done"] == 0
    with_approvals = questionnaire_completion({"has_approvals": True})
    without = questionnaire_completion({"has_approvals": False})
    assert with_approvals["total"] == without["total"] + 4
    text = format_answers_for_prompt({"dept_function": "Кредиты", "has_approvals": True, "custom": "x"})
    assert "Основная функция подразделения: Кредиты" in text and "Да" in text and "custom: x" in text


def test_documents_budget_is_shared_fairly():
    context = build_documents_context([("short", "a" * 100), ("long", "b" * 10000)], budget=1000)
    assert "a" * 100 in context
    assert context.count("b") == 900
    assert build_documents_context([], 100) == "Документы не загружены"
