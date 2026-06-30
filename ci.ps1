# Norenty - CI local minimo. Corre antes de cada commit "de verdad" del loop.
# Falla (exit != 0) si algo rompe: el loop NO debe comitear si esto falla.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$fallo = $false

function Seccion($titulo) {
    Write-Output ""
    Write-Output "=== $titulo ==="
}

# Nota PS 5.1: redirigir stderr de un exe nativo aqui dentro envuelve cada
# linea en NativeCommandError y rompe $?, aunque el exit code real sea 0.
# Por eso NO se usa 2>&1 / 2>$null en las llamadas de abajo: se deja que
# stderr salga tal cual y se confia solo en $LASTEXITCODE.

# --- Backend: pytest ---
Seccion "Backend: pytest"
Push-Location "$root\backend"
& ".\.venv\Scripts\python.exe" -m pytest tests/ -q
if ($LASTEXITCODE -ne 0) { $fallo = $true; Write-Output "FALLO: tests backend" }
Pop-Location

# --- Dashboard: vitest ---
Seccion "Dashboard: vitest"
Push-Location "$root\dashboard"
$env:Path = "C:\Program Files\nodejs;" + $env:Path
npm run test
if ($LASTEXITCODE -ne 0) { $fallo = $true; Write-Output "FALLO: tests dashboard" }

# --- Dashboard: build (detecta errores de compilacion/tipos que "200" no pilla) ---
Seccion "Dashboard: build"
npm run build
if ($LASTEXITCODE -ne 0) { $fallo = $true; Write-Output "FALLO: build dashboard" }
Pop-Location

Seccion "Resultado"
if ($fallo) {
    Write-Output "CI: FALLO - no commitear hasta arreglarlo."
    exit 1
} else {
    Write-Output "CI: OK"
    exit 0
}
