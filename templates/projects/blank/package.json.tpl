{
  "name": "{{name}}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "cross-env NODE_OPTIONS=\"--no-deprecation --max-old-space-size=8000\" next build",
    "dev": "cross-env NODE_OPTIONS=--no-deprecation next dev",
    "generate:importmap": "cross-env NODE_OPTIONS=--no-deprecation payload generate:importmap",
    "generate:types": "cross-env NODE_OPTIONS=--no-deprecation payload generate:types",
    "payload": "cross-env NODE_OPTIONS=--no-deprecation payload",
    "start": "cross-env NODE_OPTIONS=--no-deprecation next start"
  },
  "dependencies": {
    "{{dbAdapterPackage}}": "{{payloadVersion}}",
    "@payloadcms/next": "{{payloadVersion}}",
    "@payloadcms/plugin-multi-tenant": "{{payloadVersion}}",
{{#if corporate}}    "@payloadcms/plugin-form-builder": "{{payloadVersion}}",
{{/if}}    "@payloadcms/richtext-lexical": "{{payloadVersion}}",
    "@payloadcms/ui": "{{payloadVersion}}",
    "cross-env": "^7.0.3",
    "graphql": "^16.8.1",
    "next": "16.3.8",
    "payload": "{{payloadVersion}}",
    "react": "19.2.6",
    "react-dom": "19.2.6",
    "sharp": "0.35.5"
  },
  "devDependencies": {
    "@types/node": "22.19.9",
    "@types/react": "19.2.14",
    "@types/react-dom": "19.2.3",
    "typescript": "5.7.3"
  },
  "engines": {
    "node": "^18.20.2 || >=20.9.0"
  }
}
