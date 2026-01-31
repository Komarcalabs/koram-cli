// src/commands/infra-webserver.js
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');
const { selectKoramConfig } = require('../../utils/index');

class InfraWebserverCommand extends Command {
  async run() {
    const { flags } = this.parse(InfraWebserverCommand);
    const projectRoot = process.cwd();
    const rcPath = await selectKoramConfig(projectRoot, flags.env || 'production');

    if (!rcPath) {
      this.error('❌ No se encontró archivo de configuración .koram-rc.<env>.json');
      return;
    }

    const configFile = JSON.parse(fs.readFileSync(rcPath));
    const { server, webserver } = configFile;

    if (!webserver) {
      this.error('❌ No existe el bloque "webserver" en la configuración. Usa `koram add:webserver` primero.');
      return;
    }

    // Soporte para configs[]
    const configs = webserver.configs || (webserver.config ? [webserver.config] : []);
    if (configs.length === 0) {
      this.error('❌ No hay configuraciones en el bloque "webserver".');
      return;
    }

    // 1. Generar contenido nginx.conf
    const nginxConf = configs.map(cfg => this.generateNginxConf(cfg)).join('\n\n');

    // 2. Definir nombres de archivo remoto
    const appName = configFile.name || 'koram-app';
    const remoteConfPath = `/etc/nginx/sites-available/${appName}.conf`;
    const remoteEnabledPath = `/etc/nginx/sites-enabled/${appName}.conf`;

    // 3. Conectar al servidor y transferir archivo
    const ssh = new Client();
    ssh
      .on('ready', () => {
        this.log(`✅ Conexión establecida con ${server.user}@${server.host}`);

        // Usamos sftp para mayor seguridad en la escritura del archivo
        ssh.sftp((err, sftp) => {
          if (err) return this.error(`Error al iniciar SFTP: ${err.message}`);

          const writeStream = sftp.createWriteStream(remoteConfPath, { flags: 'w' });
          writeStream.write(nginxConf);
          writeStream.end();

          writeStream.on('close', () => {
            this.log(`✅ Configuración subida a ${remoteConfPath}`);

            // Crear symlink
            ssh.exec(`sudo ln -sf ${remoteConfPath} ${remoteEnabledPath}`, (err2, stream2) => {
              if (err2) return this.error(err2.message);

              stream2.on('close', () => {
                this.log(`✅ Symlink creado en ${remoteEnabledPath}`);

                // Validar y recargar nginx
                ssh.exec('sudo nginx -t && sudo systemctl reload nginx', (err3, stream3) => {
                  if (err3) return this.error(err3.message);

                  stream3.on('close', () => {
                    this.log('🚀 Nginx recargado correctamente');
                    ssh.end();
                  });
                });
              });
            });
          });
        });
      })
      .connect({
        host: server.host,
        port: server.port || 22,
        username: server.user,
        privateKey: fs.readFileSync(server.sshKey.replace('~', process.env.HOME)),
      });
  }

  // Generador extendido para múltiples bloques
  generateNginxConf(config) {
    const sslBlock = config.ssl?.enabled
      ? `
    listen 443 ssl;
    ssl_certificate ${config.ssl.certPath};
    ssl_certificate_key ${config.ssl.keyPath};`
      : `listen ${config.listen || 80};`;

    const locations = (config.locations || [])
      .map(
        (loc) => `
    location ${loc.path} {
      proxy_pass ${loc.proxyPass};
      ${loc.extra ? loc.extra.join('\n      ') : ''}
    }`
      )
      .join('\n');

    return `
server {
    server_name ${config.serverName};${sslBlock}

    ${locations}
}
    `;
  }
}

InfraWebserverCommand.description = `Aplica la configuración del bloque webserver en el servidor remoto
Soporta múltiples configuraciones (webserver.configs).
Genera un nginx.conf y lo sincroniza en el servidor remoto.
`;

InfraWebserverCommand.flags = {
  env: flags.string({ char: 'e', description: 'Entorno a usar (production, staging, etc)', default: 'production' }),
};

module.exports = InfraWebserverCommand;
