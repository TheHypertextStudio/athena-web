#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const tools = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(tools, "../..");
const bytes = await readFile(path.join(tools, "tools.json"));
const spec = JSON.parse(bytes);
const runtime = JSON.parse(await readFile(path.join(tools, "runtime.json")));
if (!isDeepStrictEqual(runtime.spec, spec))
  throw Error("Formatter pins changed; rerun hook setup");
const npm = createRequire(path.join(runtime.npm, "../package.json"));
const importedPrettier = await import(pathToFileURL(npm.resolve("prettier")));
const prettier = importedPrettier.default ?? importedPrettier;
if (prettier.version !== runtime.prettier)
  throw Error("Prepared Prettier version does not match repository pin");
if (spec.prettier.manifest) {
  const data = JSON.parse(
    await readFile(path.join(repo, spec.prettier.manifest)),
  );
  let version = data.devDependencies?.prettier ?? data.dependencies?.prettier;
  if (version?.startsWith("catalog:"))
    version = (
      await readFile(path.join(repo, "pnpm-workspace.yaml"), "utf8")
    ).match(/^\s+prettier:\s*['"]?(\d+\.\d+\.\d+)/m)?.[1];
  if (version !== runtime.prettier)
    throw Error("Repository Prettier pin changed; rerun hook setup");
}
const filename = path.resolve(repo, process.argv[2]);
const parser = process.argv[3];
const source = await new Promise((resolve, reject) => {
  let text = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (text += chunk));
  process.stdin.on("end", () => resolve(text));
  process.stdin.on("error", reject);
});

const configFile = await prettier.resolveConfigFile(filename);
const contexts = [];
for (
  let folder = configFile ? path.dirname(configFile) : path.dirname(filename);
  ;
) {
  const manifest = await readFile(path.join(folder, "package.json"), "utf8")
    .then(JSON.parse)
    .catch(() => null);
  if (manifest)
    contexts.push({
      folder,
      manifest,
      dependencies: { ...manifest.dependencies, ...manifest.devDependencies },
    });
  if (folder === repo || !folder.startsWith(repo + path.sep)) break;
  folder = path.dirname(folder);
}
const dependencies = Object.assign(
  {},
  ...contexts.toReversed().map((context) => context.dependencies),
);
const workspaceModules = new Map();
const exactVersion = (value) =>
  typeof value === "string" && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value);
