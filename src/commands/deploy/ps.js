// src/commands/deploy-status.js
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { spawnSync } = require('child_process');
const Table = require('cli-table3');
const { selectKoramConfig } = require('../../utils/index');

let keytar;
try {
  keytar = require('keytar');
} catch (err) {
  keytar = null; // fallback si no soporta keytar
}

class DeployStatusCommand extends Command {
  async run() {
    const { args, flags } = this.parse(DeployStatusCommand);

    // 📂 Leer credenciales guardadas
    const credFile = path.join(process.env.HOME, '.koram_credentials.json');
    if (!fs.existsSync(credFile)) {
      console.log(chalk.red('❌ No se encontraron credenciales guardadas'));
      return;
    }

    const allCreds = JSON.parse(fs.readFileSync(credFile));
    let keys = Object.keys(allCreds);

    if (keys.length === 0) {
      console.log(chalk.red('❌ No hay credenciales registradas en tu archivo'));
      return;
    }

    // 🎯 Si se pasa alias, filtramos solo esas credenciales
    if (args.alias) {
      if (args.alias == '.') {
        const projectRoot = process.cwd();
        var configFile = JSON.parse(
          fs.readFileSync(await selectKoramConfig(projectRoot, flags.env))
        );
        keys = Object.keys(allCreds).filter(k=>k.endsWith(':'+configFile.server?.user)&&allCreds[k].host==configFile.server.host);
        console.log(keys,"llave")
      } else {
        keys = keys.filter(k => k.startsWith(args.alias + ':'));
        if (keys.length === 0) {
          console.log(chalk.red(`❌ No se encontraron credenciales para el alias "${args.alias}"`));
          return;
        }
      }

    }

    for (const key of keys) {
      const [alias, user] = key.split(':');
      const host = allCreds[key].host;
      if (!host) continue;

      // 🔑 Password desde keytar (si existe) o fallback desde el JSON
      let password = null;
      if (keytar) {
        try {
          password = await keytar.getPassword('koram', key);
        } catch {
          password = allCreds[key].password || null;
        }
      } else {
        password = allCreds[key].password || null;
      }

      const useSSHKey = flags.sshKey || false;

      let sshCommand;
      if (password && !useSSHKey) {
        sshCommand = `sshpass -p '${password}' ssh -o StrictHostKeyChecking=no ${user}@${host} "pm2 jlist"`;
      } else {
        sshCommand = `ssh -o StrictHostKeyChecking=no ${user}@${host} "pm2 jlist"`;
      }

      let table = new Table({
        head: [
          chalk.cyan('Proceso'),
          chalk.cyan('ID'),
          chalk.cyan('Status'),
          chalk.cyan('CPU'),
          chalk.cyan('Memoria')
        ],
        colWidths: [25, 5, 12, 8, 12],
        wordWrap: true
      });

      console.log(chalk.magenta.bold(`\n📡 Servidor: ${alias} → ${user}@${host}`));

      try {
        const result = spawnSync(sshCommand, { shell: true, encoding: 'utf8' });

        if (result.error || !result.stdout) {
          console.log(chalk.red('❌ Error de conexión o sin salida\n'));
          continue;
        }

        let processes;
        try {
          processes = JSON.parse(result.stdout);
        } catch {
          console.log(chalk.red('❌ Error al parsear JSON de pm2 jlist\n'));
          continue;
        }

        if (!Array.isArray(processes) || processes.length === 0) {
          console.log(chalk.yellow('⚠️ Sin procesos activos en este servidor\n'));
          continue;
        }

        processes.forEach(p => {
          const statusColor =
            p.pm2_env.status === 'online'
              ? chalk.green('online')
              : chalk.red(p.pm2_env.status);

          table.push([
            p.name,
            p.pm_id,
            statusColor,
            `${p.monit.cpu}%`,
            `${Math.round(p.monit.memory / 1024 / 1024)} MB`
          ]);
        });

        console.log(table.toString());
      } catch (err) {
        console.log(chalk.red('❌ Error inesperado ejecutando el comando SSH\n'));
      }
    }
  }
}

DeployStatusCommand.description = `Muestra el estado de los procesos PM2.
Si indicas un alias solo muestra los procesos de ese servidor, si no muestra todos.`;

DeployStatusCommand.args = [
  { name: 'alias', required: false, description: 'Alias del servidor a consultar' }
];

DeployStatusCommand.flags = {
  sshKey: flags.boolean({ char: 'k', description: 'Usar SSH key en lugar de password' }),
};

module.exports = DeployStatusCommand;
