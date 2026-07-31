# Guía Detallada de Despliegues (SPA, Nuxt y PM2)

`koram-cli` provee tres motores de despliegue altamente especializados y optimizados para distintos tipos de aplicaciones y arquitecturas de servidor. Esta guía explica el funcionamiento, configuración y paso a paso para cada uno de ellos.

---

## 1. Conceptos Comunes y Prerrequisitos

Antes de iniciar cualquier despliegue, debes configurar las credenciales del servidor VPS de destino. Koram almacena estas credenciales de forma cifrada en la bóveda de llaves del sistema (`keytar`), por lo que solo se registran una vez.

### Registrar un Servidor Remoto
Ejecuta el comando para registrar las credenciales bajo un alias único:
```bash
koram creds:add mi-vps-alias --user root --host 64.23.174.86 --port 22
```
*Te solicitará la contraseña de forma interactiva y la guardará de manera segura.*

---

## 2. Despliegue de Sitios Estáticos (SPA)

Diseñado para aplicaciones que se compilan a archivos estáticos (HTML, JS, CSS) como React, Vue, Vite, Angular, Svelte o sitios HTML planos.

### Comando de Ejecución
*   **Modo Interactivo (Recomendado):** Abre un dashboard web de control local en el puerto `3889` para pre-visualizar y editar parámetros antes de desplegar.
    ```bash
    koram deploy:spa
    ```
*   **Modo Directo (Headless):** Ejecuta el despliegue de inmediato en segundo plano (útil para pipelines CI/CD o ejecución rápida).
    ```bash
    koram deploy:spa --now
    ```

### Estructura de Configuración (`.koram-rc.<env>.json`)
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

### Explicación de Parámetros
*   `type`: Debe ser `"spa"`.
*   `deploy.path`: Ruta física en el servidor VPS donde se guardará la app (ej: `/var/www/mi-app`).
*   `deploy.buildCommand`: Comando local ejecutado para compilar la aplicación.
*   `deploy.outputDir`: Carpeta generada localmente con los estáticos listos (ej: `dist`, `build` o `public`).
*   `deploy.atomicDeploys`: Si es `true` (por defecto), crea una estructura de lanzamientos atómicos (`releases/` con marcas de tiempo y un enlace simbólico `current/` para revertir o desplegar en milisegundos sin inactividad).
*   `deploy.webserver.autoApply`: Sincroniza automáticamente la plantilla local de Nginx al terminar.

### Flujo Interno de Despliegue
1.  **Build Local:** Ejecuta `deploy.buildCommand` en tu máquina.
2.  **Conexión SSH:** Se conecta al VPS usando las credenciales seguras asociadas al host.
3.  **Transferencia Sincronizada (Rsync/Tar):** 
    *   Si tienes instalado `rsync` y `sshpass`, sube únicamente los archivos que cambiaron (despliegue Delta ultra rápido).
    *   Si no, genera un paquete `tar.gz`, lo sube y lo extrae en el VPS (método clásico).
4.  **Cambio Atómico de Enlace (Symlink):** Cambia el symlink `/var/www/mi-app/current` apuntando a la nueva versión en `releases/<timestamp>`.
5.  **Limpieza:** Borra los releases antiguos en el servidor remoto, manteniendo solo las últimas 5 versiones.
6.  **Sincronización Nginx:** Si `autoApply` es `true`, aplica la plantilla local `.koram/webserver/mi-app-estatica-<env>.conf` en `/etc/nginx/sites-available/` y recarga Nginx.

---

## 3. Despliegue de Nuxt.js (SSR / Servidor Node)

Diseñado para aplicaciones Nuxt.js universales (Server-Side Rendering) que necesitan ejecutarse mediante Node.js en el servidor y ser administradas por un gestor de procesos como PM2.

### Comando de Ejecución
*   **Modo Interactivo (Recomendado):** Lanza el dashboard local en el puerto `3888` para controlar el proceso.
    ```bash
    koram deploy:nuxt
    ```

