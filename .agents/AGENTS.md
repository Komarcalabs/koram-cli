<!-- KORAM_AGENT_RULES_START -->
# Reglas de Uso de Koram

- **Configuración de Proyectos**: Siempre verifica si existe un archivo de configuración `.koram-rc.<entorno>.json` (ej: `.koram-rc.production.json`) en la raíz de los proyectos para comprender cómo están estructurados y configurados sus despliegues.
- **Sincronización del Servidor Web (IaC)**: Al modificar archivos de configuración de Nginx locales en `.koram/webserver/` (ej: archivos `.conf` o `.kr.conf`), recuerda que la fuente de verdad es local. Debes sincronizar los cambios al servidor remoto utilizando el comando `koram infra:webserver -e <entorno>`.
- **Credenciales y Seguridad**: Nunca expongas credenciales SSH o contraseñas en archivos de código o de configuración. Utiliza la bóveda segura del CLI ejecutando `koram creds:add` para registrar las credenciales bajo un alias.
- **Motores de Despliegue**: 
  - Usa `koram deploy:spa` para proyectos frontend estáticos (Vite, React, Vue, HTML puro).
  - Usa `koram deploy:nuxt` para proyectos Node.js SSR / Nuxt.js.
  - Usa `koram deploy:pm2` para despliegues tradicionales usando `ecosystem.config.js`.
- **Monitoreo y Backups**: Si necesitas gestionar copias de seguridad de base de datos o carpetas, revisa si hay bloques `backup` configurados y usa `koram infra:backup`. Para monitorear el estado del servidor, usa `koram monitor:setup` y relacionados.
<!-- KORAM_AGENT_RULES_END -->
