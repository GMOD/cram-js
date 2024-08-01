const webpack = require('webpack')
const path = require('path')

module.exports = {
  mode: 'production',
  entry: './dist/index.js',
  plugins: [
    // this is needed to properly polyfill buffer in desktop, after the CRA5
    // conversion it was observed cram, twobit, etc that use
    // @gmod/binary-parser complained of buffers not being real buffers
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
    }),
  ],
  resolve: {
    fallback: {
      buffer: require.resolve('buffer/'),
    },
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'cram-bundle.js',
    library: 'gmodCRAM',
    libraryTarget: 'window',
  },
}
