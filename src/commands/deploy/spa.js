const { Command, flags } = require('@oclif/command');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const open = require('open');
const { spawn, execSync } = require('child_process');
const { NodeSSH } = require('node-ssh');
const chalk = require('chalk');
const glob = require('glob');
const detect = require('detect-port').default;
const { getCredentialByKey, selectKoramConfig } = require('../../utils/index');

class DeploySPACommand extends Command {
  async run() {
    const { args, flags } = this.parse(DeploySPACommand);
    const alias = args.alias || '.';
    const projectRoot = process.cwd();

    // Determinar config inicial
    let configPath = null;
    let initialRC = null;
    try {
      configPath = await selectKoramConfig(projectRoot, flags.env);
      initialRC = path.basename(configPath);
    } catch (e) { }

    let aliasCreds = null;
    if (alias && alias !== '.') {
      try {
        aliasCreds = await getCredentialByKey(alias);
        if (aliasCreds) {
          console.log(chalk.cyan(`🔑 Usando alias de credenciales:`), alias);
        }
      } catch (e) {
        this.log(chalk.yellow(`⚠️ No se encontró el alias "${alias}", se usará el contexto del archivo.`));
      }
    }

    if (flags.now) {
      if (!configPath || !fs.existsSync(configPath)) {
        this.error(chalk.red('❌ No se encontró configuración para el despliegue directo.'));
      }
      console.log(chalk.cyan('🚀 Iniciando despliegue directo (Headless)...'));
      let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      // Overrides de Alias
      if (aliasCreds) {
        if (!config.server) config.server = {};
        config.server.host = aliasCreds.host || config.server.host;
        config.server.user = aliasCreds.user || config.server.user;
        config.server.password = aliasCreds.password || config.server.password;
      }

      // Overrides de Flags
      if (flags.host) { if (!config.server) config.server = {}; config.server.host = flags.host; }
      if (flags.user) { if (!config.server) config.server = {}; config.server.user = flags.user; }
      if (flags.path) { if (!config.deploy) config.deploy = {}; config.deploy.path = flags.path; }

      try {
        await this.executeDeployment(config, null);
        this.log(chalk.green('✅ Despliegue completado con éxito.'));
        process.exit(0);
      } catch (err) {
        this.error(chalk.red(`❌ Error en el despliegue: ${err.message}`));
      }
      return;
    }

    if (initialRC) console.log(chalk.cyan('✨ Configuración inicial seleccionada:'), initialRC);

    // 1. Iniciar Servidor Express para el Dashboard
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });

    app.use(express.static(path.join(__dirname, '../../deployer-dashboard')));

    let isBusy = false;

    wss.on('connection', async (ws) => {
      console.log(chalk.cyan('✨ Dashboard conectado.'));

      const configs = glob.sync(path.join(projectRoot, '.koram-rc.*.json')).map(f => path.basename(f));
      let envFiles = glob.sync(path.join(projectRoot, '.env.*')).map(f => path.basename(f));
      if (envFiles.length === 0) envFiles = ['.env.production'];

      let preSelected = initialRC || (configs.length > 0 ? configs[0] : null);

      ws.send(JSON.stringify({
        type: 'configs',
        items: configs,
        selected: preSelected,
        envs: envFiles
      }));

      if (preSelected) {
        const configPath = path.join(projectRoot, preSelected);
        if (fs.existsSync(configPath)) {
          let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

          // Overrides de Alias
          if (aliasCreds) {
            if (!config.server) config.server = {};
            config.server.host = aliasCreds.host || config.server.host;
            config.server.user = aliasCreds.user || config.server.user;
            config.server.password = aliasCreds.password || config.server.password;
          }

          // Overrides
          if (flags.host) { if (!config.server) config.server = {}; config.server.host = flags.host; }
          if (flags.user) { if (!config.server) config.server = {}; config.server.user = flags.user; }
          if (flags.path) { if (!config.deploy) config.deploy = {}; config.deploy.path = flags.path; }
          ws.send(JSON.stringify({ type: 'config_data', data: config }));
        }
      }

      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message);

          if (data.type === 'load_config') {
            const configPath = path.join(projectRoot, data.name);
            if (fs.existsSync(configPath)) {
              const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
              ws.send(JSON.stringify({ type: 'config_data', data: config }));
            }
          }

          if (data.type === 'save_config') {
            const configPath = path.join(projectRoot, data.name);
            const currentConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
            const serverData = { ...data.data.server };
            delete serverData.password;
            delete serverData.password_plain;

            const updated = {
              ...currentConfig,
              name: data.data.name || currentConfig.name,
              server: serverData,
              deploy: { ...currentConfig.deploy, ...data.data.deploy },
              env: { ...currentConfig.env, ...data.data.env },
              buildEnv: data.data.buildEnv || currentConfig.buildEnv,
              processes: data.data.processes || currentConfig.processes,
              advanced: { ...currentConfig.advanced, ...data.data.advanced }
            };

            fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
            this.logToWs(ws, '✅ Configuración guardada en ' + data.name, 'success');
          }

          if (data.type === 'start_deploy' && !isBusy) {
            isBusy = true;
            this.broadcast(wss, { type: 'status', busy: true });
            try {
              const configPath = path.join(projectRoot, data.name);
              const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
              await this.executeDeployment(config, ws);
            } catch (err) {
              this.logToWs(ws, `❌ Error crítico: ${err.message}`, 'error');
            } finally {
              isBusy = false;
              this.broadcast(wss, { type: 'status', busy: false });
            }
          }
        } catch (e) {
          console.error('WS Error:', e);
        }
      });
    });

    const PORT = await detect(3889);
    server.listen(PORT, () => {
      console.log(chalk.green(`\n🚀 Dashboard SPA listo en http://localhost:${PORT}`));
      open(`http://localhost:${PORT}`);
    });
  }

  logToWs(ws, message, level = 'info') {
    const cleanMessage = message.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'log', message: cleanMessage, level }));
    }
    if (level === 'error') console.error(chalk.red(message));
    else if (level === 'success') console.log(chalk.green(message));
    else console.log(chalk.blue(message));
  }

  broadcast(wss, data) {
    wss.clients.forEach(client => {
      if (client.readyState === client.OPEN) client.send(JSON.stringify(data));
    });
  }

  async executeDeployment(config, ws) {
    const projectRoot = process.cwd();

    // Recuperar password directamente de la bóveda
    let vaultPassword = config.server.password_plain || config.server.password;
    if (!vaultPassword) {
      try {
        const creds = await getCredentialByKey(null, config.server.user, config.server.host);
        if (creds && creds.password) vaultPassword = creds.password;
      } catch (e) { }
    }

    // Iniciar SSH en paralelo
    const sshPromise = (async () => {
      const ssh = new NodeSSH();
      await ssh.connect({
        host: config.server.host,
        port: parseInt(config.server.port) || 22,
        username: config.server.user,
        password: vaultPassword,
        tryKeyboard: true,
        agent: process.env.SSH_AUTH_SOCK
      });
      return ssh;
    })();

    try {
      // 1. Build Local
      const buildEnv = config.buildEnv || "production";
      const envName = buildEnv.split(".").pop() || "production";

      this.logToWs(ws, "📦 Preparando build local...", "info");
      if (config.advanced?.localNpmInstall) {
        this.logToWs(ws, "📥 Ejecutando npm install...", "info");
        await this.runLocalCommand("npm install", projectRoot, ws);
      }

      const buildCmd = config.deploy?.buildCommand || `NODE_ENV=${envName} npm run build`;
      this.logToWs(ws, `🔨 Ejecutando: ${buildCmd}`, "info");
      await this.runLocalCommand(buildCmd, projectRoot, ws);

      const outputDir = config.deploy?.outputDir || (fs.existsSync('dist') ? 'dist' : (fs.existsSync('build') ? 'build' : 'dist'));
      if (!fs.existsSync(outputDir)) {
        throw new Error(`No se encontró el directorio de salida (${outputDir}).`);
      }

      // 2. Esperar SSH
      this.logToWs(ws, "🔌 Conectando al servidor...", "info");
      const ssh = await sshPromise;
      this.logToWs(ws, "✅ Conexión SSH establecida.", "success");

      const remotePath = config.deploy.path;
      const useAtomic = config.advanced?.atomicDeploys !== false;

      // 3. Preparar Directorios Remotos
      if (useAtomic) {
        await ssh.execCommand(`mkdir -p ${remotePath}/releases`);
      } else {
        await ssh.execCommand(`mkdir -p ${remotePath}`);
      }

      // 4. Transferencia (Rsync o Tar)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const releaseDir = useAtomic ? `releases/${timestamp}` : '';
      const fullRemoteDest = path.join(remotePath, releaseDir);

      const hasRsync = execSync('which rsync || true').toString().trim() !== '';
      const hasSshPass = execSync('which sshpass || true').toString().trim() !== '';
      const canUseRsync = hasRsync && (vaultPassword ? hasSshPass : true);

      if (canUseRsync) {
        this.logToWs(ws, "⚡ Sincronizando archivos (Rsync)...", "info");
        if (useAtomic) await ssh.execCommand(`mkdir -p ${fullRemoteDest}`);

        let rsyncCmd = `rsync -avz --delete --no-perms --no-owner --no-group -e "ssh -p ${config.server.port || 22} -o StrictHostKeyChecking=no"`;
        if (vaultPassword) rsyncCmd = `sshpass -p "${vaultPassword}" ${rsyncCmd}`;

        const src = outputDir.endsWith('/') ? outputDir : `${outputDir}/`;
        const dest = `${config.server.user}@${config.server.host}:${fullRemoteDest}/`;

        try {
          execSync(`${rsyncCmd} ${src} ${dest}`, { cwd: projectRoot });
        } catch (e) {
          this.logToWs(ws, `⚠️ Fallo rsync: ${e.message}. Usando fallback Tar.`, "error");
          await this.transferWithTar(ssh, outputDir, fullRemoteDest, projectRoot, ws);
        }
      } else {
        await this.transferWithTar(ssh, outputDir, fullRemoteDest, projectRoot, ws);
      }

      // 5. Atomic Switch (Symlink)
      if (useAtomic) {
        this.logToWs(ws, "🔄 Activando nueva versión...", "info");
        const currentLink = path.join(remotePath, 'current');
        const relativeTarget = `releases/${timestamp}`;
        await ssh.execCommand(`cd ${remotePath} && ln -sfn ${relativeTarget} current`);

        // Limpiar versiones antiguas (mantener 5)
        this.logToWs(ws, "🧹 Limpiando versiones antiguas...", "info");
        await ssh.execCommand(`cd ${remotePath}/releases && ls -1t | tail -n +6 | xargs rm -rf`);
      }

      // 6. Post-Deploy
      if (config.deploy?.postDeploy && config.deploy.postDeploy.length > 0) {
        this.logToWs(ws, "🏃 Ejecutando comandos Post-Deploy...", "info");
        for (const cmd of config.deploy.postDeploy) {
          await ssh.execCommand(`cd ${useAtomic ? path.join(remotePath, 'current') : remotePath} && ${cmd}`);
        }
      }

      // 7. Gestionar Procesos (PM2)
      const usePm2 = config.advanced?.usePm2 !== false;
      const processes = Array.isArray(config.processes)
        ? config.processes
        : (config.processes ? Object.entries(config.processes).map(([k, v]) => ({ name: k, ...v })) : []);

      if (usePm2 && processes.length > 0) {
        this.logToWs(ws, "🚀 Gestionando procesos PM2...", "info");
        for (const proc of processes) {
          this.logToWs(ws, `🔹 Proceso: ${proc.name}...`, "info");
          const pm2Cmd = `pm2 reload ${proc.name} --update-env || (${proc.command})`;
          const finalResult = await ssh.execCommand(`cd ${useAtomic ? path.join(remotePath, 'current') : remotePath} && ${pm2Cmd}`);
          if (finalResult.stdout) this.logToWs(ws, finalResult.stdout);
          if (finalResult.stderr) this.logToWs(ws, finalResult.stderr, "info");
        }
      }

      this.logToWs(ws, "✅ ¡Despliegue SPA completado!", "success");
      ssh.dispose();

    } catch (err) {
      this.logToWs(ws, `❌ Error: ${err.message}`, "error");
      throw err;
    }
  }

  async transferWithTar(ssh, localDir, remoteDest, cwd, ws) {
    this.logToWs(ws, "📦 Empaquetando y subiendo (Tar)...", "info");
    const tarFile = `spa-deploy-${Date.now()}.tar.gz`;
    execSync(`tar -czf ${tarFile} -C ${localDir} .`, { cwd });

    await ssh.execCommand(`mkdir -p ${remoteDest}`);
    await ssh.putFile(path.join(cwd, tarFile), path.join(remoteDest, tarFile));
    await ssh.execCommand(`cd ${remoteDest} && tar -xzf ${tarFile} && rm ${tarFile}`);
    fs.unlinkSync(path.join(cwd, tarFile));
  }

  runLocalCommand(command, cwd, ws) {
    return new Promise((resolve, reject) => {
      const p = spawn(command, { cwd, shell: true });
      p.stdout.on('data', d => this.logToWs(ws, d.toString().trim()));
      p.stderr.on('data', d => this.logToWs(ws, d.toString().trim(), 'info'));
      p.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} falló`)));
    });
  }
}

DeploySPACommand.description = `Lanza el Dashboard interactivo para desplegar SPAs.
Optimizado con Rsync y despliegues atómicos.`;

DeploySPACommand.flags = {
  env: flags.string({ char: 'e', description: 'Ambiente (.koram-rc.ENV.json)' }),
  host: flags.string({ char: 'h', description: 'Host remoto' }),
  user: flags.string({ char: 'u', description: 'Usuario SSH' }),
  path: flags.string({ char: 'p', description: 'Ruta remota' }),
  now: flags.boolean({ description: 'Ejecutar despliegue inmediatamente sin Dashboard' }),
};

DeploySPACommand.args = [
  { name: 'alias', description: 'Alias del servidor o "." para usar el contexto local', default: '.' }
];

module.exports = DeploySPACommand;
