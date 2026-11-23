const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');

function copyRecursiveSync(src, dest) {
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
}

function syncContentWithMarkers(targetPath, rulesBlock, fullContent) {
  const startMarker = '<!-- KORAM_AGENT_RULES_START -->';
  const endMarker = '<!-- KORAM_AGENT_RULES_END -->';

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  if (!fs.existsSync(targetPath)) {
    fs.writeFileSync(targetPath, fullContent || rulesBlock, 'utf8');
    return { action: 'created' };
  }

  const existingContent = fs.readFileSync(targetPath, 'utf8');
  if (existingContent.includes(startMarker) && existingContent.includes(endMarker)) {
    const startIndex = existingContent.indexOf(startMarker);
    const endIndex = existingContent.indexOf(endMarker) + endMarker.length;
    const newContent = existingContent.substring(0, startIndex) + rulesBlock + existingContent.substring(endIndex);
    fs.writeFileSync(targetPath, newContent, 'utf8');
    return { action: 'updated' };
  }

  const newContent = existingContent.trim() + '\n\n' + rulesBlock + '\n';
  fs.writeFileSync(targetPath, newContent, 'utf8');
  return { action: 'appended' };
}

class AgentAttachCommand extends Command {
  async run() {
    const { flags } = this.parse(AgentAttachCommand);
    const isGlobal = flags.global || false;
    const target = (flags.target || 'all').toLowerCase();
    const projectRoot = process.cwd();

    const srcDir = path.resolve(__dirname, '../../../agent-config');
    if (!fs.existsSync(srcDir)) {
      this.error(chalk.red(`❌ No se encontró la carpeta de origen con el conocimiento: ${srcDir}`));
      return;
    }

    const srcAgentsPath = path.join(srcDir, 'AGENTS.md');
    if (!fs.existsSync(srcAgentsPath)) {
      this.error(chalk.red(`❌ No se encontró el archivo de reglas de origen: ${srcAgentsPath}`));
      return;
    }

    const srcAgentsContent = fs.readFileSync(srcAgentsPath, 'utf8');
    const startMarker = '<!-- KORAM_AGENT_RULES_START -->';
    const endMarker = '<!-- KORAM_AGENT_RULES_END -->';

    if (!srcAgentsContent.includes(startMarker) || !srcAgentsContent.includes(endMarker)) {
      this.error(chalk.red(`❌ El archivo de origen AGENTS.md no contiene las marcas de control HTML necesarias.`));
      return;
    }

    const startIndex = srcAgentsContent.indexOf(startMarker);
    const endIndex = srcAgentsContent.indexOf(endMarker) + endMarker.length;
    const koramRulesBlock = srcAgentsContent.substring(startIndex, endIndex);

    const srcSkillDir = path.join(srcDir, 'skills', 'koram-cli');

    if (isGlobal) {
      this.log(chalk.cyan(`🌐 Vinculando conocimiento de Koram de forma GLOBAL...`));

      // 1. Reglas Globales para Antigravity / Gemini CLI
      const globalRulesDirs = [
        path.join(os.homedir(), '.gemini', 'antigravity', 'rules'),
        path.join(os.homedir(), '.gemini', 'config', 'rules'),
      ];

      for (const rulesDir of globalRulesDirs) {
        const destRuleFile = path.join(rulesDir, 'koram.md');
        const res = syncContentWithMarkers(destRuleFile, koramRulesBlock, srcAgentsContent);
        this.log(chalk.green(`✔ Reglas globales Antigravity [${res.action}]: ${destRuleFile}`));
      }

      // 2. Skill Global de Antigravity
      if (fs.existsSync(srcSkillDir)) {
        const globalSkillDirs = [
          path.join(os.homedir(), '.gemini', 'config', 'skills', 'koram-cli'),
          path.join(os.homedir(), '.gemini', 'antigravity', 'skills', 'koram-cli'),
        ];

        for (const skillDir of globalSkillDirs) {
          try {
            if (fs.existsSync(skillDir)) {
              fs.rmSync(skillDir, { recursive: true, force: true });
            }
          } catch (e) { }
          copyRecursiveSync(srcSkillDir, skillDir);
          this.log(chalk.green(`✔ Habilidad técnica 'koram-cli' vinculada globalmente en: ${skillDir}`));
        }
      }

      this.log(chalk.magenta(`\n🧙‍♂️ ¡Conocimiento global de Koram activado para todos tus proyectos!`));
      return;
    }

    // Modo Local (por proyecto)
    this.log(chalk.cyan(`🤖 Vinculando conocimiento de Koram en el proyecto local (${target.toUpperCase()})...`));
    this.log(chalk.gray(`📍 Directorio del proyecto: ${projectRoot}`));

    const syncTargets = [];

    if (target === 'all' || target === 'agents' || target === 'root' || target === 'antigravity') {
      // 1. Raíz del proyecto AGENTS.md (Estándar abierto para Antigravity, Copilot, Codex, Devin)
      syncTargets.push({
        name: 'Raíz AGENTS.md (Estándar multi-agente / Antigravity / Copilot)',
        path: path.join(projectRoot, 'AGENTS.md'),
      });
    }

    if (target === 'all' || target === 'antigravity') {
      // 2. Antigravity Workspace Rules
      syncTargets.push({
        name: 'Antigravity Workspace Rule (.gemini/rules/koram.md)',
        path: path.join(projectRoot, '.gemini', 'rules', 'koram.md'),
      });

      // 3. Antigravity Workspace Skill (.gemini/skills/koram-cli/)
      if (fs.existsSync(srcSkillDir)) {
        const localGeminiSkillDir = path.join(projectRoot, '.gemini', 'skills', 'koram-cli');
        try {
          if (fs.existsSync(localGeminiSkillDir)) {
            fs.rmSync(localGeminiSkillDir, { recursive: true, force: true });
          }
        } catch (e) { }
        copyRecursiveSync(srcSkillDir, localGeminiSkillDir);
        this.log(chalk.green(`✔ Habilidad Antigravity 'koram-cli' instalada en: .gemini/skills/koram-cli`));
      }
    }

    if (target === 'all' || target === 'cursor') {
      // 4. Cursor Rules (.cursorrules)
      syncTargets.push({
        name: 'Cursor Rules (.cursorrules)',
        path: path.join(projectRoot, '.cursorrules'),
      });
    }

    if (target === 'all' || target === 'claude') {
      // 5. Claude Code (CLAUDE.md)
      syncTargets.push({
        name: 'Claude Code (CLAUDE.md)',
        path: path.join(projectRoot, 'CLAUDE.md'),
      });
    }

    // Sincronizar todos los archivos de reglas seleccionados
    for (const item of syncTargets) {
      const res = syncContentWithMarkers(item.path, koramRulesBlock, srcAgentsContent);
      this.log(chalk.green(`✔ ${item.name} [${res.action}]: ${path.relative(projectRoot, item.path)}`));
    }

    this.log(chalk.magenta(`\n🧙‍♂️ ¡Ritual de vinculación completado con éxito!`));
    this.log(`Cualquier IA (Antigravity, Cursor, Claude Code, Copilot) ahora comprende y aplica Koram automáticamente en este proyecto.`);
  }
}

AgentAttachCommand.description = `Vincula y enseña el conocimiento y reglas de Koram a agentes de IA (Antigravity, Cursor, Claude Code, Copilot).
Instala reglas en AGENTS.md (raíz), .gemini/ (Antigravity), .cursorrules (Cursor) y CLAUDE.md (Claude Code).`;

AgentAttachCommand.flags = {
  global: flags.boolean({ char: 'g', description: 'Instalar conocimiento globalmente para Antigravity en ~/.gemini/' }),
  target: flags.string({ char: 't', description: 'Destino específico: all (defecto), antigravity, cursor, claude, root', default: 'all' }),
  local: flags.boolean({ char: 'l', description: 'Instalar conocimiento localmente en el proyecto actual (defecto)', default: true }),
};

module.exports = AgentAttachCommand;
module.exports.syncContentWithMarkers = syncContentWithMarkers;
