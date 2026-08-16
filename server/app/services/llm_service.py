import os
import json
import re
import asyncio as _asyncio
from typing import Any, List
from datetime import datetime
# pyrefly: ignore [missing-import]
from pydantic import BaseModel, Field
from google import genai        # type: ignore
from google.genai import types  # type: ignore

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# ── Category split ──────────────────────────────────────────────────────
# The suite isn't one undifferentiated pile of blueprints anymore. Functional
# coverage is generated FIRST (via the per-feature-budget logic below,
# unchanged) because its count is a real signal of app complexity — it's
# already grounded in "how many distinct feature areas does this app have,
# and how many cases does each genuinely need". Every other category is then
# sized as a percentage of the OVERALL suite (not of functional's count),
# derived by treating functional's own count as that category's pct share:
#   total = functional_count / (functional_pct / 100)
#   other_category_target = round(total * other_category_pct / 100)
# So a tiny single-page app naturally gets a tiny regression/UI suite too —
# nothing here is a flat number independent of app size.
#
# "min"/"max" are per-category floor/ceiling guardrails. "max_per_feature"
# overrides the global default — Data Driven is deliberately allowed to
# stack many variants of the same field (that's the whole point of the
# category), Smoke/E2E is journey-based so a per-feature cap doesn't really
# apply (set high/effectively-off).
CATEGORY_CONFIG = {
    "functional":  {"label": "Functional",        "pct": 50, "min": 6, "max": 100, "max_per_feature": 5},
    "regression":  {"label": "Regression",         "pct": 25, "min": 3, "max": 60,  "max_per_feature": 8},
    "data_driven": {"label": "Data Driven",        "pct": 15, "min": 3, "max": 45,  "max_per_feature": 10},
    "smoke_e2e":   {"label": "Smoke / End-to-End", "pct": 5,  "min": 2, "max": 15,  "max_per_feature": 99},
    "ui":          {"label": "UI",                 "pct": 5,  "min": 2, "max": 15,  "max_per_feature": 6},
}
# Display/generation order — functional always first since everything else
# is sized off of it.
CATEGORY_ORDER = ["functional", "smoke_e2e", "regression", "data_driven", "ui"]

# ── AI-decided blueprint count guardrails (functional category) ───────────
# The user no longer picks a target test-case count. Gemini decides how many
# functional blueprints a given app/input genuinely needs, based on how many
# distinct feature areas it can identify and the per-feature cap below.
# These bounds exist purely as a safety net around that decision — not a
# target — so a sparse one-page input can't collapse to 1-2 tests, and a
# huge multi-page input can't runaway past what CATEGORY_CONFIG allows.
#
# Derived from CATEGORY_CONFIG["functional"] rather than declared separately
# — there was a real bug here during development where these were hardcoded
# independently (MAX_BLUEPRINTS=35) while CATEGORY_CONFIG's functional "max"
# said 100, and the OLDER, smaller number silently won because the trimming
# code below read the hardcoded constant. Single source of truth now.
MIN_BLUEPRINTS = CATEGORY_CONFIG["functional"]["min"]
MAX_BLUEPRINTS = CATEGORY_CONFIG["functional"]["max"]
# No single feature area (e.g. "Login", "Cart") may have more than this many
# blueprints in the Functional category. Prompted as 2-3 typical / 4-5 for
# genuinely multi-step workflows — this is the hard backstop in case the
# model ignores that.
MAX_PER_FEATURE = CATEGORY_CONFIG["functional"]["max_per_feature"]

# ── Token usage log ────────────────────────────────────────────────────────
# Canonical path: server/token_usage_log.json — must match token_usage.py's
# router exactly. This used to resolve one directory too shallow (server/app/
# token_usage_log.json), which is the same misplacement token_usage.py's
# one-time startup migration was written to clean up — except that migration
# only runs once, at startup, and this file kept writing to the wrong path on
# every single generation afterward, so the wrong file just got recreated and
# silently grew again until the next restart swept it up. Fixed to point at
# the same file token_usage.py actually reads from.
_TOKEN_LOG_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "token_usage_log.json")

def _append_token_log(entry: dict):
    try:
        path = os.path.abspath(_TOKEN_LOG_PATH)
        existing = []
        if os.path.exists(path):
            try:
                with open(path, "r") as f:
                    existing = json.load(f)
            except Exception:
                existing = []
        existing.append(entry)
        # NOTE: this used to be `existing = existing[-500:]` here, which
        # silently discarded every entry beyond the most recent 500 on every
        # single write. Retries alone can produce 2-3 log entries per test
        # case, so that cap was getting hit — and quietly erasing history —
        # far sooner than "500 generations" would suggest. Not capping here
        # at all; see the note below about why a flat JSON file isn't a great
        # long-term home for this regardless.
        with open(path, "w") as f:
            json.dump(existing, f)
    except Exception as e:
        print(f"[Token log write error]: {e}")

def _extract_tokens(response) -> dict:
    try:
        meta = response.usage_metadata
        return {
            "input_tokens": getattr(meta, "prompt_token_count", 0) or 0,
            "output_tokens": getattr(meta, "candidates_token_count", 0) or 0,
            "total_tokens": getattr(meta, "total_token_count", 0) or 0,
        }
    except Exception:
        return {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}


def _repair_truncated_step_json(raw: str) -> dict | None:
    """
    Pass 2 responses occasionally get cut off mid-way through the "steps"
    array — genuinely long multi-page flows (full checkout, multi-item
    end-to-end journeys) can exceed the output token budget even with a
    forced JSON schema. Discarding the whole test case and asking the user
    to regenerate wastes the tokens already spent generating everything up
    to the cutoff. Salvage whatever complete steps made it through instead —
    a partial-but-real 6-step test case is more useful than nothing, and
    costs nothing extra to recover.
    """
    m = re.search(r'"steps"\s*:\s*\[(.*)', raw, re.DOTALL)
    if not m:
        return None
    array_blob = m.group(1)
    # Only fully-closed quoted strings match here — a truncated trailing
    # element (cut off before its closing quote) simply never gets captured,
    # which is exactly the "drop the incomplete last step" behavior we want.
    steps = re.findall(r'"((?:[^"\\]|\\.)*)"', array_blob)
    steps = [s.replace('\\"', '"').replace('\\n', ' ').strip() for s in steps if s.strip()]
    if len(steps) < 2:
        return None
    result = {"steps": steps}
    title_m = re.search(r'"title"\s*:\s*"((?:[^"\\]|\\.)*)"', raw)
    if title_m:
        result["title"] = title_m.group(1)
    return result


