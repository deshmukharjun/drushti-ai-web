"""
AntiCheat Vision System Backend Package.

This package provides cheating detection for exam surveillance using:
- YOLO for person detection
- DeepSort for tracking
- MediaPipe for facial landmark analysis
- FastAPI for REST API and WebSocket streaming
"""

from .config import Config, load_config, DetectionConfig, CameraConfig, ServerConfig, SupabaseConfig
from .detector import CheatingDetector, DetectionResult, TrackState, PairState
from .camera_manager import CameraManager, CameraStream, CameraInfo, CameraStatus, StreamResult

__all__ = [
    'Config',
    'load_config',
    'DetectionConfig',
    'CameraConfig',
    'ServerConfig',
    'SupabaseConfig',
    'CheatingDetector',
    'DetectionResult',
    'TrackState',
    'PairState',
    'CameraManager',
    'CameraStream',
    'CameraInfo',
    'CameraStatus',
    'StreamResult',
]