<#
    Ontwikkelsessie op deze Windows-machine opzetten.

    Dot-source dit script, dus met een punt en een spatie ervoor, want het zet
    PATH in je huidige sessie:

        . .\ops\win-dev.ps1

    Er staat op deze machine geen Node.js op PATH; er is een portable Node 22 in
    LOCALAPPDATA. Dat is het enige dat dit script nog regelt.

    Historie, voor het geval de repo ooit weer verhuist
    --------------------------------------------------
    Dit project stond eerst onder "OneDrive - IG&H\Documents". Dat gaf twee
    problemen die met de verhuizing naar C:\dev zijn verdwenen:

    1. De ampersand in "IG&H". npm start zijn lifecycle-scripts via cmd.exe, en
       cmd knipt de PATH-variabele af op die ampersand. Elk npm-script faalde met
       "is not recognized as an internal or external command". Werkbaar te maken
       met $env:npm_config_script_shell = (Get-Command pwsh).Source, en dan pwsh
       en niet powershell.exe, want Windows PowerShell 5.1 kent de operator &&
       niet en die staat in de build-scripts.

    2. OneDrive dat 180 MB node_modules probeerde te synchroniseren. Vervang
       node_modules NIET door een directory junction om dat te omzeilen: npm zet
       in een workspace-repo symlinks in node_modules die terugwijzen naar de
       workspacemappen zelf (node_modules/@kroegentocht/api -> ../../api). Een
       Move-Item of robocopy /MOVE over die boom volgt die symlinks en verhuist
       je broncode mee. Dat is hier een keer gebeurd. Repo buiten OneDrive zetten
       is de enige variant zonder verrassingen.
#>

$ErrorActionPreference = 'Stop'

$nodeDir = Join-Path $env:LOCALAPPDATA 'node-portable\node-v22.12.0-win-x64'
if (-not (Test-Path $nodeDir)) {
    throw "Portable Node niet gevonden op $nodeDir. Pas het pad in dit script aan."
}
$env:PATH = "$nodeDir;$env:PATH"

$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "Node: $(node --version)"
Write-Host "npm:  $(npm --version)"
Write-Host "Repo: $repoRoot"
Write-Host ''
Write-Host 'Handig:'
Write-Host '  npm install'
Write-Host '  npm run build -w shared'
Write-Host '  npm run testdb:up      (PostGIS op 127.0.0.1:55432, vereist Docker)'
Write-Host '  npm run migrate ; npm run seed'
Write-Host '  npm run dev:api        (in een tweede terminal: npm run dev:web)'
Write-Host '  npm run test:unit ; npm run typecheck'
