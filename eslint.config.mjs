import next from "@next/eslint-plugin-next";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import importPlugin from "eslint-plugin-import";
import tsParser from "@typescript-eslint/parser";

/**
 * Configuración de ESLint en formato plano (BL-014).
 *
 * Sustituye a `.eslintrc.json` + `next lint`. Dos motivos, ninguno cosmético:
 *
 * 1. `next lint` ya avisa «deprecated and will be removed in Next.js 16». El gate `lint` es
 *    required en 04_BUILD_REPORT.json, así que el día que se suba a Next 16 el verify-run se
 *    rompería por una razón ajena al código. Se corta esa dependencia antes de que muerda.
 *
 * 2. `.eslintrc.json` excluía `tests/e2e/**` — unas 2.500 líneas, y de las más frágiles del repo:
 *    son las que hablan con el navegador. Quedaban fuera de todo análisis estático.
 *
 * POR QUÉ NO SE USA `FlatCompat`, que es la ruta de migración habitual de Next: `@eslint/eslintrc`
 * hace `import minimatch from "minimatch"`, y este proyecto fuerza `minimatch: ^10.2.6` con un
 * override —puesto para cerrar GHSA-mh99-v99m-4gvg— cuya build no expone ese default. ESLint muere
 * al cargar la config. Es el MISMO choque que ese override ya provocó en julio con el proveedor de
 * cobertura (`test-exclude`→`glob`→`minimatch`), documentado en aitri/BACKLOG.md. Así que en vez de
 * puentear la config legacy se compone directamente con los plugins, que sí publican config plana.
 *
 * El conjunto de reglas reproduce `next/core-web-vitals` pieza por pieza —se leyó
 * `eslint-config-next/index.js` para copiarlo, no se aproximó— de modo que la migración no relaja
 * el análisis: lo amplía a tests/e2e.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },

  // Base de Next: recommended + core-web-vitals, igual que hacía `next/core-web-vitals`.
  next.flatConfig.coreWebVitals,

  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"], // React 19 no necesita el import en ámbito
  reactHooks.configs["recommended-latest"],

  {
    files: ["**/*.{js,mjs,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "detect" } },
    // `jsx-a11y` e `import` se REGISTRAN pero NO se extiende su `recommended`: eslint-config-next
    // tampoco lo hacía —declara los plugins y enciende reglas sueltas—, y activarlos enteros metía
    // 19 errores nuevos en un gate que es bloqueante. Ampliar la exigencia de accesibilidad es una
    // decisión de producto con su propio coste, no un efecto colateral de cambiar de formato.
    plugins: { "jsx-a11y": jsxA11y, import: importPlugin },
    rules: {
      // Copiadas de eslint-config-next/index.js, con su severidad original.
      "import/no-anonymous-default-export": "warn",
      "react/no-unknown-property": "off",
      "react/prop-types": "off",
      "react/jsx-no-target-blank": "off",
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
      "jsx-a11y/alt-text": ["warn", { elements: ["img"], img: ["Image"] }],
    },
  },

  {
    // tests/e2e ENTRA en el análisis. La única regla que se apaga, y con motivo concreto:
    // Playwright pasa un callback llamado `use` a sus fixtures —`async ({}, use) => { await use(x) }`—
    // y `react-hooks/rules-of-hooks` lo confunde con el hook `use` de React, que no tiene nada que
    // ver. Es el único hallazgo de las 2.500 líneas y es un falso positivo, así que se apaga aquí
    // en vez de deformar el código de las fixtures para contentar a una regla que no aplica.
    files: ["tests/e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
];

export default config;
