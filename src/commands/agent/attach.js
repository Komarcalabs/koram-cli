const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');

class AgentAttachCommand extends Command {
  async run() {
    const { flags } = this.parse(AgentAttachCommand);
    const isGlobal = flags.global || false;

    const srcDir = path.resolve(__dirname, '../../../agent-config');
    if (!fs.existsSync(srcDir)) {
      this.error(chalk.red(`❌ No se encontró la carpeta de origen con el conocimiento: ${srcDir}`));
      return;
    }

    // Resolver ruta de destino
    let targetDir;
    if (isGlobal) {
      targetDir = path.join(os.homedir(), '.gemini', 'config');
    } else {
      targetDir = path.join(process.cwd(), '.agents');
    }

    this.log(chalk.cyan(`🤖 Iniciando vinculación de conocimiento con Antigravity...`));
    this.log(chalk.gray(`📍 Origen: ${srcDir}`));
    this.log(chalk.gray(`📍 Destino: ${targetDir}`));

    // Crear la ruta de destino si no existe
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
      this.log(chalk.green(`✔ Directorio de destino creado.`));
    }

    // 1. Manejo del archivo AGENTS.md
    const srcAgentsPath = path.join(srcDir, 'AGENTS.md');
    const targetAgentsPath = path.join(targetDir, 'AGENTS.md');

    if (fs.existsSync(srcAgentsPath)) {
      const srcAgentsContent = fs.readFileSync(srcAgentsPath, 'utf8');

      // Buscar marcadores de Koram en el origen (deben estar presentes)
      const startMarker = '<!-- KORAM_AGENT_RULES_START -->';
      const endMarker = '<!-- KORAM_AGENT_RULES_END -->';

      if (!srcAgentsContent.includes(startMarker) || !srcAgentsContent.includes(endMarker)) {
        this.error(chalk.red(`❌ El archivo de origen AGENTS.md no contiene las marcas de control HTML necesarias.`));
        return;
      }

      // Extraer bloque de Koram del origen
      const startIndex = srcAgentsContent.indexOf(startMarker);
      const endIndex = srcAgentsContent.indexOf(endMarker) + endMarker.length;
      const koramRulesBlock = srcAgentsContent.substring(startIndex, endIndex);

      if (!fs.existsSync(targetAgentsPath)) {
        // Si no existe el destino, escribir el origen completo
        fs.writeFileSync(targetAgentsPath, srcAgentsContent, 'utf8');
        this.log(chalk.green(`✔ Creado archivo AGENTS.md con las reglas de Koram.`));
      } else {
        // Si existe, leer contenido actual
        let targetContent = fs.readFileSync(targetAgentsPath, 'utf8');

        if (targetContent.includes(startMarker) && targetContent.includes(endMarker)) {
          // Actualizar el bloque existente
          const targetStartIndex = targetContent.indexOf(startMarker);
          const targetEndIndex = targetContent.indexOf(endMarker) + endMarker.length;
          
          const newTargetContent = 
            targetContent.substring(0, targetStartIndex) +
            koramRulesBlock +
            targetContent.substring(targetEndIndex);

          fs.writeFileSync(targetAgentsPath, newTargetContent, 'utf8');
          this.log(chalk.green(`✔ Actualizado bloque de reglas de Koram en AGENTS.md.`));
        } else {
          // Si no existen los marcadores pero tal vez el archivo tiene reglas antiguas de Koram o es de usuario
          // Lo anexamos al final del archivo con un salto de línea
          const newTargetContent = targetContent.trim() + '\n\n' + koramRulesBlock + '\n';
          fs.writeFileSync(targetAgentsPath, newTargetContent, 'utf8');
          this.log(chalk.yellow(`⚠️  Se anexaron las reglas de Koram al final del AGENTS.md existente.`));
        }
      }
    } else {
      this.log(chalk.yellow(`⚠️  No se encontró el archivo AGENTS.md de origen, se omite este paso.`));
    }

    // 2. Manejo de la Skill (skills/koram-cli)
    const srcSkillDir = path.join(srcDir, 'skills', 'koram-cli');
    const targetSkillDir = path.join(targetDir, 'skills', 'koram-cli');

    if (fs.existsSync(srcSkillDir)) {
      if (fs.existsSync(targetSkillDir)) {
        this.log(chalk.yellow(`⚡ Actualizando la habilidad 'koram-cli' en ${targetSkillDir}...`));
        try {
          fs.rmSync(targetSkillDir, { recursive: true, force: true });
        } catch (err) {
          this.warn(`No se pudo limpiar el directorio existente: ${err.message}. Intentando sobrescribir...`);
        }
      }
      
      const copyRecursiveSync = (src, dest) => {
        const exists = fs.existsSync(src);
        const stats = exists && fs.statSync(src);
        const isDirectory = exists && stats.isDirectory();
        if (isDirectory) {
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
          }
          fs.readdirSync(src).forEach((childItemName) => {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
          });
        } else {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
        }
      };

      copyRecursiveSync(srcSkillDir, targetSkillDir);
      this.log(chalk.green(`✔ Habilidad 'koram-cli' vinculada y actualizada con éxito.`));
    } else {
      this.log(chalk.yellow(`⚠️  No se encontró la carpeta de habilidades de origen, se omite este paso.`));
    }

    this.log(chalk.magenta(`\n🧙‍♂️ ¡Ritual de vinculación de conocimiento completado con éxito!`));
    this.log(`Antigravity ahora sabe cómo trabajar con Koram en este entorno.`);
  }
}

AgentAttachCommand.description = `Vincula o actualiza el conocimiento de Koram en la configuración de Antigravity (IA)
Copia las reglas generales a AGENTS.md y la guía técnica a la sección de habilidades (skills).`;

AgentAttachCommand.flags = {
  global: flags.boolean({ char: 'g', description: 'Instalar conocimiento globalmente (en ~/.gemini/config/)' }),
  local: flags.boolean({ char: 'l', description: 'Instalar conocimiento localmente en el proyecto actual (en .agents/)', default: true })
};

module.exports = AgentAttachCommand;
