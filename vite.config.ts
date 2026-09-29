import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// AudioWorklet 用のコードを esbuild で1本にまとめ、Blob URL として読み込めるようにする。
// `import url from './processor.ts?worklet'` と書くと、単一HTMLビルドでも動く。
function workletPlugin(): Plugin {
  return {
    name: 'inline-worklet',
    async load(id) {
      if (!id.endsWith('?worklet')) return null;
      const file = id.slice(0, -'?worklet'.length);
      const result = await build({
        entryPoints: [file],
        bundle: true,
        write: false,
        format: 'iife',
        target: 'es2020',
        minify: true,
        metafile: true,
      });
      const code = result.outputFiles[0].text;
      for (const f of result.metafile ? Object.keys(result.metafile.inputs) : []) this.addWatchFile(resolve(f));
      return `const code = ${JSON.stringify(code)};
export default URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));`;
    },
  };
}

// 単一 HTML にするため、ページごとに作る：ふつうは index.html（ラック）、--mode studio で studio.html（スタジオ）
export default defineConfig(({ mode }) => ({
  plugins: [workletPlugin(), viteSingleFile()],
  server: { port: 5178 },
  build: {
    outDir: 'dist',
    emptyOutDir: mode !== 'studio',
    assetsInlineLimit: 100000000,
    rollupOptions: { input: mode === 'studio' ? 'studio.html' : 'index.html' },
  },
}));
