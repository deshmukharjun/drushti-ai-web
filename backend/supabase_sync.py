"""
Upload incident frames to Supabase Storage and insert cheating_snapshots (service role).
Used by DrushtiAI Android sync — rows must use public HTTPS image_url.
"""

from __future__ import annotations

import traceback
import uuid
from typing import Optional

from supabase import Client, create_client

from .config import Config


def supabase_configured(config: Config) -> bool:
    """True if URL + key are present. The actual permission check happens at
    upload time — we let the API tell us if the key is wrong rather than
    second-guessing here."""
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
        print("[SUPABASE] Not configured — skipping upload.")
        return None

    bucket = config.supabase.bucket_name
    object_path = f"{exam_id}/{uuid.uuid4()}.jpg"

    try:
        client = _client(config)
    except Exception as e:
        print(f"[SUPABASE] create_client failed: {e}")
        return None

    # ── Read the JPEG bytes ────────────────────────────────────────────
    try:
        with open(local_file_path, "rb") as f:
            data = f.read()
    except Exception as e:
        print(f"[SUPABASE] Could not read snapshot file {local_file_path}: {e}")
        return None

    # ── Upload to Storage ──────────────────────────────────────────────
    try:
        client.storage.from_(bucket).upload(
            object_path,
            data,
            file_options={"content-type": "image/jpeg"},
        )
    except Exception as e:
        msg = str(e)
        print(f"[SUPABASE] Storage upload to {bucket}/{object_path} FAILED: {msg}")
        if "Bucket not found" in msg or "404" in msg:
            print(
                f"[SUPABASE] → Create the bucket: Supabase Dashboard → Storage → "
                f"New bucket → name='{bucket}', mark as PUBLIC."
            )
        elif "row-level security" in msg.lower() or "403" in msg or "401" in msg:
            print(
                "[SUPABASE] → Authentication/RLS rejected the upload. Double-check "
                "that SUPABASE_SERVICE_KEY in backend/.env is the service_role JWT "
                "(starts with 'eyJ'), not the publishable/anon key."
            )
        traceback.print_exc()
        return None

    try:
        image_url = _public_url(client, bucket, object_path)
    except Exception as e:
        print(f"[SUPABASE] get_public_url failed: {e}")
        return None

    # ── Insert row into cheating_snapshots ─────────────────────────────
    try:
        row = {
            "exam_id": exam_id,
            "image_url": image_url,
            "label": (label or "")[:500] or None,
        }
        client.table("cheating_snapshots").insert(row).execute()
    except Exception as e:
        msg = str(e)
        print(f"[SUPABASE] Insert into cheating_snapshots FAILED: {msg}")
        if "row-level security" in msg.lower() or "403" in msg:
            print(
                "[SUPABASE] → RLS rejected the insert. Either replace "
                "SUPABASE_SERVICE_KEY with the real service_role JWT, or add an "
                "RLS policy allowing inserts on cheating_snapshots."
            )
        traceback.print_exc()
        return None

    print(f"[SUPABASE] ✓ Uploaded {object_path} and inserted row for exam {exam_id}")
    return image_url
