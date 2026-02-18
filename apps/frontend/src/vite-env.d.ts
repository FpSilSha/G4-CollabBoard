/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH0_DOMAIN: string;
  readonly VITE_AUTH0_CLIENT_ID: string;
  readonly VITE_AUTH0_AUDIENCE: string;
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Extend Fabric.js object types to include our custom data property.
// Fabric.js v5 types don't declare 'data' on objects, so we augment them.
// Per .clauderules: every Fabric.js object MUST store its board object ID
// in fabricObject.data.id.
declare module 'fabric/fabric-impl' {
  interface IObjectOptions {
    data?: {
      id: string;
      type: string;
      text?: string;
      shapeType?: string;
      [key: string]: unknown;
    };
  }
}
