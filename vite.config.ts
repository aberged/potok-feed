import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';

function potokBuildPlugin(): Plugin {
  let resolvedConfig: ResolvedConfig;

  return {
    name: 'potok-build',
    apply: 'build',
    configResolved(config) {
      resolvedConfig = config;
    },
    async writeBundle() {
      const distDir = path.resolve(resolvedConfig.root, resolvedConfig.build.outDir);
      const html = await readFile(path.join(distDir, 'index.html'), 'utf8');
      const bodyHtml = extractBodyHtml(html);
      const css = await collectReferencedContent(html, distDir, /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi);
      const js = await collectReferencedContent(html, distDir, /<script\b[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi);

      await writeFile(path.join(distDir, 'potok-build.html'), createPotokHtml({ bodyHtml, css, js }), 'utf8');
    },
  };
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

function createPotokHtml({ bodyHtml, css, js }: { bodyHtml: string; css: string; js: string }): string {
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
  };
});