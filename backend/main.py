"""
FastAPI Backend for AntiCheat Vision System.

Provides REST API endpoints and WebSocket streaming for real-time
cheating detection alerts to the frontend dashboard.
"""

import os
import asyncio
import json
from datetime import datetime
from typing import Optional, List, Dict, Any
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import cv2
from fastapi.responses import JSONResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import load_config, Config
from .camera_manager import CameraManager, CameraInfo, CameraStatus, StreamResult
from .detector import DetectionResult
from .supabase_sync import supabase_configured, upload_snapshot_and_insert

# Load configuration
config = load_config()

# Initialize FastAPI app
app = FastAPI(
    title="AntiCheat Vision System API",
    description="Real-time cheating detection for exam surveillance",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.server.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global instances
camera_manager: Optional[CameraManager] = None
websocket_clients: Dict[str, List[WebSocket]] = {}  # camera_id -> list of websockets
incident_callbacks: List = []
# When starting a stream with an exam_id, detections upload to cheating_snapshots for the Android app.
camera_exam_ids: Dict[str, str] = {}
# Reference to the FastAPI event loop — needed because the camera processing
# thread cannot use asyncio.create_task() (no running loop in that thread).
main_event_loop: Optional[asyncio.AbstractEventLoop] = None


# -------------------- Pydantic Models --------------------

class CameraCreateRequest(BaseModel):
    """Request model for creating a camera."""
    name: str = Field(..., description="Human-readable camera name")
    stream_url: str = Field(..., description="Video source URL or path")
    location: str = Field("", description="Physical location description")


class CameraResponse(BaseModel):
    """Response model for camera info."""
    id: str
    name: str
    stream_url: str
    location: str
    is_active: bool
    status: str
    created_at: str


class IncidentResponse(BaseModel):
    """Response model for an incident."""
    id: Optional[str] = None
    camera_id: str
    behaviors: List[str]
    confidence: float
    snapshot_url: Optional[str] = None
    detected_at: str


class SettingsUpdateRequest(BaseModel):
    """Request model for updating detection settings."""
    yaw_threshold: Optional[float] = None
    look_duration: Optional[float] = None
    proximity_pix: Optional[int] = None
    proximity_duration: Optional[float] = None
    frame_skip: Optional[int] = None
    confidence_threshold: Optional[float] = None


# -------------------- Startup & Shutdown --------------------

@app.on_event("startup")
async def startup_event():
    """Initialize resources on startup."""
    global camera_manager, main_event_loop
    camera_manager = CameraManager(config)
    main_event_loop = asyncio.get_running_loop()
    print(f"[INFO] AntiCheat Vision System started")
    print(f"[INFO] Environment: {config.environment}")
    print(f"[INFO] Output directory: {config.camera.output_dir}")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup resources on shutdown."""
    global camera_manager
    if camera_manager:
        camera_manager.stop_all()
    print("[INFO] AntiCheat Vision System stopped")


# -------------------- Camera Endpoints --------------------

@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "running",
        "service": "anticheat-api",
        "version": "1.0.0",
        "active_cameras": camera_manager.get_active_count() if camera_manager else 0
    }


@app.post("/api/cameras", response_model=CameraResponse)
async def register_camera(request: CameraCreateRequest):
    """
    Register a new camera.

    Args:
        request: Camera creation request with name, stream_url, and location

    Returns:
        CameraInfo for the registered camera
    """
    try:
        camera_info = camera_manager.register_camera(
            name=request.name,
            stream_url=request.stream_url,
            location=request.location
        )
        return CameraResponse(
            id=camera_info.id,
            name=camera_info.name,
            stream_url=camera_info.stream_url,
            location=camera_info.location,
            is_active=camera_info.is_active,
            status=camera_info.status.value,
            created_at=camera_info.created_at.isoformat()
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/cameras", response_model=List[CameraResponse])
async def list_cameras():
    """
    List all registered cameras.

    Returns:
        List of CameraInfo objects
    """
    cameras = camera_manager.get_all_cameras()
    return [
        CameraResponse(
            id=cam.id,
            name=cam.name,
            stream_url=cam.stream_url,
            location=cam.location,
            is_active=cam.is_active,
            status=cam.status.value,
            created_at=cam.created_at.isoformat()
        )
        for cam in cameras
    ]


@app.get("/api/cameras/devices/available")
async def list_available_video_devices(max_index: int = 10):
    """
    List video capture device indices that OpenCV can open on this server machine.
    Use these values as stream_url when registering a local USB / built-in webcam.
    """
    max_index = max(1, min(max_index, 32))
    indices: List[int] = []
    for i in range(max_index):
        cap = cv2.VideoCapture(i)
        try:
            if cap.isOpened():
                indices.append(i)
        finally:
            cap.release()
    return {"indices": indices}


@app.get("/api/cameras/{camera_id}", response_model=CameraResponse)
async def get_camera(camera_id: str):
    """
    Get information about a specific camera.

    Args:
        camera_id: ID of the camera

    Returns:
        CameraInfo for the requested camera
    """
    camera_info = camera_manager.get_camera_info(camera_id)
    if not camera_info:
        raise HTTPException(status_code=404, detail="Camera not found")

    return CameraResponse(
        id=camera_info.id,
        name=camera_info.name,
        stream_url=camera_info.stream_url,
        location=camera_info.location,
        is_active=camera_info.is_active,
        status=camera_info.status.value,
        created_at=camera_info.created_at.isoformat()
    )


@app.delete("/api/cameras/{camera_id}")
async def unregister_camera(camera_id: str):
    """
    Unregister and remove a camera.

    Args:
        camera_id: ID of camera to remove

    Returns:
        Success message
    """
    if not camera_manager.unregister_camera(camera_id):
        raise HTTPException(status_code=404, detail="Camera not found")
    camera_exam_ids.pop(camera_id, None)
    return {"message": f"Camera {camera_id} removed"}


@app.post("/api/cameras/{camera_id}/start")
async def start_stream(camera_id: str, exam_id: Optional[str] = None):
    """
    Start processing a camera stream.

    Args:
        camera_id: ID of camera to start
        exam_id: Optional Supabase exams.id — when set with SUPABASE_* env, snapshots sync to cheating_snapshots

    Returns:
        Success message
    """
    if camera_id not in camera_manager.cameras:
        raise HTTPException(status_code=404, detail="Camera not found")

    cam_info = camera_manager.get_camera_info(camera_id)
    cam_name = cam_info.name if cam_info else '?'
    cam_url  = repr(cam_info.stream_url) if cam_info else '?'
    print(f"[API] POST /start | camera_id={camera_id} name='{cam_name}' stream_url={cam_url} exam_id={repr(exam_id)}")

    if exam_id and exam_id.strip():
        camera_exam_ids[camera_id] = exam_id.strip()
        print(f"[API] Exam tagged: camera {camera_id} → exam {exam_id.strip()}")
    else:
        camera_exam_ids.pop(camera_id, None)
        print(f"[API] No exam_id — stream will run without Supabase snapshot upload")

    # The camera runs in a background thread, so we must hand the coroutine
    # to the FastAPI event loop via run_coroutine_threadsafe.
    loop = main_event_loop

    def sync_callback(result: StreamResult):
        if loop is None or not loop.is_running():
            print("[WARN] Main event loop unavailable; dropping detection broadcast")
            return
        try:
            asyncio.run_coroutine_threadsafe(
                broadcast_detection(camera_id, result), loop
            )
        except Exception as e:
            print(f"[ERROR] Failed to schedule broadcast_detection: {e}")

    success = camera_manager.start_stream(camera_id, on_detection=sync_callback)

    if not success:
        raise HTTPException(status_code=500, detail="Failed to start stream")

    return {"message": f"Stream started for camera {camera_id}"}


@app.post("/api/cameras/{camera_id}/stop")
async def stop_stream(camera_id: str):
    """
    Stop processing a camera stream.

    Args:
        camera_id: ID of camera to stop

    Returns:
        Success message
    """
    if not camera_manager.stop_stream(camera_id):
        raise HTTPException(status_code=404, detail="Camera not found")
    camera_exam_ids.pop(camera_id, None)
    return {"message": f"Stream stopped for camera {camera_id}"}


@app.get("/api/cameras/{camera_id}/frame")
async def get_current_frame(camera_id: str):
    """
    Get the current frame from a camera (as base64).

    Args:
        camera_id: ID of camera

    Returns:
        Base64 encoded frame image
    """
    import base64

    frame = camera_manager.get_latest_frame(camera_id)
    if frame is None:
        raise HTTPException(status_code=404, detail="No frame available")

    # Encode frame as JPEG
    _, buffer = cv2.imencode('.jpg', frame)
    frame_base64 = base64.b64encode(buffer).decode('utf-8')

    return {"frame": frame_base64, "timestamp": datetime.now().isoformat()}


@app.get("/api/cameras/{camera_id}/snapshot.jpg")
async def get_snapshot_jpeg(camera_id: str):
    """
    Return the latest frame as a JPEG image (for <img> live preview in the dashboard).
    """
    if camera_id not in camera_manager.cameras:
        raise HTTPException(status_code=404, detail="Camera not found")
    frame = camera_manager.get_latest_frame(camera_id)
    if frame is None:
        raise HTTPException(status_code=404, detail="No frame available")
    ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 82])
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode frame")
    return Response(content=bytes(buffer), media_type="image/jpeg")


# -------------------- Incident Endpoints --------------------

# In-memory incident storage (replace with database in production)
incidents: List[Dict[str, Any]] = []


@app.get("/api/incidents", response_model=List[IncidentResponse])
async def list_incidents(
    camera_id: Optional[str] = None,
    behavior: Optional[str] = None,
    limit: int = 100
):
    """
    List incidents with optional filtering.

    Args:
        camera_id: Filter by camera ID
        behavior: Filter by behavior type
        limit: Maximum number of results

    Returns:
        List of incidents
    """
    filtered = incidents

    if camera_id:
        filtered = [i for i in filtered if i.get("camera_id") == camera_id]

    if behavior:
        filtered = [i for i in filtered if behavior in i.get("behaviors", [])]

    # Sort by timestamp descending
    filtered = sorted(filtered, key=lambda x: x.get("detected_at", ""), reverse=True)

    return [
        IncidentResponse(
            id=inc.get("id"),
            camera_id=inc.get("camera_id", ""),
            behaviors=inc.get("behaviors", []),
            confidence=inc.get("confidence", 0.0),
            snapshot_url=inc.get("snapshot_url"),
            detected_at=inc.get("detected_at", "")
        )
        for inc in filtered[:limit]
    ]


@app.get("/api/incidents/{incident_id}", response_model=IncidentResponse)
async def get_incident(incident_id: str):
    """
    Get a specific incident by ID.

    Args:
        incident_id: ID of the incident

    Returns:
        Incident details
    """
    for inc in incidents:
        if inc.get("id") == incident_id:
            return IncidentResponse(
                id=inc.get("id"),
                camera_id=inc.get("camera_id", ""),
                behaviors=inc.get("behaviors", []),
                confidence=inc.get("confidence", 0.0),
                snapshot_url=inc.get("snapshot_url"),
                detected_at=inc.get("detected_at", "")
            )
    raise HTTPException(status_code=404, detail="Incident not found")


@app.get("/api/incidents/export/csv")
async def export_incidents_csv():
    """
    Export incidents to CSV format.

    Returns:
        CSV file download
    """
    import csv
    import io

    output = io.StringIO()
    writer = csv.writer(output)

    # Header
    writer.writerow(["ID", "Camera ID", "Behaviors", "Confidence", "Snapshot URL", "Detected At"])

    # Data
    for inc in incidents:
        writer.writerow([
            inc.get("id", ""),
            inc.get("camera_id", ""),
            ",".join(inc.get("behaviors", [])),
            inc.get("confidence", 0.0),
            inc.get("snapshot_url", ""),
            inc.get("detected_at", "")
        ])

    output.seek(0)
    return JSONResponse(
        content={"csv": output.getvalue()},
        headers={"Content-Disposition": "attachment; filename=incidents.csv"}
    )


# -------------------- Settings Endpoints --------------------

@app.get("/api/settings")
async def get_settings():
    """
    Get current detection settings.

    Returns:
        Current configuration values
    """
    return {
        "yaw_threshold": config.detection.look_yaw_threshold_deg,
        "look_duration": config.detection.look_duration_sec,
        "proximity_pix": config.detection.proximity_pix,
        "proximity_duration": config.detection.proximity_duration_sec,
        "frame_skip": config.detection.frame_skip,
        "confidence_threshold": config.detection.yolo_min_conf,
        "gaze_threshold": config.detection.gaze_deviation_threshold
    }


@app.post("/api/settings")
async def update_settings(request: SettingsUpdateRequest):
    """
    Update detection settings at runtime.

    Args:
        request: Settings to update

    Returns:
        Updated settings
    """
    if request.yaw_threshold is not None:
        config.detection.look_yaw_threshold_deg = request.yaw_threshold

    if request.look_duration is not None:
        config.detection.look_duration_sec = request.look_duration

    if request.proximity_pix is not None:
        config.detection.proximity_pix = request.proximity_pix

    if request.proximity_duration is not None:
        config.detection.proximity_duration_sec = request.proximity_duration

    if request.frame_skip is not None:
        config.detection.frame_skip = request.frame_skip

    if request.confidence_threshold is not None:
        config.detection.yolo_min_conf = request.confidence_threshold

    return await get_settings()


# -------------------- WebSocket Endpoint --------------------

@app.websocket("/ws/feed/{camera_id}")
async def websocket_feed(websocket: WebSocket, camera_id: str):
    """
    WebSocket endpoint for real-time detection streaming.

    Push-only: every new detection is sent exactly once via
    broadcast_detection(). The connection is held open with periodic
    pings — we no longer poll get_latest_result() because that re-sent
    the same detection on every heartbeat and overloaded the dashboard.
    """
    await websocket.accept()

    if camera_id not in websocket_clients:
        websocket_clients[camera_id] = []
    websocket_clients[camera_id].append(websocket)

    try:
        while True:
            # Hold connection open. Real updates arrive via broadcast_detection.
            await asyncio.sleep(15.0)
            try:
                await websocket.send_json({"type": "ping"})
            except Exception:
                break
    except WebSocketDisconnect:
        pass
    finally:
        if camera_id in websocket_clients:
            try:
                websocket_clients[camera_id].remove(websocket)
            except ValueError:
                pass
            if not websocket_clients[camera_id]:
                del websocket_clients[camera_id]


@app.websocket("/ws/status")
async def websocket_status(websocket: WebSocket):
    """
    WebSocket endpoint for system status updates.

    Sends periodic status updates for all cameras.

    Args:
        websocket: WebSocket connection
    """
    await websocket.accept()

    try:
        while True:
            status = {
                "cameras": [
                    {
                        "id": cam.id,
                        "name": cam.name,
                        "status": cam.status.value,
                        "is_active": cam.is_active
                    }
                    for cam in camera_manager.get_all_cameras()
                ],
                "active_count": camera_manager.get_active_count(),
                "timestamp": datetime.now().isoformat()
            }
            await websocket.send_json(status)
            await asyncio.sleep(1.0)  # Status update interval

    except WebSocketDisconnect:
        pass


def _snapshot_label(behaviors: List[str]) -> str:
    if not behaviors:
        return "Incident"
    return ", ".join(behaviors)[:500]


async def broadcast_detection(camera_id: str, result: StreamResult):
    """
    Broadcast detection result to all connected WebSocket clients.

    Args:
        camera_id: ID of camera
        result: Detection result to broadcast
    """
    exam_id = camera_exam_ids.get(camera_id)

    # Only events with a saved snapshot are surfaced — this matches the 5-second
    # cooldown in the detector and keeps the dashboard alert count in sync with
    # the actual snapshot folder (and with Supabase).
    persisted: List[Dict[str, Any]] = []
    for detection in result.results:
        if not detection.snapshot_path:
            continue

        snapshot_url = f"/snapshots/{os.path.basename(detection.snapshot_path)}"

        # Upload to Supabase Storage + insert into cheating_snapshots so the
        # mobile app for this exam_id can fetch them. The file was written
        # synchronously by save_snapshot() inside the detector — no need to
        # re-check existence on disk.
        if exam_id and supabase_configured(config) and os.path.isfile(detection.snapshot_path):
            uploaded = await asyncio.to_thread(
                upload_snapshot_and_insert,
                config,
                exam_id,
                detection.snapshot_path,
                _snapshot_label(detection.behaviors),
            )
            if uploaded:
                snapshot_url = uploaded

        incident = {
            "id": os.path.basename(detection.snapshot_path).rsplit(".", 1)[0],
            "camera_id": camera_id,
            "behaviors": detection.behaviors,
            "confidence": detection.confidence,
            "snapshot_url": snapshot_url,
            "detected_at": detection.timestamp,
            "exam_id": exam_id,
        }
        incidents.append(incident)
        print(
            f"[INCIDENT] cam={camera_id} track={detection.track_id} "
            f"behaviors={detection.behaviors} conf={detection.confidence:.2f} "
            f"snap={os.path.basename(detection.snapshot_path)} "
            f"total_in_memory={len(incidents)}"
        )
        persisted.append({
            "track_id": detection.track_id,
            "behaviors": detection.behaviors,
            "confidence": detection.confidence,
            "timestamp": detection.timestamp,
            "snapshot_url": snapshot_url,
        })

    # Push to WebSocket clients ONLY when something was actually persisted.
    if persisted and camera_id in websocket_clients:
        data = {
            "camera_id": result.camera_id,
            "timestamp": result.timestamp,
            "detections": persisted,
        }
        for ws in list(websocket_clients[camera_id]):
            try:
                await ws.send_json(data)
            except Exception:
                pass  # Client disconnected


# -------------------- Snapshot Endpoints --------------------

@app.get("/snapshots/{filename}")
async def get_snapshot(filename: str):
    """
    Get a snapshot image.

    Args:
        filename: Name of the snapshot file

    Returns:
        Image file
    """
    filepath = os.path.join(config.camera.output_dir, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return FileResponse(filepath)


# -------------------- Main Entry Point --------------------

def main():
    """Run the FastAPI server."""
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host=config.server.host,
        port=config.server.port,
        reload=config.debug
    )


if __name__ == "__main__":
    main()