#!/usr/bin/env node
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const express = require('express');
const open = require('open');
const chokidar = require('chokidar');
const WebSocket = require('ws');
const detectPort = require('detect-port').default;
const chalk = require('chalk');

let optimize;
try { optimize = require('svgo').optimize; } catch (e) { optimize = null; }

class SpriteServeCommand extends Command {
  async run() {
    const { flags } = this.parse(SpriteServeCommand);

    const inputDir = flags.input || './svg-icons';
    const outputFile = flags.output || './sprite.svg';
    const prefixIcon = flags.prefix || '';
    const portDefault = flags.port || 3777;
    const watch = flags.watch !== false;
    const doOptimize = flags.optimize || true;
    const useUI = flags.ui || false;
    const external = flags.external || false;

    // 🔁 Obtener SVGs recursivamente
    function getAllSvgFiles(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let files = [];

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files = files.concat(getAllSvgFiles(fullPath));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.svg')) {
          files.push(fullPath);
        }
      }

      return files;
    }

    async function generateSprite() {
      try {
        if (!fs.existsSync(inputDir)) {
          console.error(chalk.red(`❌ La carpeta "${inputDir}" no existe`));
          return [];
        }

        const files = getAllSvgFiles(inputDir);
        if (!files.length) {
          console.error(chalk.red(`❌ No se encontraron archivos SVG en "${inputDir}"`));
          return [];
        }

        console.log(chalk.blue(`🔄 Generando sprite con ${files.length} iconos...`));

        let spriteContent = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" style="display:none;">\n  <defs>\n`;

        const iconData = []; // [{ id, group, relativePath }]

        files.forEach(file => {
          try {
            let content = fs.readFileSync(file, 'utf8');

            if (doOptimize && optimize) {
              content = optimize(content, { multipass: true }).data;
            }

            const viewBoxMatch = content.match(/viewBox=["']([^"']+)["']/);
            const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24';
            const innerContent = content.replace(/<svg[^>]*>/gi, '').replace(/<\/svg>/gi, '').trim();

            const relativePath = path.relative(inputDir, file);
            const iconName = relativePath
              .replace(/\.svg$/i, '')
              .replace(/[\\/]/g, '-');

            const group = path.dirname(relativePath) === '.' ? 'root' : path.dirname(relativePath);
            const symbolId = prefixIcon ? `${prefixIcon}-${iconName}` : iconName;

            iconData.push({ id: symbolId, group, path: relativePath });

            spriteContent += `    <symbol id="${symbolId}" viewBox="${viewBox}">\n      ${innerContent}\n    </symbol>\n`;
          } catch (err) {
            console.error(chalk.red(`❌ Error con "${file}": ${err.message}`));
          }
        });

        spriteContent += `  </defs>\n</svg>`;
        fs.writeFileSync(outputFile, spriteContent);
        console.log(chalk.green(`🎉 Sprite generado: ${outputFile}`));

        // 📄 Generar HTML agrupado por carpeta
        const hrefPrefix = external ? path.basename(outputFile) : '';
        const groupedIcons = iconData.reduce((acc, icon) => {
          acc[icon.group] = acc[icon.group] || [];
          acc[icon.group].push(icon);
          return acc;
        }, {});

        const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Vista de Iconos</title>
<style>
  body { font-family: sans-serif; padding: 2rem; background:#f9f9f9; color:#333; }
  h1 { font-size: 1.5rem; margin-bottom: 1rem; }
  h2 { margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: 0.5rem; font-size: 1.2rem; color: #555; }
  .search { margin-bottom: 1rem; padding: 0.5rem; width: 100%; max-width: 400px; font-size:16px; border:1px solid #ccc; border-radius:4px; }
  .icon { display:inline-flex; flex-direction:column; align-items:center; margin:0.75rem; font-size:12px; cursor:pointer; position: relative; background:white; padding:0.5rem; border-radius:6px; box-shadow:0 1px 3px rgba(0,0,0,0.1); }
  .icon.hidden { display:none; }
  svg { width:48px; height:48px; fill:#333; }
  .grid { display:flex; flex-wrap:wrap; }
  .tooltip {
    position: absolute;
    top: -1.5rem;
    background: #333;
    color: white;
    padding: 2px 6px;
    font-size: 10px;
    border-radius: 3px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s;
    white-space: nowrap;
  }
</style>
</head>
<body>
<h1>Iconos disponibles</h1>
<input class="search" type="text" placeholder="Buscar icono..." oninput="filterIcons(this.value)">
${external ? '' : spriteContent}
${Object.entries(groupedIcons).map(([group, icons]) => `
  <h2>${group === 'root' ? 'General' : group}</h2>
  <div class="grid">
    ${icons.map(({ id }) => `
      <div class="icon" data-name="${id}">
        <svg><use xlink:href="${hrefPrefix ? hrefPrefix + '#' : '#'}${id}"></use></svg>
        <span>${id}</span>
        <div class="tooltip">Copiado!</div>
      </div>
    `).join('')}
  </div>
`).join('')}
<script>
  const hrefPrefix = "${hrefPrefix}";

  function filterIcons(query) {
    const icons = document.querySelectorAll('.icon');
    const q = query.toLowerCase();
    icons.forEach(icon => {
      const name = icon.getAttribute('data-name').toLowerCase();
      icon.classList.toggle('hidden', !name.includes(q));
    });
  }

  document.querySelectorAll('.icon').forEach(icon => {
    const tooltip = icon.querySelector('.tooltip');
    icon.addEventListener('click', () => {
      const name = icon.getAttribute('data-name');
      const code = \`<svg><use xlink:href="\${hrefPrefix ? hrefPrefix + '#' : '#'}\${name}"></use></svg>\`;
      navigator.clipboard.writeText(code).then(() => {
        tooltip.style.opacity = 1;
        setTimeout(() => tooltip.style.opacity = 0, 1200);
      });
    });
  });

  // Live reload con WebSocket
  const ws = new WebSocket('ws://localhost:${portDefault}');
  ws.onmessage = () => location.reload();
</script>
</body>
</html>`;

        const htmlFile = path.join(path.dirname(outputFile), 'index.html');
        fs.writeFileSync(htmlFile, htmlContent);
        console.log(chalk.green(`📄 HTML generado: ${htmlFile}`));

        return iconData.map(i => i.id);
      } catch (error) {
        console.error(chalk.red('💥 Error al generar sprite:'), error.message);
        return [];
      }
    }

    if (!useUI) {
      await generateSprite();
      return;
    }

    // 🖥️ Modo UI con servidor y live reload
    const port = await detectPort(portDefault);
    const app = express();
    app.use(express.static(path.dirname(outputFile)));
    const server = require('http').createServer(app);
    const wss = new WebSocket.Server({ server });

    if (watch) {
      const watcher = chokidar.watch(inputDir, { ignoreInitial: true });
      watcher.on('all', async (event, file) => {
        console.log(chalk.yellow(`⚡ Cambio detectado: ${file}, regenerando...`));
        await generateSprite();
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) client.send('reload');
        });
      });
    }

    await generateSprite();

    server.listen(port, async () => {
      const url = `http://localhost:${port}/index.html`;
      console.log(chalk.green(`🟢 Servido en: ${url}`));
      await open(url);
    });
  }
}

SpriteServeCommand.description = 'Genera un sprite SVG y HTML agrupado por carpetas con buscador, tooltip y live reload (--ui).';
SpriteServeCommand.flags = {
  input: flags.string({ char: 'i', description: 'Carpeta con SVGs', default: './svg-icons' }),
  output: flags.string({ char: 'o', description: 'Archivo de salida del sprite', default: './sprite.svg' }),
  prefix: flags.string({ char: 'p', description: 'Prefijo para los IDs de los iconos', default: '' }),
  port: flags.integer({ description: 'Puerto del servidor', default: 3777 }),
  watch: flags.boolean({ char: 'w', description: 'Activar watch/live reload', default: true }),
  optimize: flags.boolean({ char: 'O', description: 'Optimizar SVGs antes de agregarlos al sprite', default: false }),
  ui: flags.boolean({ char: 'u', description: 'Levantar servidor con live reload y vista HTML', default: false }),
  external: flags.boolean({ char: 'e', description: 'Usar sprite externo en el HTML', default: false }),
};

module.exports = SpriteServeCommand;
