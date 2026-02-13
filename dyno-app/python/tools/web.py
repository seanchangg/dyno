"""Web fetching tool: fetch_url."""

import re
import urllib.request
import urllib.error
from html.parser import HTMLParser

TOOL_DEFS = [
    {
        "name": "fetch_url",
        "description": "Fetch the content of a URL. HTML tags are stripped for readability. Returns up to 10k characters.",
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL to fetch content from"
                }
            },
            "required": ["url"]
        }
    },
]

READ_ONLY = {"fetch_url"}


class _HTMLTextExtractor(HTMLParser):
    """Simple HTML-to-text converter that strips tags."""

    def __init__(self):
        super().__init__()
        self._parts: list[str] = []
        self._skip = False

    def handle_starttag(self, tag, _attrs):
        if tag in ("script", "style", "noscript"):
            self._skip = True

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self._skip = False

    def handle_data(self, data):
        if not self._skip:
            self._parts.append(data)

    def get_text(self) -> str:
        return " ".join(self._parts)


def strip_html(html: str) -> str:
    """Strip HTML tags and return readable text."""
    extractor = _HTMLTextExtractor()
    extractor.feed(html)
    return extractor.get_text()


async def handle_fetch_url(input_data: dict) -> str:
    url = input_data["url"]
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Marty-Agent/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            content_type = resp.headers.get("Content-Type", "")
            raw = resp.read(512_000).decode("utf-8", errors="replace")

        if "html" in content_type.lower() or raw.strip().startswith("<"):
            text = strip_html(raw)
        else:
            text = raw

        text = re.sub(r'\s+', ' ', text).strip()

        if len(text) > 10000:
            return text[:10000] + f"\n\n... (truncated, {len(text)} total chars)"
        return text
    except urllib.error.URLError as e:
        return f"Error fetching URL: {str(e)}"
    except Exception as e:
        return f"Error: {str(e)}"


HANDLERS = {
    "fetch_url": handle_fetch_url,
}
