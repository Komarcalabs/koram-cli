const {expect} = require('chai')
const {getNativePackagesToRebuild} = require('../../src/utils/deploy/nuxt-executor')

describe('NuxtExecutor - Native Dependencies & Rebuild Detection', () => {
  it('should detect sqlite3 and better-sqlite3 in package.json dependencies', () => {
    const pkg = {
      dependencies: {
        sqlite3: '^5.1.7',
        pruvious: '^1.0.0',
        vue: '^3.4.0',
      },
    }
    const detected = getNativePackagesToRebuild(pkg)
    expect(detected).to.deep.equal(['sqlite3'])
  })

  it('should detect multiple native packages from JSON string', () => {
    const pkgString = JSON.stringify({
      dependencies: {
        'better-sqlite3': '^9.4.0',
        sharp: '^0.33.0',
        express: '^4.18.0',
      },
    })
    const detected = getNativePackagesToRebuild(pkgString)
    expect(detected).to.include('better-sqlite3')
    expect(detected).to.include('sharp')
    expect(detected).to.not.include('express')
  })

  it('should return custom configured rebuild array when provided', () => {
    const pkg = {dependencies: {sqlite3: '^5.0.0'}}
    const custom = ['sqlite3', 'custom-native-addon']
    const detected = getNativePackagesToRebuild(pkg, custom)
    expect(detected).to.deep.equal(custom)
  })

  it('should return ["--all"] when configuredRebuild is true and no known packages match', () => {
    const pkg = {dependencies: {lodash: '^4.17.21'}}
    const detected = getNativePackagesToRebuild(pkg, true)
    expect(detected).to.deep.equal(['--all'])
  })

  it('should return empty array when no native packages are detected', () => {
    const pkg = {dependencies: {vue: '^3.0.0', pinia: '^2.0.0'}}
    const detected = getNativePackagesToRebuild(pkg)
    expect(detected).to.deep.equal([])
  })
})
