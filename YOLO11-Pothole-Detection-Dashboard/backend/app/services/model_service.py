from pathlib import Path
from time import perf_counter

from app.config import settings


class ModelService:
    def __init__(self) -> None:
        self._model = None
        self._error: str | None = None

    @property
    def configured_path(self) -> Path | None:
        return Path(settings.model_path).expanduser() if settings.model_path else None

    def status(self) -> dict:
        path = self.configured_path
        if path is None:
            return {"status": "not_configured", "configured": False, "loaded": False, "path": None}
        if not path.is_file():
            return {"status": "not_found", "configured": True, "loaded": False, "path": str(path)}
        if self._error:
            return {"status": "load_error", "configured": True, "loaded": False, "path": str(path),
                    "detail": self._error}
        if self._model is None:
            return {"status": "available", "configured": True, "loaded": False, "path": str(path)}
        return {"status": "ready", "configured": True, "loaded": True, "path": str(path)}

    def load(self):
        path = self.configured_path
        if path is None or not path.is_file():
            raise RuntimeError("YOLO model is not configured or the configured file does not exist")
        if self._model is None:
            try:
                from ultralytics import YOLO
                self._model = YOLO(str(path))
                self._error = None
            except Exception as exc:
                self._error = str(exc)
                raise RuntimeError(f"YOLO model could not be loaded: {exc}") from exc
        return self._model

    def predict(self, image_path: Path, confidence: float) -> tuple[list[dict], object, float]:
        model = self.load()
        started = perf_counter()
        results = model.predict(source=str(image_path), conf=confidence, verbose=False)
        elapsed_ms = (perf_counter() - started) * 1000
        result = results[0]
        items: list[dict] = []
        boxes = result.boxes
        if boxes is not None:
            coordinates = boxes.xyxy.cpu().tolist()
            class_ids = boxes.cls.cpu().tolist()
            confidences = boxes.conf.cpu().tolist()
            names = getattr(model, "names", {})
            for coords, class_id, score in zip(coordinates, class_ids, confidences):
                class_id = int(class_id)
                if class_id != settings.pothole_class_id:
                    continue
                class_name = names.get(class_id, str(class_id)) if isinstance(names, dict) else names[class_id]
                items.append({"class_id": class_id, "class_name": str(class_name), "confidence": float(score),
                              "x_min": float(coords[0]), "y_min": float(coords[1]),
                              "x_max": float(coords[2]), "y_max": float(coords[3])})
        return items, result.plot(), elapsed_ms


model_service = ModelService()
