"""
Camera Manager Module for AntiCheat Vision System.

Provides multi-camera stream handling with threading support for
parallel processing of multiple video sources (webcam, RTSP, MJPEG).
"""

import cv2
import socket
import threading
import time
import queue
from urllib.parse import unquote, urlparse, quote
from dataclasses import dataclass, field
from typing import Optional, Dict, Callable, Any, List
from datetime import datetime
from enum import Enum
import uuid

from .config import Config
from .detector import CheatingDetector, DetectionResult


class CameraStatus(Enum):
    """Status of a camera stream."""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    ACTIVE = "active"
    ERROR = "error"


@dataclass
class CameraInfo:
    """Information about a registered camera."""

    id: str
    name: str
    stream_url: str
    location: str = ""
    is_active: bool = True
    status: CameraStatus = CameraStatus.DISCONNECTED
    created_at: datetime = field(default_factory=datetime.now)


@dataclass
class StreamResult:
    """Result from processing a frame from a camera stream."""

    camera_id: str
    results: List[DetectionResult]
    frame: Optional[Any] = None  # numpy array
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    error: Optional[str] = None


class CameraStream:
    """
    Handles a single camera stream with threaded frame capture.

    Supports:
    - Local webcam (int index)
    - RTSP streams (rtsp://...)
    - MJPEG HTTP streams (http://...)
    - Video files (path to file)
    """

    def __init__(self, camera_info: CameraInfo, config: Config, detector: Optional[CheatingDetector] = None):
        """
        Initialize camera stream.

        Args:
            camera_info: Camera configuration
            config: Application configuration
            detector: Optional pre-built detector; if None, models load when the stream starts
        """
        self.camera_info = camera_info
        self.config = config
        self.detector: Optional[CheatingDetector] = detector
        self._detector_lock = threading.Lock()

        self._cap: Optional[cv2.VideoCapture] = None
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._frame_queue: queue.Queue = queue.Queue(maxsize=10)
        self._result_queue: queue.Queue = queue.Queue(maxsize=100)
        self._latest_frame: Optional[Any] = None
        self._frame_lock = threading.Lock()

        self._on_detection: Optional[Callable[[StreamResult], None]] = None
        self._on_frame: Optional[Callable[[str, Any], None]] = None
        self._detector_init_failed: bool = False

    def _ensure_detector(self) -> Optional[CheatingDetector]:
        """Load YOLO/MediaPipe once when streaming starts (keeps camera registration fast)."""
        if self.detector is not None:
            return self.detector
        if self._detector_init_failed:
            return None
        with self._detector_lock:
            if self.detector is None and not self._detector_init_failed:
                try:
                    print(
                        f"[INFO] Loading ML models for camera {self.camera_info.name} ({self.camera_info.id})..."
                    )
                    self.detector = CheatingDetector(self.config)
                except Exception as e:
                    self._detector_init_failed = True
                    print(f"[ERROR] ML models failed to load for camera {self.camera_info.id}: {e}")
                    return None
        return self.detector

    def _get_video_source(self) -> Any:
        """
        Parse video source and return appropriate value for cv2.VideoCapture.

        Returns:
            Integer for webcam, string for URL/path
        """
        source = self.camera_info.stream_url

        # Try parsing as integer (webcam index)
        try:
            return int(source)
        except ValueError:
            # URL-decode so browser-encoded characters like %40 → @ reach OpenCV correctly
            decoded = unquote(source)
            if decoded != source:
                print(f"[CAM] URL-decoded source: {source!r} → {decoded!r}")
            return decoded

    def connect(self) -> bool:
        """
        Connect to the camera stream.

        Returns:
            True if connection successful, False otherwise
        """
        try:
            source = self._get_video_source()
            print(f"[CAM] connect() | id={self.camera_info.id} name='{self.camera_info.name}' source={source!r}")

            # OpenCV build info (FFMPEG availability)
            build_info = cv2.getBuildInformation()
            has_ffmpeg = 'FFMPEG:                      YES' in build_info
            print(f"[CAM] OpenCV {cv2.__version__} — FFMPEG built-in: {has_ffmpeg}")
            if not has_ffmpeg:
                print(f"[CAM] WARNING — OpenCV was NOT compiled with FFMPEG. RTSP streams will fail. "
                      f"Install opencv-python (pip install opencv-python) which includes FFMPEG.")

            if isinstance(source, str) and source.startswith('rtsp'):
                # TCP reachability check before even trying OpenCV
                try:
                    parsed = urlparse(source)
                    host = parsed.hostname
                    port = parsed.port or 554
                    sock = socket.create_connection((host, port), timeout=5)
                    sock.close()
                    print(f"[CAM] TCP check PASSED — {host}:{port} is reachable ✓")
                except Exception as tcp_err:
                    print(f"[CAM] TCP check FAILED — cannot reach {parsed.hostname}:{parsed.port or 554}: {tcp_err}")
                    print(f"[CAM] → Likely causes: backend and camera on different networks, "
                          f"port {parsed.port or 554} blocked by firewall, or camera is offline.")

            self._cap = cv2.VideoCapture(source)

            if isinstance(source, str) and source.startswith('rtsp'):
                self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                self._cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'H264'))
                print(f"[CAM] RTSP mode — BUFFERSIZE=1, FOURCC=H264 applied")

            opened = self._cap.isOpened()
            print(f"[CAM] isOpened()={opened} | backend={self._cap.getBackendName() if opened else 'N/A'}")

            if not opened:
                print(f"[CAM] ERROR — cv2.VideoCapture could not open source={source!r}. "
                      f"Check: URL typo, camera offline, wrong port, credentials in URL, firewall, or missing codec.")
                self.camera_info.status = CameraStatus.ERROR
                return False

            # Log actual capture properties
            w  = int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h  = int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = self._cap.get(cv2.CAP_PROP_FPS)
            print(f"[CAM] Stream opened OK — {w}x{h} @ {fps:.1f} fps")

            self.camera_info.status = CameraStatus.ACTIVE
            return True

        except Exception as e:
            print(f"[CAM] EXCEPTION in connect() for id={self.camera_info.id}: {type(e).__name__}: {e}")
            self.camera_info.status = CameraStatus.ERROR
            return False

    def disconnect(self):
        """Disconnect from the camera stream."""
        self._stop_event.set()

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5.0)

        if self._cap:
            self._cap.release()

        self.camera_info.status = CameraStatus.DISCONNECTED
        self._detector_init_failed = False

    def start_processing(self,
                         on_detection: Optional[Callable[[StreamResult], None]] = None,
                         on_frame: Optional[Callable[[str, Any], None]] = None):
        """
        Start processing frames in a background thread.

        Args:
            on_detection: Callback for detection results
            on_frame: Callback for raw frames (for streaming)
        """
        self._on_detection = on_detection
        self._on_frame = on_frame
        self._stop_event.clear()
        self.camera_info.status = CameraStatus.CONNECTING

        self._thread = threading.Thread(target=self._processing_loop, daemon=True)
        self._thread.start()

    def _processing_loop(self):
        """Main processing loop running in background thread."""
        reconnect_delay = 1
        max_reconnect_delay = self.config.camera.reconnect_timeout

        print(f"[CAM] _processing_loop START | id={self.camera_info.id}")
        frame_count = 0

        while not self._stop_event.is_set():
            if not self._cap or not self._cap.isOpened():
                print(f"[CAM] No open capture — attempting connect | id={self.camera_info.id} delay={reconnect_delay}s")
                if not self.connect():
                    print(f"[CAM] Connect FAILED — retrying in {reconnect_delay}s | id={self.camera_info.id}")
                    time.sleep(reconnect_delay)
                    reconnect_delay = min(reconnect_delay * 2, max_reconnect_delay)
                    continue
                reconnect_delay = 1

            ret, frame = self._cap.read()

            if not ret:
                print(f"[CAM] cap.read() returned False (no frame) | id={self.camera_info.id} frames_received_so_far={frame_count}")
                self._cap.release()
                self._cap = None
                self.camera_info.status = CameraStatus.CONNECTING
                continue

            frame_count += 1
            if frame_count == 1:
                h, w = frame.shape[:2]
                print(f"[CAM] First frame received — {w}x{h} | id={self.camera_info.id}")
            if frame_count % 300 == 0:
                print(f"[CAM] Heartbeat — {frame_count} frames processed | id={self.camera_info.id}")

            # Store latest frame
            with self._frame_lock:
                self._latest_frame = frame.copy()

            # Call frame callback if set
            if self._on_frame:
                self._on_frame(self.camera_info.id, frame)

            # Process frame for detections
            try:
                det = self._ensure_detector()
                if det is None:
                    time.sleep(0.5)
                    continue
                results = det.process_frame(frame, self.camera_info.id)

                if results and self._on_detection:
                    stream_result = StreamResult(
                        camera_id=self.camera_info.id,
                        results=results,
                        timestamp=datetime.now().isoformat()
                    )
                    self._on_detection(stream_result)

                    # Store in result queue
                    try:
                        self._result_queue.put_nowait(stream_result)
                    except queue.Full:
                        # Remove oldest if queue is full
                        try:
                            self._result_queue.get_nowait()
                            self._result_queue.put_nowait(stream_result)
                        except queue.Empty:
                            pass

            except Exception as e:
                print(f"[ERROR] Processing error for camera {self.camera_info.id}: {e}")

            # 5fps is more than sufficient for proctoring and keeps CPU load reasonable
            time.sleep(1 / 5)

    def get_latest_frame(self) -> Optional[Any]:
        """
        Get the latest frame from the camera.

        Returns:
            BGR numpy array or None if no frame available
        """
        with self._frame_lock:
            return self._latest_frame.copy() if self._latest_frame is not None else None

    def get_latest_result(self) -> Optional[StreamResult]:
        """
        Get the latest detection result from the queue.

        Returns:
            StreamResult or None if no result available
        """
        try:
            return self._result_queue.get_nowait()
        except queue.Empty:
            return None

    def get_annotated_frame(self) -> Optional[Any]:
        """
        Get the latest frame with annotations drawn.

        Returns:
            Annotated BGR numpy array or None
        """
        frame = self.get_latest_frame()
        if frame is None:
            return None

        result = self.get_latest_result()
        if result and result.results:
            det = self._ensure_detector()
            if det is not None:
                return det.get_annotated_frame(frame, result.results)

        return frame


