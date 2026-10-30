"""Fetch the pinned YOLO11n pothole ONNX checkpoint and verify its SHA-256."""
import hashlib
import os
from pathlib import Path
import tempfile
from urllib.request import urlopen


MODEL_URL = (
    "https://huggingface.co/tahaUgan/pothole-yolo11n/resolve/"
    "6aaf73d8005d3d68d0fadd8afbffca8bb96d35fb/pothole2v_320.onnx"
)
EXPECTED_SHA256 = "c91b4211d06c915ae94519de9def87461703d612569d3ce239bf69bd7baa8c26"
DESTINATION = Path(__file__).resolve().parents[1] / "model" / "pothole2v_320.onnx"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as model_file:
        for chunk in iter(lambda: model_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    if DESTINATION.is_file() and sha256(DESTINATION) == EXPECTED_SHA256:
        print(f"Model already verified: {DESTINATION}")
        return

    fd, temporary_name = tempfile.mkstemp(prefix="pothole-model-", suffix=".onnx", dir=DESTINATION.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as output, urlopen(MODEL_URL, timeout=60) as response:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        actual_sha256 = sha256(temporary)
        if actual_sha256 != EXPECTED_SHA256:
            raise RuntimeError(f"Model checksum mismatch: expected {EXPECTED_SHA256}, got {actual_sha256}")
        temporary.replace(DESTINATION)
        print(f"Downloaded and verified model: {DESTINATION}")
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
