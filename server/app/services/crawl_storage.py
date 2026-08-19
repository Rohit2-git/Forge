"""
Storage for Crawler Agent artifacts (per-page screenshots).

Writes real files to disk under server/media/crawls/screenshots/ and returns
relative URL paths (e.g. "/media/crawls/screenshots/abc123.png") — served by
the same StaticFiles mount main.py already uses for execution screenshots, so
no new mount is needed. The DB stores these paths, not raw bytes.
"""
import os
import uuid

# server/app/services/crawl_storage.py -> up two levels -> server/
_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MEDIA_ROOT = os.path.join(_PROJECT_ROOT, "media")
CRAWL_SCREENSHOTS_DIR = os.path.join(MEDIA_ROOT, "crawls", "screenshots")

os.makedirs(CRAWL_SCREENSHOTS_DIR, exist_ok=True)


def save_crawl_screenshot(image_bytes: bytes) -> str:
    """Writes a crawled page's screenshot to disk, returns its web-relative path."""
    filename = f"{uuid.uuid4().hex}.png"
    full_path = os.path.join(CRAWL_SCREENSHOTS_DIR, filename)
    with open(full_path, "wb") as f:
        f.write(image_bytes)
    return f"/media/crawls/screenshots/{filename}"