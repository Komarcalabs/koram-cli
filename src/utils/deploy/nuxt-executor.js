const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { NodeSSH } = require('node-ssh');
const crypto = require('crypto');
const chalk = require('chalk');
const { getCredentialByKey } = require('../index');

const KNOWN_NATIVE_PACKAGES = [
  'sqlite3',
  'better-sqlite3',
  'sharp',
  'bcrypt',
  'canvas',
  'argon2',
  '@prisma/client',
  'fsevents',
  'node-sass',
  'isolated-vm'
];

function getNativePackagesToRebuild(pkgJsonContent, configuredRebuild) {
  if (Array.isArray(configuredRebuild)) {
    return configuredRebuild;
  }
  let declaredDeps = {};
  if (typeof pkgJsonContent === 'object' && pkgJsonContent !== null) {
    declaredDeps = { ...(pkgJsonContent.dependencies || {}), ...(pkgJsonContent.devDependencies || {}) };
  } else if (typeof pkgJsonContent === 'string') {
    try {
      const parsed = JSON.parse(pkgJsonContent);
      declaredDeps = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
    } catch (e) { }
  }

  const detected = KNOWN_NATIVE_PACKAGES.filter(pkg => declaredDeps[pkg] !== undefined);
  if (configuredRebuild === true && detected.length === 0) {
    return ['--all'];
  }
  return detected;
}

class NuxtExecutor {
  constructor(logFn) {
    this.log = logFn;
  }

  async executeDeployment(config, projectRoot, onDeploySuccess, flags = {}) {
    const nvmLoaders = '[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; [ -s "/usr/local/opt/nvm/nvm.sh" ] && . "/usr/local/opt/nvm/nvm.sh"; [ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && . "/opt/homebrew/opt/nvm/nvm.sh"';
    let nodeVerCmd = '';
    if (config.advanced?.nodeVersion) {
      nodeVerCmd = `nvm use ${config.advanced.nodeVersion} >/dev/null 2>&1 || true; `;
    }
    const remoteShellLoader = `export PATH=$PATH:/usr/local/bin:/usr/bin:/bin; ${nvmLoaders}; ${nodeVerCmd}[ -f ~/.profile ] && . ~/.profile; [ -f ~/.bashrc ] && . ~/.bashrc; [ -f ~/.zshrc ] && . ~/.zshrc`;

    const envVars = Object.entries(config.env || {}).map(([k, v]) => `export ${k}="${v}"`).join('; ');
    const fullRemoteLoader = `${remoteShellLoader}; ${envVars}`;

    const packageManager = config.packageManager || 'npm';
    const lockFile = packageManager === 'pnpm' ? 'pnpm-lock.yaml' : 'package-lock.json';

    // --- PARALELIZACIÓN SSH ---
    let vaultPassword = config.server.password_plain || config.server.password;
    if (!vaultPassword) {
      try {
        const creds = await getCredentialByKey(null, config.server.user, config.server.host);
        if (creds && creds.password) vaultPassword = creds.password;
      } catch (e) { }
    }

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
        this.log(`📦 Ejecutando ${packageManager} install local...`, "info");
        fullBuildCmd += `${packageManager} install && `;
      }

      const buildCmd = config.deploy?.buildCommand || `${packageManager} run build`;
      fullBuildCmd += `NODE_ENV=${envName} ${buildCmd}`;

      this.log(`🔨 Ejecutando construcción local (${envName})...`, "info");
      await this.runCommand(fullBuildCmd, projectRoot);

      const outputDir = fs.existsSync('.output') ? '.output' : '.nuxt';
      if (!fs.existsSync(outputDir)) {
        throw new Error(`No se encontró el directorio de salida (${outputDir}). ¿Ejecutaste el build correctamente?`);
      }

      const bundledModules = path.join(projectRoot, outputDir, 'server', 'node_modules');
      if (fs.existsSync(bundledModules)) {
        this.log('🧹 Limpiando módulos nativos locales de .output...', 'info');
        execSync(`rm -rf "${bundledModules}"`, { cwd: projectRoot });
      }

      // --- ESPERAR SSH ---
      this.log('⏳ Esperando estabilización de conexión SSH...', 'info');
      const ssh = await sshPromise;
      this.log('✅ Conexión SSH establecida paralelamente.', 'success');

