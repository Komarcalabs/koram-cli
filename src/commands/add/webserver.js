// src/commands/add-webserver.js
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const { selectKoramConfig } = require('../utils/index');

class AddWebserverCommand extends Command {
  async run() {
    const { flags } = this.parse(AddWebserverCommand);
    const projectRoot = process.cwd();

    // Seleccionar config
    const rcPath = await selectKoramConfig(projectRoot, flags.env);
    const config = JSON.parse(fs.readFileSync(rcPath, 'utf-8'));

    // Crear bloque webserver robusto
    const webServerConfig = {
      type: flags.type || 'nginx',
      config: {
        serverName: flags.serverName || 'example.com',
        listen: parseInt(flags.port || 80, 10),
        ssl: {
          enabled: !!flags.ssl,
          certPath: flags.certPath || `/etc/letsencrypt/live/${flags.serverName || 'example.com'}/fullchain.pem`,
          keyPath: flags.keyPath || `/etc/letsencrypt/live/${flags.serverName || 'example.com'}/privkey.pem`
        },
        locations: [
          {
            path: '/',
            proxyPass: flags.proxyPass || 'http://127.0.0.1:3000',
            extra: [
              "proxy_set_header Host $host;",
              "proxy_set_header X-Real-IP $remote_addr;"
            ]
          }
        ]
      }
    };

    // Verificar si ya existe webserver
    if (config.webserver && !flags.force) {
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: `Ya existe un bloque webserver en ${path.basename(rcPath)}. ¿Deseas sobrescribirlo?`,
          default: false
        }
      ]);

      if (!overwrite) {
        this.log('❌ Operación cancelada.');
        return;
      }
    }

    // Guardar bloque
    config.webserver = webServerConfig;
    fs.writeFileSync(rcPath, JSON.stringify(config, null, 2), 'utf-8');
    this.log(`✅ Bloque webserver agregado/actualizado en ${rcPath}`);
  }
}

AddWebserverCommand.description = `Agrega o actualiza un bloque webserver (nginx, caddy, etc.) en la configuración seleccionada (.koram-rc.<env>.json).`;

AddWebserverCommand.flags = {
  env: flags.string({ char: 'e', description: 'Seleccionar entorno (production, staging, development)' }),
  type: flags.string({ char: 't', description: 'Tipo de servidor web (nginx, caddy, apache)', default: 'nginx' }),
  serverName: flags.string({ char: 's', description: 'Nombre del servidor (ej. example.com)' }),
  port: flags.string({ char: 'p', description: 'Puerto de escucha', default: '80' }),
  ssl: flags.boolean({ description: 'Habilitar SSL', default: false }),
  certPath: flags.string({ description: 'Ruta al certificado SSL' }),
  keyPath: flags.string({ description: 'Ruta a la clave privada SSL' }),
  proxyPass: flags.string({ description: 'Destino interno al que hacer proxy', default: 'http://127.0.0.1:3000' }),
  force: flags.boolean({ char: 'f', description: 'Sobrescribir si ya existe un bloque webserver' })
};

module.exports = AddWebserverCommand;
