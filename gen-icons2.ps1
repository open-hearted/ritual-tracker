Add-Type -AssemblyName System.Drawing

$outputDir = if ($PSScriptRoot) { $PSScriptRoot } else { $PWD.Path }

function New-SolidIcon {
    param(
        [string]$Name,
        [int]$Size,
        [System.Drawing.Color]$Color
    )

    $path = Join-Path $outputDir $Name
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    $brush = New-Object System.Drawing.SolidBrush($Color)

    $graphics.FillRectangle($brush, 0, 0, $Size, $Size)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

    $brush.Dispose()
    $graphics.Dispose()
    $bmp.Dispose()
    Write-Output "Created $Name"
}

$icons = @(
    @{ Prefix = "sleep"; Color = [System.Drawing.ColorTranslator]::FromHtml("#191970") }
)

foreach ($icon in $icons) {
    New-SolidIcon "icon-$($icon.Prefix).png" 512 $icon.Color
    New-SolidIcon "icon-$($icon.Prefix)-192.png" 192 $icon.Color
    New-SolidIcon "icon-$($icon.Prefix)-180.png" 180 $icon.Color
}

$quickLogColor = [System.Drawing.ColorTranslator]::FromHtml("#111111")
New-SolidIcon "icon-512.png" 512 $quickLogColor
New-SolidIcon "icon-192.png" 192 $quickLogColor
New-SolidIcon "icon-180.png" 180 $quickLogColor
