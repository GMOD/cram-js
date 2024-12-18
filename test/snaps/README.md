## Source of files

cram31.cram was made with

```sh
samtools view volvox-sorted.bam --output-fmt-option version=3.1 -T volvox.fa -o out.cram
```

## Generate test files

```bash

while read p; do echo "import { testFile } from '.../testUtil'; testFile('$p')" >! ${p//\//\_}.test.ts; done < testFileList.txt
```
