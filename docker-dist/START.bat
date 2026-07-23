@echo off
title LeadRadar - Starting...
color 0B

echo.
echo  =================================================================
echo              LeadRadar Dashboard Launcher
echo  =================================================================
echo.

set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

:: ── Step 1: Check if Docker engine is responding ─────────────────────
echo [1/3] Checking if Docker is running...

docker info >nul 2>&1
if %ERRORLEVEL% EQU 0 goto docker_ok

echo.
echo  !! ERROR: Docker engine is not running or not ready.
echo     Please open Docker Desktop and try again.
echo.
pause
exit /b 1

:docker_ok
echo       Docker is running. OK

:: ── Step 2: Start the LeadRadar container ────────────────────────────
echo.
echo [2/3] Starting LeadRadar container...

docker compose -f "%SCRIPT_DIR%docker-compose.yml" up -d
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  !! ERROR: Could not start LeadRadar container.
    echo     (Ensure docker-compose.yml is in the same folder as START.bat)
    echo.
    pause
    exit /b 1
)

:: ── Step 3: Open browser automatically ───────────────────────────────
echo.
echo [3/3] Waiting for services to initialize...
timeout /t 5 /nobreak >nul

echo.
echo       Opening LeadRadar Dashboard in browser...
start http://localhost:3095

echo.
echo  =================================================================
echo   LeadRadar is active at http://localhost:3095
echo  =================================================================
echo.
timeout /t 3 /nobreak >nul
exit /b 0
