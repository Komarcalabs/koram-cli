---
name: koram-cli-toolkit
description: Manual técnico exhaustivo y guía de referencia de comandos, configuraciones, flujos de trabajo e infraestructura de Koram CLI para el Agente Antigravity
---

# Manual Técnico Definitivo de Koram CLI

Esta guía proporciona el conocimiento operativo completo sobre **Koram CLI**, incluyendo comandos, flags, esquemas de configuración `.koram-rc.<env>.json`, flujos de despliegue, Infraestructura como Código (IaC) de Nginx, copias de seguridad (backups), túneles y monitoreo centralizado.

---

## 1. Conceptos Generales y Seguridad

### Bóveda de Seguridad (`creds`)
Koram cifra y almacena localmente las credenciales SSH y AWS S3.
* **Mecanismo de almacenamiento**:
  1. **Keytar:** En macOS, Windows o Linux con entorno gráfico, delega al llavero del OS.
  2. **Fallback:** En entornos sin llavero (WSL o contenedores), guarda en `~/.koram_credentials.json` (se puede forzar con `--fallback` o `-f`).
* **Mapeo dinámico de credenciales según su tipo**:
  * **Servidores SSH (`--type server` / default):**
    ```bash
    koram creds:add <alias> <usuario> [host] [puerto]
    ```
    *Ejemplo:* `koram creds:add vps-prod root 64.23.174.86 22` (solicitará la contraseña de forma interactiva).
  * **Almacenamiento AWS S3 (`--type s3`):**
    ```bash
    koram creds:add <alias> s3
    ```
    *Ejemplo:* `koram creds:add mi-s3 s3` (asistente interactivo que solicita el Access Key ID, Secret Key y Región por defecto).
* **Comandos de Bóveda**:
  * `koram creds:ls` - Muestra la lista de credenciales registradas. Usa `-p` para revelar contraseñas y claves.
  * `koram creds:show <alias>` - Muestra en formato tabla los metadatos específicos según su tipo (Server o S3).
  * `koram creds:rm <alias>` - Elimina de forma definitiva la credencial de la bóveda.

---

## 2. Motores de Despliegue de Código (`deploy`)

### A. Despliegue de Aplicaciones Estáticas (`deploy:spa`)
Optimizado para React, Vue, Vite, Angular, Svelte o HTML puro.
* **Comando**:
  - `koram deploy:spa` - Lanza dashboard web interactivo local en puerto `3889`.
  - `koram deploy:spa --now` - Ejecuta directamente en segundo plano sin dashboard.
* **Esquema de Configuración (`.koram-rc.<env>.json`)**:
  ```json
  {
    "name": "mi-app-estatica",
    "type": "spa",
    "server": {
      "host": "64.23.174.86",
      "user": "root"
    },
    "deploy": {
      "path": "/var/www/mi-app-estatica",
      "buildCommand": "npm run build",
      "outputDir": "dist",
      "atomicDeploys": true,
      "webserver": {
        "autoApply": true,
        "certbotEmail": "admin@empresa.com",
        "certbotAutoRun": true
      }
    }
  }
  ```
* **Flujo Operativo**:
  1. Compila localmente con `buildCommand`.
  2. Conexión SSH. Si `rsync` y `sshpass` están en la máquina local, realiza una sincronización Delta ultra rápida. De lo contrario, sube un paquete `tar.gz` y lo descomprime.
  3. Crea estructura atómica remota: `/var/www/mi-app/releases/<timestamp>`.
  4. Crea o actualiza el enlace simbólico (symlink) `/var/www/mi-app/current` apuntando al release más reciente.
  5. Purga versiones antiguas (mantiene solo los últimos 5 releases).
  6. Sincroniza Nginx (si `autoApply` es `true`).

---

### B. Despliegue de Nuxt.js / Node SSR (`deploy:nuxt`)
Optimizado para aplicaciones que requieren servidor Node.js corriendo y PM2.
* **Comando**:
  - `koram deploy:nuxt` - Lanza dashboard web interactivo local en puerto `3888`.
