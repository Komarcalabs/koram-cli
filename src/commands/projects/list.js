const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const glob = require('glob');

class ProjectsListCommand extends Command {
  async run() {
    const { flags } = this.parse(ProjectsListCommand);

    const baseDir = flags.dir || process.cwd(); // Directorio donde buscar

    // Patrones de exclusión
    const ignoreDirs = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];

    // Buscar recursivamente todos los .koram-rc incluyendo entornos (.development, .staging, etc)
    const pattern = path.join(baseDir, '**/.koram-rc*');

    const files = glob.sync(pattern, { nodir: true, ignore: ignoreDirs });

    if (files.length === 0) {
      this.log('❌ No se encontraron archivos .koram-rc.');
      return;
    }

    // Agrupar por carpeta para identificar un proyecto
    const projects = {};
    files.forEach(file => {
      const dir = path.dirname(file);
      if (!projects[dir]) projects[dir] = [];
      projects[dir].push(file);
    });

    this.log(`🔍 Se encontraron ${Object.keys(projects).length} proyecto(s):\n`);

    for (const [dir, rcFiles] of Object.entries(projects)) {
      this.log(`📂 Carpeta: ${dir}`);
      for (const file of rcFiles) {
        try {
          const content = fs.readFileSync(file, 'utf-8');
          const config = JSON.parse(content);

          const name = config.app_name || 'sin-nombre';
          const host = config.host || '-';
          const remotePath = config.remote_path || '-';
          const buildEnv = config.build_env || path.basename(file).replace('.koram-rc', '') || '-';

          this.log(`  • ${name}`);
          this.log(`    Host: ${host}`);
          this.log(`    Remote Path: ${remotePath}`);
          this.log(`    Build Env: ${buildEnv}`);
          this.log(`    Path: ${file}`);
        } catch (err) {
          this.log(`❌ Error leyendo ${file}: ${err.message}`);
        }
      }
      this.log(''); // línea vacía entre proyectos
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
