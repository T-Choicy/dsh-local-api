$ErrorActionPreference = 'Stop'
$serviceExe = Join-Path $PSScriptRoot 'openai-api-server-via-codex.exe'
if (-not (Test-Path -LiteralPath $serviceExe -PathType Leaf)) {
    throw 'The local API server executable was not found beside Start-Server.ps1.'
}
$configPath = Join-Path $env:USERPROFILE '.config\openai-api-server-via-codex\config.toml'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw 'The existing local API server configuration was not found.'
}

$stdoutPath = Join-Path $PSScriptRoot 'server.stdout.log'
$stderrPath = Join-Path $PSScriptRoot 'server.stderr.log'
# Direct serve avoids the native supervisor spawning a new visible console.
$proxyEnvironment = @{}
foreach ($name in @('HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY')) { $proxyEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:HTTP_PROXY = 'http://127.0.0.1:7890'
    $env:HTTPS_PROXY = 'http://127.0.0.1:7890'
    $env:NO_PROXY = 'localhost,127.0.0.1,::1'
    $serviceProcess = Start-Process -FilePath $serviceExe -ArgumentList @('serve', '--config', ('"{0}"' -f $configPath)) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
} finally {
    foreach ($name in $proxyEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $proxyEnvironment[$name], 'Process') }
}

$timer = [System.Diagnostics.Stopwatch]::StartNew()
do {
    if ($serviceProcess.HasExited) {
        throw "The local API server exited with code $($serviceProcess.ExitCode). See $stderrPath and $stdoutPath."
    }
    $response = $null
    try {
        $request = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:18080/healthz')
        $request.Proxy = $null
        $request.Timeout = 1000
        $response = $request.GetResponse()
        if ([int]$response.StatusCode -eq 200) { return }
    } catch [System.Net.WebException] {
        # The server may need a moment to bind its listener.
    } finally {
        if ($null -ne $response) { $response.Close() }
    }
    Start-Sleep -Milliseconds 100
} while ($timer.Elapsed.TotalSeconds -lt 15)

throw "The local API server did not become healthy at 127.0.0.1:18080 within 15 seconds. See $stderrPath and $stdoutPath."
