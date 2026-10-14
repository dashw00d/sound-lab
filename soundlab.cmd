@echo off
rem Sound Lab (Windows). soundlab.cmd --help
set "DIR=%~dp0"
if not exist "%DIR%runtime\venv\Scripts\python.exe" (echo Not installed yet: run install.cmd & exit /b 1)
set "PYTHONPATH=%DIR%;%PYTHONPATH%"
"%DIR%runtime\venv\Scripts\python.exe" -m soundlab %*
