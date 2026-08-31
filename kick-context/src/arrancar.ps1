# Arranca el sistema completo (Orquestador + Panel) en esta PC.
# Doble clic no siempre funciona: abrí PowerShell en esta carpeta y corré:
#   ./arrancar.ps1
# Para frenar todo: cerrá esta ventana o Ctrl+C, y despues:
#   Get-Process python | Stop-Process -Force

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Arrancando Panel de Control en http://127.0.0.1:5000 ..." -ForegroundColor Cyan
Start-Process -NoNewWindow python "modulo11_panel_control/panel_control.py"

Start-Sleep -Seconds 2
Write-Host "Arrancando Orquestador (captura + resumen) ..." -ForegroundColor Cyan
Write-Host "  (si el stream esta offline, espera solo hasta que arranques)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Abri http://127.0.0.1:5000  (usuario: admin)" -ForegroundColor Green
Write-Host "Ctrl+C para frenar." -ForegroundColor DarkGray
Write-Host ""

python "modulo10_orquestador/orquestador.py"
