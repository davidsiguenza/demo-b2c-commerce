export function parseArgs(argv) {
  const positional = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === '-o') {
      options.output = argv[index + 1];
      index += 1;
      continue;
    }

    if (!value.startsWith('-')) {
      positional.push(value);
      continue;
    }

    const normalized = value.replace(/^--/, '');

    if (normalized.includes('=')) {
      const [key, raw] = normalized.split(/=(.*)/s);
      options[toCamelCase(key)] = raw;
      continue;
    }

    const next = argv[index + 1];
    const hasValue = next && !next.startsWith('-');

    if (hasValue) {
      options[toCamelCase(normalized)] = next;
      index += 1;
      continue;
    }

    options[toCamelCase(normalized)] = true;
  }

  return {
    positional,
    options,
  };
}

function toCamelCase(input) {
  return input.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
