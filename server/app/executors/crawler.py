"""
Crawler Agent — exhaustive same-origin site crawl that inventories every
interactive element's DOM details (tag, id, name, class, role, label, a
best-effort CSS selector, etc.) plus a full-page screenshot, page by page.

This is deliberately a *different* tool from the Coverage Index scout in
playwright.py:

  - Coverage Index (scout_application) is capped by a user-chosen page_limit,
    clusters elements by (route pattern, intent) so /product/1 and /product/2
    collapse into one workflow, and only keeps enough detail to estimate how
    many test cases a workflow deserves.

  - The Crawler Agent (this module) has no page cap the user sets — it keeps
    crawling same-origin pages until the queue is empty or it hits a hard
    internal safety ceiling (CRAWL_HARD_PAGE_CAP / CRAWL_HARD_DURATION_SEC,
    below) — and it keeps EVERY page + EVERY element's full DOM detail,
    unclustered, because the whole point is to hand that detail to the LLM
    at generation time so it can write selector-accurate, reliable steps
    instead of guessing at "the login button."

Results are streamed back to the caller one page at a time via the `on_page`
callback so the router can persist progress incrementally (and the frontend
can poll live status) instead of waiting for the entire crawl to finish.
"""
import asyncio
import re
import sys
import threading
import time as _time
from typing import Awaitable, Callable, Optional
from urllib.parse import urljoin, urlparse

from app.executors.playwright import _attempt_login

# ── Safety ceiling ───────────────────────────────────────────────────────
# The user explicitly does not set a page limit for this feature — it's
# supposed to crawl "the entire webpage." But an unbounded BFS on a site
# with e.g. infinite pagination or calendar-style date links would never
# terminate, so these are hard internal caps, not a user-facing setting.
# Crossing either one just stops the crawl early (status stays "completed",
# with whatever was found) rather than failing it.
CRAWL_HARD_PAGE_CAP = 300
CRAWL_HARD_DURATION_SEC = 20 * 60  # 20 minutes wall-clock
_MAX_EXPLORE_CLICKS_PER_PAGE = 15
# One page hanging (slow XHR polling, a modal that never settles, a click
# that spawns a popup Playwright waits on, etc.) must never be able to eat
# the crawl's entire time budget or wedge the loop indefinitely — cap the
# combined "visit + extract + click-explore" work for a single URL.
_PER_PAGE_HARD_TIMEOUT_SEC = 60

# Non-content link schemes/extensions we don't want clogging the queue.
_SKIP_HREF_PREFIXES = ("mailto:", "tel:", "javascript:", "#")
_SKIP_EXTENSIONS = (
    ".pdf", ".zip", ".rar", ".7z", ".exe", ".dmg", ".png", ".jpg", ".jpeg",
    ".gif", ".svg", ".webp", ".mp4", ".mp3", ".avi", ".mov", ".css", ".js",
    ".woff", ".woff2", ".ttf", ".ico",
)

# ── Cross-process cancellation, keyed by CrawlSession id ────────────────
_ACTIVE_CRAWL_CANCELLATIONS: dict = {}


def register_crawl_cancel_event(session_id: str) -> threading.Event:
    ev = threading.Event()
    _ACTIVE_CRAWL_CANCELLATIONS[session_id] = ev
    return ev


def request_crawl_stop(session_id: str) -> bool:
    ev = _ACTIVE_CRAWL_CANCELLATIONS.get(session_id)
    if ev:
        ev.set()
        return True
    return False


def clear_crawl_cancel_event(session_id: str) -> None:
    _ACTIVE_CRAWL_CANCELLATIONS.pop(session_id, None)


def _normalize_url(url: str) -> str:
    """Dedup key: same scheme+netloc+path+query, fragment stripped. Unlike
    the Coverage Index scout, this does NOT collapse route patterns — every
    distinct /product/1, /product/2, etc. is its own page, by design."""
    p = urlparse(url)
    query = f"?{p.query}" if p.query else ""
    return f"{p.scheme}://{p.netloc}{p.path.rstrip('/') or '/'}{query}"


