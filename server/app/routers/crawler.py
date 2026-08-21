"""
Crawler Agent — exhaustive site crawl (id/class/name/selector inventory per
element + a full-page screenshot per page), kept as its own feature separate
from the Coverage Index scout. See app/executors/crawler.py for why.

Endpoints:
  POST   /apps/{app_id}/crawler/start                 kick off a new crawl (background)
  POST   /apps/{app_id}/crawler/stop                   request the active crawl stop early
  GET    /apps/{app_id}/crawler/sessions               list this app's crawl sessions (newest first)
  GET    /apps/{app_id}/crawler/sessions/{session_id}  one session + its pages (light — no element JSON)
  GET    /apps/{app_id}/crawler/pages/{page_id}        one page's full detail, incl. element JSON
  PATCH  /apps/{app_id}/crawler/pages/{page_id}        user-edited element JSON for one page
  POST   /apps/{app_id}/crawler/pages/{page_id}/recrawl  re-crawl just this one page
  GET    /apps/{app_id}/crawler/sessions/{session_id}/export  full session as one downloadable JSON file
"""
import json
import logging
import traceback
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Depends, Response  # type: ignore
from pydantic import BaseModel  # type: ignore

from app.database import db
from app.auth.middleware import get_current_user
from app.executors.crawler import (
    crawl_application,
    crawl_single_page,
    register_crawl_cancel_event,
    request_crawl_stop,
    clear_crawl_cancel_event,
)
from app.services.crawl_storage import save_crawl_screenshot
from app.routers.scout import _resolve_login_fields  # reuse the same Test Data lookup the scout uses

router = APIRouter(prefix="/apps", tags=["crawler"])
logger = logging.getLogger("crawler.router")


def _serialize_session(session, pages=None) -> dict:
    out = {
        "id": session.id,
        "appId": session.appId,
        "baseUrl": session.baseUrl,
        "status": session.status,
        "errorMessage": session.errorMessage,
        "pagesCrawled": session.pagesCrawled,
        "totalElements": session.totalElements,
        "authAttempted": session.authAttempted,
        "authSucceeded": session.authSucceeded,
        "durationSec": session.durationSec,
        "createdAt": session.createdAt.isoformat() if session.createdAt else None,
        "finishedAt": session.finishedAt.isoformat() if session.finishedAt else None,
    }
    if pages is not None:
        out["pages"] = [_serialize_page_light(p) for p in pages]
    return out


def _serialize_page_light(page) -> dict:
    """Page summary without the (potentially large) element JSON — used for
    the gallery list so it stays fast even with hundreds of crawled pages."""
    return {
        "id": page.id,
        "sessionId": page.sessionId,
        "url": page.url,
        "title": page.title,
        "status": page.status,
        "errorMessage": page.errorMessage,
        "screenshotPath": page.screenshotPath,
        "elementCount": page.elementCount,
        "crawledAt": page.crawledAt.isoformat() if page.crawledAt else None,
        "editedAt": page.editedAt.isoformat() if page.editedAt else None,
    }


def _serialize_page_full(page) -> dict:
    out = _serialize_page_light(page)
    try:
        out["elements"] = json.loads(page.elements) if page.elements else []
    except (json.JSONDecodeError, TypeError):
        out["elements"] = []
    return out


