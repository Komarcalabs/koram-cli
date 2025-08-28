const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const glob = require('glob');
const Table = require('cli-table3');
const chalk = require('chalk');

class ProjectsListCommand extends Command {
  async run() {
    const { flags } = this.parse(ProjectsListCommand);
    const baseDir = flags.dir || process.cwd(); // Directorio donde buscar

    // Patrones de exclusión
    const ignoreDirs = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];

    // Buscar recursivamente todos los .koram-rc incluyendo entornos (.development, .staging, etc)
    const pattern = path.join(baseDir, '**/.koram-rc*.json');
    const files = glob.sync(pattern, { nodir: true, ignore: ignoreDirs });

    if (files.length === 0) {
      this.log('❌ No se encontraron archivos .koram-rc.');
      return;
    }

    // Agrupar por carpeta
    const projects = {};
    files.forEach(file => {
      const dir = path.dirname(file);
      if (!projects[dir]) projects[dir] = [];
      projects[dir].push(file);
    });

    this.log(`🔍 Se encontraron ${Object.keys(projects).length} proyecto(s):\n`);

    for (const [dir, rcFiles] of Object.entries(projects)) {
      this.log(chalk.green(`📂 Proyecto en carpeta local: ${dir}`));

      // Tabla para cada proyecto
      const table = new Table({
        head: ['App Name', 'Host', 'Remote Path', 'Env', 'Port', 'RC File'],
        style: { head: ['cyan'], border: [] },
        wordWrap: true,
        colWidths: [20, 18, 45, 25, 15, 55]
      });

      for (const file of rcFiles) {
        try {
          const content = fs.readFileSync(file, 'utf-8');
          const config = JSON.parse(content);

          const environment = config.environment || path.basename(file).replace('.koram-rc', '');
          const host = config.server?.host || '-';
          const remotePath = config.deploy?.path || '-';
          const appCommand = config.processes?.app?.command || '-';

          // Extraer appname de la cadena pm2 start ... --name appname
          let appname = '-';
          const match = /--name\s+([^\s]+)/.exec(appCommand);
          if (match) appname = match[1];

          const port = config.env?.PORT || '-';
          // const preDeploy = config.deploy?.preDeploy?.join(' && ') || '-';
          // const postDeploy = config.deploy?.postDeploy?.join(' && ') || '-';

          table.push([appname, host, remotePath, environment, port, file]);
        } catch (err) {
          this.log(chalk.red(`❌ Error leyendo ${file}: ${err.message}`));
        }
      }

      this.log(table.toString());
      this.log(''); // Línea vacía entre proyectos
    }
  }
}

ProjectsListCommand.description = `Lista todos los proyectos Koram en un directorio.
Agrupa múltiples archivos .koram-rc por carpeta y muestra la información de cada app.
Ignora node_modules, .git, dist y build para mejorar la velocidad.
`;

ProjectsListCommand.flags = {
  dir: flags.string({ char: 'd', description: 'Directorio base donde buscar proyectos' }),
};

module.exports = ProjectsListCommand;