def _should_skip_href(href: str) -> bool:
    if not href:
        return True
    h = href.strip().lower()
    if any(h.startswith(pfx) for pfx in _SKIP_HREF_PREFIXES):
        return True
    if any(h.split("?")[0].endswith(ext) for ext in _SKIP_EXTENSIONS):
        return True
    return False


_ELEMENT_EXTRACTION_JS = r"""
() => {
  function cssPath(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      let selector = node.tagName.toLowerCase();
      if (node.className && typeof node.className === 'string' && node.className.trim()) {
        const cls = node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(c => {
          try { return CSS.escape(c); } catch (e) { return c; }
        }).join('.');
        if (cls) selector += '.' + cls;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(s => s.tagName === node.tagName);
        if (siblings.length > 1) {
          selector += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }
      parts.unshift(selector);
      node = parent;
      depth++;
    }
    return parts.join(' > ');
  }

  const out = [];
  let counter = 0;
  const selectors = [
    'button', '[role="button"]', 'input', 'select', 'textarea', 'a[href]', 'form',
    '[role="link"]', '[role="checkbox"]', '[role="radio"]', '[role="tab"]',
    '[role="menuitem"]', '[role="combobox"]', '[role="searchbox"]', '[onclick]'
  ];
  const seen = new Set();
  selectors.forEach(sel => {
    let nodes;
    try { nodes = document.querySelectorAll(sel); } catch (e) { return; }
    nodes.forEach(el => {
      if (seen.has(el)) return;
      seen.add(el);
      const rect = el.getBoundingClientRect();
      const visible = !(rect.width === 0 && rect.height === 0);
      const label = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') ||
                     el.getAttribute('title') || el.value || '').toString().trim().slice(0, 120);
      const scoutId = 'crawl-el-' + (counter++);
      el.setAttribute('data-crawl-id', scoutId);
      out.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        name: el.getAttribute('name') || null,
        className: (typeof el.className === 'string' ? el.className : '') || null,
        type: el.getAttribute('type') || null,
        role: el.getAttribute('role') || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        placeholder: el.getAttribute('placeholder') || null,
        label: label,
        href: el.tagName.toLowerCase() === 'a' ? el.getAttribute('href') : null,
        value: (el.tagName.toLowerCase() === 'input' || el.tagName.toLowerCase() === 'button') ? (el.value || null) : null,
        dataTestId: el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa') || null,
        visible: visible,
        selector: cssPath(el),
        crawlId: scoutId,
      });
    });
  });
  return out;
}
"""


async def _extract_page_elements_detailed(page, page_url: str) -> list:
    try:
        raw = await page.evaluate(_ELEMENT_EXTRACTION_JS)
    except Exception as e:
        print(f"[Crawler] element extraction failed on {page_url}: {e}")
        return []
    return raw or []


def _run_in_new_loop(coro):
    """Same isolated-event-loop-in-a-thread pattern used by run_test_case /
    scout_application in playwright.py, so this plays nicely with FastAPI's
    already-running loop when called via loop.run_in_executor."""
    result_holder = {}

    def thread_target():
        if sys.platform == "win32":
            loop = asyncio.ProactorEventLoop()
        else:
            loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result_holder["result"] = loop.run_until_complete(coro)
        except Exception as e:
            result_holder["error"] = e
        finally:
            loop.close()

    t = threading.Thread(target=thread_target)
    t.start()
    t.join()

    if "error" in result_holder:
        raise result_holder["error"]
    return result_holder["result"]