def _repair_truncated_blueprints_json(raw: str) -> list | None:
    """
    Same truncation problem as Pass 2's steps array, but for Pass 1's
    blueprint list — salvages every fully-formed {title, type, objective,
    feature_area} object that made it through before a cutoff. A truncated
    trailing object (cut off mid-field) simply won't match this pattern and
    gets dropped, same "keep only what's complete" behavior as the Pass 2
    repair.

    IMPORTANT: this must stay in sync with BlueprintItem's fields. It used
    to match only {title, type, objective} — once feature_area was added to
    the schema, every real (complete) blueprint object has a 4th field
    before its closing brace, so the 3-field pattern silently matched
    nothing anymore and truncation recovery was quietly dead. Keeping the
    fields explicit (not schema-driven) here on purpose since this is a
    regex fallback, not the primary parse path — just remember to update it
    if BlueprintItem's fields ever change again.
    """
    pattern = re.compile(
        r'\{\s*"title"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"type"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"objective"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"feature_area"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}',
        re.DOTALL
    )
    matches = pattern.findall(raw)
    if not matches:
        return None
    blueprints = [
        {
            "title": title.replace('\\"', '"').strip(),
            "type": btype.strip(),
            "objective": objective.replace('\\"', '"').strip(),
            "feature_area": feature_area.replace('\\"', '"').strip() or "Uncategorized",
        }
        for title, btype, objective, feature_area in matches
    ]
    return blueprints if blueprints else None


def _safe_parse_json(raw: str) -> Any:
    if not raw:
        raise ValueError("Empty response from Gemini")
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    if raw.startswith("["):
        last_complete = raw.rfind("},")
        if last_complete == -1:
            last_complete = raw.rfind("}")
        if last_complete != -1:
            candidate = raw[:last_complete + 1] + "]"
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                pass
    for cutoff in [raw.rfind('",'), raw.rfind('",\n'), raw.rfind('":')]:
        if cutoff > 0:
            candidate = raw[:cutoff] + '"}'
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                continue
    raise ValueError(f"Could not parse Gemini response as JSON: {raw[:200]}")


class BlueprintItem(BaseModel):
    title: str = Field(description="Short name of the test case scenario")
    type: str = Field(description="Must be exactly positive, negative, or edge_case")
    objective: str = Field(description="One sentence statement of what behavior is being validated")
    feature_area: str = Field(description="Short name of the feature/page/workflow this belongs to, e.g. 'Login', 'Shopping Cart', 'Checkout' — used to cap how many test cases any one feature gets")

class BlueprintListSchema(BaseModel):
    blueprints: List[BlueprintItem]

class ExpandedTestCaseSchema(BaseModel):
    title: str
    steps: List[str] = Field(description="Explicit browser-level action instructions using clear verbs like Navigate to, Click, Type, or Press Enter")
    expected_result: str = Field(description="Precise description of target screen confirmation parameters")
    type: str


def _build_pass1_prompt(context: str = None, existing_titles: List[str] = None) -> str:
    context_section = f"\nContext Details:\n{context}" if context else ""

    existing_section = ""
    if existing_titles:
        titles_block = "\n".join(f"- {t}" for t in existing_titles[:150])
        existing_section = f"""

━━━ ALREADY COVERED — DO NOT REPEAT ━━━
Test cases have already been generated for this application in earlier batches. Do NOT
generate a blueprint that duplicates or closely paraphrases any of the following — assume
every one of these topics/scenarios is already fully covered and move on to something new:
{titles_block}

If a feature area above already has 2-3 blueprints against it, either skip that feature
area entirely or, only if there is a genuinely distinct uncovered angle on it, add ONE more.
Do not pad the count by re-covering what's already on this list."""

    return f"""You are a Principal QA Architect.{context_section}{existing_section}
Analyze ALL provided application inputs (screenshots, requirements, wireframes) and decide,
yourself, how many test case blueprints this application genuinely needs. There is no fixed
number to hit — your job is to right-size the suite to what's actually there, not fill a quota.

━━━ STEP 1 — FEATURE INVENTORY (do this mentally before generating any blueprints) ━━━
Identify EVERY distinct feature area / page / workflow visible across ALL inputs. For example:
- Login / Authentication
- Product Listing / Inventory page
- Sidebar Navigation (hamburger menu, nav links)
- Shopping Cart (add, remove, view)
- Checkout flow
- Sorting / Filtering
- Product Detail page
- Logout
- Error states / user-type behaviors
List every area you can see. Do NOT skip areas just because they seem secondary.

━━━ STEP 2 — PER-FEATURE BUDGET (hard rule — this is what decides the total count) ━━━
For EACH feature area, decide how many blueprints it genuinely needs:
- Simple, single-action features (e.g. Logout, a toggle, a single filter): 1-2 blueprints
  (one positive is often enough; add a negative/edge only if there's a real failure mode).
- Typical features (e.g. Login, a form, a search box): 2-3 blueprints — commonly one
  positive + one negative, plus a third only if there's a genuinely distinct edge case.
- Genuinely multi-step workflows (e.g. full checkout, multi-item cart manipulation,
  a multi-page signup wizard): up to 4-5 blueprints, because the workflow itself has
  several meaningfully different paths through it (happy path, abandon mid-way, payment
  failure, quantity edit, etc.) — not because the feature is "important".
NO feature area should ever exceed 5 blueprints. If you find yourself writing a 6th
blueprint for the same feature area, stop — that's a sign you're generating minor
variations instead of new coverage, not thoroughness.
Tag every blueprint with the "feature_area" it belongs to (short name, consistent
spelling across blueprints of the same feature — e.g. always "Login", not sometimes
"Login" and sometimes "Authentication").

━━━ STEP 3 — SUM UP THE TOTAL ━━━
Add up the per-feature budgets from Step 2 — that sum IS your total blueprint count.
A small single-page app might genuinely only need 6-10 blueprints. A large multi-page
app with several complex workflows might need 25-35. Both are correct outcomes if
that's what the per-feature budgeting above actually produces — do not inflate or
deflate the count to hit a round number.

━━━ STEP 4 — DIVERSITY RULES ━━━
- Cover positive flows, negative/error flows, and edge cases across DIFFERENT features —
  not multiple negative flows piled onto the same feature.
- Never generate two blueprints that are near-identical minor variations of the same
  action (e.g. "empty username" and "empty username field" are the same test — don't
  double-count it).
- Prioritize cross-feature user journeys where they exist: add to cart → view cart →
  checkout; login → browse → logout; open sidebar → click nav link → land on page.
  A cross-feature journey blueprint counts toward EVERY feature area it touches for
  the purposes of the cap above — don't let it be an excuse to also generate the same
  journey's individual steps as separate blueprints.

Return ONLY the blueprint list — each blueprint must include title, type
(positive/negative/edge_case), objective, and feature_area."""


