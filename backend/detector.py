"""
Cheating Detection Module for AntiCheat Vision System.

This module provides the CheatingDetector class that analyzes video frames
to detect cheating behaviors including:
- Head pose deviation (looking sideways)
- Proximity between students
- Gaze direction deviation
- Lip movement (talking)
- Face absence (left seat)
"""

import cv2
import time
import numpy as np
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple, Any
from datetime import datetime
from math import degrees
import os

from ultralytics import YOLO
from deep_sort_realtime.deepsort_tracker import DeepSort

from .config import Config, DetectionConfig

# MediaPipe imports with fallback handling
try:
    from mediapipe.python.solutions import face_mesh as face_mesh_legacy
    from mediapipe.python.solutions.face_mesh import FaceMesh
    USE_LEGACY = True
except ImportError:
    try:
        from mediapipe.solutions import face_mesh as face_mesh_legacy
        from mediapipe.solutions.face_mesh import FaceMesh
        USE_LEGACY = True
    except ImportError:
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision
        from mediapipe import Image, ImageFormat
        USE_LEGACY = False


@dataclass
class DetectionResult:
    """Structured result from cheating detection for a single frame."""

    cheating_detected: bool
    behaviors: List[str]
    confidence: float
    face_detected: bool
    timestamp: str
    track_id: Optional[int] = None
    yaw: Optional[float] = None
    pitch: Optional[float] = None
    roll: Optional[float] = None
    snapshot_path: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "cheating_detected": self.cheating_detected,
            "behaviors": self.behaviors,
            "confidence": self.confidence,
            "face_detected": self.face_detected,
            "timestamp": self.timestamp,
            "track_id": self.track_id,
            "yaw": self.yaw,
            "pitch": self.pitch,
            "roll": self.roll,
            "snapshot_path": self.snapshot_path,
        }


@dataclass
class TrackState:
    """State maintained for each tracked person."""

    track_id: int
    look_start: Optional[float] = None
    is_looking_away: bool = False
    centroid: Tuple[int, int] = (0, 0)
    last_seen: float = 0.0
    face_absence_start: Optional[float] = None
    lip_movement_start: Optional[float] = None
    is_talking: bool = False
    left_seat: bool = False
    previous_lip_distance: Optional[float] = None
    gaze_deviation_start: Optional[float] = None
    is_gaze_deviant: bool = False
    # Number of consecutive analyzed frames yaw has been above threshold —
    # used as a cheap stability filter to suppress single-frame jitter.
    yaw_streak: int = 0


@dataclass
class PairState:
    """State for proximity detection between track pairs."""

    track_ids: Tuple[int, int]
    start: Optional[float] = None
    is_close: bool = False


