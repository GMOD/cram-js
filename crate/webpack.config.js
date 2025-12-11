const path = require('path')

module.exports = {
  mode: 'production',
  entry: path.resolve(__dirname, 'src/wrapper.js'),
  output: {
    path: path.resolve(__dirname, '../src/wasm'),
    filename: 'inflate-wasm-inlined.js',
    library: {
      type: 'module',
    },
  },
  experiments: {
    outputModule: true,
  },
  module: {
    rules: [
      {
        test: /\.wasm$/,
        type: 'asset/inline',
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.wasm'],
  },
  optimization: {
    minimize: true,
  },
}
