"""Web browsing tools — interactive browser automation and web search."""

import asyncio
import json
import re
import urllib.request
import urllib.parse
import urllib.error
from html.parser import HTMLParser
from pathlib import Path


# ── Web search (no API key needed, uses DuckDuckGo HTML) ────────────────────

class _DDGResultParser(HTMLParser):
    """Extract search results from DuckDuckGo HTML lite."""

    def __init__(self):
        super().__init__()
        self.results: list[dict] = []
        self._in_result_link = False
        self._in_snippet = False
        self._current: dict = {}
        self._text_buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        cls = attrs_dict.get("class", "")

        if tag == "a" and "result__a" in cls:
            self._in_result_link = True
            self._current = {"url": attrs_dict.get("href", ""), "title": ""}
            self._text_buf = []
        elif tag == "a" and "result__snippet" in cls:
            self._in_snippet = True
            self._text_buf = []

    def handle_endtag(self, tag):
        if tag == "a" and self._in_result_link:
            self._current["title"] = " ".join(self._text_buf).strip()
            self._in_result_link = False
        elif tag == "a" and self._in_snippet:
            self._current["snippet"] = " ".join(self._text_buf).strip()
            self._in_snippet = False
            if self._current.get("title"):
                self.results.append(self._current)
            self._current = {}

    def handle_data(self, data):
        if self._in_result_link or self._in_snippet:
            self._text_buf.append(data.strip())


async def handle_web_search(input_data: dict) -> str:
    """Search the web using DuckDuckGo HTML lite."""
    query = input_data.get("query", "").strip()
    max_results = input_data.get("max_results", 8)

    if not query:
        return "Error: query is required"

    url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote_plus(query)}"
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; Dyno-Agent/1.0)",
    }

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="replace")

        parser = _DDGResultParser()
        parser.feed(html)
        results = parser.results[:max_results]

        if not results:
            return f"No results found for: {query}"

        lines = [f"Search results for: {query}\n"]
        for i, r in enumerate(results, 1):
            lines.append(f"{i}. {r['title']}")
            lines.append(f"   URL: {r['url']}")
            if r.get("snippet"):
                lines.append(f"   {r['snippet']}")
            lines.append("")

        return "\n".join(lines)
    except Exception as e:
        return f"Error searching: {str(e)}"


# ── Interactive browser (Playwright) ────────────────────────────────────────

async def handle_browse_web(input_data: dict) -> str:
    """Browse the web with Playwright — navigate, interact, extract content."""
    url = input_data.get("url", "")
    actions = input_data.get("actions", [])
    extract_selector = input_data.get("extract_selector", "body")
    screenshot = input_data.get("screenshot", False)
    user_id = input_data.get("userId")

    if not url:
        return "Error: url is required"

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return (
            "Playwright not installed. Run: "
            "pip install playwright && playwright install chromium"
        )

    results = {
        "url": url,
        "success": True,
        "actions_performed": [],
        "content": None,
        "screenshot_path": None,
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/120.0.0.0 Safari/537.36"
        )

        try:
            await page.goto(url, wait_until="networkidle", timeout=30000)
            results["actions_performed"].append({"type": "navigate", "url": url})

            for action in actions:
                action_type = action.get("type")

                if action_type == "click":
                    selector = action.get("selector", "")
                    await page.click(selector, timeout=5000)
                    results["actions_performed"].append(
                        {"type": "click", "selector": selector}
                    )

                elif action_type == "type":
                    selector = action.get("selector", "")
                    text = action.get("text", "")
                    await page.fill(selector, text, timeout=5000)
                    results["actions_performed"].append(
                        {"type": "type", "selector": selector}
                    )

                elif action_type == "wait":
                    duration = action.get("duration", 1000)
                    await asyncio.sleep(duration / 1000)
                    results["actions_performed"].append(
                        {"type": "wait", "duration": duration}
                    )

                elif action_type == "scroll":
                    direction = action.get("direction", "down")
                    amount = action.get("amount", 500)
                    if direction == "down":
                        await page.evaluate(f"window.scrollBy(0, {amount})")
                    elif direction == "up":
                        await page.evaluate(f"window.scrollBy(0, -{amount})")
                    results["actions_performed"].append(
                        {"type": "scroll", "direction": direction}
                    )

                elif action_type == "extract":
                    selector = action.get("selector", "body")
                    element = await page.query_selector(selector)
                    if element:
                        text = await element.inner_text()
                        results["actions_performed"].append({
                            "type": "extract",
                            "selector": selector,
                            "text": text[:2000],
                        })

            # Extract final content
            try:
                element = await page.query_selector(extract_selector)
                if element:
                    text = await element.inner_text()
                else:
                    text = await page.inner_text("body")
            except Exception:
                text = await page.content()

            # Truncate for token efficiency
            text = re.sub(r'\s+', ' ', text).strip()
            if len(text) > 15000:
                text = text[:15000] + f"\n\n... (truncated, {len(text)} total chars)"
            results["content"] = text

            # Screenshot if requested
            if screenshot and user_id:
                import time as _time

                screenshot_dir = Path("data/screenshots") / user_id
                screenshot_dir.mkdir(parents=True, exist_ok=True)
                filename = f"browse-{int(_time.time())}.png"
                filepath = screenshot_dir / filename
                await page.screenshot(path=str(filepath), full_page=True)
                results["screenshot_path"] = str(filepath)

        except Exception as e:
            results["success"] = False
            results["error"] = str(e)
        finally:
            await browser.close()

    return json.dumps(results)


# ── Tool definitions ────────────────────────────────────────────────────────

TOOL_DEFS = [
    {
        "name": "web_search",
        "description": (
            "Search the web and return a list of results with titles, URLs, and "
            "snippets. Good for finding information, documentation, APIs, etc. "
            "Use fetch_url afterward to read a specific result page."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query"
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum results to return (default: 8)",
                    "default": 8
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "browse_web",
        "description": (
            "Launch a headless browser to navigate a URL, interact with the page "
            "(click, type, scroll), and extract content. More powerful than "
            "fetch_url for dynamic/JS-heavy sites or when you need to interact. "
            "Returns extracted text and action results."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "URL to navigate to"
                },
                "actions": {
                    "type": "array",
                    "description": "Sequence of actions to perform after navigation",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {
                                "type": "string",
                                "enum": [
                                    "click", "type", "wait",
                                    "scroll", "extract"
                                ],
                                "description": "Action type"
                            },
                            "selector": {
                                "type": "string",
                                "description": "CSS selector (for click/type/extract)"
                            },
                            "text": {
                                "type": "string",
                                "description": "Text to type (for type action)"
                            },
                            "duration": {
                                "type": "integer",
                                "description": "Wait duration in ms (for wait action)"
                            },
                            "direction": {
                                "type": "string",
                                "enum": ["up", "down"],
                                "description": "Scroll direction (for scroll action)"
                            },
                            "amount": {
                                "type": "integer",
                                "description": "Scroll amount in px (for scroll action)"
                            }
                        }
                    }
                },
                "extract_selector": {
                    "type": "string",
                    "description": "CSS selector to extract text from (default: body)"
                },
                "screenshot": {
                    "type": "boolean",
                    "description": "Capture a screenshot at the end (default: false)"
                },
                "userId": {
                    "type": "string",
                    "description": "User ID (from system prompt, required for screenshots)"
                }
            },
            "required": ["url"]
        }
    },
]

HANDLERS = {
    "web_search": handle_web_search,
    "browse_web": handle_browse_web,
}

READ_ONLY = {"web_search", "browse_web"}
