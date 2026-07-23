param(
  [string]$PythonCommand = 'python',
  [string]$RequiredPythonVersion = '3.8.20',
  [string]$RequiredNodeVersion = '22.19.0',
  [string]$RequiredYarnVersion = '1.22.22',
  [string]$RequiredRustVersion = '1.96.0',
  [switch]$SkipToolInstall,
  [switch]$NoVersionEnforcement,
  [switch]$SkipYarnInstall,
  [switch]$SkipPythonDeps,
  [switch]$SkipPreflight
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Require-Command {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [string]$Hint = ''
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    if ($Hint) {
      throw "Missing required command '$Name'. $Hint"
    }
    throw "Missing required command '$Name'."
  }
}

function Write-Section {
  param([string]$Text)
  Write-Host ""
  Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$ErrorMessage = 'Command failed.'
  )

  $joined = $Arguments -join ' '
  Write-Host "> $FilePath $joined"
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$ErrorMessage Exit code: $LASTEXITCODE"
  }
}

function Start-ProcessChecked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [int[]]$SuccessExitCodes = @(0),
    [string]$ErrorMessage = 'Process failed.'
  )

  $joined = $Arguments -join ' '
  Write-Host "> $FilePath $joined"
  $proc = Start-Process -FilePath $FilePath -ArgumentList $Arguments -Wait -NoNewWindow -PassThru
  if ($SuccessExitCodes -notcontains $proc.ExitCode) {
    throw "$ErrorMessage Exit code: $($proc.ExitCode)"
  }
}

function Download-File {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [Parameter(Mandatory = $true)]
    [string]$Destination
  )

  Invoke-WebRequest -Uri $Url -OutFile $Destination
}

function Install-NodePortable {
  param([string]$ExpectedVersion)

  Write-Section "Installing portable Node $ExpectedVersion"
  $zipName = "node-v$ExpectedVersion-win-x64.zip"
  $zipPath = Join-Path $env:TEMP $zipName
  $url = "https://nodejs.org/dist/v$ExpectedVersion/$zipName"
  Download-File -Url $url -Destination $zipPath

  $extractRoot = Join-Path $env:LOCALAPPDATA 'Programs'
  $expandedDir = Join-Path $extractRoot "node-v$ExpectedVersion-win-x64"
  if (Test-Path $expandedDir) {
    Remove-Item -Path $expandedDir -Recurse -Force -ErrorAction SilentlyContinue
  }

  Expand-Archive -Path $zipPath -DestinationPath $extractRoot -Force
  $nodeExe = Join-Path $expandedDir 'node.exe'
  if (-not (Test-Path $nodeExe)) {
    throw "Portable Node install failed; expected executable not found at $nodeExe"
  }

  Prefer-NodeExecutable -NodeExe $nodeExe
  return $nodeExe
}

function Get-InstalledPrograms {
  $paths = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )

  $items = @()
  foreach ($path in $paths) {
    $entries = Get-ItemProperty -Path $path -ErrorAction SilentlyContinue |
      Where-Object {
        $displayNameProp = $_.PSObject.Properties['DisplayName']
        if (-not $displayNameProp) {
          return $false
        }

        $displayName = [string]$displayNameProp.Value
        if ([string]::IsNullOrWhiteSpace($displayName)) {
          return $false
        }

        $uninstallProp = $_.PSObject.Properties['UninstallString']
        $quietUninstallProp = $_.PSObject.Properties['QuietUninstallString']
        $uninstall = if ($uninstallProp) { [string]$uninstallProp.Value } else { '' }
        $quietUninstall = if ($quietUninstallProp) { [string]$quietUninstallProp.Value } else { '' }

        return (-not [string]::IsNullOrWhiteSpace($uninstall)) -or (-not [string]::IsNullOrWhiteSpace($quietUninstall))
      } |
      Select-Object DisplayName, DisplayVersion, UninstallString, QuietUninstallString
    if ($entries) {
      $items += $entries
    }
  }

  return $items
}

function Invoke-UninstallString {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DisplayName,
    [Parameter(Mandatory = $true)]
    [string]$RawCommand
  )

  $command = $RawCommand.Trim()
  if (-not $command) {
    return
  }

  if ($command -match '(?i)msiexec(\.exe)?') {
    if ($command -match '(?i)/I\s*\{') {
      $command = [regex]::Replace($command, '(?i)/I\s*\{', '/X {')
    }
    if ($command -notmatch '(?i)\s/qn\b') {
      $command += ' /qn'
    }
    if ($command -notmatch '(?i)\s/norestart\b') {
      $command += ' /norestart'
    }
  }

  Write-Host "Uninstalling: $DisplayName"
  & cmd.exe /c $command | Out-Host
}

