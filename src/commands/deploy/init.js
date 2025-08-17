const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');

class DeployInitCommand extends Command {
  async run() {
    const { flags } = this.parse(DeployInitCommand);

    const projectRoot = process.cwd();
    const rcPath = path.join(projectRoot, '.koram-rc');

    if (fs.existsSync(rcPath) && !flags.force) {
      this.error('.koram-rc ya existe en este proyecto. Usa --force para sobrescribir.');
      return;
    }

    // Configuración inicial por defecto
    const defaultConfig = {
      app_name: flags.appName || 'mi-spa',
      host: flags.host || '',
      user: flags.user || '',
      remote_path: flags.path || '/var/www/mi-spa',
      build_env: flags.buildEnv || 'production'
    };

    try {
      fs.writeFileSync(rcPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
      this.log(`✅ Archivo .koram-rc creado correctamente en ${rcPath}`);
    } catch (err) {
      this.error(`❌ No se pudo crear .koram-rc: ${err.message}`);
    }
  }
}

DeployInitCommand.description = `Inicializa un archivo .koram-rc en tu proyecto.
Este comando crea la configuración básica para que koram spa-deploy funcione.
`;

DeployInitCommand.flags = {
  host: flags.string({ char: 'h', description: 'Host del servidor' }),
  user: flags.string({ char: 'u', description: 'Usuario SSH' }),
  path: flags.string({ char: 'p', description: 'Ruta remota de la SPA' }),
  buildEnv: flags.string({ char: 'e', description: 'Entorno de build (production, staging, etc.)' }),
  appName: flags.string({ char: 'a', description: 'Nombre de la aplicación' }),
  force: flags.boolean({ char: 'f', description: 'Sobrescribir .koram-rc si ya existe' }),
};

module.exports = DeployInitCommand;