      // --- LIMPIEZA REMOTA ---
      this.log('🧹 Limpiando directorios de construcción remotos...', 'info');
      const cleanupCmd = `mkdir -p ${config.deploy.path} && cd ${config.deploy.path} && rm -rf .output .nuxt .cache`;
      await ssh.execCommand(cleanupCmd);

      // --- ESTRATEGIA DE TRANSFERENCIA ULTRA-RÁPIDA ---
      const remotePath = config.deploy.path;
      const hasRsync = execSync('which rsync || true').toString().trim() !== '';
      const hasSshPass = execSync('which sshpass || true').toString().trim() !== '';

      const potentialFiles = [outputDir, 'package.json', lockFile, 'public', 'static', 'ecosystem.config.js'];
      const filesToDeploy = potentialFiles.filter(f => fs.existsSync(path.join(projectRoot, f)));

      let useRsync = hasRsync;
      const hasPassword = !!vaultPassword;
      if (hasPassword && !hasSshPass) {
        useRsync = false;
        this.log('⚠️ Rsync requiere "sshpass" para autenticación por password. Usando Tar (Legacy).', 'info');
      }

      if (useRsync) {
        this.log('⚡ Iniciando transferencia Delta (Rsync)...', 'info');
        const rsyncTarget = `${config.server.user}@${config.server.host}:${remotePath}/`;

        await ssh.execCommand(`mkdir -p ${remotePath}`);

        let rsyncBase = `rsync -az --delete --no-perms --no-owner --no-group -e "ssh -p ${config.server.port || 22} -o StrictHostKeyChecking=no"`;
        const rsyncEnv = { ...process.env };

        if (hasPassword) {
          rsyncBase = `sshpass -e ${rsyncBase}`;
          rsyncEnv.SSHPASS = vaultPassword;
        }

        for (const file of filesToDeploy) {
          this.log(`⬆️ Sincronizando ${file}...`, 'info');
          try {
            const src = fs.statSync(file).isDirectory() ? `${file}/` : file;
            const dest = fs.statSync(file).isDirectory() ? `${rsyncTarget}${file}/` : rsyncTarget;
            if (fs.statSync(file).isDirectory()) await ssh.execCommand(`mkdir -p ${remotePath}/${file}`);

            execSync(`${rsyncBase} ${src} ${dest}`, { cwd: projectRoot, env: rsyncEnv });
          } catch (e) {
            this.log(`⚠️ Fallo rsync en ${file}: ${e.message}`, 'error');
          }
        }
      } else {
        // --- FALLBACK TAR (OPTIMIZADO) ---
        this.log('📦 Preparando paquete de despliegue (Compresión Rápida)...', 'info');
        const tarFile = `deploy-${Date.now()}.tar.gz`;
        const filesString = filesToDeploy.join(' ');

        try {
          execSync(`tar --no-xattrs --dereference -cf - ${filesString} | gzip -1 > ${tarFile}`, { cwd: projectRoot, shell: true });
        } catch (e) {
          throw new Error('Error al crear el archivo comprimido. Asegúrate de tener "tar" y "gzip" instalados.');
        }

        this.log(`⬆️ Subiendo archivos a ${remotePath}...`, 'info');
        await ssh.execCommand(`mkdir -p ${remotePath}`);
        await ssh.putFile(path.join(projectRoot, tarFile), path.join(remotePath, tarFile));

        this.log('📂 Extrayendo archivos en el servidor...', 'info');
        const extractResult = await ssh.execCommand(`cd ${remotePath} && rm -rf ${outputDir} .nuxt && tar -xzf ${tarFile} && rm ${tarFile}`);
        if (extractResult.stdout) this.log(extractResult.stdout);
        if (extractResult.stderr) this.log(extractResult.stderr, 'info');

        fs.unlinkSync(path.join(projectRoot, tarFile));
      }

      // --- CONTEXTO DE DESPLIEGUE (Pre-Deploy) ---
      const preDeployCmds = (config.deploy?.preDeploy || []).join(' && ');
      const finalRemoteLoader = preDeployCmds
        ? `${fullRemoteLoader} && ${preDeployCmds}`
        : fullRemoteLoader;

      if (preDeployCmds) {
        this.log('🏃 Ejecutando y preparando contexto Pre-Deploy...', 'info');
        this.log(`> ${preDeployCmds}`, 'info');
        const preCheck = await ssh.execCommand(`cd ${remotePath} && ${finalRemoteLoader} && echo "Pre-deploy OK"`);
        if (preCheck.code !== 0) {
          this.log(`⚠️ Advertencia en Pre-Deploy: ${preCheck.stderr}`, 'error');
        }
      }

