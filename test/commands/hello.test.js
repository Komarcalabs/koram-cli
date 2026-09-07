const {expect, test} = require('@oclif/test')

describe('init command help', () => {
  test
  .stdout()
  .command(['help', 'init'])
  .it('runs help init and displays description', ctx => {
    expect(ctx.stdout).to.contain('Inicializa un archivo de configuración')
  })
})



