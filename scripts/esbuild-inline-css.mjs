import { readFile } from 'node:fs/promises';

export const inlineComponentCss = {
  name: 'inline-component-css',
  setup(context) {
    context.onLoad({ filter: /\.css$/u }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      return {
        contents: `if(typeof document!==\"undefined\"){const style=document.createElement(\"style\");style.textContent=${JSON.stringify(source)};document.head.append(style);}`,
        loader: 'js',
      };
    });
  },
};