async def _crawl_application(
    base_url: str,
    on_page: Callable[[dict], Awaitable[None]],
    login_fields: Optional[dict],
    cancel_event: Optional[threading.Event],
) -> dict:
    # pyrefly: ignore [missing-import]
    from playwright.async_api import async_playwright

    start = _time.time()
    origin_netloc = urlparse(base_url).netloc

    queue: list = [base_url]
    queued: set = {_normalize_url(base_url)}
    visited: set = set()
    pages_scanned = 0
    total_elements = 0
    auth_attempted = False
    auth_succeeded = False

    async def visit_and_report(page, url: str) -> list:
        """Loads a URL, extracts + screenshots it, reports via on_page, and
        returns the list of same-origin hrefs discovered for the queue."""
        nonlocal total_elements
        try:
            await page.goto(url, timeout=20000, wait_until="domcontentloaded")
            try:
                await page.wait_for_load_state("networkidle", timeout=6000)
            except Exception:
                pass
        except Exception as e:
            await on_page({
                "url": url, "title": None, "status": "failed",
                "errorMessage": str(e), "elements": [], "screenshot_bytes": None,
            })
            return []

        elements = await _extract_page_elements_detailed(page, url)
        total_elements += len(elements)
        try:
            title = await page.title()
        except Exception:
            title = None
        try:
            shot = await page.screenshot(type="png", full_page=True, timeout=15000)
        except Exception:
            shot = None

        await on_page({
            "url": page.url or url, "title": title, "status": "ok",
            "errorMessage": None, "elements": elements, "screenshot_bytes": shot,
        })

        new_links = []
        for el in elements:
            if el.get("tag") == "a" and el.get("href") and not _should_skip_href(el["href"]):
                abs_url = urljoin(page.url or url, el["href"])
                parsed = urlparse(abs_url)
                if parsed.netloc == origin_netloc and parsed.scheme in ("http", "https"):
                    norm = _normalize_url(abs_url)
                    if norm not in queued and norm not in visited:
                        new_links.append(abs_url)
                        queued.add(norm)
        return new_links

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-web-security"])
        context = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await context.new_page()

        try:
            # ── Auth bootstrap — identical intent to scout_application's:
            # login-walled apps have nothing to crawl beyond the login form
            # itself unless we sign in first, using this app's Test Data. ──
            if login_fields:
                try:
                    await page.goto(base_url, timeout=15000, wait_until="domcontentloaded")
                    try:
                        await page.wait_for_load_state("networkidle", timeout=5000)
                    except Exception:
                        pass
                    if await page.locator('input[type="password"]').count() > 0:
                        auth_attempted = True
                        auth_succeeded = await _attempt_login(page, login_fields)
                        if auth_succeeded:
                            queue = [page.url]
                            queued = {_normalize_url(page.url)}
                except Exception as e:
                    print(f"[Crawler] auth bootstrap failed: {e}")

            # ── Per-URL worker ───────────────────────────────────────────
            # Pulled out of the while-loop body so it can be wrapped in a
            # hard timeout (below) and a catch-all except. Previously an
            # unhandled exception ANYWHERE in here — a DB write inside
            # on_page() raising on an odd title/URL, a click hanging a
            # popup tab open, an evaluate() throwing on a page with a
            # locked-down CSP — propagated straight out of the while loop
            # and killed the entire crawl, which is exactly what "stops
            # after 3-4 pages and won't go deeper" looks like from the
            # outside: not a queueing bug, a single-page failure taking
            # the whole run down with it. One bad page must never be able
            # to do that; it should be skipped/marked failed and the crawl
            # should keep going.
            async def _process_page_url(url: str):
                nonlocal pages_scanned
                new_links = await visit_and_report(page, url)
                pages_scanned += 1
                queue.extend(new_links)

                # Best-effort click exploration for JS-driven nav (cart icons,
                # menus, "continue" buttons with no real href — AND anchor
                # tags whose href is just a placeholder like "#", which is
                # extremely common on SPA-style sites: the <a> exists for
                # styling/accessibility but real navigation happens via a JS
                # click handler, not the href). Previously this excluded ALL
                # <a> tags on the assumption real navigation always came
                # through a proper href — true for plain hrefs, false for
                # placeholder-href anchors, which fell into a gap between
                # "skipped as non-navigational" and "click-explored" and
                # silently stopped the crawl dead after one page on sites
                # built this way (e.g. saucedemo.com's Backbone.js routing).
                # Anchors with a real, followable href are still excluded
                # here since visit_and_report() above already queues those.
                if pages_scanned >= CRAWL_HARD_PAGE_CAP:
                    return
                try:
                    clickable = await page.evaluate(
                        "() => Array.from(document.querySelectorAll('[data-crawl-id]'))"
                        ".filter(el => {"
                        "  const tag = el.tagName.toLowerCase();"
                        "  if (tag !== 'a') return true;"
                        "  const href = (el.getAttribute('href') || '').trim();"
                        "  return href === '' || href === '#';"
                        "})"
                        ".slice(0, 40).map(el => el.getAttribute('data-crawl-id'))"
                    )
                except Exception:
                    clickable = []
                before_url = page.url
                for crawl_id in (clickable or [])[:_MAX_EXPLORE_CLICKS_PER_PAGE]:
                    if cancel_event is not None and cancel_event.is_set():
                        break
                    if pages_scanned >= CRAWL_HARD_PAGE_CAP:
                        break
                    try:
                        locator = page.locator(f'[data-crawl-id="{crawl_id}"]')
                        if await locator.count() == 0:
                            continue
                        # target="_blank"-style links open a new tab rather
                        # than navigating `page` itself — page.url below
                        # would then never change, the click would look like
                        # a no-op, and the orphaned tab would sit open
                        # consuming a browser process for the rest of the
                        # crawl. Track tab count and clean up if one appears.
                        pages_before_click = len(context.pages)
                        await locator.first.click(timeout=2000)
                        try:
                            await page.wait_for_load_state("networkidle", timeout=3000)
                        except Exception:
                            pass
                        if len(context.pages) > pages_before_click:
                            for extra in context.pages:
                                if extra is not page:
                                    try:
                                        await extra.close()
                                    except Exception:
                                        pass
                        after_url = page.url
                        navigated = after_url != before_url
                        is_new = navigated and _normalize_url(after_url) not in visited and _normalize_url(after_url) not in queued
                        if is_new:
                            queue.append(after_url)
                            queued.add(_normalize_url(after_url))
                        if navigated:
                            # Restore so the next candidate click starts clean —
                            # this must run for ANY navigation, not just newly
                            # discovered pages. Two elements on the same page
                            # (e.g. a product's image link and its title link)
                            # very commonly point at the SAME target — the
                            # second one to be clicked "navigates" but isn't a
                            # new discovery, and previously fell into the
                            # no-restore branch below meant for clicks that
                            # cause no navigation at all (dropdowns, modals).
                            # That left the browser sitting on that other page
                            # for the rest of THIS page's candidate list, and
                            # every remaining candidate silently found 0
                            # elements (its data-crawl-id marker only exists
                            # on the original page's DOM) and got skipped —
                            # which is exactly why exploration used to die
                            # after 1-2 candidates instead of trying all of
                            # them. Restoring on every navigation, duplicate
                            # target or not, fixes that.
                            #
                            # page.goto() is also a full reload, which wipes
                            # the data-crawl-id markers the initial extraction
                            # set on this page's elements — re-mark them here
                            # too, or every later candidate silently no-ops
                            # the same way.
                            try:
                                await page.goto(before_url, timeout=10000, wait_until="domcontentloaded")
                                try:
                                    await page.wait_for_load_state("networkidle", timeout=4000)
                                except Exception:
                                    pass
                                await _extract_page_elements_detailed(page, before_url)
                            except Exception:
                                pass
                        else:
                            try:
                                await page.keyboard.press("Escape")
                            except Exception:
                                pass
                    except Exception:
                        continue

            while queue and pages_scanned < CRAWL_HARD_PAGE_CAP and (_time.time() - start) < CRAWL_HARD_DURATION_SEC:
                if cancel_event is not None and cancel_event.is_set():
                    break
                url = queue.pop(0)
                norm = _normalize_url(url)
                if norm in visited:
                    continue
                visited.add(norm)

                scanned_before = pages_scanned
                try:
                    await asyncio.wait_for(_process_page_url(url), timeout=_PER_PAGE_HARD_TIMEOUT_SEC)
                except asyncio.TimeoutError:
                    print(f"[Crawler] page processing exceeded {_PER_PAGE_HARD_TIMEOUT_SEC}s, skipping and continuing: {url}")
                except Exception as e:
                    # Anything unexpected (including a DB error bubbling up
                    # through on_page) must not end the crawl — report this
                    # URL as failed if it never got reported, log, and move
                    # on to the next queued page.
                    print(f"[Crawler] unhandled error processing {url}, skipping and continuing: {e}")
                if pages_scanned == scanned_before:
                    # visit_and_report never got far enough to report+count
                    # this page (e.g. the timeout hit before it could, or an
                    # exception hit before the increment) — report it as
                    # failed so it's still visible in the UI, and count it
                    # so the crawl's page budget still reflects work done.
                    try:
                        await on_page({
                            "url": url, "title": None, "status": "failed",
                            "errorMessage": "Page processing timed out or crashed.",
                            "elements": [], "screenshot_bytes": None,
                        })
                    except Exception:
                        pass
                    pages_scanned += 1
        finally:
            await context.close()
            await browser.close()

    return {
        "pagesCrawled": pages_scanned,
        "totalElements": total_elements,
        "authAttempted": auth_attempted,
        "authSucceeded": auth_succeeded,
        "durationSec": round(_time.time() - start, 1),
        "hitSafetyCap": pages_scanned >= CRAWL_HARD_PAGE_CAP or (_time.time() - start) >= CRAWL_HARD_DURATION_SEC,
        "stopped": bool(cancel_event is not None and cancel_event.is_set()),
    }


