@echo off
rem Double-click to run Food Log locally at http://localhost:5174
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
