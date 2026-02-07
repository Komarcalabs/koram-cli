const { Command, flags } = require('@oclif/command');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const open = require('open');
const { spawn, execSync } = require('child_process');
const { NodeSSH } = require('node-ssh');
const crypto = require('crypto');
const chalk = require('chalk');
const glob = require('glob');
const detect = require('detect-port').default;
const { getCredentialByKey, selectKoramConfig } = require('../../utils/index');

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

    // 1. Iniciar Servidor Express para el Dashboard
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });

    app.use(express.static(path.join(__dirname, '../../deployer-dashboard')));

    let isBusy = false;

    wss.on('connection', async (ws) => {
      console.log(chalk.cyan('✨ Dashboard conectado.'));

      // Enviar lista de configs y archivos .env.* al conectar
      const configs = glob.sync(path.join(projectRoot, '.koram-rc.*.json')).map(f => path.basename(f));
      let envFiles = glob.sync(path.join(projectRoot, '.env.*')).map(f => path.basename(f));

      if (envFiles.length === 0) {
        envFiles = ['.env.production'];
      }

      // Determinar archivo seleccionado por defecto
      let preSelected = initialRC || (configs.length > 0 ? configs[0] : null);

      ws.send(JSON.stringify({
        type: 'configs',
        items: configs,
        selected: preSelected,
        envs: envFiles
      }));

      // Cargar configuración inicial con Overrides de Flags y Alias
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

          // Overrides de Flags de la CLI
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

            // Limpiamos contraseñas para no guardarlas en el JSON (Paridad Usuario)
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

    const PORT = await detect(3888);
    server.listen(PORT, () => {
      console.log(chalk.green(`\n🚀 Dashboard de Despliegue listo en http://localhost:${PORT}`));
      open(`http://localhost:${PORT}`);
    });
  }

  logToWs(ws, message, level = 'info') {
    // Limpiar códigos ANSI para el Dashboard (Paridad Python)
    const cleanMessage = message.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'log', message: cleanMessage, level }));
    }
    if (level === 'error') console.error(chalk.red(message));
    else if (level === 'success') console.log(chalk.green(message));
    else console.log(chalk.blue(message));
  }

  broadcast(wss, data) {
    wss.clients.forEach(client => {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }

  async executeDeployment(config, ws) {
    const projectRoot = process.cwd();
    const remoteShellLoader = 'export PATH=$PATH:/usr/local/bin:/usr/bin:/bin; [ -f ~/.profile ] && . ~/.profile; [ -f ~/.bashrc ] && . ~/.bashrc; [ -f ~/.zshrc ] && . ~/.zshrc';

    const envVars = Object.entries(config.env || {}).map(([k, v]) => `export ${k}="${v}"`).join('; ');
    const fullRemoteLoader = `${remoteShellLoader}; ${envVars}`;

    // --- PARALELIZACIÓN SSH (Paridad Python) ---
    // Recuperar password directamente de la bóveda de Koram (Seguridad Máxima)
    let vaultPassword = config.server.password_plain || config.server.password;
    if (!vaultPassword) {
      try {
        const creds = await getCredentialByKey(null, config.server.user, config.server.host);
        if (creds && creds.password) vaultPassword = creds.password;
      } catch (e) { }
    }

    // Iniciamos la conexión en paralelo mientras ocurre el build local
    const sshPromise = (async () => {
      try {
        const ssh = new NodeSSH();
        const sshConfig = {
          host: config.server.host,
          port: parseInt(config.server.port) || 22,
          username: config.server.user,
          tryKeyboard: true,
        };
        if (vaultPassword) {
          sshConfig.password = vaultPassword;
        }
        if (process.env.SSH_AUTH_SOCK) {
          sshConfig.agent = process.env.SSH_AUTH_SOCK;
        }
        await ssh.connect(sshConfig);
        return ssh;
      } catch (err) {
        throw new Error(`Error en conexión SSH paralela: ${err.message}`);
      }
    })();

    try {
      // 0. Preparar Build Local
      let fullBuildCmd = "";

      const buildEnv = config.buildEnv || "production";
      const envName = buildEnv.split(".").pop() || "production";

      const isLocalInstall = config.advanced?.localNpmInstall === true;
      if (isLocalInstall) {
        this.logToWs(ws, "📦 Ejecutando npm install local...", "info");
        fullBuildCmd += "npm install && ";
      }

      fullBuildCmd += `NODE_ENV=${envName} npm run build`;

      this.logToWs(ws, `🔨 Ejecutando construcción local (${envName})...`, "info");
      await this.runCommand(fullBuildCmd, projectRoot, ws);

      const outputDir = fs.existsSync('.output') ? '.output' : '.nuxt';
      if (!fs.existsSync(outputDir)) {
        throw new Error(`No se encontró el directorio de salida (${outputDir}). ¿Ejecutaste el build correctamente?`);
      }

      // Paridad Python: Limpiar módulos nativos del build local (incompatibles con Linux)
      const bundledModules = path.join(projectRoot, outputDir, 'server', 'node_modules');
      if (fs.existsSync(bundledModules)) {
        this.logToWs(ws, '🧹 Limpiando módulos nativos locales de .output...', 'info');
        execSync(`rm -rf "${bundledModules}"`, { cwd: projectRoot });
      }

      // --- ESPERAR SSH ---
      this.logToWs(ws, '� Esperando estabilización de conexión SSH...', 'info');
      const ssh = await sshPromise;
      this.logToWs(ws, '✅ Conexión SSH establecida paralelamente.', 'success');

      // --- LIMPIEZA REMOTA ---
      this.logToWs(ws, '🧹 Limpiando directorios de construcción remotos...', 'info');
      const cleanupCmd = `mkdir -p ${config.deploy.path} && cd ${config.deploy.path} && rm -rf .output .nuxt .cache`;
      await ssh.execCommand(cleanupCmd);

      // --- ESTRATEGIA DE TRANSFERENCIA ULTRA-RÁPIDA (Paridad Python + Optimización) ---
      const remotePath = config.deploy.path;
      const hasRsync = execSync('which rsync || true').toString().trim() !== '';
      const hasSshPass = execSync('which sshpass || true').toString().trim() !== '';

      // Identificar archivos a desplegar (Paridad Python: public, static, ecosystem, etc.)
      const potentialFiles = [outputDir, 'package.json', 'package-lock.json', 'public', 'static', 'ecosystem.config.js'];
      const filesToDeploy = potentialFiles.filter(f => fs.existsSync(path.join(projectRoot, f)));

      // Solo usamos Rsync si está disponible. Si hay contraseña, requerimos sshpass.
      let useRsync = hasRsync;
      const hasPassword = !!vaultPassword;
      if (hasPassword && !hasSshPass) {
        useRsync = false;
        this.logToWs(ws, '⚠️ Rsync requiere "sshpass" para autenticación por password. Usando Tar (Legacy).', 'info');
      }

      if (useRsync) {
        this.logToWs(ws, '⚡ Iniciando transferencia Delta (Rsync)...', 'info');
        const rsyncTarget = `${config.server.user}@${config.server.host}:${remotePath}/`;

        // 1. Asegurar carpeta remota
        await ssh.execCommand(`mkdir -p ${remotePath}`);

        // 2. Ejecutar Rsync Delta Sync (Solo sube lo que cambió)
        let rsyncBase = `rsync -az --delete --no-perms --no-owner --no-group -e "ssh -p ${config.server.port || 22} -o StrictHostKeyChecking=no"`;
        const rsyncEnv = { ...process.env };

        if (hasPassword) {
          rsyncBase = `sshpass -e ${rsyncBase}`;
          rsyncEnv.SSHPASS = vaultPassword;
        }

        for (const file of filesToDeploy) {
          this.logToWs(ws, `⬆️ Sincronizando ${file}...`, 'info');
          try {
            // Si es un directorio, añadimos / al final para que rsync sincronice el contenido
            const src = fs.statSync(file).isDirectory() ? `${file}/` : file;
            const dest = fs.statSync(file).isDirectory() ? `${rsyncTarget}${file}/` : rsyncTarget;
            if (fs.statSync(file).isDirectory()) await ssh.execCommand(`mkdir -p ${remotePath}/${file}`);

            execSync(`${rsyncBase} ${src} ${dest}`, { cwd: projectRoot, env: rsyncEnv });
          } catch (e) {
            this.logToWs(ws, `⚠️ Fallo rsync en ${file}: ${e.message}`, 'error');
          }
        }
      } else {
        // --- FALLBACK TAR (OPTIMIZADO) ---
        this.logToWs(ws, '📦 Preparando paquete de despliegue (Compresión Rápida)...', 'info');
        const tarFile = `deploy-${Date.now()}.tar.gz`;

        // Unimos los archivos a empaquetar
        const filesString = filesToDeploy.join(' ');

        try {
          // Usamos gzip -1 para máxima velocidad. --dereference para seguir symlinks (Paridad Python)
          execSync(`tar --no-xattrs --dereference -cf - ${filesString} | gzip -1 > ${tarFile}`, { cwd: projectRoot, shell: true });
        } catch (e) {
          throw new Error('Error al crear el archivo comprimido. Asegúrate de tener "tar" y "gzip" instalados.');
        }

        this.logToWs(ws, `⬆️ Subiendo archivos a ${remotePath}...`, 'info');
        await ssh.execCommand(`mkdir -p ${remotePath}`);
        await ssh.putFile(path.join(projectRoot, tarFile), path.join(remotePath, tarFile));

        this.logToWs(ws, '📂 Extrayendo archivos en el servidor...', 'info');
        // Solo limpiamos si usamos Tar, Rsync ya lo hace con --delete
        const extractResult = await ssh.execCommand(`cd ${remotePath} && rm -rf ${outputDir} .nuxt && tar -xzf ${tarFile} && rm ${tarFile}`);
        if (extractResult.stdout) this.logToWs(ws, extractResult.stdout);
        if (extractResult.stderr) this.logToWs(ws, extractResult.stderr, 'info');

        fs.unlinkSync(path.join(projectRoot, tarFile)); // Borrar local
      }

      // --- CONTEXTO DE DESPLIEGUE (Pre-Deploy) ---
      // Concatenamos los comandos Pre-Deploy para que persistan en el loader remoto
      const preDeployCmds = (config.deploy?.preDeploy || []).join(' && ');
      const finalRemoteLoader = preDeployCmds
        ? `${fullRemoteLoader} && ${preDeployCmds}`
        : fullRemoteLoader;

      if (preDeployCmds) {
        this.logToWs(ws, '🏃 Ejecutando y preparando contexto Pre-Deploy...', 'info');
        this.logToWs(ws, `> ${preDeployCmds}`, 'info');
        // Validamos que los comandos predeploy funcionen antes de seguir
        const preCheck = await ssh.execCommand(`cd ${remotePath} && ${finalRemoteLoader} && echo "Pre-deploy OK"`);
        if (preCheck.code !== 0) {
          this.logToWs(ws, `⚠️ Advertencia en Pre-Deploy: ${preCheck.stderr}`, 'error');
        }
      }

      // 4. Smart Install (Hash check)
      this.logToWs(ws, '🧠 Verificando dependencias (Smart Install)...', 'info');
      const lockPath = path.join(projectRoot, 'package-lock.json');
      const localHash = crypto.createHash('sha256').update(fs.readFileSync(lockPath)).digest('hex');

      const remoteHashResult = await ssh.execCommand(`cat ${remotePath}/.lockhash`);
      const remoteHash = remoteHashResult.stdout.trim();

      if (localHash === remoteHash) {
        this.logToWs(ws, '✅ Dependencias idénticas. Saltando npm install.', 'success');
      } else {
        this.logToWs(ws, '🔄 Cambios detectados. Sincronizando módulos en el servidor (Modo Robusto)...', 'info');

        // Registrar versiones para depuración y asegurar GIT (Paridad Usuario)
        await ssh.execCommand(`cd ${remotePath} && ${finalRemoteLoader} && node -v && npm -v && which git || echo "⚠️ Git no encontrado"`);

        const optimizeNpm = config.advanced?.optimizeNpm !== false;

        // Entorno ultra-permisivo para evitar bloqueos por motores o conflictos de pares
        // Forzamos el registro oficial para evitar errores de 'notarget' por caches locales/viejas
        const envBypass = 'export NPM_CONFIG_ENGINE_STRICT=false; export NPM_CONFIG_LEGACY_PEER_DEPS=true; export NPM_CONFIG_REGISTRY=https://registry.npmjs.org/;';

        // Nota: Usamos 'npm install' en lugar de 'ci' para mayor flexibilidad con dependencias Git y preparaciones complejas
        let npmFlags = '--omit=dev --no-audit --no-progress';
        if (optimizeNpm) npmFlags += ' --prefer-offline';

        const npmCmd = `npm install ${npmFlags}`;

        const installResult = await ssh.execCommand(`cd ${remotePath} && ${finalRemoteLoader} && ${envBypass} ${npmCmd}`);
        if (installResult.code !== 0) {
          this.logToWs(ws, `⚠️ Advertencia en npm install: ${installResult.stderr}`, 'error');
          // Si el error persiste, intentamos una limpieza profunda (Nuclear)
          this.logToWs(ws, '🔄 Reintentando con limpieza de node_modules (Modo Nuclear)...', 'info');
          await ssh.execCommand(`cd ${remotePath} && rm -rf node_modules package-lock.json && ${finalRemoteLoader} && ${envBypass} npm install ${npmFlags}`);
        }

        // Paridad Python: Reconstrucción inteligente con fallbacks
        this.logToWs(ws, '🔨 Reconstruyendo módulos nativos en el servidor...', 'info');
        const rebuildCmd = `${envBypass} (npm rebuild --update-binary || npm rebuild --build-from-source || echo '⚠️ Advertencia en rebuild')`;
        await ssh.execCommand(`cd ${remotePath} && ${finalRemoteLoader} && ${rebuildCmd}`);

        await ssh.execCommand(`echo "${localHash}" > ${remotePath}/.lockhash`);
      }

      // 5. Entorno y Reinicio
      this.logToWs(ws, '📝 Configurando variables de entorno...', 'info');
      let envContent = `PORT=${config.env.PORT || 3000}\n`;
      for (const [key, val] of Object.entries(config.env || {})) {
        if (key !== 'PORT') envContent += `${key}=${val}\n`;
      }
      const remoteEnvPath = path.join(remotePath, '.env');
      await ssh.execCommand(`echo "${envContent}" > ${remoteEnvPath}`);

      const usePm2 = config.advanced?.usePm2 !== false;
      const processes = Array.isArray(config.processes)
        ? config.processes
        : (config.processes ? Object.entries(config.processes).map(([k, v]) => ({ name: k, ...v })) : []);

      if (processes.length > 0) {
        for (const proc of processes) {
          this.logToWs(ws, `🚀 Gestionando proceso: ${proc.name || 'app'}...`, 'info');

          let finalCmd = proc.command;

          // Lógica inteligente para PM2 (Paridad Python + Mejoras)
          if (usePm2 && proc.command.includes('pm2')) {
            let pm2Identifier = proc.name || 'app';

            // Regex robusta para capturar el nombre después de --name, manejando espacios y comillas
            const nameMatch = proc.command.match(/--name\s+["']?([^"'\s]+)["']?/);
            if (nameMatch) {
              pm2Identifier = nameMatch[1];
            }

            // 'pm2 reload' es ideal porque:
            // 1. Si el proceso existe, aplica los nuevos cambios de código y variables (--update-env)
            // 2. Si NO existe (||), ejecuta el comando completo del usuario (que puede ser compuesto)
            finalCmd = `pm2 reload ${pm2Identifier} --update-env || (${proc.command})`;
          }

          const result = await ssh.execCommand(`cd ${remotePath} && ${finalRemoteLoader} && ${finalCmd}`);
          if (result.stdout) this.logToWs(ws, result.stdout);
          if (result.stderr) this.logToWs(ws, result.stderr, 'info');
        }
      } else if (!usePm2) {
        this.logToWs(ws, '🚀 Iniciando aplicación con Node (Legacy Mode)...', 'info');
        const nodeCmd = `${finalRemoteLoader} && nohup node ${outputDir}/server/index.mjs > app.log 2>&1 &`;
        const nodeRes = await ssh.execCommand(`cd ${remotePath} && ${nodeCmd}`);
        if (nodeRes.stdout) this.logToWs(ws, nodeRes.stdout);
        if (nodeRes.stderr) this.logToWs(ws, nodeRes.stderr, 'info');
      }

      this.logToWs(ws, '✅ ¡Despliegue completado con éxito!', 'success');

      // Calcular y enviar URL final
      const deployedUrl = `http://${config.server.host}:${config.env.PORT || 3000}`;
      this.logToWs(ws, `🔗 URL de la aplicación: ${deployedUrl}`, 'success');

      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'deploy_success', url: deployedUrl }));
      }

      // 6. Post-Deploy Commands (Remotos)
      if (config.deploy?.postDeploy && config.deploy.postDeploy.length > 0) {
        this.logToWs(ws, '🏃 Ejecutando comandos Post-Deploy en el servidor...', 'info');
        for (const cmd of config.deploy.postDeploy) {
          this.logToWs(ws, `> ${cmd}`, 'info');
          const postResult = await ssh.execCommand(`cd ${remotePath} && ${fullRemoteLoader} && ${cmd}`);
          if (postResult.stdout) this.logToWs(ws, postResult.stdout);
          if (postResult.stderr) this.logToWs(ws, postResult.stderr, 'info');
        }
      }

      ssh.dispose();

    } catch (err) {
      this.logToWs(ws, `❌ Error en el proceso: ${err.message}`, 'error');
      throw err;
    }
  }

  runCommand(command, cwd, ws) {
    return new Promise((resolve, reject) => {
      const isUnix = process.platform !== 'win32';
      let spawnCmd = command;
      let spawnArgs = [];
      let spawnOpts = { cwd, shell: true };

      if (isUnix) {
        const shell = process.env.SHELL || '/bin/zsh';
        spawnCmd = shell;

        // Cargador hiper-robusto de perfiles y NVM
        const loaders = [
          '[ -f ~/.zshrc ] && . ~/.zshrc',
          '[ -f ~/.bashrc ] && . ~/.bashrc',
          '[ -f ~/.profile ] && . ~/.profile',
          '[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"',
          '[ -s "/usr/local/opt/nvm/nvm.sh" ] && . "/usr/local/opt/nvm/nvm.sh"',
          '[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && . "/opt/homebrew/opt/nvm/nvm.sh"'
        ].join('; ');

        // Asegurar que node_modules/.bin esté en el PATH para el comando actual
        const localBin = 'export PATH="./node_modules/.bin:$PATH"';

        const fullCmd = `${loaders}; ${localBin}; ${command}`;
        spawnArgs = ['-c', fullCmd]; // Eliminamos -l para evitar resets de PATH por el sistema
        spawnOpts = { cwd, env: process.env };
      }

      const p = spawn(spawnCmd, spawnArgs, spawnOpts);

      p.stdout.on('data', (data) => {
        const line = data.toString().trim();
        if (line) this.logToWs(ws, line);
      });
      p.stderr.on('data', (data) => {
        const line = data.toString().trim();
        if (line) this.logToWs(ws, line, 'info');
      });

      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Comando '${command}' falló con código ${code}`));
      });
    });
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