def _build_category_prompt(
    category: str,
    target_count: int,
    feature_areas: List[str],
    context: str = None,
    existing_titles: List[str] = None,
) -> str:
    """
    Prompt builder for the four non-functional categories (regression,
    data_driven, smoke_e2e, ui). Each gets grounded in the SAME feature_area
    list the functional pass already discovered, rather than re-inventing
    feature names from scratch — keeps feature_area spelling consistent
    across categories so the breakdown/grouping stays coherent.

    target_count is a SOFT target (see the "aim for approximately" line at
    the bottom) — discover_category_blueprints clamps the result to a
    tolerance band around it afterward rather than demanding an exact count,
    since forcing an exact number here would just reintroduce the same
    "padding to hit a quota" problem the AI-decided-count change was meant
    to solve, one category at a time.
    """
    meta = CATEGORY_CONFIG[category]
    context_section = f"\nContext Details:\n{context}" if context else ""
    features_block = "\n".join(f"- {f}" for f in feature_areas) if feature_areas else \
        "(no feature list available — infer the feature areas yourself from the inputs)"

    existing_section = ""
    if existing_titles:
        titles_block = "\n".join(f"- {t}" for t in existing_titles[:150])
        existing_section = f"""

━━━ ALREADY COVERED — DO NOT REPEAT ━━━
Do NOT generate a blueprint that duplicates or closely paraphrases any of the following
(this includes the functional blueprints already generated for this same batch):
{titles_block}"""

    if category == "regression":
        intent = """You are writing the REGRESSION suite for this application — the deeper, wider-net pass that
runs alongside (not instead of) the functional suite already generated. Regression blueprints
re-examine the SAME feature areas below but go past the basic positive/negative case: boundary
values, less-common input combinations, cross-feature side effects (does an action on one
feature quietly break the state of another?), and areas that tend to regress after changes
elsewhere. This is about depth on features that already exist, not about discovering new ones."""
    elif category == "data_driven":
        intent = """You are writing the DATA-DRIVEN suite — this is deliberately where repeated variations of
the SAME field/form with DIFFERENT input data belong (this is the one category where that
repetition is the point, not a problem — Functional stays capped at 2-3 per topic specifically
so this material lives here instead). For form fields, filters, search boxes, and similar
inputs in the feature list below, generate both POSITIVE data variants (valid boundary values,
typical values, max-length valid input) and NEGATIVE data variants (empty, too long, special
characters, wrong type, injection-style strings, whitespace-only) as separate blueprints.
Title each blueprint around "<field/form> — <data condition>" so it's clear which data case it
covers."""
    elif category == "smoke_e2e":
        intent = """You are writing the SMOKE / END-TO-END suite — a SMALL number of full top-to-bottom user
journeys that each touch MULTIPLE feature areas in one continuous flow (e.g. login → browse →
add to cart → checkout; or login → create a record → verify it appears → logout). These exist
to catch "is the system fundamentally alive" breakage, not to validate any single feature in
depth — keep each blueprint's objective centered on completing the full journey, not on any one
step within it. Do NOT write single-feature blueprints here; if it only touches one feature
area, it belongs in Functional, not Smoke/E2E."""
    else:  # ui
        intent = """You are writing the UI suite — layout, visual state, and interaction-affordance checks that
are NOT about business logic correctness. Think: are the right elements visible / hidden /
disabled in each state, does the layout hold up, are error/success messages actually SHOWN to
the user (not just does the backend behavior work), tooltips, icons, responsive behavior, focus
states, placeholder text. If a blueprint is really testing whether an action succeeds or fails
correctly, it belongs in Functional or Data Driven, not here — UI blueprints test whether the
user can SEE and INTERACT WITH the result correctly, not whether the result itself is correct."""

    low = max(1, round(target_count * 0.6))
    high = max(low, round(target_count * 1.3))

    return f"""You are a Principal QA Architect writing the "{meta['label']}" portion of a larger test suite.{context_section}{existing_section}

Known feature areas for this application (from an earlier functional-coverage pass on the same
inputs — ground your blueprints in these; use the same feature_area name for anything covering
one of them, don't invent unrelated features):
{features_block}

{intent}

Aim for approximately {target_count} blueprints for this category — anywhere from {low} to {high}
is genuinely fine depending on how much real {meta['label'].lower()} material this application
has. Do not pad to hit the exact number, and do not invent scenarios that don't fit this
category's intent just to reach it. No single feature_area should end up with more than
{meta['max_per_feature']} blueprints in this category.

Return ONLY the blueprint list — each blueprint must include title, type
(positive/negative/edge_case), objective, and feature_area."""


def _build_pass2_prompt(
    title: str, test_type: str, objective: str, context: str = None, test_data: dict = None, base_url: str = None) -> str:
    context_section = f"\nApp Architecture Context:\n{context}" if context else ""
    test_data_section = ""
    if test_data:
        test_data_section = f"""

TEST DATA TO USE (provided, real values — not invented):
{json.dumps(test_data)}
Wherever a step needs one of these fields (e.g. a name, email, age, or any other key listed
above), use this EXACT value, written verbatim. Do not invent a different value for any field
that appears in this list. For any data a step needs that ISN'T listed here, invent realistic
sample data as you normally would."""

    if base_url:
        url_constraint = f"""
!!HARD CONSTRAINT — URL: The ONLY permitted URL in any Navigate step is: {base_url}
- You MUST use exactly "{base_url}" as the Navigate URL. No exceptions.
- NEVER invent, guess, or substitute any other URL (e.g. example.com, acme.com, inventory-system.com).
- If the test scenario involves a subsystem (inventory, CS tool, admin panel), it still lives at {base_url}. Navigate there first.
- Violation: writing any URL other than {base_url} in a Navigate step is a critical error.\n"""
    else:
        url_constraint = ""

    return f"""You are an Expert QA Engineer writing steps for an AI browser agent.{url_constraint}{context_section}{test_data_section}
Expand this test case into clear, executable action steps.

Target Scenario:
- Title: {title}
- Type: {test_type}
- Objective: {objective}

STEP WRITING RULES:
1. Steps are USER ACTIONS only. No verify/assert/confirm/check/ensure/observe steps ever —
   the executor cannot act on these, they are dead weight. Every step must be a real browser
   action: navigate, click, type, press a key, select, or scroll. Nothing else.
2. Never reference HTML IDs, CSS selectors, or DOM attributes.
3. ALWAYS start from the application homepage. The URL to navigate to is specified in the
   HARD CONSTRAINT above — use it verbatim. Never navigate to a deep subpath directly.
   WRONG: "Navigate to https://en.wikipedia.org/wiki/Artificial_intelligence"
   RIGHT: "Navigate to https://en.wikipedia.org/" then "Search for 'Artificial intelligence'"
   If an Application Base URL is provided above, use THAT exact URL for the first Navigate step.
   NEVER invent a URL — only use the one provided.
4. For searching: ALWAYS use "Search for 'X'" immediately followed by "Press Enter" as the very
   next step — a search that is only typed and never submitted never shows a result page.
   WRONG: ["Search for 'Anonymous'"]  (leaves the term sitting in the box, nothing happens)
   RIGHT: ["Search for 'Anonymous'", "Press Enter"]
   Never use "Type X into search field" for this.
5. For form inputs: "Enter 'value' in the [field name]"
6. For clicks: "Click the [element name]"
7. Write 3-8 steps. Use realistic specific sample data (real names, real queries). The LAST step
   must be the final real action needed to reach the state being tested (e.g. the click, the
   keypress, the submission) — do not add a trailing step describing what should then be seen.
   Put what success looks like in expected_result instead, not in the steps list.
8. Exception to rule 4: if the objective is specifically about the autocomplete/suggestions
   dropdown itself (e.g. "autocomplete at 2 chars"), end on "Search for 'ar'" WITHOUT a Press
   Enter step — pressing Enter would submit the search and the dropdown wouldn't be the thing
   being tested anymore. Put "Autocomplete suggestions appear below the search box" in
   expected_result, not as a step. For every other search-related objective, rule 4 applies and
   Press Enter must follow the search step.
9. NEVER write a step that starts with "Perform:", "Perform", "Test that", "Check whether", or any
   other summary/restatement of the objective. Every single step must be one concrete, atomic
   browser action a person could literally do with a mouse and keyboard.
   WRONG: "Perform: Confirm that selecting a different language routes to the right subdomain"
   RIGHT: "Click the 'Languages' button" then "Click 'Deutsch'"
   (then expected_result: "The page reloads at the de.wikipedia.org subdomain")
10. If the objective itself describes an outcome rather than an action (e.g. "X correctly routes to Y",
    "Z displays the right behavior"), do NOT copy that phrasing into a step. Decompose it into the
    literal sequence of clicks/inputs that would trigger that outcome, and put the outcome itself
    in expected_result.

Return ONLY this JSON:
{{"title":"{title}","steps":["step1","step2","step3"],"expected_result":"what the user sees when test passes","type":"{test_type}"}}"""


