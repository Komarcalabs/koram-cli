// src/commands/deploy-status.js
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { exec } = require('child_process');
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

    console.log(chalk.cyan(`🔍 Servidores identificados: ${keys.map(k => k.split(':')[0]).join(', ')}\n`));
    console.log(chalk.blue(`⏳ Consultando procesos PM2 en paralelo...`));

    const startTime = Date.now();

    const promises = keys.map(async (key) => {
      const [alias, user] = key.split(':');
      const host = allCreds[key].host;
      if (!host) return;

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

      return new Promise((resolve) => {
        exec(sshCommand, { encoding: 'utf8' }, (error, stdout, stderr) => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          
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

          console.log(chalk.magenta.bold(`\n📡 Servidor: ${alias} → ${user}@${host} ${chalk.dim(`(${elapsed}s)`)}`));

          if (error || !stdout) {
            console.log(chalk.red('❌ Error de conexión o sin salida\n'));
            resolve();
            return;
          }

          let processes;
          try {
            processes = JSON.parse(stdout);
          } catch {
            console.log(chalk.red('❌ Error al parsear JSON de pm2 jlist\n'));
            resolve();
            return;
          }

          if (!Array.isArray(processes) || processes.length === 0) {
            console.log(chalk.yellow('⚠️ Sin procesos activos en este servidor\n'));
            resolve();
            return;
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
          resolve();
        });
      });
    });

    await Promise.all(promises);
    console.log(chalk.green(`\n✅ Consulta de todos los servidores finalizada en ${((Date.now() - startTime) / 1000).toFixed(1)}s`));
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
