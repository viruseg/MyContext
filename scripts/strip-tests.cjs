const fs = require('fs');

const path = process.argv[2];
const names = process.argv.slice(3);

let lines = fs.readFileSync(path, 'utf8').split('\n');
const withoutEol = (line) => line.replace(/\r$/, '');

for (const name of names) {
  const needle = `test('${name}'`;
  const start = lines.findIndex((line) => withoutEol(line).trimStart().startsWith(needle));
  if (start < 0) {
    console.log('MISS ' + name);
    continue;
  }
  let end = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    // Ровно два пробела: у тела самого уровня столько, а у `});` внутри
    // `page.evaluate` — четыре, и по обрезке такой строки тело развалилось бы.
    if (withoutEol(lines[i]) === '  });') {
      end = i;
      break;
    }
  }
  if (end < 0) {
    console.log('NOEND ' + name);
    continue;
  }
  let tail = end + 1;
  if (tail < lines.length && withoutEol(lines[tail]).trim() === '') tail += 1;
  let head = start;
  if (head > 0 && withoutEol(lines[head - 1]).trim() === '') head -= 1;
  lines.splice(head, tail - head);
  console.log('REMOVED ' + name);
}

fs.writeFileSync(path, lines.join('\n'));