function Uninstall-ProgramsByPattern {
  param(
    [Parameter(Mandatory = $true)]
    [string]$NamePattern
  )

  $programs = Get-InstalledPrograms | Where-Object {
    $displayNameProp = $_.PSObject.Properties['DisplayName']
    $displayName = if ($displayNameProp) { [string]$displayNameProp.Value } else { '' }
    -not [string]::IsNullOrWhiteSpace($displayName) -and ($displayName -match $NamePattern)
  }
  foreach ($program in $programs) {
    $cmd = if ($program.QuietUninstallString) { $program.QuietUninstallString } else { $program.UninstallString }
    if ($cmd) {
      Invoke-UninstallString -DisplayName $program.DisplayName -RawCommand $cmd
    }
  }
}

function Uninstall-NodeVersionsViaNvm {
  if (-not (Get-Command 'nvm' -ErrorAction SilentlyContinue)) {
    return
  }

  $lines = (& nvm list 2>$null)
  if (-not $lines) {
    return
  }

  $versions = @()
  foreach ($line in $lines) {
    $matches = [regex]::Matches([string]$line, '\d+\.\d+\.\d+')
    foreach ($m in $matches) {
      $versions += $m.Value
    }
  }

  foreach ($version in ($versions | Sort-Object -Unique)) {
    Write-Host "Removing NVM-managed Node version $version"
    & nvm uninstall $version 2>$null | Out-Host
  }
}

function Remove-NvmFoldersIfPresent {
  $nvmHome = [System.Environment]::GetEnvironmentVariable('NVM_HOME', 'User')
  if (-not $nvmHome) {
    $nvmHome = [System.Environment]::GetEnvironmentVariable('NVM_HOME', 'Machine')
  }

  if ($nvmHome -and (Test-Path $nvmHome)) {
    try {
      Remove-Item -Path $nvmHome -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
      Write-Warning "Could not remove NVM_HOME directory: $nvmHome"
    }
  }

  $nvmSymlink = [System.Environment]::GetEnvironmentVariable('NVM_SYMLINK', 'User')
  if (-not $nvmSymlink) {
    $nvmSymlink = [System.Environment]::GetEnvironmentVariable('NVM_SYMLINK', 'Machine')
  }

  if ($nvmSymlink -and (Test-Path $nvmSymlink)) {
    try {
      $item = Get-Item -LiteralPath $nvmSymlink -ErrorAction SilentlyContinue
      if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Remove-Item -LiteralPath $nvmSymlink -Force -ErrorAction SilentlyContinue
      }
    } catch {
      Write-Warning "Could not remove NVM_SYMLINK path: $nvmSymlink"
    }
  }
}

function Uninstall-MismatchedNode {
  param([string]$ExpectedVersion)

  $current = Get-CommandVersion -Command 'node' -Args @('--version')
  if (-not $current -or (Test-ExactVersion -Actual $current -Expected $ExpectedVersion)) {
    return
  }

  Write-Section 'Removing existing Node installations'
  Uninstall-NodeVersionsViaNvm
  Uninstall-ProgramsByPattern -NamePattern '^NVM for Windows'
  Uninstall-ProgramsByPattern -NamePattern '^Node\.js'
  Remove-NvmFoldersIfPresent
  Refresh-ProcessPath
}

function Uninstall-MismatchedPython {
  param([string]$ExpectedVersion)

  $current = Get-CommandVersion -Command $PythonCommand -Args @('--version')
  if (-not $current -or (Test-ExactVersion -Actual $current -Expected $ExpectedVersion)) {
    return
  }

  Write-Section 'Removing existing Python installations'
  Uninstall-ProgramsByPattern -NamePattern '^Python\s+3(\.|\s)'
  Refresh-ProcessPath
}

function Uninstall-MismatchedRust {
  param([string]$ExpectedVersion)

  $current = Get-CommandVersion -Command 'rustc' -Args @('--version')
  if (-not $current -or (Test-ExactVersion -Actual $current -Expected $ExpectedVersion)) {
    return
  }

  Write-Section 'Removing existing Rust installations'
  if (Get-Command 'rustup' -ErrorAction SilentlyContinue) {
    & rustup self uninstall -y
  }
  Uninstall-ProgramsByPattern -NamePattern '^Rustup'
  Refresh-ProcessPath
}

