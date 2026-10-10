$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$dsVersionCheck = 'import sys; sys.exit(not ((3, 11) <= sys.version_info[:2] <= (3, 13)))'
$dsPythonError = 'Python 3.11-3.13 is required. Install Python 3.12 from https://www.python.org/ (or set DS_PYTHON to a supported Python executable).'
function Test-DsPython {
    param([string]$Executable, [string[]]$PythonArgs = @())
    if (-not (Get-Command $Executable -ErrorAction SilentlyContinue)) { return $false }
    try {
        & $Executable @PythonArgs -c $dsVersionCheck 2>$null
        return ($LASTEXITCODE -eq 0)
    } catch { return $false }
}
if (-not (Test-Path '.venv\Scripts\python.exe')) {
    $dsPython = $null
    $dsPythonArgs = @()
    if ($env:DS_PYTHON) {
        if (-not (Test-DsPython $env:DS_PYTHON)) { throw $dsPythonError }
        $dsPython = $env:DS_PYTHON
    } else {
        foreach ($dsVersion in @('-3.12', '-3.13', '-3.11')) {
            if (Test-DsPython 'py' @($dsVersion)) {
                $dsPython = 'py'
                $dsPythonArgs = @($dsVersion)
                break
            }
        }
        if (-not $dsPython -and (Test-DsPython 'python')) { $dsPython = 'python' }
        if (-not $dsPython) { throw $dsPythonError }
    }
    & $dsPython @dsPythonArgs -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Virtualenv creation failed' }
}
& '.venv\Scripts\python.exe' -c $dsVersionCheck
if ($LASTEXITCODE -ne 0) { throw "Existing .venv uses an unsupported Python. Remove .venv and rerun. $dsPythonError" }
& '.venv\Scripts\python.exe' -m pip install --disable-pip-version-check -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
$dsPort = if ($env:DS_PORT) { $env:DS_PORT } else { '8710' }
Write-Host "Open http://127.0.0.1:$dsPort"
& '.venv\Scripts\python.exe' -m uvicorn app.main:app --host 127.0.0.1 --port $dsPort
exit $LASTEXITCODE
