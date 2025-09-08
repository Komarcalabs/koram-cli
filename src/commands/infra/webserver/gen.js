// src/commands/infra-webserver-gen.js
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const { selectKoramConfig } = require('../../../utils/index');

class InfraWebserverGenCommand extends Command {
  async run() {
    const { flags } = this.parse(InfraWebserverGenCommand);
    const projectRoot = process.cwd();
    const rcPath = await selectKoramConfig(projectRoot, flags.env || 'production');

    if (!rcPath) {
      this.error('❌ No se encontró archivo de configuración .koram-rc.<env>.json');
      return;
    }

    const configFile = JSON.parse(fs.readFileSync(rcPath));
    const { webserver } = configFile;

    if (!webserver) {
      this.error('❌ No existe el bloque "webserver" en la configuración. Usa `koram add:webserver` primero.');
      return;
    }

    // Soporte para webserver.configs (array) o webserver.config (único objeto)
    const configs = webserver.configs || (webserver.config ? [webserver.config] : []);

    if (configs.length === 0) {
      this.error('❌ No hay configuraciones en el bloque "webserver".');
      return;
    }

    const nginxConf = configs.map(cfg => this.generateNginxConf(cfg)).join('\n\n');

    if (flags.out) {
      const outPath = path.resolve(flags.out);
      fs.writeFileSync(outPath, nginxConf, 'utf-8');
      this.log(`✅ nginx.conf generado en: ${outPath}`);
    } else {
      this.log('--- nginx.conf generado ---\n');
      this.log(nginxConf);
    }
  }

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

InfraWebserverGenCommand.description = `Genera el archivo nginx.conf a partir del bloque webserver de tu .koram-rc.<env>.json
Soporta múltiples configuraciones (webserver.configs).
Puedes visualizarlo en consola o guardarlo en un archivo con --out.
`;

InfraWebserverGenCommand.flags = {
  env: flags.string({ char: 'e', description: 'Entorno a usar (production, staging, etc)', default: 'production' }),
  out: flags.string({ char: 'o', description: 'Ruta de salida para guardar el archivo nginx.conf' }),
};

module.exports = InfraWebserverGenCommand;
