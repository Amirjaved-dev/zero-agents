param(
  [switch]$KeepRunning
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$workspace = Join-Path $repoRoot "local-axl"
$axlDir = Join-Path $workspace "axl"
$goDir = Join-Path $workspace "go"
$goZip = Join-Path $workspace "go1.25.5.windows-amd64.zip"
$goExe = Join-Path $goDir "bin\go.exe"
$nodeExe = Join-Path $axlDir "node.exe"

$nodeAApiPort = 9022
$nodeBApiPort = 9012
$peerListenPort = 9101
$tcpPort = 7000

function Stop-LocalAxlNodes {
  if (!(Test-Path $nodeExe)) {
    return
  }

  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $nodeExe } | Stop-Process -Force
}

function Invoke-AxlTopology($port) {
  Invoke-RestMethod -Uri "http://127.0.0.1:$port/topology" -TimeoutSec 10
}

function Receive-AxlMessage($port) {
  curl.exe -s -i "http://127.0.0.1:$port/recv"
}

function Wait-AxlMessage($port, $expected) {
  $deadline = (Get-Date).AddSeconds(15)

  while ((Get-Date) -lt $deadline) {
    $received = Receive-AxlMessage $port
    if ($received -match [regex]::Escape($expected)) {
      return $received
    }

    Start-Sleep -Milliseconds 500
  }

  throw "Timed out waiting for AXL message: $expected"
}

New-Item -ItemType Directory -Force -Path $workspace | Out-Null

if (!(Test-Path $axlDir)) {
  git clone https://github.com/gensyn-ai/axl.git $axlDir
}

if (!(Test-Path $goExe)) {
  if (!(Test-Path $goZip)) {
    curl.exe -L --retry 3 --output $goZip "https://go.dev/dl/go1.25.5.windows-amd64.zip"
  }

  if (Test-Path $goDir) {
    Remove-Item -Recurse -Force $goDir
  }

  tar -xf $goZip -C $workspace
}

Push-Location $axlDir
try {
  & $goExe build -o node.exe .\cmd\node\

  @"
{
  "Peers": [],
  "Listen": ["tls://127.0.0.1:$peerListenPort"],
  "api_port": $nodeAApiPort,
  "tcp_port": $tcpPort
}
"@ | Out-File -FilePath "node-a-config.json" -Encoding ascii

  @"
{
  "Peers": ["tls://127.0.0.1:$peerListenPort"],
  "Listen": [],
  "api_port": $nodeBApiPort,
  "tcp_port": $tcpPort
}
"@ | Out-File -FilePath "node-b-config.json" -Encoding ascii

  Stop-LocalAxlNodes
  Start-Sleep -Seconds 2

  Start-Process -FilePath $nodeExe -ArgumentList @("-config", "node-a-config.json") -WorkingDirectory $axlDir -WindowStyle Minimized
  Start-Sleep -Seconds 2
  Start-Process -FilePath $nodeExe -ArgumentList @("-config", "node-b-config.json") -WorkingDirectory $axlDir -WindowStyle Minimized
  Start-Sleep -Seconds 8

  $nodeA = Invoke-AxlTopology $nodeAApiPort
  $nodeB = Invoke-AxlTopology $nodeBApiPort

  if (!$nodeA.our_public_key -or !$nodeB.our_public_key) {
    throw "AXL topology did not return public keys"
  }

  curl.exe -s -f -X POST "http://127.0.0.1:$nodeBApiPort/send" -H "X-Destination-Peer-Id: $($nodeA.our_public_key)" --data-binary "hello from local node B" | Out-Null
  Wait-AxlMessage $nodeAApiPort "hello from local node B" | Out-Null

  curl.exe -s -f -X POST "http://127.0.0.1:$nodeAApiPort/send" -H "X-Destination-Peer-Id: $($nodeB.our_public_key)" --data-binary "hello from local node A" | Out-Null
  Wait-AxlMessage $nodeBApiPort "hello from local node A" | Out-Null

  Write-Output "AXL local integration test passed"
  Write-Output "Node A API: http://127.0.0.1:$nodeAApiPort"
  Write-Output "Node B API: http://127.0.0.1:$nodeBApiPort"
  Write-Output "Node A peer ID: $($nodeA.our_public_key)"
  Write-Output "Node B peer ID: $($nodeB.our_public_key)"
}
finally {
  Pop-Location

  if (!$KeepRunning) {
    Stop-LocalAxlNodes
  }
}
