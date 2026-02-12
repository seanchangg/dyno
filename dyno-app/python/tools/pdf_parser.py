"""PDF parsing tool — extract text from PDFs.

Supports local files (from uploads) and remote URLs. Uses PyPDF2 for extraction,
which handles most PDFs well. For more advanced parsing (OCR, layout analysis),
can be extended with pdfplumber or camelot.
"""

import asyncio
import json
from pathlib import Path
from typing import Optional

from ._common import UPLOADS_DIR, DATA_DIR

# PyPDF2 is lightweight and widely available
try:
    from PyPDF2 import PdfReader
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False


async def _download_pdf(url: str, save_path: Path) -> bool:
    """Download a PDF from a URL using curl."""
    proc = await asyncio.create_subprocess_exec(
        "curl", "-L", "-o", str(save_path), url,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    await proc.communicate()
    return proc.returncode == 0 and save_path.exists()


def _extract_text_from_pdf(filepath: Path, max_pages: Optional[int] = None) -> dict:
    """Extract text from a PDF file."""
    if not HAS_PYPDF:
        return {
            "success": False,
            "error": "PyPDF2 not installed. Run: pip install PyPDF2",
            "text": "",
            "pages": 0,
        }

    try:
        reader = PdfReader(str(filepath))
        total_pages = len(reader.pages)
        pages_to_read = min(total_pages, max_pages) if max_pages else total_pages

        text_blocks = []
        for i in range(pages_to_read):
            page = reader.pages[i]
            text = page.extract_text()
            if text.strip():
                text_blocks.append(f"=== Page {i + 1} ===\n{text.strip()}")

        full_text = "\n\n".join(text_blocks)

        return {
            "success": True,
            "text": full_text,
            "pages": total_pages,
            "pages_read": pages_to_read,
            "chars": len(full_text),
            "error": None,
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "text": "",
            "pages": 0,
        }


async def handle_parse_pdf(input_data: dict) -> str:
    """Parse a PDF and extract text content.
    
    Args:
        input_data: {
            "source": str - file path (relative to uploads/) or URL
            "max_pages": int - optional limit on pages to read (default: all)
        }
    """
    source = input_data.get("source", "").strip()
    max_pages = input_data.get("max_pages")

    if not source:
        return json.dumps({
            "success": False,
            "error": "source is required (file path or URL)",
        })

    # Determine if source is URL or local file
    is_url = source.startswith("http://") or source.startswith("https://")

    if is_url:
        # Download to temp location
        temp_name = f"_tmp_{source.split('/')[-1]}"
        if not temp_name.endswith(".pdf"):
            temp_name += ".pdf"
        temp_path = DATA_DIR / temp_name

        success = await _download_pdf(source, temp_path)
        if not success:
            return json.dumps({
                "success": False,
                "error": f"Failed to download PDF from {source}",
            })

        result = _extract_text_from_pdf(temp_path, max_pages)
        
        # Clean up temp file
        try:
            temp_path.unlink()
        except OSError:
            pass

        result["source"] = source
        result["source_type"] = "url"

    else:
        # Local file in uploads
        filepath = UPLOADS_DIR / source
        if not filepath.exists():
            return json.dumps({
                "success": False,
                "error": f"File not found: {source} (looked in uploads/)",
            })

        result = _extract_text_from_pdf(filepath, max_pages)
        result["source"] = source
        result["source_type"] = "file"

    return json.dumps(result, indent=2)


# ── Tool definition ─────────────────────────────────────────────────────────

TOOL_DEFS = [
    {
        "name": "parse_pdf",
        "description": (
            "Extract text content from a PDF file. Supports local files "
            "(from uploads/) or remote URLs. Returns page-by-page text extraction. "
            "Useful for reading papers, reports, documentation, etc."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "source": {
                    "type": "string",
                    "description": (
                        "File path (relative to uploads/, e.g. 'paper.pdf') or "
                        "full URL (e.g. 'https://example.com/document.pdf')"
                    )
                },
                "max_pages": {
                    "type": "integer",
                    "description": (
                        "Optional limit on pages to read (useful for large PDFs). "
                        "Defaults to reading all pages."
                    )
                }
            },
            "required": ["source"]
        }
    }
]

HANDLERS = {
    "parse_pdf": handle_parse_pdf,
}

READ_ONLY = {"parse_pdf"}
