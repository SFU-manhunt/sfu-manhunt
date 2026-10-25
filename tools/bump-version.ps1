# Bumps the app version in all three places, so phones pick up the new files:
#   version.json, js/config.js (SFU.VERSION) and the ?v= tags in index.html.
# Run from the project folder:  powershell -File tools\bump-version.ps1
$root = Split-Path -Parent $PSScriptRoot
$enc = New-Object Text.UTF8Encoding $false
$old = (Get-Content (Join-Path $root 'version.json') -Raw | ConvertFrom-Json).v
$new = $old + 1

[IO.File]::WriteAllText((Join-Path $root 'version.json'), "{ `"v`": $new }`n", $enc)

$cfg = Join-Path $root 'js\config.js'
$c = [IO.File]::ReadAllText($cfg) -replace 'SFU\.VERSION = \d+;', "SFU.VERSION = $new;"
[IO.File]::WriteAllText($cfg, $c, $enc)

$html = Join-Path $root 'index.html'
$h = [IO.File]::ReadAllText($html) -replace '\?v=\d+"', "?v=$new`""
[IO.File]::WriteAllText($html, $h, $enc)

"Version $old -> $new"
