$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
$releaseRoot = Join-Path $appRoot '发布'
$stageRoot = Join-Path $releaseRoot 'win-x64'
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
Copy-Item -Path (Join-Path $appRoot 'node_modules\electron\dist\*') -Destination $stageRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $stageRoot 'electron.exe') -Destination (Join-Path $stageRoot '拾室素材采集.exe') -Force
Remove-Item -LiteralPath (Join-Path $stageRoot 'electron.exe')
$sourceRoot = Join-Path $stageRoot 'resources\app'
New-Item -ItemType Directory -Path $sourceRoot -Force | Out-Null
Get-ChildItem -LiteralPath $appRoot -File | Where-Object Extension -in '.cjs','.js','.html','.css' | Copy-Item -Destination $sourceRoot -Force
Copy-Item -LiteralPath (Join-Path $appRoot 'package.json') -Destination $sourceRoot -Force
foreach ($folder in 'assets','adapters','runtime') {
  Copy-Item -LiteralPath (Join-Path $appRoot $folder) -Destination $sourceRoot -Recurse -Force
}
& 'C:\Program Files (x86)\NSIS\makensis.exe' '/INPUTCHARSET' 'UTF8' "/DSTAGE=$stageRoot" "/DOUTPUT=$releaseRoot\拾室素材采集-0.2.0-安装程序.exe" (Join-Path $PSScriptRoot 'installer.nsi')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
