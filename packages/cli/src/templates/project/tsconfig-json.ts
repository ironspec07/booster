export const template = `{
  "compilerOptions": {
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "importHelpers": true,
    "module": "commonjs",
    "strict": true,
    "target": "es2017",
    "noImplicitReturns": true,
    "noImplicitThis": true,
    "noUnusedLocals": true,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "plugins": [{ "transform": "@boostercloud/metadata-booster" }],
    "sourceMap":true
  },
  "include": ["src/**/*"]
}
`
