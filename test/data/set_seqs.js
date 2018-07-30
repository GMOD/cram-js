const fs = require('fs')

function getFeatures(data) {
  const features = []
  if (data.length && data.forEach) {
    data.forEach(d => {
      features.push(...getFeatures(d))
    })
  } else if (data.features) {
    features.push(...data.features)
  } else if (typeof data === 'object') {
    Object.entries(data).forEach(([k, d]) => {
      features.push(...getFeatures(d))
    })
  }
  return features
}

fs.readdirSync('.')
  .filter(f => /dump.json/.test(f))
  //.filter(f => /ce#1000/.test(f))
  .forEach(filename => {
    const data = require(`./${filename}`)
    const features = getFeatures(data)
    console.log(`${filename} has ${features.length} features`)

    const samFile = filename.replace('.dump.json', '.sam')
    if (fs.existsSync(samFile)) {
      console.log(`${filename} has a sam file`)
      const sequences = {}
      fs.readFileSync(samFile)
        .toString('ascii')
        .split('\n')
        .forEach(line => {
          const fields = line.split('\t')
          const name = fields[0]
          const seq = fields[9]
          if (!sequences[name]) sequences[name] = []
          sequences[name].push(seq)
        })

      // if (sequences.s0c) {
      //   console.log(sequences.s0c)
      // }

      let replaced = false
      features.forEach(feature => {
        const samSeq =
          sequences[feature.readName] && sequences[feature.readName][0]
        if (feature.readBases === '*') {
          delete feature.readBases
          replaced = true
        }
        if (samSeq) {
          if (samSeq !== feature.readBases) replaced = true
          if (samSeq === '*') {
            delete feature.readBases
          } else {
            feature.readBases = samSeq
          }
          // console.log(`${feature.readName} = ${samSeq}`)
          sequences[feature.readName].shift()
        }
      })
      if (replaced) {
        fs.writeFileSync(filename, JSON.stringify(data, null, '  '))
      }
    } else {
      console.log(`${filename} has no sam file`)
    }
  })
