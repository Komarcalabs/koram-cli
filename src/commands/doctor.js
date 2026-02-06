const { Command } = require('@oclif/command');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const util = require('util');
const glob = require('glob');

const execAsync = util.promisify(exec);

class DoctorCommand extends Command {
  async run() {
    console.log(chalk.cyan('🧙‍♂️ Iniciando el ritual de diagnóstico Komarquino v2.0...\n'));

    let warnings = 0;
    let errors = 0;

    try {
      // 1. Node y NPM
      const nodeVersion = process.version;
      const { stdout: npmVersion } = await execAsync('npm -v');
      console.log(chalk.green(`✔ Node: ${nodeVersion}`));
      console.log(chalk.green(`✔ NPM: ${npmVersion.trim()}`));

      // 2. Herramientas de Sistema (Nuevos Requerimientos)
      console.log(chalk.cyan('\n🛠 Revisando herramientas de sistema...'));

      // Rsync
      try {
        await execAsync('rsync --version');
        console.log(chalk.green('✔ Rsync: Instalado (Transferencia Delta activada)'));
      } catch {
        console.log(chalk.yellow('⚠ Rsync: No encontrado (Los deploys usarán fallback Tar, más lento)'));
        warnings++;
      }

      // Sshpass
      try {
        await execAsync('sshpass -V');
        console.log(chalk.green('✔ Sshpass: Instalado (Autenticación por password soportada)'));
      } catch {
        console.log(chalk.yellow('⚠ Sshpass: No encontrado (Rsync fallará si usas contraseña sin SSH-Agent)'));
        warnings++;
      }

      // Keytar / Bóveda
      try {
        require('keytar');
        console.log(chalk.green('✔ Keytar: Operativo (Bóveda de credenciales segura activada)'));
      } catch {
        console.log(chalk.red('❌ Keytar: No operativo (Las credenciales podrían guardarse en texto plano)'));
        errors++;
      }

      // 3. Archivos de Configuración (.koram-rc.*.json)
      console.log(chalk.cyan('\n📂 Revisando configuración del proyecto...'));
      const configs = glob.sync(path.join(process.cwd(), '.koram-rc.*.json'));
      if (configs.length > 0) {
        console.log(chalk.green(`✔ Entornos encontrados (${configs.length}): ${configs.map(f => path.basename(f)).join(', ')}`));
      } else {
        console.log(chalk.yellow('⚠ No se encontraron archivos .koram-rc.*.json'));
        console.log(chalk.cyan('   ✨ Ritual sugerido: ejecuta `koram init` para bendecir tu proyecto.'));
        warnings++;
      }

      // 4. Vulnerabilidades (Opcional pero útil)
      console.log(chalk.cyan('\n🛡 Revisando seguridad del proyecto...'));
      try {
        const { stdout } = await execAsync('npm audit --json');
        const audit = JSON.parse(stdout);
        const vulnerabilities = audit.metadata?.vulnerabilities;
        if (vulnerabilities) {
          const total = Object.values(vulnerabilities).reduce((a, b) => a + b, 0);
          if (total === 0) {
            console.log(chalk.green('✔ No se encontraron vulnerabilidades'));
          } else {
            console.log(chalk.yellow(`⚠ Vulnerabilidades encontradas: ${total}`));
            warnings++;
          }
        }
      } catch {
        console.log(chalk.green('✔ Seguridad verificada.'));
      }

      // Resumen final épico
      console.log('\n' + chalk.magenta('🔮 Resumen del ritual Komarquino:'));
      if (errors > 0) {
        console.log(chalk.red(`❌ Problemas críticos detectados: ${errors}`));
        console.log(chalk.red('   Tu entorno no es del todo sagrado. Considera corregir los errores para un despliegue sin mácula.'));
      } else if (warnings > 0) {
        console.log(chalk.yellow(`⚠ Advertencias encontradas: ${warnings}`));
        console.log(chalk.yellow('   Tu entorno es funcional, pero podría ser más eficiente.'));
      } else {
        console.log(chalk.green('🟢 ¡Felicidades! Tu entorno ha sido bendecido por el Koram.'));
        console.log(chalk.green('   Estás listo para desplegar con la fuerza de mil servidores.'));
      }

    } catch (error) {
      console.log(chalk.red('💥 El ritual ha sido interrumpido por una fuerza oscura:'), error.message);
    }
  }
}

DoctorCommand.description = `Realiza un diagnóstico profundo de tu entorno de desarrollo Koram.
Verifica dependencias de sistema (rsync, sshpass), la bóveda de credenciales y archivos de configuración.`;

module.exports = DoctorCommand;
