# YOLO11 Pothole Detection API

FastAPI backend foundation for the existing Vite dashboard. The dashboard runs on port 4176 in this workspace because the default Vite ports are occupied; API base URL is `http://127.0.0.1:8000/api/v1`.

## Setup and run (macOS/Linux)

```bash
cd YOLO11-Pothole-Detection-Dashboard/backend
python3.11 -m venv .venv311
source .venv311/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
python scripts/download_model.py
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

On Windows, create the environment with `py -3.11 -m venv .venv311`, activate `.venv311\Scripts\activate`, then use the same pip, migration, and Uvicorn commands.

Swagger UI: <http://127.0.0.1:8000/docs>

## Run the connected dashboard

Keep the API running in one terminal. In a second terminal, start the existing frontend:

```bash
cd YOLO11-Pothole-Detection-Dashboard
npm run dev
```

Open <http://localhost:4176/>. Do not open `index.html` as a `file://` URL; the Vite module client needs the dev server. `VITE_API_URL` is read from the dashboard root `.env` (copy its `.env.example` if you need to override the default). The API allows the dashboard's localhost, 127.0.0.1, and `terminal.local` origins on ports 4173 and 4176.

## Tests

```bash
cd YOLO11-Pothole-Detection-Dashboard/backend
source .venv311/bin/activate
python -m pytest -q
```

Migration commands: `alembic upgrade head`, `alembic current`, and `alembic downgrade base`.

## Configuration

Set `DATABASE_URL`, `CORS_ORIGINS`, `MODEL_PATH`, `UPLOAD_DIR`, and `RESULTS_DIR` in `.env`. CORS allows the observed Vite origins on ports 4173 and 4176. The configured model is an ONNX export of a public YOLO11n pothole detector; download it with the checksum-pinned script above. Its attribution, class map, revision, and license are documented in `model/ATTRIBUTION.md`. Set `MODEL_PATH` to your own trained `best.pt` if you prefer your project checkpoint. The API reports missing or unloadable weights accurately and does not fabricate inference results. `DETECTION_CONFIDENCE` defaults to `0.80`; this reduced image-level false alarms on a balanced 800-image sample of the project's `Pothole` and `Normal` folders (11/400 to 3/400 normal images) while reducing pothole-image recall from 70.3% to 59.3%. These are image-level metrics on a sampled classification dataset, not bounding-box accuracy. Lower the value to favor recall or raise it to favor fewer detections. Restart the backend after changing `.env`. The sample includes no YOLO box labels, so it cannot support supervised object-detection fine-tuning.

The authenticated Settings page provides a slider to change the confidence for future processing jobs without editing `.env` or restarting the server. The workspace value is stored in `application_settings`; `GET` and `PUT /api/v1/settings/detection-confidence` expose the same setting. Existing detections are not rewritten when the value changes.

## Initial endpoints

- `GET /api/v1/health`
- `GET /api/v1/health/database`
- `GET /api/v1/health/model`
- `GET /api/v1/health/storage`

## Authentication API

In development, create an account with `POST /api/v1/auth/register` using JSON fields `email`, `display_name`, and `password` (minimum 8 characters). The endpoint returns a bearer access token and the public user profile. Exchange credentials at `POST /api/v1/auth/token` as OAuth2 form fields `username` (email) and `password`; use the token as `Authorization: Bearer <access_token>`. `GET /api/v1/auth/me` returns the signed-in account. The dashboard, upload, job, detection, and location APIs require a bearer token; health checks remain public. New uploads are associated with the signed-in user. Self-registration is enabled by default only for `development`, `dev`, and `local` environments; set `ALLOW_SELF_REGISTRATION` explicitly to override. Access-token lifetime is configured by `ACCESS_TOKEN_EXPIRE_MINUTES`. Production requires a non-default `SECRET_KEY` of at least 32 characters.

## Image processing API

`POST /api/v1/images/process` accepts multipart field `files` with up to eight PNG, JPEG, or WEBP images (10 MB each). It stores each image, creates a processing job, and schedules YOLO inference. Poll `GET /api/v1/jobs/{job_id}`; successful jobs include a `detection_id`. Fetch detection metadata from `GET /api/v1/detections/{detection_id}` and its annotated JPEG from `GET /api/v1/detections/{detection_id}/annotated`. An owner can permanently remove an inactive image and its jobs, detections, locations, and stored files with `DELETE /api/v1/images/{image_id}`. Pre-authentication workspace images (without an owner) can be removed by an authenticated workspace user. Active jobs cannot be deleted. Deletions are recorded in `audit_logs`. If the model file is absent or cannot load, uploaded images and jobs remain stored and jobs finish as `failed` with the reason recorded.

### Optional upload location

Image uploads may include multipart fields `latitude` and `longitude` together, plus optional `altitude_m`, `accuracy_m`, and ISO-8601 `captured_at`. The upload UI only requests browser location after the user selects **Capture location**. A submitted fix is stored in `locations` for each image in that upload with source `browser_gps_at_upload`. This is the device position at upload time, not GPS metadata embedded in the photo; only attach it when it matches where the selected photos were taken. Coordinates can be listed at `GET /api/v1/locations?limit=100`. The dashboard lists saved coordinates and can display each point on an embedded OpenStreetMap view after the user selects **Show on map**; selecting it sends that point’s coordinates to OpenStreetMap.

The schema includes users, images, detections and detection items, geospatial locations, processing jobs with source/device fields for future mobile hybrid inference, notifications, audit logs, and application settings.
