const { Command, flags } = require('@oclif/command');
const inquirer = require('inquirer');
const keytar = require('keytar');
const chalk = require('chalk');


class CredentialListCommand extends Command {
  async run() {
    const credFile = `${process.env.HOME}/.koram_credentials.json`;
    let allCreds = {};
    if (require('fs').existsSync(credFile)) {
      allCreds = JSON.parse(require('fs').readFileSync(credFile));
    }

    const accounts = Object.keys(allCreds);
    if (accounts.length === 0) {
      console.log(chalk.yellow('⚠ No hay credenciales guardadas'));
      return;
    }

    console.log(chalk.blue('💡 Credenciales guardadas:'));
    accounts.forEach(a => {
      const [alias, user] = a.split(':');
      console.log(`- Alias: ${alias} | Usuario: ${user} | Host: ${allCreds[a].host || '-'}`);
    });
  }
}

CredentialListCommand.description = `Lista todas las credenciales guardadas`;

module.exports = CredentialListCommand