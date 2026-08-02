const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const { selectKoramConfig } = require('../../utils/index');

class AddBackupCommand extends Command {
  async run() {
    const { flags } = this.parse(AddBackupCommand);
    const projectRoot = process.cwd();

    // Seleccionar o inicializar config
    let rcPath;
    try {
      rcPath = await selectKoramConfig(projectRoot, flags.env);
    } catch (e) {
      this.error(e.message);
      return;
    }

    const config = JSON.parse(fs.readFileSync(rcPath, 'utf-8'));

    // Inicializar bloque backup si no existe o si se fuerza
    if (!config.backup || flags.force) {
      config.backup = {
        configs: []
      };
      if (flags.force) {
        this.log(`⚠️ Bloque backup reiniciado en ${rcPath}`);
      }
    }

    this.log(`\n📦 Configurando un nuevo Backup para ${path.basename(rcPath)}...\n`);

    // Preguntas iniciales
    const initialAns = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Nombre único para esta configuración de backup (ej: db-prod, uploads):',
        default: flags.name || 'backup-default',
        validate: (input) => {
          if (!input.trim()) return 'El nombre es obligatorio.';
          // Si no se fuerza, verificar si ya existe un config con el mismo nombre
          const exists = config.backup.configs.find(c => c.name === input.trim());
          if (exists && !flags.force) {
            return `Ya existe un backup con el nombre "${input.trim()}". Utilice otro nombre o el flag --force para sobrescribirlo.`;
          }
          return true;
        }
      },
      {
        type: 'confirm',
        name: 'dedicatedServer',
        message: '¿Este backup se realizará en un servidor VPS dedicado diferente al de la app?',
        default: false
      }
    ]);

    const backupName = initialAns.name.trim();
    let serverBlock = null;

    if (initialAns.dedicatedServer) {
      const serverAns = await inquirer.prompt([
        {
          type: 'input',
          name: 'host',
          message: 'IP/Host del VPS de backups:',
          validate: (input) => input.trim() ? true : 'El host es obligatorio.'
        },
        {
          type: 'input',
          name: 'user',
          message: 'Usuario SSH del VPS de backups:',
          default: 'root'
        },
        {
          type: 'input',
          name: 'port',
          message: 'Puerto SSH:',
          default: '22'
        }
      ]);

      serverBlock = {
        host: serverAns.host.trim(),
        user: serverAns.user.trim(),
        port: parseInt(serverAns.port, 10) || 22
      };
    }

    const typeAns = await inquirer.prompt([
      {
        type: 'list',
        name: 'backupType',
        message: '¿Qué tipo de recurso deseas respaldar?',
        choices: [
          { name: 'Base de datos (MongoDB)', value: 'mongodb' },
          { name: 'Rutas de archivos o directorios', value: 'files' },
          { name: 'Ambos (Base de datos + Archivos)', value: 'both' }
        ]
      }
    ]);

    let databaseBlock = null;
    let pathsBlock = null;

    // Configurar base de datos
    if (typeAns.backupType === 'mongodb' || typeAns.backupType === 'both') {
      this.log('\n🗄️  Configurando Base de Datos MongoDB...');
      const dbAns = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Nombre de la base de datos MongoDB:',
          validate: (input) => input.trim() ? true : 'El nombre de la base de datos es obligatorio.'
        },
        {
          type: 'input',
          name: 'user',
          message: 'Usuario de la base de datos (opcional):'
        },
        {
          type: 'password',
          name: 'pass',
          message: 'Contraseña de la base de datos (opcional):',
          mask: '*'
        },
        {
          type: 'input',
          name: 'host',
          message: 'Host de la base de datos:',
          default: '127.0.0.1'
        },
        {
          type: 'input',
          name: 'port',
          message: 'Puerto de la base de datos:',
          default: '27017'
        },
        {
          type: 'input',
          name: 'authSource',
          message: 'Base de datos de autenticación (authSource):',
          default: 'admin'
        }
      ]);

      databaseBlock = {
        type: 'mongodb',
        name: dbAns.name.trim(),
        user: dbAns.user.trim() || undefined,
        pass: dbAns.pass || undefined,
        host: dbAns.host.trim(),
        port: parseInt(dbAns.port, 10) || 27017,
        authSource: dbAns.authSource.trim() || undefined
      };
    }

    // Configurar rutas de archivos
    if (typeAns.backupType === 'files' || typeAns.backupType === 'both') {
      this.log('\n📁 Configurando Rutas de Archivos...');
      pathsBlock = [];
      let addMore = true;

      while (addMore) {
        const pathAns = await inquirer.prompt([
          {
            type: 'input',
            name: 'path',
            message: 'Ingresa la ruta absoluta remota a respaldar:',
            validate: (input) => input.trim() ? true : 'La ruta no puede estar vacía.'
          },
          {
            type: 'input',
            name: 'exclude',
            message: 'Ingresa patrones de exclusión separados por comas (ej: *.tmp, cache/*) [opcional]:'
          },
          {
            type: 'confirm',
            name: 'compress',
            message: '¿Deseas comprimir esta ruta?',
            default: true
          },
          {
            type: 'confirm',
            name: 'more',
            message: '¿Deseas agregar otra ruta de archivos?',
            default: false
          }
        ]);

        const excludeList = pathAns.exclude ? pathAns.exclude.split(',').map(s => s.trim()).filter(Boolean) : [];
        pathsBlock.push({
          path: pathAns.path.trim(),
          compress: pathAns.compress,
          exclude: excludeList.length > 0 ? excludeList : undefined
        });
        addMore = pathAns.more;
      }
    }

    // Configurar políticas de retención
    this.log('\n🕒 Configurando Políticas de Retención...');
    const retentionAns = await inquirer.prompt([
      {
        type: 'input',
        name: 'keepLocal',
        message: '¿Cuántos backups deseas conservar LOCALMENTE?',
        default: '5',
        validate: (input) => !isNaN(parseInt(input, 10)) ? true : 'Debe ser un número válido.'
      },
      {
        type: 'input',
        name: 'keepRemote',
        message: '¿Cuántos backups deseas conservar REMOTAMENTE (en el VPS)?',
        default: '5',
        validate: (input) => !isNaN(parseInt(input, 10)) ? true : 'Debe ser un número válido.'
      },
      {
        type: 'input',
        name: 'outputDir',
        message: 'Directorio local de descarga de los backups:',
        default: './backups'
      }
    ]);

    // Configurar subida opcional a S3
    this.log('\n☁️  Configurando subida a AWS S3 (Opcional)...');
    const s3PromptAns = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enableS3',
        message: '¿Deseas subir automáticamente este backup a la nube AWS S3?',
        default: false
      }
    ]);

    let s3Block = null;
    if (s3PromptAns.enableS3) {
      const s3Ans = await inquirer.prompt([
        {
          type: 'input',
          name: 'key',
          message: 'Introduce el alias de las credenciales S3 (guardado en koram creds):',
          validate: (input) => input.trim() ? true : 'El alias es obligatorio.'
        },
        {
          type: 'input',
          name: 'bucket',
          message: 'Introduce el nombre del Bucket de AWS S3 destino:',
          validate: (input) => input.trim() ? true : 'El nombre del bucket es obligatorio.'
        },
        {
          type: 'input',
          name: 'path',
          message: 'Introduce el prefijo o ruta opcional dentro del bucket (ej: backups/production/):',
          default: ''
        }
      ]);

      s3Block = {
        key: s3Ans.key.trim(),
        bucket: s3Ans.bucket.trim(),
        path: s3Ans.path.trim() || undefined
      };
    }

    // Crear el nuevo objeto de configuración
    const newBackupConfig = {
      name: backupName,
      ...(serverBlock ? { server: serverBlock } : {}),
      ...(databaseBlock ? { database: databaseBlock } : {}),
      ...(pathsBlock ? { paths: pathsBlock } : {}),
      ...(s3Block ? { s3: s3Block } : {}),
      keepLocal: parseInt(retentionAns.keepLocal, 10) || 5,
      keepRemote: parseInt(retentionAns.keepRemote, 10) || 5,
      outputDir: retentionAns.outputDir.trim() || './backups'
    };

    // Reemplazar o añadir
    const existingIdx = config.backup.configs.findIndex(c => c.name === backupName);
    if (existingIdx !== -1) {
      config.backup.configs[existingIdx] = newBackupConfig;
      this.log(`\n🔄 Sobrescribiendo la configuración de backup existente "${backupName}".`);
    } else {
      config.backup.configs.push(newBackupConfig);
      this.log(`\n✅ Añadida la nueva configuración de backup "${backupName}".`);
    }

    // Guardar archivo rc
    fs.writeFileSync(rcPath, JSON.stringify(config, null, 2), 'utf-8');
    this.log(`✅ Archivo .koram-rc actualizado correctamente en: ${rcPath}\n`);
    this.log(`Ahora puedes ejecutar ${require('chalk').bold('koram infra:backup')} para realizar la copia de seguridad.`);
  }
}

AddBackupCommand.description = `Configura de forma interactiva copias de seguridad de bases de datos y carpetas, guardándolas en .koram-rc.<env>.json`;

AddBackupCommand.flags = {
  env: flags.string({ char: 'e', description: 'Seleccionar entorno para configurar el backup (ej: production, staging)' }),
  name: flags.string({ char: 'n', description: 'Nombre para el backup (ej: db, uploads)' }),
  force: flags.boolean({ char: 'f', description: 'Sobrescribir configuraciones duplicadas sin preguntar' })
};

module.exports = AddBackupCommand;
