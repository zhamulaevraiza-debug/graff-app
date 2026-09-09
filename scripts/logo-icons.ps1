# Рисует иконки приложения из контуров логотипа (src/data/logo-paths.ts).
#
#   powershell -ExecutionPolicy Bypass -File scripts/logo-icons.ps1
#
# Контуры состоят только из команд M, Q и Z — этого хватает, чтобы нарисовать их
# средствами System.Drawing без сторонних библиотек.
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)
Add-Type -AssemblyName System.Drawing

$src = Get-Content (Join-Path $Root 'src\data\logo-paths.ts') -Raw -Encoding UTF8

function Get-Part([string]$name) {
  $m = [regex]::Match($src, "export const $name\s*:\s*LogoPart\s*=\s*\{\s*box:\s*'([^']+)',\s*d:\s*'([^']+)'")
  if (-not $m.Success) { throw "не нашёл контур $name" }
  $box = $m.Groups[1].Value -split ' ' | ForEach-Object { [double]$_ }
  return @{ box = $box; d = $m.Groups[2].Value }
}

function Get-Color([string]$name) {
  $m = [regex]::Match($src, "export const $name\s*=\s*'#([0-9A-Fa-f]{6})'")
  if (-not $m.Success) { throw "не нашёл цвет $name" }
  $v = $m.Groups[1].Value
  return [System.Drawing.Color]::FromArgb(
    [Convert]::ToInt32($v.Substring(0,2),16),
    [Convert]::ToInt32($v.Substring(2,2),16),
    [Convert]::ToInt32($v.Substring(4,2),16))
}

# Разбирает строку контура в GraphicsPath. Квадратичная кривая переводится в кубическую.
# Блоков-скриптов здесь нет намеренно: присваивание внутри них не видно снаружи,
# и текущая точка не двигалась бы — вместо контура получались лучи из одной точки.
function New-PathFigure([string]$d, [double]$scale, [double]$dx, [double]$dy) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.FillMode = [System.Drawing.Drawing2D.FillMode]::Alternate
  $curX = 0.0; $curY = 0.0; $startX = 0.0; $startY = 0.0
  $open = $false

  foreach ($m in [regex]::Matches($d, '([MQLZ])([^MQLZ]*)')) {
    $cmd = $m.Groups[1].Value
    $nums = @([regex]::Matches($m.Groups[2].Value, '-?\d+(?:\.\d+)?') | ForEach-Object { [double]$_.Value })

    if ($cmd -eq 'M' -and $nums.Count -ge 2) {
      if ($open) { $path.CloseFigure() }
      $path.StartFigure()
      $curX = $nums[0] * $scale + $dx; $curY = $nums[1] * $scale + $dy
      $startX = $curX; $startY = $curY
      $open = $true
    }
    elseif ($cmd -eq 'L' -and $nums.Count -ge 2) {
      $nx = $nums[0] * $scale + $dx; $ny = $nums[1] * $scale + $dy
      $path.AddLine([float]$curX, [float]$curY, [float]$nx, [float]$ny)
      $curX = $nx; $curY = $ny
    }
    elseif ($cmd -eq 'Q' -and $nums.Count -ge 4) {
      $qx = $nums[0] * $scale + $dx; $qy = $nums[1] * $scale + $dy
      $ex = $nums[2] * $scale + $dx; $ey = $nums[3] * $scale + $dy
      $c1x = $curX + 2.0 / 3.0 * ($qx - $curX); $c1y = $curY + 2.0 / 3.0 * ($qy - $curY)
      $c2x = $ex + 2.0 / 3.0 * ($qx - $ex);     $c2y = $ey + 2.0 / 3.0 * ($qy - $ey)
      $path.AddBezier([float]$curX, [float]$curY, [float]$c1x, [float]$c1y, [float]$c2x, [float]$c2y, [float]$ex, [float]$ey)
      $curX = $ex; $curY = $ey
    }
    elseif ($cmd -eq 'Z') {
      if ($open) { $path.CloseFigure(); $open = $false }
      $curX = $startX; $curY = $startY
    }
  }
  if ($open) { $path.CloseFigure() }
  return $path
}

$mark = Get-Part 'LOGO_MARK'
$crown = Get-Part 'LOGO_CROWN'
$red = Get-Color 'LOGO_RED'
$cream = [System.Drawing.Color]::FromArgb(0xFB, 0xF6, 0xEF)
$line = [System.Drawing.Color]::FromArgb(0xD4, 0xB7, 0x9B)

