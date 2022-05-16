const path = require('path')

module.exports = {
  mode: 'production',
  entry: './dist/index.js',
  resolve: {
    fallback: {
      buffer: require.resolve('buffer/'),
      url: require.resolve('url/'),
    },
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'cram-bundle.js',
    library: 'gmodCRAM',
    libraryTarget: 'window',
  },
}
