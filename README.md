Koram
=====

El Libro Sakrado del Wen Komarquino
[![Version](https://img.shields.io/npm/v/koram.svg)](https://npmjs.org/package/koram)
[![Downloads/week](https://img.shields.io/npm/dw/koram.svg)](https://npmjs.org/package/koram)
[![License](https://img.shields.io/npm/l/koram.svg)](https://github.com/OTROS/koram/blob/master/package.json)

<!-- toc -->
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
<!-- usage -->
```sh-session
$ npm install -g koram
$ koram COMMAND
running command...
$ koram (-v|--version|version)
koram/0.0.3 darwin-x64 node-v8.17.0
$ koram --help [COMMAND]
USAGE
  $ koram COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`koram help [COMMAND]`](#koram-help-command)
* [`koram login`](#koram-login)
* [`koram ui`](#koram-ui)

## `koram help [COMMAND]`

display help for koram

```
USAGE
  $ koram help [COMMAND]

ARGUMENTS
  COMMAND  command to show help for

OPTIONS
  --all  see all commands in CLI
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v3.2.0/src/commands/help.ts)_

## `koram login`

Logueate como wen komarquino

```
USAGE
  $ koram login

OPTIONS
  -u, --user=user  nickname komarquino

DESCRIPTION
  ...
  Comando de login en la plataforma koram
```

_See code: [src/commands/login.js](https://gitlab.com/komarca-kodebase/koram-cli/blob/v0.0.3/src/commands/login.js)_

## `koram ui`

Abre nuestro libro sakrado en tu navegador

```
USAGE
  $ koram ui

DESCRIPTION
  ...
  Comando para abrir el koram
```

_See code: [src/commands/ui.js](https://gitlab.com/komarca-kodebase/koram-cli/blob/v0.0.3/src/commands/ui.js)_
<!-- commandsstop -->