      // 4. Smart Install (.output/server & Root)
      const serverPkgPath = path.join(projectRoot, outputDir, 'server', 'package.json');
      const hasServerPkg = fs.existsSync(serverPkgPath);
      const shouldServerInstall = config.advanced?.serverInstall !== false && hasServerPkg;

      if (shouldServerInstall) {
        this.log(`🧠 Verificando dependencias de servidor Nitro (${outputDir}/server)...`, 'info');
        const serverPkgRaw = fs.readFileSync(serverPkgPath, 'utf-8');
        const localServerHash = crypto.createHash('sha256').update(serverPkgRaw).digest('hex');

        const remoteServerHashResult = await ssh.execCommand(`cat ${remotePath}/${outputDir}/server/.server_lockhash 2>/dev/null || true`);
        const remoteServerHash = remoteServerHashResult.stdout.trim();

        const checkNodeModules = await ssh.execCommand(`[ -d "${remotePath}/${outputDir}/server/node_modules" ] && echo "exists" || echo "missing"`);
        const serverModulesExist = checkNodeModules.stdout.trim() === 'exists';

        if (localServerHash === remoteServerHash && serverModulesExist) {
          this.log(`✅ Dependencias de ${outputDir}/server idénticas y al día. Saltando instalación.`, 'success');
        } else {
          this.log(`🔄 Sincronizando módulos de ${outputDir}/server en el servidor...`, 'info');
          const envBypass = 'export NPM_CONFIG_ENGINE_STRICT=false; export NPM_CONFIG_LEGACY_PEER_DEPS=true; export NPM_CONFIG_REGISTRY=https://registry.npmjs.org/;';
          const serverInstallCmd = `npm install --omit=dev --no-audit --no-progress`;

          const installRes = await ssh.execCommand(`cd ${remotePath}/${outputDir}/server && ${finalRemoteLoader} && ${envBypass} ${serverInstallCmd}`);
          if (installRes.code !== 0) {
            this.log(`⚠️ Advertencia en ${outputDir}/server install: ${installRes.stderr || installRes.stdout}`, 'error');
            this.log('🔄 Reintentando con limpieza de node_modules en el servidor...', 'info');
            await ssh.execCommand(`cd ${remotePath}/${outputDir}/server && rm -rf node_modules package-lock.json && ${finalRemoteLoader} && ${envBypass} ${serverInstallCmd}`);
          }

          // Detección y reconstrucción de módulos nativos en .output/server
          const nativeToRebuild = getNativePackagesToRebuild(serverPkgRaw, config.advanced?.nativeRebuild);
          this.log(`🔨 Verificando/Reconstruyendo módulos nativos en ${outputDir}/server...`, 'info');

          let rebuildCmd = '';
          if (nativeToRebuild.length > 0 && !nativeToRebuild.includes('--all')) {
            this.log(`⚙️ Reconstruyendo binarios nativos: ${nativeToRebuild.join(', ')}...`, 'info');
            rebuildCmd = `${envBypass} (npm rebuild ${nativeToRebuild.join(' ')} --build-from-source || npm rebuild --build-from-source || echo '⚠️ Advertencia en rebuild')`;
          } else {
            rebuildCmd = `${envBypass} (npm rebuild --build-from-source || npm rebuild --update-binary || echo '⚠️ Advertencia en rebuild')`;
          }

          const rebuildRes = await ssh.execCommand(`cd ${remotePath}/${outputDir}/server && ${finalRemoteLoader} && ${rebuildCmd}`);
          if (rebuildRes.stdout) this.log(rebuildRes.stdout);
          if (rebuildRes.stderr && rebuildRes.code !== 0) this.log(rebuildRes.stderr, 'info');

          await ssh.execCommand(`echo "${localServerHash}" > ${remotePath}/${outputDir}/server/.server_lockhash`);
          this.log(`✅ Dependencias de ${outputDir}/server listas.`, 'success');
        }
      }

