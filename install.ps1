#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Installs (or upgrades) the `bbb` daemon for the current Windows user, then
  runs `bbb setup`. No administrator rights are used or required.

.DESCRIPTION
  Every release is a GitHub Release built by .github/workflows/release.yml,
  which uploads one .zip archive and one .sha256 checksum for
  x86_64-pc-windows-msvc. This script:

    1. Resolves which release to install: the latest *stable* release by
       default, the latest prerelease with -Beta, or an exact tag with
       -Version. Until the daemon has a stable release, the latest stable
       release is an extension-only one carrying no `bbb` archive at all;
       when that is what the default resolves to, this falls back to the
       latest prerelease that does have a Windows build, and says so.
    2. Downloads that archive and its .sha256 sidecar, and refuses to
       install unless the archive's hash matches it.
    3. Unpacks into a versioned directory under $InstallRoot and only then
       repoints a `current` directory junction at it (junctions need no
       elevated privilege, unlike an NTFS symlink) — so a failed download or
       a binary that will not even run leaves whatever was already installed
       completely untouched, and this install, once it gets that far, can
       always be rolled back to the version `current` pointed at before.
    4. Adds `current` to the user's PATH (once), and finally runs
       `bbb.exe setup`.

  Nothing here touches a vault. Uninstalling is: delete $InstallRoot and
  remove it from PATH; your vault, wherever `bbb setup` pointed it at, is a
  directory of Markdown files this script has never heard of.

.PARAMETER Beta
  Install the latest prerelease instead of the latest stable release.

.PARAMETER Version
  Install exactly this release, e.g. v4.0.0 or v4.0.0-beta.1 (with or
  without the leading "v"). Overrides -Beta.

.PARAMETER InstallDir
  Where versions are unpacked. Default: $env:LOCALAPPDATA\bbb.

.PARAMETER SkipSetup
  Install the binary but do not run `bbb setup` afterward.

.EXAMPLE
  irm https://raw.githubusercontent.com/farhadeidi/bookmarks-but-better/main/install.ps1 | iex

.EXAMPLE
  iwr -useb https://raw.githubusercontent.com/farhadeidi/bookmarks-but-better/main/install.ps1 -OutFile install.ps1
  .\install.ps1 -Beta