async def _run_and_persist_crawl(session_id: str, app_id: str, base_url: str):
    login_fields = await _resolve_login_fields(app_id)
    cancel_event = register_crawl_cancel_event(session_id)

    async def on_page(page_result: dict):
        screenshot_path = None
        if page_result.get("screenshot_bytes"):
            try:
                screenshot_path = save_crawl_screenshot(page_result["screenshot_bytes"])
            except Exception as e:
                print(f"[Crawler] screenshot save failed: {e}")

        elements = page_result.get("elements") or []

        # NOTE: these two DB writes previously had zero error handling. If
        # either one threw (a Prisma validation error on an odd field, a
        # transient DB connection hiccup, a value too long for a column,
        # etc.) the exception propagated up through crawl_application(),
        # got caught by crawler.py's per-page catch-all/timeout wrapper two
        # layers up, and surfaced only as a generic "Page processing timed
        # out or crashed" — with no indication it was actually a DB write
        # failing. Wrapping it here with full traceback logging makes that
        # failure mode diagnosable instead of silently absorbed. We still
        # re-raise so the existing upstream handling (mark page/crawl as
        # failed, move on) is unchanged — this only adds visibility.
        try:
            await db.crawlpage.create(data={
                "sessionId": session_id,
                "url": page_result["url"],
                "title": page_result.get("title"),
                "status": page_result["status"],
                "errorMessage": page_result.get("errorMessage"),
                "screenshotPath": screenshot_path,
                "elements": json.dumps(elements),
                "elementCount": len(elements),
            })
        except Exception:
            logger.error(
                "[Crawler] crawlpage.create failed — sessionId=%s url=%s\n%s",
                session_id, page_result.get("url"), traceback.format_exc(),
            )
            raise

        try:
            # Live progress — the frontend polls the session endpoint while
            # status == "running" to show pages/elements found so far.
            await db.crawlsession.update(
                where={"id": session_id},
                data={
                    "pagesCrawled": {"increment": 1},
                    "totalElements": {"increment": len(elements)},
                },
            )
        except Exception:
            logger.error(
                "[Crawler] crawlsession.update (progress) failed — sessionId=%s url=%s\n%s",
                session_id, page_result.get("url"), traceback.format_exc(),
            )
            raise

    try:
        summary = await crawl_application(base_url, on_page, login_fields=login_fields, cancel_event=cancel_event)
        final_status = "stopped" if summary.get("stopped") else "completed"
        await db.crawlsession.update(
            where={"id": session_id},
            data={
                "status": final_status,
                "authAttempted": summary.get("authAttempted", False),
                "authSucceeded": summary.get("authSucceeded", False),
                "durationSec": summary.get("durationSec"),
                "finishedAt": datetime.utcnow(),
            },
        )
    except Exception as e:
        await db.crawlsession.update(
            where={"id": session_id},
            data={"status": "failed", "errorMessage": str(e), "finishedAt": datetime.utcnow()},
        )
    finally:
        clear_crawl_cancel_event(session_id)


@router.post("/{app_id}/crawler/start")
async def start_crawl(app_id: str, background_tasks: BackgroundTasks, current_user=Depends(get_current_user)):
    app_record = await db.application.find_unique(where={"id": app_id})
    if not app_record:
        raise HTTPException(status_code=404, detail="Application not found.")
    if not app_record.url or app_record.url == "http://localhost":
        raise HTTPException(status_code=400, detail="This application has no reachable URL configured.")

    # One crawl at a time per app — refuse a second start while one's running,
    # same spirit as the scout's single-cached-profile-per-app model.
    running = await db.crawlsession.find_first(where={"appId": app_id, "status": "running"})
    if running:
        raise HTTPException(status_code=409, detail="A crawl is already running for this application.")

    session = await db.crawlsession.create(data={
        "appId": app_id,
        "baseUrl": app_record.url,
        "status": "running",
    })
    background_tasks.add_task(_run_and_persist_crawl, session.id, app_id, app_record.url)
    return _serialize_session(session)


@router.post("/{app_id}/crawler/stop")
async def stop_crawl(app_id: str, current_user=Depends(get_current_user)):
    running = await db.crawlsession.find_first(where={"appId": app_id, "status": "running"})
    if not running:
        raise HTTPException(status_code=404, detail="No crawl is currently running for this application.")
    request_crawl_stop(running.id)
    return {"stopping": True, "sessionId": running.id}


@router.get("/{app_id}/crawler/sessions")
async def list_crawl_sessions(app_id: str, current_user=Depends(get_current_user)):
    sessions = await db.crawlsession.find_many(where={"appId": app_id}, order={"createdAt": "desc"}, take=25)
    return [_serialize_session(s) for s in sessions]


@router.get("/{app_id}/crawler/sessions/{session_id}")
async def get_crawl_session(app_id: str, session_id: str, current_user=Depends(get_current_user)):
    session = await db.crawlsession.find_unique(where={"id": session_id})
    if not session or session.appId != app_id:
        raise HTTPException(status_code=404, detail="Crawl session not found.")
    pages = await db.crawlpage.find_many(where={"sessionId": session_id}, order={"crawledAt": "asc"})
    return _serialize_session(session, pages)


