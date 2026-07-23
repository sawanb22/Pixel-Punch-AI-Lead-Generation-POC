@echo off
title LeadRadar - First Time Setup
color 0A

echo.
echo  =================================================================
echo         LeadRadar - FIRST TIME SETUP (Run this only once!)
echo  =================================================================
echo.
echo  This will build the Docker image and start LeadRadar.
echo  This may take 5-10 minutes on first run. Please be patient.
echo.
pause

cd /d "%~dp0"

:: ── Check Docker is running ──────────────────────────────────────────
echo.
echo [1/4] Checking Docker engine...

docker info >nul 2>&1
if %ERRORLEVEL% EQU 0 goto docker_ok

echo.
echo  !! ERROR: Docker engine is not running or not ready.
echo     Please make sure Docker Desktop is open and running, then try again.
echo.
pause
exit /b 1

:docker_ok
echo       Docker is running. OK

:: ── Remove old container and volumes ─────────────────────────────────
echo.
echo [2/4] Removing any previous LeadRadar installation...
docker compose down -v 2>nul
echo       Clean.

:: ── Build the Docker image ───────────────────────────────────────────
echo.
echo [3/4] Building the LeadRadar Docker image...
echo       (This takes 5-10 minutes on first run — please wait)
echo.
docker compose build --no-cache
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  !! ERROR: Docker build failed.
    echo.
    pause
    exit /b 1
)
echo.
echo       Build complete!

:: ── Start the container ──────────────────────────────────────────────
echo.
echo [4/4] Starting LeadRadar container...
docker compose up -d
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  !! ERROR: Could not start the container.
    echo.
    pause
    exit /b 1
)

echo.
echo       Waiting 15 seconds for services to fully start...
timeout /t 15 /nobreak >nul

:: ── Open browser ─────────────────────────────────────────────────────
echo.
echo  Opening LeadRadar Dashboard in your browser...
start http://localhost:3095

echo.
echo  =================================================================
echo         SETUP COMPLETE!
echo.
echo   LeadRadar is running at: http://localhost:3095
echo.
echo   FROM NOW ON, use START.bat every day.
echo   Do NOT run SETUP.bat again — it will wipe all your data!
echo  =================================================================
echo.
pause
