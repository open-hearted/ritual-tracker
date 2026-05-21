Add-Type -AssemblyName System.Drawing

function Draw-Icon {
    param([string]$name, [System.Drawing.Color]$bgColor, [string]$text)
    $path = Join-Path $PWD $name
    $bmp = New-Object System.Drawing.Bitmap(512, 512)
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    
    $bgBrush = New-Object System.Drawing.SolidBrush($bgColor)
    $graphics.FillRectangle($bgBrush, 0, 0, 512, 512)
    
    $font = New-Object System.Drawing.Font("Segoe UI Emoji", 200)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $format = New-Object System.Drawing.StringFormat()
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    
    $graphics.DrawString($text, $font, $textBrush, 256, 256, $format)
    
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bmp.Dispose()
    Write-Output "Created $name"
}

Draw-Icon "icon-wake.png" ([System.Drawing.Color]::DarkOrange) "🌅"
Draw-Icon "icon-awake.png" ([System.Drawing.Color]::MediumSeaGreen) "👀"
Draw-Icon "icon-sleep.png" ([System.Drawing.Color]::MidnightBlue) "🌙"
