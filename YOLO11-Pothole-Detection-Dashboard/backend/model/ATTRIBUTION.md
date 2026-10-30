# Model attribution

This workspace uses `pothole2v_320.onnx`, the ONNX export from [tahaUgan/pothole-yolo11n](https://huggingface.co/tahaUgan/pothole-yolo11n), pinned to revision `6aaf73d8005d3d68d0fadd8afbffca8bb96d35fb`.

- Architecture: YOLO11n object detector
- Classes: `0` Pothole, `1` Sewage-Manhole. The backend retains class `0` only.
- Model license declared by its publisher: CC-BY-4.0
- SHA-256: `c91b4211d06c915ae94519de9def87461703d612569d3ce239bf69bd7baa8c26`
- The publisher describes this export as a 320-pixel model. Treat its outputs as model estimates and validate it against the project's intended images before operational use.

Download and checksum verification are implemented in `scripts/download_model.py`.
