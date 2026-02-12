"""Package installation tool: install_package.

Disabled entirely in cloud mode — users share the server, so installing
packages is unsafe. In local/dev mode, works as before.
"""

import re
import subprocess
from pathlib import Path
from ._common import STORAGE_MODE

_TOOL_DEFS = [
    {
        "name": "install_package",
        "description": "Install an npm package in the dyno-app directory.",
        "input_schema": {
            "type": "object",
            "properties": {
                "package_name": {
                    "type": "string",
                    "description": "Name of the npm package to install (e.g. 'lodash' or 'lodash@4.17.21')"
                }
            },
            "required": ["package_name"]
        }
    },
]

# In cloud mode, don't register the tool at all
TOOL_DEFS = _TOOL_DEFS if STORAGE_MODE != "cloud" else []

READ_ONLY: set[str] = set()


async def handle_install_package(input_data: dict) -> str:
    package_name = input_data["package_name"]
    if not re.match(r'^[a-zA-Z0-9@_./-]+$', package_name):
        return f"Error: Invalid package name: {package_name}"

    # Find the dyno-app directory (where package.json lives)
    dyno_app_dir = Path(__file__).parent.parent.parent
    if not (dyno_app_dir / "package.json").exists():
        return "Error: Cannot find dyno-app/package.json"

    try:
        result = subprocess.run(
            ["npm", "install", package_name],
            cwd=str(dyno_app_dir),
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            return f"Error installing {package_name}: {result.stderr.strip()}"
        return f"Installed {package_name} successfully"
    except subprocess.TimeoutExpired:
        return f"Error: npm install timed out for {package_name}"
    except FileNotFoundError:
        return "Error: npm not found. Is Node.js installed?"


HANDLERS = {
    "install_package": handle_install_package,
}
