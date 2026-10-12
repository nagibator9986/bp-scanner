"""Детерминированная генерация BPMN 2.0 XML по шагам процесса.

Модель описывает процесс структурно (шаги, роли, системы, решения), а схема
со всеми координатами строится здесь. Это гарантирует валидный XML, отсутствие
наложений и дорожки (lanes) по ролям — без отдельных вызовов LLM.
"""
import xml.etree.ElementTree as ET

NS = {
    "bpmn": "http://www.omg.org/spec/BPMN/20100524/MODEL",
    "bpmndi": "http://www.omg.org/spec/BPMN/20100524/DI",
    "dc": "http://www.omg.org/spec/DD/20100524/DC",
    "di": "http://www.omg.org/spec/DD/20100524/DI",
    # Цвета элементов (BPMN in Color + расширение bpmn.io) — понимают bpmn-js и Camunda Modeler
    "color": "http://www.omg.org/spec/BPMN/non-normative/color/1.0",
    "bioc": "http://bpmn.io/schema/bpmn/biocolor/1.0",
}
STROKE_COLORS = {"serviceTask": "#10b981", "exclusiveGateway": "#f59e0b"}
for _prefix, _uri in NS.items():
    ET.register_namespace(_prefix, _uri)

DEFAULT_ROLE = "Исполнитель"

POOL_X, POOL_Y = 160, 80
POOL_LABEL_W = 30          # полоса с названием пула
LANE_LABEL_W = 30          # полоса с названием дорожки
LANE_H = 150
COL_W = 180
FIRST_COL_OFFSET = 60      # от начала содержимого дорожки до центра стартового события
SIZES = {
    "event": (36, 36),
    "task": (130, 80),
    "gateway": (50, 50),
}


def _q(prefix: str, tag: str) -> str:
    return f"{{{NS[prefix]}}}{tag}"


def _short(text: str, limit: int = 90) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _task_tag(step: dict) -> str:
    if step.get("type") == "subprocess":
        return "subProcess"
    if step.get("automated"):
        return "serviceTask"
    if step.get("system"):
        return "userTask"
    if step.get("manual"):
        return "manualTask"
    return "task"


class _Node:
    def __init__(self, node_id: str, kind: str, tag: str, name: str, lane: int, col: int, step: dict | None = None):
        self.id = node_id
        self.kind = kind  # event | task | gateway
        self.tag = tag
        self.name = name
        self.lane = lane
        self.col = col
        self.step = step or {}
        self.incoming: list[str] = []
        self.outgoing: list[str] = []

    @property
    def size(self) -> tuple[int, int]:
        return SIZES[self.kind]

    @property
    def center(self) -> tuple[float, float]:
        cx = POOL_X + POOL_LABEL_W + LANE_LABEL_W + FIRST_COL_OFFSET + self.col * COL_W
        cy = POOL_Y + self.lane * LANE_H + LANE_H / 2
        return cx, cy

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        (cx, cy), (w, h) = self.center, self.size
        return cx - w / 2, cy - h / 2, w, h


