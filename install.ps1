Write-Host "========================================" -ForegroundColor Cyan
Write-Host "        Instalador de KORAM CLI         " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$nodeInstalled = Get-Command node -ErrorAction SilentlyContinue

if (!$nodeInstalled) {
    Write-Host "=> Node.js no está instalado." -ForegroundColor Yellow
    Write-Host "=> Descargando e instalando Node.js (esto tomará unos minutos)..." -ForegroundColor Yellow
    
    $nodeInstaller = "$env:TEMP\node-installer.msi"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi" -OutFile $nodeInstaller
    
    Write-Host "=> Por favor espera, instalando Node.js de forma silenciosa..."
    Start-Process -Wait -FilePath "msiexec" -ArgumentList "/i $nodeInstaller /quiet /norestart"
    
    # Recargar variables de entorno para que Node/NPM estén disponibles en esta sesión
    foreach($level in "Machine","User") {
        [Environment]::GetEnvironmentVariables($level).GetEnumerator() | % {
            if ($_.Name -eq 'Path') {
                $env:Path = $_.Value
            }
        }
    }
} else {
    $nodeVer = node -v
    Write-Host "=> Node.js ya está instalado: $nodeVer" -ForegroundColor Green
}

Write-Host "=> Instalando koram desde npm..." -ForegroundColor Yellow
npm install -g koram

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "¡Koram instalado exitosamente!" -ForegroundColor Green
Write-Host "Puedes ejecutar 'koram' para empezar." -ForegroundColor Cyan
Write-Host "Nota: Si acabas de instalar Node.js, puede que necesites cerrar y abrir tu terminal." -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
