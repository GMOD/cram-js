const path = require('path')

module.exports = {
  mode: 'production',
  entry: './dist/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'cram-bundle.js',
    library: 'gmodCRAM',
    libraryTarget: 'window',
  },
}
