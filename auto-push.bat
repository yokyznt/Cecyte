@echo off
cd /d "%~dp0"
echo ==========================================================
echo  Auto-push activo: cualquier cambio en esta carpeta se sube
echo  solo a GitHub cada 20 segundos. Deja esta ventana abierta.
echo  Para parar: cierra la ventana o presiona Ctrl+C.
echo ==========================================================
:loop
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Auto: cambios %date% %time%"
  git push
)
timeout /t 20 /nobreak >nul
goto loop
