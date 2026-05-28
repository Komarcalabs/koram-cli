Write-Host "========================================" -ForegroundColor Cyan
Write-Host "        Instalador de KORAM CLI         " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$nodeInstalled = Get-Command node -ErrorAction SilentlyContinue

if (!$nodeInstalled) {
    Write-Host "=> Node.js no esta instalado." -ForegroundColor Yellow
    Write-Host "=> Descargando e instalando Node.js (esto tomara unos minutos)..." -ForegroundColor Yellow
    
    $nodeInstaller = "$env:TEMP\node-installer.msi"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi" -OutFile $nodeInstaller
    
    Write-Host "=> Por favor espera, instalando Node.js de forma silenciosa..."
    Start-Process -Wait -FilePath "msiexec" -ArgumentList "/i $nodeInstaller /quiet /norestart"
    
    # Recargar variables de entorno combinando Machine y User para no perder rutas del sistema
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = $machinePath + ';' + $userPath
} else {
    $nodeVer = node -v
    Write-Host "=> Node.js ya esta instalado: $nodeVer" -ForegroundColor Green
}

Write-Host "=> Instalando koram desde npm..." -ForegroundColor Yellow
cmd.exe /c "npm install -g koram"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Koram instalado exitosamente!" -ForegroundColor Green
Write-Host "Puedes ejecutar 'koram' para empezar." -ForegroundColor Cyan
Write-Host "Nota: Si acabas de instalar Node.js, puede que necesites cerrar y abrir tu terminal." -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
