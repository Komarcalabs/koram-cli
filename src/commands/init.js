// src/commands/init.js
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

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

    const appName = flags.appName || path.basename(projectRoot);

    // Configuración moderna y unificada
    const defaultConfig = {
      name: appName,
      type: flags.type || 'spa',
      server: {
        host: flags.host || '',
        user: flags.user || '',
        port: 22
      },
      deploy: {
        repository: flags.repository || '',
        branch: flags.branch || 'main',
        path: flags.path || `/var/www/${appName}`,
        outputDir: flags.type === 'nuxt' ? '.output' : (flags.type === 'deno' ? '' : 'dist'),
        buildCommand: flags.type === 'deno' ? '' : 'npm run build',
        atomicDeploys: true,
        preDeploy: [],
        postDeploy: []
      },
      processes: [
        {
          name: appName,
          command: flags.type === 'nuxt'
            ? `pm2 start .output/server/index.mjs --name ${appName}`
            : (flags.type === 'deno'
              ? `pm2 start "deno run --allow-net --allow-read main.ts" --name ${appName}`
              : `pm2 start dist/index.js --name ${appName}`)
        }
      ],
      advanced: {
        usePm2: true,
        optimizeNpm: true,
        localNpmInstall: false
      },
      env: {
        NODE_ENV: env,
        PORT: 3000
      }
    };

    try {
      fs.writeFileSync(rcPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
      this.log(chalk.green(`\n✅ Archivo ${rcFileName} creado correctamente.`));
      this.log(chalk.cyan(`📍 Ruta: ${rcPath}\n`));
      this.log(`Ahora puedes ejecutar ${chalk.bold('koram deploy')} para iniciar el despliegue.`);
    } catch (err) {
      this.error(chalk.red(`❌ No se pudo crear ${rcFileName}: ${err.message}`));
    }
  }
}

DeployInitCommand.description = `Inicializa un archivo de configuración .koram-rc.<entorno>.json robusto.
El formato generado es compatible con todos los motores de despliegue de Koram (SPA, Nuxt, Deno, PM2).`;

DeployInitCommand.flags = {
  env: flags.string({ char: 'e', description: 'Entorno (production, staging, develop)', default: 'production' }),
  type: flags.string({ char: 't', description: 'Tipo de aplicación (spa, nuxt, pm2, deno)', default: 'spa' }),
  host: flags.string({ char: 'h', description: 'Host del servidor' }),
  user: flags.string({ char: 'u', description: 'Usuario SSH' }),
  path: flags.string({ char: 'p', description: 'Ruta remota de despliegue' }),
  repository: flags.string({ char: 'r', description: 'URL del repositorio Git' }),
  branch: flags.string({ char: 'b', description: 'Rama de Git', default: 'main' }),
  appName: flags.string({ char: 'a', description: 'Nombre de la aplicación' }),
  force: flags.boolean({ char: 'f', description: 'Sobrescribir configuración existente' }),
};

module.exports = DeployInitCommand;
