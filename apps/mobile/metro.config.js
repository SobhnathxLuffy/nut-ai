const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')
const fs = require('node:fs')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// Watch the whole workspace so edits to packages/* hot-reload in the app.
config.watchFolders = [workspaceRoot]

// The bundled nutrition corpus is a binary asset, not source.
config.resolver.assetExts = [...config.resolver.assetExts, 'db', 'wasm']
config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs']

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
config.resolver.disableHierarchicalLookup = true

const originalResolveRequest = config.resolver.resolveRequest

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.includes('sqlite3-worker1')) {
    return { type: 'empty' }
  }

  const isRelative = moduleName.startsWith('./') || moduleName.startsWith('../')

  if (isRelative && moduleName.endsWith('.js')) {
    const originDir = path.dirname(context.originModulePath)
    const asTs = path.resolve(originDir, moduleName.replace(/\.js$/, '.ts'))
    if (fs.existsSync(asTs)) {
      moduleName = moduleName.replace(/\.js$/, '')
    }
  }

  return originalResolveRequest
    ? originalResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform)
}

module.exports = config
