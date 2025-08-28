// src/commands/deploy-init.js
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');

class DeployInitCommand extends Command {
  async run() {
    const { flags } = this.parse(DeployInitCommand);

    const projectRoot = process.cwd();
    const env = flags.env || 'production';
    const rcFileName = `.koram-rc.${env}.json`;
    const rcPath = path.join(projectRoot, rcFileName);

    if (fs.existsSync(rcPath) && !flags.force) {
      this.error(`${rcFileName} ya existe en este proyecto. Usa --force para sobrescribir.`);
      return;
    }

    // Configuración inicial mínima pero escalable
    const defaultConfig = {
      environment: env,
      server: {
        host: flags.host || '',
        user: flags.user || '',
        port: 22,
        sshKey: flags.sshKey || '~/.ssh/id_rsa'
      },
      deploy: {
        repository: flags.repository || '',
        branch: flags.branch || 'main',
        path: flags.path || `/var/www/${flags.appName || 'mi-app'}`,
        preDeploy: [],
        postDeploy: []
      },
      processes: {
        [flags.appName || 'mi-app']: {
          command: `pm2 start dist/index.js --name ${flags.appName || 'mi-app'}`,
          logsPath: `/var/log/${flags.appName || 'mi-app'}.log`
        }
      },
      env: {
        NODE_ENV: env
      }
    };

    try {
      fs.writeFileSync(rcPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
      this.log(`✅ Archivo ${rcFileName} creado correctamente en ${rcPath}`);
    } catch (err) {
      this.error(`❌ No se pudo crear ${rcFileName}: ${err.message}`);
    }
  }
}

DeployInitCommand.description = `Inicializa un archivo de configuración .koram-rc.<entorno>.json en tu proyecto.
Este archivo contiene la configuración mínima para soportar despliegues, logs y procesos, escalable para futuras funcionalidades.`;

DeployInitCommand.flags = {
  env: flags.string({ char: 'e', description: 'Entorno a inicializar (production, staging, development)', default: 'production' }),
  host: flags.string({ char: 'h', description: 'Host del servidor' }),
  user: flags.string({ char: 'u', description: 'Usuario SSH' }),
  path: flags.string({ char: 'p', description: 'Ruta remota donde se desplegará la app' }),
  sshKey: flags.string({ char: 'k', description: 'Ruta a la SSH key' }),
  repository: flags.string({ char: 'r', description: 'Repositorio Git para despliegue' }),
  branch: flags.string({ char: 'b', description: 'Rama a desplegar' }),
  appName: flags.string({ char: 'a', description: 'Nombre de la aplicación' }),
  force: flags.boolean({ char: 'f', description: 'Sobrescribir configuración existente' }),
};

module.exports = DeployInitCommand;
