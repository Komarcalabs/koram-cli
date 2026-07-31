// TODO EN EL PROCESO DE INSTALACION CONTENTEMPLAR INSTALAR SSHPASS AL USUARIO PARA QUE TENGA LISTO ESO TAMBIEN
// SOPORTE PARA QUE SOPORTE ALIAS LOCAL DE . ----> BUSCA KORAM SINO BUSCA EN EL ENTORNO POR EL HOST
// src/commands/deploy.js
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { spawn } = require('child_process');
const os = require('os');
const { getCredentialByKey, selectKoramConfig } = require('../../utils/index');

class DeployCommand extends Command {
  async run() {
    const { args, flags } = this.parse(DeployCommand);
    const alias = args.alias || '.';
    const projectRoot = process.cwd();

    // 1. Determinar config de koram-rc y el entorno
    let rcPath = null;
    let env = flags.env || 'production';
    let koramConfig = null;

    try {
      rcPath = await selectKoramConfig(projectRoot, flags.env);
      if (rcPath) {
        koramConfig = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
        // Determinar env a partir del nombre del archivo rcPath (.koram-rc.<env>.json)
        env = path.basename(rcPath).replace('.koram-rc.', '').replace('.json', '');
        console.log(chalk.cyan(`✨ Configuración de Koram seleccionada: .koram-rc.${env}.json`));
      }
    } catch (e) {
      // Si no hay .koram-rc, continuamos tradicionalmente
    }

    // 2. Detectar archivos ecosystem (.js, .cjs, .ts)
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

    // Importar el ecosistema
    const tryPath = path.resolve(process.cwd(), ecosystemFile);
    delete require.cache[require.resolve(tryPath)];
    const ecosystemConfig = require(tryPath);

    const configFile = ecosystemConfig.deploy[env];
    if (!configFile) {
      console.log(chalk.red(`❌ No se encontró la configuración del entorno "${env}" en ${ecosystemFile}`));
      return;
    }

    // 3. Resolver credenciales
    let credentials = null;
    if (alias === '.' || !alias) {
      // Intentar resolver desde koramConfig o del ecosistema
      const user = koramConfig?.server?.user || configFile.user;
      const host = koramConfig?.server?.host || configFile.host;
      if (user && host) {
        credentials = await getCredentialByKey(null, user, host);
      }
    } else {
      credentials = await getCredentialByKey(alias);
    }

    if (!credentials) {
      console.log(chalk.yellow(`⚠️ No se encontraron credenciales guardadas para el servidor. PM2 solicitará la contraseña en consola.`));
      credentials = { user: configFile.user, host: configFile.host };
    }

    console.log(chalk.cyan(`📢 Entorno de Despliegue: ${chalk.bold(env.toUpperCase())}`));
    console.log(chalk.cyan(`🖥️  Servidor Destino: ${chalk.bold(credentials.user + '@' + credentials.host)}`));

    const extraParams = flags.extra || '';
    const password = credentials.password;
    
    // Construir comando PM2
    let pm2Command = `pm2 deploy ${ecosystemFile} ${env} ${extraParams}`.trim();
    let passFile = null;

    if (password && !flags.sshKey) {
      console.log(chalk.green(`🔑 Usando credenciales guardadas en la bóveda de forma segura...`));
      const tmpDir = os.tmpdir();
      passFile = path.join(tmpDir, `koram_pass_${Date.now()}.txt`);
      fs.writeFileSync(passFile, password + '\n', { mode: 0o600 });
      pm2Command = `sshpass -f '${passFile}' ${pm2Command}`;
    }

    console.log(chalk.blue(`🔹 Iniciando despliegue de PM2 (pm2 deploy)...`));

    const logPath = path.resolve(process.cwd(), 'deploy_debug.log');
    const logFile = fs.createWriteStream(logPath, { flags: 'a' });
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
      try {
        if (passFile && fs.existsSync(passFile)) {
          fs.unlinkSync(passFile);
        }
      } catch (e) {}

      if (code === 0) {
        console.log(chalk.green('✅ Deploy completado con éxito'));
      } else {
        console.log(chalk.red(`❌ Deploy falló con código ${code}. Revisa ${logPath}`));
      }
    });
  }
}

DeployCommand.description = `Realiza un deploy automático usando alias de credenciales guardadas.
Si se desea omitir la contraseña y usar la llave SSH cargada en el agente, usar --ssh-key o -k.
Permite múltiples archivos ecosystem (.js, .cjs, .ts) y parámetros extra de PM2.`;

DeployCommand.args = [
  { name: 'alias', required: false, description: 'Alias del servidor o "." para usar el contexto local', default: '.' }
];

DeployCommand.flags = {
  env: flags.string({ char: 'e', description: 'Environment a usar' }),
  extra: flags.string({ char: 'x', description: 'Parámetros extra para pm2' }),
  sshKey: flags.boolean({ char: 'k', description: 'Omitir contraseña y usar SSH key cargada en el agente' }),
};

module.exports = DeployCommand;