def _enforce_feature_caps(blueprints: list, max_per_feature: int = MAX_PER_FEATURE) -> list:
    """
    Hard backstop for the per-feature cap the Pass 1 prompt asks for. Trims
    any feature_area beyond max_per_feature, keeping the first N encountered
    (Gemini tends to emit the clearest/most central scenarios for a feature
    first, and pad with near-duplicates later) rather than trusting the
    prompt alone — a model that ignores the instruction shouldn't be able to
    dump 15 login variants into the suite.

    max_per_feature is overridable per-category (see CATEGORY_CONFIG) since
    Data Driven is SUPPOSED to stack many variants of the same field, while
    UI/Smoke should stay tight.
    """
    seen_per_feature: dict = {}
    kept = []
    for bp in blueprints:
        feature = (bp.get("feature_area") or "Uncategorized").strip() or "Uncategorized"
        bp["feature_area"] = feature
        n = seen_per_feature.get(feature, 0)
        if n >= max_per_feature:
            continue
        seen_per_feature[feature] = n + 1
        kept.append(bp)
    return kept


def _feature_breakdown(blueprints: list) -> dict:
    breakdown: dict = {}
    for bp in blueprints:
        feature = (bp.get("feature_area") or "Uncategorized").strip() or "Uncategorized"
        breakdown[feature] = breakdown.get(feature, 0) + 1
    return breakdown


