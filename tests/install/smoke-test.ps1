# End-to-end regression test for install.ps1, run against a fake release
# served from this machine rather than the real GitHub one -- so it exercises
# the real download, the real checksum verification, the real unpack and the
# real junction swap without depending on network access or on a release
# existing.
#
# install.sh gets the same treatment from tests/install/smoke-test.sh. That
# test also covers release *resolution* (the /latest redirect and the atom
# feed), which both scripts implement identically; this one pins an explicit
# -Version so it can stay focused on the part that is genuinely
# Windows-specific: what happens to the staged files between "downloaded" and
# "current points at it".
#
# Run from the repository root:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests/install/smoke-test.ps1

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$installPs1 = Join-Path $repoRoot "install.ps1"
$repoSlug = "farhadeidi/bookmarks-but-better"
$exe = "bookmarks-but-better"
$target = "x86_64-pc-windows-msvc"
$version = "4.0.0"
$tag = "v$version"

$pass = 0
$fail = 0
function Test-Ok($message) { $script:pass++; Write-Host "ok - $message" }
function Test-Bad($message) { $script:fail++; Write-Host "NOT OK - $message" }
function Assert-That($condition, $message) {
  if ($condition) { Test-Ok $message } else { Test-Bad $message }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ("bbb-smoke-" + [IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $work -Force | Out-Null

$server = $null
$substDrive = $null

function Stop-Fixture {
  if ($script:server) {
    Stop-Job $script:server -ErrorAction SilentlyContinue
    Remove-Job $script:server -Force -ErrorAction SilentlyContinue
  }
  if ($script:substDrive) { & subst $script:substDrive /D 2>&1 | Out-Null }
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

try {
  # -------------------------------------------------------------------------
  # The fake release: a real PE executable, because the whole point of this
  # test is what Windows does to an executable it has just run. A batch file
  # renamed to .exe would not be scanned, would not be locked, and would not
  # reproduce anything.
  # -------------------------------------------------------------------------
  $serveDir = Join-Path $work "serve\$tag"
  New-Item -ItemType Directory -Path $serveDir -Force | Out-Null

  $archiveName = "$exe-$version-$target.zip"
  $stagingRoot = Join-Path $work "staging"
  $payload = Join-Path $stagingRoot "$exe-$version-$target"
  New-Item -ItemType Directory -Path $payload -Force | Out-Null

  Add-Type -OutputType ConsoleApplication -OutputAssembly (Join-Path $payload "$exe.exe") -TypeDefinition @"
public class FakeDaemon {
  public static int Main(string[] args) {
    if (args.Length > 0 && args[0] == "--version") {
      System.Console.WriteLine("bookmarks-but-better $version (smoke test)");
      return 0;
    }
    return 1;
  }
}
"@
  Set-Content -Path (Join-Path $payload "README.md") -Value "readme"
  Set-Content -Path (Join-Path $payload "LICENSE") -Value "license"

  $archivePath = Join-Path $serveDir $archiveName
  Compress-Archive -Path $payload -DestinationPath $archivePath -Force
  $hash = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  # The sidecar shape install.ps1 parses: "<hash>  <filename>".
  Set-Content -Path "$archivePath.sha256" -Value "$hash  $archiveName" -Encoding ascii

  # -------------------------------------------------------------------------
  # The fake server. A raw TcpListener rather than HttpListener, which would
  # need a netsh URL reservation to bind without elevation, and rather than a
  # Python one-liner, which would need Python on the box. It answers exactly
  # the one endpoint an explicit -Version install reads:
  # /<repo>/releases/download/<tag>/<asset>.
  # -------------------------------------------------------------------------
  $port = Get-Random -Minimum 20000 -Maximum 25000
  $server = Start-Job -ArgumentList $port, (Join-Path $work "serve"), $repoSlug -ScriptBlock {
    param($Port, $Root, $Slug)
    $prefix = "/$Slug/releases/download/"
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    while ($true) {
      $client = $listener.AcceptTcpClient()
      try {
        $stream = $client.GetStream()
        $reader = [IO.StreamReader]::new($stream)
        $requestLine = $reader.ReadLine()
        if (-not $requestLine) { continue }
        $path = ($requestLine -split ' ')[1]
        $body = $null
        if ($path.StartsWith($prefix)) {
          $rel = $path.Substring($prefix.Length) -replace '/', '\'
          $full = Join-Path $Root $rel
          # Refuse anything that resolves outside the fixture directory.
          if ((Test-Path $full) -and
              ([IO.Path]::GetFullPath($full)).StartsWith([IO.Path]::GetFullPath($Root))) {
            $body = [IO.File]::ReadAllBytes($full)
          }
        }
        if ($null -ne $body) {
          $head = "HTTP/1.1 200 OK`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
        } else {
          $body = [byte[]]@()
          $head = "HTTP/1.1 404 Not Found`r`nContent-Length: 0`r`nConnection: close`r`n`r`n"
        }
        $headBytes = [Text.Encoding]::ASCII.GetBytes($head)
        $stream.Write($headBytes, 0, $headBytes.Length)
        if ($body.Length) { $stream.Write($body, 0, $body.Length) }
        $stream.Flush()
      } finally {
        $client.Close()
      }
    }
  }

  $base = "http://127.0.0.1:$port"
  # Give the listener a moment to bind before the first install races it.
  $bound = $false
  foreach ($attempt in 1..50) {
    try {
      $probe = [Net.Sockets.TcpClient]::new("127.0.0.1", $port)
      $probe.Close()
      $bound = $true
      break
    } catch { Start-Sleep -Milliseconds 100 }
  }
  Assert-That $bound "fake release server accepts connections"

  # Runs install.ps1 in its own process, so $env:TEMP can differ per scenario.
  function Invoke-Install {
    param([string]$InstallDir, [string]$TempDir)
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = (Get-Process -Id $PID).Path
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$installPs1`" " +
      "-Version $tag -InstallDir `"$InstallDir`""
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.EnvironmentVariables["BOOKMARKS_BUT_BETTER_INSTALL_GITHUB_BASE"] = $base
    $psi.EnvironmentVariables["TEMP"] = $TempDir
    $psi.EnvironmentVariables["TMP"] = $TempDir
    $process = [Diagnostics.Process]::Start($psi)
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      Output   = "$stdout$stderr"
    }
  }

  function Assert-InstallIsComplete {
    param([string]$InstallDir, [string]$Label)
    $current = Join-Path $InstallDir "current"
    $installedExe = Join-Path $current "$exe.exe"
    Assert-That (Test-Path $installedExe) "$Label - current\$exe.exe exists"
    # Every file from the archive has to be there, not just the executable: a
    # half-copied version directory is the failure mode this guards against.
    foreach ($name in @("README.md", "LICENSE")) {
      Assert-That (Test-Path (Join-Path $current $name)) "$Label - current\$name exists"
    }
    if (Test-Path $installedExe) {
      $reported = (& $installedExe --version 2>&1) -join ""
      Assert-That ($reported -match [regex]::Escape($version)) "$Label - installed exe reports $version"
    }
  }

  # -------------------------------------------------------------------------
  # Scenario 1: an ordinary install.
  # -------------------------------------------------------------------------
  $installDir1 = Join-Path $work "install-plain"
  $tempDir1 = Join-Path $work "temp-plain"
  New-Item -ItemType Directory -Path $tempDir1 -Force | Out-Null
  $result1 = Invoke-Install -InstallDir $installDir1 -TempDir $tempDir1
  Assert-That ($result1.ExitCode -eq 0) "plain install exits 0"
  if ($result1.ExitCode -ne 0) { Write-Host $result1.Output }
  Assert-InstallIsComplete -InstallDir $installDir1 -Label "plain install"

  # Installing the same version again has to replace the version directory
  # rather than trip over it.
  $result2 = Invoke-Install -InstallDir $installDir1 -TempDir $tempDir1
  Assert-That ($result2.ExitCode -eq 0) "reinstall over an existing version exits 0"
  if ($result2.ExitCode -ne 0) { Write-Host $result2.Output }
  Assert-InstallIsComplete -InstallDir $installDir1 -Label "reinstall"

  # -------------------------------------------------------------------------
  # Scenario 2: issue #66. Real-time antivirus takes a read-share handle on an
  # executable it has just scanned and releases it asynchronously, so the step
  # after install.ps1 runs the staged exe for its --version check can hit a
  # file it is not allowed to delete. That handle is reproduced here exactly:
  # a watcher takes one the moment the staged exe appears and holds it.
  #
  # The staging directory is put on a subst'd drive so that the move into
  # $InstallDir crosses a volume boundary, which is what makes Move-Item walk
  # the directory file by file -- the shape the original report shows
  # ("bookmarks-but-better.exe:FileInfo"), and the shape in which a failure
  # has already deleted part of the source and cannot be retried.
  # -------------------------------------------------------------------------
  $substTarget = Join-Path $work "volume"
  New-Item -ItemType Directory -Path $substTarget -Force | Out-Null
  $substDrive = $null
  foreach ($letter in @("X:", "Y:", "W:", "V:")) {
    if (-not (Test-Path $letter)) {
      & subst $letter $substTarget 2>&1 | Out-Null
      if (Test-Path $letter) { $substDrive = $letter; break }
    }
  }

  if (-not $substDrive) {
    Test-Bad "could not map a spare drive letter for the cross-volume scenario"
  } else {
    $tempDir2 = "$substDrive\temp"
    New-Item -ItemType Directory -Path $tempDir2 -Force | Out-Null
    $installDir2 = Join-Path $work "install-locked"

    $watcher = Start-Job -ArgumentList $tempDir2, $exe -ScriptBlock {
      param($TempDir, $Exe)
      # Poll rather than use FileSystemWatcher: the window between the exe
      # being extracted and install.ps1 moving it is what has to be caught,
      # and a poll that misses it simply makes the test a weaker one rather
      # than a flaky one.
      $deadline = (Get-Date).AddSeconds(90)
      while ((Get-Date) -lt $deadline) {
        $candidate = Get-ChildItem -Path $TempDir -Recurse -Filter "$Exe.exe" -ErrorAction SilentlyContinue |
          Select-Object -First 1
        if ($candidate) {
          try {
            # FileShare.Read: readable, but not deletable or renamable -- the
            # same handle a real-time scan holds.
            $handle = [IO.File]::Open($candidate.FullName, 'Open', 'Read', 'Read')
            Start-Sleep -Seconds 5
            $handle.Close()
            return "locked $($candidate.FullName)"
          } catch { }
        }
        Start-Sleep -Milliseconds 20
      }
      return "never saw the staged exe"
    }

    $result3 = Invoke-Install -InstallDir $installDir2 -TempDir $tempDir2
    $watcherResult = (Receive-Job -Job $watcher -Wait -ErrorAction SilentlyContinue) -join ""
    Remove-Job $watcher -Force -ErrorAction SilentlyContinue

    Assert-That ($watcherResult -like "locked *") "watcher held a scan-shaped lock on the staged exe"
    Assert-That ($result3.ExitCode -eq 0) "install survives a locked staged exe across a volume boundary"
    if ($result3.ExitCode -ne 0) { Write-Host $result3.Output }
    Assert-InstallIsComplete -InstallDir $installDir2 -Label "locked install"
  }

  # -------------------------------------------------------------------------
  # install.ps1 has to stay ASCII. Windows PowerShell 5.1 reads a file with no
  # byte-order mark using the machine's ANSI codepage, so a single non-ASCII
  # character in a double-quoted string closes it early and the whole script
  # fails to parse -- for every user who downloads it with -OutFile and runs
  # it, which is one of the two documented ways to install.
  # -------------------------------------------------------------------------
  $nonAscii = @([IO.File]::ReadAllBytes($installPs1) | Where-Object { $_ -gt 127 })
  Assert-That ($nonAscii.Count -eq 0) "install.ps1 contains no non-ASCII bytes"
} finally {
  Stop-Fixture
}

Write-Host ""
Write-Host "passed $pass, failed $fail"
if ($fail -gt 0) { exit 1 }
exit 0
