const { Command, flags } = require('@oclif/command');
const chalk = require('chalk');
const fs = require('fs');
const Table = require('cli-table3');

let keytar;
try {
  keytar = require('keytar');
} catch (err) {
  keytar = null; // si no existe keytar en el entorno
}

class CredentialListCommand extends Command {
  async run() {
    const { flags } = this.parse(CredentialListCommand);

    const credFile = `${process.env.HOME}/.koram_credentials.json`;
    let allCreds = {};
    if (fs.existsSync(credFile)) {
      allCreds = JSON.parse(fs.readFileSync(credFile));
    }

    const accounts = Object.keys(allCreds);
    if (accounts.length === 0) {
      this.log(chalk.yellow('⚠ No hay credenciales guardadas'));
      return;
    }

    const table = new Table({
      head: [
        chalk.cyan('Alias'),
        chalk.cyan('Usuario / ID'),
        chalk.cyan('Host / Región'),
        chalk.cyan('Tipo'),
        chalk.cyan('Origen'),
        ...(flags.showPassword ? [chalk.cyan('Contraseña / Secret')] : []),
      ],
      style: { head: [], border: [] },
      wordWrap: true,
    });

    for (const a of accounts) {
      const [alias, user] = a.split(':');
      const meta = allCreds[a] || {};
      let origen = chalk.gray('keytar');
      let password = null;

      // Intentar obtener password de keytar, pero catch si falla
      if (keytar) {
        try {
          password = await keytar.getPassword('koram', a);
        } catch (err) {
          // Error de Keytar (ej: WSL sin keyring)
          origen = chalk.yellow('fallback ⚠️');
          password = meta.password || null;
        }
      }

      // Si keytar no estaba disponible o no devolvió nada, usar fallback
      if (!password && meta.password) {
        origen = chalk.yellow('fallback ⚠️');
        password = meta.password;
      }

      let typeDisplay = chalk.blue('SSH (Pass)');
      if (meta.type === 's3') {
        typeDisplay = chalk.yellow('AWS S3');
      } else if (meta.authType === 'key' || meta.keyPath) {
        typeDisplay = chalk.cyan('SSH (Key)');
      }

      const row = [alias, user, meta.host || '-', typeDisplay, origen];

      if (flags.showPassword) {
        if (meta.authType === 'key' || meta.keyPath) {
          const keyLabel = meta.keyPath ? require('path').basename(meta.keyPath) : 'Llave SSH';
          row.push(password ? chalk.green(`[Passphrase: ${password}]`) : chalk.gray(`[${keyLabel}]`));
        } else {
          row.push(password ? chalk.green(password) : chalk.red('No encontrada'));
        }
      }

      table.push(row);
    }

    this.log(chalk.blue('💡 Credenciales guardadas:\n'));
    this.log(table.toString());
  }
}

CredentialListCommand.description = `Lista todas las credenciales guardadas (keytar + fallback)`;

CredentialListCommand.flags = {
  showPassword: flags.boolean({
    char: 'p',
    description: 'Muestra también las contraseñas guardadas',
    default: false,
  }),
};

CredentialListCommand.examples = [
  `${require('chalk').green('koram creds:ls')}     # Lista todas las credenciales registradas`,
  `${require('chalk').green('koram creds:ls -p')}  # Muestra además las contraseñas/secrets en texto claro`
];

module.exports = CredentialListCommand;
