const { Command, flags } = require('@oclif/command');
const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs');
let keytar;

try {
  keytar = require('keytar');
} catch (err) {
  // Si no hay keytar disponible (ej: WSL)
  keytar = null;
}

class CredentialAddCommand extends Command {
  async run() {
    const { args, flags } = this.parse(CredentialAddCommand);
    const alias = args.alias;
    const user = args.user;
    const host = args.host || '';

    if (!alias || !user) {
      console.log(chalk.red('❌ Debes indicar alias y usuario'));
      return;
    }

    const credFile = `${process.env.HOME}/.koram_credentials.json`;
    let allCreds = {};
    if (fs.existsSync(credFile)) {
      allCreds = JSON.parse(fs.readFileSync(credFile));
    }

    const key = `${alias}:${user}`;
    let existing = null;

    if (!flags.fallback && keytar) {
      existing = await keytar.getPassword('koram', key);
    } else {
      existing = allCreds[key]?.password || null;
    }

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

    if (!flags.fallback && keytar) {
      // Guardar en Keytar
      await keytar.setPassword('koram', key, answer.password);
    } else {
      // Guardar en archivo JSON (fallback)
      allCreds[key] = { host, password: answer.password };
    }

    // Guardar siempre metadata (host, etc.)
    if (!allCreds[key]) {
      allCreds[key] = { host };
    } else {
      allCreds[key].host = host || allCreds[key].host || '';
    }

    fs.writeFileSync(credFile, JSON.stringify(allCreds, null, 2));

    console.log(chalk.green(`🔑 Credencial guardada para ${user}@${alias} (${flags.fallback ? 'fallback' : 'keytar'})`));
  }
}

CredentialAddCommand.description = `Guarda una credencial segura para un servidor con alias simple.
Por defecto usa Keytar, pero puedes usar un fallback basado en JSON.`;

CredentialAddCommand.args = [
  { name: 'alias', required: true, description: 'Alias legible del servidor' },
  { name: 'user', required: true, description: 'Usuario SSH' },
  { name: 'host', required: false, description: 'IP o hostname del servidor (opcional)' }
];

CredentialAddCommand.flags = {
  fallback: flags.boolean({ char: 'f', description: 'Usar almacenamiento fallback en JSON en lugar de Keytar' }),
};

module.exports = CredentialAddCommand;
