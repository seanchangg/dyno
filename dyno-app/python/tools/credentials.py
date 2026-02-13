"""Credential vault tools: get_credential, list_credentials.

Allows the agent to retrieve third-party API keys/tokens stored
by the user in the Credential Vault (Settings page).
"""

import json
import os
import urllib.request
import urllib.parse
import urllib.error

from ._common import FRONTEND_URL

# Gateway URL for credential retrieval (internal calls — always localhost)
_GATEWAY_HTTP = os.getenv("GATEWAY_INTERNAL_URL", "http://localhost:18789")

TOOL_DEFS = [
    {
        "name": "get_credential",
        "description": (
            "Retrieve a stored credential (API key, token, etc.) by name. "
            "Credentials are stored by the user in the Settings page Credential Vault. "
            "Returns the plaintext value. Always pass the userId from the system prompt."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "userId": {
                    "type": "string",
                    "description": "The user's ID (provided in the system prompt)"
                },
                "name": {
                    "type": "string",
                    "description": "Credential name (e.g. GMAIL_API_KEY, WEATHER_TOKEN)"
                }
            },
            "required": ["userId", "name"]
        }
    },
    {
        "name": "list_credentials",
        "description": (
            "List all credential names stored in the user's Credential Vault. "
            "Returns names only, not values. Always pass the userId from the system prompt."
        ),
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
]

READ_ONLY = {"get_credential", "list_credentials"}


async def handle_get_credential(input_data: dict) -> str:
    user_id = input_data.get("userId", "")
    name = input_data.get("name", "").strip()

    if not user_id:
        return "Error: userId is required"
    if not name:
        return "Error: credential name is required"

    payload = json.dumps({"userId": user_id, "name": name}).encode()
    req = urllib.request.Request(
        f"{_GATEWAY_HTTP}/api/credentials/retrieve",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            value = result.get("value", "")
            return value
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            err = json.loads(body)
            return f"Error: {err.get('error', body)}"
        except json.JSONDecodeError:
            return f"Error: {body}"
    except Exception as e:
        return f"Error retrieving credential: {str(e)}"


async def handle_list_credentials(input_data: dict) -> str:
    user_id = input_data.get("userId", "")

    if not user_id:
        return "Error: userId is required"

    try:
        url = f"{_GATEWAY_HTTP}/api/credentials?userId={urllib.parse.quote(user_id)}"
        with urllib.request.urlopen(url, timeout=10) as resp:
            result = json.loads(resp.read())
            credentials = result.get("credentials", [])

            if not credentials:
                return "No credentials stored. Add credentials in Settings > Credential Vault."

            names = [c["credential_name"] for c in credentials]
            return "Stored credentials: " + ", ".join(names)
    except Exception as e:
        return f"Error listing credentials: {str(e)}"


HANDLERS = {
    "get_credential": handle_get_credential,
    "list_credentials": handle_list_credentials,
}
