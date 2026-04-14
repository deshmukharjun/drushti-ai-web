"""
Upload incident frames to Supabase Storage and insert cheating_snapshots (service role).
Used by DrushtiAI Android sync — rows must use public HTTPS image_url.
"""

from __future__ import annotations

import uuid
from typing import Optional

from supabase import Client, create_client

from .config import Config


def supabase_configured(config: Config) -> bool:
    return bool(config.supabase.url and config.supabase.service_key)


def _client(config: Config) -> Client:
    return create_client(config.supabase.url, config.supabase.service_key)


def _public_url(client: Client, bucket: str, object_path: str) -> str:
    return client.storage.from_(bucket).get_public_url(object_path)


def upload_snapshot_and_insert(
    config: Config,
    exam_id: str,
    local_file_path: str,
    label: Optional[str],
) -> Optional[str]:
    """
    Upload JPEG to bucket at {exam_id}/{uuid}.jpg and insert cheating_snapshots row.
    Returns public image URL, or None on failure.
    """
    if not supabase_configured(config):
        return None
    try:
        client = _client(config)
        bucket = config.supabase.bucket_name
        object_path = f"{exam_id}/{uuid.uuid4()}.jpg"
        with open(local_file_path, "rb") as f:
            data = f.read()
        client.storage.from_(bucket).upload(
            object_path,
            data,
            file_options={"content-type": "image/jpeg"},
        )
        image_url = _public_url(client, bucket, object_path)
        row = {
            "exam_id": exam_id,
            "image_url": image_url,
            "label": (label or "")[:500] or None,
        }
        client.table("cheating_snapshots").insert(row).execute()
        return image_url
    except Exception as e:
        print(f"[WARN] Supabase snapshot sync failed: {e}")
        return None
