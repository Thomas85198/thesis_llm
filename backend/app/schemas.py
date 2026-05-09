from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


SectionName = Literal[
    "Abstract",
    "Introduction",
    "Method",
    "Experiment",
    "Results",
    "Discussion",
    "Conclusion",
    "Other",
]


class EDU(BaseModel):
    id: str
    text: str
    section: SectionName
    order: int
    page: int = 0
    bbox: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0, 0.0])


class Entity(BaseModel):
    id: str
    name: str
    type: Literal[
        "Concept", "Method", "Metric", "Dataset", "Model", "Task", "Claim", "Other"
    ]


class ERTriple(BaseModel):
    id: str
    source_entity_id: str
    target_entity_id: str
    predicate: str
    evidence_edu_id: str


RSTRelationType = Literal[
    "Elaboration",
    "Background",
    "Cause",
    "Result",
    "Contrast",
    "Concession",
    "Evidence",
    "Justify",
    "Motivation",
    "Solutionhood",
    "Sequence",
    "Restatement",
    "Summary",
    "Condition",
    "Other",
]


class RSTNode(BaseModel):
    id: str
    rst_type: RSTRelationType
    nucleus_edu_id: str
    satellite_edu_ids: list[str] = Field(default_factory=list)


FRUFunction = Literal[
    "Motivation",
    "Claim",
    "Evidence",
    "Background",
    "Definition",
    "MethodStep",
    "Observation",
    "Attribution",
    "Concession",
    "Compensation",
    "Specific",
    "Generalization",
    "Restatement",
    "MetaDiscourse",
    "Other",
]


class FRUNode(BaseModel):
    id: str
    function: FRUFunction
    edu_ids: list[str]
    summary: str = ""


class Severity(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Defect(BaseModel):
    id: str
    rule_id: str
    defect_type: str
    severity: Severity
    section: SectionName
    evidence_edu_ids: list[str]
    description: str
    suggestion: str


class PaperGraph(BaseModel):
    paper_id: str
    title: str = ""
    edus: list[EDU] = Field(default_factory=list)
    entities: list[Entity] = Field(default_factory=list)
    er_triples: list[ERTriple] = Field(default_factory=list)
    rst_nodes: list[RSTNode] = Field(default_factory=list)
    fru_nodes: list[FRUNode] = Field(default_factory=list)


class AnalysisResult(BaseModel):
    paper_id: str
    graph: PaperGraph
    defects: list[Defect] = Field(default_factory=list)