class CheatingDetector:
    """
    Main detector class for identifying cheating behaviors in video frames.

    Uses YOLO for person detection, DeepSort for tracking, and MediaPipe for
    facial landmark analysis including head pose estimation and gaze detection.
    """

    # 3D model points for solvePnP (generic face model)
    FACE_3D_MODEL = np.array([
        (0.0, 0.0, 0.0),          # nose tip
        (0.0, -330.0, -65.0),     # chin
        (-225.0, 170.0, -135.0),  # left eye left corner
        (225.0, 170.0, -135.0),   # right eye right corner
        (-150.0, -150.0, -125.0), # left mouth corner
        (150.0, -150.0, -125.0)   # right mouth corner
    ], dtype=np.float64)

    # Key facial landmark indices for MediaPipe
    NOSE_TIP = 1
    CHIN = 152
    LEFT_EYE_OUTER = 33
    RIGHT_EYE_OUTER = 263
    LEFT_MOUTH = 61
    RIGHT_MOUTH = 291

    # Eye landmark indices for gaze estimation
    LEFT_EYE_INNER = 133
    LEFT_EYE_OUTER_IDX = 33
    RIGHT_EYE_INNER = 362
    RIGHT_EYE_OUTER_IDX = 263
    LEFT_PUPIL = 468
    RIGHT_PUPIL = 473
    LEFT_IRIS_CENTER = 468
    RIGHT_IRIS_CENTER = 473

    # YOLO COCO class IDs for prohibited objects
    PROHIBITED_CLASSES = {
        67: "phone",
        73: "book",
        63: "laptop",
        76: "scissors",
    }

    def __init__(self, config: Config):
        """
        Initialize the CheatingDetector with configuration.

        Args:
            config: Configuration object containing all settings
        """
        self.config = config
        self.detection = config.detection

        # Initialize models
        self._init_yolo()
        self._init_face_mesh()
        self._init_tracker()

        # State tracking
        self.track_states: Dict[int, TrackState] = {}
        self.pair_states: Dict[Tuple[int, int], PairState] = {}

        # Frame counter for frame skipping
        self.frame_count = 0

        # Cooldown between emitting the same event (incident + snapshot) per key
        cooldown = getattr(config.detection, "incident_cooldown_sec", 5.0)
        self._cooldown_sec: float = cooldown
        self._last_event_time: Dict[str, float] = {}

        # Snapshot cooldown (same value — only save a file when an event is emitted)
        self.last_snapshot_time = self._last_event_time
        self.snapshot_cooldown_sec: float = self._cooldown_sec

        # Active bounding boxes from last processed frame (tid -> (x1,y1,x2,y2))
        self.active_tracks: Dict[int, Tuple[int, int, int, int]] = {}
        # Face bbox per track for the most recent processed frame
        self.track_face_boxes: Dict[int, Tuple[int, int, int, int]] = {}

        # Track-disappearance bookkeeping for true "left seat" detection.
        # tid -> (last_seen_time, last_bbox)
        self._last_seen: Dict[int, Tuple[float, Tuple[int, int, int, int]]] = {}
        self._left_seat_fired: set = set()
        self.left_seat_grace_sec: float = 6.0

        # Output directory for snapshots
        self.output_dir = config.camera.output_dir
        os.makedirs(self.output_dir, exist_ok=True)

    def _init_yolo(self):
        """Initialize YOLO model for person detection."""
        model_path = self.config.yolo_model_path
        if not os.path.exists(model_path):
            print(f"[WARN] YOLO model not found at {model_path}, will auto-download")
        self.yolo = YOLO(model_path)

    def _init_face_mesh(self):
        """Initialize MediaPipe FaceMesh for facial landmark detection."""
        global USE_LEGACY

        if USE_LEGACY:
            print("[INFO] Using legacy FaceMesh API")
            self.face_mesh = FaceMesh(
                static_image_mode=False,
                max_num_faces=10,  # detect up to 10 students simultaneously
                min_detection_confidence=self.detection.face_detection_confidence,
                min_tracking_confidence=self.detection.face_tracking_confidence
            )
            self.use_legacy = True
        else:
            print("[INFO] Using Tasks API FaceLandmarker")
            model_path = self.config.face_landmarker_path

            if not os.path.exists(model_path):
                print(f"[INFO] Downloading FaceLandmarker model...")
                self._download_face_landmarker(model_path)

            from mediapipe.tasks import python
            from mediapipe.tasks.python import vision

            base_options = python.BaseOptions(model_asset_path=model_path)
            options = vision.FaceLandmarkerOptions(
                base_options=base_options,
                running_mode=vision.RunningMode.IMAGE,
                num_faces=10,  # detect up to 10 students simultaneously
                min_face_detection_confidence=self.detection.face_detection_confidence
            )
            self.face_landmarker = vision.FaceLandmarker.create_from_options(options)
            self.use_legacy = False

    def _download_face_landmarker(self, path: str):
        """Download the FaceLandmarker model if not present."""
        import urllib.request

        # Legacy path (vision_transformer/...) returns 404; use current bucket layout.
        urls = [
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        ]
        parent = os.path.dirname(os.path.abspath(path))
        if parent:
            os.makedirs(parent, exist_ok=True)
        last_err: Optional[Exception] = None
        for url in urls:
            try:
                urllib.request.urlretrieve(url, path)
                print(f"[INFO] FaceLandmarker model downloaded to {path}")
                return
            except Exception as e:
                last_err = e
        raise RuntimeError(f"Failed to download FaceLandmarker model: {last_err}")

    def _init_tracker(self):
        """Initialize DeepSort tracker.
        n_init=1 → tracks confirm on the first detection so every student gets
        a bbox immediately. Default of 3 made students invisible for ~3s.
        """
        self.tracker = DeepSort(
            max_age=self.detection.track_max_age,
            n_init=1,
        )

    def _landmarks_to_2d_points(self, landmarks, w: int, h: int) -> np.ndarray:
        """
        Convert MediaPipe landmarks to 2D image points for solvePnP.

        Args:
            landmarks: MediaPipe facial landmarks
            w: Image width
            h: Image height

        Returns:
            numpy array of 2D points
        """
        pts = [
            (landmarks[self.NOSE_TIP].x * w, landmarks[self.NOSE_TIP].y * h),
            (landmarks[self.CHIN].x * w, landmarks[self.CHIN].y * h),
            (landmarks[self.LEFT_EYE_OUTER].x * w, landmarks[self.LEFT_EYE_OUTER].y * h),
            (landmarks[self.RIGHT_EYE_OUTER].x * w, landmarks[self.RIGHT_EYE_OUTER].y * h),
            (landmarks[self.LEFT_MOUTH].x * w, landmarks[self.LEFT_MOUTH].y * h),
            (landmarks[self.RIGHT_MOUTH].x * w, landmarks[self.RIGHT_MOUTH].y * h),
        ]
        return np.array(pts, dtype=np.float64)

    def estimate_head_pose(self, face_landmarks, crop_w: int, crop_h: int) -> Tuple[Optional[float], Optional[float], Optional[float]]:
        """
        Estimate head pose (yaw, pitch, roll) from facial landmarks.

        Uses solvePnP with a generic 3D face model to estimate orientation.

        Args:
            face_landmarks: MediaPipe facial landmarks
            crop_w: Width of the face crop
            crop_h: Height of the face crop

        Returns:
            Tuple of (yaw, pitch, roll) in degrees, or (None, None, None) on failure
        """
        try:
            image_points = self._landmarks_to_2d_points(face_landmarks, crop_w, crop_h)

            # Camera intrinsics approximation
            focal_length = crop_w
            center = (crop_w / 2, crop_h / 2)
            camera_matrix = np.array([
                [focal_length, 0, center[0]],
                [0, focal_length, center[1]],
                [0, 0, 1]
            ], dtype=np.float64)
            dist_coeffs = np.zeros((4, 1))

            success, rotation_vector, _ = cv2.solvePnP(
                self.FACE_3D_MODEL, image_points, camera_matrix, dist_coeffs,
                flags=cv2.SOLVEPNP_ITERATIVE
            )

            if not success:
                return None, None, None

            # Convert rotation vector to Euler angles
            rmat, _ = cv2.Rodrigues(rotation_vector)
            sy = np.sqrt(rmat[0, 0]**2 + rmat[1, 0]**2)
            singular = sy < 1e-6

            if not singular:
                x = np.arctan2(rmat[2, 1], rmat[2, 2])
                y = np.arctan2(-rmat[2, 0], sy)
                z = np.arctan2(rmat[1, 0], rmat[0, 0])
            else:
                x = np.arctan2(-rmat[1, 2], rmat[1, 1])
                y = np.arctan2(-rmat[2, 0], sy)
                z = 0

            return degrees(x), degrees(y), degrees(z)

        except Exception as e:
            print(f"[WARN] Head pose estimation failed: {e}")
            return None, None, None

    def estimate_gaze_deviation(self, landmarks, w: int, h: int) -> Optional[float]:
        """
        Estimate gaze deviation from looking forward.

        Uses iris landmarks to determine if eyes are looking away from center.

        Args:
            landmarks: MediaPipe facial landmarks
            w: Image width
            h: Image height

        Returns:
            Normalized gaze deviation (0 = center, 1 = extreme), or None on failure
        """
        try:
            # Get eye center and iris positions
            # Left eye
            left_eye_x = landmarks[468].x  # Left iris center
            left_eye_center_x = (landmarks[33].x + landmarks[133].x) / 2  # Eye horizontal center

            # Right eye
            right_eye_x = landmarks[473].x  # Right iris center
            right_eye_center_x = (landmarks[362].x + landmarks[263].x) / 2

            # Calculate normalized deviation (0 to 1)
            left_deviation = abs(left_eye_x - left_eye_center_x) * 2
            right_deviation = abs(right_eye_x - right_eye_center_x) * 2

            # Average deviation from both eyes
            avg_deviation = (left_deviation + right_deviation) / 2
            return min(avg_deviation, 1.0)

        except (IndexError, AttributeError):
            return None

    def estimate_lip_distance(self, landmarks, w: int, h: int) -> Optional[float]:
        """
        Estimate lip distance for talking detection.

        Args:
            landmarks: MediaPipe facial landmarks
            w: Image width
            h: Image height

        Returns:
            Normalized lip distance (0-1), or None on failure
        """
        try:
            # Upper lip landmark 13, lower lip landmark 14
            upper_lip = landmarks[13]
            lower_lip = landmarks[14]

            # Calculate normalized vertical distance
            distance = abs(lower_lip.y - upper_lip.y)
            return distance

        except (IndexError, AttributeError):
            return None

    # ── Shared bounding box drawing style ──────────────────────────────────
    # Red box + red filled label bar with white text, matching reference screenshot.
    BOX_COLOR_ALERT = (0, 0, 255)        # BGR: red
    BOX_COLOR_OK = (0, 200, 0)            # BGR: green
    BOX_THICKNESS = 3
    LABEL_FONT = cv2.FONT_HERSHEY_SIMPLEX
    LABEL_SCALE = 0.7
    LABEL_FONT_THICKNESS = 2
    LABEL_TEXT_COLOR = (255, 255, 255)   # white

    def _draw_labeled_box(
        self,
        img: np.ndarray,
        x1: int, y1: int, x2: int, y2: int,
        label: str,
        color: Tuple[int, int, int],
    ) -> None:
        """Draw a thick rectangle with a filled label bar above it (red bar / white text)."""
        cv2.rectangle(img, (x1, y1), (x2, y2), color, self.BOX_THICKNESS)

        (tw, th), baseline = cv2.getTextSize(
            label, self.LABEL_FONT, self.LABEL_SCALE, self.LABEL_FONT_THICKNESS
        )
        pad_x, pad_y = 8, 6
        bar_h = th + baseline + pad_y * 2

        # Place bar above the box; if no room above, place inside top
        bar_y2 = y1
        bar_y1 = bar_y2 - bar_h
        if bar_y1 < 0:
            bar_y1 = y1
            bar_y2 = y1 + bar_h

        bar_x1 = x1
        bar_x2 = min(x1 + tw + pad_x * 2, img.shape[1] - 1)

        cv2.rectangle(img, (bar_x1, bar_y1), (bar_x2, bar_y2), color, -1)
        cv2.putText(
            img, label,
            (bar_x1 + pad_x, bar_y2 - pad_y - baseline // 2),
            self.LABEL_FONT, self.LABEL_SCALE,
            self.LABEL_TEXT_COLOR, self.LABEL_FONT_THICKNESS,
            cv2.LINE_AA,
        )

    @staticmethod
    def _format_behavior_label(behavior: str, confidence: float) -> str:
        """'looking_sideways' + 0.85 → 'Looking sideways: 0.85'."""
        pretty = behavior.replace("_", " ").replace(":", ": ").capitalize()
        return f"{pretty}: {confidence:.2f}"

    def _can_emit(self, key: str, current_time: float) -> bool:
        """
        Return True if the cooldown has elapsed for this event key.
        Marks the key as used (so the next call within the cooldown returns False).
        """
        last = self._last_event_time.get(key, 0.0)
        if (current_time - last) >= self._cooldown_sec:
            self._last_event_time[key] = current_time
            return True
        return False

    def _can_save_snapshot(self, key: str, current_time: float) -> bool:
        """Alias kept for backwards compatibility — same gate as _can_emit."""
        return key in self._last_event_time and (
            current_time - self._last_event_time[key] < self._cooldown_sec
        )

    def save_snapshot(
        self,
        frame: np.ndarray,
        note: str,
        *,
        camera_id: str = "",
        exam_id: str = "",
        student_id: str = "",
        track_id: Optional[int] = None,
        behaviors: Optional[List[str]] = None,
        confidence: float = 0.0,
        face_box: Optional[Tuple[int, int, int, int]] = None,
        object_boxes: Optional[List[Tuple[int, int, int, int, str]]] = None,
    ) -> str:
        """
        Save an annotated snapshot with metadata baked in.

        Layout matches the dashboard preview style: red bbox + red label bar
        with white text 'Behavior: confidence', plus a black metadata strip
        at the bottom.
        """
        img = frame.copy()
        h, w = img.shape[:2]

        primary_behavior = (behaviors[0] if behaviors else "incident")

        # ── Subject (person) box with violation label ─────────────────────
        if face_box is not None:
            fx1, fy1, fx2, fy2 = face_box
            label = self._format_behavior_label(primary_behavior, confidence)
            self._draw_labeled_box(img, fx1, fy1, fx2, fy2, label, self.BOX_COLOR_ALERT)

        # ── Prohibited object boxes ───────────────────────────────────────
        for ox1, oy1, ox2, oy2, lbl in (object_boxes or []):
            obj_label = self._format_behavior_label(f"object: {lbl}", 1.0)
            self._draw_labeled_box(img, ox1, oy1, ox2, oy2, obj_label, self.BOX_COLOR_ALERT)

        # ── Metadata strip at bottom (black bar, white text) ──────────────
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        behavior_str = ", ".join(behaviors) if behaviors else "unknown"
        lines = [
            f"Time: {ts}   Camera: {camera_id}",
            f"Exam ID: {exam_id}   Student ID: {student_id}   Track ID: {track_id}",
            f"Event: {behavior_str}   Confidence: {confidence:.2f}",
        ]

        line_h = 24
        bar_h = line_h * len(lines) + 12
        cv2.rectangle(img, (0, h - bar_h), (w, h), (0, 0, 0), -1)
        for i, line in enumerate(lines):
            y = h - bar_h + 22 + i * line_h
            cv2.putText(img, line, (10, y),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)

        timestamp_ms = int(time.time() * 1000)
        filename = f"{note}_{timestamp_ms}.jpg"
        filepath = os.path.join(self.output_dir, filename)
        cv2.imwrite(filepath, img)
        return filepath

    def detect_persons(self, frame: np.ndarray) -> List[Tuple[int, int, int, int, float, int]]:
        """
        Detect persons in frame using YOLO.

        Args:
            frame: BGR frame

        Returns:
            List of (x1, y1, x2, y2, confidence, class_id) tuples
        """
        results = self.yolo.predict(
            source=frame,
            imgsz=self.detection.yolo_img_size,
            conf=self.detection.yolo_min_conf,
            classes=self.detection.yolo_classes,
            verbose=False
        )

        detections = []
        for r in results:
            for box in r.boxes:
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                conf = float(box.conf[0])
                cls = int(box.cls[0])
                detections.append((x1, y1, x2, y2, conf, cls))

        return detections

    def detect_objects(self, frame: np.ndarray) -> List[Tuple[int, int, int, int, float, str]]:
        """
        Detect prohibited objects (phone, book, laptop) using YOLO.

        Returns:
            List of (x1, y1, x2, y2, confidence, label) tuples above 0.5 threshold.
        """
        prohibited_ids = list(self.PROHIBITED_CLASSES.keys())
        results = self.yolo.predict(
            source=frame,
            imgsz=self.detection.yolo_img_size,
            conf=0.5,
            classes=prohibited_ids,
            verbose=False,
        )
        detections = []
        for r in results:
            for box in r.boxes:
                cls = int(box.cls[0])
                if cls not in self.PROHIBITED_CLASSES:
                    continue
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                conf = float(box.conf[0])
                label = self.PROHIBITED_CLASSES[cls]
                detections.append((x1, y1, x2, y2, conf, label))
        return detections

    def _face_descriptor_from_landmarks(
        self, landmarks, frame_w: int, frame_h: int
    ) -> Optional[Dict[str, Any]]:
        """Build a compact face descriptor (bbox + yaw) from MediaPipe landmarks.

        Returns None if essential landmarks are missing.
        """
        try:
            nose = landmarks[self.NOSE_TIP]
            le = landmarks[self.LEFT_EYE_OUTER]
            re = landmarks[self.RIGHT_EYE_OUTER]
        except (IndexError, AttributeError):
            return None

        d_left = abs(nose.x - le.x)
        d_right = abs(nose.x - re.x)
        asymmetry = (d_left - d_right) / max(d_left + d_right, 1e-6)
        yaw_deg = float(asymmetry * 120.0)

        # Tight bbox from landmarks, padded for context (forehead, chin)
        xs = [lm.x for lm in landmarks]
        ys = [lm.y for lm in landmarks]
        x1n, x2n = min(xs), max(xs)
        y1n, y2n = min(ys), max(ys)

        x1 = int(max(0, x1n * frame_w))
        x2 = int(min(frame_w - 1, x2n * frame_w))
        y1 = int(max(0, y1n * frame_h))
        y2 = int(min(frame_h - 1, y2n * frame_h))

        # Add ~25% vertical padding (forehead is above eyes, chin below)
        h_pad = int((y2 - y1) * 0.25)
        y1 = max(0, y1 - h_pad)
        y2 = min(frame_h - 1, y2 + h_pad // 2)

        return {
            "bbox": (x1, y1, x2, y2),
            "yaw": yaw_deg,
            "asymmetry": asymmetry,
            "center": ((x1 + x2) // 2, (y1 + y2) // 2),
        }

    def detect_all_faces(self, frame: np.ndarray) -> List[Dict[str, Any]]:
        """Run face detection on the FULL frame and return descriptors for every face.

        Critical for the multi-student case: face_mesh on per-YOLO-bbox crops
        misattributes faces when bboxes overlap. Running on the whole frame
        once gives every student their own independent face descriptor.
        """
        h, w = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        descriptors: List[Dict[str, Any]] = []

        if self.use_legacy:
            results = self.face_mesh.process(rgb)
            if not results.multi_face_landmarks:
                return descriptors
            for face in results.multi_face_landmarks:
                desc = self._face_descriptor_from_landmarks(face.landmark, w, h)
                if desc is not None:
                    descriptors.append(desc)
        else:
            from mediapipe import Image, ImageFormat
            mp_image = Image(image_format=ImageFormat.SRGB, data=rgb)
            detection_result = self.face_landmarker.detect(mp_image)
            if not detection_result.face_landmarks:
                return descriptors
            for face_landmarks in detection_result.face_landmarks:
                desc = self._face_descriptor_from_landmarks(face_landmarks, w, h)
                if desc is not None:
                    descriptors.append(desc)

        return descriptors

    @staticmethod
    def _match_faces_to_tracks(
        tracks: Dict[int, Tuple[int, int, int, int]],
        faces: List[Dict[str, Any]],
    ) -> Dict[int, Dict[str, Any]]:
        """Greedy 1-to-1 matching: each YOLO track gets its closest unique face."""
        matches: Dict[int, Dict[str, Any]] = {}
        used = set()

        # Sort by largest bbox first so prominent students get faces assigned first
        sorted_tracks = sorted(
            tracks.items(),
            key=lambda kv: (kv[1][2] - kv[1][0]) * (kv[1][3] - kv[1][1]),
            reverse=True,
        )

        for tid, (x1, y1, x2, y2) in sorted_tracks:
            tcx, tcy = (x1 + x2) // 2, (y1 + y2) // 2
            best_idx, best_dist = None, float("inf")
            margin = 30  # pixels of slack outside the bbox
            for i, face in enumerate(faces):
                if i in used:
                    continue
                fcx, fcy = face["center"]
                if not (x1 - margin <= fcx <= x2 + margin and
                        y1 - margin <= fcy <= y2 + margin):
                    continue
                dist = ((fcx - tcx) ** 2 + (fcy - tcy) ** 2) ** 0.5
                if dist < best_dist:
                    best_dist, best_idx = dist, i

            if best_idx is not None:
                matches[tid] = faces[best_idx]
                used.add(best_idx)

        return matches

    def process_face(
        self, frame: np.ndarray, x1: int, y1: int, x2: int, y2: int
    ) -> Tuple[Optional[float], Optional[float], Optional[float], Optional[float], bool, Optional[float], int]:
        """
        Process face region for head pose, gaze, lip movement, and face count.

        Returns:
            Tuple of (yaw, pitch, roll, gaze_deviation, face_detected, lip_distance, num_faces)
            num_faces > 1 indicates multiple people in the crop region.
        """
        h0, w0 = frame.shape[:2]

        # Extract head crop (upper 60% of bbox)
        top = max(y1, 0)
        bottom = min(y1 + int((y2 - y1) * 0.6), h0)
        left = max(x1, 0)
        right = min(x2, w0)

        head_crop = frame[top:bottom, left:right]

        if head_crop.size == 0:
            return None, None, None, None, False, None, 0

        # Convert to RGB for MediaPipe
        rgb = cv2.cvtColor(head_crop, cv2.COLOR_BGR2RGB)

        # Process with FaceMesh
        if self.use_legacy:
            results = self.face_mesh.process(rgb)
            if not results.multi_face_landmarks:
                return None, None, None, None, False, None, 0
            num_faces = len(results.multi_face_landmarks)
            landmarks = results.multi_face_landmarks[0].landmark
        else:
            from mediapipe import Image, ImageFormat
            mp_image = Image(image_format=ImageFormat.SRGB, data=rgb)
            detection_result = self.face_landmarker.detect(mp_image)
            if not detection_result.face_landmarks:
                return None, None, None, None, False, None, 0
            num_faces = len(detection_result.face_landmarks)
            landmarks = detection_result.face_landmarks[0]

        crop_h, crop_w = head_crop.shape[:2]

        # Reject tiny crops — solvePnP is unreliable below ~80px
        if crop_w < 80 or crop_h < 80:
            return None, None, None, None, False, None, 0

        # ── Robust yaw via nose-eye asymmetry (primary signal) ──────────
        # solvePnP is wildly unreliable when the YOLO bbox extends past the
        # face into background — it frequently returns 90°+ for forward-facing
        # students. We use asymmetry of nose-x vs eye corners instead:
        #   asymmetry ∈ [-1, +1]:  0 = forward, ±0.20 = mild turn, ±0.45 = profile
        # Convert asymmetry directly to a degree-equivalent yaw so the rest of
        # the pipeline keeps using the same threshold semantics.
        try:
            nose_x = landmarks[self.NOSE_TIP].x
            le_x = landmarks[self.LEFT_EYE_OUTER].x
            re_x = landmarks[self.RIGHT_EYE_OUTER].x
            d_left = abs(nose_x - le_x)
            d_right = abs(nose_x - re_x)
            asymmetry = (d_left - d_right) / max(d_left + d_right, 1e-6)
        except (IndexError, AttributeError):
            asymmetry = 0.0

        # Map asymmetry to a yaw-like angle (deg). |asymmetry|=0.5 ≈ 60°.
        yaw = float(asymmetry * 120.0)
        pitch = 0.0
        roll = 0.0

        gaze_deviation = self.estimate_gaze_deviation(landmarks, crop_w, crop_h)
        lip_distance = self.estimate_lip_distance(landmarks, crop_w, crop_h)

        return yaw, pitch, roll, gaze_deviation, True, lip_distance, num_faces

    def process_frame(
        self,
        frame: np.ndarray,
        camera_id: str = "default",
        exam_id: str = "",
        student_id: str = "",
    ) -> List[DetectionResult]:
        """
        Process a single frame and detect cheating behaviors.

        Args:
            frame: BGR frame to process
            camera_id: Identifier for the camera source
            exam_id: Exam identifier baked into snapshots
            student_id: Student identifier baked into snapshots

        Returns:
            List of DetectionResult objects for each detected violation
        """
        self.frame_count += 1
        current_time = time.time()

        if self.frame_count % (self.detection.frame_skip + 1) != 0:
            return []

        h0, w0 = frame.shape[:2]

        # ── Detection passes (all run on the full frame) ──────────────────
        person_detections = self.detect_persons(frame)
        object_detections = self.detect_objects(frame)
        all_faces = self.detect_all_faces(frame)

        # ── Track persons via DeepSort for stable IDs ─────────────────────
        ds_detections = [
            ([d[0], d[1], d[2], d[3]], d[4], "person") for d in person_detections
        ]
        tracks = self.tracker.update_tracks(ds_detections, frame=frame)

        active_tracks: Dict[int, Tuple[int, int, int, int]] = {}
        for tr in tracks:
            if not tr.is_confirmed():
                continue
            tid = tr.track_id
            x1, y1, x2, y2 = map(int, tr.to_ltrb())
            active_tracks[tid] = (x1, y1, x2, y2)

        self.active_tracks = active_tracks

        # ── 1:1 face → track assignment (each student gets their own face) ─
        track_faces = self._match_faces_to_tracks(active_tracks, all_faces)
        self.track_face_boxes = {
            tid: face["bbox"] for tid, face in track_faces.items()
        }

        # Build object box list for snapshot annotation
        obj_boxes: List[Tuple[int, int, int, int, str]] = [
            (ox1, oy1, ox2, oy2, lbl)
            for ox1, oy1, ox2, oy2, _conf, lbl in object_detections
        ]

        results = []

        # ── Multiple-person flag (entire frame) ────────────────────────────
        # Note: in classroom mode this fires often (it's a class!) — leave it as
        # info; downstream UI can decide whether to surface it. Disabled when
        # only one person is expected in front of the camera.
        if len(active_tracks) > 1 and self.detection.flag_multiple_persons:
            key = f"{camera_id}_multi_face"
            if self._can_emit(key, current_time):
                snap = self.save_snapshot(
                    frame.copy(), f"{camera_id}_multi",
                    camera_id=camera_id, exam_id=exam_id, student_id=student_id,
                    behaviors=["multiple_persons"], confidence=0.9,
                    object_boxes=obj_boxes,
                )
                results.append(DetectionResult(
                    cheating_detected=True, behaviors=["multiple_persons"],
                    confidence=0.9, face_detected=True,
                    timestamp=datetime.now().isoformat(), snapshot_path=snap,
                ))

        # ── Prohibited object flag ──────────────────────────────────────────
        if object_detections:
            key = f"{camera_id}_objects"
            if self._can_emit(key, current_time):
                obj_labels = list({lbl for *_, lbl in object_detections})
                behaviors_obj = [f"prohibited_object:{lbl}" for lbl in obj_labels]
                obj_conf = max(d[4] for d in object_detections)
                snap = self.save_snapshot(
                    frame.copy(), f"{camera_id}_obj",
                    camera_id=camera_id, exam_id=exam_id, student_id=student_id,
                    behaviors=behaviors_obj, confidence=obj_conf,
                    object_boxes=obj_boxes,
                )
                results.append(DetectionResult(
                    cheating_detected=True, behaviors=behaviors_obj,
                    confidence=obj_conf,
                    face_detected=bool(active_tracks),
                    timestamp=datetime.now().isoformat(), snapshot_path=snap,
                ))

        # ── Per-person behavioral checks ───────────────────────────────────
        # Stability filter: yaw must exceed threshold for `streak_required`
        # consecutive analyzed frames before triggering. Suppresses 1-frame
        # jitter without the duration-then-snapshot lag (snapshot is taken
        # the moment the streak threshold is hit, while the student IS turned).
        STREAK_REQUIRED = 2

        for tid, (x1, y1, x2, y2) in active_tracks.items():
            cx, cy = (x1 + x2) // 2, y2

            state = self.track_states.get(tid, TrackState(track_id=tid))
            state.centroid = (cx, cy)
            state.last_seen = current_time

            face = track_faces.get(tid)
            face_detected = face is not None
            yaw = face["yaw"] if face_detected else None
            face_box_for_snapshot = face["bbox"] if face_detected else (x1, y1, x2, y2)

            candidate_behaviors: List[tuple] = []

            if face_detected and yaw is not None:
                state.face_absence_start = None
                state.left_seat = False

                if abs(yaw) > self.detection.look_yaw_threshold_deg:
                    state.yaw_streak += 1
                    if state.yaw_streak >= STREAK_REQUIRED:
                        state.is_looking_away = True
                        # Confidence scales with how far past threshold the yaw is.
                        excess = abs(yaw) - self.detection.look_yaw_threshold_deg
                        conf = min(0.7 + excess / 60.0, 1.0)
                        candidate_behaviors.append(("looking_sideways", conf))
                else:
                    state.yaw_streak = 0
                    state.is_looking_away = False
            else:
                # YOLO sees the person but face mesh found no face for them.
                # This is normal when looking down to write — NOT "left seat".
                state.face_absence_start = None
                state.yaw_streak = 0

            self.track_states[tid] = state

            # ── Cooldown gate (5s per behavior per track) ─────────────────
            emittable: List[str] = []
            max_conf = 0.0
            for behavior_name, conf_val in candidate_behaviors:
                bkey = f"{camera_id}_id{tid}_{behavior_name}"
                if self._can_emit(bkey, current_time):
                    emittable.append(behavior_name)
                    max_conf = max(max_conf, conf_val)

            if emittable:
                snap = self.save_snapshot(
                    frame.copy(), f"{camera_id}_id{tid}",
                    camera_id=camera_id, exam_id=exam_id, student_id=student_id,
                    track_id=tid, behaviors=emittable, confidence=min(max_conf, 1.0),
                    face_box=face_box_for_snapshot, object_boxes=obj_boxes,
                )
                results.append(DetectionResult(
                    cheating_detected=True, behaviors=emittable,
                    confidence=min(max_conf, 1.0), face_detected=face_detected,
                    timestamp=datetime.now().isoformat(),
                    track_id=tid, yaw=yaw, pitch=0.0, roll=0.0,
                    snapshot_path=snap,
                ))

        # ── Proximity check ────────────────────────────────────────────────
        tids = list(active_tracks.keys())
        for i in range(len(tids)):
            for j in range(i + 1, len(tids)):
                id1, id2 = tids[i], tids[j]
                if id1 not in self.track_states or id2 not in self.track_states:
                    continue

                c1 = np.array(self.track_states[id1].centroid)
                c2 = np.array(self.track_states[id2].centroid)
                dist = float(np.linalg.norm(c1 - c2))

                pair_key = tuple(sorted((id1, id2)))
                pair_state = self.pair_states.get(pair_key, PairState(track_ids=pair_key))

                if dist < self.detection.proximity_pix:
                    if pair_state.start is None:
                        pair_state.start = current_time
                    elif not pair_state.is_close:
                        if current_time - pair_state.start >= self.detection.proximity_duration_sec:
                            pair_state.is_close = True
                            pkey = f"{camera_id}_prox_{id1}_{id2}"
                            if self._can_emit(pkey, current_time):
                                snap = self.save_snapshot(
                                    frame.copy(), pkey,
                                    camera_id=camera_id, exam_id=exam_id, student_id=student_id,
                                    behaviors=["proximity_cheating"], confidence=0.75,
                                    object_boxes=obj_boxes,
                                )
                                results.append(DetectionResult(
                                    cheating_detected=True,
                                    behaviors=["proximity_cheating"],
                                    confidence=0.75, face_detected=True,
                                    timestamp=datetime.now().isoformat(),
                                    snapshot_path=snap,
                                ))
                else:
                    pair_state.start = None
                    pair_state.is_close = False

                self.pair_states[pair_key] = pair_state

        # ── True "left seat" detection ─────────────────────────────────────
        # Fires once when a previously-tracked person has been gone for
        # `left_seat_grace_sec` consecutive seconds (DeepSort lost them).
        for tid, (x1, y1, x2, y2) in active_tracks.items():
            self._last_seen[tid] = (current_time, (x1, y1, x2, y2))

        for tid, (last_t, bbox) in list(self._last_seen.items()):
            gone_for = current_time - last_t
            if gone_for >= self.left_seat_grace_sec and tid not in active_tracks:
                if tid not in self._left_seat_fired:
                    key = f"{camera_id}_left_seat_{tid}"
                    if self._can_emit(key, current_time):
                        self._left_seat_fired.add(tid)
                        snap = self.save_snapshot(
                            frame.copy(), key,
                            camera_id=camera_id, exam_id=exam_id, student_id=student_id,
                            track_id=tid, behaviors=["left_seat"], confidence=0.85,
                            face_box=bbox, object_boxes=obj_boxes,
                        )
                        results.append(DetectionResult(
                            cheating_detected=True, behaviors=["left_seat"],
                            confidence=0.85, face_detected=False,
                            timestamp=datetime.now().isoformat(),
                            track_id=tid, snapshot_path=snap,
                        ))
            # Forget tracks that have been gone a long time
            if gone_for > 60.0:
                self._last_seen.pop(tid, None)
                self._left_seat_fired.discard(tid)

        # Clear left_seat_fired flag if track returns
        for tid in active_tracks:
            self._left_seat_fired.discard(tid)

        self._cleanup_states(current_time)
        return results

    def _cleanup_states(self, current_time: float):
        """Remove stale track states."""
        timeout = 5.0  # 5 second timeout
        to_delete = [
            tid for tid, state in self.track_states.items()
            if current_time - state.last_seen > timeout
        ]
        for tid in to_delete:
            del self.track_states[tid]

        # Cleanup pair states where one track is gone
        pair_to_delete = [
            key for key in self.pair_states
            if key[0] not in self.track_states or key[1] not in self.track_states
        ]
        for key in pair_to_delete:
            del self.pair_states[key]

    def get_annotated_frame(self, frame: np.ndarray, results: List[DetectionResult]) -> np.ndarray:
        """
        Draw live annotations using the same red-box style as saved snapshots.

        Tracks with an active violation get a red box + label bar showing the
        primary behavior and confidence. All other tracks get a thin green box.
        """
        annotated = frame.copy()

        # Map track_id → (primary_behavior, confidence) from this frame's results
        tid_to_alert: Dict[int, Tuple[str, float]] = {}
        for r in results:
            if r.track_id is not None and r.behaviors:
                tid_to_alert[r.track_id] = (r.behaviors[0], r.confidence)

        for tid, (x1, y1, x2, y2) in self.active_tracks.items():
            # Prefer the tight face bbox over the loose YOLO person bbox
            face_box = self.track_face_boxes.get(tid)
            bx1, by1, bx2, by2 = face_box if face_box is not None else (x1, y1, x2, y2)
            if tid in tid_to_alert:
                behavior, conf = tid_to_alert[tid]
                label = self._format_behavior_label(behavior, conf)
                self._draw_labeled_box(annotated, bx1, by1, bx2, by2, label, self.BOX_COLOR_ALERT)
            else:
                cv2.rectangle(annotated, (bx1, by1), (bx2, by2), self.BOX_COLOR_OK, 1)

        return annotated

    def close(self):
        """Release resources."""
        if self.use_legacy:
            self.face_mesh.close()
        else:
            self.face_landmarker.close()