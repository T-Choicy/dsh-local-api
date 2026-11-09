$ErrorActionPreference = 'Stop'
$serviceExe = Join-Path $PSScriptRoot 'glm-api-server-via-zcode.exe'
if (-not (Test-Path -LiteralPath $serviceExe -PathType Leaf)) {
    throw 'The local API server executable was not found beside Start-Server.ps1.'
}

$stdoutPath = Join-Path $PSScriptRoot 'server.stdout.log'
$stderrPath = Join-Path $PSScriptRoot 'server.stderr.log'
# Direct serve avoids a visible console window; logs go to the files beside this script.
$serviceProcess = Start-Process -FilePath $serviceExe -ArgumentList @('serve') `
    -WorkingDirectory $PSScriptRoot -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru

$timer = [System.Diagnostics.Stopwatch]::StartNew()
do {
    if ($serviceProcess.HasExited) {
        throw "The local API server exited with code $($serviceProcess.ExitCode). See $stderrPath and $stdoutPath."
    }
    $response = $null
    try {
        $request = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:18081/healthz')
        $request.Proxy = $null
        $request.Timeout = 1000
        $response = $request.GetResponse()
        if ([int]$response.StatusCode -eq 200) {
            Write-Host 'glm-api-server-via-zcode is healthy at http://127.0.0.1:18081 (OpenAI base: /v1)'
            return
        }
    } catch [System.Net.WebException] {
        # The server may need a moment to bind its listener or refresh the plan token.
    } finally {
        if ($null -ne $response) { $response.Close() }
    }
    Start-Sleep -Milliseconds 200
} while ($timer.Elapsed.TotalSeconds -lt 30)

throw "The local API server did not become healthy at 127.0.0.1:18081 within 30 seconds. See $stderrPath and $stdoutPath."
