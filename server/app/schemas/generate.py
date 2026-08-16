# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from typing import Any, List, Optional


class TestCase(BaseModel):
    title: str
    steps: List[str]
    expected_result: str
    type: str  # positive, negative, edge_case
    # Which of the 5 generation categories this test case belongs to
    # (functional / regression / data_driven / smoke_e2e / ui) — see
    # CATEGORY_CONFIG in llm_service.py. Optional so CSV-imported or other
    # legacy-path test cases that never went through category discovery
    # don't fail validation; the frontend treats a missing value as
    # "functional" (see AppContext.tsx's DB-fetch mapping).
    category: Optional[str] = None
    feature_area: Optional[str] = None
    # BUG FIX: these three were already being produced by the generation
    # pipeline (see generate.py's worker_wrapper) but this schema never
    # declared them — since /tests/generate uses response_model=GenerateTestResponse,
    # FastAPI/Pydantic silently dropped them from every response before they
    # ever reached the frontend, even though Generator.tsx has always been
    # reading tc.test_data_source_type / tc.test_data_source_id / tc.test_data_values
    # off the response. In practice this meant auto-matched test data never
    # actually made it to the UI. Declaring them here (not related to the
    # category-split feature, just adjacent code touched while fixing that)
    # so they're no longer discarded.
    test_data_source_type: Optional[str] = None
    test_data_source_id: Optional[str] = None
    test_data_values: Optional[Any] = None


class GenerateTestResponse(BaseModel):
    run_id: Optional[int] = None
    filename: str
    total: int
    source: str           # "document", "wireframe", or "document + wireframe"
    context_used: bool = False
    test_cases: List[TestCase]
    # Real per-batch Gemini call trace (model, tokens, pass timings, whether the
    # Pass 1 top-up retry fired, and now the category_breakdown/category_targets
    # from the category-split feature) — powers the Execution Trace tab.
    # Optional/None for older code paths (e.g. CSV import) that don't build one.
    generation_trace: Optional[dict] = None