@echo off
rem ============================================================
rem  Ciclo della spesa - postazione di CONSULTAZIONE (sola lettura)
rem  Indica qui sotto la cartella della condivisa riservata alla
rem  consultazione (la stessa per le due postazioni), ad esempio:
rem  set CONDIVISA=\\NOME-SERVER\NOME-CONDIVISA\CicloSpesa
rem ============================================================
set CONDIVISA=\\NOME-SERVER\NOME-CONDIVISA\CicloSpesa

cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 ciclo_spesa.py consultazione --condivisa "%CONDIVISA%"
) else (
  python ciclo_spesa.py consultazione --condivisa "%CONDIVISA%"
)
if errorlevel 1 pause