async def crawl_application(
    base_url: str,
    on_page: Callable[[dict], Awaitable[None]],
    login_fields: Optional[dict] = None,
    cancel_event: Optional[threading.Event] = None,
) -> dict:
    """Public entrypoint. Runs the crawl in its own thread/event loop (same
    pattern as scout_application/run_test_case) so it doesn't fight FastAPI's
    loop, while still awaiting `on_page` (an async DB-writing callback) as
    each page completes. Because `on_page` needs to run on FastAPI's own
    event loop (it touches the Prisma client), it's scheduled back onto that
    loop via asyncio.run_coroutine_threadsafe from inside the worker thread.
    """
    caller_loop = asyncio.get_event_loop()

    async def on_page_threadsafe(page_result: dict):
        fut = asyncio.run_coroutine_threadsafe(on_page(page_result), caller_loop)
        return await asyncio.wrap_future(fut)

    # Simpler & safer: since _crawl_application already runs inside the
    # worker thread's OWN new loop (not caller_loop), calling the caller's
    # coroutine directly from there would attach it to the wrong loop. Route
    # through run_coroutine_threadsafe as above so `on_page` always executes
    # on the original FastAPI loop, regardless of which thread is crawling.
    coro = _crawl_application(base_url, on_page_threadsafe, login_fields, cancel_event)

    import functools
    fn = functools.partial(_run_in_new_loop, coro)
    result = await caller_loop.run_in_executor(None, fn)
    return result


