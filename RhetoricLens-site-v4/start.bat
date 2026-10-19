@echo off
setlocal
title RhetoricLens Prototype v3

cd /d "%~dp0"

echo ==========================================
echo        RhetoricLens Prototype v3
echo ==========================================
echo.

if not exist ".venv\Scripts\python.exe" (
    echo [1/3] Creating virtual environment...
    python -m venv .venv
    if errorlevel 1 (
        echo.
        echo ERROR: Could not create the virtual environment.
        echo Make sure Python 3.10+ is installed and added to PATH.
        pause
        exit /b 1
    )
) else (
    echo [1/3] Virtual environment found.
)

echo.
echo [2/3] Installing/updating dependencies...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo ERROR: Dependency installation failed.
    pause
    exit /b 1
)

echo.
echo [3/3] Starting RhetoricLens...
echo.
echo Open http://127.0.0.1:8000 in your browser.
echo Press CTRL+C in this window to stop the server.
echo.

start "" "http://127.0.0.1:8000"
".venv\Scripts\python.exe" -m uvicorn app.main:app --reload

echo.
echo RhetoricLens has stopped.
pause
