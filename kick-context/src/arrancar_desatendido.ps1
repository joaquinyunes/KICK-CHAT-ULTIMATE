# Arranca el sistema y lo MANTIENE vivo sin que tengas que estar. Pensado para
# correr como Tarea Programada de Windows (al iniciar sesión). Si el orquestador
# se cae, lo vuelve a levantar solo. Logs en <DATA_DIR>\logs\arrancar_desatendido.log
#
# Registrar la tarea (una sola vez, en PowerShell COMO ADMIN, desde src\):
#
#   $exe = (Get-Command powershell).Source
#   $arg = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Resolve-Path .\arrancar_desatendido.ps1) + '"'
#   schtasks /Create /TN "KickContext" /TR "$exe $arg" /SC ONLOGON /RL LIMITED /F
#
# Arrancar ya sin reiniciar:   schtasks /Run /TN "KickContext"
# Ver estado:                  schtasks /Query /TN "KickContext" /V /FO LIST
# Sacarla:                     schtasks /Delete /TN "KickContext" /F

$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

# Carpeta de datos (para el log). Lee KICK_CONTEXT_DATA_DIR del entorno o del .env.
$dataDir = $env:KICK_CONTEXT_DATA_DIR
if (-not $dataDir -and (Test-Path ".\.env")) {
  $m = Select-String -Path ".\.env" -Pattern '^\s*KICK_CONTEXT_DATA_DIR\s*=\s*(.+)$' | Select-Object -First 1
  if ($m) { $dataDir = $m.Matches[0].Groups[1].Value.Trim().Trim('"') }
}
if (-not $dataDir) { $dataDir = Join-Path $env:USERPROFILE "kick-context-data" }
$logDir = Join-Path $dataDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "arrancar_desatendido.log"

function Escribir($txt) {
  $linea = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $txt
  Add-Content -Path $log -Value $linea -Encoding utf8
}

Escribir "watchdog iniciado (pid $PID)"

# El Panel se levanta una vez, aparte (si se cae, no es crítico).
Start-Process -WindowStyle Hidden powershell `
  "-NoProfile -ExecutionPolicy Bypass -Command `"Set-Location '$PSScriptRoot'; python modulo11_panel_control/panel_control.py`""

while ($true) {
  Escribir "lanzando orquestador..."
  try {
    $p = Start-Process -PassThru -WindowStyle Hidden python "modulo10_orquestador/orquestador.py"
    $p.WaitForExit()
    Escribir ("orquestador terminó (exit {0}). Reintento en 15s." -f $p.ExitCode)
  } catch {
    Escribir ("error lanzando orquestador: {0}. Reintento en 15s." -f $_.Exception.Message)
  }
  Start-Sleep -Seconds 15
}