      // 4.1. Smart Install (Root project)
      const lockPath = path.join(projectRoot, lockFile);
      const hasRootPkg = fs.existsSync(path.join(projectRoot, 'package.json'));
      if (hasRootPkg && config.advanced?.rootInstall !== false) {
        this.log('🧠 Verificando dependencias raíz (Smart Install)...', 'info');
        const localHash = fs.existsSync(lockPath)
          ? crypto.createHash('sha256').update(fs.readFileSync(lockPath)).digest('hex')
          : crypto.createHash('sha256').update(fs.readFileSync(path.join(projectRoot, 'package.json'))).digest('hex');

        const remoteHashResult = await ssh.execCommand(`cat ${remotePath}/.lockhash 2>/dev/null || true`);
        const remoteHash = remoteHashResult.stdout.trim();

        const checkRootModules = await ssh.execCommand(`[ -d "${remotePath}/node_modules" ] && echo "exists" || echo "missing"`);
        const rootModulesExist = checkRootModules.stdout.trim() === 'exists';

        if (localHash === remoteHash && rootModulesExist) {
          this.log(`✅ Dependencias raíz idénticas. Saltando ${packageManager} install.`, 'success');
        } else {
          this.log(`🔄 Cambios detectados en raíz. Sincronizando módulos en el servidor (Modo Robusto - ${packageManager})...`, 'info');

          await ssh.execCommand(`cd ${remotePath} && ${finalRemoteLoader} && node -v && ${packageManager} -v && which git || echo "⚠️ Git no encontrado"`);

          const optimizeNpm = config.advanced?.optimizeNpm !== false;

          let envBypass = '';
          let installCmd = '';

          if (packageManager === 'pnpm') {
            envBypass = 'export PNPM_CONFIG_REGISTRY=https://registry.npmjs.org/;';
            installCmd = 'pnpm install --prod --no-frozen-lockfile';
          } else {
            envBypass = 'export NPM_CONFIG_ENGINE_STRICT=false; export NPM_CONFIG_LEGACY_PEER_DEPS=true; export NPM_CONFIG_REGISTRY=https://registry.npmjs.org/;';
            let npmFlags = '--omit=dev --no-audit --no-progress';
            if (optimizeNpm) npmFlags += ' --prefer-offline';
            installCmd = `npm install ${npmFlags}`;
          }

          const installResult = await ssh.execCommand(`cd ${remotePath} && ${finalRemoteLoader} && ${envBypass} ${installCmd}`);
          if (installResult.code !== 0) {
            this.log(`⚠️ Advertencia en ${packageManager} install: ${installResult.stderr}`, 'error');
            this.log('🔄 Reintentando con limpieza de node_modules (Modo Nuclear)...', 'info');
            await ssh.execCommand(`cd ${remotePath} && rm -rf node_modules ${lockFile} && ${finalRemoteLoader} && ${envBypass} ${installCmd}`);
          }

          let rootPkgRaw = null;
          try { rootPkgRaw = fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'); } catch (e) { }
          const rootNativeToRebuild = getNativePackagesToRebuild(rootPkgRaw, config.advanced?.nativeRebuild);

          this.log('🔨 Reconstruyendo módulos nativos en raíz del servidor...', 'info');
          let rebuildCmd = '';
          if (rootNativeToRebuild.length > 0 && !rootNativeToRebuild.includes('--all')) {
            rebuildCmd = `${envBypass} (${packageManager} rebuild ${rootNativeToRebuild.join(' ')} || npm rebuild ${rootNativeToRebuild.join(' ')} --build-from-source || ${packageManager} rebuild || echo '⚠️ Advertencia en rebuild')`;
          } else {
            rebuildCmd = `${envBypass} (${packageManager} rebuild || npm rebuild --update-binary || npm rebuild --build-from-source || echo '⚠️ Advertencia en rebuild')`;
          }
          await ssh.execCommand(`cd ${remotePath} && ${finalRemoteLoader} && ${rebuildCmd}`);

          await ssh.execCommand(`echo "${localHash}" > ${remotePath}/.lockhash`);
        }
      }

      // 5. Entorno y Reinicio
      this.log('📝 Configurando variables de entorno...', 'info');
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
          this.log(`🚀 Gestionando proceso: ${proc.name || 'app'}...`, 'info');
          let finalCmd = proc.command;

          if (usePm2 && proc.command.includes('pm2')) {
            let pm2Identifier = proc.name || 'app';
            const nameMatch = proc.command.match(/--name\s+["']?([^"'\s]+)["']?/);
            if (nameMatch) {
              pm2Identifier = nameMatch[1];
            }
            finalCmd = `pm2 reload ${pm2Identifier} --update-env || (${proc.command})`;
          }

          const result = await ssh.execCommand(`cd ${remotePath} && ${finalRemoteLoader} && ${finalCmd}`);
          if (result.stdout) this.log(result.stdout);
          if (result.stderr) this.log(result.stderr, 'info');
        }
      } else if (!usePm2) {
        this.log('🚀 Iniciando aplicación con Node (Legacy Mode)...', 'info');
        const nodeCmd = `${finalRemoteLoader} && nohup node ${outputDir}/server/index.mjs > app.log 2>&1 &`;
        const nodeRes = await ssh.execCommand(`cd ${remotePath} && ${nodeCmd}`);
        if (nodeRes.stdout) this.log(nodeRes.stdout);
        if (nodeRes.stderr) this.log(nodeRes.stderr, 'info');
      }

      this.log('✅ ¡Despliegue completado con éxito!', 'success');

      const deployedUrl = `http://${config.server.host}:${config.env.PORT || 3000}`;
      this.log(`🔗 URL de la aplicación: ${deployedUrl}`, 'success');

      if (onDeploySuccess) {
        onDeploySuccess(deployedUrl);
      }

      // 6. Post-Deploy Commands (Remotos)
      if (config.deploy?.postDeploy && config.deploy.postDeploy.length > 0) {
        this.log('🏃 Ejecutando comandos Post-Deploy en el servidor...', 'info');
        for (const cmd of config.deploy.postDeploy) {
          this.log(`> ${cmd}`, 'info');
          const postResult = await ssh.execCommand(`cd ${remotePath} && ${fullRemoteLoader} && ${cmd}`);
          if (postResult.stdout) this.log(postResult.stdout);
          if (postResult.stderr) this.log(postResult.stderr, 'info');
        }
      }

      // Sincronizar Nginx de forma opcional
      const webserverEnv = (flags.env || config.environment || 'production');
      let shouldSyncWebserver = false;
      if (flags['no-webserver']) {
        shouldSyncWebserver = false;
      } else if (flags.webserver) {
        shouldSyncWebserver = true;
      } else {
        shouldSyncWebserver = !!config.deploy?.webserver?.autoApply;
      }

      if (shouldSyncWebserver && config.webserver) {
        this.log("🔌 Sincronizando servidor web (Nginx)...", "info");
        const { syncRemoteWebserver } = require('../nginx');
        try {
          await syncRemoteWebserver(ssh, config, webserverEnv, (msg, level) => {
            this.log(msg, level === 'error' ? 'error' : (level === 'success' ? 'success' : 'info'));
          });
        } catch (webserverErr) {
          this.log(`⚠️ Advertencia en Nginx: ${webserverErr.message}`, "error");
        }
      }

      ssh.dispose();
    } catch (err) {
      this.log(`❌ Error en el proceso: ${err.message}`, 'error');
      throw err;
    }
  }

  runCommand(command, cwd) {
    return new Promise((resolve, reject) => {
      const isUnix = process.platform !== 'win32';
      let spawnCmd = command;
      let spawnArgs = [];
      let spawnOpts = { cwd, shell: true };

      if (isUnix) {
        const shell = process.env.SHELL || '/bin/zsh';
        spawnCmd = shell;

        const loaders = [
          '[ -f ~/.zshrc ] && . ~/.zshrc',
          '[ -f ~/.bashrc ] && . ~/.bashrc',
          '[ -f ~/.profile ] && . ~/.profile',
          '[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"',
          '[ -s "/usr/local/opt/nvm/nvm.sh" ] && . "/usr/local/opt/nvm/nvm.sh"',
          '[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && . "/opt/homebrew/opt/nvm/nvm.sh"'
        ].join('; ');

        const localBin = 'export PATH="./node_modules/.bin:$PATH"';
        const fullCmd = `${loaders}; ${localBin}; ${command}`;
        spawnArgs = ['-c', fullCmd];
        spawnOpts = { cwd, env: process.env };
      }

      const p = spawn(spawnCmd, spawnArgs, spawnOpts);

      p.stdout.on('data', (data) => {
        const line = data.toString().trim();
        if (line) this.log(line);
      });
      p.stderr.on('data', (data) => {
        const line = data.toString().trim();
        if (line) this.log(line, 'info');
      });

      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Comando '${command}' falló con código ${code}`));
      });
    });
  }
}

module.exports = NuxtExecutor;
module.exports.NuxtExecutor = NuxtExecutor;
module.exports.getNativePackagesToRebuild = getNativePackagesToRebuild;
module.exports.KNOWN_NATIVE_PACKAGES = KNOWN_NATIVE_PACKAGES;
