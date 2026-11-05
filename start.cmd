@echo off
rem Start the demo stack and open the web app. Works from PowerShell, cmd or a double-click.
rem Uses Git Bash explicitly: plain "bash" on Windows may be WSL, which has no distro here.
setlocal
set "GITBASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%GITBASH%" (
  echo Git Bash not found at "%GITBASH%". Install Git for Windows, then try again.
  exit /b 1
)
cd /d "%~dp0"
"%GITBASH%" scripts/start.sh
