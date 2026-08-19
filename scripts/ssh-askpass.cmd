@echo off
if not defined VELA_SSH_PASSWORD exit /b 1
echo %VELA_SSH_PASSWORD%
