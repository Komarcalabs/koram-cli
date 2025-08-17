const { Command, flags } = require('@oclif/command');
const inquirer = require('inquirer');
const keytar = require('keytar');
const chalk = require('chalk');

class CredentialAddCommand extends Command {
  async run() {
    const { args } = this.parse(CredentialAddCommand);
    const server = args.server;
    const user = args.user;

    if (!server || !user) {
      console.log(chalk.red('❌ Debes indicar servidor y usuario'));
      return;
    }

    const answer = await inquirer.prompt([
      {
        type: 'password',
        name: 'password',
        message: `Introduce la contraseña para ${user}@${server}:`,
        mask: '*'
      }
    ]);

    await keytar.setPassword('koram', `${server}:${user}`, answer.password);
    console.log(chalk.green(`🔑 Credencial guardada para ${user}@${server}`));
  }
}

CredentialAddCommand.description = `Guarda una credencial segura para un servidor`;

CredentialAddCommand.args = [
  { name: 'server', required: true, description: 'Nombre o alias del servidor' },
  { name: 'user', required: true, description: 'Usuario SSH' }
];


module.exports = CredentialAddCommand;
