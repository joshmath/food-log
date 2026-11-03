# Serves this folder at http://localhost:5174 for local testing.
# Run serve.cmd (double-click), or: powershell -ExecutionPolicy Bypass -File serve.ps1
# Press Ctrl+C or close the window to stop.
param([int]$Port = 5174, [switch]$NoBrowser)

$root = $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'
  '.svg' = 'image/svg+xml'; '.png' = 'image/png'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch {
  Write-Host "Couldn't start on port $Port. It may already be running in another window." -ForegroundColor Red
  Write-Host "To use a different port, run: serve.cmd -Port $($Port + 1)"
  if (-not $NoBrowser) { Read-Host 'Press Enter to close' }
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host "Food Log running at $url"
Write-Host "Press Ctrl+C or close this window to stop."
if (-not $NoBrowser) { Start-Process $url }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($path -eq '') { $path = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path))
    # Only serve files inside this folder.
    if ($file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $file -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $type = $types[[IO.Path]::GetExtension($file).ToLower()]
      $ctx.Response.ContentType = $(if ($type) { $type } else { 'application/octet-stream' })
      $ctx.Response.Headers.Add('Cache-Control', 'no-store')
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
  }
} finally {
  $listener.Stop()
}
