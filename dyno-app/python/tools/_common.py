"""Shared constants and helpers for all tool modules."""

import os
from pathlib import Path

# Everything lives inside the project: dyno-app/
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent  # dyno-app/

# ── Load .env.local into os.environ (won't override existing env vars) ─────
_ENV_LOCAL_PATH = PROJECT_ROOT / ".env.local"
try:
    for _line in _ENV_LOCAL_PATH.read_text().splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _key, _, _val = _line.partition("=")
        _key = _key.strip()
        _val = _val.strip().strip('"').strip("'")
        if _key not in os.environ:
            os.environ[_key] = _val
except FileNotFoundError:
    pass
DATA_DIR = PROJECT_ROOT / "data"
TOOLS_DIR = Path(__file__).resolve().parent.parent  # python/
SCREENSHOTS_DIR = DATA_DIR / "screenshots"
UPLOADS_DIR = DATA_DIR / "uploads"
SCRIPTS_DIR = DATA_DIR / "scripts"
WIDGETS_DIR = DATA_DIR / "widgets"

# Dual sandbox: bot can access its own code (python/) and its data (data/)
ALLOWED_BASES = [TOOLS_DIR, DATA_DIR]

# Directories the bot must never access
EXCLUDED_DIRS = {"node_modules", ".git", ".next", "src", ".venv", "__pycache__"}

# ── Cloud storage config ───────────────────────────────────────────────────
# STORAGE_MODE: "local" (default, uses filesystem) or "cloud" (uses Supabase Storage)
STORAGE_MODE = os.getenv("STORAGE_MODE", "local")

# Supabase Storage bucket names
WORKSPACE_BUCKET = "workspace"
WIDGETS_BUCKET = "widgets"
UPLOADS_BUCKET = "uploads"
SCRIPTS_BUCKET = "scripts"

# Frontend URL (for API calls to Next.js)
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

# Ensure directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
SCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
WIDGETS_DIR.mkdir(parents=True, exist_ok=True)


def safe_path(filename: str, base: Path | None = None, allowed_bases: list[Path] | None = None) -> Path:
    """Resolve a filename to a safe path within allowed directories.

    If `base` is given, resolve against that single base (legacy behavior).
    If `allowed_bases` is given, try each base and return the first valid match.
    If neither is given, uses ALLOWED_BASES.
    """
    if base is not None:
        resolved = (base / filename).resolve()
        if not str(resolved).startswith(str(base.resolve())):
            raise ValueError(f"Path escapes sandbox: {filename}")
        _check_excluded(resolved)
        return resolved

    bases = allowed_bases or ALLOWED_BASES
    # Try to find which base the path belongs to
    for b in bases:
        resolved = (b / filename).resolve()
        if str(resolved).startswith(str(b.resolve())):
            _check_excluded(resolved)
            return resolved

    raise ValueError(f"Path escapes sandbox: {filename}")


def _check_excluded(resolved: Path) -> None:
    """Raise if any component of the path is in EXCLUDED_DIRS."""
    for part in resolved.parts:
        if part in EXCLUDED_DIRS:
            raise ValueError(f"Access denied: path contains excluded directory '{part}'")
