"""Skill CRUD tools — create, list, read, update, delete skill.md files.

Skills are markdown files with YAML frontmatter that get injected into the
agent's system prompt. In cloud mode, they're stored per-user in Supabase
Storage under workspace/{userId}/skills/{id}.md.

In local mode, they're stored in data/skills/{id}.md.
"""

import json
import re
import time
from pathlib import Path

from ._common import STORAGE_MODE, WORKSPACE_BUCKET, DATA_DIR

SKILLS_LOCAL_DIR = DATA_DIR / "skills"
SKILLS_LOCAL_DIR.mkdir(parents=True, exist_ok=True)

_MAX_SKILL_SIZE = 50 * 1024  # 50KB
_MAX_SKILLS = 50
_RESERVED_IDS = {"dyno-core", "skill-authoring"}
_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")  # kebab-case


def _validate_id(skill_id: str) -> str | None:
    """Validate a skill ID. Returns error message or None."""
    if not skill_id:
        return "Error: id is required"
    if skill_id in _RESERVED_IDS:
        return f"Error: '{skill_id}' is a reserved skill ID"
    if not _ID_PATTERN.match(skill_id):
        return "Error: id must be kebab-case (lowercase letters, numbers, hyphens)"
    if len(skill_id) > 64:
        return "Error: id must be 64 characters or fewer"
    return None


def _build_skill_md(skill_id: str, name: str, description: str, content: str,
                    tags: list[str] | None = None, version: str = "1.0.0") -> str:
    """Build a skill.md file with YAML frontmatter."""
    tag_str = f"[{', '.join(tags)}]" if tags else "[]"
    frontmatter = (
        f"---\n"
        f"id: {skill_id}\n"
        f"name: {name}\n"
        f"description: {description}\n"
        f"version: {version}\n"
        f"author: user\n"
        f"tags: {tag_str}\n"
        f"---\n\n"
    )
    return frontmatter + content


def _parse_frontmatter(raw: str) -> tuple[dict, str]:
    """Parse YAML frontmatter from a skill.md file."""
    match = re.match(r"^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$", raw)
    if not match:
        return {}, raw

    metadata = {}
    for line in match.group(1).split("\n"):
        colon_idx = line.find(":")
        if colon_idx == -1:
            continue
        key = line[:colon_idx].strip()
        value = line[colon_idx + 1:].strip()
        # Handle array values
        if value.startswith("[") and value.endswith("]"):
            metadata[key] = [v.strip().strip("\"'") for v in value[1:-1].split(",") if v.strip()]
        else:
            metadata[key] = value.strip("\"'")

    return metadata, match.group(2).strip()


# ── Cloud helpers ─────────────────────────────────────────────────────────────

def _cloud_skill_path(skill_id: str) -> str:
    return f"skills/{skill_id}.md"


def _cloud_upload(user_id: str, skill_id: str, content: str) -> None:
    from . import storage_client
    storage_client.upload_file(
        WORKSPACE_BUCKET, user_id, _cloud_skill_path(skill_id),
        content.encode("utf-8"), "text/markdown"
    )


def _cloud_read(user_id: str, skill_id: str) -> str:
    from . import storage_client
    data = storage_client.read_file(WORKSPACE_BUCKET, user_id, _cloud_skill_path(skill_id))
    return data.decode("utf-8")


def _cloud_delete(user_id: str, skill_id: str) -> None:
    from . import storage_client
    storage_client.delete_file(WORKSPACE_BUCKET, user_id, _cloud_skill_path(skill_id))


def _cloud_list(user_id: str) -> list[dict]:
    from . import storage_client
    files = storage_client.list_files(WORKSPACE_BUCKET, user_id, "skills/")
    return [f for f in files if f.get("name", "").endswith(".md")]


# ── Local helpers ─────────────────────────────────────────────────────────────

def _local_path(skill_id: str) -> Path:
    return SKILLS_LOCAL_DIR / f"{skill_id}.md"


# ── Handlers ──────────────────────────────────────────────────────────────────

