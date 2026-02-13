"""Code execution tools — run code and manage reusable scripts.

Supports one-off execution (execute_code) and persistent scripts that can
be saved, listed, and re-run to avoid burning inference tokens on repetitive
tasks.

When SANDBOX_MODE=docker (the default), all code runs inside a disposable
Docker container with no access to host secrets, filesystem, or services.
Set SANDBOX_MODE=unsafe to fall back to bare subprocess execution (dev only).
"""

import asyncio
import json
import os
import sys
import tempfile
import time
from pathlib import Path

from ._common import DATA_DIR, STORAGE_MODE, SCRIPTS_BUCKET

SCRIPTS_DIR = DATA_DIR / "scripts"
SCRIPTS_DIR.mkdir(parents=True, exist_ok=True)

# ── Sandbox configuration ─────────────────────────────────────────────────────

SANDBOX_MODE = os.getenv("SANDBOX_MODE", "docker")
SANDBOX_IMAGE = "dyno-sandbox:latest"
SANDBOX_DIR = Path(__file__).resolve().parent.parent / "sandbox"

_sandbox_ready = False

# ── Environment sanitization for subprocess execution ─────────────────────────
# Allowlist approach: only expose env vars that code execution legitimately needs.
# Everything else (secrets, internal keys, project paths) is stripped.

_ALLOWED_ENV_KEYS = {
    "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR",
    "HOME", "USER", "SHELL", "PYTHONDONTWRITEBYTECODE",
    "VIRTUAL_ENV",  # needed so venv Python resolves packages correctly
}


def _get_safe_env() -> dict[str, str] | None:
    """Return a sanitized environment dict for subprocess execution.

    Uses an allowlist: only known-safe env vars are passed through.
    In local mode, also allows through for developer convenience, but
    still strips secrets.
    """
    env = {}
    for key in _ALLOWED_ENV_KEYS:
        val = os.environ.get(key)
        if val is not None:
            env[key] = val
    return env

_LANG_CONFIG = {
    "python": {"ext": ".py", "cmd": [sys.executable]},
    "bash": {"ext": ".sh", "cmd": ["bash"]},
    "javascript": {"ext": ".js", "cmd": ["node"]},
    "typescript": {"ext": ".ts", "cmd": ["npx", "tsx"]},
    "cpp": {"ext": ".cpp", "cmd": None, "compiled": True},
}

# Map file extension → language name for the Docker entrypoint
_EXT_TO_LANG = {cfg["ext"]: lang for lang, cfg in _LANG_CONFIG.items()}


# ── Docker sandbox helpers ────────────────────────────────────────────────────