class CameraManager:
    """
    Manages multiple camera streams and coordinates detection.

    Provides a centralized interface for:
    - Registering/unregistering cameras
    - Starting/stopping streams
    - Collecting results from all active cameras
    """

    def __init__(self, config: Config):
        """
        Initialize the Camera Manager.

        Args:
            config: Application configuration
        """
        self.config = config
        self.cameras: Dict[str, CameraStream] = {}
        self._results_lock = threading.Lock()
        self._latest_results: Dict[str, StreamResult] = {}

    def register_camera(self,
                        name: str,
                        stream_url: str,
                        location: str = "",
                        camera_id: Optional[str] = None) -> CameraInfo:
        """
        Register a new camera.

        Args:
            name: Human-readable camera name
            stream_url: Video source URL or path
            location: Physical location description
            camera_id: Optional custom ID (auto-generated if not provided)

        Returns:
            CameraInfo for the registered camera
        """
        if camera_id is None:
            camera_id = str(uuid.uuid4())

        if camera_id in self.cameras:
            raise ValueError(f"Camera with ID {camera_id} already registered")

        # Check max cameras limit
        if len(self.cameras) >= self.config.camera.max_cameras:
            raise ValueError(f"Maximum camera limit ({self.config.camera.max_cameras}) reached")

        camera_info = CameraInfo(
            id=camera_id,
            name=name,
            stream_url=stream_url,
            location=location
        )

        self.cameras[camera_id] = CameraStream(camera_info, self.config, detector=None)

        return camera_info

    def unregister_camera(self, camera_id: str) -> bool:
        """
        Unregister and stop a camera.

        Args:
            camera_id: ID of camera to remove

        Returns:
            True if successful, False if camera not found
        """
        if camera_id not in self.cameras:
            return False

        stream = self.cameras[camera_id]
        self.stop_stream(camera_id)

        if stream.detector is not None:
            stream.detector.close()

        del self.cameras[camera_id]

        # Remove cached results
        with self._results_lock:
            self._latest_results.pop(camera_id, None)

        return True

    def start_stream(self,
                     camera_id: str,
                     on_detection: Optional[Callable[[StreamResult], None]] = None,
                     on_frame: Optional[Callable[[str, Any], None]] = None) -> bool:
        """
        Start processing a camera stream.

        Args:
            camera_id: ID of camera to start
            on_detection: Callback for detection results
            on_frame: Callback for raw frames

        Returns:
            True if started successfully
        """
        if camera_id not in self.cameras:
            return False

        stream = self.cameras[camera_id]

        # Wrap detection callback to cache results
        def wrapped_on_detection(result: StreamResult):
            with self._results_lock:
                self._latest_results[camera_id] = result
            if on_detection:
                on_detection(result)

        stream.start_processing(wrapped_on_detection, on_frame)
        return True

    def stop_stream(self, camera_id: str) -> bool:
        """
        Stop processing a camera stream.

        Args:
            camera_id: ID of camera to stop

        Returns:
            True if stopped successfully
        """
        if camera_id not in self.cameras:
            return False

        self.cameras[camera_id].disconnect()
        return True

    def get_camera_info(self, camera_id: str) -> Optional[CameraInfo]:
        """
        Get information about a camera.

        Args:
            camera_id: ID of camera

        Returns:
            CameraInfo or None if not found
        """
        if camera_id not in self.cameras:
            return None
        return self.cameras[camera_id].camera_info

    def get_all_cameras(self) -> List[CameraInfo]:
        """
        Get list of all registered cameras.

        Returns:
            List of CameraInfo objects
        """
        return [stream.camera_info for stream in self.cameras.values()]

    def get_latest_result(self, camera_id: str) -> Optional[StreamResult]:
        """
        Get the latest detection result for a camera.

        Args:
            camera_id: ID of camera

        Returns:
            StreamResult or None if no result
        """
        with self._results_lock:
            return self._latest_results.get(camera_id)

    def get_latest_frame(self, camera_id: str) -> Optional[Any]:
        """
        Get the latest frame from a camera.

        Args:
            camera_id: ID of camera

        Returns:
            BGR numpy array or None
        """
        if camera_id not in self.cameras:
            return None
        return self.cameras[camera_id].get_latest_frame()

    def get_annotated_frame(self, camera_id: str) -> Optional[Any]:
        """
        Get the latest annotated frame from a camera.

        Args:
            camera_id: ID of camera

        Returns:
            Annotated BGR numpy array or None
        """
        if camera_id not in self.cameras:
            return None
        return self.cameras[camera_id].get_annotated_frame()

    def stop_all(self):
        """Stop all camera streams."""
        for camera_id in list(self.cameras.keys()):
            self.stop_stream(camera_id)

    def get_active_count(self) -> int:
        """Get count of active camera streams."""
        return sum(1 for cam in self.cameras.values()
                   if cam.camera_info.status == CameraStatus.ACTIVE)


def create_camera_manager(config: Config) -> CameraManager:
    """
    Factory function to create a CameraManager.

    Args:
        config: Application configuration

    Returns:
        Configured CameraManager instance
    """
    return CameraManager(config)