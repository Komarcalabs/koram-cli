const { Command, flags } = require('@oclif/command');
const inquirer = require('inquirer');
const keytar = require('keytar');
const chalk = require('chalk');


class CredentialListCommand extends Command {
  async run() {
    const credentials = await keytar.findCredentials('koram');
    if (credentials.length === 0) {
      console.log(chalk.yellow('⚠ No hay credenciales guardadas'));
      return;
    }
    console.log(chalk.blue('💡 Credenciales guardadas:'));
    credentials.forEach(c => console.log(`- ${c.account}`));
  }
}

CredentialListCommand.description = `Lista todos los servidores con credenciales guardadas`;

module.exports = CredentialListCommand