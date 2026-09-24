// src/commands/ssh.js
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const chalk = require('chalk');
const { spawn } = require('child_process');
const { selectKoramConfig, getCredentialByKey } = require('../utils/index');
const ora = require('ora');
const { Client } = require('ssh2');

class SshCommand extends Command {
  async run() {
    try {
      const { args, flags } = this.parse(SshCommand);
      const projectRoot = process.cwd();

      const alias = args.alias;
      if (!alias) {
        this.log(chalk.red('❌ Debes indicar un alias de servidor'));
        return;
      }

      let configFile = {};
      let credentials = {};
      if (alias === '.') {
        configFile = JSON.parse(
          fs.readFileSync(await selectKoramConfig(projectRoot, flags.env))
        );
        credentials = await getCredentialByKey(null, configFile.user, configFile.host);
      } else {
        credentials = await getCredentialByKey(alias);
      }

      const { password, user, host, authType, keyPath, passphrase } = credentials;
      const isKeyAuth = authType === 'key' || !!keyPath;
      const useSSHKey = flags.sshKey || isKeyAuth;
      let sshKeyPath = keyPath || configFile.server?.sshKey || null;

      if (sshKeyPath) {
        sshKeyPath = sshKeyPath.replace(/^~(?=$|\/|\\)/, process.env.HOME || '');
      }

      if (useSSHKey && !sshKeyPath && !process.env.SSH_AUTH_SOCK) {
        this.log(chalk.red(`❌ No se encontró la SSH key para alias "${alias}"`));
        return;
      }

      const spinner = ora(`Iniciando conexión SSH a ${user}@${host}...`).start();

      // 👉 Keepalive args para evitar que muera la sesión
      const sshArgs = [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ServerAliveInterval=60',
        '-o', 'ServerAliveCountMax=3',
        `${user}@${host}`
      ];
      if (useSSHKey && sshKeyPath) sshArgs.unshift('-i', sshKeyPath);

      spinner.stop();
      this.log(chalk.magenta(`🚀 Conectando a ${user}@${host}${isKeyAuth ? ' (usando llave .pem)' : ''}...\n`));

      if (password && !useSSHKey) {
        // Intentar sshpass primero
        try {
          const sshProcess = spawn('sshpass', ['-p', password, 'ssh', ...sshArgs], { stdio: 'inherit' });
          sshProcess.on('error', (err) => {
            if (err.code === 'ENOENT') {
              this.log(chalk.yellow('⚠️  sshpass no está instalado, usando fallback ssh2...'));
              this.connectWithSsh2({ user, host, password });
            } else {
              this.log(chalk.red(`❌ Error SSH: ${err.message}`));
            }
          });
          sshProcess.on('exit', (code) => this.log(chalk.gray(`\n🔌 Conexión cerrada (sshpass, código ${code})`)));
        } catch {
          this.log(chalk.yellow('⚠️  sshpass no está disponible, usando fallback ssh2...'));
          this.connectWithSsh2({ user, host, password });
        }
      } else {
        // SSH normal o con llave
        const sshProcess = spawn('ssh', sshArgs, { stdio: 'inherit' });
        sshProcess.on('error', (err) => {
          this.log(chalk.yellow(`⚠️ Falló spawn nativo de SSH (${err.message}), intentando fallback ssh2...`));
          this.connectWithSsh2({ user, host, password, keyPath: sshKeyPath, passphrase });
        });
        sshProcess.on('exit', (code) => this.log(chalk.gray(`\n🔌 Conexión cerrada (ssh, código ${code})`)));
      }

    } catch (error) {
      this.log(chalk.red(`❌ ${error.message}`));
    }
  }

  connectWithSsh2({ user, host, password, keyPath, passphrase }) {
    const conn = new Client();
    conn.on('ready', () => {
      console.log(chalk.green('✅ Conectado con ssh2 (fallback interactivo)\n'));

      // 👉 Activar keepalive en ssh2
      conn.keepaliveInterval = 60000; // cada 60s
      conn.keepaliveCountMax = 3;

      conn.shell({ term: 'xterm-color', cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 }, (err, stream) => {
        if (err) {
          console.error(chalk.red('❌ Error al iniciar shell:'), err.message);
          conn.end();
          return;
        }

        // Habilitar entrada cruda para interactividad
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.pipe(stream);
        stream.pipe(process.stdout);
        stream.stderr.pipe(process.stderr);

        stream.on('close', () => {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          console.log(chalk.gray('\n🔌 Conexión cerrada (ssh2 fallback)'));
          conn.end();
        });
      });
    });

    const connConfig = { host, port: 22, username: user };
    if (keyPath && fs.existsSync(keyPath)) {
      connConfig.privateKey = fs.readFileSync(keyPath);
      if (passphrase) connConfig.passphrase = passphrase;
    } else if (password) {
      connConfig.password = password;
    }
    conn.connect(connConfig);
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
