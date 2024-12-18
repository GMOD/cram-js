const fs = require('fs')

const s = process.argv[2]
const s2 = s.replaceAll('#', '__')
fs.renameSync(s, s2)
