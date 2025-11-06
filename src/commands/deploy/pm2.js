// TODO EN EL PROCESO DE INSTALACION CONTENTEMPLAR INSTALAR SSHPASS AL USUARIO PARA QUE TENGA LISTO ESO TAMBIEN
// SOPORTE PARA QUE SOPORTE ALIAS LOCAL DE . ----> BUSCA KORAM SINO BUSCA EN EL ENTORNO POR EL HOST
// src/commands/deploy.js
const { Command, flags } = require('@oclif/command');
const keytar = require('keytar');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { spawn } = require('child_process');

class DeployCommand extends Command {
  async run() {
    const { args, flags } = this.parse(DeployCommand);
    const alias = args.alias;

    if (!alias) {
      console.log(chalk.red('❌ Debes indicar un alias de servidor para el deploy'));
      return;
    }

    // Leer credenciales
    const credFile = path.join(process.env.HOME, '.koram_credentials.json');
    if (!fs.existsSync(credFile)) {
      console.log(chalk.red('❌ No se encontraron credenciales guardadas'));
      return;
    }

    const allCreds = JSON.parse(fs.readFileSync(credFile));
    const keys = Object.keys(allCreds).filter(k => k.startsWith(alias + ':'));

    if (keys.length === 0) {
      console.log(chalk.red(`❌ No se encontró credencial para alias "${alias}"`));
      return;
    }

    // Selección si hay varias credenciales
    let keyToUse;
    if (keys.length === 1) {
      keyToUse = keys[0];
    } else {
      const choices = keys.map(k => {
        const user = k.split(':')[1];
        const host = allCreds[k].host || '-';
        return { name: `${user}@${alias} | Host: ${host}`, value: k };
      });
      const answer = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: `Se encontraron varias credenciales para alias "${alias}", selecciona cuál usar:`,
        choices
      }]);
      keyToUse = answer.selected;
    }

    const [aliasName, user] = keyToUse.split(':');
    const host = allCreds[keyToUse].host;
    if (!host) {
      console.log(chalk.red(`❌ No se encontró host definido para ${user}@${aliasName}`));
      return;
    }

    const password = await keytar.getPassword('koram', keyToUse);
    const useSSHKey = flags.sshKey || false;

    console.log(chalk.green(`🚀 Preparando deploy para ${user}@${host} usando ${useSSHKey ? 'SSH key' : 'contraseña'}...`));

    // Detectar archivos ecosystem (.js, .cjs, .ts)
    const allowedExts = ['.js', '.cjs', '.ts'];
    const ecosystems = fs.readdirSync(process.cwd())
      .filter(f => f.startsWith('ecosystem') && allowedExts.includes(path.extname(f)));

    if (ecosystems.length === 0) {
      console.log(chalk.red('❌ No se encontró ningún archivo ecosystem válido'));
      return;
    }

    let ecosystemFile = ecosystems[0];
    if (ecosystems.length > 1) {
      const answer = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Se encontraron varios archivos ecosystem, selecciona cuál usar:',
        choices: ecosystems
      }]);
      ecosystemFile = answer.selected;
    }

    const env = flags.env || 'production';
    const extraParams = flags.extra || '';

    // Construir comando PM2
    let pm2Command = `pm2 deploy ${ecosystemFile} ${env} ${extraParams}`.trim();

    // Si se usa contraseña, prefijamos con sshpass
    if (password && !useSSHKey) {
      pm2Command = `sshpass -p '${password}' ${pm2Command}`;
    }

    console.log(chalk.blue(`🔹 Comando final: ${pm2Command}`));

    // Ejecutar PM2 deploy localmente
    const deployProcess = spawn(pm2Command, { shell: true, stdio: 'inherit' });

    deployProcess.on('exit', code => {
      if (code === 0) {
        console.log(chalk.green('✅ Deploy completado con éxito'));
      } else {
        console.log(chalk.red(`❌ Deploy finalizó con código ${code}`));
      }
    });
  }
}

DeployCommand.description = `Realiza un deploy automático usando alias de credenciales guardadas.
Si se desea omitir la contraseña y usar la llave SSH cargada en el agente, usar --ssh-key o -k.
Permite múltiples archivos ecosystem (.js, .cjs, .ts) y parámetros extra de PM2.`;

DeployCommand.args = [
  { name: 'alias', required: true, description: 'Alias del servidor a desplegar' }
];

DeployCommand.flags = {
  env: flags.string({ char: 'e', description: 'Environment a usar', default: 'production' }),
  extra: flags.string({ char: 'x', description: 'Parámetros extra para pm2' }),
  sshKey: flags.boolean({ char: 'k', description: 'Omitir contraseña y usar SSH key cargada en el agente' }),
};

module.exports = DeployCommand;
