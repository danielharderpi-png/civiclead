param(
  [string]$MastersDir,
  [string]$OutDir
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")

if (-not $OutDir) {
  $OutDir = Join-Path $repoRoot "store-assets"
}
if (-not $MastersDir) {
  $MastersDir = Join-Path $OutDir "masters"
}
$tilesDir = Join-Path $OutDir "tiles"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
New-Item -ItemType Directory -Force -Path $tilesDir | Out-Null

$boxMasterPath = Join-Path $MastersDir "master-box-art-1x1.png"
$heroMasterPath = Join-Path $MastersDir "master-hero-16x9.png"
$posterMasterPath = Join-Path $MastersDir "master-poster-2x3.png"

foreach ($required in @($boxMasterPath, $heroMasterPath, $posterMasterPath)) {
  if (-not (Test-Path $required)) {
    throw "Missing required master image: $required"
  }
}

$bgColor = [System.Drawing.Color]::FromArgb(255, 0x12, 0x16, 0x1c)

function New-ResizedBitmap {
  param(
    [Parameter(Mandatory=$true)][System.Drawing.Image]$Source,
    [Parameter(Mandatory=$true)][int]$TargetWidth,
    [Parameter(Mandatory=$true)][int]$TargetHeight,
    [ValidateSet('cover', 'contain')][string]$Mode = 'cover'
  )

  $bmp = New-Object System.Drawing.Bitmap($TargetWidth, $TargetHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bmp.SetResolution(96, 96)

  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $attrs = New-Object System.Drawing.Imaging.ImageAttributes
  $attrs.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)

  try {
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $g.Clear($bgColor)

    $srcW = [double]$Source.Width
    $srcH = [double]$Source.Height
    $dstW = [double]$TargetWidth
    $dstH = [double]$TargetHeight

    if ($Mode -eq 'cover') {
      $scale = [Math]::Max($dstW / $srcW, $dstH / $srcH)
      $cropW = $dstW / $scale
      $cropH = $dstH / $scale
      $cropX = ($srcW - $cropW) / 2.0
      $cropY = ($srcH - $cropH) / 2.0

      $destRect = New-Object System.Drawing.Rectangle(0, 0, $TargetWidth, $TargetHeight)
      $g.DrawImage(
        $Source,
        $destRect,
        [float]$cropX,
        [float]$cropY,
        [float]$cropW,
        [float]$cropH,
        [System.Drawing.GraphicsUnit]::Pixel,
        $attrs
      )
    } else {
      $scale = [Math]::Min($dstW / $srcW, $dstH / $srcH)
      $drawW = [int][Math]::Round($srcW * $scale)
      $drawH = [int][Math]::Round($srcH * $scale)
      $drawX = [int][Math]::Floor(($TargetWidth - $drawW) / 2.0)
      $drawY = [int][Math]::Floor(($TargetHeight - $drawH) / 2.0)

      $destRect = New-Object System.Drawing.Rectangle($drawX, $drawY, $drawW, $drawH)
      $g.DrawImage(
        $Source,
        $destRect,
        [float]0,
        [float]0,
        [float]$Source.Width,
        [float]$Source.Height,
        [System.Drawing.GraphicsUnit]::Pixel,
        $attrs
      )
    }
  } finally {
    $attrs.Dispose()
    $g.Dispose()
  }

  return $bmp
}

function Export-ResizedPng {
  param(
    [Parameter(Mandatory=$true)][System.Drawing.Image]$Source,
    [Parameter(Mandatory=$true)][int]$Width,
    [Parameter(Mandatory=$true)][int]$Height,
    [Parameter(Mandatory=$true)][string]$Destination,
    [ValidateSet('cover', 'contain')][string]$Mode = 'cover'
  )

  $bmp = New-ResizedBitmap -Source $Source -TargetWidth $Width -TargetHeight $Height -Mode $Mode
  try {
    $bmp.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output ("Generated {0} ({1}x{2})" -f $Destination, $Width, $Height)
  } finally {
    $bmp.Dispose()
  }
}

function Export-MultiResIco {
  param(
    [Parameter(Mandatory=$true)][System.Drawing.Image]$Source,
    [Parameter(Mandatory=$true)][string]$Destination,
    [int[]]$Sizes = @(16, 24, 32, 48, 64, 128, 256)
  )

  $frames = New-Object System.Collections.Generic.List[byte[]]
  foreach ($size in $Sizes) {
    $bmp = New-ResizedBitmap -Source $Source -TargetWidth $size -TargetHeight $size -Mode 'cover'
    $ms = New-Object System.IO.MemoryStream
    try {
      $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      $frames.Add($ms.ToArray())
    } finally {
      $ms.Dispose()
      $bmp.Dispose()
    }
  }

  $fs = New-Object System.IO.FileStream($Destination, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  $bw = New-Object System.IO.BinaryWriter($fs)
  try {
    # ICONDIR header (6 bytes)
    $bw.Write([uint16]0)                # idReserved
    $bw.Write([uint16]1)                # idType = 1 (ICO)
    $bw.Write([uint16]$Sizes.Count)     # idCount

    $offset = 6 + (16 * $Sizes.Count)
    for ($i = 0; $i -lt $Sizes.Count; $i++) {
      $size = $Sizes[$i]
      $pngBytes = $frames[$i]
      $dimByte = if ($size -ge 256) { [byte]0 } else { [byte]$size }

      $bw.Write($dimByte)               # bWidth
      $bw.Write($dimByte)               # bHeight
      $bw.Write([byte]0)                # bColorCount
      $bw.Write([byte]0)                # bReserved
      $bw.Write([uint16]1)              # wPlanes
      $bw.Write([uint16]32)             # wBitCount
      $bw.Write([uint32]$pngBytes.Length) # dwBytesInRes
      $bw.Write([uint32]$offset)        # dwImageOffset

      $offset += $pngBytes.Length
    }

    foreach ($pngBytes in $frames) {
      $bw.Write($pngBytes)
    }
    Write-Output ("Generated {0} ({1} frames: {2})" -f $Destination, $Sizes.Count, ($Sizes -join ','))
  } finally {
    $bw.Dispose()
    $fs.Dispose()
  }
}

$boxMaster = [System.Drawing.Image]::FromFile($boxMasterPath)
$heroMaster = [System.Drawing.Image]::FromFile($heroMasterPath)
$posterMaster = [System.Drawing.Image]::FromFile($posterMasterPath)

try {
  # 1. Store Listings — Box Art & Logos (1:1)
  Export-ResizedPng -Source $boxMaster -Width 2160 -Height 2160 -Destination (Join-Path $OutDir "BoxArt-2160x2160.png") -Mode 'cover'
  Export-ResizedPng -Source $boxMaster -Width 1080 -Height 1080 -Destination (Join-Path $OutDir "BoxArt-1080x1080.png") -Mode 'cover'
  Export-ResizedPng -Source $boxMaster -Width 300  -Height 300  -Destination (Join-Path $OutDir "StoreLogo-300x300.png") -Mode 'cover'

  # 2. Store Listings — Poster Art (2:3)
  Export-ResizedPng -Source $posterMaster -Width 1440 -Height 2160 -Destination (Join-Path $OutDir "PosterArt-1440x2160.png") -Mode 'cover'
  Export-ResizedPng -Source $posterMaster -Width 720  -Height 1080 -Destination (Join-Path $OutDir "PosterArt-720x1080.png") -Mode 'cover'

  # 3. Store Listings — Hero & Promotional Art (16:9 & 2:1)
  Export-ResizedPng -Source $heroMaster -Width 3840 -Height 2160 -Destination (Join-Path $OutDir "SuperHeroArt-3840x2160.png") -Mode 'cover'
  Export-ResizedPng -Source $heroMaster -Width 1920 -Height 1080 -Destination (Join-Path $OutDir "SuperHeroArt-1920x1080.png") -Mode 'cover'
  Export-ResizedPng -Source $heroMaster -Width 2400 -Height 1200 -Destination (Join-Path $OutDir "PromotionalArt-2400x1200.png") -Mode 'cover'

  # 4. Windows App Tiles & Package Icons
  Export-ResizedPng -Source $boxMaster  -Width 310 -Height 310 -Destination (Join-Path $tilesDir "LargeTile-310x310.png") -Mode 'cover'
  Export-ResizedPng -Source $heroMaster -Width 310 -Height 150 -Destination (Join-Path $tilesDir "WideTile-310x150.png") -Mode 'cover'
  Export-ResizedPng -Source $boxMaster  -Width 150 -Height 150 -Destination (Join-Path $tilesDir "MediumTile-150x150.png") -Mode 'cover'
  Export-ResizedPng -Source $boxMaster  -Width 71  -Height 71  -Destination (Join-Path $tilesDir "SmallTile-71x71.png") -Mode 'cover'
  Export-ResizedPng -Source $boxMaster  -Width 50  -Height 50  -Destination (Join-Path $tilesDir "StoreBadge-50x50.png") -Mode 'cover'
  Export-ResizedPng -Source $boxMaster  -Width 44  -Height 44  -Destination (Join-Path $tilesDir "AppListIcon-44x44.png") -Mode 'cover'
  Export-ResizedPng -Source $boxMaster  -Width 256 -Height 256 -Destination (Join-Path $tilesDir "AppIcon-256x256.png") -Mode 'cover'
  Export-MultiResIco -Source $boxMaster -Destination (Join-Path $tilesDir "CivicLead.ico")
} finally {
  $boxMaster.Dispose()
  $heroMaster.Dispose()
  $posterMaster.Dispose()
}
