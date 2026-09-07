const { Command, flags } = require('@oclif/command');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const { NodeSSH } = require('node-ssh');
const os = require('os');
const { getCredentialByKey, selectKoramConfig } = require('../../utils/index');

class DeployNodeCommand extends Command {
  async run() {
    const { args, flags } = this.parse(DeployNodeCommand);
    const alias = args.alias || '.';
    const projectRoot = process.cwd();

    // 1. Determinar config de koram-rc y el entorno
    let rcPath = null;
    let env = flags.env || 'production';
    let config = null;

    try {
      rcPath = await selectKoramConfig(projectRoot, flags.env);
      if (rcPath) {
        config = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
        env = path.basename(rcPath).replace('.koram-rc.', '').replace('.json', '');
        console.log(chalk.cyan(`✨ Configuración de Koram seleccionada: .koram-rc.${env}.json`));
      } else {
        throw new Error("No se encontró archivo de configuración.");
      }
    } catch (e) {
      console.log(chalk.red(`❌ Error al cargar configuración: ${e.message}`));
      return;
    }

    if (!config.deploy) {
      console.log(chalk.red(`❌ No se encontró la sección 'deploy' en tu configuración .koram-rc.${env}.json`));
      return;
    }

    const deployConfig = config.deploy;
    const remotePath = deployConfig.path;
    const repo = deployConfig.repo;
    const ref = deployConfig.ref || 'origin/master';
    const postDeploy = deployConfig.postDeploy || [];
    
    if (!remotePath || !repo) {
      console.log(chalk.red(`❌ Faltan propiedades requeridas 'path' y 'repo' en la sección 'deploy'.`));
      return;
    }

    // 2. Resolver credenciales
    let credentials = null;
    if (alias === '.' || !alias) {
      const user = config.server?.user || 'root';
      const host = config.server?.host;
      if (user && host) {
        credentials = await getCredentialByKey(null, user, host);
      }
    } else {
      credentials = await getCredentialByKey(alias);
    }

    if (!credentials) {
      console.log(chalk.yellow(`⚠️ No se encontraron credenciales guardadas. Se usará la configuración por defecto.`));
      credentials = {
        user: config.server?.user || 'root',
        host: config.server?.host
      };
    }

    if (!credentials.host) {
      console.log(chalk.red(`❌ No se especificó el host remoto en la configuración ni credenciales.`));
      return;
    }

    console.log(chalk.cyan(`📢 Entorno de Despliegue (Agnóstico Node.js): ${chalk.bold(env.toUpperCase())}`));
    console.log(chalk.cyan(`🖥️  Servidor Destino: ${chalk.bold(credentials.user + '@' + credentials.host)}`));

    // 3. Conexión SSH
    const ssh = new NodeSSH();
    const connectionOpts = {
      host: credentials.host,
      port: parseInt(config.server?.port || credentials.port) || 22,
      username: credentials.user,
      tryKeyboard: true,
      agent: process.env.SSH_AUTH_SOCK
    };

    if (credentials.password) {
      connectionOpts.password = credentials.password;
    }

    if (config.server?.sshKey) {
      const resolvedKeyPath = config.server.sshKey.replace(/^~/, os.homedir());
      if (fs.existsSync(resolvedKeyPath)) {
        connectionOpts.privateKey = fs.readFileSync(resolvedKeyPath, 'utf8');
      }
    }

    try {
      console.log(chalk.cyan(`🔌 Conectando al servidor...`));
      await ssh.connect(connectionOpts);
      console.log(chalk.green(`✅ Conexión SSH establecida.`));

      // 4. Preparar Directorios Remotos
      console.log(chalk.blue(`🔹 Preparando directorios en ${remotePath}...`));
      await ssh.execCommand(`mkdir -p "${remotePath}/source" "${remotePath}/shared"`, { cwd: '/' });

      // 5. Clonar o Actualizar Repositorio
      const checkGit = await ssh.execCommand(`[ -d "source/.git" ] && echo "exists" || echo "missing"`, { cwd: remotePath });
      const gitBranch = ref.split('/').pop() || 'master';

      if (checkGit.stdout.trim() !== 'exists') {
        console.log(chalk.blue(`🔹 Clonando repositorio ${repo} en ${remotePath}/source...`));
        const cloneResult = await ssh.execCommand(`git clone "${repo}" "${remotePath}/source"`, { cwd: remotePath });
        if (cloneResult.stdout) console.log(cloneResult.stdout);
        if (cloneResult.stderr) console.error(cloneResult.stderr);
      } else {
        console.log(chalk.blue(`🔹 Actualizando código vía Git (${ref})...`));
        const gitCommands = [
          `cd "${remotePath}/source"`,
          `git stash || true`,
          `git fetch --all`,
          `git checkout "${gitBranch}" || git checkout -b "${gitBranch}" || true`,
          `git reset --hard "${ref}"`
        ].join(' && ');

        const gitResult = await ssh.execCommand(gitCommands);
        if (gitResult.stdout) console.log(gitResult.stdout);
        if (gitResult.stderr) console.error(gitResult.stderr);
      }

      // 6. Ejecutar Post-Deploy
      if (postDeploy && postDeploy.length > 0) {
        console.log(chalk.blue(`🔹 Ejecutando comandos Post-Deploy...`));
        for (const cmd of postDeploy) {
          console.log(chalk.gray(`🏃 Ejecutando: ${cmd}`));
          const postResult = await ssh.execCommand(`bash -l -c "cd \\"${remotePath}/source\\" && ${cmd}"`);
          if (postResult.stdout) console.log(postResult.stdout);
          if (postResult.stderr) console.error(postResult.stderr);
          if (postResult.code !== 0) {
            throw new Error(`Comando falló con código ${postResult.code}`);
          }
        }
      }

      // 7. Gestionar Procesos (PM2)
      const usePm2 = config.advanced?.usePm2 !== false;
      const processes = Array.isArray(config.processes)
        ? config.processes
        : (config.processes ? Object.entries(config.processes).map(([k, v]) => ({ name: k, ...v })) : []);

      if (usePm2 && processes.length > 0) {
        console.log(chalk.blue(`🚀 Gestionando procesos PM2...`));
        for (const proc of processes) {
          console.log(chalk.cyan(`🔹 Proceso: ${proc.name}...`));
          const pm2Cmd = `pm2 reload ${proc.name} --update-env || (${proc.command})`;
          const finalResult = await ssh.execCommand(`bash -l -c "cd \\"${remotePath}/source\\" && ${pm2Cmd}"`);
          if (finalResult.stdout) console.log(finalResult.stdout);
          if (finalResult.stderr) console.error(finalResult.stderr);
        }
      }

      console.log(chalk.green('✅ ¡Despliegue Node.js completado con éxito!'));
      ssh.dispose();

    } catch (err) {
      console.log(chalk.red(`❌ Error en el despliegue: ${err.message}`));
      ssh.dispose();
      process.exit(1);
    }
  }
}

DeployNodeCommand.description = `Despliega aplicaciones Node.js (backend) usando configuraciones del archivo .koram-rc.json.
Optimizado para despliegues remotos directos basados en Git sin dependencias locales.`;

DeployNodeCommand.flags = {
  env: flags.string({ char: 'e', description: 'Environment a usar' })
};

DeployNodeCommand.args = [
  { name: 'alias', required: false, description: 'Alias del servidor o "." para usar el contexto local', default: '.' }
];

module.exports = DeployNodeCommand;
