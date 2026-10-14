@echo off
rem Install Sound Lab's runtime (Windows). See install.py for options, e.g. install.cmd --hf-home D:\hf
cd /d "%~dp0"
where py >nul 2>nul && (py -3 install.py %* & exit /b %errorlevel%)
where python >nul 2>nul && (python install.py %* & exit /b %errorlevel%)
where uv >nul 2>nul && (uv run --no-project --python 3.12 install.py %* & exit /b %errorlevel%)
echo Needs Python (any 3.8+, from python.org or the Microsoft Store) or uv to run the installer.
exit /b 1
