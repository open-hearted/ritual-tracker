
Add-Type -AssemblyName System.Drawing

$path1 = Join-Path $PWD "icon-wake.png"
$bmp1 = New-Object System.Drawing.Bitmap(512, 512)
$g1 = [System.Drawing.Graphics]::FromImage($bmp1)
$b1 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::DarkOrange)
$g1.FillRectangle($b1, 0, 0, 512, 512)
$bmp1.Save($path1, [System.Drawing.Imaging.ImageFormat]::Png)
$g1.Dispose(); $bmp1.Dispose()

$path2 = Join-Path $PWD "icon-awake.png"
$bmp2 = New-Object System.Drawing.Bitmap(512, 512)
$g2 = [System.Drawing.Graphics]::FromImage($bmp2)
$b2 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::MediumSeaGreen)
$g2.FillRectangle($b2, 0, 0, 512, 512)
$bmp2.Save($path2, [System.Drawing.Imaging.ImageFormat]::Png)
$g2.Dispose(); $bmp2.Dispose()

$path3 = Join-Path $PWD "icon-sleep.png"
$bmp3 = New-Object System.Drawing.Bitmap(512, 512)
$g3 = [System.Drawing.Graphics]::FromImage($bmp3)
$b3 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::MidnightBlue)
$g3.FillRectangle($b3, 0, 0, 512, 512)
$bmp3.Save($path3, [System.Drawing.Imaging.ImageFormat]::Png)
$g3.Dispose(); $bmp3.Dispose()

