---
name: koram-cli-toolkit
description: Manual técnico exhaustivo, arquitectura, esquemas de configuración, catálogo de comandos y guía operativa de Koram CLI para Agentes de Inteligencia Artificial
---

# Manual Técnico Definitivo de Koram CLI

Esta guía proporciona el conocimiento operativo completo sobre **Koram CLI** (`koram`), incluyendo todos los comandos, parámetros, esquemas `.koram-rc.<env>.json`, flujos de despliegue atómico, Infraestructura como Código (IaC) de Nginx, copias de seguridad (backups), observabilidad y mantenimiento remoto de servidores VPS.

---

## 1. Filosofía de Arquitectura y Seguridad

### Bóveda Criptográfica (`creds`)
Koram cifra y almacena localmente las credenciales SSH y tokens de AWS S3 para evitar la exposición de secretos en archivos de código o repositorios Git.
* **Mecanismos de Almacenamiento**:
  1. **Keytar:** En macOS, Windows o Linux con entorno gráfico, delega al llavero seguro oficial del Sistema Operativo.
  2. **Fallback:** En entornos sin llavero (WSL sin GUI o contenedores CI/CD), almacena metadatos y credenciales en `~/.koram_credentials.json` (se puede forzar con `--fallback` o `-f`).
  3. **Almacenamiento de Llaves Privadas SSH (`.pem` / `id_rsa`):** Al vincular una llave privada con `koram creds:add --key`, Koram la copia a `~/.koram/keys/<alias>.pem` y le asigna permisos estrictos `0600` (y `0700` a la carpeta), garantizando compatibilidad con OpenSSH.

* **Comandos de la Bóveda**:
  * **Asistente Interactivo Universal:**
    ```bash
    koram creds:add
    ```
    Lanza el menú guiado para elegir entre Llave SSH (.pem), Contraseña o AWS S3.
  * **Servidor con Llave SSH:**
    ```bash
    koram creds:add <alias> <usuario> <host> --key <ruta-al-pem>
    ```
  * **Servidor con Contraseña:**
    ```bash
    koram creds:add <alias> <usuario> <host>
    ```
  * **Almacenamiento AWS S3:**
    ```bash
    koram creds:add <alias> s3
    ```
  * **`koram creds:ls`**: Lista las credenciales registradas. Usa `-p` para revelar contraseñas.
  * **`koram creds:show <alias>`**: Muestra en formato tabla los metadatos específicos del servidor o bucket S3.
  * **`koram creds:update <alias>`**: Actualiza parámetros de una credencial existente (usuario, host, llave o contraseña) de forma interactiva o por flags.
  * **`koram creds:rm <alias>`**: Elimina permanentemente una credencial de la bóveda.

* **Acceso Directo por SSH**:
  ```bash
  koram ssh <alias>
  koram ssh . # Resuelve automáticamente el servidor según el .koram-rc local
  ```

---

## 2. Archivos de Configuración Declarativa (`.koram-rc.<env>.json`)

En la raíz del proyecto reside un archivo `.koram-rc.<entorno>.json` por cada ambiente (ej: `.koram-rc.production.json`, `.koram-rc.staging.json`, `.koram-rc.develop.json`).
* **Inicialización Rápida**: Ejecuta `koram init` para responder un cuestionario interactivo que genera el archivo inicial tipado.

### Estructura General del Esquema
```json
{
  "name": "mi-aplicacion",
  "type": "nuxt", // "spa" | "nuxt" | "pm2" | "node" | "deno"
  "server": {
    "host": "64.23.174.86",
    "user": "root",
    "port": 22,
    "sshKey": "~/.koram/keys/prod.pem" // Opcional, si no se resuelve desde la bóveda
  },
  "buildEnv": "production",
  "packageManager": "npm", // "npm" | "pnpm" | "yarn"
  "deploy": {
    "path": "/var/www/mi-aplicacion",
    "buildCommand": "npm run build",
    "outputDir": ".output",
    "atomicDeploys": true,
    "preDeploy": [],
    "postDeploy": [],
    "webserver": {
      "autoApply": true,
      "certbotEmail": "admin@empresa.com",
      "certbotAutoRun": true
    }
  },
  "processes": [
    {
      "name": "mi-aplicacion",
      "command": "pm2 start .output/server/index.mjs --name mi-aplicacion"
    }
  ],
  "env": {
    "NODE_ENV": "production",
    "PORT": 3000
  },
  "advanced": {
    "usePm2": true,
    "optimizeNpm": true,
    "localNpmInstall": false,
    "serverInstall": true,
    "rootInstall": true,
    "nodeVersion": "20"
  }
}
```

---

## 3. Motores de Despliegue (`deploy`)

