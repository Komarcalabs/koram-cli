const { Command, flags } = require('@oclif/command');
const inquirer = require('inquirer');
const keytar = require('keytar');
const chalk = require('chalk');

class CredentialAddCommand extends Command {
  async run() {
    const { args } = this.parse(CredentialAddCommand);
    const alias = args.alias;
    const user = args.user;
    const host = args.host || '';

    if (!alias || !user) {
      console.log(chalk.red('❌ Debes indicar alias y usuario'));
      return;
    }

    // Verificar si ya existe
    const existing = await keytar.getPassword('koram', `${alias}:${user}`);
    if (existing) {
      console.log(chalk.yellow(`⚠ Ya existe una credencial para ${user}@${alias}, se sobrescribirá.`));
    }

    const answer = await inquirer.prompt([
      {
        type: 'password',
        name: 'password',
        message: `Introduce la contraseña para ${user}@${alias}:`,
        mask: '*'
      }
    ]);

    // Guardar contraseña segura en Keytar
    await keytar.setPassword('koram', `${alias}:${user}`, answer.password);

    // Guardar host como metadato en un archivo JSON simple
    const credFile = `${process.env.HOME}/.koram_credentials.json`;
    let allCreds = {};
    if (require('fs').existsSync(credFile)) {
      allCreds = JSON.parse(require('fs').readFileSync(credFile));
    }
    allCreds[`${alias}:${user}`] = { host };
    require('fs').writeFileSync(credFile, JSON.stringify(allCreds, null, 2));

    console.log(chalk.green(`🔑 Credencial guardada para ${user}@${alias}`));
  }
}

CredentialAddCommand.description = `Guarda una credencial segura para un servidor con alias simple`;

CredentialAddCommand.args = [
  { name: 'alias', required: true, description: 'Alias legible del servidor' },
  { name: 'user', required: true, description: 'Usuario SSH' },
  { name: 'host', required: false, description: 'IP o hostname del servidor (opcional)' }
];

module.exports = CredentialAddCommand;
