const { Command, flags } = require('@oclif/command');
const path = require('path');
const chalk = require('chalk');
const { getCredentialByKey, selectKoramConfig } = require('../../utils/index');
const NuxtDashboard = require('../../utils/deploy/nuxt-dashboard');

class DeployCommand extends Command {
  async run() {
    const { args, flags } = this.parse(DeployCommand);
    const alias = args.alias || '.';
    const projectRoot = process.cwd();

    let initialRC = null;
    try {
      const rcPath = await selectKoramConfig(projectRoot, flags.env);
      if (rcPath) initialRC = path.basename(rcPath);
      console.log(chalk.cyan('✨ Configuración inicial seleccionada:'), initialRC);
    } catch (e) { }

    let aliasCreds = null;
    if (alias && alias !== '.') {
      try {
        aliasCreds = await getCredentialByKey(alias);
        if (aliasCreds) {
          console.log(chalk.cyan(`🔑 Usando alias de credenciales:`), alias);
        }
      } catch (e) {
        console.log(chalk.yellow(`⚠️ No se encontró el alias "${alias}", se usará el contexto del archivo.`));
      }
    }

    const dashboard = new NuxtDashboard({
      projectRoot,
      initialRC,
      aliasCreds,
      flags
    });

    await dashboard.start();
  }
}

DeployCommand.description = `Lanza el Dashboard de despliegue interactivo para Nuxt.
Optimizado para servidores de bajos recursos con Smart Install.
`;

DeployCommand.flags = {
  env: flags.string({ char: 'e', description: 'Ambiente específico (ej: develop, staging)' }),
  host: flags.string({ char: 'h', description: 'Host del servidor para sobrescribir el config' }),
  user: flags.string({ char: 'u', description: 'Usuario SSH para sobrescribir el config' }),
  path: flags.string({ char: 'p', description: 'Ruta remota para sobrescribir el config' }),
};

DeployCommand.args = [
  { name: 'alias', description: 'Alias del servidor o "." para usar el contexto local', default: '.' }
];

module.exports = DeployCommand;
