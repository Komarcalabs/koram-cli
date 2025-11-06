// TODO EN EL PROCESO DE INSTALACION CONTENTEMPLAR INSTALAR SSHPASS AL USUARIO PARA QUE TENGA LISTO ESO TAMBIEN
// SOPORTE PARA QUE SOPORTE ALIAS LOCAL DE . ----> BUSCA KORAM SINO BUSCA EN EL ENTORNO POR EL HOST
// src/commands/deploy.js
const { Command, flags } = require('@oclif/command');
const keytar = require('keytar');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { spawn } = require('child_process');
const { getCredentialByKey } = require('../../utils/index');

class DeployCommand extends Command {
  async run() {
    const { args, flags } = this.parse(DeployCommand);
    const alias = args.alias;
    const projectRoot = process.cwd();
    if (!alias) {
      console.log(chalk.red('❌ Debes indicar un alias de servidor para el deploy'));
      return;
    }
    // Detectar archivos ecosystem (.js, .cjs, .ts)
    const allowedExts = ['.js', '.cjs', '.ts'];
    const ecosystems = fs.readdirSync(projectRoot)
      .filter(f => f.startsWith('ecosystem') && allowedExts.includes(path.extname(f)));

    if (ecosystems.length === 0) {
      console.log(chalk.red('❌ No se encontró ningún archivo ecosystem válido'));
      return;
    }

    let ecosystemFile = ecosystems[0];
    if (ecosystems.length > 1) {
      const answer = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Se encontraron varios archivos ecosystem, selecciona cuál usar:',
        choices: ecosystems
      }]);
      ecosystemFile = answer.selected;
    }

    // Usamos require para importar el archivo
    var tryPath = path.resolve(process.cwd(), ecosystemFile)
    delete require.cache[require.resolve(tryPath)];
    var ecosystemConfig = require(tryPath);

    let configFile = ecosystemConfig.deploy[flags.env];
    var credentials = {};
    if (alias === '.') {
      // configFile = JSON.parse(
      //   fs.readFileSync(await selectKoramConfig(projectRoot, flags.env))
      // );
      credentials = await getCredentialByKey(null, configFile.user, configFile.host);
    } else {
      credentials = await getCredentialByKey(alias);
    }

    console.log(chalk.green(`🚀 Preparando deploy para ${credentials.user}@${credentials.host} usando ${'contraseña'}...`));

    const env = flags.env || 'production';
    const extraParams = flags.extra || '';
    const password = credentials.password;
    // Construir comando PM2
    let pm2Command = `pm2 deploy ${ecosystemFile} ${env} ${extraParams}`.trim();
    // Si se usa contraseña, prefijamos con sshpass
    if (password) {
      pm2Command = `sshpass -p '${password}' ${pm2Command}`;
    }
    console.log(chalk.blue(`🔹 Comando final: Ejecutando pm2 deploy.....`));
    // Ejecutar PM2 deploy localmente

    const logPath = path.resolve(process.cwd(), 'deploy_debug.log');
    const logFile = fs.createWriteStream(logPath, { flags: 'a' });
    // const deployProcess = spawn(pm2Command, { shell: true });
    const deployProcess = spawn(pm2Command, { shell: true });
    deployProcess.stdout.on('data', data => {
      process.stdout.write(data);
      logFile.write(data);
    });
    deployProcess.stderr.on('data', data => {
      process.stderr.write(data);
      logFile.write(data);
    });
    deployProcess.on('exit', code => {
      logFile.end();
      if (code === 0) {
        console.log('✅ Deploy completado con éxito');
      } else {
        console.log(`❌ Deploy falló con código ${code}. Revisa ${logPath}`);
      }
    });
  }
}

DeployCommand.description = `Realiza un deploy automático usando alias de credenciales guardadas.
Si se desea omitir la contraseña y usar la llave SSH cargada en el agente, usar --ssh-key o -k.
Permite múltiples archivos ecosystem (.js, .cjs, .ts) y parámetros extra de PM2.`;

DeployCommand.args = [
  { name: 'alias', required: true, description: 'Alias del servidor a desplegar' }
];

DeployCommand.flags = {
  env: flags.string({ char: 'e', description: 'Environment a usar', default: 'production' }),
  extra: flags.string({ char: 'x', description: 'Parámetros extra para pm2' }),
  sshKey: flags.boolean({ char: 'k', description: 'Omitir contraseña y usar SSH key cargada en el agente' }),
};

module.exports = DeployCommand;
