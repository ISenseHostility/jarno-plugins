# Zips each plugin as exports/<name>-v<major>.zip, the version read from its plugin.json.
# Versions only bump the first number (1.0.0, 2.0.0, ...), so v1, v2, ... name them.
#   powershell -File export.ps1             export every plugin
#   powershell -File export.ps1 stats-board export one
param([string[]]$Plugins)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$root = $PSScriptRoot
$out = Join-Path $root 'exports'
New-Item -ItemType Directory -Force $out | Out-Null

$dirs = Get-ChildItem $root -Directory | Where-Object { Test-Path (Join-Path $_.FullName '.claude-plugin/plugin.json') }
if ($Plugins) { $dirs = $dirs | Where-Object { $Plugins -contains $_.Name } }

foreach ($dir in $dirs) {
	$manifest = Get-Content (Join-Path $dir.FullName '.claude-plugin/plugin.json') -Raw | ConvertFrom-Json
	$major = ($manifest.version -split '\.')[0]
	$zip = Join-Path $out "$($manifest.name)-v$major.zip"

	# Stage a clean copy: no generated types, logs or editor files.
	$stage = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
	$copy = Join-Path $stage $manifest.name
	Copy-Item $dir.FullName $copy -Recurse
	Get-ChildItem $copy -Recurse -Force -Directory | Where-Object { $_.Name -eq 'types' -and $_.Parent.Name -eq '.claude-plugin' } | Remove-Item -Recurse -Force
	Get-ChildItem $copy -Recurse -Force -File -Include '*.log', '.DS_Store' | Remove-Item -Force
	# A zip sent on its own carries the repository's license.
	$license = Join-Path $root 'LICENSE'
	if ((Test-Path $license) -and -not (Test-Path (Join-Path $copy 'LICENSE'))) { Copy-Item $license $copy }

	# Entries are named with forward slashes, so the zip unpacks on macOS and Linux too
	# (Windows PowerShell's Compress-Archive and ZipFile both write backslashes).
	if (Test-Path $zip) { Remove-Item $zip -Force }
	$archive = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
	try {
		foreach ($file in Get-ChildItem $copy -Recurse -Force -File) {
			$entry = $manifest.name + '/' + $file.FullName.Substring($copy.Length + 1).Replace('\', '/')
			[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entry, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
		}
	} finally {
		$archive.Dispose()
	}
	Remove-Item $stage -Recurse -Force
	Write-Output "$($manifest.name) $($manifest.version) -> exports/$(Split-Path $zip -Leaf)"
}
