const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Obtiene la ruta al directorio centralizado de llaves SSH de Koram
 */
function getKoramKeysDir() {
  return path.join(os.homedir(), '.koram', 'keys');
}

/**
 * Asegura la existencia del directorio de llaves con permisos estrictos 0700
 */
function ensureKoramKeysDir() {
  const keysDir = getKoramKeysDir();
  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true, mode: 0o700 });
  } else {
    try {
      fs.chmodSync(keysDir, 0o700);
    } catch (e) {
      // Ignorar errores en sistemas de archivos no POSIX (ej. Windows)
    }
  }
  return keysDir;
}

/**
 * Valida, copia y aplica permisos 0600 a una llave privada SSH (.pem / id_rsa)
 * 
 * @param {string} sourcePath Ruta origen del archivo .pem proporcionado por el usuario
 * @param {string} alias Alias único del servidor
 * @param {string} [user] Usuario SSH opcional para desambiguar
 * @returns {string} Ruta absoluta del archivo copiado en ~/.koram/keys/<alias>.pem
 */
function storeKoramKey(sourcePath, alias, user) {
  if (!sourcePath || typeof sourcePath !== 'string') {
    throw new Error('Debes especificar una ruta válida al archivo de la llave privada');
  }

  const resolvedSource = sourcePath.trim().replace(/^~(?=$|\/|\\)/, os.homedir());
  const absoluteSource = path.isAbsolute(resolvedSource)
    ? resolvedSource
    : path.resolve(process.cwd(), resolvedSource);

  if (!fs.existsSync(absoluteSource)) {
    throw new Error(`El archivo de llave no existe en: ${absoluteSource}`);
  }

  const stat = fs.statSync(absoluteSource);
  if (!stat.isFile()) {
    throw new Error(`La ruta especificada no es un archivo: ${absoluteSource}`);
  }

  const content = fs.readFileSync(absoluteSource, 'utf8');
  if (!content.includes('PRIVATE KEY') && !content.includes('BEGIN RSA') && !content.includes('BEGIN OPENSSH')) {
    throw new Error('El archivo no parece ser una llave privada SSH válida (debe contener cabeceras -----BEGIN ... PRIVATE KEY-----)');
  }

  const keysDir = ensureKoramKeysDir();
  const sanitizedAlias = alias.replace(/[^a-zA-Z0-9_-]/g, '_');
  const targetFileName = `${sanitizedAlias}.pem`;
  const targetPath = path.join(keysDir, targetFileName);

  // Escribir archivo en el almacén seguro con permisos 0600
  fs.writeFileSync(targetPath, content, { mode: 0o600 });
  try {
    fs.chmodSync(targetPath, 0o600);
  } catch (e) {
    // Ignorar en Windows
  }

  return targetPath;
}

/**
 * Elimina de forma segura una llave del almacén de Koram
 * 
 * @param {string} keyPath Ruta al archivo .pem
 */
function removeKoramKey(keyPath) {
  if (!keyPath) return;
  const resolved = keyPath.replace(/^~(?=$|\/|\\)/, os.homedir());
  const keysDir = getKoramKeysDir();

  // Seguridad: solo eliminar si el archivo está dentro de ~/.koram/keys/
  if (resolved.startsWith(keysDir) && fs.existsSync(resolved)) {
    try {
      fs.unlinkSync(resolved);
    } catch (e) {
      // Ignorar fallos al eliminar
    }
  }
}

module.exports = {
  getKoramKeysDir,
  ensureKoramKeysDir,
  storeKoramKey,
  removeKoramKey,
};
