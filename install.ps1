#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Installs (or upgrades) the `bookmarks-but-better` daemon for the current
  Windows user, then runs `bookmarks-but-better setup`. No administrator rights
  are used or required.

.DESCRIPTION
  Every release is a GitHub Release built by .github/workflows/release.yml,
  which uploads one .zip archive and one .sha256 checksum for
  x86_64-pc-windows-msvc, plus this script itself under a fixed name. This
  script:

    1. Resolves which release to install: the latest *stable* release by
       default, the latest prerelease with -Beta, or an exact tag with
       -Version. A stable release that carries no daemon build — every stable
       release up to and including v3.2.0 was extension-only — falls back to
       the latest prerelease that does have a Windows build, and says so.
    2. Downloads that archive and its .sha256 sidecar from the GitHub
       Release, and refuses to install unless the archive's hash matches it.
    3. Unpacks into a versioned directory under $InstallRoot and only then
       repoints a `current` directory junction at it (junctions need no
       elevated privilege, unlike an NTFS symlink) — so a failed download or
       a binary that will not even run leaves whatever was already installed
       completely untouched, and this install, once it gets that far, can
       always be rolled back to the version `current` pointed at before.
    4. Adds `current` to the user's PATH (once), and finally runs
       `bookmarks-but-better.exe setup`.

  Everything it fetches is a GitHub Release URL — the release download
  endpoint and the releases Atom feed — so it never calls the GitHub JSON API.
  install.sh resolves releases exactly the same way, so both platforms pick
  the same release for the same flags.

  Nothing here touches a vault. Uninstalling is: delete $InstallRoot and
  remove it from PATH; your vault, wherever `bookmarks-but-better setup`
  pointed it at, is a directory of Markdown files this script has never heard
  of.

.PARAMETER Beta
  Install the latest prerelease instead of the latest stable release.

.PARAMETER Version
  Install exactly this release, e.g. v4.0.0 or v4.0.0-beta.1 (with or
  without the leading "v"). Overrides -Beta.

.PARAMETER InstallDir
  Where versions are unpacked. Default: $env:LOCALAPPDATA\bookmarks-but-better.

.PARAMETER SkipSetup
  Install the binary but do not run `bookmarks-but-better setup` afterward.

.EXAMPLE
  irm https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.ps1 | iex

.EXAMPLE
  iwr -useb https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.ps1 -OutFile install.ps1
  .\install.ps1 -Beta
