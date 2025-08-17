const { Command, flags } = require('@oclif/command');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class DeploySPACommand extends Command {
  async run() {
    const { flags } = this.parse(DeploySPACommand);

    const cliRootPath = path.resolve(__dirname, '../../');
    const venvPythonPath = path.join(cliRootPath, 'venv/bin/python3');
    if (!fs.existsSync(venvPythonPath)) {
      this.error('El entorno virtual de Python no se encontró. Asegúrate de haber ejecutado `npm install`.');
      return;
    }

    // Ruta de tu nuevo script SPA
    const deployerPath = path.join(cliRootPath, 'spa-deployer.py');

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
    const buildEnv = config.build_env || 'production';

    // Ejecutar Python con variables de entorno
    const pyProcess = spawn(venvPythonPath, [deployerPath], {
      shell: true,
      env: { 
        ...process.env,
        HOST: host,
        USER: user,
        REMOTE_PATH: remotePath,
        BUILD_ENV: buildEnv,
        RC_PATH: rcPath // Pasamos la ruta del .koram-rc
      }
    });

    pyProcess.stdout.on('data', (data) => process.stdout.write(data.toString()));
    pyProcess.stderr.on('data', (data) => process.stderr.write(data.toString()));
    pyProcess.on('close', (code) => {
      if (code === 0) console.log('\n✅ Deploy SPA completado con éxito.');
      else console.log(`\n❌ Deploy SPA finalizó con código ${code}`);
    });
  }
}

DeploySPACommand.description = `Lanza el deployer Python para SPA
Este comando ejecuta el build local, empaquetado, subida y despliegue de la SPA en el servidor.
`;

DeploySPACommand.flags = {
  host: flags.string({ char: 'h', description: 'Host del servidor' }),
  user: flags.string({ char: 'u', description: 'Usuario SSH' }),
  path: flags.string({ char: 'p', description: 'Ruta remota de la SPA' }),
};

module.exports = DeploySPACommand;
