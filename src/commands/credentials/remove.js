const { Command, flags } = require('@oclif/command');
const inquirer = require('inquirer');
const keytar = require('keytar');
const chalk = require('chalk');

class CredentialRemoveCommand extends Command {
  async run() {
    const { args } = this.parse(CredentialRemoveCommand);
    const server = args.server;
    const user = args.user;

    if (!server || !user) {
      console.log(chalk.red('❌ Debes indicar servidor y usuario'));
      return;
    }

    const removed = await keytar.deletePassword('koram', `${server}:${user}`);
    if (removed) {
      console.log(chalk.green(`✅ Credencial eliminada para ${user}@${server}`));
    } else {
      console.log(chalk.yellow(`⚠ No se encontró credencial para ${user}@${server}`));
    }
  }
}

CredentialRemoveCommand.description = `Elimina una credencial guardada`;

CredentialRemoveCommand.args = [
  { name: 'server', required: true, description: 'Nombre o alias del servidor' },
  { name: 'user', required: true, description: 'Usuario SSH' }
];

module.exports = CredentialRemoveCommand