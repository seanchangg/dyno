"""Screenshot tools: take_screenshot, list_screenshots, read_screenshot.

Screenshots are captured locally via Playwright, then uploaded to Supabase
Storage through the Next.js API. Listing and reading also go through the API.
"""

import json
import os
import re
import time
import urllib.request
import urllib.error

from ._common import SCREENSHOTS_DIR, FRONTEND_URL, safe_path
from .memories import _get_user_id

API_BASE = FRONTEND_URL + "/api/screenshots"

TOOL_DEFS = [
    {
        "name": "take_screenshot",
        "description": "Capture a screenshot of a webpage URL. Uploads it to cloud storage and returns the public URL. Requires playwright to be installed. Always pass the userId from the system prompt.",
        "input_schema": {
            "type": "object",
            "properties": {
                "userId": {
                    "type": "string",
                    "description": "The user's ID (provided in the system prompt)"
                },
                "url": {
                    "type": "string",
                    "description": "The URL of the webpage to screenshot (e.g. 'https://example.com')"
                }
            },
            "required": ["userId", "url"]
        }
    },
    {
        "name": "list_screenshots",
        "description": "List all screenshots stored in the cloud. Returns filenames and public URLs sorted by most recent first. Always pass the userId from the system prompt.",
        "input_schema": {
            "type": "object",
            "properties": {
                "userId": {
                    "type": "string",
                    "description": "The user's ID (provided in the system prompt)"
                }
            },
            "required": ["userId"]
        }
    },
    {
        "name": "read_screenshot",
        "description": "Read metadata about a screenshot (size, creation time, public URL). Always pass the userId from the system prompt.",
        "input_schema": {
            "type": "object",
            "properties": {
                "userId": {
                    "type": "string",
                    "description": "The user's ID (provided in the system prompt)"
                },
                "filename": {
                    "type": "string",
                    "description": "Name of the screenshot file (e.g. 'example-com-1234567890.png')"
                }
            },
            "required": ["userId", "filename"]
        }
    },
]

READ_ONLY = {"take_screenshot", "list_screenshots", "read_screenshot"}


async def handle_take_screenshot(input_data: dict) -> str:
    url = input_data["url"]
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return "Error: playwright is not installed. Run: pip install playwright && python -m playwright install chromium"

    slug = re.sub(r'[^a-zA-Z0-9]+', '-', url.split("//")[-1])[:50].strip('-')
    ts = int(time.time())
    filename = f"{slug}-{ts}.png"
    filepath = SCREENSHOTS_DIR / filename

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page(viewport={"width": 1280, "height": 720})
            await page.goto(url, timeout=15000, wait_until="networkidle")
            await page.screenshot(path=str(filepath))
            await browser.close()

        size = filepath.stat().st_size
    except Exception as e:
        return f"Error taking screenshot: {str(e)}"

    # Upload to Supabase via the Next.js API
    user_id = _get_user_id(input_data)
    if user_id:
        try:
            public_url = _upload_to_api(filepath, filename, user_id)
            # Clean up local file after successful upload
            filepath.unlink(missing_ok=True)
            return f"Screenshot saved: {filename} ({size} bytes)\nPublic URL: {public_url}"
        except Exception as e:
            # Fall back to local-only if upload fails
            return f"Screenshot saved locally: {filename} ({size} bytes). Upload failed: {str(e)}"
    else:
        return f"Screenshot saved locally: {filename} ({size} bytes). No user ID available for cloud upload."


def _upload_to_api(filepath, filename: str, user_id: str) -> str:
    """Upload a screenshot file to the Next.js API endpoint using multipart form data."""
    import io

    boundary = f"----PythonBoundary{int(time.time() * 1000)}"

    body = io.BytesIO()

    # userId field
    body.write(f"--{boundary}\r\n".encode())
    body.write(f'Content-Disposition: form-data; name="userId"\r\n\r\n'.encode())
    body.write(f"{user_id}\r\n".encode())

    # filename field
    body.write(f"--{boundary}\r\n".encode())
    body.write(f'Content-Disposition: form-data; name="filename"\r\n\r\n'.encode())
    body.write(f"{filename}\r\n".encode())

    # file field
    body.write(f"--{boundary}\r\n".encode())
    body.write(f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode())
    body.write(b"Content-Type: image/png\r\n\r\n")
    with open(filepath, "rb") as f:
        body.write(f.read())
    body.write(b"\r\n")

    # End boundary
    body.write(f"--{boundary}--\r\n".encode())

    data = body.getvalue()
    req = urllib.request.Request(
        API_BASE,
        data=data,
        method="POST",
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(data)),
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read().decode())
    return result.get("publicUrl", "")


async def handle_list_screenshots(input_data: dict) -> str:
    user_id = _get_user_id(input_data)
    if not user_id:
        # Fall back to local listing
        return _list_local_screenshots()

    try:
        url = f"{API_BASE}?userId={urllib.parse.quote(user_id)}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        screenshots = data.get("screenshots", [])
        if not screenshots:
            return "No screenshots found."
        lines = []
        for s in screenshots:
            lines.append(f"{s['filename']} ({s.get('size', 0)} bytes) - {s.get('public_url', '')}")
        return "\n".join(lines)
    except Exception:
        return _list_local_screenshots()


def _list_local_screenshots() -> str:
    """Fallback: list screenshots from local directory."""
    files = sorted(SCREENSHOTS_DIR.iterdir(), key=lambda f: f.stat().st_mtime, reverse=True)
    files = [f for f in files if f.is_file() and not f.name.startswith(".")]
    if not files:
        return "No screenshots found."
    lines = []
    for f in files:
        stat = f.stat()
        age = time.time() - stat.st_mtime
        if age < 60:
            ago = f"{int(age)}s ago"
        elif age < 3600:
            ago = f"{int(age / 60)}m ago"
        else:
            ago = f"{int(age / 3600)}h ago"
        lines.append(f"{f.name} ({stat.st_size} bytes, {ago})")
    return "\n".join(lines)


async def handle_read_screenshot(input_data: dict) -> str:
    user_id = _get_user_id(input_data)
    if user_id:
        try:
            import urllib.parse
            url = f"{API_BASE}?userId={urllib.parse.quote(user_id)}"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
            screenshots = data.get("screenshots", [])
            filename = input_data["filename"]
            for s in screenshots:
                if s["filename"] == filename:
                    return (
                        f"Screenshot: {s['filename']}\n"
                        f"Public URL: {s.get('public_url', 'N/A')}\n"
                        f"Size: {s.get('size', 0)} bytes\n"
                        f"Created: {s.get('created_at', 'unknown')}"
                    )
            return f"Error: Screenshot not found in cloud: {filename}"
        except Exception:
            pass

    # Fallback to local
    filename = input_data["filename"]
    resolved = safe_path(filename, base=SCREENSHOTS_DIR)
    if not resolved.exists():
        return f"Error: Screenshot not found: {filename}"
    stat = resolved.stat()
    return (
        f"Screenshot: {filename}\n"
        f"Path: {resolved}\n"
        f"Size: {stat.st_size} bytes\n"
        f"Created: {time.ctime(stat.st_mtime)}"
    )


HANDLERS = {
    "take_screenshot": handle_take_screenshot,
    "list_screenshots": handle_list_screenshots,
    "read_screenshot": handle_read_screenshot,
}
