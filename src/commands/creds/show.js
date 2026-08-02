// src/commands/creds/show.js
const { Command } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const Table = require('cli-table3');

let keytar;
try {
  keytar = require('keytar');
} catch (err) {
  keytar = null; // Si keytar no está disponible (ej. en WSL)
}

class CredsShowCommand extends Command {
  async run() {
    const { args } = this.parse(CredsShowCommand);
    const alias = args.alias;

    if (!alias) {
      this.log(chalk.red('❌ Debes indicar un alias'));
      return;
    }

    const credFile = path.join(process.env.HOME, '.koram_credentials.json');
    if (!fs.existsSync(credFile)) {
      this.log(chalk.red('❌ No se encontraron credenciales guardadas'));
      return;
    }

    const allCreds = JSON.parse(fs.readFileSync(credFile));
    const keys = Object.keys(allCreds).filter(k => k.startsWith(alias + ':'));

    if (keys.length === 0) {
      this.log(chalk.red(`❌ No se encontró credencial para alias "${alias}"`));
      return;
    }

    // Si hay varias credenciales para el mismo alias
    let keyToUse;
    if (keys.length === 1) {
      keyToUse = keys[0];
    } else {
      this.log(chalk.yellow(`⚠ Se encontraron varias credenciales para alias "${alias}":`));
      keys.forEach(k => {
        const user = k.split(':')[1];
        this.log(`- ${user}`);
      });
      this.log(chalk.yellow('👉 Usa el nombre completo alias:usuario para ver la contraseña'));
      return;
    }

    const [aliasName, user] = keyToUse.split(':');
    const host = allCreds[keyToUse].host || '-';

    let password = null;
    let origen = chalk.green('keytar');

    // Buscar primero en keytar (si está disponible)
    if (keytar) {
      password = await keytar.getPassword('koram', keyToUse);
    }

    // Si no se encontró en keytar, buscar en fallback JSON
    if (!password && allCreds[keyToUse].password) {
      password = allCreds[keyToUse].password;
      origen = chalk.yellow('fallback ⚠️');
    }

    // Construir tabla
    const table = new Table({
      head: [chalk.cyan('Campo'), chalk.cyan('Valor')],
      style: { head: [], border: [] },
      colWidths: [20, 55],
      wordWrap: true,
    });

    const credentialType = allCreds[keyToUse].type || 'server';

    if (credentialType === 's3') {
      table.push(
        [chalk.blue('Alias'), aliasName],
        [chalk.blue('Tipo'), chalk.yellow('AWS S3')],
        [chalk.blue('AWS Access Key ID'), user],
        [chalk.blue('AWS Secret Key'), password || chalk.red('(No guardada)')],
        [chalk.blue('Región por defecto'), host || '-'],
        [chalk.blue('Origen'), origen]
      );
    } else {
      table.push(
        [chalk.blue('Alias'), aliasName],
        [chalk.blue('Tipo'), chalk.blue('SSH Server')],
        [chalk.blue('Usuario SSH'), user],
        [chalk.blue('Host / IP'), host],
        [chalk.blue('Contraseña SSH'), password || chalk.red('(No guardada)')],
        [chalk.blue('Origen'), origen]
      );
    }

    this.log(chalk.blue('🔎 Detalle de la credencial:\n'));
    this.log(table.toString());
  }
}

CredsShowCommand.description = `Muestra la información completa de una credencial guardada, incluyendo contraseña`;

CredsShowCommand.args = [
  { name: 'alias', required: true, description: 'Alias de la credencial a mostrar' }
];

CredsShowCommand.examples = [
  `${require('chalk').green('koram creds:show mi-servidor')}  # Muestra el detalle de una credencial de servidor`,
  `${require('chalk').green('koram creds:show mi-s3')}        # Muestra el detalle formateado para AWS S3`
];

module.exports = CredsShowCommand;
