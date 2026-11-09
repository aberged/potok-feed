import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';

// Vite writes here the packages bundled into the app, with their license texts
// (`build.license`), and potokBuildPlugin puts them at the top of the script.
const LICENSE_FILE = '.vite/license.json';

function potokBuildPlugin(): Plugin {
  let resolvedConfig: ResolvedConfig;

  return {
    name: 'potok-build',
    apply: 'build',
    configResolved(config) {
      resolvedConfig = config;
    },
    async writeBundle(_options, bundle) {
      const distDir = path.resolve(resolvedConfig.root, resolvedConfig.build.outDir);
      const html = await readFile(path.join(distDir, 'index.html'), 'utf8');
      const bodyHtml = extractBodyHtml(html);
      const css = await collectReferencedContent(html, distDir, /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi);
      const js = await collectReferencedContent(html, distDir, /<script\b[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi);
      const licenseAsset = bundle[LICENSE_FILE];
      const licenses = licenseAsset?.type === 'asset' ? licenseComment(licenseAsset.source) : '';

      await writeFile(path.join(distDir, 'potok-build.html'), createPotokHtml({ bodyHtml, css, js, licenses }), 'utf8');
    },
  };
}

type BundledPackage = { name: string; version: string; identifier?: string; text?: string };

// One legal comment with the name, version and license text of each bundled
// package, or nothing when the app bundles none.
function licenseComment(source: string | Uint8Array): string {
  const packages = JSON.parse(typeof source === 'string' ? source : new TextDecoder().decode(source)) as BundledPackage[];
  if (packages.length === 0) {
    return '';
  }

  const entries = packages.map(({ name, version, identifier, text }) =>
    [`${name} ${version}${identifier ? ` (${identifier})` : ''}`, text].filter(Boolean).join('\n\n'),
  );
  // A `*/` inside a license text would close the comment early, and some
  // packages ship their license with CRLF line ends.
  const body = entries.join('\n\n\n').replace(/\r\n?/g, '\n').replace(/\*\//g, '* /');
  return `/*! The packages bundled into this app and their licenses:\n\n${body}\n*/`;
}

async function collectReferencedContent(html: string, distDir: string, pattern: RegExp): Promise<string> {
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const match of html.matchAll(pattern)) {
    const referencedFile = normalizeBundlePath(match[1]);
    if (!referencedFile || seen.has(referencedFile)) {
      continue;
    }

    seen.add(referencedFile);
    parts.push((await readFile(path.join(distDir, referencedFile), 'utf8')).trim());
  }

  return parts.join('\n');
}

function normalizeBundlePath(fileName: string): string {
  return fileName.replace(/^\/+/, '').replace(/^\.\//, '');
}

function extractBodyHtml(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) {
    return '';
  }

  return match[1].trim();
}

function escapeInlineContent(value: string, tagName: 'script' | 'style'): string {
  const closingTag = new RegExp(`</${tagName}`, 'gi');
  return value.replace(closingTag, `<\\/${tagName}`);
}

function createPotokHtml({ bodyHtml, css, js, licenses }: { bodyHtml: string; css: string; js: string; licenses: string }): string {
  return [
    '<!-- style goes here -->',
    '<style>',
    escapeInlineContent(css, 'style'),
    '</style>',
    '<!-- style ends here -->',
    '',
    '<!-- html goes here -->',
    bodyHtml,
    '<!-- html ends here -->',
    '',
    '<!-- script wrapper -->',
    '<script type="module">',
    ...(licenses ? [escapeInlineContent(licenses, 'script')] : []),
    '(()=>{',
    '  console.debug("<#HOOK#> loading script -> wait for potok");',
    '  const interval = setInterval(() => {',
    '    const host = document.querySelector("#group-panel-description")',
    '    if (host && host.potok &&host.potok.insertGroupValue) {',
    '      clearInterval(interval);',
    '      console.debug("<#HOOK#> potok found, loading app");',
    '      const potok = host.potok;',
    '      potok.eventListenerOptions = {signal: potok.abortController.signal};',
    '//////////////////////',
    '// app code goes here',
    '//////////////////////',
    '',
    escapeInlineContent(js, 'script'),
    '',
    '//////////////////////',
    '// end of app code',
    '/////////////////////',
    '    }',
    '  }, 300);',
    '})();',
    '</script>',
    '<!-- script wrapper ends here -->',
    '',
  ].join('\n');
}

export default defineConfig(async ({ command }) => {
  const plugins: Plugin[] = [potokBuildPlugin()];

  const tailwind = (await import('@tailwindcss/vite')).default;
  plugins.push(tailwind());

  return {
    plugins,
    build: {
      license: { fileName: LICENSE_FILE },
      rolldownOptions: {
        // Vite drops legal comments when it minifies. Keep them (`@license`,
        // `/*!`), so notices written in the code itself reach the build too.
        output: { comments: { legal: true } },
      },
    },
  };
});