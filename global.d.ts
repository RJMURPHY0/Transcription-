// Allow side-effect CSS imports (e.g. `import './globals.css'` in layout.tsx)
declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}
