// Node test reporter for CI: turns each failing test into a GitHub Actions error
// annotation, which stays readable without access to the full job log.
const escapeData = text => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = text => escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

export default async function* githubReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail' || event.data.details?.type === 'suite') continue;
    const {name, file, line, details} = event.data;
    const error = details?.error?.cause ?? details?.error;
    const message = (error?.stack ?? error?.message ?? String(error)).split('\n').slice(0, 15).join('\n');
    const location = file ? `file=${escapeProperty(file)},line=${line ?? 1},` : '';
    yield `::error ${location}title=${escapeProperty(name)}::${escapeData(message)}\n`;
  }
}