### A. Aplicaciones Estáticas (`deploy:spa`)
Optimizado para React, Vue, Vite, Angular, Svelte y HTML plano.
* **Comandos**:
  - `koram deploy:spa`: Inicia Dashboard web interactivo en `http://localhost:3889`.
  - `koram deploy:spa --now`: Despliegue directo sin abrir el navegador.
  - Flags opcionales: `-e, --env <entorno>`, `-h, --host <host>`, `-u, --user <user>`, `-p, --path <path>`, `--webserver`, `--no-webserver`.
* **Flujo**:
  1. Compila localmente con `deploy.buildCommand`.
  2. Conexión SSH segura (con soporte de llaves o password).
  3. Transferencia Delta mediante `rsync` (o compresión `tar.gz` de alto rendimiento como fallback).
  4. Despliegue atómico en `/var/www/<app>/releases/<timestamp>` y conmutación instantánea del symlink `/var/www/<app>/current`.
  5. Purga automática de releases antiguos (mantiene los últimos 5).
  6. Sincronización automática de Nginx (si está configurada).

### B. Aplicaciones Nuxt.js SSR / Node.js (`deploy:nuxt`)
Optimizado para SSR moderno con Nitro y gestión de procesos PM2.
* **Comando**:
  - `koram deploy:nuxt [alias]`: Lanza Dashboard interactivo en `http://localhost:3888`.
  - Flags opcionales: `-e, --env`, `-h, --host`, `-u, --user`, `-p, --path`, `--webserver`, `--no-webserver`.
* **Flujo y Optimizaciones Avanzadas**:
  1. **Build Local**: Ejecuta la compilación en la máquina local generando `.output`.
  2. **Purga de Módulos Locales**: Limpia módulos nativos compilados localmente en `.output/server/node_modules` para evitar incompatibilidades de arquitectura binaria.
  3. **Conexión SSH Paralela**: Inicia la conexión al servidor de forma asíncrona mientras compila.
  4. **Preparación con Auto-Elevación (`ensureRemoteDirectory`)**: Valida permisos en el servidor y, si es necesario, auto-repara permisos con `sudo`.
  5. **Transferencia Delta (Rsync / Tar)**: Sube `.output`, `package.json`, lockfiles y assets.
  6. **Smart Install Remoto**:
     - Calcula el hash SHA-256 de los lockfiles locales vs remotos (`.server_lockhash` y `.lockhash`). Si son idénticos, omite `npm install` ahorrando tiempo y memoria RAM en servidores pequeños.
     - Si difieren, detecta la arquitectura del servidor (`x64`, `arm64`) y el SO (`linux`, `darwin`) para instalar los binarios nativos correctos (`sharp`, `better-sqlite3`, `argon2`, `prisma`, etc.) con fallback escalonado a rebuild de código fuente.
  7. **Variables de Entorno**: Inyecta dinámicamente el archivo `.env` en el servidor con los valores de la sección `env`.
  8. **Recarga PM2 Zero-Downtime**: `pm2 reload <nombre> --update-env` o arranque inicial si no existía.

### C. Despliegue Tradicional PM2 (`deploy:pm2`)
Para backends estructurados con `ecosystem.config.js`.
* **Comando**: `koram deploy:pm2 [alias] -e <entorno>`
* Auto-detecta la sección correspondiente del ecosistema según el entorno (ej: `ecosystem.production.config.js`) y orquesta el despliegue con las credenciales de la bóveda.

### D. Otros Despliegues (`deploy:node`, `deploy:deno`)
* `koram deploy:node`: Despliegue de aplicaciones Node tradicionales.
* `koram deploy:deno`: Despliegue de servicios y scripts Deno en el servidor.

---

## 4. Observabilidad, Diagnóstico y Métricas

* **Logs Remotos en Vivo (`deploy:logs`)**:
  Permite ver la salida estándar y de error de los procesos PM2 remotos directamente en la terminal local:
  ```bash
  koram deploy:logs [alias] -e <entorno> -f -l 100
  ```
  - `-f, --follow`: Modo streaming en tiempo real.
  - `-l, --lines <n>`: Número de líneas históricas a recuperar.
  - `-e, --error`: Muestra únicamente logs de error (`stderr`).

* **Estado de Procesos Remotos (`deploy:ps`)**:
  Muestra una tabla con el estado, CPU, memoria consumida, uptime y reinicios de PM2 en el servidor:
  ```bash
  koram deploy:ps [alias]
  ```

* **Diagnóstico de Entorno (`doctor`)**:
  Audita el estado de dependencias locales, versiones de Node.js, consistencia de archivos `.koram-rc` y emite sugerencias de optimización:
  ```bash
  koram doctor
  ```

* **Limpieza de Proyecto (`clean`)**:
  Elimina carpetas `node_modules`, archivos `.output`, `dist`, cachés de NPM y temporales de manera guiada o forzada con `-y`:
  ```bash
  koram clean [-y]
  ```

* **Servidor de Vista Previa (`serve`)**:
  Levanta un servidor web local con live reload para probar compilaciones estáticas:
  ```bash
  koram serve [-p <puerto>] [-d <directorio>]
  ```

---

