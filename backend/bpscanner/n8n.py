"""Преобразование описания workflow в JSON, который импортируется в n8n (Import from File)."""
import re
import uuid
from collections import defaultdict

# n8n_node → (тип ноды n8n, typeVersion). Версии выбраны консервативно — поддерживаются n8n 1.x.
NODE_CATALOG = {
    "scheduletrigger": ("n8n-nodes-base.scheduleTrigger", 1.1),
    "cron": ("n8n-nodes-base.scheduleTrigger", 1.1),
    "webhook": ("n8n-nodes-base.webhook", 1.1),
    "manualtrigger": ("n8n-nodes-base.manualTrigger", 1),
    "emailreadimap": ("n8n-nodes-base.emailReadImap", 2),
    "httprequest": ("n8n-nodes-base.httpRequest", 4.1),
    "emailsend": ("n8n-nodes-base.emailSend", 2),
    "sendemail": ("n8n-nodes-base.emailSend", 2),
    "email": ("n8n-nodes-base.emailSend", 2),
    "telegram": ("n8n-nodes-base.telegram", 1),
    "slack": ("n8n-nodes-base.slack", 2),
    "postgres": ("n8n-nodes-base.postgres", 2),
    "database": ("n8n-nodes-base.postgres", 2),
    "microsoftsql": ("n8n-nodes-base.microsoftSql", 1),
    "googlesheets": ("n8n-nodes-base.googleSheets", 4),
    "spreadsheet": ("n8n-nodes-base.microsoftExcel", 2),
    "microsoftexcel": ("n8n-nodes-base.microsoftExcel", 2),
    "extractfromfile": ("n8n-nodes-base.extractFromFile", 1),
    "if": ("n8n-nodes-base.if", 1),
    "switch": ("n8n-nodes-base.switch", 2),
    "merge": ("n8n-nodes-base.merge", 2),
    "splitinbatches": ("n8n-nodes-base.splitInBatches", 2),
    "set": ("n8n-nodes-base.set", 3),
    "code": ("n8n-nodes-base.code", 1),
    "function": ("n8n-nodes-base.code", 1),
    "wait": ("n8n-nodes-base.wait", 1),
    "respondtowebhook": ("n8n-nodes-base.respondToWebhook", 1),
}
DEFAULT_BY_TYPE = {
    "trigger": "manualtrigger",
    "condition": "if",
    "transform": "set",
}
NOOP = ("n8n-nodes-base.noOp", 1)
STICKY = ("n8n-nodes-base.stickyNote", 1)


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return slug[:40] or uuid.uuid4().hex[:8]


def _parameters(key: str, node: dict) -> dict:
    params = node.get("parameters") or {}
    description = node.get("description") or node.get("name") or ""
    if key in ("scheduletrigger", "cron"):
        cron = params.get("cron") or params.get("schedule") or params.get("cronExpression") or "0 9 * * 1-5"
        return {"rule": {"interval": [{"field": "cronExpression", "expression": str(cron)}]}}
    if key == "webhook":
        return {
            "httpMethod": str(params.get("method") or params.get("httpMethod") or "POST").upper(),
            "path": str(params.get("path") or _slug(node.get("name", ""))),
            "options": {},
        }
    if key == "httprequest":
        result = {"url": str(params.get("url") or "https://example.com/api"), "options": {}}
        method = str(params.get("method") or "GET").upper()
        if method != "GET":
            result["method"] = method
        return result
    if key in ("postgres", "database", "microsoftsql"):
        query = params.get("query") or f"-- {description}\nSELECT 1;"
        return {"operation": "executeQuery", "query": str(query)}
    if key in ("code", "function"):
        comment = "\n".join(f"// {line}" for line in str(description).splitlines() if line.strip())
        return {"jsCode": f"{comment}\n// TODO: реализовать логику шага\nreturn $input.all();"}
    if key == "telegram":
        return {"text": str(params.get("text") or description), "additionalFields": {}}
    if key in ("emailsend", "sendemail", "email"):
        result = {"subject": str(params.get("subject") or node.get("name") or "Уведомление"), "options": {}}
        if params.get("to"):
            result["toEmail"] = str(params["to"])
        return result
    if key in ("set", "splitinbatches", "respondtowebhook"):
        return {"options": {}}
    return {}


def _resolve(node: dict) -> tuple[str, str, float]:
    key = re.sub(r"[^a-z]", "", (node.get("n8n_node") or "").lower().replace("n8n-nodes-base.", ""))
    if key not in NODE_CATALOG:
        key = DEFAULT_BY_TYPE.get(node.get("type"), "")
    if key in NODE_CATALOG:
        node_type, version = NODE_CATALOG[key]
        return key, node_type, version
    return "noop", *NOOP


