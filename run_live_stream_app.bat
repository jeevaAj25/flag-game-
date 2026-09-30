@echo off
title Live Flag Count Fight - YouTube Stream Studio
echo ====================================================================
echo   FLAG COUNT FIGHT - STANDALONE YOUTUBE LIVE STREAMING APP
echo ====================================================================
echo.
echo Starting Flag Fight Server...
echo.

start "" "http://localhost:3000/admin"
node src/index.js

pause
