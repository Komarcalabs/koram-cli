# Koram CLI — El Toolkit Sagrado de Komarca Labs

[![npm version](https://img.shields.io/npm/v/koram.svg?style=flat-square&color=blue)](https://www.npmjs.com/package/koram)
[![npm downloads](https://img.shields.io/npm/dm/koram.svg?style=flat-square&color=green)](https://www.npmjs.com/package/koram)
[![GitHub Repository](https://img.shields.io/badge/GitHub-Komarcalabs%2Fkoram--cli-181717.svg?style=flat-square&logo=github)](https://github.com/Komarcalabs/koram-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

> **Koram** (`koram-cli`) es el toolkit sagrado y oficial de DevOps, automatización de infraestructura y orquestación de despliegues desarrollado por **Komarca Labs** (**Komarcalabs**).

---

## 🏛️ Presentación de Komarca Labs (Komarcalabs)

En los albores del código, los desarrolladores buscaban un artefacto que guiara sus proyectos, que iluminara el camino entre la complejidad y la creatividad.\
**Komarca Labs** (**Komarcalabs**) lo ha forjado:\
**Koram**, la herramienta sagrada del buen **Komarquino**.

Koram centraliza en una sola herramienta de línea de comandos (CLI) el ciclo de vida operativo de tus aplicaciones: despliegues atómicos (Nuxt.js SSR, SPAs con Vite/React/Vue, PM2), gestión de servidores web Nginx con SSL automático por Let's Encrypt (IaC), monitoreo centralizado de VPS, túneles reversos sobre SSH y copias de seguridad automatizadas de bases de datos y archivos.

---

## El Camino del buen Komarquino

Koram no es solo una herramienta; es un ritual, un compendio de poderes ancestrales para los que buscan la perfección en el desarrollo.

---

## Instalación

Puedes instalar Koram de múltiples formas. La forma recomendada y más rápida es usar nuestros scripts automáticos (que también instalarán Node.js si no lo tienes).

**🍎 Para Mac o 🐧 Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/Komarcalabs/koram-cli/master/install.sh | bash
```

**🪟 Para Windows (PowerShell como Administrador):**

```powershell
iwr -useb https://raw.githubusercontent.com/Komarcalabs/koram-cli/master/install.ps1 | iex
```

**📦 Instalación manual (vía npm):**
Si ya tienes Node.js configurado, simplemente corre:

```bash
npm i -g koram
```

> [!TIP]
> **Koram Smart Lite**: La instalación es rápida y ligera. El entorno de Python (necesario para algunos despliegues Nuxt/SPA) se omitirá si no está disponible. Si luego intentas usar un comando de deploy, Koram te preguntará si deseas configurarlo en ese momento de forma interactiva.

**Uso**:

```
$ koram [COMMAND]
```

---

## Temas del Saber Komarquino

| Tema          | Descripción                                                                             |
| ------------- | --------------------------------------------------------------------------------------- |
| **deploy**    | Inicializa un archivo `.koram-rc` en tu proyecto, marcando el inicio de la creación.    |
| **projects**  | Lista todos los proyectos Koram en un directorio, revelando tu legado de desarrollador. |
| **monitor**   | Vigilancia constante de tus VPS y procesos PM2, el ojo que todo lo ve.                  |
| **webserver** | Gestión de servidores web (Nginx) con IaC, Certbot y SSL automatizado.                  |
| **backup**    | Respaldo de bases de datos (MongoDB) y archivos remotos con retención y exclusión.     |

---

## Comandos Místicos

| Comando                         | Descripción                                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **help**                        | Muestra la guía de sabiduría de Koram.                                                                                                         |
| **login**                       | Loguéate como un verdadero Wen Komarquino.                                                                                                     |
| **deploy\*\***:init\*\*         | Inicializa el koram en tu proyecto.                                                                                                            |
| **deploy\*\***:nuxt\*\*         | Invoca el deployer Python para proyectos Nuxt.                                                                                                 |
| **deploy\*\***:spa\*\*          | Invoca el deployer Python para SPA.                                                                                                            |
| **ui**                          | Abre nuestro Libro Sagrado en tu navegador y contempla el poder del toolkit.                                                                   |
| **doctor**                      | Realiza un chequeo completo del proyecto Node.js: Node, NPM, dependencias, vulnerabilidades y archivos sagrados. Sugiere rituales de sanación. |
| **clean**                       | Purifica tu proyecto Node.js: elimina node_modules, dist/build, cache de npm y logs temporales. Interactivo o automático con `-y`.             |
| **serve**                       | Sirve tu proyecto Node.js o carpeta estática con live reload y ritual de protección. Opciones de puerto (`-p`) y ejecución automática (`-y`).  |
| **monitor\*\***:server\*\*      | Inicia el Gran Ojo, el servidor central que recibe las visiones de todos tus agentes.                                                          |
| **monitor\*\***:agent\*\*       | Despliega un centinela en tu VPS para informar constantemente sobre la salud del sistema y PM2.                                                |
| **monitor\*\***:setup\*\*       | Comandante de flota: despliega automáticamente el Servidor o el Agente en un remoto usando SSH.                                                |
| **add\*\***:webserver\*\*       | Configura interactiva y localmente el bloque webserver de tu app.                                                                              |
| **infra\*\***:webserver\*\*     | Aplica y sincroniza la configuración Nginx en el servidor remoto con auto-SSL Certbot.                                                         |
| **infra\*\***:webserver:gen\*\* | Genera localmente la plantilla de configuración de Nginx en `.koram/webserver/`.                                                               |
| **add\*\***:backup\*\*          | Configura interactiva y localmente el bloque de backups de tu app.                                                                             |
| **infra\*\***:backup\*\*         | Ejecuta copias de seguridad de bases de datos y carpetas descargándolas en local y aplicando retención.                                         |

---

## ⚔️ Módulos Sagrados y Guías de Uso

Koram está dividido en cuatro grandes reinos funcionales. Cada uno cuenta con una guía dedicada y detallada paso a paso para facilitar su lectura en GitHub:

---

### 📦 1. Motores de Despliegue (SPA, Nuxt y PM2)

Koram cuenta con tres comandos especializados para realizar despliegues automáticos e inteligentes de tus proyectos, mapeando configuraciones a entornos remotos.

- **Despliegue de Sitios Estáticos (`koram deploy:spa`)**: Compila localmente, sube por Rsync/Tar delta, crea lanzamientos atómicos y purga versiones antiguas. Posee un dashboard gráfico en el puerto `3889`.
- **Despliegue de Nuxt.js / Node SSR (`koram deploy:nuxt`)**: Compila en local, sube el código, ejecuta instalación inteligente (`Smart Install`), crea el archivo `.env` dinámico e inicia/recarga los procesos en PM2. Posee un dashboard gráfico en el puerto `3888`.
- **Despliegue Tradicional de PM2 (`koram deploy:pm2`)**: Ejecuta el despliegue nativo de PM2 mediante `ecosystem.config.js` y auto-resolución de credenciales desde la bóveda segura de Koram.

👉 **Para ver el detalle de cada parámetro de configuración y guías paso a paso, lee la [Guía Detallada de Despliegues (docs/deployments.md)](docs/deployments.md).**

---

### 🌐 2. Servidor Web y SSL (Nginx & Certbot)

Automatización completa del servidor web Nginx, integrando un esquema simétrico de Infraestructura como Código (IaC) y aprovisionamiento SSL automático.

- **Plantillas locales (`.koram/webserver/`)**: Los archivos de configuración se editan localmente y se guardan en Git. Actúan como la fuente de verdad.
- **Certificación SSL en dos fases**: Genera un bootstrap temporal en puerto 80, ejecuta Certbot no-interactivamente y sube la configuración final HTTPS recargando el servicio de forma segura.
- **Servidores Separados**: Mapea despliegues de código a un servidor interno y configuraciones Nginx a un VPS de balanceador/frontal de forma transparente.

👉 **Para ver la guía de comandos Nginx y flujos de automatización SSL, lee la [Guía de Servidor Web y Nginx (docs/webserver.md)](docs/webserver.md).**

---

### 🔌 3. Túnel de Infraestructura (Koram Tunnel)

Expón instantáneamente cualquier puerto local de tu máquina de desarrollo (localhost) al internet, utilizando uno de tus propios servidores VPS remotos como un proxy inverso seguro sobre SSH.

- Ideal para webhooks, pruebas de API móviles o demostraciones a clientes en vivo.
- Liberación automática de puertos en el servidor remoto si ya están ocupados.

👉 **Para ver el funcionamiento y flags del túnel de proxy inverso, lee la [Guía del Túnel de Infraestructura (docs/tunnel.md)](docs/tunnel.md).**

---

### 👁️ 4. Monitoreo de VPS (Koram Monitor)

Centraliza la vigilancia del estado de salud de tus VPS (CPU, RAM, disco) y estado de tus procesos PM2 en una sola interfaz web.

- **El Gran Ojo (Servidor Central)**: El hub con el Dashboard interactivo web.
- **El Centinela (Agente)**: Centinelas ligeros ejecutándose en segundo plano en cada servidor remoto que reportan datos al Hub.
- **Despliegue setup automático**: Comando interactivo (`koram monitor:setup`) para conectarse, aprovisionar dependencias y dejar todo corriendo en PM2 con persistencia.

👉 **Para ver cómo desplegar el servidor y agentes de monitoreo, lee la [Guía de Monitoreo de VPS (docs/monitor.md)](docs/monitor.md).**

---

### 💾 5. Módulo de Copias de Seguridad (Koram Backup)
Automatización y resguardo de datos críticos, integrando backups de bases de datos y carpetas del servidor de forma declarativa.
* **Respaldo de MongoDB**: Genera dumps comprimidos y estructurados con credenciales seguras.
* **Respaldos de Directorios**: Comprime carpetas y archivos aplicando exclusiones flexibles (patrones de ignorado).
* **Multi-Servidor y Retención**: Admite servidores dedicados para backups, los descarga localmente a un directorio `./backups/` seguro (auto-ignorado en Git) y mantiene únicamente la cantidad configurada de copias históricas locales y remotas.

👉 **Para ver la guía de configuración y comandos de backups, lee la [Guía de Backups (docs/backup.md)](docs/backup.md).**

---

## 🔑 Registro Único de Credenciales (Bóveda de Seguridad)

Antes de desplegar código o configurar infraestructura, guarda tus claves y contraseñas por única vez bajo un alias en la bóveda encriptada del sistema:

* **Servidor SSH:**
  ```bash
  koram creds:add mi-vps-alias root 64.23.174.86
  ```
* **AWS S3 Cloud:**
  ```bash
  koram creds:add mi-s3-alias s3
  ```

👉 **Para ver la guía completa de almacenamiento de credenciales y seguridad, lee la [Guía de Credenciales (docs/creds.md)](docs/creds.md).**

---

## 🌌 El Legado Komarquino

Koram es la llave que conecta el conocimiento de los antiguos con la tecnología moderna.  
Solo los Komarquinos que lo dominen pueden desplegar proyectos con la precisión de un ritual ancestral.

---

## 🏢 Komarca Labs (Komarcalabs)

_"Forjando herramientas sagradas para desarrolladores legendarios"_

* 📦 **Paquete oficial en npm:** [npmjs.com/package/koram](https://www.npmjs.com/package/koram)
* 🐙 **Repositorio oficial en GitHub:** [github.com/Komarcalabs/koram-cli](https://github.com/Komarcalabs/koram-cli)
* 🏢 **Organización:** [Komarca Labs (Komarcalabs)](https://github.com/Komarcalabs)
* 💬 **Reporte de problemas y sugerencias:** [Issues](https://github.com/Komarcalabs/koram-cli/issues)
* 🌐 **Keywords:** `koram`, `koram-cli`, `komarcalabs`, `komarca labs`, `komarquino`, `devops`, `despliegues`, `infraestructura`
