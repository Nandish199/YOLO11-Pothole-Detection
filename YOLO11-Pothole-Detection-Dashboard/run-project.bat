@echo off
setlocal

cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo Python was not found. Install Python 3.11 and add it to PATH.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo Node.js/npm was not found. Install Node.js and add it to PATH.
    pause
    exit /b 1
)

if not exist ".env" (
    copy ".env.example" ".env" >nul
)

if not exist "node_modules\" (
    echo Installing dashboard dependencies...
    call npm install
    if errorlevel 1 (
        echo Dashboard dependency installation failed.
        pause
        exit /b 1
    )
)

cd backend

if not exist ".venv311\Scripts\python.exe" (
    echo Creating the Python 3.11 virtual environment...
    python -m venv .venv311
    if errorlevel 1 (
        echo Virtual environment creation failed.
        pause
        exit /b 1
    )
)

echo Installing backend dependencies...
".venv311\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo Backend dependency installation failed.
    pause
    exit /b 1
)

echo Applying database migrations...
".venv311\Scripts\python.exe" -m alembic upgrade head
if errorlevel 1 (
    echo Database migration failed.
    pause
    exit /b 1
)

echo Starting FastAPI on http://127.0.0.1:8001
start "Pothole Detection API" cmd /k ""%CD%\".venv311\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8001"

cd ..

echo Starting Vite dashboard on http://localhost:4176
start "Pothole Detection Dashboard" cmd /k "npm run dev"

echo.
echo Both services have been started.
echo Dashboard: http://localhost:4176
echo API:       http://127.0.0.1:8001
echo API docs:  http://127.0.0.1:8001/docs
pause
