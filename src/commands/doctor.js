const { Command } = require('@oclif/command');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const util = require('util');

const execAsync = util.promisify(exec);

class DoctorCommand extends Command {
  async run() {
    console.log(chalk.cyan('🧙‍♂️ Iniciando el ritual de diagnóstico Komarquino...\n'));

    let warnings = 0;
    let errors = 0;

    try {
      // 1. Node y NPM
      const nodeVersion = process.version;
      const { stdout: npmVersion } = await execAsync('npm -v');
      console.log(chalk.green(`✔ Node: ${nodeVersion}`));
      console.log(chalk.green(`✔ NPM: ${npmVersion.trim()}`));

      // 2. Verificar .koram-rc
      const koramRcPath = path.join(process.cwd(), '.koram-rc');
      if (fs.existsSync(koramRcPath)) {
        console.log(chalk.green(`✔ Archivo sagrado .koram-rc encontrado`));
      } else {
        console.log(chalk.yellow(`⚠ No se encontró .koram-rc`));
        console.log(chalk.cyan('✨ Ritual sugerido: ejecuta `koram deploy` para crear tu archivo sagrado.'));
        warnings++;
      }

      // 3. Dependencias desactualizadas
      console.log(chalk.cyan('\n🔎 Revisando dependencias desactualizadas...'));
      try {
        const { stdout } = await execAsync('npm outdated --json');
        if (!stdout) {
          console.log(chalk.green('✔ Todas las dependencias están al día'));
        } else {
          const outdated = JSON.parse(stdout);
          console.log(chalk.yellow('⚠ Dependencias desactualizadas:'));
          for (const dep in outdated) {
            const info = outdated[dep];
            console.log(` - ${dep}: ${info.current} → ${info.latest}`);
          }
          console.log(chalk.cyan('✨ Ritual sugerido: ejecuta `koram upgrade` para actualizar tus dependencias.'));
          warnings++;
        }
      } catch {
        console.log(chalk.green('✔ Todas las dependencias están al día'));
      }

      // 4. Vulnerabilidades
      console.log(chalk.cyan('\n🛡 Revisando vulnerabilidades...'));
      try {
        const { stdout } = await execAsync('npm audit --json');
        const audit = JSON.parse(stdout);
        const vulnerabilities = audit.metadata?.vulnerabilities;
        if (vulnerabilities) {
          const total = Object.values(vulnerabilities).reduce((a,b)=>a+b,0);
          if (total === 0) {
            console.log(chalk.green('✔ No se encontraron vulnerabilidades'));
          } else {
            console.log(chalk.red(`❌ Vulnerabilidades encontradas: ${total}`));
            console.table(vulnerabilities);
            console.log(chalk.cyan('✨ Ritual sugerido: ejecuta `npm audit fix` o `koram upgrade` para purificar tu proyecto.'));
            errors++;
          }
        } else {
          console.log(chalk.green('✔ No se encontraron vulnerabilidades'));
        }
      } catch {
        console.log(chalk.green('✔ No se encontraron vulnerabilidades'));
      }

      // Resumen final épico
      console.log('\n' + chalk.magenta('🔮 Resumen del ritual Komarquino:'));
      if (errors > 0) {
        console.log(chalk.red(`❌ Problemas críticos detectados: ${errors}`));
      } else if (warnings > 0) {
        console.log(chalk.yellow(`⚠ Advertencias encontradas: ${warnings}`));
      } else {
        console.log(chalk.green('🟢 Ritual completo sin errores. ¡Tu proyecto está bendecido por el Koram!'));
      }

    } catch (error) {
      console.log(chalk.red('💥 Algo salió mal en el ritual:'), error);
    }
  }
}

DoctorCommand.description = `Realiza un chequeo completo del proyecto Node.js
Incluye Node, NPM, dependencias, vulnerabilidades y archivos sagrados (.koram-rc)
También sugiere rituales de sanación para corregir los problemas encontrados.
`;

module.exports = DoctorCommand;
