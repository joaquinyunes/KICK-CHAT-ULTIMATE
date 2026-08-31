# arrancar_desatendido.ps1 — Watchdog: levanta el Panel y lo relanza si se cae
# Registrá como Tarea Programada (como admin):
#   schtasks /Create /TN "KickContext" /TR "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File arrancar_desatendido.ps1" /SC ONLOGON /RL LIMITED /F

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ServerDir   = Join-Path $ProjectRoot "servidor"
$NodeExe     = (Get-Command node).Source
$LogFile     = Join-Path $ServerDir "watchdog.log"

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts $msg" | Out-File -FilePath $LogFile -Append -Encoding utf8
}

Log "=== Watchdog arrancado ==="

while ($true) {
    Log "Arrancando server-engine.js..."
    try {
        $proc = Start-Process -FilePath $NodeExe -ArgumentList "dist/server-engine.js" `
            -WorkingDirectory $ServerDir -PassThru -NoNewWindow `
            -RedirectStandardOutput (Join-Path $ServerDir "stdout.log") `
            -RedirectStandardError (Join-Path $ServerDir "stderr.log")

        Log "PID=$($proc.Id) — esperando..."

        $proc.WaitForExit()
        $exitCode = $proc.ExitCode
        Log "Proceso terminó con exit code $exitCode"
    } catch {
        Log "ERROR al lanzar proceso: $_"
    }

    Log "Reintentando en 5 segundos..."
    Start-Sleep -Seconds 5
}
