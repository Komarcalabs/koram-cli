// src/commands/creds/show.js
const { Command } = require('@oclif/command');
const keytar = require('keytar');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

class CredsShowCommand extends Command {
  async run() {
    const { args } = this.parse(CredsShowCommand);
    const alias = args.alias;

    if (!alias) {
      console.log(chalk.red('❌ Debes indicar un alias'));
      return;
    }

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

    // Si hay varias credenciales para el mismo alias
    let keyToUse;
    if (keys.length === 1) {
      keyToUse = keys[0];
    } else {
      console.log(chalk.yellow(`Se encontraron varias credenciales para alias "${alias}":`));
      keys.forEach(k => {
        const user = k.split(':')[1];
        console.log(`- ${user}`);
      });
      console.log(chalk.yellow('Usa el nombre completo alias:usuario para ver la contraseña'));
      return;
    }

    const [aliasName, user] = keyToUse.split(':');
    const host = allCreds[keyToUse].host || '-';

    // Obtener contraseña desde Keytar
    const password = await keytar.getPassword('koram', keyToUse);

    console.log(chalk.green(`Alias: ${aliasName}`));
    console.log(chalk.green(`Usuario: ${user}`));
    console.log(chalk.green(`Host: ${host}`));
    console.log(chalk.green(`Contraseña: ${password || '(No guardada)'}`));
  }
}

CredsShowCommand.description = `Muestra la información completa de una credencial guardada, incluyendo contraseña`;

CredsShowCommand.args = [
  { name: 'alias', required: true, description: 'Alias de la credencial a mostrar' }
];

module.exports = CredsShowCommand;
