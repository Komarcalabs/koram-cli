const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { selectKoramConfig } = require('../../utils/index');
const {
  getBackupSshConnection,
  generateMongoDBDumpCmd,
  generateTarArchiveCmd,
  downloadBackup,
  cleanLocalBackups,
  cleanRemoteBackups,
  uploadToS3
} = require('../../utils/backup');

class InfraBackupCommand extends Command {
  async run() {
    const { flags } = this.parse(InfraBackupCommand);
    const projectRoot = process.cwd();

    // Seleccionar config
    let rcPath;
    try {
      rcPath = await selectKoramConfig(projectRoot, flags.env);
    } catch (e) {
      this.error(e.message);
      return;
    }

    const config = JSON.parse(fs.readFileSync(rcPath, 'utf-8'));
    const envName = path.basename(rcPath).replace('.koram-rc.', '').replace('.json', '');

    if (!config.backup || !Array.isArray(config.backup.configs) || config.backup.configs.length === 0) {
      this.error(`❌ No hay ninguna configuración de backup definida en ${path.basename(rcPath)}. Corre "koram add:backup" primero.`);
      return;
    }

    this.log(chalk.cyan(`\n🚀 Iniciando ejecución de backups para el entorno: ${chalk.bold(envName.toUpperCase())}`));
    this.log(chalk.gray(`Se encontraron ${config.backup.configs.length} tareas de backup configuradas.\n`));

    const results = [];

    for (const backupConfig of config.backup.configs) {
      const name = backupConfig.name;
      this.log(chalk.yellow(`\n----------------------------------------`));
      this.log(`📦 [${chalk.bold(name)}] Iniciando backup...`);
      this.log(chalk.yellow(`----------------------------------------`));

      let ssh = null;
      try {
        // 1. Establecer conexión SSH
        const targetHost = backupConfig.server?.host || config.server?.host || 'localhost';
        this.log(`🔌 Conectando a ${chalk.green(targetHost)}...`);
        ssh = await getBackupSshConnection(backupConfig.server, config.server);

        // 2. Generar timestamp único y carpetas temporales
        const timestamp = new Date().toISOString()
          .replace(/T/, '_')
          .replace(/\..+/, '')
          .replace(/:/g, '-');
        
        const remoteTempDir = `/tmp/koram-backup-${name}-${timestamp}`;
        this.log(`📁 Creando directorio de trabajo remoto temporal: ${remoteTempDir}`);
        await ssh.execCommand(`mkdir -p ${remoteTempDir}`);

        // 3. Ejecutar backup de Base de Datos (MongoDB)
        if (backupConfig.database) {
          if (backupConfig.database.type === 'mongodb') {
            this.log(`🗄️  [MongoDB] Iniciando volcado de base de datos: ${chalk.bold(backupConfig.database.name)}...`);
            const dumpFile = `${remoteTempDir}/mongodb-${backupConfig.database.name}.archive`;
            const dumpCmd = generateMongoDBDumpCmd(backupConfig.database, dumpFile);
            
            const dumpRes = await ssh.execCommand(dumpCmd);
            if (dumpRes.code !== 0) {
              throw new Error(`Error en mongodump: ${dumpRes.stderr || dumpRes.stdout}`);
            }
            this.log(chalk.green(`✓ [MongoDB] Volcado completado con éxito.`));
          } else {
            this.log(chalk.gray(`⚠️  [DB] Tipo de base de datos "${backupConfig.database.type}" no soportado actualmente (añadido al backlog).`));
          }
        }

        // 4. Ejecutar backup de Rutas de Archivos
        if (Array.isArray(backupConfig.paths) && backupConfig.paths.length > 0) {
          this.log(`📁 [Archivos] Respaldando ${backupConfig.paths.length} ruta(s)...`);
          for (let i = 0; i < backupConfig.paths.length; i++) {
            const pathConf = backupConfig.paths[i];
            const baseFolderName = path.basename(pathConf.path);
            const archiveFile = `${remoteTempDir}/files-${baseFolderName}-${i}.tar.gz`;
            
            this.log(`   - Comprimiendo ${chalk.blue(pathConf.path)}...`);
            const tarCmd = generateTarArchiveCmd(pathConf, archiveFile);
            const tarRes = await ssh.execCommand(tarCmd);
            
            if (tarRes.code !== 0) {
              throw new Error(`Error en tar para ${pathConf.path}: ${tarRes.stderr || tarRes.stdout}`);
            }
          }
          this.log(chalk.green(`✓ [Archivos] Rutas comprimidas y agregadas al workspace.`));
        }

        // 5. Empaquetar todo el directorio temporal en un solo .tar.gz remoto final
        const appName = config.name || 'koram-app';
        const remoteBackupDir = path.join(config.deploy?.path || `/var/www/${appName}`, 'backups');
        
        this.log(`📁 Creando directorio remoto para históricos: ${remoteBackupDir}`);
        await ssh.execCommand(`mkdir -p ${remoteBackupDir}`);

        const finalArchiveName = `${appName}-${name}-${envName}-${timestamp}.tar.gz`;
        const finalRemoteFile = `${remoteBackupDir}/${finalArchiveName}`;

        this.log(`📦 Empaquetando workspace final remoto...`);
        const finalPackCmd = `tar -czf '${finalRemoteFile}' -C '${remoteTempDir}' .`;
        const finalPackRes = await ssh.execCommand(finalPackCmd);
        
        if (finalPackRes.code !== 0) {
          throw new Error(`Error al empaquetar backup final en el VPS: ${finalPackRes.stderr || finalPackRes.stdout}`);
        }

        // 6. Descargar el archivo localmente
        const localDestDir = path.resolve(projectRoot, backupConfig.outputDir || './backups');
        const localDestFile = path.join(localDestDir, finalArchiveName);

        // Asegurar .gitignore
        ensureGitIgnore(projectRoot, backupConfig.outputDir || './backups');

        this.log(`⬇️  Descargando backup al disco local: ${chalk.blue(localDestFile)}...`);
        await downloadBackup(ssh, finalRemoteFile, localDestFile);
        this.log(chalk.green(`✓ Descarga completada correctamente.`));

        // 6.1. Subida opcional a AWS S3
        if (backupConfig.s3) {
          this.log(`☁️  [S3] Iniciando subida del backup a S3 (alias: ${chalk.bold(backupConfig.s3.key)})...`);
          try {
            await uploadToS3(localDestFile, backupConfig.s3);
            this.log(chalk.green(`✓ [S3] Subida completada con éxito.`));
          } catch (s3Err) {
            this.log(chalk.red(`⚠️  [S3] Error al subir a S3: ${s3Err.message}`));
          }
        }

        // 7. Limpieza de carpeta temporal remota
        this.log(`🧹 Limpiando directorio temporal remoto...`);
        await ssh.execCommand(`rm -rf ${remoteTempDir}`);

        // 8. Aplicar políticas de retención
        this.log(`🕒 Aplicando políticas de retención remota (límite: ${backupConfig.keepRemote})...`);
        await cleanRemoteBackups(ssh, remoteBackupDir, appName, name, envName, backupConfig.keepRemote);

        this.log(`🕒 Aplicando políticas de retención local (límite: ${backupConfig.keepLocal})...`);
        cleanLocalBackups(localDestDir, appName, name, envName, backupConfig.keepLocal);

        results.push({ name, status: 'success', archive: finalArchiveName });
        this.log(chalk.green(`\n🎉 [${name}] ¡Backup completado con éxito!`));

      } catch (err) {
        results.push({ name, status: 'failed', error: err.message });
        this.log(chalk.red(`\n❌ [${name}] Error en el backup: ${err.message}`));
      } finally {
        if (ssh) {
          ssh.dispose();
        }
      }
    }

    // Resumen final de la ejecución
    this.log(chalk.yellow(`\n========================================`));
    this.log(chalk.bold(`📋 RESUMEN DE EJECUCIÓN DE BACKUPS`));
    this.log(chalk.yellow(`========================================`));
    let hasFailed = false;
    for (const res of results) {
      if (res.status === 'success') {
        this.log(`✅ [${res.name}]: ${chalk.green('Completado')} → ${chalk.gray(res.archive)}`);
      } else {
        this.log(`❌ [${res.name}]: ${chalk.red('Fallido')} → ${chalk.red(res.error)}`);
        hasFailed = true;
      }
    }
    this.log(chalk.yellow(`========================================\n`));

    if (hasFailed) {
      this.exit(1);
    }
  }
}

/**
 * Asegura que el directorio de salida de los backups esté agregado al .gitignore del proyecto.
 */
function ensureGitIgnore(projectRoot, outputDir) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const ignoreEntry = outputDir.startsWith('./') ? outputDir.slice(2) : outputDir;
  const cleanEntry = ignoreEntry.replace(/\/$/, '') + '/'; // force folder ignore

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `${cleanEntry}\n`, 'utf-8');
    return;
  }

  let content = fs.readFileSync(gitignorePath, 'utf-8');
  const lines = content.split('\n').map(l => l.trim());
  if (!lines.includes(cleanEntry) && !lines.includes(ignoreEntry)) {
    content = content.trim() + `\n\n# Koram Backups local repository\n${cleanEntry}\n`;
    fs.writeFileSync(gitignorePath, content, 'utf-8');
  }
}

InfraBackupCommand.description = `Realiza las copias de seguridad de las bases de datos y archivos declarados en .koram-rc.<env>.json`;

InfraBackupCommand.flags = {
  env: flags.string({ char: 'e', description: 'Seleccionar entorno para ejecutar los backups (ej: production, staging)' })
};

module.exports = InfraBackupCommand;