async def handle_create_skill(input_data: dict) -> str:
    """Create a new skill.md file."""
    skill_id = input_data.get("id", "").strip()
    name = input_data.get("name", "").strip()
    description = input_data.get("description", "").strip()
    content = input_data.get("content", "")
    tags = input_data.get("tags", [])
    version = input_data.get("version", "1.0.0")

    # Validate
    err = _validate_id(skill_id)
    if err:
        return err
    if not name:
        return "Error: name is required"
    if not content:
        return "Error: content is required"

    skill_md = _build_skill_md(skill_id, name, description, content, tags, version)

    if len(skill_md.encode("utf-8")) > _MAX_SKILL_SIZE:
        return f"Error: Skill exceeds {_MAX_SKILL_SIZE // 1024}KB size limit"

    user_id = input_data.get("userId", "")

    if STORAGE_MODE == "cloud":
        if not user_id:
            return "Error: userId is required for cloud storage operations"

        # Check skill count limit
        existing = _cloud_list(user_id)
        if len(existing) >= _MAX_SKILLS:
            return f"Error: Maximum of {_MAX_SKILLS} skills reached. Delete unused skills first."

        # Check for duplicate
        try:
            _cloud_read(user_id, skill_id)
            return f"Error: Skill '{skill_id}' already exists. Use update_skill to modify it."
        except RuntimeError:
            pass  # Not found — good

        try:
            _cloud_upload(user_id, skill_id, skill_md)
            return json.dumps({
                "created": True,
                "id": skill_id,
                "name": name,
                "size_bytes": len(skill_md.encode("utf-8")),
                "note": "Skill will be active on next connection (page refresh).",
            })
        except RuntimeError as e:
            return f"Error: {e}"
    else:
        # Local mode
        path = _local_path(skill_id)
        if path.exists():
            return f"Error: Skill '{skill_id}' already exists. Use update_skill to modify it."

        existing = list(SKILLS_LOCAL_DIR.glob("*.md"))
        if len(existing) >= _MAX_SKILLS:
            return f"Error: Maximum of {_MAX_SKILLS} skills reached."

        path.write_text(skill_md, encoding="utf-8")
        return json.dumps({
            "created": True,
            "id": skill_id,
            "name": name,
            "path": str(path),
            "size_bytes": path.stat().st_size,
        })


async def handle_list_workspace_skills(input_data: dict) -> str:
    """List all workspace skills."""
    user_id = input_data.get("userId", "")

    if STORAGE_MODE == "cloud":
        if not user_id:
            return "Error: userId is required for cloud storage operations"

        try:
            files = _cloud_list(user_id)
            if not files:
                return "No workspace skills found. Use create_skill to add one."

            skills = []
            for f in files:
                name = f.get("name", "")
                if name.endswith(".md"):
                    skill_id = name[:-3]  # strip .md
                    metadata = f.get("metadata", {})
                    size = metadata.get("size", 0) if metadata else 0
                    skills.append({"id": skill_id, "size_bytes": size})

            return json.dumps({"skills": skills, "count": len(skills)})
        except RuntimeError as e:
            return f"Error: {e}"
    else:
        # Local mode
        skills = []
        for path in sorted(SKILLS_LOCAL_DIR.glob("*.md")):
            skill_id = path.stem
            raw = path.read_text(encoding="utf-8")
            meta, _ = _parse_frontmatter(raw)
            skills.append({
                "id": skill_id,
                "name": meta.get("name", skill_id),
                "description": meta.get("description", ""),
                "version": meta.get("version", "1.0.0"),
                "size_bytes": path.stat().st_size,
            })

        if not skills:
            return "No workspace skills found. Use create_skill to add one."

        return json.dumps({"skills": skills, "count": len(skills)})


async def handle_read_skill(input_data: dict) -> str:
    """Read a skill's full content."""
    skill_id = input_data.get("id", "").strip()
    if not skill_id:
        return "Error: id is required"

    user_id = input_data.get("userId", "")

    if STORAGE_MODE == "cloud":
        if not user_id:
            return "Error: userId is required for cloud storage operations"
        try:
            content = _cloud_read(user_id, skill_id)
            return content
        except RuntimeError:
            return f"Error: Skill '{skill_id}' not found"
    else:
        path = _local_path(skill_id)
        if not path.exists():
            return f"Error: Skill '{skill_id}' not found"
        return path.read_text(encoding="utf-8")


