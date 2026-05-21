$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { $PWD.Path }
& (Join-Path $scriptDir "gen-icons2.ps1")