function New-Icon([int]$size, [double]$inset, [double]$round, [bool]$border, [string]$out) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $r = $round * $size
  $bg = New-Object System.Drawing.Drawing2D.GraphicsPath
  if ($r -gt 0) {
    $d = 2 * $r
    $bg.AddArc(0, 0, $d, $d, 180, 90)
    $bg.AddArc($size - $d, 0, $d, $d, 270, 90)
    $bg.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
    $bg.AddArc(0, $size - $d, $d, $d, 90, 90)
    $bg.CloseFigure()
  } else {
    $bg.AddRectangle((New-Object System.Drawing.RectangleF(0, 0, $size, $size)))
  }
  $g.FillPath((New-Object System.Drawing.SolidBrush($cream)), $bg)
  if ($border) {
    $pen = New-Object System.Drawing.Pen($line, [float]([Math]::Max(1, $size / 64)))
    $g.DrawPath($pen, $bg)
    $pen.Dispose()
  }
  $bg.Dispose()

  $pad = $size * $inset
  $inner = $size - 2 * $pad
  $crownH = $inner * 0.20
  $gap = $inner * 0.05
  $markH = $inner - $crownH - $gap
  $crownW = $crown.box[2] * $crownH / $crown.box[3]
  $markW = $mark.box[2] * $markH / $mark.box[3]

  $brush = New-Object System.Drawing.SolidBrush($red)
  $kc = $crownH / $crown.box[3]
  $pc = New-PathFigure $crown.d $kc (($size - $crownW) / 2 - $crown.box[0] * $kc) ($pad - $crown.box[1] * $kc)
  $g.FillPath($brush, $pc); $pc.Dispose()

  $km = $markH / $mark.box[3]
  $pm = New-PathFigure $mark.d $km (($size - $markW) / 2 - $mark.box[0] * $km) ($pad + $crownH + $gap - $mark.box[1] * $km)
  $g.FillPath($brush, $pm); $pm.Dispose()
  $brush.Dispose()

  $g.Dispose()
  $bmp.Save((Join-Path $Root $out), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "$out — $size px"
}

New-Icon 192 0.09 0.25 $true  'public\icon-192.png'
New-Icon 512 0.09 0.25 $true  'public\icon-512.png'
New-Icon 180 0.09 0.00 $true  'public\apple-touch-icon.png'
New-Icon 512 0.22 0.00 $false 'public\icon-maskable-512.png'

# ---- те же иконки в виде SVG: их берут браузер и манифест ----

function New-IconSvg([double]$inset, [double]$round, [bool]$border, [string]$out) {
  $size = 64.0
  $pad = $size * $inset
  $inner = $size - 2 * $pad
  $crownH = $inner * 0.20
  $gap = $inner * 0.05
  $markH = $inner - $crownH - $gap
  $crownW = $crown.box[2] * $crownH / $crown.box[3]
  $markW = $mark.box[2] * $markH / $mark.box[3]
  $r = $round * $size
  $n = { param($v) [Math]::Round($v, 2).ToString([System.Globalization.CultureInfo]::InvariantCulture) }
  $redHex = '#{0:x2}{1:x2}{2:x2}' -f $red.R, $red.G, $red.B

  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">')
  [void]$sb.AppendLine('  <!-- Знак и корона обведены с вывески кафе, см. src/data/logo-paths.ts -->')
  if ($r -gt 0) {
    [void]$sb.AppendLine(('  <rect width="64" height="64" rx="{0}" fill="#FBF6EF"/>' -f (& $n $r)))
    if ($border) { [void]$sb.AppendLine(('  <rect x=".5" y=".5" width="63" height="63" rx="{0}" fill="none" stroke="#D4B79B" stroke-width="1"/>' -f (& $n ($r - 0.5)))) }
  } else {
    [void]$sb.AppendLine('  <rect width="64" height="64" fill="#FBF6EF"/>')
    if ($border) { [void]$sb.AppendLine('  <rect x=".5" y=".5" width="63" height="63" fill="none" stroke="#D4B79B" stroke-width="1"/>') }
  }
  [void]$sb.AppendLine(('  <svg x="{0}" y="{1}" width="{2}" height="{3}" viewBox="{4}"><path fill="{5}" fill-rule="evenodd" d="{6}"/></svg>' -f
    (& $n (($size - $crownW) / 2)), (& $n $pad), (& $n $crownW), (& $n $crownH), ($crown.box -join ' '), $redHex, $crown.d))
  [void]$sb.AppendLine(('  <svg x="{0}" y="{1}" width="{2}" height="{3}" viewBox="{4}"><path fill="{5}" fill-rule="evenodd" d="{6}"/></svg>' -f
    (& $n (($size - $markW) / 2)), (& $n ($pad + $crownH + $gap)), (& $n $markW), (& $n $markH), ($mark.box -join ' '), $redHex, $mark.d))
  [void]$sb.AppendLine('</svg>')
  [System.IO.File]::WriteAllText((Join-Path $Root $out), $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "$out"
}

New-IconSvg 0.09 0.25 $true  'public\icon.svg'
New-IconSvg 0.22 0.00 $false 'public\icon-maskable.svg'
