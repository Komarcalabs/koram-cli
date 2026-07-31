const fs = require('fs');
const path = require('path');

/**
 * Genera el encabezado de comentarios con metadatos para el archivo Nginx.
 */
function generateMetadataHeader(appName, env, isBootstrap = false) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  return `# =========================================================================
# GENERADO AUTOMÁTICAMENTE POR KORAM-CLI (Evitar modificaciones directas)
# Proyecto: ${appName}
# Entorno: ${env}
# Archivo Local: .koram/webserver/${appName}-${env}.conf
# Sincronizado el: ${timestamp}
${isBootstrap ? '# MODO: Bootstrap Temporal (Sólo Puerto 80 para Certbot Let\'s Encrypt)\n' : ''}# =========================================================================\n`;
}

/**
 * Genera la configuración de Nginx para un bloque del array de configs.
 */
function generateSingleServerBlock(appName, config, projectType, deployPath, isAtomic, envPort, options = {}) {
  const { bootstrapOnly } = options;

  // 1. SSL Block
  let sslBlock = '';
  if (config.ssl?.enabled && !bootstrapOnly) {
    sslBlock = `
    listen 443 ssl;
    ssl_certificate ${config.ssl.certPath};
    ssl_certificate_key ${config.ssl.keyPath};`;
  } else if (bootstrapOnly) {
    sslBlock = `
    listen 80;`;
  } else {
    sslBlock = `
    listen ${config.listen || 80};`;
  }

  // 2. Locations / Servir archivos
  let contentBlock = '';

  if (projectType === 'spa') {
    // Para SPA, Nginx sirve los archivos compilados directamente
    const rootPath = isAtomic ? path.join(deployPath, 'current') : deployPath;
    contentBlock = `
    root ${rootPath};
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }`;

    // Agregar locaciones extra si existen
    if (config.locations && config.locations.length > 0) {
      const customLocs = config.locations
        .filter(loc => loc.path !== '/') // Omitir el raíz ya que lo configuramos arriba
        .map(loc => `
    location ${loc.path} {
      ${loc.proxyPass ? `proxy_pass ${loc.proxyPass};` : ''}
      ${loc.extra ? loc.extra.join('\n      ') : ''}
    }`)
        .join('\n');
      if (customLocs) contentBlock += '\n' + customLocs;
    }
  } else {
    // Para SSR/PM2/Node, Nginx actúa como reverse proxy
    const locations = (config.locations || [])
      .map(loc => {
        let proxyDest = loc.proxyPass;
        // Si es el root y no está definido, resolver dinámicamente con envPort
        if (!proxyDest && loc.path === '/') {
          proxyDest = `http://127.0.0.1:${envPort || 3000}`;
        }

        const headers = proxyDest ? `
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;` : '';

        return `
    location ${loc.path} {
      ${proxyDest ? `proxy_pass ${proxyDest};` : ''}
      ${headers}
      ${loc.extra ? loc.extra.join('\n      ') : ''}
    }`;
      })
      .join('\n');

    contentBlock = locations || `
    location / {
      proxy_pass http://127.0.0.1:${envPort || 3000};
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }`;
  }

  // Redirección opcional de HTTP a HTTPS si no estamos en bootstrap y SSL está habilitado
  let redirectBlock = '';
  if (config.ssl?.enabled && !bootstrapOnly && config.redirectToSsl) {
    redirectBlock = `
server {
    listen 80;
    server_name ${config.serverName};
    return 301 https://$host$request_uri;
}
`;
  }

  const serverBlock = `
server {
    server_name ${config.serverName};
    ${sslBlock.trim()}
    ${contentBlock.trim()}
}
`;

  return redirectBlock ? `${redirectBlock}\n${serverBlock}` : serverBlock;
}

/**
 * Genera el archivo nginx.conf completo para la aplicación.
 */
function generateNginxConf(configFile, env, options = {}) {
  const { bootstrapOnly = false } = options;
  const appName = configFile.name || 'koram-app';
  const projectType = configFile.type || 'spa';
  const deployPath = configFile.deploy?.path || `/var/www/${appName}`;
  const isAtomic = configFile.deploy?.atomicDeploys !== false;
  const envPort = configFile.env?.PORT || 3000;

  const webserver = configFile.webserver;
  if (!webserver) {
    throw new Error('No existe el bloque "webserver" en la configuración.');
  }

  const configs = webserver.configs || (webserver.config ? [webserver.config] : []);
  if (configs.length === 0) {
    throw new Error('No hay configuraciones en el bloque "webserver".');
  }

  const header = generateMetadataHeader(appName, env, bootstrapOnly);
  const body = configs
    .map(cfg => generateSingleServerBlock(appName, cfg, projectType, deployPath, isAtomic, envPort, { bootstrapOnly }))
    .join('\n\n');

  return header + body;
}