async def _ensure_sandbox_image() -> None:
    """Build the sandbox Docker image if it doesn't already exist."""
    global _sandbox_ready
    if _sandbox_ready:
        return

    # Check if image exists
    check = await asyncio.create_subprocess_exec(
        "docker", "image", "inspect", SANDBOX_IMAGE,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await check.wait()

    if check.returncode != 0:
        print(f"[sandbox] Building image {SANDBOX_IMAGE} from {SANDBOX_DIR} …")
        build = await asyncio.create_subprocess_exec(
            "docker", "build", "-t", SANDBOX_IMAGE, str(SANDBOX_DIR),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        b_stdout, b_stderr = await build.communicate()
        if build.returncode != 0:
            raise RuntimeError(
                f"Failed to build sandbox image:\n"
                f"{b_stderr.decode('utf-8', errors='replace')}"
            )
        print(f"[sandbox] Image built successfully.")

    _sandbox_ready = True


async def _run_file_docker(
    filepath: str,
    timeout: int,
    language: str,
    args: list[str] | None = None,
    stdin_data: str | None = None,
) -> dict:
    """Execute a file inside a disposable Docker container.

    The container gets:
    - No host filesystem access (only the script file mounted read-only)
    - Internet but host services blocked
    - Resource limits: 512 MB memory, 1 CPU, 64 PIDs
    - Read-only root FS + writable /tmp and /workspace (tmpfs)
    - Non-root ``sandbox`` user, no env vars from host
    """
    await _ensure_sandbox_image()

    ext = Path(filepath).suffix
    container_script = f"/workspace/script{ext}"

    docker_cmd = [
        "docker", "run", "--rm",
        "--network=bridge",
        "--add-host=host.docker.internal:0.0.0.0",
        "--memory=512m",
        "--cpus=1.0",
        "--pids-limit=64",
        "--read-only",
        "--tmpfs=/tmp:rw,exec,nosuid,size=100m",
        "--tmpfs=/workspace:rw,exec,nosuid,size=50m",
        "--security-opt=no-new-privileges",
        "-v", f"{filepath}:{container_script}:ro",
    ]

    if stdin_data:
        docker_cmd.append("-i")

    docker_cmd.extend([
        SANDBOX_IMAGE,
        language,
        container_script,
        *(args or []),
    ])

    process = await asyncio.create_subprocess_exec(
        *docker_cmd,
        stdin=asyncio.subprocess.PIPE if stdin_data else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    # Allow extra time for Docker overhead
    docker_timeout = timeout + 5

    try:
        stdin_bytes = stdin_data.encode("utf-8") if stdin_data else None
        stdout, stderr = await asyncio.wait_for(
            process.communicate(input=stdin_bytes), timeout=docker_timeout
        )
    except asyncio.TimeoutError:
        process.kill()
        # Also try to kill any lingering container (best-effort)
        await asyncio.create_subprocess_exec(
            "docker", "kill", "--signal=KILL",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        return {
            "stdout": "",
            "stderr": f"Execution timed out after {timeout}s",
            "exit_code": -1,
            "success": False,
        }

    return {
        "stdout": stdout.decode("utf-8", errors="replace"),
        "stderr": stderr.decode("utf-8", errors="replace"),
        "exit_code": process.returncode,
        "success": process.returncode == 0,
    }


# ── Unsafe (bare subprocess) execution — dev only ─────────────────────────────

async def _run_file_unsafe(
    filepath: str,
    timeout: int,
    args: list[str] | None = None,
    stdin_data: str | None = None,
) -> dict:
    """Execute a file directly as a host subprocess (UNSAFE — dev only).

    If *stdin_data* is provided it is piped to the process's stdin.
    C++ files (.cpp) are compiled with g++ first, then the binary is run.
    """
    ext = Path(filepath).suffix
    binary_path: str | None = None

    # ── C++ compilation step ──────────────────────────────────────────────
    if ext == ".cpp":
        binary_path = filepath.rsplit(".", 1)[0]
        compile_proc = await asyncio.create_subprocess_exec(
            "g++", "-std=c++17", "-o", binary_path, filepath,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(DATA_DIR),
            env=_get_safe_env(),
        )
        try:
            c_stdout, c_stderr = await asyncio.wait_for(
                compile_proc.communicate(), timeout=timeout
            )
        except asyncio.TimeoutError:
            compile_proc.kill()
            return {
                "stdout": "",
                "stderr": f"C++ compilation timed out after {timeout}s",
                "exit_code": -1,
                "success": False,
            }
        if compile_proc.returncode != 0:
            return {
                "stdout": c_stdout.decode("utf-8", errors="replace"),
                "stderr": c_stderr.decode("utf-8", errors="replace"),
                "exit_code": compile_proc.returncode,
                "success": False,
            }
        full_cmd = [binary_path, *(args or [])]
    else:
        cmd = None
        for cfg in _LANG_CONFIG.values():
            if cfg["ext"] == ext:
                cmd = cfg.get("cmd")
                break
        if not cmd:
            cmd = ["python3"]
        full_cmd = [*cmd, filepath, *(args or [])]

    # ── Run ────────────────────────────────────────────────────────────────
    process = await asyncio.create_subprocess_exec(
        *full_cmd,
        stdin=asyncio.subprocess.PIPE if stdin_data else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(DATA_DIR),
        env=_get_safe_env(),
    )

    try:
        stdin_bytes = stdin_data.encode("utf-8") if stdin_data else None
        stdout, stderr = await asyncio.wait_for(
            process.communicate(input=stdin_bytes), timeout=timeout
        )
    except asyncio.TimeoutError:
        process.kill()
        return {
            "stdout": "",
            "stderr": f"Execution timed out after {timeout}s",
            "exit_code": -1,
            "success": False,
        }
    finally:
        # Clean up compiled binary
        if binary_path:
            try:
                Path(binary_path).unlink(missing_ok=True)
            except OSError:
                pass

    return {
        "stdout": stdout.decode("utf-8", errors="replace"),
        "stderr": stderr.decode("utf-8", errors="replace"),
        "exit_code": process.returncode,
        "success": process.returncode == 0,
    }


# ── Dispatch: choose Docker or unsafe based on SANDBOX_MODE ──────────────────

async def _run_file(
    filepath: str,
    timeout: int,
    args: list[str] | None = None,
    stdin_data: str | None = None,
) -> dict:
    """Execute a file and return {stdout, stderr, exit_code, success}.

    Routes to Docker sandbox by default, or bare subprocess if
    SANDBOX_MODE=unsafe.
    """
    if SANDBOX_MODE == "docker":
        ext = Path(filepath).suffix
        language = _EXT_TO_LANG.get(ext, "python")
        return await _run_file_docker(
            filepath, timeout, language, args=args, stdin_data=stdin_data,
        )
    else:
        return await _run_file_unsafe(
            filepath, timeout, args=args, stdin_data=stdin_data,
        )


# ── execute_code: one-off execution ─────────────────────────────────────────

async def handle_execute_code(input_data: dict) -> str:
    """Execute code in a temporary file and return output."""
    code = input_data.get("code", "")
    language = input_data.get("language", "python")
    timeout = input_data.get("timeout", 30)
    stdin_data = input_data.get("stdin_data")

    if not code:
        return "Error: code is required"

    cfg = _LANG_CONFIG.get(language)
    if not cfg:
        return f"Error: unsupported language '{language}'. Supported: {', '.join(_LANG_CONFIG)}"

    # Write to temp file in scripts dir
    tmp_name = f"_tmp_{int(time.time() * 1000)}{cfg['ext']}"
    tmp_path = SCRIPTS_DIR / tmp_name

    try:
        tmp_path.write_text(code, encoding="utf-8")
        result = await _run_file(str(tmp_path), timeout, stdin_data=stdin_data)
        return json.dumps(result)
    finally:
        try:
            tmp_path.unlink()
        except OSError:
            pass


# ── save_script: persist a reusable script ───────────────────────────────────

def _make_header(name: str, description: str, language: str) -> str:
    """Build a metadata header comment for a script."""
    if language == "python":
        return f'# Script: {name}\n# Description: {description}\n# Language: {language}\n\n'
    elif language in ("javascript", "typescript"):
        return f'// Script: {name}\n// Description: {description}\n// Language: {language}\n\n'
    elif language == "bash":
        return f'#!/bin/bash\n# Script: {name}\n# Description: {description}\n\n'
    elif language == "cpp":
        return f'// Script: {name}\n// Description: {description}\n// Language: {language}\n\n'
    return ""


async def handle_save_script(input_data: dict) -> str:
    """Save a named script for later re-use."""
    name = input_data.get("name", "").strip()
    code = input_data.get("code", "")
    language = input_data.get("language", "python")
    description = input_data.get("description", "")

    if not name or not code:
        return "Error: name and code are required"

    cfg = _LANG_CONFIG.get(language)
    if not cfg:
        return f"Error: unsupported language '{language}'. Supported: {', '.join(_LANG_CONFIG)}"

    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)
    filename = f"{safe_name}{cfg['ext']}"
    header = _make_header(name, description, language)
    full_content = header + code

    meta = {
        "name": name,
        "filename": filename,
        "language": language,
        "description": description,
        "created_at": time.time(),
        "size_bytes": len(full_content.encode("utf-8")),
    }

    if STORAGE_MODE == "cloud":
        user_id = input_data.get("userId", "")
        if not user_id:
            return "Error: userId is required for cloud storage operations"
        try:
            from . import storage_client
            # Upload script file first
            storage_client.upload_file(
                SCRIPTS_BUCKET, user_id, filename,
                full_content.encode("utf-8"),
                "text/plain"
            )
            # Upload metadata — if this fails, clean up the script file
            try:
                storage_client.upload_file(
                    SCRIPTS_BUCKET, user_id, f"{safe_name}.meta.json",
                    json.dumps(meta, indent=2).encode("utf-8"),
                    "application/json"
                )
            except (RuntimeError, Exception) as meta_err:
                # Rollback: remove orphaned script file
                try:
                    storage_client.delete_file(SCRIPTS_BUCKET, user_id, filename)
                except Exception:
                    pass
                return f"Error saving script metadata: {meta_err}"
            return json.dumps({
                "saved": True,
                "name": name,
                "filename": filename,
                "size_bytes": meta["size_bytes"],
            })
        except RuntimeError as e:
            return f"Error: {e}"
        except Exception as e:
            return f"Error saving script: {e}"
    else:
        filepath = SCRIPTS_DIR / filename
        filepath.write_text(full_content, encoding="utf-8")
        meta["size_bytes"] = filepath.stat().st_size

        meta_path = SCRIPTS_DIR / f"{safe_name}.meta.json"
        meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

        return json.dumps({
            "saved": True,
            "name": name,
            "filename": filename,
            "path": str(filepath),
            "size_bytes": meta["size_bytes"],
        })


# ── run_script: execute a saved script ───────────────────────────────────────

async def handle_run_script(input_data: dict) -> str:
    """Run a previously saved script by name."""
    name = input_data.get("name", "").strip()
    args = input_data.get("args", [])
    timeout = input_data.get("timeout", 30)
    stdin_data = input_data.get("stdin_data")

    if not name:
        return "Error: name is required"

    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)

    if STORAGE_MODE == "cloud":
        user_id = input_data.get("userId", "")
        if not user_id:
            return "Error: userId is required for cloud storage operations"

        # Find which extension exists in cloud
        from . import storage_client
        found_ext = None
        found_content = None
        for cfg in _LANG_CONFIG.values():
            try:
                data = storage_client.read_file(
                    SCRIPTS_BUCKET, user_id, f"{safe_name}{cfg['ext']}"
                )
                found_ext = cfg["ext"]
                found_content = data
                break
            except RuntimeError:
                continue

        if not found_content:
            return f"Error: script '{name}' not found. Use list_scripts to see available scripts."

        # Write to temp file, execute, cleanup
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(
                suffix=found_ext, dir=str(SCRIPTS_DIR),
                delete=False, mode="wb"
            ) as tmp:
                tmp.write(found_content)
                tmp_path = tmp.name

            result = await _run_file(tmp_path, timeout, args, stdin_data=stdin_data)
            result["script"] = name
            return json.dumps(result)
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
    else:
        # Local mode
        found = None
        for cfg in _LANG_CONFIG.values():
            candidate = SCRIPTS_DIR / f"{safe_name}{cfg['ext']}"
            if candidate.exists():
                found = candidate
                break

        if not found:
            return f"Error: script '{name}' not found. Use list_scripts to see available scripts."

        result = await _run_file(str(found), timeout, args, stdin_data=stdin_data)
        result["script"] = name
        return json.dumps(result)


# ── list_scripts: show saved scripts ─────────────────────────────────────────

async def handle_list_scripts(input_data: dict) -> str:
    """List all saved scripts with metadata."""
    scripts = []

    if STORAGE_MODE == "cloud":
        user_id = input_data.get("userId", "")
        if not user_id:
            return "Error: userId is required for cloud storage operations"
        try:
            from . import storage_client
            files = storage_client.list_files(SCRIPTS_BUCKET, user_id, "")
            for f in files:
                if not isinstance(f, dict):
                    continue
                name = f.get("name", "")
                if name.endswith(".meta.json"):
                    try:
                        data = storage_client.read_file(SCRIPTS_BUCKET, user_id, name)
                        meta = json.loads(data.decode("utf-8"))
                        scripts.append(meta)
                    except (RuntimeError, json.JSONDecodeError, Exception):
                        continue
        except (RuntimeError, Exception) as e:
            return f"Error listing scripts: {e}"
    else:
        for meta_file in sorted(SCRIPTS_DIR.glob("*.meta.json")):
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
                scripts.append(meta)
            except (json.JSONDecodeError, OSError):
                continue

    if not scripts:
        return "No saved scripts yet. Use save_script to create one."

    lines = ["Saved scripts:\n"]
    for s in scripts:
        lines.append(f"  {s['name']} ({s['language']}) — {s.get('description', 'no description')}")
        lines.append(f"    File: {s['filename']} ({s.get('size_bytes', '?')} bytes)")
    return "\n".join(lines)


# ── delete_script: remove a saved script ─────────────────────────────────────

async def handle_delete_script(input_data: dict) -> str:
    """Delete a saved script by name."""
    name = input_data.get("name", "").strip()
    if not name:
        return "Error: name is required"

    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)
    deleted = []

    if STORAGE_MODE == "cloud":
        user_id = input_data.get("userId", "")
        if not user_id:
            return "Error: userId is required for cloud storage operations"

        from . import storage_client
        # Remove script file (any extension)
        for cfg in _LANG_CONFIG.values():
            try:
                storage_client.delete_file(
                    SCRIPTS_BUCKET, user_id, f"{safe_name}{cfg['ext']}"
                )
                deleted.append(f"{safe_name}{cfg['ext']}")
            except RuntimeError:
                pass

        # Remove metadata
        try:
            storage_client.delete_file(
                SCRIPTS_BUCKET, user_id, f"{safe_name}.meta.json"
            )
            deleted.append(f"{safe_name}.meta.json")
        except RuntimeError:
            pass
    else:
        for cfg in _LANG_CONFIG.values():
            candidate = SCRIPTS_DIR / f"{safe_name}{cfg['ext']}"
            if candidate.exists():
                candidate.unlink()
                deleted.append(candidate.name)

        meta_path = SCRIPTS_DIR / f"{safe_name}.meta.json"
        if meta_path.exists():
            meta_path.unlink()
            deleted.append(meta_path.name)

    if not deleted:
        return f"Error: script '{name}' not found"

    return f"Deleted script '{name}' ({', '.join(deleted)})"


# ── Tool definitions ────────────────────────────────────────────────────────

TOOL_DEFS = [
    {
        "name": "execute_code",
        "description": (
            "Execute code (Python, JavaScript, TypeScript, Bash, or C++) in a temporary file. "
            "Returns stdout, stderr, and exit code. Good for one-off calculations, "
            "data processing, or testing snippets. Optionally pipe JSON data to the process via stdin_data.\n\n"
            "IMPORTANT: Code runs in an isolated Docker container with pre-installed packages "
            "(requests, pandas, numpy, matplotlib, Pillow, etc.). Each execution is a fresh "
            "container — packages installed at runtime via pip are lost when execution ends. "
            "Do NOT pip install packages in execute_code and expect them in later execute_code "
            "or run_script calls. For widget backends, use save_script instead — saved scripts "
            "run in the same Docker sandbox and have the same pre-installed packages."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "The code to execute"
                },
                "language": {
                    "type": "string",
                    "enum": ["python", "bash", "javascript", "typescript", "cpp"],
                    "description": "Language/runtime (default: python)",
                    "default": "python"
                },
                "timeout": {
                    "type": "integer",
                    "description": "Timeout in seconds (default: 30, max: 120)",
                    "default": 30
                },
                "stdin_data": {
                    "type": "string",
                    "description": "Data to pipe to the process via stdin (e.g. JSON string)"
                }
            },
            "required": ["code"]
        }
    },
    {
        "name": "save_script",
        "description": (
            "Save a named, reusable script for later execution. Use this for "
            "repetitive tasks (data formatting, API calls, file processing) to "
            "avoid re-generating code each time. Scripts persist across sessions."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Script name (alphanumeric, dashes, underscores)"
                },
                "code": {
                    "type": "string",
                    "description": "The script source code"
                },
                "language": {
                    "type": "string",
                    "enum": ["python", "bash", "javascript", "typescript", "cpp"],
                    "description": "Language (default: python)",
                    "default": "python"
                },
                "description": {
                    "type": "string",
                    "description": "What this script does (for reference)"
                }
            },
            "required": ["name", "code"]
        }
    },
    {
        "name": "run_script",
        "description": (
            "Run a previously saved script by name. Optionally pass command-line "
            "arguments or pipe data via stdin. Much cheaper than regenerating "
            "code — use this for repetitive operations."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Name of the saved script to run"
                },
                "args": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Command-line arguments to pass to the script"
                },
                "timeout": {
                    "type": "integer",
                    "description": "Timeout in seconds (default: 30)",
                    "default": 30
                },
                "stdin_data": {
                    "type": "string",
                    "description": "Data to pipe to the process via stdin (e.g. JSON string)"
                }
            },
            "required": ["name"]
        }
    },
    {
        "name": "list_scripts",
        "description": "List all saved reusable scripts with their descriptions and metadata.",
        "input_schema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "delete_script",
        "description": "Delete a saved script by name.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Name of the script to delete"
                }
            },
            "required": ["name"]
        }
    },
]

HANDLERS = {
    "execute_code": handle_execute_code,
    "save_script": handle_save_script,
    "run_script": handle_run_script,
    "list_scripts": handle_list_scripts,
    "delete_script": handle_delete_script,
}

READ_ONLY = {"execute_code", "run_script", "list_scripts"}
