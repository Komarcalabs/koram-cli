# Koram

## _El Toolkit Komarquino_

_"La herramienta sagrada del buen desarrollador"_

---

## Presentación de Komarca Labs

En los albores del código, los desarrolladores buscaban un artefacto que guiara sus proyectos, que iluminara el camino entre la complejidad y la creatividad.\
**Komarca Labs** lo ha forjado:\
**Koram**, la herramienta sagrada del buen Komarquino.

---

## Versión Sagrada

```
koram/0.1.2 darwin-arm64 node-v22.9.0
```

---

## El Camino del buen Komarquino

Koram no es solo una herramienta; es un ritual, un compendio de poderes ancestrales para los que buscan la perfección en el desarrollo.

---

## Instalación

Koram se instala globalmente mediante **npm**:

```bash
npm i -g koram
```

**Uso**:

```
$ koram [COMMAND]
```

---

## Temas del Saber Komarquino

| Tema         | Descripción                                                                             |
| ------------ | --------------------------------------------------------------------------------------- |
| **deploy**   | Inicializa un archivo `.koram-rc` en tu proyecto, marcando el inicio de la creación.    |
| **projects** | Lista todos los proyectos Koram en un directorio, revelando tu legado de desarrollador. |
| **monitor**  | Vigilancia constante de tus VPS y procesos PM2, el ojo que todo lo ve.                  |

---

## Comandos Místicos

| Comando                    | Descripción                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **help**                   | Muestra la guía de sabiduría de Koram.                                                                                                         |
| **login**                  | Loguéate como un verdadero Wen Komarquino.                                                                                                     |
| **deploy\*\***:init\*\*    | Inicializa el koram en tu proyecto.                                                                                                            |
| **deploy\*\***:nuxt\*\*    | Invoca el deployer Python para proyectos Nuxt.                                                                                                 |
| **deploy\*\***:spa\*\*     | Invoca el deployer Python para SPA.                                                                                                            |
| **ui**                     | Abre nuestro Libro Sagrado en tu navegador y contempla el poder del toolkit.                                                                   |
| **doctor**                 | Realiza un chequeo completo del proyecto Node.js: Node, NPM, dependencias, vulnerabilidades y archivos sagrados. Sugiere rituales de sanación. |
| **clean**                  | Purifica tu proyecto Node.js: elimina node_modules, dist/build, cache de npm y logs temporales. Interactivo o automático con `-y`.             |
| **serve**                  | Sirve tu proyecto Node.js o carpeta estática con live reload y ritual de protección. Opciones de puerto (`-p`) y ejecución automática (`-y`).  |
| **monitor\*\***:server\*\* | Inicia el Gran Ojo, el servidor central que recibe las visiones de todos tus agentes.                                                          |
| **monitor\*\***:agent\*\*  | Despliega un centinela en tu VPS para informar constantemente sobre la salud del sistema y PM2.                                                |

---

## Koram Deploy

`koram deploy` permite realizar despliegues automáticos de tus proyectos usando alias de servidores y PM2.

### Flujo de uso

1. Guardar credencial(contraseñas) con alias:

```bash
koram creds:add <alias> --user <usuario> --host <ip_servidor>
```

2. Ejecutar deploy:

```bash
koram deploy <alias> [flags]
```

### Flags

| Flag            | Descripción                                                |
| --------------- | ---------------------------------------------------------- |
| `-e, --env`     | Define el entorno a usar. Por defecto: `production`.       |
| `-x, --extra`   | Parámetros extra opcionales para pasar a PM2.              |
| `-k, --ssh-key` | Omitir la contraseña guardada y usar llave SSH autorizada. |

### Ejemplos

- Deploy usando la contraseña guardada:

```bash
koram deploy bb_server
```

- Deploy usando llave SSH:

```bash
koram deploy bb_server --ssh-key
```

- Deploy en otro entorno:

```bash
koram deploy bb_server --env staging
```

- Deploy con parámetros extra:

```bash
koram deploy bb_server --extra "--update-env"
```

### Comportamiento

- Selecciona credencial automáticamente según alias.
- Permite seleccionar entre múltiples credenciales o archivos `ecosystem.config.js`.
- Muestra logs en tiempo real.
- Compatible con deploy por contraseña o SSH key.

---

## Koram Monitor (El Ojo que todo lo ve)

`koram monitor` te permite centralizar la vigilancia de múltiples VPS en un solo Dashboard místico.

### 1. El Gran Ojo (Servidor Central)

Inicia el servidor que recibirá los reportes de todos tus centinelas.

```bash
koram monitor:server --port 3000 --key <tu_secret_key>
```

- **Dashboard**: Disponible en `http://localhost:3000/`. Permanecerá público a menos que se use el flag `--auth`.
- **Seguridad**: Los agentes **siempre** requieren la clave para reportar. El Dashboard puede protegerse y personalizarse con:
  ```bash
  koram monitor:server --port 3000 --key <tu_secret_key> --auth --user admin --pass secreto123
  ```
  _(Si se activa `--auth`, usa las credenciales definidas o los valores por defecto: Usuario: `koram` / Contraseña: `<la_key_que_definiste_en_-k>`)\_.

### 2. El Centinela (Agente de Monitoreo)

Despliega el agente en cada uno de tus VPS para que informe su estado.

```bash
koram monitor:agent --url http://tu-servidor-central.com:3000 --key <tu_secret_key> --name <nombre_vps>
```

#### Parámetros del Centinela:

| Flag             | Descripción                                                |
| ---------------- | ---------------------------------------------------------- |
| `-u, --url`      | La URL donde reside el Gran Ojo.                           |
| `-k, --key`      | La llave sagrada para autenticarse.                        |
| `-n, --name`     | Nombre del VPS (opcional, usa el hostname por defecto).    |
| `-i, --interval` | Frecuencia de los informes en segundos. Por defecto: `60`. |

---

### Flags del Servidor (El Gran Ojo):

| Flag         | Descripción                                                          |
| ------------ | -------------------------------------------------------------------- |
| `-p, --port` | Puerto donde escuchará el servidor. Por defecto: `3000`.             |
| `-k, --key`  | La llave sagrada que deben usar los agentes para reportar.           |
| `-a, --auth` | Si se incluye, el Dashboard requerirá login (Basic Auth).            |
| `--user`     | Usuario personalizado para el Dashboard (por defecto: `koram`).      |
| `--pass`     | Contraseña personalizada para el Dashboard (por defecto: `API_KEY`). |

---

## Ejecución en Segundo Plano (Background)

Para que el Monitor sea eterno, puedes usar **PM2** para correr tanto el servidor como los agentes:

### 1. Correr el Servidor en el Central

```bash
pm2 start "koram monitor:server --port 3000 --key <clave> --auth" --name koram-server
```

### 2. Correr el Agente en cada VPS

```bash
pm2 start "koram monitor:agent --url http://monitor.tu-dominio.com --key <clave> --name VPS-1" --name koram-agent
```

### 3. Guardar estado

```bash
pm2 save
```

---

## El Legado Komarquino

Koram es la llave que conecta el conocimiento de los antiguos con la tecnología moderna.
Solo los Komarquinos que lo dominen pueden desplegar proyectos con la precisión de un ritual ancestral.

---

## Komarca Labs

_"Forjando herramientas sagradas para desarrolladores legendarios"_