function Uninstall-ExistingYarn {
  if (-not (Get-Command 'yarn' -ErrorAction SilentlyContinue)) {
    return
  }

  Write-Section 'Removing existing Yarn installations'
  try {
    if (Get-Command 'npm' -ErrorAction SilentlyContinue) {
      & npm uninstall -g yarn | Out-Host
    }
  } catch {
    Write-Warning 'npm-based Yarn uninstall failed; continuing with bootstrap.'
  }

  try {
    if (Get-Command 'corepack' -ErrorAction SilentlyContinue) {
      & corepack disable 2>$null | Out-Host
    }
  } catch {
    Write-Warning 'corepack disable failed; continuing with bootstrap.'
  }

  Uninstall-ProgramsByPattern -NamePattern '^Yarn($|\s)'
  Refresh-ProcessPath
}

function Refresh-ProcessPath {
  $machinePath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $combined = @($machinePath, $userPath) -join ';'
  $env:Path = $combined
}

function Normalize-Version {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ''
  }

  $match = [regex]::Match($Value, '\d+(\.\d+){1,3}')
  if ($match.Success) {
    return $match.Value
  }

  return ''
}

function Require-ExactVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Tool,
    [Parameter(Mandatory = $true)]
    [string]$Actual,
    [Parameter(Mandatory = $true)]
    [string]$Expected
  )

  if ([string]::IsNullOrWhiteSpace($Expected)) {
    return
  }

  $actualNormalized = Normalize-Version -Value $Actual
  $expectedNormalized = Normalize-Version -Value $Expected

  if (-not $actualNormalized) {
    throw "Unable to parse $Tool version from '$Actual'."
  }

  if (-not $expectedNormalized) {
    throw "Expected version for $Tool ('$Expected') is invalid."
  }

  if ($actualNormalized -ne $expectedNormalized) {
    throw "$Tool version mismatch. Expected '$expectedNormalized' but found '$actualNormalized'."
  }
}

function Get-CommandVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [string[]]$Args = @('--version')
  )

  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    return $null
  }

  try {
    $output = (& $Command @Args 2>&1 | Select-Object -First 1)
  } catch {
    return $null
  }

  if ($null -eq $output) {
    return $null
  }

  $text = [string]$output
  if ($text -match '(?i)python was not found') {
    return $null
  }

  return $text
}

function Test-ExactVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Actual,
    [Parameter(Mandatory = $true)]
    [string]$Expected
  )

  return (Normalize-Version -Value $Actual) -eq (Normalize-Version -Value $Expected)
}

