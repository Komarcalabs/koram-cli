const { Command, flags } = require('@oclif/command');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const util = require('util');
const inquirer = require('inquirer');

const execAsync = util.promisify(exec);

class CleanCommand extends Command {
  async run() {
    const { flags } = this.parse(CleanCommand);
    const auto = flags.yes || false;

    console.log(chalk.cyan('🧹 Iniciando el ritual de purificación Komarquino...\n'));

    try {
      const steps = [
        { name: 'node_modules', path: path.join(process.cwd(), 'node_modules'), description: 'Purificar node_modules' },
        { name: 'dist', path: path.join(process.cwd(), 'dist'), description: 'Purificar dist' },
        { name: 'build', path: path.join(process.cwd(), 'build'), description: 'Purificar build' },
        { name: 'npm cache', command: 'npm cache clean --force', description: 'Purificar cache de npm' },
        { name: 'logs', path: path.join(process.cwd(), 'logs'), description: 'Purificar logs temporales' },
      ];

      for (const step of steps) {
        let proceed = auto; // si se pasa -y, se ejecuta automáticamente

        if (!auto) {
          const answer = await inquirer.prompt([{
            type: 'confirm',
            name: 'proceed',
            message: `Deseas ejecutar el ritual para: ${step.description}?`,
            default: true
          }]);
          proceed = answer.proceed;
        }

        if (proceed) {
          if (step.path) {
            if (fs.existsSync(step.path)) {
              console.log(chalk.yellow(`⚡ Ejecutando ritual sobre ${step.name}...`));
              await execAsync(`rm -rf ${step.path}`);
              console.log(chalk.green(`✔ ${step.name} purificado`));
            } else {
              console.log(chalk.green(`✔ ${step.name} ya estaba limpio`));
            }
          } else if (step.command) {
            console.log(chalk.yellow(`⚡ Ejecutando ritual sobre ${step.name}...`));
            await execAsync(step.command);
            console.log(chalk.green(`✔ ${step.name} purificado`));
          }
        } else {
          console.log(chalk.blue(`⏩ Ritual de ${step.name} omitido`));
        }
      }

      console.log(chalk.magenta('\n🧙‍♂️ Ritual de purificación completado. Tu proyecto brilla nuevamente.'));

    } catch (error) {
      console.log(chalk.red('💥 Algo salió mal en el ritual:'), error);
    }
  }
}

CleanCommand.description = `Purifica tu proyecto Node.js de manera interactiva
Koram preguntará antes de eliminar node_modules, dist/build, cache de npm y logs temporales.
Usa -y o --yes para ejecutar automáticamente sin preguntar.
`;

CleanCommand.flags = {
  yes: flags.boolean({ char: 'y', description: 'Ejecutar purificación sin preguntar' })
};

module.exports = CleanCommand;
