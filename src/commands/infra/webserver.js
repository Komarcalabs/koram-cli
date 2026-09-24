// src/commands/infra-webserver.js
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const { NodeSSH } = require('node-ssh');
const { selectKoramConfig, getCredentialByKey } = require('../../utils/index');
const { syncRemoteWebserver } = require('../../utils/nginx');

class InfraWebserverCommand extends Command {
  async run() {
    const { flags } = this.parse(InfraWebserverCommand);
    const projectRoot = process.cwd();
    const env = flags.env || 'production';
    const rcPath = await selectKoramConfig(projectRoot, env);

    if (!rcPath) {
      this.error('❌ No se encontró archivo de configuración .koram-rc.<env>.json');
      return;
    }

    const configFile = JSON.parse(fs.readFileSync(rcPath));
    const { server } = configFile;

    // Conectar por SSH
    let vaultPassword = server.password_plain || server.password;
    let vaultKeyPath = server.sshKey || null;
    let vaultPassphrase = null;

    try {
      const creds = await getCredentialByKey(null, server.user, server.host);
      if (creds) {
        if (creds.password) vaultPassword = creds.password;
        if (creds.keyPath) vaultKeyPath = creds.keyPath;
        if (creds.passphrase) vaultPassphrase = creds.passphrase;
      }
    } catch (e) { }

    if (vaultKeyPath) {
      vaultKeyPath = vaultKeyPath.replace(/^~(?=$|\/|\\)/, process.env.HOME || '');
    }

    const ssh = new NodeSSH();
    try {
      const connectionOpts = {
        host: server.host,
        port: parseInt(server.port) || 22,
        username: server.user,
        tryKeyboard: true,
        agent: process.env.SSH_AUTH_SOCK
      };

      if (vaultKeyPath && fs.existsSync(vaultKeyPath)) {
        connectionOpts.privateKey = fs.readFileSync(vaultKeyPath);
        if (vaultPassphrase) connectionOpts.passphrase = vaultPassphrase;
      } else if (vaultPassword) {
        connectionOpts.password = vaultPassword;
      }

      this.log(`🔌 Conectando al servidor ${server.user}@${server.host}...`);
      await ssh.connect(connectionOpts);
      this.log(`✅ Conexión SSH establecida.`);

      await syncRemoteWebserver(ssh, configFile, env, this.log.bind(this));

      ssh.dispose();
    } catch (err) {
      ssh.dispose();
      this.error(`❌ Error en el proceso remoto de Nginx: ${err.message}`);
    }
  }
}

InfraWebserverCommand.description = `Aplica la configuración del bloque webserver en el servidor remoto.
Soporta múltiples configuraciones, fuente de verdad simétrica (.koram/webserver/) y auto-certificación SSL mediante Certbot.
`;

InfraWebserverCommand.flags = {
  env: flags.string({ char: 'e', description: 'Entorno a usar (production, staging, etc)', default: 'production' }),
};

module.exports = InfraWebserverCommand;
