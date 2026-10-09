// src/utils/deploy/remote-dir.js

/**
 * Valida y asegura que un directorio remoto exista y que el usuario SSH
 * tenga permisos completos de escritura sobre él.
 * Si no existe o no tiene permisos de escritura, intenta auto-remediar con elevación sudo.
 *
 * @param {object} ssh - Instancia conectada de NodeSSH
 * @param {string} remotePath - Ruta absoluta en el servidor remoto
 * @param {string} user - Usuario SSH conectado
 * @param {string} [vaultPassword] - Contraseña opcional para sudo interactivo/pipe
 * @param {function} [logFn] - Función de log (message, level)
 * @returns {Promise<boolean>}
 */
async function ensureRemoteDirectory(ssh, remotePath, user, vaultPassword = null, logFn = console.log) {
  const log = (msg, level = 'info') => {
    if (typeof logFn === 'function') logFn(msg, level);
  };

  log(`🔍 Validando directorio remoto y permisos en ${remotePath}...`, 'info');

  // 1. Probar si el directorio existe y si el usuario actual tiene permisos de escritura
  const checkCmd = `[ -d "${remotePath}" ] && ([ -w "${remotePath}" ] && echo "OK" || echo "EXISTS_NO_WRITE") || echo "MISSING"`;
  const checkResult = await ssh.execCommand(checkCmd);
  const status = checkResult.stdout.trim();

  if (status === 'OK') {
    return true; // Ya existe y es completamente escribible
  }

  const isMissing = status === 'MISSING';
  const reason = isMissing ? 'no existe' : `no tiene permisos de escritura para el usuario "${user}"`;
  log(`⚠️ El directorio "${remotePath}" ${reason}. Auto-remediando con sudo...`, 'info');

  const fixOwnershipCmd = `sudo chown -R $(whoami):$(id -gn) "${remotePath}" && sudo chmod -R u+rwX "${remotePath}"`;
  const fullCreateCmd = `sudo mkdir -p "${remotePath}" && ${fixOwnershipCmd}`;
  const targetCmd = isMissing ? fullCreateCmd : fixOwnershipCmd;

  // 2. Intentar sudo sin contraseña (muy común en AWS EC2 ubuntu / cloud-init)
  const sudoCheck = await ssh.execCommand('sudo -n true 2>/dev/null');
  if (sudoCheck.code === 0) {
    const sudoResult = await ssh.execCommand(targetCmd);
    if (sudoResult.code === 0) {
      log(`✅ Directorio preparado y permisos asignados a "${user}" mediante sudo.`, 'success');
      return true;
    }
  }

  // 3. Si sudo sin contraseña no funcionó pero tenemos vaultPassword, intentar con pipe sudo -S
  if (vaultPassword) {
    const escapedPassword = vaultPassword.replace(/"/g, '\\"');
    const sudoPassCmd = `echo "${escapedPassword}" | sudo -S ${targetCmd}`;
    const passResult = await ssh.execCommand(sudoPassCmd);
    if (passResult.code === 0) {
      log(`✅ Directorio preparado y permisos asignados a "${user}" mediante sudo (con contraseña).`, 'success');
      return true;
    }
  }

  // 4. Intento estándar de mkdir sin sudo en caso de que el usuario tenga permisos en el directorio padre
  if (isMissing) {
    await ssh.execCommand(`mkdir -p "${remotePath}"`);
  }

  // 5. Verificación final de permisos de escritura
  const finalCheck = await ssh.execCommand(`[ -d "${remotePath}" ] && [ -w "${remotePath}" ] && echo "OK" || echo "FAIL"`);
  if (finalCheck.stdout.trim() !== 'OK') {
    const manualCmd = isMissing
      ? `sudo mkdir -p "${remotePath}" && sudo chown -R ${user}:${user} "${remotePath}" && sudo chmod -R 755 "${remotePath}"`
      : `sudo chown -R ${user}:${user} "${remotePath}" && sudo chmod -R 755 "${remotePath}"`;
    throw new Error(
      `Permisos insuficientes en el servidor remoto para "${remotePath}".\n` +
      `El usuario "${user}" no tiene permisos de escritura y la auto-elevación con sudo no fue posible.\n` +
      `💡 Solución: Conéctate con "koram ssh ." y ejecuta en el servidor remoto:\n   ${manualCmd}`
    );
  }

  log(`✅ Directorio remoto listo para transferencia.`, 'success');
  return true;
}

module.exports = {
  ensureRemoteDirectory
};