def generate_bpmn_xml(process_name: str, steps: list[dict], default_role: str | None = None) -> str:
    """Строит BPMN 2.0 XML с пулом, дорожками по ролям и диаграммой.

    steps — нормализованные шаги: {name, role, system, type: task|decision|subprocess, automated, manual}.
    Шаг-решение превращается в исключающий шлюз: «Да» — дальше по процессу,
    «Нет» — возврат на предыдущий шаг (доработка).
    """
    process_name = _short(process_name or "Процесс", 120)
    steps = [s for s in steps if s and s.get("name")] or [{"name": process_name, "type": "task"}]
    fallback_role = default_role or DEFAULT_ROLE

    lanes: list[str] = []
    for step in steps:
        role = _short(step.get("role") or fallback_role, 60)
        if role not in lanes:
            lanes.append(role)

    def lane_of(step: dict) -> int:
        return lanes.index(_short(step.get("role") or fallback_role, 60))

    nodes: list[_Node] = [_Node("StartEvent_1", "event", "startEvent", "Начало", lane_of(steps[0]), 0)]
    counters = {"task": 0, "gateway": 0}
    for index, step in enumerate(steps, 1):
        if step.get("type") == "decision":
            counters["gateway"] += 1
            nodes.append(_Node(f"Gateway_{counters['gateway']}", "gateway", "exclusiveGateway",
                               _short(step["name"]), lane_of(step), index, step))
        else:
            counters["task"] += 1
            nodes.append(_Node(f"Activity_{counters['task']}", "task", _task_tag(step),
                               _short(step["name"]), lane_of(step), index, step))
    end = _Node("EndEvent_1", "event", "endEvent", "Конец", lane_of(steps[-1]), len(steps) + 1)
    nodes.append(end)

    flows: list[dict] = []

    def add_flow(source: _Node, target: _Node, name: str = "", back: bool = False) -> None:
        flow_id = f"Flow_{len(flows) + 1}"
        flows.append({"id": flow_id, "source": source, "target": target, "name": name, "back": back})
        source.outgoing.append(flow_id)
        target.incoming.append(flow_id)

    for position in range(len(nodes) - 1):
        current, following = nodes[position], nodes[position + 1]
        if current.kind == "gateway":
            add_flow(current, following, "Да")
            previous = next((n for n in reversed(nodes[:position]) if n.kind == "task"), None)
            add_flow(current, previous or end, "Нет", back=previous is not None)
        else:
            add_flow(current, following)

    # ---------- Семантика ----------
    definitions = ET.Element(_q("bpmn", "definitions"), {
        "id": "Definitions_1",
        "targetNamespace": "http://bpmn.io/schema/bpmn",
        "exporter": "BP Scanner",
        "exporterVersion": "2.0",
    })
    collaboration = ET.SubElement(definitions, _q("bpmn", "collaboration"), {"id": "Collaboration_1"})
    ET.SubElement(collaboration, _q("bpmn", "participant"),
                  {"id": "Participant_1", "name": process_name, "processRef": "Process_1"})

    process = ET.SubElement(definitions, _q("bpmn", "process"),
                            {"id": "Process_1", "name": process_name, "isExecutable": "false"})
    lane_set = ET.SubElement(process, _q("bpmn", "laneSet"), {"id": "LaneSet_1"})
    for lane_index, lane_name in enumerate(lanes):
        lane = ET.SubElement(lane_set, _q("bpmn", "lane"), {"id": f"Lane_{lane_index + 1}", "name": lane_name})
        for node in nodes:
            if node.lane == lane_index:
                ET.SubElement(lane, _q("bpmn", "flowNodeRef")).text = node.id

    for node in nodes:
        element = ET.SubElement(process, _q("bpmn", node.tag), {"id": node.id, "name": node.name})
        details = []
        if node.step.get("system"):
            details.append(f"Система: {node.step['system']}")
        if node.step.get("duration_min"):
            details.append(f"Длительность: {node.step['duration_min']:g} мин")
        if details:
            ET.SubElement(element, _q("bpmn", "documentation")).text = "; ".join(details)
        for flow_id in node.incoming:
            ET.SubElement(element, _q("bpmn", "incoming")).text = flow_id
        for flow_id in node.outgoing:
            ET.SubElement(element, _q("bpmn", "outgoing")).text = flow_id

    for flow in flows:
        attributes = {"id": flow["id"], "sourceRef": flow["source"].id, "targetRef": flow["target"].id}
        if flow["name"]:
            attributes["name"] = flow["name"]
        ET.SubElement(process, _q("bpmn", "sequenceFlow"), attributes)

    # ---------- Диаграмма ----------
    content_width = (len(steps) + 1) * COL_W + 2 * FIRST_COL_OFFSET
    pool_width = POOL_LABEL_W + LANE_LABEL_W + content_width
    pool_height = len(lanes) * LANE_H

    diagram = ET.SubElement(definitions, _q("bpmndi", "BPMNDiagram"), {"id": "BPMNDiagram_1"})
    plane = ET.SubElement(diagram, _q("bpmndi", "BPMNPlane"), {"id": "BPMNPlane_1", "bpmnElement": "Collaboration_1"})

    def shape(element_id: str, x: float, y: float, w: float, h: float, **extra: str) -> ET.Element:
        node = ET.SubElement(plane, _q("bpmndi", "BPMNShape"), {"id": f"{element_id}_di", "bpmnElement": element_id, **extra})
        ET.SubElement(node, _q("dc", "Bounds"), {"x": f"{x:g}", "y": f"{y:g}", "width": f"{w:g}", "height": f"{h:g}"})
        return node

    shape("Participant_1", POOL_X, POOL_Y, pool_width, pool_height, isHorizontal="true")
    for lane_index in range(len(lanes)):
        shape(f"Lane_{lane_index + 1}", POOL_X + POOL_LABEL_W, POOL_Y + lane_index * LANE_H,
              pool_width - POOL_LABEL_W, LANE_H, isHorizontal="true")

    for node in nodes:
        x, y, w, h = node.bounds
        extra = {}
        if node.kind == "gateway":
            extra["isMarkerVisible"] = "true"
        if node.tag == "subProcess":
            extra["isExpanded"] = "false"
        if node.tag in STROKE_COLORS:
            extra[_q("bioc", "stroke")] = STROKE_COLORS[node.tag]
            extra[_q("color", "border-color")] = STROKE_COLORS[node.tag]
        element = shape(node.id, x, y, w, h, **extra)
        if node.kind in ("event", "gateway"):
            label = ET.SubElement(element, _q("bpmndi", "BPMNLabel"))
            label_w = 90 if node.kind == "event" else 130
            # Подпись шлюза — над ромбом: снизу проходит стрелка «Нет» (возврат на доработку)
            label_y = y - 36 if node.kind == "gateway" else y + h + 6
            ET.SubElement(label, _q("dc", "Bounds"), {
                "x": f"{x + w / 2 - label_w / 2:g}", "y": f"{label_y:g}", "width": f"{label_w:g}", "height": "30",
            })

    for flow in flows:
        source, target = flow["source"], flow["target"]
        sx, sy, sw, sh = source.bounds
        tx, ty, tw, th = target.bounds
        (scx, scy), (tcx, tcy) = source.center, target.center
        if flow["back"]:
            channel = max(sy + sh, ty + th) + 22
            points = [(scx, sy + sh), (scx, channel), (tcx, channel), (tcx, ty + th)]
            label_pos = ((scx + tcx) / 2 - 15, channel + 2)
        elif flow["name"] == "Нет":  # «Нет» без предыдущей задачи — сразу в конец
            channel = max(sy + sh, ty + th) + 22
            points = [(scx, sy + sh), (scx, channel), (tcx, channel), (tcx, ty + th)]
            label_pos = (scx + 6, sy + sh + 4)
        else:
            start, finish = (sx + sw, scy), (tx, tcy)
            if abs(scy - tcy) < 1:
                points = [start, finish]
            else:
                middle = (start[0] + finish[0]) / 2
                points = [start, (middle, scy), (middle, tcy), finish]
            label_pos = (sx + sw + 6, scy + 4)
        edge = ET.SubElement(plane, _q("bpmndi", "BPMNEdge"), {"id": f"{flow['id']}_di", "bpmnElement": flow["id"]})
        for px, py in points:
            ET.SubElement(edge, _q("di", "waypoint"), {"x": f"{px:g}", "y": f"{py:g}"})
        if flow["name"]:
            label = ET.SubElement(edge, _q("bpmndi", "BPMNLabel"))
            ET.SubElement(label, _q("dc", "Bounds"), {
                "x": f"{label_pos[0]:g}", "y": f"{label_pos[1]:g}", "width": "30", "height": "14",
            })

    ET.indent(definitions, space="  ")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(definitions, encoding="unicode")
