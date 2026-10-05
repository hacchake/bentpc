declare module '*?worklet' {
  const url: string;
  export default url;
}
declare module '*.css';
declare module '*?worker&inline' {
  const W: { new (): Worker };
  export default W;
}
interface ImportMeta {
  readonly env: { readonly PROD: boolean; readonly DEV: boolean; readonly MODE: string };
}