@router.get("/{app_id}/crawler/pages/{page_id}")
async def get_crawl_page(app_id: str, page_id: str, current_user=Depends(get_current_user)):
    page = await db.crawlpage.find_unique(where={"id": page_id})
    if not page:
        raise HTTPException(status_code=404, detail="Crawled page not found.")
    session = await db.crawlsession.find_unique(where={"id": page.sessionId})
    if not session or session.appId != app_id:
        raise HTTPException(status_code=404, detail="Crawled page not found.")
    return _serialize_page_full(page)


class UpdatePageElementsRequest(BaseModel):
    elements: list


@router.patch("/{app_id}/crawler/pages/{page_id}")
async def update_crawl_page_elements(app_id: str, page_id: str, payload: UpdatePageElementsRequest, current_user=Depends(get_current_user)):
    """Lets the user hand-edit/augment what the crawler captured for one page
    — e.g. adding an element it missed, or fixing a selector — straight from
    the Crawler Agent UI, per the 'we can edit and add something if it
    missed something' requirement."""
    page = await db.crawlpage.find_unique(where={"id": page_id})
    if not page:
        raise HTTPException(status_code=404, detail="Crawled page not found.")
    session = await db.crawlsession.find_unique(where={"id": page.sessionId})
    if not session or session.appId != app_id:
        raise HTTPException(status_code=404, detail="Crawled page not found.")

    if not isinstance(payload.elements, list):
        raise HTTPException(status_code=400, detail="elements must be a JSON array.")

    updated = await db.crawlpage.update(
        where={"id": page_id},
        data={
            "elements": json.dumps(payload.elements),
            "elementCount": len(payload.elements),
            "editedAt": datetime.utcnow(),
        },
    )
    return _serialize_page_full(updated)


@router.post("/{app_id}/crawler/pages/{page_id}/recrawl")
async def recrawl_single_page(app_id: str, page_id: str, current_user=Depends(get_current_user)):
    """Targeted re-crawl of one page — for when the initial crawl missed a
    page's current state, or the user wants fresh data after a deploy,
    without re-running the entire site crawl."""
    page = await db.crawlpage.find_unique(where={"id": page_id})
    if not page:
        raise HTTPException(status_code=404, detail="Crawled page not found.")
    session = await db.crawlsession.find_unique(where={"id": page.sessionId})
    if not session or session.appId != app_id:
        raise HTTPException(status_code=404, detail="Crawled page not found.")

    try:
        result = await crawl_single_page(page.url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Recrawl failed: {str(e)}")

    screenshot_path = page.screenshotPath
    if result.get("screenshot_bytes"):
        try:
            screenshot_path = save_crawl_screenshot(result["screenshot_bytes"])
        except Exception as e:
            print(f"[Crawler] recrawl screenshot save failed: {e}")

    elements = result.get("elements") or []
    updated = await db.crawlpage.update(
        where={"id": page_id},
        data={
            "title": result.get("title"),
            "status": result["status"],
            "errorMessage": result.get("errorMessage"),
            "screenshotPath": screenshot_path,
            "elements": json.dumps(elements),
            "elementCount": len(elements),
            "editedAt": datetime.utcnow(),
        },
    )
    return _serialize_page_full(updated)


@router.get("/{app_id}/crawler/sessions/{session_id}/export")
async def export_crawl_session(app_id: str, session_id: str, current_user=Depends(get_current_user)):
    session = await db.crawlsession.find_unique(where={"id": session_id})
    if not session or session.appId != app_id:
        raise HTTPException(status_code=404, detail="Crawl session not found.")
    pages = await db.crawlpage.find_many(where={"sessionId": session_id}, order={"crawledAt": "asc"})

    export_obj = {
        "appId": app_id,
        "baseUrl": session.baseUrl,
        "status": session.status,
        "pagesCrawled": session.pagesCrawled,
        "totalElements": session.totalElements,
        "crawledAt": session.createdAt.isoformat() if session.createdAt else None,
        "pages": [_serialize_page_full(p) for p in pages],
    }
    body = json.dumps(export_obj, indent=2)
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="crawl_{session_id}.json"'},
    )