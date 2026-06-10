const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const open = require('open');
const glob = require('glob');
const detect = require('detect-port').default;
const chalk = require('chalk');
const NuxtExecutor = require('./nuxt-executor');

class NuxtDashboard {
  constructor({ projectRoot, initialRC, aliasCreds, flags }) {
    this.projectRoot = projectRoot;
    this.initialRC = initialRC;
    this.aliasCreds = aliasCreds;
    this.flags = flags;
    this.isBusy = false;
  }

  async start() {
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });

    app.use(express.static(path.join(__dirname, '../../deployer-dashboard')));

    wss.on('connection', async (ws) => {
      console.log(chalk.cyan('✨ Dashboard conectado.'));

      const configs = glob.sync(path.join(this.projectRoot, '.koram-rc.*.json')).map(f => path.basename(f));
      let envFiles = glob.sync(path.join(this.projectRoot, '.env.*')).map(f => path.basename(f));

      if (envFiles.length === 0) {
        envFiles = ['.env.production'];
      }

      let preSelected = this.initialRC || (configs.length > 0 ? configs[0] : null);

      ws.send(JSON.stringify({
        type: 'configs',
        items: configs,
        selected: preSelected,
        envs: envFiles
      }));

      if (preSelected) {
        const configPath = path.join(this.projectRoot, preSelected);
        if (fs.existsSync(configPath)) {
          let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

          if (this.aliasCreds) {
            if (!config.server) config.server = {};
            config.server.host = this.aliasCreds.host || config.server.host;
            config.server.user = this.aliasCreds.user || config.server.user;
            config.server.password = this.aliasCreds.password || config.server.password;
          }

          if (this.flags.host) { if (!config.server) config.server = {}; config.server.host = this.flags.host; }
          if (this.flags.user) { if (!config.server) config.server = {}; config.server.user = this.flags.user; }
          if (this.flags.path) { if (!config.deploy) config.deploy = {}; config.deploy.path = this.flags.path; }

          ws.send(JSON.stringify({ type: 'config_data', data: config }));
        }
      }

      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message);

          if (data.type === 'load_config') {
            const configPath = path.join(this.projectRoot, data.name);
            if (fs.existsSync(configPath)) {
              const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
              ws.send(JSON.stringify({ type: 'config_data', data: config }));
            }
          }

          if (data.type === 'save_config') {
            const configPath = path.join(this.projectRoot, data.name);
            const currentConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};

            const serverData = { ...data.data.server };
            delete serverData.password;
            delete serverData.password_plain;

            const updated = {
              ...currentConfig,
              name: data.data.name || currentConfig.name,
              packageManager: data.data.packageManager || currentConfig.packageManager || 'npm',
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

          if (data.type === 'start_deploy' && !this.isBusy) {
            this.isBusy = true;
            this.broadcast(wss, { type: 'status', busy: true });

            try {
              const configPath = path.join(this.projectRoot, data.name);
              const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

              const executor = new NuxtExecutor((msg, level) => {
                this.logToWs(ws, msg, level);
              });

              await executor.executeDeployment(config, this.projectRoot, (deployedUrl) => {
                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: 'deploy_success', url: deployedUrl }));
                }
              });

            } catch (err) {
              this.logToWs(ws, `❌ Error crítico: ${err.message}`, 'error');
            } finally {
              this.isBusy = false;
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
}

module.exports = NuxtDashboard;
