// src/commands/add-webserver.js
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const { selectKoramConfig } = require('../../utils/index');
const { generateNginxConf, saveLocalConfig, readLocalConfig, getLocalConfigPath } = require('../../utils/nginx');

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

    const isSpa = config.type === 'spa';

    // Función auxiliar para crear configs
    const makeServerConfig = (opts = {}) => {
      const locations = opts.redirect
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
              // Solo agregar proxyPass si no es SPA, o si se pasó explícitamente el flag proxyPass
              ...((flags.proxyPass || !isSpa) ? { proxyPass: flags.proxyPass || 'http://127.0.0.1:3000' } : {}),
              extra: (flags.proxyPass || !isSpa) ? [
                "proxy_set_header Host $host;",
                "proxy_set_header X-Real-IP $remote_addr;"
              ] : []
            }
          ];

      return {
        serverName: flags.serverName || 'example.com',
        listen: parseInt(opts.listen || flags.port || 80, 10),
        ssl: {
          enabled: !!opts.ssl,
          certPath: flags.certPath || `/etc/letsencrypt/live/${flags.serverName || 'example.com'}/fullchain.pem`,
          keyPath: flags.keyPath || `/etc/letsencrypt/live/${flags.serverName || 'example.com'}/privkey.pem`
        },
        locations
      };
    };

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

    // Guardar archivo rc
    fs.writeFileSync(rcPath, JSON.stringify(config, null, 2), 'utf-8');
    this.log(`✅ Configuración webserver añadida/actualizada en ${rcPath}`);

    // Generar archivo Nginx local
    const env = path.basename(rcPath).replace('.koram-rc.', '').replace('.json', '');
    const appName = config.name || 'koram-app';

    try {
      const newNginxConf = generateNginxConf(config, env);
      const localConfPath = getLocalConfigPath(projectRoot, appName, env);
      const existingConf = readLocalConfig(projectRoot, appName, env);

      let shouldWrite = true;
      if (existingConf && existingConf !== newNginxConf && !flags.force) {
        const { overwriteLocal } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'overwriteLocal',
            message: `El archivo local .koram/webserver/${appName}-${env}.conf ya existe y difiere del generado. ¿Deseas sobrescribirlo?`,
            default: false
          }
        ]);
        shouldWrite = overwriteLocal;
      }

      if (shouldWrite) {
        saveLocalConfig(projectRoot, appName, env, newNginxConf);
        this.log(`✅ Archivo de plantilla Nginx guardado localmente en: .koram/webserver/${appName}-${env}.conf`);
      } else {
        this.log(`⚠️ Se conservó la versión editada localmente de .koram/webserver/${appName}-${env}.conf`);
      }
    } catch (e) {
      this.error(`❌ Error al generar plantilla local de Nginx: ${e.message}`);
    }
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
  proxyPass: flags.string({ description: 'Destino interno al que hacer proxy (ej. http://127.0.0.1:3000)' }),
  redirectToSsl: flags.boolean({ description: 'Crear redirección automática de HTTP→HTTPS', default: false }),
  force: flags.boolean({ char: 'f', description: 'Sobrescribir o reiniciar bloque webserver/config existente' })
};

module.exports = AddWebserverCommand;