### Estructura de Configuración (`.koram-rc.<env>.json`)
```json
{
  "name": "mi-app-nuxt",
  "type": "nuxt",
  "server": {
    "host": "64.23.174.86",
    "user": "root"
  },
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

### Explicación de Parámetros
*   `type`: Debe ser `"nuxt"`.
*   `deploy.outputDir`: Carpeta de salida de compilación Nuxt (por defecto `.output`).
*   `packageManager`: Gestor de paquetes usado en el servidor (`npm` o `pnpm`).
*   `processes`: Lista de comandos PM2 para levantar o recargar la aplicación en el servidor remoto.
*   `advanced.usePm2`: Controla si Koram administra y reinicia los procesos en PM2 tras subir los archivos.
*   `advanced.optimizeNpm`: Si es `true`, optimiza la instalación de dependencias en el VPS usando caches locales.
*   `advanced.localNpmInstall`: Si es `true`, ejecuta `npm install` localmente antes de compilar.
*   `env.PORT`: Puerto interno sobre el cual escuchará la aplicación Node/Nuxt en el servidor. El Nginx local mapeará automáticamente el proxy reverso a este puerto.

### Flujo Interno de Despliegue
1.  **Build Local:** Genera la carpeta compilada `.output` en local.
2.  **Sincronización SSH:** Abre la sesión en el VPS.
3.  **Subida Delta (Rsync/Tar):** Transfiere `.output`, `package.json` y los lockfiles correspondientes.
4.  **Smart Install (Instalación Inteligente de Dependencias):**
    *   Compara el hash del `package-lock.json` local con el remoto.
    *   **Si son idénticos:** Salta la instalación de dependencias en el servidor (ahorrando hasta 2 minutos de deploy).
    *   **Si son diferentes:** Instala únicamente las dependencias de producción en el VPS y reconstruye los módulos nativos.
5.  **Configuración de Entorno:** Genera y escribe el archivo `.env` en la carpeta del VPS con las variables declaradas en el bloque `env` (incluyendo el `PORT`).
6.  **Reinicio PM2:** Ejecuta `pm2 reload <proceso> --update-env` en el servidor para activar el nuevo código sin caída de servicio.
7.  **Sincronización Nginx:** Si `autoApply` es `true`, sincroniza Nginx redireccionando el proxy de puerto hacia `http://127.0.0.1:<PORT>`.

---

## 4. Despliegue PM2 Tradicional (Git / Comandos)

Diseñado para aplicaciones backend tradicionales o servicios Node.js que ya cuentan con un archivo de configuración `ecosystem.config.js` y dependen del motor de despliegue nativo de PM2 (`pm2 deploy`).

### Comando de Ejecución
```bash
koram deploy:pm2 [alias] [flags]
```

#### Parámetros y Flags
*   `alias`: Alias del servidor de destino o `.` para usar la configuración local. Si no se pasa, **Koram te preguntará interactivamente qué archivo `.koram-rc` deseas mapear**.
*   `-e, --env`: Entorno configurado en el bloque del ecosistema.
*   `-x, --extra`: Parámetros extras que se desees inyectar al comando PM2 (ej: `--force`).
*   `-k, --sshKey`: Bandera para omitir la contraseña de la bóveda de Koram y forzar el uso de llaves SSH cargadas en el agente local.

### Estructura de Configuración (`ecosystem.config.js`)
```javascript
module.exports = {
  apps: [{
    name: 'mi-api',
    script: 'dist/index.js'
  }],
  deploy: {
    production: {
      user: 'root',
      host: '64.23.174.86',
      ref: 'origin/main',
      repo: 'git@github.com:empresa/mi-api.git',
      path: '/var/www/mi-api',
      'post-deploy': 'npm install && npm run build && pm2 reload mi-api'
    }
  }
};
```

### Estructura de Configuración Asociada (`.koram-rc.<env>.json`)

Koram utiliza este archivo para autodetectar de forma interactiva qué entorno se va a subir y mapear dinámicamente las credenciales seguras del servidor desde la bóveda de llaves local, evitando preguntas de passwords.

```json
{
  "name": "mi-app-api",
  "server": {
    "host": "64.23.174.86",
    "user": "root"
  }
}
```

### Explicación de Parámetros de Koram RC
*   `server.host`: La dirección IP pública del servidor VPS remoto configurado en tu ecosistema. Sirve como llave de búsqueda para extraer el password de la bóveda.
*   `server.user`: El usuario SSH con el que se iniciará la sesión remota para ejecutar la recarga.

### Flujo Interno de Despliegue
1.  **Detección de Archivo:** Escanea el proyecto en busca de archivos `ecosystem.config.js` (o extensiones `.cjs`, `.ts`).
2.  **Resolución de Entorno y Configuración:**
    *   Lee la configuración del entorno seleccionado (`.koram-rc.<env>.json`).
    *   Extrae el `user` y `host` de dicho archivo (o del `ecosystem` si no hay rc).
3.  **Auto-login y Recuperación de Password:**
    *   Busca en la bóveda segura (`keytar`) el password asociado a ese `user@host`.
    *   Si lo encuentra, crea un archivo temporal encriptado y ejecuta el despliegue PM2 prefijado con `sshpass`, **evitando que debas escribir contraseñas en consola**.
4.  **Ejecución PM2:** Ejecuta el comando nativo `pm2 deploy <file> <env>`, el cual hace Git clone/pull en el servidor y corre las tareas de post-despliegue definidas.
5.  **Limpieza:** Elimina físicamente de la memoria y disco el archivo temporal de contraseñas de forma segura al finalizar.
