# Koram

## *El Toolkit Komarquino*

*"La herramienta sagrada del buen desarrollador"*

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

---

## Comandos Místicos

| Comando             | Descripción                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **help**            | Muestra la guía de sabiduría de Koram.                                                                                                         |
| **login**           | Loguéate como un verdadero Wen Komarquino.                                                                                                     |
| **deploy****:init** | Inicializa el koram en tu proyecto.                                                                                                            |
| **deploy****:nuxt** | Invoca el deployer Python para proyectos Nuxt.                                                                                                 |
| **deploy****:spa**  | Invoca el deployer Python para SPA.                                                                                                            |
| **ui**              | Abre nuestro Libro Sagrado en tu navegador y contempla el poder del toolkit.                                                                   |
| **doctor**          | Realiza un chequeo completo del proyecto Node.js: Node, NPM, dependencias, vulnerabilidades y archivos sagrados. Sugiere rituales de sanación. |
| **clean**           | Purifica tu proyecto Node.js: elimina node\_modules, dist/build, cache de npm y logs temporales. Interactivo o automático con `-y`.            |
| **serve**           | Sirve tu proyecto Node.js o carpeta estática con live reload y ritual de protección. Opciones de puerto (`-p`) y ejecución automática (`-y`).  |

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



## El Legado Komarquino

Koram es la llave que conecta el conocimiento de los antiguos con la tecnología moderna.\
Solo los Komarquinos que lo dominen pueden desplegar proyectos con la precisión de un ritual ancestral.

---

## Komarca Labs

*"Forjando herramientas sagradas para desarrolladores legendarios"*
