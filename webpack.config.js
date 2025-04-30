import path from 'path'
import { fileURLToPath } from 'url'

// Get the equivalent of __dirname in ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default {
  mode: 'production',
  entry: './dist/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'cram-bundle.js',
    library: 'gmodCRAM',
    libraryTarget: 'window',
  },
}
