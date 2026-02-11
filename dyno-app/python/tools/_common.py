"""Shared constants and helpers for all tool modules."""

from pathlib import Path

# Everything lives inside the project: dyno-app/data/
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent  # dyno-app/
DATA_DIR = PROJECT_ROOT / "data"
TOOLS_DIR = Path(__file__).resolve().parent.parent  # python/
SCREENSHOTS_DIR = DATA_DIR / "screenshots"
UPLOADS_DIR = DATA_DIR / "uploads"

# Ensure directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def safe_path(filename: str, base: Path = TOOLS_DIR) -> Path:
    """Resolve a filename to a safe path within a base directory."""
    resolved = (base / filename).resolve()
    if not str(resolved).startswith(str(base.resolve())):
        raise ValueError(f"Path escapes sandbox: {filename}")
    return resolved
