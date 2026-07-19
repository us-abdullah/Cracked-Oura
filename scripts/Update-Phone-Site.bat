@echo off
title Update Phone Site (Vercel)
cd /d "%~dp0"
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-Phone-Site.ps1"
echo.
echo -----------------------------------------
pause
