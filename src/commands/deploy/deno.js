// src/commands/infra-deploy.js
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const { NodeSSH } = require('node-ssh');
const ignore = require('ignore');
const { selectKoramConfig, getCredentialByKey } = require('../../utils/index');

class InfraDeployCommand extends Command {
  async run() {
    const { flags } = this.parse(InfraDeployCommand);
    const projectRoot = process.cwd();
    const rcPath = await selectKoramConfig(projectRoot, flags.env || 'production');

    if (!rcPath) {
      this.error('❌ No se encontró archivo de configuración .koram-rc.<env>.json');
      return;
    }

    const configFile = JSON.parse(fs.readFileSync(rcPath, 'utf-8'));
    const { server, deploy, processes, env } = configFile;

    if (!server || !deploy) {
      this.error('❌ El archivo de configuración debe contener bloques "server" y "deploy"');
      return;
    }

    // 🔍 Leer credenciales
    let credentials = await getCredentialByKey(null, server.user, server.host);

    // 📋 Cargar reglas de .koramignore
    const koramignorePath = path.join(projectRoot, '.koramignore');
    let ig = ignore();
    if (fs.existsSync(koramignorePath)) {
      const koramignoreContent = fs.readFileSync(koramignorePath, 'utf-8');
      ig = ignore().add(koramignoreContent.split('\n'));
      this.log(`📄 Usando reglas de exclusión de .koramignore`);
    }

    // 🔌 Conectar vía SSH
    const ssh = new NodeSSH();
    this.log(`🔌 Conectando a ${server.user}@${server.host}...`);
    await ssh.connect({
      host: server.host,
      username: server.user,
      port: server.port || 22,
      password: credentials.password,
      privateKey: server.sshKey ? fs.readFileSync(server.sshKey.replace('~', process.env.HOME)) : undefined,
    });

    this.log('📂 Creando directorio de deploy...');
    await ssh.execCommand(`mkdir -p ${deploy.path}`);

    // 🚀 Clonar repo o copiar archivos
    if (deploy.repository) {
      this.log(`⬇️ Clonando repo ${deploy.repository}...`);
      await ssh.execCommand(
        `cd ${deploy.path} && git clone -b ${deploy.branch || 'main'} ${deploy.repository} . || (cd ${deploy.path} && git pull)`
      );
    } else {
      this.log('📤 Subiendo archivos locales...');
      await ssh.putDirectory(projectRoot, deploy.path, {
        recursive: true,
        concurrency: 5,
        validate: (itemPath) => {
          const relPath = path.relative(projectRoot, itemPath);
          if (!relPath) return true; // siempre incluir root
          return !ig.ignores(relPath);
        },
      });
    }

    // ⚙️ Pre-deploy
    if (deploy.preDeploy?.length) {
      this.log('⚙️ Ejecutando preDeploy...');
      for (const cmd of deploy.preDeploy) {
        this.log(`→ ${cmd}`);
        await ssh.execCommand(cmd, { cwd: deploy.path });
      }
    }

    // 🌍 Variables de entorno (env)
    if (env) {
      this.log('📝 Generando archivo .env remoto...');
      const envContent = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
      await ssh.execCommand(`echo "${envContent}" > ${deploy.path}/.env`);
    }

    // 🚀 Post-deploy
    if (deploy.postDeploy?.length) {
      this.log('⚙️ Ejecutando postDeploy...');
      for (const cmd of deploy.postDeploy) {
        this.log(`→ ${cmd}`);
        await ssh.execCommand(cmd, { cwd: deploy.path });
      }
    }

    // 🔄 Procesos (ejemplo Deno o PM2)
    if (processes) {
      this.log('🔄 Levantando procesos...');
      const procList = Array.isArray(processes)
        ? processes
        : Object.entries(processes).map(([k, v]) => ({ name: k, ...v }));

      for (const proc of procList) {
        this.log(`→ ${proc.name || 'cmd'}: ${proc.command}`);
        await ssh.execCommand(proc.command, { cwd: deploy.path });
      }
    }

    ssh.dispose();
    this.log('✅ Deploy finalizado con éxito 🚀');
  }
}

InfraDeployCommand.description = `Realiza deploy de la aplicación según .koram-rc.<env>.json
- Crea directorio remoto
- Sube repo o archivos (respetando .koramignore)
- Ejecuta preDeploy y postDeploy
- Levanta procesos definidos
`;

InfraDeployCommand.flags = {
  env: flags.string({ char: 'e', description: 'Entorno a usar (production, staging, etc)', default: 'production' }),
};

module.exports = InfraDeployCommand;