/**
 * Rutas de archivos locales
 */
function getLocalConfigPath(projectRoot, appName, env) {
  return path.join(projectRoot, '.koram', 'webserver', `${appName}-${env}.conf`);
}

function ensureLocalDir(projectRoot) {
  const dir = path.join(projectRoot, '.koram', 'webserver');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function saveLocalConfig(projectRoot, appName, env, content) {
  ensureLocalDir(projectRoot);
  const filePath = getLocalConfigPath(projectRoot, appName, env);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function readLocalConfig(projectRoot, appName, env) {
  const filePath = getLocalConfigPath(projectRoot, appName, env);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  return null;
}

/**
 * Sincroniza de forma remota la configuración de Nginx y maneja Certbot sobre una conexión SSH activa.
 */
async function syncRemoteWebserver(ssh, configFile, env, logFn = console.log) {
  const appName = configFile.name || 'koram-app';
  const webserver = configFile.webserver;
  if (!webserver) {
    logFn('⚠️ No existe el bloque "webserver" en la configuración. Saltando sincronización de Nginx.');
    return;
  }

  const configs = webserver.configs || (webserver.config ? [webserver.config] : []);
  if (configs.length === 0) {
    logFn('⚠️ No hay configuraciones en el bloque "webserver". Saltando sincronización de Nginx.');
    return;
  }

  let activeSsh = ssh;
  let ownsConnection = false;

  const appServer = configFile.server;
  const webServer = configFile.webserver?.server || configFile.server;
  const isDifferent = appServer && webServer && (
    appServer.host !== webServer.host ||
    appServer.user !== webServer.user ||
    (parseInt(appServer.port) || 22) !== (parseInt(webServer.port) || 22)
  );

  if (isDifferent) {
    logFn(`🔌 El servidor web Nginx reside en un host diferente (${webServer.user}@${webServer.host}). Conectando...`);
    const { NodeSSH } = require('node-ssh');
    const { getCredentialByKey } = require('./index');
    
    let vaultPassword = webServer.password_plain || webServer.password;
    if (!vaultPassword) {
      try {
        const creds = await getCredentialByKey(null, webServer.user, webServer.host);
        if (creds && creds.password) vaultPassword = creds.password;
      } catch (e) { }
    }

    const connectionOpts = {
      host: webServer.host,
      port: parseInt(webServer.port) || 22,
      username: webServer.user,
      tryKeyboard: true,
      agent: process.env.SSH_AUTH_SOCK
    };

    if (webServer.sshKey) {
      const keyPath = webServer.sshKey.replace('~', process.env.HOME || process.env.USERPROFILE || '');
      if (fs.existsSync(keyPath)) {
        connectionOpts.privateKey = fs.readFileSync(keyPath);
      }
    }

    if (vaultPassword) {
      connectionOpts.password = vaultPassword;
    }

    activeSsh = new NodeSSH();
    await activeSsh.connect(connectionOpts);
    logFn(`✅ Conexión establecida con el servidor web Nginx.`);
    ownsConnection = true;
  }

  try {
    // 1. Obtener la fuente de verdad (Nginx Config)
    let nginxConf = readLocalConfig(process.cwd(), appName, env);
    if (!nginxConf) {
      logFn(`⚙️ Generando configuración de Nginx local de origen...`);
      nginxConf = generateNginxConf(configFile, env);
      saveLocalConfig(process.cwd(), appName, env, nginxConf);
    }

    const remoteConfPath = `/etc/nginx/sites-available/${appName}-${env}.conf`;
    const remoteEnabledPath = `/etc/nginx/sites-enabled/${appName}-${env}.conf`;

    // 2. Revisar si requerimos inicializar Certbot para SSL
    const configsWithSsl = configs.filter(cfg => cfg.ssl?.enabled);
    const missingCerts = [];

    for (const cfg of configsWithSsl) {
      logFn(`🔍 Verificando certificado remoto para ${cfg.serverName}...`);
      const checkCert = await activeSsh.execCommand(`sudo test -f ${cfg.ssl.certPath} && echo "yes" || echo "no"`);
      if (checkCert.stdout.trim() !== 'yes') {
        missingCerts.push(cfg);
      }
    }

    const needsCertbot = missingCerts.length > 0;
    const certbotAutoRun = configFile.deploy?.webserver?.certbotAutoRun !== false;

    // Helper para subir archivos mediante /tmp (evita problemas de permisos con usuarios no-root)
    const uploadConf = async (content) => {
      const tempLocalFile = path.join(process.cwd(), '.koram', `temp-${Date.now()}.conf`);
      if (!fs.existsSync(path.dirname(tempLocalFile))) {
        fs.mkdirSync(path.dirname(tempLocalFile), { recursive: true });
      }
      fs.writeFileSync(tempLocalFile, content, 'utf-8');

      try {
        const tempRemoteFile = `/tmp/nginx-temp-${Date.now()}.conf`;
        await activeSsh.putFile(tempLocalFile, tempRemoteFile);
        await activeSsh.execCommand(`sudo mv ${tempRemoteFile} ${remoteConfPath}`);
        await activeSsh.execCommand(`sudo chmod 644 ${remoteConfPath}`);
      } finally {
        if (fs.existsSync(tempLocalFile)) {
          fs.unlinkSync(tempLocalFile);
        }
      }
    };

    const isAtomic = configFile.deploy?.atomicDeploys !== false;

    if (needsCertbot && certbotAutoRun) {
      logFn(`⚠️ Certificados SSL faltantes. Iniciando fase de bootstrap HTTP (Fase 1/2)...`);

      // 2.1 Subir config HTTP temporal (Bootstrap)
      const bootstrapConf = generateNginxConf(configFile, env, { bootstrapOnly: true });
      await uploadConf(bootstrapConf);
      logFn(`✅ Configuración de bootstrap subida a ${remoteConfPath}`);

      // 2.2 Habilitar sitio temporal
      await activeSsh.execCommand(`sudo ln -sf ${remoteConfPath} ${remoteEnabledPath}`);
      logFn(`✅ Enlace simbólico de bootstrap creado.`);

      // 2.3 Recargar Nginx
      logFn(`🔄 Recargando Nginx para validación...`);
      const reloadRes = await activeSsh.execCommand(`sudo nginx -t && sudo systemctl reload nginx`);
      if (reloadRes.code !== 0) {
        throw new Error(`Fallo al recargar Nginx en bootstrap: ${reloadRes.stderr}`);
      }

      // 2.4 Correr Certbot
      for (const cfg of missingCerts) {
        const email = configFile.deploy?.webserver?.certbotEmail || `admin@${cfg.serverName}`;
        logFn(`🔒 Ejecutando Certbot Let's Encrypt para ${cfg.serverName} (email: ${email})...`);
        
        const certbotCheck = await activeSsh.execCommand('which certbot || echo "no"');
        if (certbotCheck.stdout.trim() === 'no') {
          logFn(`📥 Instalando certbot y python3-certbot-nginx en el servidor...`);
          await activeSsh.execCommand('sudo apt-get update && sudo apt-get install -y certbot python3-certbot-nginx');
        }

        const certbotCmd = `sudo certbot --nginx -d ${cfg.serverName} --non-interactive --agree-tos -m ${email}`;
        const certbotRes = await activeSsh.execCommand(certbotCmd);
        if (certbotRes.code !== 0) {
          logFn(`❌ Certbot falló: ${certbotRes.stderr || certbotRes.stdout}`);
          logFn(`💡 Intentando método alternativo certbot certonly --webroot...`);
          const webroot = isAtomic ? path.join(configFile.deploy.path, 'current') : configFile.deploy.path;
          const certbotAltCmd = `sudo certbot certonly --webroot -w ${webroot} -d ${cfg.serverName} --non-interactive --agree-tos -m ${email}`;
          const certbotAltRes = await activeSsh.execCommand(certbotAltCmd);
          if (certbotAltRes.code !== 0) {
            throw new Error(`No se pudo obtener el certificado SSL: ${certbotAltRes.stderr}`);
          }
        }
        logFn(`✅ Certificado Let's Encrypt obtenido exitosamente.`);
      }
    }

    // 3. Subir la configuración final de Nginx
    logFn(`⬆️ Subiendo configuración de Nginx final (Fase 2/2)...`);
    await uploadConf(nginxConf);
    logFn(`✅ Configuración final subida a ${remoteConfPath}`);

    // 4. Crear enlace simbólico definitivo si no existiera
    await activeSsh.execCommand(`sudo ln -sf ${remoteConfPath} ${remoteEnabledPath}`);
    logFn(`✅ Enlace simbólico definitivo creado en ${remoteEnabledPath}`);

    // 5. Testear y recargar Nginx
    logFn(`🔄 Comprobando sintaxis y recargando Nginx...`);
    const finalReload = await activeSsh.execCommand(`sudo nginx -t && sudo systemctl reload nginx`);
    if (finalReload.code !== 0) {
      throw new Error(`Error al recargar Nginx: ${finalReload.stderr}`);
    }
    logFn(`🚀 Nginx sincronizado y recargado correctamente. Configuración activa.`);
  } finally {
    if (ownsConnection && activeSsh) {
      activeSsh.dispose();
      logFn(`🔌 Conexión con el servidor web Nginx cerrada.`);
    }
  }
}

module.exports = {
  generateNginxConf,
  getLocalConfigPath,
  ensureLocalDir,
  saveLocalConfig,
  readLocalConfig,
  syncRemoteWebserver,
};
