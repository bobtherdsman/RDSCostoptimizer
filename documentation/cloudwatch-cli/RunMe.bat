@echo off
REM One-click launcher for the CloudWatch FLEET evidence collector (read-only).
REM Double-click this file. It auto-discovers every RDS SQL Server instance
REM across all enabled regions and builds one ZIP to upload. No input needed.
REM (Optional: change the collection window, e.g. -Days 30.)
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0collect-cloudwatch-evidence.ps1"
echo.
pause