async def discover_test_blueprints(
    content: str = None,
    image_part: Any = None,
    image_parts: List[Any] = None,
    context: str = None,
    app_id: str = None,
    batch_label: str = None,
    existing_titles: List[str] = None
) -> dict:
    """
    Pass 1 — the AI decides how many blueprints this input needs (no fixed
    target from the user anymore). MIN_BLUEPRINTS/MAX_BLUEPRINTS below are
    guardrails, not goals: too few gets topped up, too many gets trimmed
    (feature-cap first, then a hard slice at MAX_BLUEPRINTS as a last resort).

    Returns a dict — not a bare list — so the caller can see and log/display
    *why* the count came out the way it did (feature_breakdown, whether
    bounds/top-up fired), per the "monitor this carefully" requirement.
    """
    base_prompt = _build_pass1_prompt(context, existing_titles)

    # Build the image list: prefer image_parts (multi-image), fall back to single image_part
    all_image_parts = image_parts if image_parts else ([image_part] if image_part else [])

    num_images = len(all_image_parts)
    input_text = "Analyze inputs and decide the right number of distinct testing blueprint items yourself, per the rules above.\n"
    if num_images > 1:
        input_text += f"\nNOTE: {num_images} screenshots have been provided, each showing a DIFFERENT page or state of the application. You MUST treat each screenshot as a separate feature area and distribute test coverage across ALL of them — do not focus on just one screenshot.\n"
    if content:
        input_text += f"\nRequirements content:\n{content}"
    contents = [base_prompt, input_text]
    for img in all_image_parts:
        contents.append(img)

    config = types.GenerateContentConfig(
        temperature=0.1,
        response_mime_type="application/json",
        response_schema=BlueprintListSchema,
        # Raised from 8192 — Functional's ceiling is now 100 blueprints
        # (CATEGORY_CONFIG), and ~100 {title, type, objective, feature_area}
        # objects doesn't reliably fit in 8192 output tokens. Under-sizing
        # this was exactly what made the truncation-repair path load-bearing
        # for large apps instead of an edge case; better to just give large
        # generations enough room in the first place.
        max_output_tokens=20000
    )

    for attempt in range(3):
        try:
            response = await _asyncio.to_thread(
                client.models.generate_content,
                model="gemini-3-flash-preview",
                contents=contents,
                config=config
            )
            tokens = _extract_tokens(response)
            _append_token_log({
                "id": f"gen-p1-{int(datetime.utcnow().timestamp()*1000)}",
                "timestamp": datetime.utcnow().isoformat(),
                "type": "generation_pass1",
                "model": "gemini-3-flash-preview",
                "app_id": app_id,
                "batch_label": batch_label,
                "input_tokens": tokens["input_tokens"],
                "output_tokens": tokens["output_tokens"],
                "total_tokens": tokens["total_tokens"],
            })
            try:
                parsed = _safe_parse_json(response.text)
                blueprints = parsed.get("blueprints", parsed) if isinstance(parsed, dict) else parsed
            except ValueError:
                blueprints = _repair_truncated_blueprints_json(response.text)
                if blueprints is None:
                    raise
                print(f"[Pass 1 recovery] Salvaged {len(blueprints)} complete blueprints from a "
                      f"truncated response — used instead of retrying.")
            if blueprints and isinstance(blueprints, list):
                topup_fired = False

                # ── Lower-bound guardrail: the AI decided fewer blueprints than
                # MIN_BLUEPRINTS. This can legitimately happen for a tiny single-page
                # input, but MIN_BLUEPRINTS is set low enough that going below it
                # usually means the model under-covered rather than the app being
                # genuinely that small — so top up rather than trust it blindly. ──
                if len(blueprints) < MIN_BLUEPRINTS:
                    shortfall = MIN_BLUEPRINTS - len(blueprints)
                    topup_fired = True
                    print(f"[Pass 1] AI decided on {len(blueprints)} blueprints — below the {MIN_BLUEPRINTS} floor, requesting {shortfall} more via top-up call.")
                    topup_titles = [b.get("title", "") for b in blueprints]
                    topup_prompt = f"""You are a Principal QA Architect.
A previous generation pass produced only {len(blueprints)} test blueprints for an application — too few
for meaningful coverage. You must generate {shortfall} ADDITIONAL blueprints that are completely
different from the ones already created, tagging each with a feature_area as before.

Already generated titles (DO NOT repeat or closely paraphrase any of these):
{chr(10).join(f'- {t}' for t in topup_titles)}

Generate {shortfall} new blueprints covering scenarios NOT yet covered above — look for feature
areas in the input that weren't covered at all yet, or genuinely distinct edge cases /
negative flows on features that only got a single positive test so far.
No single feature_area should end up with more than {MAX_PER_FEATURE} total blueprints once
combined with the list above.

You must return exactly {shortfall} blueprint objects, each meaningfully different from the list above."""

                    topup_contents = [topup_prompt]
                    for img in all_image_parts:
                        topup_contents.append(img)

                    try:
                        topup_response = await _asyncio.to_thread(
                            client.models.generate_content,
                            model="gemini-3-flash-preview",
                            contents=topup_contents,
                            config=types.GenerateContentConfig(
                                temperature=0.4,  # Higher temp for more creative edge cases
                                response_mime_type="application/json",
                                response_schema=BlueprintListSchema,
                                max_output_tokens=4096
                            )
                        )
                        topup_tokens = _extract_tokens(topup_response)
                        _append_token_log({
                            "id": f"gen-p1-topup-{int(datetime.utcnow().timestamp()*1000)}",
                            "timestamp": datetime.utcnow().isoformat(),
                            "type": "generation_pass1_topup",
                            "model": "gemini-3-flash-preview",
                            "app_id": app_id,
                            "batch_label": batch_label,
                            "input_tokens": topup_tokens["input_tokens"],
                            "output_tokens": topup_tokens["output_tokens"],
                            "total_tokens": topup_tokens["total_tokens"],
                        })
                        try:
                            topup_parsed = _safe_parse_json(topup_response.text)
                            topup_blueprints = topup_parsed.get("blueprints", topup_parsed) if isinstance(topup_parsed, dict) else topup_parsed
                        except ValueError:
                            topup_blueprints = _repair_truncated_blueprints_json(topup_response.text) or []
                        if topup_blueprints and isinstance(topup_blueprints, list):
                            blueprints = blueprints + topup_blueprints
                            print(f"[Pass 1 top-up] Added {len(topup_blueprints)} blueprints → total now {len(blueprints)}")
                    except Exception as topup_err:
                        print(f"[Pass 1 top-up error] {topup_err} — continuing with {len(blueprints)} blueprints")

                # ── Per-feature cap: hard backstop, not just a prompt instruction ──
                pre_cap_count = len(blueprints)
                blueprints = _enforce_feature_caps(blueprints)
                if len(blueprints) < pre_cap_count:
                    print(f"[Pass 1] Feature cap trimmed {pre_cap_count - len(blueprints)} over-represented blueprint(s) "
                          f"(> {MAX_PER_FEATURE} for the same feature_area).")

                # ── Upper-bound guardrail: last-resort slice if the AI still went
                # over MAX_BLUEPRINTS even after feature capping (e.g. a very large
                # number of legitimately distinct small feature areas). ──
                if len(blueprints) > MAX_BLUEPRINTS:
                    print(f"[Pass 1] {len(blueprints)} blueprints exceeds the {MAX_BLUEPRINTS} ceiling — trimming to {MAX_BLUEPRINTS}.")
                    blueprints = blueprints[:MAX_BLUEPRINTS]

                # Every blueprint from this pass is Functional — the other four
                # categories are generated separately in discover_all_blueprints,
                # each tagging its own blueprints with its own category.
                for bp in blueprints:
                    bp["category"] = "functional"

                return {
                    "blueprints": blueprints,
                    "ai_decided_count": len(blueprints),
                    "feature_breakdown": _feature_breakdown(blueprints),
                    "topup_fired": topup_fired,
                    "min_bound": MIN_BLUEPRINTS,
                    "max_bound": MAX_BLUEPRINTS,
                }
        except Exception as e:
            if attempt == 2:
                raise ValueError(f"Blueprint discovery failed after 3 attempts: {str(e)}")
            await _asyncio.sleep(1)
    return {"blueprints": [], "ai_decided_count": 0, "feature_breakdown": {}, "topup_fired": False, "min_bound": MIN_BLUEPRINTS, "max_bound": MAX_BLUEPRINTS}


