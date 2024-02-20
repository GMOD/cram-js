export function parseHeaderText(text: string) {
  const lines = text.split(/\r?\n/)
  const data: {
    tag: string
    data: {
      tag: string
      value: string | undefined
    }[]
  }[] = []
  for (const line of lines) {
    const [tag, ...fields] = line.split(/\t/)
    if (tag) {
      data.push({
        tag: tag.slice(1),
        data: fields.map(f => {
          const r = f.indexOf(':')
          if (r !== -1) {
            return {
              tag: f.slice(0, r),
              value: f.slice(r + 1),
            }
          } else {
            // @CO lines are not comma separated.
            // See "samtools view -H c2\#pad.3.0.cram"
            // so, just store value tag itself
            return {
              tag: f,
              value: undefined,
            }
          }
        }),
      })
    }
  }
  return data
}
