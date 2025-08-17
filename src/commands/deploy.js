const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const chalk = require('chalk');
const { exec } = require('child_process');
const keytar = require('keytar');

class DeployCommand extends Command {
  async run() {
    const { args, flags } = this.parse(DeployCommand);
    const env = args.environment;
    if (!env) {
      console.log(chalk.red('❌ Debes especificar un entorno: staging, production, etc.'));
      return;
    }

    // Manejo de archivo ecosystem
    let ecosystemFile = flags.ecosystem;
    const ecosystems = fs.readdirSync(process.cwd()).filter(f =>
      f.startsWith('ecosystem') && (f.endsWith('.js') || f.endsWith('.cjs') || f.endsWith('.mjs'))
    );

    if (!ecosystemFile) {
      if (ecosystems.length === 0) {
        console.log(chalk.red('❌ No se encontró ningún archivo ecosystem'));
        return;
      } else if (ecosystems.length === 1) {
        ecosystemFile = ecosystems[0];
      } else {
        const answer = await inquirer.prompt([{
          type: 'list',
          name: 'ecosystem',
          message: 'Selecciona el archivo ecosystem a usar:',
          choices: ecosystems
        }]);
        ecosystemFile = answer.ecosystem;
      }
    }

    // Leer credencial guardada
    const serverAlias = flags.server || env; // puede mapearse al env o alias
    const user = flags.user || 'root';
    const password = await keytar.getPassword('koram', `${serverAlias}:${user}`);
    if (!password) {
      console.log(chalk.red(`❌ No se encontró credencial para ${user}@${serverAlias}`));
      return;
    }

    // Construir comando PM2
    let pm2Args = flags.pm2Args || '';
    const deployCommand = `pm2 deploy ${ecosystemFile} ${env} ${pm2Args}`;

    console.log(chalk.blue(`🚀 Ejecutando deploy en ${env} usando ${ecosystemFile}...`));

    // Ejecutar deploy con la credencial
    const child = exec(deployCommand, {
      env: { ...process.env, SSH_PASSWORD: password },
      stdio: 'inherit'
    });

    child.stdout.on('data', data => console.log(data.toString()));
    child.stderr.on('data', data => console.error(data.toString()));
    child.on('close', async code => {
      console.log(chalk.green(`✅ Deploy finalizado con código ${code}`));
      if (flags.cmd) {
        console.log(chalk.blue(`💡 Ejecutando comando post-deploy: ${flags.cmd}`));
        const post = exec(flags.cmd, { env: process.env });
        post.stdout.on('data', d => console.log(d.toString()));
        post.stderr.on('data', e => console.error(e.toString()));
      }
    });
  }
}

DeployCommand.description = `Realiza un deploy automático usando PM2 con credenciales guardadas.
`;

DeployCommand.args = [
  { name: 'environment', required: true, description: 'Nombre del entorno (staging, production, etc.)' }
];

DeployCommand.flags = {
  ecosystem: flags.string({ char: 'e', description: 'Archivo ecosystem.config.js a usar' }),
  pm2Args: flags.string({ char: 'a', description: 'Argumentos extra para PM2' }),
  cmd: flags.string({ char: 'c', description: 'Comando post-deploy a ejecutar en el servidor' }),
  server: flags.string({ char: 's', description: 'Alias o host del servidor (para credencial)' }),
  user: flags.string({ char: 'u', description: 'Usuario SSH para el deploy' })
};

module.exports = DeployCommand;
