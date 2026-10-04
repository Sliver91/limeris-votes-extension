# Limeris votes — mise à jour depuis la dernière release GitHub.
# Remplace le contenu du dossier « extension » à côté de ce script.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = 'Sliver91/limeris-votes-extension'
$root = $PSScriptRoot
$ext = Join-Path $root 'extension'
$manifest = Join-Path $ext 'manifest.json'

if (-not (Test-Path $manifest)) {
    Write-Host "Dossier « extension » introuvable à côté de ce script." -ForegroundColor Red
    exit 1
}

$local = [version](Get-Content $manifest -Raw -Encoding UTF8 | ConvertFrom-Json).version
Write-Host "Version installée : $local"

try {
    $release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'limeris-votes-updater' }
} catch {
    Write-Host "Impossible de joindre GitHub : $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$remote = [version]($release.tag_name -replace '^v', '')
Write-Host "Dernière version  : $remote"

if ($remote -le $local) {
    Write-Host "L'extension est déjà à jour." -ForegroundColor Green
    exit 0
}

$asset = $release.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1
if (-not $asset) {
    Write-Host "La release $($release.tag_name) ne contient pas de fichier zip." -ForegroundColor Red
    exit 1
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) "limeris-votes-$remote"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp | Out-Null
$zip = Join-Path $tmp $asset.name
$new = Join-Path $tmp 'contenu'
$backup = Join-Path $tmp 'ancienne'

try {
    Write-Host "Téléchargement de $($asset.name)..."
    Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing
    Expand-Archive $zip -DestinationPath $new

    $newExt = Join-Path $new 'extension'
    $newManifest = Join-Path $newExt 'manifest.json'
    if (-not (Test-Path $newManifest)) { throw "Le zip ne contient pas extension/manifest.json." }
    $got = [version](Get-Content $newManifest -Raw -Encoding UTF8 | ConvertFrom-Json).version
    if ($got -ne $remote) { throw "Le zip contient la version $got au lieu de $remote." }

    # Le dossier lui-même reste en place : le navigateur pointe dessus.
    Copy-Item $ext $backup -Recurse
    try {
        Get-ChildItem $ext -Force | Remove-Item -Recurse -Force
        Copy-Item (Join-Path $newExt '*') $ext -Recurse -Force
    } catch {
        Get-ChildItem $ext -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        Copy-Item (Join-Path $backup '*') $ext -Recurse -Force
        throw
    }

    $readme = Join-Path $new 'LISEZ-MOI.txt'
    if (Test-Path $readme) { Copy-Item $readme $root -Force }
} catch {
    Write-Host "Mise à jour annulée : $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Extension mise à jour : $local -> $remote" -ForegroundColor Green
Write-Host "Dernière étape : ouvre chrome://extensions (ou brave://extensions)"
Write-Host "et clique sur la flèche de rechargement de « Limeris votes »."
