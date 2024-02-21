export function parseHeaderText(text: string) {
  const lines = text.split(/\r?\n/)
  const data: {
    tag: string
    data: {
      tag: string
      value: string
    }[]
  }[] = []
  for (const line of lines) {
    const [tag, ...fields] = line.split(/\t/)
    if (tag) {
      data.push({
        tag: tag.slice(1),
        data: fields.map(f => {
          const r = f.indexOf(':')
          return r !== -1
            ? {
                tag: f.slice(0, r),
                value: f.slice(r + 1),
              }
            : // @CO lines are not comma separated.
              // See "samtools view -H c2\#pad.3.0.cram"
              // so, just store value tag and value itself
              {
                tag: f,
                value: '',
              }
        }),
      })
    }
  }
  return data
}