async def discover_category_blueprints(
    category: str,
    target_count: int,
    feature_areas: List[str],
    content: str = None,
    image_parts: List[Any] = None,
    context: str = None,
    existing_titles: List[str] = None,
    app_id: str = None,
    batch_label: str = None,
) -> list:
    """
    One Pass-1-style call scoped to a single non-functional category
    (regression / data_driven / smoke_e2e / ui). target_count is a SOFT
    target — see _build_category_prompt — clamped to a tolerance band
    around it afterward rather than forced exact, same reasoning as the
    functional pass's "AI decides" but per-category.

    Deliberately simpler than discover_test_blueprints: no top-up retry if
    under-target (accepting fewer is fine — these are secondary categories,
    not worth a second Gemini call each), just a truncate if it runs over.
    Returns a plain list (not a dict) since the caller (discover_all_blueprints)
    aggregates all five categories' metadata itself.
    """
    meta = CATEGORY_CONFIG[category]
    base_prompt = _build_category_prompt(category, target_count, feature_areas, context, existing_titles)

    all_image_parts = image_parts or []
    input_text = f"Analyze the inputs and generate the {meta['label']} blueprints per the rules above.\n"
    if content:
        input_text += f"\nRequirements content:\n{content}"
    contents = [base_prompt, input_text] + list(all_image_parts)

    config = types.GenerateContentConfig(
        temperature=0.2,
        response_mime_type="application/json",
        response_schema=BlueprintListSchema,
        max_output_tokens=8192
    )

    for attempt in range(3):
        try:
            response = await _asyncio.to_thread(
                client.models.generate_content,
                model="gemini-3-flash-preview",
                contents=contents,
                config=config
            )
            tokens = _extract_tokens(response)
            _append_token_log({
                "id": f"gen-p1-{category}-{int(datetime.utcnow().timestamp()*1000)}",
                "timestamp": datetime.utcnow().isoformat(),
                "type": f"generation_pass1_{category}",
                "model": "gemini-3-flash-preview",
                "app_id": app_id,
                "batch_label": batch_label,
                "input_tokens": tokens["input_tokens"],
                "output_tokens": tokens["output_tokens"],
                "total_tokens": tokens["total_tokens"],
            })
            try:
                parsed = _safe_parse_json(response.text)
                blueprints = parsed.get("blueprints", parsed) if isinstance(parsed, dict) else parsed
            except ValueError:
                blueprints = _repair_truncated_blueprints_json(response.text)
                if blueprints is None:
                    raise
                print(f"[Pass 1 — {category} recovery] Salvaged {len(blueprints)} complete blueprints from a "
                      f"truncated response — used instead of retrying.")

            if blueprints and isinstance(blueprints, list):
                for bp in blueprints:
                    bp["category"] = category
                blueprints = _enforce_feature_caps(blueprints, max_per_feature=meta["max_per_feature"])
                if len(blueprints) > meta["max"]:
                    blueprints = blueprints[:meta["max"]]
                return blueprints
            return []
        except Exception as e:
            if attempt == 2:
                print(f"[Pass 1 — {category}] failed after 3 attempts: {e} — continuing with 0 blueprints for this category.")
                return []
            await _asyncio.sleep(1)
    return []


async def discover_all_blueprints(
    content: str = None,
    image_part: Any = None,
    image_parts: List[Any] = None,
    context: str = None,
    app_id: str = None,
    batch_label: str = None,
    existing_titles: List[str] = None,
) -> dict:
    """
    Orchestrates the full category split: Functional first (its count is the
    app-complexity signal), then the other four categories concurrently,
    each sized as a percentage of the overall suite derived from Functional's
    count (see CATEGORY_CONFIG's pct comment).

    Returns a dict combining all five categories:
      blueprints          — flat list, every item tagged with "category"
      ai_decided_count    — total across all categories
      category_breakdown  — {category: count}
      category_targets    — {category: {target, min, max}} — what was asked
                             for vs. CATEGORY_CONFIG bounds, for monitoring
      feature_breakdown   — per-feature counts across ALL categories combined
      topup_fired         — from the functional pass only (the only one that
                             ever retries for being under-target)
      min_bound/max_bound — functional's bounds, kept for the existing
                             "AI decided N (bounds: X–Y)" log line
    """
    all_image_parts = image_parts if image_parts else ([image_part] if image_part else [])

    # ── Functional first — everything else scales off its count ──
    functional_result = await discover_test_blueprints(
        content=content,
        image_parts=all_image_parts if all_image_parts else None,
        context=context,
        app_id=app_id,
        batch_label=batch_label,
        existing_titles=existing_titles,
    )
    functional_blueprints = functional_result["blueprints"]
    functional_count = len(functional_blueprints)
    feature_areas = sorted(_feature_breakdown(functional_blueprints).keys())

    functional_pct = CATEGORY_CONFIG["functional"]["pct"]
    # Guard against functional_count being 0 (e.g. discovery genuinely found
    # nothing) — fall back to the floor so the other categories still get a
    # sane minimum instead of dividing by zero / targeting 0 for everything.
    total_target = (functional_count / (functional_pct / 100)) if functional_count > 0 else CATEGORY_CONFIG["functional"]["min"] * 2

    category_targets: dict = {
        "functional": {"target": functional_count, "min": CATEGORY_CONFIG["functional"]["min"], "max": CATEGORY_CONFIG["functional"]["max"]}
    }

    other_categories = [c for c in CATEGORY_ORDER if c != "functional"]
    category_calls = []
    for cat in other_categories:
        meta = CATEGORY_CONFIG[cat]
        raw_target = round(total_target * meta["pct"] / 100)
        target = max(meta["min"], min(raw_target, meta["max"]))
        category_targets[cat] = {"target": target, "min": meta["min"], "max": meta["max"]}
        category_calls.append(discover_category_blueprints(
            category=cat,
            target_count=target,
            feature_areas=feature_areas,
            content=content,
            image_parts=all_image_parts if all_image_parts else None,
            context=context,
            existing_titles=existing_titles,
            app_id=app_id,
            batch_label=batch_label,
        ))

    # All four non-functional categories run concurrently — they're
    # independent Gemini calls, no reason to serialize them.
    other_results = await _asyncio.gather(*category_calls)

    all_blueprints = list(functional_blueprints)
    category_breakdown = {"functional": functional_count}
    for cat, result_blueprints in zip(other_categories, other_results):
        all_blueprints.extend(result_blueprints)
        category_breakdown[cat] = len(result_blueprints)

    return {
        "blueprints": all_blueprints,
        "ai_decided_count": len(all_blueprints),
        "category_breakdown": category_breakdown,
        "category_targets": category_targets,
        "feature_breakdown": _feature_breakdown(all_blueprints),
        "topup_fired": functional_result.get("topup_fired", False),
        "min_bound": functional_result.get("min_bound", MIN_BLUEPRINTS),
        "max_bound": functional_result.get("max_bound", MAX_BLUEPRINTS),
    }


def _ensure_press_enter_after_search(steps: list) -> list:
    """
    Deterministic safety net: the model doesn't always reliably add "Press
    Enter" after a "Search for 'X'" step, even when instructed to in the
    prompt. Rather than trust the model every time, walk the steps and
    insert "Press Enter" wherever a search step isn't immediately followed
    by one — guaranteeing every search actually gets submitted.

    Skips this for autocomplete-specific steps (where the step text itself
    mentions "autocomplete" or "suggestion"), matching the one intentional
    exception in the prompt rules.
    """
    if not steps:
        return steps

    result = []
    for i, step in enumerate(steps):
        result.append(step)
        s_lower = step.strip().lower()
        is_search_step = s_lower.startswith("search for")
        mentions_autocomplete = "autocomplete" in s_lower or "suggestion" in s_lower
        if is_search_step and not mentions_autocomplete:
            next_step = steps[i + 1].strip().lower() if i + 1 < len(steps) else ""
            if not next_step.startswith("press enter"):
                result.append("Press Enter")
    return result