* **Esquema de Configuración (`.koram-rc.<env>.json`)**:
  ```json
  {
    "name": "mi-app-nuxt",
    "type": "nuxt",
    "server": { "host": "64.23.174.86", "user": "root" },
    "deploy": {
      "path": "/var/www/mi-app-nuxt",
      "buildCommand": "npm run build",
      "outputDir": ".output",
      "packageManager": "npm",
      "webserver": {
        "autoApply": true,
        "certbotEmail": "admin@empresa.com",
        "certbotAutoRun": true
      }
    },
    "processes": [
      {
        "name": "mi-app-nuxt",
        "command": "pm2 start .output/server/index.mjs --name mi-app-nuxt"
      }
    ],
    "advanced": {
      "usePm2": true,
      "optimizeNpm": true,
      "localNpmInstall": false
    },
    "env": {
      "NODE_ENV": "production",
      "PORT": 3000
    }
  }
  ```
* **Flujo Operativo**:
  1. Compilación local en `.output`.
  2. Sincronización SSH y subida Delta de `.output` y `package.json`.
  3. **Smart Install:** Compara el hash del `package-lock.json` local con el del servidor. Si coinciden, omite la instalación de dependencias en el servidor. Si difieren, las instala de forma limpia para producción.
  4. Genera dinámicamente un archivo `.env` en el servidor con los valores de la sección `env`.
  5. Recarga PM2 sin caída: `pm2 reload <proceso> --update-env`.

---

### C. Despliegue de PM2 Tradicional (`deploy:pm2`)
Para backends con archivo `ecosystem.config.js` propio.
* **Comando**:
  ```bash
  koram deploy:pm2 [alias] [flags]
  ```
* **Flags**:
  - `-e, --env`: Entorno configurado en `ecosystem.config.js` (ej. `production`).
  - `-x, --extra`: Parámetros extras para el comando nativo de PM2.
  - `-k, --sshKey`: Usa llaves SSH cargadas en el agente local en lugar de contraseñas de la bóveda.
* **Flujo**:
  1. Lee `.koram-rc.<env>.json` o el `ecosystem` para mapear las credenciales SSH usando el host/usuario como llave en la bóveda criptográfica.
  2. Recupera la contraseña, crea un archivo temporal encriptado y ejecuta con `sshpass` el comando nativo `pm2 deploy <file> <env>`.
  3. Purga el archivo temporal de contraseñas de la memoria y el disco inmediatamente.

---

## 3. Servidor Web y SSL (Nginx IaC)

Koram automatiza Nginx usando un esquema simétrico 1-a-1.
* **Estructura local (Fuente de Verdad)**: `.koram/webserver/${appName}-${env}.conf`
* **Ruta remota**: `/etc/nginx/sites-available/${appName}-${env}.conf` con symlink activo hacia `sites-enabled/`.

### Comandos de Infraestructura de Nginx
* **`koram add:webserver`**: Inicializa la configuración en el JSON del entorno y genera localmente la plantilla Nginx.
  - *Flags:* `-e` (entorno), `-s` (dominio), `--ssl` (habilitar HTTPS), `--proxyPass` (URL para Node, ej: `http://127.0.0.1:3000`), `--redirectToSsl` (redirigir 80 a 443), `-f` (sobrescribir plantilla local).
* **`koram infra:webserver:gen`**: Regenera la plantilla Nginx local basándose en el JSON.
* **`koram infra:webserver`**: Sincroniza la plantilla local hacia el servidor remoto Nginx.

