$velaUrl = 'http://127.0.0.1:5173'

for ($attempt = 0; $attempt -lt 90; $attempt++) {
    try {
        $response = Invoke-WebRequest -Uri $velaUrl -UseBasicParsing -TimeoutSec 1
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
            Start-Process $velaUrl
            exit 0
        }
    } catch {
        Start-Sleep -Milliseconds 750
    }
}

exit 1
