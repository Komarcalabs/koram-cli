// src/commands/ssh.js
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const chalk = require('chalk');
const { spawn } = require('child_process');
const { selectKoramConfig, getCredentialByKey } = require('../utils/index');
const ora = require('ora');
const { Client } = require('ssh2'); // fallback sin sshpass

class SshCommand extends Command {
  async run() {
    try {
      let { args, flags } = this.parse(SshCommand);

      const projectRoot = process.cwd();

      let configFile = {};
      const alias = args.alias;
      if (!alias) {
        this.log(chalk.red('❌ Debes indicar un alias de servidor'));
        return;
      }

      let credentials = {};
      if (alias === '.') {
        configFile = JSON.parse(
          fs.readFileSync(await selectKoramConfig(projectRoot, flags.env))
        );
        credentials = await getCredentialByKey(null, configFile.user, configFile.host);
      } else {
        credentials = await getCredentialByKey(alias);
      }

      const { password, user, host } = credentials;
      const useSSHKey = flags.sshKey || false;
      let sshKeyPath = null;

      if (useSSHKey) {
        sshKeyPath = configFile.server?.sshKey || null;
        if (!sshKeyPath && !process.env.SSH_AUTH_SOCK) {
          this.log(chalk.red(`❌ No se encontró la SSH key para alias "${alias}"`));
          return;
        }
      }

      const spinner = ora(`Iniciando conexión SSH a ${user}@${host}...`).start();

      let sshArgs = [
        '-o', 'StrictHostKeyChecking=no',
        `${user}@${host}`
      ];

      if (useSSHKey && sshKeyPath) {
        sshArgs.unshift('-i', sshKeyPath);
      }

      spinner.stop();
      this.log(chalk.magenta(`🚀 Conectando a ${user}@${host}...\n`));

      let sshProcess;

      if (password && !useSSHKey) {
        // ---- Intentamos usar sshpass ----
        try {
          sshProcess = spawn('sshpass', ['-p', password, 'ssh', ...sshArgs], { stdio: 'inherit' });

          sshProcess.on('error', (err) => {
            if (err.code === 'ENOENT') {
              this.log(chalk.yellow('⚠️  sshpass no está instalado, usando fallback ssh2...'));
              this.connectWithSsh2({ user, host, password });
            } else {
              this.log(chalk.red(`❌ Error SSH: ${err.message}`));
            }
          });

        } catch (err) {
          if (err.code === 'ENOENT') {
            this.log(chalk.yellow('⚠️  sshpass no está instalado, usando fallback ssh2...'));
            this.connectWithSsh2({ user, host, password });
          } else {
            this.log(chalk.red(`❌ ${err.message}`));
          }
        }

      } else {
        // ---- Si hay sshKey o no hay password, usamos ssh normal ----
        sshProcess = spawn('ssh', sshArgs, { stdio: 'inherit' });
      }

      if (sshProcess) {
        sshProcess.on('exit', (code) => {
          this.log(chalk.gray(`\n🔌 Conexión cerrada (código ${code})`));
        });
      }

    } catch (error) {
      this.log(chalk.red(`❌ ${error.message}`));
    }
  }

  connectWithSsh2({ user, host, password }) {
    const conn = new Client();
    conn.on('ready', () => {
      console.log(chalk.green('✅ Conectado con ssh2 (fallback)\n'));
      conn.shell((err, stream) => {
        if (err) {
          console.error(chalk.red('❌ Error al iniciar shell:'), err.message);
          conn.end();
          return;
        }
        process.stdin.pipe(stream);
        stream.pipe(process.stdout);
        stream.stderr.pipe(process.stderr);

        stream.on('close', () => {
          console.log(chalk.gray('🔌 Conexión cerrada (ssh2 fallback)'));
          conn.end();
        });
      });
    }).connect({
      host,
      port: 22,
      username: user,
      password
    });
  }
}

// ------------------------------
// Configuración Oclif
// ------------------------------
SshCommand.description = `Conéctate rápidamente a un servidor usando un alias de credencial.
Ejemplo:
  koram ssh prod
  koram ssh staging -k
`;

SshCommand.args = [
  { name: 'alias', required: true, description: 'Alias del servidor definido en Koram' },
];

SshCommand.flags = {
  env: flags.string({ char: 'e', description: 'Entorno a usar', default: '' }),
  sshKey: flags.boolean({ char: 'k', description: 'Usar SSH key en lugar de password' }),
};

module.exports = SshCommand;
