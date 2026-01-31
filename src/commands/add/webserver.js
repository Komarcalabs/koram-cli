// src/commands/add-webserver.js
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const { selectKoramConfig } = require('../../utils/index');

class AddWebserverCommand extends Command {
  async run() {
    const { flags } = this.parse(AddWebserverCommand);
    const projectRoot = process.cwd();

    // Seleccionar config
    const rcPath = await selectKoramConfig(projectRoot, flags.env);
    const config = JSON.parse(fs.readFileSync(rcPath, 'utf-8'));

    // Si no existe bloque webserver, inicializarlo
    if (!config.webserver || flags.force) {
      config.webserver = {
        type: flags.type || 'nginx',
        configs: []
      };
      if (flags.force) {
        this.log(`⚠️ Bloque webserver reiniciado en ${rcPath}`);
      }
    }

    // Función auxiliar para crear configs
    const makeServerConfig = (opts = {}) => ({
      serverName: flags.serverName || 'example.com',
      listen: parseInt(opts.listen || flags.port || 80, 10),
      ssl: {
        enabled: !!opts.ssl,
        certPath: flags.certPath || `/etc/letsencrypt/live/${flags.serverName || 'example.com'}/fullchain.pem`,
        keyPath: flags.keyPath || `/etc/letsencrypt/live/${flags.serverName || 'example.com'}/privkey.pem`
      },
      locations: opts.redirect
        ? [
            {
              path: '/',
              extra: [
                'return 301 https://$host$request_uri;'
              ]
            }
          ]
        : [
            {
              path: '/',
              proxyPass: flags.proxyPass || 'http://127.0.0.1:3000',
              extra: [
                "proxy_set_header Host $host;",
                "proxy_set_header X-Real-IP $remote_addr;"
              ]
            }
          ]
    });

    let newConfigs = [];

    if (flags.ssl && flags.redirectToSsl) {
      // Config 80 → redirect to HTTPS
      newConfigs.push(makeServerConfig({ listen: 80, redirect: true }));

      // Config 443 → real proxy + SSL
      newConfigs.push(makeServerConfig({ listen: 443, ssl: true }));
    } else {
      // Normal single config
      newConfigs.push(makeServerConfig({ ssl: flags.ssl }));
    }

    // Agregar/actualizar configs
    for (const newCfg of newConfigs) {
      const exists = config.webserver.configs.find(
        c => c.serverName === newCfg.serverName && c.listen === newCfg.listen
      );

      if (exists && !flags.force) {
        const { overwrite } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'overwrite',
            message: `Ya existe un bloque con serverName=${newCfg.serverName} y listen=${newCfg.listen}. ¿Deseas sobrescribirlo?`,
            default: false
          }
        ]);

        if (!overwrite) {
          this.log(`❌ Bloque ${newCfg.serverName}:${newCfg.listen} no fue modificado.`);
          continue;
        }

        // Reemplazar existente
        const idx = config.webserver.configs.indexOf(exists);
        config.webserver.configs[idx] = newCfg;
      } else {
        // Agregar nuevo
        config.webserver.configs.push(newCfg);
      }
    }

    // Guardar archivo
    fs.writeFileSync(rcPath, JSON.stringify(config, null, 2), 'utf-8');
    this.log(`✅ Configuración webserver añadida/actualizada en ${rcPath}`);
  }
}

AddWebserverCommand.description = `Agrega o actualiza configuraciones dentro del bloque webserver (nginx, caddy, etc.) en .koram-rc.<env>.json.
Soporta múltiples bloques y redirección automática HTTP→HTTPS.`;

AddWebserverCommand.flags = {
  env: flags.string({ char: 'e', description: 'Seleccionar entorno (production, staging, development)' }),
  type: flags.string({ char: 't', description: 'Tipo de servidor web (nginx, caddy, apache)', default: 'nginx' }),
  serverName: flags.string({ char: 's', description: 'Nombre del servidor (ej. example.com)' }),
  port: flags.string({ char: 'p', description: 'Puerto de escucha', default: '80' }),
  ssl: flags.boolean({ description: 'Habilitar SSL', default: false }),
  certPath: flags.string({ description: 'Ruta al certificado SSL' }),
  keyPath: flags.string({ description: 'Ruta a la clave privada SSL' }),
  proxyPass: flags.string({ description: 'Destino interno al que hacer proxy', default: 'http://127.0.0.1:3000' }),
  redirectToSsl: flags.boolean({ description: 'Crear redirección automática de HTTP→HTTPS', default: false }),
  force: flags.boolean({ char: 'f', description: 'Sobrescribir o reiniciar bloque webserver/config existente' })
};

module.exports = AddWebserverCommand;
