param(
    [Parameter(Mandatory = $true)]
    [string]$InstanceUuid,
    [Parameter(Mandatory = $true)]
    [string]$ProtectedTokenPath,
    [int]$DelaySeconds = 5400
)

$ErrorActionPreference = 'Stop'
if ($InstanceUuid -notmatch '^pro-[a-z0-9]+$') {
    throw 'Invalid AutoDL Pro instance UUID.'
}

Start-Sleep -Seconds ([Math]::Max(60, $DelaySeconds))

Add-Type -AssemblyName System.Security
$entropy = [Text.Encoding]::UTF8.GetBytes('vela-autodl-pro-v0528')
$cipher = [IO.File]::ReadAllBytes($ProtectedTokenPath)
$token = [Text.Encoding]::UTF8.GetString(
    [System.Security.Cryptography.ProtectedData]::Unprotect(
        $cipher,
        $entropy,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
)

$headers = @{ Authorization = $token }
$body = @{ instance_uuid = $InstanceUuid } | ConvertTo-Json -Compress
$response = Invoke-RestMethod `
    -Method Post `
    -Uri 'https://api.autodl.com/api/v1/dev/instance/pro/power_off' `
    -Headers $headers `
    -ContentType 'application/json' `
    -Body $body `
    -TimeoutSec 30

if ($response.code -ne 'Success') {
    throw "AutoDL safety power-off failed: $($response.code)"
}