async def expand_single_test_case(
    blueprint: dict,
    context: str = None,
    app_id: str = None,
    batch_label: str = None,
    test_data: dict = None,
    base_url: str = None,
    image_parts: List[Any] = None
) -> dict:
    import re as _re
    raw_objective = blueprint.get("objective", "Validate feature behavior.")
    clean_objective = _re.sub(
        r'^(validate that|verify that|ensure that|confirm that|check that|assert that|validate|verify|ensure|confirm|check|assert)\s+',
        '', raw_objective, flags=_re.IGNORECASE
    ).strip()
    if clean_objective:
        clean_objective = clean_objective[0].upper() + clean_objective[1:]

    prompt = _build_pass2_prompt(
        title=blueprint.get("title", "Untitled"),
        test_type=blueprint.get("type", "positive"),
        objective=clean_objective,
        context=context,
        test_data=test_data,
        base_url=base_url
    )

    # Pass 2 previously wrote steps blind — title/objective text only, no visual
    # grounding at all. That's fine for well-known UIs the model already "knows"
    # from pretraining, but for anything app-specific it was guessing. Same
    # screenshots Pass 1 used for blueprint discovery are passed here too, so
    # step-writing can actually look at the real page instead of assuming
    # generic patterns like a search bar that may not exist.
    contents = [prompt] + list(image_parts) if image_parts else prompt

    config = types.GenerateContentConfig(
        temperature=0.1,
        response_mime_type="application/json",
        response_schema=ExpandedTestCaseSchema,
        max_output_tokens=8192
    )

    last_error = None
    for attempt in range(3):
        try:
            response = await _asyncio.to_thread(
                client.models.generate_content,
                model="gemini-3-flash-preview",
                contents=contents,
                config=config
            )
            tokens = _extract_tokens(response)
            _append_token_log({
                "id": f"gen-p2-{int(datetime.utcnow().timestamp()*1000)}",
                "timestamp": datetime.utcnow().isoformat(),
                "type": "generation_pass2",
                "model": "gemini-3-flash-preview",
                "app_id": app_id,
                "batch_label": batch_label,
                "test_title": blueprint.get("title", "Untitled"),
                "input_tokens": tokens["input_tokens"],
                "output_tokens": tokens["output_tokens"],
                "total_tokens": tokens["total_tokens"],
            })
            try:
                parsed = _safe_parse_json(response.text)
            except ValueError:
                repaired = _repair_truncated_step_json(response.text)
                if repaired is None:
                    raise
                print(f"[Pass 2 recovery] Salvaged {len(repaired['steps'])} complete steps from a "
                      f"truncated response for '{blueprint.get('title', 'Untitled')}' — used instead of retrying.")
                parsed = repaired
            steps = parsed.get("steps", [])
            _SKIP_PREFIXES = (
                'verify', 'assert', 'confirm that', 'check that', 'ensure', 'validate',
                'perform', 'test that', 'check whether', 'confirm', 'check', 'observe'
            )
            steps = [s for s in steps if not s.strip().lower().startswith(_SKIP_PREFIXES)]
            steps = _ensure_press_enter_after_search(steps)
            if not steps or not isinstance(steps, list) or len(steps) < 2:
                raise ValueError(f"Insufficient steps ({len(steps)}) — retrying")
            parsed["steps"] = steps
            if "title" not in parsed:
                parsed["title"] = blueprint.get("title", "Untitled")
            if "type" not in parsed:
                parsed["type"] = blueprint.get("type", "positive")
            if "expected_result" not in parsed:
                parsed["expected_result"] = raw_objective
            # Category/feature_area live on the blueprint (assigned in Pass 1 /
            # discover_all_blueprints), not something Pass 2 decides — carry
            # them through unconditionally so every expanded test case stays
            # tagged with which category+feature it belongs to.
            parsed["category"] = blueprint.get("category", "functional")
            parsed["feature_area"] = blueprint.get("feature_area", "Uncategorized")
            return parsed
        except Exception as e:
            last_error = e
            # Previously silent — a failure here meant no one ever found out why,
            # they just saw a broken "Search for X" test case with no explanation.
            print(f"[Pass 2 generation error] attempt {attempt + 1}/3, blueprint "
                  f"'{blueprint.get('title', 'Untitled')}': {type(e).__name__}: {e}")
            if attempt < 2:
                await _asyncio.sleep(0.5)
                continue
            title = blueprint.get("title", "Untitled")
            # Previous fallback fabricated a full "Navigate → Search for X → Press
            # Enter" sequence guessing at UI that may not exist — that guaranteed
            # a wasted, billable execution run chasing a non-existent search bar.
            # Being honest costs nothing and doesn't burn execution tokens: a
            # single real navigate step, clearly flagged, so it's obvious at a
            # glance this test case needs to be regenerated rather than run.
            return {
                "title": f"⚠️ Generation failed — {title}",
                "steps": [f"Navigate to {base_url}" if base_url else "Navigate to the application homepage"],
                "expected_result": f"Automatic step generation failed after 3 attempts ({type(last_error).__name__}: {str(last_error)[:150]}). Please regenerate this test case.",
                "type": blueprint.get("type", "positive"),
                "category": blueprint.get("category", "functional"),
                "feature_area": blueprint.get("feature_area", "Uncategorized"),
            }


async def _expand_all(blueprints: list, context: str = None, app_id: str = None, batch_label: str = None, base_url: str = None, image_parts: List[Any] = None) -> list:
    semaphore = _asyncio.Semaphore(4)
    async def _expand_one(bp):
        async with semaphore:
            await _asyncio.sleep(0.1)
            return await expand_single_test_case(bp, context, app_id=app_id, batch_label=batch_label, base_url=base_url, image_parts=image_parts)
    return list(await _asyncio.gather(*[_expand_one(bp) for bp in blueprints]))


async def generate_test_cases_from_text(content: str, context: str = None, app_id: str = None, batch_label: str = None, base_url: str = None) -> list:
    result = await discover_test_blueprints(content=content, context=context, app_id=app_id, batch_label=batch_label)
    return await _expand_all(result["blueprints"], context, app_id=app_id, batch_label=batch_label, base_url=base_url)

async def generate_test_cases_from_image(image_bytes: bytes, media_type: str, context: str = None, app_id: str = None, batch_label: str = None, base_url: str = None) -> list:
    image_part = types.Part.from_bytes(data=image_bytes, mime_type=media_type)
    result = await discover_test_blueprints(image_part=image_part, context=context, app_id=app_id, batch_label=batch_label)
    return await _expand_all(result["blueprints"], context, app_id=app_id, batch_label=batch_label, base_url=base_url, image_parts=[image_part])