async def handle_update_skill(input_data: dict) -> str:
    """Update an existing skill. Reads current, merges changes, re-uploads."""
    skill_id = input_data.get("id", "").strip()
    if not skill_id:
        return "Error: id is required"

    user_id = input_data.get("userId", "")

    # Read existing
    if STORAGE_MODE == "cloud":
        if not user_id:
            return "Error: userId is required for cloud storage operations"
        try:
            existing_raw = _cloud_read(user_id, skill_id)
        except RuntimeError:
            return f"Error: Skill '{skill_id}' not found. Use create_skill to create it."
    else:
        path = _local_path(skill_id)
        if not path.exists():
            return f"Error: Skill '{skill_id}' not found. Use create_skill to create it."
        existing_raw = path.read_text(encoding="utf-8")

    # Parse existing
    meta, existing_content = _parse_frontmatter(existing_raw)

    # Merge updates
    name = input_data.get("name", meta.get("name", skill_id)).strip()
    description = input_data.get("description", meta.get("description", "")).strip()
    content = input_data.get("content", existing_content)
    tags = input_data.get("tags", meta.get("tags", []))
    version = input_data.get("version", meta.get("version", "1.0.0"))

    skill_md = _build_skill_md(skill_id, name, description, content, tags, version)

    if len(skill_md.encode("utf-8")) > _MAX_SKILL_SIZE:
        return f"Error: Skill exceeds {_MAX_SKILL_SIZE // 1024}KB size limit"

    if STORAGE_MODE == "cloud":
        try:
            _cloud_upload(user_id, skill_id, skill_md)
            return json.dumps({
                "updated": True,
                "id": skill_id,
                "name": name,
                "size_bytes": len(skill_md.encode("utf-8")),
                "note": "Changes take effect on next connection (page refresh).",
            })
        except RuntimeError as e:
            return f"Error: {e}"
    else:
        path = _local_path(skill_id)
        path.write_text(skill_md, encoding="utf-8")
        return json.dumps({
            "updated": True,
            "id": skill_id,
            "name": name,
            "size_bytes": path.stat().st_size,
        })


async def handle_delete_skill(input_data: dict) -> str:
    """Delete a skill by ID."""
    skill_id = input_data.get("id", "").strip()
    if not skill_id:
        return "Error: id is required"

    if skill_id in _RESERVED_IDS:
        return f"Error: Cannot delete reserved skill '{skill_id}'"

    user_id = input_data.get("userId", "")

    if STORAGE_MODE == "cloud":
        if not user_id:
            return "Error: userId is required for cloud storage operations"
        try:
            _cloud_delete(user_id, skill_id)
            return json.dumps({
                "deleted": True,
                "id": skill_id,
                "note": "Skill removed. Takes effect on next connection.",
            })
        except RuntimeError as e:
            return f"Error: {e}"
    else:
        path = _local_path(skill_id)
        if not path.exists():
            return f"Error: Skill '{skill_id}' not found"
        path.unlink()
        return json.dumps({"deleted": True, "id": skill_id})


# ── Tool definitions ──────────────────────────────────────────────────────────

TOOL_DEFS = [
    {
        "name": "create_skill",
        "description": (
            "Create a new skill.md file. Skills are markdown files with metadata that "
            "get injected into your system prompt, giving you domain knowledge and "
            "capabilities. Use this to codify recurring patterns, domain expertise, "
            "or specialized workflows."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "description": "Unique skill ID in kebab-case (e.g. 'data-analysis', 'email-drafting')"
                },
                "name": {
                    "type": "string",
                    "description": "Human-readable skill name"
                },
                "description": {
                    "type": "string",
                    "description": "Brief description of what this skill provides"
                },
                "content": {
                    "type": "string",
                    "description": "Markdown content — instructions, examples, patterns, etc."
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Categorization tags (e.g. ['analysis', 'data'])"
                },
                "version": {
                    "type": "string",
                    "description": "Semantic version (default: '1.0.0')"
                }
            },
            "required": ["id", "name", "content"]
        }
    },
    {
        "name": "list_workspace_skills",
        "description": "List all workspace skills you've created. Shows IDs, names, and sizes.",
        "input_schema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "read_skill",
        "description": "Read the full content of a workspace skill by ID.",
        "input_schema": {
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "description": "Skill ID to read"
                }
            },
            "required": ["id"]
        }
    },
    {
        "name": "update_skill",
        "description": (
            "Update an existing workspace skill. Provide only the fields you want to "
            "change — unspecified fields keep their current values."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "description": "Skill ID to update"
                },
                "name": {
                    "type": "string",
                    "description": "New name (optional)"
                },
                "description": {
                    "type": "string",
                    "description": "New description (optional)"
                },
                "content": {
                    "type": "string",
                    "description": "New markdown content (optional)"
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "New tags (optional)"
                },
                "version": {
                    "type": "string",
                    "description": "New version (optional)"
                }
            },
            "required": ["id"]
        }
    },
    {
        "name": "delete_skill",
        "description": "Delete a workspace skill by ID. Cannot delete reserved/bundled skills.",
        "input_schema": {
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "description": "Skill ID to delete"
                }
            },
            "required": ["id"]
        }
    },
]

HANDLERS = {
    "create_skill": handle_create_skill,
    "list_workspace_skills": handle_list_workspace_skills,
    "read_skill": handle_read_skill,
    "update_skill": handle_update_skill,
    "delete_skill": handle_delete_skill,
}

READ_ONLY = {"list_workspace_skills", "read_skill"}
