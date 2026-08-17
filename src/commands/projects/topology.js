const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const glob = require('glob');
const chalk = require('chalk');

class ProjectsTopologyCommand extends Command {
  async run() {
    const { flags } = this.parse(ProjectsTopologyCommand);
    const baseDir = flags.dir || process.cwd();

    // 1. Encontrar todos los .koram-rc.*.json
    const ignoreDirs = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];
    const rcFiles = glob.sync(path.join(baseDir, '**/.koram-rc*.json'), { nodir: true, ignore: ignoreDirs });

    if (rcFiles.length === 0) {
      this.log(chalk.red('❌ No se encontraron archivos de configuración .koram-rc para analizar.'));
      return;
    }

    const apps = [];
    const pathMap = {};

    // Cargar apps
    rcFiles.forEach(file => {
      try {
        const config = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const env = path.basename(file).replace('.koram-rc.', '').replace('.json', '');
        const host = config.server?.host || '-';
        const remotePath = config.deploy?.path || '';
        const type = config.type || 'spa';

        const appObj = {
          name: config.name || path.basename(file, '.json'),
          type,
          host,
          remotePath,
          env,
          file
        };
        apps.push(appObj);

        if (remotePath) {
          const cleanPath = remotePath.replace(/\/+$/, '');
          pathMap[cleanPath] = appObj;
        }
      } catch (err) { }
    });

    // 2. Encontrar todos los archivos .conf de Nginx
    const confFiles = glob.sync(path.join(baseDir, '**/.koram/webserver/*.conf'), { nodir: true, ignore: ignoreDirs });

    const gateways = {};

    confFiles.forEach(file => {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        
        let serverNames = [];
        let locations = [];
        let isSsl = content.includes('listen 443') || content.includes('ssl');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith('server_name')) {
            const match = /server_name\s+([^;]+);/.exec(line);
            if (match) {
              serverNames = match[1].split(/\s+/).map(s => s.trim()).filter(Boolean);
            }
          }
          if (line.startsWith('location')) {
            const match = /location\s+([^\s{]+)/.exec(line);
            if (match) {
              const locPath = match[1].trim();
              let alias = null;
              let proxyPass = null;
              let j = i + 1;
              let openBraces = 1;

              while (j < lines.length && openBraces > 0) {
                const subLine = lines[j].trim();
                if (subLine.includes('{')) openBraces++;
                if (subLine.includes('}')) openBraces--;

                if (subLine.startsWith('alias')) {
                  const m = /alias\s+([^;]+);/.exec(subLine);
                  if (m) alias = m[1].trim();
                }
                if (subLine.startsWith('root')) {
                  const m = /root\s+([^;]+);/.exec(subLine);
                  if (m) alias = m[1].trim();
                }
                if (subLine.startsWith('proxy_pass')) {
                  const m = /proxy_pass\s+([^;]+);/.exec(subLine);
                  if (m) proxyPass = m[1].trim();
                }
                j++;
              }
              locations.push({ path: locPath, alias, proxyPass });
            }
          }
        }

        serverNames.forEach(name => {
          if (!gateways[name]) gateways[name] = [];
          gateways[name].push({ file, locations, isSsl });
        });
      } catch (err) { }
    });

    // Group apps by host
    const hostsMap = {};
    apps.forEach(app => {
      if (!hostsMap[app.host]) hostsMap[app.host] = { apps: [], gateways: [] };
      hostsMap[app.host].apps.push(app);
    });

    // Mapear gateways a hosts
    Object.entries(gateways).forEach(([domain, instances]) => {
      instances.forEach(inst => {
        // Encontrar qué app/rc es dueña de este conf para saber el host
        const dir = path.dirname(path.dirname(path.dirname(inst.file)));
        const ownerApp = apps.find(app => path.dirname(app.file) === dir);
        const host = ownerApp ? ownerApp.host : 'Desconocido';
        if (hostsMap[host]) {
          hostsMap[host].gateways.push({ domain, ...inst });
        }
      });
    });

    // 3. Imprimir Topología
    this.log(chalk.bold.cyan('\n🔍 TOPOLOGÍA DE RED Y ENRUTAMIENTO KORAM\n'));

    Object.entries(hostsMap).forEach(([host, data]) => {
      this.log(chalk.bold.yellow(`🖥️  Servidor: ${host}`));
      
      const printedApps = new Set();

      // Dibujar Gateways Nginx
      data.gateways.forEach((gw, gwIndex) => {
        const isLastGw = gwIndex === data.gateways.length - 1 && data.apps.length === printedApps.size;
        const prefix = isLastGw ? '└── ' : '├── ';
        const protocol = gw.isSsl ? 'https://' : 'http://';
        this.log(`${prefix}🌐 Nginx Gateway: ${chalk.green(protocol + gw.domain)}`);

        gw.locations.forEach((loc, locIndex) => {
          const locPrefix = gwIndex === data.gateways.length - 1 && locIndex === gw.locations.length - 1 ? '    └── ' : '    ├── ';
          let destination = '';

          if (loc.alias) {
            const cleanAlias = loc.alias.replace(/\/+$/, '').replace(/\/current$/, '');
            const targetApp = pathMap[cleanAlias];
            if (targetApp) {
              destination = `${chalk.bold(targetApp.name)} (SPA) [${chalk.dim(loc.alias)}]`;
              printedApps.add(targetApp.name);
            } else {
              destination = `Ruta Estática [${chalk.dim(loc.alias)}]`;
            }
          } else if (loc.proxyPass) {
            // Buscar si coincide con alguna app tipo pm2/ssr
            const portMatch = /:(\d+)/.exec(loc.proxyPass);
            let targetApp = null;
            if (portMatch) {
              const port = portMatch[1];
              targetApp = apps.find(app => app.env?.PORT == port || app.name.includes('back') || app.name.includes('backend'));
            }
            if (targetApp) {
              destination = `${chalk.bold(targetApp.name)} (Backend/PM2) [${chalk.dim(loc.proxyPass)}]`;
              printedApps.add(targetApp.name);
            } else {
              destination = `Proxy Reverso [${chalk.dim(loc.proxyPass)}]`;
            }
          }

          this.log(`${locPrefix}📍 Subruta ${chalk.cyan(loc.path)} ──> ${destination}`);
        });
      });

      // Dibujar aplicaciones sueltas/no enrutadas por gateway
      const remainingApps = data.apps.filter(app => !printedApps.has(app.name));
      remainingApps.forEach((app, index) => {
        const isLast = index === remainingApps.length - 1;
        const prefix = isLast ? '└── ' : '├── ';
        this.log(`${prefix}📦 App Independiente: ${chalk.bold(app.name)} (${app.type}) [${chalk.dim(app.remotePath)}]`);
      });
      this.log('');
    });
  }
}

ProjectsTopologyCommand.description = `Muestra el mapa de topología de red y enrutamiento Nginx de tus aplicaciones.
Escanea configuraciones y plantillas de servidores web locales para mostrar cómo se relacionan.`;

ProjectsTopologyCommand.flags = {
  dir: flags.string({ char: 'd', description: 'Directorio base para buscar topología' }),
};

module.exports = ProjectsTopologyCommand;