async def generate_test_cases_from_images(image_list: list, context: str = None, app_id: str = None, batch_label: str = None, base_url: str = None) -> list:
    """Multi-image variant: image_list is a list of (image_bytes, media_type) tuples.
    All images are passed to Gemini together so it can see every page/screen at once
    before generating blueprints — prevents anchoring on whichever single image was
    picked when multiple screenshots cover different features."""
    image_parts = [types.Part.from_bytes(data=b, mime_type=mt) for b, mt in image_list]
    result = await discover_test_blueprints(image_parts=image_parts, context=context, app_id=app_id, batch_label=batch_label)
    return await _expand_all(result["blueprints"], context, app_id=app_id, batch_label=batch_label, base_url=base_url, image_parts=image_parts)

async def generate_test_cases_from_both(content: str, image_bytes: bytes, media_type: str, context: str = None, app_id: str = None, batch_label: str = None, base_url: str = None) -> list:
    image_part = types.Part.from_bytes(data=image_bytes, mime_type=media_type)
    result = await discover_test_blueprints(content=content, image_part=image_part, context=context, app_id=app_id, batch_label=batch_label)
    return await _expand_all(result["blueprints"], context, app_id=app_id, batch_label=batch_label, base_url=base_url, image_parts=[image_part])

async def generate_test_cases_from_both_multi(content: str, image_list: list, context: str = None, app_id: str = None, batch_label: str = None, base_url: str = None) -> list:
    """Multi-image + text variant: image_list is a list of (image_bytes, media_type) tuples."""
    image_parts = [types.Part.from_bytes(data=b, mime_type=mt) for b, mt in image_list]
    result = await discover_test_blueprints(content=content, image_parts=image_parts, context=context, app_id=app_id, batch_label=batch_label)
    return await _expand_all(result["blueprints"], context, app_id=app_id, batch_label=batch_label, base_url=base_url, image_parts=image_parts)

def _looks_already_executable(steps_text: str) -> list | None:
    """
    Heuristic gate for the CSV import feature: manual QA steps that already
    read like atomic, literal actions (quoted values + action verbs, e.g.
    "Enter 'admin' in the Username field") don't need an AI rewrite at all —
    importing them as-is costs zero tokens and preserves the tester's exact
    wording. Returns the split step list if the text clears this bar, else
    None (caller should run the AI normalization pass instead).
    """
    lines = [l.strip() for l in re.split(r'[\n;]+', steps_text or "") if l.strip()]
    if len(lines) < 2:
        return None
    action_verbs = ('click', 'enter', 'select', 'navigate', 'type', 'check', 'choose',
                    'press', 'tap', 'verify', 'scroll', 'open', 'go to', 'submit')
    executable_count = sum(
        1 for l in lines
        if ("'" in l or '"' in l) and any(v in l.lower() for v in action_verbs)
    )
    # Require most lines to look atomic — a stray vague line mixed in with
    # otherwise-literal steps is fine and still safe to import verbatim.
    if executable_count >= max(2, int(len(lines) * 0.6)):
        return lines
    return None


async def normalize_manual_test_case(
    title: str,
    raw_steps_text: str,
    expected_result: str = None,
    app_id: str = None,
    batch_label: str = None,
    base_url: str = None,
    image_parts: List[Any] = None
) -> dict:
    """
    Converts one manually-written CSV test case into the same executable step
    format used everywhere else in the platform (matches ExpandedTestCaseSchema).
    Already-atomic steps are kept verbatim at zero AI cost via
    _looks_already_executable; only genuinely high-level/descriptive steps get
    rewritten via Gemini, using the same repair/retry approach as Pass 2 generation.
    """
    already_executable = _looks_already_executable(raw_steps_text)
    if already_executable:
        return {
            "title": title or "Untitled Test Case",
            "steps": already_executable,
            "expected_result": expected_result or "Passed",
            "type": "positive",
        }

    base_url_line = f"\nApplication base URL: {base_url}" if base_url else ""
    prompt = f"""You are converting a manually-written QA test case into precise, atomic,
machine-executable browser automation steps for a Playwright-based test runner.

Test case title: {title or "Untitled Test Case"}
Tester's original steps (may be high-level or vague):
\"\"\"{raw_steps_text}\"\"\"
Tester's original expected result: {expected_result or "(not specified — infer a reasonable one from the steps)"}{base_url_line}

Rewrite the steps as a JSON object with "title", "steps" (a list of 3-8 atomic actions,
each phrased like "Navigate to <url>", "Enter '<value>' in the <field> field",
"Click '<label>'", "Select '<option>' from the <name> dropdown"), and "expected_result".
Preserve the tester's original intent and expected outcome exactly — do not invent new
behavior or extra verification steps they did not ask for. If the tester's steps already
imply specific field values (like a username), keep those exact values.
"""

    config = types.GenerateContentConfig(
        temperature=0.1,
        response_mime_type="application/json",
        response_schema=ExpandedTestCaseSchema,
        max_output_tokens=8192
    )
    contents = [prompt] + list(image_parts) if image_parts else prompt

    last_error = None
    for attempt in range(3):
        try:
            response = await _asyncio.to_thread(
                client.models.generate_content,
                model="gemini-3-flash-preview",
                contents=contents,
                config=config
            )
            tokens = _extract_tokens(response)
            _append_token_log({
                "id": f"import-csv-{int(datetime.utcnow().timestamp()*1000)}",
                "timestamp": datetime.utcnow().isoformat(),
                "type": "csv_import_normalize",
                "model": "gemini-3-flash-preview",
                "app_id": app_id,
                "batch_label": batch_label,
                "test_title": title,
                "input_tokens": tokens["input_tokens"],
                "output_tokens": tokens["output_tokens"],
                "total_tokens": tokens["total_tokens"],
            })
            try:
                parsed = _safe_parse_json(response.text)
            except ValueError:
                repaired = _repair_truncated_step_json(response.text)
                if repaired is None:
                    raise
                print(f"[CSV import recovery] Salvaged {len(repaired['steps'])} complete steps "
                      f"from a truncated response for '{title}'.")
                parsed = repaired
            steps = parsed.get("steps", [])
            if not steps or not isinstance(steps, list) or len(steps) < 2:
                raise ValueError(f"Insufficient steps ({len(steps)}) — retrying")
            parsed["steps"] = steps
            parsed.setdefault("title", title or "Untitled Test Case")
            parsed.setdefault("expected_result", expected_result or "Passed")
            parsed.setdefault("type", "positive")
            return parsed
        except Exception as e:
            last_error = e
            print(f"[CSV import normalize error] attempt {attempt + 1}/3, '{title}': {type(e).__name__}: {e}")
            if attempt < 2:
                await _asyncio.sleep(0.5)
                continue
            return {
                "title": f"⚠️ Import normalization failed — {title or 'Untitled'}",
                "steps": [f"Navigate to {base_url}" if base_url else "Navigate to the application homepage"],
                "expected_result": f"Could not automatically convert this manual test case into executable steps ({type(last_error).__name__}: {str(last_error)[:150]}). Please edit manually.",
                "type": "positive",
            }