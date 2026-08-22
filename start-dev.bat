@echo off
cd /d "%~dp0"
set PATH=C:\Users\muham\AppData\Local\Temp\node-v22.16.0-win-x64;%PATH%
node node_modules\next\dist\bin\next dev
