# Guía de Backups de Bases de Datos y Archivos

`koram-cli` cuenta con un sistema de copias de seguridad (backups) robusto, automatizado e impulsado por tu archivo de configuración `.koram-rc.<env>.json`. Permite realizar respaldos de bases de datos y directorios de archivos de forma remota, empaquetarlos en un solo archivo comprimido, descargarlos de forma segura a tu máquina local y aplicar políticas de retención históricas automáticas tanto locales como remotas.

---

## 1. Arquitectura de Backups

La arquitectura del sistema de backups está pensada para ser flexible y segura:
* **Copias Consolidadas:** Cada tarea de backup genera un único archivo comprimido `.tar.gz` que consolida tanto el dump de base de datos como las rutas de archivos que configuraste.
* **Auto-Login SSH:** Se conecta de forma automática a los servidores utilizando la bóveda segura de credenciales de Koram.
* **Descarga Automática SFTP:** Los archivos resultantes se descargan inmediatamente a tu máquina local en la carpeta configurada (generalmente `./backups`), la cual es añadida automáticamente al `.gitignore` del proyecto para no subir gigabytes de backups a Git de forma accidental.
* **Políticas de Retención:** Tanto en local como en remoto, el CLI mantiene únicamente la cantidad de backups indicada (ej. los últimos 5), purgando las versiones antiguas de forma automatizada para no saturar los discos.

---

## 2. Configuración Declarativa (`.koram-rc.<env>.json`)

El bloque `"backup"` se organiza en un array de configuraciones en `configs` (simétrico a `webserver.configs`), lo que permite respaldar diferentes servidores e infraestructuras en un único entorno:

```json
"backup": {
  "configs": [
    {
      "name": "database-vps",
      "server": {
        "host": "191.101.235.199",
        "user": "root",
        "port": 22
      },
      "database": {
        "type": "mongodb",
        "name": "huntban_db",
        "user": "db_user",
        "pass": "db_password",
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
      "server": {
        "host": "191.101.235.182",
        "user": "root",
        "port": 22
      },
      "paths": [
        {
          "path": "/home/deploys/huntban-next/uploads",
          "compress": true,
          "exclude": [
            "*.tmp",
            "cache/*",
            "logs/*.log"
          ]
        }
      ],
      "keepLocal": 5,
      "keepRemote": 5,
      "outputDir": "./backups"
    }
  ]
}
```

### Explicación de Parámetros:

#### Generales del Backup
* `name`: Nombre único identificativo de la tarea de backup. Afecta al nombre del archivo descargado.
* `server` *(Opcional)*: Bloque con las credenciales SSH del servidor de backups si este difiere del servidor principal del proyecto (`server` raíz). Si se omite, se usa el servidor por defecto del proyecto.
* `keepLocal`: Cantidad de archivos de backup de esta tarea a mantener en tu máquina local.
* `keepRemote`: Cantidad de archivos de backup de esta tarea a mantener en el servidor VPS.
* `outputDir`: Directorio relativo en tu proyecto local donde se descargarán los archivos (ej: `./backups`).

#### Bases de Datos (`database`)
* `type`: Tipo de base de datos. Actualmente soportado: `"mongodb"` (`mongodump` con compresión gzip nativa). MySQL/PostgreSQL planificados en el backlog.
* `name`: Nombre de la base de datos a respaldar.
* `user` / `pass` *(Opcional)*: Usuario y contraseña de la base de datos.
* `host` / `port`: Host y puerto del servidor de base de datos remoto (por defecto `127.0.0.1:27017`).
* `authSource` *(Opcional)*: Base de datos donde se autentica el usuario (por defecto `"admin"`).

#### Rutas de Archivos (`paths`)
* `path`: Ruta física absoluta de la carpeta o archivo en el servidor remoto.
* `compress`: Si es `true`, comprime el directorio.
* `exclude` *(Opcional)*: Array de patrones glob que serán omitidos por `tar` durante la compresión. Es ideal para ignorar carpetas temporales, logs, node_modules, cachés o multimedia innecesaria.
  * Ejemplos: `*.tmp`, `cache/*`, `logs/*.log`.

---

## 3. Comandos de Backups

### A. Agregar/Configurar Backup (`koram add:backup`)
Inicia un asistente interactivo en consola para agregar o actualizar una tarea de backup.
```bash
koram add:backup [flags]
```
#### Flags:
* `-e, --env`: Entorno del proyecto para configurar el backup (ej. `production`, `staging`). Si no se pasa, lo pregunta de forma interactiva.
* `-n, --name`: Nombre identificativo de la tarea de backup.
* `-f, --force`: Sobrescribe una tarea existente con el mismo nombre sin confirmación interactiva.

> [!TIP]
> **Inicialización al Vuelo:** Si ejecutas `koram add:backup` en un proyecto donde aún no has creado un archivo `.koram-rc.*.json`, el CLI te ofrecerá inicializar automáticamente un archivo por defecto (`.koram-rc.production.json`) con la estructura base del toolkit, y luego continuará el asistente para añadir el backup en el archivo creado.