function Resolve-NodeExecutable {
  param([string]$ExpectedVersion)

  $candidates = @()

  if (Get-Command 'node' -ErrorAction SilentlyContinue) {
    $candidates += (Get-Command 'node').Source
  }

  $whereNode = @()
  try {
    $whereNode = (& cmd.exe /c "where node 2>nul")
  } catch {
    $whereNode = @()
  }

  if ($whereNode) {
    $cleanWhereNode = $whereNode |
      Where-Object { $_ -and ($_ -notmatch '^(?i)INFO:') }
    if ($cleanWhereNode) {
      $candidates += $cleanWhereNode
    }
  }

  $common = @(
    (Join-Path ${env:ProgramFiles} 'nodejs\node.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
  )
  $candidates += $common

  foreach ($candidate in ($candidates | Where-Object { $_ } | Select-Object -Unique)) {
    if (-not (Test-Path $candidate)) {
      continue
    }

    try {
      $version = (& $candidate --version 2>&1 | Select-Object -First 1)
    } catch {
      continue
    }

    if ($version -and (Test-ExactVersion -Actual ([string]$version) -Expected $ExpectedVersion)) {
      return $candidate
    }
  }

  return $null
}

function Prefer-NodeExecutable {
  param(
    [Parameter(Mandatory = $true)]
    [string]$NodeExe
  )

  $nodeDir = Split-Path -Parent $NodeExe
  if (-not [string]::IsNullOrWhiteSpace($nodeDir)) {
    $existing = $env:Path
    $env:Path = "$nodeDir;$existing"
  }
}

function Ensure-NodeExact {
  param([string]$ExpectedVersion)

  $current = Get-CommandVersion -Command 'node' -Args @('--version')
  if ($current -and (Test-ExactVersion -Actual $current -Expected $ExpectedVersion)) {
    $resolvedCurrent = Resolve-NodeExecutable -ExpectedVersion $ExpectedVersion
    if ($resolvedCurrent) {
      Prefer-NodeExecutable -NodeExe $resolvedCurrent
    }
    return
  }

  if ($SkipToolInstall) {
    throw "Node $ExpectedVersion is required, but found '$current'. Re-run without -SkipToolInstall."
  }

  Write-Section "Installing Node $ExpectedVersion"
  $tempMsi = Join-Path $env:TEMP "node-v$ExpectedVersion-x64.msi"
  $url = "https://nodejs.org/dist/v$ExpectedVersion/node-v$ExpectedVersion-x64.msi"
  Download-File -Url $url -Destination $tempMsi

  $msiInstalled = $true
  try {
    Start-ProcessChecked -FilePath 'msiexec.exe' -Arguments @(
      '/i',
      $tempMsi,
      '/qn',
      '/norestart',
      'MSIINSTALLPERUSER=1',
      'ALLUSERS=2'
    ) -SuccessExitCodes @(0, 3010) -ErrorMessage 'Node MSI install failed.'
  } catch {
    Write-Warning "Node MSI install failed; falling back to portable install. $($_.Exception.Message)"
    $msiInstalled = $false
  }

  Refresh-ProcessPath

  $resolved = Resolve-NodeExecutable -ExpectedVersion $ExpectedVersion
  if (-not $resolved -and -not $msiInstalled) {
    $resolved = Install-NodePortable -ExpectedVersion $ExpectedVersion
  }

  if (-not $resolved -and $msiInstalled) {
    $resolved = Install-NodePortable -ExpectedVersion $ExpectedVersion
  }

  if ($resolved) {
    Prefer-NodeExecutable -NodeExe $resolved
  }

  $updated = Get-CommandVersion -Command 'node' -Args @('--version')
  if (-not $updated -or -not (Test-ExactVersion -Actual $updated -Expected $ExpectedVersion)) {
    $nodeSource = $null
    if (Get-Command 'node' -ErrorAction SilentlyContinue) {
      $nodeSource = (Get-Command 'node').Source
    }

    $whereNode = @()
    try {
      $whereNode = (& cmd.exe /c "where node 2>nul")
    } catch {
      $whereNode = @()
    }

    $cleanWhereNode = $whereNode |
      Where-Object { $_ -and ($_ -notmatch '^(?i)INFO:') }
    $whereDetail = if ($cleanWhereNode) { ($cleanWhereNode -join '; ') } else { 'not found in PATH' }
    $resolvedDetail = if ($resolved) { $resolved } else { 'no exact node.exe candidate found' }
    throw "Node install did not result in expected version $ExpectedVersion. Current: '$updated'. node source: '$nodeSource'. where node: $whereDetail. resolved node candidate: $resolvedDetail"
  }
}

function Ensure-YarnExact {
  param([string]$ExpectedVersion)

  $current = Get-CommandVersion -Command 'yarn' -Args @('--version')
  if ($current -and (Test-ExactVersion -Actual $current -Expected $ExpectedVersion)) {
    return
  }

  if ($SkipToolInstall) {
    throw "Yarn $ExpectedVersion is required, but found '$current'. Re-run without -SkipToolInstall."
  }

  Write-Section "Installing Yarn $ExpectedVersion"
  if (Get-Command 'corepack' -ErrorAction SilentlyContinue) {
    Invoke-External -FilePath 'corepack' -Arguments @('enable') -ErrorMessage 'corepack enable failed.'
    Invoke-External -FilePath 'corepack' -Arguments @('prepare', "yarn@$ExpectedVersion", '--activate') -ErrorMessage 'corepack prepare failed.'
  } else {
    Invoke-External -FilePath 'npm' -Arguments @('install', '-g', "yarn@$ExpectedVersion") -ErrorMessage 'npm install yarn failed.'
  }

  $updated = Get-CommandVersion -Command 'yarn' -Args @('--version')
  if (-not $updated -or -not (Test-ExactVersion -Actual $updated -Expected $ExpectedVersion)) {
    throw "Yarn install did not result in expected version $ExpectedVersion. Current: '$updated'."
  }
}

function Ensure-PythonExact {
  param([string]$ExpectedVersion)

  $current = Get-CommandVersion -Command $PythonCommand -Args @('--version')
  if ($current -and (Test-ExactVersion -Actual $current -Expected $ExpectedVersion)) {
    return
  }

  if ($SkipToolInstall) {
    throw "Python $ExpectedVersion is required, but found '$current'. Re-run without -SkipToolInstall."
  }

  Write-Section "Installing Python $ExpectedVersion"
  $tempExe = Join-Path $env:TEMP "python-$ExpectedVersion-amd64.exe"
  $url = "https://www.python.org/ftp/python/$ExpectedVersion/python-$ExpectedVersion-amd64.exe"
  Download-File -Url $url -Destination $tempExe

  Start-Process -FilePath $tempExe -ArgumentList @(
    '/quiet',
    'InstallAllUsers=0',
    'PrependPath=1',
    'Include_test=0',
    'SimpleInstall=1'
  ) -Wait -NoNewWindow
  Refresh-ProcessPath

  $updated = Get-CommandVersion -Command $PythonCommand -Args @('--version')
  if (-not $updated -or -not (Test-ExactVersion -Actual $updated -Expected $ExpectedVersion)) {
    Write-Warning "Python command '$PythonCommand' did not resolve expected version after install. The script will continue by resolving the exact executable path directly."
  }
}

function Resolve-PythonExecutable {
  param([string]$ExpectedVersion)

  $candidates = @()
  if (Get-Command $PythonCommand -ErrorAction SilentlyContinue) {
    $candidates += (Get-Command $PythonCommand).Source
  }

  if (Get-Command 'py' -ErrorAction SilentlyContinue) {
    $majorMinor = ($ExpectedVersion -split '\.')[0..1] -join '.'
    $probe = (& py "-$majorMinor" -c "import sys; print(sys.version.split()[0]); print(sys.executable)" 2>$null)
    if ($LASTEXITCODE -eq 0 -and $probe.Count -ge 2) {
      $version = [string]$probe[0]
      $exe = [string]$probe[1]
      if (Test-Path $exe -and (Test-ExactVersion -Actual $version -Expected $ExpectedVersion)) {
        return $exe
      }
    }
  }

  $localExe = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python38\python.exe'
  if (Test-Path $localExe) {
    $candidates += $localExe
  }

  foreach ($candidate in $candidates | Select-Object -Unique) {
    try {
      $version = (& $candidate --version 2>&1 | Select-Object -First 1)
    } catch {
      continue
    }

    if ($version -and ([string]$version -match '(?i)python was not found')) {
      continue
    }

    if ($version -and (Test-ExactVersion -Actual ([string]$version) -Expected $ExpectedVersion)) {
      return $candidate
    }
  }

  throw "Could not resolve Python executable for required version $ExpectedVersion."
}

function Ensure-RustToolchainExact {
  param([string]$ExpectedVersion)

  if (-not (Get-Command 'rustup' -ErrorAction SilentlyContinue)) {
    if ($SkipToolInstall) {
      throw "rustup is required for exact Rust pinning. Re-run without -SkipToolInstall."
    }

    Write-Section 'Installing rustup'
    $tempExe = Join-Path $env:TEMP 'rustup-init.exe'
    Download-File -Url 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe' -Destination $tempExe
    Start-Process -FilePath $tempExe -ArgumentList @('-y', '--profile', 'minimal', '--default-toolchain', 'none') -Wait -NoNewWindow
    Refresh-ProcessPath
  }

  $currentRust = Get-CommandVersion -Command 'rustc' -Args @('--version')
  if ($currentRust -and (Test-ExactVersion -Actual $currentRust -Expected $ExpectedVersion)) {
    return
  }

  if ($SkipToolInstall) {
    throw "Rust $ExpectedVersion is required, but found '$currentRust'. Re-run without -SkipToolInstall."
  }

  Write-Section "Installing Rust toolchain $ExpectedVersion"
  Invoke-External -FilePath 'rustup' -Arguments @('toolchain', 'install', $ExpectedVersion, '--profile', 'minimal') -ErrorMessage 'rustup toolchain install failed.'
  Invoke-External -FilePath 'rustup' -Arguments @('default', $ExpectedVersion) -ErrorMessage 'rustup default failed.'
}

function Ensure-VsBuildTools {
  $vsWhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (Test-Path $vsWhere) {
    $installed = & $vsWhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($installed) {
      return
    }
  }

  if (Get-Command 'cl.exe' -ErrorAction SilentlyContinue) {
    return
  }

  if ($SkipToolInstall) {
    throw "Visual C++ Build Tools are required (cl.exe not found). Re-run without -SkipToolInstall."
  }

  Write-Section 'Installing Visual Studio Build Tools (C++ workload)'
  $tempExe = Join-Path $env:TEMP 'vs_BuildTools.exe'
  Download-File -Url 'https://aka.ms/vs/17/release/vs_BuildTools.exe' -Destination $tempExe

  Start-Process -FilePath $tempExe -ArgumentList @(
    '--quiet',
    '--wait',
    '--norestart',
    '--nocache',
    '--add', 'Microsoft.VisualStudio.Workload.VCTools',
    '--includeRecommended',
    '--includeOptional'
  ) -Wait -NoNewWindow

  $vsWhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (Test-Path $vsWhere) {
    $installed = & $vsWhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($installed) {
      return
    }
  }

  if (-not (Get-Command 'cl.exe' -ErrorAction SilentlyContinue)) {
    Write-Warning 'Visual C++ Build Tools were installed, but cl.exe is not on PATH in this shell. Use a Developer PowerShell prompt for packaging.'
  }
}

$scriptDir = Split-Path -Parent $PSCommandPath
$repoRoot = Resolve-Path (Join-Path $scriptDir '..')
Set-Location $repoRoot

Write-Section 'Checking required tools'
if (-not $SkipToolInstall) {
  Uninstall-MismatchedNode -ExpectedVersion $RequiredNodeVersion
  Uninstall-ExistingYarn
  Uninstall-MismatchedPython -ExpectedVersion $RequiredPythonVersion
  Uninstall-MismatchedRust -ExpectedVersion $RequiredRustVersion
}

Ensure-NodeExact -ExpectedVersion $RequiredNodeVersion
Ensure-YarnExact -ExpectedVersion $RequiredYarnVersion
Ensure-PythonExact -ExpectedVersion $RequiredPythonVersion
Ensure-RustToolchainExact -ExpectedVersion $RequiredRustVersion
Ensure-VsBuildTools

Require-Command -Name 'node' -Hint 'Node install verification failed.'
Require-Command -Name 'yarn' -Hint 'Yarn install verification failed.'
Require-Command -Name 'rustc' -Hint 'Rust install verification failed.'
Require-Command -Name 'cargo' -Hint 'Cargo install verification failed.'

$nodeVersion = (node --version).Trim()
$yarnVersion = (yarn --version).Trim()
$resolvedPython = Resolve-PythonExecutable -ExpectedVersion $RequiredPythonVersion
$pythonVersionRaw = (& $resolvedPython --version 2>&1 | Select-Object -First 1)
$rustVersion = (rustc --version).Trim()

Write-Host "Node:   $nodeVersion"
Write-Host "Yarn:   $yarnVersion"
Write-Host "Python: $pythonVersionRaw"
Write-Host "Rust:   $rustVersion"

if (-not $NoVersionEnforcement) {
  Require-ExactVersion -Tool 'Node' -Actual $nodeVersion -Expected $RequiredNodeVersion
  Require-ExactVersion -Tool 'Yarn' -Actual $yarnVersion -Expected $RequiredYarnVersion
  Require-ExactVersion -Tool 'Python' -Actual $pythonVersionRaw -Expected $RequiredPythonVersion
  Require-ExactVersion -Tool 'Rust' -Actual $rustVersion -Expected $RequiredRustVersion
}

$venvDir = Join-Path $repoRoot '.venv'
$venvPython = Join-Path $venvDir 'Scripts\python.exe'

Write-Section 'Preparing Python virtual environment'
if (-not (Test-Path $venvPython)) {
  & $resolvedPython -m venv $venvDir
}

& $venvPython -m pip install --upgrade pip

if (-not $SkipPythonDeps) {
  Write-Section 'Installing sidecar Python dependencies'
  & $venvPython -m pip install -r (Join-Path $repoRoot 'requirements.txt')
}

Write-Section 'Installing frontend/build dependencies'
if (-not $SkipYarnInstall) {
  yarn install
} else {
  Write-Host 'Skipping yarn install by request.'
}

if (-not $SkipPreflight) {
  Write-Section 'Running sidecar preflight checks'
  $env:PYTHON = $venvPython
  yarn sidecar:preflight
} else {
  Write-Host 'Skipping sidecar preflight by request.'
}

Write-Section 'Bootstrap complete'
Write-Host 'Recommended next commands:'
Write-Host '  yarn package'
Write-Host '  # or: yarn package:windows'