#>
[CmdletBinding()]
param(
  [switch]$Beta,
  [string]$Version = "",
  [string]$InstallDir = "$env:LOCALAPPDATA\bbb",
  [switch]$SkipSetup
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Repo = "farhadeidi/bookmarks-but-better"
$Target = "x86_64-pc-windows-msvc"
$InstallRoot = $InstallDir
$CurrentLink = Join-Path $InstallRoot "current"
# Overridable only for this script's own test suite — there is no supported
# reason to point it anywhere but the real API in normal use.
$ApiBase = if ($env:BBB_INSTALL_GITHUB_API) { $env:BBB_INSTALL_GITHUB_API } else { "https://api.github.com" }

function Invoke-GitHubApi {
  param([string]$Url)
  $headers = @{ Accept = "application/vnd.github+json" }
  if ($env:GITHUB_TOKEN) { $headers["Authorization"] = "token $env:GITHUB_TOKEN" }
  Invoke-RestMethod -Uri $Url -Headers $headers
}

# The archive this platform needs from a given release. Every release names it
# after its own version, so this can only be computed per release — which is
# exactly why the fallback below has to look inside each candidate rather than
# just taking the newest thing it finds.
function Get-ArchiveName {
  param([string]$Tag)
  "bbb-$($Tag.TrimStart('v'))-$Target.zip"
}

# True when a release actually ships a daemon build for Windows. An
# extension-only release (every stable release up to and including v3.2.0)
# does not, and installing from one is not a thing that can succeed.
function Test-ReleaseHasDaemon {
  param($Release)
  if (-not $Release) { return $false }
  $names = $Release.PSObject.Properties.Name
  if (($names -notcontains "tag_name") -or ($names -notcontains "assets")) { return $false }
  if (-not $Release.tag_name) { return $false }
  $wanted = Get-ArchiveName $Release.tag_name
  return [bool]($Release.assets | Where-Object { $_.name -eq $wanted } | Select-Object -First 1)
}

Write-Host "platform: $Target"

# ---------------------------------------------------------------------------
# 1. Which release: an explicit tag, the latest prerelease, or the latest
#    stable release. Stable is the default; a prerelease always has to be
#    asked for, one way or another.
# ---------------------------------------------------------------------------
$release = $null
if ($Version) {
  $tag = $Version.TrimStart("v")
  $tag = "v$tag"
  Write-Host "resolving explicit release $tag"
  try {
    $release = Invoke-GitHubApi "$ApiBase/repos/$Repo/releases/tags/$tag"
  } catch {
    throw "no release found for tag $tag"
  }
} elseif ($Beta) {
  Write-Host "resolving the latest prerelease"
  $releases = Invoke-GitHubApi "$ApiBase/repos/$Repo/releases?per_page=20"
  $release = $releases | Where-Object { -not $_.draft -and $_.prerelease } | Select-Object -First 1
  if (-not $release) {
    throw "no prerelease was found; pass -Version to install a specific one"
  }
} else {
  Write-Host "resolving the latest stable release"
  $release = Invoke-GitHubApi "$ApiBase/repos/$Repo/releases/latest"

  # The daemon has no stable release yet: the latest stable release is an
  # extension-only one, and resolving to it is how `irm … | iex` ends in
  # "release vX has no asset named bbb-…". Fall back to the newest prerelease
  # that does carry a Windows build, loudly — a prerelease is normally
  # something you have to ask for, and this is the one case where the
  # alternative is not installing at all.
  if (-not (Test-ReleaseHasDaemon $release)) {
    $stableTag = if ($release -and $release.tag_name) { $release.tag_name } else { "unknown" }
    Write-Host "the latest stable release ($stableTag) ships no bbb daemon build for $Target"
    Write-Host "falling back to the latest prerelease — pass -Version <tag> to pin a specific release"
    $releases = Invoke-GitHubApi "$ApiBase/repos/$Repo/releases?per_page=20"
    $release = $releases |
      Where-Object { -not $_.draft -and $_.prerelease -and (Test-ReleaseHasDaemon $_) } |
      Select-Object -First 1
    if (-not $release) {
      throw "no stable or prerelease release has a bbb build for $Target yet"
    }
  }
}

$tag = $release.tag_name
if (-not $tag) { throw "the resolved release had no tag" }
$version = $tag.TrimStart("v")
Write-Host "installing $tag (version $version)"

$archiveName = Get-ArchiveName $tag
$checksumName = "$archiveName.sha256"

$archiveAsset = $release.assets | Where-Object { $_.name -eq $archiveName } | Select-Object -First 1
$checksumAsset = $release.assets | Where-Object { $_.name -eq $checksumName } | Select-Object -First 1

if (-not $archiveAsset) { throw "release $tag has no asset named $archiveName" }
if (-not $checksumAsset) { throw "release $tag has no checksum for $archiveName" }

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
  Invoke-WebRequest -Uri $archiveAsset.browser_download_url -OutFile $archivePath
  Invoke-WebRequest -Uri $checksumAsset.browser_download_url -OutFile $checksumPath

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

  $staged = Join-Path $extractDir "bbb-$version-$Target"
  $stagedExe = Join-Path $staged "bbb.exe"
  if (-not (Test-Path $stagedExe)) {
    throw "the archive did not contain bbb.exe — this is a packaging bug, not a local problem"
  }

  $null = & $stagedExe --version 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "the downloaded bbb.exe does not run on this machine (checked with --version)"
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
  # 4. Repoint `current` — the one step that changes what a running `bbb` on
  #    PATH resolves to. A directory junction, not a symlink: junctions need
  #    no elevated privilege on Windows, unlike NTFS symlinks.
  # -----------------------------------------------------------------------
  if (Test-Path $CurrentLink) { Remove-Item -Force $CurrentLink }
  New-Item -ItemType Junction -Path $CurrentLink -Target $versionDir | Out-Null

  $currentExe = Join-Path $CurrentLink "bbb.exe"
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
  # call below (and this session) can use `bbb` without a new shell.
  if (($env:Path -split ";") -notcontains $CurrentLink) {
    $env:Path = "$env:Path;$CurrentLink"
  }

  if ($previousVersion -and $previousVersion -ne $version) {
    Write-Host "upgraded bbb: $previousVersion -> $version"
  } elseif ($previousVersion) {
    Write-Host "reinstalled bbb $version"
  } else {
    Write-Host "installed bbb $version"
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