---

### B. Ejecutar Backups (`koram infra:backup`)
Ejecuta de forma secuencial y automatizada todas las tareas de backup declaradas en el array `configs` del archivo `.koram-rc.<env>.json`.
```bash
koram infra:backup [flags]
```
#### Flags:
* `-e, --env`: Entorno del proyecto para ejecutar los backups. Si no se pasa, te permite elegirlo de una lista.

#### Flujo de Ejecución Interno por cada Configuración:
1. **Conexión SSH:** Se conecta al host definido en el bloque `server` del backup (o cae al de la app).
2. **Workspace Temporal:** Crea un directorio remoto temporal `/tmp/koram-backup-<name>-<timestamp>`.
3. **Database Dump:** Genera el volcado gzip de MongoDB y lo guarda en el workspace temporal.
4. **Compresión de Rutas:** Comprime cada directorio remoto configurado y aplica las exclusiones mediante `tar --exclude`, depositándolo en el workspace temporal.
5. **Consolidación:** Empaqueta todo el workspace temporal remoto en un solo `.tar.gz` remoto final en el directorio de históricos del VPS.
6. **Descarga SFTP:** Transfiere el archivo `.tar.gz` final al directorio local (ej: `./backups/`) y añade la ruta al `.gitignore` si no estaba ya.
7. **Limpieza Temporal:** Borra el workspace temporal `/tmp` del servidor.
8. **Políticas de Retención:** Purga copias antiguas en el VPS y localmente basándose en los parámetros de retención configurados.

---

## 4. Nomenclatura de Archivos Generados

Los archivos de backup descargados localmente siguen un formato simétrico e informativo:
```
./backups/${appName}-${backupName}-${env}-${timestamp}.tar.gz
```
**Ejemplo:**
`./backups/mi-app-database-vps-production-20260802_12-30-00.tar.gz`

---

## 5. Estrategias de Ejecución y Recomendaciones

El comando `koram infra:backup` puede ejecutarse bajo diferentes esquemas físicos dependiendo de tus políticas de mantenimiento.

### Caso A: Ejecutado desde tu Computadora Local (Orquestación del Desarrollador)
* **Comportamiento:** El CLI se conecta vía SSH al VPS remoto, ejecuta los volcados y compresiones allí, descarga el `.tar.gz` consolidado a la carpeta `./backups` de tu PC local y sube el archivo a S3 directamente utilizando las credenciales guardadas en la bóveda de tu máquina local.
* **Cuándo usarlo:** Ideal para backups rápidos preventivos antes de un despliegue crítico, cambios de base de datos en caliente o revisiones manuales de mantenimiento.

### Caso B: Ejecutado desde un Servidor Centralizado (Recomendado para Producción)
Si gestionas múltiples proyectos o clientes, la mejor práctica de arquitectura es contar con un **Servidor de Administración o Monitoreo centralizado** (por ejemplo, el mismo VPS donde se aloja `koram monitor:server`).
* **Comportamiento:** Clonas los repositorios de tus proyectos en el Servidor Central, configuras sus respectivas credenciales locales de S3 y servidores SSH remotos, y programas un cron job en Linux para que ejecute los backups a horas de bajo tráfico.
* **Ventajas:** Aísla por completo a tus VPS de producción del consumo de ancho de banda y CPU requeridos para subir archivos pesados a S3, y consolida todos tus backups históricos ordenadamente en un disco de administración centralizado.
* **Ejemplo de Cron Job diario (a las 2:00 AM):**
  ```bash
  0 2 * * * cd /home/administrador/mi-proyecto && koram infra:backup -e production >> /var/log/koram-backups.log 2>&1
  ```

### Caso C: Ejecutado directamente desde el VPS de la App (Autónomo)
* **Comportamiento:** Si instalas `koram-cli` en el mismo servidor VPS donde corre tu aplicación, configuras el host del servidor como `localhost` o `127.0.0.1`. El CLI realizará el dump local, empaquetará el `.tar.gz` en la carpeta `./backups/` dentro del proyecto en el mismo VPS, y realizará la subida a S3 directamente usando las credenciales del servidor.
* **Cuándo usarlo:** Útil si deseas automatización descentralizada y que cada servidor se encargue de resguardarse de forma aislada.

### Recomendaciones Prácticas:
1. **Exclusiones Inteligentes (`exclude`):** Modifica tus paths de archivos para excluir de forma proactiva archivos que no aportan valor histórico (ej. `*.log`, `tmp/*`, `cache/*`, `node_modules/*`). Esto aligera significativamente el peso del archivo final comprimido, acelerando la descarga SFTP y reduciendo costos de transferencia.
2. **Diferenciación de Servidores (`backup.server`):** Si tu MongoDB se aloja en un servidor dedicado de base de datos y tu servidor web en otro, aprovéchate del array de configs. Define un bloque `server` diferente para cada backup, y Koram abrirá de forma autónoma conexiones SSH hacia cada VPS de manera secuencial y ordenada.
