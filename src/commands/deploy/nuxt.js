const { Command, flags } = require('@oclif/command');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class DeployCommand extends Command {
  async run() {
    const { flags } = this.parse(DeployCommand);

    const cliRootPath = path.resolve(__dirname, '../../../');
    const venvPythonPath = path.join(cliRootPath, 'venv/bin/python3');
    if (!fs.existsSync(venvPythonPath)) {
      this.error('El entorno virtual de Python no se encontró. Asegúrate de haber ejecutado `npm install`.');
      return;
    }

    const deployerPath = path.join(cliRootPath, 'src/python-deployer/main.py');

    // Leer configuración del proyecto
    const projectRoot = process.cwd();
    const rcPath = path.join(projectRoot, '.koram-rc');
    let config = {};
    if (fs.existsSync(rcPath)) {
      config = JSON.parse(fs.readFileSync(rcPath, 'utf-8'));
    }

    // Sobrescribir con flags
    const host = flags.host || config.host || '';
    const user = flags.user || config.user || '';
    const remotePath = flags.path || config.remote_path || '';
    const appName = config.app_name || '';

    // Ejecutar Python con variables de entorno
    const pyProcess = spawn(venvPythonPath, [deployerPath], {
      shell: true,
      env: { 
        ...process.env, 
        HOST: host, 
        USER: user, 
        REMOTE_PATH: remotePath, 
        APP_NAME: appName,
        RC_PATH: rcPath // Pasamos la ruta del .koram-rc
      }
    });

    pyProcess.stdout.on('data', (data) => process.stdout.write(data.toString()));
    pyProcess.stderr.on('data', (data) => process.stderr.write(data.toString()));
    pyProcess.on('close', (code) => {
      if (code === 0) console.log('\n✅ Deploy completado con éxito.');
      else console.log(`\n❌ Deploy finalizó con código ${code}`);
    });
  }
}

DeployCommand.description = `Lanza el deployer Python para Nuxt
Este comando ejecuta el flujo de construcción, empaquetado, subida y reinicio de la app en el servidor.
`;

DeployCommand.flags = {
  host: flags.string({ char: 'h', description: 'Host del servidor' }),
  user: flags.string({ char: 'u', description: 'Usuario SSH' }),
  path: flags.string({ char: 'p', description: 'Ruta remota de la app' }),
};

module.exports = DeployCommand;
