"""Supabase Storage abstraction using the REST API (no pip dependencies).

Provides file operations against Supabase Storage buckets with user-scoped
paths: all files are stored under {userId}/{path} for isolation.

Uses urllib like supabase_client.py — zero external dependencies.
"""

import json
import os
import urllib.request
import urllib.parse
import urllib.error

_SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def _storage_url(bucket: str, path: str = "") -> str:
    """Build the Supabase Storage API URL."""
    base = f"{_SUPABASE_URL}/storage/v1/object"
    if path:
        return f"{base}/{bucket}/{path}"
    return f"{base}/{bucket}"


def _headers(*, content_type: str | None = None) -> dict[str, str]:
    h = {
        "apikey": _SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {_SERVICE_ROLE_KEY}",
    }
    if content_type:
        h["Content-Type"] = content_type
    return h


def upload_file(bucket: str, user_id: str, path: str, content_bytes: bytes,
                content_type: str = "application/octet-stream") -> dict:
    """Upload a file to Supabase Storage at {userId}/{path}.

    Uses upsert mode so existing files are overwritten.
    Returns the response dict on success, raises on error.
    """
    storage_path = f"{user_id}/{path}"
    url = _storage_url(bucket, storage_path)

    headers = _headers(content_type=content_type)
    headers["x-upsert"] = "true"

    req = urllib.request.Request(url, data=content_bytes, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        raise RuntimeError(f"Storage upload error ({e.code}): {body}")


def read_file(bucket: str, user_id: str, path: str) -> bytes:
    """Download a file from Supabase Storage at {userId}/{path}.

    Returns the raw bytes of the file.
    """
    storage_path = f"{user_id}/{path}"
    url = _storage_url(bucket, storage_path)

    req = urllib.request.Request(url, headers=_headers(), method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        raise RuntimeError(f"Storage read error ({e.code}): {body}")


def list_files(bucket: str, user_id: str, prefix: str = "") -> list[dict]:
    """List objects in Supabase Storage under {userId}/{prefix}.

    Returns a list of file metadata dicts.
    """
    list_url = f"{_SUPABASE_URL}/storage/v1/object/list/{bucket}"

    search_prefix = f"{user_id}/{prefix}" if prefix else f"{user_id}/"

    # Split into folder path and search string
    # The API expects prefix as the folder and search as a filter
    parts = search_prefix.rstrip("/").rsplit("/", 1)
    folder = parts[0] if len(parts) > 1 else ""
    search = parts[1] if len(parts) > 1 else parts[0]

    payload = json.dumps({
        "prefix": f"{user_id}/{prefix}" if prefix else f"{user_id}/",
        "limit": 1000,
        "offset": 0,
        "sortBy": {"column": "name", "order": "asc"},
    }).encode()

    headers = _headers(content_type="application/json")
    req = urllib.request.Request(list_url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        raise RuntimeError(f"Storage list error ({e.code}): {body}")


def delete_file(bucket: str, user_id: str, path: str) -> dict:
    """Remove a file from Supabase Storage at {userId}/{path}."""
    storage_path = f"{user_id}/{path}"
    delete_url = f"{_SUPABASE_URL}/storage/v1/object/{bucket}"

    payload = json.dumps({"prefixes": [storage_path]}).encode()
    headers = _headers(content_type="application/json")

    req = urllib.request.Request(delete_url, data=payload, headers=headers, method="DELETE")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        raise RuntimeError(f"Storage delete error ({e.code}): {body}")


def get_public_url(bucket: str, user_id: str, path: str) -> str:
    """Get the public URL for a file in a public bucket."""
    storage_path = f"{user_id}/{path}"
    return f"{_SUPABASE_URL}/storage/v1/object/public/{bucket}/{storage_path}"
