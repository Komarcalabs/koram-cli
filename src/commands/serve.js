const { Command, flags } = require('@oclif/command');
const express = require('express');
const path = require('path');
const chalk = require('chalk');
const inquirer = require('inquirer');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const chokidar = require('chokidar');
const open = require('open');
const detectPort = require('detect-port').default;

class ServeCommand extends Command {
  async run() {
    const { args, flags } = this.parse(ServeCommand);
    const auto = flags.yes || false;
    let port = flags.port || 3777;

    // Determinar carpeta a servir
    let folder = args.folder;
    const dirs = fs.readdirSync(process.cwd()).filter(f => fs.statSync(f).isDirectory());

    if (!folder) {
      if (dirs.length === 0) {
        console.log(chalk.red('💥 No se encontraron carpetas en el directorio actual.'));
        return;
      }
      const answer = await inquirer.prompt([{
        type: 'list',
        name: 'folder',
        message: 'Elige la carpeta que deseas servir:',
        choices: dirs
      }]);
      folder = answer.folder;
    } else if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
      console.log(chalk.red(`💥 La carpeta "${folder}" no existe.`));
      return;
    }

    // Verificar si el puerto está ocupado
    port = await detectPort(port);

    const servePath = path.join(process.cwd(), folder);
    const app = express();

    // Middleware para inyectar live reload
    app.use((req, res, next) => {
      if (req.path.endsWith('.html')) {
        let file = fs.readFileSync(path.join(servePath, req.path));
        let content = file.toString();
        const liveReloadScript = `
          <script>
            const ws = new WebSocket('ws://localhost:${port}');
            ws.onmessage = () => { location.reload(); }
          </script>
        `;
        content = content.replace('</body>', `${liveReloadScript}</body>`);
        res.send(content);
      } else {
        next();
      }
    });

    app.use('/', express.static(servePath));

    const server = http.createServer(app);
    const wss = new WebSocket.Server({ server });

    function ritualProteccion() {
      const frames = [
        chalk.blue('🔮 ✨ ✨ ✨ ✨ ✨ ✨ ✨ ✨'),
        chalk.cyan('🔮 🌟 🌟 🌟 🌟 🌟 🌟 🌟 🌟'),
        chalk.magenta('🔮 ✨ 🌟 ✨ 🌟 ✨ 🌟 ✨ 🌟')
      ];
      let i = 0;
      const interval = setInterval(() => {
        process.stdout.write('\r' + frames[i % frames.length]);
        i++;
      }, 200);
      setTimeout(() => {
        clearInterval(interval);
        process.stdout.write('\r✔ Ritual de protección completado          \n');
      }, 2000);
    }

    const watcher = chokidar.watch(servePath, { ignoreInitial: true });
    watcher.on('all', (event, file) => {
      console.log(chalk.yellow(`\n⚡ Cambio detectado: ${file}`));
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send('reload');
      });
      ritualProteccion();
    });

    server.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(chalk.green(`🟢 La carpeta "${folder}" está siendo servida por el Koram`));
      console.log(chalk.cyan(`📜 Puedes acceder a ella en: ${chalk.underline.blue(url)}`));
      console.log(chalk.magenta('✨ Live reload activado: cambios se reflejarán automáticamente.'));
      console.log(chalk.magenta('🛡 Cada cambio será bendecido con un ritual de protección.'));

      // Abrir navegador automáticamente
      open(url);
    });
  }
}

ServeCommand.description = `Sirve tu proyecto Node.js o cualquier carpeta estática con live reload y ritual de protección
Puedes pasar la carpeta como argumento: koram serve nombre_carpeta
Si no se pasa, se pedirá seleccionar entre las carpetas disponibles.
El puerto se toma del flag -p o por defecto, si está ocupado se buscará automáticamente uno disponible.
`;

ServeCommand.args = [
  {
    name: 'folder',        // nombre del argumento posicional
    required: false,
    description: 'Nombre de la carpeta a servir'
  }
];

ServeCommand.flags = {
  port: flags.integer({ char: 'p', description: 'Puerto donde se servirá el proyecto' }),
  yes: flags.boolean({ char: 'y', description: 'Ejecutar automáticamente sin preguntar' })
};

module.exports = ServeCommand;
