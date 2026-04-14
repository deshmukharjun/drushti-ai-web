"""
Configuration settings for AntiCheat Vision System.
All thresholds and paths are configurable via environment variables.
"""

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List

try:
    from dotenv import load_dotenv

    _backend_dir = Path(__file__).resolve().parent
    load_dotenv(_backend_dir / ".env")
except ImportError:
    pass


@dataclass
class DetectionConfig:
    """Configuration for cheating detection thresholds."""

    # Head pose detection thresholds
    look_yaw_threshold_deg: float = 15.0  # Degrees - head turn angle to flag
    look_pitch_threshold_deg: float = 20.0  # Degrees - head up/down angle
    look_duration_sec: float = 0.5  # Duration before alert triggers

    # Proximity detection thresholds
    proximity_pix: int = 150  # Pixels - distance threshold for overhead cam
    proximity_duration_sec: float = 2.0  # Duration before proximity alert

    # Gaze detection thresholds
    gaze_deviation_threshold: float = 0.3  # Normalized (0-1) eye gaze deviation

    # Lip movement detection
    lip_movement_threshold: float = 0.02  # Normalized lip openness change
    talking_duration_sec: float = 1.5  # Continuous lip movement duration

    # Face absence detection
    face_absence_duration_sec: float = 3.0  # Duration before "left seat" alert

    # YOLO detection settings
    yolo_img_size: int = 640
    yolo_min_conf: float = 0.25
    yolo_classes: List[int] = field(default_factory=lambda: [0])  # class 0 = person

    # Frame processing
    frame_skip: int = 5  # Process every Nth frame
    track_max_age: int = 30  # DeepSort max tracking age

    # Face detection confidence
    face_detection_confidence: float = 0.3
    face_tracking_confidence: float = 0.3


@dataclass
class CameraConfig:
    """Configuration for camera streams."""

    default_source: str = "0"  # Default camera source
    output_dir: str = "events_snapshots"
    max_cameras: int = 10
    reconnect_timeout: int = 30  # Seconds to wait before reconnecting


@dataclass
class ServerConfig:
    """Configuration for FastAPI server."""

    host: str = "0.0.0.0"
    port: int = 8000
    websocket_heartbeat: float = 0.5  # Seconds between WebSocket updates
    cors_origins: List[str] = field(default_factory=lambda: ["*"])


@dataclass
class SupabaseConfig:
    """Configuration for Supabase integration."""

    url: str = ""
    service_key: str = ""
    bucket_name: str = "cheating-snapshots"


@dataclass
class Config:
    """Main configuration container."""

    detection: DetectionConfig = field(default_factory=DetectionConfig)
    camera: CameraConfig = field(default_factory=CameraConfig)
    server: ServerConfig = field(default_factory=ServerConfig)
    supabase: SupabaseConfig = field(default_factory=SupabaseConfig)

    # Model paths
    yolo_model_path: str = "yolo11n.pt"
    face_landmarker_path: str = "face_landmarker.task"

    # Environment
    environment: str = "development"  # "development" or "production"
    debug: bool = True


def load_config() -> Config:
    """Load configuration from environment variables."""

    config = Config()

    # Detection thresholds from env
    config.detection.look_yaw_threshold_deg = float(
        os.getenv("YAW_THRESHOLD", config.detection.look_yaw_threshold_deg)
    )
    config.detection.look_duration_sec = float(
        os.getenv("LOOK_DURATION", config.detection.look_duration_sec)
    )
    config.detection.proximity_pix = int(
        os.getenv("PROXIMITY_PIX", config.detection.proximity_pix)
    )
    config.detection.proximity_duration_sec = float(
        os.getenv("PROXIMITY_DURATION", config.detection.proximity_duration_sec)
    )
    config.detection.frame_skip = int(
        os.getenv("FRAME_SKIP", config.detection.frame_skip)
    )
    config.detection.yolo_min_conf = float(
        os.getenv("CONFIDENCE_THRESHOLD", config.detection.yolo_min_conf)
    )
    config.detection.gaze_deviation_threshold = float(
        os.getenv("GAZE_THRESHOLD", config.detection.gaze_deviation_threshold)
    )

    # Camera config
    config.camera.default_source = os.getenv("VIDEO_SOURCE", config.camera.default_source)
    config.camera.output_dir = os.getenv("OUTPUT_DIR", config.camera.output_dir)

    # Model paths
    config.yolo_model_path = os.getenv("MODEL_PATH", config.yolo_model_path)
    config.face_landmarker_path = os.getenv("FACE_LANDMARKER_PATH", config.face_landmarker_path)

    # Supabase config
    config.supabase.url = os.getenv("SUPABASE_URL", "")
    config.supabase.service_key = os.getenv("SUPABASE_SERVICE_KEY", "")
    config.supabase.bucket_name = os.getenv("SUPABASE_BUCKET", "cheating-snapshots")

    # Server config
    config.server.host = os.getenv("HOST", config.server.host)
    config.server.port = int(os.getenv("PORT", config.server.port))

    # Environment
    config.environment = os.getenv("ENV", "development")
    config.debug = config.environment == "development"

    # Create output directory
    os.makedirs(config.camera.output_dir, exist_ok=True)

    return config


# Global config instance
config: Config = load_config()