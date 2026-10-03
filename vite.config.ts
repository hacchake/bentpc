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

// 単一 HTML にするため、ページごとに作る：ふつうは index.html（ラック）、--mode studio で studio.html（スタジオ）、--mode sampler で sampler.html（サンプラー）
export default defineConfig(({ mode }) => ({
  plugins: [workletPlugin(), viteSingleFile()],
  // GitHub Pages（https://hacchake.github.io/bentpc/）で公開するための置き場所。
  // ※ 単一 HTML 化のプラグインがページ内のパスを相対（./）に直すので、手元のサーバーでは http://localhost:5178/ のまま開く
  base: '/bentpc/',
  server: { port: 5178 },
  build: {
    outDir: 'dist',
    emptyOutDir: mode !== 'studio' && mode !== 'sampler',
    assetsInlineLimit: 100000000,
    rollupOptions: { input: mode === 'studio' ? 'studio.html' : mode === 'sampler' ? 'sampler.html' : 'index.html' },
  },
}));