## 5. Servidor Web Nginx como Código (Nginx IaC)

Koram implementa un esquema simétrico donde la configuración local es la única fuente de verdad:
* **Ruta Local**: `.koram/webserver/${appName}-${env}.conf`
* **Ruta Remota**: `/etc/nginx/sites-available/${appName}-${env}.conf` con symlink en `sites-enabled/`.

### Comandos de Servidor Web
* **`koram add:webserver`**: Inicializa la configuración en `.koram-rc` y genera la plantilla local Nginx.
  - Flags: `-e <env>`, `-s <dominio>`, `--ssl`, `--proxyPass <url>` (ej: `http://127.0.0.1:3000`), `--port 80`.
* **`koram infra:webserver:gen -e <env>`**: Regenera la plantilla Nginx local a partir del JSON.
* **`koram infra:webserver -e <env>`**: Sincroniza la plantilla local hacia el servidor remoto Nginx y recarga el servicio.
* **`koram projects:topology`**: Inspecciona todos los proyectos y muestra el mapa de enrutamiento Nginx, puertos y dominios vinculados.

### Flujo Automatizado de Certificados SSL (Certbot Doble Fase)
1. **Fase Bootstrap**: Si los certificados de Let's Encrypt aún no existen en el VPS, Koram genera una plantilla provisional que solo escucha en el puerto 80, la sube y ejecuta Certbot de forma no interactiva:
   ```bash
   sudo certbot --nginx -d dominio.com --non-interactive --agree-tos -m admin@empresa.com
   ```
2. **Fase Final**: Una vez generados los certificados por Let's Encrypt, Koram sube la plantilla completa con SSL en puerto 443, redirección HTTP $\rightarrow$ HTTPS y recarga Nginx de forma segura.

---

## 6. Sistema de Backups (`backup`)

Permite programar o ejecutar copias de seguridad de bases de datos y carpetas, descargarlas por SFTP a la máquina local y aplicar políticas de retención.
* **Configuración en `.koram-rc.<env>.json`**:
  ```json
  "backup": {
    "configs": [
      {
        "name": "db-backup",
        "server": { "host": "191.101.235.199", "user": "root" },
        "database": {
          "type": "mongodb", // "mongodb" | "mysql" | "postgres"
          "name": "mi_bd",
          "user": "db_user",
          "pass": "db_pass",
          "authSource": "admin"
        },
        "keepLocal": 5,
        "keepRemote": 5,
        "outputDir": "./backups"
      },
      {
        "name": "archivos-uploads",
        "paths": [
          {
            "path": "/var/www/uploads",
            "compress": true,
            "exclude": ["*.tmp", "cache/*"]
          }
        ],
        "keepLocal": 5,
        "keepRemote": 5,
        "outputDir": "./backups"
      }
    ]
  }
  ```
* **Comandos**:
  - `koram add:backup`: Asistente interactivo para registrar tareas de backup.
  - `koram infra:backup -e <entorno>`: Ejecuta secuencialmente los dumps remotos, compresión en `.tar.gz`, descarga local a `./backups/` y purga de versiones antiguas según `keepLocal` y `keepRemote`.

---

## 7. Mantenimiento y Redes

* **Limpieza Remota de Espacio en Disco (`infra:clean`)**:
  Conéctate al servidor VPS y libera gigabytes de espacio en disco de forma interactiva y segura:
  ```bash
  koram infra:clean [alias]
  ```
  Permite seleccionar y limpiar:
  - Paquetes no utilizados y caché de APT (`apt-get autoremove`, `clean`).
  - Logs antiguos del sistema (`journalctl --vacuum-time=3d`).
  - Imágenes huérfanas, contenedores detenidos y volúmenes de Docker (`docker system prune`).
  - Cachés de NPM y temporales del sistema (`/tmp`).

* **Túnel Inverso (`infra:tunnel`)**:
  Expone un puerto local (ej: `3000`) a internet mediante un proxy SSH en un servidor VPS público:
  ```bash
  koram infra:tunnel <alias> -l 3000 -p 8080
  ```

* **Monitoreo Centralizado (`monitor`)**:
  - `koram monitor:setup <alias>`: Despliega automáticamente en el servidor el agente o hub de monitoreo con PM2 y auto-inicio en reboot.
  - `koram monitor:server`: Inicia el panel y servidor central del monitor.
  - `koram monitor:agent`: Inicia un agente centinela que recopila CPU, RAM y estado de procesos.

* **Vinculación con Agentes de IA (`agent:attach`)**:
  Inyecta y mantiene actualizado el conocimiento y reglas de Koram para que agentes de IA (Antigravity, Cursor, Claude Code, Copilot) entiendan el contexto operativo del proyecto:
  ```bash
  koram agent:attach           # Instala reglas en AGENTS.md, .gemini/, .cursorrules y CLAUDE.md
  koram agent:attach --global  # Instala reglas y skills globalmente para Antigravity
  ```
