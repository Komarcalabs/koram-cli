#!/usr/bin/env node
// COMANDO PARA INSTALAR PYTHON EN MULTISISTEMA SI SALEN ERRORES -----> para el post install
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');

console.log(chalk.cyan('🧩 Verificando entorno Python...'));

function hasCommand(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getPythonVersion() {
  try {
    const output = execSync('python3 --version', { encoding: 'utf8' });
    const match = output.match(/Python (\d+)\.(\d+)/);
    if (match) {
      return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        full: output.trim()
      };
    }
  } catch {
    return null;
  }
  return null;
}

function tryInstallPython() {
  const platform = os.platform();
  console.log(chalk.yellow('⚠️  Python3 no encontrado. Intentando instalarlo...'));

  try {
    if (platform === 'darwin') {
      if (hasCommand('brew')) {
        console.log(chalk.cyan('🍺 Instalando Python3 con Homebrew...'));
        execSync('brew install python', { stdio: 'inherit' });
      } else {
        console.warn(
          chalk.red(
            '❌ Homebrew no está instalado. Instálalo con:\n' +
            '   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
          )
        );
        process.exit(1);
      }
    } else if (platform === 'linux') {
      console.log(chalk.cyan('🐧 Instalando Python3 y módulos necesarios...'));
      execSync('sudo apt-get update -y', { stdio: 'inherit' });
      execSync('sudo apt-get install -y python3 python3-pip python3-venv', { stdio: 'inherit' });
    } else if (platform === 'win32') {
      console.warn(
        chalk.yellow(
          '⚠️  Instalación automática no soportada en Windows.\n' +
          '   Descarga Python manualmente desde: https://www.python.org/downloads/windows/'
        )
      );
    } else {
      console.warn(chalk.yellow('⚠️  Instalación automática no soportada en este sistema operativo.'));
    }
  } catch (e) {
    console.error(chalk.red('❌ No se pudo instalar Python3 automáticamente.'));
    console.error(chalk.gray(e.message));
  }
}

function ensureEnsurepip() {
  try {
    execSync('python3 -m ensurepip --upgrade', { stdio: 'inherit' });
    console.log(chalk.green('✅ Módulo ensurepip disponible.'));
  } catch {
    const platform = os.platform();
    if (platform === 'linux') {
      console.log(chalk.yellow('⚙️ Instalando python3-venv (faltaba ensurepip)...'));
      try {
        execSync('sudo apt-get install -y python3-venv', { stdio: 'inherit' });
      } catch (e) {
        console.error(chalk.red('❌ No se pudo instalar python3-venv.'));
        console.error(chalk.gray(e.message));
      }
    }
  }
}

// 1️⃣ Verificar instalación y versión de Python3
const version = getPythonVersion();
const MIN_MAJOR = 3;
const MIN_MINOR = 7;

let isCompatible = false;
if (version) {
  if (version.major > MIN_MAJOR || (version.major === MIN_MAJOR && version.minor >= MIN_MINOR)) {
    isCompatible = true;
    console.log(chalk.green(`✅ ${version.full} detectado (Compatible).`));
  } else {
    console.warn(chalk.yellow(`⚠️  ${version.full} detectado - Versión muy antigua (Se requiere >= 3.7).`));
  }
}

if (!isCompatible) {
  if (!version) tryInstallPython();

  const newVersion = getPythonVersion();
  if (newVersion && (newVersion.major > MIN_MAJOR || (newVersion.major === MIN_MAJOR && newVersion.minor >= MIN_MINOR))) {
    isCompatible = true;
    console.log(chalk.green(`✅ ${newVersion.full} instalado correctamente.`));
  } else {
    console.warn(chalk.yellow('⚠️  Koram entrará en modo Lite: Los comandos de deploy Nuxt/SPA no estarán disponibles sin Python 3.7+.'));
  }
}

if (isCompatible) {
  // 2️⃣ Verificar ensurepip disponible
  ensureEnsurepip();

  // 3️⃣ Crear entorno virtual y dependencias
  try {
    const venvPath = path.join(__dirname, '..', 'venv');
    if (!fs.existsSync(venvPath)) {
      console.log(chalk.cyan('🛠️  Creando entorno virtual...'));
      execSync('python3 -m venv venv', { stdio: 'inherit' });
    }

    console.log(chalk.cyan('📦 Instalando dependencias Python...'));
    execSync('venv/bin/pip install --upgrade pip', { stdio: 'inherit' });
    execSync('venv/bin/pip install -r src/python-deployer/requirements.txt', { stdio: 'inherit' });

    console.log(chalk.green('✅ Entorno Python instalado correctamente.'));
  } catch (err) {
    console.warn(chalk.yellow('⚠️  No se pudo configurar el entorno Python (se omitirá para versión Lite).'));
    console.warn(chalk.gray(err.message));
  }
}
