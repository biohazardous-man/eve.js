<#
Proof-of-authorship note: Primary authorship and project direction for this utility script belong to John Elysian.
This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
If you reuse, discuss, or share this file, please credit it accurately.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$dataPath = Join-Path $repoRoot "server\src\newDatabase\data\characters\data.json"
$portraitDir = Join-Path $repoRoot "server\src\_secondary\image\generated\Character"
$backupRoot = Join-Path $repoRoot "_local\backups"

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path,
    [Parameter(Mandatory = $true)]
    [string] $Content
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Test-EveJsServerRunning {
  param(
    [Parameter(Mandatory = $true)]
    [string] $RepoRoot
  )

  $serverPath = [regex]::Escape((Join-Path $RepoRoot "server"))
  $nodeProcesses = Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -match "^node(\.exe)?$" -and
      $_.CommandLine -match $serverPath
    }

  return @($nodeProcesses).Count -gt 0
}

if (Test-EveJsServerRunning -RepoRoot $repoRoot) {
  Write-Error "Stop the EveJS server before running this reset. The live process would overwrite direct database edits."
}

if (-not (Test-Path -LiteralPath $dataPath)) {
  Write-Error "Character database not found at $dataPath"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $backupRoot ("paperdoll-reset-" + $timestamp)
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Copy-Item -LiteralPath $dataPath -Destination (Join-Path $backupDir "characters.data.json")

$rawJson = Get-Content -LiteralPath $dataPath -Raw
$characters = $rawJson | ConvertFrom-Json

$resetCount = 0
$resetNames = New-Object System.Collections.Generic.List[string]

foreach ($entry in $characters.PSObject.Properties) {
  $record = $entry.Value
  if ($null -eq $record) {
    continue
  }

  $record | Add-Member -NotePropertyName "appearanceInfo" -NotePropertyValue $null -Force
  $record | Add-Member -NotePropertyName "portraitInfo" -NotePropertyValue $null -Force
  $record | Add-Member -NotePropertyName "paperDollState" -NotePropertyValue 4 -Force

  foreach ($propertyName in @("portraitUploadedAt", "portraitByteLength", "portraitSizes")) {
    if ($record.PSObject.Properties.Name -contains $propertyName) {
      $record.PSObject.Properties.Remove($propertyName)
    }
  }

  $resetCount += 1
  $resetNames.Add([string]$record.characterName) | Out-Null
}

$normalizedJson = $characters | ConvertTo-Json -Depth 100
Write-Utf8NoBom -Path $dataPath -Content ($normalizedJson + "`n")

$deletedPortraitFiles = 0
if (Test-Path -LiteralPath $portraitDir) {
  $portraitFiles = Get-ChildItem -LiteralPath $portraitDir -File |
    Where-Object { $_.Name -match "^\d+_\d+\.jpg$" }

  foreach ($portraitFile in $portraitFiles) {
    Remove-Item -LiteralPath $portraitFile.FullName -Force
    $deletedPortraitFiles += 1
  }
}

Write-Host ""
Write-Host "Reset complete."
Write-Host ("Backup: " + $backupDir)
Write-Host ("Characters reset: " + $resetCount)
Write-Host ("Portrait files deleted: " + $deletedPortraitFiles)
Write-Host ("Characters: " + (($resetNames | Sort-Object) -join ", "))