async def crawl_single_page(base_url_page: str) -> dict:
    """Re-crawls exactly one page — used by the 'Recrawl this page' action in
    the Crawler Agent UI. Returns the same per-page shape `on_page` receives,
    minus the queue-discovery bookkeeping (irrelevant for a single page)."""
    # pyrefly: ignore [missing-import]
    from playwright.async_api import async_playwright

    async def _run():
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-web-security"])
            context = await browser.new_context(viewport={"width": 1280, "height": 800})
            page = await context.new_page()
            try:
                try:
                    await page.goto(base_url_page, timeout=20000, wait_until="domcontentloaded")
                    try:
                        await page.wait_for_load_state("networkidle", timeout=6000)
                    except Exception:
                        pass
                except Exception as e:
                    return {"url": base_url_page, "title": None, "status": "failed",
                            "errorMessage": str(e), "elements": [], "screenshot_bytes": None}

                elements = await _extract_page_elements_detailed(page, base_url_page)
                try:
                    title = await page.title()
                except Exception:
                    title = None
                try:
                    shot = await page.screenshot(type="png", full_page=True, timeout=15000)
                except Exception:
                    shot = None
                return {"url": page.url or base_url_page, "title": title, "status": "ok",
                        "errorMessage": None, "elements": elements, "screenshot_bytes": shot}
            finally:
                await context.close()
                await browser.close()

    import functools
    loop = asyncio.get_event_loop()
    fn = functools.partial(_run_in_new_loop, _run())
    result = await loop.run_in_executor(None, fn)
    return result