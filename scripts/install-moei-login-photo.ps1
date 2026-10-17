<#
.SYNOPSIS
 Install the approved user-provided MOEI harbor photo as the Login background.
.DESCRIPTION
 No network request or AI image generation. Source is the original picture
 copied via browser right-click > Copy image, or an existing JPG/PNG file.
 Run under Windows PowerShell with -STA so Clipboard image works.
#>
[CmdletBinding()]
param(
  [string]$SourceFile,
  [switch]$FromClipboard
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $repo 'public\branding\moei-login-maritime.jpg'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
Add-Type -AssemblyName System.Drawing

if ($SourceFile) {
  $src = (Resolve-Path -LiteralPath $SourceFile).Path
  $img = [System.Drawing.Image]::FromFile($src)
  try {
    if ($img.Width -lt 1000 -or $img.Height -lt 600) {
      throw 'Image dimensions are too small; copy the original maritime photo, not a tiny preview.'
    }
    $img.Save($destination, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  } finally { $img.Dispose() }
} else {
  Add-Type -AssemblyName System.Windows.Forms
  if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) {
    throw 'Clipboard has no image. In ChatGPT right-click the original harbor photo and choose Copy image.'
  }
  $img = [System.Windows.Forms.Clipboard]::GetImage()
  if ($null -eq $img) { throw 'Unable to read image from clipboard.' }
  try {
    if ($img.Width -lt 1000 -or $img.Height -lt 600) {
      throw 'Copied image is too small; use the original harbor photo, not the screenshot.'
    }
    $img.Save($destination, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  } finally { $img.Dispose() }
}
$bytes = [System.IO.File]::ReadAllBytes($destination)
if ($bytes.Length -lt 100000 -or $bytes[0] -ne 0xFF -or $bytes[1] -ne 0xD8) {
  throw 'Invalid JPEG output: login file was not installed.'
}
$hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
Write-Host "MOEI Login background installed: $destination" -ForegroundColor Green
Write-Host "JPEG bytes: $($bytes.Length)  SHA256: $hash"
Write-Host 'To keep the photo on future PRs, commit this file to your feature branch.'
