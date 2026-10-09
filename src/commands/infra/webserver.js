// src/commands/infra-webserver.js
const { Command, flags } = require("@oclif/command");
const fs = require("fs");
const path = require("path");
const { selectKoramConfig } = require("../../utils/index");
const { syncRemoteWebserver } = require("../../utils/nginx");

class InfraWebserverCommand extends Command {
  async run() {
    const { flags } = this.parse(InfraWebserverCommand);
    const projectRoot = process.cwd();
    const rcPath = await selectKoramConfig(projectRoot, flags.env);

    if (!rcPath) {
      this.error("❌ No se encontró archivo de configuración .koram-rc.<env>.json");
      return;
    }

    const env = flags.env || path.basename(rcPath).replace('.koram-rc.', '').replace('.json', '');
    const configFile = JSON.parse(fs.readFileSync(rcPath));
    try {
      await syncRemoteWebserver(null, configFile, env, this.log.bind(this));
    } catch (err) {
      this.error(`❌ Error en el proceso remoto de Nginx: ${err.message}`);
    }
  }
}

InfraWebserverCommand.description = `Aplica la configuración del bloque webserver en el servidor remoto.
Soporta múltiples configuraciones, fuente de verdad simétrica (.koram/webserver/) y auto-certificación SSL mediante Certbot.
`;

InfraWebserverCommand.flags = {
  env: flags.string({ char: "e", description: "Entorno a usar (production, staging, etc)" }),
};

module.exports = InfraWebserverCommand;