### Flujo de Certificación SSL de Doble Fase
1. **Fase de Verificación:** El CLI busca por SSH si las rutas de los certificados (Let's Encrypt) ya existen en el servidor VPS.
2. **Fase de Bootstrap:** Si no existen, genera una configuración temporal que escucha **únicamente en el puerto 80**, la sube y recarga Nginx. Luego corre Certbot no interactivo:
   ```bash
   sudo certbot --nginx -d mi-app.com --non-interactive --agree-tos -m <email>
   ```
3. **Fase HTTPS Final:** Una vez generados los certificados por Certbot, el CLI sube la configuración final SSL con el puerto 443 y redirecciones, realizando una segunda recarga segura de Nginx en el servidor.

### Arquitectura de Servidores Separados
Si tienes el servidor web frontal/balanceador en un VPS público y el backend en un VPS interno, puedes declararlo usando `webserver.server`:
```json
{
  "name": "mi-app",
  "server": { "host": "10.0.0.5" },
  "webserver": {
    "server": { "host": "64.23.174.86", "user": "root" },
    "configs": [{ "serverName": "mi-sitio.com", "listen": 80 }]
  }
}
```
* **Comportamiento**: El despliegue de código se conectará a `10.0.0.5` y la sincronización de Nginx abrirá de forma autónoma una conexión SSH separada hacia `64.23.174.86`.

---

## 4. Sistema de Backups (`backup`)

Genera dumps de base de datos y compresión de archivos, descargándolos por SFTP y aplicando políticas de retención.

### Configuración Declarativa
```json
"backup": {
  "configs": [
    {
      "name": "database-vps",
      "server": { "host": "191.101.235.199", "user": "root" },
      "database": {
        "type": "mongodb",
        "name": "mi_db",
        "user": "db_user",
        "pass": "db_pass",
        "host": "127.0.0.1",
        "port": 27017,
        "authSource": "admin"
      },
      "keepLocal": 5,
      "keepRemote": 5,
      "outputDir": "./backups"
    },
    {
      "name": "uploads-vps",
      "paths": [
        {
          "path": "/home/deploys/uploads",
          "compress": true,
          "exclude": ["*.tmp", "cache/*", "logs/*.log"]
        }
      ],
      "keepLocal": 5,
      "keepRemote": 5,
      "outputDir": "./backups"
    }
  ]
}
```
* **`exclude`**: Array de patrones glob que se omitirán al comprimir directorios remotos (ej: logs, caches).

### Comandos de Backup
* **`koram add:backup`**: Asistente interactivo en consola para agregar configuraciones.
* **`koram infra:backup`**: Ejecuta secuencialmente todas las tareas definidas en `configs`.
* **Nomenclatura**: `./backups/${appName}-${backupName}-${env}-${timestamp}.tar.gz`.

### Casos de Uso y Arquitecturas de Backup
1. **Caso A: PC Local (Desarrollador):** Ejecutas el comando localmente. Se conecta al VPS, genera el dump remota, lo comprime, lo descarga a tu carpeta local `./backups/` (auto-ignorada en git) y sube a AWS S3 si está configurado.
2. **Caso B: Servidor Centralizado (Admin/Cron):** Clonas el repositorio en un VPS central. Programas una tarea cron para correr `koram infra:backup -e production`. Aísla el tráfico de backups de los VPS de producción.
3. **Caso C: VPS Autónomo (Local):** Instalas Koram en el mismo servidor VPS donde corre la app y usas `localhost` en la configuración. El dump y retención ocurren localmente en el servidor.

---

## 5. Túneles e Infraestructura (`tunnel`)

Exhibe un puerto local a Internet a través de un VPS proxy seguro sobre SSH.
* **Comando**:
  ```bash
  koram infra:tunnel [ALIAS] [FLAGS]
  ```
* **Flags**:
  - `-l, --localPort`: Puerto local (ej: `3000`).
  - `-p, --remotePort`: Puerto público a abrir en el VPS (ej: `8080`).
  - `-k, --sshKey`: Usa llaves SSH cargadas en el agente local en lugar de contraseña.
* **Seguridad (Liberación de puertos)**: El comando detecta si el puerto remoto está en uso. Te ofrecerá de forma interactiva terminar el proceso huérfano que lo ocupa para liberarlo al instante.

---

## 6. Monitoreo Centralizado (`monitor`)

Topología Hub-and-Spoke para vigilar la salud de múltiples VPS (CPU, RAM, disco) y procesos PM2.
* **El Gran Ojo (Hub / Servidor Central):** Recibe datos e implementa la interfaz web.
* **Centinelas (Spokes / Agente):** Envían datos en background al servidor.

### A. Despliegue Automático
```bash
koram monitor:setup <mi-vps-alias>
```
* Se conecta por SSH, valida/instala Node.js >= 20, instala Koram de forma global, y arranca el servicio correspondiente en PM2 con auto-inicio en reboot.

### B. Ejecución Manual
* **Servidor Central:**
  ```bash
  koram monitor:server --port 3000 --key <secret_key> --auth --user admin --pass secreto
  ```
* **Agentes (Centinelas):**
  ```bash
  koram monitor:agent --url http://ip-servidor:3000 --key <secret_key> --name vps-prod --interval 60
  ```

---

## 7. Utilidades y Diagnóstico de Proyectos

* **`koram doctor`**: Analiza vulnerabilidades de dependencias en `package.json`, versiones de node/npm en desarrollo y la integridad de los archivos de configuración recomendando rituales de sanación.
* **`koram clean`**: Purifica el repositorio de forma interactiva o silenciosa (`-y`), eliminando `node_modules`, carpetas de build (`dist`, `build`), cachés de NPM y archivos log.
* **`koram serve`**: Levanta un servidor HTTP local estático con live reload en el puerto deseado (`-p`) para pre-visualizar compilaciones de producción.
