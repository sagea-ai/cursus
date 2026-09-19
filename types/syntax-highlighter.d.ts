// Ambient types for react-syntax-highlighter's deep ESM imports (the light
// build keeps Prism grammars for exactly the languages we register, instead
// of bundling every grammar). @types/react-syntax-highlighter only covers
// the top-level entry. `any` here is load-bearing: grammar modules are
// untyped refractor functions consumed solely via registerLanguage.
declare module "react-syntax-highlighter/dist/esm/languages/prism/*" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const language: any;
  export default language;
}

declare module "react-syntax-highlighter/dist/esm/styles/prism" {
  export const oneDark: { [key: string]: React.CSSProperties };
}