#>
[CmdletBinding()]
param(
  [switch]$Beta,
  [string]$Version = "",
  [string]$InstallDir = "$env:LOCALAPPDATA\bookmarks-but-better",
  [switch]$SkipSetup
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Repo = "farhadeidi/bookmarks-but-better"
$Exe = "bookmarks-but-better"
$Target = "x86_64-pc-windows-msvc"
$InstallRoot = $InstallDir
$CurrentLink = Join-Path $InstallRoot "current"
# Overridable only for this script's own test suite — there is no supported
# reason to point it anywhere but github.com in normal use.
$GitHubBase = if ($env:BOOKMARKS_BUT_BETTER_INSTALL_GITHUB_BASE) {
  $env:BOOKMARKS_BUT_BETTER_INSTALL_GITHUB_BASE
} else {
  "https://github.com"
}
$ReleasesBase = "$GitHubBase/$Repo/releases"

# The archive this platform needs from a given release. Every release names it
# after its own version, so this can only be computed per release — which is
# exactly why the fallback below has to probe each candidate rather than just
# taking the newest thing it finds.
function Get-ArchiveName {
  param([string]$Tag)
  "$Exe-$($Tag.TrimStart('v'))-$Target.zip"
}

function Get-AssetUrl {
  param([string]$Tag, [string]$Name)
  "$ReleasesBase/download/$Tag/$Name"
}

# A release tag here is either vX.Y.Z or vX.Y.Z-beta.N — release.yml accepts no
# other shape — so "is this a prerelease" is a property of the tag and needs no
# API lookup to answer.
function Test-PrereleaseTag {
  param([string]$Tag)
  return $Tag -like "*-beta.*"
}

# True when a release actually ships a daemon build for Windows. An
# extension-only release (every stable release up to and including v3.2.0)
# does not, and installing from one is not a thing that can succeed.
function Test-ReleaseHasDaemon {
  param([string]$Tag)
  if (-not $Tag) { return $false }
  try {
    $null = Invoke-WebRequest -Uri (Get-AssetUrl $Tag (Get-ArchiveName $Tag)) `
      -Method Head -UseBasicParsing
    return $true
  } catch {
    return $false
  }
}

# The tag /releases/latest redirects to — GitHub's "latest" is by definition
# the newest non-draft, non-prerelease release, so this needs no filtering.
function Get-LatestStableTag {
  $response = Invoke-WebRequest -Uri "$ReleasesBase/latest" -Method Head -UseBasicParsing
  $base = $response.BaseResponse
  # Windows PowerShell 5.1 hands back an HttpWebResponse, whose landing URL is
  # `ResponseUri`; PowerShell 6+ hands back an HttpResponseMessage, where the
  # same thing is `RequestMessage.RequestUri`. Both ship on Windows and the
  # script has to run under either.
  if ($base.PSObject.Properties.Name -contains "ResponseUri") {
    $final = $base.ResponseUri.AbsoluteUri
  } else {
    $final = $base.RequestMessage.RequestUri.AbsoluteUri
  }
  return ($final.TrimEnd('/') -split '/')[-1]
}

# Every release tag in the Atom feed, newest first. The feed's entry links are
# .../releases/tag/<tag>, which is the only thing read out of it.
function Get-ReleaseTags {
  $feed = Invoke-WebRequest -Uri "$ReleasesBase.atom" -UseBasicParsing
  $text = [string]$feed.Content
  return [regex]::Matches($text, '/releases/tag/([^"]+)"') |
    ForEach-Object { $_.Groups[1].Value }
}

# The newest prerelease that actually has a build for Windows.
function Get-LatestBetaTagWithDaemon {
  foreach ($candidate in Get-ReleaseTags) {
    if (-not (Test-PrereleaseTag $candidate)) { continue }
    if (Test-ReleaseHasDaemon $candidate) { return $candidate }
  }
  return $null
}

Write-Host "platform: $Target"

# ---------------------------------------------------------------------------
# 1. Which release: an explicit tag, the latest prerelease, or the latest
#    stable release. Stable is the default; a prerelease always has to be
#    asked for, one way or another.
# ---------------------------------------------------------------------------
$tag = $null
if ($Version) {
  $tag = "v$($Version.TrimStart('v'))"
  Write-Host "resolving explicit release $tag"
} elseif ($Beta) {
  Write-Host "resolving the latest prerelease"
  $tag = Get-LatestBetaTagWithDaemon
  if (-not $tag) {
    throw "no prerelease has a $Exe build for $Target; pass -Version to install a specific one"
  }
} else {
  Write-Host "resolving the latest stable release"
  $tag = Get-LatestStableTag
  if (-not $tag) { throw "could not resolve the latest release" }

  # A stable release that carries no daemon build is how `irm … | iex` ends in
  # "release vX has no asset named bookmarks-but-better-…" — every stable
  # release up to and including v3.2.0 was extension-only. Fall back to the
  # newest prerelease that does carry a Windows build, loudly: a prerelease is
  # normally something you have to ask for, and this is the one case where the
  # alternative is not installing at all.
  if (-not (Test-ReleaseHasDaemon $tag)) {
    Write-Host "the latest stable release ($tag) ships no $Exe daemon build for $Target"
    Write-Host "falling back to the latest prerelease — pass -Version <tag> to pin a specific release"
    $tag = Get-LatestBetaTagWithDaemon
    if (-not $tag) {
      throw "no stable or prerelease release has a $Exe build for $Target yet"
    }
  }
}

if (-not $tag.StartsWith("v")) {
  throw "the resolved release tag '$tag' is not a vMAJOR.MINOR.PATCH tag"
}
$version = $tag.TrimStart("v")
Write-Host "installing $tag (version $version)"

$archiveName = Get-ArchiveName $tag
$checksumName = "$archiveName.sha256"

# ---------------------------------------------------------------------------
# 2. Download and verify. Nothing below this point is installed until the
#    hash matches.
# ---------------------------------------------------------------------------
$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $workDir | Out-Null
try {
  $archivePath = Join-Path $workDir $archiveName
  $checksumPath = Join-Path $workDir $checksumName

  Write-Host "downloading $archiveName"
  try {
    Invoke-WebRequest -Uri (Get-AssetUrl $tag $archiveName) -OutFile $archivePath -UseBasicParsing
  } catch {
    throw "release $tag has no asset named $archiveName"
  }
  try {
    Invoke-WebRequest -Uri (Get-AssetUrl $tag $checksumName) -OutFile $checksumPath -UseBasicParsing
  } catch {
    throw "release $tag has no checksum for $archiveName"
  }

  Write-Host "verifying checksum"
  # The sidecar is the standard `sha256sum`/`shasum` line: "<hash>  <filename>".
  $expected = ((Get-Content $checksumPath -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
  $actual = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expected -ne $actual) {
    throw "checksum verification failed for $archiveName (expected $expected, got $actual) — refusing to install a corrupted or tampered download"
  }

  # -------------------------------------------------------------------------
  # 3. Unpack into a fresh versioned directory. The version already
  #    installed (if any) is completely untouched by everything up to and
  #    including this step.
  # -------------------------------------------------------------------------
  $extractDir = Join-Path $workDir "extracted"
  Expand-Archive -Path $archivePath -DestinationPath $extractDir

  $staged = Join-Path $extractDir "$Exe-$version-$Target"
  $stagedExe = Join-Path $staged "$Exe.exe"
  if (-not (Test-Path $stagedExe)) {
    throw "the archive did not contain $Exe.exe — this is a packaging bug, not a local problem"
  }

  $null = & $stagedExe --version 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "the downloaded $Exe.exe does not run on this machine (checked with --version)"
  }

  $previousVersion = $null
  if (Test-Path $CurrentLink) {
    $existingTarget = (Get-Item $CurrentLink).Target
    if ($existingTarget) {
      $previousVersion = Split-Path -Leaf ($existingTarget | Select-Object -First 1)
    }
  }

  $versionDir = Join-Path (Join-Path $InstallRoot "versions") $version
  if (Test-Path $versionDir) { Remove-Item -Recurse -Force $versionDir }
  New-Item -ItemType Directory -Path (Split-Path -Parent $versionDir) -Force | Out-Null
  Move-Item -Path $staged -Destination $versionDir

  # -----------------------------------------------------------------------
  # 4. Repoint `current` — the one step that changes what a running
  #    `bookmarks-but-better` on PATH resolves to. A directory junction, not a
  #    symlink: junctions need no elevated privilege on Windows, unlike NTFS
  #    symlinks.
  # -----------------------------------------------------------------------
  if (Test-Path $CurrentLink) { Remove-Item -Force $CurrentLink }
  New-Item -ItemType Junction -Path $CurrentLink -Target $versionDir | Out-Null

  $currentExe = Join-Path $CurrentLink "$Exe.exe"
  $null = & $currentExe --version 2>&1
  $postSwapOk = $LASTEXITCODE -eq 0

  if (-not $postSwapOk) {
    if ($previousVersion) {
      Write-Host "the new version failed its post-install check; rolling back to $previousVersion"
      Remove-Item -Force $CurrentLink
      $previousDir = Join-Path (Join-Path $InstallRoot "versions") $previousVersion
      New-Item -ItemType Junction -Path $CurrentLink -Target $previousDir | Out-Null
    } else {
      Write-Host "the new version failed its post-install check; removing the incomplete install"
      Remove-Item -Force $CurrentLink
    }
    throw "install of $tag did not pass its post-install check"
  }

  # -----------------------------------------------------------------------
  # 5. PATH: add `current` once, for this user only.
  # -----------------------------------------------------------------------
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $pathEntries = @()
  if ($userPath) { $pathEntries = $userPath -split ";" }
  if ($pathEntries -notcontains $CurrentLink) {
    $newPath = if ($userPath) { "$userPath;$CurrentLink" } else { $CurrentLink }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "added $CurrentLink to your user PATH (restart your shell to pick it up)"
  }
  # Also make it available for the rest of *this* process, so the `setup`
  # call below (and this session) can use `bookmarks-but-better` without a new
  # shell.
  if (($env:Path -split ";") -notcontains $CurrentLink) {
    $env:Path = "$env:Path;$CurrentLink"
  }

  if ($previousVersion -and $previousVersion -ne $version) {
    Write-Host "upgraded ${Exe}: $previousVersion -> $version"
  } elseif ($previousVersion) {
    Write-Host "reinstalled $Exe $version"
  } else {
    Write-Host "installed $Exe $version"
  }
  Write-Host "  binary:  $currentExe"
  Write-Host "  version: $versionDir"

  if ($SkipSetup) {
    Write-Host ""
    Write-Host "Skipping setup (-SkipSetup). Run `"$currentExe`" setup when ready."
    exit 0
  }

  Write-Host ""
  & $currentExe setup
  exit $LASTEXITCODE
} finally {
  Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
}
