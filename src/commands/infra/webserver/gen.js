// src/commands/infra-webserver-gen.js
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const { selectKoramConfig } = require('../../../utils/index');
const { generateNginxConf, saveLocalConfig, readLocalConfig } = require('../../../utils/nginx');

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

    const env = flags.env || 'production';
    const appName = configFile.name || 'koram-app';

    try {
      const nginxConf = generateNginxConf(configFile, env);

      if (flags.out) {
        const outPath = path.resolve(flags.out);
        fs.writeFileSync(outPath, nginxConf, 'utf-8');
        this.log(`✅ nginx.conf generado y guardado en: ${outPath}`);
      } else {
        const existingConf = readLocalConfig(projectRoot, appName, env);
        let shouldWrite = true;

        if (existingConf && existingConf !== nginxConf && !flags.force) {
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
          const outPath = saveLocalConfig(projectRoot, appName, env, nginxConf);
          this.log(`✅ Archivo de plantilla Nginx guardado localmente en: ${outPath}`);
          this.log('\n--- nginx.conf generado ---\n');
          this.log(nginxConf);
        } else {
          this.log(`⚠️ Se conservó la versión editada localmente de .koram/webserver/${appName}-${env}.conf`);
        }
      }
    } catch (e) {
      this.error(`❌ Error al generar la configuración: ${e.message}`);
    }
  }
}

InfraWebserverGenCommand.description = `Genera el archivo nginx.conf a partir del bloque webserver de tu .koram-rc.<env>.json
Soporta múltiples configuraciones (webserver.configs).
Guarda por defecto en .koram/webserver/<appName>-<env>.conf o en la ruta de --out.
`;

InfraWebserverGenCommand.flags = {
  env: flags.string({ char: 'e', description: 'Entorno a usar (production, staging, etc)', default: 'production' }),
  out: flags.string({ char: 'o', description: 'Ruta de salida para guardar el archivo nginx.conf' }),
  force: flags.boolean({ char: 'f', description: 'Fuerza la sobrescritura de la plantilla Nginx local existente', default: false }),
};

module.exports = InfraWebserverGenCommand;
