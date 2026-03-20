param(
  [string]$OutputPath,
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"
$scriptStart = Get-Date
$scriptFailed = $false
$spinnerFrames = @("|", "/", "-", "\")
$compressionJob = $null

$repoRoot = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $repoRoot "dist"

function Write-Banner {
  param(
    [string]$Title,
    [System.ConsoleColor]$Color = [System.ConsoleColor]::Cyan
  )

  $line = "=" * 72
  Write-Host ""
  Write-Host $line -ForegroundColor $Color
  Write-Host ("  {0}" -f $Title) -ForegroundColor $Color
  Write-Host $line -ForegroundColor $Color
}

function Show-IntroAnimation {
  $art = @(
    "___________     ___________           ____. _________",
    "\_   _____/__  _\_   _____/          |    |/   _____/",
    " |    __)_\  \/ /|    __)_           |    |\_____  \ ",
    " |        \\   / |        \      /\__|    |/        \",
    "/_______  / \_/ /_______  /      \________/_______  /",
    "        \/              \/                        \/ "
  )

  $colors = @(
    [System.ConsoleColor]::DarkMagenta,
    [System.ConsoleColor]::Magenta,
    [System.ConsoleColor]::DarkCyan,
    [System.ConsoleColor]::Cyan,
    [System.ConsoleColor]::Yellow
  )

  for ($index = 0; $index -lt $art.Count; $index++) {
    $color = $colors[$index % $colors.Count]
    Write-Host $art[$index] -ForegroundColor $color
    Start-Sleep -Milliseconds 45
  }

  Write-Host ""
}

function Write-StatusLine {
  param(
    [string]$Message,
    [System.ConsoleColor]$Color = [System.ConsoleColor]::Gray
  )

  $timestamp = Get-Date -Format "HH:mm:ss"
  Write-Host ("[{0}] {1}" -f $timestamp, $Message) -ForegroundColor $Color
}

function Write-Section {
  param(
    [string]$Title
  )

  Write-Host ""
  Write-Host ("========== {0} ==========" -f $Title.ToUpperInvariant()) -ForegroundColor DarkCyan
}

function Write-AnimatedStatus {
  param(
    [string]$Message,
    [System.ConsoleColor]$Color = [System.ConsoleColor]::Yellow
  )

  foreach ($frame in $spinnerFrames) {
    Write-Host ("`r[{0}] {1}   " -f $frame, $Message) -NoNewline -ForegroundColor $Color
    Start-Sleep -Milliseconds 60
  }

  Write-Host ("`r[OK] {0}   " -f $Message) -ForegroundColor Green
}

function Show-LiveSpinner {
  param(
    [string]$Message,
    [scriptblock]$StatusScript,
    [object]$Job
  )

  $frameIndex = 0
  while ($Job.State -eq "Running" -or $Job.State -eq "NotStarted") {
    $frame = $spinnerFrames[$frameIndex % $spinnerFrames.Count]
    $statusText = & $StatusScript
    Write-Host ("`r[{0}] {1} {2}   " -f $frame, $Message, $statusText) -NoNewline -ForegroundColor Magenta
    Start-Sleep -Milliseconds 180
    $frameIndex++
    $Job = Get-Job -Id $Job.Id
  }

  Write-Host ""
}

function Wait-ForExit {
  if ($NoPause) {
    return
  }

  Write-Host ""
  Read-Host "Press Enter to close this window" | Out-Null
}

function Get-RelativePath {
  param(
    [string]$BasePath,
    [string]$TargetPath
  )

  $baseUri = New-Object System.Uri(($BasePath.TrimEnd("\") + "\"))
  $targetUri = New-Object System.Uri($TargetPath)
  return [System.Uri]::UnescapeDataString(
    $baseUri.MakeRelativeUri($targetUri).ToString().Replace("/", "\")
  )
}

function Test-ExcludedPath {
  param(
    [string]$RelativePath
  )

  $normalized = $RelativePath.Replace("/", "\")
  $excludedPrefixes = @(
    ".git\",
    "node_modules\",
    "client\",
    "docs\",
    "server\logs\",
    "clientOld",
    "data\fuzzwork\",
    "_secondary\",
    "_local\",
    "dist\"
  )

  foreach ($prefix in $excludedPrefixes) {
    if ($normalized.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }

  $excludedFiles = @(
    "evejs.config.local.json"
  )

  foreach ($fileName in $excludedFiles) {
    if ($normalized.Equals($fileName, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }

  $leafName = Split-Path -Leaf $normalized
  $excludedLeafPatterns = @(
    "tmp_*",
    "chat_client_*",
    "*.pyc",
    "*.pyj",
    "*.decomp",
    "*.decomp.py",
    "*.log"
  )

  foreach ($pattern in $excludedLeafPatterns) {
    if ($leafName -like $pattern) {
      return $true
    }
  }

  return $false
}

if (-not $OutputPath) {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $OutputPath = Join-Path $distDir "EvEJS-source-$timestamp.zip"
}

$resolvedOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$outputDir = Split-Path -Parent $resolvedOutputPath

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("evejs-source-" + [System.Guid]::NewGuid().ToString("N"))

try {
  try {
    $Host.UI.RawUI.WindowTitle = "eve.js Source Zip"
  } catch {
  }

  Show-IntroAnimation
  Write-Banner "eve.js Source Zip" Magenta
  Write-StatusLine "Starting source archive build..." Green
  Write-StatusLine ("Repo root: {0}" -f $repoRoot) DarkGray
  Write-StatusLine ("Output zip: {0}" -f $resolvedOutputPath) DarkGray
  Write-StatusLine ("Staging folder: {0}" -f $stagingRoot) DarkGray

  New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
  New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null

  Write-Section "Scanning Files"
  Write-AnimatedStatus "Initializing scanners and priming the archive engines..."

  $filesToArchive = New-Object System.Collections.Generic.List[object]
  $allFiles = 0
  $excludedCount = 0
  $includedBytes = 0L
  $scanTick = 0

  foreach ($file in Get-ChildItem -Path $repoRoot -Recurse -File) {
    $allFiles++
    $relativePath = Get-RelativePath -BasePath $repoRoot -TargetPath $file.FullName
    if (Test-ExcludedPath -RelativePath $relativePath) {
      $excludedCount++
      if ($allFiles -eq 1 -or $allFiles % 2500 -eq 0) {
        $frame = $spinnerFrames[$scanTick % $spinnerFrames.Count]
        Write-Host ("`r[{0}] Scanned {1:N0} files | kept {2:N0} | skipped {3:N0}   " -f $frame, $allFiles, $filesToArchive.Count, $excludedCount) -NoNewline -ForegroundColor Cyan
        $scanTick++
      }
      continue
    }

    $filesToArchive.Add([PSCustomObject]@{
      FullName = $file.FullName
      RelativePath = $relativePath
      Length = $file.Length
    }) | Out-Null

    $includedBytes += $file.Length

    if ($allFiles -eq 1 -or $allFiles % 2500 -eq 0) {
      $frame = $spinnerFrames[$scanTick % $spinnerFrames.Count]
      Write-Host ("`r[{0}] Scanned {1:N0} files | kept {2:N0} | skipped {3:N0}   " -f $frame, $allFiles, $filesToArchive.Count, $excludedCount) -NoNewline -ForegroundColor Cyan
      $scanTick++
    }
  }
  Write-Host ""

  Write-StatusLine ("Found {0:N0} files total." -f $allFiles) Cyan
  Write-StatusLine ("Keeping {0:N0} files and excluding {1:N0}." -f $filesToArchive.Count, $excludedCount) Cyan
  Write-StatusLine ("Estimated staged payload: {0:N2} MB" -f ($includedBytes / 1MB)) Cyan

  if ($filesToArchive.Count -eq 0) {
    throw "No files matched the archive rules. Nothing to zip."
  }

  Write-Section "Copying To Staging"
  Write-AnimatedStatus "Launching transfer grid and staging selected files..."

  $copyCount = 0
  $totalToCopy = $filesToArchive.Count
  foreach ($entry in $filesToArchive) {
    $copyCount++
    $destinationPath = Join-Path $stagingRoot $entry.RelativePath
    $destinationDir = Split-Path -Parent $destinationPath

    if (-not (Test-Path $destinationDir)) {
      New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
    }

    Copy-Item -Path $entry.FullName -Destination $destinationPath -Force

    $percentComplete = [math]::Floor(($copyCount / $totalToCopy) * 100)
    Write-Progress -Activity "Copying files" -Status ("{0:N0}/{1:N0} - {2}" -f $copyCount, $totalToCopy, $entry.RelativePath) -PercentComplete $percentComplete

    if ($copyCount -eq 1 -or $copyCount % 500 -eq 0 -or $copyCount -eq $totalToCopy) {
      Write-StatusLine ("Copied {0:N0}/{1:N0}: {2}" -f $copyCount, $totalToCopy, $entry.RelativePath) DarkGray
    }
  }
  Write-Progress -Activity "Copying files" -Completed
  Write-StatusLine "Staging complete." Green

  Write-Section "Creating Zip"
  if (Test-Path $resolvedOutputPath) {
    Write-StatusLine "Removing existing zip at the destination first..." DarkYellow
    Remove-Item -Path $resolvedOutputPath -Force
  }

  Write-AnimatedStatus "Igniting compression core..."
  $compressionJob = Start-Job -ScriptBlock {
    param(
      [string]$SourcePath,
      [string]$DestinationPath
    )

    Compress-Archive -Path (Join-Path $SourcePath "*") -DestinationPath $DestinationPath -CompressionLevel Optimal
  } -ArgumentList $stagingRoot, $resolvedOutputPath

  Show-LiveSpinner -Message "Building zip archive..." -Job $compressionJob -StatusScript {
    if (Test-Path $resolvedOutputPath) {
      return ("| current size {0:N2} MB" -f ((Get-Item $resolvedOutputPath).Length / 1MB))
    }

    return "| warming up"
  }

  Wait-Job -Job $compressionJob | Out-Null
  $jobErrors = $compressionJob.ChildJobs | ForEach-Object {
    $_.Error | ForEach-Object { $_.ToString() }
  } | Where-Object { $_ }

  if ($jobErrors) {
    throw ($jobErrors -join [Environment]::NewLine)
  }

  Receive-Job -Job $compressionJob -ErrorAction Stop | Out-Null
  Remove-Job -Job $compressionJob -Force

  $archiveInfo = Get-Item -Path $resolvedOutputPath
  $elapsed = (Get-Date) - $scriptStart

  Write-Banner "Archive Complete" Yellow
  Write-StatusLine ("Source zip created: {0}" -f $resolvedOutputPath) Green
  Write-StatusLine ("Archive size: {0:N2} MB" -f ($archiveInfo.Length / 1MB)) Green
  Write-StatusLine ("Elapsed time: {0:hh\:mm\:ss}" -f $elapsed) Green
} catch {
  $scriptFailed = $true
  Write-Progress -Activity "Copying files" -Completed

  Write-Banner "Archive Failed" Red
  Write-StatusLine $_.Exception.Message Red

  if ($_.InvocationInfo -and $_.InvocationInfo.ScriptLineNumber) {
    Write-StatusLine ("Line {0}: {1}" -f $_.InvocationInfo.ScriptLineNumber, $_.InvocationInfo.Line.Trim()) DarkRed
  }

} finally {
  if (Test-Path $stagingRoot) {
    Write-StatusLine "Cleaning up the staging folder..." DarkGray
    Remove-Item -Path $stagingRoot -Recurse -Force
  }

  if ($compressionJob) {
    Remove-Job -Job $compressionJob -Force -ErrorAction SilentlyContinue
  }

  Wait-ForExit
}

if ($scriptFailed) {
  exit 1
}
