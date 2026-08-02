const fs = require('fs');
const path = require('path');
const { NodeSSH } = require('node-ssh');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getCredentialByKey } = require('./index');

/**
 * Establece una conexión SSH con el servidor de backups.
 */
async function getBackupSshConnection(serverConfig, defaultServer) {
  const server = serverConfig || defaultServer;
  if (!server) {
    throw new Error('No se especificaron las credenciales del servidor.');
  }

  let vaultPassword = server.password_plain || server.password;
  if (!vaultPassword) {
    try {
      const creds = await getCredentialByKey(null, server.user, server.host);
      if (creds && creds.password) vaultPassword = creds.password;
    } catch (e) { }
  }

  const ssh = new NodeSSH();
  const connectionOpts = {
    host: server.host,
    port: parseInt(server.port) || 22,
    username: server.user,
    tryKeyboard: true,
    agent: process.env.SSH_AUTH_SOCK
  };

  if (server.sshKey) {
    const keyPath = server.sshKey.replace('~', process.env.HOME || process.env.USERPROFILE || '');
    if (fs.existsSync(keyPath)) {
      connectionOpts.privateKey = fs.readFileSync(keyPath);
    }
  }

  if (vaultPassword) {
    connectionOpts.password = vaultPassword;
  }

  await ssh.connect(connectionOpts);
  return ssh;
}

/**
 * Genera el comando para volcar MongoDB.
 */
function generateMongoDBDumpCmd(dbConfig, remoteArchiveFile) {
  let cmd = 'mongodump';
  if (dbConfig.host) cmd += ` --host ${dbConfig.host}`;
  if (dbConfig.port) cmd += ` --port ${dbConfig.port}`;
  if (dbConfig.user) cmd += ` --username ${dbConfig.user}`;
  if (dbConfig.pass) cmd += ` --password '${dbConfig.pass}'`;
  if (dbConfig.name) cmd += ` --db ${dbConfig.name}`;
  
  if (dbConfig.user && dbConfig.authSource) {
    cmd += ` --authenticationDatabase ${dbConfig.authSource}`;
  } else if (dbConfig.user) {
    cmd += ` --authenticationDatabase admin`;
  }
  
  cmd += ` --archive='${remoteArchiveFile}' --gzip`;
  return cmd;
}

/**
 * Genera el comando tar para comprimir una ruta aplicando exclusiones.
 */
function generateTarArchiveCmd(pathConfig, remoteArchiveFile) {
  const targetPath = pathConfig.path.replace(/\/$/, ''); // Quitar barra inclinada al final si existe
  const parentDir = path.dirname(targetPath);
  const folderName = path.basename(targetPath);

  let excludeFlags = '';
  if (Array.isArray(pathConfig.exclude) && pathConfig.exclude.length > 0) {
    excludeFlags = pathConfig.exclude.map(pat => `--exclude='${pat}'`).join(' ');
  }

  // tar -czf <archive> <excludes> -C <parentDir> <folderName>
  return `tar -czf '${remoteArchiveFile}' ${excludeFlags} -C '${parentDir}' '${folderName}'`;
}

/**
 * Descarga el archivo de backup remoto al local mediante SFTP.
 */
async function downloadBackup(ssh, remoteFile, localDestFile) {
  const localDir = path.dirname(localDestFile);
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }
  await ssh.getFile(localDestFile, remoteFile);
}

/**
 * Elimina backups locales antiguos según el límite configurado.
 */
function cleanLocalBackups(localDir, appName, backupName, env, keep) {
  if (!fs.existsSync(localDir)) return;
  const prefix = `${appName}-${backupName}-${env}-`;
  
  const files = fs.readdirSync(localDir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.tar.gz'))
    .map(f => {
      const fullPath = path.join(localDir, f);
      return {
        name: f,
        path: fullPath,
        mtime: fs.statSync(fullPath).mtimeMs
      };
    });

  files.sort((a, b) => a.mtime - b.mtime); // De más antiguo a más reciente

  if (files.length > keep) {
    const toDelete = files.slice(0, files.length - keep);
    for (const f of toDelete) {
      try {
        fs.unlinkSync(f.path);
      } catch (e) {}
    }
  }
}

/**
 * Elimina backups remotos antiguos según el límite configurado.
 */
async function cleanRemoteBackups(ssh, remoteBackupDir, appName, backupName, env, keep) {
  const prefixPattern = `${remoteBackupDir}/${appName}-${backupName}-${env}-*.tar.gz`;
  const listCmd = `ls -1t ${prefixPattern} 2>/dev/null || true`;
  const res = await ssh.execCommand(listCmd);
  
  if (res.stdout) {
    const files = res.stdout.split('\n').map(f => f.trim()).filter(Boolean);
    if (files.length > keep) {
      const toDelete = files.slice(keep);
      const deleteCmd = `rm -f ${toDelete.map(f => `'${f}'`).join(' ')}`;
      await ssh.execCommand(deleteCmd);
    }
  }
}

/**
 * Sube un archivo local a AWS S3 utilizando credenciales seguras de la bóveda.
 */
async function uploadToS3(localFilePath, s3Config) {
  const s3Creds = await getCredentialByKey(s3Config.key);
  if (!s3Creds) {
    throw new Error(`No se encontró la credencial de S3 con alias "${s3Config.key}"`);
  }

  const accessKeyId = s3Creds.user; // El usuario técnico es el Access Key ID
  const secretAccessKey = s3Creds.password; // La contraseña es el Secret Access Key
  const region = s3Config.region || s3Creds.host || 'us-east-1'; // El host técnico es la Región
  const bucket = s3Config.bucket;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(`Credenciales de S3 incompletas para alias "${s3Config.key}" (Faltan AccessKey o SecretKey).`);
  }
  if (!bucket) {
    throw new Error(`No se especificó un bucket de destino en la configuración del backup.`);
  }

  const client = new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  });

  const fileStream = fs.createReadStream(localFilePath);
  const keyName = path.join(s3Config.path || '', path.basename(localFilePath)).replace(/\\/g, '/');

  const uploadParams = {
    Bucket: bucket,
    Key: keyName,
    Body: fileStream
  };

  await client.send(new PutObjectCommand(uploadParams));
}

module.exports = {
  getBackupSshConnection,
  generateMongoDBDumpCmd,
  generateTarArchiveCmd,
  downloadBackup,
  cleanLocalBackups,
  cleanRemoteBackups,
  uploadToS3
};