def _layout(nodes: list[dict], connections: list[dict]) -> dict[str, tuple[int, int]]:
    """Раскладка слева направо: колонка ноды — длина самого длинного пути до неё."""
    ids = [n["id"] for n in nodes]
    depth = {i: 0 for i in ids}
    # Ограниченная релаксация рёбер: корректно для DAG и не зацикливается на циклах
    for _ in range(len(ids)):
        changed = False
        for c in connections:
            candidate = depth[c["from"]] + 1
            if candidate < len(ids) and depth[c["to"]] < candidate:
                depth[c["to"]] = candidate
                changed = True
        if not changed:
            break
    columns = defaultdict(list)
    for i in ids:
        columns[depth[i]].append(i)
    positions = {}
    for column, members in columns.items():
        for row, node_id in enumerate(members):
            offset = (row - (len(members) - 1) / 2) * 160
            positions[node_id] = (300 + column * 240, int(320 + offset))
    return positions


def to_n8n_workflow(workflow: dict) -> dict:
    nodes = workflow.get("nodes") or []
    connections = workflow.get("connections") or []
    positions = _layout(nodes, connections)

    names: dict[str, str] = {}
    keys: dict[str, str] = {}
    used_names: set[str] = set()
    n8n_nodes = []
    for node in nodes:
        key, node_type, version = _resolve(node)
        name = (node.get("name") or node["id"])[:60]
        base, suffix = name, 2
        while name in used_names:
            name = f"{base} {suffix}"
            suffix += 1
        used_names.add(name)
        names[node["id"]] = name
        keys[node["id"]] = key
        item = {
            "parameters": _parameters(key, node),
            "id": str(uuid.uuid4()),
            "name": name,
            "type": node_type,
            "typeVersion": version,
            "position": list(positions[node["id"]]),
        }
        if node.get("description"):
            item["notes"] = node["description"]
            item["notesInFlow"] = True
        if key == "webhook":
            item["webhookId"] = str(uuid.uuid4())
        n8n_nodes.append(item)

    note_lines = [f"## {workflow.get('name', 'Workflow')}"]
    for label, field in (("Описание", "description"), ("Сценарий", "use_case"), ("Экономия", "estimated_time_savings")):
        if workflow.get(field):
            note_lines.append(f"**{label}:** {workflow[field]}")
    if workflow.get("integration_points"):
        note_lines.append("**Интеграции:** " + ", ".join(workflow["integration_points"]))
    note_lines.append("_Сгенерировано BP Scanner. Настройте учётные данные и параметры нод перед запуском._")
    min_x = min((p[0] for p in positions.values()), default=300)
    min_y = min((p[1] for p in positions.values()), default=320)
    n8n_nodes.insert(0, {
        "parameters": {"content": "\n\n".join(note_lines), "height": 260, "width": 420},
        "id": str(uuid.uuid4()),
        "name": "Описание workflow",
        "type": STICKY[0],
        "typeVersion": STICKY[1],
        "position": [min_x - 40, min_y - 320],
    })

    outputs: dict[str, dict[int, list]] = defaultdict(lambda: defaultdict(list))
    branch_counter: dict[str, int] = defaultdict(int)
    for connection in connections:
        source, target = connection["from"], connection["to"]
        if source not in names or target not in names:
            continue
        if keys[source] in ("if", "switch"):
            index = branch_counter[source]
            branch_counter[source] += 1
            if keys[source] == "if":
                index = min(index, 1)
        else:
            index = 0
        outputs[names[source]][index].append({"node": names[target], "type": "main", "index": 0})

    n8n_connections = {}
    for source_name, by_index in outputs.items():
        main = [by_index.get(i, []) for i in range(max(by_index) + 1)]
        n8n_connections[source_name] = {"main": main}

    return {
        "name": workflow.get("name", "Workflow")[:120],
        "nodes": n8n_nodes,
        "connections": n8n_connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "pinData": {},
        "meta": {"templateCredsSetupCompleted": False},
        "tags": [],
    }


def export_filename(workflow: dict, index: int | None = None) -> str:
    base = re.sub(r"[^\w\-]+", "_", workflow.get("name", "workflow"), flags=re.UNICODE).strip("_")[:60] or "workflow"
    prefix = f"{index:02d}_" if index is not None else ""
    return f"{prefix}{base}.json"
