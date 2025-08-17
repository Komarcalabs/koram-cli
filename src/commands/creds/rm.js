// src/commands/credential/remove.js
const { Command } = require('@oclif/command');
const inquirer = require('inquirer');
const keytar = require('keytar');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

class CredentialRemoveCommand extends Command {
  async run() {
    const { args } = this.parse(CredentialRemoveCommand);
    const alias = args.alias;

    if (!alias) {
      console.log(chalk.red('❌ Debes indicar el alias de la credencial a eliminar'));
      return;
    }

    // Archivo JSON donde guardamos host como referencia
    const credFile = path.join(process.env.HOME, '.koram_credentials.json');
    let allCreds = {};
    if (fs.existsSync(credFile)) {
      allCreds = JSON.parse(fs.readFileSync(credFile));
    }

    // Filtrar credenciales que coincidan con el alias
    const matchingKeys = Object.keys(allCreds).filter(k => k.startsWith(alias + ':'));

    if (matchingKeys.length === 0) {
      console.log(chalk.yellow(`⚠ No se encontró ninguna credencial para alias "${alias}"`));
      return;
    }

    let keyToDelete;

    if (matchingKeys.length === 1) {
      keyToDelete = matchingKeys[0];
    } else {
      // Si hay varias, pedir al usuario que seleccione
      const choices = matchingKeys.map(k => {
        const user = k.split(':')[1];
        const host = allCreds[k].host || '-';
        return { name: `${user}@${alias} | Host: ${host}`, value: k };
      });
      const answer = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: `Se encontraron varias credenciales para alias "${alias}", selecciona cuál eliminar:`,
        choices
      }]);
      keyToDelete = answer.selected;
    }

    const [aliasName, user] = keyToDelete.split(':');

    // Eliminar de Keytar
    await keytar.deletePassword('koram', keyToDelete);

    // Eliminar del JSON
    delete allCreds[keyToDelete];
    fs.writeFileSync(credFile, JSON.stringify(allCreds, null, 2));

    console.log(chalk.green(`✅ Credencial eliminada para ${user}@${aliasName}`));
  }
}

CredentialRemoveCommand.description = `Elimina una credencial guardada usando solo el alias`;

CredentialRemoveCommand.args = [
  { name: 'alias', required: true, description: 'Alias de la credencial a eliminar' }
];

module.exports = CredentialRemoveCommand;
