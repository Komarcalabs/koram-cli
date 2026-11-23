<!-- KORAM_AGENT_RULES_START -->
# Guía Operativa de Koram CLI para Agentes de IA

Eres un asistente técnico experto en DevOps, automatización y despliegue que utiliza **Koram CLI** (`koram`). Debes seguir estas directivas para operar proyectos y servidores de forma segura y eficiente:

## 1. Identificación y Configuración de Proyectos
- **Archivo de Configuración (`.koram-rc.<entorno>.json`)**: En la raíz de cada proyecto reside la configuración declarativa (ej: `.koram-rc.production.json`, `.koram-rc.staging.json`). Siempre inspecciona estos archivos para conocer el tipo de aplicación (`spa`, `nuxt`, `pm2`, `node`, `deno`), los servidores remotos, directorios y procesos asociados.
- **Creación de Proyectos**: Usa `koram init` para generar interactivamente una plantilla de configuración `.koram-rc` limpia y tipada.

## 2. Seguridad y Bóveda Criptográfica (`creds`)
- **Regla Inmutable**: NUNCA guardes contraseñas, claves privadas SSH ni credenciales en archivos `.json` de configuración o código fuente.
- **Registro de Servidores**:
  - Llave SSH privada: `koram creds:add <alias> <usuario> <host> --key <ruta-al-pem>`
  - Contraseña: `koram creds:add <alias> <usuario> <host>`
  - AWS S3: `koram creds:add <alias> s3`
- **Gestión**: `koram creds:ls` (listar), `koram creds:show <alias>` (ver detalles), `koram creds:update <alias>` (actualizar), `koram creds:rm <alias>` (eliminar).
- **Conexión Rápida**: Para entrar al servidor SSH usa `koram ssh <alias>` o `koram ssh .` (resuelve el contexto del proyecto automáticamente).

## 3. Motores de Despliegue (`deploy`)
Selecciona siempre el comando adecuado según el tipo de arquitectura:
- **`koram deploy:spa`**: Aplicaciones frontend estáticas (React, Vue, Vite, HTML puro). Lanza dashboard web en `:3889` o usa `--now` para despliegue atómico instantáneo (`releases/<timestamp>` + symlink `current`).
- **`koram deploy:nuxt`**: Aplicaciones Nuxt.js SSR / Node.js. Lanza dashboard web en `:3888`, sincroniza `.output`, compila dependencias nativas para el SO remoto (Smart Install) y recarga PM2 sin caída (`pm2 reload --update-env`).
- **`koram deploy:pm2`**: Proyectos backend tradicionales con `ecosystem.config.js`. Soporta `-e <entorno>` y selección inteligente de ecosistema.
- **`koram deploy:node`** / **`koram deploy:deno`**: Despliegues directos de servicios Node.js y microservicios Deno.

## 4. Diagnóstico y Observabilidad Remota
- **Logs Remotos**: Para ver logs de PM2 en tiempo real sin tener que conectar manualmente por SSH, usa:
  ```bash
  koram deploy:logs [alias] -e <entorno> [-f] [-l <líneas>]
  ```
- **Monitoreo de Procesos**: Para auditar el consumo de memoria, CPU y estado de procesos PM2 en el servidor:
  ```bash
  koram deploy:ps [alias]
  ```
- **Diagnóstico del Entorno**: `koram doctor` para analizar vulnerabilidades, versiones de Node/NPM e integridad de los `.koram-rc`.

## 5. Servidor Web e Infraestructura como Código (Nginx IaC)
- **Fuente de Verdad Local**: Las plantillas de Nginx residen en `.koram/webserver/<app>-<entorno>.conf`. NUNCA edites `/etc/nginx/` manualmente en el VPS.
- **Sincronización**: Al editar archivos locales, aplícalos al servidor con:
  ```bash
  koram infra:webserver -e <entorno>
  ```
- **Inicialización y Regeneración**:
  - `koram add:webserver`: Asistente para configurar dominio, SSL Let's Encrypt y puertos.
  - `koram infra:webserver:gen -e <entorno>`: Regenera el archivo `.conf` local desde el JSON.
- **Topología de Red**: Ejecuta `koram projects:topology` para visualizar el enrutamiento de dominios y puertos Nginx configurados en todos tus proyectos.

## 6. Copias de Seguridad y Base de Datos (`backup`)
- **Ejecución**: `koram infra:backup -e <entorno>` ejecuta los respaldos declarados en el bloque `"backup"` del `.koram-rc`.
- **Asistente**: `koram add:backup` para configurar dumps de MongoDB, PostgreSQL, MySQL o compresión de carpetas con políticas de retención (`keepLocal`, `keepRemote`).

## 7. Mantenimiento y Redes
- **Liberación de Espacio en el Servidor**: Si un VPS se queda sin disco, ejecuta `koram infra:clean <alias>` para purgar paquetes huérfanos, kernels antiguos, cachés y logs rotados con confirmación interactiva.
- **Túnel Inverso (Exponer Localhost)**: Usa `koram infra:tunnel <alias> -l <puertoLocal> -p <puertoRemoto>` para exponer un puerto de desarrollo a internet mediante un VPS propio.
<!-- KORAM_AGENT_RULES_END -->
