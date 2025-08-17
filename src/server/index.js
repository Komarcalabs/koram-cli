const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3777;

app.get('/', async (req, res) => {
  const { marked } = await import("marked"); // import dinámico
  const mdPath = path.join(__dirname, 'koram/public/index.md');

  fs.readFile(mdPath, 'utf8', (err, data) => {
    if (err) return res.status(500).send("No se pudo leer el Koram");

    const html = marked(data);

    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Koram - Libro Sagrado</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; line-height: 1.6; padding: 0 20px; background: #f5f5f5; }
          h1,h2,h3 { color: #7001E6; }
          code { background: #eee; padding: 2px 4px; border-radius: 4px; }
          pre { background: #eee; padding: 10px; border-radius: 6px; overflow-x: auto; }
          table { border-collapse: collapse; margin: 20px 0; }
          table, th, td { border: 1px solid #ccc; padding: 8px; }
        </style>
      </head>
      <body>
        ${html}
      </body>
      </html>
    `);
  });
});

app.listen(PORT, () => console.log(`Koram corriendo en http://localhost:${PORT}`));