const scalar = (value) => value.trim().replace(/^(['"])(.*)\1$/, "$2");

function declaringContext(base) {
  const context = contexts.find(
    (value) => value.manifest.name === base || value.dependencies[base],
  );
  if (!context)
    throw Error("Project config dependency is not declared: " + base);
  return context;
}

async function expectedVersion(base) {
  const context = declaringContext(base);
  if (context.manifest.name === base) {
    if (!exactVersion(context.manifest.version))
      throw Error("Workspace config package needs an exact version: " + base);
    workspaceModules.set(base, context.folder);
    return context.manifest.version;
  }
  const declared = context.dependencies[base];
  if (exactVersion(declared)) return declared;
  // pnpm's root importer is authoritative for ranges and catalog references. Require the
  // matching specifier as well, so a stale lock cannot bless a changed package manifest.
  const lock = await readFile(path.join(repo, "pnpm-lock.yaml"), "utf8").catch(
    () => "",
  );
  const importerName =
    path.relative(repo, context.folder).split(path.sep).join("/") || ".";
  const sections = (lock.split(/^importers:\s*$/m)[1] ?? "").split(
    /^(?= {2}\S)/m,
  );
  const importer = sections.find(
    (section) =>
      scalar(section.split("\n")[0].trim().replace(/:$/, "")) === importerName,
  );
  if (importer) {
    const lines = importer.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const key = lines[index].match(/^ {6}(.+):\s*$/);
      if (!key || scalar(key[1]) !== base) continue;
      const fields = {};
      for (
        let next = index + 1;
        next < lines.length && /^ {8}/.test(lines[next]);
        next++
      ) {
        const field = lines[next].match(/^ {8}(specifier|version):\s*(.+)$/);
        if (field) fields[field[1]] = scalar(field[2]);
      }
      if (
        fields.specifier === declared &&
        declared.startsWith("workspace:") &&
        fields.version?.startsWith("link:")
      ) {
        const folder = path.resolve(context.folder, fields.version.slice(5));
        if (folder !== repo && !folder.startsWith(repo + path.sep))
          throw Error("Workspace config link escapes repository");
        const metadata = JSON.parse(
          await readFile(path.join(folder, "package.json"), "utf8"),
        );
        const requested = declared.slice("workspace:".length);
        if (
          metadata.name !== base ||
          !exactVersion(metadata.version) ||
          (exactVersion(requested) && requested !== metadata.version)
        ) {
          throw Error(
            "Workspace config package does not match its declaration: " + base,
          );
        }
        workspaceModules.set(base, folder);
        return metadata.version;
      }
      const version = fields.version?.match(
        /^(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?:\(|$)/,
      )?.[1];
      if (fields.specifier === declared && version) return version;
    }
  }
  if (declared === "catalog:") {
    const workspace = await readFile(
      path.join(repo, "pnpm-workspace.yaml"),
      "utf8",
    );
    const catalog =
      workspace.split(/^catalog:\s*$/m)[1]?.split(/^\S/m)[0] ?? "";
    for (const line of catalog.split("\n")) {
      const field = line.match(/^ {2}(.+):\s*(.+)$/);
      if (field && scalar(field[1]) === base && exactVersion(scalar(field[2])))
        return scalar(field[2]);
    }
  }
  throw Error("Cannot establish exact locked project dependency: " + base);
}

function packageParts(name) {
  const parts = name.split("/");
  return name.startsWith("@")
    ? [parts.slice(0, 2).join("/"), parts.slice(2)]
    : [parts[0], parts.slice(1)];
}

async function validateModule(filename, base, expected) {
  let folder = path.dirname(filename);
  while (true) {
    const metadata = await readFile(path.join(folder, "package.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (metadata?.name === base) {
      if (metadata.version !== expected)
        throw Error(
          `Project dependency ${base} resolved ${metadata.version}; expected ${expected}`,
        );
      return filename;
    }
    const parent = path.dirname(folder);
    if (parent === folder)
      throw Error("Cannot identify resolved project dependency: " + base);
    folder = parent;
  }
}

async function projectModule(name) {
  const [base, rest] = packageParts(name);
  const expected = await expectedVersion(base);
  const context = declaringContext(base);
  let direct;
  try {
    direct = createRequire(path.join(context.folder, "package.json")).resolve(
      name,
    );
  } catch {
    // An absent direct installation can still resolve from a verified workspace or cache.
  }
  if (workspaceModules.has(base)) {
    const folder = workspaceModules.get(base);
    const metadata = JSON.parse(
      await readFile(path.join(folder, "package.json"), "utf8"),
    );
    const exported = rest.length
      ? metadata.exports?.["./" + rest.join("/")]
      : (metadata.exports?.["."] ?? metadata.main);
    const relative =
      typeof exported === "string"
        ? exported
        : (exported?.import ?? exported?.default);
    if (!relative || typeof relative !== "string")
      throw Error("Workspace config export is missing: " + name);
    const resolved = path.resolve(folder, relative);
    if (!resolved.startsWith(folder + path.sep))
      throw Error("Workspace config export escapes package");
    return validateModule(resolved, base, expected);
  }
  if (direct) return validateModule(direct, base, expected);
  const prefix = base.replace("/", "+") + "@";
  const stores = [
    ...new Set([
      path.join(context.folder, "node_modules/.pnpm"),
      path.join(repo, "node_modules/.pnpm"),
    ]),
  ];
  const matches = [];
  for (const store of stores)
    for (const entry of (await readdir(store).catch(() => [])).filter((value) =>
      value.startsWith(prefix),
    )) {
      const folder = path.join(store, entry, "node_modules", base);
      const metadata = await readFile(path.join(folder, "package.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null);
      if (metadata?.name !== base || metadata.version !== expected) continue;
      const peer = entry.match(
        /(?:^|_)prettier@(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?:_|$)/,
      )?.[1];
      const declaredPrettier = context.dependencies.prettier;
      const preferredPeer = exactVersion(declaredPrettier)
        ? declaredPrettier
        : runtime.prettier;
      if (peer && peer !== preferredPeer) continue;
      let resolved;
      if (!rest.length) {
        try {
          resolved = createRequire(path.join(folder, "package.json")).resolve(
            base,
          );
        } catch {
          // This cached package has no root export; keep searching matching snapshots.
        }
      } else {
        const exported = metadata.exports?.["./" + rest.join("/")];
        const relative =
          typeof exported === "string"
            ? exported
            : (exported?.import ?? exported?.default);
        if (typeof relative === "string" && relative.startsWith("./"))
          resolved = path.resolve(folder, relative);
      }
      if (resolved)
        matches.push(await validateModule(resolved, base, expected));
    }
  if (matches.length > 1)
    throw Error("Ambiguous locked project dependency peer snapshots: " + name);
  if (matches.length === 1) return matches[0];
  throw Error(
    "Install the locked project config dependency: " + name + "@" + expected,
  );
}

async function pluginModule(name) {
  const [base] = packageParts(name);
  if (dependencies[base]) {
    const expected = await expectedVersion(base);
    try {
      return await projectModule(name);
    } catch (error) {
      // A mismatched or ambiguous project installation is an error, not a cache fallback.
      if (
        !error.message.startsWith(
          "Install the locked project config dependency:",
        )
      )
        throw error;
      if (spec.npm[base] !== expected)
        throw Error("Project plugin pin changed; rerun hook setup: " + base, {
          cause: error,
        });
      return validateModule(npm.resolve(name), base, expected);
    }
  }
  if (!spec.npm[base])
    throw Error("Formatter plugin has no exact tool pin: " + base);
  return validateModule(npm.resolve(name), base, spec.npm[base]);
}

let config;
if (configFile && /\.(?:mjs|cjs|js)$/.test(configFile)) {
  const text = await readFile(configFile, "utf8");
  const imports = [
    ...text.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g,
    ),
  ]
    .map((match) => match[1])
    .filter(
      (name) =>
        !name.startsWith(".") &&
        !name.startsWith("/") &&
        !name.startsWith("node:"),
    );
  const resolved = new Map(
    await Promise.all(
      [...new Set(imports)].map(async (name) => [
        name,
        pathToFileURL(await projectModule(name)).href,
      ]),
    ),
  );
  const configURL = pathToFileURL(configFile).href;
  // Resolve this config's own validated imports while executing the original file unchanged.
  // Relative imports, import.meta.url, and composed configuration remain native Node behavior.
  const hooks = registerHooks({
    resolve(name, context, next) {
      if (context.parentURL === configURL && resolved.has(name))
        return { url: resolved.get(name), shortCircuit: true };
      return next(name, context);
    },
  });
  try {
    config = (await import(configURL)).default;
  } finally {
    hooks.deregister();
  }
} else {
  config = await prettier.resolveConfig(filename);
}
config = { ...config };
config.plugins = await Promise.all(
  (config.plugins ?? []).map((plugin) =>
    typeof plugin === "string" ? pluginModule(plugin) : plugin,
  ),
);
const addon = {
  xml: "@prettier/plugin-xml",
  toml: "prettier-plugin-toml",
  sql: "prettier-plugin-sql",
  sh: "prettier-plugin-sh",
  ini: "prettier-plugin-ini",
  properties: "prettier-plugin-properties",
  astro: "prettier-plugin-astro",
}[parser];
if (addon && spec.npm[addon]) config.plugins.push(await pluginModule(addon));
if (parser === "sql") config.language = spec.sql_dialect ?? "postgresql";
// Java properties comments do not continue across physical lines. Values can;
// never trim a continuation merely because it begins with a comment marker.
function propertiesEntries(text) {
  const entries = new Map();
  const decode = (value) =>
    value.replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/g, (_, escape) => {
      if (escape.startsWith("u"))
        return String.fromCharCode(parseInt(escape.slice(1), 16));
      return { t: "\t", n: "\n", r: "\r", f: "\f" }[escape] ?? escape;
    });
  let logical = "";
  let continued = false;
  for (let line of text.split(/\r\n|\r|\n/)) {
    if (!continued && /^[ \t\f]*(?:[#!]|$)/.test(line)) continue;
    if (continued) line = line.replace(/^[ \t\f]+/, "");
    logical += line;
    continued = (line.match(/\\+$/)?.[0].length ?? 0) % 2 === 1;
    if (continued) {
      logical = logical.slice(0, -1);
      continue;
    }
    const content = logical.replace(/^[ \t\f]+/, "");
    let end = 0;
    for (; end < content.length; end++) {
      if (content[end] === "\\") end++;
      else if (/[=:\t\f ]/.test(content[end])) break;
    }
    let start = end;
    while (/[ \t\f]/.test(content[start] ?? "") && start < content.length)
      start++;
    if (content[start] === "=" || content[start] === ":") start++;
    while (/[ \t\f]/.test(content[start] ?? "") && start < content.length)
      start++;
    entries.set(decode(content.slice(0, end)), decode(content.slice(start)));
    logical = "";
  }
  if (continued) {
    // A dangling continuation at EOF still contributes the logical entry.
    return propertiesEntries(text + "\n");
  }
  return [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function cleanPropertiesCommentWhitespace(text) {
  let continued = false;
  return text
    .split(/(?<=\n)/)
    .map((physical) => {
      const body = physical.replace(/\r?\n$/, "");
      const comment = !continued && /^[ \t\f]*[#!]/.test(body);
      continued = !comment && (body.match(/\\+$/)?.[0].length ?? 0) % 2 === 1;
      return comment ? physical.replace(/[ \t]+(\r?\n|$)/, "$1") : physical;
    })
    .join("");
}

let formatted = await prettier.format(source, {
  ...config,
  filepath: filename,
  ...(parser
    ? { parser: parser === "properties" ? "dot-properties" : parser }
    : {}),
});
if (parser === "properties") {
  formatted = cleanPropertiesCommentWhitespace(formatted);
  if (
    !isDeepStrictEqual(propertiesEntries(source), propertiesEntries(formatted))
  )
    throw Error(
      "Properties formatter changed a key or value; staged bytes were not changed",
    );
}
process.stdout.write(formatted);
