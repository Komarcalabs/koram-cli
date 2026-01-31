const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const { spawn } = require('child_process');
const { Client } = require('ssh2');
const { selectKoramConfig, getCredentialByKey } = require('../../utils/index');

class ReverseTunnelCommand extends Command {
  async run() {
    try {
      const { args, flags } = this.parse(ReverseTunnelCommand);
      const projectRoot = process.cwd();
      const alias = args.alias;

      if (!alias) return this.log(chalk.red('❌ Debes indicar un alias de servidor'));

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

      const { password, user, host } = credentials;
      const useSSHKey = flags.sshKey || false;

      // Preguntar puertos si no se pasan por flags
      let remotePort = flags.remotePort;
      let localPort = flags.localPort;

      if (!flags.remotePort || !flags.localPort) {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'localPort',
            message: '🔹 ¿A qué puerto LOCAL deseas conectar?',
            default: 4000,
            validate: (val) =>
              !isNaN(val) && val > 0 && val < 65535
                ? true
                : 'Debes ingresar un número de puerto válido',
          },
          {
            type: 'input',
            name: 'remotePort',
            message: '🔹 ¿A qué puerto REMOTO (VPS) deseas exponer?',
            default: 4000,
            validate: (val) =>
              !isNaN(val) && val > 0 && val < 65535
                ? true
                : 'Debes ingresar un número de puerto válido',
          },
        ]);
        localPort = Number(answers.localPort);
        remotePort = Number(answers.remotePort);
      }

      let sshKeyPath = null;
      if (useSSHKey) {
        sshKeyPath = configFile.server?.sshKey || null;
        if (!sshKeyPath && !process.env.SSH_AUTH_SOCK) {
          this.log(chalk.red(`❌ No se encontró la SSH key para alias "${alias}"`));
          return;
        }
      }

      const sshConfig = {
        host,
        port: 22,
        username: user,
        readyTimeout: 20000,
      };
      if (useSSHKey) {
        if (process.env.SSH_AUTH_SOCK) sshConfig.agent = process.env.SSH_AUTH_SOCK;
        else if (sshKeyPath) sshConfig.privateKey = fs.readFileSync(sshKeyPath, 'utf8');
      } else if (password) sshConfig.password = password;

      // Verificar configuración SSH del VPS
      const spinner = ora(`Verificando configuración SSH en ${host}...`).start();
      const ssh = new Client();

      let sshNeedsFix = false;

      await new Promise((resolve, reject) => {
        ssh
          .on('ready', async () => {
            spinner.succeed(`✔ Conectado a ${chalk.cyan(host)} para verificación`);
            const result = await this.execSSH(
              ssh,
              "grep -E '^(AllowTcpForwarding|GatewayPorts)' /etc/ssh/sshd_config || true"
            );
            const allowForward = /AllowTcpForwarding\s+yes/.test(result);
            const allowGateway = /GatewayPorts\s+yes/.test(result);
            if (!allowForward || !allowGateway) sshNeedsFix = true;
            ssh.end();
            resolve();
          })
          .on('error', (err) => reject(err))
          .connect(sshConfig);
      });

      if (sshNeedsFix) {
        this.log(chalk.yellow(`⚠️ El servidor ${host} no permite túneles inversos.`));
      } else {
        this.log(chalk.green('✅ SSH remoto ya permite túneles inversos'));
      }

      // 🔍 Verificar si el puerto remoto está en uso y ofrecer liberarlo
      const remoteFree = await this.checkAndFreeRemotePort(sshConfig, remotePort);
      if (!remoteFree) {
        const answer = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'tryAnother',
            message: chalk.yellow(
              `El puerto remoto ${remotePort} sigue en uso. ¿Deseas probar con otro puerto automáticamente?`
            ),
            default: true,
          },
        ]);
        if (answer.tryAnother) {
          remotePort++;
          this.log(chalk.cyan(`🔁 Intentando con puerto remoto alternativo: ${remotePort}`));
        } else {
          this.log(chalk.red('❌ Operación cancelada.'));
          return;
        }
      }

      // Crear túnel inverso
      await this.createReverseTunnel({
        user,
        host,
        password,
        useSSHKey,
        sshKeyPath,
        remotePort,
        localPort,
        sshConfig,
      });
    } catch (error) {
      this.log(chalk.red(`❌ ${error.message}`));
    }
  }

  // Ejecutar comandos remotos vía SSH
  async execSSH(ssh, cmd) {
    return new Promise((resolve) => {
      ssh.exec(cmd, (err, stream) => {
        if (err) return resolve('');
        let output = '';
        stream.on('data', (d) => (output += d.toString()));
        stream.stderr.on('data', (d) => (output += d.toString()));
        stream.on('close', () => resolve(output.trim()));
      });
    });
  }

  // Verifica y libera el puerto remoto si está ocupado
  async checkAndFreeRemotePort(sshConfig, remotePort) {
    const ssh = new Client();
    let freed = false;
    await new Promise((resolve) => {
      ssh
        .on('ready', async () => {
          const checkCmd = `sudo lsof -i :${remotePort} -sTCP:LISTEN -t || true`;
          const result = await this.execSSH(ssh, checkCmd);
          if (result) {
            console.log(chalk.yellow(`⚠️ Puerto remoto ${remotePort} en uso. Liberando...`));
            await this.execSSH(
              ssh,
              `sudo lsof -ti :${remotePort} | xargs -r sudo kill -9 || true`
            );
            const verify = await this.execSSH(ssh, checkCmd);
            freed = !verify;
          } else {
            freed = true;
          }
          ssh.end();
          resolve();
        })
        .on('error', () => resolve())
        .connect(sshConfig);
    });
    return freed;
  }

  // Crear túnel inverso localmente
  async createReverseTunnel({ user, host, password, useSSHKey, sshKeyPath, remotePort, localPort, sshConfig }) {
    this.log(chalk.magenta(`🚀 Estableciendo túnel inverso hacia ${user}@${host}...`));
    this.log(chalk.gray(`↩  ${host}:${remotePort} → localhost:${localPort}`));

    const sshArgs = [
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-N',
      '-R', `${remotePort}:localhost:${localPort}`,
      `${user}@${host}`,
    ];

    if (useSSHKey && sshKeyPath) sshArgs.unshift('-i', sshKeyPath);

    const proc = password && !useSSHKey
      ? spawn('sshpass', ['-p', password, 'ssh', ...sshArgs], { stdio: 'inherit' })
      : spawn('ssh', sshArgs, { stdio: 'inherit' });

    process.stdin.resume();
    console.log(chalk.blue('\n🔄 Presiona ENTER para cerrar el túnel y liberar el puerto remoto...'));
    process.stdin.once('data', async () => {
      proc.kill('SIGTERM');
      console.log(chalk.gray('\n🔌 Cerrando túnel y liberando puerto remoto...'));
      await this.checkAndFreeRemotePort(sshConfig, remotePort);
      console.log(chalk.green(`✅ Puerto remoto ${remotePort} liberado correctamente.`));
      process.exit(0);
    });
  }
}

ReverseTunnelCommand.description = `Crea un túnel inverso SSH localmente usando credenciales Koram.
Detecta si el puerto remoto está en uso, lo libera automáticamente, 
y cierra el túnel limpiamente al presionar ENTER.`;

ReverseTunnelCommand.args = [
  { name: 'alias', required: true, description: 'Alias del servidor (ej: prod, staging, etc.)' },
];

ReverseTunnelCommand.flags = {
  env: flags.string({ char: 'e', description: 'Entorno a usar', default: '' }),
  sshKey: flags.boolean({ char: 'k', description: 'Usar SSH key en lugar de password' }),
  remotePort: flags.integer({ char: 'p', description: 'Puerto remoto (VPS)' }),
  localPort: flags.integer({ char: 'l', description: 'Puerto local' }),
};

module.exports = ReverseTunnelCommand;
