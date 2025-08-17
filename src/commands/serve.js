const { Command, flags } = require('@oclif/command');
const express = require('express');
const path = require('path');
const chalk = require('chalk');
const inquirer = require('inquirer');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const chokidar = require('chokidar');

class ServeCommand extends Command {
  async run() {
    const { flags } = this.parse(ServeCommand);
    const auto = flags.yes || false;
    const port = flags.port || 3777;

    // Carpeta por defecto: dist o public
    let folder = 'dist';
    if (!fs.existsSync(path.join(process.cwd(), folder))) {
      folder = fs.existsSync(path.join(process.cwd(), 'public')) ? 'public' : null;
    }

    if (!folder) {
      console.log(chalk.red('💥 No se encontró la carpeta dist ni public para servir.'));
      return;
    }

    const serveMessage = `Deseas servir la carpeta sagrada "${folder}" en el puerto ${port}?`;

    let proceed = auto;
    if (!auto) {
      const answer = await inquirer.prompt([{
        type: 'confirm',
        name: 'proceed',
        message: serveMessage,
        default: true
      }]);
      proceed = answer.proceed;
    }

    if (!proceed) {
      console.log(chalk.blue('⏩ Ritual de servir cancelado.'));
      return;
    }

    // Configurar servidor
    const app = express();
    const servePath = path.join(process.cwd(), folder);

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

    // Función de ritual animado
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

    // Observar cambios y disparar ritual
    const watcher = chokidar.watch(servePath, { ignoreInitial: true });
    watcher.on('all', (event, file) => {
      console.log(chalk.yellow(`\n⚡ Cambio detectado: ${file}`));
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send('reload');
      });
      ritualProteccion();
    });

    server.listen(port, () => {
      console.log(chalk.green(`🟢 La carpeta "${folder}" está siendo servida por el Koram`));
      console.log(chalk.cyan(`📜 Puedes acceder a ella en: http://localhost:${port}`));
      console.log(chalk.magenta('✨ Live reload activado: cambios se reflejarán automáticamente.'));
      console.log(chalk.magenta('🛡 Cada cambio será bendecido con un ritual de protección.'));
    });
  }
}

ServeCommand.description = `Sirve tu proyecto Node.js o carpeta estática con live reload y ritual de protección
Por defecto servirá "dist" o "public".
Usa -p o --port para definir el puerto y -y para no preguntar.
`;

ServeCommand.flags = {
  port: flags.integer({ char: 'p', description: 'Puerto donde se servirá el proyecto' }),
  yes: flags.boolean({ char: 'y', description: 'Ejecutar automáticamente sin preguntar' })
};

module.exports = ServeCommand;
