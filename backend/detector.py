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
                max_num_faces=1,
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
                num_faces=1,
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
        """Initialize DeepSort tracker."""
        self.tracker = DeepSort(max_age=self.detection.track_max_age)

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

    def save_snapshot(self, frame: np.ndarray, note: str) -> str:
        """
        Save a snapshot of the current frame.

        Args:
            frame: BGR frame to save
            note: Description for filename

        Returns:
            Path to saved snapshot
        """
        timestamp = int(time.time() * 1000)
        filename = f"{note}_{timestamp}.jpg"
        filepath = os.path.join(self.output_dir, filename)
        cv2.imwrite(filepath, frame)
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

    def process_face(self, frame: np.ndarray, x1: int, y1: int, x2: int, y2: int) -> Tuple[Optional[float], Optional[float], Optional[float], Optional[float], bool, Optional[float]]:
        """
        Process face region for head pose, gaze, and lip movement.

        Args:
            frame: Full BGR frame
            x1, y1, x2, y2: Bounding box coordinates

        Returns:
            Tuple of (yaw, pitch, roll, gaze_deviation, face_detected, lip_distance)
        """
        h0, w0 = frame.shape[:2]

        # Extract head crop (upper 60% of bbox)
        top = max(y1, 0)
        bottom = min(y1 + int((y2 - y1) * 0.6), h0)
        left = max(x1, 0)
        right = min(x2, w0)

        head_crop = frame[top:bottom, left:right]

        if head_crop.size == 0:
            return None, None, None, None, False, None

        # Convert to RGB for MediaPipe
        rgb = cv2.cvtColor(head_crop, cv2.COLOR_BGR2RGB)

        # Process with FaceMesh
        if self.use_legacy:
            results = self.face_mesh.process(rgb)
            if not results.multi_face_landmarks:
                return None, None, None, None, False, None
            landmarks = results.multi_face_landmarks[0].landmark
        else:
            from mediapipe import Image, ImageFormat
            mp_image = Image(image_format=ImageFormat.SRGB, data=rgb)
            detection_result = self.face_landmarker.detect(mp_image)
            if not detection_result.face_landmarks:
                return None, None, None, None, False, None
            landmarks = detection_result.face_landmarks[0]

        crop_h, crop_w = head_crop.shape[:2]

        # Get head pose
        yaw, pitch, roll = self.estimate_head_pose(landmarks, crop_w, crop_h)

        # Get gaze deviation
        gaze_deviation = self.estimate_gaze_deviation(landmarks, crop_w, crop_h)

        # Get lip distance
        lip_distance = self.estimate_lip_distance(landmarks, crop_w, crop_h)

        return yaw, pitch, roll, gaze_deviation, True, lip_distance

    def process_frame(self, frame: np.ndarray, camera_id: str = "default") -> List[DetectionResult]:
        """
        Process a single frame and detect cheating behaviors.

        Args:
            frame: BGR frame to process
            camera_id: Identifier for the camera source

        Returns:
            List of DetectionResult objects for each detected violation
        """
        self.frame_count += 1
        current_time = time.time()

        # Skip frames if configured
        if self.frame_count % (self.detection.frame_skip + 1) != 0:
            return []

        h0, w0 = frame.shape[:2]

        # Detect persons
        detections = self.detect_persons(frame)

        # Format for DeepSort: [bbox, confidence, class]
        ds_detections = [([d[0], d[1], d[2], d[3]], d[4], 'person') for d in detections]

        # Update tracker
        tracks = self.tracker.update_tracks(ds_detections, frame=frame)

        # Collect active tracks
        active_tracks = {}
        for tr in tracks:
            if not tr.is_confirmed():
                continue
            tid = tr.track_id
            ltrb = tr.to_ltrb()
            x1, y1, x2, y2 = map(int, ltrb)
            active_tracks[tid] = (x1, y1, x2, y2)

        results = []

        # Process each track
        for tid, (x1, y1, x2, y2) in active_tracks.items():
            # Calculate centroid (bottom center)
            cx, cy = (x1 + x2) // 2, y2

            # Get or create track state
            state = self.track_states.get(tid, TrackState(track_id=tid))
            state.centroid = (cx, cy)
            state.last_seen = current_time

            # Process face
            yaw, pitch, roll, gaze_dev, face_detected, lip_dist = self.process_face(frame, x1, y1, x2, y2)

            behaviors = []
            confidence = 0.0

            if face_detected and yaw is not None:
                state.face_absence_start = None
                state.left_seat = False

                # Check head yaw (looking sideways)
                if abs(yaw) > self.detection.look_yaw_threshold_deg:
                    if state.look_start is None:
                        state.look_start = current_time
                    elif not state.is_looking_away:
                        if current_time - state.look_start >= self.detection.look_duration_sec:
                            state.is_looking_away = True
                            behaviors.append("looking_sideways")
                            confidence = max(confidence, 0.7 + abs(yaw) / 300)
                else:
                    state.look_start = None
                    state.is_looking_away = False

                # Check gaze deviation
                if gaze_dev is not None and gaze_dev > self.detection.gaze_deviation_threshold:
                    if state.gaze_deviation_start is None:
                        state.gaze_deviation_start = current_time
                    elif not state.is_gaze_deviant:
                        if current_time - state.gaze_deviation_start >= self.detection.look_duration_sec:
                            state.is_gaze_deviant = True
                            behaviors.append("gaze_deviation")
                            confidence = max(confidence, 0.6 + gaze_dev * 0.3)
                else:
                    state.gaze_deviation_start = None
                    state.is_gaze_deviant = False

                # Check lip movement (talking)
                if lip_dist is not None:
                    if state.previous_lip_distance is not None:
                        lip_change = abs(lip_dist - state.previous_lip_distance)
                        if lip_change > self.detection.lip_movement_threshold:
                            if state.lip_movement_start is None:
                                state.lip_movement_start = current_time
                            elif not state.is_talking:
                                if current_time - state.lip_movement_start >= self.detection.talking_duration_sec:
                                    state.is_talking = True
                                    behaviors.append("talking")
                                    confidence = max(confidence, 0.65)
                        else:
                            state.lip_movement_start = None
                            state.is_talking = False
                    state.previous_lip_distance = lip_dist

            else:
                # Face not detected - check for absence
                if state.face_absence_start is None:
                    state.face_absence_start = current_time
                elif not state.left_seat:
                    if current_time - state.face_absence_start >= self.detection.face_absence_duration_sec:
                        state.left_seat = True
                        behaviors.append("left_seat")
                        confidence = 0.8

            self.track_states[tid] = state

            # Create result if behaviors detected
            if behaviors:
                snapshot_path = self.save_snapshot(frame.copy(), f"{camera_id}_id{tid}")

                result = DetectionResult(
                    cheating_detected=True,
                    behaviors=behaviors,
                    confidence=min(confidence, 1.0),
                    face_detected=face_detected,
                    timestamp=datetime.now().isoformat(),
                    track_id=tid,
                    yaw=yaw,
                    pitch=pitch,
                    roll=roll,
                    snapshot_path=snapshot_path
                )
                results.append(result)

        # Check proximity between pairs
        tids = list(active_tracks.keys())
        for i in range(len(tids)):
            for j in range(i + 1, len(tids)):
                id1, id2 = tids[i], tids[j]

                if id1 not in self.track_states or id2 not in self.track_states:
                    continue

                c1 = np.array(self.track_states[id1].centroid)
                c2 = np.array(self.track_states[id2].centroid)
                dist = np.linalg.norm(c1 - c2)

                pair_key = tuple(sorted((id1, id2)))
                pair_state = self.pair_states.get(pair_key, PairState(track_ids=pair_key))

                if dist < self.detection.proximity_pix:
                    if pair_state.start is None:
                        pair_state.start = current_time
                    elif not pair_state.is_close:
                        if current_time - pair_state.start >= self.detection.proximity_duration_sec:
                            pair_state.is_close = True

                            snapshot_path = self.save_snapshot(frame.copy(), f"{camera_id}_prox_{id1}_{id2}")

                            result = DetectionResult(
                                cheating_detected=True,
                                behaviors=["proximity_cheating"],
                                confidence=0.75,
                                face_detected=True,
                                timestamp=datetime.now().isoformat(),
                                snapshot_path=snapshot_path
                            )
                            results.append(result)
                else:
                    pair_state.start = None
                    pair_state.is_close = False

                self.pair_states[pair_key] = pair_state

        # Cleanup old states
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
        Draw annotations on frame showing detected violations.

        Args:
            frame: BGR frame
            results: List of detection results

        Returns:
            Annotated BGR frame
        """
        annotated = frame.copy()

        # Draw track bounding boxes
        for tid, (x1, y1, x2, y2) in self.track_states.items():
            state = self.track_states.get(tid)

            # Default green box
            color = (0, 255, 0)
            label = f"ID:{tid}"

            if state and state.is_looking_away:
                color = (0, 0, 255)  # Red
                label += " LOOK"
            elif state and state.is_talking:
                color = (0, 165, 255)  # Orange
                label += " TALK"
            elif state and state.left_seat:
                color = (128, 128, 128)  # Gray
                label += " LEFT"

            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
            cv2.putText(annotated, label, (x1, y1 - 10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

        # Draw alerts for violations
        for result in results:
            for behavior in result.behaviors:
                alert_text = f"ALERT: {behavior.upper()}"
                cv2.putText(annotated, alert_text, (10, 30),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)

        return annotated

    def close(self):
        """Release resources."""
        if self.use_legacy:
            self.face_mesh.close()
        else:
            self.face_landmarker.close()